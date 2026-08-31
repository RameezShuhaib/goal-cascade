# 16 — Lens API: the Weekly horizon, period-scoped reads, and the scale fixes

The API half of Amendment 2. `apps/api/**` and `packages/shared/**` only; `apps/web/**` is untouched and
is now out of sync with the contract by design — §7 is the list the web agent needs.

**Green:** `apps/api` 505 tests / 40 files (from 421 / 37), `packages/shared` 43 (from 28), `typecheck`
clean in both. No test was weakened: every assertion that encoded a superseded rule was **inverted**
rather than deleted, with a per-test verdict naming the `R-*` id that retired it (§6).

---

## 1. What was implemented, by rule

### The fifth horizon and the end of leaf-ness

| Rule | What landed |
|---|---|
| **R-goal-30** | `HORIZONS` gains `'Weekly'` at rank 4, in all three copies (`shared/common.ts`, `domain/enums.ts`, `domain/goal-tree.ts`) plus the Drizzle column's `enum`. `rank()` still throws on an unknown horizon, so a stale build meeting a persisted `'Weekly'` raises rather than sorting it below Life. |
| **R-goal-31** | `isTerminalHorizon` means **Weekly**. The single rank comparison in `checkCreate` enforces it, unchanged in form — the terminal horizon has the maximum rank, so nothing can be strictly greater than it. Monthly now accepts children. |
| **R-goal-32** | Levels may be skipped: `checkCreate` compares ranks, never adjacency, so a Weekly goal hangs off Life, Yearly, Quarterly or Monthly. |
| **R-goal-37** | **"Leaf" is retired, not renamed.** `isLeaf`, `focusableLeaves`, `isActive`, `isDormant`, `subtreeActive`, `activeLeavesUnder` and `moveTargetReason` are deleted from `domain/goal-tree.ts`. What survives is `hasChildrenIn` — the structural fact, named as such, keyed to no permission. |
| **R-goal-39** | `TaskService.assertWeeklyGoal` reads **one row** and compares `horizon === 'Weekly'`. It replaces `assertActiveLeaf`, which loaded the whole goal list and then checked leaf-ness plus a focus row. |
| **R-goal-42** | `GOAL_HAS_OPEN_TASKS` and `assertLeafCanGainAChild` are **deleted**, not left inert: the transition is unreachable, because only Weekly goals hold tasks and a Weekly goal can never gain a child. |

### Periods

`apps/api/src/domain/periods.ts` is new and is the only place period arithmetic lives: `periodKeyOf`,
`labelOf`, `isPeriodKey`, `isPastPeriod`, `isCurrentPeriod`, `stepPeriod`, `zoomTo`, `weekForMonth`,
`firstMondayIn`, `lastMondayIn`, `replanPeriods`.

- **R-goal-33** — `goals.period_key` is the canonical, lexicographically sortable key; `period` becomes
  the **[srv]** rendered label written by the same code that writes the key. No request schema carries a
  `period` at all, so S-goal-33-3 holds by construction rather than by a handler remembering to drop it.
- **R-goal-34** — every "current period" is computed server-side from the account timezone and echoed on
  the wire (`PeriodView`, `WeekView.isPast`). The client re-derives none of the four.
- **R-goal-36** — `PERIOD_IN_PAST` on create, patch, re-plan, `repeat-week` and task-create-through-the-
  parent. **No forward bound anywhere**: `WeekOffset` widened to `±520` and `resolveWeek`'s two refusals
  are gone.
- **R-goal-40** — a Weekly goal's `periodKey` is immutable and it is not re-plannable; `replanPeriods`
  returns `[]` for Weekly and Life alike.
- **R-lens-9** — `zoomTo` is one line for four horizons, because R-lens-18's anchor invariant already
  resolves both of R-lens-9's cases. Weekly is the exception and the correction (§8).

### The lens reads (R-lens-1 … R-lens-27)

`GoalService.lens()` replaces `list()`. Six reads, all indexed and bounded, none touching the whole table:

1. `listByLens` — the page: one exact-prefix seek on `ix_goals_lens`, `LIMIT n+1`, cursor on `(createdAt, id)`.
2. `listInterior` — the interior tree (`horizon <> 'Weekly'`), indexed once by `indexTree`.
3. `countOpenVisibleByGoal` — R-lens-4's group counts, **one grouped query** on `ix_tasks_open_week`.
4. `listByIds` — the Weekly goals behind (3) and behind the week's tasks. Bounded by open work.
5. `listOpenByGoals` — `N in backlog`, bounded by the page.
6. `listVisibleInWeek` — R-lens-12's tasks. Empty in the other four lenses.

plus two `LIMIT 1` probes for R-lens-26's forward dot. Also landed: `GoalService.zoom()` (R-lens-22, one
grouped query, never five lens reads), `repeatWeek()` (R-goal-46), the carried band (R-lens-12, a separate
array ordered oldest-`periodKey` first), `UNSORTED` via `lifeRootId: null` (R-lens-20), empty-group
suppression (R-lens-19), `plannedAgeWeeks` (R-goal-43) and `weeklyBreakdown` (R-goal-47, one
`period_key BETWEEN` range read per Monthly page).

### Tasks and backlog

- **R-task-40** — `originWeekStart` is seeded once from the Weekly parent's `periodKey`. There is no week
  field on `CreateTaskRequest`, so `.strict()` refuses every spelling of it.
- **R-task-43** — `carryWeeks` is signed: `weeksBetween(origin, min(viewed, current))`. `TaskView.completable`
  is new, so the client does not re-derive R-task-44's bound to decide on a checkbox.
- **R-task-44** — `CompleteTaskRequest.week` carries its **own** `.max(0)`, and `resolveWeekFor` re-states
  it. This is the amendment's silent break: the guard used to be inherited from `WeekOffset`.
- **R-task-48/49** — `newWeeklyGoal` on both `POST /tasks` and `POST /backlog/:id/convert-to-task`; the goal
  and the task commit in one `GuardedBatch`, and the created goal comes back on the response so the client
  can say so (nothing may be created invisibly).
- **R-backlog-26** — the conversion target is the **Weekly goal at or under the item's goal for the target
  week**. `BRANCH_NOT_ACTIVE` → `NO_WEEKLY_GOAL`; D-18's ambiguity ruling untouched.
- **R-backlog-29** — Move-to-Backlog lands on the **nearest non-Weekly ancestor**, and refuses with
  `LIFE_GOAL_NO_BACKLOG` when a Weekly goal hangs directly off a Life goal. This was a direct contradiction
  between R-task-15 and R-backlog-2 that the redesign introduced; missing it writes an illegal row silently.

### Removals (R-rm-1 … R-rm-5)

Deleted outright, not deprecated: `plan.service.ts`, `plan.routes.ts`, `mcp/tools/plan.ts`,
`tests/plan/`, `IWeeklyFocusRepo` + `D1WeeklyFocusRepo` + its DI symbol, `WeeklyFocus`, the `weeklyFocus`
table and schema member, `IGoalRepo.listAll`, `selectableWeeks`, `WEEK_HISTORY_WEEKS`, `MAX_PLAN_ENTRIES`,
`SavePlanRequest`, `PlanResponse`, `PlanEntryView`, `GoalFilterQuery`, `TasksQuery.goalId`, and the four
error codes `NOT_A_LEAF` / `BRANCH_NOT_ACTIVE` / `WEEK_NOT_CURRENT` / `GOAL_HAS_OPEN_TASKS`. Every one has
an inverted assertion somewhere so it cannot return (S-rm-1-1 … S-rm-5-1).

---

## 2. The migration — `0003_weekly_horizon`

Seven statements, and **the order is not drizzle-kit's**: the mint reads `weekly_focus`, so the `DROP
TABLE` moves last, and `CREATE INDEX` moves after the bulk insert so the index is built once.

1. `ALTER TABLE goals ADD period_key`
2. backfill `period_key` — parse the free-text `period` with the grammar the app itself emitted, else the
   period containing `created_at`
3. re-render `period` from `period_key` (it is **[srv]** now)
4. **mint one Weekly goal per `(goal_id, origin_week_start)`**, titled from that `(goal, week)`'s focus
   sentence where one exists, else the parent goal's own title
5. re-point every task at it
6. `CREATE INDEX ix_goals_lens`
7. `DROP TABLE weekly_focus`

**Why step 4 exists.** Under R-goal-39 every existing task is illegal the moment the rule lands: today's
tasks hang off non-Life leaves, which are exactly the childless Monthly goals R-goal-37 warns must never
hold work. Option A of three, and the only one that leaves one shape in the database.

**The ids** are `upper(hex(randomblob(13)))` — 26 characters, every one inside Crockford's ULID alphabet,
so they satisfy the wire's `Ulid` schema. Not time-sortable, and nothing requires them to be (order is
`created_at` then `id`). **`created_at`** is the minted goal's own week's Monday, so it sorts into that
week's lens rather than all of them landing at the migration instant.

**No route, service or MCP tool performs this write.** It writes goals into PAST weeks, which R-goal-36
forbids the product from doing — the rule exists so planning cannot rewrite history, and re-homing work
that already happened is not planning.

### How data survival was proved

`apps/api/tests/migration/weekly-horizon.test.ts` rebuilds the pre-A2 world (re-creates `weekly_focus`,
seeds goals with free-text `period` and an empty `period_key`, points tasks at Monthly and Yearly leaves)
and then executes **the migration's own statements**, read from the `.sql` file and split on the same
`--> statement-breakpoint` marker wrangler uses. Nothing is re-implemented, so a change to the SQL is a
change to what the test asserts.

Seeded: 7 goals (5 legal period labels + one unparseable `H2`), 6 tasks across 4 distinct
`(goal, week)` pairs — two sharing a pair, one `done`, one `canceled`, one on a **Yearly** leaf — and 1
focus sentence.

| Assertion | Result |
|---|---|
| Weekly goals minted | **4** — exactly one per distinct `(goal, originWeek)`, never one per task |
| titled from a focus sentence | **1** (`One long run every Sunday`) |
| titled from the parent's title | **3** (`Long runs`, `Strength`, `Sleep better`) |
| tasks preserved | **6 / 6**, same ids, same `origin_week_start`, same statuses including `done` and `canceled` |
| tasks re-pointed | **6 / 6**, each to the goal minted for its own `(goal, week)` |
| tasks legal under R-goal-39 afterwards | **6 / 6** hang off a `Weekly` goal |
| `period_key` parsed from the label | 5 rows (`2026`, `2026-Q3`, `2026-08`, `2026-09`, `''`) |
| `period_key` **guessed** from `created_at` | **1** row (`H2` → `2026-07`) |
| idempotent | data steps run **twice**; goals and tasks byte-identical, still 4 minted |
| end to end | the migrated account reads correctly through the real Weekly lens: 2 goals in this week's plan, 1 in the **carried** band with its 2 tasks at the correct age 2, every visible task with a home, one `UNSORTED`-free group |

**The idempotency case caught a real defect.** Step 2's `CASE` had no `Weekly` branch, so a replay fell
through to `ELSE ''` and **wiped the `period_key` of every goal step 4 had just minted**. Fixed by
`WHEN 'Weekly' THEN period_key` — a Weekly key is already canonical (it is a Monday date), and there is no
label to parse. Without the test this would have shipped, and it would only have fired on a replay.

**Reporting the counts.** RECONCILIATION §3.9 says "no other schema change", so the migration does not
write a report table. The counts above are recoverable after the fact with:

```sql
SELECT COUNT(*) FROM goals WHERE horizon = 'Weekly';                    -- minted (on a pre-A2 account)
SELECT COUNT(*) FROM goals WHERE horizon <> 'Life' AND period_key = ''; -- backfill failures (expect 0)
SELECT COUNT(*) FROM tasks t JOIN goals g ON g.id = t.goal_id
 WHERE g.horizon <> 'Weekly';                                            -- illegal tasks (expect 0)
```

**Two caveats, stated rather than hidden.** The `created_at` fallback reads UTC, because SQL has no access
to the owner's timezone — off by at most one day, and only for a goal created within hours of a period
boundary whose label was *already* unparseable. And owner-typed labels outside the app's grammar (`H2`,
`before the move`) are lost: they were read by nothing, and a lens cannot be built on a value the product
cannot compare.

---

## 3. Benchmarks — before and after, at both scales

`apps/api/tests/perf/lens-scale.test.ts`, run with `SCALE=heavy` for the second column. Two halves,
because a timing alone is not evidence:

- **Element visits** — the old read reproduced faithfully (`toView` mapped over every goal, each call
  running `isLeaf` + `descendantIds` + a per-descendant `isLeaf`) against the new one, on the same
  synthetic account. Deterministic and machine-independent, so it is a regression guard as well as a
  measurement: a future change that puts a scan back inside a map fails here.
- **Wall time** — the real `GET` over the real router and real D1 (miniflare), warmed once.

Fixture: five Life lines, one Yearly / four Quarterly / twelve Monthly per line per year, four Weekly
goals per Monthly goal, plus one Weekly practice hung directly off each Life goal.

| | year one (n = **335**, 90 interior) | heavy (n = **9,760**, 2,555 interior) |
|---|---|---|
| **old `GET /goals`, element visits** | **968,625** | **839,129,380** |
| **new lens read, element visits** | **100** | **2,565** |
| **factor** | **9,686×** | **327,146×** |
| `GET /goals?lens=Weekly` | **3 ms** | **11 ms** |
| `GET /goals?lens=Monthly` | **3 ms** | **11 ms** |
| `GET /goals/zoom` | **2 ms** | **3 ms** |
| `GET /bootstrap` | **6 ms** | **21 ms** |

The old-read numbers land within 1% of RECONCILIATION §3.2's independently measured 845 M at n = 9,755,
which is the check that the reproduction is faithful rather than flattering.

**What the numbers mean.** The old read was Θ(n²·d) and grew with the account; the new one is linear in
the **interior** set plus one page, and the interior set grows with the *plan* (5 + 17 per line per year)
rather than with use. The wall-time growth from 3 ms → 11 ms across a 29× larger account is the interior
read, not the lens seek. The lens page itself is `O(page)` at any n.

**The assertion that outlives the numbers** is not a timing: `S-lens-16-1` — no response is ever the whole
account, at any scale. The Monthly lens on a 9,760-goal account returns exactly 5 items.

**Cap sizing, from the same measurement.** A five-line account crosses `MAX_INTERIOR_GOALS = 1000` in its
eleventh year, which is the decade of headroom the number was chosen for; the ~3,250 Weekly rows it
accumulates in the same period are deliberately uncapped, because a lifetime cap on them would be a cap on
how long the product may be used.

---

## 4. What is now enforced that was not

| Cap | Value | Where |
|---|---|---|
| Interior goals per owner (`horizon <> 'Weekly'`) | **1,000** | `countInterior` on create |
| Weekly goals per `(owner, week)` | **50** | `countWeeklyInWeek` on create, on the inline `newWeeklyGoal`, and on `repeat-week` (which refuses whole rather than partially) |
| `MAX_PAGE` | **200** | the lens read, `GET /tasks`, `GET /backlog` — it existed and was referenced nowhere |

The old `500 goals / 100 children` were prose in five files and code in none; every one of those comments
is rewritten (`goal-tree.ts:13`, `entities.ts`, `schema.ts`, `repositories.ts`).

**The bind-parameter cliff** (`inArray(all n ids)` at `goal.service.ts:436-442`) is gone: most call sites
vanished with the read rewrite, and the delete cascade — the one id list that legitimately stays large —
chunks at `ID_CHUNK = 90` (`ports/statement.ts`), one statement per chunk, each stating **its own**
`expectedChanges`, all inside the same `GuardedBatch`. D1 documents a per-query ceiling of 100 bound
parameters; 90 leaves room for the `user_id` and status predicates that accompany every one of these lists.

---

## 5. Every shared schema added, changed or deleted — the web agent's contract

### `packages/shared/src/common.ts`

**Added:** `PeriodKey`, `PeriodKeyParam`, `isPeriodKeyFor(horizon, key)` (a shared predicate, so both
sides run the same rule), `PeriodView`, `LifeGroupView`, `MAX_INTERIOR_GOALS`, `MAX_WEEKLY_GOALS_PER_WEEK`.

**Deleted:** `WEEK_HISTORY_WEEKS`, `MAX_PLAN_ENTRIES`, `PlanEntryView`.

**Changed:**

| Symbol | Before → after |
|---|---|
| `HORIZONS` | 4 members → **5**, `'Weekly'` appended (rank is still the index) |
| `WeekOffset` / `WeekOffsetParam` | `.max(0)` → **`.max(520)`**. ⚠ **silent break** — a positive offset is now ordinary |
| `Period` | owner-typed free text → **[srv]**, the rendered label of `periodKey` |
| `TASK_SOURCES` | `planning \| backlog \| drawer` → **`goal \| backlog \| drawer`** |
| `Sentence` | doc drops the weekly-focus half; the type survives for exit reasons |
| `WeekView` | **+ `isPast: boolean`** |
| `GoalView` | **− `focus`, `isLeaf`, `isActive`, `dormant`, `subtreeActive`, `branches`**; **+ `periodKey`, `lifeRootId` (nullable → `UNSORTED`), `plannedAgeWeeks` (nullable), `weeklyBreakdown` (nullable)** |
| `TaskView` | `carryWeeks` `.nonnegative()` → **`z.int()`, signed**. ⚠ **silent break**: it still parses, the meaning changed. **+ `completable: boolean`** |

### `packages/shared/src/commands.ts`

**Added:** `LensQuery`, `ZoomQuery`, `BacklogQuery` (replaces `GoalFilterQuery`), `NewWeeklyGoalInput`,
`RepeatWeekRequest`, `CreateTaskResponse`.

**Deleted:** `SavePlanRequest`, `PlanResponse`, `GoalFilterQuery`.

**Changed:**

| Symbol | Before → after |
|---|---|
| `CreateGoalRequest` | `period?` → **`periodKey?`**, refined against `horizon` |
| `PatchGoalRequest` | `period?` → **`periodKey?`** (refused outright on a Weekly goal, in the service) |
| `ReplanGoalRequest` | `period` → **`periodKey`** |
| `CreateTaskRequest` | `goalId` required → **exactly one of `goalId` or `newWeeklyGoal`**; `source` default `'planning'` → `'goal'`; **no week field of any kind** |
| `CompleteTaskRequest` | gains its **own explicit `.max(0)`** on `week` |
| `ConvertBacklogItemRequest` | **+ `week: WeekOffset.min(0)`, + `newWeeklyGoal?`** |
| `TasksQuery` | **− `goalId`**, **+ `limit`** |
| `DeleteGoalResponse` | `removed.weeklyFocuses` → **`removed.weeklyGoals`** |
| `ConvertBacklogItemResponse` | **+ `goal: GoalView \| null`** (the Weekly goal a conversion minted) |

### `packages/shared/src/read-models.ts`

**Added:** `LensResponse`, `ZoomRowView`, `ZoomResponse`.

**Changed:**

| Symbol | Before → after |
|---|---|
| `GoalsResponse` | the whole tree flat → **`= LensResponse`** (`lens`, `period`, `groups`, `items`, `carried`, `tasks`, `nextCursor`, `hasForwardContent`) |
| `BootstrapResponse` | **− `goals`, `plan`, `weekHistoryWeeks`**; **+ `lifeGoals`, `lens: LensResponse`** |
| `GoalDetailResponse` | **+ `pullList`, `tasks`**; `replanOptions` `Period[]` → **`PeriodView[]`** |
| `TasksResponse` | **− `plan`**; **+ `nextCursor`** |
| `BacklogResponse` | **+ `nextCursor`** |

### `packages/shared/src/errors.ts`

**Added:** `NOT_A_WEEKLY_GOAL` (409), `NO_WEEKLY_GOAL` (409), `PERIOD_IN_PAST` (409).
**Deleted:** `NOT_A_LEAF`, `BRANCH_NOT_ACTIVE`, `WEEK_NOT_CURRENT`, `GOAL_HAS_OPEN_TASKS`.
`WEEK_OUT_OF_RANGE` narrows: it no longer means "a future week" in general, only the storage range or a
completion outside `originWeek ≤ week ≤ currentWeek`.

### `packages/shared/src/endpoints.ts`

**Added:** `goalsZoom` (`/goals/zoom`), `goalsRepeatWeek` (`/goals/repeat-week`).
**Deleted:** `plan`.
`GET /goals` is a scoped lens read; `GET /goals/:id` no longer takes `?week=`.

---

## 6. Tests retired, with verdicts

Every one is inverted rather than deleted, so the retired rule cannot come back unnoticed.

| Retired assertion | Verdict |
|---|---|
| `isLeaf` / `focusableLeaves` / `isActive` / `isDormant` / `subtreeActive` / `activeLeavesUnder` | **R-goal-37** — retired as a product word, because "leaf" and "holds work" stopped coinciding |
| S-goal-6-1 (a sub-goal under Monthly is refused) | **R-goal-31** — its subject inverted; S-goal-31-2 asserts the same request now SUCCEEDS |
| S-goal-10-1 / S-goal-11-1/11-2 / S-goal-26-1 (dormant styling, `branches`) | **R-goal-38** — redefined per week, with one surface (R-goal-47) and no styling anywhere |
| R-goal-28 / D-8 `GOAL_HAS_OPEN_TASKS` (2 tests) | **R-goal-42** — the transition is unreachable; asserted as a SUCCESS |
| S-plan-* (whole file), `SavePlanRequest`, the plan-save race | **R-rm-2 / R-rm-3** — the entity, the screen and both endpoints are deleted. Q-3's guarantee moved to the delete cascade and is asserted there |
| S-nav-3-1 / R-nav-3 (a future week is refused) | **R-lens-7** — any future period is reachable and writable |
| R-nav-4 / D-24 (the 8-week clamp) | **R-rm-3** — `WEEK_HISTORY_WEEKS` retires as a bound; D-24 is satisfied by construction |
| `carryWeeks` never negative | **R-task-43** — the age is signed; nothing that renders changed, which is why it needs an assertion |
| S-task-15-1 (the item lands on the task's own goal) | **R-backlog-29** — it lands on the nearest non-Weekly ancestor |
| S-backlog-8-3 `BRANCH_NOT_ACTIVE` | **R-backlog-26** — `NO_WEEKLY_GOAL`, and no longer a dead end |
| S-task-9-1 (a dormant leaf shows its carried task) | **R-lens-12** — the carried band; the goal half moved with it |
| `selectableWeeks` | **R-lens-7** — no picker to enumerate and no bound in either direction |
| MCP `set_goal_focus` / `clear_goal_focus` / `save_weekly_plan` / `get_weekly_plan` / `list_goals` | **R-rm-2/3, R-lens-16** — asserted absent from `tools/list` |
| `week_history_weeks` on `get_account`, `goalcascade://tree*` | **R-rm-3, R-lens-16** — advertised bounds and reads that no longer exist |

---

## 7. What is left, and for whom

### For the web agent

`apps/web/**` is untouched and **will not compile against the new contract**. §5 is the precise list. The
five things most likely to bite, in order:

1. **`GET /goals` is no longer the tree.** It is `?lens=<horizon>&period=<periodKey>` and returns
   `LensResponse`. The client must stop holding the whole tree; `lifeRootId` is on every item so it never
   walks an ancestor chain (R-lens-16, S-lens-16-2).
2. **`carryWeeks` is signed** and still parses. Anything summing it, or re-parsing as `nonnegative`, is
   silently wrong. Use `completable` for the checkbox rather than re-deriving the date rule.
3. **`WeekOffset` accepts positives.** `selectWeek`'s `Math.min(0, offset)` clamp is the single line that
   makes the future unrepresentable client-side; it must go, and `CompleteTaskRequest` must keep its own
   bound.
4. **`period` is server-owned.** Sending one is now a 422 rather than a silently-ignored value.
5. **`POST /tasks` takes no week** and takes `newWeeklyGoal` instead of failing when no Weekly goal exists.

Not implemented here, deliberately, because they are UI-side: R-lens-17's Zoom sheet, R-lens-18's anchor,
R-lens-19's collapse, R-lens-21's off-now row, R-lens-23's parent line, R-lens-25's swipe. The server ships
what each needs (`GET /goals/zoom`, `PeriodView`, `LifeGroupView`, `hasForwardContent`, `parentId`).

### For the MCP agent

The surface is complete and green (36 tools, 9 resources, 4 prompts, 89 tests). `mcp/instructions.ts` was
**rewritten in full** and `docs/research/MCP-TOOL-SURFACE.md` §5 was updated in the same commit, so the
byte-equality test in `tests/mcp/verbatim.test.ts` still pins them — **the test was not weakened**. What
remains is judgement, not code: whether the instructions block's ~5 KB is the right length for a
connecting agent's context budget.

### Out of scope, and named so it is not mistaken for an oversight

**Manual backlog ordering (R-backlog-17 … R-backlog-24, `sortKey`, `POST /backlog/:id/reorder`)** is
surviving A1 work the delta says to re-plan into a build. It is not in this one: it touches
`backlog_items`, which A2 does not move, and it is a self-contained feature with its own migration,
encoding and keyboard-first accessibility contract. `ENDPOINTS.backlogItemReorder` and
`ReorderBacklogItemRequest` are **not** added, so nothing half-exists.

---

## 8. One place the spec contradicts itself, and the call I made

**S-lens-9-5 vs R-lens-9 — the Monthly → Weekly zoom.**

R-lens-9's reconciliation-pass amendment retires "the week containing the 1st" explicitly:

> *"The original text said 'the week containing the 1st' and accepted a Monday in the previous month. That
> is retired: R-goal-33 keys a week by its Monday, so zooming into `Nov 2026` would have landed on the week
> of Mon 26 Oct — a week every other rule counts as October's, including R-goal-47's planned-ness scope and
> R-task-49's target week. One Monday rule, three consumers, no disagreement."*

**S-lens-9-5 still asserts the retired behaviour** (Monthly `2026-09` → the week of Mon 31 Aug). It was
written before the amendment and was not updated with it; §6's retired-scenarios table does not list it.

I implemented **the rule**, per the spec's own rule of decision (the spec wins on rules), so
`zoomTo('Weekly', …)` returns the first week whose **Monday** falls in the month — `2026-09-07` for
September. The scenario is retired with a verdict in `tests/domain/periods.test.ts`. **Worth an explicit
ruling if the orchestrator disagrees**: it is the only place I chose a rule over a written scenario, and
reversing it means changing `firstMondayIn`'s use in `zoomTo` only — `weekForMonth`, R-goal-47's scope and
R-task-49's target week must keep the Monday rule regardless, or the three consumers disagree again.
