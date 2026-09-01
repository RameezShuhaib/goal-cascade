# Spec delta — tasks at the month, and measurable tasks (Amendment 8)

Authority: `docs/SPEC.md` §2 (`R-task-51 … R-task-59`, `R-lens-31`, `R-lens-32`, `R-backlog-30`,
`R-backlog-31`, `R-measure-1 … R-measure-9`, `R-rm-6`), §3 (`S-task-51-1 …`, `S-measure-1-1 …`),
§4 (`Q-25 … Q-28`), §6 Amendment 8. `docs/BUSINESS-RULES.md` is the owner's prose and ships verbatim
over MCP — **it is byte-pinned and the constant must be regenerated in this same change** (§6 below).

Two features, one unit. They land on the same table and would otherwise be two migrations of `tasks`.

---

## 1. What changes, in one paragraph each

**Tasks at the month.** A task's parent may now be a **Monthly** or a **Weekly** goal. Its week
generalises to a **period at a scope**: `scope ∈ { Monthly, Weekly }` and `originPeriodKey` in that
scope's canonical format. Carry, visibility and completion are the same three comparisons they were,
made within one scope — a month task carries into the next month exactly as a week task carries into
the next week, with no write and no job. A month task appears in the Monthly lens and in the **month
band** of every week of its month, where it wears no late styling of any kind; between *months* it
earns the ordinary chip in months. One new operation, **Park** (`retarget`), moves a task between the
two scopes in both directions. `+ Task` on a Monthly goal creates **one row** and infers nothing —
which retires R-task-49's built inference and everything it needed.

**Measurable tasks.** A task carries an optional `measure`: `kind ∈ { counter, gauge }`, `start`,
`current`, `target | null`, `unit`. A checkbox is `measure = null` — there is no third kind. `current`
is **derived** from an append-only, individually deletable list of **readings**, each storing an
**absolute** value; a counter's `+3` is resolved to an absolute before storage, which is what makes
deletion correct with one rule for both kinds. Progress is `(current − start) / (target − start)`;
`target == start` is refused, and if it exists anyway no division is performed. Readings are keyed by
`taskId` alone and survive carrying, parking, completion and unchecking. Completion stays independent
of the target in both directions, and nothing anywhere computes a pace, a projection, a trend or a
roll-up.

---

## 2. Migration and compatibility

### 2.1 `tasks` — renames, one new column, five nullable columns

`apps/api/src/infrastructure/persistence/schema.ts:218-258`

| Change | Column | Note |
|---|---|---|
| **rename** | `origin_week_start` → `origin_period_key` | **Every existing value is a Monday and is unchanged.** Only the name and the format's domain widen. |
| **rename** | `done_week_start` → `done_period_key` | Same — values untouched. |
| **add** | `scope TEXT NOT NULL DEFAULT 'Weekly'` | Backfill `'Weekly'` for every existing row; every existing task hangs off a Weekly goal. |
| **add** | `measure_kind TEXT NULL` | `'counter' \| 'gauge'`; `NULL` ⇒ no measure (R-measure-1). |
| **add** | `measure_start REAL NULL` | |
| **add** | `measure_current REAL NULL` | Derived (R-measure-3), maintained in the reading transaction, never client-supplied. |
| **add** | `measure_target REAL NULL` | `NULL` is a legitimate no-target measure — distinguish from "no measure" by `measure_kind IS NULL`. |
| **add** | `measure_unit TEXT NULL` | |

Invariant to assert in the domain and in one test: `measure_kind IS NULL` ⇔ all five measure columns
are `NULL`; and `scope = 'Weekly'` ⇔ `origin_period_key` is a Monday, `scope = 'Monthly'` ⇔ it matches
`^\d{4}-(0[1-9]|1[0-2])$`. There is no SQL `CHECK` in this schema (only `_guard`), so this is an
application invariant, like the Weekly-only rule it replaces.

### 2.2 Indexes

| Was | Becomes | Key |
|---|---|---|
| `ix_tasks_open_week` | `ix_tasks_open_period` | `(user_id, status, scope, origin_period_key)` |
| `ix_tasks_done_week` | `ix_tasks_done_period` | `(user_id, status, scope, done_period_key)` |
| `ix_tasks_goal` | unchanged | `(user_id, goal_id, status)` |

`scope` leading `origin_period_key` is why it is stored at all (R-task-52): a week read and a month
read must not scan each other's rows, and no index can key on the length of a string.

### 2.3 New table `task_readings`

Mirrors `task_links` / `task_events` structurally.

```
id TEXT PK, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
task_id TEXT NOT NULL, value REAL NOT NULL, at TEXT NOT NULL, created_at TEXT NOT NULL
ix_task_readings_task (user_id, task_id, at, id)
```

**No week, month, period or scope column, ever** (R-measure-5, `S-measure-5-2`). `task_id` carries no
FK, matching `task_events`/`task_links`; deletion is by the same subtree-cascade batch.

### 2.4 Migration order (one migration, one journal entry, one snapshot)

1. `ALTER TABLE tasks RENAME COLUMN origin_week_start TO origin_period_key;` and the same for `done_`.
2. `ALTER TABLE tasks ADD COLUMN scope TEXT NOT NULL DEFAULT 'Weekly';` then the five measure columns.
3. Drop `ix_tasks_open_week` / `ix_tasks_done_week`; create the two `_period` indexes.
4. `CREATE TABLE task_readings` + its index.
5. Regenerate the Drizzle journal and snapshot.

**No data is transformed and nothing is guessed** — unlike Q-18's `period` backfill, this migration
reads no value and writes no interpretation. It is reversible up to the column names.

### 2.5 Contract fields that move

| Field | Was | Becomes | Break |
|---|---|---|---|
| `TaskView.originWeekStart` | `WeekStart` | `TaskView.originPeriodKey: PeriodKeyParam` | **Renamed and widened.** A client reading `originWeekStart` breaks loudly (missing key), which is the right failure. |
| `TaskView.doneWeekStart` | `WeekStart \| null` | `TaskView.donePeriodKey: PeriodKeyParam \| null` | Same. |
| — | — | `TaskView.scope: 'Monthly' \| 'Weekly'` | New, required. |
| `TaskView.carryWeeks` | `z.int()`, signed since A2 | `TaskView.carryAge: z.int()` + `TaskView.carryUnit: 'weeks' \| 'months'` | **Renamed.** `carryWeeks` on a month task would be a lie in the same shape A2's silent break already warned about; renaming forces every render site to be visited. |
| `TaskView.completable` | boolean | unchanged in name, **generalised in meaning** — R-task-55's bound at the task's own scope | **Silent semantic break.** Called out here because the type does not move. |
| — | — | `TaskView.measure: MeasureView \| null` | New. `MeasureView = { kind, start, current, target, unit, progress: number \| null }`. |
| — | — | `TaskDetailView.readings: ReadingView[]` | New; oldest first. Detail only — a lens row needs `current`/`target`, not the history. |
| `LensResponse.tasks` | Weekly lens only | also populated for the **Monthly** lens (R-lens-32) | Additive. |
| — | — | `LensResponse.monthTasks` + `LensResponse.monthPeriodKey` | New, **Weekly lens only** — R-lens-31's band and the month its week belongs to. `null` on every other lens. |
| `GoalDetailResponse.tasks` | "empty for every other horizon" | populated on **Monthly** and **Weekly** | The doc comment is wrong from A8 and must be edited, not left. |
| `GoalView.weeklyBreakdown` | `{ weeklyGoals, thisWeek } \| null` | unchanged in shape; R-goal-47's new `No weeks yet` case is a **client** copy branch on `weeklyGoals === 0 && the card has tasks` | No wire change. |
| `BacklogItemView.fromWeek` | `WeekStart \| null` | `fromPeriodKey: PeriodKeyParam \| null` | Renamed; a month task's exit sets a **month** (R-task-59). Label renders `from week of …` or `from Sep 2026` off the format. |

### 2.6 Validation that moves

| Where | Was | Becomes |
|---|---|---|
| `TaskService.assertWeeklyGoal` (`task.service.ts:500-510`) | `goal.horizon !== 'Weekly'` → `NOT_A_WEEKLY_GOAL` | `assertTaskGoal`: `!['Monthly','Weekly'].includes(goal.horizon)` → **`NOT_A_TASK_GOAL`**. **This is the whole enforcement point** — the rule lives in exactly one guard and nowhere in SQL. |
| `CreateTaskRequest` (`commands.ts:394-408`) | `.strict()` refuses `week`/`weekOffset`; XOR `goalId` / `newWeeklyGoal` | **unchanged**, and must stay so (`S-task-52-2`). The scope comes from the goal. |
| `CompleteTaskRequest.week` (`commands.ts:433`) | `WeekOffset.max(0)` | `period: PeriodKeyParam` — an **explicit canonical key**, not an offset. R-task-55's seam case (`S-task-55-2`) requires the client to name the period it is standing in; an offset cannot express "the August month band, on 2 September". `.max(0)` becomes `period ≤ currentPeriod(scope)` in the service. |
| `MoveTaskToBacklogRequest.week` | `WeekOffset` | same change, same reason. |
| `PatchTaskRequest` | `{ title?, cond?, description?, version? }` | unchanged — **no measure fields**; a measure is set by its own command so its events are unambiguous. |
| `assertCanHoldBacklog` (`backlog.service.ts:244-256`) | refuses Life and Weekly | **unchanged.** Monthly holds both a backlog and tasks, deliberately (R-backlog-30). |
| `TaskService.nearestBacklogHost` (`task.service.ts:570-591`) | walks up from a Weekly goal | **terminates immediately for a month task** — the goal it is on can hold backlog (R-task-59). Add the scope branch; keep `LIFE_GOAL_NO_BACKLOG` for the week case. |
| `mintWeeklyGoal` × 2 (`task.service.ts:527`, `backlog.service.ts:789`) | `HORIZON_CONFLICT` on a Weekly parent | unchanged; two callers instead of three (R-rm-6). |
| — | — | New: `MEASURE_TARGET_EQUALS_START` (422) on set/edit; `MEASURE_KIND_MISMATCH` (422) on a delta against a gauge; `NO_MEASURE` (409) on a reading against a measureless task; finite/`≤1e9` numeric floor. |

### 2.7 Error catalogue

`packages/shared/src/errors.ts:63` — `NOT_A_WEEKLY_GOAL` is **removed**, not deprecated (R-rm-6).
`NOT_A_TASK_GOAL` (409) takes its code slot and its recovery text (`apps/api/src/api/mcp/errors.ts:40`)
is rewritten: *"That goal's horizon holds no tasks. Tasks live on **monthly and weekly** goals — the
horizon and nothing else. `details` carries the horizon."* Three codes added, all above. Contract
assertion `packages/shared/tests/contract.test.ts:62,69` and the client mapping
`apps/web/src/lib/errorCopy.ts` + `apps/web/tests/api/http.test.ts:112-137` follow.

---

## 3. Blast radius — exhaustive

### 3.1 Shared (`packages/shared`, 112 tests green today)

| File | Change |
|---|---|
| `src/common.ts:497-524` | `TaskView` — the six field changes in §2.5; new `MeasureView`, `ReadingView`, `TaskScope`, `CarryUnit`. |
| `src/common.ts:537+` | `BacklogItemView.fromWeek` → `fromPeriodKey`. |
| `src/commands.ts:394-464` | `CompleteTaskRequest`, `MoveTaskToBacklogRequest` take a `period`; new `RetargetTaskRequest`, `SetMeasureRequest`, `ClearMeasureRequest`, `RecordReadingRequest` (XOR `value` / `delta`), `DeleteReadingRequest`. |
| `src/read-models.ts:62-264` | `LensResponse.monthTasks` / `.monthPeriodKey`; `TaskDetailResponse` carries readings; `GoalDetailResponse.tasks`' doc comment. |
| `src/errors.ts:63` | the code swap + three additions. |
| `src/endpoints.ts` | `taskRetarget`, `taskMeasure`, `taskReadings`, `taskReading`. |
| `src/calendar/*` | **no change.** `periodKeyOf`, `stepPeriod`, `isPastPeriod`, `weekRangeOf` already answer everything month scope needs; `weeksBetween` gains a sibling `periodsBetween(horizon, a, b)` for R-task-54's month age — *in `calendar/periods.ts`, and nowhere else* (`S-lens-30-14` forbids a second declaration). |
| `src/common.ts:152` `MAX_PAGE` | unchanged; `MAX_READINGS = 2000` added (Q-26). |

### 3.2 API — services

| File | Change |
|---|---|
| `application/services/task.service.ts` | `assertWeeklyGoal` → `assertTaskGoal` (the one guard, §2.6). `create` seeds `scope` + `originPeriodKey` from the goal. `complete`/`uncheck`/`moveToBacklog` take a `period` and bound it at the task's scope. `nearestBacklogHost` gains the month branch. **New:** `retarget`, `setMeasure`, `clearMeasure`, `recordReading`, `deleteReading` — the last two maintain `measure_current` in the same transaction. |
| `application/services/backlog.service.ts` | `convert` gains the **month** target (R-backlog-31): no `resolveConversionTarget` call, no ambiguity, no `NO_WEEKLY_GOAL`. The week path (`resolveConversionTarget`, `buildTaskWrites`, `mintWeeklyGoal`) is untouched. |
| `application/services/views.ts:121` | `toTaskView` — scope-aware `carryAge`/`carryUnit`, `completable`, and the measure projection (progress omitted when `target` is `null` **or** `target === start`). |
| `application/services/goal.service.ts` | lens read returns month tasks for the Monthly lens; the Weekly lens read additionally fetches the month band keyed by `periodKeyOf('Monthly', viewedMonday)`. Delete cascade takes readings. `assertCapacity` unchanged. |
| `application/services/activity-log.ts` | `ensureCarried` gains the **month** form, clamped at the current month; six new event kinds' copy builders. |
| `domain/weeks.ts:48-68` | `carryWeeks`/`isVisibleInWeek` become scope-parameterised (`carryAge`, `isVisibleInPeriod`). This is **policy** and stays out of `packages/shared/calendar` by that file's own stated rule. |
| `domain/enums.ts:23-60` | `TASK_EVENT_KINDS` += `parked`, `unparked`, `measure_added`, `measure_edited`, `measure_removed` (the month form of `carried` reuses `carried`); glyphs `→ → ✎ ✎ ✎`. |
| `domain/entities.ts` | `Task` gains `scope`/`measure`; new `Reading`. |
| `application/ports/repositories.ts` | `ITaskRepo` — `listVisibleInWeek` → `listVisibleInPeriod(scope, key)`; new `IReadingRepo`. |
| `infrastructure/persistence/d1-task.repo.ts:48-65` | the visibility query gains `scope` in its predicate; `D1ReadingRepo` added; `ux_task_events_carried` unique index now keys on the period, not the week. |
| `infrastructure/di` | one registration for `IReadingRepo`. |

### 3.3 API — routes

`api/routes/tasks.routes.ts` — `POST /tasks/:id/retarget`, `PUT /tasks/:id/measure`,
`DELETE /tasks/:id/measure`, `POST /tasks/:id/readings`, `DELETE /tasks/:id/readings/:readingId`.
`POST /tasks/:id/complete` and `/move-to-backlog` take `period` instead of `week`.
`api/routes/backlog.routes.ts` — `POST /backlog/:id/convert-to-task` accepts a month target.
`api/routes/goals.routes.ts` — no signature change; two payload fields.

### 3.4 MCP surface (`apps/api/src/api/mcp/`) — 33 tools today

| Item | Change |
|---|---|
| `tools/tasks.ts:84-110` `create_task` | title and description rewritten: *"Add a task under a **monthly or weekly** goal."* The `NOT_A_WEEKLY_GOAL` paragraph is replaced wholesale. |
| `tools/tasks.ts:157` `complete_task` | `week_offset` → `period` (a canonical key). Same for `move_task_to_backlog` (`:193`). |
| `tools/tasks.ts:26` `list_tasks` | gains `scope?: 'month' \| 'week' \| 'all'` and a `period` alternative to `week_offset`. |
| `tools/tasks.ts:14` | the `goal_path` comment ("a task's goal is always a Weekly goal") is false and must be edited. |
| **new tools** | `park_task` / `unpark_task` (or one `retarget_task` — **recommended**, one tool, one `target`), `set_task_measure`, `clear_task_measure`, `record_reading`, `delete_reading`, `list_readings`. **Net +5 or +6 tools; 33 → 38/39.** |
| `tools/goals.ts:245` `get_goal` | its description says a Weekly goal "also carries its tasks"; a Monthly goal now does too. |
| `tools/backlog.ts:175` `convert_backlog_item_to_task` | gains `to: 'month' \| 'week'` (default `week` for compatibility, **recommended** `month` where the item's goal is Monthly). |
| `errors.ts:40` | `NOT_A_WEEKLY_GOAL` → `NOT_A_TASK_GOAL`, new recovery text; three new codes. |
| `instructions.ts:19-98` **`SERVER_INSTRUCTIONS`** | Four paragraphs change and one is added: **`ONLY WEEKLY GOALS HOLD TASKS`** → **`MONTHLY AND WEEKLY GOALS HOLD TASKS`** (and why the line falls there); **`CARRYING`** gains the month scope, the month band's Monday rule, and the rule that a month task is never late in a week; **`THE THREE EXITS`** gains one sentence saying Park is *not* a fourth; **`NO REPORTS`** gains the measure clause by name (no pace, projection, trend, streak, on-track verdict or roll-up — R-measure-9). **New paragraph `MEASURES`**: two kinds, implied direction, optional target, `current` derived from readings, readings follow the task and never the week, reaching a target never completes anything. |
| `business-rules.ts:15` `BUSINESS_RULES_MD` | **regenerate by hand in this commit** — see §6. |
| `resources.ts:100-130` | `goalcascade://week/current` and `week/{week_start}` gain the month band; consider `goalcascade://month/{month_key}`. |
| `prompts.ts` | `plan_the_week` and `triage_the_backlog` both describe a week-only model; `review_the_carry` must not acquire a pace. |
| `docs/research/MCP-TOOL-SURFACE.md` | §2 tool list, §5 the pinned instructions block, §6 errors. **`apps/api/tests/mcp/verbatim.test.ts:13-30` pins §5 byte-for-byte** — edit both or the suite fails. |

### 3.5 Web (`apps/web`, 409 tests green today)

| File | Change |
|---|---|
| `lens/cards.tsx:202-264` `MonthlyCard` | **loses** `targetWeek`, the `weekForMonth` import and `LinkRow`'s `newWeekly` fork (R-rm-6); **gains** the nested task list (R-lens-32) and R-goal-47's new `No weeks yet` case. |
| `lens/cards.tsx` `LinkRow` | one unconditional branch per horizon; `weekStart` prop removed. |
| `lens/cards.tsx` `WeeklyCard`, `CarriedCard` | unchanged. |
| `lens/LensScreen.tsx` `Body` | a third section after the carried band — `MonthBand`, collapsible, key `Weekly|__month|${monthKey}`, rendered from `data.monthTasks`. |
| **new** `lens/MonthBand.tsx` | the band, its heading, its per-goal grouping, its `+ Task` foot. |
| `components/TaskRow.tsx` `CarryLabel` | **the single load-bearing edit.** Today: `if (task.done \|\| age < 1) return null; sev = age >= 2 ? 'chip' : 'gray'`. It must take the unit (`weeks`/`months`) and a `suppress` flag the month band passes — and the *suppression must live at the call site*, not inside `CarryLabel`, so `S-lens-31-2` can assert it by rendering the band. |
| `components/TaskRow.tsx` | renders the measure inline: `12 / 15 leads` + one neutral bar; a task with `measure === null` is byte-identical to today. |
| **new** `components/MeasureBlock.tsx`, `components/Sparkline.tsx`, `components/ReadingsList.tsx` | task page only. Sparkline is a static `<path>`: no axis, no gridline, no target line, no trend line, no animation. |
| `screens/TaskPage.tsx` | measure block + readings between LINKS and the exits; `Park in a week` / `Move to the month` beside the exits, visually separated so it does not read as a fourth exit. |
| `screens/GoalDetailScreen.tsx` | a Monthly goal's page gains a `Tasks` section **above** its existing `Backlog (N)` section — the two side by side is where R-backlog-30's distinction is either legible or lost. |
| `components/BacklogSheets.tsx` `TaskCreateSheet` | **loses** `newWeekly`, `willCreateGoal`, `implicitWeeklyGoalNote`, the `weeklyTarget` invocation from the Monthly entry point, `landedWeek` and its navigation (R-rm-6); **keeps** all of it for Park and the week-conversion path. Gains `Add to this month` on the pull sheet. |
| `lens/copy.ts:148-163` | `plannedNess` gains the `No weeks yet` case; `implicitWeeklyGoalNote` deleted; band heading, park copy, measure copy added. |
| `context/UIContext.tsx`, `components/Sheets.tsx` | `taskCreate` sheet loses `newWeekly` from the Monthly path; new `retarget` and `measure` sheet kinds. |
| `api/queries.ts:665-753` | `useCompleteTask`/`useMoveTaskToBacklog` take a `period`; new `useRetargetTask`, `useSetMeasure`, `useClearMeasure`, `useRecordReading`, `useDeleteReading` with their invalidations (a reading invalidates the task **and** its lens row, because `current` renders there). |
| `api/http.ts:281-298` | five new methods. |
| `utils/periodKeys.ts:84` `weekForMonth` | **survives with two consumers** — `zoomTo` and R-goal-47's scope. `cards.tsx` stops importing it. See §5. |
| `lib/weekClock.ts:55` | unchanged. |
| `lib/errorCopy.ts` | four code changes. |
| service-worker read-model prefixes | `/api/tasks` unchanged; no new prefix needed. |

### 3.6 Tests that will fail and must be rewritten, not deleted

`apps/api/tests/tasks/week-model.test.ts` (`S-goal-37-1`/`S-goal-39-1` now assert **Quarterly**, not
Monthly), `tests/tasks/exits.test.ts`, `tests/tasks/activity.test.ts`, `tests/backlog/convert.test.ts`,
`tests/domain/weeks.test.ts`, `tests/mcp/tools.test.ts:334-338,599`, `tests/mcp/verbatim.test.ts`
(**both pins**), `packages/shared/tests/contract.test.ts:62,69`,
`apps/web/tests/api/http.test.ts:112-137`, and every web test rendering a task row or a Monthly card.
`packages/shared/tests/periods.test.ts:164-165` and `apps/web/tests/utils/periodKeys.test.ts:56-85`
**must keep passing unchanged** — `weekForMonth` is not being modified (§5).

---

## 4. Build order

1. **Shared contracts** (`common.ts`, `commands.ts`, `read-models.ts`, `errors.ts`, `endpoints.ts`) +
   `periodsBetween`. Nothing compiles until this lands, which is the point.
2. **Migration** (§2.4) + repos + `domain/weeks.ts` + `domain/enums.ts`.
3. **`assertTaskGoal`** and the create path — the smallest change that makes a month task exist.
4. Carry, visibility, completion at both scopes; `views.ts`.
5. Retarget (Park), then the conversion month path, then the backlog-host branch.
6. Measures: columns, `task_readings`, the five commands, `measure_current` maintenance.
7. **R-rm-6's deletion**, as its own commit, with `S-rm-6-1` as its acceptance.
8. Web: Monthly card tasks → month band → task-row measure → task page → sheets.
9. MCP: tools, errors, instructions, `BUSINESS_RULES_MD`, `MCP-TOOL-SURFACE.md` §2/§5/§6.

Steps 1–6 are behind no flag and are additive to the *product*; step 7 is the only removal and is
deliberately separate so its diff is readable.

---

## 5. The `weekForMonth` clamp — what is being removed and what is not

Verified against the source, not the docs (`packages/shared/src/calendar/periods.ts:315`,
`apps/web/src/utils/periodKeys.ts:84`, `apps/web/src/lib/weekClock.ts:55`):

```
weekForMonth('2026-09', today = '2026-09-02')  =  2026-08-31
periodKeyOf('Monthly', '2026-08-31')           =  2026-08
```

Its first branch tests the **calendar month** of today, not the month's **week range**. So `+ Task` on
a September Monthly goal on Wed 2 Sep 2026 targeted the week of **Mon 31 August** — August's week —
created a Weekly goal there under a September parent, failed to be counted by R-goal-47's line (whose
scope is Mondays *in* the month), and navigated the owner into August. Full working in `SPEC.md` §6.

**A8 removes the caller, not the function.** `MonthlyCard` stops importing it (R-rm-6). The two
survivors are correct as they stand and must not be "fixed" by reflex:

- **`zoomTo` (R-lens-9)** — landing on the week you are *living in* is right even when that week
  belongs to the previous month; R-lens-29's `This week is in Aug 2026` already names the seam.
- **R-goal-47's scope** — never reaches the today branch; it is a `BETWEEN firstMondayIn … lastMondayIn`
  range scan.

`[recommended]` **Rename `weekForMonth` → `zoomWeekForMonth`** (or move it beside `zoomTo`) so its
today branch reads as the zoom rule it actually is, rather than as a general answer to "which week does
this month mean". Not actioned in A8, because A8 deletes the only caller for which it was wrong.

---

## 6. `BUSINESS-RULES.md` is byte-pinned — read this before committing

`docs/BUSINESS-RULES.md` ships **verbatim** over MCP as `goalcascade://rules/business-rules`. It is a
hand-copied TS constant, `BUSINESS_RULES_MD` at `apps/api/src/api/mcp/business-rules.ts:15`, and
**there is no generator script** — the file's own header says to regenerate it by hand in the same
commit. The guardrail is byte equality:

```
apps/api/tests/mcp/verbatim.test.ts:32-39   expect(BUSINESS_RULES_MD).toBe(businessRulesMd)
```

(`businessRulesMd` is `import … from '../../../../docs/BUSINESS-RULES.md?raw'`.) A raw markdown import
is used only in tests because esbuild/wrangler does not resolve `?raw` on the Workers build.

**A8 edits `BUSINESS-RULES.md` in six places** — the Goal horizon bullet, two Lenses bullets, two
weekly-lens bullets, the whole Task section, a new `## Measure` section, the Backlog-item section, and
the Navigation removed-entirely bullet. **The build agent must re-copy the file into
`business-rules.ts` in the same change**, or `verbatim.test.ts` fails. The same test also pins
`SERVER_INSTRUCTIONS` against `docs/research/MCP-TOOL-SURFACE.md` §5 (`:777`), which §3.4 also changes —
**two pins, both in one file, both must move together.**

---

## 7. Open questions

**Q-A `[recommended]` — one `retarget_task` tool, or `park_task` + `unpark_task`?**
**One tool**, `retarget_task`, with `target: { goal_id }` and the server deciding the direction from
the target's horizon. Two tools would be one operation under two names, and MCP's tool budget already
carries 33.

**Q-B `[recommended]` — does `complete_task` keep `week_offset` for compatibility?**
**No.** `period` replaces it outright. An offset cannot express R-task-55's seam ("the August month
band, on 2 September"), and keeping both means two code paths and an ambiguity for an agent to get
wrong. This is a breaking MCP change and should be announced in the tool description.

**Q-C `[recommended]` — does the Monthly lens paginate its tasks?**
**Yes, at `MAX_PAGE`**, like every other lens read (R-lens-16). A Monthly goal with 200 month tasks is
a data pathology, but the read must not be the thing that discovers it.

**Q-D `[recommended]` — is the measure bar rendered on a task *row*, or only on the task page?**
**Row and page.** The row shows `12 / 15 leads` and a 2px neutral bar under the title; the page shows
the sparkline, the readings and the input. Without the row the number is invisible from the lens, which
is where the owner reads their week — and the whole ask was to *see* the number.

**Q-E `[recommended]` — can a measure be attached at create time, or only after?**
**Both**, in one command: `CreateTaskRequest` gains an optional `measure`. A separate second step for
"reach 15 leads" is the two-step friction this amendment exists to remove, one layer down.

**Q-F `[recommended]` — what happens to a month task when its Monthly goal is re-planned to a later
month (R-goal-40)?** **Nothing.** The task's period is its own stored field (R-task-52 / R-task-40) and
does not follow its parent — the same ruling A2 made for weeks, for the same four reasons. The task
carries on its own schedule and the goal moves on its own; if the owner wants the work moved too, that
is a Park. Recorded because it is the first question a builder will ask, and the answer is "the rule
you already have".

**Q-G `[recommended]` — should the month band show *done* month tasks?**
**Yes, for the whole month it was completed in** — R-task-53's rule, unchanged, at month scope. A done
month task struck through in every week of its month mirrors a done week task struck through for its
week, and hiding it would make the band disagree with the Monthly lens.
