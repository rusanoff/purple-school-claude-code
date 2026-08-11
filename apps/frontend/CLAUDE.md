# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See also the root `CLAUDE.md` for monorepo-wide conventions (shared lint/format config, port allocation). If you change this app's architecture, update the "Architecture" section below in the same change.

## Architecture

- `next.config.ts` sets `turbopack.root` explicitly to the monorepo root — this is required because Next's workspace-root auto-detection gets confused by lockfiles/config outside this repo; don't remove it.
- Lint config (`eslint.config.mjs`) extends the shared root base (`../../eslint.base.mjs`) plus `eslint-config-next` (`core-web-vitals` + `typescript` rule sets). Prettier formatting is enforced through ESLint (`prettier/prettier` rule from the shared base), not just as a separate step.
