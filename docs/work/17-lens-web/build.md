# 17 — Lens web: the router, the five lenses, and the task page

The client half of Amendment 2. `apps/web/**` only — `apps/api/**` and `packages/shared/**` are merged,
green and untouched (505 / 43, verified after every step of this build).

**Green:** `apps/web` **257 tests / 24 files** (from 227 / 22, of which **93 were failing** when this
started), `typecheck` clean across all three workspaces, `build` emits `dist/sw.js` with its 13-entry
precache manifest.

The starting 93 failures were the worklist, not an obstacle: the API contract had moved and the client had
not. Nothing was deleted to make a number go green — where an assertion encoded a rule the amendment
retired, it was **inverted in place** with a verdict naming the `R-*` id (§6).

---

## 1. The router, and why this one

**`react-router` v7.18**, `BrowserRouter`, declarative `<Routes>`. One new dependency, which the brief
expected; nothing else was added.

**Why a router at all.** The app had none: `screen` and the open overlay were `UIContext` state and
`lib/useUrlSync.ts` mirrored the screen into the address bar one way afterwards. That was a defensible
call while every screen was a tab — R-nav-2 recorded it — and CR-5's task page is precisely the case it
reserved. A task is a genuinely linkable thing and a sheet cannot be linked to.

**Why react-router and not the smaller options.** Three properties decided it, in this order:

1. **`MemoryRouter` and a real history stack in tests.** Every routing assertion in
   `tests/routing/routes.test.tsx` opens the app *at a URL* and presses `history.back()`, which is the same
   popstate path Android's back button takes. A hand-rolled `useState(location.pathname)` + `popstate`
   shim would have been ~40 lines and would have been tested against itself.
2. **Optional path segments** (`/month` as well as `/month/2026-08`), which R-lens-14 needs: the client
   must never derive the current period, so "the month containing today" has to be expressible as *the
   absence of a segment*.
3. It is the option a later maintainer will already know. `wouter` is smaller and would have worked; the
   size difference is ~12 kB gzipped against a 148 kB bundle, which is not the axis that matters here.

**What is addressable, and what is deliberately not** (R-lens-14, R-nav-24):

| Route | Screen |
|---|---|
| `/` and any unknown path | redirect to the remembered lens (cold start → `/week`, R-nav-28) |
| `/life` | Life lens |
| `/year/:period?` · `/quarter/:period?` · `/month/:period?` · `/week/:period?` | the four period lenses |
| `/goal/:goalId` | goal detail |
| `/task/:taskId` | **the task page** (CR-5) |
| `/backlog` · `/learnings` | unchanged |

**Overlays are not routes.** The `+` drawer, the Zoom sheet, every confirm sheet and every create form
stay `UIContext` state: each is a two-second interaction whose URL nobody wants, and reloading must not
reopen one (asserted, S-nav-24-2).

Three details worth recording:

- **`/week/:monday` carries the absolute Monday**, never an offset (D-1). A relative offset in a URL means
  something different on Tuesday.
- **The URL is rewritten to the canonical key once the read lands**, with `replace`. `/month` becomes
  `/month/2026-08` from the server's own `PeriodView`, so a copied address is absolute and the client
  still never decides which period is current.
- **`BrowserRouter` sits above the auth gate** (`main.tsx`). That is what makes a deep link opened while
  signed out survive the sign-in round trip *for nothing*: the gate renders `AuthScreen` in place of the
  routes and the location never changes. `pwa/deepLink.ts` — the `sessionStorage` parking lot that existed
  only because there was no router — is deleted, and the Worker's existing `index.html` fallback means an
  installed PWA deep-links by doing nothing at all.

---

## 2. The two silent breaks

Both were flagged by the API agent, both compile clean, and both now have an assertion that fails if they
regress.

### 2.1 `TaskView.carryWeeks` is signed (R-task-43)

`weeksBetween(origin, min(viewed, current))` goes **negative** for work that is not due yet. The type
still parses; only the meaning moved.

**Every site that formats or compares it was audited.** There are exactly three, and all three were
already written as `>= 1` / `>= 2` rather than `!== 0` or `Math.abs`, so the code was accidentally correct
and would have stayed correct silently — which is the worst possible state for a break like this. What
this build added is the thing that holds it: `src/components/TaskRow.tsx` and `src/screens/TaskPage.tsx`
carry the rule in a doc block naming what a magnitude-shaped bug would look like, and

- `tests/screens/weeklyLens.test.tsx` — *"a negative age renders NOTHING — no chip, no label, no `-1
  weeks`"*, on a future week whose whole screen is badged `Future week — planning ahead`;
- the same file — an already-late task (origin `−3`) projected into a future week **keeps** its chip,
  because it is late today and still open then;
- `tests/screens/taskPage.test.tsx` — the same negative case on the page.

**Nothing in this client sums `carryWeeks` across tasks**, and nothing re-parses it as `nonnegative`. The
one number that aggregates carry is `GoalView.carrying`, which is the server's.

**The product rule this protects:** the red chip is the only escalation in the product and it must never
fire on work that is not late (R-lens-11, S-lens-11-2). Firing it at a plan would destroy the one signal
that means anything.

### 2.2 `WeekOffset` accepts positives (R-goal-36, R-rm-3)

`UIContext.selectWeek`'s `Math.min(0, offset)` would have compiled, rendered, and silently pinned every
forward navigation to the current week.

**It is deleted, not relaxed.** The whole `viewedWeek` / `selectWeek` concept went with it: the week is
`/week/:monday` now, an absolute Monday in the URL, so there is no client-side week variable left for a
clamp to go stale on. `TasksScreen`'s `disabled={w === 0}` forward chevron and its `Math.min(w + 1, 0)`
went with the screen.

**Audited for others.** `grep` over `src/` for `Math.min(0`, `Math.max(0`, `min(0,` finds one hit: the
delete sheet's `Math.max(0, removed.goals - 1)`, which is a count floor and unrelated. `WEEK_HISTORY_WEEKS`
and `PLAN_AHEAD_WEEKS` appear nowhere. The one surviving forward bound is `CompleteTaskRequest.week`'s own
`.max(0)`, which is the server's and is correct (R-task-44).

Assertions: `tests/screens/lenses.test.tsx` steps the forward chevron and lands on a later period with the
control still enabled; `tests/utils/periodKeys.test.ts` steps twenty months forward with no clamp;
`tests/api/http.test.ts` sends `?week=6` unchanged.

---

## 3. What was built

### The five lenses (`src/lens/`)

One shell, five bodies. `LensScreen` renders the cluster row, the lens row and — conditionally — the
off-now row, then a flat list grouped by owning Life goal.

- **The chrome budget is enforced, not aspirational** (R-nav-27). Two unconditional rows; the off-now row
  renders only off-now (R-lens-21) and group headers only when there is more than one non-empty group
  (R-lens-19). `tests/screens/lenses.test.tsx` asserts that a current period draws nothing else.
- **No filter pills anywhere** (R-rm-4, R-lens-15) — deleted, with `taskGoalFilter` and
  `backlogGoalFilter` off `UIContext`.
- **Groups**: the whole header row is the collapse toggle, session-scoped and per-lens; a zero count is
  never rendered, visibly or in the accessible name; an empty group is not rendered at all; with exactly
  one group there is no header; `UNSORTED` is last, uncounted, and never collapsed by default.
- **The Life lens has no groups** — each Life goal is a group of one, so the count and the backlog line
  move onto the card, and R-goal-24's carrying line renders there (C-18).
- **The Monthly card carries R-goal-47's planned-ness line**, dormancy's one surface, in all four states.
  No bar, no percentage, no colour, not a link, and no `+ Weekly goal` on the card (Q-20 amended).

### The Zoom sheet and the period control

`LensRow` is `‹ [title ▾] ›`. The title *is* the altitude control (R-lens-17) — there is no persistent
switcher and no period picker, which is what makes D-24 unrepresentable rather than guarded against.

- The Zoom sheet is the existing `Sheet`, so it inherits R-nav-15's whole contract unchanged; focus
  returns to the lens title, whose accessible name is the lens-change announcement.
- Counts are one read (`GET /goals/zoom`), never five lens reads. Zero counts are omitted.
- **The anchor (R-lens-18) is derived, not stored.** `isCurrent ? ownerToday : firstDayOf(period)` gives
  exactly R-lens-18's rule with nothing to keep in step, and zoom is lossless because the derived anchor
  of the destination is the same date. Only **Life**, which has no period, holds the last anchor in
  context — which is what makes "Life is not a reset" true.
- Both chevrons are disabled (not hidden) on Life; the forward one carries R-lens-26's dot.

### The Weekly lens, and the carried band

It absorbed the Tasks screen and the plan screen whole: completing, unchecking, the three exits, the carry
labels, the backlog pull, `+ Task`, `+ Weekly goal`.

**The carried band is built** (R-lens-12, and RECONCILIATION §1.4's largest correction to the UX plan):
below the week's own goals, one collapsible band headed `Carried`, oldest `periodKey` first (the server's
order — nothing re-sorts), each goal labelled `from week of 24 Aug`, each showing only its tasks visible
in the viewed week, and **no `+ Task` and no `Pull from backlog` on any of them** — adding new work to a
past week's goal is back-dating. A week whose plan is empty while work still carries says so rather than
rendering "nothing happened" over a band full of open tasks (§1.4's §7.2 item).

`Repeat last week` sits at the **group foot** beside `+ Weekly goal`, per Life line (R-goal-46, C-25).

### The task page (`/task/:taskId`)

A full screen, never a sheet. `TaskDetailSheet` is deleted, not moved (S-rm-5-1).

- The **checkbox** is on the page (R-task-50) and completing there returns to the lens with `Done`. It is
  exit 1 given a second home; there are still exactly three exits.
- **Three ways back, all equivalent**: the `‹ Week of Mon 31 Aug` control that *names where you came
  from*, browser/Android back, and `Escape`. Opened cold by URL it falls back to the Weekly lens at the
  task's own `originWeek` — never the current week, where the task would not be visible.
- The **context line** is `<Life goal> · <weekly goal>`, both tappable, from `GET /goals/:id`'s `goal` +
  `ancestors` in one request. This is where the ancestry a task lost by leaving the tree comes back.
- Leaving with unsaved edits raises the **same discard strip** the sheets use, with the same "ask once,
  then out" and the same held-Escape guard.
- It carries the top-right cluster, which goal detail used to omit (R-nav-25).

### Creation

- The create sheet's heading names the horizon (no horizon picker) and the **period is a read-only chip
  with its reason beside it** — not the free-text field that let you type `Q9 3026`, which under R-goal-33
  would put the goal in no lens at all. The wire carries `periodKey`; there is no `period` field.
- The parent picker lists only legal parents in the **enclosing** period (`useParentOptions`, up to four
  cached lens reads), narrowed to one line when opened from a group foot. Exactly one is preselected.
- The empty state closes the loop in one tap: `Start with a Life goal →` navigates to `/life` **and**
  opens `New Life goal`.
- **`+ Task` from a Monthly card infers the weekly goal** (R-task-48/49): one candidate is used silently,
  several show a picker with the first preselected, none creates one in the same transaction with the
  monthly goal's title — **stated before it happens** (`This starts a weekly goal "…" …`) and **named
  after** (the toast names the week; the live region names the goal). On save the app moves to the Weekly
  lens at that week, because staying put would read as a lost write.
- The target week is `weekForMonth` — R-lens-9's clamp, shared by zoom, this create and R-goal-47's scope,
  so the three cannot disagree. Both of its inputs are the server's.

### Accessibility

- Every control is a real `<button>`; the checkbox precedes its title on a row; sheets keep `Sheet`'s
  trap, `Escape`, backdrop and focus-return contract, and the newest sheet inherits it rather than
  reinventing half of it (asserted).
- **Zero new colour tokens.** The group header, the counts, the planned-ness line, the off-now badge and
  the carried label are all `T.mut`; nothing new lands on `faint`, which fails AA in both themes.
  `tests/screens/contrast.test.ts` is untouched and green.
- One `aria-live="polite"` region per lens, carrying only what focus will not say — including the carried
  count. Group headers carry `aria-expanded` and spell the count's scope out (`…, 3 open tasks this
  week.`). The task page moves focus to its `<h1>` on arrival.
- **The one gesture has a keyboard equal** (R-lens-25): a horizontal swipe steps the period, suppressed on
  Life and inside `[data-h-scroll]`; `←`/`→` step and `Shift+↑`/`↓` zoom, ignored while a field has focus.
  Every one has a visible control one `Tab` away, and all of it is documented in the Account sheet.

---

## 4. Deleted

| Deleted | Rule |
|---|---|
| `screens/TasksScreen.tsx` (with `Section` and `WeekSwitcher`) | R-rm-5 |
| `screens/PlanScreen.tsx` | R-rm-3, R-rm-5 |
| `screens/GoalsScreen.tsx` — the tree, its recursive `Rows`, per-node collapse, the `⋯` row menus | R-lens-1, R-rm-5 |
| `TaskDetailSheet` (task detail is a page) and `InactiveBranchSheet` (the dead end has no state left) | R-task-45, R-task-49, R-rm-5 |
| the goal-filter pills, `taskGoalFilter`, `backlogGoalFilter`, the week-change filter reset | R-rm-4, R-lens-15 |
| `lib/useUrlSync.ts` and `pwa/deepLink.ts` (+ its test) — both existed only because there was no router | R-nav-24 |
| `usePlan`, `useSavePlan`, `client.plan()`, `client.savePlan()`, `keys.plan`/`planAll`, `/api/plan` from the SW prefixes, the `'plan'` refresh target | R-rm-2, R-rm-3 |
| `utils/tree.ts`'s `childrenOf`, `ancestorsOf`, `rootOf`, `rootIdOfGoalId`, `descendantIds`, `pathOf`, `flatTree`, `activeLeavesUnder`, `leaves` | R-lens-16, R-goal-37 |
| `utils/periods.ts`'s `defaultPeriod` | R-goal-33 |
| `UIContext`'s `screen`, `goalId`, `viewedWeek`, `selectWeek`, `menuGoalId` | R-nav-24, R-rm-3 |
| the `Tasks` tab — tabs are now `Goals · + · Learnings` | R-nav-23 |

Nothing is "kept for compatibility" or left unused. An audit grep over `src/` for `isLeaf`,
`subtreeActive`, `dormant`, `DORMANT`, `weeklyFocus`, `WEEK_HISTORY_WEEKS`, `PLAN_AHEAD_WEEKS`,
`BRANCH_NOT_ACTIVE`, `NOT_A_LEAF`, `GOAL_HAS_OPEN_TASKS`, `WEEK_NOT_CURRENT`, `TasksScreen`, `PlanScreen`
and `GoalsScreen` returns **comments only** — each one a note saying what was removed and why.

---

## 5. Tests retired, with verdicts

Every one is **inverted rather than deleted**, so the retired rule cannot come back unnoticed.

| Retired assertion | Verdict |
|---|---|
| `S-goal-10-1` — *a dormant leaf states its dormancy and where to change it* | **R-goal-38 / R-rm-2.** `weekly_focus` is deleted, so "dormant" has no referent on a goal and `GoalView.dormant` left the wire. Dormancy has exactly one surface and it is **not styling**. Inverted: `goalDetail.test.tsx` asserts nothing is labelled `DORMANT` anywhere, and that R-goal-47's line is there instead |
| `S-goal-10-1` (tree row), `R-goal-26 / D-16` — the `N of M branches active` chip | **R-goal-26, retired outright; R-goal-38.** It counted active leaves and `GoalView.branches` left the wire. R-lens-4's open-task count on the group header is the surviving number |
| `S-goal-6-1` — *a Monthly goal offers no `+ Sub-goal`* | **R-goal-31.** The terminal horizon moved: Monthly accepts Weekly children now, and the detail page offers `+ Weekly goal` (asserted). Weekly is the horizon that can never have sub-goals |
| `S-goal-18-1 / 18-2 / 19-1` — the Move sheet's two disabled reasons | **R-goal-19 is unreachable from this client, not repealed.** A parent must be strictly longer-horizon and every descendant is strictly shorter, so no descendant and no horizon conflict can appear in a picker built from legal targets. The server's `WOULD_CREATE_CYCLE` / `HORIZON_CONFLICT` refusals are still rendered from the code. **Flagged in §7** |
| `S-nav-3-1` — *the future is not reachable by chevron or picker* | **R-lens-7 / R-rm-3.** Any future period is reachable and writable and the forward chevron is never disabled. Inverted: `lenses.test.tsx` steps forward and lands there |
| `S-nav-4-1 / D-24` — the picker and the chevrons reach the same 8 weeks | **R-lens-7, R-lens-17.** There is no picker: one control per dimension makes D-24 unrepresentable rather than guarded. `WEEK_HISTORY_WEEKS` is gone from the contract |
| `S-nav-6-1` — *changing the week resets the goal filter to All* | **R-rm-4 / R-nav-6.** There is no filter to reset. Inverted: `lenses.test.tsx` asserts no `All` chip exists in any lens |
| `S-nav-8-1` — *an active leaf with no tasks still gets a section and its focus sentence* | **R-rm-2 / R-lens-12.** The focus sentence names an entity CR-4 deleted; a Weekly goal's own title is the sentence now. The empty-card copy is `Nothing on this yet.` |
| `S-nav-9-1` — the week-0 empty state offers `Plan this week` | **R-rm-3 / R-lens-6.** There is no plan screen. The headline is kept **verbatim** (R-nav-9) and only the body and the CTA changed, to `+ Weekly goal` |
| `S-task-9-1` — *a dormant leaf carrying an open task still shows it* | **R-lens-12.** The behaviour survives and moved: it is the carried band, asserted in full (band position, `from week of …`, oldest-first order, no `+ Task`) |
| `S-task-4-1` — *with nothing active there is no target, and a route to planning* | **R-task-48 / R-task-49.** The route to planning does not exist and neither does the dead end: the sheet creates the weekly goal inline. Inverted in `creation.test.tsx` and `backlog.test.tsx` |
| `S-backlog-8-1 / 8-2 / 8-3` — the `This branch isn't active this week` sheet | **R-backlog-26 / R-task-49.** `BRANCH_NOT_ACTIVE` is deleted; `NO_WEEKLY_GOAL` is answered with the inline create. Inverted: the sheet stays open and the item is untouched |
| `S-backlog-15-1 / 15-2` — the drawer's *"branch isn't active"* copy | **R-backlog-27.** Now `No weekly goal this week — parked in Backlog`, asserted with the one-entity guarantee (D-21) intact |
| `S-plan-*` (the whole file, 7 tests) | **R-rm-2 / R-rm-3.** The entity, the screen and both endpoints are deleted. The two surviving fragments are asserted where they moved: the pull list on a Weekly goal's page (R-backlog-28) and the staleness line on a Weekly goal (R-goal-43) |
| `/api/plan` in the service worker's cacheable prefixes | **R-rm-3.** Inverted to `toBe(false)`: a cache prefix for a route that does not exist is one refactor from being a route that does |
| `NOT_A_LEAF` in `shouldRetry` / `isTransient` | **R-goal-39.** Replaced by `NOT_A_WEEKLY_GOAL`, which is just as unretryable — retrying cannot make a Monthly goal a Weekly one |
| `client.tasks({ goalId })` | **R-rm-4.** `TasksQuery` has no `goalId`. Replaced by an assertion that a lens read sends `lens` and `period` and **no** filter of any kind |
| `S-goal-13-1` — the create form's `Target period` pre-fill | **R-goal-33 / §6.7.** The field is gone: a goal is created into the period you are looking at, shown as a read-only chip. `defaultPeriod` is deleted |
| `R-goal-23 / D-3` — re-plan chips as `Period[]` strings | **R-goal-40.** They are `PeriodView[]` now: the **label** is shown and the **`periodKey`** is written. Asserted on the wire |

---

## 6. Where the client is now thinner than the spec, and why

Three things the UX plan and the ruleset ask for **cannot be rendered from the current wire**. All three
are the same shape: an id the client holds with no title to go with it, and no batch read to resolve one.
None is a judgement call and none should be closed by adding reads from the client.

1. **R-lens-23's parent line** (`under Run a sub-2h half marathon in 2026`) — a lens item carries
   `parentId` but no parent title or period label. Resolving it would be one `GET /goals/:id` per card,
   and R-lens-16/S-lens-16-2 forbid the client holding or walking the interior tree. *The fix is a field
   on `LensResponse.items` — a `parent: { id, title, period } | null`, suppressed server-side when it is
   the group's own Life goal, which is where the suppression rule belongs anyway.* The card component is
   written so the line drops straight in.
2. **R-lens-24's third empty state** (*"Nothing quarterly yet"* — a lens empty at **every** period) — no
   read model says whether a horizon has ever held a goal. `hasForwardContent` only looks forward. Saying
   "nothing quarterly yet" to someone with last year's quarterly goals would be a lie, so the
   period-level states ship and the horizon-level one does not. *The fix is one boolean on
   `LensResponse`.*
3. **R-backlog-13's grouping** on the Backlog page — a `BacklogItemView` carries `goalId` and no title.
   The page resolves what it can from the three current-period lens reads plus the Life lens and puts the
   rest under `Elsewhere` (D-27's position: surface it, never drop it). *The fix is an owning-goal label
   on the item view.*

And one deliberate narrowing, recorded rather than hidden: **R-goal-19's two disabled Move reasons** are
not rendered, because under the new horizon rules no invalid target can appear in a picker built from
legal ones (§5). The refusals still are.

---

## 7. What remains

- The three wire gaps in §6, each of which is a field, not a feature.
- **No desktop layout.** The walkthrough's first criticism — *"a phone app wearing a desktop window"* — is
  untouched here, as §10 of the UX plan intended: mixing it into a navigation rewrite would make both
  harder to judge.
- **Manual backlog ordering** (R-backlog-17 … R-backlog-24) is still halted work; the API deliberately
  ships no `reorder` endpoint, so nothing half-exists on this side either.
- `dist/assets/index-*.js` is 487 kB raw / 148 kB gzipped, up ~12 kB gzipped for the router. Worth a look
  if it ever matters; it is not close to mattering.
