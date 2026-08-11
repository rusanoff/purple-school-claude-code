# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository structure

This is a pnpm workspace monorepo with two independent apps:

- `apps/frontend` — Next.js (App Router, TypeScript). See `apps/frontend/CLAUDE.md`.
- `apps/backend` — NestJS (TypeScript), with a Prisma/Postgres auth feature. See `apps/backend/CLAUDE.md`.

The frontend is a minimal scaffold; the backend has an email/password → JWT auth module. They are wired together at the tooling level described below.

## Database

Start local Postgres with `docker compose up -d` (repo root). The backend connects via its own `DATABASE_URL` (`apps/backend/.env`) and manages schema with Prisma — the backend's e2e tests hit this real database, so it must be up before `pnpm --filter backend test:e2e`.

## Shared tooling architecture

The two apps intentionally do **not** have fully independent lint/format setups — they share a common base so rules stay consistent:

- `.prettierrc.json` (root) is the single Prettier config for both apps — neither app has its own `.prettierrc`.
- `eslint.base.mjs` (root) — a shared flat-config array (`eslint:recommended` + `eslint-plugin-prettier/recommended`) imported by both apps' `eslint.config.mjs` via a relative path (`../../eslint.base.mjs`). Each app then layers its own framework-specific rules on top (Next's config in frontend, `typescript-eslint` type-checked rules + Nest globals in backend).
- Shared devDependencies used only by that root config file (`eslint`, `@eslint/js`, `eslint-config-prettier`, `eslint-plugin-prettier`, `prettier`) live in the **root** `package.json`, not duplicated in each app. Anything an app's own `eslint.config.mjs` imports directly (e.g. backend's `typescript-eslint`, `globals`) must stay a direct dependency of that app, per pnpm's strict (non-hoisted) `node_modules` — don't move those to root.

When touching lint/format rules, prefer editing `eslint.base.mjs` or `.prettierrc.json` at the root if the change should apply to both apps; only touch an app's own `eslint.config.mjs` for framework-specific rules.

## Port conventions

Frontend defaults to `:3000` (Next.js default). Backend's default port was changed from Nest's default `3000` to **`3001`** in `apps/backend/src/main.ts` specifically so both apps can run at once via `pnpm dev` without a collision. Keep this in mind if either app's port is changed in the future — they must not collide again.

## Keeping this documentation in sync

Whenever a change alters the architecture described here — a new app/package added to the workspace, shared tooling moved or restructured, port conventions changed — update this file (and the affected app's `CLAUDE.md`) in the same change. Do not let these docs drift from what the code actually does.
