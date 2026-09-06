const { execFileSync } = require('child_process')
const fs = require('fs')

const config = JSON.parse(fs.readFileSync('.claude/ralph.config.json', 'utf8'))

const phases = config.phases?.length
  ? config.phases
  : [{ milestone: config.milestone, branch: config.branch }]
const phase = phases[0]

if (!phase?.milestone || !phase?.branch) {
  console.error('❌ В конфиге нет ни phases[0], ни пары milestone + branch.')
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

// Счётчик сбрасываем только после успешной подготовки ветки, чтобы упавший
// старт не затирал прогресс уже идущего прогона.
fs.writeFileSync('.claude/ralph.iterations.json', JSON.stringify({ count: 0, phaseIndex: 0 }))

const prompt = config.prompt.replace('{milestone}', phase.milestone).replace('{branch}', phase.branch)

console.log(`🚀 Запускаем Ralph для milestone: ${phase.milestone} (ветка ${phase.branch})`)

run('claude', ['-p', prompt, '--max-turns', String(config.maxTurns)])
