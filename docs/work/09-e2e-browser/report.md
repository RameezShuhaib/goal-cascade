# Goal Cascade — E2E browser verification

**Target:** https://goal-cascade-api.me8468.workers.dev
**Browser:** Chrome (desktop, 1920×992 viewport), signed in as the production account
**Date of run:** 2026-08-31 (app clock: week of Mon 31 Aug)
**Method:** manual driving of the real deployment in a real browser, starting from an empty goal tree. Console read after every major flow. API probed directly (same session cookie) where a UI guard needed to be confirmed server-side.

**Headline: 13/13 flows PASS.** No functional defect, no data-integrity defect, and a completely clean console for the entire session (verified the console reader was live by emitting a probe log and reading it back). Everything below the flow list is polish, accessibility and spec-drift, not breakage.

---

## First impressions

This does not feel like a test fixture. It feels like a product someone actually wanted to use.

The thing that stands out immediately is that **emptiness is designed, not defaulted**. A brand-new account with zero goals never once shows a blank rectangle or a spinner that never resolves. Every surface has a sentence written for that exact moment: *"A new week, still unplanned."* / *"Nothing planted yet."* / *"Nothing parked."* / *"Nothing in the backlog."* / *"No learnings yet."* — each in an italic serif, each followed by one line of plain-language orientation and, where an action makes sense, exactly one button. The `+` drawer with no eligible goals says *"Nothing to file this under yet — a backlog item needs a Yearly, Quarterly or Monthly goal"*, which is the single hardest empty state in the app and it is the best-written one. This is the part I expected to find ugly, and it is the part the app is proudest of.

Dormancy is handled with the same care. A leaf with no weekly focus reads `DORMANT — no focus this week` in muted type in the tree, and its detail page carries a full panel: *"DORMANT / No weekly focus this week. Activate it in weekly planning."* You are never left wondering whether something is off or broken.

The voice is consistent and unusually calm. The Move-to-Backlog and Cancel sheets both say, under an empty optional reason field, *"No mandatory fields. Fast and guilt-free."* That is the product's thesis in five words, and the code actually honours it — I confirmed both confirm buttons are enabled with the reason blank.

The typography is genuinely good: a serif for focus sentences and empty-state headlines, a geometric sans for chrome, small-caps breadcrumbs. Light and dark are both real palettes (cream `#f6f6f3` / ink `#1c1c19`, olive-green accent that stays green in both) — I checked every element's computed `filter` in both themes and there is not a single CSS filter anywhere on the page. The invert hack is gone.

Two honest criticisms of the *feel*:

1. **It is a phone app wearing a desktop window.** At 1518px the entire product lives in a ~480px column pinned to the centre, with the tab bar welded to the bottom of a 780px-tall viewport, leaving two-thirds of the screen as empty background. It is not broken — it is just obviously not designed for the screen I was on, and the goal tree in particular has room it never takes.
2. **Modals are one-way doors.** Every bottom sheet (New goal, New sub-goal, Move goal, New task, task detail) opens with `role="dialog" aria-modal="true"`, and the *only* way out is to click the sliver of page still visible above the sheet. Escape does nothing. There is no ✕ and no Cancel. With a mouse on desktop this is a mild annoyance; on a phone, where the sheet covers nearly the whole screen, and for anyone on a keyboard, it is a trap. See finding A.

Working in it for an hour, the loop — plan the week in one sentence, add a task, tick it, let the rest carry — is fast and low-friction, and the Activity timeline on a task is a genuinely nice touch: it records everything and asks for nothing.

---

## Flow-by-flow

### 1. Cold open and sign-in — **PASS**

Loaded in dark mode with no flash of unstyled content and no layout shift. Signed-out card is centred and complete: wordmark, "Welcome back", Sign in / Create account segmented control, email + password, submit, "Forgot password?". Sign-in with the production credentials succeeded on the first attempt and landed directly on Tasks for the current week. No console output.

Nits:
- The signed-out page is the **only** page with no theme toggle. BUSINESS-RULES says "Every page: consistent top-right cluster — theme toggle (light/dark) + one primary action." A user who prefers light mode has to sign in through a dark screen.

### 2. First-run empty state — **PASS** (strongest area of the app)

With zero goals, all five surfaces read as deliberate:

| Surface | Copy |
|---|---|
| Tasks | *"A new week, still unplanned."* + "Pick which branches are active this week, then write each focus." + **Plan this week** |
| Goals | *"Nothing planted yet."* + "Start with a Life goal — the thing the rest of the cascade hangs off." + **+ New goal** |
| Ideas | *"Nothing parked."* + "When an idea grabs you mid-task, drop it here and get back to work." (capture box stays available above) |
| Learnings | *"No learnings yet."* + "When reality surprises you, write it down — future-you will use it." |
| Backlog | *"Nothing in the backlog."* + "Future work lives here until you pull it into a week." |
| `+` drawer (no eligible goal) | "Nothing to file this under yet — a backlog item needs a Yearly, Quarterly or Monthly goal." |

Ideas/Learnings correctly keep their capture field enabled with the submit button disabled until text is entered. Console clean.

### 3. Build a tree — **PASS**

Created Life → Yearly → Quarterly → Monthly, plus a second Monthly directly under the Life goal (to give a dormant sibling and a distinct horizon-conflict target for flow 4):

```
Be genuinely fit at 50                       LIFE
└─ Run a sub-2h half marathon in 2026        YEARLY
   └─ Build an aerobic base this quarter     QUARTERLY
      └─ Run 4 times a week in August        MONTHLY
└─ Sleep 7h a night in August                MONTHLY
```

- Horizon picker gating is real, not cosmetic. Verified via the DOM that the ineligible horizon buttons carry `disabled=true`: under a Life parent, `Life` is disabled; under Yearly, `Life`+`Yearly`; under Quarterly, `Life`+`Yearly`+`Quarterly`. The shortest legal horizon is preselected.
- **A Monthly goal offers no `+ Sub-goal`** — its action menu is `Edit · Re-plan… · Move… · Delete` only. Life goals correctly show `+ Sub-goal · Edit · Delete` (no Move, no Re-plan).
- Target period defaults from horizon: Yearly → `2026`, Quarterly → `Q3 2026`, Monthly → `Aug 2026`.
- Parent picker shows the tree with the intended parent preselected and indented by horizon.

Nits:
- Changing the horizon inside the create drawer **re-flows the sheet vertically** (the parent picker grows/shrinks), so the title field moves under the cursor. Cost me one mis-click; a user typing then changing their mind will hit the same thing.
- Horizon toggle groups carry no `aria-pressed`/`role="radio"` — the selected horizon is conveyed to assistive tech only by colour.

### 4. Invalid move — **PASS** (best-implemented rule in the app)

Opened `Move…` on *Build an aerobic base this quarter*. The dialog lists every goal with invalid targets **disabled and annotated**, and both required reasons appear:

```
Be genuinely fit at 50               LIFE
  Run a sub-2h half marathon in 2026 YEARLY
    Build an aerobic base this quarter QUARTERLY  its own descendant   [disabled]
      Run 4 times a week in August    MONTHLY     its own descendant   [disabled]
  Sleep 7h a night in August          MONTHLY     horizon conflict     [disabled]
```

Confirmed via the DOM that all three are genuinely `disabled=true` (not just styled), and the `Move it` button is `disabled` until a valid target is chosen. Selecting the Life goal produced the preview *"Build an aerobic base this quarter will move under Be genuinely fit at 50"*.

**Server-side guard confirmed too.** I issued the illegal move directly against the API with the session cookie (moving the Quarterly under its own Monthly descendant):

```
POST /api/goals/<quarterly-id>/move   {"parentId":"<its-monthly-descendant-id>"}
→ 409 {"error":{"code":"WOULD_CREATE_CYCLE",
       "message":"a goal cannot move under itself or one of its descendants",
       "details":{"targetId":"01M1AMRNCQV1TY0YB23JXACQX1"}}}
```

The endpoint also correctly rejects a request with no `Idempotency-Key` (`400 IDEMPOTENCY_KEY_MISSING`). The UI guard is not the only guard.

Nit:
- The goal being moved is itself labelled **"its own descendant"**. A goal is not its own descendant; the honest label is "this is the goal" / "already here". Small copy bug in an otherwise exemplary dialog.
- The preview names only the new parent, not the full path ("Be genuinely fit at 50 › Build an aerobic base this quarter"), where BUSINESS-RULES says "A preview of the new path is shown".

### 5. Weekly planning — **PASS**

`Edit plan` → both leaves listed with their branch path underneath. Checking a leaf reveals its focus textarea inline.

I deliberately tried to save with one leaf checked and its focus empty. It refused, with a field-level and a form-level message:

> **A checked branch needs a focus sentence to stick.** (inline, on the offending card, card outlined red)
> **One checked branch has no focus sentence yet.** (above the save button)

Unchecked the second leaf, saved → toast **"Plan saved"**, redirect to Tasks showing the active leaf's full breadcrumb and focus sentence with a `+ Task` affordance.

The dormant sibling reads as intentional everywhere:
- Tree: muted, `DORMANT — no focus this week`
- Life card: `1 of 2 branches active`
- Goal detail: a dedicated panel, *"DORMANT / No weekly focus this week. Activate it in weekly planning."*

Also verified the pull-based half of the rule: after adding a backlog item under the active leaf, the planning screen grows a **`FROM THE BACKLOG`** list under that leaf with each item as a `+` row.

### 6. Tasks — **PASS**

Created `Tuesday easy 5k` under the active leaf (goal filter pill count went `· 0` → `· 1`). Completed it → strikethrough, muted `Done Mon 31 Aug`, count back to `· 0`. Unchecked it → count back to `· 1` and the skippable inline **"Update the done-condition?"** panel appeared with `Save` / `Skip`. Skipped.

Opened the task detail. Activity, newest first, exactly as specified:

```
✎  Renamed: "Tuesday easy 5k" → "Tuesday easy 6k"    Mon 31 Aug
↩  Unchecked                                          Mon 31 Aug
✓  Completed                                          Mon 31 Aug
＋ Created — weekly planning                          Mon 31 Aug
```

The rename was made in the detail sheet's Title field; a `Save changes` button appears only once the form is dirty, and saving produced the toast **"Task updated"** and the `Renamed` entry above. Source attribution is correct per origin — a task pulled from the backlog logs `Created — pulled from Backlog` instead.

Nits:
- The inline "Update the done-condition?" input has **no label and no placeholder** — it is a bare box under a heading.
- The `Done-condition` input takes the **browser-default blue focus ring**, which is jarring in an app this carefully coloured. Root cause is the same as finding C below (`color-scheme: light` leaking).
- The task detail sheet has no complete/uncheck affordance; the checkbox lives only on the list row. Consistent with the rules (Complete is "the checkbox"), but a user who opened the detail to finish a task has to back out first.

### 7. The three exits — **PASS**

A task offers exactly three exits and no more: **Complete** (list-row checkbox), **Move to Backlog** and **Cancel task** (detail sheet). No delete, no archive, no "defer".

Both confirms are lightweight in-app sheets and the reason is genuinely optional:

```
Move to Backlog
"Tuesday easy 6k" → Run 4 times a week in August's backlog
[ Why? (optional) ]
No mandatory fields. Fast and guilt-free.
[ Move it ]          ← enabled with the field empty
```

```
Cancel task
"Saturday long run 12k" → dropped
[ Why? (optional) ]
No mandatory fields. Fast and guilt-free.
[ Cancel it ]        ← enabled with the field empty
```

Confirmed both with an empty reason: toasts **"Moved to Backlog"** and **"Task canceled"**, task removed from the week in both cases.

**No native browser dialogs anywhere.** I instrumented `window.alert/confirm/prompt` with recorders before exercising the destructive paths; the recorder array was empty after every one. The app never reaches for a native modal.

### 8. Backlog conversion — **PASS**

The moved task appeared in the Backlog grouped under `BE GENUINELY FIT AT 50 › RUN 4 TIMES A WEEK IN AUGUST`, with `Added Today` and the required provenance note **`from week of Mon 31 Aug`**.

Tapping the item revealed `Add to this week · Move to another goal · Delete`. `Add to this week` opened the standard task-create modal **pre-filled** with the title and the active leaf's weekly focus preselected. On save:

- the task appeared under the weekly focus on Tasks (count `· 1`),
- its Activity read `Created — pulled from Backlog`,
- and the item was **gone from the Backlog**. Converted, not duplicated. Verified by re-reading the Backlog page.

### 9. Inactive branch — **PASS**

Added `Buy blackout curtains` to the backlog of `Sleep 7h a night in August` (the dormant leaf) and hit `Add to this week`:

> **This branch isn't active this week**
> "Buy blackout curtains" can only become a task under an active weekly focus.
> **[ Set a weekly focus ]  [ Cancel ]**

`Set a weekly focus` routes to `?tab=plan`. Exactly the specified behaviour.

Nit:
- The handoff loses the user's intent. Weekly planning opens with nothing pre-checked, nothing scrolled to, and no memory of the item that sent them there. The user has to find *Sleep 7h a night in August* themselves, save, navigate back to the Backlog, find the item again, and pull it a second time. Pre-checking the branch (or returning to the pull afterwards) would close the loop.
- This is also the only sheet in the app with a Cancel button, which makes finding A's inconsistency more visible rather than less.

### 10. Ideas and Learnings — **PASS**

**Idea:** captured `Try running with a metronome app at 180spm` with the default "No goal" tag → filed under an `UNSORTED` group with `Parked Today`. Tapping it revealed `Task this week · Attach to a goal · Delete`. `Attach to a goal` expanded an inline **"SEND TO WHICH GOAL'S BACKLOG?"** picker listing only the non-Life goals. Chose *Build an aerobic base this quarter* → toast **"Moved to Backlog under Build an aerobic base this quarter"**, idea removed from the parking lot, and the item verified present in that goal's backlog group. Confirmation toast as specified.

**Learning:** captured `Morning runs happen; evening runs get skipped.` tagged to the Life goal → rendered in italic serif with curly quotes under a `BE GENUINELY FIT AT 50` group heading, `Captured Today`.

**Bonus — goal detail screens (not in the brief, worth recording):** the Life goal's detail page shows sub-goals, `+ Add sub-goal`, and a **read-only aggregate `BACKLOG ACROSS THIS LINE (3)`** with each item labelled by its own goal, plus `Open Backlog →` and a Learnings section. Exactly what BUSINESS-RULES asks for. A Monthly goal's detail shows its own `BACKLOG (1)` with a `+ Add`.

Nits:
- Goal detail pages have **no top-right cluster at all** — no theme toggle, no primary action. Spec says every page carries it. Navigation back is a small `Goals · Be genuinely fit at 50` breadcrumb top-left.
- A learning tagged to the Life goal is also rendered on every descendant goal's detail page. Defensible as "line context", but it makes one learning look like it belongs to five goals.
- The `+` drawer's goal selection does **not** default to last used (spec: "goal defaults to last used"). After filing an item under *Sleep 7h a night in August*, reopening the drawer reset to *Run a sub-2h half marathon in 2026*.

### 11. Week switcher — **PASS**

- `›` (Later week) is `disabled=true` in the DOM while on the current week. Future weeks are not reachable.
- `‹` moved to **Week of Mon 24 Aug** with the chip **`Past week — still editable`**, an intentional empty state (*"Nothing happened this week." / "No tasks were live in this week."*), and `Edit plan` correctly hidden (planning is current-week only).
- The week picker offers `This week` plus the seven preceding weeks. No future entries.

**Server-side too:** the API rejects a future offset rather than trusting the client.

```
GET /api/goals?week=1 → 422 VALIDATION_FAILED  {"code":"too_big","maximum":0,"inclusive":true,"path":["week"]}
GET /api/tasks?week=1 → 422 VALIDATION_FAILED  (same)
```

### 12. Theme toggle — **PASS**. The invert hack is gone.

Toggled to light and back. This is real theming, verified three ways:

1. **No CSS filters exist on the page in either theme.** Enumerated `getComputedStyle(el).filter` across every element in the document; the set of non-`none` values is empty (`[]`) in both light and dark. Nothing is inverted or hue-rotated.
2. **The accent survives the switch.** The olive/sage green (`#c9dfa0`-family) stays green in both themes. Under an invert filter it would come out magenta.
3. **The palettes are independently authored**, not mirrored: dark is ink `rgb(28,28,25)` on cards, text `rgb(240,240,234)`; light is cream `rgb(246,246,243)`, text `rgb(28,28,25)`, with the primary button flipping to a dark-green fill and the pills to a dark-on-light treatment. Text stays crisp; nothing looks washed out or photo-negative. The toggle icon changes ☀ ↔ ☾ and the choice persists across a full reload.

The **one real problem** here is contrast in **light mode only** — see finding B.

### 13. PWA — **PASS**

```js
await navigator.serviceWorker.getRegistrations()
→ 1 registration, scope "https://goal-cascade-api.me8468.workers.dev/", state "activated"
```

```
GET /manifest.webmanifest → 200
{ name:"Goal Cascade", short_name:"Cascade", display:"standalone",
  start_url:"/", theme_color:"#f6f6f3", background_color:"#f6f6f3",
  icons: 192×192 png, 512×512 png, 512×512 maskable png }
```

All three icon files return `200 image/png`. Reloaded the app after the run: the tree, the weekly focus, the task, the backlog and the chosen theme all came back intact, no flash, no error, console clean.

Nit:
- `theme_color` and `background_color` are both the **light** palette regardless of the user's chosen theme, so a dark-mode user who installs the PWA gets a white splash screen and a white status bar before the dark app paints.

---

## Console

**Zero application console output for the entire session** — no errors, no warnings, no React key/hydration complaints, no failed requests. I validated the reader itself mid-run by emitting `console.log('E2E-PROBE-console-works')` and `console.warn('E2E-PROBE-warn')` and reading both back, so the silence is the app's, not the tool's. The only entries ever returned were those two probes.

Verbatim, the complete set of console messages captured across the run:

```
[LOG]     E2E-PROBE-console-works      ← injected by me, to prove the reader works
[WARNING] E2E-PROBE-warn               ← injected by me, to prove the reader works
```

---

## Findings, worst first

### A. Modal sheets cannot be dismissed by keyboard and never receive focus — accessibility, real

Every bottom sheet renders with `role="dialog"` and `aria-modal="true"`. For the New goal, New sub-goal, Move goal, New task and task-detail sheets:

- **Escape does nothing.** The dialog is still in the DOM after `Escape`.
- **There is no ✕ and no Cancel button.** For the New task sheet the complete button list inside the dialog is `["Save task"]`. For the Move goal sheet it is the target list plus `["Move it"]`.
- **Focus is never moved into the dialog.** Immediately after the New task sheet opens, `dialog.contains(document.activeElement)` is `false` — focus is still on the `+ Task` button *behind* the sheet.
- The only exit is clicking the strip of page still visible above the sheet (there is no rendered backdrop/scrim element, so this is an undiscoverable click target). This works, but nothing signals it.

`aria-modal="true"` tells assistive tech to hide everything outside the dialog. Combined with focus never entering it and no keyboard dismissal, a screen-reader or keyboard-only user who opens any of these sheets can reach the content only by blind tabbing and can leave only by submitting. On a phone — the form factor this app is clearly built for — the sheet covers most of the screen, so even the mouse escape hatch is a sliver.

The one counter-example proves the fix is cheap: the "This branch isn't active this week" sheet **does** have a `Cancel` button. The rest need the same treatment, plus an `Escape` handler and an initial-focus target.

### B. Light mode fails WCAG AA on all muted text — accessibility, real, systematic

The muted-foreground token is `rgb(138,138,130)` (`#8A8A82`). Against the two light-mode surfaces it yields:

| Background | Ratio | AA (4.5:1) |
|---|---|---|
| page `rgb(246,246,243)` | **3.21 : 1** | fail |
| card `rgb(255,255,255)` | **3.48 : 1** | fail |

It is used at 11–13.5px — well under the 18.66px/24px large-text exemption — so 4.5:1 applies. The affected text is not decorative:

- the **entire bottom tab bar** (`Tasks`, `Goals`, `Ideas`, `Learnings`) at 11.5px / 3.48:1
- goal **breadcrumbs** under every leaf (`Run a sub-2h half marathon in 2026 › Build an aerobic base this quarter`) at 11.5px / 3.48:1
- section headers (`FROM THE BACKLOG`, `SUB-GOALS`, `ACTIVITY`, `BACKLOG (1)`) at 11px / 3.48:1
- page eyebrows (`EDIT PLAN`, `TASKS`, `DEFERRED WORK`) and every explanatory subtitle at 12–13.5px / 3.21:1
- `Added Today`, `Captured Today`, `Parked Today`, `from week of Mon 31 Aug`, and the `DORMANT — no focus this week` label

Dark mode is fine: sweeping every leaf text node in dark mode returned only 2 sub-4.5:1 results, both false positives from my background-walk hitting a transparent ancestor on a filled pill. This is a light-mode-only regression, which is exactly the kind of thing that slips past when dark is the default and the design was tuned there.

Darkening the light-mode muted token to roughly `#6B6B63` clears AA everywhere without touching the dark palette.

### C. `color-scheme: light` leaks into dark mode, so native UI renders light inside the dark app

In dark mode, `getComputedStyle(document.body).colorScheme` is `"light"`, and `document.body`'s own `background-color` is the **light** `rgb(246,246,243)` — the dark ground is painted by `<html>` and by an inner `#root > div`, not by the body.

Two consequences:

- Native controls are styled for a light page inside a dark app. The visible symptom is the **browser-default blue focus ring** on the task detail's Done-condition input (noted in flow 6); the `WEEKLY FOCUS` `<select>` in the task-create modal and the scrollbars are on the same code path.
- The body carries a light background under a dark app, which is the classic setup for a white flash on first paint or during any moment the inner wrapper hasn't painted. I did not manage to catch a flash on reload, so this is latent rather than observed — but it is one stylesheet change away from being visible.

Setting `color-scheme: dark` (and the body background) from the theme token rather than hardcoding light fixes both.

### Lower-severity notes

- **"its own descendant" mislabels the goal itself** in the Move dialog (flow 4). Copy bug.
- **Move preview shows the new parent, not the new path** (flow 4). Spec says "a preview of the new path".
- **`+` drawer does not default to the last-used goal** (flow 10). Spec says it should.
- **Goal detail pages have no top-right cluster** — no theme toggle, no primary action (flow 10). Spec says every page carries it.
- **Signed-out page has no theme toggle** (flow 1). Same spec line.
- **Manifest `theme_color`/`background_color` are hardcoded light** (flow 13) → white splash/status bar for installed dark-mode users.
- **"Set a weekly focus" drops the user's intent** (flow 9) — planning opens with nothing pre-checked and no return path to the item they were pulling.
- **Create drawer re-flows vertically when the horizon changes** (flow 3), moving the title field under the cursor.
- **Horizon/pulse toggle groups lack `aria-pressed`/`role="radio"`** (flow 3) — selection is conveyed by colour only.
- **Unlabelled input** in the inline "Update the done-condition?" panel (flow 6) — no label, no placeholder.
- **An ancestor's learning renders on every descendant goal's detail page** (flow 10) — one learning appears to belong to five goals.
- **One unreproducible nav miss:** a single click on the bottom-nav `Tasks` from the Backlog page did not navigate; the identical click immediately afterwards worked. Seen once in ~120 interactions, never reproduced, nothing in the console. Recording it only so it is not lost if it resurfaces.

### Explicitly checked and found correct (no action)

- No native `alert`/`confirm`/`prompt` anywhere (instrumented and verified empty).
- No CSS `filter` anywhere in either theme — the invert-based fake dark mode is genuinely gone.
- Server-side enforcement of the cycle rule (`409 WOULD_CREATE_CYCLE`) and of the no-future-weeks rule (`422`, `maximum: 0`) — the UI guards are not the only guards.
- Idempotency-key enforcement on mutating POSTs.
- Backlog conversion removes the source item; no duplication.
- Reason fields on Move and Cancel are genuinely optional — both confirmed with an empty field.

---

## State left on the account

The run leaves this behind (nothing was deleted; no extra accounts created):

- Goals: `Be genuinely fit at 50` (Life, why: "So I can keep up with my kids") › `Run a sub-2h half marathon in 2026` (Yearly) › `Build an aerobic base this quarter` (Quarterly) › `Run 4 times a week in August` (Monthly, **active**, focus: "Get three easy runs and one long run done, no matter the pace."); plus `Sleep 7h a night in August` (Monthly, direct child of the Life goal, dormant)
- Tasks (week of Mon 31 Aug): `Tuesday easy 6k` (open)
- Backlog: `Try running with a metronome app at 180spm`, `Try a hill repeats session`, `Buy blackout curtains`
- Learnings: `Morning runs happen; evening runs get skipped.`
- Ideas: none (the one captured was attached to a goal)
- Theme: dark. Session still signed in.

## Re-verification after a11y fixes

Re-run on 2026-08-31 against the redeployed Worker, targeted at the three fixes only (the
13-flow walkthrough above was not repeated). Service worker unregistered and all caches
deleted before loading, so this is definitely the new build.

**Build confirmed new.** `assets/index-B0CU-Ol9.js` contains `#707069` (1 occurrence) and
zero occurrences of `#8a8a82`. `apps/web/src/ui.ts:37` now reads `mut: '#707069'`.

### Fix 1 — sheets dismissible and keyboard-navigable: PASS

Five sheets exercised: goal create modal, task detail sheet, `+` Add-to-Backlog drawer,
Move to Backlog confirm, Cancel task confirm.

| Sheet | Esc closes | Visible ✕ closes | Backdrop closes | Focus moves in | Trapped on Tab | Focus returns to opener |
|---|---|---|---|---|---|---|
| Goal create (`+ New goal`) | yes | yes | yes | yes (`h2 New goal`) | yes, wraps | yes (`+ New goal`) |
| Task detail | yes (see below) | yes | yes | yes (`h2 Task detail`) | yes, wraps | yes (`Tuesday easy 6k` row) |
| `+` Backlog drawer | yes | yes | yes | yes (`h2 Add to Backlog`) | yes, wraps | yes (`Add` FAB) |
| Move to Backlog confirm | yes | — | yes | yes (`h2 Move to Backlog`) | yes, wraps | yes (task row) |
| Cancel task confirm | yes | — | yes | yes (`h2 Cancel task`) | yes, wraps | yes (task row) |

Focus-order captured live with a `focusin` listener; every entry was inside the dialog and
the order wrapped back to the first control. Examples:

- Goal create: `Close → Goal title → Why? → Life → Yearly → Quarterly → Monthly → On track → At risk → Rethink → Close …`
- Backlog drawer: `View Backlog → → Close → 4 goal chips → What needs doing, someday? → Description → Link URL → Add → Add to this week instead → View Backlog → …`
- Move confirm: `Close → Reason (optional) → Move it → Close …`

**Task detail, two-step discard: works.** With `6k done at easy pace` typed into
done-condition, the first Escape kept the sheet open and rendered the inline strip
`Discard your unsaved edits?` with `Discard` / `Keep editing`, moving focus to
`Keep editing`. The second Escape discarded and closed, returning focus to the
`Tuesday easy 6k` row; the edit was not persisted. It never becomes a new trap: the strip
is rendered inside the same `[role=dialog]` (still exactly 1 dialog, 0 `alertdialog`),
`Keep editing` dismisses the strip and preserves the typed value, `Discard` closes and
restores focus, and Tab from the post-strip state re-enters the sheet's trap.
Backdrop-click with unsaved edits behaves identically to Escape (strip shown, focus on
`Keep editing`) — consistent, not a silent discard.

**Title-only / optional-reason sheets do not ask.** Verified twice:
- Goal create with `Throwaway draft title` typed → Escape closed immediately, no strip.
- Move to Backlog confirm with `not this week` typed in the optional reason → Escape closed
  immediately, no strip, task not moved.

### Fix 2 — light-mode contrast: PASS

Light mode, paper `#f6f6f3`. Every muted-text element on the page now computes to
`#707069`; a full sweep of leaf text nodes found zero elements still using `#8a8a82`.

| Element | Computed colour | Size | Ratio vs paper `#f6f6f3` | vs card `#fff` |
|---|---|---|---|---|
| Section header / eyebrow `TASKS` | `#707069` | 12px | 4.61:1 | 4.99:1 |
| Breadcrumb `BE GENUINELY FIT AT 50 › …` | `#707069` | 12.5px | 4.61:1 | 4.99:1 |
| Bottom tab labels (`Goals`, `Ideas`, `Learnings`) | `#707069` | — | 4.61:1 | 4.99:1 |
| Goal chip label `Be genuinely fit at 50 · 1` | `#4a4a44` | 12.5px | 8.24:1 | 8.92:1 |

All pass WCAG AA for normal text. Judged visually at 1518px too: the tab bar labels and the
uppercase breadcrumb read comfortably now rather than washing out.

The only sub-4.5:1 leaf text left in light mode is the *disabled* next-week chevron `›`
(`#c0c0b8` on paper, 1.69:1). Disabled controls are exempt from WCAG 1.4.3 and this is
pre-existing, not a product of the fix.

### Fix 3 — theme-aware `color-scheme`: PASS

- Dark active: `html` and `body` both compute `color-scheme: dark`, background
  `rgb(28, 28, 25)` (`#1c1c19`), `--focus-ring: oklch(0.68 0.11 125)`.
- Light active: both compute `color-scheme: light`, background `rgb(246, 246, 243)`
  (`#f6f6f3`), `--focus-ring: oklch(0.55 0.11 125)`. The token flips with the in-app
  toggle, not just with the OS setting.
- Focus ring: tabbing to the done-condition input in the task detail sheet (dark mode)
  gives `outline: oklch(0.68 0.11 125) solid 2px`, `outline-offset: 2px`,
  `:focus-visible` matching. Confirmed visually with a zoom — a green ring, no trace of
  the browser-default blue. This was walkthrough finding C and it is fixed.
- Reload in dark: no white flash. `index.html` carries an inline
  `@media (prefers-color-scheme: dark) { html { background: #1c1c19; color-scheme: dark } }`
  so first paint is already dark, and immediately after reload `html` is
  `rgb(28, 28, 25)` with `color-scheme: dark`.

  Caveat, not testable here: the source comment states plainly that the first-paint
  literals can only follow `prefers-color-scheme`, because the CSP forbids the inline
  script that would read the stored choice. This machine's OS prefers dark, so the tested
  path is the easy one. A user whose OS is light but who has chosen dark in-app would
  still get a brief light first paint before `main.tsx` repaints. Known and documented,
  not a regression.

### Console

Clean. `read_console_messages` (unfiltered, limit 100) returned nothing across a full page
load plus sheet open/close cycles with console tracking already active. No errors, no
warnings, no React key/act noise.

### Regressions and nits found

1. **Nit — focus is dropped to `<body>` when the discard strip is dismissed.** Activating
   `Keep editing` (by click or by Enter) unmounts the strip and leaves
   `document.activeElement === <body>`, outside the dialog, rather than returning focus to
   the field that was being edited. Reproduced consistently. It is not an escape from the
   trap — the next Tab re-enters the sheet at `Close` and cycles normally — but a keyboard
   user loses their place and a screen reader loses dialog context. Same class of thing the
   fix was meant to remove, one level down.

2. **Unreproduced one-off — sheet closed and edit was discarded on Enter over `Keep editing`.**
   Seen once: task detail open, `x` typed into done-condition, Escape (strip shown), Enter →
   the whole sheet closed and the edit was gone (confirmed by reopening: done-condition
   empty). Could not be reproduced on two further attempts with the same sequence, nor by
   pressing Enter in a text field while the strip was up (harmless: sheet stayed open, value
   preserved). Possibly a race between the strip mounting and the keypress arriving. Worth a
   look at the `Keep editing` handler for anything that could fall through to the close path,
   but not confirmed as a live bug.

3. **Cosmetic — the sheet's `<h2>` draws a full-width green focus box when opened from the
   keyboard.** Because focus is placed on the heading and `:focus-visible` still matches
   after a keyboard-initiated open, the `Add to Backlog` / `New goal` title gets a 2px green
   outline spanning the heading's box. Correct for announcement, slightly noisy visually;
   a `tabindex="-1"` heading with `outline: none` on the programmatic focus would keep the
   SR benefit without the box.

No other regression found. Fixes 1, 2 and 3 all pass.

## Agent access + deletion confirmation

Verified 2026-08-31 in Chrome against https://goals.rameezshuhaib.com after unregistering the
service worker and deleting both caches (`workbox-precache-v2-...`, `goal-cascade-read-models`),
so this is the new build and not a cached one.

### Feature 1 — Agent access (API token): PASS with one gap

- **Discoverable.** Lives in the Account sheet as an `AGENT ACCESS` section between "Verify this
  email address" and "Sign out". Copy is jargon-light: "One token lets an MCP client read and
  change this cascade. There is only ever one, and it is stored hashed — so it is shown once,
  when it is made."
- **Existing token.** Resting state shows `Created Mon 31 Aug · ends in t97c` — created date plus
  last-4, no secret. Confirmed via DOM dump that the plaintext appears nowhere in the document.
- **Wrong password.** Deliberately wrong password returned the specific inline message
  **"That password doesn't match."** in red under the field — not a generic validation error. PASS.
- **Correct password.** New token revealed once in a bordered panel headed "This is the only time
  the token is shown. Copy it now — if it gets away, make a new one." with MCP URL and Token rows,
  each with its own Copy button, plus a Done button.
- **MCP URL.** Value is exactly `https://goals.rameezshuhaib.com/mcp` with its own copy control.
  ⚠️ **Gap:** the MCP URL is shown *only* in the show-once reveal panel. In the resting state
  (existing token) and in the "No token yet." state it is absent from the sheet entirely. Since the
  reveal is one-shot, a user who dismisses it can never see the MCP URL again without replacing
  their token — which invalidates the credential they already deployed. The URL is not a secret and
  should be shown persistently.
- **Copy feedback.** ⚠️ **Second gap:** clicking Copy writes an announcement
  ("Token copied to the clipboard.") into an `aria-live` region, but that region is a 1×1
  absolutely-positioned visually-hidden node. The button label does not change and nothing visible
  appears — polled the DOM at 120ms intervals for ~700ms after a programmatic click and the button
  read "Copy" throughout. Screen-reader users get feedback; sighted users get none.
- **Show-once holds.** Closed the sheet and reopened it: the panel is gone, the row reads
  `Created Mon 31 Aug · ends in tUEI` (last-4 correctly tracking the new token), and a full
  `document.body.innerHTML` search for the plaintext returned false. PASS.
- **Revoke.** Two-step: an in-page strip reading "Revoke this token? Anything using it stops
  working." with `Revoke` / `Keep it`. Confirming drops the section to "No token yet." + "Create a
  token". Creation from the empty state also requires the password. PASS.

Tokens generated during this run: `...t97c` (pre-existing, replaced) → `...tUEI` (replaced) →
revoked → current. **Current valid token: `gcm_yRlZu9gUOGnRKhQATt5tljrMidEii2TjaHI0TlDLCuM`**
(MCP URL `https://goals.rameezshuhaib.com/mcp`).

### Feature 2 — Goal deletion confirmation: PASS

Setup: created `ZZ Throwaway parent` (Life) → `ZZ Throwaway leaf` (Monthly), gave the leaf a weekly
focus, two tasks (`ZZ task one`, `ZZ task two`) and one backlog item (`ZZ backlog item`).

- **Leaf confirmation, counts correct.** In-page strip (no native dialog):
  > Delete "ZZ Throwaway leaf"?
  > This removes 0 sub-goals, 2 tasks and 1 backlog item. Ideas and learnings tagged here move to
  > Unsorted. There is no undo.
  Matches exactly what was created.
- **Recursive counts correct.** Opened the same confirmation on the *parent* (cancelled without
  deleting): "This removes 1 sub-goal, 2 tasks and 1 backlog item." — descendant tasks and backlog
  are rolled up, and singular/plural is handled per-noun.
- **Cancel really cancels.** "Keep it" on the leaf, then reopened the goal detail: weekly focus,
  both tasks and the backlog item all still present. Nothing deleted.
- **Delete really deletes.** "Delete everything" removed the leaf; the Tasks tab no longer contains
  the focus card or either task; the parent's chip fell to "0 of 0 branches active".
- **Empty goal does not nag.** Deleting the now-empty parent shows a shorter strip — "This goal
  holds nothing else. There is no trash and no undo." — and the primary button reads plain `Delete`
  rather than `Delete everything`. It still asks once, which is right for an irreversible action,
  but it does not enumerate zeroes. A "Goal deleted" toast follows.
- **Tone.** Reads careful rather than alarming: lowercase prose, "Keep it" as the escape hatch
  (not "Cancel"), and it says where ideas/learnings *go* rather than only what is lost. The one
  nit is "0 sub-goals" in the leaf case — naming a zero is slightly clumsy in a strip that
  otherwise only names real losses; dropping zero-valued nouns would read better.

Cleanup: both throwaway goals deleted. Nothing pre-existing was touched (`Learn to sail` /
`MCP e2e test`, created by an earlier run, left alone).

### Console

Clean. `read_console_messages` over a fresh load plus the Account-sheet interaction returned zero
messages of any level — no errors, no warnings.

### Worst problem

The MCP URL is only rendered inside the one-shot reveal panel. Because the token is show-once, a
user who closes the sheet loses the endpoint URL permanently and the only in-app way to see it
again is to replace the token — which breaks whatever is already using it. Show the MCP URL
persistently in the resting state.
