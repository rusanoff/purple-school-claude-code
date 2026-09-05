# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See also the root `CLAUDE.md` for monorepo-wide conventions (shared lint/format config, port allocation). If you change this app's architecture, update the "Architecture" section below in the same change.

## Architecture

NestJS project with a Prisma/Postgres-backed auth feature (email + password → JWT). Runs on the **Fastify** HTTP platform (`@nestjs/platform-fastify`), not Express — there is no `express`/`@types/express`/`@nestjs/platform-express` dependency in this app; don't add code that assumes an Express `Request`/`Response`.

- Entry point `src/main.ts` bootstraps `AppModule` via `NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter())` and listens on `process.env.PORT ?? 3001`, `0.0.0.0` (Fastify defaults to binding `127.0.0.1` only, unlike Node's/Express's default of all interfaces — the explicit host keeps that same all-interfaces behavior). The default port was changed from Nest's usual `3000` to `3001` specifically to avoid colliding with the frontend's dev server — see root `CLAUDE.md`.
- **Fastify, not Express:** anywhere a raw request/response type is needed (currently `JwtAuthGuard` and `@CurrentUser()`), import `FastifyRequest`/`FastifyReply` from the `fastify` package, not `express`. `fastify` itself is a **direct** dependency of this app (not just a transitive dependency of `@nestjs/platform-fastify`) — pnpm's strict `node_modules` means importing a package's types/runtime requires declaring it directly, per the root `CLAUDE.md` dependency-hoisting rule. This also means Nest's built-in Express+multer file-upload helpers (`FileInterceptor`, `@UploadedFile()`, `multer`) are **not usable** here — they are explicitly Express-only; a future file-upload feature needs `@fastify/multipart` instead (see `docs/research-meeting-upload.md`).
- **e2e tests and Fastify:** each `test/*.e2e-spec.ts` constructs its own `FastifyAdapter` instance and passes it to `createNestApplication(adapter)`, then awaits `adapter.getInstance().ready()` after `app.init()` — Fastify registers routes/plugins asynchronously, and `supertest` needs the instance to be ready before requests against `app.getHttpServer()` are guaranteed to hit registered routes. Follow this pattern in any new `*.e2e-spec.ts` file.
- `src/app.module.ts` wires the feature modules (`PrismaModule`, `UsersModule`, `AuthModule`, `MeetingModule`) plus `ConfigModule.forRoot({ isGlobal: true })` for env access, and registers a global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) via an `APP_PIPE` provider — done this way (not `app.useGlobalPipes` in `main.ts`) so DTO validation also applies in e2e tests, which build the app from `AppModule` directly. New features follow the same pattern: one `Module` per feature, registered in `AppModule`'s `imports`. `AppModule` registers no controllers of its own — there is no root `/` route, `AppController`, or `AppService` (removed as unused Nest-generated boilerplate); only the pipe and the feature modules live here.
- **Persistence (Prisma):** models live in `prisma/schema.prisma`. `src/prisma/prisma.service.ts` extends `PrismaClient` and connects/disconnects on Nest lifecycle hooks; `PrismaModule` is `@Global()` so `PrismaService` is injectable everywhere without re-importing. **Pinned to Prisma 6** (v7 drops the `url = env(...)` datasource in favor of driver adapters + `prisma.config.ts`). The generator uses Prisma's **default output** (no `output` in the schema) — a custom `output` under `apps/backend/node_modules` is NOT resolvable because pnpm hoists `@prisma/client` to the root store; after schema changes run `pnpm exec prisma generate` (and `prisma migrate dev` for schema changes). Migrations live in `prisma/migrations/`.
- **Users (`src/users/`) — CQRS, no controller:** owns all `User` persistence (the only module that imports `PrismaService` for the `user` table). Has no HTTP surface at all — it exists purely to be called through `CommandBus`/`QueryBus` by other feature modules (currently just `AuthModule`). `commands/create-user.handler.ts` (`CreateUserCommand`) checks for a duplicate email (409 `ConflictException`), hashes the password with `bcryptjs` (`SALT_ROUNDS = 10`), and creates the row. `queries/find-user-by-email.handler.ts` (`FindUserByEmailQuery`) is a pure read, returning `null` when no user matches. `queries/get-user-profile.handler.ts` (`GetUserProfileQuery`) reads the caller's **own** row by the id carried in their JWT — that id is the entire authorization story, there is no query for reading anybody else's profile — and returns a `UserProfileResponse`. Deliberately it does _not_ resolve to `null` on a miss the way `FindUserByEmailQuery` does: the caller is already authenticated, so an absent row means the user was deleted after the token was issued, and the handler reports that as `NotFoundException` (404, not 401) instead of making every call site branch on `null`. Beyond the credentials columns, `User` carries two **optional** profile columns (`prisma/schema.prisma`): `name` and `avatarPath`. Both are nullable with no default and no backfill — every user that existed before the `add_user_profile_fields` migration has `null` in both, so any code reading them must handle `null` rather than assume a string. `avatarPath` holds a **generated on-disk filename** (same convention as `MeetingFile.path`), not the uploaded filename, not an absolute path and not a URL; nothing writes to either column yet. `interfaces/user-profile.interface.ts` holds the **public** side of this: `UserProfileResponse` (`id`, `email`, `name`, `avatarUrl`, `createdAt`) plus `toUserProfileResponse(user)`, which drops the password hash and the persistence-only timestamps and turns the stored `avatarPath` filename into `${AVATAR_URL_PREFIX}/<filename>` (`/api/avatars/...`, `null` when there is no avatar). That `/api` prefix is emitted here on purpose so the value is usable as-is in an `<img src>` through the frontend's rewrite — see the constant's own comment for which half of the path is served by whom. `create-user`/`find-user-by-email` instead return a `UserRecord` (`interfaces/user-record.interface.ts`) — `id`/`email`/`passwordHash` — which, unlike `AuthResponse`/`MeetingResponse`, is an internal cross-module message type, not an HTTP response shape: it deliberately includes `passwordHash` so callers (e.g. `LoginHandler`) can verify credentials, and must never be returned from a controller as-is.
- **Auth (`src/auth/`) — CQRS:** built with `@nestjs/cqrs`. `AuthController` is thin: it only maps HTTP → commands via `CommandBus.execute(new RegisterCommand(...))` / `LoginCommand`, exposing `POST /auth/register` (201) and `POST /auth/login` (`@HttpCode(200)`, since Nest POST defaults to 201). Both take `AuthCredentialsDto` (`@IsEmail`, password `@MinLength(6)`) and return `{ accessToken }`. All business logic lives in command handlers under `commands/` (`register.handler.ts`, `login.handler.ts`) — see the **CQRS** section below for the pattern itself. Neither handler touches Prisma directly: `RegisterHandler` dispatches `CreateUserCommand` (from `users/commands/`) via `CommandBus` and lets `UsersModule` own the 409-on-duplicate-email/hashing/creation; `LoginHandler` dispatches `FindUserByEmailQuery` via `QueryBus`, then does the `bcrypt.compare` itself and 401s on unknown email or bad password (same message, no user enumeration) — password _verification_ is treated as an auth concern, password _hashing/storage_ as a users concern. Both handlers delegate JWT signing to the shared `TokenService` (`services/token.service.ts`, wraps `JwtService`). `AuthModule` registers `TokenService` alongside the handlers; `JwtModule.registerAsync` reads secret/expiry from config. Note that **login is modeled as a command, not a query** — deliberately; the rationale is in the CQRS section. `AuthModule` does **not** import `UsersModule` — the two talk only through the shared `CommandBus`/`QueryBus` (see the CQRS section's note on cross-module dispatch), which is the point of routing user creation/lookup through CQRS instead of injecting a `UsersService`.
  - **JWT protection:** there is no Passport dependency. `guards/jwt-auth.guard.ts` (`JwtAuthGuard`) verifies the `Bearer <jwt>` header with the shared `JwtService` and attaches `{ userId, email }` (see `interfaces/auth-user.interface.ts`) to `request.user`; `decorators/current-user.decorator.ts` (`@CurrentUser()`) reads it. `AuthModule` **exports** `JwtModule` + `JwtAuthGuard` so other feature modules import `AuthModule` to reuse the same guard/secret. Because the guard type is used in a decorated param, import `AuthUser` with `import type` (`isolatedModules` + `emitDecoratorMetadata`).
- **Meeting (`src/meeting/`) — CQRS, JWT-protected:** `MeetingController` (`@Controller('meetings')`, `@UseGuards(JwtAuthGuard)`) maps HTTP → `CommandBus`/`QueryBus`. Routes: `POST /meetings` (201, `CreateMeetingDto`: `title` non-empty — `@Transform`-trimmed _before_ `@IsNotEmpty` so a whitespace-only title 400s rather than storing blank, `date` `@IsDateString`, `participants` non-empty `string[]`), `GET /meetings` (current user's meetings, still scoped to `ownerId` only), `GET /meetings/:id`, `DELETE /meetings/:id` (`@HttpCode(204)`, owner-only — see below). This is the reference example of the **CQRS** section below — commands (`commands/`, create + delete) and queries (`queries/`, list + get-one), registered in `MeetingModule` alongside `CqrsModule` + `AuthModule` + `MeetingFilesModule` (see the delete bullet below for why). Handlers return a mapped `MeetingResponse` (`{ id, title, date, participants, isOwner }`) via `toMeetingResponse(meeting, callerId)`, hiding the raw `ownerId`/timestamps but folding `ownerId` into a caller-scoped `isOwner: meeting.ownerId === callerId` boolean — every call site passes its own already-known caller id (`ownerId` in `CreateMeetingHandler`/`GetMeetingsHandler`, since both are inherently owner-scoped; `userId` in `GetMeetingHandler`, the one case where the caller can be a participant instead). Needed because `assertMeetingAccess` (below) grants the owner and a participant the same read access, so without this a client has no way to tell the two apart — the frontend uses it to decide who can delete which meeting file, see its own `CLAUDE.md`.
  - **Owner-or-participant access (`src/meeting/access/meeting-access.ts`):** `assertMeetingAccess(meeting, { userId, email })` throws `ForbiddenException` unless the caller is `meeting.ownerId` or their JWT email case-insensitively matches an entry in `meeting.participants` (a plain `String[]`, not a `User` relation). `GetMeetingHandler` looks a meeting up by `id` alone, 404s if it doesn't exist, then calls this — so a non-existent meeting is 404 and an existing-but-inaccessible one is **403**, no longer both collapsing to 404 the way owner-only scoping used to (this makes `GetMeetingHandler` an exception to the general "Authorization inside the pattern" section below, which still describes the owner-only-scoping/always-404 shape used everywhere else). `GetMeetingsQuery` (the list) is unchanged — still owner-only, always-404. This function is plain handler-side logic, not a Nest `Guard` (guards here are authentication-only) — reused directly both by `GetMeetingHandler` and by `AssertMeetingAccessHandler` (`src/meeting/queries/assert-meeting-access.*`, a narrower query that only runs the check, used by `MeetingFilesController`), so meeting and file access can't drift apart.
  - **`DeleteMeetingCommand`/`DeleteMeetingHandler`** — **owner-only**, deliberately stricter than `assertMeetingAccess`: a participant can read a meeting but must not be able to delete it, so this check (`meeting.ownerId !== userId` → 403) is applied directly in the handler rather than reused from there. It snapshots every `MeetingFile.path` for the meeting, then deletes the `Meeting` row (its own delete wrapped in a P2025 → `NotFoundException` translation, see `src/prisma/prisma-error.util.ts`, for two concurrent deletes of the same meeting), and only _then_ removes each snapshotted path from disk via an injected `MeetingFileStorageService`, with `Promise.allSettled` (not `Promise.all`) so one locked/permission-denied file doesn't block the others or leave the already-deleted meeting looking like the operation failed — failures are logged, not thrown. DB-row-first (not disk-first) mirrors `DeleteMeetingFileHandler`'s ordering rationale: the paths are already captured in memory by this point, so disk cleanup doesn't need the row to still exist, and a disk failure can no longer leave the _meeting_ stuck undeleted. This does leave one narrow accepted race: a file uploaded in the instant between the snapshot and the meeting delete is cascade-removed from the DB (`onDelete: Cascade` on `MeetingFile.meetingId`) but never reaches disk cleanup — a known limitation, not solved here, the same way the `uploadedById` cascade tradeoff in `prisma/schema.prisma` is accepted rather than solved. `MeetingModule` imports `MeetingFilesModule` directly (see that module's `exports` below) instead of going through the CQRS bus the way `MeetingFilesController` calls back into `meeting/`'s queries — reusing a storage service's actual disk-IO methods isn't a message/result exchange, it's the same kind of direct-injection reuse `AuthModule` offers other modules for `JwtAuthGuard`.
- **Meeting files (`src/meeting-files/`) — CQRS, JWT-protected, file upload/list/download/delete:** full file lifecycle for a meeting, all four routes on `@Controller('meetings/:meetingId/files')`.
  - `POST /meetings/:meetingId/files` accepts a `multipart/form-data` body with one `file` field. Persists `MeetingFile` rows (`prisma/schema.prisma`: many-to-one to `Meeting` with `onDelete: Cascade`, many-to-one to `User` via `uploadedById` also `Cascade`, plus `filename`/`mimeType`/`size` (`BigInt` — an `Int` column would overflow past ~2.1GB, plausible for a recording)/`path`/`createdAt`) and streams the file to disk under `FILE_STORAGE_DIR`.
  - `GET /meetings/:meetingId/files` — `ListMeetingFilesQuery`, newest first, mapped to `MeetingFileResponse[]` (never exposes `path`).
  - `GET /meetings/:meetingId/files/:fileId` — streams the file back. `GetMeetingFileQuery` and `DeleteMeetingFileCommand`'s handler share `findMeetingFileOrThrow` (`queries/find-meeting-file-or-throw.ts`) for "the file with this id, scoped to this meeting" — 404s if the file doesn't exist _or_ belongs to a different meeting (never leaked as "exists elsewhere"); factored out specifically so that scoping rule can't drift between the two call sites. `GetMeetingFileHandler` maps the result to the internal `MeetingFileRecord` (`interfaces/meeting-file.interface.ts` — extends `MeetingFileResponse` with `path`; like `UserRecord` in `users/`, a cross-handler message type, never serialized straight to a client). Before streaming, the controller calls `MeetingFileStorageService.fileExists()` and 404s if it's gone — a concurrent delete of the file (or of the whole meeting) between the DB read and opening the stream would otherwise surface as a raw, unhandled error, since a `@Res()` route bypasses Nest's exception zone for anything thrown once the response starts. It then sets `Content-Disposition` by hand — CR/LF stripped, and the quoted `filename` parameter itself limited to a printable-ASCII fallback (`_` for anything else), since HTTP header values are Latin-1-only at the Node/Fastify level and a Cyrillic/CJK/emoji upload name placed there verbatim throws `ERR_INVALID_CHAR` — the real name survives losslessly in an RFC 5987 `filename*` parameter alongside it. Finally pipes `MeetingFileStorageService.createReadStream()` through `@Res()`, since Nest can't infer stream-plus-headers from a plain return value.
  - `DELETE /meetings/:meetingId/files/:fileId` — `DeleteMeetingFileCommand` carries out its **own** authorization check (unlike every other route here): the meeting owner may delete any file, but a participant may only delete a file they uploaded themselves (`file.uploadedById === requesterId`) — a narrower rule than owner-or-participant meeting access, so it can't be expressed via `assertMeetingAccess`/`AssertMeetingAccessQuery` and lives in the handler instead, after fetching the file with its meeting's `ownerId` in one query (`include: { meeting: { select: { ownerId: true } } }`). Deletes the DB row **before** the disk file — the reverse order would risk a DB row pointing at an already-gone file if the disk step failed, whereas this order's worst case is a harmless orphaned file.
  - **`MeetingFilesController` is not a one-liner-per-route controller** like `MeetingController` — a multipart body can't be handed straight to a bus as an immutable command payload, and streaming a download needs `@Res()`. Every route except upload still starts by dispatching `AssertMeetingAccessQuery` (from `src/meeting/queries/`) to reuse the exact same owner-or-participant check `GET /meetings/:id` uses, before doing anything else. Upload's shape: (1) `AssertMeetingAccessQuery` before touching the request body; (2) `MeetingFileStorageService.saveUploadedFile()` to validate and write the file; (3) `UploadMeetingFileCommand`, whose handler does nothing but `prisma.meetingFile.create(...)` — the CQRS command's job is narrowly metadata persistence, not the file handling itself. If step 3 throws, the controller calls `storage.deleteFile()` to remove the file step 2 already wrote before rethrowing — otherwise a DB failure after a successful write would orphan the file. `MeetingFilesModule` imports `CqrsModule` + `AuthModule` only (no import of `MeetingModule`) — cross-module dispatch through the shared bus for the access check, same pattern as Auth ↔ Users (see the CQRS section). It **exports** `MeetingFileStorageService` though (not through the bus) specifically so `MeetingModule`'s `DeleteMeetingHandler` can inject it directly — see that bullet above; this is one-directional, `MeetingFilesModule` itself never imports `MeetingModule`, so there's no cycle.
  - **`MeetingFileStorageService`** (`src/meeting-files/storage/`) validates `data.mimetype` (lower-cased before comparison — MIME tokens are case-insensitive) against an allowlist (`src/meeting-files/constants/file-upload.constants.ts` — audio/video prefixes + a fixed set of document MIME types; meant to be mirrored by a future frontend `<input accept>`) before writing anything, then streams `data.file` through `node:stream/promises pipeline` into a `randomUUID()`-named file (never the client-supplied filename — path-traversal/collision hazard) under `FILE_STORAGE_DIR`. Size enforcement passes `FILE_MAX_SIZE_BYTES` as a **per-call** `limits.fileSize` to `request.file(...)` (not the fixed value `@fastify/multipart` was registered with in `src/multipart.ts`, which is just a fallback for any future route that doesn't set its own) — this is both what lets `test/meeting-files.e2e-spec.ts` override the effective limit per test run via `process.env.FILE_MAX_SIZE_BYTES` without re-registering the plugin, and what avoids two independent size limits silently disagreeing. Busboy doesn't error the stream when that limit is hit, it just stops early and sets `data.file.truncated` — checked after `pipeline()` resolves, `rm`'ing the partial file and throwing `BadRequestException` if set. `createReadStream(diskFilename)`/`fileExists(diskFilename)` (used by the download route) and `deleteFile(diskFilename)` (used by delete-file and delete-meeting) round out the service's disk-IO surface.
  - **No global Prisma exception filter** (`app.module.ts` registers only `APP_PIPE`) — a handful of Prisma failure modes that this feature's concurrent-delete/insert-vs-delete races can actually hit are translated by hand via `isPrismaError(error, code)` (`src/prisma/prisma-error.util.ts`): `P2025` ("record to delete not found", when two requests race to delete the same file or the same meeting) and `P2003` (a foreign-key violation, when a meeting is deleted in the window between `MeetingFilesController.upload()`'s access check and its `UploadMeetingFileCommand` insert) both become a `NotFoundException` instead of a raw 500.
  - **Env:** `FILE_STORAGE_DIR` (default `./uploads`, resolved relative to cwd) and `FILE_MAX_SIZE_BYTES` (optional; unset/empty falls back to 50MB, but any other value must parse as a non-negative integer or the app fails to start — see `.env.example`). `apps/backend/.gitignore` excludes the storage dir from git.
- **Env:** requires `DATABASE_URL` (Postgres from the root `docker-compose.yml`), `JWT_SECRET`, and optional `JWT_EXPIRES_IN` (default `1d`). See `apps/backend/.env.example`. `.env` is gitignored; Prisma CLI auto-loads it.
- **Testing:** see the **Testing** section below for how to run unit vs. e2e tests, prerequisites, and what each currently covers.
- Lint config (`eslint.config.mjs`) extends the shared root base (`../../eslint.base.mjs`) plus `typescript-eslint`'s `recommendedTypeChecked` (type-aware linting via `projectService`) and Nest/Jest globals.

## Testing

Two independent Jest configs, run per app — there is no repo-root "test everything" script, so always go through `pnpm --filter backend <script>` (or `cd apps/backend && pnpm <script>`):

- **`pnpm --filter backend test`** — unit tests. Config is inline in `package.json` (`rootDir: "src"`, matches `*.spec.ts` sitting next to the code it tests). The suite is small and deliberately narrow: 17 tests across `src/meeting-files/constants/file-upload.constants.spec.ts`, `src/meeting-files/storage/meeting-file-storage.service.spec.ts`, `src/users/interfaces/user-profile.interface.spec.ts` and `src/users/queries/get-user-profile.handler.spec.ts` — pure functions, one service, and one handler; no HTTP and no database. `passWithNoTests: true` stays set in the jest config so the command keeps exiting `0` if the pattern ever matches nothing. `get-user-profile.handler.spec.ts` is the pattern for the rest: handlers are plain classes with constructor DI (see the CQRS section's **Handler contract**), so they unit-test by `new`-ing the handler with a hand-rolled `{ user: { findUnique } }` stub cast to `PrismaService` — no Nest testing module needed. Every other handler is still covered by e2e only; add a `*.spec.ts` beside one when that stops being enough.
- **`pnpm --filter backend test:e2e`** — end-to-end tests, a separate config at `test/jest-e2e.json`, spec files under `test/*.e2e-spec.ts` (currently `auth.e2e-spec.ts`, `meeting.e2e-spec.ts`, `meeting-files.e2e-spec.ts`, and `users.e2e-spec.ts`, 78 tests total). **These hit the real Postgres** from the root `docker-compose.yml` — run `docker compose up -d` (repo root) first, or they fail with connection errors rather than assertion failures. This is also the only place the CQRS handlers get exercised at all (no unit tests yet), including cross-module dispatch — see **Cross-module dispatch (Auth ↔ Users)** below. Each test self-isolates with a fresh random email (`randomUUID()`) instead of truncating tables between runs, so the suite is safe to run repeatedly against a Postgres instance that already has data in it; `meeting.e2e-spec.ts` registers a throwaway user per test case to obtain a bearer token. `meeting-files.e2e-spec.ts` additionally: constructs its `FastifyAdapter` app with `registerMultipart()` called before `app.init()` (see the Meeting files bullet above), points `FILE_STORAGE_DIR` at a fresh `mkdtemp()` directory removed in `afterAll`, and overrides `FILE_MAX_SIZE_BYTES` to a small value for its size-limit test — both env vars are set before `Test.createTestingModule(...).compile()` runs so `ConfigService` picks them up.
- **`pnpm --filter backend test:watch`** / **`test:cov`** / **`test:debug`** — watch mode, coverage, and an `--inspect-brk` debug run (`--runInBand`); all three run against the _unit_-test config, there's no e2e equivalent for any of them.

When a change spans a module boundary (e.g. the Auth ↔ Users CQRS split), run both `test` and `test:e2e` before touching anything to confirm the baseline is green, then again after each self-contained step of the change — `test:e2e` is what actually verifies you haven't broken the wiring, since it's currently the only coverage handlers get.

## CQRS

Every feature module in this app is built on `@nestjs/cqrs`. This is the app-wide convention, not a per-feature choice — a new feature module is expected to follow it.

### The core rule: controllers are transport-only

A controller may do exactly three things: declare the route, bind the DTO/guard/status code, and hand a command or query to a bus. It holds **no** business logic, no Prisma access, and no conditionals. Both existing controllers are one-liner-per-route as a result:

```ts
@Post()
create(
  @CurrentUser() user: AuthUser,
  @Body() { title, date, participants }: CreateMeetingDto,
): Promise<MeetingResponse> {
  return this.commandBus.execute(
    new CreateMeetingCommand(user.userId, title, date, participants),
  );
}
```

If you find yourself adding an `if` to a controller, that branch belongs in a handler.

### Command vs. query — how to choose

- **Command** — changes state, _or_ is a security-sensitive action worth auditing. Dispatched via `CommandBus`, lives in `<feature>/commands/`.
- **Query** — a pure read with no side effects. Dispatched via `QueryBus`, lives in `<feature>/queries/`.

`LoginCommand` is the deliberate exception that proves the rule: login only _reads_ the user row, but it is modeled as a **command, not a query**, because it is a security action — this leaves room to emit login-succeeded/failed events or write audit records later without reclassifying it. Don't "fix" it into a query.

### File layout

```
src/<feature>/
  <feature>.controller.ts     # HTTP → bus only
  <feature>.module.ts         # imports CqrsModule; registers the handler barrels
  commands/
    index.ts                  # exports the `CommandHandlers` array
    <verb>-<noun>.command.ts  # the message (intent + payload)
    <verb>-<noun>.handler.ts  # the behaviour
  queries/
    index.ts                  # exports the `QueryHandlers` array
    <verb>-<noun>.query.ts
    <verb>-<noun>.handler.ts
  dto/                        # class-validator input shapes (HTTP edge)
  interfaces/                 # response shapes returned by handlers
```

Command/query and its handler are **separate files** that sit side by side. The `.command.ts`/`.query.ts` file stays dependency-free (message + result type only) so it can be constructed anywhere without dragging Prisma in.

### Typed buses — no generics at the call site

Messages extend the `Command<TResult>` / `Query<TResult>` base classes from `@nestjs/cqrs` v11, which carry the result type as a phantom. That is what makes `commandBus.execute(...)` / `queryBus.execute(...)` infer their return type with no explicit generic argument:

```ts
export class GetMeetingsQuery extends Query<MeetingResponse[]> {
  constructor(public readonly ownerId: string) {
    super();
  }
}
```

Two consequences worth knowing: the `super()` call is mandatory, and if you write a plain `class FooCommand {}` without extending the base, `execute` degrades to `any` and you silently lose type safety at every call site. Always extend the base class.

Payload fields are `public readonly` constructor parameters — messages are immutable value objects.

### Handler contract

```ts
@QueryHandler(GetMeetingQuery)
export class GetMeetingHandler implements IQueryHandler<GetMeetingQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({ ownerId, id }: GetMeetingQuery): Promise<MeetingResponse> { ... }
}
```

- Decorate with `@CommandHandler(X)` / `@QueryHandler(X)` and implement `ICommandHandler<X>` / `IQueryHandler<X>` — the decorator does the bus registration, the interface only supplies type-checking. Both are required.
- `execute` **destructures the message in the parameter list** rather than taking a named `command`/`query` object. Match this style.
- Handlers are ordinary Nest providers, so they get constructor DI (`PrismaService`, `TokenService`, …).
- Handlers **throw Nest HTTP exceptions directly** (`ConflictException`, `UnauthorizedException`, `NotFoundException`). This is intentional: the handler is the layer that knows _why_ something failed, and no extra domain-error→HTTP mapping layer exists. Don't add one without changing every handler.
- Handlers return a **mapped response interface** (`AuthResponse`, `MeetingResponse`), never a raw Prisma row — that mapping is what keeps `ownerId`/`passwordHash`/timestamps out of API output (see `toMeetingResponse`).

### Authorization inside the pattern

Ownership is a handler concern, not a controller one. The controller reads the caller from the JWT via `@CurrentUser()` and passes `user.userId` into the message. `ownerId` must always come from the JWT, never from the request body (`CreateMeetingDto` has no such field, and the global `forbidNonWhitelisted` pipe rejects one if sent).

Most handlers scope **every** Prisma call on `ownerId` (`where: { id, ownerId }`) — because a non-owner's row simply doesn't match, another user's meeting surfaces as **404, not 403**, no existence leak. `GetMeetingsHandler` (the list) still works this way. `GetMeetingHandler` is the deliberate exception: it needs owner-**or**-participant access, which can't be expressed as a single Prisma `where` scope the same way (`participants` is a `String[]`, not a join) — so it fetches by `id` alone and calls `assertMeetingAccess` (`src/meeting/access/meeting-access.ts`) separately, which means an existing-but-inaccessible meeting there is **403**, not 404. See the Meeting bullet in the Architecture section above for the full rationale; don't assume every handler is 404-only just because most are.

### Registration

Each `commands/index.ts` / `queries/index.ts` barrel exports a plain array, and the feature module spreads it into `providers`:

```ts
export const QueryHandlers = [GetMeetingsHandler, GetMeetingHandler];
```

```ts
@Module({
  imports: [CqrsModule, AuthModule],
  controllers: [MeetingController],
  providers: [...CommandHandlers, ...QueryHandlers],
})
export class MeetingModule {}
```

`CqrsModule` is imported **per feature module**, not registered globally in `AppModule`. Keep it that way so a feature module stays self-contained.

> Known inconsistency: `auth/commands/index.ts` also re-exports the command classes themselves (`export * from './login.command'`), while `meeting/commands/index.ts` and `users/commands|queries/index.ts` export only the handler array. Nothing depends on the re-export — both controllers import commands from their concrete file paths. Prefer the meeting/users style (handler array only) for new features, and don't rely on the barrel to resolve a command class.

### Cross-module dispatch (Auth ↔ Users)

`UsersModule` and `AuthModule` are the one pair of feature modules that talk to _each other_ through the bus rather than each only dispatching to its own handlers. This works because `CqrsModule` (imported plain, with no `.forRoot()`) is the same static module reference everywhere — Nest dedupes it to a single instance app-wide, so every feature module that imports it shares the exact same `CommandBus`/`QueryBus`/`ExplorerService`. `ExplorerService` also doesn't scan per-importing-module; at `onApplicationBootstrap` it walks _every_ provider in the whole app's module graph for `@CommandHandler`/`@QueryHandler` metadata and registers all of them on that one shared bus. Two consequences:

- `RegisterHandler`/`LoginHandler` construct `CreateUserCommand`/`FindUserByEmailQuery` (imported from `users/commands|queries/`) and hand them to their own injected `CommandBus`/`QueryBus` — there is no direct import of `UsersModule` or its handlers from `auth/`, and no `UsersService` to inject. The message classes (not the module) are the contract between the two features.
- A module's handlers are only discoverable if the module itself is part of the app graph (reachable from `AppModule`'s `imports`) — `UsersModule` doesn't need to be imported by `AuthModule` for this to work, but it does need to be imported by `AppModule` (or by something `AppModule` imports). Forgetting to register a new bus-only module in `AppModule` fails the same way as forgetting a handler in its `index.ts` barrel: `No handler found for the command/query` at runtime, not a compile error.

Use this pattern (message-only coupling via a shared bus, no cross-module DI) for any future module pair that needs to call into another feature's write/read path — don't reach for direct service injection across feature-module boundaries instead.

### Adding a new command or query

1. Create `<verb>-<noun>.command.ts` (or `.query.ts`) extending `Command<T>` / `Query<T>`, with `public readonly` payload fields and `super()`.
2. Create the sibling `<verb>-<noun>.handler.ts`, decorated and implementing the matching interface.
3. Append the handler to the `CommandHandlers` / `QueryHandlers` array in that folder's `index.ts` — **forgetting this step is the usual failure**, and it shows up at runtime as `No handler found for the command/query`, not as a compile error.
4. Add the route to the controller as a single `execute` call, with its DTO and (if protected) `@UseGuards(JwtAuthGuard)` — skip this step for a bus-only module with no controller (e.g. `users/`), where the caller is another module's handler instead of HTTP.
5. Cover it in `test/<feature>.e2e-spec.ts` — for a bus-only module, coverage comes from whichever HTTP-facing feature's e2e spec exercises the flow that dispatches to it (e.g. `users/` is exercised via `test/auth.e2e-spec.ts`).

### What this app deliberately does _not_ use

`@nestjs/cqrs` also ships events, sagas, and event sourcing — **none are used here**. There is no `EventBus`, no event store, and no separate read model: commands and queries hit the _same_ Postgres database through the same `PrismaService`. The value being bought is the read/write split and thin controllers, not eventual consistency. Don't assume event-sourced semantics when reading this code.

Handlers currently have **no unit tests** — the pattern is exercised end-to-end through `test/auth.e2e-spec.ts` and `test/meeting.e2e-spec.ts` against real Postgres. Handlers are plain classes with constructor DI, so they are straightforward to unit test with a mocked `PrismaService` if that becomes worthwhile.
