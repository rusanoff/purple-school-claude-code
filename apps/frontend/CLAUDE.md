# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See also the root `CLAUDE.md` for monorepo-wide conventions (shared lint/format config, cross-app commands, port allocation). If you change this app's architecture, update the "Architecture" section below in the same change.

## Commands (run from `apps/frontend`, or via `pnpm --filter frontend <script>` from repo root)

```bash
pnpm dev       # next dev — starts on :3000
pnpm build     # next build (production build)
pnpm start     # next start — serve the production build
pnpm lint      # eslint
pnpm format    # prettier --write .
```

There is no test setup in this app yet.

## Architecture

Minimal Next.js App Router project, currently just the scaffolded template — no custom routes, components, or data-fetching logic beyond `app/layout.tsx` and `app/page.tsx`.

- App Router (`app/` directory), TypeScript, no `src/` directory (routes live directly under `app/`).
- Import alias `@/*` maps to the project root (see `tsconfig.json`).
- No Tailwind, no CSS framework configured.
- `next.config.ts` sets `turbopack.root` explicitly to the monorepo root — this is required because Next's workspace-root auto-detection gets confused by lockfiles/config outside this repo; don't remove it.
- Lint config (`eslint.config.mjs`) extends the shared root base (`../../eslint.base.mjs`) plus `eslint-config-next` (`core-web-vitals` + `typescript` rule sets). Prettier formatting is enforced through ESLint (`prettier/prettier` rule from the shared base), not just as a separate step.
