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

---

## Regression fixes

The browser agent re-ran the three fixes against the redeployed Worker and passed all three, then listed
three things they had left behind (`docs/work/09-e2e-browser/report.md`, "Regressions and nits found").
These are those, and nothing else was touched: `Sheet.tsx` was not restructured, no dependency was added,
no assertion was removed, skipped or loosened.

**`npm run typecheck --workspaces`: clean. `npm test --workspaces`: 345 api / 21 shared / 197 web, all
passing** (190 web before; +7 new, no edits to existing ones). **`npm run build -w @goal-cascade/web`:
succeeds**, `dist/sw.js` emitted with its 13-entry precache manifest.

### 1. The Enter bug: what it actually was

The report's item 2 was the serious one — seen once, not reproducible: Enter over `Keep editing` closed the
task detail sheet and took the typed done-condition with it. `Keep editing` doing the exact opposite of what
it says is data loss, so it was read for rather than clicked for.

**The obvious suspect was audited and cleared.** A `<button>` with no `type` is `type="submit"`, so inside a
`<form>` both Enter and a click run the form's submit handler instead of the button's own `onClick` — and
whether that happens depends on an ancestor several files away, which is exactly the shape of a bug that
reproduces once. Every `<button>` in `src/components/**` and `src/screens/**` was audited: **109 of them,
and 0 were missing an explicit `type`.** The app has exactly two `<form>` elements, both in the auth screens,
and both submit deliberately (`PrimaryButton` defaults to `type="submit"`; every use of it outside a form —
`App.tsx`, `VerifyEmailScreen` — passes `type="button"` explicitly). The task detail sheet is not inside a
form at all. **So the reported Enter path does not exist, and this was not a form submit.** Nothing needed
fixing here; the guard below exists so it stays that way.

Reproduced in the harness instead: with the strip up and focus on `Keep editing`, `{Enter}` fires the
button's own `onClick`, the strip closes, the sheet stays open and the value survives. It does not close.
There is no code path from `Keep editing` to `onClose` — the only callers are `Discard`, the `✕`, the
backdrop, and Escape.

**What can actually close the sheet and discard, without the user choosing it, is Escape auto-repeat.** The
strip is raised by Escape and answered by Escape ("ask once, then out" — a trap is worse than a lost draft).
Held down, Escape repeats at roughly 30/s after a ~500ms delay, so a key held a moment too long raises the
strip and answers it inside one press: the question appears and is gone before it can be read, and
paragraphs go with it. That fits the evidence — one sighting, no reproduction from deliberate presses, and
an agent that had pressed Escape and then Enter would attribute the close to the Enter it saw last.

The fix is two lines in the Escape branch: **an auto-repeat may raise the strip; it may never be the press
that discards.**

```ts
if (e.repeat && confirming) return;
```

Deliberate presses are unchanged — the existing "ask once, then out" test (`{Escape}` `{Escape}`) still
passes untouched, because two discrete presses carry `repeat: false`.

**Honest summary: the reported Enter-closes-and-discards bug is not real — the mechanism it was attributed
to does not exist in this code, and it does not reproduce. A real data-loss path was found next to it, in
the same strip, and is closed.**

### 2. Focus is handed back when the strip is dismissed

Report item 1, reproduced consistently: dismissing the strip unmounted the button that held focus, and the
browser's answer to that is `<body>` — outside an `aria-modal` dialog, mid-sentence. The trap was not broken
(the next Tab re-entered at `Close`), but a keyboard user had lost their place in a sheet they had just
chosen to stay in, which is the opposite of what `Keep editing` promises.

`requestClose` now records `document.activeElement` **before** the strip mounts and steals focus — that is
the field being typed into — and the `confirming` effect gained an else branch: on dismiss it puts focus
back there, guarded by `isConnected` and `sheet.contains(...)` because the render that dismissed the strip
may have taken the field with it. The fallback is the sheet's first field (`firstField`, the first
`input`/`textarea`/`select` in the trap's own DOM order, else its first stop) — never `<body>`. A backdrop
click with unsaved edits records `<body>` as the interrupted element, fails the `contains` check and lands
on the first field, which is the right answer for a dismissal that never had a caret.

### 3. The heading's focus ring

Report item 3, cosmetic. The `<h2>` is `tabindex="-1"` and takes focus on open so the dialog's title is
announced — right for a screen reader, and at `flex: 1` it drew a full-width green box across the sheet
whenever the sheet was opened from the keyboard, because `:focus-visible` still matched.

Two narrow changes, no ring removed from anything interactive:

- `index.html`: `[tabindex]` in the shared ring becomes `[tabindex]:not([tabindex="-1"])`, inside the
  existing `:where()` so the rule keeps its zero specificity. An element with `tabindex="-1"` is not a tab
  stop and is only ever focused by script. `a`, `button`, `input`, `select` and `textarea` still match on
  their own element names whatever their tabindex, so every genuinely interactive control keeps its ring.
- `ui.ts`: `sheetTitle` swaps its now-pointless `outlineOffset: 3` for `outline: 'none'`, so the heading
  cannot pick a ring back up from a future rule.

### Files changed

| File | Change |
|---|---|
| `apps/web/src/components/Sheet.tsx` | `interruptedRef` + `firstField`; focus restored on dismiss; the `e.repeat` guard (and `confirming` added to the keydown effect's deps so the guard sees it) |
| `apps/web/src/ui.ts` | `sheetTitle`: `outlineOffset: 3` → `outline: 'none'` |
| `apps/web/index.html` | the shared ring skips `[tabindex="-1"]` |
| `tests/screens/buttonTypes.test.tsx` | **new** — 2 tests, the class-of-bug guard |
| `tests/screens/sheetDismissal.test.tsx` | +5 tests for the three items above; nothing existing changed |

Each of the five new sheet tests was checked against the unfixed code: the Enter test passes either way
(there was no bug), and the other four fail without their fix. Both button-type guards were checked the same
way — the source scan fails when a `type` is deleted, and the DOM scan fails when `PrimaryButton` loses its
default (a prop that resolves to `undefined` emits no attribute at all, and the submit default is back).

### The guard against the class of bug

`tests/screens/buttonTypes.test.tsx`, two tests, because neither catches what the other does:

1. **Source scan.** Every `<button …>` opening tag in `src/components/**` and `src/screens/**` — found by
   scanning to the end of the tag rather than by a regex, since attribute values run across lines and hold
   `{}`, quotes and nested JSX — must carry an explicit `type=`. It reads every file, including screens no
   test renders, and asserts the tag count it found so a silently broken parse cannot pass by finding
   nothing.
2. **DOM scan.** Renders the real `Choose a new password` `<form>` and asserts no button inside it reaches
   the DOM without a `type` attribute, plus that the submit is `Save password` and `Back to sign in` is
   `type="button"`. This is the half that catches `type={undefined}` — the source scan sees the prop and is
   satisfied, while React emits no attribute and the default returns.

`apps/api/**` and `packages/shared/**` were not touched.
