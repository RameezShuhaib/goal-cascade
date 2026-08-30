# 04 — Tasks: the lifecycle and the activity timeline

The feature the product is actually about. Everything here fills in services behind routes the foundation
already registered; no route shape, no shared schema and no repository port was changed.

Sources of truth, in order: `docs/work/01-foundation/build.md` → `docs/SPEC.md` (`R-task-*`, `S-task-*`,
`D-1/4/12/13/14/15`) → `docs/BUSINESS-RULES.md` → the mockup in `apps/web/src/`.

---

## 1. What was built

```
apps/api/src/application/services/
├── task.service.ts      the ten operations behind /tasks (was a NotImplementedError stub)
└── activity-log.ts      NEW — the timeline: event copy, R-task-27 truncation, the lazy carry producer
apps/api/tests/tasks/
├── helpers.ts           seeding (goals + weekly focus through their PORTS, tasks over HTTP)
├── week-model.test.ts   14 tests — D-1, R-task-5/6/7/8/9/10/11/12, R-nav-3/4
├── exits.test.ts        17 tests — R-task-13..21, D-4, D-12, D-15
└── activity.test.ts     21 tests — R-task-2/22..31, D-13, D-14, Q-2, Q-17
```

`npm run typecheck` and `npm run test` pass in `apps/api`: **198 tests, 17 files** (52 of them new here).
All ten task routes answer end to end; none of them throws `NotImplementedError` any more.

## 2. Rules covered

| Rule | Where |
|---|---|
| R-task-1/4 (target is an active non-Life leaf) | `assertActiveLeaf` — `NOT_A_LEAF` / `BRANCH_NOT_ACTIVE`, never a fallback goal (D-10) |
| R-task-2/30 (four creation sources) | `source` → the four `Created — …` lines, recorded on the event with `detail.source` |
| R-task-3 | `cond` optional, `''` when unset |
| R-task-5/6 (origin = current week, immutable) | `originWeekStart = ctx.currentWeekStart`; no operation ever rewrites it |
| R-task-7/8/9 (visibility, carrying, dormancy) | `ITaskRepo.listVisibleInWeek` alone; no filtering in the service |
| R-task-10/11/12 (carry labels) | `carryWeeks(origin, viewedWeek)` on every `TaskView` |
| R-task-13 (exactly three exits) | there is no fourth handler; `S-task-13-1` asserts defer/snooze/reschedule/move-to-week 404 |
| R-task-14 (complete, any week) | `complete`; `WEEK_OUT_OF_RANGE` below origin, `doneAt` = the instant (D-4) |
| R-task-15/17/18 + D-12 (move to backlog) | `moveToBacklog`; item on the task's OWN goal, `fromWeekStart` = the week it was live in |
| R-task-16/17/18 (cancel) | `cancel`; optional reason retained on the row |
| R-task-19/20/21 (uncheck) | `uncheck`; origin preserved, no re-parent, no active-leaf requirement, skippable cond edit |
| R-task-22/23/26/27 (detail + editing) | `get` / `patch`; one event per changed field, values truncated |
| R-task-24/25 + D-13 (links) | `addLink` / `removeLink`, both logged |
| R-task-28 | server sends `cond`, `doneAt`, `carryWeeks`; the row copy is the client's |
| R-task-29 + D-14 + Q-17 (carry log) | `ActivityLog.ensureCarried` — see §3 |
| R-task-30/31 (the complete event set) | `activity-log.ts` is the only writer; there is no endpoint that authors an event |
| R-task-32 + D-15 + Q-6 (exits keep the row) | terminal `status` + `exitReason` + `exitedAt`; nothing deletes a task |
| Q-2 | every task write is guarded on `version`; a stale one is a clean 409 with no event committed |

## 3. How carry events are produced, and why they cannot duplicate

Carrying itself is **derived and writes nothing** — an open task is visible in every week at or after its
origin (`listVisibleInWeek`), which is why there is no cron in this Worker and why nothing naturally
writes the cosmetic `Carried to week of …` line (D-14: the mockup had these only in fixture data).

`ActivityLog.ensureCarried` produces them **lazily, on a read of a week** (`GET /tasks` and
`GET /tasks/:id`). For every open task visible in the week read, it emits one insert per week crossed,
through `ITaskEventRepo.insertCarriedIgnoreStmt` — an `INSERT … ON CONFLICT DO NOTHING` against
`ux_task_events_carried (user_id, task_id, week_start) WHERE kind = 'carried'`. Idempotency is therefore
the **database's**, not the code's: a re-read, a refresh, or two devices opening the same new week at once
insert nothing the second time. `S-task-29-1` reads the same weeks four times over and still finds exactly
two entries.

Two deliberate details:

- **`at` is the Monday of the week carried INTO, not `ctx.now`.** The entry describes something that
  happened at the start of that week; stamping today's clock on it would sort a carry from three weeks ago
  above a `Completed` from last week in a newest-first timeline. That is D-4's mistake in a new place.
- **The backfill window is bounded to `WEEK_HISTORY_WEEKS` (8).** A read fills every week from
  `max(origin + 1, viewed − 7)` to the viewed week, so a task carried for a year cannot fan a single read
  out into an unbounded batch. Every week the owner can actually address gets filled by any read of it,
  and the window slides forward with the current week. A task left untouched for more than eight weeks
  will therefore have gaps in its carry log for the weeks nobody could reach — this is the one place the
  implementation is deliberately narrower than a literal reading of R-task-29, and it is a cosmetic log,
  not a fact about the task.

Failures of the carry batch are swallowed: it is a log line produced during a READ, and a task list must
not 500 because another device wrote the same entry a millisecond earlier.

## 4. What I rely on from the backlog agent

Move-to-Backlog (`R-task-15`) creates a backlog item. I do **not** call `BacklogService` and I do not
touch its tables directly — the exit and the item are written in ONE `GuardedBatch` through the ports the
foundation defined:

- `IBacklogRepo.insertStmt(item)` — with `goalId` = the task's own goal, `fromWeekStart` = the Monday of
  the week the task was live in (D-12), `status: 'open'`, `convertedToTaskId: null`, `version: 1`.
- `IBacklogLinkRepo.insertStmt(link)` — one row per task link, copied by value (new ids).

**What the backlog agent needs to know / what I need from them:**

1. Items created by an exit must appear in `GET /backlog` like any other open item — they are ordinary
   `status: 'open'` rows, distinguished only by a non-null `fromWeekStart`, which the UI renders as
   `from week of 24 Aug` (R-backlog-4c, D-12).
2. `BacklogItemView.fromWeekStart` must be projected straight through; it is a **date**, never a display
   string.
3. If `BacklogService` ever adds an invariant on creation (e.g. normalising `goalId` upward), it has to
   live behind the repo or in a shared domain function, or the two creation paths will drift. Today the
   only invariant is R-backlog-2 (never a Life goal), which the exit satisfies for free: a task's goal is
   always a non-Life leaf.
4. Conversion back into a task (`POST /backlog/:id/convert-to-task`) is **theirs**, not mine, and must log
   `Created — pulled from Backlog` — the copy is exported as `createdText('backlog')` from
   `application/services/activity-log.ts`. Please use it (and `ActivityLog.append`) rather than writing a
   `task_events` row by hand, so the timeline has exactly one author. The same applies to
   `POST /ideas/:id/convert-to-task` → `createdText('idea')` for the capture agent.

## 5. Shared-seam edits (all additive, listed for the orchestrator)

1. **`application/services/index.ts`** — one line, alphabetically first: `export * from './activity-log';`.
   Nothing reordered, nothing reformatted.
2. **`application/services/guarded-batch.ts`** — three lines plus a comment in `run()`'s post-check:
   `expectedChanges: 0` now means "best-effort, do not assert the row count" instead of "must change
   exactly zero rows".

   **This was a genuine bug and the orchestrator should know about it.** The port documents
   `expectedChanges: 0` as "for best-effort statements that may legitimately no-op", and both
   `ITaskEventRepo.insertCarriedIgnoreStmt` and `D1TaskEventRepo` tell the caller to use it for the carry
   insert. But the post-check asserted `actual === expected`, so the FIRST (successful) carry insert —
   1 row changed, 0 expected — raised `ConcurrencyError` → **409 on a GET**. Only the duplicate case
   worked. The existing test (`guarded-batch.test.ts`, "`expectedChanges: 0` allows a statement that may
   legitimately match nothing") passes unchanged, because it only ever exercises the 0-row half.
   No other caller in the tree passes `0`.

3. **`infrastructure/di/container.ts` — NOT touched.** `TaskService` was already registered, and
   `ActivityLog` is an `@injectable()` concrete class that tsyringe resolves as a constructor dependency
   without a registration. One less file for three agents to collide in.

## 6. Existing tests I changed, and why (per test)

Three assertions in `tests/validate.test.ts` asserted `501 NOT_IMPLEMENTED` as a *proxy* for "validation
passed and the request reached the service". Implementing `TaskService` makes that proxy wrong by
construction. None of them was weakened; two were made stronger:

- *"an empty body parses as {} so a command whose fields are all optional still works"* — `501` → `404`.
  The request still reaches the service; the service now refuses on the **id** (R-auth-3: an unknown task
  is a plain 404). The assertion the test exists to make is "not 422", and that still holds.
- *"coerces `week` from its string form and passes it through"* — `501` → `200`, **plus** a new assertion
  that `week.offset === -2`. The 501 could only imply the coercion happened; the 200 proves it.
- *"R-nav-4 / D-24 — reaching past the switcher's bound…"* — the in-bounds control case `week=-7` is now
  `200` instead of `501`. The refusal half of the test (`week=-9` → 422 `WEEK_OUT_OF_RANGE`) is untouched.

## 7. Decisions worth an orchestrator veto

1. **Straight quotes in event text.** `Renamed: "old" → "new"` uses ASCII `"`, following SPEC §2's code
   spans. The mockup used typographic `“ ”`. If the design wants curly quotes, it is a two-line change in
   `activity-log.ts` (`renamedText`, `condEditedText`) plus two test strings.
2. **A blank title is a 422, not a silent fallback.** R-task-23 says "a blank title falls back to the
   existing title and logs nothing"; the shared `Title` schema is `min(1)` after trim, so a blank title
   never reaches the service. The client already disables Save in that state, so the fallback is UI
   behaviour; the API refuses rather than guessing. The schema was NOT changed.
3. **Editing an exited task is refused** (`TASK_ALREADY_EXITED`). R-task-26 grants editability to *done*
   tasks; a canceled or moved-out task is a historical record, and rewriting it would edit something that
   already left the board (D-15). Not spelled out in the SPEC — flagging it as my call.
4. **Completing an already-done task is refused** (`TASK_ALREADY_EXITED`, "task is already completed")
   rather than silently re-stamping `doneWeekStart`. Unchecking an open task is likewise a
   `VALIDATION_FAILED`, never a silent no-op (Q-10).
5. **Adding or removing a link does not bump the task row's `version`.** Links are their own table, so a
   link edit cannot collide with a concurrent title edit. The returned `TaskView` therefore carries the
   same `version` with a changed `links` array.
6. **`carryWeeks` is computed for every status**, including done and exited tasks, exactly as the shared
   schema describes it (`viewedWeek − originWeekStart`). R-task-12's "no label when done" is a rendering
   rule the client applies with `done`.

## 8. Left undone / proposed (not performed — outside my scope)

- `GET /tasks` returns the week's plan by reading `IWeeklyFocusRepo.listByWeek` directly. When
  `PlanService` lands, the projection is three lines (`toPlanEntryView`) and could move there; I did not
  reach into their service.
- `BootstrapService` still 501s: it must call `TaskService.list` rather than re-deriving visibility or
  producing carry events independently (the foundation says the same). Whoever implements it should note
  that `list` has the side effect of producing carry entries — that is intended, and it is idempotent.
- The `carrying` aggregate on `GoalView` (R-goal-24, "N tasks carrying · oldest W weeks") is the goals
  agent's; `ITaskRepo.listOpenByGoals` plus `carryWeeks()` is all it needs, and it must NOT recompute
  visibility with its own SQL.
- Nothing in `apps/web/` was touched. The client still needs the carry chip copy
  (`N weeks · since <Mon d Mon>`) built from `carryWeeks` + `originWeekStart`; the server deliberately
  does not send a pre-rendered label for the row (only for the timeline, where the text is frozen at
  append time).
