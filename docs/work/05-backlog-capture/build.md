# 05 — Backlog, Ideas, Learnings, and the `/bootstrap` read model

Fills in four of the foundation's stubs: `BacklogService`, `IdeaService`, `LearningService`,
`BootstrapService`. No route file, no schema and no migration was changed — the foundation had every
endpoint registered, validated, session-gated and idempotency-wrapped, and every port this work needed
already existed.

Sources of truth, in order: `docs/work/01-foundation/build.md` → `docs/SPEC.md` → `docs/BUSINESS-RULES.md`.

---

## 1. What was implemented

| File | What |
|---|---|
| `apps/api/src/application/services/backlog.service.ts` | `list`, `listForGoal`, `create`, `patch`, `move`, `remove`, `convert`, plus the shared conversion helpers |
| `apps/api/src/application/services/capture.service.ts` | `IdeaService`, `LearningService`, `BootstrapService` |
| `apps/api/tests/backlog/{fixtures.ts, backlog.test.ts, convert.test.ts}` | 21 tests |
| `apps/api/tests/capture/{ideas.test.ts, learnings.test.ts}` | 19 tests |
| `apps/api/tests/bootstrap/bootstrap.test.ts` | 5 tests |

`npm run typecheck` and `npm run test` pass in `apps/api`: **19 files, 191 tests** (146 inherited, 45 new).
No inherited test was changed, weakened or deleted.

### Endpoints that moved from 501 to live

| Method | Path | Rules |
|---|---|---|
| GET | `/bootstrap?week=` | cold open (`fetchAll`), R-nav-4/D-24 |
| GET | `/backlog?goalId=` | R-backlog-5/11/12/13, Q-7 |
| POST | `/backlog` | R-backlog-2/4/16 |
| PATCH | `/backlog/:id` | R-backlog-3 (shape), Q-2 |
| POST | `/backlog/:id/move` | R-backlog-2/10, S-backlog-10-1 |
| DELETE | `/backlog/:id` | R-backlog-10 |
| POST | `/backlog/:id/convert-to-task` | R-backlog-6/7/8/9, Q-4, D-18, D-19 |
| GET/POST/DELETE | `/ideas`, `/ideas/:id` | R-idea-1/2/6/7 |
| POST | `/ideas/:id/attach` | R-idea-5 |
| POST | `/ideas/:id/convert-to-task` | R-idea-4, D-22 |
| GET/POST/PATCH/DELETE | `/learnings`, `/learnings/:id` | R-learning-1/2/4/6, D-23 |
| POST | `/learnings/:id/attach` | R-learning-3 |

**Rule ids covered:** R-backlog-1, 2, 3 (by shape), 4 (a, b, d — c is the tasks agent's Move-to-Backlog),
5, 6, 7, 8, 9, 10, 11, 12, 13 (server half), 16 · R-idea-1, 2, 4, 5, 6, 7 · R-learning-1, 2, 3, 4, 6 ·
Q-2, Q-4, Q-7, Q-10, Q-11 · D-17, D-18, D-19, D-20, D-22, D-23 · R-auth-2/3 on every referenced id.

R-backlog-14/15 (`+` drawer copy and its single-entity behaviour), R-idea-3/8, R-learning-5/7 and
R-backlog-13's grouping are **client** rules; the server owes them the total order and the refusals,
which it now provides.

---

## 2. How double conversion is made structurally impossible

`S-backlog-6-2` is the sharpest rule in this area, and the mockup got both halves of it wrong (D-19):
`saveNewTask` did `backlog.find(...)` then `backlog.filter(...)`, so a stale second modal produced a
**second** task from a vanished item — and the removal was never sent to the API at all.

Three independent layers, in the order a request meets them. A conversion has to defeat all three:

1. **The same request twice** (a retry over a flaky network, the same `Idempotency-Key`) never reaches
   `BacklogService.convert` at all. The `idempotent` middleware replays the stored 201 verbatim with
   `Idempotent-Replayed: true`, so the client gets the **original** task id back. This is the outer half
   of Q-4. *(test: "a replay with the SAME idempotency key returns the ORIGINAL task")*

2. **A genuinely second attempt** (a stale open modal, a second device, a fresh key) reads
   `status = 'converted'` in the read phase and is refused `409 ALREADY_CONVERTED`, with
   `details.taskId` naming the task the item already became so the client can navigate to it rather than
   dead-ending. The item is **marked, never deleted** — a deleted row has nothing to refuse with.
   *(test: "converting the same item twice … EXACTLY ONE task exists")*

3. **Two attempts racing past (2) at the same instant** meet the database. `convert` issues ONE
   `GuardedBatch.run` containing the task INSERT, its link INSERTs, its `created` event INSERT **and**
   `IBacklogRepo.markConvertedGuardedStmt`, whose WHERE pins `status = 'open' AND version = <read>`.
   `GuardedBatch` derives that precondition and asserts it FIRST in the D1 batch, so the loser trips
   `_guard`'s `CHECK (0)`, D1 rolls the **whole batch** back, and the task insert dies with the update.
   `ux_backlog_converted_task` (unique on `converted_to_task_id`) is the belt to those braces.
   *(test: "two conversions racing at the same instant produce one task and one refusal")*

Layer 3 is the one that makes this structural rather than hopeful: it is not possible to write a code
path in which the task exists and the item is still open, because they are the same transaction.

The same one-batch discipline covers the other two atomic operations:

- **R-idea-4 / D-22** — the idea's `deleteStmt` is in the SAME batch as the task INSERT. There is no
  endpoint anywhere that removes an idea "in preparation" for a task, which is precisely the ordering
  the mockup got wrong (it deleted, then opened the modal, and a cancel lost the thought forever).
- **R-idea-5** — attach inserts the backlog item and deletes the idea in one batch.

---

## 3. The seam with the tasks agent — both directions

We meet at the foundation's **ports**, never at each other's services or tables.

### 3.1 Backlog/Ideas → a Task (my direction)

A conversion is ONE transactional operation (Q-4). Calling `TaskService.create()` would be a second
`GuardedBatch.run`, i.e. a second transaction — exactly the split D-19 records. So `backlog.service.ts`
exports a narrow, documented factory that mints the task **rows as unexecuted statements**, which my
batch then commits alongside the item's conversion:

```ts
// application/services/backlog.service.ts
export const CREATED_EVENT_TEXT: Record<TaskSource, string>;   // R-task-30, the four `Created — …` lines
export type NewTaskDraft = { goalId; title; cond; description; links; source; detail };
export function buildTaskWrites(ctx, { ids, tasks, taskLinks, taskEvents }, draft): {
  task: Task; links: TaskLink[]; event: TaskEvent; writes: GuardedWrite[];
};
export function toNewTaskDetailView(w: TaskWrites): TaskDetailView;
```

It writes through `ITaskRepo.insertStmt`, `ITaskLinkRepo.insertStmt`, `ITaskEventRepo.insertStmt` and
nothing else. It sets `originWeekStart = ctx.currentWeekStart` (R-task-5/6) and appends exactly one
`created` event (R-task-31). It knows nothing about completing, carrying, exiting, patching or links
after creation — **`TaskService` owns everything a task does after it exists.**

**Tasks agent, two asks:**
- `CREATED_EVENT_TEXT` currently holds all four `Created — …` strings from R-task-30 because two of them
  are needed here. If you keep the canonical copy elsewhere, import it here rather than duplicating it —
  or import this map. One of the two must go; do not leave two.
- `toNewTaskDetailView` is a local `TaskDetailView` mapper for a task that is one instant old
  (`done: false`, `carryWeeks: 0`, one event). When `TaskService` grows the general mapper, replace this
  with it.

### 3.2 A Task → a backlog item (your direction)

`POST /tasks/:id/move-to-backlog` (R-task-15, D-12, D-15) creates a backlog item through **my**
repository port. Use the exported builder so the two capture paths cannot drift into two shapes:

```ts
export function buildBacklogItem(ctx, ids, {
  goalId, title, description, links, fromWeekStart,   // fromWeekStart = the Monday the task was LIVE in
}): { item: BacklogItem; links: BacklogLink[] };
export function assertCanHoldBacklog(goal: Goal): void;   // R-backlog-2 → 409 LIFE_GOAL_NO_BACKLOG
export function toBacklogItemView(item, links): BacklogItemView;
```

Put `items.insertStmt(item)` + `backlogLinks.insertStmt(...)` in the SAME `GuardedBatch.run` as the
task's status update and its `moved_to_backlog` event. Notes:

- `fromWeekStart` is the week the task was **live in**, not "this week" (D-12).
- A task's goal is a leaf, which is never a Life goal — so `assertCanHoldBacklog` should never fire on
  your path. Call it anyway; it is one line and it is the invariant.
- **Do not delete the task** (D-15), and do not set `backlogItems.convertedToTaskId` on this path — that
  column means "this item BECAME that task" and is unique. The task's own `movedToBacklogItemId` is the
  pointer for your direction.

### 3.3 The seam with the goals agent

`GET /goals/:id` needs `GoalDetailResponse.backlog` + `.backlogIsAggregate` (R-backlog-11/12). That read
model is implemented here and is public — call it, do not re-query `backlog_items`:

```ts
BacklogService.listForGoal(ctx, goalId): Promise<{ items: BacklogItemView[]; isAggregate: boolean }>
```

Non-Life goal → its OWN items, `isAggregate: false` (the client offers the three per-item actions, D-20).
Life goal → the read-only roll-up of every open item on any **descendant**, `isAggregate: true`, each row
carrying its own `goalId` for the `<owning goal title> · added <date>` label. A Life goal never holds
items itself, so the roll-up excludes the root by construction.

`GET /backlog?goalId=<lifeGoalId>` answers with the same aggregate, for the same reason.

`GoalView.backlogCount` (R-goal-25) is deliberately **not** computed here — the shape is the goals
agent's and it needs the tree anyway. `IBacklogRepo.listOpenByGoals` is the port for it.

---

## 4. Decisions worth recording

- **Ordering is applied in the service, not left to the repo.** The repos already `ORDER BY captured_at
  DESC, id DESC`, but Q-7 asks for an order that is total and stable and never storage order, the Life
  aggregate merges rows from more than one query, and D-17 records that the mockup's "newest first" was
  really array-insertion order that any refetch scrambled. `newestFirst()` in `backlog.service.ts` is the
  one implementation; ideas and learnings use it too.
- **A converted item is not editable or movable.** `PATCH` and `move` on one answer `409
  ALREADY_CONVERTED` rather than 404 — it tells the client where the work went.
- **Ambiguous conversion target → `422 VALIDATION_FAILED`, with `details.candidates`.** R-backlog-7 /
  D-18 require the user to choose when two active leaves qualify; the server must not pick. There is no
  `AMBIGUOUS_TARGET` code in `ERROR_STATUS`, and adding one means editing
  `packages/shared/src/errors.ts` — a file three agents share this week. See §6: this is the one thing
  worth an orchestrator ruling.
- **A named-but-wrong conversion target → `409 BRANCH_NOT_ACTIVE`** (not 404), unless the goal does not
  exist or is not the caller's, which is a plain 404 (R-auth-3).
- **An idea longer than 200 chars keeps all of its text.** `Idea.text` is 500 (Q-11) and
  `BacklogItem.title` / `Task.title` are 200. `splitCapture()` puts the first 199 chars + `…` in the
  title and the FULL original text in the description, rather than silently truncating: losing half a
  parked thought is the same class of bug as D-22. A short idea — nearly all of them — produces a title
  and an empty body.
- **`ctx.now` stamps every row**, never `IClock` directly, so every row and event written by one request
  carries the identical `serverNow` the response reports.
- **Every write goes through `GuardedBatch`**, including single-statement ones, so the `meta.changes`
  post-check applies uniformly and a vanished row is a 409 rather than a silent success.

---

## 5. Left undone

- **Q-12 collection caps are not enforced for the owner-level totals** (2000 backlog items, 5000 ideas,
  5000 learnings). Per-request caps (`MAX_LINKS`, string lengths) ARE enforced, by the shared zod
  schemas. The owner-level ones would need a full-table count on every create through the existing ports;
  they are worth a `COUNT(*)` port method rather than a scan. Nothing in the product can reach them today.
- **No pagination.** `GET /backlog`, `/ideas`, `/learnings` return everything. Q-12 asks for a hard page
  cap of 200 on every list endpoint, but `BacklogResponse` / `IdeasResponse` / `LearningsResponse` carry
  no cursor field, so adding one is a contract change and not mine to make unilaterally. Recommend it as
  a follow-up once real volumes exist; the `capturedAt`/`id` order is already a usable cursor.
- **`R-backlog-4(c)`** (an item created by a task moving out of a week) is the tasks agent's path; §3.2 is
  the interface it should use.
- **`R-learning-5`** (a goal detail screen listing its Life root's learnings) needs
  `ILearningRepo.listByGoals(userId, [lifeRootId])` — the port exists and is unused here because the
  endpoint belongs to `GoalService`. Not a gap in this work, but nothing calls it yet.

### Proposed removals (NOT performed — outside this scope)

Nothing. The one thing I would have tidied — `packages/shared/src/errors.ts` gaining an
`AMBIGUOUS_TARGET` code — is a shared-file change and is raised in §6 instead.

---

## 6. Shared-seam edits

**None.** This is worth stating explicitly, because three agents were editing these two files at once:

- `application/services/index.ts` — **not touched.** It already exported `./backlog.service` and
  `./capture.service`.
- `infrastructure/di/container.ts` — **not touched.** It already registered `BacklogService`,
  `IdeaService`, `LearningService` and `BootstrapService`.
- `api/routes/backlog.routes.ts`, `api/routes/capture.routes.ts` — **not touched.** `/bootstrap` was
  already wired into `capture.routes.ts` as `bootstrapRoutes`; no duplicate route file was created.
- `packages/shared/src/**`, `apps/web/**`, `docs/SPEC.md` — **not touched.** No schema was found to be
  wrong.

Files changed by this agent, in full: the two services above, `docs/work/05-backlog-capture/build.md`,
and `apps/api/tests/{backlog,capture,bootstrap}/**`.

### One thing for the orchestrator

`ERROR_STATUS` has no code for "more than one active leaf qualifies — the user must choose"
(R-backlog-7 / D-18 / S-backlog-7-2). It is currently `422 VALIDATION_FAILED` with
`details.candidates: [{ id, title }]`, which is machine-readable and sufficient, but it is a *product*
refusal wearing a *validation* code, and the client will have to branch on `details.candidates` rather
than on `error.code`. If `AMBIGUOUS_CONVERSION_TARGET: 409` is worth adding to
`packages/shared/src/errors.ts`, it is a two-line change plus one line in this service — but it is a
shared file and I did not make it unilaterally.

---

## 7. Test notes

Every test is an HTTP-level test through the real router, real middleware and real SQL, with only the
clock faked (`ContainerOverrides`, the one seam). Tests are named after the `S-*` scenarios.

Two deliberate departures worth knowing about:

- **`tests/backlog/fixtures.ts`** seeds goals and weekly-focus rows through `IGoalRepo` / `IWeeklyFocusRepo`
  and `GuardedBatch`, because `GoalService` and `PlanService` are still stubs. They write the same rows
  those services will, through the same ports — so when `POST /goals` and `PUT /plan` land, these helpers
  can be swapped for HTTP calls one at a time without touching a single assertion.
- **`tests/bootstrap/bootstrap.test.ts`** registers fake `GoalService` / `PlanService` / `TaskService`
  instances through `ContainerOverrides`. That is the point of the test as much as a convenience: it
  proves `BootstrapService` **composes** the owning readers and derives nothing of its own — including
  asserting each reader is called exactly once, so the lazy `Carried to week of …` producer inside
  `TaskService.list` (R-task-29, Q-17) fires on a cold open exactly as it does on a Tasks-screen fetch.
  When those services land, delete `installReaderFakes` and the assertions should still hold.

---

## Review

Reviewed by 07-api-review. Full findings and evidence: `docs/work/07-api-review/report.md`.

**Verdict: no defect found in this work.** §2's three layers against double conversion, §3's seam
discipline, the atomic idea flows and the ordering rules were all attacked directly and none of them moved.

- **§2, all three layers, confirmed.** A replay with the same `Idempotency-Key` returns the **original**
  task; a genuinely second attempt is `409 ALREADY_CONVERTED` naming the task the item became; and the
  racing pair is arbitrated by `markConvertedGuardedStmt` inside the one batch. The round-trip case the
  review invented — a task moved to backlog, converted back, then converted **again** — is also refused,
  with exactly two tasks and one item in the database: the exit does not reset the item's status. Your
  claim that layer 3 makes this structural rather than hopeful is accurate.
- **§3.2, the seam with the tasks agent, holds in both directions.** `tests/review/seams.test.ts` walks
  task → Move-to-Backlog → convert. `fromWeekStart` is the week the task was live in and survives the
  conversion; the item is marked, not deleted; `convertedToTaskId` and `movedToBacklogItemId` point the
  right ways; the links are copied by value; and the exited task keeps its row, its reason and its final
  event. All four of your asks in the tasks agent's §4 were honoured, in both directions.
- **§3.3, the seam with the goals agent.** `GoalDetailResponse.backlog` / `.backlogIsAggregate` come from
  your `listForGoal` and the Life roll-up excludes the root by construction, as documented.
- **The cascade.** Deleting a goal now removes both sides of a round trip and a whole-table sweep finds no
  item, task or focus naming a goal that no longer exists. (That sweep found a real bug — but in the goals
  agent's `remove`, not here; see report finding 2.)
- **Ordering, strictness and scoping.** `newestFirst()` is the single implementation and is total and
  stable. 562 request-strictness probes across 23 write endpoints all answer 422 with an
  `unrecognized_keys` issue naming the exact key. Every referenced id is ownership-checked, not just the
  target: moving your own item onto another account's goal, and attaching your own idea to their goal, are
  both plain 404s.
- **§4 — `splitCapture()` was right.** Keeping the full idea text in the description rather than truncating
  a parked thought is the same class of care as D-22, and it round-trips through the response schema.

**§6 — your orchestrator question is answered, and implemented.** `AMBIGUOUS_CONVERSION_TARGET: 409` is now
in `packages/shared/src/errors.ts`, and `resolveConversionTarget` raises it. Your reading was exactly
right: the input was well formed, the product simply has no single answer, and a client that has to branch
on `details.candidates` rather than `error.code` will get it wrong. `details.candidates` is unchanged, so
the chooser has what it needs and re-submitting with `goalId` still resolves it. Declining to edit a shared
file unilaterally was the correct call, and this is the change you would have made.

*Per-test verdict — `tests/backlog/convert.test.ts` S-backlog-7-2: legitimately retired.* Only the status
and code assertions moved, and only because the contract moved. Every behavioural assertion the test exists
to make — no silent pick, both candidates named, the item still `open`, naming one of them succeeds and
lands the task exactly there — is untouched.

**§5, still open, not done here.** The Q-12 owner-level caps and pagination remain unenforced; nothing in
the product can reach them today and both need a contract or a port method, so they stay follow-ups.

**One LOW finding, fixed.** `GET /ideas` and `GET /learnings` were the only list routes with no query
schema, so `?__x=1` returned 200 — and, more to the point, `GET /ideas?goalId=…` silently returned the
unfiltered list while `GET /backlog?goalId=…` filters. Both now validate against a strict empty `NoQuery`
and answer 422. Not a breach of any `.strict()` schema (none was declared); an asymmetry a client gets
wrong once and never sees.
