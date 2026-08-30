# 03 — Goals and the weekly plan

`GoalService` and `PlanService`, behind the routes the foundation registered. Nothing here changed a
route shape, a shared schema, or a rule that already lived in `domain/goal-tree.ts`.

Sources of truth, in order: `docs/SPEC.md` → `docs/BUSINESS-RULES.md` → `docs/work/01-foundation/build.md`.

---

## 1. What was built

```
apps/api/src/application/services/
├── goal.service.ts   list · detail · create · patch · move · replan · remove (cascade)
└── plan.service.ts   get · save (whole-week replace)

apps/api/tests/
├── goals/fixtures.ts           shared fixtures (trees built through the REAL routes)
├── goals/goal-tree.test.ts     22 tests — create, edit, move, dormancy, carrying, detail, scoping
├── goals/delete-cascade.test.ts 5 tests — Q-5
├── goals/replan-periods.test.ts 9 tests — D-3, unit + HTTP
└── plan/plan.test.ts           13 tests — R-plan-*, R-goal-28
```

`npm run typecheck` clean; `npm run test` **195 passed (18 files)**, up from 146.

Routes now answering for real: `GET /goals`, `GET /goals/:id`, `POST /goals`, `PATCH /goals/:id`,
`POST /goals/:id/move`, `POST /goals/:id/replan`, `DELETE /goals/:id`, `GET /plan`, `PUT /plan`.

## 2. Rules covered

| Area | Rules |
|---|---|
| Create | R-goal-1/3/4/5/6/7/13/29, D-3, D-6, S-goal-3-1/4-1/5-1/5-2/5-3/6-1/13-1/29-1 |
| Edit | R-goal-14/15/29, Q-2 (`version`), S-goal-14-1/14-2 |
| Move | R-goal-16/17/18/19/21/28, S-goal-17-1/18-1/18-2/21-1/28-1 |
| Re-plan | R-goal-22/23, D-3, S-goal-22-1/23-1 |
| Delete | Q-5, S-idea-7-1 (tags null out, never cascade) |
| Reads | R-goal-8/9/10/11/24/25/26/27, R-backlog-11/12 (shape only), R-learning-5, Q-7, D-16 |
| Plan | R-plan-1/2/5/6/7/8, Q-3, D-2, D-9, S-plan-2-1/5-1/5-2/6-1/7-1/8-1 |
| Scoping | R-auth-2/3/5 on every read and write |

The tree invariants themselves are NOT re-implemented: `GoalTreeGuard` + `domain/goal-tree.ts` remain the
only place `HORIZON_CONFLICT` / `WOULD_CREATE_CYCLE` / `LIFE_GOAL_IMMUTABLE` / `GOAL_HAS_OPEN_TASKS` are
decided, and the routes still call the guard before the service.

## 3. Decisions

### 3.1 A leaf that gains a child loses its focus — for every week (R-goal-28 / D-8 / S-goal-9-1)

**Decision:** when a create or a move turns a leaf into a parent, EVERY `weekly_focus` row that leaf holds
is deleted in the SAME `GuardedBatch` as the create/move. Open tasks are refused up front by
`GoalTreeGuard` (`GOAL_HAS_OPEN_TASKS`), which is the foundation's standing ruling — nothing is silently
re-homed.

**Why every week, not just the current one.** A row that survives is a second representation of dormancy,
which is exactly what D-2 exists to prevent: `isActive` also requires `isLeaf`, so the stale row is inert
*today* and comes back to life the moment the child is moved away — the mockup's silent resurrection.
S-goal-9-1 states it directly ("the stale row must not exist"), and `IWeeklyFocusRepo.deleteByGoalsStmt`
is documented by the foundation as the R-goal-28 statement. Deleting only the current week would leave
the same bug reachable in any other week.

**The cost, accepted deliberately:** a past week no longer renders that ex-leaf's sentence. Nothing else
is lost — its tasks are untouched (the operation is refused while any are open), and the goal's own
history is intact. Tested three ways in `tests/plan/plan.test.ts`: create-under, move-under, and the
round trip where the child is moved away again and the ex-leaf comes back plainly dormant.

### 3.2 Re-plan refuses a no-op instead of writing one

`period` is free text (the owner may type a label), so the server does not force the choice into
`replanPeriods`. It does refuse a re-plan to the period the goal is ALREADY in — the precise bug D-3
records — with `422 VALIDATION_FAILED` and `details.options` carrying the derivation for today and this
goal, so the client can re-render the sheet from the server's list rather than a literal.

The optional reason is accepted and **not persisted**: goals have no activity log in this product
(R-nav-14 removes audit trails and reports), and a column nothing renders would be a feature the ruleset
deletes. It is the client's toast copy.

### 3.3 Periods live where the tree rules live

`defaultPeriod` / `replanPeriods` were already implemented and unit-tested in `domain/goal-tree.ts` by the
foundation, derived from `(horizon, today)`. No second module was created for them — a duplicate would be
a second definition of the same rule. `today` is `dateInTimezone(ctx.now, ctx.tz)`, the OWNER's calendar
day (R-auth-5): `tests/goals/replan-periods.test.ts` proves two accounts at the same instant get 2027 and
2026 respectively across the Auckland/New-York split, plus the quarter and year boundaries as unit tests.

### 3.4 `PUT /plan` is a literal delete-then-insert replace

The save deletes exactly the rows it read for that week and re-inserts the keepers in one batch. The
delete states its exact row count, which `GuardedBatch` turns into a precondition — so a concurrent save
from another device loses cleanly with `409 CONCURRENT_UPDATE` instead of interleaving two half-plans
(Q-3), and there is no plan-level version column to invent. A leaf that keeps its focus keeps its row id
and `createdAt` (the row is re-inserted with them), so the client's identity is stable across an edit.

Refusals are checked for the whole payload before any write: a non-current `weekStart`
(`WEEK_NOT_CURRENT`), any entry on a Life goal or a non-leaf (`NOT_A_LEAF`), an unknown goal (404), a
duplicated `goalId` (`VALIDATION_FAILED`). A checked leaf with a blank sentence stores nothing (R-plan-5 /
D-9) and the response's `entries` is what tells the client the check did not stick.

### 3.5 The cascade states every count it is about to remove

`DELETE /goals/:id?cascade=true` reads the exact row sets first and gives every statement an exact
`expectedChanges`. `GuardedBatch` asserts each one, so a task created under the subtree between the read
and the write rolls the whole delete back with a 409 rather than leaving an orphan. Without `?cascade`,
a goal with children answers `409 GOAL_HAS_CHILDREN` with `{ subGoals, tasks, backlogItems }` in
`details` — the exact numbers the confirmation sheet has to name — and writes nothing. A childless goal
needs no flag.

Deleted: goals, weekly focuses, tasks (+ their links and events), backlog items (+ their links). Nulled
to Unsorted, never deleted: Idea and Learning `goalId` tags (S-idea-7-1).

## 4. Shared files touched

**`application/services/index.ts` and `infrastructure/di/container.ts`: NOT touched.** Both already
export and register `GoalService` and `PlanService`, so no seam edit was needed.

What *was* touched outside the owned set, all additive:

| File | Change |
|---|---|
| `application/ports/repositories.ts` | +4 READ methods: `IWeeklyFocusRepo.listByGoals`, `ITaskRepo.listByGoals`, `ITaskEventRepo.listByTasks`, `IBacklogRepo.listByGoals`. No existing signature changed. |
| `infrastructure/persistence/d1-goal.repo.ts` / `d1-task.repo.ts` / `d1-backlog.repo.ts` | the four implementations. |

They exist because `GuardedBatch` compares `meta.changes` to `expectedChanges` **exactly** (0 means "must
change zero rows"), so a cascade delete has to know the precise row set it is removing — and because
`deleteByTasksStmt` / `deleteByItemsStmt` take ids, which only a read can supply. `listOpenByGoals` was
not enough: an EXITED task still owns links and events (D-15), and filtering to `open` would have
orphaned them.

Three existing tests asserted `501` as shorthand for "the request reached the (stubbed) service". That
stub is gone, so the assertion was re-pointed at the real answer; no expectation was weakened, and no
test was deleted:

| Test | Was | Now | Why |
|---|---|---|---|
| `goal-tree-guard.test.ts` ×4 (S-goal-3-1, S-goal-5-1, S-goal-17-1, the already-has-children case) | `501` | `201` / `200` | A legal create/move is now carried out. The guard assertion — 409 for every violation — is unchanged, and it is what the file is for. |
| `validate.test.ts` "a well-formed id … reaches the service" | `501` | `404` | The service's own answer for an id nobody owns (R-auth-3). Strictly stronger: a malformed id could not produce it. |
| `error-handler.test.ts` "a stub route answers 501" | `GET /api/goals` | `GET /api/bootstrap` | `/goals` is implemented; `/bootstrap` is the remaining stub. When it lands, assert `errorResponse('NOT_IMPLEMENTED', …)` directly and drop the route from that test. |

## 5. Left undone, deliberately

- **`replanPeriods` is not on the wire.** The contextual option list has no field in
  `GoalDetailResponse` / `GoalView`, and adding one would be a shared-schema change. Today it reaches the
  client only in the `details` of a refused no-op re-plan (§3.2). **Proposed:** add
  `replanOptions: string[]` to `GoalDetailResponse` so the sheet never derives a period client-side.
  Until then the client must derive them from `preferences.timezone` + `serverNow`, duplicating the rule.
- **`GoalService.remove` loads all ideas to count the tagged ones**, because `IIdeaRepo` has `listAll`
  but no `listByGoals` (its sibling `ILearningRepo` has one). **Proposed:** add
  `IIdeaRepo.listByGoals`, symmetric with the learning repo. Not done here: another agent owns the idea
  flows this week, and it is a performance nit at ≤5000 ideas (Q-12), not a correctness one.
- **`BacklogItemView` / `LearningView` are projected locally** in `goal.service.ts` for the detail
  screen. `BacklogService` / `LearningService` will grow their own canonical projectors; when they exist,
  one of the two should be lifted to a shared module rather than kept in duplicate.
- **`GuardedBatch.expectedChanges` cannot express "however many rows match".** Every caller must know its
  exact count first, which is why §4's four reads exist and why the port doc's "use 0 for best-effort
  statements that may legitimately no-op" is misleading — `0` means "must change zero", and
  `insertCarriedIgnoreStmt` (the doc's own example) will throw the first time it actually inserts.
  **Proposed for the foundation owner, not performed here:** allow `expectedChanges: 'any'`.
- **`GoalView.carrying` counts open tasks under a Life goal** whose origin is before the VIEWED week.
  The singular/plural copy (`1 task carrying · oldest 1 week`, S-goal-24-3) is the client's.
- Nothing was changed under `apps/web/`, `packages/shared/src/`, `docs/SPEC.md`, or any other agent's
  service or route.
