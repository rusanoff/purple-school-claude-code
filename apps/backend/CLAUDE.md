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

Minimal NestJS project, currently just the scaffolded template — a single root module with no real domain logic yet.

- Entry point `src/main.ts` bootstraps `AppModule` via `NestFactory.create` and listens on `process.env.PORT ?? 3001`. The default was changed from Nest's usual `3000` to `3001` specifically to avoid colliding with the frontend's dev server — see root `CLAUDE.md`.
- `src/app.module.ts` is the sole module, wiring `AppController` → `AppService` (standard Nest controller/service/module pattern). New features should follow this pattern: one `Module` per feature, registered in `AppModule`'s `imports`.
- Jest config lives inline in `package.json` (`rootDir: "src"`, matches `*.spec.ts`); e2e tests use a separate config at `test/jest-e2e.json`.
- Lint config (`eslint.config.mjs`) extends the shared root base (`../../eslint.base.mjs`) plus `typescript-eslint`'s `recommendedTypeChecked` (type-aware linting via `projectService`) and Nest/Jest globals. Notable relaxed rules: `@typescript-eslint/no-explicit-any` is off; `no-floating-promises` and `no-unsafe-argument` are warnings, not errors.
- `tsconfig.json` disables full `strict` mode (`noImplicitAny: false`, `strictBindCallApply: false`, `noFallthroughCasesInSwitch: false`) while keeping `strictNullChecks: true` — this is the Nest CLI default, not a project-specific choice.
