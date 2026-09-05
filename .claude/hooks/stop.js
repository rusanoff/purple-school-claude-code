const { execFileSync } = require('child_process');
const fs = require('fs');

const configFile = '.claude/ralph.config.json';
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));

if (!config.active) {
  process.exit(0);
}

// Счетчик итераций
const counterFile = '.claude/ralph.iterations.json';
let counter = { count: 0 };
if (fs.existsSync(counterFile)) {
  try {
    const saved = JSON.parse(fs.readFileSync(counterFile, 'utf8'));
    if (Number.isInteger(saved.count)) {
      counter = saved;
    }
  } catch {
    // пустой или битый файл — начинаем счёт заново
  }
}

const writeCounter = (count) =>
  fs.writeFileSync(counterFile, JSON.stringify({ count }));

if (counter.count >= config.maxIterations) {
  console.log(
    `⛔ Достигнут лимит итераций (${config.maxIterations}). Ralph останавливается.`,
  );
  writeCounter(0);
  process.exit(0);
}

const gh = (args) => execFileSync('gh', args).toString().trim();

// Проверяем открытые Issues
const issues = JSON.parse(
  gh([
    'issue',
    'list',
    '--milestone',
    config.milestone,
    '--state',
    'open',
    '--json',
    'number,title',
  ]),
  // gh отдаёт сначала свежие — берём в порядке создания, как в плане
).sort((a, b) => a.number - b.number);

if (issues.length > 0) {
  // Увеличиваем счетчик
  counter.count++;
  writeCounter(counter.count);

  const next = issues[0];
  console.log(
    `🔄 Итерация ${counter.count}/${config.maxIterations} — Issue #${next.number}: ${next.title}`,
  );

  const prompt = config.prompt
    .replace('{milestone}', config.milestone)
    .replace('{branch}', config.branch);

  execFileSync(
    'claude',
    ['-p', prompt, '--max-turns', String(config.maxTurns)],
    {
      stdio: 'inherit',
    },
  );
} else {
  console.log('✅ Milestone завершен. Создаём PR');
  writeCounter(0);

  // Разоружаемся ДО запуска ревью: сессия ревью ниже завершится в этом же
  // репозитории и снова вызовет этот хук — открытых Issue уже нет, так что он
  // снова попадёт сюда и породит ещё одну сессию ревью, и так бесконечно. Счётчик
  // эту ветку не ограничивает (здесь он как раз сбрасывается) — ограничивает флаг.
  // Новый milestone — снова выставить active: true вручную.
  fs.writeFileSync(
    configFile,
    JSON.stringify({ ...config, active: false }, null, 2) + '\n',
  );

  const base = gh([
    'repo',
    'view',
    '--json',
    'defaultBranchRef',
    '--jq',
    '.defaultBranchRef.name',
  ]);

  execFileSync('git', ['push', '-u', 'origin', config.branch], {
    stdio: 'inherit',
  });

  const existing = gh([
    'pr',
    'list',
    '--head',
    config.branch,
    '--json',
    'url',
    '--jq',
    '.[0].url // empty',
  ]);

  const prUrl =
    existing ||
    gh([
      'pr',
      'create',
      '--title',
      `feat: ${config.milestone}`,
      '--body',
      `Closes all issues in milestone ${config.milestone}`,
      '--base',
      base,
      '--head',
      config.branch,
    ]);

  console.log(`🔍 Запускаем финальное ревью через Fable: ${prUrl}`);

  execFileSync(
    'claude',
    [
      '-p',
      `Сделай детальное код-ревью PR ${prUrl}. Проверь архитектуру, безопасность, производительность и соответствие PRD. Оставь комментарии в PR через gh cli.`,
      '--model',
      'claude-fable-5',
    ],
    { stdio: 'inherit' },
  );
}
