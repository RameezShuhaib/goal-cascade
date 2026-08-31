# 10 — Dismissible sheets, AA contrast, a theme-aware `color-scheme`

The three accessibility defects the browser walkthrough found (`docs/work/09-e2e-browser/report.md`,
findings A, B and C), fixed. Nothing was restructured: 13/13 flows still work, the oklch palette, the
self-hosted Manrope/Newsreader, `#f6f6f3` and the inline-style convention are untouched, and no dependency
was added — the focus trap is twenty lines in the component that already existed.

**`npm run typecheck --workspaces`: clean. `npm test --workspaces`: 345 api / 21 shared / 190 web, all
passing** (170 web before; +18 new, and 4 selector updates explained in §5). **`npm run build -w
@goal-cascade/web`: succeeds**, `dist/sw.js` emitted with its 13-entry precache manifest.

---

## 1. Finding A — the sheets were one-way doors

`apps/web/src/components/Sheet.tsx` is the only file that renders a `role="dialog"`, and every sheet in the
app goes through it, so the whole `aria-modal` contract is implemented there once and every sheet inherits
it. What it now does, and what each part replaces:

| Behaviour | Before | Now |
|---|---|---|
| Escape | nothing | closes; with unsaved work, asks once and the second Escape closes anyway |
| Dismiss control | none (only `Save`/`Move it`/…) | a quiet `✕` in the sheet header, `aria-label="Close"` |
| Focus on open | stayed on the trigger *behind* the sheet | moves to the sheet's heading |
| Focus while open | free to wander behind an `aria-modal` dialog | trapped: `Tab`/`Shift+Tab` cycle inside |
| Focus on close | wherever it happened to be | back to the element that opened the sheet |
| Backdrop | no element — an accidental gap above the sheet | an explicit `div`, click closes (R-nav-15) |
| Accessible name | a hand-written `aria-label` | `aria-labelledby` → the `<h2>` the sheet renders |

### How the focus trap works

No library. Three pieces, all in `Sheet.tsx`:

1. **On mount** the component records `document.activeElement` — the `+ Task` button, the task row, the `…`
   menu item — and focuses its own `<h2 tabindex="-1">`. The heading rather than the first field, so a phone
   keyboard does not spring up and nothing is typed into by accident; a screen reader reads the dialog's
   title, which is the point of `aria-labelledby`.
2. **While open** a `keydown` listener on `document` (in the *capture* phase, so a field that stops
   propagation cannot swallow Escape) handles `Tab`. It queries the sheet for everything tabbable in DOM
   order — `a[href]`, `button`, `input`, `select`, `textarea`, `[tabindex]`, each `:not([disabled])`,
   because this app disables controls on purpose (an empty title, an invalid Move target) and a disabled
   control must not be a stop on the way round. Then: forward off the last stop wraps to the first, backward
   off the first wraps to the last, and if focus has escaped the sheet entirely (a click on the page behind)
   the next `Tab` pulls it back in. The `-1` heading is not in the ring: forward from it falls through to
   the browser's own next stop, which is the `✕`.
3. **On unmount** the recorded trigger is focused again, guarded by `isConnected` — the action that closed
   the sheet may have removed the row that opened it.

### Escape and unsaved input

The rule the product's own copy sets ("No mandatory fields. Fast and guilt-free.", R-nav-14) is that nothing
in a flow is ever mandatory — including a confirmation. So **only one sheet asks**: the task detail sheet,
and only while its form is dirty. It is the one sheet you can sit in and write paragraphs into (title,
done-condition, description, all pre-filled from the server), and it already tracks `dirty` for its
`Save changes` button, which is passed straight through as `unsaved`.

The prompt is one strip inside the sheet — *"Discard your unsaved edits?"* `[Discard] [Keep editing]` —
focus moves to `Keep editing`, and **Escape while it is up discards and closes**. A trap is worse than a
lost draft, so the escape hatch asks at most once and can never become a second door to be stuck behind.

Every other sheet closes on the first Escape. The goal form holds a title and a one-line why; the Move,
Re-plan, Cancel and Move-to-Backlog sheets hold an optional reason. Guarding those would contradict the
product's thesis, and `tests/screens/sheetDismissal.test.tsx` asserts that a typed reason does **not** stop
Escape.

### The visible ✕ and the heading

The header is `[ heading ] [ optional link ] [ ✕ ]` — one row, 36px hit target, `T.mut` on no background.
A ✕ in the header rather than a `Cancel`/`Save` button bar: the app's chrome is quiet, and a sheet that
shouts about leaving reads as a commitment.

Each sheet's heading used to be a `<div>` in its own children, which is why `aria-modal` had nothing to
point at. `Sheet` renders it now, from the `label` prop, as the `<h2>` that `aria-labelledby` targets — so
the accessible name and the visible title cannot drift apart, because they are the same node. The visible
copy is unchanged in every case (`Move goal`, `New sub-goal`, `Delete “…”?`, `Move to Backlog`, …); the
task detail sheet gains a visible `Task detail` heading where it previously had only a grab handle, and the
handle is still above it.

## 2. Finding B — light mode failed AA on muted text

`mut` is the token behind the bottom tab bar, every breadcrumb, every section header, every page eyebrow and
every explanatory subtitle, at 11–13.5px — under the 18.66px/24px large-text exemption, so AA is 4.5:1.

A hue-preserving lightness step in OKLCH, and nothing else: **hue 106.7° and chroma 0.011 unchanged,
lightness 0.631 → 0.543.** It is the same warm grey, one step darker.

| Token | Surface | Before | After | AA 4.5:1 |
|---|---|---|---|---|
| light `mut` `#8a8a82` → `#707069` | page `paper` `#f6f6f3` | **3.21 : 1** | **4.61 : 1** | pass |
| light `mut` `#8a8a82` → `#707069` | card `#fff` | **3.48 : 1** | **4.99 : 1** | pass |
| dark `mut` `#9a9a90` (unchanged) | page `paper` `#1c1c19` | 6.02 : 1 | 6.02 : 1 | pass |
| dark `mut` `#9a9a90` (unchanged) | card `#242420` | 5.49 : 1 | 5.49 : 1 | pass |

Dark mode was already correct and was not touched. `LIGHT` in `ThemeContext.tsx` **is** `colors` from
`ui.ts`, so the one edit in `ui.ts` moves both, and `pwa/manifest.ts` reads only `paper`/`ink`, which did
not change — the install colours are unaffected.

`tests/screens/contrast.test.ts` recomputes the ratio from the tokens themselves (WCAG relative luminance,
`#abc` and `#aabbcc`) for both themes × both surfaces and fails under 4.5:1, plus a check on the check: it
reproduces the walkthrough's own 3.21 and 3.48 for the old token, so the formula is measured rather than
trusted. A palette drifting back below AA is exactly the regression a comment cannot stop.

**Left alone, deliberately:** the `faint` tier (light `#b5b5ad` → 1.91:1 on page, 2.06:1 on card; dark
`#6e6e66` → 3.32:1 / 3.03:1) is a *different* token and fails AA in **both** themes. It carries
`DORMANT — no focus this week`, `from week of …`, `Done <date>`, the activity timestamps and the picker
rows' horizon labels. Fixing it means re-tuning both palettes — light `faint` lands on top of the new `mut`
and dark `faint` has to move up to roughly dark `mut`, collapsing a deliberate three-tier hierarchy in the
owner's approved design. That is a design decision, not a defect fix, so it is recorded here rather than
made unilaterally.

## 3. Finding C — `color-scheme` did not follow the theme

`index.html` pinned `color-scheme: light` and `background: #f6f6f3` on **`body`**, and a stylesheet
declaration beats an inherited value — so `applyDocumentTheme`'s `color-scheme` on `<html>` never reached
anything. In dark mode `getComputedStyle(document.body).colorScheme` stayed `light`: native controls,
scrollbars and form widgets rendered for a light page inside a dark app (the browser-default blue focus ring
on the done-condition input), and a light body sat under a dark app ready to flash white.

- `index.html`: `html { background: #f6f6f3; color-scheme: light; }` with a
  `@media (prefers-color-scheme: dark)` override, and `html, body { margin: 0; padding: 0; }` — the body
  declares neither any more. These two literals are the first paint only (the CSP forbids an inline script
  that could read the stored choice); `main.tsx`'s `bootDocumentTheme()` repaints from the stored preference
  before React mounts.
- `applyDocumentTheme` now writes `colorScheme` and `backgroundColor` to `document.body` as well as
  `documentElement`, so nothing can quietly re-pin them, and publishes `--focus-ring` from `tokens.green`.
- `index.html` grows one rule: `:where(a, button, input, select, textarea, [tabindex]):focus-visible
  { outline: 2px solid var(--focus-ring); outline-offset: 2px; }`. `:focus-visible` so a mouse click on a
  button draws nothing; `:where()` so its zero specificity never fights a component's inline styles.

**Verified in Chrome against the production build** (`vite preview` over `dist/`), focusing a real text
input in both media modes:

| Theme | `body` `color-scheme` | `body` background | Input focus ring |
|---|---|---|---|
| light | `light` | `rgb(246, 246, 243)` | `solid 2px oklch(0.55 0.11 125)` |
| dark | `dark` | `rgb(28, 28, 25)` | `solid 2px oklch(0.68 0.11 125)` |

The ring is the app's own green in both, at the lightness that theme uses. The browser default (blue on a
light page, white on a dark one) is gone.

## 4. Files changed

| File | Change |
|---|---|
| `apps/web/src/components/Sheet.tsx` | the whole of finding A: Escape, trap, initial + restored focus, `✕`, backdrop, `aria-labelledby`, the one discard prompt |
| `apps/web/src/ui.ts` | `mut` `#8a8a82` → `#707069`; `sheetHeader` / `sheetTitle` / `sheetClose` / `discardBar` styles |
| `apps/web/src/context/ThemeContext.tsx` | `applyDocumentTheme` also paints `body` and publishes `--focus-ring` |
| `apps/web/index.html` | `color-scheme` off `body`, dark first-paint media query, the app's `:focus-visible` ring |
| `components/GoalModals.tsx`, `TaskSheets.tsx`, `BacklogSheets.tsx`, `TopActions.tsx` | each sheet's heading `<div>` removed in favour of the `label` the shared header renders; the drawer's "View Backlog →" moved to `headerRight`; the task detail sheet passes `grip` and `unsaved={dirty}` |
| `tests/screens/sheetDismissal.test.tsx` | **new** — 11 tests, finding A through the real provider stack |
| `tests/screens/contrast.test.ts` | **new** — 7 tests, the AA ratios computed from the tokens |
| `tests/screens/theme.test.tsx` | +2 tests for finding C (body + `--focus-ring` follow the theme; `index.html` paints only `html`) |

`apps/api/**` and `packages/shared/**` were not touched.

## 5. The four test edits, and why they are not a weakening

No assertion was removed, skipped or loosened. Four **selectors** moved:
`findByRole('dialog', { name: 'Task create' })` → `{ name: 'New task' }`, in `tests/screens/plan.test.tsx`
and `tests/screens/backlog.test.tsx`.

`Task create` was the value of a hand-written `aria-label` that appeared nowhere on screen — the sheet's
visible heading always read *New task*. Now that the dialog is named by `aria-labelledby` pointing at that
heading (which is what finding A asks for), its accessible name **is** `New task`. The old name was the bug
those queries were asserting against; the tests assert the same thing about the same dialog.
