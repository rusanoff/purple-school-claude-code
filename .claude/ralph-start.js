const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { startSession } = require('./ralph-session')

// Same anchoring as the Stop Hook: work from the repo root whatever directory
// the script was called from, so the config, git and the spawned session agree.
const projectDir = path.resolve(__dirname, '..')
process.chdir(projectDir)

const CONFIG_FILE = path.join(projectDir, '.claude/ralph.config.json')
const COUNTER_FILE = path.join(projectDir, '.claude/ralph.iterations.json')
const PID_FILE = path.join(projectDir, '.claude/ralph.pid')

const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))

const phases = config.phases?.length
  ? config.phases
  : [{ milestone: config.milestone, branch: config.branch }]

const readCounter = () => {
  try {
    return JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8'))
  } catch {
    return null
  }
}

// Sessions are detached, so a running loop leaves no trace in any terminal.
// Without this check a second start would put two Ralphs on the same branches
// and milestones at once.
const runningPid = () => {
  let pid
  try {
    pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim())
  } catch {
    return null
  }
  if (!pid) return null

  // A dead pid leaves the file behind, and pids get reused — so ask ps what
  // that process actually is instead of trusting the number.
  try {
    const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' })
    return command.includes('claude') ? pid : null
  } catch {
    return null
  }
}

const busyPid = runningPid()
if (busyPid) {
  console.error(`❌ Ralph уже работает: фоновая сессия pid ${busyPid}.`)
  console.error('   Смотри .claude/ralph.log; чтобы остановить — kill ' + busyPid)
  process.exit(1)
}

// The loop is meant to survive an interruption — a session limit, a laptop
// reboot — so by default it picks up at the phase the counter stopped on. Only
// --restart starts the whole plan over from phases[0].
const saved = process.argv.includes('--restart') ? null : readCounter()
const phaseIndex = saved?.phaseIndex ?? 0
const startCount = saved?.count ?? 0
const phase = phases[phaseIndex]

if (!phase) {
  console.log('🎉 Все фазы уже пройдены. Нужен новый прогон — запусти с --restart.')
  process.exit(0)
}

if (!phase?.milestone || !phase?.branch) {
  console.error(`❌ В конфиге нет ни phases[${phaseIndex}], ни пары milestone + branch.`)
  process.exit(1)
}

if (!config.active) {
  console.error('❌ active: false — Stop Hook выйдет сразу, и цикл оборвётся после первой сессии.')
  console.error('   Поставь "active": true в .claude/ralph.config.json.')
  process.exit(1)
}

const baseBranch = config.baseBranch || 'master'

// Аргументы массивом, а не строкой: и в prompt, и в названиях милстоунов есть
// кавычки, пробелы и двоеточия, которые шелл переврал бы.
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' })

const branchExists = (branch) => {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

// Ветку первой фазы готовим здесь же, кодом. Дальше по фазам это делает Stop
// Hook (checkoutPhaseBranch), и только старт раньше полагался на то, что модель
// не забудет правило из ralph.md — а забыв, она начала бы фазу от текущего
// HEAD, и коммиты предыдущей ветки уехали бы в PR этой.
const prepareBranch = () => {
  run('git', ['checkout', baseBranch])
  run('git', ['pull', '--ff-only', 'origin', baseBranch])

  if (branchExists(phase.branch)) {
    run('git', ['checkout', phase.branch])
    console.log(`ℹ️ Ветка ${phase.branch} уже есть — продолжаем на ней.`)
    return
  }

  run('git', ['checkout', '-b', phase.branch])
}

try {
  prepareBranch()
} catch (error) {
  console.error(`❌ Не удалось подготовить ветку ${phase.branch}: ${error.message}`)
  console.error('   Обычно это незакоммиченные изменения — закоммить или спрячь их в stash.')
  process.exit(1)
}

// Счётчик пишем только после успешной подготовки ветки, чтобы упавший старт не
// затирал прогресс уже идущего прогона. Итерации фазы не обнуляем: они —
// бюджет попыток на эту фазу, и продолжение прогона его не возвращает.
fs.writeFileSync(COUNTER_FILE, JSON.stringify({ count: startCount, phaseIndex }))

const prompt = config.prompt.replace('{milestone}', phase.milestone).replace('{branch}', phase.branch)

console.log(
  `🚀 Ralph, фаза ${phaseIndex + 1}/${phases.length}: ${phase.milestone} (ветка ${phase.branch})`,
)
if (startCount > 0) console.log(`   Продолжаем с итерации ${startCount + 1}/${config.maxIterations}.`)

// Первая сессия запускается так же, как все следующие: отвязанной, с выводом в
// лог. Иначе она держала бы терминал часами, а цикл всё равно ушёл бы в фон
// после неё — Stop Hook вкладывать сессии друг в друга больше не умеет.
const pid = startSession({
  projectDir,
  prompt,
  maxTurns: config.maxTurns,
  label: `${phase.milestone} | ${phase.branch}`,
})

console.log(`\n▶️ Цикл идёт в фоне, сессия pid ${pid}.`)
console.log('   tail -f .claude/ralph.log     — что Ralph делает сейчас')
console.log('   kill $(cat .claude/ralph.pid) — остановить цикл')
