# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See also the root `CLAUDE.md` for monorepo-wide conventions (shared lint/format config, port allocation). If you change this app's architecture, update the "Architecture" section below in the same change.

## Architecture

- `next.config.ts` sets `turbopack.root` explicitly to the monorepo root — this is required because Next's workspace-root auto-detection gets confused by lockfiles/config outside this repo; don't remove it.
- Styling is **Tailwind CSS v4** (via `@tailwindcss/postcss`, configured in `postcss.config.mjs` — there is no `tailwind.config.*`; Tailwind v4 is CSS-configured) plus **HeroUI v3** (`@heroui/react` + `@heroui/styles`). Both are imported in `app/globals.css` in that order (`tailwindcss` first, then `@heroui/styles`) — the order is required. `app/globals.css` is imported once, in `app/layout.tsx`.
- HeroUI v3 needs **no provider** and no `framer-motion`. Its components use the compound pattern (`Card.Header`, etc.), semantic variants (`primary`/`secondary`/`danger`/…), and `onPress` rather than `onClick`. Do not apply HeroUI v2 patterns — they are incompatible. Client components using HeroUI need `'use client'`.
- **Branding:** `components/brand.tsx` exports `APP_NAME` (`'Video Meetings'`, also the source of `metadata.title` in `app/layout.tsx`) and `<Brand />`, the logo + wordmark lockup. There is deliberately **no global header** — the layout renders only `{children}`, and pages that want the branding place `<Brand />` themselves (the register page centers it above the card). Full-bleed decorative backgrounds are `fixed inset-0 -z-10` so they cover the viewport regardless of the page's own height.
- **Backend calls go through a same-origin proxy.** `next.config.ts` rewrites `/api/:path*` → `${BACKEND_URL}/:path*` (`BACKEND_URL` defaults to `http://localhost:3001`, see `.env.example`). The browser therefore only ever talks to this origin, which is why the backend needs **no CORS configuration** — don't add `app.enableCors()` there or switch the client to absolute backend URLs without removing this rewrite. Note the rewrite strips `/api`, so the frontend path `/api/auth/register` hits the backend route `POST /auth/register`.
- `lib/auth.ts` is the client for the backend's auth API: `register()` plus `ApiError`, which normalizes Nest's error body (`message` is a plain string for thrown HTTP exceptions like the 409 on a duplicate email, and a string array for `ValidationPipe` failures). The JWT is kept in `localStorage` under `accessToken` via `saveAccessToken`/`getAccessToken`.
- `app/register/page.tsx` is the registration screen — a HeroUI `Form` whose client-side rules mirror the backend's `AuthCredentialsDto` (valid email, password ≥ 6 chars). Keep the two in sync if that DTO changes. Server failures render as a `danger` `Alert` above the fields; success swaps the card for a confirmation panel.
- Lint config (`eslint.config.mjs`) extends the shared root base (`../../eslint.base.mjs`) plus `eslint-config-next` (`core-web-vitals` + `typescript` rule sets). Prettier formatting is enforced through ESLint (`prettier/prettier` rule from the shared base), not just as a separate step.

## Definition of done for UI changes

Any change that affects the UI (pages, components, styling, layout, copy shown to users, interaction behaviour) is **not complete** until both of the following are done. Editing the code and having it compile is never enough.

1. **Verify it visually in a real browser.** The dev server is already running — do **not** start it (no `pnpm dev`, no `pnpm --filter frontend dev`) and do not restart it; just point the browser at the running app (frontend on `:3000`, backend on `:3001`). Only if the app is genuinely unreachable, say so instead of spawning your own server. Open the affected route with the Playwright MCP browser tools, and look at the rendered result — take a screenshot, exercise the interaction you changed (submit the form, open the modal, trigger the error state), and check the browser console for errors. Check the states that matter for the change, not just the happy path: loading, error, empty, and success where they exist, plus at least one narrow (mobile) and one wide (desktop) viewport for anything layout-related. Screenshots of what you actually saw are the evidence — do not claim a UI change works without having rendered it.
2. **Review it with the `ui-ux-pro-max` skill.** Invoke the skill and apply its guidance to the change (visual hierarchy, spacing, typography, colour/contrast, accessibility, responsive behaviour, interaction states). Fix what it surfaces, then re-verify visually per step 1. If you consciously deviate from a recommendation, say why in your summary.

Report the task as done only after both steps have actually run, and state in the summary what you rendered and what the skill review changed.
