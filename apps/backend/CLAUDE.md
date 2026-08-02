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
- `src/app.module.ts` wires the feature modules (`PrismaModule`, `AuthModule`) plus `ConfigModule.forRoot({ isGlobal: true })` for env access, and registers a global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) via an `APP_PIPE` provider — done this way (not `app.useGlobalPipes` in `main.ts`) so DTO validation also applies in e2e tests, which build the app from `AppModule` directly. New features follow the same pattern: one `Module` per feature, registered in `AppModule`'s `imports`.
- **Persistence (Prisma):** `prisma/schema.prisma` defines the `User` model (`@@map("users")`; `id` uuid, unique `email`, `passwordHash`). `src/prisma/prisma.service.ts` extends `PrismaClient` and connects/disconnects on Nest lifecycle hooks; `PrismaModule` is `@Global()` so `PrismaService` is injectable everywhere without re-importing. **Pinned to Prisma 6** (v7 drops the `url = env(...)` datasource in favor of driver adapters + `prisma.config.ts`). The generator uses Prisma's **default output** (no `output` in the schema) — a custom `output` under `apps/backend/node_modules` is NOT resolvable because pnpm hoists `@prisma/client` to the root store; after schema changes run `pnpm exec prisma generate` (and `prisma migrate dev` for schema changes). Migrations live in `prisma/migrations/`.
- **Auth (`src/auth/`) — CQRS:** built with `@nestjs/cqrs`. `AuthController` is thin: it only maps HTTP → commands via `CommandBus.execute(new RegisterCommand(...))` / `LoginCommand`, exposing `POST /auth/register` (201) and `POST /auth/login` (`@HttpCode(200)`, since Nest POST defaults to 201). Both take `AuthCredentialsDto` (`@IsEmail`, password `@MinLength(6)`) and return `{ accessToken }`. All business logic lives in command handlers under `commands/` (`register.handler.ts`, `login.handler.ts`); commands extend `Command<AuthResponse>` so `execute` infers the result type. `RegisterHandler` hashes with `bcryptjs` (`SALT_ROUNDS = 10`) and 409s on duplicate email; `LoginHandler` verifies the password and 401s on unknown email or bad password (same message, no user enumeration). Both delegate JWT signing to the shared `TokenService` (`services/token.service.ts`, wraps `JwtService`). `AuthModule` imports `CqrsModule` and registers `TokenService` plus `...CommandHandlers` (barrel in `commands/index.ts`); `JwtModule.registerAsync` reads secret/expiry from config. **Login is modeled as a command, not a query**, deliberately — it's a security action, leaving room for login events/audit later. To add a feature, add a `*.command.ts` + `*.handler.ts` and append the handler to `CommandHandlers`; don't put logic back in the controller.
- **Env:** requires `DATABASE_URL` (Postgres from the root `docker-compose.yml`), `JWT_SECRET`, and optional `JWT_EXPIRES_IN` (default `1d`). See `apps/backend/.env.example`. `.env` is gitignored; Prisma CLI auto-loads it.
- Jest config lives inline in `package.json` (`rootDir: "src"`, matches `*.spec.ts`); e2e tests use a separate config at `test/jest-e2e.json`. **`test/auth.e2e-spec.ts` hits the real Postgres** — start it with `docker compose up -d` (from repo root) before `pnpm test:e2e`. Tests self-isolate with a random unique email per case rather than truncating tables.
- Lint config (`eslint.config.mjs`) extends the shared root base (`../../eslint.base.mjs`) plus `typescript-eslint`'s `recommendedTypeChecked` (type-aware linting via `projectService`) and Nest/Jest globals. Notable relaxed rules: `@typescript-eslint/no-explicit-any` is off; `no-floating-promises` and `no-unsafe-argument` are warnings, not errors.
- `tsconfig.json` disables full `strict` mode (`noImplicitAny: false`, `strictBindCallApply: false`, `noFallthroughCasesInSwitch: false`) while keeping `strictNullChecks: true` — this is the Nest CLI default, not a project-specific choice.
