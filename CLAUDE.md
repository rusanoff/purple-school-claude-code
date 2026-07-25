# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository structure

This is a pnpm workspace monorepo with two independent apps:

- `apps/frontend` — Next.js (App Router, TypeScript). See `apps/frontend/CLAUDE.md`.
- `apps/backend` — NestJS (TypeScript). See `apps/backend/CLAUDE.md`.

Both are minimal, freshly-scaffolded projects (no business logic yet) wired together only at the tooling level described below.

## Commands (run from repo root)

```bash
pnpm install          # install deps for both apps (single lockfile, single node_modules)
pnpm dev              # run frontend + backend concurrently (frontend :3000, backend :3001)
pnpm dev:frontend     # run only the frontend dev server
pnpm dev:backend      # run only the backend in watch mode
pnpm build            # build frontend, then backend
pnpm lint             # lint frontend, then backend
pnpm format           # prettier --write across frontend, then backend
```

To target a single app directly, use pnpm's `--filter`, e.g. `pnpm --filter backend test`, `pnpm --filter frontend build`.

## Shared tooling architecture

The two apps intentionally do **not** have fully independent lint/format setups — they share a common base so rules stay consistent:

- `pnpm-workspace.yaml` (root) — defines the workspace (`apps/*`) and `ignoredBuiltDependencies`.
- `.prettierrc.json` (root) — the single Prettier config used by both apps (`singleQuote`, `trailingComma: all`). Neither app has its own `.prettierrc`.
- `eslint.base.mjs` (root) — a shared flat-config array (`eslint:recommended` + `eslint-plugin-prettier/recommended`) imported by both apps' `eslint.config.mjs` via a relative path (`../../eslint.base.mjs`). Each app then layers its own framework-specific rules on top (Next's config in frontend, `typescript-eslint` type-checked rules + Nest globals in backend).
- Shared devDependencies used only by that root config file (`eslint`, `@eslint/js`, `eslint-config-prettier`, `eslint-plugin-prettier`, `prettier`) live in the **root** `package.json`, not duplicated in each app. Anything an app's own `eslint.config.mjs` imports directly (e.g. backend's `typescript-eslint`, `globals`) must stay a direct dependency of that app, per pnpm's strict (non-hoisted) `node_modules` — don't move those to root.

When touching lint/format rules, prefer editing `eslint.base.mjs` or `.prettierrc.json` at the root if the change should apply to both apps; only touch an app's own `eslint.config.mjs` for framework-specific rules.

## Port conventions

Frontend defaults to `:3000` (Next.js default). Backend's default port was changed from Nest's default `3000` to **`3001`** in `apps/backend/src/main.ts` specifically so both apps can run at once via `pnpm dev` without a collision. Keep this in mind if either app's port is changed in the future — they must not collide again.

## Keeping this documentation in sync

Whenever a change alters the architecture described here — a new app/package added to the workspace, shared tooling moved or restructured, port conventions changed, cross-app commands added/removed — update this file (and the affected app's `CLAUDE.md`) in the same change. Do not let these docs drift from what the code actually does.
