const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

// Сессии Ралфа запускаются отвязанными — почему именно так, написано в
// hooks/stop.js. Запускают их двое (стартер и Stop Hook), поэтому механика
// живёт здесь, а не копией в каждом.
const startSession = ({ projectDir, prompt, maxTurns, label }) => {
  const logFile = path.join(projectDir, '.claude/ralph.log')
  const pidFile = path.join(projectDir, '.claude/ralph.pid')

  const log = fs.openSync(logFile, 'a')
  fs.writeSync(log, `\n=== ${new Date().toISOString()} | ${label}\n`)

  // detached: своя группа процессов, поэтому сессия переживает и хук, и тот
  // claude, внутри которого хук отработал.
  const child = spawn('claude', ['-p', prompt, '--max-turns', String(maxTurns)], {
    cwd: projectDir,
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, RALPH_CHILD: '' },
  })
  child.unref()
  fs.closeSync(log)

  // Фоновой сессии не видно ни в одном терминале — pid-файл единственный
  // способ отличить идущий цикл от завершённого и остановить его.
  fs.writeFileSync(pidFile, String(child.pid))
  return child.pid
}

module.exports = { startSession }
