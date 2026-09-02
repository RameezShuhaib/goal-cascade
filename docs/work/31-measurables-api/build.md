# 31 — Amendment 8, the API half: month-level tasks and measurable tasks

Spec: `docs/SPEC.md` §2 (`R-task-51 … R-task-59`, `R-lens-31/32`, `R-backlog-30/31`,
`R-measure-1 … R-measure-9`, `R-rm-6`), §3's 49 scenarios, §6 Amendment 8.
Builder's summary: `docs/work/26-measurables/spec-delta.md`.
Mid-build hand-off: `docs/work/32-week-selection/UX-PLAN.md` §8.3 (A11), plus the owner's ruling on its
§9.2 — **`+ Task` on a Monthly goal defaults to the month.**

Two commits, deliberately:

| | Commit | Contains |
|---|---|---|
| 1 | `refactor: originPeriodKey, donePeriodKey, carryAge, and an explicit completion period` | the wide mechanical renames, no migration, no behaviour |
| 2 | `feat(api): month-level tasks and measurable tasks` | the schema, the migration, every rule, the MCP surface |

Green at the end: **655 api / 439 web / 132 shared**, typecheck clean across all three workspaces.
Floors were 562 / 431 / 113. Nothing deployed, nothing merged.

Two further commits answer two review passes; **§9 is their ledger**, and it marks which entries are
defects with a failing test and which are de-duplication or coverage — a distinction the first version of
that section got wrong about itself.

---

## 1. Schema

One migration, `0005_month_tasks_and_measures.sql`, with its Drizzle snapshot regenerated. Seventeen
statements, **and not one of them is an `UPDATE` or an `INSERT`** — see §6.

### `tasks`

| Change | Column | Note |
|---|---|---|
| rename | `origin_week_start` → `origin_period_key` | every stored value is a Monday and none changed |
| rename | `done_week_start` → `done_period_key` | same |
| add | `scope TEXT NOT NULL DEFAULT 'Weekly'` | **the default IS the backfill** — every task that existed hung off a Weekly goal (R-goal-39), so the constant is true of all of them and nothing is read |
| add | `measure_kind TEXT NULL` | `'counter' \| 'gauge'`; `NULL` ⇒ no measure |
| add | `measure_start REAL NULL` | REAL, not INTEGER: `78.5 kg` is the owner's example |
| add | `measure_current REAL NULL` | derived, maintained in the reading transaction, never client-supplied |
| add | `measure_target REAL NULL` | `NULL` is a legitimate no-target measure |
| add | `measure_unit TEXT NULL` | |

Indexes: `ix_tasks_open_week` → **`ix_tasks_open_period` `(user_id, status, scope, origin_period_key)`**
and the same for `done`. **`scope` between `status` and the key is the whole reason the column exists**:
`'2026-08' <= '2026-09-07'` is true as a string comparison and no index can key on the length of a
string, so without it a week read sweeps every month key on the way.

### Two more renames the spec-delta's §2.1 did not list, and why they are here

- `task_events.week_start` → **`period_key`**, with `ux_task_events_carried` keyed on it. A month task
  carries between months and earns the same `Carried to …` line at the month scale, so the uniqueness
  key that makes the lazy producer idempotent had to widen with it. The two scopes cannot collide: a
  month key and a Monday are never the same string.
- `backlog_items.from_week_start` → **`from_period_key`**. R-task-59 requires a month task's exit to
  render `from Sep 2026`, which is only expressible if the month is what is stored. It is **provenance
  on a row that has no period of its own** (R-backlog-30): nothing filters, sorts, ages or lenses on it.

### New table

```
task_readings(id PK, user_id → user ON DELETE CASCADE, task_id, value REAL, at, created_at)
ix_task_readings_task (user_id, task_id, at, id)
```

**No week, month, period or scope column, ever** (R-measure-5, S-measure-5-2). `task_id` carries no FK,
matching `task_links`/`task_events`; deletion is by the same Q-5 subtree-cascade batch, which
`GoalService.remove` now includes.

---

## 2. The contract the web agent consumes

Everything below is exported from `@goal-cascade/shared`.

### `TaskView` — four new fields, three renamed, one silently re-meant

```ts
TaskView = {
  id, goalId, title, cond, description, links, status, done, doneAt, exitReason, exitedAt,
  createdAt, updatedAt, version,                    // unchanged

  scope: 'Monthly' | 'Weekly',                      // NEW, required
  originPeriodKey: PeriodKeyParam,                  // was originWeekStart: WeekStart
  donePeriodKey: PeriodKeyParam | null,             // was doneWeekStart
  carryAge: number,                                 // was carryWeeks; still SIGNED
  carryUnit: 'weeks' | 'months',                    // NEW, required
  completable: boolean,                             // SAME NAME, NEW MEANING — see below
  measure: MeasureView | null,                      // NEW; null on most tasks
}

TaskDetailView = TaskView & { events: TaskEventView[]; readings: ReadingView[] }   // readings oldest first

MeasureView = {
  kind: 'counter' | 'gauge',
  start: number,
  current: number,           // DERIVED from the readings; never sent, never patchable
  target: number | null,     // null is a real measure with no finish line
  unit: string,              // '' when unset
  progress: number | null,   // null when target is null OR target === start. No division is performed.
}

ReadingView = { id, taskId, value, at }             // no period of any kind, ever

BacklogItemView.fromPeriodKey: PeriodKeyParam | null // was fromWeekStart; a month key for a month task
```

⚠ **`completable` is the one field whose name did not move and whose meaning did.** It is now the bound
**at the task's own scope**, so for a month task in the month band it answers about its **month**. A
client that assumes "this week" is reading a different sentence from the one being written.

⚠ **`carryAge` is honest at month scope and the band must suppress it, not the wire.** R-task-54 says a
month task wears no carry label of any kind inside a week (S-lens-31-2) — **the suppression belongs to
the render site**, because the same task in the Monthly lens must show its chip. Read `carryUnit` before
rendering any age; the string "weeks" is now wrong half the time.

### `LensResponse` — two new fields

```ts
tasks: TaskView[]            // Weekly lens: the week's tasks. Monthly lens: the MONTH's tasks (NEW).
                             // Empty on Life / Yearly / Quarterly, which hold no tasks.
monthTasks: TaskView[]       // NEW. WEEKLY LENS ONLY — the month band. Empty everywhere else,
                             // including Monthly, where the month's tasks are `tasks`.
monthPeriodKey: PeriodKey | null   // NEW. Weekly lens only; the band's month, by the MONDAY rule.
```

The Monthly lens has **no carried band**: a month task carries onto the same goal, so there is nothing to
separate it from. `monthTasks` are projected at **month scope** — their `carryAge`, `carryUnit` and
`completable` all answer about `monthPeriodKey`, which is what makes S-task-55-2's seam completion the
obvious thing to send. They are **not counted** in `LifeGroupView.openTasks` at any lens (S-lens-31-3).

`GoalDetailResponse.tasks` is now populated on a **Monthly** goal too (its month tasks), as well as
Weekly. Its doc comment was wrong from A8 and is corrected.

### Requests

```ts
CreateTaskRequest {
  goalId? | newWeeklyGoal?,          // exactly one, unchanged
  period?: PeriodKeyParam,           // NEW — the destination. See the table below.
  measure?: MeasureInput,            // NEW (Q-E) — attach a number in the same call
  title, cond, description, links, source
}

MeasureInput { kind, start = 0, target: number|null = null, unit = '' }   // no `current`, no direction flag

CompleteTaskRequest       { period: PeriodKeyParam, version? }   // was week: WeekOffset.max(0)
MoveTaskToBacklogRequest  { period: PeriodKeyParam, reason?, version? }   // was week: WeekOffset
RetargetTaskRequest       { period: PeriodKeyParam, goalId?, newWeeklyGoal?, version? }   // NEW
SetMeasureRequest         { measure: MeasureInput, version? }             // NEW
RecordReadingRequest      { value? XOR delta?, at?, version? }            // NEW
ConvertBacklogItemRequest { …, period?: PeriodKeyParam }                  // was week: WeekOffset.min(0)
```

**`period` is one field at two scopes and the key's FORMAT is the discriminator** (R-task-52) — the same
shape in create, Park and a backlog conversion, which is the coordinator's point (3). `CreateTaskRequest`
resolves it like this:

| `goalId`'s horizon | `period` | Result |
|---|---|---|
| Monthly | **absent** | a **month task on that goal** — the default, one row, nothing inferred |
| Monthly | a Monday | the `Add to this week` path: the Weekly goal under it is resolved; ≥2 → `AMBIGUOUS_CONVERSION_TARGET`; none → `NO_WEEKLY_GOAL` |
| Monthly | a different month, or a year/quarter key | `VALIDATION_FAILED` |
| Weekly | absent, or that goal's own week | a week task — unchanged |
| Weekly | anything else | `VALIDATION_FAILED` (moving between weeks is Park, not a create) |
| Life / Yearly / Quarterly | any | `NOT_A_TASK_GOAL` (409) |
| — (`newWeeklyGoal`) | a Monday | mint for **that** week |
| — (`newWeeklyGoal`) | absent | mint for the **current** week — the `+` drawer, unchanged |

⚠ **`newWeeklyGoal` can never fire as a side effect of accepting a default.** The month path creates
exactly one row; a Weekly goal is minted only when the request carries `newWeeklyGoal`, which the client
sends only after the owner named a week and the server refused. That is the defect R-rm-6 deletes.

### New endpoints

```
POST   /api/tasks/:id/retarget              RetargetTaskRequest  → RetargetTaskResponse { task, goal }
PUT    /api/tasks/:id/measure               SetMeasureRequest    → TaskResponse
DELETE /api/tasks/:id/measure                                    → TaskResponse
POST   /api/tasks/:id/readings              RecordReadingRequest → TaskResponse
DELETE /api/tasks/:id/readings/:readingId                        → TaskResponse
```

`ENDPOINTS.taskRetarget / taskMeasure / taskReadings / taskReading`. Every one returns the whole
`TaskDetailView`, so a reading invalidates the task **and** its lens row from one response.

### Errors

`NOT_A_WEEKLY_GOAL` is **removed**, not deprecated (R-rm-6): the string survives only in tombstone
comments that name its retirement. `NOT_A_TASK_GOAL` (409) takes its slot. Added:
`MEASURE_TARGET_EQUALS_START` (422), `MEASURE_KIND_MISMATCH` (422), `NO_MEASURE` (409).

### Calendar (`packages/shared/src/calendar/periods.ts`, both in the census)

- **`periodsBetween(horizon, from, to)`** — `weeksBetween`'s generalisation; the month scale `carryAge`
  is counted in. A malformed or wrong-horizon key answers `0`, never `NaN`: this value renders.
- **`taskWeeksInMonth(monthKey, today)`** — A11 §4.3's directive. The month's own Mondays, past weeks
  omitted. **`taskWeekForMonth` is now defined as this list's head**, proven by a test rather than a
  comment (`periods.test.ts`), so the default and the offer cannot come apart the way `weekForMonth` did.

---

## 3. What the renames touched

Commit 1 is 54 files and no migration. The wire renames are `originWeekStart → originPeriodKey`,
`doneWeekStart → donePeriodKey`, `carryWeeks → carryAge`, `fromWeekStart → fromPeriodKey`, and their MCP
snake_case twins. **DB column names were deliberately left alone in that commit** so it carries no SQL at
all: `schema.ts` kept `text('origin_week_start')` under the new property name, and the columns moved in
commit 2's single migration, as the spec-delta §2.4 asks.

The one change in commit 1 that could not be a pure rename is `week_offset → period` on `complete` and
`move-to-backlog`, in the shared schema, the service, the MCP tools and every test. An offset cannot
express *"the period I am standing in"* once a task may be scoped to a month (S-task-55-2), and the
`.max(0)` it inherited became `period <= currentPeriod`, re-stated in the service where the scope is
known. Commit 2 widened the two fields from `WeekStart` to `PeriodKeyParam`.

Tests rewritten with a per-test verdict (none weakened, none deleted):

| Test | Verdict |
|---|---|
| `contract.test.ts` "CompleteTaskRequest.week carries its OWN future guard" | R-task-55 — restated as "names an explicit period, never an offset"; the property moved to `apps/api/tests/tasks/exits.test.ts` and now asserts the code too |
| `exits.test.ts` "a future week is refused by the contract itself" | R-task-55 — "a future period is refused, now by the service" |
| `week-model.test.ts` S-goal-37-1 / S-goal-39-1 | R-task-51 — both asserted a **Monthly** goal refuses a task, which is now false. Restated as S-task-51-2 one horizon up: the trap is a childless **Quarterly** goal, and the point (the condition is the horizon, never leaf-ness) is unchanged. §6's own ledger lists these two as superseded. |
| `mcp/tools.test.ts` "NOT_A_WEEKLY_GOAL names the trap" | R-task-51 / R-rm-6 — same move, plus the recovery line now names the month path first |
| `contract.test.ts` S-rm-2-1 | R-rm-6 — `NOT_A_WEEKLY_GOAL` joins the four codes asserted ABSENT |
| `convert.test.ts` "the schema refuses a negative offset" | R-backlog-31 — there is no offset; the bound is `PERIOD_IN_PAST` in the service, at either scope |
| `domain/weeks.test.ts` | R-task-53/54 — every case restated at BOTH scopes; `isVisibleInWeek` → `isVisibleInPeriod` |
| `migration/weekly-horizon.test.ts` | 0003's SQL names two columns A8 renamed. The statements are read through one explicit `RENAMED_BY_A8` map, so the semantics asserted are unchanged and a change to 0003's SQL is still a change to what it asserts. |

---

## 4. The MCP surface

**37 → 43 tools.** Six added, none removed (A8's one removal is a web flow and an error code).

- **`retarget_task`** — Park / Move to the month, as ONE tool (Q-A): the direction comes from the task's
  scope and the key's format, so two tools would be one operation under two names.
- **`set_task_measure` / `clear_task_measure`** — attach or replace; remove takes every reading with it.
- **`record_reading` / `list_readings` / `delete_reading`** — append-only, individually deletable.

Changed: `list_tasks` gains `scope: week | month | all` and answers `month_period_key`; `create_task`
gains `period` and `measure` and is rewritten around "the month is the default"; `complete_task` and
`move_task_to_backlog` take `period` (**a breaking change with no compatibility path**, Q-B);
`convert_backlog_item_to_task` takes `period` and gains the month path; `taskOut` gains `scope`,
`carry_unit`, `measure` and `reading_count`, and `carry_label` renders in the task's own unit.

`goalcascade://week/current` and `week/{week_start}` gain `month_period_key` and `month_tasks` as a
**separate key** — an agent that merged them into `tasks` would report a month task as part of the week's
load and, worse, as late once weeks had passed.

**`SERVER_INSTRUCTIONS`**: four paragraphs rewritten (`ONLY WEEKLY GOALS HOLD TASKS` →
`MONTHLY AND WEEKLY GOALS HOLD TASKS`; `CARRYING`; `THE THREE EXITS`; `NO REPORTS` gains the measure
clause by name) and three added — `A TASK'S PERIOD, AND ITS SCOPE`, `A MONTH TASK IS NEVER LATE IN A
WEEK`, and `MEASURES`. The month-band paragraph earns its length: *"it has been three weeks"* is the most
natural thing for a model to say about a month task's carry age, and it is the opposite of the rule.

⚠ **The two byte-pins moved in one commit**, which is what `tests/mcp/verbatim.test.ts` exists to force:
`docs/research/MCP-TOOL-SURFACE.md` §5 and `SERVER_INSTRUCTIONS` are written from one source string by a
script, so they cannot be edited apart; `docs/BUSINESS-RULES.md` gained A11 §8.6's sentence and
`BUSINESS_RULES_MD` was regenerated from the file in the same change.

---

## 5. Open questions resolved

| # | Question | Ruling |
|---|---|---|
| Q-A | one `retarget_task` or a park/unpark pair? | **One.** The direction is decided by the task's scope and the key's format; a pair would be one operation under two names. |
| Q-B | does `complete_task` keep `week_offset`? | **No**, and no compatibility path. Two code paths and an ambiguity for an agent to get wrong. |
| Q-C | does the Monthly lens paginate its tasks? | **Yes, at `MAX_PAGE`**, through the same `listVisibleInPeriod`. |
| Q-E | can a measure be attached at create? | **Yes**, `CreateTaskRequest.measure`, logging `Measure added` in the same batch. |
| Q-F | what happens to a month task when its goal is re-planned? | **Nothing.** `originPeriodKey` is the task's own field; the goal moves alone. No code was written for this, which is the point. |
| Q-G | does the month band show *done* month tasks? | **Yes**, for the month they were completed in — R-task-53 unchanged at month scope. |
| — | `fromWeek` null, or the month? | S-task-59-1 says "`fromWeek` is `null`" **and** "renders `from Sep 2026`", which cannot both hold on one field. Resolved as the spec-delta §2.5 states it: the column is renamed `from_period_key` and carries the **month**. There is no week, which is what "null" meant. |
| — | which conversion field? | `ConvertBacklogItemRequest.week` (an offset) became `period`, for consistency with create and Park — one answer in this product to "which period does this land in". Absent still means the current week, so the `+` drawer is unchanged. |
| — | where does the "resolve a Weekly goal for a week" rule live? | Extracted to `application/services/weekly-target.ts`. A8 gives it a **third** caller (Park) and A11 a fourth (`+ Task` with a week); three private copies of a resolution whose refusals are `AMBIGUOUS_CONVERSION_TARGET` and `NO_WEEKLY_GOAL` is three chances for one to pick silently, which is exactly what R-rm-6 deletes a flow for. |
| — | one migration or two? | **One.** Commit 1 renamed TS identifiers only and carries no SQL, so §2.4's "one migration, one journal entry, one snapshot" survives the commit split. |

---

## 6. The migration, and the defect class it was checked against

**This migration transforms no data, and that is the whole of its replay-safety argument.** 0003 shipped
an `UPDATE … CASE … ELSE ''` whose replay wiped the `period_key` of every Weekly goal it had just minted —
a bug that exists only because a migration read a value and wrote an interpretation of it. There is not
one `UPDATE` or `INSERT` in `0005`: a rename moves a name, `DEFAULT 'Weekly'` fills a new column with a
constant true of every existing row, and the five measure columns are born NULL. That is asserted over
the SQL text in `tests/migration/month-tasks-and-measures.test.ts`, which is the only place it can be.

Statements 4–5 (`DROP INDEX` / `CREATE INDEX` / `CREATE TABLE`) carry `IF EXISTS` / `IF NOT EXISTS` and
are individually re-runnable; the test runs them twice and asserts an identical `PRAGMA` end state.
Statements 1–3 are `ALTER TABLE … RENAME COLUMN` / `ADD COLUMN`, for which **SQLite has no conditional
form at all** — their replay safety is wrangler's journal, which is the mechanism that actually runs on
deploy.

### Double-apply against a scratch D1 — evidence

The production shape was seeded **at 0004** (journal temporarily trimmed, `0005` held back), so the
rename and the adds ran against real rows rather than an empty table:

```
$ wrangler d1 migrations apply goal-cascade-db --local        # 0000…0004
$ wrangler d1 execute … --file seed.sql                       # 5 goals, 3 tasks, 23 backlog items
$ wrangler d1 execute … --command "SELECT COUNT(*) …"         # g=5  t=3  b=23
$ wrangler d1 migrations apply goal-cascade-db --local        # 0005 → 17 commands executed successfully
$ wrangler d1 execute … --file dump.sql  > after1.json
$ wrangler d1 migrations apply goal-cascade-db --local        # ✅ No migrations to apply!
$ wrangler d1 execute … --file dump.sql  > after2.json

IDENTICAL: True
sha256 A: ac454954ddbbf4c055d933e9eab1db2f
sha256 B: ac454954ddbbf4c055d933e9eab1db2f
```

Re-run from a clean `.wrangler` state after the review fixes of §9 (which touch no SQL), the same
double-apply is identical again at `f3577b425c026a84fe391255`.

The dump covers `sqlite_master` for the four affected tables and their indexes, plus every row of
`goals`, `tasks`, `task_events` and `backlog_items`. After the first apply:

- counts unchanged — **5 goals, 3 tasks, 23 backlog items, 1 task event, 0 readings**;
- all three tasks came out `scope = 'Weekly'` with `origin_period_key` still `2026-08-17` / `2026-08-24` /
  `2026-08-31`, the done one keeping `done_period_key = 2026-08-24` and its `done_at`;
- every `measure_*` column NULL — nothing invented a measure;
- the backlog item that had a `from_week_start` kept its value under `from_period_key`;
- indexes are `ix_tasks_open_period`, `ix_tasks_done_period`, `ix_tasks_goal`, `ix_task_readings_task`,
  `ux_task_events_carried`; the two `_week` names are gone.

`npm run db:generate` reports **"No schema changes, nothing to migrate"** against `meta/0005_snapshot.json`,
which is the proof that the hand-written SQL and `schema.ts` agree. (The snapshot was built from 0004's by
script rather than by drizzle-kit's prompts, which need a TTY; the `generate` run is the check on it.)

---

## 7. Three defects the new tests found in this build

Recorded because each was a plausible-looking line that the suite caught and a review would not have.

1. **`assertPeriodFor` compared periods without checking the key's FORMAT.** `'2026-08-31' >= '2026-08'`
   and `'2026-08-31' <= '2026-09'` are both true, so a **Monday satisfied both completion bounds for a
   month task** — and would have been stamped into `done_period_key`, where no month lens could ever
   match it again. The scope check is now the first thing that function does.
2. **"the current period" for a month task was taken as the month the current WEEK belongs to.** That is
   the *band's* question (R-lens-31), not R-goal-34's. On 2 Sep the two differ (Aug vs Sep), and the wrong
   one made a September month task **un-completable for the whole first week of September** and negatively
   aged in its own month. Split into `periodForScope` (which month does this week belong to) and
   `currentPeriodOf` (what is the current period, from today) — the `zoomWeekForMonth` /
   `taskWeekForMonth` lesson, one amendment later.
3. **`ensureCarried` never ran for a month task.** It was called only from `GET /tasks?week=` and the task
   page, and a month task appears in neither, so `Carried to Sep 2026` would have existed in the spec and
   nowhere else. The Monthly lens is now a second producer surface, and the producer takes an explicit
   scope plus a period *in* it rather than converting a week internally.

### One behaviour worth flagging to the web agent

On **Wed 2 Sep 2026** the month band shows **August's** tasks (the current week is Mon 31 Aug), but
`Aug 2026` is a **past month for planning**, so `+ Task` in that band must create into the **current or a
later** month — which is R-lens-31's own wording. A past period is closed to *plan* and to nothing else,
so an August month task can still be completed from that band (S-task-55-2), parked, moved to backlog and
cancelled. It simply cannot be born there. The API enforces exactly this; the band's `+ Task` needs to
target the current month, not `monthPeriodKey`.

---

## 8. Files `apps/web/**` changed, and why each was forced

| File | Change |
|---|---|
| `src/api/queries.ts` | `useCompleteTask` / `useMoveTaskToBacklog` / `useConvertBacklogItem` resolve their existing `week` offset to a Monday through `useWeekClock`. Call sites unchanged. |
| `src/lib/errorCopy.ts` | `case 'NOT_A_WEEKLY_GOAL'` → `'NOT_A_TASK_GOAL'`; the code no longer exists |
| `src/lens/copy.ts` | `TASKS_LIVE_ON_WEEKLY_GOALS` → `TASKS_LIVE_ON_TASK_GOALS`, `'Tasks live on monthly and weekly goals.'` |
| `src/lib/queryClient.ts` | one comment naming the retired code |
| `tests/msw/fixtures.ts` | `TaskView` gained four required fields and `LensResponse` two |
| `tests/api/http.test.ts`, `tests/screens/backlog.test.tsx` | the retired code, and the `week` → `period` payload |
| `src/utils/dates.ts` | ⚠ **review fix** — `periodOfLabel` / `periodFromLabel` / `monthSinceLabel`, so a month key does not render `NaN` (§9.4) |
| `src/components/BacklogItemCard.tsx`, `src/screens/TaskPage.tsx`, `src/components/TaskRow.tsx` | ⚠ **review fix** — the three call sites that met a month key, one line each |
| `tests/utils/periodLabels.test.ts`, `tests/screens/weeklyLens.test.tsx` | ⚠ **review fix** — the render-level guards for the above |

No component, screen, sheet or lens file was touched. `R-rm-6`'s removals (`MonthlyCard`'s target week,
`LinkRow`'s `newWeekly` fork, `TaskCreateSheet`'s implicit-goal path, `implicitWeeklyGoalNote`) are all
web-side and are left for the UI agent, as are `MonthBand`, `MeasureBlock`, `Sparkline`, `ReadingsList`
and `CarryLabel`'s suppression flag.

`taskWeekForMonth` **survives** with its census entry and its tests: A8's R-rm-6 text predates A9's split
and names `weekForMonth`, and `S-lens-9-7` still requires both functions to be declared under
`packages/shared/src/calendar/`. Its last caller may go with `MonthlyCard`; the function does not.

---

## 9. The review pass — six defects, four hardening items

A code-quality review of the two commits above found six defects with concrete failure scenarios. Each of
the **six** is fixed with a test proven to fail first; none of the existing tests was weakened.

⚠ **Two of §9.7's four hardening items are de-duplication and coverage, not defects, and the first
version of this section claimed otherwise.** `setMeasure`'s `.at(-1)` was correct for every input (see
its entry), and `retarget_task` already took `PeriodKeyParam`, so §9.3's Park round-trip test is coverage
of a path that worked rather than proof of one that did not. **In this repo a doc block is the review's
primary evidence, and a false one is precisely how §9.1 shipped green** — `views.ts` described that bug
in prose while the code committed it. An over-claimed ledger entry is the same failure one layer up.

### 9.1 (severe) Four read models computed "the current month" from the current WEEK

`goal.service.ts` (the Monthly lens's `tasks`, the Weekly lens's `monthTasks`, a goal's detail page) and
`backlog.service.ts` (a conversion's response) passed `periodKeyOf('Monthly', ctx.currentWeekStart)` as
`toTaskView`'s `currentPeriodKey`. `views.ts:159` names this exact failure in prose — and the code did it
anyway, at four sites, in the same commit that wrote the warning.

**On 2 Sep 2026** the current week is Mon 31 Aug, so the month-of-the-current-week is `2026-08` while the
current month is `2026-09`. A month task created on a September goal therefore came back
`completable: true` from the create and `completable: false, carryAge: -1` from the lens one read later —
**the wire telling the client to hide a checkbox for a write the server then accepts.** Worse, an
Aug-origin task read `carryAge: 0` in the September lens while `ensureCarried` (which clamps correctly)
had already written `Carried to Sep 2026` onto its timeline: two halves of one response disagreeing.

The window is the **1–6 days of every month before its first Monday** — where the owner is today. Fixed
by using `currentPeriodOf(ctx, scope)` at all four sites; `periodForScope` is now down to its **one**
legitimate caller (`TaskService.get`, which really is answering the band's question) and its doc block
says so by name. Five tests in `month-tasks.test.ts`, all five failing before the fix.

### 9.2 `MEASURE_TARGET_EQUALS_START` was never emitted — and MCP bypassed the rule entirely

The refusal lived in a Zod `.refine()` whose *message* was the code, and `api/validate.ts` flattens every
schema failure to `VALIDATION_FAILED`. So the code sat in `ERROR_STATUS` with an MCP recovery entry and
was never emitted, while the web — which renders `issues[0].message` verbatim — showed the owner a toast
reading literally `MEASURE_TARGET_EQUALS_START`.

Chasing it turned up worse: **a Zod refinement guards `/api/*` and nothing else.** The MCP tools declare
their own input schemas, so `set_task_measure` handed `start === target` straight through to a service
that never checked — writing a `5 / 5` measure with no progress and logging
`Measure added: counter, 5 → 5`. The rule now has **one enforcement point**, `TaskService.assertMeasure`,
reachable from every front door, in the shape `assertTaskGoal` already has for R-task-51. The shared
contract test was rewritten with a verdict: the schema owns a target's *shape*, the service owns whether
it names movement.

### 9.3 Month tasks could not be completed or backlogged over MCP at all

`complete_task` and `move_task_to_backlog` typed `period` as `WeekStart`, so `'2026-09'` failed the input
schema and the default (a Monday) was refused by the scope check — **no reachable value worked**, on a
surface whose `create_task` actively steers agents into creating month tasks. A surface that can only
create is worse than one that cannot: it accumulates work the agent can never close. Widened to
`PeriodKeyParam`, and the default is resolved **inside the service**, where the task is already loaded
(see §9.8). `move_task_to_backlog`'s description no longer claims the item goes "above its week", and its
TITLE no longer does either. Four MCP tests — three of them proof, and the Park round-trip **coverage**:
`retarget_task` already took `PeriodKeyParam`, so that path was never broken.

### 9.4 `from week of NaN Aug` in the web backlog

`shortDate`, `weekLabel` and `weekOfLabel` all split a `YYYY-MM-DD` for its day segment; handed a month
key the segment is `undefined` and the owner reads `NaN`. Reachable **today**, through the flow
S-task-59-1 is itself about. `common.ts` promised `from Sep 2026` for this case and nothing implemented
it. Added `periodOfLabel` / `periodFromLabel` / `monthSinceLabel` to `utils/dates.ts` — each importing
the server's own `labelOf` rather than re-implementing it (R-lens-30) — and wired the three call sites.
`CarryLabel` now reads `carryUnit` instead of hardcoding "weeks". Render-level tests on the backlog card
and the carry chip, both proven to fail against the old call sites.

### 9.5 MCP `list_tasks` handed agents "2 months · since Jun" for a month task in a week listing

`shapes.ts` states that a month task says nothing at all inside a week and that the suppression belongs to
the surface; `list_tasks` **is** that surface and applied none, one field below an instructions block
promising A MONTH TASK IS NEVER LATE IN A WEEK. `taskOut` takes a `suppressCarryLabel` flag and the week
listing passes it for month rows. `carry_age` and `carry_unit` stay honest — an agent asked *"how long has
this been open"* can still answer; what it cannot do is find a ready-made late-sounding sentence.

### 9.6 The test that let 9.2 ship green

`expect(JSON.stringify(body)).toContain('MEASURE_TARGET_EQUALS_START')` passes when the name appears
anywhere — including as a Zod issue message inside a `VALIDATION_FAILED` envelope. Now `codeOf(res)`, like
the rest of that file, on both the create and the edit path.

### 9.7 Four hardening items

- **`weekly-target.ts` bypassed `MAX_WEEKLY_GOALS_PER_WEEK`.** A real defect, with a test proven to fail. The cap lived on `TaskService`'s own copy
  of `mintWeeklyGoal`, so the backlog conversion had always skipped it and **Park inherited the bypass**
  when the rule was extracted. Moved into the shared resolver, where all three inline-create paths meet
  it. A rule enforced by whichever caller remembered is a rule with a hole in it.
- **`deleteReading` was missing `assertNotExited`.** Its five siblings all refuse an exited task (D-15), so
  a cancelled task's readings were the one thing in the product still mutable after the exit — and a
  deletion leaves no trace to notice it by (R-measure-7). A real defect, with a test proven to fail.
- **`setMeasure` spelled "the latest surviving reading" a second way**, as `readings.at(-1)?.value`.
  ⚠ **De-duplication, NOT a bug fix, and the first version of this entry got that wrong.**
  `D1ReadingRepo.listByTask` orders `asc(at), asc(id)`, so the last element **is** the max by `(at, id)`
  for every input — back-dated readings included — and the test written for it passed against the
  unfixed code. The claim that "a back-dated reading is where they come apart" was false and is
  withdrawn. What the second spelling lacked was robustness: it was correct only for as long as that
  `ORDER BY` stayed exactly what it is, and nothing declares the reading list's order load-bearing
  beyond the sparkline. `currentFrom` states the rule rather than depending on it, and the test stands
  as coverage of the property (a back-dated reading never becomes `current`) rather than as proof of a
  regression.
- **`park()`'s dead `void today;`** and its unused parameter, plus two imports left dangling by the fixes.

### 9.8 A second review pass — seven items, and one claim of mine that was wrong

- ⚠ **The `setMeasure` entry in §9.7 over-claimed and is corrected there.** See that entry: the
  verifier ran the test against the unfixed code and it passed, because `.at(-1)` really is
  `currentFrom` under the repository's ordering. The change stands as de-duplication.
- **The task page's back control named a month and went to a week.** `lensPath('Weekly', '2026-08')`
  is `/week/2026-08`, which `validKeyFor` drops as non-canonical, landing on the current week. A8 had
  fixed the LABEL and left the destination, which is worse than the state before it — both halves were
  visibly broken then, and neither could be trusted. `lensPathForScope` makes them one fact, at both
  call sites (`TaskPage`, `TaskSheets`).
- **Completing a month task from its own page posted a Monday**, refused `WEEK_OUT_OF_RANGE` — the
  scope check doing its job on a payload the client got wrong. `useWeekClock.periodFor(scope, offset)`
  is the one spelling, used by the page, the row and the exit sheet. Pre-existing and low
  reachability, but real against live data, so it is fixed here rather than routed on.
- **`MEASURE_TARGET_EQUALS_START`, `MEASURE_KIND_MISMATCH` and `NO_MEASURE` had no `errorCopy` case**
  and fell to `default:` — "Couldn't save — try again.", advice that cannot work on a 4xx. Added now
  rather than with the measures UI, because a code with no copy is invisible until it is in front of
  the owner.
- **`move_task_to_backlog`'s TITLE still said "above its week"** under a description that had been
  corrected. A title is what an agent reads in `tools/list`, often without the description under it.
- **Three stale doc blocks** claiming the `target === start` refusal lives in a schema refinement
  (`tasks.routes.ts`, `domain/measures.ts`, `common.ts`), and one citing a `views.test.ts` that does
  not exist. The real pin is `tests/tasks/month-tasks.test.ts`'s `R-goal-34` block.
- **Seven dangling imports** across the three services this branch touched; only `labelOf` in
  `task.service.ts` went dangling here, the rest predate it.
- **The MCP default-period path cost two D1 round trips plus a lazy write** to learn one enum. Moved
  into `TaskService.assertPeriodFor`, which is downstream of `load()` and has the task in hand — so
  `/api/*` still requires the client to name its period (R-task-55) while an agent, which has no
  surface to be standing on, gets the current one at the task's own scope for free.

**Not done, and flagged rather than decided:** `noUnusedLocals` in `tsconfig.base.json` would have
caught the dangling imports and the dead `void today;`. It is not added here because it would light up
files this branch never touched, and that is a repo-wide call rather than an amendment's.
