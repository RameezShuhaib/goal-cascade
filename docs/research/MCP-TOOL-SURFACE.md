# Goal Cascade — MCP Tool Surface

Design for the tools, resources and prompts a Cloudflare Worker MCP server exposes so external AI agents
can manage the owner's Goal Cascade account.

Sources of truth: `docs/SPEC.md` (`R-*`, `S-*`, `Q-*`, `D-*`), `docs/BUSINESS-RULES.md`,
`packages/shared/src/{common,commands,read-models,endpoints,errors}.ts`,
`apps/api/src/application/services/`.

Scope note: this document designs the **semantic surface only**. HTTP transport, OAuth/session wiring,
and SDK plumbing are owned by a parallel agent and are deliberately absent.

Naming: MCP tool inputs are `snake_case`; the server maps them onto the existing camelCase Zod request
schemas. Every constraint below is the constraint already encoded in `packages/shared/src/common.ts`.

> ⚠ **Amendment 2 (the lens redesign) rewrote this document.** It was written against the pre-A2 product
> — a four-horizon tree of active and dormant *leaves*, each carrying a weekly *focus sentence* stored in
> a `weekly_focus` table behind `PUT /plan`. **None of that exists.** A weekly intent is now an ordinary
> goal at a fifth `Weekly` horizon; task ownership is `horizon === 'Weekly'` and nothing else; and the
> four plan/focus tools, the `leaves` and `active_leaves` selectors, and the `NOT_A_LEAF` /
> `BRANCH_NOT_ACTIVE` / `WEEK_NOT_CURRENT` codes are all deleted. §5 was rewritten at the time; §§1–4 and
> 6–8 were not, and went on specifying the deleted product for one release. They are corrected here.
>
> **Where the live Zod schema is the authority, this document now points at it instead of copying it.**
> The exhaustive per-field constraint tables were the half that rotted, because they were a copy of
> something with no alarm on it. `apps/api/tests/mcp/surface.test.ts` guards what remains: every tool
> name and error code this file names must exist in the live registry, and no retired name may reappear.

---

## 1. Design principles

1. **One cheap read makes the agent competent.** `get_overview` is the first call in almost every
   session: the life goals, this week's lens — the week's own weekly goals, what is carrying into it,
   and the tasks visible in it — plus backlog, learnings and counts. Enough to plan without a second
   round trip. It is deliberately **not** the whole tree: the goal list grows with every week the owner
   uses the product (R-lens-27), so no read returns all of it.
2. **Ids move between tools; titles never enter a mutating tool.** Resolution is one explicit, auditable
   step (`find_goal`), never a fuzzy match hidden inside a write.
3. **Tools are shaped like the product's intents, not like its rows.** `replan_goal` and `move_goal` are
   separate because they are separate rules with separate refusals; `update_goal` is one tool because
   editing the card is one intent.
4. **The dangerous primitive is wrapped, and the safe wrapper is what the agent reaches for first.**
   Subtree delete gets an intent-shaped, preview-first alternative.
5. **A week is an integer offset, and it may be positive.** `week_offset` is bounded `-520 … 520` and
   defaults to `0`. **There is no forward bound on planning** (R-goal-36, R-lens-7): work may be written
   into any future week. The two exceptions are the two that would rewrite history or the future:
   `complete_task` takes `≤ 0` (you cannot tick off a week that has not begun) and
   `convert_backlog_item_to_task` takes `≥ 0` (a pull lands in this week or a later one, never a past
   one). Longer horizons address a period by its **canonical key** rather than an offset —
   `2026`, `2026-Q3`, `2026-09`, or a Monday `2026-09-07` (R-goal-33).
6. **Refusals are the product speaking, not failures.** Every error code is surfaced with its recovery
   move; a `409` here means "you need to do something else first", never "retry".
7. **Server-owned things stay server-owned.** Idempotency keys, ULIDs, task events, `origin_week_start`,
   derived flags: the agent never supplies them and never sees a field it could corrupt.
8. **What the product deliberately does not have, the surface does not invent** (R-nav-14, R-task-13):
   no fourth task exit, no review wizard, no week report, no audit view — and, since A2, no focus
   sentence and no notion of an active or dormant branch.

---

## 2. The tool list

**43 tools: 12 read-only, 31 mutating.**

| Category | Read | Mutating |
|---|---|---|
| Discovery & goals | 6 | 6 |
| Tasks | 3 | 13 |
| Backlog | 1 | 6 |
| Learnings | 1 | 4 |
| Account & preferences | 1 | 2 |

⚠ **A8 adds six task tools and no others**: `retarget_task` (Park in a week / Move to the month),
`set_task_measure`, `clear_task_measure`, `record_reading`, `list_readings`, `delete_reading`. It is one
tool for Park rather than a `park_task`/`unpark_task` pair (Q-A): two tools would be one operation under
two names, and the direction is already decided by the task's scope and the key's format.

*(The pre-A2 design had a `Weekly plan / focus` row of 1 read and 3 mutating tools — `get_weekly_plan`,
`set_goal_focus`, `clear_goal_focus`, `save_weekly_plan`. All four are **deleted**. A weekly intent is a
goal, so it is created with `create_goal(horizon="Weekly")` and read with `list_lens(lens="Weekly")`;
`repeat_last_week` is the one convenience that survived the plan screen. The five Idea tools went with
the Ideas entity in Amendment 2, and `change_password` was added when rail 2 was overruled — see §7.)*

Conventions used in every table below:

- **Mutating** tools are annotated `[MUTATING]`; everything else is `[READ-ONLY]`.
- Every mutating tool is executed by the server with a **freshly generated** `Idempotency-Key`. The agent
  never supplies one and cannot see one (§7, rail 6). Transport-level retries reuse the same key, so a
  dropped response never double-writes.
- `version` (optimistic concurrency, Q-2) is **not** an agent-facing input. The server reads the current
  version immediately before the write and sends it; a `CONCURRENT_UPDATE` is surfaced to the agent with
  the fresh state (§6).
- Every response carries `server_now` (ISO-8601 UTC) and, where a week is involved,
  `week: { week_start, offset, is_current, is_past }`.
- Every list response is capped at `MAX_PAGE` (200) and carries `next_cursor` (Q-12). There is no
  uncapped list read on this surface.

---

### 2.1 Discovery and goal reads

#### `get_overview` `[READ-ONLY]`

> Start here. Returns the owner's life goals, this week's lens and counts of open tasks, backlog items
> and learnings. One call is enough to answer "what is this person working on".

Backed by `GET /bootstrap` plus the Weekly lens read, reshaped.

- `include` — subset of `["lens","tasks","backlog","learnings"]`, default all. Trims the payload.
- `week_offset` — `-520 … 520`, default `0`.

Output:

```jsonc
{
  "week": { "week_start": "2026-08-31", "offset": 0, "is_current": true, "is_past": false },
  "life_goals": [
    { "id": "01J…", "title": "Health", "horizon": "Life", "period_key": null,
      "carrying": { "open_tasks": 3, "oldest_weeks": 4 } }   // null when nothing carries
  ],
  "groups":    [ { "id": "01J…", "title": "Health", "open_tasks": 4 } ],
  "this_week": [ /* Weekly goals whose periodKey IS this week */ ],
  "carried":   [ /* Weekly goals from EARLIER weeks that still hold open work (R-lens-12) */ ],
  "tasks":     [ /* tasks visible in this week, with SIGNED carry ages */ ],
  "backlog":   [ /* open items */ ],
  "learnings": [ /* newest first */ ],
  "counts": { "open_tasks": 9, "carrying_tasks": 3, "backlog": 11, "learnings": 6 },
  "server_now": "2026-08-31T09:12:00.000Z"
}
```

There is **no `tree`**, no `active_leaves` and no `focus`. `carried` is what replaced the dormant-leaf
list: a weekly goal from an earlier week that still holds open work appears in this week's lens, below
the week's own goals, labelled with the week it was written for (R-lens-12).

Rules: R-goal-24, R-lens-2/12, R-task-7/8, R-lens-27, D-11, Q-7.

---

#### `list_lens` `[READ-ONLY]`

> **The main read.** Every goal at one horizon in one period, grouped by the life goal it ultimately
> belongs to. This replaced the whole-tree read: there are five lenses, one per horizon, and each is a
> flat list rather than a branch you walk into.

Backed by `GET /goals` (`LensQuery` → `LensResponse`).

- `lens` — `Life`\|`Yearly`\|`Quarterly`\|`Monthly`\|`Weekly`, default `Weekly`.
- `period` — a canonical period key (`2026`, `2026-Q3`, `2026-09`, a Monday `2026-09-07`). Omit and the
  **server** answers with the current period for that horizon; never compute "now" client-side
  (R-lens-14). Ignored on `Life`, which has no period dimension (R-lens-2).
- `cursor`, `limit` — paging, `limit` ≤ 200.

Output: `{ lens, period, groups[], items[], carried[], tasks[], parents[], has_forward_content,
next_cursor, server_now }`.

- `period` is `null` on the Life lens; otherwise `{ period_key, label, is_current, is_past, has_work }`.
  The **label is server-rendered** (`Q3 2026`, `Week of 7 Sep`) — never format a period key yourself.
- `carried` and `tasks` are populated on the **Weekly lens only**; every other lens sends them empty.
- `has_forward_content` — does any later period at this horizon hold a goal? (R-lens-26.) It is the one
  cue that work written months ahead is not invisible from here.

Rules: R-lens-1/2/3/5/12/14/16/19/23/26/27, Q-7.

---

#### `get_period` `[READ-ONLY]`

> Turn "this quarter" or a date into the canonical period key each of the five horizons lands on, with
> a goal count for each. Call this rather than assembling a period key from a date yourself.

- `anchor` — ISO date `YYYY-MM-DD`. Omit for the server's today in the owner's timezone.

Output: `{ rows: [{ lens, period_key, label, goals, is_current }], server_now }`. The `Life` row carries
`period_key: null` and the label `everything`.

Rules: R-lens-9/22, R-goal-33/34.

---

#### `find_goal` `[READ-ONLY]`

> Turn a phrase the user said ("my fitness goal", "Q3 revenue") into goal ids. Returns ranked candidates
> with horizon and period. **Always call this before any tool that takes a `goal_id`, unless you already
> have the id from an earlier result in this conversation.** If two or more candidates come back with
> similar scores, ask the user which one — do not guess.

- `query` — 1–200 chars, matched against title, `why` and the goal's line.
- `lens` — which horizon to search, default `Weekly`.
- `period` — canonical period key; omit for the current period of that horizon.
- `only` — `any` (default) \| `weekly` \| `can_hold_backlog` \| `life`.
  `weekly` = valid task targets (R-task-4); `can_hold_backlog` = Yearly/Quarterly/Monthly
  (R-backlog-2); `life` = valid Learning tags (R-learning-2).
- `limit` — `1…20`, default `5`.

Output: `{ matches: [{ id, title, horizon, period, period_key, is_weekly, score, matched_on }],
ambiguous, server_now }` — `ambiguous: true` when the top two scores are within 0.15. **Ask the user.**

`only="leaves"` and `only="active_leaves"` are **deleted**. Leaf-ness is not a task-ownership test any
more and nothing computes it: `is_weekly` is the whole answer (R-goal-37).

Rules: R-goal-2, R-auth-3 (nothing outside the owner's account is ever returned).

---

#### `get_goal` `[READ-ONLY]`

> One goal in full: its ancestors, its children, its backlog, the learnings on its life line, and the
> periods it could be re-planned to.

Backed by `GET /goals/:id` (`GoalDetailResponse`).

- `goal_id` — ULID, from `find_goal` or a previous result.

Output: `{ goal, ancestors[], children[], backlog[], backlog_is_aggregate, pull_list[], learnings[],
replan_options[], tasks[], server_now }`.

- `backlog_is_aggregate` is `true` on a **Life** goal: the list is then a read-only roll-up of every
  descendant's items and **must not** be passed to `move_backlog_item` / `delete_backlog_item` as if it
  were that goal's own (R-backlog-12).
- `pull_list` is the items sitting on the goals *above* a Weekly goal, ready to pull into its week.
- `replan_options` is the server's own derivation from today and this goal's horizon (R-goal-23, D-3) —
  pass one of these to `replan_goal` rather than inventing a period key. It is **empty on a Weekly
  goal**, which is not re-plannable at all (R-goal-22).
- The goal carries `weekly_breakdown` on a Monthly goal and `planned_age_weeks` on a Weekly one. It
  carries **no `is_leaf` field, on purpose**, and no `is_active`, `dormant` or `subtree_active`.

Rules: R-goal-27, R-backlog-11/12, R-learning-5, R-goal-21/23/37/47.

---

#### `preview_goal_deletion` `[READ-ONLY]`

> **Call this before `delete_goal`, always.** Returns exactly what deleting this goal would destroy: the
> sub-goals, weekly goals, tasks (with their activity timelines) and backlog items in its whole subtree,
> plus the learnings that would fall back to "Unsorted". Show these numbers to the user and get their
> agreement before deleting.

- `goal_id` — ULID.

Output:

```jsonc
{
  "goal": { "id": "01J…", "title": "Q3 2026", "horizon": "Quarterly" },
  "would_remove": { "goals": 3, "weekly_goals": 2, "tasks": 11, "task_events": 63, "backlog_items": 7 },
  "would_untag": { "learnings": 2 },
  "requires_cascade": true,      // true iff the goal has descendants
  "server_now": "…"
}
```

`weekly_focuses` was the pre-A2 name for that count. A weekly goal is an ordinary goal now, so the
count is `weekly_goals` — and it is the count that matters most, because deleting a monthly goal takes
every week written under it.

This shipped; the `[NEW BACKEND WORK]` note the design carried is discharged (§8, Q1).

Rules: Q-5, R-goal-28, D-27.

---

### 2.2 Goals (mutating)

Constraints below are the ones in `packages/shared/src/commands.ts`; that file is the authority.

#### `create_goal` `[MUTATING]`

> Create a goal. Horizons nest Life › Yearly › Quarterly › Monthly › Weekly and a child's horizon must be
> strictly shorter than its parent's. Life goals have no parent and no period; every other horizon needs
> one. **Weekly goals can never have sub-goals**, and they are the only goals that hold tasks.

Backed by `POST /goals` (`CreateGoalRequest`).

- `title` **yes** — trimmed 1–200; whitespace-only refused (R-goal-29).
- `horizon` **yes** — including `Weekly`. Fixed at creation, never editable.
- `parent_id` **yes** — ULID or `null`; `null` **only** for `Life`. Must be a goal of strictly longer
  horizon. Levels may be skipped: a Weekly goal may hang directly off a Life goal (R-goal-4/5/6).
- `period_key` — the canonical key, **not a label**: `2026`, `2026-Q3`, `2026-09`, or a Monday
  `2026-09-07`. Omit and the server derives the current period for that horizon (R-goal-13/33). Must be
  omitted for `Life`.
- `why` — trimmed ≤ 200, default `""`.
- `pulse` — `On track`\|`At risk`\|`Rethink`, default `On track`.

Output: `{ goal, server_now }`.
Rules: R-goal-1/3/4/5/6/7/13/29/32/33/36; refuses with `HORIZON_CONFLICT`, `PERIOD_IN_PAST` (nothing is
created into a past period — planning does not rewrite history), `VALIDATION_FAILED`.

There is **no `GOAL_HAS_OPEN_TASKS` refusal any more.** It guarded "making a leaf a parent while it
holds open tasks", and leaf-ness stopped deciding anything (R-goal-42).

---

#### `update_goal` `[MUTATING]`

> Edit a goal's card: title, motivation, target period and pulse. Horizon and parent are **not** editable
> here — use `move_goal` to re-parent and `replan_goal` to change the period with a reason.

Backed by `PATCH /goals/:id` (`PatchGoalRequest`). Inputs: `goal_id` **yes**, then at least one of
`title`, `why`, `period_key`, `pulse`. `period_key` is refused on a Life goal.

Output: `{ goal, server_now }`. Rules: R-goal-14/15/29, S-goal-14-2 (`horizon` / `parent_id` are not
accepted keys, by design).

---

#### `move_goal` `[MUTATING]`

> Re-parent a goal. Its children move with it and its own horizon does not change. The new parent must
> have a **longer** horizon and must not be the goal itself or any of its descendants. Life goals cannot
> be moved. Read the returned path back to the user.

Backed by `POST /goals/:id/move` (`MoveGoalRequest`). Inputs: `goal_id` **yes**, `new_parent_id` **yes**.

Output: `{ goal, new_path, moved_descendants, server_now }`.
Rules: R-goal-16/17/18/19/20/21; refuses with `WOULD_CREATE_CYCLE` (checked first, R-goal-19),
`HORIZON_CONFLICT`, `LIFE_GOAL_IMMUTABLE`.

A goal's period is **never** checked against its parent's (R-goal-33): a week that straddles a month
boundary is ordinary, not an error, so a move never refuses on period grounds.

---

#### `replan_goal` `[MUTATING]`

> Move a goal to a later target period — the product's only "push". Pass one of the `replan_options`
> from `get_goal`; the reason is optional and the product deliberately never demands one.

Backed by `POST /goals/:id/replan` (`ReplanGoalRequest`). Inputs: `goal_id` **yes**, `period_key`
**yes** (one of `replan_options`, and different from the current one), `reason` optional ≤ 280.

Output: `{ goal, previous_period, server_now }`.
Rules: R-goal-22/23, D-3; refuses with `LIFE_GOAL_IMMUTABLE`, `VALIDATION_FAILED`.

**A Weekly goal is not re-plannable.** It *is* a week, and moving it would restate what a past week
held. An intention that did not happen carries forward through its open tasks, or is written again for
the new week (R-goal-22).

---

#### `repeat_last_week` `[MUTATING]`

> Copy the previous week's weekly goals for **one life line** into the selected week, as ordinary new
> goals — same titles, no tasks, nothing linking them. There is no recurring-goal machinery behind this.

Inputs: `life_goal_id` **yes**, `week_start` **yes** — the Monday to copy *into*, absolute rather than an
offset so a call that crossed a Monday boundary writes where it meant to.

Output: `{ created: [...], count, server_now }`. Rules: R-lens-13, R-goal-36.

---

#### `delete_goal` `[MUTATING]` **destructive**

> Permanently delete a goal **and its entire subtree**: every sub-goal, weekly goal, task (with its
> activity timeline) and backlog item below it. Learnings tagged to anything deleted fall back to
> "Unsorted". There is no undo and no trash. Call `preview_goal_deletion` first and repeat its counts to
> the user; only set `cascade` after the user has agreed to those specific numbers.

Backed by `DELETE /goals/:id?cascade=`. Inputs: `goal_id` **yes**, `cascade` boolean default `false`
(required `true` when the goal has descendants).

Output: `{ deleted, removed: { goals, weekly_goals, tasks, task_events, backlog_items },
untagged: { learnings }, server_now }`.
Rules: Q-5, D-27; refuses with `GOAL_HAS_CHILDREN`.

---

### 2.3 The weekly plan — retired as an object

There is no plan entity, no `/plan` route and no focus sentence. `get_weekly_plan`, `set_goal_focus`,
`clear_goal_focus` and `save_weekly_plan` are **deleted**, and with them the whole-week atomic replace
that made them necessary.

What replaced them, and where each old intent went:

| Pre-A2 | Now |
|---|---|
| "activate a branch with a sentence" | `create_goal(horizon="Weekly", period_key=<Monday>)` — the intent *is* the goal |
| "stand a branch down" | nothing. A week you did not write for holds no weekly goal; there is no state to clear |
| "read this week's plan" | `list_lens(lens="Weekly")` |
| "replace the whole week" | nothing, deliberately. Weekly goals are created and deleted one at a time |
| `dormant_leaves` | `carried` — earlier weeks' goals that still hold open work (R-lens-12) |

The safety rail this section used to carry (`confirm_deactivations`, §7 rail 3) is retired with it: a
write that silently deactivated branches the agent forgot to list is not expressible any more, which is
better than guarding it.

Several weekly goals may sit under one monthly goal in the same week — that is how a week holds more
than one intention.

---

### 2.4 Tasks

#### `list_tasks` `[READ-ONLY]`

> The tasks visible in one week, and — ⚠ **A8** — the month tasks of the month that week belongs to.
> Open tasks appear in every period from the one they were created in onwards, at their own scope: a week
> task carries into next week, a month task into next month. Done tasks appear only in the period they
> were completed in. Cancelled and moved-to-backlog tasks appear in none.

Backed by `GET /tasks?week=` (`TasksResponse`) and, for the month half, the Weekly lens's `monthTasks`.

- `week_offset` — `-520 … 520`, default `0`. Carry ages are counted against **today**, not against the
  period you are viewing, so a plan never ages (R-task-43).
- `scope` — ⚠ **A8, new.** `week` (default) \| `month` \| `all`. `month` is the month tasks of the month
  this week belongs to, by the **Monday rule**: the week of Mon 31 Aug shows August's, on 2 September.
- `state` — `all` (default) \| `open` \| `done` \| `carrying`. `carrying` = open with `carry_age ≥ 1`.
- `limit` — ≤ 200.

Output: `{ week, month_period_key, tasks[], next_cursor, server_now }`. Each task carries `goal_id`,
`goal_path`, `title`, `cond`, `description`, `links[]`, `status`, `done`, ⚠ **A8** `scope`,
`origin_period_key`, `done_period_key`, `done_at`, `exit_reason`, `exited_at`, `carry_age`, ⚠ **A8**
`carry_unit`, `carry_label`, `completable`, ⚠ **A8** `measure`, `created_at`, `updated_at`.

⚠ **A8 — a month task in a week is NOT late.** It carries its honest month-scale `carry_age`, and the
month band renders no label from it at all (R-task-54, S-lens-31-2). An agent that reports "three weeks
overdue" off a month task has said the opposite of the rule this amendment exists to state.

There is **no `plan` array** in this response any more. **`carry_weeks` is signed** (R-task-43): a
negative age means the work is planned for a future week and is early, not late, and no carry label
fires at `≤ 0`. `completable` is the server's own answer to "can this be ticked off in this week".

Rules: R-task-7/8/10/11/12/43, R-lens-12, D-11, Q-12.

---

#### `get_task` `[READ-ONLY]`

> One task with its full activity timeline — creation source, every week it carried into, renames,
> done-condition edits, links added and removed, completions, unchecks and exits, newest first. The
> timeline is written by the server and is read-only.

Inputs: `task_id` **yes**, `week_offset` default `0`.

Output: the task fields above plus `events: [{ id, kind, at, text, glyph, detail }]` (`kind` ∈
`created`, `carried`, `renamed`, `cond_edited`, `description_updated`, `link_added`, `link_removed`,
`completed`, `unchecked`, `moved_to_backlog`, `canceled`).
Rules: R-task-22/27/29/30/31; there is **no** tool to write, edit or delete a task event (S-task-30-1).

---

#### `create_task` `[MUTATING]`

> Add a task to a **monthly or a weekly goal** — the condition is the horizon and nothing else
> (⚠ **A8**, R-task-51). On a monthly goal, leaving `period` out gives you a **month task on that goal**:
> one row, nothing inferred, no weekly goal invented, no navigation. That is the normal case.

Backed by `POST /tasks` (`CreateTaskRequest`).

- Exactly one of `goal_id` (a **Monthly or Weekly** goal) or `new_weekly_goal` `{ parent_id, title }`.
- `period` — ⚠ **A8/A11, new.** One field, two scopes, the key's **format** the discriminator
  (R-task-52). Omitted on a monthly goal ⇒ a **month task** in that goal's month. One of that month's
  **Mondays** ⇒ the `Add to this week` path: the weekly goal under it is resolved, two or more give
  `AMBIGUOUS_CONVERSION_TARGET`, none gives `NO_WEEKLY_GOAL` and you re-send with `new_weekly_goal`.
- `measure` — ⚠ **A8, new** (Q-E). Attaches a number in the same call: `{ kind, start, target, unit }`.
  Omit for an ordinary checkbox, which is what most tasks are.
- `title` **yes** — trimmed 1–200.
- `cond` — done-condition, trimmed ≤ 200, default `""`. **Optional by design; do not fabricate one.**
- `description` — ≤ 4000, default `""`. `links` — ≤ 20 `http(s)` URLs.
- `source` — `goal` (default) \| `drawer`, recorded once on the `Created —` event. `backlog` is set by
  the conversion tool and must not be passed here.

The task takes its **scope and period** from the resolved goal and then fixes both for good; the only
thing that rewrites them afterwards is `retarget_task`.

⚠ **`new_weekly_goal` never fires as a side effect of a default.** The month path creates exactly one
row. A weekly goal is minted only when the request carries `new_weekly_goal`, which a client sends only
after the owner named a week and the server refused (R-rm-6: the silent implicit create is deleted, not
repaired).

Output: `{ task, created_weekly_goal, server_now }`.
Rules: R-task-1/2/3/4/5/6/48/51/52/57, R-goal-37, D-10; refuses with `NOT_A_TASK_GOAL`, `NO_WEEKLY_GOAL`,
`AMBIGUOUS_CONVERSION_TARGET`, `PERIOD_IN_PAST`, `MEASURE_TARGET_EQUALS_START`, `VALIDATION_FAILED`.

`NOT_A_LEAF` and `BRANCH_NOT_ACTIVE` are gone: the first because leaf-ness decides nothing, the second
because there is no activation to be missing. `NOT_A_WEEKLY_GOAL` is gone with A8's R-rm-6, replaced by
`NOT_A_TASK_GOAL`, which names two horizons instead of one.

---

#### `update_task` `[MUTATING]`

> Edit a task's title, done-condition or description. Done tasks stay editable. Each changed field is
> logged on the activity timeline automatically.

Inputs: `task_id` **yes**, then at least one of `title`, `cond`, `description`. A no-op edit writes
nothing and logs nothing. Rules: R-task-23/26/27/30.

---

#### `complete_task` `[MUTATING]` — exit 1 of 3

> Tick a task off. You may complete into any period from the task's origin onward that has already
> begun — past periods stay fully editable. The task then appears only in the period it was completed in.

Inputs: `task_id` **yes**, `period` optional (defaults to the current week).

⚠ **A8 (R-task-55) — `week_offset` is REPLACED by `period`, an explicit canonical key.** An offset cannot
express *"the period I am standing in"* once a task may be scoped to a month: on Wed 2 Sep 2026 the
current week belongs to **August** while the current month is September, so offset 0 has two answers and
only the caller knows which surface it is on. Completing a month task from the month band of the week of
Mon 31 Aug therefore writes `2026-08` — a past month, which R-goal-36 permits without qualification,
because past periods are closed to *plan* and to nothing else (S-task-55-2). **This is a breaking MCP
change and there is no compatibility path** (Q-B): keeping both would be two code paths and an ambiguity
for an agent to get wrong.

The bound is `origin ≤ period ≤ current`, **at the task's own scope**, and it now lives in the service
rather than in the schema — the same guard, moved to where the scope is known.

Rules: R-task-13/14/55, S-task-14-1/14-2, S-task-55-1/55-2; refuses with `WEEK_OUT_OF_RANGE`.

---

#### `uncheck_task` `[MUTATING]`

> Re-open a completed task. It keeps its original creation week, so it immediately carries into the
> current week with the age it actually earned, and its weekly goal reappears alongside it. Optionally
> update the done-condition at the same time — leaving it out is a no-op, which is the normal case.

Inputs: `task_id` **yes** (task must be `done`), `cond` optional.
Rules: R-task-19/20/21; refuses with `VALIDATION_FAILED` when the task is not done.

---

#### `move_task_to_backlog` `[MUTATING]` — exit 2 of 3

> Take a task out of the week and park it on the nearest goal **above** the week — normally the monthly
> parent — keeping the description and links and noting which week it came from. The reason is optional;
> pass only what the user actually said. Only open tasks can be moved.

Inputs: `task_id` **yes** (must be `open`), `period` optional (defaults to the current week), `reason`
optional ≤ 280. ⚠ **A8** — `week_offset` became `period` here for `complete_task`'s reason. For a **month
task** the item lands on the goal it is already on (R-task-59): a monthly goal holds both a backlog and
tasks, so R-backlog-29's walk terminates immediately, and the item renders `from Sep 2026`.

It has to *leave* the week; that is the point of the exit, and it is why the item lands a horizon up
rather than on the weekly goal it came from (a backlog item has no week, and a weekly goal would give it
one).

Output: `{ task, item, server_now }`. Rules: R-task-13/15/17/18, D-12, D-15; refuses with
`TASK_ALREADY_EXITED`.

---

#### `cancel_task` `[MUTATING]` — exit 3 of 3

> Drop a task. It leaves every week but its record and timeline survive. The reason is optional. Only
> open tasks can be cancelled.

Inputs: `task_id` **yes** (must be `open`), `reason` optional. Refuses with `TASK_ALREADY_EXITED`.

There is **no** fourth exit. Requests to defer, snooze, reschedule or move a task to a different week
have no tool and must be refused, not approximated (R-task-13, S-task-13-1, R-nav-14). Note that
"move it to next week" is not merely unsupported — it is unnecessary: an open task carries into every
later week by itself, with no write at all.

---

#### `retarget_task` `[MUTATING]`

> Park a month task into a week, or move a week task back to its month. **Not a fourth exit**
> (R-task-56, S-task-56-4): the task is still open, still visible and still the owner's to finish, and it
> keeps its title, condition, description, links, timeline and **every recorded value** — only the goal
> and the period change. Reversible on purpose.

Backed by `POST /tasks/:id/retarget` (`RetargetTaskRequest` → `RetargetTaskResponse`).

- `period` — a **Monday** parks; a **month key** moves back. The task's own scope plus the key's format
  decide the direction, so there is no `direction` argument and no second tool.
- `goal_id` — parking only, when two or more weekly goals qualify (`AMBIGUOUS_CONVERSION_TARGET`).
- `new_weekly_goal` — parking only, when none does (`NO_WEEKLY_GOAL`); creates it in one transaction
  (R-task-48).

Refused: a week task to a **different week** and a month task to a **different month** — those are the
reschedule this product does not have. A past period (`PERIOD_IN_PAST`), and a done or exited task
(`TASK_ALREADY_EXITED`). Retargeting to the period the task is already in is a no-op that writes no
event. A weekly goal with no monthly ancestor cannot be moved back at all (`HORIZON_CONFLICT`).

---

#### `set_task_measure` / `clear_task_measure` `[MUTATING]`

> Give a task a number, or take it away. Two kinds and **no third**: a `counter` you add to and a
> `gauge` you set. A checkbox is the ABSENCE of a measure, not a counter that stops at one
> (R-measure-1).

Backed by `PUT` / `DELETE /tasks/:id/measure` (`SetMeasureRequest` → `TaskResponse`).

- `measure.kind` — `counter` \| `gauge`.
- `measure.start` — default `0`. `measure.target` — nullable, default `null`. `measure.unit` — ≤ 16.
- There is **no `current`** and no field to send one: it is derived from the readings (R-measure-3).
- There is **no direction flag**: `target` above `start` counts up, below it counts down (R-measure-2).
- `target === start` is refused with `MEASURE_TARGET_EQUALS_START` — it names no movement (R-measure-4).
- `target: null` is a **first-class** tracked number with a history and no percentage, not a degraded one.

`clear_task_measure` **deletes every recorded value** with the measure, in one transaction. Name the
count first (`list_readings`) and get an explicit yes — the same discipline the goal cascade uses (Q-5).

---

#### `record_reading` / `list_readings` / `delete_reading` `[MUTATING]` `[READ-ONLY]` `[MUTATING]`

> Record a value, read the history, delete one value. Append-only and individually deletable: there is
> no edit, because correcting a mistyped 240 is deleting it and recording 24 (R-measure-5).

Backed by `POST /tasks/:id/readings`, the task-page read, and `DELETE /tasks/:id/readings/:readingId`.

- Exactly one of `value` (absolute) or `delta` (add). A `delta` against a **gauge** is refused with
  `MEASURE_KIND_MISMATCH`; an absolute `value` against a **counter** is accepted, because correcting a
  counter to where it actually is is legitimate (R-measure-3, S-measure-3-3).
- What is **stored** is always the absolute value after the reading, which is what makes deletion correct
  with one rule for both kinds.
- `at` — optional; back-dating a reading is legitimate and does not make it the current value.
- Capped at 2,000 per task (Q-26). No compaction, no rollup, no pruning.
- **Readings follow the TASK and never the week** (R-measure-5): they survive carrying, parking,
  un-parking, re-parenting, completion and unchecking, and no reading has a week, month or period.
- **No reading writes a timeline entry**, on record or on delete (R-measure-7).
- A task with no measure is refused with `NO_MEASURE`.

⚠ **Nothing here may be turned into a verdict** (R-measure-8): no pace, projection, forecast, trend,
moving average, on-track/behind/ahead state, streak, completion rate, burndown, per-period summary, or
sum across two tasks. Report what was recorded.

---

#### `add_task_link` / `remove_task_link` `[MUTATING]`

> Attach or detach an external link. Logs `Link added: <host>` / `Link removed: <host>`.

`add_task_link`: `task_id`, `url` (`http`/`https` only, ≤ 2048 chars; max 20 links per task).
`remove_task_link`: `task_id`, `link_id` from `get_task().links[].id`.
Rules: R-task-24/25, D-13, Q-11.

---

### 2.5 Backlog

#### `list_backlog` `[READ-ONLY]`

> Deferred future work with its goal path, newest first across goals and in the owner's own manual order
> within a goal. Backlog items have no checkbox, no done-condition, no due date and no status — that
> poverty is deliberate. Converted items are never listed.

Inputs: `goal_id` optional (narrows to one goal; on a **Life** goal this is the read-only aggregate of
its descendants' items, R-backlog-12), `limit` ≤ 200.

Output: `{ items: [{ …item, goal_path }], next_cursor, server_now }`.

`under_goal_id` and `convertible_only` were designed and **not built**. `convertible_only` asked which
items sit under an *active leaf*, a question that no longer means anything: any item can become work in
any week, because the receiving weekly goal is created on demand (see `convert_backlog_item_to_task`).

Rules: R-backlog-1/2/3/5/13/17/21, Q-7, Q-12.

---

#### `create_backlog_item` `[MUTATING]`

> Park work under a **Yearly, Quarterly or Monthly** goal. Never a Life goal, and never a Weekly goal —
> a backlog item has no week, and a weekly goal would give it one.

Inputs: `goal_id` **yes**, `title` **yes** (1–200), `description` ≤ 4000, `links` ≤ 20.
The item lands at the **top** of that goal's list. Rules: R-backlog-2/4/16; refuses with
`LIFE_GOAL_NO_BACKLOG` — a Weekly goal is refused too, for the converse of the reason a Weekly goal is
the only thing that used to hold a task: an item has no week, and a weekly goal would give it one.

---

#### `update_backlog_item` / `move_backlog_item` / `delete_backlog_item` `[MUTATING]`

- `update_backlog_item` — `item_id` plus any of `title`, `description`, `links` (which **replaces** the
  whole list). Cannot change position. Refuses with `ALREADY_CONVERTED`.
- `move_backlog_item` — `item_id`, `goal_id`. Lands at the top of the destination; the manual position
  does not travel with it. Captured date and "from week of …" note do not change. Refuses with
  `LIFE_GOAL_NO_BACKLOG`.
- `delete_backlog_item` **destructive** — `item_id`, one item per call. There is no archive and no undo;
  confirm with the user first, and note that `move_backlog_item` is usually what they actually want.
  (The design's required `confirmed: true` flag was **not** built — see §7, rail 5.)

---

#### `reorder_backlog_item` `[MUTATING]`

> Move an item within its **own** goal's list. There is no position number anywhere in this product, so
> the move is always relative.

Inputs: `item_id` **yes**, plus **exactly one** of `after_item_id`, `before_item_id`, or
`to: "top" | "bottom"`.

Order across goals is not the owner's to set: two items on different goals have no relative position, so
the only honest arrangement is the one that needs no decision (R-backlog-21).

Rules: R-backlog-17/21.

---

#### `convert_backlog_item_to_task` `[MUTATING]`

> The **only** way backlog becomes work. The item is consumed and becomes a task in one atomic operation
> — never duplicated, never left behind.

Inputs: `item_id` **yes** (must be `open`); one of `goal_id` (a Weekly goal for the target week) or
`new_weekly_goal` `{ parent_id, title }`; `week_offset` **≥ 0**, default `0`; `title` and `cond`
optional overrides.

If exactly one weekly goal qualifies for the target week it is used; if several do you must name one;
**if none exists, pass `new_weekly_goal` and the sheet's own behaviour is reproduced — one step, not
two.** The pre-A2 answer here was "activate the branch with `set_goal_focus` first", and there is
nothing left to activate.

Output: `{ task, item /* status: "converted" */, created_weekly_goal, server_now }`.
Rules: R-backlog-6/7/8/9, R-task-48/49, Q-4, D-18, D-19; refuses with `AMBIGUOUS_CONVERSION_TARGET`
(details carry `candidates`), `ALREADY_CONVERTED`, `PERIOD_IN_PAST`.

---

### 2.6 Learnings

#### `list_learnings` `[READ-ONLY]`

> Insights that might change the plan, newest first, with their Life-goal tag (`null` = "Unsorted") and
> the `applied` ("changed the plan") badge. Not a journal, and never converted into work.

Input: none. Output: `{ learnings: [{ …learning, goal_title }], next_cursor, server_now }`, capped at
`MAX_PAGE` like every other list (Q-12).

Rules: R-learning-1/2.

---

#### `capture_learning` / `update_learning` / `attach_learning_to_goal` / `discard_learning` `[MUTATING]`

- `capture_learning` — `text` **yes** (1–500), `goal_id` (a **Life** goal or `null`, default `null`),
  `applied` default `false`. Refuses with `NOT_A_LIFE_GOAL`.
- `update_learning` — `learning_id` **yes**, then `text` and/or `applied`. Only set `applied: true` when
  the user says a decision actually changed; the badge is a claim about the owner's decision, not
  something to infer (R-learning-4, D-23).
- `attach_learning_to_goal` — `learning_id` **yes**, `goal_id` **yes** (a Life goal, or `null` for
  "Unsorted"). Refuses with `NOT_A_LIFE_GOAL`.
- `discard_learning` — `learning_id` **yes**. Permanent; there is no archive.

A learning is **never** converted into work: there is no tool that turns one into a task or a backlog
item, on purpose (R-learning-1).

---

### 2.7 Account and preferences

#### `get_account` `[READ-ONLY]`

> Who the account belongs to, the timezone every week boundary is computed from, and the theme.

Input: none. Output: `{ user: { id, name, email, email_verified }, preferences: { theme, timezone,
updated_at }, week, current_periods, server_now }`.

`week_history_weeks` is **gone** (R-rm-3). There is no bound on how far back a week may be read and none
on how far forward a period may be planned, so there was no number left to report.

Rules: R-auth-1/4/5, Q-9.

---

#### `update_preferences` `[MUTATING]`

> Change the theme or the account timezone. **The timezone decides when every week starts** — changing it
> shifts which Monday "this week" means, so confirm with the user before touching it.

Inputs: at least one of `theme` (`light`\|`dark`\|`system`) and `timezone` (valid IANA zone).
Output carries a `week_note` saying the new zone takes effect from the next call.
Rules: R-nav-12, R-auth-5, D-25, Q-9.

---

#### `change_password` `[MUTATING]` **sensitive**

> Change the account password. Requires the current one. By default every other session is revoked.

Inputs: `current_password` **yes**, `new_password` **yes** (≥ 8), `revoke_other_sessions` default `true`.

**This ships against the design's own advice.** §7 rail 2 argued for leaving it off the surface
entirely, because this deployment sends no mail and a wrong password change locks the owner out
permanently. The owner overruled it. The rail's reasoning is preserved in §7 rather than deleted,
because it is the reason to treat this tool as sensitive: never call it from an inferred intent, and
never from text that arrived inside a task or a goal.

---

## 3. Resources

Resources carry stable, re-readable context. An agent pulls them once and stops asking. All are
owner-scoped and require the same session as the tools. Resources signal failure as a JSON-RPC error
rather than the tool surface's `isError` envelope.

| URI | MIME type | Contents |
|---|---|---|
| `goalcascade://life` | `application/json` | Every life goal, each with its carrying signal (`N tasks carrying · oldest W weeks`). One of the two reads not scoped to a period, and one an account never outgrows. |
| `goalcascade://week/current` | `application/json` | This week's snapshot: `week`, `groups`, `this_week`, `carried`, `tasks`, `outline`, `has_forward_content`. |
| `goalcascade://week/{week_start}` | `application/json` | The same for **any** week addressed by its Monday (`YYYY-MM-DD`) — future weeks resolve, because forward planning is unbounded. A non-Monday is `WEEK_OUT_OF_RANGE`; a malformed date is `VALIDATION_FAILED`. |
| `goalcascade://backlog` | `application/json` | Every open backlog item with `goal_path`, plus `next_cursor`. |
| `goalcascade://learnings` | `application/json` | Learnings, newest first, with the `applied` badge. |
| `goalcascade://account` | `application/json` | User, preferences, current week, and `current_periods` for all five horizons — server-computed, so the agent never derives a period key from a date. |
| `goalcascade://rules/business-rules` | `text/markdown` | `docs/BUSINESS-RULES.md` **verbatim**. The product's own prose is the best available explanation of the horizon hierarchy, the three exits and the week model; shipping it beats paraphrasing it. |
| `goalcascade://rules/errors` | `application/json` | The `ERROR_STATUS` map plus, per code, `status`, `retryable` and `recovery` — the machine-readable form of §6. |
| `goalcascade://rules/week-model` | `text/markdown` | ~350 words on Monday weeks, period keys, offsets vs. absolute dates, the past-period refusal, auto-carry and the signed carry age. The single thing most likely to be got wrong. |

`goalcascade://tree` and `goalcascade://tree/outline` are **deleted**. There is no whole-tree read on the
surface at all: the goal list grows with use, so a resource that returned it would grow without bound
(R-lens-27). The week resources carry an `outline` string, but it is a **flat** list grouped under each
life goal — not an indented tree, and it carries no `ACTIVE:` line, because there is no such state.

Deliberately **not** resources: anything paginated or unbounded (task activity timelines, historical
tasks across all weeks). Those stay behind tools so the agent pays for what it asks for.

---

## 4. Prompts

Four prompts ship. **`apps/api/src/api/mcp/prompts.ts` holds the exact text**; what follows is the
design — the shape of each workflow and the refusals built into it. This section is deliberately a
summary and not a copy: the pre-A2 version of this document *was* a copy, it drifted, and live code
cited it while it did.

### `plan_the_week`

Argument: `notes` (string, ≤ 2000 — anything the user already said about the week ahead).

Reads `goalcascade://week/current` and `list_lens(lens="Monthly")`. Reports three things: what is
already written for this week, what is **carrying** into it from earlier weeks, and which monthly goals
have nothing in the week at all. Asks the user to confirm a shortlist — it never decides. Then writes
with `create_goal(horizon="Weekly")` one goal at a time, or `repeat_last_week` for a line the user wants
repeated. Finally, for each new weekly goal, reads `get_goal`'s `pull_list` and converts only the items
the user names.

**Refuses:** creating, completing or cancelling any task unless asked; deleting a past week's weekly
goal. *(Pre-A2 this step read "write the plan with `set_goal_focus` one branch at a time" and warned
which branches would go dormant. Both are gone with the plan object.)*

### `review_the_carry`

Argument: `weeks` (integer 1–52, default `2` — the minimum age to report on).

Calls `list_tasks(week_offset=0, state="carrying")`, groups by life goal via
`goalcascade://week/current`, and for every task at least `weeks` old calls `get_task` to read its
timeline. States the honest reading in one line per task, then offers **exactly the three exits this
product has** — `complete_task`, `move_task_to_backlog`, `cancel_task` — and passes a reason through
verbatim when the user gives one, leaving it empty when they do not.

**Refuses:** defer, snooze, reschedule, or move-to-another-week; creating, editing or deleting any goal.

### `triage_the_backlog`

Argument: `goal` (string, ≤ 200 — a goal to limit the triage to).

Resolves a named goal with `find_goal` and confirms it first. Calls `list_backlog` scoped by `goal_id`,
cross-references `list_lens(lens="Weekly")` for which weekly goals could receive an item, then walks the
items a few at a time proposing `convert_backlog_item_to_task`, `move_backlog_item`,
`delete_backlog_item` (saying plainly that it is permanent) or leaving it. Where no weekly goal exists
for the target week it uses `convert_backlog_item_to_task`'s `new_weekly_goal` rather than reporting a
blocker. Says out loud, before the first conversion, that converting **consumes** the item.

*(Pre-A2 this ended by offering `set_goal_focus` to unblock "non-convertible" items. Nothing is blocked
now — the receiving goal is created on demand.)*

### `goal_health_check`

Argument: `life_goal` (string, ≤ 200 — limit to one life line).

Reads `goalcascade://life`, `goalcascade://week/current`, and `list_lens` for Monthly and Quarterly,
optionally scoped with `find_goal`. Flags, without softening: months with nothing planned, periods that
have already passed, goals marked `At risk` or `Rethink` with nothing written this week, and goals whose
`planned_age_weeks ≥ 2`. Offers the specific move for each — `replan_goal` using `get_goal`'s
`replan_options`, `update_goal`, `create_goal(horizon="Weekly")`, or `move_goal`. Reads `list_learnings`
and offers `update_learning` with `applied=true` where one actually changed the plan.

**Refuses:** proposing a deletion. If deletion genuinely looks right it says so in words and stops.

---

## 5. Server instructions block

This is the `instructions` string the MCP server advertises on connect.

```
Goal Cascade is one person's goals and their week. You are acting on the owner's own account:
one owner, one set of goals, no sharing, no other users.

THE HIERARCHY. Goals nest in exactly five horizons: Life › Yearly › Quarterly › Monthly › Weekly. A
child's horizon must be strictly shorter than its parent's, so Life goals sit at the root with no
parent and no period, and WEEKLY goals can never have sub-goals. Levels may be skipped: a weekly goal
usually hangs off a monthly one, but it may hang off any longer horizon, including a life goal
directly. That is legal, not a mistake to correct.

MONTHLY AND WEEKLY GOALS HOLD TASKS. The condition is the horizon and nothing else. A quarterly goal
that happens to have no monthly children yet still cannot hold a task — it looks like the end of a
branch and it is not a place work goes. The line falls where it does because a month is the longest
deadline you can put on a piece of work here: the horizons that hold deferred, undated work are
yearly, quarterly and monthly, the horizons that hold committed, dated work are monthly and weekly,
and monthly is deliberately the one that holds both. Past a month it is a goal, or it is in the
backlog. There is no "active", no "dormant" and no focus sentence in this product — a weekly intent
IS a goal, and several under one monthly goal is how a week holds several intentions.

A TASK'S PERIOD, AND ITS SCOPE. A task belongs to one period at one scope: a task on a weekly goal
has a WEEK, a task on a monthly goal has a MONTH. It is taken from that goal when the task is created
and then never changes, except by one named operation (see PARKING). The key's format says which
scope you are looking at — 2026-09 is a month and 2026-09-07 is a week's Monday — and every
comparison the product makes is inside one scope, never across two. Creating a task on a monthly goal
with no period is the normal case and gives you a month task on that goal; naming one of that month's
Mondays instead asks for that week, which resolves the weekly goal under it and may need one created.
Do not name a week the user did not ask for.

PERIODS. Every non-life goal sits in exactly one period of its own horizon, named by a canonical key:
a year (2026), a quarter (2026-Q3), a month (2026-09), or a week (a Monday, 2026-09-07). The key is
what every lens filters on, so it is never free text. A goal's period is never checked against its
parent's — a week that straddles a month boundary is ordinary. NOTHING IS EVER CREATED INTO, OR MOVED
INTO, A PAST PERIOD: planning does not rewrite history, and that refusal is PERIOD_IN_PAST. There is
no limit in the other direction — you may set goals and tasks as far ahead as the owner wants. A
weekly goal's week is fixed for good once created: it is not re-plannable, and moving it to another
parent never changes its week.

WHAT A PERIOD SPANS. A period is the WHOLE WEEKS it contains, and a week belongs to its MONDAY's
period. So Sep 2026 is the four weeks beginning 7, 14, 21 and 28 September: it runs Mon 7 Sep to Sun
4 Oct, and it does not contain the week of Mon 31 Aug, which is August's. Every period you are given
carries week_range — quote that, and never present a month, a quarter or a year as its calendar
dates. It follows that the current period of a horizon is not always the period holding the week in
progress: on Tue 1 Sep 2026 the current month is Sep 2026 while this week sits in Aug 2026. Where a
period carries current_week_period, that is where the week in progress actually is, and the period
you are reading legitimately excludes it — that is not a bug, not an empty plan, and not a reason to
move anything. It is also which month a week's month tasks come from: the week of Mon 31 Aug shows
AUGUST's, on 2 September.

LENSES. Reading is by lens, not by tree: one horizon, one period, everything at that horizon across
the whole account, grouped under the life goal each item belongs to. Use list_lens. There is no
whole-tree read and no filter — grouping is the answer to "show me just this line". Two lenses carry
work: the Weekly lens shows the week's tasks, and the Monthly lens shows each monthly goal's own
month tasks. The other three show none, because those horizons hold none.

THE WEEK. Weeks start Monday, in the owner's own timezone, computed by the server — never from your
clock. Tools address a week by OFFSET: 0 is this week, -1 last week, +2 two weeks ahead. Positive
offsets are ordinary. The one place a future period is refused is COMPLETING a task: you cannot
finish work in a period that has not happened. A completion names the period it was made in, at the
task's own scope, so completing a month task from the week of Mon 31 Aug on 2 September writes
AUGUST — the period you were standing in, not "the current month".

CARRYING. An open task is visible in every period from the one it was created in onward, at its own
scope. It carries forward by itself — there is no rollover step, no prompt, and nothing to confirm —
and a weekly goal comes with its tasks, shown as CARRIED and labelled with the week it was written
for, so it never reads as this week's plan. A week task carries into next week; a MONTH TASK CARRIES
INTO NEXT MONTH, by the same mechanism and with no write. A task that has carried one period shows
"since Mon 24 Aug" or "since Aug"; two or more shows a red chip, "3 weeks" or "3 months". That chip
is the only escalation in the product, it is counted in the task's own unit, and it never fires on
work whose period has not arrived — a task planned ahead has a NEGATIVE age. A completed task is
visible only in the period it was completed in.

A MONTH TASK IS NEVER LATE IN A WEEK. It appears in the month band of every week of its month, and it
carries no chip, no "since" line and no badge there of any kind. A month task you have not got to in
week two is not behind: the deadline is the end of the month, and a week has no standing to say
otherwise. Do not call one overdue, at risk, or slipping because weeks have passed. Between MONTHS
the same chip fires normally, in the Monthly lens, where the unit means something.

THE THREE EXITS. A task leaves a week in exactly three ways: COMPLETE, MOVE TO BACKLOG, or CANCEL.
There is no fourth exit. Do not offer or simulate defer, snooze, reschedule, or move-to-another-week.
Move to backlog parks the item on the nearest goal that can hold one — the monthly parent for a week
task, and for a month task the goal it is already on — because the point of that exit is to leave the
period. Unchecking a completed task re-opens it under its ORIGINAL creation period, so it comes back
with the age it really has.

PARKING IS NOT AN EXIT. retarget_task moves a month task into a specific week, and a week task back
to its month. The task is still open, still visible and still the owner's to finish; it keeps its
title, condition, description, links, timeline and every recorded value, and only its goal and its
period change. It is reversible on purpose. It is NOT a defer, a snooze or a reschedule: a week task
cannot be parked into a different week and a month task cannot be moved to a different month, and
both are refused.

MEASURES. A task may carry a number, and most do not — a task without one is an ordinary checkbox and
is unchanged in every way. Two kinds and no third: a COUNTER you add to ("+3") and a GAUGE you set
("= 78.5"). One triple, start / current / target, plus a unit you were given and which is never
parsed or converted. DIRECTION IS IMPLIED: target above start counts up, target below start counts
down, and there is nothing to set. THE TARGET IS OPTIONAL — a measure with no target is a real,
tracked number with a history and no percentage, not a broken one — and a target equal to the start
is refused, because it names no movement. CURRENT IS DERIVED from an append-only list of readings,
each storing the absolute value after it; deleting a reading falls current back to the one before it,
which is why correcting a mistyped number means deleting it and recording the right one. READINGS
FOLLOW THE TASK AND NEVER THE WEEK: they survive carrying, parking, un-parking, completion and
unchecking, and there is no week, month or period on a reading. REACHING A TARGET NEVER COMPLETES A
TASK and completing a task never records a value: the owner decides both, and a task completed at 12
of 15 is the truth of it.

NO REPORTS. There is no review wizard, no audit trail, no week report, no completion rate, no streak
and no progress bar, and a goal has no "done" state at any horizon. Whether a week went well is
answered by looking at that week. That refusal extends to every number a measure makes available: no
pace, no projection, no forecast, no "at this rate", no trend line, no moving average, no on-track,
behind or ahead verdict in any word, colour or accessible name, no streak, no completion rate, no
burndown, no per-period summary, and no rolling a month's target up out of its weeks or summing a
measure across two tasks. The rule that admits the numbers and refuses these: a number the owner
recorded is data; a number you derived about the owner is a judgement. Report what was recorded. Do
not invent any of the rest, and refuse rather than approximate.

HOW TO WORK. Start with get_overview. Resolve names to ids with find_goal and ask when it reports
ambiguity — acting on the wrong goal is the worst thing you can do here. Reasons on exits and re-plans
are always optional; pass what the user said and nothing more. Deletes cascade and cannot be undone,
and deleting a monthly goal takes every weekly goal and task under it: preview, quote the numbers, get
agreement. Removing a measure deletes every value recorded on it: name the count first. Refusals carry
a code and a recovery step — read it and do that, do not retry.
```

---

## 6. Error surface

Every tool failure is returned as an MCP tool error whose content is:

```jsonc
{
  "code": "AMBIGUOUS_CONVERSION_TARGET",
  "message": "more than one weekly goal can receive this item — choose one",
  "recovery": "Ask the user which weekly goal should receive it, then call convert_backlog_item_to_task again with goal_id set to one of `candidates`.",
  "retryable": false,
  "details": { "itemId": "01J…", "candidates": [{ "id": "01J…", "title": "Three gym sessions" }] }
}
```

`code` is the existing `ErrorCode` verbatim; `details` is the existing `DomainError` details object.
`recovery` is written by the MCP layer for the model to read, and `retryable` tells it whether repeating
the identical call could ever succeed. It is `true` for exactly three codes: `IDEMPOTENCY_IN_PROGRESS`,
`RATE_LIMITED`, `INTERNAL`. Everything else is `false` — a 409 in this product means *do something
different*, and an agent that retries it burns turns and confuses the user.

The six codes worth teaching explicitly:

| Code | What actually happened | What the agent must do |
|---|---|---|
| `HORIZON_CONFLICT` | The child's horizon is not strictly shorter than the parent's — equal rank, or a Weekly parent (Weekly is terminal, R-goal-5/6/17). | Do not retry with the same pair. On create: pick a horizon of higher rank than the parent, or a different parent. On move: `details` carries both horizons — pick a target with a longer horizon, or tell the user this parent cannot hold this goal. |
| `WOULD_CREATE_CYCLE` | The move target is the goal itself or one of its descendants. R-goal-18(a,b). This check runs **before** the horizon check, so it is the reason you get when both apply. | Never retry. Re-read the relevant lens (`list_lens`) and choose a target outside the moved goal's subtree. If the user's phrasing pointed at a descendant, say plainly that a goal cannot move under its own child. |
| `NOT_A_TASK_GOAL` | ⚠ **A8** — tasks live on **monthly and weekly** goals, and this goal is at some other horizon. R-task-51, superseding R-goal-39. `details` carries the goal's horizon. | Do **not** hunt for a different goal that happens to be the right horizon. Put the work on the monthly goal for the month you mean — `create_task` with that `goal_id` and **no** `period` makes a month task on it — or on a weekly goal for a week. A quarterly goal with no monthly children looks like the end of a branch and is still not a place work goes. |
| `MEASURE_TARGET_EQUALS_START` | ⚠ **A8** — the target equals the start, which names no movement. R-measure-4. | Ask what the target actually is; do **not** invent one a unit away. If the user is tracking a number with no finish line, send `target: null` — a real measure with a history and no percentage. |
| `MEASURE_KIND_MISMATCH` | ⚠ **A8** — a `delta` against a **gauge**. R-measure-3. | Re-send with `value`. The reverse is legitimate and is not a mistake: an absolute `value` against a counter is how you correct one. |
| `NO_MEASURE` | ⚠ **A8** — the task carries no number; it is an ordinary checkbox. R-measure-1. | Attach a measure with `set_task_measure`, then record. Do **not** complete the task instead, and do not put the number in its description. |
| `NO_WEEKLY_GOAL` | The week you targeted holds no weekly goal that could receive this work. R-backlog-8, R-task-49. `details` carries the goal and the week. | Pass `new_weekly_goal` and let the call create the goal and the task in one step. This is a one-step flow by design; do not report it to the user as a blocker, and never park the work on some other goal instead. |
| `PERIOD_IN_PAST` | A write tried to create a goal in, or move one into, a period that has already passed. R-goal-36, R-lens-10. | Never retry with the same period. Past periods stay readable exactly as they were — planning does not rewrite history. Offer the current or a later period. Note this closes the past to **plan only**: completing, unchecking, editing and exiting a task in a past week all still work. |
| `AMBIGUOUS_CONVERSION_TARGET` | Two or more weekly goals in the target week qualify to receive the item. The server refuses to choose because this id fixes which goal the task belongs to for its whole life. `details.candidates` = `[{id,title}]`. | Ask the user which one, using the candidate titles. Then repeat the call with `goal_id`. Do not pick the first candidate, do not pick by ordering, and do not pick by string similarity. |

The rest, in brief:

| Code | Recovery |
|---|---|
| `GOAL_HAS_CHILDREN` | A delete was attempted on a goal with sub-goals without `cascade`. Do **not** simply resend with `cascade: true` — report the counts from `preview_goal_deletion`, get an explicit yes, then delete. This refusal is the product's confirmation step, not an argument you forgot. |
| `NOT_A_LIFE_GOAL` | Learning tags must be a Life goal or `null`. Use the goal's life root. |
| `LIFE_GOAL_NO_BACKLOG` | Backlog items need a Yearly/Quarterly/Monthly goal. Pick a descendant. |
| `LIFE_GOAL_IMMUTABLE` | Life goals cannot be moved or re-planned. Say so; do not work around it. |
| `ALREADY_CONVERTED` | This backlog item already became a task — a retry, a stale id, or a second agent. No second task was created. Find the task it became (`convertedToTaskId`) and continue with that; do not re-create the work by hand. |
| `TASK_ALREADY_EXITED` | The task is done, cancelled or already in the backlog. Only open tasks can be moved or cancelled. Re-read with `get_task`. |
| `WEEK_OUT_OF_RANGE` | A completion week earlier than the task's origin or later than this one, or a `week_start` that is not a Monday. Weeks are keyed by their Monday (R-goal-33). |
| `CONCURRENT_UPDATE` | Someone (the owner's phone) changed the row first. Re-read the entity, re-check the user's intent still applies, then write once. Never loop. |
| `VALIDATION_FAILED` | A field is out of bounds or whitespace-only — including a period key that is not canonical for its horizon. `details` names the field; fix and retry once. |
| `NOT_FOUND` | The id does not exist for this owner — deleted, or never existed. Re-resolve with `find_goal` / a list tool. Do not report "permission denied": this product cannot distinguish the two, on purpose. |
| `IDEMPOTENCY_IN_PROGRESS` | An identical write is in flight. Wait briefly and re-read; do not fire a second write. |
| `UNAUTHENTICATED` / `INVALID_API_TOKEN` / `FORBIDDEN` | The session or token is gone. Stop and tell the user to reconnect. |
| `RATE_LIMITED` / `INTERNAL` | Transient. Back off once, then report rather than hammering. |

`IDEMPOTENCY_KEY_MISSING` and `IDEMPOTENCY_KEY_REUSED` should never reach an agent — the server owns
those keys (§7, rail 6). If one does, it is an MCP-server bug and should surface as `INTERNAL`.
`SIGNUP_NOT_ALLOWED` and `NOT_IMPLEMENTED` are not reachable from any tool.

**Four codes this document used to teach are deleted from `ERROR_STATUS`.** They are listed here so that
a reader who remembers them finds the successor rather than assuming a gap:

| Deleted | Why | Successor |
|---|---|---|
| `NOT_A_LEAF` | Leaf-ness stopped deciding task ownership (R-goal-37) | `NOT_A_TASK_GOAL` (via A2's `NOT_A_WEEKLY_GOAL`, itself retired by A8's R-rm-6) |
| `BRANCH_NOT_ACTIVE` | There is no activation to be missing (R-rm-2) | `NO_WEEKLY_GOAL` |
| `WEEK_NOT_CURRENT` | Planning is no longer confined to the current week (R-goal-36, R-lens-7) | `PERIOD_IN_PAST` |
| `GOAL_HAS_OPEN_TASKS` | It guarded making a leaf a parent; nothing left to guard (R-goal-42) | none, deliberately |

`packages/shared/tests/contract.test.ts` inverts the assertion on all four, so re-introducing one fails.

---

## 7. Safety rails

The owner asked for full access to every entity. These are the places to put a speed bump anyway, with
the reason. Each is individually overrulable — and two of them were overruled or retired, which is
recorded here rather than quietly deleted.

1. **`delete_goal` requires a preview.** A goal delete takes the whole subtree with it — sub-goals,
   weekly goals, tasks, task events, backlog items — with no soft-delete and no trash (Q-5).
   `preview_goal_deletion` shipped and counts the leaf case too, so the most dangerous delete in the
   product is no longer the one with no preview. The design also called for an `acknowledged_counts`
   round-trip on `delete_goal`; that was **not built** — `delete_goal` takes a plain `cascade` boolean.
   The confirmation therefore lives in the tool description and the prompts, not in the schema.

2. **`change_password` was to get no tool at all — overruled by the owner, and it ships.** The argument
   stands and is why the tool is marked sensitive in §2.7: this deployment cannot send mail, so changing
   the password while signed in is the *only* recovery path the owner has. An agent that changes it —
   from a mis-parsed instruction, a prompt injection in a task description, or a bad retry — locks the
   owner out permanently. It requires the current password, which is the mitigation that made the
   overrule defensible; an agent must never call it from an inferred intent.

3. ~~**`save_weekly_plan` requires `confirm_deactivations`.**~~ **Retired with the plan object.**
   `PUT /plan` was a whole-week replace in which any leaf the agent forgot to list went dormant
   silently, and the rail forced the agent to count what it was turning off. There is no whole-week
   write any more: weekly goals are created one at a time and nothing is deactivated by omission
   (§2.3). The rail is recorded rather than deleted because the *failure mode* it named — a write that
   silently undoes work the agent did not know about — is the one to keep watching for in any future
   bulk tool.

4. **No tool may pass a title where an id is expected.** Fuzzy matching inside a mutating tool is the
   single highest-consequence failure mode on this surface: an agent that resolves "fitness" to the
   wrong monthly goal creates work under the wrong line, and nothing about the response looks wrong.
   `find_goal` makes resolution a visible, ambiguity-reporting step, and its `ambiguous: true` flag is
   what the model is told to escalate on.

5. **`delete_backlog_item` and `discard_learning` are one entity per call, and the prompts confirm
   first.** There is no archive anywhere in this product. Deleting a parked item is cheap for an agent
   and irreversible for the owner, and "clean up my backlog" is exactly the kind of instruction that
   reads as a licence to bulk-delete. The design's required `confirmed: true` flag was **not built**;
   what enforces this today is the tool descriptions and the prompts' one-at-a-time instruction. If
   these tools ever grow a bulk form, the flag should arrive with it.

6. **The agent never supplies an `Idempotency-Key`.** An LLM cannot reliably reason about when two calls
   are "the same operation", and a reused key across genuinely different intents returns a stale replay
   that looks like success. The server mints a fresh key per tool invocation and reuses it only for
   transport-level retries of that same invocation — which is exactly the semantics Q-4 wants.

7. **No bulk/batch mutation tool.** There is deliberately no `delete_goals`, `complete_tasks`, or
   `convert_all_backlog`. Everything destructive is one entity per call, so a misread instruction costs
   one row and one visible step, not a subtree. The prompts reinforce this ("one decision at a time").

8. **`update_preferences.timezone` should be confirmed with the user.** It silently redefines which
   Monday "this week" is, which moves every carry age and shifts which period each lens opens on. It is
   not destructive, but it is invisible, and invisible is worse here. The response's `week_note` says
   the change takes effect from the next call; read it back.

9. **The absent things stay absent.** No tool for a fourth task exit, a review wizard, a week report, or
   writing a task event (R-nav-14, R-task-13, R-task-31, S-task-30-1). An agent asked to "reschedule
   this to next week" must say the product does not do that — and, better, that it does not need to: an
   open task carries into every later week on its own. Adding a convenience tool here would be the first
   place the MCP surface and the product diverge.

10. **No tool returns the whole goal list.** Every read is scoped to one lens and one period, and every
    list is capped at `MAX_PAGE` with a cursor (Q-12, R-lens-27). This is a scale rail rather than a
    safety one, but it belongs in the same list: the goal table grows with every week the owner uses the
    product, so an unbounded read is a defect that only shows up on a real account.

---

## 8. Open questions — resolved

Every question below was open when this document was written and is now answered by what shipped. They
are kept, with their answers, because the reasoning is the part worth having.

1. **Does `preview_goal_deletion` get built, and as a `dryRun` flag or its own route?**
   **Resolved: its own read-only tool**, counting the leaf case too. The dangerous delete is no longer
   the one with no preview.

2. **Should `find_goal` fuzzy-match, or should the surface be ids-only?**
   **Resolved: fuzzy-match in `find_goal` and nowhere else**, with an explicit `ambiguous` flag. Ids-only
   is safer but costs the agent a full read and a manual scan on every turn — and since A2 there is no
   full read to scan. Concentrating the fuzziness in one read-only tool means the risk is inspectable
   and the mutating tools stay exact.

3. ~~**Should `save_weekly_plan` be exposed at all?**~~ **Moot.** The plan object is gone (§2.3). The
   answer at the time was "yes, with `confirm_deactivations` mandatory"; the redesign removed the
   question by removing the whole-week write.

4. **Should the MCP server expose past-week *writes* (completing a task in week -3)?**
   **Resolved: yes.** `complete_task(week_offset ≤ 0)` is a real product capability — past weeks stay
   fully interactive (R-task-14) — and an agent doing a carry review needs it. `WEEK_OUT_OF_RANGE`
   prevents the incoherent cases, and `PERIOD_IN_PAST` separately closes the past to new *plan*. The
   redesign sharpened this into a rule worth stating twice: **the past is closed to plan and open to
   truth.**

5. **Should `list_tasks` gain subtree filtering?**
   **Resolved: no, and the question dissolved.** `list_tasks` has no `goal_id` at all now: it returns
   the tasks visible in one week, and the Weekly lens's grouping by life goal answers "how's my health
   line doing" directly (R-lens-3).

6. **How much of `docs/BUSINESS-RULES.md` ships as a resource?**
   **Resolved: all of it, verbatim**, at `goalcascade://rules/business-rules`. It is the authoritative
   prose, and paraphrasing it into the instructions block is how the two drift. The copy is byte-pinned
   by `apps/api/tests/mcp/verbatim.test.ts`, because a copy with no alarm on it is a copy that drifts —
   which is exactly what happened to §§1–4 and 6–8 of *this* document.

7. **Should `update_learning(applied=true)` be agent-settable?**
   **Resolved: yes, but only on explicit user statement.** The badge means "this changed the plan",
   which is a claim about a decision the owner made, not something to infer. It is stated in the tool
   description rather than blocked.

8. **Should there be a `set_last_used_goal` equivalent for the `+` drawer's default?**
   **Resolved: no.** That is a client-local UI convenience (R-backlog-14), not account state, and there
   is no endpoint for it. An agent names the goal explicitly every time.

9. **Read-only mode as a deployment option?**
   **Still open.** A `GOALCASCADE_MCP_READONLY` flag advertising only the 11 read tools and the
   resources would be useful for connecting a second, untrusted agent (a summariser, a briefing bot)
   without giving it the write surface. Not a rail on the owner's own agent — an operational option, and
   not built.
