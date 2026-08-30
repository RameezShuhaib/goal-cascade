# 02 — PWA shell, build tooling, icons, CSP

What the PWA agent built in `apps/web`, the decisions behind it, and the one line the web agent has to add.

Ported from `react-app`'s `PROJECT-BLUEPRINT.md` §4–§5 and its implementation, adapted to this product and
stripped of what Goal Cascade does not have.

---

## Files created

| File | What it is |
|---|---|
| `apps/web/package.json` | `@goal-cascade/web`, private, ESM. `build` runs `tsc && tsc -p tsconfig.sw.json && vite build`. |
| `apps/web/vite.config.ts` | React + VitePWA (`injectManifest`), the dev proxy, and the vitest block. |
| `apps/web/tsconfig.json` | Extends `tsconfig.base.json`; DOM libs, `jsx: react-jsx`, `@goal-cascade/shared` paths, **excludes `src/sw.ts`**. |
| `apps/web/tsconfig.sw.json` | `lib: ["ES2022", "WebWorker"]`; `src/sw.ts` + `src/sw/` only. |
| `apps/web/src/pwa/manifest.ts` | The manifest as a TS module + the theme colours as named constants. No React/DOM imports — Vite loads it in Node. |
| `apps/web/src/pwa/boot.ts` | Side-effect boot: install-prompt capture, deep-link capture, SW registration. |
| `apps/web/src/pwa/deepLink.ts` | `?tab=…` / `?goal=…` parsing and the pending-link store. |
| `apps/web/src/pwa/installState.ts` | `beforeinstallprompt` capture + `useInstallState()`. |
| `apps/web/src/pwa/updateToast.ts` | "Update available — Reload", plain DOM. |
| `apps/web/src/sw.ts` | Wiring only: precache, `NavigationRoute`, `NetworkFirst`, message listener. |
| `apps/web/src/sw/handlers.ts` | Every cache decision and the client-message parser — importable, unit-tested. |
| `apps/web/public/_headers` | CSP + security headers. |
| `apps/web/public/fonts/*.woff2` | Self-hosted Manrope and Newsreader (latin + latin-ext, variable). |
| `apps/web/public/icons/*.png` | Generated icons (committed). |
| `apps/web/scripts/make-icons.mjs` | The generator. `npm run icons -w @goal-cascade/web`. |
| `apps/web/index.html` | Existing head kept; PWA metas, icons, `@font-face`, safe-area insets added. |
| `apps/web/tests/setup.ts`, `tests/pwa/*.test.ts` | 38 tests across manifest, SW handlers, deep links, update toast, CSP. |

`apps/web/src/main.tsx` was **not** touched — see "The one line" below.

---

## Decisions

### Fonts: self-hosted, not Google Fonts

**Chosen: self-host.** Manrope (400–800, variable) and Newsreader (400–500 italic, variable) are committed to
`apps/web/public/fonts` as latin + latin-ext woff2 subsets (~282 KB total), declared with `@font-face` in
`index.html`. The Google Fonts `<link>` is gone.

Three reasons, in order of weight:

1. **The CSP stays clean.** `default-src 'self'` with no third-party origin anywhere. Allowing
   `fonts.googleapis.com` in `style-src` and `fonts.gstatic.com` in `font-src` would have been the only
   external origin in the whole policy, and every future "can we just add…" would have had that precedent to
   point at.
2. **Offline actually works.** `injectManifest.globPatterns` includes `woff2`, so the fonts are now in the
   precache (12 entries, 502 KiB). A Google-hosted font cannot be precached, so an offline open would have
   silently fallen back to the system font — the app would look wrong exactly when the user is least able to
   understand why.
3. **No third party learns when a personal goal app is opened.**

Cost: ~282 KB of committed binary, and the files must be refreshed by hand if the typefaces are ever updated
(the URLs are documented in the `index.html` comment). Newsreader italic is the bulk of it (147 KB latin +
95 KB latin-ext) because it is a two-axis variable font; if that ever matters, dropping `latin-ext` for
Newsreader saves 95 KB at the cost of accented characters in the italic serif accents.

### Icons: generated, deterministic, from the palette

There is no logo, so `scripts/make-icons.mjs` draws one: **three nested chevrons cascading downward and
inward** — Life › Yearly › Quarterly › Monthly, the product's whole idea in one glyph. The two outer chevrons
are `colors.accentSoft`, the innermost is white: the cascade narrows to the one thing you are doing this week.

The script has no dependencies (PNG encoded over `node:zlib`) and converts the palette's **oklch** literals to
sRGB itself, so the output is a pure function of the palette and the geometry. Re-running on an unchanged
palette produces byte-identical PNGs — a diff under `public/icons` always means something real changed. Do not
hand-edit the PNGs.

Generated and committed: `icon-192`, `icon-512`, `maskable-512` (full-bleed, glyph inside the 80% safe zone),
`apple-touch-icon-180` (full-bleed square; iOS rounds it itself), `favicon-32` (all-white glyph — the pale
outer chevrons vanish at that size).

### Service worker: no push, no per-user cache — and the one thing that replaces it

Push is dropped entirely: R-nav-14 removes push flows by design, so NestFeed's `push` /`notificationclick` /
`pushsubscriptionchange` handlers, `subscriptionBody.ts` and the badge icon have no counterpart here.

NestFeed also scoped its read-model cache to a user id, backed by an identity record the *page* wrote after a
live `/api/me`. That machinery needs a page-side auth module that does not exist yet and is not mine to write,
so this build takes the blunt version instead, enforced in `src/sw/handlers.ts`:

- **`/api/me` and `/api/auth/*` are never cached** (`NEVER_CACHED_PREFIXES`). A cached 200 for the session
  endpoint is the thing that would let a signed-out phone be told it is signed in as the previous user and
  then be handed that user's cached goals.
- **Any 401/403 on a read empties the cache** before the response reaches the page (`isSessionEnded`).
- **A successful sign-out empties it too**, as does `postMessage({ type: 'clear-cached-data' })` from the page.

The cost is honest: a cold open with no network cannot resolve `/me`, so the app shows its retry/auth state
rather than the last known view. React Query's `localStorage` persister still restores the view once `/me`
resolves. **Upgrade path:** once there is a page-side identity module, port `react-app`'s
`apps/web/src/sw/identity.ts` and re-scope the cache name to `goal-cascade-read-models:<userId>` —
`purgeCachedApiData` already deletes by that prefix, so nothing else has to change.

`READ_MODEL_PREFIXES` is currently `/api/goals`, `/api/tasks`, `/api/plan`, `/api/backlog`, `/api/ideas`,
`/api/learnings`, matched as `path === p || path.startsWith(p + '/')` so item reads are covered and
`/api/goalsomething` is not. **Keep it in step with the endpoint constants in `@goal-cascade/shared`** once
those land.

### Two structural traps the blueprint warns about — how they are handled here

1. **The SW needs its own tsconfig.** `WebWorker` and `DOM` libs collide (`self`, `caches`, `location`), so
   `tsconfig.json` excludes `src/sw.ts` and `tsconfig.sw.json` checks it. `src/sw/handlers.ts` is excluded
   from *neither*: it is checked under DOM and under WebWorker, which is what keeps it honestly portable.
   Both `build` and `typecheck` run `tsc` twice.
2. **Logic lives in an importable module.** `src/sw.ts` is wiring; every decision is in `src/sw/handlers.ts`
   and unit-tested in `tests/pwa/sw.test.ts` under jsdom.

### Smaller calls, each verified against the build output

- **No `<link rel="manifest">` in `index.html`.** vite-plugin-pwa injects one and does not dedupe — writing
  one by hand produced two in `dist/index.html`. `tests/pwa/manifest.test.ts` guards against it coming back.
  (Consequence: the dev server is not installable, since `devOptions.enabled: false`. Correct trade.)
- **`includeManifestIcons: false`.** The `png` glob already precaches the icons; the default added them a
  second time (15 precache entries → 12).
- **`changeOrigin: false`** on the dev proxy, as the blueprint requires: rewriting the Host header would make
  the session cookie third-party in dev, so auth would work in production and nowhere else.
- **`--safe-bottom`** is published as a CSS custom property on `:root` rather than applied. `#root` gets the
  top/left/right insets; the bottom inset cannot help a `position: fixed` tab bar, and moving the tab bar is
  the web agent's call, not mine. See "Left for the web agent".

---

## The one line `main.tsx` needs

`apps/web/src/main.tsx` is the seam and was deliberately left alone. Add the import at the **top of the import
block, before `./App`** — order matters, because `beforeinstallprompt` and the initial URL are both read at
module load and are gone by the time a component effect runs:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import './pwa/boot';        // <-- add this line
import App from './App';
```

Side effects only; it exports nothing and renders nothing.

---

## Left for the web agent

- **The MSW server belongs in `tests/setup.ts`.** There is a `NOTE (web agent)` comment marking the spot;
  `msw` is already a devDependency. Nothing in the PWA tests needs a network, so nothing is wired yet.
- **Consume deep links.** `src/pwa/deepLink.ts` exports `onDeepLink(cb)` / `consumePendingDeepLink()` and the
  `DEEP_LINK_PARAMS` list to strip after applying one. Shapes: `?tab=tasks|goals|ideas|learnings|backlog|plan`
  and `?tab=goals&goal=<id>`. Adjust the tab names there if the store's view keys differ (the mockup uses
  `home` / `goals` / `line` / `ideas` / `learn`); the mapping is one line in the consumer either way.
- **Purge on sign-out and on 401.** Call
  `navigator.serviceWorker.controller?.postMessage({ type: 'clear-cached-data' })` alongside clearing the
  React Query persister. The worker already purges on the sign-out POST and on a 401 it sees, but a 401 the
  page handles from a cached-then-revalidated query may not pass through the worker's route.
- **`useInstallState()`** from `src/pwa/installState.ts` is available if an "Add to Home Screen" affordance is
  ever wanted; nothing renders it today.
- **`--safe-bottom`** — the fixed tab bar in `components/TabBar.tsx` sits under the home indicator on a
  notched phone. `padding-bottom: var(--safe-bottom)` on that container fixes it. Not applied here because
  `TabBar.tsx` is not mine to edit.
- **Dark theme.** R-nav-12 wants a real dark token set. `MANIFEST_DARK_THEME_COLOR` is `colors.ink`
  (`#1c1c19`) as a placeholder for the dark paper, asserted by the manifest test. When the dark palette lands
  in `src/ui.ts`, point that constant at the real dark background token and update the `index.html`
  `theme-color` dark variant — the test will tell you.

---

## Verification — what is green and what is not

Run from `apps/web` after a working `npm install`.

| Check | Result |
|---|---|
| `tsc -p tsconfig.sw.json --noEmit` | **passes** |
| `vitest run` | **passes** — 38 tests, 5 files |
| `vite build` | **passes** — SW built, 12 precache entries (502 KiB), `manifest.webmanifest` + `_headers` emitted, exactly one manifest link in `dist/index.html` |
| `tsc --noEmit` (app project) | **5 pre-existing errors, none in PWA files** |

The five `tsc` errors are in the mockup files the web agent owns, and all come from `noUncheckedIndexedAccess`
in `tsconfig.base.json` now applying to `apps/web` (the standalone mockup tsconfig did not extend the base):

```
src/store.tsx(242,18)  TS2322  period: string | undefined  -> string
src/store.tsx(334,167) TS2345  Horizon | undefined         -> Horizon
src/store.tsx(364,52)  TS2322  boolean | undefined         -> boolean
src/store.tsx(367,51)  TS2322  string | undefined          -> string
src/utils/tree.ts(37,21) TS2322 Goal | undefined           -> Goal
```

They will disappear with the React Query rewrite; they are listed here so nobody is surprised that
`npm run build` does not yet pass end to end.

### How this was verified without `packages/shared`

`npm install` at the repo root fails with `404 @goal-cascade/shared` until the foundation agent lands that
package — expected, and not worked around (creating `packages/shared` here would collide). Instead the
dependency set was installed in a scratch directory with the `@goal-cascade/shared` entry removed and linked
in as `apps/web/node_modules`, which is enough because **nothing in the PWA files imports `@goal-cascade/shared`**.
The `paths` mapping in `tsconfig.json` and the `"*"` dependency in `package.json` are therefore written
correctly but **unverified against the real package**. Once `packages/shared` exists, `npm install` at the
root and a re-run of `npm run typecheck -w @goal-cascade/web` is the confirming step.
