# 06 — Web data layer, contexts and auth

What this agent built in `apps/web`, and — from §5 onward — the brief for the screens agent that
replaces `src/store.tsx`.

Sources of truth, in order: `docs/SPEC.md` → `docs/BUSINESS-RULES.md` → `packages/shared/src/` (the
contract) → `docs/work/01-foundation/build.md` (the endpoint table) → the mockup.

The recipe is `react-app/PROJECT-BLUEPRINT.md` §4. The client, the query wiring, the contexts, the auth
screens and the test harness are ported from that codebase — which is deployed and working — and adapted:
`@nestfeed/shared` → `@goal-cascade/shared`, no tenants, no push, no service-worker identity record, and
Goal Cascade's own visual identity on the auth screens.

---

## 1. What was built

```
apps/web/src/
├── api/
│   ├── errors.ts       ApiError + ApiErrorCode (§5 codes + NETWORK + BAD_RESPONSE), isTransient
│   ├── http.ts         HttpApiClient — one method per ENDPOINTS entry, every response Zod-parsed
│   └── queries.ts      read hooks, useCommand, one write hook per command endpoint
├── auth/
│   ├── client.ts       Better Auth client, AuthError, authCopy (incl. SIGNUP_NOT_ALLOWED)
│   ├── session.ts      useAuthActions — afterSignIn / signOut
│   ├── identity.ts     who this device believes is signed in (keys the persisted cache)
│   └── purge.ts        the ONE teardown path: sign-out, 401, other-account-signs-in
├── context/
│   ├── ApiContext.tsx  DI for the client — the seam tests inject through
│   ├── UIContext.tsx   screen · sheet · filters · viewed week · toast · sessionEpoch
│   └── ThemeContext.tsx real light/dark token sets (replaces the mockup's invert filter)
├── lib/
│   ├── queryClient.ts  keys, shouldRetry, createQueryClient, identityPersister
│   ├── errorCopy.ts    presentError — one line per domain code
│   ├── serverClock.ts  server/device skew from every `serverNow`
│   └── useUrlSync.ts   the no-router URL shim + auth landings
├── components/auth/    AuthScreen · ResetPasswordScreen · VerifyEmailScreen · ui.tsx
├── App.tsx             AppRoot (identity watch + sessionEpoch key) + the gate + UIToast
└── main.tsx            provider nest, persister, `import './pwa/boot'`

apps/web/tests/
├── render.tsx          renderApp / renderAppHook through the real provider stack
├── msw/                handlers.ts (every endpoint) + fixtures.ts
├── auth/               gate.test.tsx · auth.test.tsx · verify.test.tsx
└── api/                http.test.ts · queries.test.tsx · persist.test.ts
```

`tests/setup.ts` gained the MSW server the PWA agent left a `NOTE (web agent)` for
(`onUnhandledRequest: 'error'`), plus `resetDeepLinks()` and `resetServerClock()` in `afterEach`.
Nothing else outside the list above was touched.

**`npm run test`: 90 passing across 11 files.** `npm run typecheck`: the 5 pre-existing
`noUncheckedIndexedAccess` errors in `src/store.tsx` and `src/utils/tree.ts` remain — see §7.

---

## 2. The state split, and the one rule

> **React Query owns everything the server knows. Context owns everything only the browser knows.**

There is no `GoalsContext`, no `TasksContext`, and there must not be one. Caching, refetching, staleness,
error propagation and cross-screen consistency are already solved in React Query, and a context holding a
`goals` array re-solves all of them badly.

The three contexts each do one thing:

| Context | Holds | Does NOT hold |
|---|---|---|
| `ApiContext` | one `HttpApiClient`, injected | anything mutable |
| `UIContext` | screen, open sheet, filters, viewed week, toast, `sessionEpoch` | server data, **form drafts** |
| `ThemeContext` | the resolved tokens + the persisted light/dark choice | anything else |

Each exports a `useX` that throws when its provider is missing, so the mistake surfaces at the first
render rather than as a component silently rendering defaults.

**Form drafts stay local to their sheet.** The mockup kept `gmTitle`, `dtCond`, `bdLinks` and two dozen
siblings in one global object, so every keystroke re-rendered every screen. `UIContext` says *which* sheet
is open and *what it is about* (`Sheet` is a discriminated union carrying the ids); the sheet owns its own
`useState` for the fields.

---

## 3. Things worth knowing before you use this layer

**Weeks.** You send an **offset** (`0` = this week, negative = past) and get back an absolute `weekStart`
(D-1). Never derive a Monday on the client: R-auth-5 puts that in the owner's timezone, server-side.
`ui.viewedWeek` is the offset; `ui.selectWeek(n)` clamps to `≤ 0` (R-nav-3) and resets the goal filter
(R-nav-6) in one call, so neither can be half-done.

**Derived fields are the server's.** `isLeaf`, `isActive`, `dormant`, `subtreeActive`, `carrying`,
`branches`, `backlogCount`, `carryWeeks`, task visibility — all computed server-side for the week you
asked about, and never recomputed here. `src/utils/tree.ts`'s `isLeaf` / `isActive` / `subtreeActive` /
`activeLeafFor` / `defaultPeriod` / `replanPeriods` are therefore **dead** once the screens read
`GoalView`; keep only the presentation helpers (`pathOf` for the breadcrumb, `flatTree` for the picker,
`hostOf`, `trunc`, `rank` for sorting).

**Every write goes through `useCommand`.** It owns the idempotency key (one per *intent*: reused across
retries of identical variables, regenerated when they change, dropped on success and on any stored 4xx),
the error toast via `presentError`, and patch-then-invalidate. Do not call `client.*` from a component.

**Errors are copy, not exceptions.** `lib/errorCopy.ts` has a line for every domain code. Two codes are
deliberately silent (`message: null`) because the screen explains them itself — `GOAL_HAS_CHILDREN`
(the cascade-delete sheet renders the counts from `details`) and `BRANCH_NOT_ACTIVE` (the "this branch
isn't active this week" sheet). If you add a screen for a refusal, add it to `quiet` on that command.

**Offline.** `PersistQueryClientProvider` restores the last 24h of read models on a cold open, keyed on
`goal-cascade.query-cache:<userId>`. Q-15 stands: a read cache, never a mutation queue — do not build
replay-after-reconnect.

---

## 4. Auth — every flow, and the two Goal Cascade specifics

Flows: sign-up · sign-in · sign-out · email verification · forgot-password request · password reset via
`/?reset=1&token=…`. The gate is `/me`, never the URL: pending → splash, 401 → `AuthScreen`, other error →
retry, else → the app.

**Sign-up is allowlisted to one address** (R-auth-1). A refusal is `403 SIGNUP_NOT_ALLOWED` and is rendered
as a statement of what the product is, not as a fault: *"Goal Cascade is a single-person app — sign-up is
open to one address only. If that address is yours, check the spelling; otherwise sign in."* The form stays
usable and the sign-in tab stays one tap away.

**No email can ever be sent.** The Worker has no mail binding and no adapter that could acquire one, by
design (`docs/work/01-foundation/build.md` §3.8). So no screen says "check your inbox":

- **Verification** (`VerifyEmailScreen`): leads with *"Nothing in Goal Cascade is blocked by this"* —
  sign-in works unverified (`requireEmailVerification: false`) — then states that the app cannot send mail
  and that a link is written to the server's outbox. Its resend button is labelled **"Write a new link to
  the outbox"**, because that is literally what it does.
- **Forgot password**: *"No email will arrive — this app has no way to send one, on purpose. The link was
  written to the server's outbox instead, and it works for one hour."*

### Getting your own reset link

`LogEmailSender` **only stores a message when the recipient matches `E2E_EMAIL_PATTERN`**
(`*@test.goal-cascade.local`), and that pattern is constrained to non-registrable domains. A reset link for
`me@rameezshuhaib.com` is therefore written **nowhere** — not the outbox table, not the log (which records
`to` and `subject` only). The forgot-password flow, as shipped, cannot recover the owner's own password.

The recovery that works today, with no code change and no data loss, is to move the account onto a sunk
address for the length of the reset. It needs `wrangler` D1 access, which is the right bar for a password
reset:

```sh
cd apps/api
# 1. point the account at an address the sink accepts (non-registrable, so no mail can escape).
npx wrangler d1 execute goal-cascade-db --remote \
  --command "UPDATE user SET email='owner@test.goal-cascade.local' WHERE email='me@rameezshuhaib.com'"

# 2. in the app: Forgot password → owner@test.goal-cascade.local → Request a reset link.

# 3. read the link out of the outbox (newest first). It IS the landing URL: /?reset=1&token=…
npx wrangler d1 execute goal-cascade-db --remote \
  --command "SELECT body FROM email_outbox ORDER BY created_at DESC LIMIT 1"
#    …or, if INTERNAL_SECRET is set:
#    curl -H "X-Internal-Secret: $INTERNAL_SECRET" \
#      "https://<app>/internal/outbox?to=owner@test.goal-cascade.local"

# 4. open that URL, set the new password (this revokes every existing session), then put the address back.
npx wrangler d1 execute goal-cascade-db --remote \
  --command "UPDATE user SET email='me@rameezshuhaib.com' WHERE email='owner@test.goal-cascade.local'"
```

Reset tokens are stored **hashed** (`verification.storeIdentifier: 'hashed'`), so there is no shortcut of
reading a token straight out of D1 — step 2 has to actually run.

> **Flag for the orchestrator.** This is a five-step manual procedure for the single most stressful moment
> a user of this app can have. It is a consequence of a correct security decision (no mail, and the sink
> restricted to non-registrable domains), not a defect in it. If the owner wants something better, the
> smallest honest option is an authenticated `POST /api/auth/change-password` surfaced in Settings, which
> Better Auth already exposes and which needs the *current* password — it prevents the lockout rather than
> curing it. Curing it needs an ops path the API agent would have to design.

---

## 5. The migration table — every `Store` method

This is the screens agent's primary brief. `src/store.tsx` (405 lines) holds both halves of the app: the
server data and the UI state, with every mutation doing a local array edit plus a fire-and-forget
`api.persist()`. Replace the server half with the hooks below and the UI half with `UIContext`, then delete
`store.tsx`, `src/api/client.ts` and `src/data/mock.ts` (R-auth-6 / D-26: no fixture id may survive).

### 5.1 Tree helpers — all of them go

| `Store` method | Replacement | Why it changes |
|---|---|---|
| `node(id)` | `goals.find(g => g.id === id)` over `useGoals(week).data.goals` | Same thing, sourced from the server's ordering (Q-7: parents before children, then `createdAt`, then `id`). Do not re-sort. |
| `children(id)` | `goals.filter(g => g.parentId === id)`, or `useGoal(id).data.children` | The detail response already has them. |
| `isLeaf(g)` | `g.isLeaf` | **Server-derived.** Deleting the local computation is the point. |
| `isActive(g)` | `g.isActive` | Activity is "a focus row exists for this week" (D-2), which only the server can see. |
| `subtreeActive(g)` | `g.subtreeActive` | Server-derived. |
| `ancestors(g)` | `useGoal(id).data.ancestors` (root → parent) | Detail screen only; the tree screen can still walk `parentId`. |
| `rootOf(g)` | `ancestors[0] ?? goal` | — |
| `descendants(id)` | *gone* | Only used for the move-target guard; the server refuses `WOULD_CREATE_CYCLE` (R-goal-18/19). Grey the rows out from `ancestors`/`parentId` if you like, but the refusal is the mechanism. |
| `leaves()` / `activeLeaves()` | `goals.filter(g => g.isLeaf)` / `.filter(g => g.isLeaf && g.isActive)` | Server-derived flags. |
| `lifeGoals()` / `nonLife()` | `goals.filter(g => !g.parentId)` / `.filter(g => g.parentId)` | Unchanged. |
| `pathOf(g)` | keep `utils/tree.ts#pathOf`, or `ancestors.map(a => a.title)` | Presentation only. |
| `visibleIn(t, w)` | *gone* | **R-task-7/8/32 are applied by the server.** `useTasks(week)` returns exactly the tasks visible in that week; an exited task appears in none. Filtering again on the client is how the two get to disagree. |

### 5.2 Theme and toast

| `Store` method | Replacement | Behaviour change |
|---|---|---|
| `applyTheme(dark)` | `ThemeProvider` + `applyDocumentTheme` | **The `invert(1) hue-rotate(180deg)` filter is gone** (R-nav-12 / D-25). Read colours from `useTheme()` tokens instead of `colors` from `src/ui.ts`. Token names match, so it is mostly `colors.x` → `T.x`. |
| `toggleTheme()` | `useThemeChoice().toggleTheme()` | Now persists to `/me/preferences` (per-user, across sessions) and caches locally for first paint. |
| `showToast(msg)` | `useUI().showToast(msg, { tone, action })` | R-nav-13 timing kept (~2.6s; errors and actions linger). Most command toasts are now automatic — `useCommand` toasts failures via `presentError`, so only *confirmations* need an explicit call. |

### 5.3 Tasks

| `Store` method | Replacement | Behaviour that must change |
|---|---|---|
| `toggleTask(t)` (uncheck path) | `useCompleteTask()` / `useUncheckTask()` | Split in two — they are different commands with different rules. `complete` takes the **viewed week** (past weeks are completable, R-task-14/nav-5); a week before origin or in the future is `422 WEEK_OUT_OF_RANGE`, not a clamp. The `events` array is **server-rendered** (R-task-30/31) — stop constructing `{ i, t, d }` locally. |
| `saveUncheck()` | `useUncheckTask({ id, cond })` | `cond` is optional; omitted/blank/unchanged logs nothing (S-task-21-1/3). Keep the "skippable" sheet, drop the local event append and the truncation string-building (R-task-27 truncation is the server's). |
| `openTaskDetail(t)` | `ui.openSheet({ kind: 'taskDetail', taskId })` + `useTask(id)` | The sheet fetches its own detail (with `events`); lists do not carry them. Drafts (`dtTitle`, `dtCond`, `dtDesc`) become local state in the sheet. |
| `saveTaskDetail()` | `usePatchTask({ id, patch })` | Send only changed fields. The three "which fields changed" event strings are gone: the server emits `renamed` / `cond_edited` / `description_updated` itself. **Currently silently `return`s when the task is missing; now a `404 NOT_FOUND`** (indistinguishable from another owner's row, R-auth-3) with copy "That's no longer here." |
| `addTaskLink()` | `useAddTaskLink({ id, url })` | **Was a silent `return` on a blank/invalid URL; now `422 VALIDATION_FAILED`.** The shared `Url` schema requires http(s), ≤2048 chars, and caps links at `MAX_LINKS` (20). Show the message at the field. |
| `removeTaskLink(index)` | `useRemoveTaskLink({ id, linkId })` | **By link id, not array index** (D-13). The index version deletes the wrong row whenever the list has changed underneath. |
| `openTaskCreate(goalId, prefill)` | `ui.openSheet({ kind: 'taskCreate', goalId, title?, fromBacklogId?, fromIdeaId? })` | — |
| `saveNewTask()` | `useCreateTask()` — or `useConvertBacklogItem()` / `useConvertIdea()` when it came from one | **Three changes.** (a) **No client-minted `'t' + Date.now()` id** — Q-8 makes ids server-side ULIDs and the API refuses a supplied one (`.strict()`). (b) **A blank title is `422`, not a silent `return`.** (c) A backlog pull is **not** "create a task and filter the item out of the array": it is `POST /backlog/:id/convert-to-task`, one atomic operation that marks the item converted (D-19) — the mockup's version could create the task and lose the item, or duplicate it. Same for an idea (D-22: the idea is consumed **only** on success). `originWeekStart` and `source` are server-assigned. |

### 5.4 The confirm sheet

| `Store` method | Replacement | Behaviour that must change |
|---|---|---|
| `openConfirm(cf)` | `ui.openSheet({ kind: 'confirmTaskExit' \| 'confirmReplan' \| 'confirmDeleteGoal', … })` | One union member per action instead of one `ConfirmState` with optional ids. |
| `confirmAction()` → `moveTask` | `useMoveTaskToBacklog({ id, week, reason })` | **The task row is not deleted** (D-15): it keeps `status: 'movedToBacklog'` so the `Moved to Backlog` log entry and the reason have somewhere to live. The response carries **both** the exited task and the new backlog item. `fromWeekStart` is the week the task was **live** in, not "this week" (D-12). Refused on an already-exited task with `409 TASK_ALREADY_EXITED` — where the mockup `return`ed. |
| `confirmAction()` → `cancelTask` | `useCancelTask({ id, reason })` | Same: the row survives with `status: 'canceled'`. |
| `confirmAction()` → replan | `useReplanGoal({ id, period, reason })` | `replanPeriods(horizon)` moves server-side (D-3, derived from today and strictly forward); the sheet offers what the server would accept. **A Life goal is `409 LIFE_GOAL_IMMUTABLE`** (R-goal-21) rather than a `return`. |

### 5.5 Backlog

| `Store` method | Replacement | Behaviour that must change |
|---|---|---|
| `pullToWeek(item)` | `useConvertBacklogItem({ id, goalId? })` | `activeLeafFor()` is gone. **`goalId` is required when more than one active leaf sits under the item's goal** — D-18 forbids the server picking silently, so the sheet must ask. No active leaf at all → `409 BRANCH_NOT_ACTIVE`, which is the "this branch isn't active this week → [Set a weekly focus] / [Cancel]" sheet (R-backlog-8), not a toast. A second conversion → `409 ALREADY_CONVERTED`. |
| `deleteBacklogItem(id)` | `useDeleteBacklogItem({ id })` | — |
| `moveBacklogItem(id, goalId)` | `useMoveBacklogItem({ id, goalId })` | **A Life-goal target is `409 LIFE_GOAL_NO_BACKLOG`** (R-backlog-2). `capturedAt` and `fromWeekStart` are unchanged by a move (R-backlog-10). |
| `addBacklogItem(...)` | `useCreateBacklogItem({ goalId, title, description, links })` | **No `'b' + Date.now()` id.** `when: 'Today'` and `fromWeek: ''` are gone: the server sends `capturedAt` (ISO) and `fromWeekStart` (a Monday or null) — format them at render time. Blank title → `422`. |
| `openBacklogDrawer()` | `ui.openSheet({ kind: 'backlogDrawer', goalId? })` | `blGoal` ("last used goal") was seeded to the fixture id `'g3'`; **it must resolve to a real goal or to "none"** (D-10 / D-26). A brand-new account has an empty tree, so the drawer needs an empty state. |
| `saveBacklogDrawer()` | `useCreateBacklogItem()` or `useCreateTask()`, chosen by `bdToWeek` | The mockup silently parked the item in the backlog when the branch was dormant and toasted about it. Now: attempt the task, and let `BRANCH_NOT_ACTIVE` drive the same sheet as a backlog pull. Do not invent a fallback goal (D-10 — there is none). |

### 5.6 Ideas and learnings

| `Store` method | Replacement | Behaviour that must change |
|---|---|---|
| `saveIdea()` | `useCreateIdea({ text, goalId })` | No `'k' + Date.now()`. **The tag must be a Life goal or `null`** — anything else is `409 NOT_A_LIFE_GOAL` (R-idea-2). Blank text → `422`. |
| `ideaToBacklog(idea, goalId)` | `useAttachIdea({ id, goalId })` | **One atomic command**, not "create an item, then delete the idea". The mockup could create the item and leave the idea (or the reverse). The response carries the new item and the consumed `ideaId`. |
| *(idea → task)* | `useConvertIdea({ id, goalId, title?, cond? })` | D-22 — the idea is consumed **only** on successful creation. The mockup deleted it before the modal was saved and lost it on cancel. |
| `saveLearning()` | `useCreateLearning({ text, goalId, applied })` | No client id. Life-goal-or-null tag, same as ideas (R-learning-2). |
| *(no equivalent)* | `usePatchLearning({ id, patch: { applied } })` | R-learning-4 / D-23 — the "changed the plan" badge has to be earnable by an explicit action. The mockup had no way to set it. |
| *(no equivalent)* | `useAttachLearning({ id, goalId })`, `useDeleteLearning({ id })`, `useDeleteIdea({ id })` | R-learning-3 / R-idea-6 — re-tag (or `null` for Unsorted) and discard. |

### 5.7 Goals

| `Store` method | Replacement | Behaviour that must change |
|---|---|---|
| `openGoalModal({editId, parentId})` | `ui.openSheet({ kind: 'goalForm', editId, parentId })` | `gmMinRank` / `defaultPeriod` stay as *form affordances* (offer the right horizons), but they are no longer the guard — the server is. |
| `saveGoal()` (create) | `useCreateGoal({ title, why, horizon, parentId, period?, pulse })` | **No `'g' + Date.now()`.** The two silent `return`s (blank title; non-Life with no parent) become `422 VALIDATION_FAILED`. A parent whose horizon is not strictly longer is `409 HORIZON_CONFLICT`; creating under a leaf that still carries open tasks is `409 GOAL_HAS_OPEN_TASKS` — "move or close them first" (R-goal-28 / D-8), not a silent re-home. `period` defaults from horizon and today when omitted (D-3). |
| `saveGoal()` (edit) | `usePatchGoal({ id, patch })` | **Edit changes `title`, `why`, `period`, `pulse` only** (R-goal-14). `horizon` and `parentId` are refused by `.strict()` — re-parenting is `move`, re-scheduling is `replan`. |
| `moveGoal()` | `useMoveGoal({ id, parentId })` | The `return` on a missing target becomes `422`. Cycles are `409 WOULD_CREATE_CYCLE` and the **descendant reason wins over the horizon reason** (R-goal-19), so render `err.code` rather than guessing. A Life goal cannot move at all. |
| *(no equivalent)* | `useDeleteGoal({ id, cascade })` | Q-5 — without `cascade`, a goal with children is refused with `409 GOAL_HAS_CHILDREN` carrying the counts in `details`; that refusal **is** the confirmation sheet's data ("N sub-goals, M tasks, K backlog items"). With `cascade: true` the response reports what was removed and what was un-tagged. No soft delete, no trash. |

### 5.8 Weekly planning

| `Store` method | Replacement | Behaviour that must change |
|---|---|---|
| `planChecked(g)` / `planDraft(g)` | local state in `PlanScreen`, seeded from `usePlan(0)` + `g.isActive` / `g.focus` | Drafts are the screen's, not global. |
| `savePlan()` | `useSavePlan({ weekStart, entries })` | **Send the absolute `weekStart`** from `usePlan(0).data.week.weekStart`, not "now": R-plan-2 refuses any other week with `409 WEEK_NOT_CURRENT`, and sending it explicitly is what makes a save that crossed a Monday boundary **fail loudly** instead of writing into the wrong week (Q-3 — refused wholesale, never partly applied). A blank sentence, or a leaf omitted from `entries`, **clears** that leaf's focus (R-plan-5/7). A non-leaf or Life goal in `entries` is `409 NOT_A_LEAF`. After a save, `useSavePlan` already invalidates tasks + plan + goals, so drop the manual `view: 'home', viewWeek: 0` state juggling and just `ui.setScreen('tasks')`. |

### 5.9 Bootstrap

| `Store` | Replacement |
|---|---|
| `AppProvider`'s `useEffect` → `api.fetchAll()` | `useBootstrap(week)` — one request, everything for that week — or the individual read hooks. There is no global "loading" flag: each hook has its own `isPending`, and the gate in `App.tsx` has already guaranteed a session by the time any screen renders. |

### 5.10 Screen names

`UIContext`'s `Screen` uses the deep-link vocabulary, not the mockup's `View`:

| mockup `View` | `Screen` |
|---|---|
| `home` | `tasks` |
| `goals` | `goals` |
| `line` | `goal` (+ `ui.goalId`; use `ui.openGoal(id)`) |
| `backlog` | `backlog` |
| `ideas` | `ideas` |
| `learn` | `learnings` |
| `plan` | `plan` |

`useUrlSync` mirrors these as `?tab=…` (and `?tab=goals&goal=<id>`), which is exactly what
`pwa/deepLink.ts` parses — so a copied address bar is a working deep link.

---

## 6. Testing

`tests/render.tsx` gives you `renderApp` / `renderAppHook`: the real provider stack, a no-retry
`QueryClient`, a `userEvent`, and MSW on the socket. Write tests as user behaviour — find the control,
click it, assert what appears. Add handlers to `tests/msw/handlers.ts` and shapes to `fixtures.ts`;
`onUnhandledRequest: 'error'` means an unstubbed call fails the test rather than hanging it.

The client is exercised through the real Zod schemas, so a fixture that drifts from the contract fails
loudly instead of passing against a hand-written type.

---

## 7. Left for the screens agent

- **The 5 `noUncheckedIndexedAccess` errors** in `src/store.tsx` (×4) and `src/utils/tree.ts` (×1) are still
  there. They predate this agent and live in files it does not own; deleting `store.tsx` clears four of
  them, and `utils/tree.ts:37` (`descendants`) needs a `!` or a guard. **`npm run typecheck` does not pass
  until that is done.**
- **`App.tsx` still renders the mockup** as the signed-in tree (`MockupShell`), so the app runs end to end
  today. It is marked `TEMPORARY`; replace it with the real shell and delete `store.tsx`,
  `src/api/client.ts` and `src/data/mock.ts`.
- **Two toasts are mounted** while the migration is in flight: `UIToast` (in `App.tsx`, driven by
  `UIContext`) and the mockup's `components/Toast.tsx` (driven by `useStore`). Delete the second one with
  the store and move `UIToast` into `components/`.
- **The screens still import `colors` from `src/ui.ts`** — a light-only palette. Switch them to
  `useTheme()` tokens; the names match one-for-one, and `LIGHT` **is** `colors`, so a mechanical swap is
  safe. `tests/api/persist.test.ts` asserts that the tokens and `src/pwa/manifest.ts` stay in step, and
  `tests/pwa/manifest.test.ts` asserts the manifest and `index.html` do — keep both passing.
- **A sign-out control** exists in the hook (`useAuthActions().signOut`) but nowhere in the UI. R-nav-11
  gives every page a top-right cluster; the natural home is there or on a settings surface.
- **`VerifyEmailScreen` is written and tested but not routed.** Sign-in works unverified, so nothing forces
  it; wire it to a deliberate entry point (a settings row) rather than to a gate condition.
