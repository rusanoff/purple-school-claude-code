# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository structure

This is a pnpm workspace monorepo with two independent apps:

- `apps/frontend` — Next.js (App Router, TypeScript). See `apps/frontend/CLAUDE.md`.
- `apps/backend` — NestJS (TypeScript), with a Prisma/Postgres auth feature. See `apps/backend/CLAUDE.md`.

The backend has an email/password → JWT auth module; the frontend consumes it from a registration page. They are wired together at the tooling level described below.

## Frontend ↔ backend wiring

The frontend never calls the backend cross-origin. `apps/frontend/next.config.ts` rewrites `/api/:path*` to `${BACKEND_URL}/:path*` (default `http://localhost:3001`), so the browser only talks to the frontend's own origin and **the backend needs no CORS setup**. If that ever changes, both sides must change together — see `apps/frontend/CLAUDE.md`.

## Database

Start local Postgres with `docker compose up -d` (repo root). The backend connects via its own `DATABASE_URL` (`apps/backend/.env`) and manages schema with Prisma — the backend's e2e tests hit this real database, so it must be up before `pnpm --filter backend test:e2e`. It also holds a few persistent `qa-*@example.test` users and fixture meetings, seeded once for manual/Playwright UI testing — see the "Playwright test fixtures" section of `apps/frontend/CLAUDE.md` for credentials and how to re-seed them if the `postgres_data` volume is ever wiped.

## Shared tooling architecture

The two apps intentionally do **not** have fully independent lint/format setups — they share a common base so rules stay consistent:

- `.prettierrc.json` (root) is the single Prettier config for both apps — neither app has its own `.prettierrc`.
- `eslint.base.mjs` (root) — a shared flat-config array (`eslint:recommended` + `eslint-plugin-prettier/recommended`) imported by both apps' `eslint.config.mjs` via a relative path (`../../eslint.base.mjs`). Each app then layers its own framework-specific rules on top (Next's config in frontend, `typescript-eslint` type-checked rules + Nest globals in backend).
- Shared devDependencies used only by that root config file (`eslint`, `@eslint/js`, `eslint-config-prettier`, `eslint-plugin-prettier`, `prettier`) live in the **root** `package.json`, not duplicated in each app. Anything an app's own `eslint.config.mjs` imports directly (e.g. backend's `typescript-eslint`, `globals`) must stay a direct dependency of that app, per pnpm's strict (non-hoisted) `node_modules` — don't move those to root.

When touching lint/format rules, prefer editing `eslint.base.mjs` or `.prettierrc.json` at the root if the change should apply to both apps; only touch an app's own `eslint.config.mjs` for framework-specific rules.

## Git hooks

Husky manages git hooks; the root `prepare` script (`husky`) installs them on `pnpm install`. `.husky/pre-commit`, before every commit: brings up the root `docker-compose.yml` Postgres service (`docker compose up -d postgres`, a no-op if it's already running), polls `pg_isready` for up to 30s so a cold start has time to become healthy, then runs `pnpm lint && pnpm test && pnpm test:e2e`. Root `lint` covers both apps; root `test` runs only `pnpm --filter backend test` (unit tests, `passWithNoTests: true` — the frontend has no test suite yet); root `test:e2e` runs `pnpm --filter backend test:e2e` against that real Postgres instance. Because e2e now runs on every commit, **committing requires Docker to be available** — if Postgres never becomes ready within the poll window, the e2e step fails with a connection error rather than the hook hanging indefinitely. If the frontend gains tests, add them to root `test`.

## Port conventions

Frontend defaults to `:3000` (Next.js default). Backend's default port was changed from Nest's default `3000` to **`3001`** in `apps/backend/src/main.ts` specifically so both apps can run at once via `pnpm dev` without a collision. Keep this in mind if either app's port is changed in the future — they must not collide again.

## Keeping this documentation in sync

Whenever a change alters the architecture described here — a new app/package added to the workspace, shared tooling moved or restructured, port conventions changed — update this file (and the affected app's `CLAUDE.md`) in the same change. Do not let these docs drift from what the code actually does.
