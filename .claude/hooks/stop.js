const { execSync } = require('child_process')
const fs = require('fs')

const config = JSON.parse(fs.readFileSync('.claude/ralph.config.json', 'utf8'))

const output = execSync(
  `gh issue list --milestone "${config.milestone}" --state open --json number,title`,
).toString()
const issues = JSON.parse(output)

if (issues.length > 0) {
  const next = issues[0]
  console.log(`🔄 Слудующий Issue #${next.number}: ${next.title}`);

  let prompt = config.prompt.replace('{milestone}', config.milestone);
  prompt = prompt.replace('{branch}', config.branch);

  execSync(`claude -p "${prompt}"`, { stdio: 'inherit' })
} else {
  console.log('✅ Milestone завершен. Создаём PR')
  execSync(
    `gh pr create --title "feat: ${config.milestone}" --body "Closes all issues in milestone ${config.milestone}" --base main --head ${config.branch}`,
    { stdio: 'inherit' },
  )
}
