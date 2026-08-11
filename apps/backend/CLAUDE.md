# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See also the root `CLAUDE.md` for monorepo-wide conventions (shared lint/format config, cross-app commands, port allocation). If you change this app's architecture, update the "Architecture" section below in the same change.

## Commands (run from `apps/backend`, or via `pnpm --filter backend <script>` from repo root)

```bash
pnpm start           # nest start
pnpm start:dev       # nest start --watch — starts on :3001
pnpm start:debug      # nest start --debug --watch
pnpm start:prod       # node dist/main (run after `pnpm build`)
pnpm build            # nest build
pnpm lint             # eslint "{src,apps,libs,test}/**/*.ts" --fix
pnpm format           # prettier --write "src/**/*.ts" "test/**/*.ts"
pnpm test             # jest — unit tests (*.spec.ts, colocated under src/)
pnpm test:watch       # jest --watch
pnpm test:cov         # jest --coverage
pnpm test:e2e         # jest --config ./test/jest-e2e.json — e2e tests under test/
```

To run a single test file: `pnpm test -- app.controller.spec.ts` (or pass a path/pattern jest understands). For a single e2e test: `pnpm test:e2e -- app.e2e-spec.ts`.

## Architecture

NestJS project with a Prisma/Postgres-backed auth feature (email + password → JWT).

- Entry point `src/main.ts` bootstraps `AppModule` via `NestFactory.create` and listens on `process.env.PORT ?? 3001`. The default was changed from Nest's usual `3000` to `3001` specifically to avoid colliding with the frontend's dev server — see root `CLAUDE.md`.
- `src/app.module.ts` wires the feature modules (`PrismaModule`, `AuthModule`, `MeetingModule`) plus `ConfigModule.forRoot({ isGlobal: true })` for env access, and registers a global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) via an `APP_PIPE` provider — done this way (not `app.useGlobalPipes` in `main.ts`) so DTO validation also applies in e2e tests, which build the app from `AppModule` directly. New features follow the same pattern: one `Module` per feature, registered in `AppModule`'s `imports`.
- **Persistence (Prisma):** `prisma/schema.prisma` defines the `User` model (`@@map("users")`; `id` uuid, unique `email`, `passwordHash`) and the `Meeting` model (`@@map("meetings")`; `id` uuid, `title`, `date`, `participants String[]`, `ownerId` → `User` with `onDelete: Cascade`, indexed on `ownerId`). `src/prisma/prisma.service.ts` extends `PrismaClient` and connects/disconnects on Nest lifecycle hooks; `PrismaModule` is `@Global()` so `PrismaService` is injectable everywhere without re-importing. **Pinned to Prisma 6** (v7 drops the `url = env(...)` datasource in favor of driver adapters + `prisma.config.ts`). The generator uses Prisma's **default output** (no `output` in the schema) — a custom `output` under `apps/backend/node_modules` is NOT resolvable because pnpm hoists `@prisma/client` to the root store; after schema changes run `pnpm exec prisma generate` (and `prisma migrate dev` for schema changes). Migrations live in `prisma/migrations/`.
- **Auth (`src/auth/`) — CQRS:** built with `@nestjs/cqrs`. `AuthController` is thin: it only maps HTTP → commands via `CommandBus.execute(new RegisterCommand(...))` / `LoginCommand`, exposing `POST /auth/register` (201) and `POST /auth/login` (`@HttpCode(200)`, since Nest POST defaults to 201). Both take `AuthCredentialsDto` (`@IsEmail`, password `@MinLength(6)`) and return `{ accessToken }`. All business logic lives in command handlers under `commands/` (`register.handler.ts`, `login.handler.ts`) — see the **CQRS** section below for the pattern itself. `RegisterHandler` hashes with `bcryptjs` (`SALT_ROUNDS = 10`) and 409s on duplicate email; `LoginHandler` verifies the password and 401s on unknown email or bad password (same message, no user enumeration). Both delegate JWT signing to the shared `TokenService` (`services/token.service.ts`, wraps `JwtService`). `AuthModule` registers `TokenService` alongside the handlers; `JwtModule.registerAsync` reads secret/expiry from config. Note that **login is modeled as a command, not a query** — deliberately; the rationale is in the CQRS section.
  - **JWT protection:** there is no Passport dependency. `guards/jwt-auth.guard.ts` (`JwtAuthGuard`) verifies the `Bearer <jwt>` header with the shared `JwtService` and attaches `{ userId, email }` (see `interfaces/auth-user.interface.ts`) to `request.user`; `decorators/current-user.decorator.ts` (`@CurrentUser()`) reads it. `AuthModule` **exports** `JwtModule` + `JwtAuthGuard` so other feature modules import `AuthModule` to reuse the same guard/secret. Because the guard type is used in a decorated param, import `AuthUser` with `import type` (`isolatedModules` + `emitDecoratorMetadata`).
- **Meeting (`src/meeting/`) — CQRS, JWT-protected:** `MeetingController` (`@Controller('meetings')`, `@UseGuards(JwtAuthGuard)`) maps HTTP → `CommandBus`/`QueryBus`. Routes: `POST /meetings` (201, `CreateMeetingDto`: `title` non-empty — `@Transform`-trimmed _before_ `@IsNotEmpty` so a whitespace-only title 400s rather than storing blank, `date` `@IsDateString`, `participants` non-empty `string[]`), `GET /meetings` (current user's meetings), `GET /meetings/:id` (404 when missing). Ownership is enforced by scoping every query on `ownerId` (from the JWT) — another user's meeting is **404, not 403** (no existence leak). This is the reference example of the **CQRS** section below — one command (`commands/`, create) and two queries (`queries/`, list + get-one), registered in `MeetingModule` alongside `CqrsModule` + `AuthModule`. Handlers return a mapped `MeetingResponse` (`{ id, title, date, participants }`) via `toMeetingResponse`, hiding `ownerId`/timestamps.
- **Env:** requires `DATABASE_URL` (Postgres from the root `docker-compose.yml`), `JWT_SECRET`, and optional `JWT_EXPIRES_IN` (default `1d`). See `apps/backend/.env.example`. `.env` is gitignored; Prisma CLI auto-loads it.
- Jest config lives inline in `package.json` (`rootDir: "src"`, matches `*.spec.ts`); e2e tests use a separate config at `test/jest-e2e.json`. **`test/auth.e2e-spec.ts` and `test/meeting.e2e-spec.ts` hit the real Postgres** — start it with `docker compose up -d` (from repo root) before `pnpm test:e2e`. Tests self-isolate with a random unique email per case rather than truncating tables (`meeting.e2e-spec.ts` registers a fresh user per case to get a bearer token).
- Lint config (`eslint.config.mjs`) extends the shared root base (`../../eslint.base.mjs`) plus `typescript-eslint`'s `recommendedTypeChecked` (type-aware linting via `projectService`) and Nest/Jest globals. Notable relaxed rules: `@typescript-eslint/no-explicit-any` is off; `no-floating-promises` and `no-unsafe-argument` are warnings, not errors.
- `tsconfig.json` disables full `strict` mode (`noImplicitAny: false`, `strictBindCallApply: false`, `noFallthroughCasesInSwitch: false`) while keeping `strictNullChecks: true` — this is the Nest CLI default, not a project-specific choice.

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

Current inventory:

| Feature        | Commands                          | Queries                               |
| -------------- | --------------------------------- | ------------------------------------- |
| `src/auth/`    | `RegisterCommand`, `LoginCommand` | —                                     |
| `src/meeting/` | `CreateMeetingCommand`            | `GetMeetingsQuery`, `GetMeetingQuery` |

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

Ownership is a handler concern, not a controller one. The controller reads the caller from the JWT via `@CurrentUser()` and passes `user.userId` into the message as `ownerId`; handlers then scope **every** Prisma call on it (`where: { id, ownerId }`). Because a non-owner's row simply doesn't match, another user's meeting surfaces as **404, not 403** — no existence leak. `ownerId` must always come from the JWT, never from the request body (`CreateMeetingDto` has no such field, and the global `forbidNonWhitelisted` pipe rejects one if sent).

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

> Known inconsistency: `auth/commands/index.ts` also re-exports the command classes themselves (`export * from './login.command'`), while `meeting/commands/index.ts` exports only the handler array. Nothing depends on the re-export — both controllers import commands from their concrete file paths. Prefer the meeting style (handler array only) for new features, and don't rely on the barrel to resolve a command class.

### Adding a new command or query

1. Create `<verb>-<noun>.command.ts` (or `.query.ts`) extending `Command<T>` / `Query<T>`, with `public readonly` payload fields and `super()`.
2. Create the sibling `<verb>-<noun>.handler.ts`, decorated and implementing the matching interface.
3. Append the handler to the `CommandHandlers` / `QueryHandlers` array in that folder's `index.ts` — **forgetting this step is the usual failure**, and it shows up at runtime as `No handler found for the command/query`, not as a compile error.
4. Add the route to the controller as a single `execute` call, with its DTO and (if protected) `@UseGuards(JwtAuthGuard)`.
5. Cover it in `test/<feature>.e2e-spec.ts`.

### What this app deliberately does _not_ use

`@nestjs/cqrs` also ships events, sagas, and event sourcing — **none are used here**. There is no `EventBus`, no event store, and no separate read model: commands and queries hit the _same_ Postgres database through the same `PrismaService`. The value being bought is the read/write split and thin controllers, not eventual consistency. Don't assume event-sourced semantics when reading this code.

Handlers currently have **no unit tests** — the pattern is exercised end-to-end through `test/auth.e2e-spec.ts` and `test/meeting.e2e-spec.ts` against real Postgres. Handlers are plain classes with constructor DI, so they are straightforward to unit test with a mocked `PrismaService` if that becomes worthwhile.
