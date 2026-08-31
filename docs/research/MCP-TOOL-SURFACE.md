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

---

## 1. Design principles

1. **One cheap read makes the agent competent.** `get_overview` is the first call in almost every
   session: the whole tree as a path-labelled outline, the current week, active leaves and their focus
   sentences, and counts — enough to plan without a second round trip.
2. **Ids move between tools; titles never enter a mutating tool.** Resolution is one explicit, auditable
   step (`find_goal`), never a fuzzy match hidden inside a write.
3. **Tools are shaped like the product's intents, not like its rows.** `replan_goal` and `move_goal` are
   separate because they are separate rules with separate refusals; `update_goal` is one tool because
   editing the card is one intent.
4. **The dangerous primitive is wrapped, and the safe wrapper is what the agent reaches for first.**
   Whole-week plan replace and subtree delete both get intent-shaped, preview-first alternatives.
5. **The week is an integer offset ≤ 0, everywhere a tool takes one, except the plan save** — which takes
   the absolute Monday the server just handed back, so a call that crossed a Monday boundary fails loudly
   instead of writing into last week.
6. **Refusals are the product speaking, not failures.** Every error code is surfaced with its recovery
   move; a `409` here means "you need to do something else first", never "retry".
7. **Server-owned things stay server-owned.** Idempotency keys, ULIDs, task events, `originWeekStart`,
   derived flags: the agent never supplies them and never sees a field it could corrupt.
8. **What the product deliberately does not have, the surface does not invent** (R-nav-14, R-task-13):
   no fourth task exit, no review wizard, no week report, no audit view.

---

## 2. The tool list

**42 tools: 12 read-only, 30 mutating.**

| Category | Read | Mutating |
|---|---|---|
| Discovery & goals (read) | 5 | — |
| Goals (write) | — | 5 |
| Weekly plan / focus | 1 | 3 |
| Tasks | 2 | 8 |
| Backlog | 1 | 5 |
| Ideas | 1 | 4 |
| Learnings | 1 | 4 |
| Account & preferences | 1 | 1 |

Conventions used in every table below:

- **Mutating** tools are annotated `[MUTATING]`; everything else is `[READ-ONLY]`.
- Every mutating tool is executed by the server with a **freshly generated** `Idempotency-Key`. The agent
  never supplies one and cannot see one (§7, rail 6). Transport-level retries reuse the same key, so a
  dropped response never double-writes.
- `version` (optimistic concurrency, Q-2) is **not** an agent-facing input. The server reads the current
  version immediately before the write and sends it; a `CONCURRENT_UPDATE` is surfaced to the agent with
  the fresh state (§6).
- Every response carries `server_now` (ISO-8601 UTC) and, where a week is involved,
  `week: { week_start, offset, is_current }`.

---

### 2.1 Discovery and goal reads

#### `get_overview` `[READ-ONLY]`

> Start here. Returns the owner's entire goal tree as an indented outline with ids and paths, the current
> week, which branches are active this week and their focus sentences, plus counts of open tasks,
> backlog items, ideas and learnings. One call is enough to answer "what is this person working on".

Backed by `GET /bootstrap` (`BootstrapResponse`), reshaped.

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `include` | string[] | no | subset of `["tree","week","tasks","backlog","ideas","learnings"]`, default all | Trims the payload when the agent already has context. |
| `week_offset` | integer | no | `-520 … 0`, default `0` | Which week the snapshot is about. `0` = this week. |

Output:

```jsonc
{
  "week": { "week_start": "2026-08-31", "offset": 0, "is_current": true },
  "week_history_weeks": 8,
  "tree": [                       // depth-first, parents before children (Q-7)
    { "id": "01J…", "path": "Health › Get strong in 2026 › Q3 › Sep 2026",
      "title": "Sep 2026", "horizon": "Monthly", "period": "Sep 2026",
      "why": "", "pulse": "On track", "parent_id": "01J…",
      "is_leaf": true, "is_active": true, "dormant": false, "subtree_active": true,
      "focus": "Three gym sessions and one long run.",
      "backlog_count": 2,
      "carrying": null,           // Life goals only: { open_tasks, oldest_weeks }
      "branches": null }          // Life goals only: { active, total }
  ],
  "active_leaves": [ { "id": "01J…", "path": "…", "focus": "…" } ],
  "tasks": [ /* TaskView, this week */ ],
  "backlog": [ /* BacklogItemView, open only */ ],
  "ideas": [ /* IdeaView */ ],
  "learnings": [ /* LearningView */ ],
  "counts": { "goals": 14, "open_tasks": 9, "carrying_tasks": 3, "backlog": 11, "ideas": 4, "learnings": 6 },
  "server_now": "2026-08-31T09:12:00.000Z"
}
```

Rules: R-goal-8/9/10/11/24/25/26, R-nav-4, R-task-7/8, D-1, D-2, Q-7.

---

#### `find_goal` `[READ-ONLY]`

> Turn a phrase the user said ("my fitness goal", "Q3 revenue") into goal ids. Returns ranked candidates
> with full path, horizon and whether the branch is active this week. **Always call this before any tool
> that takes a `goal_id`, unless you already have the id from an earlier result in this conversation.**
> If two or more candidates come back with similar scores, ask the user which one — do not guess.

Derived in the MCP layer from `GET /goals?week=` (`GoalsResponse`); no new backend work — the whole tree
is one request and matching is local.

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `query` | string | **yes** | 1–200 chars | Free text matched against `title`, `why` and the full ancestor path. |
| `horizon` | string | no | `Life`\|`Yearly`\|`Quarterly`\|`Monthly` | Restrict to one horizon. |
| `only` | string | no | `any` (default) \| `leaves` \| `active_leaves` \| `can_hold_backlog` \| `life` | `active_leaves` = valid task targets (R-task-4); `can_hold_backlog` = non-Life (R-backlog-2); `life` = valid Idea/Learning tags (R-idea-2, R-learning-2). |
| `limit` | integer | no | `1…20`, default `5` | Candidates returned. |

Output:

```jsonc
{
  "matches": [
    { "id": "01J…", "title": "Sep 2026", "path": "Health › Get strong in 2026 › Q3 2026 › Sep 2026",
      "horizon": "Monthly", "period": "Sep 2026", "is_leaf": true, "is_active": true,
      "focus": "Three gym sessions and one long run.", "backlog_count": 2,
      "score": 0.91, "matched_on": "path" }
  ],
  "ambiguous": false,   // true when the top two scores are within 0.15 — ASK THE USER
  "server_now": "…"
}
```

Matching: case- and diacritic-insensitive; exact title > title prefix > title substring > path substring
> `why` substring; ties broken by shorter horizon first (the more specific goal), then `createdAt` asc.
Rules: R-goal-2/8/9, R-auth-3 (nothing outside the owner's tree is ever returned).

---

#### `list_goals` `[READ-ONLY]`

> The goal tree, filterable. Use `get_overview` for a first look; use this to answer narrow questions
> like "which branches are dormant" or "which goals hold backlog".

Backed by `GET /goals?week=`.

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `week_offset` | integer | no | `-520 … 0`, default `0` | Week the derived flags (`is_active`, `dormant`, `focus`) are computed for. |
| `horizon` | string | no | enum | Filter. |
| `state` | string | no | `all` (default) \| `active` \| `dormant` \| `leaves` \| `has_backlog` | Filter. |
| `under_goal_id` | string | no | ULID | Restrict to that goal's subtree (inclusive). |
| `format` | string | no | `outline` (default) \| `flat` | `outline` renders the indented text tree; `flat` returns the array. |

Output: `{ goals: GoalView[] , outline?: string, week, server_now }`.
Rules: R-goal-25, Q-7.

---

#### `get_goal` `[READ-ONLY]`

> One goal in full: breadcrumb path, children with their active/dormant state, its backlog, the learnings
> attached to its Life line, and the periods it could be re-planned to.

Backed by `GET /goals/:id?week=` (`GoalDetailResponse`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `goal_id` | string | **yes** | ULID | From `find_goal` or a previous result. |
| `week_offset` | integer | no | `-520 … 0`, default `0` | Week the derived flags are for. |

Output: `{ goal, ancestors[], children[], backlog[], backlog_is_aggregate, learnings[], replan_options[], week, server_now }`.

`backlog_is_aggregate` is `true` on a **Life** goal: the list is then a read-only roll-up of every
descendant's items and **must not** be passed to `move_backlog_item` / `delete_backlog_item` as if it were
that goal's own (R-backlog-12).
`replan_options` is the server's own derivation from today and this goal's horizon (R-goal-23, D-3) — the
agent must pass one of these to `replan_goal` rather than inventing a period string.
Rules: R-goal-27, R-backlog-11/12, R-learning-5, R-goal-21/23.

---

#### `preview_goal_deletion` `[READ-ONLY]` `[NEW BACKEND WORK]`

> **Call this before `delete_goal`, always.** Returns exactly what deleting this goal would destroy: the
> sub-goals, weekly focuses, tasks (with their activity timelines) and backlog items in its whole
> subtree, plus the ideas and learnings that would fall back to "Unsorted". Show these numbers to the
> user and get their agreement before deleting.

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `goal_id` | string | **yes** | ULID | The goal that would be deleted. |

Output:

```jsonc
{
  "goal": { "id": "01J…", "title": "Q3 2026", "path": "Health › … › Q3 2026", "horizon": "Quarterly" },
  "would_remove": { "goals": 3, "weekly_focuses": 2, "tasks": 11, "open_tasks": 4,
                    "task_events": 63, "backlog_items": 7 },
  "would_untag": { "ideas": 1, "learnings": 2 },
  "subtree": [ { "id": "01J…", "title": "Sep 2026", "horizon": "Monthly",
                 "open_tasks": 4, "backlog_items": 3 } ],
  "requires_cascade": true,      // true iff the goal has descendants
  "server_now": "…"
}
```

`[NEW BACKEND WORK]` — what is missing: `GoalService.remove` computes exactly these counts but only
raises them inside the `GOAL_HAS_CHILDREN` error, and **only when `descendants.size > 0`**
(`apps/api/src/application/services/goal.service.ts:247`). A **leaf** goal carrying open tasks and
backlog items therefore deletes with no guard and no counts at all. No existing read can supply the
number either: `GET /tasks?goalId=` filters on the exact leaf and only returns tasks *visible in one
week*, so done-in-a-past-week and exited tasks are invisible to it. Needed: a dry-run — either
`DELETE /goals/:id?dryRun=true` returning the `DeleteGoalResponse` shape with `deleted: false`, or a
`GET /goals/:id/deletion-preview`. It must count for leaf goals too, otherwise the most dangerous
delete in the product is the one with no preview. Until it ships, `delete_goal` must be disabled for any
goal whose `get_goal` shows children or backlog (§7, rail 1).

Rules: Q-5, R-goal-28, S-idea-7-1, D-27.

---

### 2.2 Goals (mutating)

#### `create_goal` `[MUTATING]`

> Create a goal. Horizons nest Life › Yearly › Quarterly › Monthly and a child's horizon must be strictly
> shorter than its parent's. Life goals have no parent and no period; every other horizon needs one.
> Monthly goals can never have sub-goals.

Backed by `POST /goals` (`CreateGoalRequest`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `title` | string | **yes** | trimmed, 1–200 | The goal, one line. Whitespace-only is refused (R-goal-29). |
| `horizon` | string | **yes** | `Life`\|`Yearly`\|`Quarterly`\|`Monthly` | Fixed at creation; never editable afterwards. |
| `parent_id` | string \| null | **yes** | ULID or `null` | `null` **only** for `Life`. Must be a goal of strictly longer horizon and must not be `Monthly` (R-goal-4/5/6). |
| `why` | string | no | trimmed, ≤ 200, default `""` | One-line motivation. |
| `period` | string | no | trimmed, ≤ 32 | Target period label (`2026`, `Q4 2026`, `Sep 2026`). Omit to let the server derive it from the horizon and today (R-goal-13). Must be `""`/omitted for Life. |
| `pulse` | string | no | `On track`\|`At risk`\|`Rethink`, default `On track` | Self-reported health. |

Output: `{ goal: GoalView, server_now }`.
Rules: R-goal-1/3/4/5/6/7/13/29; refuses with `HORIZON_CONFLICT`, `GOAL_HAS_OPEN_TASKS` (creating under a
leaf that still holds open tasks — R-goal-28/D-8), `VALIDATION_FAILED`.

---

#### `update_goal` `[MUTATING]`

> Edit a goal's card: title, motivation, target period and pulse. Horizon and parent are **not** editable
> here — use `move_goal` to re-parent and `replan_goal` to change the period with a reason.

Backed by `PATCH /goals/:id` (`PatchGoalRequest`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `goal_id` | string | **yes** | ULID | Target. |
| `title` | string | no | trimmed, 1–200 | New title. |
| `why` | string | no | trimmed, ≤ 200 | New one-liner. |
| `period` | string | no | trimmed, ≤ 32 | New period. Refused on a Life goal. |
| `pulse` | string | no | enum | New pulse. |

At least one of the four must be present. Output: `{ goal: GoalView, server_now }`.
Rules: R-goal-14/15/29, S-goal-14-2 (`horizon` / `parent_id` are not accepted keys, by design).

---

#### `move_goal` `[MUTATING]`

> Re-parent a goal. Its children move with it and its own horizon does not change. The new parent must
> have a **longer** horizon and must not be the goal itself or any of its descendants. Life goals cannot
> be moved. Read the returned `new_path` back to the user.

Backed by `POST /goals/:id/move` (`MoveGoalRequest`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `goal_id` | string | **yes** | ULID | The goal to move. Must not be a Life goal. |
| `new_parent_id` | string | **yes** | ULID | Strictly longer horizon; not the goal or a descendant. |

Output: `{ goal: GoalView, new_path: "Health › Get strong in 2026 › Q3 2026", moved_descendants: 2, server_now }`.
Rules: R-goal-16/17/18/19/20/21/28; refuses with `WOULD_CREATE_CYCLE` (checked first, R-goal-19),
`HORIZON_CONFLICT`, `LIFE_GOAL_IMMUTABLE`, `GOAL_HAS_OPEN_TASKS`.

---

#### `replan_goal` `[MUTATING]`

> Move a goal to a later target period — the product's only "push". Pass one of the `replan_options`
> from `get_goal`; the reason is optional and the product deliberately never demands one. Life goals
> cannot be re-planned.

Backed by `POST /goals/:id/replan` (`ReplanGoalRequest`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `goal_id` | string | **yes** | ULID | Non-Life goal. |
| `period` | string | **yes** | trimmed, ≤ 32; should be one of `get_goal.replan_options` | The new target period. Must differ from the current one. |
| `reason` | string | no | trimmed, ≤ 280 | One line, optional. Never invent one — pass only what the user actually said. |

Output: `{ goal: GoalView, previous_period: "Q3 2026", server_now }`.
Rules: R-goal-22/23, D-3; refuses with `LIFE_GOAL_IMMUTABLE`, `VALIDATION_FAILED` (same period).

---

#### `delete_goal` `[MUTATING]` **destructive**

> Permanently delete a goal **and its entire subtree**: every sub-goal, weekly focus, task (with its
> activity timeline) and backlog item below it. Ideas and learnings tagged to anything deleted fall back
> to "Unsorted". There is no undo and no trash. You must call `preview_goal_deletion` first and repeat
> its counts to the user; only set `confirm_cascade` after the user has agreed to those specific numbers.

Backed by `DELETE /goals/:id?cascade=` (`DeleteGoalResponse`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `goal_id` | string | **yes** | ULID | The goal. |
| `confirm_cascade` | boolean | **yes** | must be `true` when the goal has descendants | Explicit acknowledgement of the subtree delete. Maps to `?cascade=true`. |
| `acknowledged_counts` | object | **yes** | `{ goals, tasks, backlog_items }` from `preview_goal_deletion` | Server compares against live counts and refuses with `VALIDATION_FAILED` if the tree changed since the preview. |

Output: `{ deleted: true, removed: { goals, weekly_focuses, tasks, task_events, backlog_items }, untagged: { ideas, learnings }, server_now }`.
Rules: Q-5, S-idea-7-1, D-27; refuses with `GOAL_HAS_CHILDREN` (details carry `subGoals`/`tasks`/`backlogItems`).

`acknowledged_counts` is enforced in the MCP layer (re-run the preview, compare, refuse on mismatch) —
no backend change needed beyond `preview_goal_deletion`.

---

### 2.3 Weekly plan and focus

The plan is the product's subtlest object. `PUT /plan` is a **whole-week atomic replace**: every non-Life
leaf named with a non-empty sentence gets a focus, and **every leaf not named loses its focus** (R-plan-7).
An agent that builds `entries` from a partial mental model silently deactivates branches. Hence the three
tools below: one faithful primitive and two safe intent-shaped wrappers that read-modify-write around it.

#### `get_weekly_plan` `[READ-ONLY]`

> The focus sentences for one week — which branches are active and what each one says. Past weeks render
> their own sentences; only the current week is editable.

Backed by `GET /plan?week=` (`PlanResponse`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `week_offset` | integer | no | `-520 … 0`, default `0` | Which week. |

Output: `{ week: { week_start, offset, is_current }, entries: [{ id, goal_id, goal_path, week_start, sentence, created_at, updated_at }], dormant_leaves: [{ id, path }], editable: true, server_now }`.

`week_start` in this response is what `save_weekly_plan` requires. Rules: R-plan-1/2, D-2.

---

#### `set_goal_focus` `[MUTATING]` — preferred

> Activate one branch for **this week** by giving it a focus sentence, or replace the sentence it
> already has. Leaves every other branch's focus untouched. This is the safe way to activate a single
> branch; use `save_weekly_plan` only when replanning the whole week at once.

Implemented in the MCP layer as `GET /plan` → merge one entry → `PUT /plan` with the returned
`week_start`. No new backend work.

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `goal_id` | string | **yes** | ULID; must be a **non-Life leaf** | The branch to activate. |
| `sentence` | string | **yes** | trimmed, 1–280 | One sentence. A blank sentence does not activate anything — the check does not stick (R-plan-5). |

Output: `{ week, entries: PlanEntryView[], activated: true, server_now }`.
Rules: R-plan-1/2/4/5/7/8, R-goal-9; refuses with `NOT_A_LEAF`, `WEEK_NOT_CURRENT`.

---

#### `clear_goal_focus` `[MUTATING]`

> Make one branch dormant for **this week** by removing its focus sentence. Its open tasks are **not**
> deleted — they stay visible and keep carrying. Every other branch is untouched.

Same read-modify-write implementation.

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `goal_id` | string | **yes** | ULID; non-Life leaf | The branch to make dormant. |

Output: `{ week, entries: PlanEntryView[], cleared: true, open_tasks_kept: 3, server_now }`.
Rules: R-plan-6, R-task-9, S-plan-6-1, D-11.

---

#### `save_weekly_plan` `[MUTATING]` — whole-week replace

> Replace the **entire** current week's plan in one atomic write. Every leaf you list with a sentence
> becomes active; **every non-Life leaf you leave out becomes dormant**. Only use this when you are
> deliberately planning the whole week and you have just read `get_weekly_plan` — for a single branch use
> `set_goal_focus` or `clear_goal_focus` instead. Only the current week can be planned.

Backed by `PUT /plan` (`SavePlanRequest`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `week_start` | string | **yes** | `YYYY-MM-DD`, must be a Monday **and the current week** | Take this verbatim from the `week.week_start` of a `get_weekly_plan` / `get_overview` call made in this same session. Sending it explicitly is what makes a save that crossed a Monday boundary fail loudly rather than write into the wrong week. |
| `entries` | array | **yes** | ≤ 500 items | `[{ goal_id: ULID, sentence: string (trimmed, ≤ 280) }]`. Each `goal_id` must be a non-Life leaf; duplicates are refused. An entry with a blank sentence is a *clear*. |
| `confirm_deactivations` | integer | **yes** | must equal the number of currently-active leaves absent from `entries` | Forces the agent to have counted what it is turning off. Mismatch → refused in the MCP layer with the list of leaves that would go dormant. |

Output: `{ week, entries: PlanEntryView[], activated: [{id, path}], deactivated: [{id, path}], server_now }`.
Rules: R-plan-2/3/5/7/8/12, Q-3; refuses with `WEEK_NOT_CURRENT` (wholesale, never partial), `NOT_A_LEAF`.

`confirm_deactivations` is an MCP-layer guard (compare `entries` against `GET /plan` before the `PUT`);
no backend change needed.

---

### 2.4 Tasks

#### `list_tasks` `[READ-ONLY]`

> The tasks visible in one week, with that week's focus sentences. Open tasks appear in every week from
> the one they were created in onwards — they carry automatically. Done tasks appear only in the week
> they were completed. Cancelled and moved-to-backlog tasks appear in no week at all.

Backed by `GET /tasks?week=&goalId=` (`TasksResponse`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `week_offset` | integer | no | `-520 … 0`, default `0` | Which week to view. Carry ages are computed against **this** week, not against today. |
| `goal_id` | string | no | ULID | Filter to one leaf. **Exact leaf only — this does not include a subtree.** To see a whole branch, filter the result by `goal_id` against `list_goals(under_goal_id=…)`. |
| `state` | string | no | `all` (default) \| `open` \| `done` \| `carrying` | `carrying` = open with `carry_weeks ≥ 1`. |

Output:

```jsonc
{
  "week": { "week_start": "2026-08-31", "offset": 0, "is_current": true },
  "tasks": [
    { "id": "01J…", "goal_id": "01J…", "goal_path": "Health › … › Sep 2026",
      "title": "Book the physio", "cond": "Appointment in the calendar",
      "description": "", "links": [{ "id": "01J…", "url": "https://…" }],
      "status": "open", "done": false,
      "origin_week_start": "2026-08-17", "done_week_start": null, "done_at": null,
      "exit_reason": null, "exited_at": null,
      "carry_weeks": 2, "carry_label": "2 weeks · since 17 Aug",
      "created_at": "…", "updated_at": "…" }
  ],
  "plan": [ /* PlanEntryView for this week */ ],
  "server_now": "…"
}
```

Rules: R-task-7/8/9/10/11/12/32, R-nav-7/8, D-11.

---

#### `get_task` `[READ-ONLY]`

> One task with its full activity timeline — creation source, every week it carried into, renames,
> done-condition edits, links added and removed, completions, unchecks and exits, newest first. The
> timeline is written by the server and is read-only.

Backed by `GET /tasks/:id?week=` (`TaskDetailResponse`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `task_id` | string | **yes** | ULID | Target. |
| `week_offset` | integer | no | `-520 … 0`, default `0` | Week the carry age is computed for. |

Output: task fields as above plus `events: [{ id, kind, at, text, glyph, detail }]`
(`kind` ∈ `created`, `carried`, `renamed`, `cond_edited`, `description_updated`, `link_added`,
`link_removed`, `completed`, `unchecked`, `moved_to_backlog`, `canceled`).
Rules: R-task-22/27/29/30/31; there is **no** tool to write, edit or delete a task event (S-task-30-1).

---

#### `create_task` `[MUTATING]`

> Add a task under an **active** branch. A task always lands in the current week — there is no
> back-dating and no way to create into a past or future week. The done-condition is optional. If the
> branch has no focus this week, activate it first with `set_goal_focus`; never fall back to a different
> goal.

Backed by `POST /tasks` (`CreateTaskRequest`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `goal_id` | string | **yes** | ULID; must be a **non-Life leaf with a focus this week** | The branch. Get it from `find_goal(only="active_leaves")`. |
| `title` | string | **yes** | trimmed, 1–200 | What to do. |
| `cond` | string | no | trimmed, ≤ 200, default `""` | Done-condition — how you'll know it's done. Optional by design; do not fabricate one. |
| `description` | string | no | trimmed, ≤ 4000, default `""` | Notes. |
| `links` | string[] | no | ≤ 20 items, each an `http(s)` URL ≤ 2048 chars | External links. |
| `source` | string | no | `planning` (default) \| `drawer` | Recorded once on the `Created — …` event. `backlog` and `idea` are set by the conversion tools and must not be passed here. |

Output: `{ task: TaskDetailView, server_now }`.
Rules: R-task-1/2/3/4/5/6, D-10; refuses with `NOT_A_LEAF`, `BRANCH_NOT_ACTIVE`, `VALIDATION_FAILED`.

---

#### `update_task` `[MUTATING]`

> Edit a task's title, done-condition or description. Done tasks stay editable. Each changed field is
> logged on the activity timeline automatically.

Backed by `PATCH /tasks/:id` (`PatchTaskRequest`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `task_id` | string | **yes** | ULID | Target. |
| `title` | string | no | trimmed, 1–200 | New title (logs `Renamed`). |
| `cond` | string | no | trimmed, ≤ 200 | New done-condition (logs `Done-condition edited`). |
| `description` | string | no | trimmed, ≤ 4000 | New description (logs `Description updated`). |

At least one of the three. A no-op edit writes nothing and logs nothing.
Output: `{ task: TaskDetailView, events_logged: ["renamed"], server_now }`.
Rules: R-task-23/26/27/30.

---

#### `complete_task` `[MUTATING]` — exit 1 of 3

> Tick a task off. You may complete into any week from the task's origin week onward, including past
> weeks — past weeks stay fully editable. The task then appears only in the week it was completed in.

Backed by `POST /tasks/:id/complete` (`CompleteTaskRequest`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `task_id` | string | **yes** | ULID | Target. |
| `week_offset` | integer | no | `-520 … 0`, default `0` | The week to record the completion in. Must not be earlier than the task's `origin_week_start`, and never a future week. |

Output: `{ task: TaskDetailView, server_now }`.
Rules: R-task-13/14, S-task-14-1/14-2; refuses with `WEEK_OUT_OF_RANGE`.

---

#### `uncheck_task` `[MUTATING]`

> Re-open a completed task. It keeps its original creation week, so it immediately carries into the
> current week with the age it actually earned. Optionally update the done-condition at the same time —
> leaving it out is a no-op, which is the normal case.

Backed by `POST /tasks/:id/uncheck` (`UncheckTaskRequest`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `task_id` | string | **yes** | ULID; task must be `done` | Target. |
| `cond` | string | no | trimmed, ≤ 200 | New done-condition. Omitted, blank or unchanged writes nothing and logs nothing. |

Output: `{ task: TaskDetailView, server_now }`.
Rules: R-task-19/20/21, S-task-19-1/21-1/21-3; refuses with `VALIDATION_FAILED` when the task is not done.

---

#### `move_task_to_backlog` `[MUTATING]` — exit 2 of 3

> Take a task out of the week and park it in its own goal's backlog, keeping the description and links
> and noting which week it came from. The reason is optional — the product is deliberately guilt-free;
> pass only what the user actually said. Only open tasks can be moved.

Backed by `POST /tasks/:id/move-to-backlog` (`MoveTaskToBacklogRequest`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `task_id` | string | **yes** | ULID; task must be `open` | Target. |
| `week_offset` | integer | no | `-520 … 0`, default `0` | The week the task was live in; becomes the item's `from_week_start`. |
| `reason` | string | no | trimmed, ≤ 280 | Optional one-liner, retained on the task record. |

Output: `{ task: TaskDetailView, item: BacklogItemView, server_now }`.
Rules: R-task-13/15/17/18, D-12, D-15; refuses with `TASK_ALREADY_EXITED`.

---

#### `cancel_task` `[MUTATING]` — exit 3 of 3

> Drop a task. It leaves every week but its record and timeline survive. The reason is optional. Only
> open tasks can be cancelled.

Backed by `POST /tasks/:id/cancel` (`CancelTaskRequest`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `task_id` | string | **yes** | ULID; task must be `open` | Target. |
| `reason` | string | no | trimmed, ≤ 280 | Optional one-liner, retained on the record. |

Output: `{ task: TaskDetailView, server_now }`.
Rules: R-task-13/16/17/18, D-15; refuses with `TASK_ALREADY_EXITED`.

There is **no** fourth exit. Requests to defer, snooze, reschedule or move a task to a different week
have no tool and must be refused, not approximated (R-task-13, S-task-13-1, R-nav-14).

---

#### `add_task_link` `[MUTATING]`

> Attach an external link to a task. Logs `Link added: <host>`.

Backed by `POST /tasks/:id/links` (`AddTaskLinkRequest`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `task_id` | string | **yes** | ULID | Target. |
| `url` | string | **yes** | `http`/`https` only, ≤ 2048 chars; max 20 links per task | The link. Other schemes are refused, not stored. |

Output: `{ task: TaskDetailView, server_now }`. Rules: R-task-24, Q-11, Q-12.

---

#### `remove_task_link` `[MUTATING]`

> Remove a link from a task by its link id. Logs `Link removed: <host>`.

Backed by `DELETE /tasks/:id/links/:linkId`.

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `task_id` | string | **yes** | ULID | Target. |
| `link_id` | string | **yes** | ULID from `get_task().links[].id` | The link. |

Output: `{ task: TaskDetailView, server_now }`. Rules: R-task-25, D-13.

---

### 2.5 Backlog

#### `list_backlog` `[READ-ONLY]`

> Deferred future work, grouped by branch, newest first. Backlog items have no checkbox, no
> done-condition, no due date and no status — that poverty is deliberate. Converted items are never
> listed.

Backed by `GET /backlog?goalId=` (`BacklogResponse`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `goal_id` | string | no | ULID | Narrow to one goal's own items. |
| `under_goal_id` | string | no | ULID | Narrow to a whole subtree (MCP-layer filter against `list_goals`). Use this for "everything under my health line". |
| `convertible_only` | boolean | no | default `false` | Only items with at least one active leaf at or under their goal — i.e. items that could become a task right now. |

Output: `{ items: [{ …BacklogItemView, goal_path, convertible: true, active_leaf_candidates: [{id,title}] }], server_now }`.
Rules: R-backlog-1/2/3/5/13, R-backlog-7/8, Q-7.

---

#### `create_backlog_item` `[MUTATING]`

> Park work under a Yearly, Quarterly or Monthly goal. Never a Life goal and never a week.

Backed by `POST /backlog` (`CreateBacklogItemRequest`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `goal_id` | string | **yes** | ULID; **non-Life** goal | Where it lives. |
| `title` | string | **yes** | trimmed, 1–200 | The deferred work, one line. |
| `description` | string | no | trimmed, ≤ 4000, default `""` | Notes. |
| `links` | string[] | no | ≤ 20 `http(s)` URLs | External links. |

Output: `{ item: BacklogItemView, server_now }`.
Rules: R-backlog-2/4/16; refuses with `LIFE_GOAL_NO_BACKLOG`.

---

#### `update_backlog_item` `[MUTATING]`

> Edit a parked item's title, description or links.

Backed by `PATCH /backlog/:id` (`PatchBacklogItemRequest`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `item_id` | string | **yes** | ULID; item must be `open` | Target. |
| `title` | string | no | trimmed, 1–200 | New title. |
| `description` | string | no | trimmed, ≤ 4000 | New description. |
| `links` | string[] | no | ≤ 20 `http(s)` URLs | Replaces the whole list. |

Output: `{ item: BacklogItemView, server_now }`. Rules: R-backlog-3; refuses with `ALREADY_CONVERTED`.

---

#### `move_backlog_item` `[MUTATING]`

> Re-home a parked item under a different non-Life goal. Its captured date and its "from week of …" note
> do not change.

Backed by `POST /backlog/:id/move` (`MoveBacklogItemRequest`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `item_id` | string | **yes** | ULID | Target. |
| `goal_id` | string | **yes** | ULID; **non-Life** goal | New owner. |

Output: `{ item: BacklogItemView, new_goal_path, server_now }`.
Rules: R-backlog-10, S-backlog-10-1; refuses with `LIFE_GOAL_NO_BACKLOG`.

---

#### `delete_backlog_item` `[MUTATING]` **destructive**

> Permanently delete a parked item. There is no archive and no undo. Confirm with the user first —
> `move_backlog_item` is usually what they actually want.

Backed by `DELETE /backlog/:id`.

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `item_id` | string | **yes** | ULID | Target. |
| `confirmed` | boolean | **yes** | must be `true` | Explicit acknowledgement; the tool refuses without it. |

Output: `{ deleted: true, server_now }`. Rules: R-backlog-10.

---

#### `convert_backlog_item_to_task` `[MUTATING]`

> The **only** way backlog becomes work. The item is consumed and becomes a task in one atomic
> operation — never duplicated, never left behind. The task lands under an **active leaf at or under the
> item's goal**. If exactly one such leaf exists it is used; if several do you must name one; if none
> does, the branch isn't active this week and you must activate it with `set_goal_focus` first.

Backed by `POST /backlog/:id/convert-to-task` (`ConvertBacklogItemRequest`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `item_id` | string | **yes** | ULID; item must be `open` | The item to convert. |
| `goal_id` | string | no | ULID; must be an **active leaf at or under the item's goal** | Required when more than one candidate exists — the server refuses to pick, because this id decides which focus the task belongs to for the rest of its life. |
| `title` | string | no | trimmed, 1–200 | Override the item's title on the created task. |
| `cond` | string | no | trimmed, ≤ 200, default `""` | Done-condition for the new task. |

Output: `{ task: TaskDetailView, item: BacklogItemView /* status: "converted" */, server_now }`.
Rules: R-backlog-6/7/8/9, Q-4, D-18, D-19; refuses with `BRANCH_NOT_ACTIVE`,
`AMBIGUOUS_CONVERSION_TARGET` (details carry `candidates: [{id,title}]`), `ALREADY_CONVERTED`.

---

### 2.6 Ideas (parking lot)

#### `list_ideas` `[READ-ONLY]`

> Parked thoughts, grouped by Life goal then "Unsorted", newest first.

Backed by `GET /ideas`. Input: none. Output: `{ ideas: [{ …IdeaView, goal_title }], grouped: {...}, server_now }`.
Rules: R-idea-7, S-idea-7-1.

---

#### `capture_idea` `[MUTATING]`

> Park a distracting thought in two seconds. Text only. The optional tag is a **Life goal** or nothing.

Backed by `POST /ideas` (`CreateIdeaRequest`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `text` | string | **yes** | trimmed, 1–500 | The thought. |
| `goal_id` | string \| null | no | ULID of a **Life** goal, or `null` (default) | Tag. A non-Life goal is refused. |

Output: `{ idea: IdeaView, server_now }`. Rules: R-idea-1/2; refuses with `NOT_A_LIFE_GOAL`.

---

#### `attach_idea_to_goal` `[MUTATING]`

> Send an idea to a goal's backlog. The idea's text becomes a backlog item on the chosen **non-Life**
> goal and the idea is removed, in one operation.

Backed by `POST /ideas/:id/attach` (`AttachIdeaRequest`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `idea_id` | string | **yes** | ULID | Target. |
| `goal_id` | string | **yes** | ULID; **non-Life** goal | Receiving goal. |

Output: `{ item: BacklogItemView, idea_id, server_now }`.
Rules: R-idea-5, R-backlog-2/4; refuses with `LIFE_GOAL_NO_BACKLOG`.

Note the asymmetry, and it is intentional: an idea's *tag* must be a **Life** goal (R-idea-2), while an
idea's *attach target* must be a **non-Life** goal (R-idea-5). Different fields, different rules.

---

#### `convert_idea_to_task` `[MUTATING]`

> "Task this week": the idea becomes a task under an active leaf and is consumed — but only if the task
> is actually created. If no branch is active, activate one first; never route the task to a fallback
> goal.

Backed by `POST /ideas/:id/convert-to-task` (`ConvertIdeaRequest`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `idea_id` | string | **yes** | ULID | Target. |
| `goal_id` | string | **yes** | ULID; **active non-Life leaf** | Where the task lands. |
| `title` | string | no | trimmed, 1–200 | Override; defaults to the idea's text (truncated to 200, remainder into the description). |
| `cond` | string | no | trimmed, ≤ 200, default `""` | Done-condition. |

Output: `{ task: TaskDetailView, idea_id, server_now }`.
Rules: R-idea-4, R-task-4, D-22; refuses with `NOT_A_LEAF`, `BRANCH_NOT_ACTIVE`.

---

#### `delete_idea` `[MUTATING]`

> Discard a parked idea. No confirmation is required by the product, but say what you are deleting first.

Backed by `DELETE /ideas/:id`.

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `idea_id` | string | **yes** | ULID | Target. |

Output: `{ deleted: true, server_now }`. Rules: R-idea-6.

---

### 2.7 Learnings

#### `list_learnings` `[READ-ONLY]`

> Insights that might change the plan, grouped by Life goal then "Unsorted", newest first. Not a journal
> and never converted into work.

Backed by `GET /learnings`. Input: none. Output: `{ learnings: [{ …LearningView, goal_title }], server_now }`.
Rules: R-learning-1/2.

---

#### `capture_learning` `[MUTATING]`

Backed by `POST /learnings` (`CreateLearningRequest`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `text` | string | **yes** | trimmed, 1–500 | The insight. |
| `goal_id` | string \| null | no | ULID of a **Life** goal, or `null` (default) | Tag. |
| `applied` | boolean | no | default `false` | "changed the plan" badge. |

Output: `{ learning: LearningView, server_now }`. Rules: R-learning-1/2; refuses with `NOT_A_LIFE_GOAL`.

---

#### `update_learning` `[MUTATING]`

> Edit a learning's text, or mark it as having changed the plan (the "changed the plan" badge).

Backed by `PATCH /learnings/:id` (`PatchLearningRequest`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `learning_id` | string | **yes** | ULID | Target. |
| `text` | string | no | trimmed, 1–500 | New text. |
| `applied` | boolean | no | — | Set/clear the badge. Only set `true` when the user says a decision actually changed. |

Output: `{ learning: LearningView, server_now }`. Rules: R-learning-4, D-23.

---

#### `attach_learning_to_goal` `[MUTATING]`

> Re-tag a learning to a **Life** goal, or pass `null` to move it back to "Unsorted". A learning is never
> converted into work — there is no tool that turns one into a task or a backlog item.

Backed by `POST /learnings/:id/attach` (`AttachLearningRequest`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `learning_id` | string | **yes** | ULID | Target. |
| `goal_id` | string \| null | **yes** | ULID of a **Life** goal, or `null` | New tag. |

Output: `{ learning: LearningView, server_now }`.
Rules: R-learning-2/3, S-learning-3-1; refuses with `NOT_A_LIFE_GOAL`.

---

#### `discard_learning` `[MUTATING]`

Backed by `DELETE /learnings/:id`.

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `learning_id` | string | **yes** | ULID | Target. |

Output: `{ deleted: true, server_now }`. Rules: R-learning-6.

---

### 2.8 Account and preferences

#### `get_account` `[READ-ONLY]`

> Who the account belongs to, the timezone every week boundary is computed from, and the theme
> preference.

Backed by `GET /me` + `GET /me/preferences` (`MeResponse`, `PreferencesResponse`).
Input: none. Output: `{ user: { id, name, email, email_verified }, preferences: { theme, timezone, updated_at }, week: { week_start, offset: 0, is_current: true }, week_history_weeks: 8, server_now }`.
Rules: R-auth-1/4/5, Q-9.

---

#### `update_preferences` `[MUTATING]`

> Change the theme or the account timezone. **The timezone decides when every week starts** — changing it
> shifts which Monday "this week" means, so confirm with the user before touching it.

Backed by `PATCH /me/preferences` (`PatchPreferencesRequest`).

| Field | Type | Req. | Constraint | Meaning |
|---|---|---|---|---|
| `theme` | string | no | `light`\|`dark`\|`system` | Persisted per user. |
| `timezone` | string | no | valid IANA zone, ≤ 64 chars | Authoritative for every week boundary. |

At least one required. Output: `{ preferences: PreferencesView, week, server_now }`.
Rules: R-nav-12, R-auth-5, D-25, Q-9.

**Not exposed:** `POST /me/change-password`. See §7, rail 2.

---

## 3. Resources

Resources carry stable, re-readable context. An agent pulls them once and stops asking. All are
owner-scoped and require the same session as the tools.

| URI | MIME type | Contents | Refresh |
|---|---|---|---|
| `goalcascade://tree` | `application/json` | The full goal tree for the current week: `GoalView[]` with derived flags, plus `week`. Same payload as `list_goals(format="flat")`. | Per read; cheap. |
| `goalcascade://tree/outline` | `text/markdown` | The tree as an indented outline — `Health › Get strong in 2026 › Q3 2026 › Sep 2026 [Monthly · Q3 2026 · On track · ACTIVE: "Three gym sessions…"]` — one line per goal with its ULID in brackets. This is the resource an agent should read to *reason*; the JSON one is for exact field access. | Per read. |
| `goalcascade://week/current` | `application/json` | This week's `week`, `plan` entries with goal paths, `tasks` with carry labels, and the list of dormant leaves. | Per read; changes on every plan/task write. |
| `goalcascade://week/{week_start}` | `application/json` | The same for a past week, addressed by its Monday (`YYYY-MM-DD`). Future weeks are never resolvable. | Immutable once past, apart from edits. |
| `goalcascade://backlog` | `application/json` | Every open backlog item with `goal_path` and `convertible`. | Per read. |
| `goalcascade://ideas` | `application/json` | Open ideas, grouped. | Per read. |
| `goalcascade://learnings` | `application/json` | Learnings, grouped, with the `applied` badge. | Per read. |
| `goalcascade://account` | `application/json` | User, preferences, timezone, current week, `week_history_weeks`. | Rarely. |
| `goalcascade://rules/business-rules` | `text/markdown` | `docs/BUSINESS-RULES.md` **verbatim**. The product's own prose is the best available explanation of the horizon hierarchy, the three exits and the week model; shipping it beats paraphrasing it. Static. | Static, embedded at deploy. |
| `goalcascade://rules/errors` | `application/json` | The `ERROR_STATUS` map plus, per code, `meaning`, `recovery` and the `details` keys it carries — the machine-readable form of §6. | Static. |
| `goalcascade://rules/week-model` | `text/markdown` | ~300 words on Monday weeks, offsets vs. absolute `week_start`, auto-carry, and which tools take which. The single thing most likely to be got wrong. | Static. |

Deliberately **not** resources: anything paginated or unbounded (task activity timelines, historical
tasks across all weeks). Those stay behind tools so the agent pays for what it asks for.

---

## 4. Prompts

### `plan_the_week`

Arguments: `notes` (string, optional — anything the user already said about the week ahead).

```
Plan this week in Goal Cascade.

1. Read goalcascade://week/current and goalcascade://tree/outline.
2. Tell me, in a short list: which branches are active right now and what each focus sentence says;
   which branches are dormant; and which open tasks are carrying, with their ages.
3. Ask me which branches should be active this week. Suggest a shortlist based on: branches that
   already carry open tasks, branches whose goal pulse is "At risk" or "Rethink", and branches with
   backlog items ready to pull. Do not decide for me.
4. For each branch I confirm, draft one focus sentence — one sentence, concrete, in my voice — and
   read it back before writing anything.
5. Write the plan with set_goal_focus one branch at a time. Use clear_goal_focus for branches I want
   to stand down. Only use save_weekly_plan if I explicitly ask you to replace the whole week, and if
   you do, tell me exactly which branches will go dormant before you call it.
6. Then, for each newly active branch, list its pullable backlog items (list_backlog with
   convertible_only) and ask which to pull. Convert only the ones I name.

Do not create, complete, or cancel any task in this workflow unless I ask.

My notes for this week: {{notes}}
```

---

### `review_the_carry`

Arguments: `weeks` (integer, optional, default `2` — the minimum age to report on).

```
Show me what is carrying and help me decide what to do about it.

1. Call list_tasks(week_offset=0, state="carrying"). Group the results by Life goal, using
   goalcascade://tree/outline for the paths.
2. For every task at least {{weeks}} weeks old, call get_task and read its activity timeline. Tell me:
   when it was created and from where (planning, backlog, an idea, the drawer), how many weeks it has
   carried, whether it has ever been renamed or had its done-condition changed, and whether its branch
   still has a focus this week.
3. For each one, state the honest reading in one line — for example: "carried 4 weeks, no
   done-condition, branch went dormant in week -2".
4. Then offer me exactly the three exits this product has, and nothing else:
     - Complete it (complete_task)
     - Move it to the backlog (move_task_to_backlog) — it keeps its description and links
     - Cancel it (cancel_task)
   Never offer to defer, snooze, reschedule, or move a task to a different week. Those do not exist.
5. Act only on what I choose. When I give a reason, pass it through verbatim; when I do not, leave the
   reason empty — this product never requires one.

Do not change any focus sentence or any goal in this workflow.
```

---

### `triage_the_backlog`

Arguments: `goal` (string, optional — a goal name or branch to limit the triage to).

```
Help me triage the Goal Cascade backlog{{#goal}} under "{{goal}}"{{/goal}}.

1. If a goal was named, resolve it with find_goal first and confirm which one I mean before going on.
2. Call list_backlog (scoped with under_goal_id if a goal was named). Group items by branch path,
   newest first, and mark each one as convertible or not.
3. Summarise: how many items, how they split across branches, how many could become work this week,
   and which branches are blocking the rest because they have no focus this week.
4. Walk me through the convertible items a few at a time. For each, propose one of:
     - pull it into this week (convert_backlog_item_to_task) — say which active leaf will receive it,
       and if there is more than one candidate, ask me which
     - move it to a better-fitting goal (move_backlog_item)
     - delete it (delete_backlog_item) — say clearly that this is permanent and has no undo
     - leave it
5. For non-convertible items, tell me which branch would need a focus first. Offer to set one with
   set_goal_focus, but do not set one without my say-so.

Converting consumes the item — it becomes a task and leaves the backlog. Say so before the first
conversion.
```

---

### `process_ideas`

Arguments: none.

```
Clear the Goal Cascade parking lot with me.

1. Call list_ideas and read goalcascade://tree/outline.
2. Read the ideas back grouped by Life goal, with Unsorted last. Keep it short — these are two-second
   captures, not documents.
3. Go through them one at a time and offer exactly the three things an idea can become:
     - a task this week (convert_idea_to_task) — name the active leaf it would land under; if no
       branch is active, say so and offer to set a focus first rather than picking some other goal
     - a backlog item on a goal (attach_idea_to_goal) — the target must be a Yearly, Quarterly or
       Monthly goal, never a Life goal
     - deleted (delete_idea)
   An idea can also stay parked. That is a real answer; offer it.
4. If an idea reads more like an insight than a piece of work — something that would change the plan
   rather than something to do — say so and offer capture_learning instead, then delete the idea.

Do not batch-convert. One decision at a time, mine.
```

---

### `goal_health_check`

Arguments: `life_goal` (string, optional — limit to one Life line).

```
Give me an honest health check of my goal tree{{#life_goal}} for "{{life_goal}}"{{/life_goal}}.

1. Read goalcascade://tree/outline and goalcascade://week/current. If a Life goal was named, resolve
   it with find_goal and scope everything below to that line.
2. For each Life goal report: how many of its branches are active this week, how many tasks are
   carrying and the oldest age, how many backlog items sit under it, and the pulse of each child.
3. Flag, without softening: branches that have been dormant while still carrying open tasks; goals
   whose target period has already passed; goals marked "At risk" or "Rethink" with no active leaf
   beneath them; and Monthly goals with an empty backlog and no tasks.
4. For each flag, offer the specific move: replan_goal (say which period, using the replan_options
   from get_goal — do not invent a period), update_goal to change the pulse, set_goal_focus to wake a
   branch, or move_goal if the goal is hanging off the wrong parent.
5. Read out any learnings attached to this line (list_learnings) and ask whether any of them should
   change the plan. If one already did, offer update_learning with applied=true.

Never propose deleting a goal in this workflow. If deletion genuinely looks right, say so in words and
stop — I will ask for it explicitly.
```

---

## 5. Server instructions block

This is the `instructions` string the MCP server advertises on connect.

```
Goal Cascade is one person's goal tree and their week. You are acting on the owner's own account:
one owner, one tree, no sharing, no other users.

THE HIERARCHY. Goals nest in exactly four horizons: Life › Yearly › Quarterly › Monthly. A child's
horizon must be strictly shorter than its parent's, so Life goals sit at the root with no parent and
no target period, and Monthly goals can never have sub-goals. Goals never hold tasks directly.

LEAF, ACTIVE, DORMANT. A goal with no children is a LEAF. A non-Life leaf becomes ACTIVE by being
given one focus sentence for the current week; that sentence is the only thing that activates it.
Only an active leaf can hold tasks. A leaf with no focus this week is DORMANT — visible but quiet,
and that is a normal, intentional state, not a fault. A branch is dormant when no leaf below it is
active. When a branch has no focus and you need to put work there, activate it with set_goal_focus and
ask first; never route work to some other goal because the right one is dormant.

THE WEEK. Weeks start Monday, in the owner's own timezone, computed by the server — never from your
clock. Tools address a week by OFFSET: 0 is this week, -1 last week, and positive values do not exist
because future weeks are not addressable anywhere in this product. The one exception is
save_weekly_plan, which takes the absolute Monday date (YYYY-MM-DD) that a read just returned, so a
call that crossed a Monday boundary fails loudly instead of writing into the wrong week. Only the
current week can be planned; past weeks stay fully editable for tasks.

CARRYING. An open task is visible in every week from the one it was created in onward. It carries
forward by itself — there is no rollover step, no prompt, and nothing to confirm. A task that has
carried a week shows "since Mon 24 Aug"; two weeks or more shows a red "N weeks" chip. That chip is
the only escalation in the product. A completed task is visible only in the week it was completed.

THE THREE EXITS. A task leaves a week in exactly three ways: COMPLETE, MOVE TO BACKLOG (it becomes a
parked item on its own goal, keeping description and links), or CANCEL. There is no fourth exit. Do
not offer or simulate defer, snooze, reschedule, or move-to-another-week. Unchecking a completed task
re-opens it under its ORIGINAL creation week, so it comes back with the age it really has.

BACKLOG, IDEAS, LEARNINGS. Backlog items are deferred work on a Yearly/Quarterly/Monthly goal — never
a Life goal, never a week — with no checkbox, no due date and no status. Converting one is the only
way backlog becomes work, and it consumes the item. Ideas are two-second captures with an optional
LIFE-goal tag; they can become a task, a backlog item, or nothing. Learnings are insights, tagged to a
Life goal, and are never converted into work.

HOW TO WORK. Start with get_overview. Resolve names to ids with find_goal and ask when it reports
ambiguity — acting on the wrong goal is the worst thing you can do here. Reasons on exits and re-plans
are always optional; pass what the user said and nothing more. Deletes cascade and cannot be undone:
preview, quote the numbers, get agreement. Refusals carry a code and a recovery step — read it and do
that, do not retry.
```

---

## 6. Error surface

Every tool failure is returned as an MCP tool error whose content is:

```jsonc
{
  "code": "AMBIGUOUS_CONVERSION_TARGET",
  "message": "more than one active focus can receive this item — choose one",
  "recovery": "Ask the user which branch should receive it, then call convert_backlog_item_to_task again with goal_id set to one of `candidates`.",
  "retryable": false,
  "details": { "itemId": "01J…", "candidates": [{ "id": "01J…", "title": "Sep 2026" }] }
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
| `HORIZON_CONFLICT` | The child's horizon is not strictly shorter than the parent's — equal rank, or a Monthly parent (Monthly is terminal). R-goal-5/6/17. | Do not retry with the same pair. On create: pick a horizon of higher rank than the parent, or a different parent. On move: `details` carries both horizons — pick a target with a longer horizon, or tell the user this parent cannot hold this goal. |
| `WOULD_CREATE_CYCLE` | The move target is the goal itself or one of its descendants. R-goal-18(a,b). This check runs **before** the horizon check, so it is the reason you get when both apply. | Never retry. Re-read the tree (`goalcascade://tree`) and choose a target outside the moved goal's subtree. If the user's phrasing pointed at a descendant, say plainly that a goal cannot move under its own child. |
| `BRANCH_NOT_ACTIVE` | No leaf at or under the target goal has a focus this week, so nothing can receive the task. R-backlog-8, R-task-4. `details` carries `goalId` and `weekStart`. | Present the product's own two options: activate a branch (`set_goal_focus` on a specific non-Life leaf — ask which), or leave it parked. Never pick a different goal that happens to be active; that is the one substitution this product explicitly forbids. |
| `ALREADY_CONVERTED` | This backlog item already became a task — a retry, a stale id, or a second agent. R-backlog-6/9, D-19. No second task was created. | Do not retry and do not re-create the work by hand. Call `list_backlog` or `get_task` to find the task it became (`convertedToTaskId`) and continue with that task. Tell the user it was already pulled in. |
| `AMBIGUOUS_CONVERSION_TARGET` | Two or more active leaves at or under the item's goal qualify. The server refuses to choose because this id fixes which focus the task belongs to for its whole life. `details.candidates` = `[{id,title}]`. | Ask the user which branch, using the candidate titles. Then repeat the call with `goal_id`. Do not pick the first candidate, do not pick by ordering, and do not pick by string similarity. |
| `GOAL_HAS_CHILDREN` | A delete was attempted on a goal with sub-goals without `cascade`. `details` carries `subGoals`, `tasks`, `backlogItems`. | Do **not** simply resend with `confirm_cascade: true`. Report those counts to the user, get an explicit yes, then delete. This refusal is the product's confirmation step, not an argument you forgot. |

The rest, in brief:

| Code | Recovery |
|---|---|
| `NOT_A_LEAF` | The goal is a Life goal or has children. Pick a leaf below it (`find_goal(only="leaves")`). |
| `NOT_A_LIFE_GOAL` | Idea/Learning tags must be a Life goal or `null`. Use the goal's Life root. |
| `LIFE_GOAL_NO_BACKLOG` | Backlog items need a Yearly/Quarterly/Monthly goal. Pick a descendant. |
| `LIFE_GOAL_IMMUTABLE` | Life goals cannot be moved or re-planned. Say so; do not work around it. |
| `GOAL_HAS_OPEN_TASKS` | Making a leaf a parent while it still holds open tasks is refused. Move or close those tasks first, then retry. `details` names them. |
| `TASK_ALREADY_EXITED` | The task is done, cancelled or already in the backlog. Only open tasks can be moved or cancelled. Re-read with `get_task`. |
| `WEEK_NOT_CURRENT` | Planning edits the current week only, and the save was refused wholesale — nothing was written. Re-read `get_weekly_plan` for the fresh `week_start` and try again. |
| `WEEK_OUT_OF_RANGE` | A future week, or a completion week earlier than the task's origin. Use an offset ≤ 0 and ≥ the task's `origin_week_start`. |
| `CONCURRENT_UPDATE` | Someone (the owner's phone) changed the row first. Re-read the entity, re-check the user's intent still applies, then write once. Never loop. |
| `VALIDATION_FAILED` | A field is out of bounds or whitespace-only. `details` names the field; fix and retry once. |
| `NOT_FOUND` | The id does not exist for this owner — deleted, or never existed. Re-resolve with `find_goal` / a list tool. Do not report "permission denied": this product cannot distinguish the two, on purpose. |
| `IDEMPOTENCY_IN_PROGRESS` | An identical write is in flight. Wait briefly and re-read; do not fire a second write. |
| `UNAUTHENTICATED` / `FORBIDDEN` | The session is gone. Stop and tell the user to reconnect. |
| `RATE_LIMITED` / `INTERNAL` | Transient. Back off once, then report rather than hammering. |

`IDEMPOTENCY_KEY_MISSING` and `IDEMPOTENCY_KEY_REUSED` should never reach an agent — the server owns
those keys (§7, rail 6). If one does, it is an MCP-server bug and should surface as `INTERNAL`.

---

## 7. Safety rails

The owner asked for full access to every entity. These are the places to put a speed bump anyway, with
the reason. Each is individually overrulable.

1. **`delete_goal` requires a preview and echoed counts.** A goal delete takes the whole subtree with it —
   sub-goals, focuses, tasks, task events, backlog items — with no soft-delete and no trash (Q-5). Worse,
   the API's `GOAL_HAS_CHILDREN` guard only fires when the goal has *descendants*
   (`goal.service.ts:247`), so deleting a **leaf** goal carrying forty open tasks and a full backlog
   succeeds silently on the first call. The `acknowledged_counts` round-trip is what converts an agent's
   confident single call into a two-step the user sees. Until `preview_goal_deletion` exists on the
   backend, `delete_goal` should refuse any goal that `get_goal` shows to have children or backlog.

2. **`POST /me/change-password` gets no tool at all.** This deployment cannot send mail, so changing the
   password while signed in is the *only* recovery path the owner has (`endpoints.ts` comment on
   `meChangePassword`). An agent that changes it — from a mis-parsed instruction, a prompt injection in a
   task description, or a bad retry — locks the owner out of their account permanently. There is no
   upside: the owner has a UI for this. Leave it off the surface entirely rather than behind a
   confirmation.

3. **`save_weekly_plan` requires `confirm_deactivations`.** `PUT /plan` is a whole-week replace: any
   active leaf the agent forgets to include goes dormant, silently, in the same transaction that looked
   like a success (R-plan-7). An agent working from a stale or partial tree will do this and report
   "plan saved". Requiring the count of branches it is about to deactivate forces it to have looked.
   `set_goal_focus` / `clear_goal_focus` exist so the agent almost never needs the raw primitive.

4. **No tool may pass a title where an id is expected.** Fuzzy matching inside a mutating tool is the
   single highest-consequence failure mode on this surface: an agent that resolves "fitness" to the wrong
   Monthly goal creates work under a stranger's branch, and nothing about the response looks wrong.
   `find_goal` makes resolution a visible, ambiguity-reporting step, and its `ambiguous: true` flag is
   what the model is told to escalate on.

5. **`delete_backlog_item` and `delete_idea` are confirm-then-act; `discard_learning` should be too.**
   There is no archive anywhere in this product. Deleting a parked item is cheap for an agent and
   irreversible for the owner, and "clean up my backlog" is exactly the kind of instruction that reads as
   a licence to bulk-delete. `delete_backlog_item` carries a required `confirmed: true`; the prompts
   instruct one-at-a-time processing for ideas.

6. **The agent never supplies an `Idempotency-Key`.** An LLM cannot reliably reason about when two calls
   are "the same operation", and a reused key across genuinely different intents returns a stale replay
   that looks like success. The server mints a fresh key per tool invocation and reuses it only for
   transport-level retries of that same invocation — which is exactly the semantics `Q-4` wants.

7. **No bulk/batch mutation tool.** There is deliberately no `delete_goals`, `complete_tasks`, or
   `convert_all_backlog`. Everything destructive is one entity per call, so a misread instruction costs
   one row and one visible step, not a subtree. The prompts reinforce this ("one decision at a time").

8. **`update_preferences.timezone` should be confirmed with the user.** It silently redefines which
   Monday "this week" is, which moves every carry age and can make the current plan unsaveable
   (`WEEK_NOT_CURRENT`). It is not destructive, but it is invisible, and invisible is worse here.

9. **The absent things stay absent.** No tool for a fourth task exit, a review wizard, a week report, or
   writing a task event (R-nav-14, R-task-13, R-task-31, S-task-30-1). An agent asked for "reschedule
   this to next week" must say the product does not do that — the three exits are the answer. Adding a
   convenience tool here would be the first place the MCP surface and the product diverge.

---

## 8. Open questions

1. **Does `preview_goal_deletion` get built, and as a `dryRun` flag or its own route?**
   `[recommended]` `DELETE /goals/:id?dryRun=true` returning the existing `DeleteGoalResponse` shape with
   `deleted: false` — it reuses the counting code already in `GoalService.remove` and adds no new
   response schema. Also make the leaf case emit counts, so the guard covers the dangerous path.

2. **Should `find_goal` fuzzy-match, or should the surface be ids-only with `get_overview` as the
   documented discovery step?**
   `[recommended]` Fuzzy-match in `find_goal` and nowhere else, with an explicit `ambiguous` flag and a
   score. Ids-only is safer but costs the agent a full-tree read and a manual scan on every turn, and in
   practice models will scan badly. Concentrating the fuzziness in one read-only tool means the risk is
   inspectable and the mutating tools stay exact.

3. **Should `save_weekly_plan` be exposed at all, given `set_goal_focus` / `clear_goal_focus` cover every
   single-branch case?**
   `[recommended]` Yes, keep it — genuine weekly planning replaces five to ten focuses at once and doing
   that as N read-modify-writes is both slow and non-atomic — but keep `confirm_deactivations` mandatory
   and keep the description steering agents to the wrappers.

4. **Should the MCP server expose past-week *writes* (completing a task in week -3)?**
   `[recommended]` Yes. `complete_task(week_offset)` is a real product capability (R-task-14, past weeks
   stay fully interactive) and an agent doing a carry review needs it. The `WEEK_OUT_OF_RANGE` guard
   already prevents the incoherent cases.

5. **`goal_id` on `list_tasks` filters an exact leaf, not a subtree. Should the MCP layer add subtree
   filtering client-side?**
   `[recommended]` Yes — expose `under_goal_id` as an MCP-layer filter (resolve the subtree from
   `GET /goals`, then filter the week's tasks). "How's my health line doing" is the most natural question
   an agent will be asked, and exact-leaf filtering answers it wrong rather than not at all.

6. **How much of `docs/BUSINESS-RULES.md` ships as a resource?**
   `[recommended]` All of it, verbatim, at `goalcascade://rules/business-rules`. It is 69 lines, it is
   the authoritative prose, and paraphrasing it into the instructions block is how the two drift.

7. **Should `update_learning(applied=true)` be agent-settable?**
   `[recommended]` Yes, but only on explicit user statement — the badge means "this changed the plan",
   which is a claim about a decision the owner made, not something to infer. Note it in the tool
   description (done above) rather than blocking it.

8. **Should there be a `set_last_used_goal` equivalent for the `+` drawer's default?**
   `[recommended]` No. That is a client-local UI convenience (R-backlog-14), not account state, and there
   is no endpoint for it. An agent should name the goal explicitly every time.

9. **Read-only mode as a deployment option?**
   `[recommended]` Ship a `GOALCASCADE_MCP_READONLY` flag that advertises only the 12 read tools and the
   resources. Useful for connecting a second, untrusted agent (a summariser, a briefing bot) without
   giving it the write surface. Not a rail on the owner's own agent — an operational option.
