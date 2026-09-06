const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const CONFIG_FILE = '.claude/ralph.config.json'
const COUNTER_FILE = '.claude/ralph.iterations.json'

const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))

if (!config.active) process.exit(0)

// The repository's default branch is master, not main.
const baseBranch = config.baseBranch || 'master'
const mergeWaitMinutes = config.mergeWaitMinutes ?? 60
const mergePollSeconds = config.mergePollSeconds ?? 30
const ghRetries = config.ghRetries ?? 4
const ghRetryDelaySeconds = config.ghRetryDelaySeconds ?? 5

// Every external command goes through execFileSync with an argument array:
// milestone names contain spaces, quotes and dashes that a shell would mangle.
const capture = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim()
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' })

const tryRun = (cmd, args) => {
  try {
    execFileSync(cmd, args, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const sleepSeconds = (seconds) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000)

// One blip on api.github.com used to kill the whole cycle: the hook exited and
// nothing restarted it. Network-bound calls get a few tries with backoff.
const withRetry = (label, fn) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return fn()
    } catch (error) {
      if (attempt >= ghRetries) throw error
      const delay = ghRetryDelaySeconds * attempt
      console.log(`⚠️ ${label}: попытка ${attempt}/${ghRetries} не удалась, повтор через ${delay} с...`)
      sleepSeconds(delay)
    }
  }
}

const gh = (args) => withRetry(`gh ${args.slice(0, 2).join(' ')}`, () => capture('gh', args))

const saveCounter = (counter) => fs.writeFileSync(COUNTER_FILE, JSON.stringify(counter))

// stdin is /dev/null on purpose: the hook's own stdin holds Claude Code's JSON
// payload, which a nested `claude -p` would read as extra prompt input.
const runClaude = (prompt, extraArgs = []) =>
  execFileSync('claude', ['-p', prompt, ...extraArgs], {
    stdio: ['ignore', 'inherit', 'inherit'],
  })

// gh lists issues newest-first, but issues inside a milestone depend on each
// other in creation order — sort ascending so we pick the actually-next one.
const listIssues = (milestone, state) =>
  JSON.parse(
    gh([
      'issue',
      'list',
      '--milestone',
      milestone,
      '--state',
      state,
      '--json',
      'number,title',
      '--limit',
      '100',
    ]),
  ).sort((a, b) => a.number - b.number)

const findOpenPr = (branch) => {
  const prs = JSON.parse(
    gh([
      'pr',
      'list',
      '--head',
      branch,
      '--base',
      baseBranch,
      '--state',
      'open',
      '--json',
      'number,url',
    ]),
  )
  return prs.length > 0 ? prs[0] : null
}

const createPr = (phase) => {
  withRetry('git push', () => run('git', ['push', '--set-upstream', 'origin', phase.branch]))

  const closed = listIssues(phase.milestone, 'closed')
  const body = [
    `Фаза: ${phase.milestone}`,
    '',
    'PR создан Ralph Stop Hook после закрытия всех Issues милстоуна.',
    '',
    '## Закрытые Issues',
    ...closed.map((issue) => `- #${issue.number} — ${issue.title}`),
    '',
    '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
    '',
  ].join('\n')

  const bodyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-pr-')), 'body.md')
  fs.writeFileSync(bodyFile, body)

  // Not retried: a second create would collide with the PR the first one may
  // have already opened. On failure we look the branch up before giving up —
  // and a real failure throws, so phaseIndex never advances past a PR-less
  // phase (handled by the catch at the bottom).
  try {
    run('gh', [
      'pr',
      'create',
      '--base',
      baseBranch,
      '--head',
      phase.branch,
      '--title',
      `feat: ${phase.milestone}`,
      '--body-file',
      bodyFile,
    ])
  } catch (error) {
    const pr = findOpenPr(phase.branch)
    if (!pr) throw error
    console.log(`ℹ️ gh pr create отчитался ошибкой, но PR #${pr.number} создан.`)
    return pr
  }

  const pr = findOpenPr(phase.branch)
  if (!pr) throw new Error(`PR для ветки ${phase.branch} не найден после создания`)
  return pr
}

const waitForMerge = (prNumber) => {
  const deadline = Date.now() + mergeWaitMinutes * 60 * 1000

  for (;;) {
    const { state } = JSON.parse(gh(['pr', 'view', String(prNumber), '--json', 'state']))

    if (state === 'MERGED') {
      console.log(`✅ PR #${prNumber} смержен.`)
      return true
    }
    if (state === 'CLOSED') {
      console.log(`⛔ PR #${prNumber} закрыт без мержа.`)
      return false
    }
    if (Date.now() >= deadline) {
      console.log(`⏳ PR #${prNumber} не смержен за ${mergeWaitMinutes} мин.`)
      return false
    }

    console.log(`⏳ Ждём мержа PR #${prNumber}...`)
    sleepSeconds(mergePollSeconds)
  }
}

// The next phase branches off a freshly pulled base rather than the previous
// phase's HEAD — otherwise the previous phase's commits leak into its PR.
const checkoutPhaseBranch = (branch) => {
  run('git', ['checkout', baseBranch])
  withRetry('git pull', () => run('git', ['pull', '--ff-only', 'origin', baseBranch]))

  if (tryRun('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])) {
    run('git', ['checkout', branch])
    if (!tryRun('git', ['merge-base', '--is-ancestor', baseBranch, branch])) {
      console.log(`⚠️ Ветка ${branch} уже существует и отстаёт от ${baseBranch} — проверь вручную.`)
    }
    return
  }

  run('git', ['checkout', '-b', branch])
}

const startPhase = (phase) => {
  const prompt = config.prompt
    .replace('{milestone}', phase.milestone)
    .replace('{branch}', phase.branch)

  runClaude(prompt, ['--max-turns', String(config.maxTurns)])
}

const main = () => {
  let counter = { count: 0, phaseIndex: 0 }
  if (fs.existsSync(COUNTER_FILE)) {
    counter = JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8'))
  }

  const phases = config.phases?.length
    ? config.phases
    : [{ milestone: config.milestone, branch: config.branch }]
  const phase = phases[counter.phaseIndex]

  if (!phase) {
    console.log('🎉 Все фазы завершены.')
    return
  }

  if (counter.count >= config.maxIterations) {
    console.log(`⛔ Лимит итераций (${config.maxIterations}) достигнут.`)
    saveCounter({ count: 0, phaseIndex: counter.phaseIndex })
    return
  }

  const openIssues = listIssues(phase.milestone, 'open')

  if (openIssues.length > 0) {
    counter.count++
    saveCounter(counter)

    const next = openIssues[0]
    console.log(
      `🔄 Фаза ${counter.phaseIndex + 1} — Итерация ${counter.count}/${config.maxIterations} — Issue #${next.number}: ${next.title}`,
    )
    console.log(`📋 Осталось: ${openIssues.length}`)

    startPhase(phase)
    return
  }

  console.log(`✅ Фаза ${counter.phaseIndex + 1} завершена. Создаём PR...`)

  let pr = findOpenPr(phase.branch)
  if (pr) {
    console.log(`ℹ️ PR #${pr.number} уже открыт — переиспользуем его.`)
  } else {
    pr = createPr(phase)

    console.log('🔍 Ревью Fable 5.1...')
    runClaude(
      `Проведи детальное code review PR #${pr.number}. Проверь архитектуру, безопасность, производительность и соответствие PRD. Оставь комментарии в PR через gh cli.`,
      ['--model', 'claude-fable-5-1', '--max-turns', String(config.maxTurns)],
    )
  }

  if (!waitForMerge(pr.number)) {
    console.log(`⏸️ Цикл остановлен: смержи PR #${pr.number} и запусти Ralph снова.`)
    return
  }

  counter.phaseIndex++
  counter.count = 0
  saveCounter(counter)

  const nextPhase = phases[counter.phaseIndex]
  if (!nextPhase) {
    console.log('🎉 Все фазы завершены!')
    return
  }

  console.log(`➡️ Фаза ${counter.phaseIndex + 1}: ${nextPhase.milestone}`)
  checkoutPhaseBranch(nextPhase.branch)
  startPhase(nextPhase)
}

try {
  main()
} catch (error) {
  // phaseIndex is left alone so the next run retries the interrupted step.
  console.error(`❌ Ralph: шаг прерван — ${error.message}`)
  process.exit(1)
}
