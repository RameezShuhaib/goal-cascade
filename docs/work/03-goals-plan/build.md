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

---

## Review

Reviewed by 07-api-review. Full findings and evidence: `docs/work/07-api-review/report.md`.

Three findings here, two of them in the two places this document is most confident about. The tree rules
themselves, the re-plan derivation, the dormancy propagation and every aggregate were attacked and held.

**§3.5 — the cascade orphaned rows it had not read. HIGH, fixed.** The promise is exact: *"a task created
under the subtree between the read and the write rolls the whole delete back with a 409 rather than leaving
an orphan."* It did not, because `removal()` only emitted a statement when the read found `rows > 0`. With
zero rows there was no statement, therefore no precondition, therefore nothing to trip — and there is no FK
on `tasks.goal_id` / `backlog_items.goal_id` / `weekly_focus.goal_id` to catch it. `0 → 1` is the ordinary
case, not an exotic one: delete a goal with no tasks while another device creates one.
`tests/review/cascade-race.test.ts` decorates the read to open the window deterministically; pre-fix it
printed `{ status: 200, taskRowSurvives: true, itsGoalSurvives: false }` — the goal deleted, the row not.
Fixed by emitting every statement with its exact count, `0` included. The negative controls in the same
file show the guard already worked when the read found one row, so the hole was precisely the zero case;
and two further tests assert the ordinary cascade and the all-zero delete still succeed, because a fix that
409s honest deletes would be worse than the bug.

This was downstream of §5's own observation: `expectedChanges: 0` had stopped meaning "must change zero
rows" (see the 01-foundation review). Your proposed `'any'` was the right answer and is now implemented.

**§3.4 — `PUT /plan` did not deliver the Q-3 guarantee it claims. HIGH, fixed.** *"A concurrent save from
another device loses cleanly with 409 instead of interleaving two half-plans"* was false twice over. The
delete targeted only the goal ids the save had **read**, so a row another device added for a goal absent
from that list survived the whole-week replace and the stored plan became a merge of two plans — a leaf the
saving device believed dormant stayed active. And when the week was empty the statement was skipped
entirely, so a concurrent first save of a fresh week was clobbered silently. Fixed with a new
`deleteByWeekStmt`: delete by **week**, `expectedChanges = <rows read>`, so the precondition reads "this
week still holds exactly the plan I was built on" — the guarantee as written, and meaningful at 0. Proven
red then green in `tests/review/guarded-semantics.test.ts`, with an uncontended save as the negative
control. `deleteByGoalsAndWeekStmt` is now unused; kept rather than removed.

**§3.1 — deleting EVERY week's focus was the wrong call. MEDIUM, changed.** This is the one considered
decision the review overturned, so the reasoning is worth reading in full (report finding 5).

Your argument was that a surviving row is a second representation of dormancy and D-8's silent
resurrection. But the defence against resurrection is not deletion, it is the derivation — and the
derivation already does it. `isActive` / `isDormant` / `subtreeActive` / `activeLeavesUnder` in
`domain/goal-tree.ts`, your own `toView`, `TaskService.assertActiveLeaf`, `IdeaService.requireActiveLeaf`
and `BacklogService.resolveConversionTarget` all require leaf-ness **at read time**. A surviving row cannot
make a non-leaf active anywhere, and once the goal is a leaf again the current week's row is already gone,
so it is plainly dormant. Meanwhile deleting the past re-introduces exactly the bug D-2 made focus a
per-week table to prevent: adding a sub-goal today silently rewrote the record of six weeks ago, and
`GET /plan?week=-6` went blank for a week that really did have a focus.

On S-goal-9-1: its observable assertion — *"reported as not active and holds no focus"* — is satisfied
either way. Its parenthetical *"the stale row must not exist — D-2"* cites D-2 while requiring the thing
D-2 forbids. The spec is inconsistent there and the parenthetical is the wrong half.

Now: the current week and later are deleted (`deleteByGoalsFromWeekStmt`), the past is kept. The honest
cost, which you should know: `GoalView.isActive` for a past week uses **today's** tree, because "was a leaf
then" is not stored — so for an ex-leaf, `GET /plan?week=-2` shows its old sentence while
`GET /goals?week=-2` reports `isActive: false`. That divergence is new and is smaller than deleting the
truth outright.

*Per-test verdict — `tests/plan/plan.test.ts` "D-8 — the focus is removed for EVERY week": legitimately
retired, and strengthened.* Its `toHaveLength(0)` asserted the mechanism; its resurrection assertion is the
rule, and is unchanged. The replacement adds four assertions (the past row survives with its sentence, the
past week still renders it, the current week is empty, the ex-leaf reports `isActive: false`) and re-runs
the resurrection check after the move. Your other two R-goal-28 tests needed no change at all.

**§5 — both proposals implemented.** `expectedChanges: 'any'` is in. `replanOptions: string[]` is on
`GoalDetailResponse`, populated from your `replanPeriods(horizon, today, currentPeriod)` and empty for a
Life goal; `tests/review/seams.test.ts` asserts it is the *same* list a refused no-op re-plan returns in
`details.options`, so the two cannot drift, and that it moves with the owner's clock rather than a literal.
`IIdeaRepo.listByGoals` was not added — still a performance nit, not a correctness one.

Everything else in §3 held: §3.2's refusal of a no-op re-plan, §3.3's single definition of the period rules,
the tree guard staying ahead of the service, and every derived aggregate.
