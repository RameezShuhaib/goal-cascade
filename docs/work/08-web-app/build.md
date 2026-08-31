# 08 — The screens, on the real API

What this agent did in `apps/web/src` and `apps/web/tests`: replaced the mockup store with the query layer
built in `06-web-data`, deleted the mockup's data sources, and gave every silent `return` a screen.

Sources of truth, in order: `docs/SPEC.md` → `docs/BUSINESS-RULES.md` → `packages/shared/src/` →
`docs/work/01-foundation/build.md` → `docs/work/06-web-data/build.md` §5 (the method-by-method migration
table, which was this agent's primary brief).

**`npm run typecheck`: clean** (the 5 pre-existing `noUncheckedIndexedAccess` errors are gone — four with
`store.tsx`, and `utils/tree.ts` was rewritten). **`npm run test`: 168 passing across 18 files**, up from 90
across 11. `npm run build` — see §7: the app bundle builds; the service-worker step fails for a reason that
predates this work and lives in files this agent may not touch.

---

## 1. What is gone

| Deleted | Lines | Why |
|---|---|---|
| `src/store.tsx` | 405 | Held server data AND UI state in one class; every mutation edited a local array and fired `api.persist()` into a stub. Its two halves are now React Query and `UIContext`. |
| `src/api/client.ts` | 54 | The stub. `persist()` logged to the console and its own comment said "TODO: add error handling/rollback". |
| `src/data/mock.ts` | 99 | The fixture tree — `g1`…`g15`, `t1`…`t7`, `b1`…`b5`. R-auth-6 / D-26: no fixture id may survive into the real client. |
| `src/types.ts` | 73 | The mockup's entity types, with relative week offsets (D-1), `Goal.focus: string` (D-2), and display-string dates (`when`, `fromWeek`, `doneLabel` — D-17). `@goal-cascade/shared`'s views replace all of them. |
| `components/Toast.tsx`'s store-driven toast | — | Two toasts were mounted at once. `UIToast` moved here from `App.tsx` and is now the only one. |
| `utils/tree.ts`: `isLeaf`, `isActive`, `subtreeActive`, `activeLeafFor`, `defaultPeriod`, `replanPeriods` | — | Server-derived, or (the two period functions) frozen 2026 literals — D-3. |
| `utils/dates.ts`: `mondayOf`, `wm(offset)`, `dstr`, `todayStr` | — | Every one derived a Monday from the DEVICE clock. R-auth-5 puts that in the owner's timezone, server-side. |
| `App.tsx`'s `MockupShell` | — | Replaced by `src/AppShell.tsx`. |

Nothing outside `apps/web/src` (minus `pwa/**`, `sw*`, `api/http.ts`, `api/errors.ts`, `auth/**`,
`context/**`, `lib/**`, `components/auth/**`) and `apps/web/tests` (minus `tests/pwa/**`) was touched.
`packages/shared` and `apps/api` were read only.

## 2. What replaced it

```
src/
├── AppShell.tsx          the signed-in tree: screen switch + TabBar + Sheets
├── skin.ts               useSkin() — the resolved token set, one line per screen
├── ui.ts                 `colors` (the LIGHT palette, still the manifest's source) + `styles(T)`
├── utils/
│   ├── tree.ts           presentation only: pathOf, flatTree, ancestorsOf, activeLeavesUnder, hostOf
│   ├── dates.ts          formats ABSOLUTE weekStarts and instants; no Monday is ever derived
│   └── periods.ts        defaultPeriod / replanPeriods from (horizon, owner-local today)
├── components/
│   ├── Sheets.tsx        one switch over UIContext's `Sheet` union
│   ├── Toast.tsx         UIToast — the one toast
│   ├── states.tsx        Loading · Empty · LoadError · FieldError · commandError
│   ├── BacklogItemCard   one row, the same three actions on every screen (D-20)
│   ├── TaskRow · TaskSheets · BacklogSheets · GoalModals · TabBar · TopActions · Sheet
└── screens/              Tasks · Goals · GoalDetail · Backlog · Capture (Ideas+Learnings) · Plan
```

**The state split holds.** No screen holds server data in `useState`. `UIContext` holds screen, sheet,
filters, viewed week, toast, collapse and menu state; React Query holds everything else. The only local
state anywhere is form drafts (inside the sheet that owns them, per §2 of the 06 doc), three list
selections (`selected` item id), the plan screen's check/draft maps (R-plan-12: discarded on leave), and
`TopActions`' account panel.

**Every screen now themes.** `colors` became `styles(T)`, resolved from `useTheme()` through `useSkin()`.
`colors` itself stays exported because `ThemeContext.LIGHT` **is** it and `pwa/manifest.ts` reads it — the
pairing `tests/api/persist.test.ts` asserts. The `invert(1) hue-rotate(180deg)` filter is gone; a test now
asserts `documentElement.style.filter === ''` after a toggle, so it cannot come back.

## 3. Where the UI now handles a refusal the mockup handled silently

This is the list the brief asked for. Every row was a `return`, a fabricated success, or nothing at all.

| Refusal | Where it surfaces now | Was |
|---|---|---|
| `HORIZON_CONFLICT` (create) | inline at the goal form, under the fields | `saveGoal` had no rank check; the disabled chips were the only guard (D-5) |
| `HORIZON_CONFLICT` (move) | the move sheet's disabled row reason, **and** an inline message on a refused submit | `moveGoal` wrote `parentId` with no check at all |
| `WOULD_CREATE_CYCLE` | same; the descendant reason is checked FIRST (R-goal-19), and the goal itself is shown disabled rather than filtered out (D-7) | the goal vanished from its own list |
| `GOAL_HAS_OPEN_TASKS` | inline at the goal form — "move or close them first" | no representation; D-8's tasks silently disappeared from every week |
| `GOAL_HAS_CHILDREN` | **is** the delete sheet's data: the counts come from `details`, and only then is `?cascade=true` offered | no delete action existed (Q-5) |
| `LIFE_GOAL_IMMUTABLE` | the re-plan sheet refuses to open a form for a Life goal and says why | `confirmAction` just `return`ed |
| `NOT_A_LEAF` | toast via `presentError`; the create sheet only ever offers active leaves | `saveNewTask` never checked the target |
| `NOT_A_LIFE_GOAL` | inline at the capture form; the chip rows offer Life goals only | no server, so no refusal |
| `BRANCH_NOT_ACTIVE` | the "This branch isn't active this week" sheet — from the client's pre-flight AND from the server's own refusal (S-backlog-8-3), and from an idea with no active leaf (S-idea-4-3) | a toast, or a fallback to the literal id `'g4'` (D-10) |
| `LIFE_GOAL_NO_BACKLOG` | toast; no picker lists a Life goal | no check |
| `ALREADY_CONVERTED` | inline in the create sheet: "already this week — nothing new was created", and no second task | D-19: a **second task** was created from a vanished item, and the removal was never sent to the API |
| ambiguous conversion target | the create sheet's focus picker, with no default selection — from the client's candidate count and from the server's `details.candidates` | `activeLeafFor` took the first active leaf in array order (D-18) |
| `TASK_ALREADY_EXITED` | toast; the exits are hidden once `status !== 'open'` | `confirmAction` `return`ed on a missing task |
| `WEEK_OUT_OF_RANGE` | toast on a refused complete | the mockup clamped |
| `WEEK_NOT_CURRENT` | inline on the plan screen — "the week rolled over while you were planning" | `savePlan` wrote whatever was on screen (Q-3) |
| `VALIDATION_FAILED` (blank title) | Save stays disabled, and the server's issue message renders at the field | `return` — the sheet did nothing |
| `VALIDATION_FAILED` (bad link URL) | at the link field | `addTaskLink` `return`ed on a blank/invalid URL |
| `NOT_FOUND` | "That's no longer here", plus a full refresh | `saveTaskDetail` `return`ed |
| a failed READ | `LoadError` inline with a Try again, per screen | impossible against an array |

Plus three behaviour changes with no refusal attached:

- **Ids are the server's.** Nothing is keyed on a locally-minted id; `POST` bodies are asserted in tests to
  carry no `id` and no `originWeek`.
- **The three exits delete nothing.** Move-to-Backlog and Cancel patch a terminal `status`; the tests assert
  no `DELETE /tasks` is ever issued (D-15 / R-task-32), so the `Moved to Backlog` / `Canceled` timeline
  entries and their optional reasons have somewhere to live.
- **Weeks are absolute on the wire.** `ui.viewedWeek` is still an offset locally (it is what `?week=` takes),
  but no offset is stored, cached as data, or turned back into a date. Carry ages come from
  `TaskView.carryWeeks`; labels come from `originWeekStart`; the week picker walks off the `weekStart` the
  server sent for the viewed week.

## 4. Rules covered by name

Goal: R-goal-1..29 (all rendered; 3, 5, 6, 9, 10, 11, 13, 14, 16–21, 24, 25, 26, 27, 28 asserted).
Plan: R-plan-1..12 (2, 5, 6, 7, 9, 10, 11, 12 asserted).
Task: R-task-1..32 (3, 4, 6, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 21, 22, 23, 24, 25, 26, 27, 30, 31, 32
asserted).
Backlog: R-backlog-1..16 (2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16 asserted).
Idea: R-idea-1..8 (1, 2, 4, 5, 6, 7, 8 asserted). Learning: R-learning-1..7 (1, 2, 3, 4, 5, 7 asserted).
Nav: R-nav-1..15 (1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15 asserted). Auth: R-auth-6.
Mockup bugs closed here: D-1, D-2, D-3, D-4, D-6, D-7, D-9, D-10, D-11, D-12, D-13, D-15, D-16, D-17, D-18,
D-19, D-20, D-21, D-22, D-23, D-24, D-25, D-26, D-27.

Tests are named after the scenario they cover. New files, all through the real provider stack and MSW:

```
tests/screens/goals.test.tsx       14  create · sub-goal · horizon lock · both move reasons · dormancy · carrying · delete
tests/screens/tasks.test.tsx       21  sections · week switcher · carry labels · create · three exits · uncheck · detail
tests/screens/plan.test.tsx         7  set · clear · blank-sentence flag · WEEK_NOT_CURRENT · pull list
tests/screens/backlog.test.tsx     15  page · move · conversion · double conversion · dormant branch · ambiguity · drawer
tests/screens/capture.test.tsx     13  ideas · learnings · attach · convert · the applied badge
tests/screens/goalDetail.test.tsx   6  own backlog vs. the Life roll-up · dormant block · line learnings
tests/screens/theme.test.tsx        3  real tokens, no document filter, persisted choice, sign-out
```

`tests/msw/fixtures.ts` grew a `tree()` builder: two Life lines, one active leaf, three dormant, and an
unrelated Monthly goal so the move sheet can show both disabled reasons at once. It is additive — the
existing `goal()` / `leaf()` / `goalsResponse()` builders are unchanged, so the 06 agent's tests still run
against exactly what they were written for.

## 5. Judgement calls, recorded

1. **The account button.** R-nav-11 describes "theme toggle plus at most one primary action", and this adds
   a second 40px icon to the cluster, behind which sit sign-out and the entry point for `VerifyEmailScreen`
   (written and tested by the 06 agent, left unrouted for want of a settings surface). An app you cannot
   sign out of is not shippable, and R-nav-1 fixes the tab bar at five, so a Settings tab was not available.
   Its open/closed state is local to `TopActions` because `UIContext`'s `Sheet` union is not this agent's
   file to extend.
2. **The uncheck follow-up is two calls, not one.** The 06 table maps `saveUncheck()` to
   `useUncheckTask({ id, cond })`. But R-task-19/21 put the uncheck FIRST and the prompt after, and
   `TaskService.uncheck` refuses a task that is not `done` (`VALIDATION_FAILED: 'task is not completed'`) —
   so a second call carrying `cond` cannot be an uncheck. The row unchecks immediately (`POST /uncheck`),
   the prompt appears, and a real change is `PATCH /tasks/:id`, which appends the same `cond_edited` event.
   Skip and an unchanged/blank save write nothing at all (S-task-21-1/3, asserted).
3. **A third tap action on a learning.** R-learning-3 names exactly two, but R-learning-4 / D-23 require
   `applied` to be earnable by an explicit action. "Changed the plan" is that action.
4. **`activeLeavesUnder` is a filter, not a derivation.** R-backlog-8 requires the "branch isn't active"
   sheet to appear INSTEAD of the create modal, which means the client has to know before it asks. It
   filters the server's own `isLeaf` / `isActive` flags for the week; it recomputes nothing. The server
   remains the guard, and its refusal drives the same sheet (S-backlog-8-3, asserted).
5. **The Tasks screen shows the focus sentence at week 0 only**, per R-nav-8's explicit "(week 0 only)".
   D-2 notes the model can now render a past week's own sentence; R-nav-8 is the numbered rule, so it wins.
   Changing this is a one-line edit if the owner prefers D-2's reading.
6. **The `+` drawer creates exactly one entity** and the checkbox reads "Add to this week instead" (D-21).
   With no active leaf under the chosen goal it parks the item in the backlog and says so (S-backlog-15-2),
   rather than attempting a task it has no target for — the 06 table suggested letting `BRANCH_NOT_ACTIVE`
   drive the sheet, but `CreateTaskRequest` needs a `goalId` that does not exist in that case.
7. **Last-used backlog goal** is a module-level `let` in `BacklogSheets.tsx`, validated against the live
   tree on every open and falling back to the first non-Life goal or to an empty state (D-10). It is not a
   store: it holds one string, for one sheet, for one page load.

## 6. For the orchestrator — two contract gaps

**a. `AMBIGUOUS_CONVERSION_TARGET` does not exist.** The brief described it as a `409` with
`details.candidates`. `packages/shared/src/errors.ts` has no such code, and `BacklogService.resolveTarget`
throws `VALIDATION_FAILED` with `details.candidates: [{ id, title }]` — which
`docs/work/05-backlog-capture/build.md` §… itself flags as "a *product* refusal wearing a *validation*
code". The create sheet therefore branches on `details.candidates`, not on `err.code`, which works today
and keeps working unchanged if the code is added. **Recommend adding it** (`AMBIGUOUS_CONVERSION_TARGET:
409`) so `lib/errorCopy.ts` can carry a line for it; a `packages/shared` change is not this agent's to make.

**b. `GoalDetailResponse.replanOptions` does not exist.** The brief said the contextual next periods come
from the server. They do not — `docs/work/03-goals-plan/build.md` §5 proposed the field and left it undone.
So `src/utils/periods.ts` mirrors `apps/api/src/domain/goal-tree.ts`'s derivation, from `serverNow` in the
owner's timezone rather than from a literal (D-3 is closed either way). The duplication is named in that
file's header. The re-plan sheet also accepts the server's own `details.options` on a refusal and re-renders
from it, so the server still gets the last word. **Recommend adding `replanOptions: string[]`** and deleting
`replanPeriods` from the client.

## 7. Left undone

- **`npm run build` fails at the service-worker step, and did so before this work.** `tsc`, `tsc -p
  tsconfig.sw.json` and the app bundle all succeed — `dist/` gets `index.html`, `assets/index-*.js`,
  `manifest.webmanifest`, `_headers`, `fonts/`, `icons/`. `vite-plugin-pwa` then spawns a nested Vite
  (v8.2.2 / rolldown) to build `src/sw.ts` and it aborts with 40 × *"Transforming destructuring to the
  configured target environment (chrome87, edge88, es2020, …) is not supported yet"* inside `idb`, a
  transitive dependency of `workbox-expiration`. **Verified pre-existing**: `git stash` → `npx vite build`
  on the untouched tree reproduces it identically, and `package.json` / `package-lock.json` /
  `vite.config.ts` / `src/sw.ts` are all unmodified by this agent (and all off-limits to it). So `dist/`
  ships **without `sw.js` and without a precache manifest** — a broken deploy for the PWA half. It needs the
  PWA/foundation owner: either pin the nested Vite, or raise the `build.target` for the SW environment.
- **`GoalDetailScreen` fetches `useTasks(0, goal.id)`** for an active leaf. `GoalDetailResponse` has no
  `tasks` field, so this is a second request on that screen. Adding one would remove it.
- **No optimistic updates.** `useCommand` is patch-then-invalidate (06 §3), which means a tap on a slow
  connection shows the old state until the response lands. Q-14 asks for optimistic UI with rollback; the
  simpler shape was kept deliberately, because a rollback path that is wrong is worse than a spinner.
- **`carryWeeks` on the goal-detail task list** is computed for week 0, which is the only week that screen
  shows. If a week switcher is ever added there, pass the offset through.
- **No pagination anywhere.** Q-12 caps every list endpoint at 200 and the client reads the first page. At
  one owner's scale this is fine; it is not a general answer.
