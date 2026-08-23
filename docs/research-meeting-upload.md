# Research: технологическая реализация загрузки файлов встреч

**План:** @docs/plan-meeting-file-upload-and-display.md
**PRD:** @docs/prd-meeting-file-upload-and-display.md
**Дата:** 2026-08-23

## Контекст стека

- Backend: NestJS 11, платформа **Fastify** (`@nestjs/platform-fastify`; до 2026-08-23 была Express, переведено на Fastify — см. `apps/backend/CLAUDE.md`), CQRS, Prisma 6 + Postgres, JWT-guard (`JwtAuthGuard`, читает `FastifyRequest`, не Express `Request`).
- Frontend: Next.js 16.2.10 (App Router), клиент — `lib/api.ts` (`apiFetch`) поверх `fetch`, токен в `localStorage`.
- Frontend → backend только через same-origin rewrite `/api/:path*` → `${BACKEND_URL}/:path*` (`apps/frontend/next.config.ts`) — прямых запросов к `:3001` быть не должно, это ограничивает выбор технологий на фронте (см. раздел про rewrite ниже).
- Хранилище — локальный диск backend-сервера (S3/MinIO явно вне скоупа PRD).

Ниже — варианты и рекомендации по каждому техническому узлу с учётом уже принятых в кодовой базе паттернов (CQRS, `ValidationPipe` с `forbidNonWhitelisted`, owner-или-участник доступ).

---

## 1. Приём multipart-запроса на backend

### Fastify, не Express — `FileInterceptor`/`multer` не подходят

Backend переведён на `@nestjs/platform-fastify` (см. `apps/backend/CLAUDE.md`). Официальная документация NestJS по загрузке файлов (`FileInterceptor`/`@UploadedFile()`, построенные поверх `multer`) явно помечена как **несовместимая с `FastifyAdapter`** — этот путь, описанный в предыдущей версии этого документа, для текущего стека не применим. Рекомендованный для Fastify инструмент — плагин `@fastify/multipart`, который нужно установить и зарегистрировать отдельно (в `apps/backend/package.json` его сейчас нет).

### Регистрация плагина

`@fastify/multipart` регистрируется один раз на уровне Fastify-инстанса в `src/main.ts`, а не декоратором на контроллере:

```ts
import multipart from '@fastify/multipart';
// ...
await app.register(multipart, {
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 }, // 1 файл за запрос — batch вне скоупа PRD
});
```

По умолчанию плагин сам ограничивает `fileSize` 1MB «из соображений безопасности» — лимит обязательно нужно переопределить под реальный максимум (документы + аудио/видео), иначе легитимные загрузки будут отклоняться уже на этом уровне.

### Чтение файла в контроллере/хендлере — без `FileInterceptor`

Без Express-интерсептора у Nest нет отдельного шага «файл уже провалидирован и лежит в `request.file`» до входа в бизнес-логику — multipart разбирает сам обработчик через `await request.file()`:

```ts
const data = await request.file(); // { file: Readable, filename, mimetype, fields }
if (!ALLOWED_MIME_REGEX.test(data.mimetype)) {
  throw new BadRequestException('Unsupported file type');
}
await pipeline(data.file, createWriteStream(diskPath)); // потоково, без буферизации в памяти
if (data.file.truncated) {
  await fs.unlink(diskPath); // лимит fileSize превышен — частично записанный файл на диске подчистить
  throw new BadRequestException('File too large');
}
```

Несколько следствий для архитектуры этого приложения:

- **Валидация MIME** — по `data.mimetype`, который плагин берёт из заголовка `Content-Type` конкретной multipart-части — это, как и в Express+multer варианте, **значение, присланное клиентом**, а не результат анализа содержимого (magic bytes). То же ограничение и та же оговорка, что PRD не требует антивирус/глубокую проверку — allowlist на этом уровне достаточен как первый рубеж; `mimetype` доступен сразу в `data`, поэтому проверку можно сделать **до** старта записи на диск, не читая поток.
- **Валидация размера** — не отдельным pipe-компонентом (аналога `ParseFilePipeBuilder` для этого пути нет), а через `limits.fileSize` плагина + флаг `data.file.truncated`, который выставляется после того, как поток исчерпал лимит. Поток при этом не обрывается с ошибкой — он тихо обрезается, значит **обязательно** проверять `truncated` после `pipeline()` и вручную удалять частично записанный файл, иначе на диске останется недописанный файл без записи в БД (или обрезанный файл ошибочно посчитается валидным).
- **Отклонение до записи vs после**: MIME проверяется до записи (дёшево), размер — только после того, как поток уже потёк на диск до лимита (Fastify не знает реальный размер тела заранее для потокового multipart). Это отличается от multer, где `fileFilter` также вызывается до старта записи, но по сути то же самое ограничение — Node-стриминг в принципе не знает итоговый размер, пока не примет данные.
- **Отклонение MIME до старта записи на диск** — так же, как в multer-варианте: если `data.mimetype` не проходит allowlist, `data.file` можно даже не пайпить в `createWriteStream`, а сразу дренировать/отбросить поток и вернуть 400 — файл с недопустимым типом на диск вообще не попадает.
- MIME allowlist держать одним источником правды — константа/enum, используемая **и** здесь на backend, **и** в клиентской валидации `<input accept="...">` на фронте (Фаза 4 плана), чтобы не разъезжались.

### Хранение на диске — потоковая запись, без буферизации в памяти

`data.file` — `Readable`-поток; `pipeline(data.file, fs.createWriteStream(diskPath))` из `node:stream/promises` пишет на диск по мере приёма, не накапливая файл целиком в памяти процесса — то же требование, что и в исходном multer-варианте (важно для аудио/видео, которые могут быть заметно крупнее документов). Альтернатива — `await data.toBuffer()`, которая ждёт весь файл в `Buffer` и **бросает исключение** при превышении лимита (более простая обработка ошибки, чем проверка `truncated`), но не годится для этой фичи по той же причине, по которой не годился `memoryStorage` у multer: несколько параллельных загрузок видео исчерпают память процесса.

- `diskPath`: директория вне `src`/`dist`, задаваемая через `.env` (например, `FILE_STORAGE_DIR`, по аналогии с `DATABASE_URL`/`JWT_SECRET` в `.env.example`), с дефолтом вроде `./uploads` относительно cwd процесса. Директорию нужно добавить в `apps/backend/.gitignore` (сейчас файла нет — надо создать) — загруженные файлы не должны попадать в git.
- Имя файла на диске: **не использовать `data.filename` как есть** — путь-трэверсал (`../../etc/passwd`) и коллизии имён; официальный README `@fastify/multipart` отдельно предупреждает не доверять присланному имени файла напрямую. Генерировать имя как `randomUUID()` (+ сохранённое расширение из `data.filename`, санитизированное whitelist-регэкспом), а оригинальное имя хранить только в БД (`MeetingFile.filename`) для отображения и `Content-Disposition` при скачивании — тот же подход, что уже используется в схеме для `User.id`/`Meeting.id` (`@default(uuid())`).
- Директорию назначения нужно гарантированно создать заранее (`fs.mkdir(dir, { recursive: true })` при старте модуля), иначе первая же загрузка на чистом окружении упадёт — этого за вас никто не делает ни в multer-варианте, ни здесь.

### Ошибки → HTTP-статусы, и отклонение от паттерна «controllers are transport-only»

Раз готового Nest-pipe для файловой валидации на Fastify нет, чтение/валидация/запись файла естественно ложится в **хендлер команды** (`UploadMeetingFileHandler`), а не в контроллер — это на самом деле хорошо согласуется с правилом `apps/backend/CLAUDE.md` «контроллер — только транспорт»: контроллер остаётся однострочным (`commandBus.execute(new UploadMeetingFileCommand(meetingId, user.userId, request))`), а `BadRequestException`/`ForbiddenException` за недопустимый MIME/размер/доступ хендлер выбрасывает сам — так же, как остальные хендлеры уже делают («throw Nest HTTP exceptions directly»).

Есть нюанс, которого не было в командах/запросах меньшего размера: сообщение (`UploadMeetingFileCommand`) вынуждено нести либо сырой `FastifyRequest`, либо уже прочитанный поток/буфер — то есть не чисто-примитивный payload, как остальные команды в приложении («payload fields are public readonly constructor parameters — messages are immutable value objects»). Практический компромисс — вынести чтение multipart-части (`request.file()`, MIME-проверку, запись на диск) в отдельный provider/helper (например, `MeetingFileStorageService.saveUploadedFile(request, constraints)`), вызываемый **из контроллера** до диспатча команды: тогда в `UploadMeetingFileCommand` попадают уже готовые примитивы (`filename`, `mimeType`, `size`, `path`), а не сырой request — это ближе к духу существующего паттерна (валидация — на границе HTTP, до команды), хоть контроллер и перестаёт быть строго однострочным. Это стоит явно решить на этапе имплементации: строгое соответствие «один вызов бас в контроллере» или чистота payload команды.

---

## 2. Схема Prisma для `MeetingFile`

Соответствует style существующих моделей (`@id @default(uuid())`, `@@map`, `@@index` на FK, `onDelete: Cascade`):

```prisma
model MeetingFile {
  id           String   @id @default(uuid())
  meetingId    String
  meeting      Meeting  @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  uploadedById String
  uploadedBy   User     @relation(fields: [uploadedById], references: [id], onDelete: Cascade)
  filename     String   // оригинальное имя, для отображения и Content-Disposition
  mimeType     String
  size         Int      // байты; PRD ограничивает размер — Int (до ~2ГБ) достаточен, BigInt избыточен для этого лимита
  path         String   // относительный путь/имя файла на диске (сгенерированный UUID-based), не абсолютный путь и не оригинальное имя
  createdAt    DateTime @default(now())

  @@index([meetingId])
  @@map("meeting_files")
}
```

- `onDelete: Cascade` на `meetingId` — база сама подчистит строки `MeetingFile` при удалении `Meeting` (это то, что план называет «каскад в БД сам по себе файловую систему не трогает» — файлы на диске нужно удалить отдельным шагом **до** удаления записи `Meeting`, иначе `path` из уже удалённых строк недоступен для чтения).
- `uploadedById` со связью на `User` (а не просто строка email) — так `DELETE .../files/:fileId` может сравнивать `uploadedById === currentUser.userId` напрямую, без email-нормализации. Email-based case-insensitive сопоставление (из PRD) нужно **только** для проверки «участник ли текущий пользователь» через `Meeting.participants: String[]`, не для авторства файла.
- `onDelete: Cascade` на `uploadedById` — обсуждаемо: если пользователь-автор файла может быть удалён из системы, каскад унесёт с собой и его файлы для всех участников встречи, что, вероятно, нежелательно (файл общий для встречи, не приватный для автора). Поскольку в текущей кодовой базе вообще нет удаления пользователей — это не блокер сейчас, но стоит явно решить на этапе имплементации: либо `onDelete: Cascade` (принять этот побочный эффект), либо `SetNull`/сделать `uploadedById` nullable, если позже появится удаление аккаунтов. Отметить это как открытый вопрос в плане реализации, если ещё не решено.

---

## 3. Проверка доступа owner-или-участник

PRD и план уже фиксируют правило (email, без учёта регистра, сопоставление с `Meeting.participants`). С точки зрения технологии реализации:

- Вынести в отдельный переиспользуемый сервис/утилиту (например, `MeetingAccessService` или чистая функция `assertMeetingAccess(meeting, user)`), которую используют и `GetMeetingHandler`, и все новые файловые handler'ы — так критерий «участник видит `GET /meetings/:id`» и «участник видит/скачивает файлы» гарантированно используют одну и ту же логику, а не две похожие, которые могут разойтись.
- Технически это **не** Nest `Guard` в классическом смысле (guard'ы у нас сейчас — только `JwtAuthGuard`, аутентификация, не авторизация) — авторизация уже сегодня живёт в handler'ах (see `apps/backend/CLAUDE.md`, раздел «Authorization inside the pattern»), значит owner-или-участник тоже должен остаться command/query-handler-логикой, а не превращаться в отдельный class-guard — это сохранит консистентность паттерна.
- Важное отличие от текущего поведения `GetMeetingHandler`: сейчас доступ проверяется через Prisma `where: { id, ownerId }` (несовпадение = 404, без утечки существования). Для owner-или-участник такое элегантное «слияние в WHERE» сложнее, потому что участники хранятся как `String[]` email, а не через join — Prisma это можно выразить как `where: { id, OR: [{ ownerId }, { participants: { has: userEmail } }] }` (Postgres `String[]` поддерживает `has`), но `has` регистро-зависим — значит для регистронезависимого сравнения нужно либо хранить/сравнивать email в нормализованном (lowercase) виде на уровне запроса, либо дозагрузить встречу без email-фильтра и сравнить `participants.map(p => p.toLowerCase())` в JS. Второе — надёжнее с точки зрения непредсказуемых различий в регистре и проще для чтения, но не использует индекс/не масштабируется на case-insensitive поиск по большому списку — для текущего масштаба (участники одной встречи, короткий список) это не проблема.

---

## 4. Скачивание файла

### Вариант: `StreamableFile` (рекомендуется) вместо `res.sendFile`/буферизации в память

```ts
@Get(':id/files/:fileId')
async download(
  @Res({ passthrough: true }) res: FastifyReply,
  ...
): Promise<StreamableFile> {
  const meta = await this.queryBus.execute(new GetMeetingFileQuery(...));
  const stream = createReadStream(resolveStoragePath(meta.path));
  res.header('Content-Type', meta.mimeType);
  res.header(
    'Content-Disposition',
    `attachment; filename="${encodeRFC5987(meta.filename)}"`,
  );
  return new StreamableFile(stream);
}
```

- `StreamableFile` из `@nestjs/common` работает на обеих платформах (Express и Fastify) — стримит файл с диска в ответ, не загружая его целиком в память Node; важно для видео/аудио того же порядка размера, что и при загрузке.
- Тип для `@Res()` — `FastifyReply` из пакета `fastify`, не Express `Response`; заголовки выставляются через `res.header(key, value)` (можно и `res.headers({...})`), а не через Express-style `res.set({...})`.
- Требует `@Res({ passthrough: true })`, чтобы Nest сам завершил ответ после стрима (без `passthrough` пришлось бы вызывать `res.send()`/`res.raw.end()` вручную).
- `Content-Disposition` с оригинальным `filename` из БД — но оригинальное имя может содержать не-ASCII/спецсимволы, значит нужна корректная кодировка заголовка (RFC 5987/6266, `filename*=UTF-8''...`), а не голая интерполяция строки — иначе кириллические имена файлов в `Content-Disposition` могут сломать заголовок или неправильно скачаться в некоторых браузерах.
- 404, если `fileId` не принадлежит `meetingId` (уже отражено в плане) — проверка `where: { id: fileId, meetingId }`, не просто `where: { id: fileId }`.

### Почему не отдавать файлы как статику

Раздавать `uploads/` напрямую через `ServeStaticModule`/nginx было бы проще технически, но обходит и JWT-проверку, и owner-или-участник авторизацию (PRD прямо требует 401/403 на скачивание не-участником) — с UUID-именами на диске файл всё равно не должен быть публично адресуем без проверки прав, поэтому раздача обязана идти через защищённый Nest-роут, не через статическую директорию.

---

## 5. Frontend: загрузка, прогресс, скачивание с авторизацией

### Ограничение rewrite: multipart идёт через same-origin rewrite, не напрямую к backend

`apps/frontend/next.config.ts` рьюрайтит `/api/:path*` → backend — это остаётся верным и для multipart-запросов (Next.js рьюрайты в `next.config.ts` — это HTTP-прокси на уровне сервера Next, они прозрачно проксируют произвольный body, включая `multipart/form-data`, никакого спец-кода для этого не нужно).

Важный нюанс актуальной версии Next (16.2.10, установлена в проекте): при проксировании через rewrite Next **буферизует тело запроса в памяти**, чтобы его можно было прочитать и в прокси-слое, и в целевом хендлере; лимит этого буфера регулируется experimental-опцией `proxyClientMaxBodySize` (по умолчанию 10MB). Для аудио/видео-файлов дефолт в 10MB будет резать легитимные загрузки задолго до backend-лимита — если ожидаются файлы крупнее ~10MB, `proxyClientMaxBodySize` в `next.config.ts` нужно явно поднять до значения не меньше backend-лимита (иначе фронтенд обрежет/залогирует предупреждение раньше, чем сработает серверная валидация размера).

Отдельно: установленная `next@16.2.10` (подтверждено — `apps/frontend/package.json`) содержит известные уязвимости из июльского 2026 security-релиза Next.js, закрытые в `16.2.11`, в т.ч. `CVE-2026-64641` (DoS через чрезмерную нагрузку CPU в App Router с Server Actions) и `CVE-2026-64642` (обход middleware/proxy-проверок в App Router с Turbopack + одной локалью в `i18n.locales`) — всего 9 уязвимостей исправлено в `16.2.11`/`15.5.21`. Это не специфично для файловой фичи, но раз фича добавляет новый прокси-путь с телом произвольного размера — стоит обновить Next до патч-версии `>=16.2.11` в рамках этой же работы или отдельным тикетом до релиза.

### Отправка файла: `fetch` + `FormData`, а не XHR — если прогресс не обязателен через промежуточные %

`lib/api.ts` сейчас построен вокруг `fetch`. Для самого запроса загрузки:

```ts
const form = new FormData();
form.append('file', file);
await fetch(`/api/meetings/${id}/files`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` }, // без Content-Type — браузер сам выставит multipart boundary
  body: form,
});
```

**Важно:** `Content-Type` заголовок для multipart нельзя выставлять вручную (без правильного `boundary` браузер/сервер не распарсят тело) — и `apiFetch` в `lib/api.ts` **действительно** всегда добавляет `Content-Type: application/json`, как только `init.body` задан (`...(init.body ? { 'Content-Type': 'application/json' } : {})`), без проверки типа тела; `FormData` — тоже truthy `body`, значит `apiFetch` как есть для файлового эндпоинта неприменим. Либо `apiFetch` получает опцию не подставлять `Content-Type` когда `body instanceof FormData`, либо загрузка файла идёт через отдельную функцию в новом `lib/files.ts` (что и предусмотрено планом, Фаза 4), которая не переиспользует JSON-специфичную часть `apiFetch`.

**Прогресс загрузки (PRD: «UI показывает состояние загрузки в процессе/успешно/ошибка»):** нативный `fetch` не даёт progress-событий на **upload** (только на скачивании, через `ReadableStream` тела ответа, но не запроса). Для файлов PRD размера (документы + аудио/видео) два реалистичных варианта:

- **Простой (рекомендуется для этой фичи):** трёхстрочное состояние без процентов — `idle → uploading → success/error`, реализуемое через обычный `fetch` (react state вокруг промиса). PRD формулирует критерий как «в процессе / успешно / ошибка», а не «процент загрузки» — этого достаточно и не требует ничего сверх `fetch`.
- **С процентом:** `XMLHttpRequest` с `xhr.upload.onprogress` (единственный широко поддерживаемый способ получить реальный upload-progress без сторонних библиотек) — оправдано, только если PRD/пользователь явно попросит процент, иначе не усложнять ради этого фичу лишней веткой кода (fetch vs XHR) в `lib/files.ts`.

### Скачивание с авторизацией

Обычная `<a href="/api/meetings/:id/files/:fileId">` не пронесёт `Authorization`-заголовок (localStorage-токен, не cookie) — план уже фиксирует это верно (Фаза 5). Технически:

```ts
const res = await fetch(`/api/meetings/${id}/files/${fileId}`, {
  headers: { Authorization: `Bearer ${token}` },
});
const blob = await res.blob();
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = filename; // имя из метаданных списка, не из Content-Disposition (fetch API не даёт удобного парсинга этого заголовка)
a.click();
URL.revokeObjectURL(url);
```

Компромисс этого подхода: файл целиком буферизуется в памяти браузера как `Blob` перед стартом сохранения (нет true streaming-to-disk из fetch в браузере без File System Access API, который не во всех браузерах доступен и усложняет реализацию непропорционально PRD). Для документов и типичных записей встреч это приемлемо; если ожидаются очень большие видеофайлы (сотни МБ – единицы ГБ) на слабых клиентских устройствах, стоит на этапе реализации протестировать реальный верхний предел размера и при необходимости явно задать более консервативный max-size для аудио/видео, чем «сколько выдержит браузер».

---

## 6. Тестирование (backend e2e, `supertest`)

План требует e2e-тесты первым пунктом каждой backend-фазы. Multipart через `supertest`:

```ts
await request(app.getHttpServer())
  .post(`/meetings/${meetingId}/files`)
  .set('Authorization', `Bearer ${token}`)
  .attach('file', Buffer.from('fake video content'), {
    filename: 'recording.mp4',
    contentType: 'video/mp4',
  })
  .expect(201);
```

- `.attach(field, buffer, { filename, contentType })` — не нужен реальный файл на диске в тестовом фикстуре, буфер в памяти достаточен и не требует бинарных файлов в репозитории. `supertest` формирует multipart-запрос на клиентской стороне и не зависит от платформы сервера (Express/Fastify) — этот вызов не меняется из-за перехода на Fastify.
- Стандартный для этого репозитория e2e-boilerplate (см. `apps/backend/CLAUDE.md`) уже требует создавать `FastifyAdapter` явно и дожидаться `adapter.getInstance().ready()` после `app.init()`, прежде чем слать запросы через `supertest(app.getHttpServer())` — новый `meeting-files.e2e-spec.ts` должен повторить этот же паттерн, а не паттерн `auth.e2e-spec.ts`/`meeting.e2e-spec.ts` времён Express (`createNestApplication()` без адаптера).
- Тесты на удаление встречи должны также проверять **файловую систему**, не только БД/HTTP-код — т.е. `fs.existsSync(path)` после `DELETE /meetings/:id` должен быть `false`. Это выходит за пределы обычного HTTP-assertion паттерна остальных e2e-тестов репозитория (`meeting.e2e-spec.ts` сейчас проверяет только HTTP/JSON) — стоит явно предусмотреть импорт `fs`/`node:path` в новом `meeting-files.e2e-spec.ts` для этой проверки.
- Тестовое хранилище: направить `FILE_STORAGE_DIR` в `.env`/CI на временную/тестовую директорию (не смешивать с потенциальной dev-директорией `./uploads`), чтобы e2e-прогон не оставлял мусорные файлы в рабочей копии и не конфликтовал при параллельных прогонах.

---

## 7. Рекомендуемый набор решений (сводка)

| Узел                               | Решение                                                                                                                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Приём multipart                    | `@fastify/multipart` (новая зависимость), зарегистрирован в `main.ts` с `limits.fileSize`; `FileInterceptor`/`multer` не используются — несовместимы с `FastifyAdapter`                       |
| Валидация типа/размера на backend  | MIME — вручную по `data.mimetype` до записи на диск; размер — `limits.fileSize` плагина + проверка `data.file.truncated` после `pipeline()`, с удалением частично записанного файла           |
| Хранение на диске                  | `pipeline(data.file, fs.createWriteStream(...))` из `node:stream/promises`, путь из `.env` (`FILE_STORAGE_DIR`), имя файла — `randomUUID()` + санитизированное расширение, не `data.filename` |
| Метаданные                         | Prisma-модель `MeetingFile`, `onDelete: Cascade` на `meetingId`; политику каскада на `uploadedById` — решить явно на этапе реализации                                                         |
| Доступ owner-или-участник          | Общая handler-side проверка (сервис/утилита), переиспользуемая всеми meeting- и file-хендлерами, а не Nest `Guard`                                                                            |
| Скачивание                         | `StreamableFile` + явные `Content-Type`/`Content-Disposition` (RFC 5987 для не-ASCII имён), не статическая раздача                                                                            |
| Удаление встречи                   | Прочитать пути файлов → удалить с диска → удалить встречу (каскад БД подчистит строки `MeetingFile`) — в этом порядке, иначе пути недоступны после каскада                                    |
| Frontend-загрузка                  | `fetch` + `FormData`, `Authorization` без ручного `Content-Type`; состояние `idle/uploading/success/error` без процента (XHR — только если понадобится процент)                               |
| Frontend-скачивание                | `fetch` → `blob()` → `URL.createObjectURL` → программный клик по `<a download>`                                                                                                               |
| Next.js rewrite для больших файлов | Поднять `experimental.proxyClientMaxBodySize` выше backend max-size; обновить `next` до `>=16.2.11` (патчит несколько high-severity CVE, актуально раз фича добавляет новый прокси-путь)      |
| e2e                                | `supertest.attach()` с буфером в памяти; отдельная проверка `fs.existsSync` для критерия «файлы удаляются с диска»                                                                            |

## Открытые вопросы для этапа имплементации

- Единый лимит размера для документов и для аудио/видео, или два разных — PRD не разделяет явно.
- Политика `onDelete` для `MeetingFile.uploadedById` при будущем удалении пользователей (сейчас удаления пользователей в системе нет, но `Cascade` унесёт общий для встречи файл — решить сознательно, не по умолчанию).
- Нужен ли upload-прогресс в процентах или достаточно трёх состояний (в PRD сформулировано как «в процессе/успешно/ошибка», без упоминания процента).
- Где именно читать multipart-часть запроса (`request.file()`) — в контроллере через отдельный helper-provider (payload команды остаётся плоским) или прямо в хендлере команды (контроллер передаёт `FastifyRequest` целиком) — см. раздел 1; выбрать один вариант до реализации Фазы 1, чтобы не разъезжаться между будущими файловыми эндпоинтами.
