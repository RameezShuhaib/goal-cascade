# Goal Cascade — Product Specification

Extracted from `docs/BUSINESS-RULES.md` (authoritative prose) and the React mockup in `apps/web/src/`.
Where the two disagree, BUSINESS-RULES wins and the divergence is recorded in §5.

Conventions used throughout:

- **Week model.** Weeks start Monday. The client addresses weeks by *offset* relative to the current week (`0` = current, negative = past, positive = a future week; ⚠ **A2** removes the forward bound — R-lens-7). The stored model uses an absolute `weekStart` date (see §5, D-1). `offset = (weekStart − mondayOf(today)) / 7 days`.
- **Period model** (⚠ **A2**, R-goal-33). Every non-Life goal sits in exactly one **period** of its own horizon, identified by a canonical `periodKey`: `2026` (Yearly), `2026-Q3` (Quarterly), `2026-09` (Monthly), `2026-09-07` — the Monday — (Weekly). A Life goal has `periodKey = ''`. A week is the Weekly horizon's period, so the week model above is a special case of this one.
- **Amendments.** §6 records amendment sets applied after the first draft. Every rule an amendment supersedes, retires or modifies is marked in place with `⚠` and the rule that replaces it; §6 carries the before/after so intent can be diffed. A rule with no `⚠` is unchanged. **A rule marked `RETIRED` describes a product that no longer exists and must not be implemented**; its text is left in place only so the diff is readable.
- **Horizon rank.** ⚠ **A2**: `Life=0, Yearly=1, Quarterly=2, Monthly=3, Weekly=4` (R-goal-30). "Shorter horizon" = higher rank. Weekly is terminal (R-goal-31). ⚠ **A8** — Weekly is no longer the only horizon that holds tasks: **Monthly and Weekly** hold them, and nothing else does (R-task-51, superseding R-goal-39).
- **Task scope** (⚠ **A8**, R-task-52). A task carries its own `scope` — `Monthly` or `Weekly` — seeded from its goal's horizon at creation, and one `originPeriodKey` in that scope's format (`2026-09` or `2026-09-07`). Every visibility, carry and completion comparison in §2 is made **within one scope**, against `periodKey`s of one format. The week model above is the Weekly scope's special case.
- Ids in §3 refer to rules in §2. Test names and conformance reporting key off scenario ids.

---

## 1. Entities and fields

Server-owned fields are marked **[srv]**: the client never supplies them and any client-supplied value is ignored. All entities carry `ownerId` **[srv]** (see R-auth-2); it is omitted from the per-entity tables below to avoid repetition.

### Goal

| Field | Type | Req. | Meaning |
|---|---|---|---|
| `id` | string | **[srv]** | Stable goal identifier. |
| `parentId` | string \| null | required (nullable) | Parent goal; `null` only for Life goals. |
| `horizon` | `'Life' \| 'Yearly' \| 'Quarterly' \| 'Monthly' \| 'Weekly'` ⚠ **A2** | required | Position in the cascade; fixed after creation. |
| `title` | string | required | The goal, one line. Non-empty after trim. |
| `why` | string | optional (`''`) | One-line motivation. |
| `pulse` | `'On track' \| 'At risk' \| 'Rethink'` | required (default `'On track'`) | Self-reported health. |
| `periodKey` | string | required (`''` on Life) ⚠ **A2, new** | The canonical period this goal sits in: `2026` / `2026-Q3` / `2026-09` / `2026-09-07`. Server-normalised, sortable, the key every lens filters on (R-goal-33). |
| ~~`period`~~ | string | ⚠ **A2 — [srv], derived** | Was owner-typed free text; is now the **rendered label** of `periodKey` (`2026`, `Q3 2026`, `Sep 2026`, `Week of 7 Sep`). A client-supplied value is ignored (R-goal-33). |
| `createdAt` / `updatedAt` | timestamp | **[srv]** | Audit timestamps. |

Derived, never stored: `ancestors`, `descendants`, `path`, `lifeRootId` (R-lens-3).
⚠ **A2** — `isLeaf`, `isActive`, `dormant` and `subtreeActive` leave this list and leave the wire: `isLeaf` is retired outright (R-goal-37), and *active* / *dormant* are redefined as per-week predicates with exactly one consumer (R-goal-38, R-lens-12).
~~The mockup's `Goal.focus: string` is **not** a Goal field in this spec — see WeeklyFocus and §5 D-2.~~ ⚠ **A2** — there is no focus at all; D-2's principle survives as R-lens-10.

### ~~WeeklyFocus~~ ⚠ **A2 — DELETED (R-rm-2)**

The entity, its table, its indexes, its repository, its service, its routes, its schemas and its MCP tools are removed. Nothing replaces it as an entity: a weekly intent is now an ordinary goal with `horizon = 'Weekly'`, and several of them may sit under one parent in one week. The table below is retained only so the ledger in §6 can be read against it.

| Field | Type | Req. | Meaning |
|---|---|---|---|
| `id` | string | **[srv]** | Identifier. |
| `goalId` | string | required | The non-Life leaf goal this focus belongs to. |
| `weekStart` | date (Monday) | required | The week this focus applies to. |
| `sentence` | string | required | One sentence, non-empty after trim; a blank sentence means "no focus" and the record must not exist. |
| `sortKey` | int | **[srv]** | 0-based position of this sentence among the leaf's sentences for that week (R-plan-14). Assigned from entry order on every plan save. |
| `createdAt` / `updatedAt` | timestamp | **[srv]** | Audit timestamps. `createdAt` survives an update-in-place and is what R-plan-19 measures. |

Unique on `(goalId, weekStart, sortKey)`. ⚠ **Amendment 1** — the former `(goalId, weekStart)` uniqueness (exactly one sentence per leaf per week) is superseded by R-plan-13: a leaf may hold 1–5 rows for one week.

### Task

| Field | Type | Req. | Meaning |
|---|---|---|---|
| `id` | string | **[srv]** | Identifier. |
| `goalId` | string | required ⚠ **A2, A8** | The goal that holds it. ⚠ **A8** — `horizon ∈ { 'Monthly', 'Weekly' }` is the whole condition (R-task-51, superseding R-goal-39) — never leaf-ness, never Life, Yearly or Quarterly. |
| `scope` | `'Monthly' \| 'Weekly'` | **[srv]** ⚠ **A8, new** | The task's own horizon, seeded from its goal's at creation. It is what every visibility, carry and completion comparison is made *within*, and it is the format `originPeriodKey` must be in (R-task-52). Changed by exactly one operation, Park (R-task-56). |
| `title` | string | required | What to do. Non-empty after trim. |
| `cond` | string | optional (`''`) | Done-condition — how you'll know it's done. |
| `desc` | string | optional (`''`) | Free-text notes. |
| `links` | `{ url: string }[]` | optional (`[]`) | External links, insertion-ordered. |
| `done` | boolean | **[srv]** | Derived from `donePeriodKey != null`; set via the complete/uncheck operations, never written directly. |
| ~~`doneWeek`~~ → `donePeriodKey` | periodKey \| null | **[srv]** ⚠ **A8 — renamed and generalised** | The period the task was completed **in**, in the task's own `scope`: a Monday for a week task (unchanged in value and meaning), a month key for a month task. `null` while open (R-task-53, R-task-55). |
| `doneAt` | timestamp \| null | **[srv]** | Instant of completion; renders as `Done Fri 28 Aug`. |
| ~~`originWeek`~~ → `originPeriodKey` | periodKey | **[srv]** ⚠ **A2, renamed and generalised by A8** | The period the task was created **into**, in the task's own `scope`. Seeded once from its goal's `periodKey`; it is **its own stored field, never re-derived from the parent** (R-task-40, unchanged in force). There is no client input for it, and exactly one operation rewrites it (Park — R-task-56). |
| `measure` | Measure \| null | optional (`null`) ⚠ **A8, new** | The number this task carries, or `null`. A task with `measure = null` is an ordinary checkbox and renders exactly as it does today (R-measure-1). |
| `events` | TaskEvent[] | **[srv]** | Activity timeline, newest first. |
| `createdAt` | timestamp | **[srv]** | Audit timestamp. |

The mockup's `doneLabel: string` is a rendering of `doneAt` and is not stored (§5 D-4).

### Measure (⚠ **A8, new**)

A sub-record of Task, present or absent. It is **not** an entity of its own: it has no id, no list, no page and no existence apart from its task.

| Field | Type | Req. | Meaning |
|---|---|---|---|
| `kind` | `'counter' \| 'gauge'` | required | How a value is entered: a counter is added to, a gauge is set. There is **no `binary` member** — a checkbox is `measure = null` (R-measure-1). |
| `start` | number | required | Where the count began. `0` for a counter unless told otherwise. |
| `current` | number | **[srv]** | The value of the latest surviving reading, or `start` when there are none. **Derived, never client-supplied** (R-measure-3). |
| `target` | number \| null | optional (`null`) | Where it is going. `null` is a legitimate tracked measurement with no completion and no percentage — the AMRAP case (R-measure-4). |
| `unit` | string | optional (`''`) | `leads`, `kg`, `calls`. Rendered after the numbers; never parsed, never converted, never validated against a unit list. |
| `readings` | Reading[] | **[srv]** | Append-only history, oldest first on the wire (R-measure-5). |

Direction is **implied**: `target > start` counts up, `target < start` counts down. There is no direction flag (R-measure-2). `target == start` is refused (R-measure-4).

### Reading (⚠ **A8, new**)

| Field | Type | Req. | Meaning |
|---|---|---|---|
| `id` | string | **[srv]** | Identifier — a reading is deletable, so it must be nameable. |
| `taskId` | string | **[srv]** | Owning task. **There is no week, month or period column** (R-measure-5). |
| `value` | number | required | The **absolute** value of the measure after this reading. A counter's `+3` is resolved to an absolute by the server before it is stored. |
| `at` | timestamp | **[srv]** | When it was recorded. |

Append-only and individually deletable, and that is the whole of its lifecycle: a reading is never edited in place, because correcting one is deleting it and recording another.

### TaskEvent

| Field | Type | Req. | Meaning |
|---|---|---|---|
| `id` | string | **[srv]** | Identifier. |
| `taskId` | string | **[srv]** | Owning task. |
| `type` | enum (see R-task-30) | **[srv]** | Machine-readable event kind. |
| `text` | string | **[srv]** | Rendered line, e.g. `Renamed: "old" → "new"`. |
| `glyph` | string | **[srv]** | Small icon: `＋ ↻ ✎ ↗ ✓ ↩ →`. |
| `at` | timestamp | **[srv]** | When it happened; renders as the muted date line. |

The whole entity is server-owned and append-only. It is never created, edited, or deleted by the client (R-task-31).

### BacklogItem

| Field | Type | Req. | Meaning |
|---|---|---|---|
| `id` | string | **[srv]** | Identifier. |
| `goalId` | string | required ⚠ **A2** | A Yearly/Quarterly/Monthly goal. Never a Life goal, and never a **Weekly** goal — a backlog item is deferred work with no week, and a Weekly goal would give it one (R-backlog-2, R-backlog-26). |
| `title` | string | required | The deferred work, one line. Non-empty after trim. |
| `desc` | string | optional (`''`) | Free-text notes. |
| `links` | `{ url: string }[]` | optional (`[]`) | External links. |
| `capturedAt` | timestamp | **[srv]** | When it was captured; renders as `Added 25 Aug` / `Added Today`. |
| `fromWeek` | week (Monday date) \| null | **[srv]** | Set when the item came from a task moved out of a week; renders `from week of 24 Aug`. |
| `sortKey` | string | **[srv]** | Manual position within its **own goal's** list (R-backlog-17). Opaque, lexicographically ordered; the client never parses or mints one. |

No checkbox, done-condition, due date, or status — deliberately (R-backlog-3).
⚠ **A8** — and now, deliberately, **no period either**: `periodKey` is the field a backlog item does not have, and that absence is the whole difference between it and a month task on the same Monthly goal (R-backlog-30).

### ~~Idea~~ ⚠ **A2 — DELETED (R-rm-1)**

The entity is removed outright: no migration, no conversion, no export. The owner's decision, verbatim: *"forget about it nor i care about its data as i didnt use it."* Backlog items serve the same purpose. The table below is retained only so the ledger in §6 can be read against it.

| Field | Type | Req. | Meaning |
|---|---|---|---|
| `id` | string | **[srv]** | Identifier. |
| `goalId` | string \| null | optional (default `null`) | Optional **Life-goal** tag; `null` renders as "Unsorted". |
| `text` | string | required | The parked thought. Non-empty after trim. |
| `capturedAt` | timestamp | **[srv]** | When it was parked. |

### Learning

| Field | Type | Req. | Meaning |
|---|---|---|---|
| `id` | string | **[srv]** | Identifier. |
| `goalId` | string \| null | optional (default `null`) | Optional **Life-goal** tag. |
| `text` | string | required | The insight. Non-empty after trim. |
| `capturedAt` | timestamp | **[srv]** | When it was captured. |
| `applied` | boolean | optional (default `false`) | "changed the plan" badge. |

---

## 2. Numbered rules

### Goal

- **R-goal-1** ⚠ **modified by A2 (R-goal-33, R-goal-31)** — A goal has `title` (required, non-empty after trim), optional `why`, a `horizon`, a `pulse`, a target `period`, an optional `parentId`, and any number of children. (BUSINESS-RULES §Goal bullet 1; `types.ts:Goal`.)
- **R-goal-2** ⚠ **superseded by R-goal-30 (A2)** — The four horizons are Life → Yearly → Quarterly → Monthly with ranks 0–3. (`utils/tree.ts:rank`.)
- **R-goal-3** — A Life goal has `parentId = null` and `period = ''`; the create modal hides the period field when the horizon is Life. (`GoalModals.tsx` — `st.gmHorizon !== 'Life'` gate; `defaultPeriod('Life') === ''`.)
- **R-goal-4** — A non-Life goal must have a parent. Create is refused without one. (`store.saveGoal`: `if (gmHorizon !== 'Life' && !gmParentId) return`.)
- **R-goal-5 (horizon-rank ordering, create)** ⚠ **modified by A2** — unchanged in form; the rank set is now 0–4 and Monthly is no longer terminal (R-goal-30/R-goal-32) — On create, `rank(parent.horizon) < rank(child.horizon)` strictly. The parent picker lists only goals satisfying this; the horizon picker offers only ranks `> rank(parent)`. (`GoalModals.tsx`: `parents = flatTree(...).filter(r => rank(r.g.horizon) < rank(gmHorizon))`; `gmMinRank = rank(parent) + 1`.)
- **R-goal-6** ⚠ **superseded by R-goal-31 (A2)** — the rule keeps its shape with `Monthly` replaced by `Weekly`: Monthly now accepts Weekly children, and **Weekly** is the horizon that can never have sub-goals — A Monthly goal can never have sub-goals: the `+ Sub-goal` action is absent on Monthly rows and on a Monthly goal's detail screen. The server refuses the create regardless of what the client sends. (BUSINESS-RULES §Goal bullet 2; `GoalsScreen.tsx` `g.horizon !== 'Monthly' &&`; `GoalDetailScreen.tsx` same guard. §5 D-6.)
- **R-goal-7** ⚠ **superseded by R-goal-32 (A2)** — max depth is now 5 — Nesting never exceeds Life › Yearly › Quarterly › Monthly, i.e. max depth 4 and each level strictly shorter than the last. This is a consequence of R-goal-5 + R-goal-6 and must hold as a stored invariant.
- **R-goal-8 (leaf)** ⚠ **RETIRED by R-goal-37 (A2)** — the word "leaf" is retired, not redefined: it is no longer coextensive with "holds tasks" — A goal is a **leaf** iff it has zero children. (`utils/tree.ts:isLeaf`.)
- **R-goal-9 (active)** ⚠ **RETIRED by A2 — see R-goal-38** — `weekly_focus` no longer exists, so "active" has no referent — A goal is **active** iff it is a leaf, is not a Life goal, and has **at least one** WeeklyFocus for **the week in question**. Goals that are not leaves are never active. (`utils/tree.ts:isActive`; `leaves()` requires `g.parentId`.)
- **R-goal-10 (dormant)** ⚠ **RETIRED by A2, no replacement — see R-goal-38** — A non-Life leaf with **no** focus row for the week in question is **dormant**: rendered muted with `DORMANT — no focus this week` in the tree, and `DORMANT / No weekly focus this week. Activate it in weekly planning.` on its detail screen. Dormancy must read as intentional, not broken. (`GoalsScreen.tsx`, `GoalDetailScreen.tsx`.)
- **R-goal-11 (dormancy propagates up)** ⚠ **RETIRED by A2, no replacement** — there is no tree screen to mute — A non-leaf goal is muted iff **no** leaf anywhere in its subtree is active; one active leaf anywhere below lights the whole ancestor chain. (`utils/tree.ts:subtreeActive` — recursive `some`.)
- **R-goal-12** ⚠ **superseded by R-goal-39 (A2)** — tasks now hang off **Weekly goals** directly, and off nothing else — Goals never hold tasks directly; tasks hang off the leaf's weekly focus. (BUSINESS-RULES §Goal bullet 3.)
- **R-goal-13** ⚠ **superseded by R-goal-33 (A2)** — `period` becomes a derived label over `periodKey` — `period` defaults from the horizon on create and is derived from **today**: Yearly → the current year, Quarterly → the current quarter, Monthly → the current month, Life → `''`. (`utils/tree.ts:defaultPeriod`, corrected by §5 D-3.)
- **R-goal-14 (edit)** ⚠ **modified by R-goal-36 (A2)** — the editable field is `periodKey`, and it may never move into a past period — Editing a goal may change `title`, `why`, `period`, and `pulse` only. `horizon` and `parentId` are immutable through edit; the horizon chips are locked and the parent picker is hidden while editing. Re-parenting is done through Move (R-goal-16). (`store.saveGoal` edit branch writes only title/why/period; `GoalModals.tsx` `locked = !!st.gmEditId`, `needsParent = ... && !st.gmEditId`.)
- **R-goal-15** — `pulse` is one of On track / At risk / Rethink, per goal, and drives the coloured dot everywhere the goal is listed. (BUSINESS-RULES §Goal bullet 6; `ui.ts:dot`.)
- **R-goal-16 (move / re-parent)** — Move changes only `parentId`. The moved goal's own `horizon` is unchanged, and all descendants move with it, keeping their relative structure. (`store.moveGoal`; `MoveGoalModal` copy: "Its children move with it.")
- **R-goal-17 (horizon-rank ordering, move)** — A move target is valid only if `rank(target.horizon) < rank(moved.horizon)`. Because horizons are unchanged by the move and the subtree was already strictly decreasing, this single check preserves R-goal-7 for the whole subtree.
- **R-goal-18 (invalid move targets)** — A target is invalid if it is (a) the goal itself, (b) any descendant of the goal, or (c) of equal or shorter horizon. (`MoveGoalModal`: self filtered out; `desc.includes(...)`; `rank(r.g.horizon) >= rank(mvNode.horizon)`.)
- **R-goal-19 (the two disabled reasons)** — Invalid targets are listed but disabled, annotated with exactly one of two reasons: `its own descendant` (checked first) or `horizon conflict`. The goal itself is also disabled with `its own descendant`. No other reason strings exist. (`MoveGoalModal`; §5 D-7 for the self row.)
- **R-goal-20 (move preview)** — Once a target is selected and before confirming, a preview line reads `<goal> will move under <full ancestor path of target ›-joined>`. Confirm is disabled until a target is chosen. (`MoveGoalModal` `preview`, `saveBtn(!st.mvParentId)`.)
- **R-goal-21** — A Life goal cannot be moved and cannot be re-planned; its row menu offers only `+ Sub-goal` and `Edit`. (`GoalsScreen.tsx` life-goal menu.)
- **R-goal-22 (re-plan)** ⚠ **modified by R-goal-40 (A2)** — re-plan writes `periodKey` — Re-plan sets `period` to a contextual next period and takes an **optional** one-line reason. Nothing is mandatory; the sheet says "No mandatory fields. Fast and guilt-free." (BUSINESS-RULES §Goal bullet 5; `ConfirmSheet`.)
- **R-goal-23 (re-plan options)** ⚠ **superseded by R-goal-40 (A2)** — options are `periodKey`s and Weekly is added — Options are derived from today and the goal's horizon: Monthly → the next two months; Quarterly → the next two quarters; Yearly → next year. Life goals are not re-plannable (R-goal-21). (`utils/tree.ts:replanPeriods`, corrected by §5 D-3.)
- **R-goal-24 (life-goal quiet signal)** — A life-goal card shows `N task[s] carrying · oldest W week[s]` when open tasks exist under it whose `originWeek` is before the current week. `N` = count of those tasks; `W` = the largest age in weeks. The line is hidden when `N = 0`. There are no audit pages, review wizards, or reports anywhere in the product. (BUSINESS-RULES §Goal bullet 7; `GoalsScreen.tsx:carryLine`.)
- **R-goal-25** ⚠ **superseded by R-lens-1 … R-lens-6 (A2)** — there is no goals tree; a lens is a flat grouped list — The goals tree groups every branch under its Life root, is expand/collapse per node (expanded by default), and shows per row: title, horizon chip, pulse dot, `N in backlog` when the goal holds backlog items, the focus sentence when active, and the dormant line when a dormant leaf. (`GoalsScreen.tsx:renderRows`.)
- **R-goal-26** ⚠ **RETIRED by A2, no replacement** — it counted active leaves; R-lens-4's open-task count is the surviving group-header number — A life-goal summary chip shows `<A> of <B> branches active` where `B` is the number of non-Life leaves under it and `A` how many are active. When `B = 0`, the chip reads `0 of 0 branches`. (`GoalsScreen.tsx`, corrected by §5 D-16.)
- **R-goal-27** ⚠ **superseded by R-goal-41 (A2)** — A goal's detail screen shows breadcrumbs to the root, title, horizon · period chip, `why`, sub-goal list with per-child active/dormant labels, the weekly-focus block when active, the dormant block when a dormant leaf, a backlog block (R-backlog-11/12), and the learnings attached to its Life line.
- **R-goal-28** ⚠ **RETIRED by A2 — see R-goal-42** — nothing is leaf-bound any more, so gaining a child moves nothing — Adding a child to a leaf, or moving a goal under a leaf, makes that leaf a non-leaf: every focus row it holds for the current week **and for any later week** is deleted (past rows survive as history, D-2) and its open tasks are re-parented per §5 D-2/D-8. The operation must never leave a focus or task attached to a non-leaf.
- **R-goal-29** — `title` and `why` are trimmed on save; a whitespace-only title is a validation failure, not a silent no-op.

#### Amendment 2 — the Weekly horizon, periods, and the end of focus

- **R-goal-30 (five horizons)** — Life → Yearly → Quarterly → Monthly → Weekly, ranks 0–4. "Shorter horizon" is still higher rank. *Supersedes R-goal-2.* Every rank comparison in the product — create, move, the two move-target reasons — is unchanged in form; only the array grows.
- **R-goal-31 (Weekly is terminal; Monthly is not)** — A **Weekly** goal can never have sub-goals: no `+ Sub-goal` affordance on a Weekly goal anywhere, and the server refuses the create regardless of what the client sends. A **Monthly** goal now accepts children, and by R-goal-5 the only horizon it can accept is Weekly. *Supersedes R-goal-6*, which said exactly this of Monthly: the rule keeps its shape with one word replaced, and the single rank comparison in `checkCreate` continues to enforce both R-goal-5 and this rule, because the terminal horizon has the maximum rank and nothing can be strictly greater than it.
- **R-goal-32 (depth 5, and levels may still be skipped)** — Nesting never exceeds Life › Yearly › Quarterly › Monthly › Weekly: max depth 5, each level strictly shorter than the last. *Supersedes R-goal-7.* R-goal-5 requires strictly **decreasing** rank, not adjacency, so a Weekly goal may hang directly off a Monthly, Quarterly, Yearly **or Life** goal. Monthly is the normal parent and the one the create flow defaults to; none of the others is an error.
  - *This answers "can a Weekly goal exist without a Monthly parent": yes.* Inventing an adjacency rule for Weekly alone would make it the only horizon in the product carrying a parent constraint the other four do not, and would refuse a perfectly coherent tree — a Life goal with a single weekly practice under it and no year, quarter or month in between.
- **R-goal-33 (`periodKey` — period identity)** — Every non-Life goal carries a required, server-normalised **`periodKey`**: canonical, lexicographically sortable, one format per horizon.

  | Horizon | `periodKey` | Rendered `period` label | Example |
  |---|---|---|---|
  | Life | `''` | `''` | — |
  | Yearly | `YYYY` | `YYYY` | `2026` |
  | Quarterly | `YYYY-Qn` | `Qn YYYY` | `Q3 2026` |
  | Monthly | `YYYY-MM` | `Mon YYYY` | `Sep 2026` |
  | Weekly | `YYYY-MM-DD` (a **Monday**) | `Week of D Mon` | `Week of 7 Sep` |

  `period` stops being an owner-typed string and becomes a **[srv]**, derived label; a client-supplied `period` is ignored. `periodKey` is validated against the horizon — `2026-Q5`, `2026-13`, or a Weekly key that is not a Monday are validation failures. *Supersedes R-goal-13.*
  - **Why the free-text field cannot survive.** A lens is "every goal at this horizon **in this period**" (R-lens-2), which requires the period to *partition* the goals at a horizon: each goal in exactly one period, comparable, sortable, indexable. Free text partitions nothing — `Sep 2026`, `September 2026`, `sept 26` and `''` are four periods — and a goal whose label parses as none of them appears in **no lens at all**, which is a goal you can no longer reach. This is D-1's failure mode in the period column: a value only its author can interpret.
  - Weekly reuses `WeekStart` exactly (D-1): the Monday, absolute, never an offset. The week model is now a special case of the period model, not a parallel one.
  - **What is lost:** an owner-typed period label (`H2`, `before the move`). Accepted: the label was never read by anything, and a lens cannot be built on a value the product cannot compare.
- **R-goal-34 (what "current" means)** ⚠ **modified by A5 — the CALENDAR half is shared and the client computes it too; the DATA half is unchanged (R-lens-30)** — The current period of a horizon is derived from the owner's **account timezone** (R-auth-5), never the client clock: `today = dateInTimezone(now, tz)`, then Yearly = `today`'s year, Quarterly = `today`'s quarter, Monthly = `today`'s month, Weekly = `weekStartOfDate(today)`. Life has no current period. Every past/future judgement in A2 is a `periodKey` comparison against these. ⚠ **A5 (R-lens-30)** — the clause *"computed server-side and echoed on the wire so the client never re-derives one"* is amended: the comparison is **one implementation in `packages/shared/src/calendar/`, imported by both sides**, and the wire value is still sent and is now checked against the client's on every read. The disagreement R-auth-5 exists to prevent is a client deriving a day from the **device clock**; `today` is the stored account timezone applied to the server's clock, which is the same two inputs the server uses.
- **R-goal-35 (periods do not nest, and are never validated against the parent's)** — A goal's period is not constrained by its ancestors'. A Weekly goal for the week of 28 Sep may sit under a Monthly goal for `Oct 2026`; a Monthly goal for `Mar 2026` may sit under a Quarterly goal for `Q4 2026`. The tree constrains **horizon rank** and nothing else, exactly as before A2.
  - Enforcing containment would refuse the ordinary case — a week straddles a month boundary in most months — and would need a rule for every ancestor pair, not just Monthly→Weekly. A goal's ancestry with each ancestor's period is shown on its detail page (R-goal-41), which is where a mismatch is visible. There is no chip, no warning and no styling for it: a quiet product does not invent a fifth escalation (R-nav-26, R-lens-11).
- **R-goal-36 (a goal is never created into, or moved into, a past period)** — A create whose `periodKey` names a period earlier than the current one for its horizon is refused with **`PERIOD_IN_PAST`** (409). An edit or re-plan that would move a goal's `periodKey` into a past period is refused with the same code. **There is no forward bound at any horizon**: any future period is writable (owner decision 5; `PLAN_AHEAD_WEEKS` is retired, R-rm-3).
  - **This is D-2, generalised.** The defect that made focus per-week was that planning rewrote history. A goal written into last month is a plan claiming to have existed then, and it changes what a past lens says happened.
  - What a past-period goal still permits, deliberately: `title` / `why` / `pulse` edits (a correction is not a plan), Move (re-parenting changes no period), Delete (an explicit, confirmed destructive act — Q-5), and **every task operation R-task-14 already allows in a past week, including completing one**. Past periods are closed to new plan and to nothing else.
  - The bound is validation, not a picker clamp (R-lens-7): every past period is reachable and readable.
- **R-goal-37 ("leaf" is retired as a product word)** — The term is **retired, not redefined**. Before A2, "leaf", "non-Life leaf", "holds a focus" and "holds tasks" all named one set of goals; after A2 they do not, and **a Monthly goal with no Weekly children is a leaf by the structural definition while being precisely the goal that must never hold a task**. Every former use is restated as exactly one of:
  - **"a Weekly goal"** — wherever the old rule meant *the thing that holds work* (R-goal-39, R-task-39, R-backlog-26);
  - **"a goal with no children"** — wherever it meant the structural fact and nothing more (the create and move guards, the delete cascade).

  No rule may key a permission on leaf-ness. `GoalView.isLeaf` leaves the wire (R-rm-2); a surface needing "has children" reads `children`, which the goal detail response already carries.
  - *Why retire rather than redefine:* a redefined "leaf" reads correctly to anyone who knew the old meaning and is wrong. Nothing in the type system or in a test would catch a handler that admitted a childless Monthly goal as a task parent — it would simply be wrong, on the first empty Monthly goal anyone creates.
- **R-goal-38 (active and dormant, restated per week)** — Both words survive, defined against a **week** `W` and against nothing else:
  - A **Weekly goal is active in `W`** iff `periodKey = W`. It is active in exactly one week — the one it was written for — and in no other. It is **never dormant**: a Weekly goal is not a thing that goes quiet, it is a thing that belongs to a week. *Replaces R-goal-9.*
  - A **non-Weekly goal is dormant in `W`** iff no Weekly goal in its subtree is active in `W`. Dormancy still propagates up exactly as R-goal-11 described — one Weekly goal anywhere below lights the chain — but is read off `periodKey` instead of off a focus row. *Replaces R-goal-10 and R-goal-11.*
  - **Dormancy has exactly one surface, and it is not styling.** No goal is ever muted, greyed, or labelled `DORMANT` anywhere in the product: that muted tree is the clutter this redesign exists to remove. ⚠ **modified by the reconciliation pass — the single consumer moves.** It was R-lens-6's empty-group line in the Weekly lens; empty groups are no longer rendered (R-lens-19), so the single consumer is now **R-goal-47's planned-ness line on a Monthly goal**, one horizon up, where something can be done about it. `GoalView.isActive`, `.dormant` and `.subtreeActive` leave the wire (R-rm-2).
  - ~~**A Monthly goal with no Weekly children gets no special affordance** and no different styling from one that has them.~~ ⚠ **modified by the reconciliation pass.** It gets **no different styling and no extra control** — still true, and R-goal-47's line is muted body text, not a state — but it does carry R-goal-47's `Nothing planned yet`, because with empty groups gone there is nowhere else for the fact to be said. It is not broken; it is a month nobody has broken into weeks yet, and the line says so in those words. ~~R-nav-25's primary action is `+ Weekly goal` on every Monthly goal's **detail page** alike~~ ⚠ **superseded by R-nav-29 (A3)** — a Monthly goal's detail page carries **no** primary action; its weeks are written from the `Sub-goals` section's inline `+ Sub-goal` (R-goal-48). A Monthly goal's **card in a lens** still offers no `+ Weekly goal` at all (Q-20, amended; R-task-49).
- **R-goal-39 (only Weekly goals hold tasks)** ⚠ **SUPERSEDED by R-task-51 (A8) — a task's `goalId` names a **Monthly or Weekly** goal; the "condition is the horizon, full stop" clause survives verbatim and now names two horizons, and `NOT_A_WEEKLY_GOAL` is retired in favour of `NOT_A_TASK_GOAL`** — A task's `goalId` must name a goal with **`horizon = 'Weekly'`**. Life, Yearly, Quarterly and Monthly goals never hold tasks, and a Monthly goal with no Weekly children is no exception. A task create or re-parent naming any other horizon is refused with **`NOT_A_WEEKLY_GOAL`** (409, replacing `NOT_A_LEAF`). *Supersedes R-goal-12 ("goals never hold tasks directly; tasks hang off the leaf's weekly focus") and R-task-1.*
  - **The condition is the horizon, full stop — never leaf-ness** (R-goal-37). Because Weekly is terminal (R-goal-31), every Weekly goal is childless, so "Weekly" implies "no children"; **the converse is false and is the trap.**
  - `+ Task` is rendered on Weekly goals and nowhere else.
- **R-goal-40 (re-plan writes `periodKey`; a Weekly goal is not re-plannable)** — Re-plan sets `periodKey` to a contextual next period of the goal's own horizon and takes an **optional** one-line reason; nothing is mandatory (R-goal-22's substance unchanged). Options are derived from today and the goal's current period, strictly after both (D-3): Monthly → the next two months, Quarterly → the next two quarters, Yearly → next year. *Supersedes R-goal-23.*
  - **A Weekly goal's `periodKey` is immutable after creation**, and a Weekly goal is not re-plannable — the same exemption R-goal-21 gives a Life goal, for the opposite reason. A Weekly goal *is* a week: moving it forward would silently restate what a past week contained, which is D-2, the defect that made focus per-week in the first place. An intention that did not happen is carried by its **open tasks** (R-lens-12), not by moving the goal; an intention with nothing under it is re-written as a new Weekly goal in the new week, which costs one line and leaves the record intact.
  - **Move (re-parent) remains available on a Weekly goal** (R-goal-16/17/18 unchanged). Re-parenting changes no week and rewrites no history — it corrects *which intention a week served*, not when it happened. ⚠ *Interpretation:* the owner's ruling says a Weekly goal "is never re-parented or moved forward"; this spec reads that as one statement about the **week**, since forbidding Move as well would make Weekly the only horizon in the product that cannot be corrected. See §4 Q-24.
- **R-goal-41 (the goal detail page)** ⚠ **modified by R-goal-48 (A3) — the child list is a `Sub-goals` section that renders when empty and carries an inline `+ Sub-goal`** ⚠ **modified by A6 — the breadcrumb clause below** — A goal's detail page shows: breadcrumbs to the Life root **with each ancestor's period label** (R-goal-35); title; horizon · period chip; `why`; pulse; the child list with each child's period; the backlog block (R-backlog-11/12) on a Yearly/Quarterly/Monthly goal; the **task list** and the backlog pull list (R-backlog-28) on a Weekly goal — ⚠ **A8: a Monthly goal's page carries a task list too, above its backlog block, because that pairing is where R-backlog-30's distinction is either legible or lost (R-lens-32)** —; and the learnings attached to its Life line (R-learning-5). *Supersedes R-goal-27.* There is no weekly-focus block and no dormant block — both are deleted.
  - ⚠ **A6 — the breadcrumb clause, amended in three parts. The whole rule is: *crumbs never wrap; the page title always wraps.*** The trail was a wrapping row of every ancestor at full length, sharing row 1 with the top-right cluster, so the owner's own two-level title took three lines of muted grey and pushed the cluster and the `<h1>` down the page.
    1. **The trail is ONE line that never wraps, holding at most three segments** — `Goals`, an overflow `…`, and the **immediate parent**. `Goals` is `flex: 0 0 auto` and is never truncated; the parent takes the remaining line and **tail**-truncates; the cluster is `flex: 0 0 auto` and **can never be pushed by a title, at any length**. Which segments appear is a function of depth alone (`ancestors.length`), with no measurement, no `ResizeObserver` and no breakpoint.
    2. **The Life root moves to an `S.eyebrow` line** above the title, as a button to that goal, at depth ≥ 3 only — i.e. only when it is not already a crumb, so it is never printed twice. An eyebrow is a block and wraps freely, which is right for it and wrong for a trail. On an UNSORTED line (R-lens-20) it is **suppressed** rather than naming a non-Life goal as a Life line.
    3. **The ancestors' period labels — which this rule has always required and the screen had never rendered — move into a `Where this sits` sheet**, opened by the `…` (accessible name `Show the full path`). It is the existing `Sheet`, so it inherits R-nav-15's whole contract: focus-trapped, `Escape`/✕/backdrop all close, focus returns to the `…`. Every ancestor appears root → parent, **untruncated, with its period**, and the current goal is the last row — `aria-current="true"`, not a button. On an UNSORTED line the sheet carries `UNSORTED_NOTE` verbatim.
    - **Truncation is TAIL, never middle.** Middle-ellipsis is right for paths and filenames, where head and tail are both identifying; it is wrong for sentences, where the head carries the meaning and the tail is a modifier. `Set up my AI consultancy and land a…` is a readable clause; `Set up my AI c…paying client` is not. The *trail* is middle-collapsed — the same instinct, at the granularity where it is right.
    - **Every crumb's accessible name is the untruncated title with its period**, because the visible text is ellipsised.
    - **The page's own `<h1>` wraps freely to three lines and only then clamps.** A page title is the answer to "what am I looking at", and truncating it is the defect rather than the fix; beyond three lines the full text is in the Edit sheet, which is where you would go to read or change it anyway.
    - **Generalised to the two other places a long title broke a line**: `cards.tsx:ParentLine`'s `under <parent>` and the task page's `<Life root> · <weekly goal>` context line each become one non-wrapping, tail-truncated line. R-task-45's requirement that both context segments stay tappable is unchanged, and both accessible names carry the full title.
    - **Net lines: fewer.** A deep goal cost three to five wrapped trail lines; it now costs one trail line plus, at depth ≥ 3, one eyebrow. R-nav-27's two-row budget is untouched — nothing in the lens shell changes.
- **R-goal-42 (gaining a child can no longer strand work)** ⚠ **its REASON is restated by A8, and the restatement is stronger; the rule itself is unchanged.** The old reason — *a Weekly goal can never gain a child* — no longer covers the case, because a **Monthly** goal both holds tasks and accepts Weekly children (R-task-51, R-goal-31). The reason that actually binds, and always did: **a goal's `horizon` is immutable and task ownership is keyed on the horizon and on nothing else** (R-goal-37, R-task-51), so gaining a child can never change whether a goal may hold tasks — at any horizon, at any time, in either direction. A Monthly goal that holds month tasks and then gains a Weekly child keeps every task exactly where it is — Adding a child to a goal, or moving a goal under it, moves nothing, deletes nothing and refuses nothing. The transition R-goal-28 and D-8 existed to handle is **unreachable**: only Weekly goals hold tasks, and a Weekly goal can never gain a child (R-goal-31). *Retires R-goal-28 and the `GOAL_HAS_OPEN_TASKS` refusal.* This is the one place the redesign removes a class of defect outright rather than relocating it.
- **R-goal-43 (a Weekly goal can go stale, and says so quietly)** ⚠ **modified by the reconciliation pass — its place in the card is fixed, because the UX plan's card anatomy omitted it** — For a Weekly goal, `plannedAgeWeeks = weeksBetween(weekStartOf(updatedAt), periodKey)`. Once its week has **arrived** (`periodKey ≤ currentWeek`), a goal with `plannedAgeWeeks ≥ 2` renders a muted line `planned <N> weeks ago` beneath its title, in the Weekly lens and on its detail page — **between the parent line (R-lens-23) and the backlog line**, in the same `T.mut` register as both. Muted text only: never a chip, never coloured, never blocking. Age 1 is ordinary planning and carries no label; a week that has not arrived carries none either — it is early, not stale. *Supersedes R-plan-19, which said this of a focus row.*
- **R-goal-44 (an arrived plan is just the plan)** — When a Weekly goal's week becomes the current week, nothing is asked of the owner and nothing is written. No arrival prompt, no staleness confirmation, no "still relevant?" step: that is a review wizard, and R-nav-26 removes it — such a feature must be refused, not deferred. *Supersedes R-plan-20; unchanged in substance.*
- **R-goal-45 (a Weekly goal has no done state — removed by design)** — A Weekly goal is never completed, checked, closed, archived or marked done, and carries no completion badge, no progress bar and no `N of M tasks` ratio. No goal at any horizon has ever had a completion state, and giving one only to Weekly would make it a different kind of node from the other four.
  - **What answers "did I do it" is the week itself.** A past week's lens renders that week's Weekly goals with their tasks and each task's done state (R-lens-10) — which is a more truthful answer than a badge, because it says *what* got done. `pulse` (On track / At risk / Rethink) remains the one self-reported health signal, on every goal including Weekly.
  - **Absence from later weeks is not ambiguity, it is the statement.** A Weekly goal drops out of subsequent lenses exactly when it has no open tasks carrying (R-lens-12), and that means "nothing outstanding here". A goal whose tasks were all completed and one whose tasks were all cancelled both stop carrying, and correctly so: neither is outstanding. Which of the two happened is recorded in the tasks, in the week they happened in.
  - A completion state would immediately want a completion *rate*, and a rate wants a week report — the surface R-nav-26 removes. This rule exists so that request is refused rather than deferred.
- **R-goal-46 (`Repeat last week` — the answer to node proliferation)** ⚠ **modified by the reconciliation pass — it now has a place to be tapped.** It lives at the **group foot in the Weekly lens**, beside that group's `+ Weekly goal`, and nowhere else. Q-22's original placement — "from the Life group's own header" — is impossible: the header is entirely one collapse toggle with no separate button (R-lens-19). The group foot is a row that already exists, keeps the action per-line as Q-22 requires, adds no chrome, and leaves the header one gesture — The Weekly lens offers one action, `Repeat last week`, which copies the previous week's Weekly goals **for that Life line** into the selected week as **ordinary new goals**: `title`, `why` and `parentId` carried over, `pulse` reset to `On track`, `periodKey` set to the selected week, new ids, no tasks copied, and **nothing linking a copy to its source**. It is offered only on the current week or a later one (R-goal-36), and is a no-op with a toast when the previous week held nothing.
  - **This is deliberately not a recurrence feature.** There is no template entity, no series id, no materialisation job, no "detached from the series" state, and no edit-this-one-versus-all-future decision — the interaction every calendar product is most complained about, and precisely the complexity this redesign is removing. A repeating intention costs one tap per week and produces ordinary rows that can be edited, moved and deleted like any other.
  - It does not reduce the row count, and it is not meant to: see Q-12, where the caps and the read strategy are what actually absorb ~52 Weekly goals a year per repeating intention.

#### Reconciliation pass — dormancy's successor

- **R-goal-47 (the planned-ness line, and dormancy's one surface)** ⚠ **modified by A8 — the line still counts WEEKLY GOALS and nothing else, and it still renders; but `Nothing planned yet` on a month holding three month tasks is a lie, so the empty case splits in two (one new row below), and the line now renders BENEATH the card's task list (R-lens-32)** — A Monthly goal's card, in the Monthly lens and on its detail page, carries **one muted line** stating how the month is broken into weeks. The scope is *Weekly goals whose parent chain reaches this Monthly goal and whose week's **Monday** falls in the viewed month*. ⚠ **A9 — the claim that "one answer serves all three and they can never disagree" was false and is withdrawn.** This scope is a `BETWEEN firstMondayIn … lastMondayIn` range scan and is **unchanged**; R-lens-9's zoom asks a different question (the week you are living in) and keeps its own answer under its own name, `zoomWeekForMonth`; R-task-49's target week asks a third (a week inside this month) and takes `taskWeekForMonth`. What all three share is the **Monday rule**, which is R-goal-33's and is genuinely one rule; what they were wrongly sharing was one *function*, and this scope was the only one of the three the shared function never broke.

  | Situation | The line reads |
  |---|---|
  | No Weekly goals under it in any week of the viewed month, **and no month tasks on it** ⚠ **A8** | `Nothing planned yet` |
  | No Weekly goals under it, but it holds at least one month task ⚠ **A8, new row** | `No weeks yet` |
  | Weekly goals exist; the viewed month does not contain today | `3 weekly goals` |
  | Weekly goals exist; today is in this month and one or more falls in the current week | `3 weekly goals · 1 this week` |
  | Weekly goals exist; today is in this month and none falls in the current week | `3 weekly goals · nothing this week` |

  - **This is dormancy's only surface** (R-goal-38, amended). R-lens-6's empty-group line went with empty groups (R-lens-19), and the state it named — *this line has nothing going on right now* — is real and still worth saying. `nothing this week` is `DORMANT — no focus this week` said in plain words at the one horizon where it is actionable, and it keeps R-goal-10's requirement that it read as intentional rather than broken.
  - **The Monthly lens is the horizon that needs it.** If work lives only at the week, a Monthly goal is a container whose entire purpose is the Weekly goals beneath it, and a lens showing only titles would leave the owner unable to tell a planned month from an empty one.
  - **Not an escalation.** `nothing this week` is the same `T.mut` grey as `3 weekly goals`. The red carry chip remains the only escalation in the product (R-task-11, R-lens-11), and a month being unplanned is a fact, not a failure.
  - **Not a report.** No progress bar, ring, percentage, ratio or chart (R-nav-14, R-nav-26, R-goal-45). A monthly goal that is "40% planned" is a number nobody asked a question about.
  - **Not a link.** Tapping it does nothing: zooming into one card's weeks is a filtered subtree, and the subtree is the thing being removed (R-lens-1). The line is text; the card's `+ Task` is the action (R-task-49).
  - **It is the only number R-nav-26's list gains**, and it replaces a surface rather than adding one. The card's accessible name folds it in, because the line itself takes no focus stop: `Run 4 times a week in August, 3 weekly goals, 1 this week.`
  - Read cost: one range scan per Monthly page over `ix_goals_lens` (`horizon = 'Weekly' AND period_key BETWEEN <first Monday> AND <last Monday> AND parent_id IN (page ids)`), which works only because `period_key` sorts lexicographically — R-goal-33's whole reason for existing.

#### Amendment 3 — sub-goals from the goal page

- **R-goal-48 (a goal's own page is where its sub-goals are made)** — A goal detail page renders the **`Sub-goals` section unconditionally at every horizon that can legally hold children** — Life, Yearly, Quarterly and Monthly — whether or not the goal has any, and the section carries an inline **`+ Sub-goal`** quick capture: the same affordance R-backlog-11's `+ Add` uses one section below, opening in place, committing on `Enter` or `Save sub-goal`, and cancelling with `Never mind`. Empty state: `Nothing under this goal yet.` *Amends R-goal-41, which listed the child list but neither its empty state nor a way to add to it, and is the reason R-nav-29 supersedes R-nav-25's goal-detail mapping.*
  - **The section renders when empty, because empty is the case it exists for.** Rendering the child list only when there are children hides the affordance exactly when it is needed — a Yearly goal with no children today has no surface anywhere in the product that can give it one. The owner's words: *"look if im in a goal page. i would also want to add sub goals in the same page."*
  - **The inline capture, not a second primary action.** R-nav-25 allows a page one primary action and the goal detail page's is the horizon's, so a create that belongs to a section lives **in that section**, where the thing it creates will appear. This also settles the three horizons the old mapping left with nothing: Life, Yearly and Quarterly are precisely the horizons whose purpose is to hold sub-goals.
  - **Everything the page already knows is pre-filled, and nothing is asked twice.** The parent is this goal. The child's horizon is the legal set — every horizon of strictly higher rank (R-goal-5, R-goal-32) — and when that set holds **exactly one** member it is used with **no picker rendered at all** (a Monthly goal, whose only legal child is Weekly). When it holds more, the picker offers exactly those and defaults to the **next shorter** horizon: Life → Yearly, Yearly → Quarterly, Quarterly → Monthly. The period defaults from the chosen horizon as it does everywhere else (R-goal-33): the **current** period of that horizon, or the parent's first enclosed period when the parent's own period begins later — never a past one (R-goal-36).
    - *Why the parent's period can win.* Periods do not nest (R-goal-35), so a Quarterly child of a Yearly goal for `2027` is legal in `2026-Q4` and simply surprising. Taking the later of the two keys is one comparison over canonical keys that already sort chronologically, and it consults no clock the server did not send.
    - The **Weekly** case takes the current Monday the server sent (`WeekView.weekStart`, D-1) and derives none, which is what `+ Weekly goal` already did.
  - **Title only, with a way out to the full form.** Title is a goal's one required field (R-goal-1); `why` and `pulse` have defaults and the parent is known, so the capture takes a title and nothing else. `More…` opens the ordinary create sheet (UX §6.7) with the same horizon, period and parent pre-filled **and the typed title carried across**, so changing your mind about which form you wanted never costs what you already typed.
  - **A Weekly goal renders no section and no affordance** (R-goal-31, unchanged): Weekly is terminal, its legal-child set is empty, and an empty state inviting a create the server would refuse is worse than no section. Where a Weekly goal somehow *holds* children the list still renders — a data problem must surface in the UI (R-lens-20) — with no way to add another.
  - **The horizon rule is the server's and is never copied here.** The picker is *shaped* by the shared `HORIZONS` order (D-5 — a picker is a hint, not an invariant); `HORIZON_CONFLICT` and `PERIOD_IN_PAST` come back as codes and render in place under the field, exactly as every other refusal does.
  - **Client only.** No endpoint, no schema, no error code and no MCP tool is added: this is `POST /goals` with a `parentId`, which `create_goal` already exposes to agents with the same defaulting (omit `period_key` and the server derives the current period). A second tool for "create a sub-goal" would be the same call under another name.

### Lens (⚠ **A2 — new area**; it replaces the goals tree, the Tasks screen and the plan screen)

- **R-lens-1 (a lens, not a tree)** ⚠ **clarified by the reconciliation pass — "collapsible per node" does not forbid R-lens-19's per-group collapse** — The goal tree is not a navigation surface. Navigation is **five lenses, one per horizon**. A lens is a **flat list of every goal at that horizon across the whole account** — never a subtree of one branch, never expandable or collapsible **per node** (a Life-goal *group* is collapsible as a whole, which is a different thing: it hides a flat list, not a level — R-lens-19). The hierarchy still exists in the data and appears as *context on an item* (its Life-goal group, its ancestry on the detail page); it is no longer a path you walk. *Supersedes R-goal-25.* The owner's words: *"i dont like the tree view goals, its too clutered … in life view i can see all my life viwes … when i zoom i see quaterly that should include all quaterly items including items from all life views for that quater."*
- **R-lens-2 (what each lens shows)** —

  | Lens | Period dimension | Contents |
  |---|---|---|
  | Life | none | every Life goal |
  | Yearly | year | every Yearly goal whose `periodKey` is the selected year |
  | Quarterly | quarter | every Quarterly goal for the selected quarter, from **all** Life lines |
  | Monthly | month | every Monthly goal for the selected month, from all Life lines, ⚠ **A8** **and their month tasks** (R-lens-32) |
  | Weekly | week | every Weekly goal for the selected week, from all Life lines, **and the tasks** (R-lens-12), ⚠ **A8** **and the month band** — the month tasks of the month that week belongs to (R-lens-31) |

  Each lens shows the goals of its own horizon in exactly one period and no others. A goal appears in exactly one lens, in exactly one period of it. The Life lens has no period dimension: it is simply all of them.
- **R-lens-3 (grouping by Life goal, at any depth)** ⚠ **modified by the reconciliation pass — the root-less group is renamed `UNSORTED` (R-lens-20)** — Every lens except Life groups its items under **the Life goal each ultimately belongs to**, resolved by walking `parentId` to the root — any depth, with no assumption that the chain is four long or that the levels are adjacent (R-goal-32). Grouping is **not** filtering: there is no `All` chip and no way to view one Life line alone, because the grouping already answers that. *This is the replacement for the goal-filter pills (R-rm-4); the owner is explicit: "in each lense we donot need a filter on goals instead it will be catogrised by life goals."*
  - A goal whose ancestor chain is broken — a `parentId` pointing at nothing — groups under **`UNSORTED`**, last (R-lens-20). It is never dropped: a data problem must surface in the UI rather than silently delete a row from a view (`orderedTree` already takes this position for the tree).
  - The resolution is a walk, not a stored column, and it is cycle-safe (`ancestors` already is). A goal that is its own ancestor resolves to `UNSORTED` rather than looping.
  - **The walk reads the interior tree, never the whole goal list** (R-lens-27): every goal whose horizon is not Weekly is loaded once per request and indexed by id, so each hop is O(1) and no Weekly goal the lens is not rendering is ever held.
- **R-lens-4 (the group header)** ⚠ **modified by the reconciliation pass — a zero count is not rendered; the header's shape and collapse are R-lens-19's** ⚠ **modified by A8 — the count is **week tasks only**; a month task is never counted in it, at any lens (R-lens-31)** — Each group header shows the Life goal's title, its pulse dot, and its **open-task count** — the surviving home of the counts the filter pills carried (R-nav-7, owner decision 7). The count is the number of **open tasks under that Life goal visible in the anchoring week**: the **selected** week in the Weekly lens, and the **current** week in every other lens, which have no week of their own.
  - Stating it once means the number never changes meaning as you browse: outside the Weekly lens it is always today's load, whatever period you are looking at. R-task-38 then holds automatically — a future-origin task is not visible in the current week and cannot inflate it.
  - R-goal-24's carrying line (`N task[s] carrying · oldest W week[s]`) is unchanged and renders on a Life goal's **item in the Life lens**. It is not repeated on group headers elsewhere: two carry numbers in one header is one too many, and the escalation budget is already spent (R-lens-11).
  - ⚠ **modified by the reconciliation pass** — **a zero count is not rendered**, in the visible label or in the accessible name: a line with no open work reads `BE GENUINELY FIT AT 50` and nothing else. With empty groups no longer rendered (R-lens-19) a `0` on a header is pure chrome. *This reverses the original clause "it renders `0`; the header is never hidden".*
  - **This definition survives a challenge and the reasoning is worth keeping.** The UX plan proposed counting open tasks visible in *every* week the selected period covers. It is not truthful in either direction: an open task is visible in every week `≥` its origin, so a past month's header would count work that is open *today*, and every future month would show the identical number — a count firing on work whose period has not arrived, which R-lens-11 forbids outright. One anchoring week is both the honest answer and the cheap one (a single grouped read over `ix_tasks_open_week`).
- **R-lens-5 (order)** — Groups are ordered by their Life goal's `createdAt` asc then `id` asc — the same total, stable order as every sibling list (Q-7) — with `UNSORTED` last (R-lens-20). Within a group, items are ordered by `createdAt` asc then `id` asc. Every item in a group already shares one `periodKey`, so no period tie-break is needed. No list order in a lens depends on storage order, and no lens is manually re-orderable (manual order exists for backlog items and nowhere else, R-backlog-21).
- **R-lens-6 (empty states)** ⚠ **modified by the reconciliation pass — the empty-*group* state is retired (R-lens-19) and a third empty-*lens* state is added (R-lens-24)** —
  - ~~**An empty group** — a Life goal with no items in the selected period — still renders its header and its count, with one muted line: `Nothing at this horizon for <period>.` A Life goal is **never hidden from a lens**: a hidden group is indistinguishable from a deleted goal, and its header carries a count that is true whether or not the group has items. In the Weekly lens this line is the *only* surface dormancy has (R-goal-38).~~ **RETIRED.** A group with no items in the selected period is **not rendered at all** (R-lens-19). A twelve-line account would otherwise render twelve headers on a lens where two have items, which is the clutter complaint restated; the "indistinguishable from a deleted goal" worry is answered by the Life lens, which always shows every Life goal. **The cost is dormancy's only surface, and it is paid in the same breath**: the successor is R-goal-47's planned-ness line on a Monthly goal, one horizon up, where something can be done about it.
  - **An empty lens** — no items in any group for the selected period — reads `Nothing at this horizon for <period>.` with the horizon's create CTA, e.g. `[+ New weekly goal]`. A **past** period gets the copy **without** a CTA: `Nothing was set for <period>.`, because nothing may be created into it (R-goal-36). A lens empty in **every** period takes a third state instead (R-lens-24).
  - The Life lens's empty state is the account's cold start: `No life goals yet.` / `Start with the part of your life you want to move.` / `[+ New life goal]`.
- **R-lens-7 (the period control)** ⚠ **modified by the reconciliation pass — there is no period picker; the label opens the Zoom sheet (R-lens-17), and the picker's dot moves to the forward chevron (R-lens-26)** — Every lens except Life carries one period control: a back chevron, the selected period's label, a forward chevron. It steps by the lens's own unit — a year, a quarter, a month, a week.
  - **There is no forward bound.** Any future period is reachable and writable (owner decision 5, R-goal-36). The forward chevron is never disabled. *Supersedes R-nav-16's `+4` and retires `PLAN_AHEAD_WEEKS`.*
  - **There is no backward bound either**, and **neither chevron is ever disabled except on the Life lens**, where both are (R-lens-17). *Retires `WEEK_HISTORY_WEEKS` as a bound.* ⚠ The original clause disabled the back chevron "at the account's first period"; that is retired — it costs a `MIN(period_key)` probe on every render to grey out one control, and a bound in one direction only rebuilds D-24's asymmetry.
  - ~~**D-24's rule survives, restated:** the chevrons and the picker address exactly the same range … it lists a **window of periods centred on the selected one**…~~ **RETIRED — there is no picker.** The label is the Zoom-sheet button (R-lens-17), and a second control over the *same* dimension is exactly how D-24 happened. D-24's rule is satisfied by construction: one control per dimension, so no two controls can disagree about a range.
  - ~~A period holding at least one item … is **marked with a dot** in the picker.~~ **MOVED to R-lens-26** — the need is real (a goal written three months out is otherwise invisible from every screen but that month's) and it now lives on the forward chevron, which is the control that still exists.
  - `Now ›` in the off-now row (R-lens-21) and `Jump to now` in the Zoom sheet's footer return the lens to its current period in one action. *This is the copy; `Today` / `This week` is retired.*
- **R-lens-8 (where a lens opens)** ⚠ **modified by the reconciliation pass — R-nav-28 names the cold-start lens, which this rule left open** — A lens opens on its **current period** (R-goal-34). The selected lens and period survive within a session and are restorable from the URL (R-lens-14); they are not persisted across sessions, because where you were last Tuesday is not where you want to start. A cold start opens the **Weekly** lens (R-nav-28).
- **R-lens-9 (zooming between lenses)** ⚠ **modified by the reconciliation pass — the Monthly → Weekly clamp is corrected, and the worked example was arithmetically wrong** — The lens control carries an **anchor date**, not a period label (R-lens-18 governs the anchor's lifecycle); each lens renders the period containing that anchor. Selecting a lens maps it:
  - **Zoom out** (shorter → longer, e.g. Monthly → Quarterly): the new period is the one **containing** the anchor. `Sep 2026` → `Q3 2026` → `2026`. Always unambiguous.
  - **Zoom in** (longer → shorter, e.g. Quarterly → Monthly): if the current period **contains today**, the new period is the one containing **today**. In `Q3 2026` on 31 Aug, zooming to Monthly gives **`Aug 2026`** — the month you are living in. ⚠ *The original text read `Sep 2026`, which is simply wrong: 31 Aug is in August. It is corrected here because it is the sentence a builder would copy.* Otherwise the new period is the **first** sub-period of the current one: `Q1 2027` → `Jan 2027`.
  - Zooming **into Weekly** yields the week containing today when today is in that month, else the **first week whose Monday falls in that month**. ⚠ **A9 — unchanged in behaviour, renamed to `zoomWeekForMonth` so its remaining purpose is legible.** Its today-branch tests today's *calendar* month, which is a zoom rule wearing a general name; landing on the week you are living in is right here even when that week belongs to the previous month, and R-lens-29's line names the seam. The two other consumers it was mis-serving are now their own rules (R-task-49, R-goal-47). ⚠ *The original text said "the week containing the 1st" and accepted a Monday in the previous month. That is retired: R-goal-33 keys a week by its Monday, so zooming into `Nov 2026` would have landed on the week of Mon 26 Oct — a week every other rule counts as October's, including R-goal-47's planned-ness scope and R-task-49's target week. One Monday rule, three consumers, no disagreement.*
  - **A week that straddles a month boundary belongs to its Monday's month.** Stated because otherwise it is arbitrary, and because the whole product already names a week by its Monday.
  - **Life has no period**, so zooming to Life discards the period; zooming out of Life uses the **anchor**, which Life leaves untouched (R-lens-18) — going up to Life and back down returns you where you were.
  - The anchor moves only when a period is chosen. Zooming never moves it, so Quarterly → Monthly → Quarterly returns you to the quarter you started in.
- **R-lens-10 (past periods stay readable and truthful)** — A past period renders exactly what was there, and no write may create an item in it or move one into it (R-goal-36). **Planning never rewrites history.** *This is D-2 — the defect that made focus per-week in the first place — restated for all five horizons, and it is now a property of the goal table rather than of a table that no longer exists.*
  - Its converse binds equally: a past period is **not** read-only for *work*. A task live in a past week can still be completed, unchecked, edited, moved to the backlog or cancelled there (R-task-14, R-nav-5's "still editable" badge, R-lens-11). The redesign closes past periods to plan, never to truth.
- **R-lens-11 (future periods are never styled as late)** ⚠ **modified by the reconciliation pass — the badge names its horizon** — A future period carries a neutral badge naming the horizon — `Future year — planning ahead` · `Future quarter — planning ahead` · `Future month — planning ahead` · `Future week — planning ahead` — and nothing else. It renders in the off-now row (R-lens-21). No carry label, no red chip, no warning and no count may fire on work whose period has not arrived. **The red carry chip is the only escalation in this product** (R-task-11); firing it at a plan would destroy the one signal that means anything. The mechanism is R-task-43's signed age, which is `≤ 0` for work that is not yet due. A past period keeps `Past <horizon> — still editable` (`Past week — still editable`, `Past month — still editable`, …); the current period is unbadged and the off-now row does not render at all.
- **R-lens-12 (the Weekly lens, and what carries into a week)** ⚠ **modified by R-lens-31 (A8) — the lens gains a THIRD section, the month band, below both of these; the two cases below and their rendering are unchanged, and no month task ever appears in either of them** — A **Weekly goal appears in week `W`'s lens iff `periodKey = W` OR it still holds at least one open task visible in `W`** (R-task-7). The two cases render differently and are never mixed:
  1. **This week's plan** — goals with `periodKey = W`, in the ordinary group order (R-lens-5), each showing its title, pulse dot, `planned N weeks ago` when stale (R-goal-43), and its tasks visible in `W`.
  2. **Carried** — goals with `periodKey ≠ W` that still hold open work, rendered **below** the week's own goals in one band, **oldest `periodKey` first**, each labelled with the week it was written for (`from week of 24 Aug`) so it is never mistaken for this week's plan, and each showing only its tasks visible in `W`.

  **No task visible in a week is ever hidden from that week's lens, and no open task is ever without its goal.** This is the surviving half of R-task-9 and D-11 — hiding carried work the moment its goal's week passed would delete the carry mechanic (R-task-7) and lose work silently — and it is the whole of the carry story now: a task carries by remaining visible, its goal carries with it, and **neither involves a write, a prompt, a move operation or a job** (`isVisibleInWeek` is unchanged).
  - **Nothing ages out of the carried band, ever.** A goal with one task open for ten weeks appears in ten consecutive lenses, and that is correct: it is ten weeks of unfinished work and the product should say so every week. The escalation is on the **task** — the red `N weeks` chip, growing (R-task-11) — and it is the only one there is (R-lens-11). An age-out rule would be a second escalation, or worse, a silent disappearance of open work, which is the one thing R-task-7 exists to prevent. The carried band's ordering is the whole ergonomic answer: the oldest thing is always at the top of it.
  - This behaviour is not new. Before A2 a **dormant leaf** with a carried task appeared on the Tasks screen every week for as long as the task stayed open (R-task-9, D-11). What changes is only the name on the container.
  - `+ Task` renders on a Weekly goal whose week is the current one or later (R-task-41), and never on a goal in the carried band — carried work is finished, moved to the backlog or cancelled where it stands; adding *new* work to a past week's goal would be back-dating (R-task-41).
  - ⚠ **A8 — the Weekly lens is no longer the only lens that shows tasks** (R-lens-32); it remains the only lens that shows *week* tasks. Everything the Tasks screen did — the week switcher, completing, unchecking, the three exits, carry labels, backlog pulls — happens here (CR-3).
- **R-lens-16 (a lens read is scoped; the whole tree is never shipped)** — Every lens read is scoped to one horizon and one period and is paginated (Q-12's page cap). **The `GET /goals` "whole tree, flat" read model is retired** (R-rm-5): with a Weekly horizon an account accumulates on the order of a thousand goals a year (R-goal-46, Q-12), and a cold open that ships every goal — plus a client that rebuilds a tree from them and derives leaf-ness with an O(n²) scan — stops working somewhere in the second year, silently and gradually.
  - What replaces it: `GET /goals?lens=<horizon>&period=<periodKey>` returning that lens's items with their resolved `lifeRootId` (R-lens-3), plus the Life goals themselves for the group headers. The Life lens is the only unscoped read and is bounded by the number of Life goals.
  - The **server** resolves each item's Life root, its group and its counts. The client never walks an ancestor chain it does not hold, and must never assume it holds the whole tree.
  - Ancestry for one goal comes from `GET /goals/:id`, which already returns `ancestors` (R-goal-41).
  - ⚠ **the reconciliation pass measured this and R-lens-27 is the result.** The header's own premise — *"at most 500 nodes … so nothing here needs a query"* — was verified false and the cost is worse than the estimate: `GET /goals` is **Θ(n²·d)**, not Θ(n²), because `GoalService.toView` runs `isLeaf` + `descendantIds` + a per-descendant `isLeaf` for **every** goal. Measured: 1.4 M element visits at 395 goals (one year of ordinary use), 845 M and 2.9 s of CPU at 9 755. The named culprit in the delta — "`isLeaf` called from inside `orderedTree`'s walk" — is wrong: `orderedTree` is Θ(n log c) and calls `isLeaf` never. See `docs/work/14-redesign/RECONCILIATION.md` §3.
- **R-lens-13 (the lens switcher)** ⚠ **SUPERSEDED by R-lens-17 (reconciliation pass) — there is no persistent switcher; the title is the control; ⚠ its surviving accessibility clause is GENERALISED by R-nav-31 (A6) — a single tab stop, arrow keys along the axis the list runs, and the selection announced rather than merely coloured, at EVERY picker in the product rather than only in the Zoom sheet** — ~~A five-way control — `Life · Yearly · Quarterly · Monthly · Weekly` — in the Goals screen header, above the period control.~~ The refusal it carried survives verbatim and is restated in R-lens-17 and R-nav-23: **it is not a tab and must never become one** — five lenses in a five-item tab bar leaves no room for capture or Learnings, and the tab bar is a top-level destination switcher, not a zoom. Its accessibility requirements also survive into the Zoom sheet: a single tab stop with `←`/`→` between options (the roving-tabindex pattern R-backlog-22 already requires), and the selected lens announced, not merely coloured.
  - **Why it went.** A permanent five-way strip is a third unconditional row on the screen whose complaint was *"its too clutered"* (R-nav-27); it is 42 characters at 360px; four of its five labels are always wrong; and it treats an ordered scale as five peers. The Zoom sheet costs one tap on a deliberate, infrequent act and carries strictly more information — each row names the exact period it would land on and how many goals are there (R-lens-22), which a five-label strip has no room for.
- **R-lens-14 (every lens, period, goal and task is addressable)** ⚠ **modified by the reconciliation pass — the route shapes are R-nav-24's, amended** — A router is adopted (owner decision 6). **Routes**, each restorable by URL and by back/forward: the lens (`lens` + `period`, one route shape per horizon — R-nav-24), a goal detail page, a **task page** (R-task-45), the Backlog page, Learnings. **Overlays**, not routes, because each is a two-second interaction whose URL nobody wants: the `+` capture drawer, every confirm sheet, the create and edit forms, the period picker. A deep link to a lens+period lands on that lens with that period selected; an unparseable or absent period falls back to the current one rather than erroring.
- **R-lens-15 (no filters, anywhere in a lens)** ⚠ **clarified by R-nav-31 (A6) — a picker's transient search is not a lens filter** — There are no goal-filter pills, no `All` chip, no horizon filter, no pulse filter and no search-as-filter in any lens. Grouping (R-lens-3) is the whole answer. *Retires R-nav-6 and R-nav-7's pill row (R-rm-4).*
  - Every clause here is about **a lens** — a screen — and about **persistent filter state a user has to remember they set**. The goal picker's search field is neither: it lives inside a modal, resets to empty on every open, cannot outlive the choice it was typed for, and adds no parameter to any lens read (S-lens-3-3 untouched). That distinction is the whole argument, and it is stated in R-nav-31 as well as here.

#### Reconciliation pass — the flows the UX plan designed and no rule covered

*Added after `docs/work/14-redesign/UX-PLAN.md` landed. Every rule here answers a flow the UX plan
specifies; the reasoning and the conflicts they resolve are in `docs/work/14-redesign/RECONCILIATION.md`.*

- **R-lens-17 (the lens control is the title)** ⚠ **modified by A4 — the title carries a second line, and its accessible name carries the span (R-lens-28)** — There is no persistent lens switcher. The lens row carries `‹`, the period title, `›`; the title is a **button** that opens the **Zoom sheet** (heading `Change lens`) — a vertical ladder of the five horizons, each row naming the exact period it would land on (R-lens-9) and its count (R-lens-22), the current lens marked `aria-current="true"`, with `Jump to now` in the footer when the selected period is not the current one. *Supersedes R-lens-13.*
  - **Altitude is a vertical idea and time is a horizontal one; the two dimensions never share a widget and never compete for width.** One control per dimension is also what makes D-24 unrepresentable rather than merely guarded against.
  - On the **Life** lens both chevrons render **disabled, not hidden** (`aria-disabled` plus the real `disabled` attribute, described `Life has no periods`), so the control does not change shape between lenses and the thumb lands in the same place every time. A control that vanishes moves everything after it in the tab order.
  - The sheet is the existing `Sheet` (R-nav-15's contract, focus-trapped, `aria-labelledby` its `<h2>`); focus returns to the title button on close. Selection is announced, never merely coloured.
  - The lens title's accessible name is `<Horizon> lens, <period>. Change lens or period.` ⚠ **A4** — `<period>` is now the period's **full** name, `<label> · <weekRange>`, on every lens that has a range (R-lens-28): `Monthly lens, Sep 2026 · Mon 7 Sep – Sun 4 Oct. Change lens or period.` The visible second line is `aria-hidden`, because hearing it twice is worse than not hearing it.
- **R-lens-18 (the zoom anchor)** — The lens shell holds one **anchor date** for the session, and R-lens-9 maps it into each destination period.
  - **Cold start:** the server's today in the owner's timezone (R-auth-5), never the device clock.
  - **Stepping** the period with `‹`/`›` moves the anchor to the **first day of the newly selected period**, unless today falls inside it, in which case the anchor is today.
  - **Zooming never moves the anchor.** That is what makes zoom lossless and reversible: `Q3 2026` → Monthly → Quarterly returns to `Q3 2026`, always. A rule where it did not is a rule where zooming loses your place.
  - **Life is not a reset.** Life has no period, and the anchor survives it untouched, so going up to Life and back down returns you where you were. The naive design — Life clears the period, so coming back means today — would make the one lens with no time dimension silently destroy your position.
  - The anchor is session state; it is not persisted across a cold start (R-lens-8, R-nav-28).
- **R-lens-19 (group rendering: collapse, suppression, and what is not drawn)** ⚠ **generalised by R-nav-31 (A6) — the suppression rule is the goal picker's too: one non-empty group needs no header, on either surface** — The group header is one `S.sectionLabel` row: `▾ <LIFE GOAL TITLE> · 3 OPEN` (R-lens-4's count).
  - **The whole row is the collapse toggle**, with a `▾`/`▸` glyph and no separate chevron button, carrying `aria-expanded`. Default expanded. Collapse is **session-scoped and per-lens, never persisted** — a collapsed group that survives a restart is a hidden goal.
  - This is per-**group** collapse and is **not** the per-**node** expansion R-lens-1 forbids. Stated explicitly so R-lens-1 is not read as a ban on it.
  - **A group with no items in the selected period is not rendered** (*retires R-lens-6's empty-group clause*). A lens is not a roster.
  - **When a lens has exactly one group, the header does not render at all.** There is nothing to disambiguate, and a header over the only group names the card beneath it — so a single-Life-goal account never sees a group header anywhere in the product.
  - Collapsing a group in the Weekly lens hides that line's tasks. That is what collapse means; it is session-only, so nothing stays hidden.
  - **Order** is R-lens-5's, unchanged: the Life goals' own order, never by count — a list that reorders itself when you tick a checkbox is a list you cannot build muscle memory for. **No cap, no pagination and no "show more" on groups**; collapse is the pressure valve.
- **R-lens-20 (`UNSORTED`)** — A goal whose ancestor chain does not reach a Life goal — a dangling `parentId`, a cycle (R-lens-3's cycle-safe walk), or a migration that could not attach it — groups under **`UNSORTED`**, pinned last, with the line `These aren't under a Life goal yet.` *Renames R-lens-3's `Unattached`;* `Unsorted` is live product vocabulary (R-learning-2/3) and survives Ideas' deletion (R-rm-1).
  - The group carries **no count** and is **never collapsed by default**.
  - Each item gains one extra action, `Put under a Life goal…`, opening the existing Move sheet with the Life goals pre-listed.
  - **This state is not reachable through the product**: R-goal-4 and `checkCreate` refuse a parentless non-Life goal, so a root-less goal is a data-integrity fact, not an ordinary one. It must surface rather than silently drop a row from a view.
- **R-lens-21 (the off-now row)** ⚠ **modified by A4 — the row gains a second, mutually exclusive occupant (R-lens-29)** — When, and only when, the selected period is not the one containing today, one conditional row renders below the lens row: R-lens-11's badge on the left and a **`Now ›`** link button on the right.
  - It is the escape hatch unbounded forward navigation requires (R-lens-7): without it, fourteen months out is fourteen taps home.
  - The current period is unbadged and the row does not render, which is what keeps the shell at two unconditional rows (R-nav-27).
  - ⚠ **A4** — on the current period the same row may instead carry R-lens-29's `This week is in <period>`. The two conditions are complements (`not current` / `current`), so the row still has at most one occupant and the shell still has two unconditional rows.
- **R-lens-22 (the Zoom sheet's counts)** ⚠ **modified by A4 — each row also carries its period's span (R-lens-28)** — Each Zoom-sheet row shows the number of **goals** at that horizon in the period that row would land on; the Life row reads `everything`. A zero count is omitted, not rendered (the app already omits zero counts).
  - **It is one read, not five.** A single grouped query over `ix_goals_lens` — four horizon/period seeks plus the Life count — serves the whole sheet. It must never be five lens reads and must never fetch rows in order to count them (R-lens-27).
  - It counts goals and nothing else. It is the only count in the sheet, and it is what makes the promise "you see the destination before you commit" true.
- **R-lens-23 (the parent line on an item)** — An item in a lens shows its **immediate parent** as one muted line — `under Run a sub-2h half marathon in 2026` — **unless that parent is the group's own Life goal**, in which case nothing renders.
  - It renders on Quarterly, Monthly and Weekly items. A Yearly item's parent is always its group's Life goal, so it never renders there; a Life item has no parent. Where a Monthly goal hangs directly off its Life goal (R-goal-32 permits it) the same suppression applies.
  - The line is a **button** opening that parent's detail page: the only way to walk *up* one step without a tree. You can never walk *down* into a subtree, which is the thing that was cluttered.
  - `T.mut` at 12.5px, and **never** `faint`, which fails AA in both themes and may not carry anything load-bearing.
  - **At most one name.** The full breadcrumb path is the tree wearing a different hat (R-lens-1); today's Tasks screen prints the entire path on every section, and this prints one.
- **R-lens-24 (the third empty state — a lens empty at every period)** — When the account has Life goals but no goals at this horizon in **any** period, the lens shows a horizon-level empty state instead of the period-level one, because `Q3 2026 is unclaimed` misleads someone who has never opened the Quarterly lens at all.

  | Lens | Headline | Body | Action |
  |---|---|---|---|
  | Yearly | *Nothing yearly yet.* | A Life goal is the direction; a yearly goal is this year's version of it. | `+ Yearly goal` |
  | Quarterly | *Nothing quarterly yet.* | A quarter is long enough to change something and short enough to finish. | `+ Quarterly goal` |
  | Monthly | *Nothing monthly yet.* | Months are where a quarter turns into something you can actually do. | `+ Monthly goal` |
  | Weekly | *Nothing weekly yet.* | Weekly goals are where tasks hang. Pick a monthly goal and give this week something concrete. | `+ Weekly goal` |

  *Extends R-lens-6, which had two states and needed three.* The period-level and past-period states are unchanged, and a **past** period still carries no CTA (R-goal-36).
- **R-lens-25 (one gesture, and its keyboard equal)** — A **horizontal swipe** on the lens body steps the period, mirroring the chevrons' direction (left-to-right = earlier).
  - It is an **accelerator, never a route**: the chevrons are always present and never hidden.
  - Suppressed on the Life lens, which has no periods, and inside any horizontally scrolling child, so it cannot fight a scroller.
  - **There is no vertical swipe.** Vertical is the scroll axis, and a gesture that competes with scrolling on a phone is a gesture that fires when you did not mean it.
  - Keyboard, as documented convenience only: `←`/`→` step the period and `Shift+↑`/`Shift+↓` change altitude by one, from anywhere in the lens body, documented in the Account sheet. Every one of them has a visible control one `Tab` away, so the accessibility floor never depends on a shortcut.
- **R-lens-26 (the forward-content marker)** — The forward chevron carries a **dot** when any later period at this horizon holds at least one goal, or at least one task originating in it. *Replaces R-lens-7's picker dot, which no longer has a picker to live in (R-lens-17).*
  - Without it, a goal written three months out is invisible from every screen except that month's — R-nav-18's reason, and unbounded forward creation (R-goal-36) makes it far more likely than it was.
  - One dot, no new control, no row, and no number: it says *there is something ahead*, never how much.
- **R-lens-27 (no read loads the whole goal list)** — Extends R-lens-16 from the wire to the server. **No request may call a repository method that returns every goal.**
  - A **lens read** is one horizon and one period, paginated at `MAX_PAGE` (R-lens-16).
  - **Grouping, the Life-root walk (R-lens-3) and the parent lines (R-lens-23)** read the **interior tree** — every goal whose horizon is not Weekly — once per request, indexed by id. The interior set grows with the *plan*, not with use: roughly one Yearly, four Quarterly and twelve Monthly goals per line per year, so it is bounded where the Weekly rows are not.
  - A **create guard reads one row** (the parent — `checkCreate` compares two ranks and needs nothing else); a **move or delete guard reads one subtree** (a recursive CTE, and **zero rows when the moved goal is Weekly**, which is terminal — R-goal-31). Both run only on a write.
  - `assertWeeklyGoal` reads **one row**: `horizon = 'Weekly'` (R-goal-39), never leaf-ness (R-goal-37), so it needs no tree at all.
  - `IGoalRepo.listAll` is **deleted**, not left unused — an unused whole-table read is one refactor away from being a used one, and the R-rm-* discipline exists for exactly this.
  - The index this requires is `ix_goals_lens (user_id, horizon, period_key, created_at, id)`; it does not exist today. See `docs/work/14-redesign/RECONCILIATION.md` §3 for the measurements, the query shapes and the migration note.

#### Amendment 4 — a period's label says what it spans

*The owner opened the Monthly lens on Tue 1 Sep 2026, read `Sep 2026`, and could not find the week they were living in: **"why is Sep 2026 this month? look the last Month week hadn't completed yet? is this right or wrong? this is confusing, i think for monthly we need to note it as a range."** It is right. **The model does not change** — ★C-19 settled it, and the alternative made one week belong to two months and put three consumers in disagreement. What was wrong is the label, which promises a calendar month and delivers four whole weeks.*

- **R-lens-28 (a period's label is its name AND its span)** ⚠ **modified by A5 — the client formats both halves; the wire fields stay as the reference it is checked against (R-lens-30)** — Every period-scoped lens except **Weekly** renders, beneath the title, the **whole weeks the period contains**: `Sep 2026` over `Mon 7 Sep – Sun 4 Oct`. The pair is one string wherever a line break cannot carry it — `Sep 2026 · Mon 7 Sep – Sun 4 Oct` — which is the title button's accessible name and the live region's announcement.
  - **The span follows from R-goal-33 and nothing else.** A week is keyed by its **Monday**, so a period holds exactly the weeks whose Monday falls inside it: the first is the first such Monday and the last runs to that Monday's Sunday. `Sep 2026` is therefore the four weeks beginning 7, 14, 21 and 28 Sep — it excludes the week of Mon 31 Aug and ends four days into October. This is the broadcast-calendar convention, and its rule is that the range is published **beside** the name and never instead of it.
  - **Years appear only when the two ends disagree about one** — `Mon 7 Dec 2026 – Sun 3 Jan 2027`, where the title's own `Dec 2026` cannot disambiguate the far end. A Yearly range always spans two calendar years and therefore always prints both.
  - **The Weekly lens is exempt, and that is a finding rather than an omission.** `Week of 31 Aug` names a specific Monday and a week is unambiguously the seven days from it, so the label is already honest; a range beneath it would restate the title, which is chrome (R-nav-27).
  - **It is computed once, server-side** (`PeriodView.weekRange`, `ZoomRowView.weekRange`) and rendered by the client, because the client holds no Monday rule and must not acquire one (D-1). The Zoom sheet carries it on every row, where the promise is that you see the destination before you commit (R-lens-22).
  - **It is a second LINE, never a second ROW** (R-nav-27). It sits inside the existing title button, carries no control, no tap target and no tab stop, so the shell still has exactly two unconditional rows. It could not go on the first line: at 21px `Sep 2026 · Mon 7 Sep – Sun 4 Oct` is 32 characters and ellipsises the range away at 360px, and a half-shown range is a wrong one.
- **R-lens-29 (when the current period does not hold the current week, the lens says so)** ⚠ **R-lens-21's row gains a second occupant; R-lens-8's default deliberately does NOT change** — When the period on screen is the **current** one (R-goal-34) and still does not contain the week containing today, one conditional row renders: a muted pill reading `This week is in <period>` and a link to that period.
  - **It fires for the opening days of a period and no other time**, at any horizon: on Tue 1 Sep 2026 the Monthly lens shows it; on Fri 1 Jan 2027 the Yearly, Quarterly and Monthly lenses show it at once, because that week began Mon 28 Dec. It can never fire on Weekly — a week holds its own week — or on Life, which has no period.
  - **It takes R-lens-21's row and adds none.** The off-now row renders only when the period is *not* current and this renders only when it *is*, so the two are mutually exclusive by construction and the conditional row has two occupants. A screen showing both would be the third unconditional row R-nav-27 refuses.
  - **It is not an escalation.** Same pill, same muted grey, same register as the badge it replaces. A period that legitimately begins next week is a fact about the calendar, not a problem with the plan (R-lens-11).
  - **The jump names the period explicitly** — the key the server sent, not "the current period", which would ask for the one already on screen and land straight back.
  - **Why R-lens-8 is unchanged.** Defaulting the Monthly lens to the period holding the current week would open it, on 1 Sep 2026, on `Aug 2026` — a period the same payload calls `isPast`, which removes every create affordance (R-goal-36, R-nav-25) and badges it `Past month — still editable`. Landing somewhere you cannot plan is worse than landing somewhere honestly labelled, so the label and the flag carry the weight and the default stays the calendar period.
  - **The wire states the fact unconditionally; the client decides when to say it.** `PeriodView.currentWeekPeriod` is populated on every period that does not hold the current week and is `null` when it does; the "only on the current period" clause is the UI's, so no chrome decision lives on the server.
  - An **agent** reads the same two fields (`week_range`, `current_week_period`) on `list_lens` and `get_period`, and the server-instructions block teaches them, because an agent reasoning about "September" meets exactly the ambiguity the owner did.
- **R-lens-30 (the lens header never waits, and the calendar is shared vocabulary)** ⚠ **A5, new — this is the client-side half of R-goal-34, and it MODIFIES R-lens-28's "server-side" clause** — The period's **label**, its **range**, whether it is **current** or **past**, and **which period holds the current week** are rendered from local period arithmetic and repaint **in the same frame as the input that changed them**. No lens header may render a placeholder where a period name goes. **`…` is never a label.**
  - **The calendar lives in `packages/shared/src/calendar/` and BOTH sides import it.** Every field of `PeriodView` except `hasWork` is a pure function of `(horizon, periodKey, today)`, and the server answers `{ ...periodViewOf(horizon, key, today), hasWork }` while the client calls `periodViewOf` directly. There is no second rendering of `isPast` anywhere in the repo.
  - **The rule this replaces was half true, and that is worse than false.** Five doc blocks said the client *"holds no Monday rule"* and *"there must not be one"*. The rule they were reaching for is: **the client may not hold a *second* implementation of a date rule; it may import the *only* one.** What R-auth-5 forbids is deriving a week boundary from the **device clock** — not from the owner's stored timezone through the same function the Worker calls.
  - **`label` and `weekRange` need no clock at all.** They are pure functions of `(horizon, periodKey)`, so `/month/2026-09` renders `Sep 2026 · Mon 7 Sep – Sun 4 Oct` on the first paint of a cold, offline, preference-less open. Only `isCurrent`, `isPast` and `currentWeekPeriod` consult `today`, and those are **badges, not the title**: until the owner's timezone is known they render as **nothing, never as a wrong guess**.
  - **The owner's `today` is the stored account timezone applied to the SERVER's clock** — never the device zone and never the device clock (R-auth-5, S-auth-5-1). The fallback ladder is: the stored `preferences.timezone`, else the same value from the persisted per-user query cache, else **`'UTC'`** — matching `isValidTimezone`'s contract and the server middleware, and deliberately **not** the device zone, which is precisely the traveller disagreement R-auth-5 exists to prevent.
  - **The day is re-checked, because an installed PWA can sit open for days.** `today` is an external store recomputed on a re-arming timer, `visibilitychange`, `focus`, `online` and every `serverNow`, and on a change it invalidates the reads whose meaning depends on the date. A period's *identity* does not change at midnight; its *status* does, and without this the client would keep offering `+ Weekly goal` on a week that became past, for the write to be refused `PERIOD_IN_PAST` with no visible cause.
  - **Three anti-drift layers, and the third is the one a shared module cannot provide.** (1) **One module** — there is no second implementation left to disagree. (2) **One hand-written boundary fixture table**, checked independently by an api test and a web test that do not import each other's code. (3) **A runtime echo assertion** — the server keeps sending `PeriodView` on every read and the client compares it, field by field, against the view it computed **for that response's own `serverNow`**; a mismatch **throws in dev and test**, and in production **warns once and defers to the server**. A shared module cannot drift, but a shared module plus a client bundle older than the Worker can, and only a runtime comparison catches that. Comparing on the response's own instant is what distinguishes **version skew** (wrong when it was made) from **staleness** (right when it was made), which is an ordinary race the invalidation repairs.
  - **The server stays authoritative for everything the calendar cannot answer** — `hasWork`, `hasForwardContent`, `hasAnyAtHorizon` and every count — and none of those is on the critical path of a header. The forward-content dot therefore lags on an uncached period, which is correct: it answers "is there anything ahead", a question about data.
  - **A lens read carries an explicit canonical `periodKey`, and `null` only for Life.** The route resolves the period **before the first render that fetches**, so opening a lens is **one** request. It used to be two: the read went out with no period, the answer landed, the screen rewrote the URL, the query key changed, and a second `GET /goals` and a second loading state followed.
  - **`stepPeriod` gains the FORMAT's own edge, and no product bound.** Neither chevron is ever disabled (R-lens-7, R-goal-36, R-rm-3). But a `PeriodKey` is at most ten characters and a year is `\d{4}`, so a step out of 1000-01-01 … 9999-12-31 returns the input unchanged rather than a key nothing can parse — reachable by a fling once the header repaints instantly, and answered `422` before.


#### Amendment 8 — the month band, and the Monthly lens shows work

- **R-lens-31 (the month band — a week shows its month's tasks, and never styles them)** — The Weekly lens for week `W` renders a **third section**, below this week's plan (R-lens-12 case 1) and below the carried band (case 2): the **month band**, headed `THIS MONTH` and holding the month tasks of **the month `W` belongs to**, grouped by their Monthly goal.
  - **Which month is R-goal-33's Monday rule and nothing else.** On 2 Sep 2026 the Weekly lens is at the week of Mon 31 Aug, so its month band is **August's**. It is the same rule that makes `Sep 2026` run 7 Sep – 4 Oct (R-lens-28) and the same rule R-lens-29's `This week is in Aug 2026` already tells the owner about. One rule, said once more.
  - **It carries no carry label, no chip, no gray line and no badge** (R-task-54). A month task that is not done in week 2 is not late in week 2. The band's own heading says everything the position needs to: this is the month's work, and the deadline is the month.
  - It is **collapsible as a whole**, session-scoped and per-lens, exactly as the carried band and the groups are (R-lens-19, Q-21). It renders only when the month holds at least one visible month task, like every other section in the product.
  - Its rows are ordinary `TaskRow`s: checkbox (R-task-55's bound, in the **month's** scope), title, done-condition, measure. Tapping one opens the same task page.
  - **`+ Task` renders at the band's foot** and creates a month task on the chosen Monthly goal (R-task-57 a), on the current or a later month. Each of the band's Monthly-goal sub-headings also offers `Park in a week` on its rows (R-task-56).
  - **A month task is never counted in R-lens-4's group header, at any lens.** That number answers *"what is on me this week"*, and a month task is precisely the work this amendment exists to say is **not** on you this week. Counting it there would contradict the no-late-styling rule one row above it, in a number. *Amends R-lens-4: the count is week tasks only.*
  - **It sits last, deliberately.** A week's own plan is what the week is for; the month band is the answer to *"if I don't do it this week, that's fine — the deadline is the end of the month"*, and answering that above the week's own plan would invert the two.
- **R-lens-32 (the Monthly lens shows tasks)** — A Monthly goal's card, in the Monthly lens and on its detail page, renders **its month tasks** — those visible in the selected month (R-task-53) — nested inside the card under a hairline, exactly as a Weekly goal's card nests its week tasks (R-lens-12 case 1). *This is the surface the owner asked for: "in my monthly view i can see the tasks that is part of this month."*
  - **It is the only lens change A8 makes.** Yearly, Quarterly and Life cards show no tasks, because those horizons hold none (R-task-51).
  - The card's link row is unchanged in shape and both of its actions are simplified: `+ Task` creates a month task here (R-task-57), and `Pull from backlog` offers this goal's own backlog (R-backlog-31). Neither resolves a week any more.
  - **A carried month task appears in the month it has carried into**, in the ordinary list, with R-task-54's chip. There is **no carried band in the Monthly lens**: a month task carries onto the same goal, so there is nothing to separate it from — unlike a Weekly goal, which is a *different* goal from the one the week belongs to. Stated because its absence would otherwise read as an omission.
  - R-goal-47's planned-ness line is unchanged in what it counts and now renders **beneath** the task list, with its new `No weeks yet` case (R-goal-47, amended).
  - **A past month renders its tasks and no create affordance** (R-goal-36, R-nav-25), and a past month's tasks stay fully interactive, including completing one (R-lens-10).

### ~~Plan (weekly focus)~~ ⚠ **A2 — RETIRED IN FULL (R-rm-2, R-rm-3)**

Every rule in this section describes the `weekly_focus` entity and the plan screen, both of which are deleted. Two fragments survive and were moved: the backlog pull list (R-plan-9/10 → R-backlog-28) and the staleness line (R-plan-19 → R-goal-43). Nothing else here may be implemented.

- **R-plan-1** ⚠ **RETIRED by A2 (R-rm-2) — the `weekly_focus` entity is deleted** — A weekly focus is one sentence per non-Life leaf per week, written on the Weekly-planning screen. (BUSINESS-RULES §Weekly focus bullet 1.)
- **R-plan-2** ⚠ **RETIRED by A2 (R-rm-2/R-rm-3)** — Planning edits the **current week only**. `Edit plan` appears in the Tasks header only when the viewed week is 0, and saving the plan returns to the Tasks screen at week 0. (`TasksScreen.tsx` `w === 0 &&`; `store.savePlan` sets `view:'home', viewWeek:0`.)
- **R-plan-3** ⚠ **RETIRED by A2 (R-rm-2/R-rm-3) — there is no plan screen** — The planning screen lists every non-Life leaf, grouped by Life root, with a Life-goal filter chip row (`All` + one chip per life goal). Screen copy: "Check the branches that are active this week, one focus sentence each. Unchecked branches go dormant." (`PlanScreen.tsx`.)
- **R-plan-4** ⚠ **RETIRED by A2 (R-rm-2)** — A leaf's checkbox is pre-checked iff it is currently active; its textarea is pre-filled with the current focus. Placeholder: `This week's focus — one sentence`. (`store.planChecked` / `planDraft`.)
- **R-plan-5** ⚠ **RETIRED by A2 (R-rm-2)** — Checking a leaf activates it **only if a non-empty focus sentence is supplied**; checked-with-blank-sentence saves as no focus (dormant). The client must surface this rather than silently dropping the check. (`store.savePlan`: `checked && draft.trim() ? draft.trim() : ''`; §5 D-9.)
- **R-plan-6** ⚠ **RETIRED by A2 (R-rm-2)** — Unchecking a leaf clears its focus for the week → the leaf becomes dormant. Its existing open tasks are **not** deleted (R-task-9).
- **R-plan-7** ⚠ **RETIRED by A2 (R-rm-2)** — Save-plan is a whole-week replace over all non-Life leaves in one transaction: leaves checked with text get/keep a focus; every other non-Life leaf's current-week focus is removed. (`store.savePlan` maps all leaves.)
- **R-plan-8** ⚠ **RETIRED by A2 (R-rm-2)** — Non-leaf and Life goals are never touched by save-plan and can never hold a focus.
- **R-plan-9 (pull-based planning)** ⚠ **superseded by R-backlog-28 (A2) — the pull list survives, on a goal detail page** — Under each checked leaf, a `FROM THE BACKLOG` list shows every backlog item whose `goalId` is the leaf itself or any of its ancestors (excluding the Life root, which cannot hold items). Tapping one opens the task-create modal pre-filled with the item's title and bound to that leaf. (`PlanScreen.tsx` `chainIds = [l.id, ...ancestors]`.)
- **R-plan-10** ⚠ **superseded by R-backlog-28 (A2)** — The backlog list is hidden for unchecked leaves and when the pool is empty.
- **R-plan-11** ⚠ **RETIRED by A2 (R-rm-2)** — Saving the plan shows the toast `Plan saved`; when the week saved is not the current week the toast names it: `Plan saved for week of <Mon d Mon>`.
- **R-plan-12** ⚠ **RETIRED by A2 (R-rm-2)** — Draft check-state and draft sentences are client-local until Save; leaving the screen without saving discards them.

#### Amendment 1 — several sentences, and weeks you can plan ahead

- **R-plan-13 (several focus sentences per leaf per week)** ⚠ **RETIRED by A2 (R-rm-2) — multiplicity is now several Weekly goals under one parent (R-goal-31)** — A non-Life leaf may hold **one to five** WeeklyFocus rows for a given week. Each row is one sentence, non-empty after trim; a blank sentence still means the row must not exist (§1). Zero rows = dormant (R-goal-10). Five is the cap (Q-12): a focus is an intent, and a leaf that needs a sixth is writing a task list into the plan. *Supersedes R-plan-1's "one sentence".*
- **R-plan-14 (order of the sentences)** ⚠ **RETIRED by A2 (R-rm-2)** — Within a leaf and a week, sentences are ordered by `sortKey` ascending, then `createdAt` ascending, then `id` ascending — total and stable, never storage order (Q-7). `sortKey` is a 0-based integer the server assigns from the entry's position among **that goal's** entries in the plan save; re-ordering is a re-save. Every single-line surface renders the **first** sentence (R-nav-21).
- **R-plan-15 (the plannable window)** ⚠ **superseded by R-lens-10 + R-goal-36 (A2) — the past-period half survives; the forward cap is removed** — The plan is writable for the current week and the next `PLAN_AHEAD_WEEKS = 4` weeks — offsets `0 … +4` inclusive. A plan write naming any other week is refused with `WEEK_NOT_PLANNABLE`, wholesale, never partially applied. Past weeks are readable and never writable: history stays truthful (D-2), which is the bug that made focus per-week in the first place.
  - The bound is **validation, not a picker clamp**, and that is the asymmetry with history. The 8-week history bound (R-nav-4, Q-13) limits a *control* over weeks that already exist; anything older is still addressable by naming its `weekStart`. Every week inside the forward window is a week a write would *create*, so the forward bound is enforced at the schema and refused at the edge.
  - Four, not eight: the stated need is to lay out a month, and the current week plus four covers 35 days — any calendar month from any starting weekday. Staleness scales with distance (R-plan-19), so each extra week doubles down on plans that can rot; and beyond a month the product's own unit is the goal's `period` and Re-plan (R-goal-22/23), not a weekly focus.
- **R-plan-16 (whole-week replace, one named week)** ⚠ **RETIRED by A2 (R-rm-3) — there is no plan save** — A plan save names exactly one plannable `weekStart` and replaces the focus set **for that week only**, in one transaction, over all non-Life leaves. Entries carry an optional `id`: an entry with an `id` updates that row in place and **keeps its `createdAt`**; an entry without one inserts; every focus row for that week not named by an entry is deleted. `sortKey` is re-assigned from entry order on every save. Entries may repeat a `goalId` — that is how a leaf gets several sentences — and their relative order in the request is their order in the week. Focus rows for *other* weeks are never touched. *Supersedes R-plan-7.*
  - Preserving `createdAt` across an update-in-place is load-bearing: delete-and-recreate would reset the age of every sentence on every save and make R-plan-19 unimplementable.
- **R-plan-17 (the plan screen plans one week)** ⚠ **RETIRED by A2 (R-rm-3)** — The planning screen names the week it is planning and carries its own week control spanning `0 … +4`. It never offers a past week. Saving returns to the Tasks screen **at the week that was planned**, not at week 0. *Supersedes R-plan-2's return behaviour.*
- **R-plan-18 (per-leaf sentence editor)** ⚠ **RETIRED by A2 (R-rm-2)** — Under each leaf the screen renders that week's sentences as an ordered list of fields, each individually removable, with `+ Add another focus` up to the cap. The leaf's checkbox is checked iff it holds at least one non-blank sentence. Blank fields are discarded on save without failing it; a *checked* leaf whose fields are all blank is R-plan-5's case and must be surfaced, not silently dropped (D-9). *Supersedes R-plan-4.*
- **R-plan-19 (a plan can now go stale, and says so quietly)** ⚠ **superseded by R-goal-43 (A2) — the staleness line survives, on a Weekly goal** — For a focus row, `plannedAgeWeeks = weeksBetween(weekStartOf(updatedAt), weekStart)`. Once the row's week has **arrived** (its offset is `≤ 0`), a row with `plannedAgeWeeks ≥ 2` renders a muted line `planned <N> weeks ago` beneath its sentence, on the Plan screen and in the Tasks screen focus block. Muted text only: never a chip, never coloured, never blocking. A plan written last week for this week (age 1) is ordinary planning and carries no label. A week that has not arrived yet carries no label either — it is not stale, it is early. This is the R-goal-24 quiet-signal pattern and it is the entire answer to "should a three-week-old plan be distinguishable": yes, and by one muted line.
- **R-plan-20 (an arrived plan is just the plan)** ⚠ **superseded by R-goal-44 (A2)** — When a planned week becomes the current week, nothing is asked of the user and nothing is written. The plan is editable because it is now the current week (R-plan-15), not because it was re-confirmed. An arrival prompt, a staleness confirmation, or a "still relevant?" step is a review wizard and is out of scope — it must be refused, not deferred (R-nav-14).

### Task

- **R-task-1** ⚠ **superseded by R-task-39 (A2) — a task hangs off a Weekly goal, not off a focus** — A task lives under an active non-Life leaf's weekly focus, referenced by `goalId`. (BUSINESS-RULES §Task bullet 1.)
- **R-task-2 (creation sources — four)** ⚠ **superseded by R-task-41 (A2) — three sources; the Idea source is deleted** — (a) `+ Task` on the Tasks screen or a goal's focus block, (b) a Backlog pull, (c) an Idea's "Task this week", (d) the `+` drawer with "Also add to the current week". (BUSINESS-RULES §Task bullet 1; `store.openTaskCreate` / `saveBacklogDrawer`.)
- **R-task-3** — Fields: `title` required; `cond` (done-condition) **optional**; `desc` and `links` optional. The create modal's hint reads "Done-condition (optional) / How will you know it's done?". (`TaskCreateModal`.)
- **R-task-4** ⚠ **superseded by R-task-41 (A2) — the target selector lists Weekly goals for the target week** — The create modal's target selector lists **only leaves active in the target week**, labelled `<Life root title> — <first focus sentence>` with `+N more` when the leaf holds several. Creating a task is impossible when no leaf is active. (`TaskCreateModal` `options = s.activeLeaves()`; §5 D-10.)
- **R-task-5** ⚠ **superseded by R-task-34** — `originWeek` is always the **current** week at creation time, regardless of which week is being viewed. It is server-assigned and immutable thereafter. (`store.saveNewTask` `originWeek: 0`.)
- **R-task-6** ⚠ **superseded by R-task-34** (the no-back-dating half survives verbatim) — Tasks can only be created into the current week; there is no back-dating. The `+ Task` affordance is rendered only when the viewed week is 0 and the leaf is active. (`TasksScreen.tsx`.)
- **R-task-7 (visibility, open)** — An **open** task is visible in every viewed week `w` with `w ≥ originWeek`. It carries forward automatically with no prompt, wizard, or confirmation. (`store.visibleIn`: `t.originWeek <= w`.)
- **R-task-8 (visibility, done)** — A **done** task is visible **only** in `doneWeek` — not in earlier weeks it was open in, not in later weeks. (`store.visibleIn`: `t.doneWeek === w`.)
- **R-task-9** ⚠ **superseded by R-lens-12 (A2) — the surviving rule is that no task visible in a week is ever hidden** — Task visibility does not depend on whether the owning leaf is currently active; a dormant leaf's open tasks remain visible and interactive in the weeks they belong to. Dormancy suppresses the *empty* section and the `+ Task` affordance, not existing work. (§5 D-11.)
- **R-task-10 (carry label, 1 week)** ⚠ **modified by R-task-43 (A2) — the age formula is signed; the 1-week threshold is unchanged** — In the viewed week, `age = w − originWeek`. At `age === 1` an open task shows a gray label `since Mon 24 Aug` (the Monday of `originWeek`). (`TaskRow.tsx`, `ui.ts:carryLabel('gray')`.)
- **R-task-11 (carry label, 2+ weeks)** ⚠ **modified by R-task-43 (A2) — the ≥2-week threshold is unchanged** — At `age ≥ 2` an open task shows a **red chip** `N weeks · since 10 Aug`, where `N = age`. This is the only escalation in the product: no popups, no nags, no flags. (`TaskRow.tsx` `sev = age >= 2 ? 'chip' : 'gray'`.)
- **R-task-12** ⚠ **modified by R-task-43 (A2) — no label at age ≤ 0** — At `age === 0`, and for any done task, no carry label is shown. (`showCarry = !t.done && age >= 1`.)
- **R-task-13 (exits — exactly three)** — A task leaves a week in exactly one of three ways: **Complete**, **Move to Backlog**, **Cancel**. There is no fourth exit and no "defer", "snooze", or "reschedule". (BUSINESS-RULES §Task Exits.)
- **R-task-14 (exit: complete)** ⚠ **clarified by R-task-35** ("any viewed week" has always meant any week up to the current one; future planning makes that guard reachable) — The checkbox completes a task in **any** viewed week, including past weeks; past weeks stay fully interactive. Completing sets `doneWeek = the viewed week`, `doneAt = now`, logs `Completed`. (`store.toggleTask`; §5 D-4 on the label.)
- **R-task-15 (exit: move to backlog)** ⚠ **modified by R-backlog-29 (A2) — "the owning goal" is now a Weekly goal, which may hold no backlog; the item lands on its nearest non-Weekly ancestor** — Moves the task out of the week into the **owning goal's** backlog as a new BacklogItem carrying over `title`, `desc`, `links` and `fromWeek = the week it was live in`, then removes the task from the week. Confirm sheet takes an **optional** reason. Toast: `Moved to Backlog` (`— reason noted` appended when a reason was given). (`store.confirmAction` moveTask; §5 D-12 on `fromWeek`.)
- **R-task-16 (exit: cancel)** — Drops the task. Confirm sheet takes an **optional** reason. Toast: `Task canceled`.
- **R-task-17** — Move and Cancel are offered only on **open** tasks; the detail sheet hides both once the task is done. (`TaskDetailSheet` `{!dt.done && ...}`.)
- **R-task-18** — Neither Move nor Cancel may require any field. The confirm sheet states "No mandatory fields. Fast and guilt-free."
- **R-task-19 (uncheck)** — Unchecking a completed task, in any week, sets `doneWeek = null`, `doneAt = null`, `done = false`, keeps `originWeek` unchanged, and logs `Unchecked`. The task is immediately open again and therefore carries into the current week under its **original** origin — with the carry label its original age earns (R-task-10/11). (BUSINESS-RULES §Task bullet on Unchecking; `store.toggleTask` else-branch.)
- **R-task-20** ⚠ **modified by A2 — "does not require the owning leaf to be active" is vacuous; the substance (no re-parent, no goal write) is unchanged** — Unchecking does **not** re-parent the task, does not touch the owning goal, and does not require the owning leaf to be active.
- **R-task-21 (uncheck follow-up)** — After an uncheck, an inline, **skippable** prompt `Update the done-condition?` appears under the row, pre-filled with the current condition, with `Save` and `Skip`. Skipping is a no-op; saving an unchanged or blank value is also a no-op. Saving a changed value logs `Done-condition edited`. (`TaskRow.tsx`, `store.saveUncheck`.)
- **R-task-22** ⚠ **superseded by R-task-45 (A2) — the detail sheet becomes a routed page** — The task detail sheet shows the goal path, the done date when done, editable `title` / `cond` / `desc`, the links list with add and remove, the exits when open, and the read-only activity timeline.
- **R-task-23** ⚠ **modified by R-task-45 (A2) — "detail sheet" reads "task page"; the dirty/save behaviour is unchanged** — The `Save changes` button in the detail sheet appears only when a field is dirty; saving shows toast `Task updated`. A blank title falls back to the existing title and logs nothing. (`TaskDetailSheet` `dirty`; `store.saveTaskDetail`.)
- **R-task-24** — Adding a link appends `{url}` and logs `Link added: <host>`, where host is the URL's hostname minus a leading `www.`, falling back to the raw string truncated to 28 chars + `…` when unparseable. (`utils/tree.ts:hostOf`.)
- **R-task-25** — Removing a link removes it by index and logs `Link removed: <host>`. (`store.removeTaskLink`; event added by §5 D-13.)
- **R-task-26** — Done tasks remain editable (title, condition, description, links); only the exits are withdrawn.
- **R-task-27 (truncation in events)** — Values interpolated into event text are truncated: empty → `(none)`; longer than 24 chars → first 24 chars + `…`. (`utils/tree.ts:trunc`.)
- **R-task-28** — Task rows render title, `Done when: <cond>` when a condition exists, `Done <date>` when done (with the title struck through and muted), and the carry label when applicable.
- **R-task-29 (auto-carry log)** ⚠ **modified by R-task-38** (never logged for a week that has not arrived) — When an open task first becomes visible in a week later than its origin, a `Carried to week of <Mon d Mon>` entry is logged once per week crossed. This is automatic; the user is never prompted. (BUSINESS-RULES §Task Activity; mock data `t3`; §5 D-14 — no code produces it.)
- **R-task-30 (activity timeline — the complete set)** ⚠ **modified by R-task-46 (A2) — the `Created — from an Idea` row is retired and the planning row is renamed** — The timeline is read-only, newest first, and can contain exactly these entries:

  | Entry | Glyph | Trigger |
  |---|---|---|
  | `Created — weekly planning` | ＋ | Task created from the planning screen or a `+ Task` affordance. |
  | `Created — pulled from Backlog` | ＋ | Task created by converting a backlog item (R-backlog-6). |
  | `Created — from an Idea` | ＋ | Task created from an Idea's "Task this week". |
  | `Created — added to this week` | ＋ | Task created from the `+` drawer with "Also add to the current week". |
  | `Carried to week of <Mon d Mon>` | ↻ | The open task became visible in a new week (R-task-29). |
  | `Renamed: "<old>" → "<new>"` | ✎ | Title changed via the detail sheet. |
  | `Done-condition edited: "<old>" → "<new>"` | ✎ | `cond` changed via the detail sheet or the uncheck follow-up. |
  | `Description updated` | ✎ | `desc` changed via the detail sheet (old/new not recorded). |
  | `Link added: <host>` | ↗ | A link was added. |
  | `Link removed: <host>` | ↗ | A link was removed (R-task-25). |
  | `Completed` | ✓ | Checkbox ticked. |
  | `Unchecked` | ↩ | Checkbox un-ticked on a done task. |
  | `Moved to Backlog[ — <reason>]` | → | Move-to-backlog exit confirmed. |
  | `Canceled[ — <reason>]` | → | Cancel exit confirmed. |

- **R-task-31** — Activity entries are appended by the server as a side effect of the operation that caused them. They are never user-authored, never editable, never deletable, and never require input. (BUSINESS-RULES §Task Activity: "Never requires user input.")
- **R-task-32** — The `Moved to Backlog` / `Canceled` entries require the task record to survive its exit — see §5 D-15 (the mockup deletes the row and loses both the entry and the reason).

#### Amendment 1 — tasks in future weeks

- **R-task-33 (a task attaches to a leaf and a week, never to a sentence)** ⚠ **superseded by R-task-40 (A2) — there are no focus sentences; the ruling that a task keys on (goal, week) and nothing else survives** — With several focus sentences per leaf per week (R-plan-13), a task still references `(goalId, originWeek)` and nothing else. There is **no `focusId` on Task — not required, not optional.** The reasons, in order:
  1. A required "which focus?" field breaks the product's own rule that nothing is mandatory and flows stay fast (R-task-18, R-goal-22, R-task-3's optional done-condition).
  2. An *optional* one is worse than either extreme: it creates two classes of task and a rendering fork on every task surface, and it needs a lifecycle rule for what happens to the pointer when the whole-week replace (R-plan-16) deletes the row it names — a nullable reference nobody is required to set is a field that is wrong half the time and audited never.
  3. A focus row is per-week and freely deleted, while an **open task carries across weeks** (R-task-7). A week-`n+3` task pointing at a week-`n` sentence is a reference whose meaning decays — the D-1 failure mode in a different column.
  - **What is lost:** you cannot ask which of a week's sentences a task served, and tasks cannot be grouped by sentence on the Tasks screen. Accepted deliberately: the leaf is already the grouping, and several sentences are *parallel intents for one leaf*, not sub-buckets of it. If grouping is ever genuinely wanted, the honest model is a second leaf, not a second key on Task.
- **R-task-34 (creating into a future week)** ⚠ **superseded by R-task-40/R-task-41 (A2) — the target week ceases to be an input; the no-back-dating half survives** — A task is created into a **target week**, which must lie in the plannable window `0 … +4` (R-plan-15) and in which the target leaf must be active (R-goal-9, evaluated for the target week). `originWeek` is the target week: server-assigned from the target and immutable thereafter (R-task-5's immutability is unchanged). **There is still no back-dating** — a target week earlier than the current week is refused with `WEEK_OUT_OF_RANGE`, and a past week offers no create affordance from any source. The default target is the viewed week when it is plannable, and the current week otherwise. *Supersedes R-task-5's "always the current week" and R-task-6's "current week only"; R-task-6's no-back-dating clause survives verbatim.*
  - The three fast-capture sources stay current-week-only by design: the `+` drawer's "Also add to the current week" (R-backlog-15) and an Idea's "Task this week" (R-idea-4) do not gain a week picker. Both exist to get a thought out of the way in two seconds; a week choice is a decision, and decisions belong on the planning screen.
- **R-task-35 (completion is never in the future)** — A completion must satisfy `originWeek ≤ week ≤ currentWeek`. A future week is refused with `WEEK_OUT_OF_RANGE` — you cannot finish work in a week that has not happened. **Consequence:** a task whose `originWeek` is in the future cannot be completed *at all* until that week arrives, because no week satisfies both bounds; the refusal is the same one S-task-14-2 already specifies, and future planning is what makes it reachable rather than theoretical. The checkbox is not rendered on a task row in a future week; the row renders with its title, done-condition and actions, and no completion affordance.
- **R-task-36 (the other two exits still work on future-dated work)** — Move to Backlog and Cancel remain available on an open future-dated task. Changing your mind about next week is not a fourth exit (R-task-13 is unchanged) — it is two of the three that already exist. `fromWeek` is the week the task was live in, which for a not-yet-arrived task is its `originWeek`, a future Monday; it renders `from week of 8 Sep` like any other and is truthful.
- **R-task-37 (carry age is clamped at the current week)** ⚠ **superseded by R-task-43 (A2) — the clamp at 0 becomes a signed age** — `age = max(0, weeksBetween(originWeek, min(viewedWeek, currentWeek)))`, and `carryWeeks` on the wire is this clamped value.
  - Past and current views are unchanged (`min` is the viewed week there), so R-task-10, R-task-11 and S-task-11-2 hold verbatim.
  - In a **future** view the clamp is the whole point: `min(viewedWeek, currentWeek)` never runs ahead of today, so work that has not come due can never earn a label. A task planned for `+1` and viewed at `+3` is age **0** — no grey label, and above all **no red chip on work nobody is late with**. Without the clamp the naive `viewWeek − originWeek` would read 2 and fire the product's only escalation at a plan.
  - An **already-late** open task (origin in the past) projected into a future week keeps the age it has *today*: it is late now and it is still open then, so the chip is correct there.
- **R-task-38 (future work is not in today's numbers)** ⚠ **modified by A2 — the filter-pill bullet is retired with the pills (R-lens-4); every other bullet stands** — R-task-7 already settles this and is confirmed unchanged: an open task is visible in every week `≥ originWeek`, so a task with a future origin is **not** visible in the current week and not in any earlier one. What must hold as a consequence:
  - The Tasks screen shows only the tasks visible in the **viewed** week (R-task-7/8), so at week 0 a future-origin task is absent.
  - The goal filter pill counts (R-nav-7) count open tasks visible in the **viewed** week, so today's counts exclude future work; at a future week they include it.
  - The life-goal carrying signal (R-goal-24) counts open tasks whose `originWeek` is *before the current week*, which can never match a future origin. It is unchanged and needs no guard.
  - `N in backlog` (R-goal-25) and every backlog count are unaffected — backlog items have no week.
  - **The carry log stops at today.** R-task-29's `Carried to week of …` entry is logged once per week *crossed*; a week that has not arrived has not been crossed. The producer is clamped at the current week and must never append a `carried` event for a `weekStart > currentWeek`, however far ahead a week is *viewed*. Viewing week `+3` must write nothing to any task's timeline. *Modifies R-task-29.*

#### Amendment 2 — tasks hang off Weekly goals

- **R-task-39 (a task hangs off a Weekly goal)** ⚠ **superseded by R-task-51 (A8)** — A task's `goalId` names a goal with `horizon = 'Weekly'` and nothing else (R-goal-39). *Supersedes R-task-1.*
- **R-task-40 (the week is the task's own stored field — the modelling ruling)** ⚠ **generalised by R-task-52 (A8) — `originWeekStart` becomes `originPeriodKey` and gains a `scope`; all four reasons below are unchanged in force and now bind at two scopes, and the field is no longer immutable against exactly one operation (Park, R-task-56)** — `originWeekStart` stays an **absolute Monday stored on the task**, server-assigned once at creation from its Weekly goal's `periodKey`, and immutable for the life of the task. It is **not implied by, and never re-read from, the Weekly parent.** `doneWeekStart` is unchanged. There is no client input for either. *Supersedes R-task-33 and R-task-34's target-week parameter.*
  - **The Weekly goal says what the work is for; the task's own week says when it was live.** Those are two different facts and the redesign is the moment they stop coinciding.
  - **Why stored and not implied**, in the order the reasons bind:
    1. **Carry** (R-task-7) is a comparison against `originWeekStart` with no write and no job — the single fact that lets this product have no cron. An open task must remain visible in every week `≥` its origin *while its goal stays anchored to one week* (R-goal-40); a derived week would make "which weeks was this live in" a question about the parent rather than about the task.
    2. **Uncheck** (R-task-19) requires the *original* origin to survive a completion and its reversal. `doneWeekStart` must be stored regardless; deriving `originWeekStart` would split the two halves of one week model across a stored field and a join, and "carries into the current week under its **original** origin" would have nothing to read.
    3. **D-1.** A week that is looked up rather than recorded changes meaning without a write. That is the most damaging thing this spec inherited, and the reason every week in the product is an absolute date. `periodKey` is immutable on a Weekly goal (R-goal-40), which makes an implied week *look* safe — but it is safe only for as long as that immutability holds, and a stored column is safe unconditionally.
    4. It costs nothing: the column exists, is indexed (`ix_tasks_open_week`), and every week-scoped read stays an index seek instead of a join to `goals`.
  - **What legitimately diverges, and it is exactly one thing:** the task **carried**. An open task is visible in weeks after its origin, so from the second week onward its week and its goal's week differ. That divergence is the product working, and R-lens-12 is how it renders. Because a Weekly goal's `periodKey` is immutable (R-goal-40), there is no other way for the two to come apart.
  - **What may not diverge:** at creation they are equal, by construction — there is no target-week parameter to disagree with the parent.
- **R-task-41 (where a task may be created)** ⚠ **modified by the reconciliation pass — a fourth source (R-task-49)** ⚠ **modified by R-task-57 (A8) — the fourth source is RETIRED with R-task-49 and replaced by a direct month task; the no-back-dating and unbounded-forward clauses survive verbatim at both scopes** — A task is created **under a Weekly goal**, from four sources: (a) `+ Task` on a Weekly goal — in the Weekly lens or on its detail page; (b) a **Backlog pull** (R-backlog-26); (c) the `+` drawer's `Add to this week instead` (R-backlog-27); (d) **`+ Task` or `Pull from backlog` on a Monthly goal's card**, where the Weekly goal is resolved or created for you (R-task-49). *Supersedes R-task-2's four sources — the Idea source is deleted with the entity (R-rm-1) — and R-task-4's target selector, which now lists Weekly goals for the target week, labelled `<Life root title> — <weekly goal title>`.*
  - **No back-dating, unchanged, and now enforced through the parent** (R-task-6's surviving clause): a task may not be created under a Weekly goal whose week is in the past. The attempt is refused with `PERIOD_IN_PAST`, and no `+ Task` affordance renders on a past week or in the carried band (R-lens-12), from any source.
  - **Creating forward is unbounded** (R-goal-36): a Weekly goal three months out accepts tasks. They are invisible until that week arrives (R-task-7) and are never styled as late (R-lens-11).
  - Creating a task into a week other than the one being viewed **moves the Weekly lens to that week**, with the toast naming it: `Added to week of <Mon d Mon>`. Nothing may be created into a week and then vanish from the screen that created it (R-nav-19's reason, unchanged).
- **R-task-42 (visibility is unchanged)** ⚠ **generalised by R-task-53 (A8) — the two sentences stand verbatim for a week task and are restated at month scope for a month task; the load-bearing clause — visibility is a function of the task's own period and NEVER of its goal's — is unchanged and is what makes month-carry free too** — R-task-7 and R-task-8 stand verbatim: an **open** task is visible in every week `≥ originWeek`; a **done** task only in `doneWeek`; an **exited** task in none. Visibility is a function of the task's own weeks and **never of its goal's period** — which is what makes R-lens-12's carried band possible and what makes carrying free.
- **R-task-43 (carry age is signed)** ⚠ **generalised by R-task-54 (A8) — the age is counted in the task's own scope's units (weeks for a week task, months for a month task) and the signed rule, the thresholds and the two labels are unchanged; a month task wears NO label at all in a week (R-lens-31)** — `carryAge = weeksBetween(originWeekStart, min(viewedWeek, currentWeek))`. The value **may be negative**. Labels: `≤ 0` → **none**; `= 1` → the gray `since Mon 24 Aug`; `≥ 2` → the red `N weeks · since 10 Aug` chip, the product's only escalation. *Supersedes R-task-37's `max(0, …)` clamp; R-task-10/11/12's thresholds are unchanged.*
  - The `min(…, currentWeek)` term is what keeps a plan from ageing: a task planned for `+1` and viewed at `+3` is age `−1`, not 2. Dropping the outer clamp changes nothing that renders — no label fires below 1 either way — and leaves **one** guard instead of two, carried in the sign. A negative age is the honest reading of "not due yet", and a client that ever wants to say `in 2 weeks` has the number.
  - An **already-late** open task (origin in the past) projected into a future week keeps the age it has *today*: it is late now and still open then, so the chip is correct there.
  - `TaskView.carryWeeks` therefore stops being `nonnegative`. **This is a silent wire break** — the type still parses and the semantics change underneath it — and is called out in the delta's compatibility section.
- **R-task-44 (completion is never in the future — unchanged)** ⚠ **generalised by R-task-55 (A8) — the bound is `originPeriodKey ≤ period ≤ currentPeriod` in the task's own scope; `WEEK_OUT_OF_RANGE` survives and is joined by nothing** — `originWeek ≤ week ≤ currentWeek`, refused with `WEEK_OUT_OF_RANGE` otherwise (R-task-35, unchanged and now reachable at any distance, because the forward bound is gone). A task under a future Weekly goal cannot be completed at all until that week arrives; its row renders with no completion checkbox.
- **R-task-45 (the task page)** ⚠ **modified by the reconciliation pass — it also carries the completion checkbox (R-task-50)** — Task detail is a **routed page**, not a drawer (CR-5, owner decision 6). It shows the **completion checkbox** (R-task-50), the goal path (Life root › … › Weekly goal, **with that goal's week**) as one muted line with both segments tappable, the done date when done, editable `title` / `cond` / `desc`, the links list with add and remove, the three exits when open, and the read-only activity timeline. It carries the top-right cluster (R-nav-25), which goal detail today does not. *Supersedes R-task-22.*
  - Back returns to the lens and period the task was opened from. A task page opened cold by URL falls back to the Weekly lens at the task's `originWeek`, not at the current week — landing somewhere the task is not visible would read as a broken link.
  - Everything else about the sheet's behaviour is unchanged in substance: the dirty-only `Save changes` button, the `Task updated` toast, the blank-title fallback (R-task-23), done tasks staying editable with only the exits withdrawn (R-task-26).
- **R-task-46 (the activity timeline, amended)** ⚠ **amended again by R-task-58 (A8) — five rows are added and none is removed** — R-task-30's table changes in exactly two rows and in no other way:

  | Entry | Disposition |
  |---|---|
  | `Created — weekly planning` | **renamed** `Created — added to a goal`; the `planning` source becomes `goal` (there is no planning screen). |
  | `Created — from an Idea` | **retired** with the entity (R-rm-1); the `idea` source is removed from `TASK_SOURCES`. |

  Every other entry, glyph and trigger is unchanged — including `Carried to week of …` and its clamp (R-task-29 + R-task-38: never logged for a week later than the current one, however far ahead a lens now looks, which R-lens-7's unbounded forward control makes far more reachable than it was).
- **R-task-47 (a task never outlives its goal)** — Unchanged from Q-5: deleting a goal deletes its entire subtree and, transactionally, every Task (with its events and links) and BacklogItem in it. Deleting a **Monthly** goal therefore deletes its Weekly children and all of their tasks — the cascade already covers the new level, because it is defined over the subtree and not over a fixed depth. The confirmation names the counts, which now include Weekly goals and their tasks and can be large (R-goal-46, Q-12).
- **R-task-48 (one step, not two — the capture rule)** ⚠ **modified by the reconciliation pass — the field is pre-filled and stated, not blank and asked (R-task-49)** ⚠ **narrowed by A8 — the premise "creating a task now presupposes a Weekly goal" is FALSE from A8 onward: a Monthly goal holds tasks directly (R-task-51), so the inline `newWeeklyGoal` survives for the two flows that still name a WEEK (Park — R-task-56, and a backlog conversion targeting a week — R-backlog-31) and for nothing else** — Creating a task now presupposes a Weekly goal, and the common case is "I need to do this, this week". That must stay **one interaction**, and it is solved in the flow rather than in the model: the task-create sheet, when no Weekly goal exists for the target week under the chosen parent, creates one in the **same** sheet, and the save creates both rows **in one transaction**. The title is **pre-filled** from the chosen parent and the sheet **says what will happen before you save** (R-task-49) rather than presenting an empty field to fill — a form to fill in before you are allowed to fill in the form you wanted is the friction this rule exists to remove, wearing a different hat.
  - On the wire: `CreateTaskRequest` accepts either `goalId` (an existing Weekly goal) **or** `newWeeklyGoal: { parentId, title }`, exactly one of the two, refined. The server creates the Weekly goal at the target week and the task under it atomically; a failure creates neither.
  - **The data model is not special-cased.** There is no goal-less task, no implicit "inbox" goal, no nullable `goalId`. R-goal-39 holds unconditionally, and the server still refuses a task naming any non-Weekly goal.
  - This subsumes the `[Add a weekly goal]` action on R-backlog-26's refusal sheet: a conversion with no Weekly goal for the target week takes the same path rather than sending the owner away and losing the flow.

#### Reconciliation pass — creation from the Monthly lens, and a second home for exit 1

- **R-task-49 (`+ Task` from a Monthly goal — the Weekly goal is inferred, never asked)** ⚠ **RETIRED IN FULL by A8 (R-task-51, R-task-57). It was built; it must be removed, not left dormant.** The inference existed only to paper over the missing month-level task, and it carried a latent defect verified against the code (§6, Amendment 8). A Monthly goal now holds the task itself, so there is nothing to infer. The `weekForMonth` clamp survives for its two *other* consumers — R-lens-9's zoom and R-goal-47's scope — and both are audited in §6 — `+ Task` and `Pull from backlog` on a **Monthly goal's card** create a task under a Weekly goal that the server resolves. *This is R-task-41's fourth source.* Tasks live on Weekly goals (R-goal-39), so this is structurally two creates; made literal it is the worst flow in the product, so the second step is inferred.
  - ~~**The target week** is the same clamp as R-lens-9's Monthly → Weekly zoom: the week containing today when the viewed month contains today, otherwise the **first week whose Monday falls in that month**. One rule answers *"which week does this month mean"* for zoom, for this creation and for R-goal-47's scope.~~ ⚠ **AMENDED BY A9 — it is NOT the same clamp, and treating it as one is the defect §6 Amendment 8 verified and A9 fixes.** The zoom's clamp asks whether today's **calendar month** is the viewed month; every other rule in this product asks which month a **week's Monday** belongs to (R-goal-33, R-lens-28). The two disagree for the one to six days between a month starting and its first Monday, and the disagreement is correct for a zoom and wrong for a create. So the target week is now its own rule:
    - **The week the owner is standing in when THAT WEEK belongs to the viewed month; otherwise the viewed month's FIRST week.** The answer is inside the viewed month by construction, which is the whole property that was missing. `taskWeekForMonth('2026-09', today = 2026-09-02) = 2026-09-07`, where the retired clamp answered `2026-08-31` — August's week.
    - **The month's first week, and not the current week with a warning**, when the two differ. A task is created to be *seen* in the lens that created it; a week the viewed month's own lens will never show is not a destination, it is a leak, and R-goal-47's planned-ness line would go on reading `Nothing planned yet` immediately after the owner planned something. Naming the discrepancy instead would preserve all three of the defect's consequences and merely narrate them. The chosen week is always current-or-future at the seam, so R-goal-36 is not engaged and nothing is back-dated.
    - **The zoom's clamp is unchanged and is renamed to say what it is** — `zoomWeekForMonth`. Landing on the week you are living in is right for a zoom even when that week belongs to last month; R-lens-29's `This week is in Aug 2026` line already names the seam. **R-goal-47's scope is unchanged** and never reached the branch at all.
  - **Resolution**, over the Weekly goals under this Monthly goal in the target week. ⚠ **AMENDED BY A9 — the destination is NAMED at every count; "used silently" is retired.** The owner added three tasks from a Monthly goal, was never told which weekly goal or which week they landed in, and could not find them afterwards. **The sheet states the weekly goal and the week before `Save task` is reachable, and offers a way to change both, at every candidate count.**

    | Candidates | What happens |
    |---|---|
    | exactly one | ~~it is used — no picker, no extra field, no extra tap~~ ⚠ **A9** — it is shown as a **filled choice** in the picker's compact row and used. A choice with one option is not a choice, but it is still an ANSWER, and the answer is what was owed. Zero extra taps, as before. |
    | more than one | the sheet shows the picker's compact row with the first preselected — one tap to change, zero to accept |
    | none | one is **created**, using R-task-48's `newWeeklyGoal` in the same transaction, and the sentence saying so names the week |

  - ⚠ **A9 — the week, and the month that week belongs to, are named in all three rows**: `Lands in the week of 7 Sep · Sep 2026.` The month is there because a week and a month can honestly differ at a seam (a week belongs to its Monday's month), and because a task landing in a month other than the one on screen is exactly how the owner's three went missing. After the clamp fix the month named is the month you are looking at, so the line reads as a statement of fact rather than a warning.

  - **The implicit Weekly goal takes the Monthly goal's title.** A Weekly goal is this week's version of the monthly one, so `Run 4 times a week in August` reads correctly as a weekly goal and is renamable in one tap. `This week` would be meaningless in a list grouped by Life goal; naming it after the task confuses the step with the intent behind it.
  - **Stated before, named after — nothing may be created invisibly.** The sheet says `This starts a weekly goal "<title>" for the week of <Mon d Mon>. You can rename it after.` On save the toast reads `Added to week of <Mon d Mon>`, the app **moves to the Weekly lens at that week**, scrolled to the new task with focus on its row, and the live region carries `Added to week of Mon 31 Aug, under Run 4 times a week in August.` — naming the goal that was created, because it was created without being asked for.
  - **The move is required, not a convenience** (R-nav-19, R-task-41): staying put would leave the task and its new goal invisible from the screen that made them, which reads as a lost write. The cost is a trip back when adding tasks to several monthly goals in a row, and the Zoom sheet returns you to the same month in one tap because the anchor is preserved (R-lens-18).
  - **The Monthly card offers no `+ Weekly goal`** (Q-20, amended). A create button for the horizon below, on every card, is a tree growing back one affordance at a time; laying out a week deliberately is the Weekly lens's job. ~~The Monthly goal's **detail page** keeps `+ Weekly goal` as its one primary action (R-nav-25) — a detail page is not a lens.~~ ⚠ **superseded by R-nav-29 (A3)**: the detail page keeps the *create*, in the `Sub-goals` section it belongs to (R-goal-48), and keeps no primary action at all. The half of this bullet the Monthly **card** depends on — it offers no `+ Weekly goal` — is unchanged.
  - This retires the `This branch isn't active this week` dead end entirely: there is no longer a state in which a backlog item cannot become work, because the thing it needed to hang off is created for it.
  - It is refused on a **past** month like every other create (R-goal-36, R-task-41): a Monthly card in a past period renders no `+ Task` and no `Pull from backlog`.
- **R-task-50 (the task page's checkbox)** — The task page (R-task-45) carries the completion checkbox, and completing there returns to the lens with the toast `Done`, because the reason the page was opened is now finished.
  - It is **exit 1 given a second home**, not a fourth exit: R-task-13's "exactly three exits" is unchanged, and R-task-14 says complete is "the checkbox" without saying there is only one of them. A user who opened the detail to finish a task must not have to back out first.
  - It is bounded exactly as everywhere else (R-task-44: `originWeek ≤ week ≤ currentWeek`), so a task under a future Weekly goal renders no checkbox on its page either.
  - In the page's focus order it comes before the context line and the form, mirroring the lens row where the checkbox precedes the title.

#### Amendment 8 — tasks at the month

- **R-task-51 (a task hangs off a Monthly or a Weekly goal, and off nothing else)** — A task's `goalId` must name a goal with **`horizon ∈ { 'Monthly', 'Weekly' }`**. Life, Yearly and Quarterly goals never hold tasks. A create or a park naming any other horizon is refused with **`NOT_A_TASK_GOAL`** (409, `details.horizon`), which *replaces* `NOT_A_WEEKLY_GOAL` outright. *Supersedes R-goal-39 and R-task-39.*
  - **The condition is still the horizon, full stop — never leaf-ness** (R-goal-37). It now names two horizons instead of one; every other word of R-goal-39's ruling survives, including the trap it exists to catch. A **Quarterly** goal with no Monthly children is childless and still holds no task.
  - **Why the line falls between Quarterly and Monthly.** A month is the shortest period a person plans in that is longer than a week, and the friction the owner hit is exactly one horizon deep: *"adding a task from a Monthly goal means inventing a weekly goal first."* A quarter is not a container you put a chore in — a task with a three-month deadline carries for thirteen weeks before anything says so, which is a backlog item that has learned to nag. The horizons that hold **deferred, undated** work are Yearly, Quarterly and Monthly (R-backlog-1); the horizons that hold **committed, dated** work are Monthly and Weekly; and Monthly is deliberately the one horizon that holds both, because it is where the two decisions meet (R-backlog-30).
  - `+ Task` is rendered on Monthly and Weekly goals and nowhere else.
- **R-task-52 (the task's own period, and its scope)** — A task carries two stored, server-owned fields: **`scope`** (`'Monthly' | 'Weekly'`), seeded from its goal's horizon at creation, and **`originPeriodKey`**, seeded from that same goal's `periodKey` and in `scope`'s canonical format (R-goal-33). *Generalises R-task-40, whose four reasons for storing rather than deriving are unchanged and now bind at two scopes.* There is no client input for either.
  - **One column, two scopes, and the format is the discriminator.** `2026-09-07` is a week and `2026-09` is a month; the key says which without a flag, exactly as R-goal-33 already requires of every goal. *Renames* `originWeekStart` → `originPeriodKey` and `doneWeekStart` → `donePeriodKey`; every existing value is a Monday and is unchanged by the migration.
  - **`scope` is a denormalisation of `goal.horizon`, and it is admitted as one.** It is redundant with the key's format and with the parent's horizon, and it is stored for the same reason `originPeriodKey` is: a week-scoped read must not join to `goals` (R-task-40's reason 4), and an index cannot key on the length of a string. The invariant `scope` implies the key's format is a stored invariant with one test; where the two ever disagree the row is a data-integrity fact, not an ordinary one.
  - **A task's scope is not a second horizon system.** It is the horizon of the goal that holds it, copied. It may only ever be `Monthly` or `Weekly`, because only those two horizons hold tasks (R-task-51).
- **R-task-53 (visibility and carry, at either scope)** — *Generalises R-task-42, R-task-7 and R-task-8, which stand verbatim at week scope.* For a task of scope `S` and a viewed period `P` of the same scope:
  - an **open** task is visible in every `P ≥ originPeriodKey`;
  - a **done** task is visible **only** in `P = donePeriodKey`;
  - an **exited** task is visible in none.
  - **An unfinished month task at month end carries into the next month, by exactly the mechanism a week task carries into the next week** — a `≥` comparison over lexicographically sortable keys, with **no write, no prompt, no move operation and no job**. The product still has no cron and A8 does not give it one.
  - **Visibility is a function of the task's own period and never of its goal's** (R-task-42's load-bearing clause, unchanged). It is what makes a carried month task possible while its Monthly goal stays anchored to the month it was written for.
  - **Where a month task shows up.** In the **Monthly lens** for every month `≥` its origin while open (R-lens-32), and in the **month band** of every week belonging to that month (R-lens-31). "Belonging" is R-goal-33's Monday rule and nothing else: the week of Mon 31 Aug shows **August's** month tasks, on 2 September.
- **R-task-54 (carry age is counted in the task's own scope, and a month task is never late in a week)** — *Generalises R-task-43; the signed rule, the two thresholds and the two labels are unchanged.* `carryAge = periodsBetween(originPeriodKey, min(viewedPeriod, currentPeriod))`, counted in **weeks** for a week task and in **months** for a month task, both within one scope. `≤ 0` → none; `= 1` → the gray `since <period>`; `≥ 2` → the red `N weeks · since …` / `N months · since …` chip.
  - **A month task wears no carry label of any kind inside a week** — not the chip, not the gray line, not a muted variant. The month band renders the task, its done-condition, its measure and its checkbox, and nothing that could read as lateness. A month task unscheduled in week 2 is not late, and the escalation budget is spent (R-lens-11).
  - **A month task carrying between months does earn the chip, in the Monthly lens.** This is the same escalation at the task's own scale, not a second one, and it is the rule that stops a month task from becoming a silent second backlog (R-backlog-30): a task that has carried since August says `3 months · since Aug` in November, in the one place where the unit means something.
  - **The two are not in tension.** A month has a deadline and a week does not — for a month task the week is not the unit it was committed to, so a week has no standing to call it late.
- **R-task-55 (completion is bounded in the task's own scope)** — *Generalises R-task-44.* A completion names a period `P` of the task's `scope` and must satisfy `originPeriodKey ≤ P ≤ currentPeriod`; a later `P` is refused with `WEEK_OUT_OF_RANGE` (the code is unchanged and is now scope-agnostic). `donePeriodKey = P`. A task under a future Monthly or Weekly goal cannot be completed until that period arrives, and its row renders no checkbox (`completable` is unchanged in meaning).
  - **Standing in a week that belongs to another month, the client sends the period it is standing in.** On 2 Sep 2026 the month band of the week of Mon 31 Aug is **August's**, so completing from it writes `2026-08` — a past month, which R-goal-36 permits without qualification because past periods are closed to *plan* and to nothing else (R-lens-10). Nothing here is derived from "the current month"; the period is named explicitly, which is R-lens-29's ruling applied to a write.
- **R-task-56 (Park in a week — the one operation that rewrites a task's scope)** — A **month task** may be parked into a specific week; a **week task** may be moved back to its month. Both are the same command, `retarget`, and both are explicit, logged writes.
  - **What it does, exactly:** it sets `goalId` to the target goal and `originPeriodKey` to that goal's `periodKey`, and it sets `scope` to that goal's horizon. **Nothing else changes** — `title`, `cond`, `desc`, `links`, the events and **every reading** are untouched (R-measure-5).
  - **Parking into a week** resolves a Weekly goal exactly as R-backlog-26 already does, through the `weeklyTarget` picker (R-nav-31) and under the **Monthly goal the task is on**: exactly one candidate is used silently; two or more are refused with `AMBIGUOUS_CONVERSION_TARGET` and its candidate list; none takes R-task-48's inline `newWeeklyGoal`, in one transaction. This is why R-task-48 survives A8.
  - **Un-parking** — `Move to the month` — sets the task back onto the Weekly goal's **nearest Monthly ancestor**, at that goal's month. A Weekly goal with no Monthly ancestor (R-goal-32 permits it) has no target, and the action is refused with `HORIZON_CONFLICT` and is not rendered. It is the exact shape of R-backlog-29's refusal and is rare for the same reason.
  - **It is not a fourth exit** (R-task-13, unchanged). An exit takes work *out* of a period; parking moves it between two periods it was already committed to, and the task is still open, still visible and still yours to finish. Complete / Move to Backlog / Cancel remain the only three ways a task leaves.
  - **It is reversible on purpose.** A one-way narrowing would make a mis-tap unfixable and would push people to cancel-and-retype, which loses the readings, the links and the timeline. Symmetry costs one direction of the same command.
  - **Bounds.** The target period may not be in the past (`PERIOD_IN_PAST`, R-goal-36) — parking is planning. The target may be *earlier in the same month* than the task's origin only if that period is not past. Parking a **done** or **exited** task is refused; retargeting to the period the task is already in is an idempotent no-op that writes no event.
  - `originPeriodKey` is therefore **immutable against everything except this one named operation**, which is the narrowest possible weakening of R-task-40: D-1's failure mode is a week that *changes without a write*, and this is a write, confirmed, logged and reversible.
- **R-task-57 (where a month task is created)** — A task is created **under a Monthly or a Weekly goal**, from these sources: (a) `+ Task` on a **Monthly** goal — on its card in the Monthly lens, in the month band of the Weekly lens, or on its detail page; (b) `+ Task` on a **Weekly** goal, unchanged (R-task-41 a); (c) a **Backlog pull**, which now offers both targets (R-backlog-31); (d) the `+` drawer's `Add to this week instead`, unchanged (R-backlog-27). *Supersedes R-task-41's fourth source, which is retired with R-task-49.*
  - **Nothing is inferred and nothing is created invisibly.** `+ Task` on a Monthly goal creates **one row** — the task — on the goal you tapped, in the month you are looking at. There is no target-week clamp, no resolution table, no picker, no implicitly created Weekly goal and no sentence explaining what is about to happen, because nothing else happens. The whole of R-task-49 is deleted rather than repaired.
  - **The lens does not move.** R-task-41's rule that nothing may be created into a period and then vanish from the screen that created it is satisfied by construction: the task appears on the card you tapped. The forced navigation to the Weekly lens (R-task-49, R-nav-19's reason) goes with the inference — there is nowhere else for the row to be.
  - **No back-dating, unchanged** (R-task-41): a task may not be created under a goal whose period is in the past, at either scope, refused with `PERIOD_IN_PAST`, and no `+ Task` renders on a past month or a past week or in the carried band. **Creating forward is unbounded**, unchanged (R-goal-36): a Monthly goal six months out accepts month tasks; they are invisible until that month arrives and are never styled as late (R-lens-11).
  - The sheet is the same sheet. Its only difference at month scope is the absence of everything R-task-49 added to it.
- **R-task-58 (the activity timeline, amended a second time)** — *Amends R-task-30's table, as R-task-46 did.* Five rows are added and **none is removed**:

  | Entry | Glyph | Trigger |
  |---|---|---|
  | `Carried to <Mon YYYY>` | ↻ | A month task became visible in a new month (R-task-53). Clamped at the current month exactly as R-task-29/R-task-38 clamp the week form: a month that has not arrived has not been crossed, however far ahead a lens looks. |
  | `Parked in the week of <Mon d Mon>` | → | R-task-56, month → week. |
  | `Moved to <Mon YYYY>` | → | R-task-56, week → month. |
  | `Measure added: <kind>, <start> → <target> <unit>` | ✎ | A measure was attached to the task (R-measure-1). `<target>` renders `no target` when it is `null`. |
  | `Measure edited: <field> "<old>" → "<new>"` | ✎ | `kind`, `start`, `target` or `unit` changed. Values truncated per R-task-27. |
  | `Measure removed` | ✎ | The measure and its readings were deleted (R-measure-1). |

  - **A reading is never an event, in either direction** — not when recorded, not when deleted (R-measure-7). The readings list is its own log, it sits on the same page, and copying it into the timeline would make the timeline unreadable at the first counter anybody bumps daily.
  - `Created — added to a goal` is unchanged and covers a month task; `TASK_SOURCES` gains no member, because the source is *where you tapped*, not *what horizon it landed on*.
- **R-task-59 (a month task is not a second backlog — the pressure valve)** — The three exits are unchanged and all three work on a month task. In particular **Move to Backlog** on a month task lands the item on **that same Monthly goal** — the nearest goal that can hold backlog is the goal it is already on (R-backlog-29's walk terminates immediately) — and `fromWeek` is `null`, because the task had no week. It renders `from Sep 2026` rather than `from week of …`.
  - This is the demotion the model needs: a month task that has carried for three months and earned its chip is answered by finishing it, cancelling it, or admitting it is a *maybe* and sending it to the backlog **on the goal it already sits on, in one tap, losing nothing**. Promotion is `Add to this month` (R-backlog-31). The two concepts stay apart because moving between them is cheap and explicit in both directions.

### Measurable tasks (⚠ **A8 — new area**)

- **R-measure-1 (a measure is optional, and binary is its absence)** — A task carries an optional `measure`. There are **two `kind`s, `counter` and `gauge`, and no third**: a checkbox is `measure = null`, not a degenerate counter, and the data model keeps it separate.
  - **Why binary is not unified, though it is formally the degenerate counter `0 → 1`.** Four reasons, in the order they bind:
    1. **Completion is already modelled and it is not a number.** `donePeriodKey`, `doneAt`, the uncheck flow, the three exits and R-task-55's bound are the done model. Unifying would make `current ≥ target` a second definition of done, and two sources of truth for whether a task is finished is the defect, not the simplification.
    2. **A gauge with no target has no completion at all** (R-measure-4), so completion cannot be a function of the triple for *every* task. If it is independent for one shape it must be independent for all, or there are two completion models — and R-measure-6 requires it to be independent anyway.
    3. **Every task in the product would grow a measure it did not ask for**, on every row, every read model, every MCP payload and every count. `measure = null` costs one nullable field on a task and nothing anywhere else.
    4. **Migration.** Unifying means backfilling a triple onto every existing task and inventing a reading, with a timestamp, for every task ever completed — manufacturing history, which Q-19 and R-lens-10 refuse.
  - **The UI keeps a checkbox a checkbox, unconditionally.** A task with no measure renders exactly as it does today, everywhere. A task *with* a measure keeps its checkbox too (R-measure-6) and gains its numbers beside the title.
  - A measure may be added to an existing task and removed from one. **Removing it deletes its readings**, and is therefore a confirmed destructive act naming the count (`This deletes 14 recorded values.`), the same discipline as Q-5.
- **R-measure-2 (one triple, and direction is implied)** — A measure is `start`, `current`, `target`, plus an optional `unit` string.
  - **`counter`** is added to (`+3`); **`gauge`** is set (`= 78.5`). That is the whole difference between them, and it is an **input affordance, not a storage difference** (R-measure-3).
  - **Direction is implied and there is no direction flag**: `target > start` counts up, `target < start` counts down. A flag would be a second statement of a fact the two numbers already make, and the first row where they disagreed would be unanswerable.
  - `unit` is rendered after the numbers and is **never parsed, converted, pluralised against a list, or validated against one**. `kg`, `leads`, `reps`, `£` are all the same kind of thing to this product: a word you wrote.
  - Bounds (Q-11's register): `start`, `target` and every reading `value` are finite doubles with `|v| ≤ 1e9`; `NaN` and `±Infinity` are refused. `unit` ≤ 16 graphemes, trimmed.
- **R-measure-3 (`current` is derived from the readings, and readings are absolute)** — **`current` = the `value` of the latest surviving reading, ordered `(at desc, id desc)`, or `start` when there are none.** Every reading stores the **absolute** value of the measure after it; a counter's `+3` is resolved to an absolute by the server before it is stored.
  - **This is what makes deletion correct with one rule instead of two.** Deleting the latest reading falls back to the one before it; deleting a middle reading changes nothing; deleting the only reading returns `current` to `start`. Had a counter stored deltas and a gauge absolutes, `current` would be computed two ways, the sparkline would be drawn two ways, and the owner's own example — a mistyped `240` for `24` — would resolve differently depending on which kind of task it was typed into.
  - `current` **is** stored on the task, and it is stored as a **derived** value maintained in the same transaction as every reading write and delete — never client-supplied, never patchable. It is denormalised so that a lens row can render `12 / 15 leads` without a per-task subquery, which is the same argument R-task-52 makes for `scope`.
  - A `delta` submitted against a `gauge` is refused with **`MEASURE_KIND_MISMATCH`** (422). An absolute `value` submitted against a **counter is accepted** — correcting a counter to where it actually is ("I'm at 12") is legitimate, and a counter is a gauge you usually bump.
- **R-measure-4 (progress, the optional target, and `target == start`)** — Progress is **one formula for both kinds**: `(current − start) / (target − start)`. It handles both directions without a branch: `start 80, target 75, current 78` is `(−2)/(−5) = 0.4`.
  - **The target is optional.** With `target = null` there is **no progress, no percentage, no completion criterion and no bar** — just the number, its unit and its history. This is the AMRAP case and it is a first-class measurable, not a degraded one.
  - **`target == start` is refused at the edge** with **`MEASURE_TARGET_EQUALS_START`** (422), on create and on edit. It names no movement, and "maintain" — the only thing it could mean — is out of scope for this amendment.
  - **And if it exists in the data anyway** — a migration, a hand-edit, a bug — **progress is absent, not computed**. No division is performed, the field is omitted from the wire, and the UI renders the numbers alone. `NaN`, `Infinity`, `0%` and `100%` are each specifically forbidden as the answer: a wrong number is worse than no number, and this is the one place a divide-by-zero can reach a screen.
  - **The raw ratio may exceed 1 and is never clamped in the data.** 18 leads against a target of 15 is `1.2`, and it renders as `18 / 15 leads` — never as `120%` and never as a bar drawn past its own end. Only the *bar's fill* is clamped, and only for drawing.
  - **The bar, where it renders, carries no colour that means anything.** One neutral fill on the task page and, at most, on the task row. Not green for ahead, not red for behind, not amber for at-risk (R-measure-8).
- **R-measure-5 (readings follow the task, not the week)** — A reading is keyed by `taskId` and by nothing else. **There is no week, month, period or scope column on a reading, and there must never be one.**
  - A task carries across weeks and months (R-task-53) and may be parked between them (R-task-56). If its readings reset at any boundary the history is worthless, which is the whole reason the feature exists — the sparkline of a workout that resets every Monday shows nothing.
  - Readings therefore survive **carrying, parking, un-parking, re-parenting, completion and unchecking**, without exception. The only thing that removes a reading is deleting that reading, or deleting the measure (R-measure-1) or the task (R-task-47).
  - They are **append-only and individually deletable**. There is no edit-in-place: correcting a mistyped `240` is deleting it and recording `24`. There is no reset, no archive and no "clear history".
  - **They render as a sparkline plus the recent values, on the task page and only there.** The sparkline plots the readings in `at` order with no axis, no gridline, no target line, no trend line and no projection (R-measure-8). Where a screen has no room for it, the numbers are what render.
- **R-measure-6 (a measurable task is completed like any other task, in both directions)** —
  - **Reaching the target never completes a task.** The app does not decide you are finished; you do. `current ≥ target` changes nothing but what is rendered.
  - **Completing a task never writes a reading.** The app does not decide what your number was; you do. Completion at `12 / 15` records that you stopped at 12, which is the truth.
  - **A task may be completed at any value, including below `start`, and a gauge with no target is completable exactly like a checkbox.** Completion is `donePeriodKey` and R-task-55's bound, unchanged and untouched by the measure.
  - Unchecking is unchanged and touches no reading.
- **R-measure-7 (what the timeline records, and what it must not)** — The measure's **shape** is timeline material and its **values** are not: `Measure added`, `Measure edited`, `Measure removed` (R-task-58) and nothing else. **No reading produces an event, on record or on delete.**
  - A counter bumped daily for a quarter would put ninety rows into a log whose purpose is to answer "what happened to this task", and the ninety rows are already on the page, in the right shape, above it.
  - A deleted reading leaves **no trace anywhere**, deliberately. An audit trail of a typo defeats the reason deletion exists.
- **R-measure-8 (removed by design — the app shows what you recorded and never computes a verdict)** — *Extends R-nav-26 and R-nav-14. Every item here is out of scope and must be refused, not deferred.*
  - **No pace. No projection. No forecast. No "at this rate". No trend line. No moving average. No on-track / behind / ahead state, in a word, a colour, an icon or an accessible name. No streak. No completion rate. No burndown. No per-period summary of any measure.**
  - **No roll-up.** A Monthly goal's target is **never** computed from the tasks or weeks beneath it, and a month task's number is never summed into its goal, its lens, its group header or its Life line. Nothing aggregates a measure across tasks, anywhere.
  - **The rule that admits the numbers this amendment does add, and refuses these:** *a number the owner recorded is data; a number the app derived about the owner is a judgment.* `current`, `target`, their ratio and the readings are the owner's own values played back. Pace, projection and "you're behind" are the app's opinion of the owner, and `BUSINESS-RULES.md` removes those "entirely".
  - **Ratios are out of scope**, and this is the reason: a ratio needs a numerator and a denominator the app maintains and divides — the app deriving a number, which is the line above. `3 of 5 calls answered` is two measurable tasks or one counter, and both are already expressible.
  - **Checklists are out of scope**, and this is the reason: *"visit these 5 clients"* is five named things, not a count of five. It is five tasks, or one task with five lines in its description. A count that is secretly a list would want per-item state, per-item order and per-item completion, which is a sub-task feature wearing a number's clothes.
  - **Recurrence is out of scope and remains so.** R-goal-46 refused it once — no template entity, no series id, no materialisation job, no detached-from-series state, no edit-this-versus-all-future — and **that decision stands**. The owner's own examples do not reopen it: a **gauge is overwritten whenever you measure it**, so "update any day" needs no day concept at all; and *"15 leads daily"* is a **counter you bump**, with `daily` as context in the title and nowhere else in the model. A measure gives a repeating intention a place to accumulate, which is what it was actually missing.
  - **This rule exists so the next agent cannot reintroduce any of it as an obvious improvement.** Each of these is one line of code away from a measure and each would be the first number in this product that judged its owner.
- **R-measure-9 (what an agent may do with a measure, and what it may not)** — The MCP surface reads and updates measures like any other field: attach, edit and remove a measure, record and delete a reading, read the triple and the history. The server-instructions block teaches the model — the two kinds, the implied direction, the optional target, the derived `current`, and that readings follow the task.
  - **An agent is bound by R-measure-8 in full.** It must not compute or present a pace, a projection, a trend, a streak, an on-track verdict or a roll-up from a measure, and it must not infer completion from a target being reached. It reports what was recorded. This is the same refusal the instructions already carry for reports (`NO REPORTS`), extended by name to the numbers this amendment adds.
  - **No tool completes a task because its target was met**, and none records a reading as a side effect of completing one (R-measure-6, both directions).

### Backlog

- **R-backlog-1** — A backlog item is deferred future work attached to a single Yearly, Quarterly, or Monthly goal.
- **R-backlog-2 (never Life, never a week)** ⚠ **modified by R-backlog-26 (A2) — never a Life goal and never a **Weekly** goal either** — A backlog item may **never** be attached to a Life goal and never to a week. Every goal picker in the backlog flows lists `nonLife()` only. (BUSINESS-RULES §Backlog bullet 1; `BacklogDrawer`, `BacklogScreen` move chips, `IdeasScreen` attach chips.)
- **R-backlog-3** ⚠ **load-bearing from A8 onward, and unchanged: it is now the rule that keeps two adjacent concepts apart on one screen (R-backlog-30)** — A backlog item has no checkbox, no done-condition, no due date, and no status, and must be rendered visibly differently from a task.
- **R-backlog-4 (creation sources — four)** ⚠ **modified by R-task-41 (A2) — three sources; the Idea source is deleted** — (a) the global `+` drawer (goal defaults to the last used), (b) a goal detail `+ Add`, (c) a task moved out of a week (R-task-15), (d) an Idea attached to a goal (R-idea-5).
- **R-backlog-5** ⚠ **superseded within a goal by R-backlog-17/18; retained across goals by R-backlog-21** — Items are ordered newest first within their group, by `capturedAt` descending, `id` descending as tie-break. (BUSINESS-RULES §Backlog bullet 5; §5 D-17.)
- **R-backlog-6 (conversion — the only way backlog becomes work)** — `Add to this week` opens the standard task-create modal pre-filled with the item's title, description and links. **On save the item is converted: the backlog item is deleted and a task is created in one atomic operation.** It is never duplicated, never left behind, never copied. The task logs `Created — pulled from Backlog`. (BUSINESS-RULES §Backlog bullet 4; `store.saveNewTask`.)
- **R-backlog-7** ⚠ **modified by R-backlog-26 (A2) — "active leaf" reads "Weekly goal for the target week"; the ambiguity rule survives** — Conversion is target-bound: the created task's `goalId` is the **active leaf at or under the item's goal**. From the planning screen it is the leaf whose card the item was tapped under; from the backlog screens it is resolved by lookup. When more than one active leaf qualifies, the user must choose — the client must not pick silently. (`store.pullToWeek` → `activeLeafFor`; §5 D-18.)
- **R-backlog-8 (inactive-branch prompt)** ⚠ **modified by R-backlog-26 (A2) — the refusal survives with new copy and the code `NO_WEEKLY_GOAL`** — If no leaf at or under the item's goal has a focus in the target week, conversion is refused and a sheet appears: title `This branch isn't active this week`, body `"<item title>" can only become a task under an active weekly focus.`, actions `[Set a weekly focus]` (navigates to weekly planning) and `[Cancel]` (dismisses; the item is untouched). (`store.pullToWeek` else-branch; `InactiveBranchSheet`.)
- **R-backlog-9** — Converting an item that no longer exists (already converted, deleted, or moved) is refused; no task is created. (§5 D-19.)
- **R-backlog-10 (other actions)** ⚠ **modified by R-backlog-26 (A2) — a move target is any non-Life, **non-Weekly** goal; ⚠ its rendering is R-nav-31's (A6) — `backlogHost` mode, with the item's own goal excluded** — Besides conversion: `Move to another goal` (target = any non-Life goal, toast `Moved to <goal title>`) and `Delete`. There is no edit-in-place and no archive.
- **R-backlog-11 (goal detail, non-Life)** ⚠ **modified by R-backlog-26/28 (A2) — the backlog block renders on a Yearly/Quarterly/Monthly goal; a **Weekly** goal shows the pull list (R-backlog-28) and its tasks instead, and holds no backlog of its own** — A non-Life goal's detail screen shows `Backlog (N)` listing only the items attached to **that** goal, an inline `+ Add` quick-capture (Enter or `Save item` commits; `Never mind` cancels), and per-item `Add to this week` / `Move to another goal` / `Delete`. Empty state: `Nothing deferred on this goal.` (`GoalDetailScreen.tsx`; move action added by §5 D-20.)
- **R-backlog-12 (goal detail, Life — read-only aggregate)** — A **Life** goal's detail screen shows `Backlog across this line (N)`: a **read-only** roll-up of every item on any descendant goal, each row labelled `<owning goal title> · added <date>`. No per-item actions here — only `Open Backlog →`. (BUSINESS-RULES §Backlog bullet 5; `GoalDetailScreen.tsx` `isLife` branch.)
- **R-backlog-13 (full backlog page)** ⚠ **modified by R-backlog-21** (within a group, the goal's manual order) — The Backlog page groups items by branch path `<Life goal> › <owning goal>`, newest first, showing title, `Added <date>`, description, `N link[s]`, and `from <week of …>` when the item came out of a week. Tapping a row reveals its actions. Empty state: `Nothing in the backlog.` / `Future work lives here until you pull it into a week.` (`BacklogScreen.tsx`.)
- **R-backlog-14 (`+` drawer)** ⚠ **modified by R-backlog-27 (A2) — the drawer's goal chips exclude Weekly goals as well as Life goals; ⚠ generalised by R-nav-31 (A6) — the chips are the one goal picker in `backlogHost` mode, and the drawer's private last-used-goal memory becomes the picker's shared `RECENT`** — The `+` tab opens `Add to Backlog`: a goal picker (non-Life, non-Weekly, defaulting to the last-used goal), title (required), description, links, and a checkbox `Also add to the current week`, plus a `View Backlog →` shortcut. (BUSINESS-RULES §Nav; `BacklogDrawer`.)
  - **The default is unchanged in substance and shared in mechanism**: still the goal you filed under last, still this page load only, still validated against the offered set before it is used — but the memory now lives with the picker and is one list across all four modes, because the goal you filed under last is the same goal whether you are adding a backlog item or moving one.
- **R-backlog-15 (`+` drawer with "also add to the current week")** ⚠ **modified by R-backlog-27 (A2)** — When the box is ticked and a leaf at or under the chosen goal is active, a **task only** is created (no backlog item) with `Created — added to this week`; toast `Added to this week`. When the box is ticked but no leaf is active, a backlog item is created instead and the toast explains: `Branch isn't active this week — parked in Backlog`. When the box is unticked, a backlog item is created; toast `Added to Backlog`. (`store.saveBacklogDrawer`; copy corrected by §5 D-21.)
- **R-backlog-16** — `title` is trimmed; a whitespace-only title is refused and the Save button stays disabled.

#### Amendment 1 — manual ordering

- **R-backlog-17 (`sortKey`)** — Every backlog item carries a server-owned `sortKey`, unique within `(owner, goalId)`. It is an **opaque, lexicographically ordered string** (mid-point / fractional keys), never a position index: an index has to be rewritten across the whole list on every insert and is racy against a concurrent one. Within a goal the order is `sortKey` ascending, then `capturedAt` descending, then `id` descending — total and stable even if two keys ever collide (Q-7). The client never parses, computes or sends a key. *This answers §4 Q-7's "add an explicit `sortKey` only if manual re-ordering is ever requested." It has been.*
- **R-backlog-18 (where a new item lands)** — At the **top** of its goal's list: a new item gets a key that sorts before every existing key in that goal. Every capture flow in the product puts the newest thing where you can see it, and this keeps R-backlog-5's arrangement (newest first) exactly true for any list nobody has re-ordered. *Amends R-backlog-5 within a goal: `capturedAt` desc becomes the default the key reproduces, not the order itself.*
- **R-backlog-19 (reorder is a relative move)** — One command, `version`-guarded (Q-2), naming the item and a **neighbour**: `after: <id>`, `before: <id>`, `toTop`, or `toBottom`, all within the item's own goal. Never a position index. The server mints a key strictly between the neighbours; a neighbour in another goal, a converted item, or a missing id is refused and the order is unchanged. If mid-point keys exhaust their precision the server re-keys that goal's list inside the same transaction — invisible to the client and changing no order.
- **R-backlog-20 (moving, converting, deleting)** — Moving an item to another goal (R-backlog-10) assigns it a **fresh key at the top of the destination goal's list**; its old position is not preserved, because a per-goal order has nothing to preserve it against, and the destination's own order is the only one that now applies. `capturedAt` and `fromWeek` are still unchanged (S-backlog-10-1 holds). Conversion (R-backlog-6) and delete leave a **gap**: siblings are never re-keyed, and a converted row retains its `sortKey` where it stops participating in any order.
- **R-backlog-21 (manual order is per goal, and only per goal)** — Every list that spans more than one goal keeps `capturedAt` desc, `id` desc: the Life-goal read-only aggregate (R-backlog-12) and the ordering *of* the groups on the Backlog page (R-backlog-13). Within one group — which is one goal — the Backlog page and the goal-detail block both render that goal's manual order. A manual order **across** goals is not defined and must not be invented; two items on different goals have no relative position.
- **R-backlog-22 (reorder is keyboard-first — non-negotiable)** — Drag is never the only way to re-order. Every re-orderable backlog list provides **all** of:
  1. a roving-tabindex list: one tab stop for the list, `↑`/`↓` moving focus between rows, `Home`/`End` to the ends;
  2. a **visible, always-rendered** `Reorder "<title>"` control on each row — never hover-only, never a handle that appears on pointer-over, meeting the enforced contrast rule and a ≥44px touch target;
  3. a **grab mode**: `Space`/`Enter` on that control picks the row up; `↑`/`↓` move it one position; `Home`/`End` move it to top/bottom; `Space`/`Enter` drops it and commits; `Escape` cancels and restores the original position with **nothing written**;
  4. `Move up` / `Move down` / `Move to top` / `Move to bottom` in the row's existing action menu, so the whole feature is reachable without ever entering grab mode.
  Focus stays on the moved row's control after a drop, a cancel, or a failure, and is never lost to the document. This is a requirement of the feature, not a follow-up: the accessibility pass that made sheets dismissible and focus-trapped is enforced by tests, and a drag-only list would be a regression on work already completed.
- **R-backlog-23 (what a screen reader says)** — The list owns exactly one live region: `aria-live="assertive" aria-atomic="true"` for the duration of a grab — successive arrow presses must not be swallowed by a polite queue — reverting to `polite` when the grab ends. The announcements, verbatim:
  - pick up → `Reorder: "<title>", position N of M. Arrow keys to move, Enter to drop, Escape to cancel.`
  - each move → `"<title>", position K of M.`
  - drop → `"<title>" moved to position K of M in <goal title>.`
  - cancel → `Reorder canceled. "<title>" returned to position N of M.`
  - server refusal → `Reorder failed. "<title>" returned to position N of M.` — plus the non-toast error a lost write requires (Q-14; a toast alone is insufficient, R-nav-13).
  A pointer or touch drag announces the same lines, from the same region.
- **R-backlog-24 (drag is a second front-end on one command)** — Pointer and touch drag call the same relative reorder as the keyboard (R-backlog-19). There is no drag-only write path and no drag-only ordering semantics. Touch must not require a long-press as its only entry: the row control works on touch too.
- **R-backlog-25 (conversion into a future week)** ⚠ **modified by R-backlog-26 (A2)** — `Add to this week` becomes week-aware: a conversion names a target week in the plannable window, and the receiving leaf must be active **in that week**. R-backlog-7's ambiguity rule (two or more candidates ⇒ the user chooses) and R-backlog-8's refusal are both re-read against the **target** week, not against today. From the planning screen the target is the week being planned (R-plan-9). The refusal copy generalises: `This branch isn't active that week` when the target is not the current week. Everything else about conversion is unchanged — one atomic operation, once, never duplicated (R-backlog-6/9, D-19). *Amends R-backlog-7 and R-backlog-8.*

#### Amendment 2 — conversion targets a Weekly goal

- **R-backlog-26 (conversion targets a Weekly goal)** ⚠ **modified by R-backlog-31 (A8) — conversion gains a second, simpler target: `Add to this month` lands the task on the Monthly goal itself, with no resolution, no ambiguity and no `NO_WEEKLY_GOAL`. Everything below is unchanged for the `Add to this week` path** — `Add to this week` converts a backlog item into a task, which must land on a **Weekly goal** (R-goal-39). The conversion names a target week; the receiving goal is the Weekly goal **at or under the item's goal** whose `periodKey` is that week. *Amends R-backlog-7, R-backlog-8 and R-backlog-25 — each of which said "active leaf"; the resolution is otherwise identical, and D-18's ruling is untouched.*
  - Exactly one candidate → used silently. Two or more → the owner chooses; the server refuses to pick, with `AMBIGUOUS_CONVERSION_TARGET` and `details.candidates`. That id decides which week the task belongs to for the rest of its life, and array order is not a decision.
  - **None** → refused with **`NO_WEEKLY_GOAL`** (409, replacing `BRANCH_NOT_ACTIVE`), and the sheet offers R-task-48's inline `New weekly goal` field rather than sending the owner away: title `No weekly goal here for that week`, body `"<item title>" becomes a task under a weekly goal.`, actions `[Create one and add it]` / `[Cancel]` (the item is untouched on cancel). The copy names the week when the target is not the current one.
  - Everything else about conversion is unchanged: one atomic, idempotent operation; the item is converted, never duplicated, never left behind (R-backlog-6, R-backlog-9, D-19, Q-4); the task logs `Created — pulled from Backlog`.
  - A backlog item still may **not** be attached to a Weekly goal (R-backlog-2, amended): the whole point of a backlog item is that it has no week (R-backlog-1/3).
- **R-backlog-27 (the `+` drawer)** — Unchanged except in its target resolution: with `Add to this week instead` ticked, a **task only** is created under the Weekly goal at or under the chosen goal for the current week, logging `Created — added to this week`; with no such Weekly goal, a **backlog item** is created instead and the toast explains: `No weekly goal this week — parked in Backlog`. Unticked, a backlog item is created. *Amends R-backlog-15's copy and target rule; the single-entity behaviour (D-21) is unchanged.* The drawer's goal chips continue to list Yearly/Quarterly/Monthly goals only — never Life, and now never Weekly (R-backlog-2).
- **R-backlog-28 (the pull list moves to the Weekly goal's page)** — The `FROM THE BACKLOG` list that lived under each checked leaf on the plan screen survives on a **Weekly goal's detail page**: it lists every open backlog item whose `goalId` is any **ancestor** of that Weekly goal, excluding the Life root, which cannot hold items. Tapping one opens the task-create flow pre-filled with the item's title, bound to that Weekly goal and its week. The list is hidden when the pool is empty. *Supersedes R-plan-9 and R-plan-10 — the one surviving half of the plan screen.*
  - "At or under the leaf" becomes "any ancestor of the Weekly goal", because a backlog item can never sit on the Weekly goal itself (R-backlog-2).
- **R-backlog-29 (move-to-backlog lands on the nearest non-Weekly ancestor)** ⚠ **modified by R-task-59 (A8) — for a MONTH task the walk terminates immediately, on the goal the task is already on, and `LIFE_GOAL_NO_BACKLOG` is unreachable from it. The week case below is unchanged in every particular** — R-task-15 says the Move-to-Backlog exit creates a backlog item on **the owning goal's** backlog. The owning goal is now a Weekly goal, which may not hold backlog items (R-backlog-2) — so the item is created on that Weekly goal's **nearest non-Weekly ancestor**, normally its Monthly parent. Everything else about R-task-15 is unchanged: `title`, `desc` and `links` carry over, `fromWeek` is the Monday of the week the task was live in, the confirm sheet takes an optional reason, and the toast reads `Moved to Backlog[ — reason noted]`.
  - This is the semantically right target as well as the only legal one: "move to backlog" means *not this week*, so the item must leave the week, and a Weekly goal **is** a week. Landing it on the week it is escaping would be a no-op wearing an exit's clothes.
  - A Weekly goal whose only ancestor is a Life goal has no legal target (a Life goal holds no backlog — R-backlog-2). The exit is then refused with `LIFE_GOAL_NO_BACKLOG` and the sheet says so; Cancel remains available. This is the one cost of R-goal-32's level-skipping, it is rare, and refusing is better than inventing a home.
- **R-backlog-17 … R-backlog-24 (manual ordering) — unchanged and carried forward.** The `sortKey`, the relative-move command, the per-goal scope, the keyboard-first requirement and the live-region announcements are untouched by this redesign: they were specified against `backlog_items`, and nothing in A2 moves that table. They remain halted work to be re-planned into this build rather than rewritten (`docs/work/13-planning-ahead/spec-delta.md` §2.1, §2.2, §3).


#### Amendment 8 — backlog and a month task, on the same goal

- **R-backlog-30 (the line between a backlog item and a month task)** — Both attach to a Monthly goal, both are undated in the ordinary sense, and both wait. They are told apart by **exactly one stored fact, and it is the one the product is built on**:

  | | Backlog item | Month task |
  |---|---|---|
  | Period | **none** — it has no `periodKey` and no `originPeriodKey` | `originPeriodKey` = a month |
  | Appears in a lens | **never** — only on a goal's page and the Backlog page | in the Monthly lens, and in the month band of every week of its month |
  | Completion | none — no checkbox, no done-condition, no status (R-backlog-3) | the ordinary checkbox and the ordinary bound (R-task-55) |
  | Ages | **never.** Nothing about it changes with the passage of time | carries between months, with a growing chip at the month scale (R-task-54) |
  | Order | the owner's, by hand, per goal (R-backlog-17) | `createdAt`, like every task |
  | Becomes the other by | `Add to this month` / `Add to this week` (R-backlog-31) | `Move to Backlog`, landing on the same goal (R-task-59) |

  - **The owner's phrasing is the right one to say out loud and the wrong one to build on:** *backlog is "maybe, someday"; a month task is "yes, this month".* It survives verbatim in `BUSINESS-RULES.md`, because it is how a person decides which one to reach for. But "maybe" and "yes" are feelings, and a rule cannot check one. **The enforceable line is the period**: a backlog item is the only work object in this product with no period key, and a period key is precisely what makes something appear in a lens. That is why backlog never appears in a week and a month task always does — not a rendering choice, a consequence.
  - **Two directions, both one tap, both explicit.** That is what keeps the two concepts from collapsing into each other. A month task that has carried three months and earned its chip is *demoted* to the backlog on the goal it already sits on, losing nothing (R-task-59); a backlog item you have decided on is *promoted* in place (R-backlog-31). Neither concept has to absorb the other's job, because the move between them is cheap.
  - **What must never happen, stated so it can be audited:** a backlog item never gains a checkbox, a period, a due date or a status (R-backlog-3, unchanged); a month task never loses its checkbox or its period; and **there is no third state and no "someday task"**. A Monthly goal's page renders the two in two sections, with two different row shapes, and the difference is visible without reading a label.
  - **The failure mode this rule exists to prevent** is a month task quietly becoming a second backlog — undated in practice, carrying forever, never finished. R-task-54's month-scale chip is the mechanism that prevents it, and R-task-59 is the exit it points to. Without both, the owner's line stops holding within about three months of ordinary use.
- **R-backlog-31 (conversion targets the goal you are standing on, or a week)** — A backlog item on a **Monthly** goal offers two conversions; one on a Yearly or Quarterly goal offers only the second. *Amends R-backlog-26, R-backlog-7 and R-backlog-8, none of whose week-path rules change.*
  - **`Add to this month`** — available on a Monthly goal only. The item becomes a **month task on that same goal**, in the selected month (or the current month, whichever the surface names). There is **no resolution, no candidate list, no ambiguity, no `NO_WEEKLY_GOAL` and no implicitly created goal**: the target is the goal the item is already attached to. Everything else about conversion is unchanged — one atomic operation, the item is consumed and never duplicated, never left behind (R-backlog-6, R-backlog-9, D-19, Q-4), and the task logs `Created — pulled from Backlog`.
  - **`Add to this week`** — unchanged in every particular (R-backlog-26): it names a target week, resolves the Weekly goal at or under the item's goal, refuses ambiguity with `AMBIGUOUS_CONVERSION_TARGET`, and takes R-task-48's inline `newWeeklyGoal` when there is none.
  - **The month path is the one that removes a dead end.** `NO_WEEKLY_GOAL` was reachable from every backlog item on a Monthly goal in a week nobody had planned yet; from A8 it is reachable only when the owner has explicitly asked for a *week*.
  - The `+` drawer's `Add to this week instead` is unchanged (R-backlog-27): it is a two-second capture with no room to state a choice, and the week is the one it has always meant.

### ~~Idea~~ ⚠ **A2 — RETIRED IN FULL (R-rm-1)**

- **R-idea-1** ⚠ **RETIRED by A2 (R-rm-1) — the Idea entity is deleted outright** — An idea is a two-second capture of a distracting thought: text only, no fields to fill.
- **R-idea-2** ⚠ **RETIRED by A2 (R-rm-1)** — The optional tag is a **Life goal** or nothing; the chip row is `No goal` + one chip per life goal. Untagged ideas group under `Unsorted`. (`GoalChipRow`; `CaptureScreens.groupByGoal`.)
- **R-idea-3** ⚠ **RETIRED by A2 (R-rm-1)** — The list is read-only apart from tap actions; the only three are `Task this week`, `Attach to a goal`, `Delete`.
- **R-idea-4 (task this week)** ⚠ **RETIRED by A2 (R-rm-1)** — Opens the task-create modal pre-filled with the idea's text, target = an active leaf. The idea is deleted **only when the task is actually saved**; abandoning the modal leaves the idea in place. The created task logs `Created — from an Idea`. (§5 D-22.)
- **R-idea-5 (attach to a goal)** ⚠ **RETIRED by A2 (R-rm-1)** — Attaching sends the idea's text to the chosen **non-Life** goal's backlog as a new BacklogItem and removes the idea. Prompt copy: `SEND TO WHICH GOAL'S BACKLOG?`; toast `Moved to Backlog under <goal title>`. (`store.ideaToBacklog`.)
- **R-idea-6** ⚠ **RETIRED by A2 (R-rm-1)** — `Delete` removes the idea with no confirmation.
- **R-idea-7** ⚠ **RETIRED by A2 (R-rm-1)** — Ideas are grouped by Life goal then `Unsorted`, newest first. An idea whose tagged goal no longer exists falls into `Unsorted`. (`groupByGoal` `!s.node(x.goalId)` branch.)
- **R-idea-8** ⚠ **RETIRED by A2 (R-rm-1)** — Empty state: `Nothing parked.` / `When an idea grabs you mid-task, drop it here and get back to work.` Capture button label: `Park it`; Enter in the field also commits.

### Learning

- **R-learning-1** — A learning is a short insight that might change the plan. It is not a journal entry and not a task; it has no actions beyond re-tagging and discarding.
- **R-learning-2** ⚠ **modified by A2 — "the same chip row as ideas" now names no surviving surface (R-rm-1); the rule is otherwise unchanged, and a Learning's tag is still a Life goal or nothing** — Optional **Life-goal** tag, same chip row as ideas, same `Unsorted` grouping, newest first.
- **R-learning-3** — Tap actions are exactly two: `Attach to a goal` (re-tag to another life goal or back to `No goal`) and `Discard`.
- **R-learning-4** — `applied` renders a `changed the plan` badge. It is set explicitly by the user; the client needs an affordance for it. (BUSINESS-RULES §Learning bullet 3; §5 D-23 — the mockup has none.)
- **R-learning-5** — A goal's detail screen lists the learnings tagged to that goal's **Life root** (the whole line, not just the goal), plus `See all learnings →`. Empty state: `No learnings attached to this branch yet.` (`GoalDetailScreen.tsx`.)
- **R-learning-6** — Discarding removes the learning; there is no archive.
- **R-learning-7** — Empty state: `No learnings yet.` / `When reality surprises you, write it down — future-you will use it.` Capture button label: `Capture it`.

### Navigation & system

- **R-nav-1** ⚠ **superseded by R-nav-23 (A2) — three tabs** — Five tabs, fixed bottom: `Tasks · Goals · + · Ideas · Learnings`. The `+` is a circular button that opens the Add-to-Backlog drawer, not a page. (BUSINESS-RULES §Nav bullet 1; `TabBar.tsx`.)
- **R-nav-2** ⚠ **superseded by R-nav-24 (A2) — a real router** — The Goals tab stays highlighted while on a goal detail screen. The Backlog page has no tab; it is reached from the `+` drawer (`View Backlog →`) or a Life goal's detail screen (`Open Backlog →`).
- **R-nav-3** ⚠ **superseded by R-nav-16** — The Tasks header carries a week switcher: `‹` / `Week of <Mon d Mon>` (tap to open the picker) / `›`. The forward chevron is disabled at week 0; future weeks are never selectable. (`TasksScreen.tsx`.)
- **R-nav-4** ⚠ **superseded by R-nav-16** (the 8-week history bound survives) — The week picker offers the current week and the previous N weeks as chips (`This week`, then `Week of …`); the chevrons address the same range. The bound is a single number — the mockup's picker (6) and chevron clamp (9) disagree; see §5 D-24. Recommended bound: the last 8 weeks.
- **R-nav-5** ⚠ **superseded by R-lens-11 (A2)** — Past weeks show the badge `Past week — still editable` and remain fully interactive.
- **R-nav-6** ⚠ **RETIRED by A2 (R-rm-4) — there is no goal filter** — Changing the week via the picker resets the goal filter to `All`.
- **R-nav-7** ⚠ **superseded by R-lens-4 (A2) — the counts move to the Life-goal group headers** — The Tasks screen shows goal filter pills: `All` plus one pill per Life root that has a visible section, each with its count of **open** tasks visible in the viewed week.
- **R-nav-8** ⚠ **superseded by R-nav-21 / R-nav-22** (its "week 0 only" clause on the focus sentence also contradicted D-2) — A leaf gets a section on the Tasks screen when it has ≥1 visible task in the viewed week, or (week 0 only) it is active. Sections show the full goal path, the focus sentence (week 0 only), the task rows, and `+ Task` (week 0, active leaf only). (`TasksScreen.tsx`.)
- **R-nav-9** ⚠ **superseded by R-lens-6 (A2)** — Tasks empty states: week 0 → `A new week, still unplanned.` / `Pick which branches are active this week, then write each focus.` / `[Plan this week]`; past week → `Nothing happened this week.` / `No tasks were live in this week.` with no CTA.
- **R-nav-10** ⚠ **superseded by R-nav-20** — `Edit plan` appears in the Tasks header only at week 0 (R-plan-2).
- **R-nav-11** ⚠ **modified by R-nav-25 (A2) — the screen list changes; the one-primary-action rule is unchanged** — Every page carries the same top-right cluster: a light/dark theme toggle plus at most one primary action (`+ New goal` on Goals, `+ Add` on Backlog, `Edit plan` on Tasks, none on Ideas/Learnings/Plan/Goal detail). (BUSINESS-RULES §Nav bullet 3; `TopActions.tsx`.)
- **R-nav-12** — The theme preference is per-user and persisted across sessions; it must be a real light/dark token set, not a display filter. (§5 D-25.)
- **R-nav-13** — Toasts are transient confirmations, auto-dismissing after ~2.6s; they are never the only record of a state change.
- **R-nav-14 (removed by design)** — There is no weekly review wizard, no push flow with mandatory reasons, no audit-trail view, no week report, and no carry-count flag. Any such feature is out of scope and must be refused, not deferred. (BUSINESS-RULES §Nav last bullet.)
- **R-nav-15** — Every destructive or state-changing confirm sheet closes on overlay tap without acting.

#### Amendment 1 — a week switcher with a future

- **R-nav-16 (the switcher spans the whole window)** ⚠ **superseded by R-lens-7 (A2) — the period control is per horizon and unbounded forward** — The chevrons and the picker address exactly the same range: the previous `WEEK_HISTORY_WEEKS − 1 = 7` weeks, the current week, and the next `PLAN_AHEAD_WEEKS = 4` — thirteen weeks, offsets `−7 … +4`. The back chevron is disabled at `−7`, the forward chevron at `+4`. The picker labels them `Week of …` / `Last week` / `This week` / `Next week` / `Week of …`, with the future group visually separated from the past. D-24's rule stands unchanged — one bound per direction, honoured by both controls, no week reachable by one control and invisible to the other. *Supersedes R-nav-3's "future weeks are never selectable" and R-nav-4's "the current week and the previous N".*
- **R-nav-17 (week badges)** ⚠ **superseded by R-lens-11 (A2)** — A past week shows `Past week — still editable` (R-nav-5, unchanged). A **future** week shows `Future week — planning ahead`. The current week shows neither. A future week's task rows carry no completion checkbox (R-task-35).
- **R-nav-18 (a future week that holds work is visible from the picker)** ⚠ **superseded by R-lens-7 (A2) — the has-work dot generalises to every horizon** — A future week with at least one focus row, or at least one task originating in it, is marked in the picker with a dot. Without it, a plan written for `+2` is invisible from every screen except `+2` itself — because R-task-38 deliberately keeps it out of today's numbers — and the owner has no way to remember it exists.
- **R-nav-19 (creating into a future week leaves you there)** ⚠ **superseded by R-task-41 (A2)** — A task created into a target week other than the one being viewed moves the Tasks screen **to the target week**, and the toast names it: `Added to week of <Mon d Mon>`. Nothing may be created into a week and then vanish from the screen that created it: under R-task-38 a future-origin task is correctly invisible in the current week, and without this rule that reads as a lost write.
- **R-nav-20 (`Edit plan` and empty states across the window)** ⚠ **RETIRED by A2 (R-rm-3) — there is no `Edit plan` and no plan screen** — `Edit plan` renders in the Tasks header at **any** week in the plannable window and opens the plan screen on that week (*supersedes R-nav-10 and R-plan-2*). Empty states: week 0 keeps R-nav-9's copy verbatim; a **future** week with nothing planned reads `Nothing planned for this week yet.` / `Lay it out before it starts.` with `[Plan week of <Mon d Mon>]`; a past week keeps `Nothing happened this week.` / `No tasks were live in this week.` with no CTA. *Amends R-nav-9.*
- **R-nav-21 (focus sentences render in whatever week is viewed)** ⚠ **RETIRED by A2 (R-rm-2) — there are no focus sentences to render** — A leaf's section shows the sentences stored for the **viewed** week — past, present or future. That is the point of D-2, and R-nav-8's "(week 0 only)" clause contradicted it. Where several sentences exist they render as an ordered list in the section and in the goal detail block; where only one line is available (a tree row, a target-picker label) the **first** sentence renders (R-plan-14) followed by `+N more` when `N > 0`. *Amends R-nav-8 and R-goal-25.*
- **R-nav-22 (sections and `+ Task` across the window)** ⚠ **superseded by R-lens-12 (A2)** — A leaf gets a section on the Tasks screen when it has ≥1 visible task in the viewed week, **or** the viewed week is plannable and the leaf is active in *that* week. `+ Task` renders when the viewed week is plannable and the leaf is active in it. A past week renders sections for its visible tasks only, and never a `+ Task`. *Supersedes R-nav-8's week-0-only clauses.*

#### Amendment 2 — three tabs, a router

- **R-nav-23 (three tabs)** — Fixed bottom bar: `Goals · + · Learnings`. The `+` is a circular button that opens the Add-to-Backlog drawer, not a page (unchanged). **Tasks and Ideas are gone**: tasks live in the Weekly lens (R-lens-12) and Ideas are deleted (R-rm-1). The lens switcher is **not** a tab (R-lens-13). The Backlog page still has no tab; it is reached from the `+` drawer (`View Backlog →`) or a goal's detail page. *Supersedes R-nav-1.*
- **R-nav-24 (the router)** ⚠ **modified by the reconciliation pass — the route shapes are the UX plan's, because a URL is user-facing** — Screen and overlay stop being React state with a one-way URL mirror. **Routes:** `/` → the remembered lens at the period containing today, first ever run → `/week`; `/life`; `/year/2026`; `/quarter/2026-Q3`; `/month/2026-08`; `/week/2026-08-31`; `/goal/:goalId`; `/task/:taskId`; `/backlog`; `/learnings`. Periods are machine-formatted in the URL (`2026-Q3`) and human-formatted on screen (`Q3 2026`). **`/week/:monday` carries the absolute Monday, never an offset** — a relative offset in a URL means something different on Tuesday, which is D-1 exactly. **Overlays** stay state (R-lens-14). Browser back and forward work, a deep link restores lens + period, and an unknown route lands on the Goals screen rather than a blank page. *Supersedes R-nav-2 and the "no router" decision it recorded — CR-5's task page is exactly the genuinely-linkable case that decision reserved.*
- **R-nav-25 (the top-right cluster)** ⚠ **modified by the reconciliation pass — the lens create button names its horizon; ⚠ its GOAL-DETAIL mapping is superseded by R-nav-29 (A3) — `+ Task` on a Weekly goal and nothing at any other horizon, sub-goals having moved into the section that holds them (R-goal-48)** — Unchanged in form (R-nav-11): the theme toggle plus **at most one** primary action per page. The mapping changes with the screens — Goals → `+ Life goal` · `+ Yearly goal` · `+ Quarterly goal` · `+ Monthly goal` · `+ Weekly goal`, per the current lens, pre-filled with its horizon and selected period, and **absent** (not disabled) on a past period (R-goal-36); Goal detail → `+ Weekly goal` on a Monthly goal, `+ Task` on a Weekly goal, `+ Add` (backlog) on Yearly/Quarterly, none on Life; Backlog → `+ Add`; **Task page → the theme toggle only**, which today's goal detail omits and both must carry; Learnings → none.
  - **Absent, not disabled, on a past period.** A disabled create button invites the question "why?" on every past screen; absence plus `Past quarter — still editable` (R-lens-21) says the true thing — the past is readable, and planning does not reach back into it.
- **R-nav-26 (removed by design — extended)** — R-nav-14 is unchanged, and A2 adds to it: **a lens is not a report.** No weekly review wizard, no push flow with mandatory reasons, no audit-trail view, no week report, no carry-count flag — **and** no roll-up, completion rate, streak, burndown, or period summary on any lens header, and no completion state on a goal (R-goal-45). ⚠ **A8 — the list of permitted numbers gains a measure's own `current`, `target` and their ratio, and its readings (R-measure-8), and gains nothing else. The rule that admits them is stated there and is the one that must be quoted when the next number is proposed: a number the OWNER RECORDED is data; a number the APP DERIVED ABOUT THE OWNER is a judgment, and every judgment is still refused.** The only numbers in the product are R-lens-4's open count, R-goal-24's carrying line, `N in backlog`, the carry chip, ⚠ **and — added by the reconciliation pass — R-goal-47's planned-ness line and R-lens-22's Zoom-sheet goal counts.** Any other number is out of scope and must be refused, not deferred.
  - **Why the list grew by two, and only two.** R-goal-47's `3 weekly goals · 1 this week` **replaces** a surface rather than adding one: hiding empty groups (R-lens-19) deleted dormancy's only rendering, and this is its successor. R-lens-22's counts exist because the Zoom sheet must show where you would land *before* you commit, which is the whole argument for the sheet over a five-way strip (R-lens-17). Both are counts of things that exist, not measures of performance: neither fills up, neither is a rate, neither is coloured. **A completion rate, a streak, a burndown or a period summary is still refused.**

#### Reconciliation pass — the chrome budget, and where the app opens

- **R-nav-27 (two rows of chrome, and nothing else unconditional)** — Above the first item of any lens there are **at most two unconditional rows**: the top-right cluster (R-nav-25) and the lens row (R-lens-17). Everything else is conditional — the off-now row only off-now (R-lens-21), group headers only when there is more than one non-empty group (R-lens-19).
  - The unit is *rows of chrome above the first real item*. Today's Tasks screen carries **four** (eyebrow + `Edit plan`, week switcher, `Past week — still editable`, filter pills) and the goals tree carries **three plus depth**. Two is therefore not merely "no worse"; it removes half of what the owner complained about before any new capability is counted.
  - **This is the rule that refuses the next control.** A new unconditional row is refused, not deferred — it is why R-lens-13's five-way switcher was superseded, why there is no period picker (R-lens-7), and why the lens title carries the page identity instead of an eyebrow plus an H1.
- **R-nav-28 (where the app opens)** — A cold start opens the **Weekly lens** at the week containing today. It is the app's home for daily work now that it has absorbed the Tasks screen (R-lens-12), and it is the only lens where the answer to *"what do I do now"* is on screen.
  - Within a session the `Goals` tab returns to the lens last used, so daily use never opens the Zoom sheet (R-lens-17).
  - **The period always resets to the one containing today**, at every cold start, in every lens (R-lens-8). A remembered future period would let the app open on a screen that quietly lies about now.

#### Amendment 3 — sub-goals from the goal page

- **R-nav-29 (a goal detail page's one primary action)** ⚠ **modified by A8 — `+ Task` is now the primary action on a **Monthly** goal's page too, because a Monthly goal holds tasks (R-task-51). Every other horizon still carries none, and the reasoning below is unchanged: the create for the horizon *below* stays in the `Sub-goals` section, and this is the create for the work *on this goal*.** — Goal detail → **`+ Task` on a Weekly goal, and nothing at any other horizon.** *Supersedes R-nav-25's goal-detail mapping* (`+ Weekly goal` on a Monthly goal, `+ Add` on Yearly/Quarterly, none on Life). R-nav-25's **form** is untouched: the theme toggle, the account button, and at most one primary action per page.
  - **`+ Weekly goal` is dropped from a Monthly goal's page, not kept alongside.** With R-goal-48's inline capture on every horizon that can hold children, the top action would be a second route to a create the `Sub-goals` section already offers one screen-inch below it, and only on one of the four horizons — the exact clutter R-nav-27 refuses. Where they differ, the inline one is the shorter path (tap, type, `Enter`), and `More…` reaches the identical sheet the top action opened, pre-filled the same way, so no capability is lost with it.
  - **`+ Add` on Yearly/Quarterly was never built** and is dropped rather than implemented: R-nav-25's own text records that no such branch was ever written, and backlog capture on those two horizons is the backlog section's own inline `+ Add` (R-backlog-11) plus the global `+` drawer, both of which reach any goal.
  - **Q-20 is narrowed, not reversed.** Its ruling — *a create button for the horizon below, on every card, is a tree growing back one affordance at a time* — held `+ Weekly goal` off the Monthly **card** and left it on the **page**. A2's reconciliation kept it there because a detail page carries exactly one primary action and had nothing else to put in it; R-goal-48 gives that create a better home than the cluster, so the page now carries none.
  - A Weekly goal's page is unchanged: `+ Task` is its one primary action (R-goal-39), and it is the only goal page that has one.

#### Amendment 6 — loading is a skeleton

- **R-nav-30 (loading is a skeleton, and only when the identity is cold)** ⚠ **A6, new — the app had no loading rule of any kind before it** — The unit of the decision is the **content identity**: `(screen, lens, period)` on a lens, `(screen, goalId)` on a goal page, `(screen, taskId, week)` on a task page. Nine clauses, all binding.
  - **Identity.** Content stays on screen only while the header still describes it. When the identity changes the previous content is discarded in the same frame. Never September's goals under October's label — which is why `placeholderData: keepPreviousData` is refused (R-lens-30).
  - **Cache hit.** If the new identity has data in cache it renders **at once — no skeleton, no dim, no marker — even when it is stale and being revalidated**. Sep → Oct with Oct cached is one repaint and nothing else. In code this is React Query's `isPending` and never `isFetching`, and the distinction is the whole clause.
  - **Cold.** Only an identity with no data at all shows that screen's skeleton.
  - **Grace — 150 ms.** The skeleton does not mount for the first 150 ms; inside that window the content area is empty. A read that lands at 90 ms paints nothing grey.
  - **Minimum — 400 ms.** Once mounted a skeleton stays at least 400 ms, so the shortest visible skeleton reads as a state rather than as a flicker. Worst case 150 + 400 = **550 ms**. ⚠ The minimum is armed by the **mount**, never by the request, so it can never delay content that was already available.
  - **Errors supersede.** A read that fails during either window is replaced by `LoadError` immediately. The minimum never delays bad news.
  - **A refetch never skeletons.** Window-focus revalidation, a mutation invalidation, a retry — none may replace visible content with grey, at any latency.
  - **A skeleton never replaces an empty state.** A period known to be empty is cached content and returns instantly.
  - **One skeleton per screen, never nested.** A goal page does not show a real title beside a skeleton sub-goal list.
  - Three principles govern what a skeleton may contain. **No motion, ever** — no shimmer, pulse, gradient sweep or fade; the app has no animation and has none after this, so `prefers-reduced-motion` has nothing to honour (§8.5 of the UX plan). **Never a control** — `+ Task`, `Edit`, `Move…`, `Delete`, the checkbox and every form field render when their data lands and not before; a grey lozenge shaped like a button is an affordance that lies. **What the client already knows renders for real** — `Goals`, the top-right cluster and the task page's back control are all correct before any read starts (R-lens-30, P3), so every skeleton is a **body**, not a page.
  - **Accessibility.** The skeleton's wrapper is `role="status" aria-busy="true"` carrying the exact string the retired `Loading` component used on that screen (`Loading this goal…`, `Loading this task…`, `Loading…`); everything below it is `aria-hidden="true"` and holds **no focusable node**, so the tab order across a load→loaded transition is *empty, then the real controls*, never *fake, then real*.
  - **Contrast.** Skeleton bars are `T.line`, an existing token, and they carry **no text** — the 4.5:1 rule (`tests/screens/contrast.test.ts`) is about the legibility of type and is not engaged. They are `aria-hidden`, so they are not information either; everything a skeleton says is said by its one visually hidden status line, which is ordinary `T.mut`.
  - **It adds no row** (R-nav-27). Each skeleton occupies the space its content will occupy and nothing above it.

#### Amendment 7 — one goal picker

- **R-nav-31 (one goal picker)** — **Every choice of a goal in this product is made in one component.** A surface that needs a goal chosen supplies a **mode**; it does not supply a list, a rendering or a keyboard model. The component is a search field over a rule-scoped list, **grouped by Life goal**, every row carrying **its line and its period**, so two similarly-named goals in different lines are never confusable — the disambiguator is `<Life line> · <period>`, which needs no new wire field (`GoalView.lifeRootId` and `LensResponse.groups` are already sent and were used by no picker).
  - **Four modes, and each is a rule the SERVER already enforces, used to shape the offer** (D-5 — a disabled button is a hint, not an invariant; where the two ever disagree the server wins and its refusal renders):
    - **`parent`** — every goal of **strictly longer horizon**, levels skippable; never the goal itself and never one of its descendants (R-goal-5, R-goal-32, R-goal-18). A descendant is unlistable by construction, because it is strictly shorter-horizon than the goal and every option is strictly longer; the exclusion is stated as well as implied.
    - **`backlogHost`** — **Yearly, Quarterly and Monthly only**: never a Life goal, never a Weekly goal (R-backlog-1/2/26).
    - **`weeklyTarget`** — **Weekly goals in one week**, under the chosen parent (R-goal-39, R-task-41, R-task-49). ⚠ **A8 — the mode survives with two callers instead of three: Park (R-task-56) and a backlog conversion targeting a week (R-backlog-31). `+ Task` from a Monthly goal no longer uses it, because it no longer resolves a week.** When the server has named the candidates (`409 AMBIGUOUS_CONVERSION_TARGET`) **its list wins**: only the server knows the subtree *at or under* the item's goal, and the client holds no tree (R-lens-16).
    - **`lifeLine`** — **Life goals only**, plus a leading `No goal` row (R-learning-2/3; a non-Life tag is `NOT_A_LIFE_GOAL`).
  - ~~**One threshold governs both presentations: at 8 options a picker stops being a list and starts being a field.** At or below eight it is an inline grouped listbox with **no search field**. Above eight it is one row showing the current choice (`Choose a goal` when empty), which opens the full picker.~~ ⚠ **AMENDED BY A9 — the threshold governs ONE thing, and the SURFACE governs the shape.** The owner's `New Monthly goal` sheet had three legal parents, so eight-or-fewer chose the inline list, and three two-line rows ate the sheet and pushed `Save goal` below the fold. A count cannot tell a form sheet from a picker-shaped one. So:
    - **Inside a form sheet the picker is always the compact row**, at every option count — one line naming the current choice with its line and period (`Choose a goal` when empty), which opens the full picker. The sheet's other fields and its save button keep their space, which is the only thing that was ever wrong here.
    - **Where the picker IS the whole surface it is the inline grouped listbox**, at every option count — `Move goal`, whose sheet body is nothing else, and a backlog row's `Move to another goal`, on a screen. Nothing is being crowded out, so nothing needs collapsing.
    - **Eight remains the search threshold and nothing else**: at or below eight options the opened picker carries **no search field**, because searching a list you can see whole is chrome, and this is where the promise not to tax an account with ten goals is kept. The count is the **total across every horizon**, not the scoped one (below).
  - ⚠ **A9 — the list is SCOPED BY HORIZON first, and defaults to the most specific legal one.** The owner: *"instead we put everything under with all the goals from all the lense. we can have another option to select which lense to focus on and based on it i get the goals for that lense."* A horizon selector sits above the list; the list is that horizon's goals. This bounds the list **structurally** — one horizon's goals — rather than by a tuned number, and it matches the product's own lens-shaped mental model.
    - **Which horizons are offered comes from the mode's own rule and nothing else**, so a horizon the server would refuse is never offered: `parent` offers every strictly longer horizon (`Life` alone under `only: 'life'`), `backlogHost` offers Yearly/Quarterly/Monthly, and `weeklyTarget` and `lifeLine` are single-horizon and therefore **render no selector at all**.
    - **The default is the most specific legal horizon that has something to offer** — for a new Monthly goal that is Quarterly, not Life — or, when something is already chosen, that goal's own horizon, so reopening a picker shows you where your goal lives. Opening on an empty tab is a dead end; opening on the broadest is backwards, because the nearer a parent is the likelier it is the one you meant.
    - **Search crosses every horizon.** While the field is non-empty the scope is dropped and the ranker sees every option. **Scoping is a default view, not a filter** — it holds no state past the choice it was opened for, which is the same distinction that keeps this search out of R-lens-15's reach.
    - A horizon with no goals renders `No <horizon> goal to choose here. Pick another horizon above, or search across all of them.` — a third empty state, distinct from "this account has nothing legal at all".
    - The selector is a **`role="radiogroup"` of `role="radio"` chips with a roving tabindex**: one tab stop, `←`/`→`/`↑`/`↓` move **and** select, `Home`/`End` reach the ends, each chip's accessible name carries its count. It is deliberately not a `tablist`, because a tab implies a `tabpanel` and the thing it controls is a `listbox`. **It adds a tab stop, never a second focus trap.**
  - ⚠ **A9 — the picker's field announces its purpose AND its value**: `Choose a goal: Rebuild the gym habit — Be strong at 60 · Q3 2026`. It previously announced the value alone once filled, which left the one always-rendered field in the form without a label.
  - **The full picker takes over the sheet it was opened from.** The calling sheet swaps its body, its heading becomes `Choose a goal`, and a back control naming where you came from appears beside it. **There is never a second `aria-modal` dialog**, so there is never a second focus trap; the sheet does not unmount, so typed work survives by construction. Where the picker *is* the whole task (Move goal, moving a backlog item) it is simply the sheet's or the row's only body.
  - **Search ranks with the one shared ranker** (`packages/shared/src/search/rank-goals.ts`), which is `find_goal`'s: exact title `1.0`, prefix `0.9`, substring `0.75`, **Life line `0.5`**, `why` `0.35`, ties broken by horizon then `createdAt`. The assistant and the owner therefore order the same words the same way. It filters the already-loaded option set and fires no read; **when the field is non-empty the grouping collapses to one flat ranked list**, because a ranked list re-sorted into groups is not ranked.
  - **This does not reopen R-lens-15 or R-rm-4.** R-lens-15 forbids *search-as-filter in any lens* — a screen, and persistent filter state a user has to remember they set. **A picker is not a lens and its search is not state**: it lives inside a modal, resets to empty on every open, and cannot outlive the choice it was typed for. No lens read gains a parameter (S-lens-3-3 untouched).
  - **The picker is a listbox, and the selection is announced.** `role="listbox"` with `role="option"` rows and `aria-selected`, grouped by `role="group"` labelled with the Life goal; **one tab stop** with `aria-activedescendant`; `↑`/`↓` between rows, `Home`/`End` to the ends, `Enter`/`Space` to choose; typing from the list moves to the search field and inserts the character, so there is one search mechanism rather than a separate first-letter jump; **Escape never selects** — it clears a non-empty field, and on an empty one it closes the sheet through `Sheet`'s own unchanged contract. The result count is announced in a `role="status"`, debounced. *This is where R-lens-13's one surviving requirement — the selection is ANNOUNCED, never merely coloured — is finally met at every picker rather than only in the Zoom sheet.*
  - **The cap stops being silent.** Every picker was capped at `MAX_PAGE = 200` with `nextCursor` discarded and no indication. When any underlying read reports a cursor the picker says so at the foot of the list: `Showing the first 200. Search to narrow it.` **A picker that quietly omits a goal is a worse defect than a slow one**, because it teaches the owner the goal is gone. A server-side goal search is deliberately **deferred**, not designed: no mode reaches 200 without a data pathology (`parent` and `backlogHost` list interior goals only, `weeklyTarget` is one week), and shipping an endpoint for a case that has not occurred is what R-nav-26 exists to refuse.
  - **No virtualisation, no combobox library, no fuzzy-search library, no new colour, no new row of chrome.** 200 two-line rows in a `40vh` scroller is not a performance problem on any phone this app targets, and a virtualiser would break the roving tabindex.
  - **What it deliberately does not change:** the pull lists (R-backlog-28) pick a backlog **item**, not a goal, and are untouched beyond sharing the row idiom; the period scope of each mode is the one the reads already had (§9.6 of the UX plan names widening it as a separate, data-side change); and `lifeGoalsOnly` (R-lens-20's `Put under a Life goal…`) is carried through the move as a narrowing of `parent` rather than widened — it is still wired and still has no caller.


### Removals (⚠ **A2 — new area**)

These rules exist to be **audited**. Each names what must not exist once the redesign lands. "Deprecated", "unused but still present", "kept for compatibility", "behind a flag" and "the table is still there but nothing writes to it" all **fail** them. A later audit pass should be able to grep for every name below and find nothing.

- **R-rm-1 (Ideas — deleted outright)** — No migration, no conversion to backlog items, no export. The owner's decision, verbatim: *"forget about it nor i care about its data as i didnt use it."* Existing rows are dropped with the table. What must not exist:
  - **DB:** table `ideas`; index `ix_ideas_owner`; the `ideas` member of the `schema` barrel; a `DROP TABLE ideas` migration with its regenerated journal and snapshot.
  - **Domain:** the `Idea` entity type; the `'idea'` member of `TASK_SOURCES` / `TaskSource`.
  - **Ports & repo:** `IIdeaRepo` (interface and DI symbol) with `findById` / `listAll` / `insertStmt` / `deleteStmt` / `untagByGoalsStmt`; `D1IdeaRepo`.
  - **Service:** `IdeaService` (`list`, `create`, `remove`, `attach`, `convert`, `requireIdea`, `requireActiveLeaf`) and `toIdeaView`.
  - **Routes:** `GET /api/ideas`, `POST /api/ideas`, `DELETE /api/ideas/:id`, `POST /api/ideas/:id/attach`, `POST /api/ideas/:id/convert-to-task`; the `ideasRoutes` export and its mount.
  - **Contract:** `ENDPOINTS.ideas` / `.idea` / `.ideaAttach` / `.ideaConvert`; `IdeaView`; `CreateIdeaRequest`, `AttachIdeaRequest`, `ConvertIdeaRequest`, `IdeaResponse`, `AttachIdeaResponse`, `ConvertIdeaResponse` and their type aliases; `IdeasResponse`; `BootstrapResponse.ideas`; `DeleteGoalResponse.untagged.ideas`.
  - **Read model:** `BootstrapService`'s idea fetch; `GoalService`'s idea untag-on-delete counter and its `idea.untagByGoals` write.
  - **MCP:** tools `list_ideas`, `capture_idea`, `attach_idea_to_goal`, `convert_idea_to_task`, `delete_idea`; resource `goalcascade://ideas`; prompt `process_ideas`; the Ideas paragraph in the server instructions; the `## Idea (parking lot)` section of the shipped business-rules resource.
  - **DI:** the `IIdeaRepo` token re-export and both container registrations.
  - **Web:** `IdeasScreen` and `IdeaCard`; the `Ideas` tab; the `'ideas'` member of the `Screen` union; `fromIdeaId` on the task-create sheet; `ideas` / `createIdea` / `deleteIdea` / `attachIdea` / `convertIdea` in the HTTP client; `useIdeas`, `useCreateIdea`, `useDeleteIdea`, `useAttachIdea`, `useConvertIdea`, `dropIdea`; the `keys.ideas` query key; the `'ideas'` deep-link tab and its `TAB_SCREEN` entry; `/api/ideas` in the service-worker read-model prefixes; the delete-cascade copy that names ideas.
  - **Spec:** R-idea-1 … R-idea-8 and S-idea-2-1, S-idea-4-1/4-2/4-3, S-idea-5-1, S-idea-7-1.
  - **Surviving deliberately:** `NOT_A_LIFE_GOAL` (Learnings still use it) and `CaptureText` (Learning text).
- **R-rm-2 (`weekly_focus` — deleted outright)** — A weekly intent is now a goal, so the entity has no residue. What must not exist:
  - **DB:** table `weekly_focus`; indexes `ux_weekly_focus_goal_week` and `ix_weekly_focus_week`; the `weeklyFocus` member of the `schema` barrel.
  - **Domain:** the `WeeklyFocus` entity type; `focusableLeaves`, `isActive`, `isDormant`, `subtreeActive`, `activeLeavesUnder` — every function taking a `focusedGoalIds` set. Their replacements are period predicates (R-goal-38) over `periodKey`.
  - **Ports & repo:** `IWeeklyFocusRepo` (interface and DI symbol) with all nine methods (`listByWeek`, `listByGoals`, `findByGoalAndWeek`, `insertStmt`, `updateStmt`, `deleteByGoalsAndWeekStmt`, `deleteByWeekStmt`, `deleteByGoalsFromWeekStmt`, `deleteByGoalsStmt`); `D1WeeklyFocusRepo`.
  - **Service:** `PlanService` in full; `GoalService`'s `focusByGoal` map, `focus` projection, `branches` projection and `exLeafWrites` focus deletion; `TaskService`'s focus fetch and active-leaf guard; `BacklogService`'s `resolveConversionTarget` active-leaf resolution (replaced per R-backlog-26); `goal-tree-guard.ts`'s "an ex-leaf may hold neither focus nor tasks" guard (unreachable per R-goal-42).
  - **Contract:** `PlanEntryView`; `SavePlanRequest`; `PlanResponse`; `GoalView.focus`, `.isLeaf`, `.isActive`, `.dormant`, `.subtreeActive`, `.branches`; `TasksResponse.plan`; `BootstrapResponse.plan`; `MAX_PLAN_ENTRIES`; `Sentence`'s weekly-focus doc (the type survives for exit reasons); `DeleteGoalResponse.removed.weeklyFocuses`.
  - **Errors:** `WEEK_NOT_CURRENT` (and A1's proposed `WEEK_NOT_PLANNABLE`, never built) → `PERIOD_IN_PAST`; `NOT_A_LEAF` → `NOT_A_WEEKLY_GOAL`; `BRANCH_NOT_ACTIVE` → `NO_WEEKLY_GOAL`; `GOAL_HAS_OPEN_TASKS` → removed with no replacement (R-goal-42).
  - **MCP:** tools `get_weekly_plan`, `set_goal_focus`, `clear_goal_focus`, `save_weekly_plan`; `find_goal`'s `only: 'active_leaves'` / `'leaves'` options; `goalOut`'s `focus` and `can_hold_focus` fields; `outline`'s `ACTIVE:` line; `activeLeafCandidates`; the plan half of `goalcascade://week/current` and `goalcascade://week/{week_start}`; the focus paragraphs in the server instructions; `plan_the_week`; the `## Weekly focus` section of the shipped business-rules resource.
  - **Web:** `PlanScreen`; `usePlan`, `useSavePlan`, `plan()` / `savePlan()`; `keys.plan` / `keys.planAll`; the `'plan'` screen and deep-link tab; `activeLeavesUnder` in the web tree utils; every render of `g.focus` and every `DORMANT` label.
  - **Spec:** R-plan-1 … R-plan-20 and the whole `### Plan` scenario section (S-plan-*), except the two fragments moved to R-backlog-28 and R-goal-43.
- **R-rm-3 (the plan endpoints and the forward cap)** — `GET /api/plan` and `PUT /api/plan` are deleted; `ENDPOINTS.plan` and `planRoutes` go with them, and the route-surface census must show no `/plan` path. **`PLAN_AHEAD_WEEKS` is deleted** and never replaced with another number: there is no forward cap at any horizon (owner decision 5, R-goal-36, R-lens-7). `WEEK_HISTORY_WEEKS` stops being a bound; if a constant of that name survives at all it is a picker window size and must be renamed so it cannot be mistaken for a limit (R-lens-7). `WeekOffset` / `WeekOffsetParam`'s `.max(0)` is removed — **and `CompleteTaskRequest.week` must gain an explicit `.max(0)` in the same change**, because it inherits its future-week guard from that bound today and would lose it with no diff on its own line (R-task-44).
- **R-rm-4 (the goal-filter pills)** — Deleted, not hidden: the `All` chip and the per-Life-root pills on the Tasks header, `TasksQuery.goalId`, `GoalFilterQuery`, `taskGoalFilter` / `setTaskGoalFilter`, `backlogGoalFilter` / `setBacklogGoalFilter`, and the week-change filter reset (R-nav-6). Their open-task counts survive on the Life-goal group headers (R-lens-4, owner decision 7); nothing else about them does. No lens gains a filter of any kind (R-lens-15).
- **R-rm-5 (the Tasks screen, the plan screen, and the whole-tree read)** — Deleted: `TasksScreen` with its `Section` and `WeekSwitcher`; `PlanScreen`; `GoalsScreen`'s recursive `Rows` tree renderer with its per-node expand/collapse and `toggleCollapsed` state; the `Edit plan` and `Plan this week` entry points; `InactiveBranchSheet`; the `TaskDetailSheet` **as a sheet** (it becomes R-task-45's page). The `GET /api/tasks?week=` endpoint **survives** as the Weekly lens's data source — the screen goes, the read does not. The `GET /api/goals` **whole-tree** read model does **not** survive: it is replaced by the scoped lens read (R-lens-16).

- **R-rm-6 (the Monthly `+ Task` inference — deleted outright)** ⚠ **A8** — R-task-49's flow **was built** and must be removed, not left dormant. Its purpose was to paper over the missing month-level task; a Monthly goal now holds the task (R-task-51), so nothing is inferred and nothing may remain that infers. What must not exist:
  - **Web:** `MonthlyCard`'s `targetWeek` computation and its `weekForMonth` import (`apps/web/src/lens/cards.tsx`); `LinkRow`'s `horizon === 'Weekly' ? … : { newWeekly: … }` fork and its `weekStart` prop, which becomes one unconditional branch per horizon; `TaskCreateSheet`'s implicit-goal path when opened from a Monthly card — the `newWeekly` sheet field, `willCreateGoal`, `implicitWeeklyGoalNote` (`apps/web/src/lens/copy.ts`), the `weeklyPicker`/`weeklyTarget` invocation from that entry point, the `landedWeek` navigation and its toast (`apps/web/src/components/BacklogSheets.tsx`); the focus-move-on-arrival behaviour for this flow (UX §8).
  - **Copy:** `This starts a weekly goal "<title>" for the week of <Mon d Mon>. You can rename it after.` and the live-region line `Added to week of Mon 31 Aug, under <goal>.` — both describe a create that no longer happens.
  - **Surviving deliberately, and audited rather than assumed:** `weekForMonth` itself (two remaining consumers — R-lens-9's Monthly → Weekly zoom and R-goal-47's planned-ness scope); `TaskCreateSheet`'s `newWeeklyGoal` field and `CreateTaskRequest.newWeeklyGoal` (R-task-48, two callers left — R-task-56's Park and R-backlog-31's week path); R-nav-31's `weeklyTarget` picker mode (same two callers).
  - **Spec:** R-task-49 (RETIRED), S-nav-31-4's `+ Task` premise (restated against Park), UX-PLAN §6.7.1 and §6.4's Monthly-card `+ Task` description, and Q-20's ruling, which A8 makes moot rather than reverses.
  - **`NOT_A_WEEKLY_GOAL` is retired with it** and replaced by `NOT_A_TASK_GOAL` (R-task-51): the string must not survive in an error catalogue, an MCP recovery line, a test, or client error copy.

### Auth

- **R-auth-1** — The product is single-user-per-account: one person's cascade. There is no sharing, no delegation, no multi-tenant goal tree, and no collaborator role. (The mockup has no auth surface at all; this is the recommended baseline — see §4 Q-1.)
- **R-auth-2 (ownership scoping)** ⚠ **modified by A2 — `WeeklyFocus` and `Idea` leave the list of owned entities (R-rm-1, R-rm-2); the scoping rule is unchanged** — Every Goal, WeeklyFocus, Task, TaskEvent, BacklogItem, Idea, and Learning belongs to exactly one owner. Every read is scoped to the caller's owner id; every write asserts ownership of the target **and** of every referenced entity (e.g. a task's `goalId`, a backlog item's move target).
- **R-auth-3** — A reference to another owner's entity is indistinguishable from a non-existent one: refuse identically, leaking nothing about existence.
- **R-auth-4** — An unauthenticated request is refused for every operation, including reads. There is no public or demo mode.
- **R-auth-5** — "The current week" is computed from the owner's timezone, stored on the account, not from the client clock — otherwise `originWeek`, carry ages, and plan editability differ per device. (§4 Q-9.)
- **R-auth-6** — The seed data in `apps/web/src/data/mock.ts` (`g1`…`g15`, `t1`…`t7`, `b1`…`b5`) is fixture data only. No production default tree, no hardcoded ids (`g3`, `g4`) may survive into the real client. (§5 D-26.)

---

## 3. Testable scenarios

### Goal — create

- **S-goal-5-1** ⚠ **modified by A2 and re-pointed by S-goal-48-3 (A3) — the legal set under a Quarterly goal is `Monthly` *and* `Weekly` now that Weekly is a horizon (R-goal-30/32); the default is still `Monthly`** (R-goal-5, happy) — *Given* a Quarterly goal `Q`. *When* the user adds a sub-goal under `Q`. *Then* the horizon picker offers only `Monthly` ~~and nothing else~~ **and `Weekly`**, the horizon defaults to `Monthly`, the period defaults to the current month, and the created goal has `parentId = Q`.
- **S-goal-5-2** (R-goal-5, unhappy) — *Given* a Yearly goal `Y`. *When* a create is submitted with `parentId = Y` and `horizon = 'Yearly'`. *Then* it is refused for equal rank and no goal is created.
- **S-goal-5-3** (R-goal-5, unhappy) — *When* a create is submitted with `parentId` = a Monthly goal and `horizon = 'Quarterly'` (parent rank > child rank). *Then* it is refused and no goal is created.
- **S-goal-6-1** ⚠ **superseded by S-goal-31-1 (A2) — the terminal horizon is Weekly; a sub-goal under a Monthly goal is now legal** (R-goal-6, unhappy — sub-goal under a Monthly goal) — *Given* a Monthly goal `M`. *Then* no `+ Sub-goal` affordance is rendered on `M`'s row or detail screen; *and when* a create with `parentId = M` is submitted directly (any horizon), it is refused with "Monthly goals cannot have sub-goals" and `M` still has zero children.
- **S-goal-4-1** (R-goal-4, unhappy) — *When* a non-Life goal is created with no `parentId`. *Then* it is refused; the Create button is disabled in the client.
- **S-goal-3-1** (R-goal-3, happy) — *When* a Life goal is created. *Then* `parentId = null`, `period = ''`, and the period field is not offered.
- **S-goal-29-1** (R-goal-29, unhappy) — *When* a goal is created with title `"   "`. *Then* it is refused as a validation error; no goal is created.
- **S-goal-13-1** ⚠ **superseded by S-goal-33-1 (A2) — the field is `periodKey`** (R-goal-13, happy) — *Given* today is 2026-08-31. *When* the horizon `Quarterly` is chosen. *Then* the period pre-fills `Q3 2026` (the quarter containing today), not a hardcoded literal.

### Goal — edit

- **S-goal-14-1** (R-goal-14, happy) — *When* a goal's title, why, period and pulse are edited. *Then* all four persist and `horizon` and `parentId` are unchanged.
- **S-goal-14-2** (R-goal-14, unhappy) — *When* an edit payload includes a different `horizon` or `parentId`. *Then* those keys are refused (or ignored) and the stored horizon/parent are unchanged; re-parenting must go through Move.

### Goal — move

- **S-goal-18-1** (R-goal-18, unhappy — into a descendant) — *Given* Life `L` › Yearly `Y` › Quarterly `Q` › Monthly `M`. *When* the user opens Move on `Y`. *Then* `Q` and `M` are listed disabled with the reason `its own descendant`, and `Y` itself is disabled with the same reason. *And when* a move of `Y` under `Q` is submitted directly. *Then* it is refused and no cycle is created.
- **S-goal-18-2** (R-goal-18, unhappy — into a shorter horizon) — *Given* Quarterly `Q` and Monthly `M` in an unrelated branch. *When* the user opens Move on `Q`. *Then* `M` is listed disabled with the reason `horizon conflict` (not `its own descendant`). *And when* a move of `Q` under `M` is submitted directly. *Then* it is refused.
- **S-goal-19-1** (R-goal-19, ordering of reasons) — *Given* a goal `Q` (Quarterly) with a Monthly child `M`. *When* Move is opened on `Q`. *Then* `M` shows exactly one reason, `its own descendant` — the descendant check wins over the horizon check.
- **S-goal-17-1** (R-goal-17, happy) — *Given* Quarterly `Q` with a Monthly child under Yearly `Y1`, and another Yearly `Y2`. *When* `Q` is moved under `Y2`. *Then* `Q.parentId = Y2`, `Q.horizon` is still Quarterly, its Monthly child still hangs off `Q`, and the whole subtree still satisfies R-goal-7.
- **S-goal-20-1** (R-goal-20, happy) — *When* a valid target is selected in the Move sheet. *Then* the preview reads `<goal> will move under <Life › … › target>` and the confirm button becomes enabled; with no target selected the button is disabled.
- **S-goal-28-1** ⚠ **RETIRED by A2 — the transition is unreachable (R-goal-42)** (R-goal-28, unhappy) — *Given* an **active** leaf `A` with a focus and two open tasks. *When* a sub-goal is created under `A` (or a goal is moved under `A`). *Then* `A` is no longer a leaf, `A`'s current-week focus is deleted, and no task or focus is left referencing a non-leaf goal (per D-8's re-parent-or-refuse decision).
- **S-goal-21-1** (R-goal-21, unhappy) — *When* a Move or Re-plan is attempted on a Life goal. *Then* the affordances are absent and a direct request is refused.

### Goal — re-plan, dormancy, aggregates

- **S-goal-22-1** (R-goal-22, happy) — *When* a Monthly goal is re-planned to the next month with no reason. *Then* `period` becomes the chosen month, the operation succeeds, and the toast reads `Re-planned to <period>`.
- **S-goal-23-1** ⚠ **superseded by S-goal-40-1 (A2)** (R-goal-23, happy) — *Given* today is in September 2026 and a Monthly goal. *When* the re-plan sheet opens. *Then* the options are `Oct 2026` and `Nov 2026`, derived from today — and given today is in December 2026, they are `Jan 2027` and `Feb 2027`.
- **S-goal-9-1** ⚠ **RETIRED by A2 — it asserts a focus row** (R-goal-9, unhappy) ⚠ **narrowed by A1** — *Given* a non-leaf goal that has a focus row from before it gained a child. *Then* it is reported as not active. *And* it holds no focus row for the current week **or any later week** — those must not exist (R-goal-28). *But* its rows for weeks already past survive and still render when those weeks are viewed: at the time they were written the goal was a leaf, and history stays truthful (D-2).
- **S-goal-10-1** ⚠ **RETIRED by A2 — no goal is ever muted or labelled DORMANT (R-goal-38)** (R-goal-10, happy) — *Given* a non-Life leaf with no focus this week. *Then* its tree row is muted and reads `DORMANT — no focus this week`, and its detail screen shows the DORMANT block.
- **S-goal-11-1** ⚠ **superseded by S-goal-38-1 (A2) — dormancy is read off `periodKey` and has no styling** (R-goal-11, happy) — *Given* Life `L` › Yearly `Y` › Quarterly `Q` › Monthly `M`, with `M` active. *Then* `L`, `Y` and `Q` all render un-muted. *When* `M`'s focus is cleared. *Then* all four render muted.
- **S-goal-11-2** ⚠ **RETIRED by A2 — nothing is muted** (R-goal-11, happy) — *Given* Yearly `Y` with two Quarterly children, one holding an active leaf and one entirely dormant. *Then* `Y` is un-muted and the dormant Quarterly is muted.
- **S-goal-24-1** (R-goal-24, happy) — *Given* under Life `L`: one open task with origin 3 weeks ago and one with origin 1 week ago. *Then* `L`'s card reads `2 tasks carrying · oldest 3 weeks`.
- **S-goal-24-2** (R-goal-24, happy) — *Given* every task under `L` is either done or originated this week. *Then* no carrying line is rendered on `L`.
- **S-goal-24-3** (R-goal-24, copy) — *Given* exactly one carrying task, one week old. *Then* the line reads `1 task carrying · oldest 1 week` (singular both times).

### ~~Plan~~ ⚠ **A2 — RETIRED IN FULL (R-rm-2)**

Every scenario below asserts `weekly_focus` behaviour. Two survive as re-pointed fixtures: **S-plan-9-1 / S-plan-9-2** move to R-backlog-28 (the pull list, now on a Weekly goal page), and **S-plan-15-3** — the proof that a past period is byte-identical after a refused write — moves to R-lens-10 and is restated as S-lens-10-1. Nothing else here may be implemented.

- **S-plan-5-1** (R-plan-5, happy) — *Given* a dormant leaf. *When* it is checked, a sentence is typed, and the plan is saved. *Then* the leaf is active, its focus is the trimmed sentence, and it appears on the Tasks screen for week 0.
- **S-plan-5-2** (R-plan-5, unhappy) — *When* a leaf is checked but the sentence is left blank and the plan is saved. *Then* no focus is stored, the leaf is dormant, and the user is told the check did not stick (not silently dropped).
- **S-plan-6-1** (R-plan-6, happy) — *Given* an active leaf with two open tasks. *When* it is unchecked and the plan saved. *Then* its focus is cleared, it renders dormant, and both tasks still exist and remain visible in week 0 (R-task-9).
- **S-plan-2-1** (⚠ now R-plan-15, unhappy — text unchanged, rule re-pointed) — *Given* the viewed week is `-2`. *Then* `Edit plan` is not rendered; *and* a plan-save request naming a past week is refused (with `WEEK_NOT_PLANNABLE`).
- **S-plan-7-1** (R-plan-7, happy) — *Given* leaves `A` (active) and `B` (dormant). *When* the plan is saved with `A` unchecked and `B` checked with a sentence. *Then* in one transaction `A`'s focus is removed and `B`'s is created.
- **S-plan-9-1** (R-plan-9, happy) — *Given* a checked leaf `M` whose Quarterly parent holds backlog item `X` and whose Monthly self holds item `Y`, and an unrelated Yearly goal holds `Z`. *Then* `FROM THE BACKLOG` under `M` lists `X` and `Y` and not `Z`.
- **S-plan-9-2** (R-plan-9, happy) — *When* a listed backlog item is tapped. *Then* the task-create modal opens pre-filled with the item's title and bound to that leaf.
- **S-plan-8-1** (R-plan-8, unhappy) — *When* a plan-save payload includes a focus for a Life goal or a non-leaf goal. *Then* it is refused.

#### Plan — Amendment 1

- **S-plan-13-1** (R-plan-13, happy) — *Given* a dormant leaf `M`. *When* the plan is saved with three sentences for `M` in the current week. *Then* three focus rows exist for `(M, thisWeek)`, `M` is active, and its Tasks-screen section lists all three in order.
- **S-plan-13-2** (R-plan-13, unhappy) — *When* a plan-save names six sentences for one leaf in one week. *Then* it is refused as a validation failure and **none** of the six is written; the leaf's existing focus set is unchanged.
- **S-plan-13-3** (R-plan-13, happy) — *Given* three sentence fields for `M`, the middle one left blank. *When* the plan is saved. *Then* two rows exist, in the order the two non-blank fields appeared, and no empty row was created.
- **S-plan-13-4** (R-plan-13/R-plan-18, unhappy) — *When* `M` is checked and **all** its sentence fields are blank. *Then* no row is written, `M` is dormant, and the user is told the check did not stick (D-9) — the same surfaced failure as S-plan-5-2, not a silent drop.
- **S-plan-14-1** (R-plan-14, happy) — *Given* `M` holds sentences `A, B, C`. *When* the plan is re-saved with the fields ordered `C, A, B`. *Then* a refetch returns `C, A, B`; the order is the request's, not `createdAt`'s, and is identical on every subsequent read.
- **S-plan-15-1** (R-plan-15, happy) — *When* the plan is saved for offset `+2` with one sentence for `M`. *Then* the row is stored against that Monday, `M` is active when week `+2` is viewed, and `M` is unchanged (dormant, if it was) in week 0.
- **S-plan-15-2** (R-plan-15, unhappy) — *When* a plan-save names offset `+5`. *Then* it is refused with `WEEK_NOT_PLANNABLE`, nothing is written, and offset `+5` is unreachable from the week switcher.
- **S-plan-15-3** (R-plan-15, unhappy — history stays truthful) — *Given* week `−1` holds two focus rows. *When* a plan-save names week `−1`. *Then* it is refused with `WEEK_NOT_PLANNABLE` and both rows are byte-identical afterwards (D-2).
- **S-plan-16-1** (R-plan-16, happy) — *Given* focus rows in weeks 0, `+1` and `+2`. *When* the plan for `+1` is saved with a different set. *Then* only `+1`'s rows change; weeks 0 and `+2` are untouched.
- **S-plan-16-2** (R-plan-16, happy) — *Given* a focus row created three weeks ago for week `+1`. *When* the `+1` plan is re-saved with that row's `id` and an unrelated new sentence added. *Then* the original row keeps its `createdAt` (so R-plan-19 still measures three weeks), the new row is inserted, and both carry re-assigned `sortKey`s.
- **S-plan-16-3** (R-plan-16, unhappy) — *When* a plan-save for `+1` contains one entry naming a Life goal among nine valid entries. *Then* the whole save is refused (`NOT_A_LEAF`) and week `+1` is exactly as it was — never partially applied (Q-3).
- **S-plan-19-1** (R-plan-19, happy) — *Given* a sentence written for a week three weeks before that week began, and that week is now the current week. *Then* a muted line reads `planned 3 weeks ago` beneath it, with no chip, no colour and no prompt.
- **S-plan-19-2** (R-plan-19, happy — the two silent cases) — *Given* a sentence written last week for this week (`plannedAgeWeeks = 1`). *Then* no label. *And given* a sentence written three weeks ago for a week that has **not** arrived yet, viewed at that future week. *Then* still no label: it is early, not stale.
- **S-plan-20-1** (R-plan-20, unhappy) — *When* a planned week becomes the current week. *Then* nothing is written, nothing is asked, and no route, screen or sheet exists for confirming, reviewing or re-validating the arrived plan (R-nav-14).

### Task — visibility and carry

- **S-task-7-1** (R-task-7, happy) — *Given* an open task with `originWeek = −2`. *Then* it is visible in weeks −2, −1 and 0, with no prompt or confirmation on any transition.
- **S-task-7-2** (R-task-7, unhappy) — *Given* an open task with `originWeek = 0`. *Then* it is **not** visible when week −1 is viewed.
- **S-task-8-1** (R-task-8, happy) — *Given* a task with `originWeek = −2` completed in week −1. *Then* it is visible only in week −1: absent from week −2 and from week 0.
- **S-task-10-1** (R-task-10, happy) — *Given* an open task with `originWeek = −1`, viewed in week 0. *Then* a gray label reads `since <Monday of originWeek>` with no chip styling.
- **S-task-11-1** (R-task-11, happy — carrying 2+ weeks) — *Given* an open task with `originWeek = −3`, viewed in week 0. *Then* a red chip reads `3 weeks · since <Monday of originWeek>`, and no popup, modal, or nag is shown.
- **S-task-11-2** (R-task-11, boundary) — *Given* an open task with `originWeek = −2`, viewed in week −1 (age 1). *Then* the gray one-week label is shown, not the red chip: the label depends on the **viewed** week, not on today.
- **S-task-12-1** (R-task-12, happy) — *Given* a task created this week, viewed in week 0. *Then* no carry label is rendered.
- **S-task-9-1** ⚠ **superseded by S-lens-12-2 (A2) — the carried band replaces the dormant-leaf section** (R-task-9, happy) — *Given* a dormant leaf carrying one open task. *Then* the Tasks screen shows a section for that leaf containing the task, with no focus sentence and no `+ Task` button.

### Task — exits

- **S-task-14-1** (R-task-14, happy — complete in a past week) — *Given* an open task with `originWeek = −2` and the viewed week is `−1`. *When* the checkbox is ticked. *Then* `doneWeek = −1`, a `Completed` event is logged, the task disappears from week 0, and it is shown as done only in week −1.
- **S-task-14-2** (R-task-14, unhappy) — *When* a complete is submitted naming a week earlier than the task's `originWeek`, or a future week. *Then* it is refused.
- **S-task-13-1** (R-task-13, unhappy) — *When* any exit other than complete / move-to-backlog / cancel is requested (defer, snooze, reschedule, move-to-another-week). *Then* no such operation exists and the request is refused.
- **S-task-15-1** (R-task-15, happy) — *Given* an open task under Monthly goal `M` with a description and one link. *When* Move to Backlog is confirmed with a reason. *Then* the task no longer appears in any week, a backlog item exists on `M` carrying the title, description and link, its `fromWeek` is the week the task was live in, and the toast reads `Moved to Backlog — reason noted`.
- **S-task-15-2** (R-task-15, happy) — *When* Move to Backlog is confirmed with the reason left blank. *Then* it still succeeds and the toast reads `Moved to Backlog`.
- **S-task-16-1** (R-task-16, happy) — *When* Cancel is confirmed with an optional reason. *Then* the task leaves every week and the reason is retained on the record (D-15), toast `Task canceled`.
- **S-task-17-1** (R-task-17, unhappy) — *Given* a done task. *Then* the detail sheet offers neither `Move to Backlog` nor `Cancel task`, and a direct move/cancel on a done task is refused.

### Task — uncheck

- **S-task-19-1** (R-task-19, happy — unchecking a task completed three weeks ago) — *Given* a task with `originWeek = −4`, completed in week −3, and the viewed week is `−3`. *When* it is unchecked. *Then* `doneWeek = null`, `doneAt = null`, `done = false`, `originWeek` stays `−4`, an `Unchecked` event is logged, and the task now appears as open in weeks −4 through 0 — showing a red `4 weeks · since …` chip in week 0.
- **S-task-19-2** (R-task-19, happy) — *Given* the same task after the uncheck. *Then* no new task was created and its activity history (Created, Completed, Unchecked) is intact and ordered newest first.
- **S-task-21-1** (R-task-21, happy) — *After* any uncheck, the inline `Update the done-condition?` prompt appears pre-filled with the current condition. *When* `Skip` is pressed. *Then* the condition is unchanged and no event is logged.
- **S-task-21-2** (R-task-21, happy) — *When* a changed condition is saved from that prompt. *Then* `cond` updates and one `Done-condition edited: "<old>" → "<new>"` event is logged with both values truncated per R-task-27.
- **S-task-21-3** (R-task-21, unhappy) — *When* the prompt is saved with the value unchanged, or with only whitespace. *Then* nothing is written and no event is logged.
- **S-task-20-1** (R-task-20, happy) — *Given* a task whose leaf went dormant after the task was completed. *When* it is unchecked. *Then* the uncheck succeeds and the task's `goalId` is unchanged.

### Task — creation, editing, activity

- **S-task-5-1** ⚠ **RETIRED by A2 — there is no target-week parameter to fall back (R-task-40)** (⚠ now R-task-34, happy) — *Given* the viewed week is `−2`. *When* a task is created from an Idea or the `+` drawer. *Then* the target week falls back to the **current** week (the viewed week is not plannable), `originWeek` is that Monday, and the task does not appear in week −2 and does appear in week 0.
- **S-task-4-1** ⚠ **superseded by S-task-48-1 (A2) — the answer is an inline weekly-goal field, not a dead end** (R-task-4, unhappy) — *Given* no leaf is active this week. *When* the task-create modal is opened from any source. *Then* it offers no target, creation is blocked, and the user is routed to weekly planning — never to a hardcoded fallback goal.
- **S-task-3-1** (R-task-3, happy) — *When* a task is saved with a title and no done-condition. *Then* it is created with `cond = ''` and no validation error.
- **S-task-3-2** (R-task-3, unhappy) — *When* a task is saved with a whitespace-only title. *Then* it is refused and the Save button stays disabled.
- **S-task-23-1** (R-task-23, happy) — *When* title, condition and description are all changed and saved in one edit. *Then* exactly three events are logged (Renamed, Done-condition edited, Description updated), newest first, and the toast reads `Task updated`.
- **S-task-27-1** (R-task-27, happy) — *When* a done-condition is changed from `''` to a 40-character string. *Then* the event text reads `Done-condition edited: "(none)" → "<first 24 chars>…"`.
- **S-task-24-1** (R-task-24, happy) — *When* `https://www.github.com/acme/pr/1` is added as a link. *Then* the event reads `Link added: github.com`.
- **S-task-24-2** (R-task-24, unhappy) — *When* an unparseable string longer than 28 chars is added. *Then* the label falls back to the first 28 chars + `…` and the link is still stored (or refused per Q-11's chosen validation).
- **S-task-29-1** (R-task-29, happy) — *Given* an open task with `originWeek = −2`. *Then* its timeline contains exactly two `Carried to week of …` entries (for weeks −1 and 0), each logged once, with no user interaction at any point.
- **S-task-30-1** (R-task-30, unhappy) — *When* a client attempts to create, edit, or delete a TaskEvent. *Then* it is refused; the timeline is append-only and server-authored.
- **S-task-31-1** (R-task-31, happy) — *For* every operation in R-task-30's table, performing it produces exactly one event of the stated type with the stated glyph, and performing a no-op edit produces none.

#### Task — Amendment 1

- **S-task-33-1** ⚠ **RETIRED by A2 — there are no focus sentences; S-task-40-3 pins the surviving ruling** (R-task-33, unhappy) — *When* a task create or patch carries a `focusId` (or any per-sentence reference). *Then* it is refused as an unknown key; no such field exists on the Task entity, the request schema, or any read model.
- **S-task-33-2** ⚠ **RETIRED by A2 — there are no focus sentences** (R-task-33, happy) — *Given* a leaf holding three sentences this week and two tasks. *Then* both tasks reference only the leaf and the week, and the Tasks screen renders the three sentences above one undivided list of task rows — no grouping by sentence anywhere.
- **S-task-34-1** (R-task-34, happy) — *Given* the viewed week is `+2` and leaf `M` is active in `+2`. *When* `+ Task` is used. *Then* `originWeek` is that Monday, the task is visible at `+2` and `+3`, and it is **not** visible at week 0 or `+1`.
- **S-task-34-2** ⚠ **RETIRED by A2 — there is no forward cap to exceed (R-lens-7)** (R-task-34, unhappy) — *When* a create names target week `+5`. *Then* it is refused with `WEEK_OUT_OF_RANGE` and no task is created.
- **S-task-34-3** ⚠ **superseded by S-backlog-26-2 (A2) — `BRANCH_NOT_ACTIVE` becomes `NO_WEEKLY_GOAL`** (R-task-34, unhappy) — *Given* `M` is active in week 0 but has no focus in `+1`. *When* a create names `+1` with `goalId = M`. *Then* it is refused with `BRANCH_NOT_ACTIVE` naming week `+1` — activity is read against the **target** week, not today.
- **S-task-34-4** ⚠ **re-pointed to R-task-41 (A2), text unchanged — the refusal code becomes `PERIOD_IN_PAST` and the guard is the Weekly parent** (R-task-34, unhappy — no back-dating) — *When* a create names target week `−1`. *Then* it is refused with `WEEK_OUT_OF_RANGE`; and no create affordance is rendered at any past week, from any of the four sources.
- **S-task-34-5** ⚠ **RETIRED by A2 — the Idea source is deleted and the drawer has no week choice** (R-task-34, happy) — *When* an Idea's `Task this week` or the `+` drawer's `Add to this week instead` is used while viewing `+2`. *Then* the task is created into the **current** week, because those two fast-capture paths have no week choice by design.
- **S-task-35-1** (R-task-35, unhappy) — *Given* a task with `originWeek = +1`. *When* a completion is submitted for `+1`, or for week 0, or for any week. *Then* every one is refused with `WEEK_OUT_OF_RANGE`: `originWeek ≤ week ≤ currentWeek` has no solution. *And* no checkbox is rendered on that row at `+1`.
- **S-task-35-2** (R-task-35, happy) — *Given* the same task once its week has arrived (it is now week 0). *When* the checkbox is ticked. *Then* it completes normally with `doneWeek = thisWeek`, and a `Completed` event is logged.
- **S-task-36-1** (R-task-36, happy) — *Given* an open task with `originWeek = +2`. *When* Cancel is confirmed with an optional reason. *Then* the task leaves every week, the reason is retained, and the toast reads `Task canceled` — no new exit was invented (R-task-13).
- **S-task-36-2** (R-task-36, happy) — *Given* the same task. *When* Move to Backlog is confirmed from week `+2`. *Then* a backlog item exists on its goal with `fromWeek` = that future Monday, rendering `from week of <d Mon>`.
- **S-task-37-1** ⚠ **superseded by S-task-43-1 (A2) — the age is −1, not clamped to 0** (R-task-37, happy — the rule that must not fire) — *Given* an open task with `originWeek = +1`, viewed at `+3`. *Then* `carryWeeks = 0`: no grey label and **no red chip**. The naive `viewWeek − originWeek` would read 2 and escalate work nobody is late with.
- **S-task-37-2** (R-task-37, happy) — *Given* an open task with `originWeek = −3`, viewed at `+2`. *Then* `carryWeeks = 3` and the red `3 weeks · since …` chip renders: it is late today and still open then.
- **S-task-37-3** (R-task-37, boundary — S-task-11-2 unchanged) — *Given* an open task with `originWeek = −2`, viewed at `−1`. *Then* the clamp is inert (`min(−1, 0) = −1`), age is 1, and the grey one-week label renders exactly as before.
- **S-task-38-2** (R-task-38 / R-task-29, unhappy) — *Given* an open task with `originWeek = −2`. *When* week `+3` is viewed. *Then* the task is listed there, and **no** `Carried to week of …` event is appended for weeks `+1`, `+2` or `+3`; the timeline still holds exactly the two entries S-task-29-1 requires.
- **S-task-38-1** ⚠ **modified by A2 — the pill assertion becomes R-lens-4 group-header counts; the visibility half stands** (R-task-38, happy) — *Given* one open task with `originWeek = +1` and one with `originWeek = 0`, both under Life root `L`. *When* week 0 is viewed. *Then* only the second is listed, `L`'s filter pill reads `1`, and `L`'s card shows no carrying line. *When* week `+1` is viewed. *Then* both are listed and the pill reads `2`.

### Backlog

- **S-backlog-2-1** (R-backlog-2, unhappy) — *When* a backlog item is created or moved with `goalId` = a Life goal. *Then* it is refused. *And* no goal picker in any backlog flow lists a Life goal.
- **S-backlog-6-1** (R-backlog-6, happy) — *Given* a backlog item `X` on Monthly goal `M`, which is active. *When* `Add to this week` is used and the task saved. *Then* one task exists under `M` with `X`'s title, description and links and a `Created — pulled from Backlog` event, **and** `X` no longer exists in the backlog — not on `M`, not anywhere.
- **S-backlog-6-2** (R-backlog-6, unhappy — converting a backlog item twice) — *Given* item `X` was converted in one session. *When* a second conversion of `X` is submitted (a stale open modal, a retried request, a second device). *Then* it is refused as already converted, **no second task is created**, and the first task is untouched.
- **S-backlog-6-3** (R-backlog-6, unhappy) — *When* the pre-filled task-create modal is abandoned without saving. *Then* the backlog item still exists and no task was created.
- **S-backlog-8-1** ⚠ **superseded by S-backlog-26-2 (A2) — new code and new copy** (R-backlog-8, unhappy — pull into a dormant branch) — *Given* item `X` on Quarterly goal `Q` and no leaf at or under `Q` has a focus this week. *When* `Add to this week` is tapped. *Then* no task-create modal opens; the sheet `This branch isn't active this week` appears with body `"<X title>" can only become a task under an active weekly focus.` and the two actions.
- **S-backlog-8-2** ⚠ **superseded by S-backlog-26-2 (A2)** (R-backlog-8, happy) — *From* that sheet, `[Set a weekly focus]` navigates to weekly planning and `[Cancel]` dismisses; in both cases `X` is unchanged and no task exists.
- **S-backlog-8-3** ⚠ **re-pointed to R-backlog-26 (A2) — the server-side guard is unchanged in force** (R-backlog-8, unhappy) — *When* a conversion is submitted directly against a goal with no active leaf under it. *Then* the server refuses it; the client-side prompt is not the only guard.
- **S-backlog-7-1** ⚠ **re-pointed to R-backlog-26 (A2) — "active leaf" reads "Weekly goal for the target week"** (R-backlog-7, happy) — *Given* item `X` on Quarterly `Q` with exactly one active leaf `M` beneath it. *When* `X` is converted. *Then* the created task's `goalId` is `M`.
- **S-backlog-7-2** ⚠ **re-pointed to R-backlog-26 (A2) — the ambiguity ruling is unchanged** (R-backlog-7, unhappy) — *Given* item `X` on Quarterly `Q` with **two** active leaves beneath it. *When* `X` is converted from the Backlog page. *Then* the user is asked which focus receives it; no silent pick is made.
- **S-backlog-9-1** (R-backlog-9, unhappy) — *When* a conversion names a backlog item that was deleted or moved. *Then* it is refused and no task is created.
- **S-backlog-10-1** (R-backlog-10, happy) — *When* an item is moved to another non-Life goal. *Then* its `goalId` updates, it re-groups under the new branch path, its `capturedAt` and `fromWeek` are unchanged, and the toast names the new goal.
- **S-backlog-12-1** (R-backlog-12, happy — read-only aggregate) — *Given* Life goal `L` with items on its Yearly, Quarterly and Monthly descendants. *When* `L`'s detail screen is opened. *Then* all of them are listed under `Backlog across this line (N)`, each labelled with its owning goal title and captured date, with **no** per-item action (no add-to-week, no move, no delete) — only `Open Backlog →`.
- **S-backlog-12-2** (R-backlog-12, unhappy) — *Given* `L` has no descendants holding items. *Then* the block reads `Nothing deferred anywhere on this line.`
- **S-backlog-11-1** (R-backlog-11, happy) — *Given* Monthly goal `M` holding two items. *Then* `M`'s detail screen shows `Backlog (2)` listing only `M`'s own items, with `+ Add` quick capture and per-item actions.
- **S-backlog-15-1** ⚠ **re-pointed to R-backlog-27 (A2)** (R-backlog-15, happy) — *When* the `+` drawer is saved with `Also add to the current week` ticked and an active leaf under the chosen goal. *Then* exactly one entity exists: a task. No backlog item is created.
- **S-backlog-15-2** ⚠ **re-pointed to R-backlog-27 (A2) — the toast copy changes** (R-backlog-15, unhappy) — *When* the same is saved but no leaf under the chosen goal is active. *Then* exactly one backlog item is created, no task, and the toast explains why.
- **S-backlog-5-1** (R-backlog-5, happy) — *Given* three items captured on different days. *Then* they list newest-first within their group, and a newly created item appears at the top.

#### Backlog — Amendment 1

- **S-backlog-17-1** (R-backlog-17, happy) — *Given* goal `M` holding items `A, B, C` (newest first). *When* `C` is moved to the top. *Then* the order is `C, A, B` on the Backlog page, on `M`'s detail screen, and after a full refetch — and every item's `capturedAt` is unchanged.
- **S-backlog-17-2** (R-backlog-17, happy — total and stable) — *Given* two items inserted in the same millisecond. *Then* the list order is identical on every read, resolved by `capturedAt` desc then `id` desc; no read ever returns a different arrangement of an unchanged list.
- **S-backlog-18-1** (R-backlog-18, happy) — *Given* `M`'s list has been manually re-ordered to `C, A, B`. *When* a new item `D` is captured on `M`. *Then* the list is `D, C, A, B`.
- **S-backlog-19-1** (R-backlog-19, happy) — *When* a reorder names `after: <B.id>`. *Then* the item lands immediately after `B`, and the command carried no position index.
- **S-backlog-19-2** (R-backlog-19, unhappy) — *When* a reorder names a neighbour belonging to a different goal, or a converted item. *Then* it is refused and no order changes.
- **S-backlog-19-3** (R-backlog-19, unhappy) — *When* a reorder carries a stale `version`. *Then* it is refused with `CONCURRENT_UPDATE`, the stored order is unchanged, the row returns to its original position on screen, and R-backlog-23's failure line is announced alongside a non-toast error (Q-14).
- **S-backlog-20-1** (R-backlog-20, happy) — *Given* `M` = `C, A, B` and goal `N` = `X, Y`. *When* `A` is moved to `N`. *Then* `N` = `A, X, Y`, `M` = `C, B`, and `A`'s `capturedAt` and `fromWeek` are unchanged (S-backlog-10-1 still holds).
- **S-backlog-20-2** (R-backlog-20, happy) — *When* the middle item of a manually ordered list is converted to a task or deleted. *Then* the survivors keep their relative order and no sibling was re-keyed.
- **S-backlog-21-1** (R-backlog-21, happy) — *Given* Life goal `L` whose three descendant goals each have a manual order. *When* `L`'s detail screen is opened. *Then* the read-only aggregate is ordered `capturedAt` desc across all three, ignoring every per-goal manual order — and no reorder affordance is rendered there.
- **S-backlog-22-1** (R-backlog-22, happy — keyboard only, no pointer) — *When* the user tabs to an item's `Reorder` control, presses `Enter`, presses `↓` twice, and presses `Enter`. *Then* the item has moved two positions, the new order is persisted, and focus is still on that item's `Reorder` control.
- **S-backlog-22-2** (R-backlog-22, happy) — *When* `Escape` is pressed mid-grab. *Then* the item returns to its original position, **nothing is written**, and focus stays on its control.
- **S-backlog-22-3** (R-backlog-22, unhappy — the regression guard) — *Then* every reorder affordance is present in the DOM without any pointer event having occurred, is reachable by keyboard, passes the enforced contrast rule, and the row menu offers `Move up` / `Move down` / `Move to top` / `Move to bottom`. A drag-only implementation, or a handle revealed only on hover, fails this scenario and therefore the build.
- **S-backlog-23-1** (R-backlog-23, happy) — *When* a full keyboard reorder is performed. *Then* the live region emits, in order, the pick-up line, one position line per arrow press, and the drop line — with the region `assertive` for the duration of the grab and `polite` afterwards.
- **S-backlog-25-1** ⚠ **re-pointed to R-backlog-26 (A2)** (R-backlog-25, happy) — *Given* item `X` on Quarterly `Q`, and leaf `M` under `Q` active in week `+1`. *When* `X` is converted with target week `+1`. *Then* one task exists under `M` with `originWeek = +1`, `X` is `converted`, and the task logs `Created — pulled from Backlog`.
- **S-backlog-25-2** ⚠ **superseded by S-backlog-26-2 (A2)** (R-backlog-25, unhappy) — *Given* `M` is active in week 0 but not in `+1`. *When* `X` is converted with target week `+1`. *Then* it is refused with `BRANCH_NOT_ACTIVE`, the sheet reads `This branch isn't active that week`, and `X` is untouched.
- **S-backlog-25-3** ⚠ **re-pointed to R-backlog-26 (A2)** (R-backlog-25, unhappy) — *Given* **two** leaves under `Q` active in `+1`. *When* `X` is converted with target `+1` and no `goalId`. *Then* it is refused with `AMBIGUOUS_CONVERSION_TARGET` listing both — the ambiguity rule is evaluated for the target week, not today.

### ~~Idea~~ ⚠ **A2 — RETIRED IN FULL (R-rm-1)**

- **S-idea-4-1** (R-idea-4, happy) — *When* `Task this week` is used on an idea and the task is saved. *Then* the task exists with a `Created — from an Idea` event and the idea is gone.
- **S-idea-4-2** (R-idea-4, unhappy) — *When* `Task this week` is used and the modal is dismissed without saving. *Then* no task exists **and the idea is still in the list** (no data loss).
- **S-idea-4-3** (R-idea-4, unhappy) — *Given* no leaf is active this week. *When* `Task this week` is used. *Then* the user is told the branch must be active first; the idea is untouched and no task is created against a fallback goal.
- **S-idea-5-1** (R-idea-5, happy) — *When* an idea is attached to non-Life goal `G`. *Then* a backlog item with the idea's text exists on `G`, the idea is removed, and the toast names `G`.
- **S-idea-2-1** (R-idea-2, unhappy) — *When* an idea is tagged with a non-Life goal. *Then* it is refused; only Life goals (or none) are valid tags.
- **S-idea-7-1** (R-idea-7, happy) — *Given* an idea tagged to a Life goal that is later deleted. *Then* the idea renders under `Unsorted` rather than disappearing or erroring.

### Learning

- **S-learning-3-1** (R-learning-3, happy) — *When* a learning is re-tagged from Life goal `A` to `No goal`. *Then* `goalId = null` and it moves to the `Unsorted` group.
- **S-learning-4-1** (R-learning-4, happy) — *When* a learning is marked as having changed the plan. *Then* `applied = true` and the `changed the plan` badge renders on both the Learnings screen and the goal detail screen.
- **S-learning-5-1** (R-learning-5, happy) — *Given* a learning tagged to Life goal `L`. *When* any goal in `L`'s line is opened. *Then* the learning is listed there; it is not listed on any other Life line.

### Nav

- **S-nav-3-1** ⚠ **superseded by S-nav-16-1/S-nav-16-2** — *Given* the viewed week is 0. *Then* the forward chevron is disabled and no future week is reachable by chevron, picker, or direct request. **This scenario is retired: it asserts the exact behaviour Amendment 1 removes, and its replacements assert the new bound.**
- **S-nav-4-1** ⚠ **RETIRED by A2 — both week bounds are gone; S-lens-7-1 asserts the replacement** (R-nav-4, happy) — *Then* the week picker and the back chevron reach the same earliest week; no week is reachable by one control and not the other.
- **S-nav-6-1** ⚠ **RETIRED by A2 — there is no filter to reset (R-rm-4)** (R-nav-6, happy) — *Given* a goal filter is applied. *When* the week is changed via the picker. *Then* the filter resets to `All`.
- **S-nav-7-1** ⚠ **superseded by S-lens-4-1 (A2) — the count moves to the group header** (R-nav-7, happy) — *Given* week 0 with two open and one done task under Life root `L`. *Then* `L`'s filter pill reads `<L title> · 2`.
- **S-nav-8-1** ⚠ **superseded by S-lens-12-1 (A2)** (R-nav-8, happy) — *Given* an active leaf with no tasks at week 0. *Then* a section renders with its focus sentence and a `+ Task` button. *And given* the same leaf viewed at week −1 with no tasks then. *Then* no section renders for it.
- **S-nav-9-1** ⚠ **superseded by S-lens-6-1 / S-lens-6-2 (A2)** (R-nav-9, happy) — *Given* nothing is planned at week 0. *Then* the empty state offers `Plan this week`; at a past week with no tasks, the empty state offers no CTA.
- **S-nav-14-1** (R-nav-14, unhappy) — *Then* no route, screen, or endpoint exists for a weekly review wizard, an audit trail view, a week report, or a push flow with mandatory reasons.

#### Nav — Amendment 1

- **S-nav-16-1** ⚠ **superseded by S-lens-7-1 (A2)** (R-nav-16, happy — replaces S-nav-4-1's scope) — *Then* the chevrons and the picker reach exactly the same thirteen weeks, `−7 … +4`; no week is reachable by one control and invisible to the other.
- **S-nav-16-2** ⚠ **RETIRED by A2 — `+5` is now an ordinary reachable week** (R-nav-16, unhappy — replaces S-nav-3-1) — *Given* the viewed week is `+4`. *Then* the forward chevron is disabled, `+5` appears in no picker, and a direct request for offset `+5` is refused by the schema before any handler runs.
- **S-nav-17-1** ⚠ **superseded by S-lens-11-1 (A2) — the badge copy changes** (R-nav-17, happy) — *Given* the viewed week is `+1`. *Then* the badge reads `Future week — planning ahead`, and no task row renders a completion checkbox. *Given* week `−1`. *Then* `Past week — still editable`. *Given* week 0. *Then* neither.
- **S-nav-18-1** ⚠ **superseded by S-lens-7-2 (A2) — the dot generalises to five horizons** (R-nav-18, happy) — *Given* a focus written for `+2` and nothing at `+1` or `+3`. *Then* the picker marks `+2` and only `+2`.
- **S-nav-19-1** ⚠ **re-pointed to R-task-41 (A2), text unchanged** (R-nav-19, happy) — *Given* the viewed week is 0. *When* a task is created with target week `+1`. *Then* the Tasks screen moves to `+1`, the task is visible there, and the toast reads `Added to week of <Mon d Mon>` — the task never appears to have been swallowed.
- **S-nav-20-1** ⚠ **RETIRED by A2 — there is no `Edit plan`** (R-nav-20, happy) — *Given* the viewed week is `+2`. *Then* `Edit plan` is rendered and opens the plan screen **on week `+2`**; with nothing planned there the empty state reads `Nothing planned for this week yet.` with `[Plan week of <Mon d Mon>]`. *Given* week `−2`. *Then* `Edit plan` is absent and the empty state offers no CTA.
- **S-nav-21-1** ⚠ **RETIRED by A2 — there are no focus sentences** (R-nav-21, happy) — *Given* leaf `M` held two sentences in week `−2` and holds three now. *When* week `−2` is viewed. *Then* that week's two sentences render (D-2), not this week's three. *And* `M`'s goal-tree row shows the first sentence followed by `+2 more`.
- **S-nav-22-1** ⚠ **superseded by S-lens-12-1 (A2)** (R-nav-22, happy) — *Given* leaf `M` active in `+1` with no tasks there. *When* week `+1` is viewed. *Then* a section renders with its sentences and a `+ Task` button. *And when* week `−1` is viewed with no tasks live then. *Then* no section renders for `M`, and no `+ Task` appears anywhere on that week.

### Amendment 2 — the Weekly horizon and periods

- **S-goal-30-1** (R-goal-30, happy) — *Given* a Monthly goal `M`. *When* a sub-goal is added under `M`. *Then* the horizon picker offers only `Weekly`, the horizon defaults to `Weekly`, the period defaults to the current week's Monday, and the created goal has `parentId = M`.
- **S-goal-31-1** (R-goal-31, unhappy — the terminal horizon moved) — *Given* a Weekly goal `W`. *Then* no `+ Sub-goal` affordance is rendered on `W` anywhere; *and when* a create with `parentId = W` is submitted directly, at any horizon. *Then* it is refused with `HORIZON_CONFLICT` and `W` still has zero children.
- **S-goal-31-2** (R-goal-31, happy — the rule that reversed) — *When* a create with `parentId` = a Monthly goal and `horizon = 'Weekly'` is submitted. *Then* it **succeeds**. This is the exact request S-goal-6-1 required to be refused; a build that still refuses it has implemented the old rule.
- **S-goal-32-1** (R-goal-32, happy — levels may be skipped) — *When* a Weekly goal is created with `parentId` = a **Life** goal. *Then* it succeeds: rank 0 < rank 4, and no adjacency rule exists. *And when* it is created under a Quarterly goal. *Then* that succeeds too.
- **S-goal-32-2** (R-goal-32, unhappy) — *When* a create is submitted with `parentId` = a Weekly goal and `horizon = 'Monthly'` (inverted rank). *Then* it is refused and no goal is created.
- **S-goal-33-1** (R-goal-33, happy) — *Given* today is 2026-09-01 in the owner's timezone. *When* goals are created at each horizon with no period supplied. *Then* `periodKey` defaults to `2026` / `2026-Q3` / `2026-09` / the Monday of the current week, and `period` renders `2026` / `Q3 2026` / `Sep 2026` / `Week of 31 Aug` — derived, never a stored literal (D-3).
- **S-goal-33-2** (R-goal-33, unhappy) — *When* a create or edit supplies `periodKey = '2026-Q5'`, `'2026-13'`, `'not-a-period'`, or a Weekly key that is not a Monday. *Then* each is refused as a validation failure and no goal is written.
- **S-goal-33-3** (R-goal-33, unhappy — `period` is server-owned) — *When* a create supplies `period: 'whenever'` alongside a valid `periodKey`. *Then* the supplied `period` is ignored and the stored value is the derived label. No goal in the account has a `period` that is not the rendering of its own `periodKey`.
- **S-goal-33-4** (R-goal-33, happy — the partition property) — *For* every non-Life goal in the account, *then* it appears in exactly one lens and in exactly one period of that lens. No goal is unreachable from any lens.
- **S-goal-34-1** (R-goal-34, happy) — *Given* the account timezone is `Europe/Berlin` and a client in `UTC−8` near a Sunday/Monday and a month boundary. *Then* both agree on the current week **and** the current month, because every current period is computed server-side from the account timezone and echoed on the wire.
- **S-goal-35-1** (R-goal-35, happy — no containment check) — *Given* a Monthly goal `M` for `2026-10`. *When* a Weekly goal is created under `M` for the week of 28 Sep 2026 — a week that starts in September. *Then* it succeeds, with no warning, no chip and no styling. *And* a Monthly goal for `2026-03` may be created under a Quarterly goal for `2026-Q4`.
- **S-goal-36-1** (R-goal-36, unhappy — no back-dating a plan) — *When* a Weekly goal is created with `periodKey` = last week's Monday, or a Monthly goal with `periodKey = 2026-08` while the current month is `2026-09`. *Then* each is refused with `PERIOD_IN_PAST` and nothing is written.
- **S-goal-36-2** (R-goal-36, unhappy) — *Given* a Weekly goal for the current week. *When* an edit or re-plan sets its `periodKey` to a past week. *Then* it is refused with `PERIOD_IN_PAST` and the stored key is unchanged.
- **S-goal-36-3** (R-goal-36, happy — forward is unbounded) — *When* a Weekly goal is created 40 weeks out, and a Monthly goal 18 months out. *Then* both succeed. No offset, no month count and no horizon has a forward cap, and no request is refused for looking too far ahead.
- **S-goal-36-4** (R-goal-36, happy — what a past period still permits) — *Given* a Weekly goal from three weeks ago holding one open and one done task. *When* its `title`, `why` and `pulse` are edited, it is moved under another Monthly goal, its open task is completed in that past week, and its done task is unchecked. *Then* every one succeeds. A past period is closed to new plan and to nothing else.
- **S-goal-37-1** ⚠ **superseded by S-task-51-2 (A8) — the trap moves up one horizon: the scenario now reads `Quarterly` for `Monthly` and `NOT_A_TASK_GOAL` for `NOT_A_WEEKLY_GOAL`, and its point is unchanged** (R-goal-37, unhappy — the trap) — *Given* a Monthly goal `M` with **no** children, so it is a leaf by the structural definition. *When* a task is created with `goalId = M`. *Then* it is refused with `NOT_A_WEEKLY_GOAL`. A build that admits it has keyed task ownership on leaf-ness instead of on the horizon.
- **S-goal-37-2** (R-goal-37, unhappy — the word is gone) — *Then* no read model exposes `isLeaf`, and no rule, error message, screen string, MCP tool description or resource uses the word "leaf" to mean "holds work".
- **S-goal-38-1** (R-goal-38, happy) — *Given* Life `L` › Yearly `Y` › Quarterly `Q` › Monthly `M`, with one Weekly goal `W` under `M` for week `W0`. *Then* `M`, `Q`, `Y` and `L` are all **not dormant** in `W0`, and all four **are** dormant in `W0 + 1` when `W` holds no open tasks then. *And* nothing anywhere is muted, greyed or labelled `DORMANT` in either case.
- **S-goal-38-2** (R-goal-38, happy) — *Given* a Monthly goal with no Weekly children at all. *Then* its row in the Monthly lens is styled identically to one that has them; the only difference in the product is that its detail page's primary action is `+ Weekly goal`.
- **S-goal-39-1** ⚠ **superseded by S-task-51-1/S-task-51-2 (A8) — three horizons, not four, and `NOT_A_TASK_GOAL`** (R-goal-39, unhappy) — *When* a task create names a Life, Yearly, Quarterly or Monthly goal. *Then* each is refused with `NOT_A_WEEKLY_GOAL`, and no `+ Task` affordance is rendered at any of those four horizons.
- **S-goal-40-1** (R-goal-40, happy) — *Given* today is in September 2026 and a Monthly goal in `2026-09`. *When* the re-plan sheet opens. *Then* the options are `2026-10` and `2026-11`, derived from today and strictly after the goal's current period.
- **S-goal-40-2** (R-goal-40, unhappy — a Weekly goal is not re-plannable) — *Given* a Weekly goal. *Then* no re-plan affordance is rendered on it, and a direct re-plan or a `periodKey` patch is refused. Its week is immutable after creation.
- **S-goal-40-3** (R-goal-40, happy — Move still works) — *When* a Weekly goal is moved under a different Monthly goal. *Then* it succeeds, its `periodKey` is unchanged, and its tasks' `originWeekStart` values are unchanged.
- **S-goal-42-1** (R-goal-42, happy — the defect class is gone) — *When* a sub-goal is created under a goal that has no children, at every horizon that permits one. *Then* nothing is deleted, nothing is re-parented, no operation is refused for open tasks, and `GOAL_HAS_OPEN_TASKS` is raised by no code path in the product. It is unreachable because a goal's horizon is immutable and task ownership is keyed on the horizon (⚠ **A8 restates this reason; the assertion is unchanged**). *And given* a Monthly goal holding three month tasks. *When* a Weekly sub-goal is added to it. *Then* all three tasks are still on the Monthly goal, unmoved and unrefused.
- **S-goal-43-1** (R-goal-43, happy) — *Given* a Weekly goal written three weeks before its week, and that week is now the current week. *Then* a muted line reads `planned 3 weeks ago`, with no chip, no colour and no prompt. *And given* one written last week for this week. *Then* no label. *And given* one written three weeks ago for a week that has not arrived, viewed at that week. *Then* still no label: it is early, not stale.
- **S-goal-44-1** (R-goal-44, unhappy) — *When* a Weekly goal's week becomes the current week. *Then* nothing is written, nothing is asked, and no route, screen, sheet or endpoint exists for confirming, reviewing or re-validating it.
- **S-goal-45-1** (R-goal-45, unhappy) — *Then* no goal at any horizon has a completion state: no `done` field, no complete/close/archive operation, no completion badge, no progress bar and no `N of M tasks` ratio anywhere in the product, and a direct request to complete a goal is refused as a non-existent operation.
- **S-goal-45-2** (R-goal-45, happy — the week is the record) — *Given* a Weekly goal from three weeks ago whose two tasks were completed in that week. *Then* it is **absent** from the current week's lens (nothing is outstanding), *and* it renders in that past week's lens with both tasks shown done.
- **S-goal-46-1** (R-goal-46, happy) — *Given* last week held three Weekly goals under Life line `L`. *When* `Repeat last week` is used on the current week. *Then* three new goals exist for the current week with the same titles, `why` and parents, `pulse` reset to `On track`, new ids, **no tasks**, and no field linking any copy to its source.
- **S-goal-46-2** (R-goal-46, unhappy) — *When* `Repeat last week` is used on a **past** week. *Then* the action is not offered and a direct request is refused with `PERIOD_IN_PAST`. *And when* the previous week held nothing. *Then* nothing is created and a toast says so.

### Amendment 2 — lenses

- **S-lens-1-1** (R-lens-1, happy — flat, account-wide) — *Given* three Life lines each holding one Quarterly goal for `2026-Q3`. *When* the Quarterly lens is opened at `2026-Q3`. *Then* all three are listed, from all three lines, with no expand/collapse control anywhere and no way to walk into a subtree from the list.
- **S-lens-2-1** (R-lens-2, unhappy — one horizon only) — *Given* the Quarterly lens at `2026-Q3`. *Then* no Yearly, Monthly or Weekly goal appears in it, and no Quarterly goal from `2026-Q2` or `2026-Q4` appears in it.
- **S-lens-3-1** (R-lens-3, happy — depth-independent grouping) — *Given* Weekly goal `A` under Life › Yearly › Quarterly › Monthly, and Weekly goal `B` attached directly to a Life goal (R-goal-32). *When* the Weekly lens is opened at their week. *Then* both are grouped under their own Life goals, resolved by walking `parentId` to the root, with no assumption about chain length.
- **S-lens-3-2** (R-lens-3, unhappy — a broken chain) — *Given* a goal whose `parentId` names a goal that does not exist. *Then* it renders in the `UNSORTED` group at the end of the lens; it is neither dropped from the view nor does it error.
- **S-lens-3-3** (R-lens-3, unhappy — no filter exists) — *Then* no lens renders an `All` chip, a per-Life-goal pill, a horizon filter or a pulse filter, and no lens read accepts a `goalId` filter parameter.
- **S-lens-4-1** (R-lens-4, happy) — *Given* Life line `L` with two open and one done task visible in the current week. *When* any lens is opened. *Then* `L`'s group header reads its title and `2`. *And when* the Weekly lens moves to a week where three of `L`'s tasks are visible and open. *Then* that header reads `3`, while every other lens still reads today's `2`.
- **S-lens-4-2** (R-lens-4, happy — future work is not in today's numbers) — *Given* one open task originating in the current week and one under a Weekly goal three weeks out, both under `L`. *Then* `L`'s header reads `1` in the Life, Yearly, Quarterly and Monthly lenses and in the Weekly lens at the current week; it reads `2` only when the Weekly lens is moved to that future week.
- **S-lens-5-1** (R-lens-5, happy) — *Given* two Life goals and an orphan. *Then* the groups are ordered by the Life goals' `createdAt` asc, `id` asc, `UNSORTED` last; the order is identical on every read of an unchanged account.
- **S-lens-6-1** (R-lens-6, happy — an empty group is not a hidden group) — *Given* Life goal `L` with nothing at the Monthly horizon for the selected month. *Then* `L`'s header renders with its open-task count and one muted line `Nothing at this horizon for Sep 2026.`; `L` is not omitted from the lens.
- **S-lens-6-2** (R-lens-6, happy/unhappy — the CTA depends on the period) — *Given* an empty **future** month. *Then* the empty state offers `[+ New monthly goal]`. *Given* an empty **past** month. *Then* the copy reads `Nothing was set for <period>.` and **no** create CTA is rendered anywhere on the lens.
- **S-lens-7-1** (R-lens-7, happy — one range, both controls) — *Then* the chevrons and the picker address exactly the same set of periods, and no period is reachable by one control and invisible to the other. The forward chevron is never disabled; the back chevron is disabled only at the account's first period.
- **S-lens-7-2** (R-lens-7, happy — the has-work dot) — *Given* a Weekly goal written for `+6` and nothing at `+5` or `+7`. *Then* the picker marks `+6` and only `+6`. *And* the same holds in the Monthly lens for a month holding one goal.
- **S-lens-7-3** (R-lens-7, unhappy — no cap survives) — *When* the forward chevron is pressed twenty times in the Weekly lens. *Then* week `+20` is reached and readable, no control is disabled, and no request is refused with a range error. `PLAN_AHEAD_WEEKS` exists nowhere in the codebase.
- **S-lens-9-1** (R-lens-9, happy — zoom in prefers today) — *Given* today is 1 Sep 2026 and the Quarterly lens is at `2026-Q3`. *When* the lens is switched to Monthly. *Then* the period is `2026-09`, the month containing today — not `2026-07`, the first month of the quarter.
- **S-lens-9-2** (R-lens-9, happy — zoom in falls back to the first) — *Given* the Quarterly lens at `2027-Q1`, which does not contain today. *When* the lens is switched to Monthly. *Then* the period is `2027-01`.
- **S-lens-9-3** (R-lens-9, happy — zoom out contains) — *Given* the Monthly lens at `2026-09`. *When* the lens is switched to Quarterly then Yearly. *Then* the periods are `2026-Q3` and `2026`.
- **S-lens-9-4** (R-lens-9, happy — the round trip) — *Given* the Quarterly lens at `2027-Q1`. *When* the lens is switched to Monthly and back to Quarterly. *Then* it is at `2027-Q1` again: zooming never moves the anchor.
- **S-lens-9-5** (R-lens-9, happy — the straddling week) — *Given* the Monthly lens at `2026-09`, a month that does not contain today. *When* the lens is switched to Weekly. *Then* the period is the week containing 1 Sep 2026, whose Monday is **31 Aug** — a Monday in the previous month, which is correct and is not rounded forward.
- **S-lens-9-6** (R-lens-9, happy — Life has no period) — *When* the lens is switched to Life and back to Monthly with no period chosen in between. *Then* the Monthly lens is at the month it was at before, and switching to Monthly from a cold Life lens gives the current month.
- **S-lens-10-1** (R-lens-10, unhappy — history stays truthful) — *Given* a past week holding two Weekly goals and four tasks. *When* a create, a `periodKey` edit or a `Repeat last week` names that week. *Then* each is refused with `PERIOD_IN_PAST` and every one of the six rows is byte-identical afterwards. *This is S-plan-15-3, restated for the model that replaced the one it was written against.*
- **S-lens-10-2** (R-lens-10, happy — the converse) — *Given* the same past week. *When* one of its open tasks is completed and one of its done tasks is unchecked. *Then* both succeed, and that week's lens renders the change. A past period is read-only for plan and fully interactive for work.
- **S-lens-11-1** (R-lens-11, happy — badges) ⚠ **amended by the reconciliation pass — the badge names its horizon; this scenario still asserted the copy the pass replaced** — *Given* the Weekly lens at `+1`. *Then* the badge reads `Future week — planning ahead` and no task row renders a completion checkbox. *Given* `−1`. *Then* `Past week — still editable`. *Given* the current week. *Then* neither. *And* the same three states hold in the Monthly, Quarterly and Yearly lenses **naming their own horizon** — `Future month — planning ahead`, `Past quarter — still editable`, and so on. ~~`Planning ahead` / `Past — still editable`~~ is retired: the horizon word is what makes the badge true on four lenses instead of one (RECONCILIATION C-5).
- **S-lens-11-2** (R-lens-11, unhappy — the rule that must not fire) — *Given* a Weekly goal at `+3` holding two open tasks. *When* week `+3` is viewed. *Then* no red chip, no grey label, no count and no warning appears on any of it. The only escalation in the product does not fire at a plan.
- **S-lens-12-1** (R-lens-12, happy — this week's plan) — *Given* Weekly goal `W` for the current week with one open task. *When* the Weekly lens is opened at the current week. *Then* `W` renders in its Life group with its task and a `+ Task` affordance.
- **S-lens-12-2** (R-lens-12, happy — the carried band) — *Given* Weekly goal `W` for week `−3` with one task still open, and Weekly goal `V` for the current week. *When* the current week is viewed. *Then* `V` renders in this week's plan and `W` renders **below it, in the carried band**, labelled `from week of <W's Monday>`, showing only its still-open task with the red `3 weeks · since …` chip — and `W` offers **no** `+ Task`.
- **S-lens-12-3** (R-lens-12, happy — order within the carried band) — *Given* three carried Weekly goals from weeks `−1`, `−4` and `−2`. *Then* the band lists them `−4`, `−2`, `−1`: oldest first, so the longest-outstanding work is always at the top.
- **S-lens-12-4** (R-lens-12, happy — it never ages out) — *Given* a Weekly goal from week `−10` whose single task is still open. *When* each of the ten intervening weeks is viewed. *Then* the goal appears in every one of them, in the carried band, and its task's chip reads the age for that week. Nothing hides it, nothing archives it, and no second escalation is introduced.
- **S-lens-12-5** (R-lens-12, happy — it stops carrying when the work stops) — *Given* the same goal. *When* its last open task is completed, cancelled or moved to the backlog. *Then* the goal is absent from every subsequent week's lens, and still present in its own week's lens with the task's outcome shown.
- **S-lens-12-6** (R-lens-12, unhappy — nothing visible is hidden) — *For* every week `W` and every task visible in `W` (R-task-7/8), *then* that task appears in `W`'s lens under its own goal. There is no combination of goal period and task state in which a visible task has no home.
- **S-lens-13-1** (R-lens-13, unhappy) — *Then* the lens switcher is not a tab: the tab bar has exactly three items (R-nav-23) and none of them is a horizon. The switcher is a single tab stop, moves with `←`/`→`, and announces the selected lens rather than only colouring it.
- **S-lens-14-1** (R-lens-14, happy — deep links) — *When* a URL naming a lens and a period is opened cold. *Then* that lens is shown at that period. *When* the period is absent or unparseable. *Then* the lens opens at its current period rather than erroring.
- **S-lens-14-2** (R-lens-14, happy — back) — *When* a task page is opened from the Weekly lens at week `−2` and the back control is used. *Then* the Weekly lens is shown at week `−2`, not at the current week.
- **S-lens-16-1** (R-lens-16, unhappy — the whole tree is not shipped) — *Given* an account with 2,000 goals across five years. *When* any lens is opened. *Then* the read returns only that lens's period plus the Life goals, is paginated, and no endpoint or cold-open payload returns every goal in the account.
- **S-lens-16-2** (R-lens-16, happy — the server resolves the group) — *Then* every lens item arrives with its Life-goal group already resolved by the server; the client never walks an ancestor chain, and never assumes it holds a goal's parent.

### Amendment 2 — tasks

- **S-task-39-1** (R-task-39, happy) — *When* a task is created under a Weekly goal. *Then* it succeeds and its `goalId` is that goal.
- **S-task-40-1** (R-task-40, happy — the week is seeded from the parent) — *When* a task is created under a Weekly goal for week `+2`. *Then* `originWeekStart` is that Monday, stored on the task; the request carried no week parameter and none was accepted.
- **S-task-40-2** (R-task-40, happy — the one legitimate divergence) — *Given* an open task under a Weekly goal for week `−3`. *When* the current week is viewed. *Then* the task is visible, its `originWeekStart` is still week `−3`'s Monday, and its goal's `periodKey` is still week `−3` — the two agree, and it is *visibility* that has moved, not either week.
- **S-task-40-3** (R-task-40, unhappy — no week input, no derived week) — *When* a task create or patch carries a `week`, `weekOffset`, `originWeek` or any other week key. *Then* it is refused as an unknown key. *And* no read model computes a task's week by reading its goal's `periodKey`: deleting the goal row from a query result must not change any task's week.
- **S-task-41-1** (R-task-41, unhappy — no back-dating) — *Given* a Weekly goal for a past week. *When* a task create names it. *Then* it is refused with `PERIOD_IN_PAST`, and no `+ Task` affordance is rendered on that goal in the lens, in the carried band, or on its detail page.
- **S-task-41-2** (R-task-41, happy — creating forward) — *Given* a Weekly goal 12 weeks out. *When* a task is created under it. *Then* it succeeds, the task is invisible in every week before that one, and it carries no label of any kind when that week is viewed early.
- **S-task-41-3** (R-task-41, happy — never created into a week you cannot see) — *Given* the Weekly lens at the current week. *When* a task is created under a Weekly goal for `+1`. *Then* the lens moves to `+1`, the task is visible there, and the toast reads `Added to week of <Mon d Mon>`.
- **S-task-43-1** (R-task-43, happy — the age goes negative) — *Given* an open task whose origin is week `+1`, viewed at `+1`. *Then* `carryAge = −1`: no label, no chip. *And* viewed at `+3`, `carryAge = −1` still, because the age is measured against the current week and not the viewed one.
- **S-task-43-2** (R-task-43, happy — the late task stays late) — *Given* an open task with origin `−3`, viewed at `+2`. *Then* `carryAge = 3` and the red `3 weeks · since …` chip renders: it is late today and still open then.
- **S-task-43-3** (R-task-43, boundary — past and current views are unchanged) — *Given* an open task with origin `−2`, viewed at `−1`. *Then* the age is 1 and the grey one-week label renders exactly as S-task-11-2 always required.
- **S-task-44-1** (R-task-44, unhappy) — *Given* a task under a Weekly goal for `+1`. *When* a completion is submitted for `+1`, for the current week, or for any week. *Then* every one is refused with `WEEK_OUT_OF_RANGE`, and no checkbox is rendered on that row.
- **S-task-45-1** (R-task-45, happy) — *When* a task row is tapped. *Then* the browser navigates to a task **page** with its own URL; back returns to the lens and period it came from; no drawer or sheet is used for task detail anywhere in the product.
- **S-task-45-2** (R-task-45, happy — cold open) — *Given* a task page URL for a task with origin week `−4`, opened cold. *When* back is used. *Then* the Weekly lens opens at week `−4`, where the task is visible — never at a week the task is absent from.
- **S-task-46-1** (R-task-46, unhappy) — *Then* no task event anywhere reads `Created — from an Idea` or `Created — weekly planning`, and `TASK_SOURCES` contains exactly `goal`, `backlog`, `drawer`. Every other row of R-task-30's table is produced unchanged.
- **S-task-47-1** (R-task-47, happy — the cascade covers the new level) — *Given* a Monthly goal with four Weekly children holding nine tasks between them. *When* it is deleted with cascade. *Then* all four Weekly goals, all nine tasks, their events and their links are deleted in one transaction, nothing is orphaned, and the confirmation named those counts before it ran.
- **S-task-48-1** (R-task-48, happy — one step) — *Given* no Weekly goal exists for the current week under Monthly goal `M`. *When* `+ Task` is used from `M` and the sheet's inline `New weekly goal` field is filled alongside the task title. *Then* one Weekly goal and one task exist after a single save, in one transaction, and the task's `originWeekStart` is the current week.
- **S-task-48-2** (R-task-48, unhappy — atomicity) — *Given* the same flow. *When* the task write fails. *Then* **no** Weekly goal was created either: a failure creates neither row.
- **S-task-48-3** (R-task-48, unhappy — the model is not special-cased) — *When* a task create supplies both `goalId` and `newWeeklyGoal`, or neither. *Then* it is refused. *And* no task exists anywhere with a null `goalId`, and no implicit inbox, default or fallback goal exists in the product (D-10).

### Amendment 2 — backlog, nav, removals

- **S-backlog-26-1** (R-backlog-26, happy) — *Given* item `X` on Quarterly goal `Q` with exactly one Weekly goal `W` under `Q` for the target week. *When* `X` is converted. *Then* one task exists under `W` with `X`'s title, description and links, a `Created — pulled from Backlog` event, and `X` no longer appears in any backlog list.
- **S-backlog-26-2** (R-backlog-26, unhappy — no Weekly goal) — *Given* item `X` on `Q` and no Weekly goal under `Q` for the target week. *When* `Add to this week` is used. *Then* it is refused with `NO_WEEKLY_GOAL`, the sheet reads `No weekly goal here for that week` and offers the inline create (R-task-48), `X` is untouched, and no task exists. *And when* the conversion is submitted directly against the server. *Then* it is refused there too — the client prompt is not the only guard.
- **S-backlog-26-3** (R-backlog-26, unhappy — ambiguity) — *Given* **two** Weekly goals under `Q` for the target week. *When* `X` is converted with no `goalId`. *Then* it is refused with `AMBIGUOUS_CONVERSION_TARGET` listing both; no silent pick is made.
- **S-backlog-26-4** (R-backlog-26, unhappy — never a Weekly goal) — *When* a backlog item is created on, or moved to, a Weekly goal. *Then* it is refused, and no goal picker in any backlog flow lists a Weekly goal.
- **S-backlog-27-1** (R-backlog-27, happy/unhappy) — *When* the `+` drawer is saved with `Add to this week instead` ticked and a Weekly goal exists under the chosen goal for the current week. *Then* exactly one entity exists: a task. *When* no such Weekly goal exists. *Then* exactly one backlog item is created, no task, and the toast reads `No weekly goal this week — parked in Backlog`.
- **S-backlog-28-1** (R-backlog-28, happy) — *Given* Weekly goal `W` under Monthly `M` under Quarterly `Q`, with backlog items on `M` and `Q` and an unrelated item on another Yearly goal. *When* `W`'s detail page is opened. *Then* `FROM THE BACKLOG` lists the two items on `M` and `Q` and not the third; tapping one opens the create flow bound to `W` and its week.
- **S-backlog-29-1** (R-backlog-29, happy — the exit lands above the week) — *Given* an open task under Weekly goal `W`, whose parent is Monthly goal `M`. *When* Move to Backlog is confirmed. *Then* a backlog item exists on **`M`**, not on `W`, carrying the title, description and links, with `fromWeek` = the Monday of the week the task was live in; the task leaves every week.
- **S-backlog-29-2** (R-backlog-29, unhappy — no legal target) — *Given* a Weekly goal attached directly to a Life goal (R-goal-32), holding an open task. *When* Move to Backlog is attempted. *Then* it is refused with `LIFE_GOAL_NO_BACKLOG` and the sheet says so; Cancel and Complete remain available, and no backlog item is created on a Life or Weekly goal.
- **S-nav-23-1** (R-nav-23, unhappy) — *Then* the tab bar has exactly three items — `Goals`, `+`, `Learnings` — and there is no Tasks tab, no Ideas tab and no route reachable only from one of them.
- **S-nav-24-1** (R-nav-24, happy) — *When* a lens, a goal, a task, the Backlog page and Learnings are each visited and the browser back button is used. *Then* each step is undone in order. *And when* an unknown path is opened. *Then* the Goals screen renders rather than a blank page.
- **S-nav-24-2** (R-nav-24, unhappy — overlays are not routes) — *When* the `+` drawer, a confirm sheet, a create form or the period picker is opened. *Then* the URL does not change, and reloading the page does not reopen it.
- **S-nav-26-1** (R-nav-26, unhappy) — *Then* no route, screen, endpoint or MCP tool exists for a weekly review wizard, an audit-trail view, a week report, a push flow with mandatory reasons — **or** for a completion rate, a streak, a burndown or any per-period summary number on a lens header.
- **S-rm-1-1** (R-rm-1, unhappy — the audit) — *Then* the string `idea` appears in no table, column, index, entity, repository, service, route, endpoint constant, schema, error code, MCP tool, MCP resource, prompt, query key, screen, deep-link tab or service-worker prefix; `BootstrapResponse` has no `ideas` field; `TASK_SOURCES` has no `idea` member; and a request to every deleted idea route returns 404 from the router, not 501 from a stub.
- **S-rm-2-1** (R-rm-2, unhappy — the audit) — *Then* the strings `weekly_focus`, `weeklyFocus`, `WeeklyFocus`, `focus`, `dormant`, `isActive`, `subtreeActive` and `isLeaf` appear in no table, column, index, entity, port, service, route, schema field, read model, MCP tool or screen; `GoalView` has no `focus`, `isLeaf`, `isActive`, `dormant`, `subtreeActive` or `branches`; and `PlanEntryView`, `SavePlanRequest` and `PlanResponse` do not exist.
- **S-rm-3-1** (R-rm-3, unhappy — the audit) — *Then* the route census contains no `/plan` path; `PLAN_AHEAD_WEEKS` exists nowhere; no constant is used as a forward week bound; `WeekOffset` accepts a positive offset; **and `CompleteTaskRequest.week` refuses one** — the guard it used to inherit is now explicit (R-task-44).
- **S-rm-4-1** (R-rm-4, unhappy — the audit) — *Then* no screen renders an `All` chip or a per-Life-goal pill; `TasksQuery` has no `goalId`; `GoalFilterQuery` does not exist; and no lens read accepts a goal filter of any kind.
- **S-rm-5-1** (R-rm-5, unhappy — the audit) — *Then* `TasksScreen`, `PlanScreen`, `InactiveBranchSheet` and the recursive tree renderer with its per-node collapse state do not exist; task detail is a route and not a sheet; `GET /api/tasks?week=` **does** exist and serves the Weekly lens; and `GET /api/goals` returns one lens's period rather than every goal in the account.


### Amendment 3 — sub-goals from the goal page

- **S-goal-48-1** (R-goal-48, happy — the empty section is the whole point) — *Given* a **Yearly** goal `Y` with no children. *When* `Y`'s page is opened. *Then* a `Sub-goals` section renders reading `Nothing under this goal yet.` with a `+ Sub-goal` control. *And when* `+ Sub-goal` is used, a title typed and `Enter` pressed. *Then* exactly one goal is created with `parentId = Y`, `horizon = 'Quarterly'` and the current quarter's `periodKey`, it appears in the section, and the field closes with focus back on `+ Sub-goal`.
- **S-goal-48-2** (R-goal-48, happy — one legal horizon is not a question) — *Given* a **Monthly** goal `M`. *When* `+ Sub-goal` is used. *Then* **no horizon picker is rendered at all**, and the created goal has `horizon = 'Weekly'` with the current Monday as its `periodKey` — the same key `+ Weekly goal` used before R-nav-29 removed it.
- **S-goal-48-3** (R-goal-48, happy — several legal horizons default to the next shorter) — *Given* a **Life** goal `L`. *Then* the picker offers `Yearly`, `Quarterly`, `Monthly` and `Weekly`, with `Yearly` selected and `Life` absent. *And given* a **Quarterly** goal `Q`. *Then* it offers `Monthly` and `Weekly`, with `Monthly` selected, and no horizon of rank ≤ `Q`'s appears in either.
- **S-goal-48-4** (R-goal-48, happy — the period is never in the past and never invented) — *Given* a Yearly goal for `2027` and a today in `2026`. *When* a Quarterly sub-goal is added. *Then* its `periodKey` is `2027-Q1`, the parent's first enclosed quarter, not the current one. *And given* a Yearly goal for the current year. *Then* it is the **current** quarter, so `PERIOD_IN_PAST` is unreachable from this affordance.
- **S-goal-48-5** (R-goal-48, unhappy — Weekly is terminal) — *Given* a **Weekly** goal `W`. *Then* no `Sub-goals` section and no `+ Sub-goal` renders anywhere on its page. *And when* a create with `parentId = W` is submitted directly against the server. *Then* it is refused with `HORIZON_CONFLICT` and `W` still has no children — the absent control was never the guard (D-5).
- **S-goal-48-6** (R-goal-48, happy — nothing typed is lost) — *Given* the capture is open on a Quarterly goal with `Rebuild the gym habit` typed. *When* `More…` is used. *Then* the ordinary create sheet opens with that title already in the title field, the horizon and period the capture had, and this goal preselected as the parent.
- **S-goal-48-7** (R-goal-48, unhappy — the server's refusal renders in place) — *When* a create from the capture is refused. *Then* the message is rendered from the **code** (Q-10) in an inline `alert` under the field, the typed title is still there, the capture stays open, and nothing navigates. The same copy also reaches the toast, exactly as it does from the create sheet — one error path, not a second one for this control.
- **S-nav-29-1** (R-nav-29, unhappy — one path, not two) — *Given* a **Monthly** goal. *Then* its detail page renders no `+ Weekly goal` anywhere, and the `Sub-goals` section's `+ Sub-goal` is the only create for the horizon below. *And given* a **Weekly** goal. *Then* `+ Task` is still its one primary action.

### Amendment 4 — period ranges and the week that is elsewhere

- **S-lens-28-1** (R-lens-28, happy — the case that was reported) — *Given* today is Tue 1 Sep 2026. *When* the Monthly lens is opened. *Then* the period is `2026-09`, it is the current one, and the title reads `Sep 2026` over `Mon 7 Sep – Sun 4 Oct` — not 1–30 September. *And* the title button's accessible name is `Monthly lens, Sep 2026 · Mon 7 Sep – Sun 4 Oct. Change lens or period.`
- **S-lens-28-2** (R-lens-28, happy — a month whose 1st is a Monday has no leading gap) — *Given* `2026-06`, whose 1st is a Monday. *Then* the range reads `Mon 1 Jun – Sun 5 Jul` and begins on the 1st itself. *And given* `2027-02`, whose 1st is a Monday and which holds exactly four weeks. *Then* it reads `Mon 1 Feb – Sun 28 Feb` and ends on the last day of the month.
- **S-lens-28-3** (R-lens-28, happy — five weeks are five weeks) — *Given* `2026-08`, which holds the Mondays 3, 10, 17, 24 and 31 Aug. *Then* the range reads `Mon 3 Aug – Sun 6 Sep`: five weeks, the last of them running into September, because that week's Monday is August's.
- **S-lens-28-4** (R-lens-28, happy — December into January) — *Given* `2026-12`. *Then* the range reads `Mon 7 Dec 2026 – Sun 3 Jan 2027`, with both years spelled out because the two ends disagree about one. *And given* `2027-01`. *Then* it reads `Mon 4 Jan – Sun 31 Jan`, with no year at either end. *And given* the Yearly period `2026`. *Then* `Mon 5 Jan 2026 – Sun 3 Jan 2027`.
- **S-lens-28-5** (R-lens-28, happy — a quarter whose first Monday is in the previous quarter) — *Given* `2026-Q4`, whose 1 Oct is a Thursday in a week beginning Mon 28 Sep. *Then* the range reads `Mon 5 Oct 2026 – Sun 3 Jan 2027`: the quarter opens a week late, because the straddling week is Q3's. *And given* `2026-Q3`. *Then* `Mon 6 Jul – Sun 4 Oct`, whose far end is the same Sunday `Sep 2026`'s is.
- **S-lens-28-6** (R-lens-28, unhappy — the two lenses with nothing to add) — *Given* the Weekly lens at `2026-08-31`. *Then* the title reads `Week of 31 Aug` and no range renders beneath it, because the label already names a specific Monday. *Given* the Life lens. *Then* no range renders, and its accessible name is `Life lens, Life. Change lens or period.`
- **S-lens-28-7** (R-lens-28, happy — the Zoom sheet) — *When* the Zoom sheet is opened. *Then* each of the four period rows shows its own span beneath its label, and the Life row shows `everything` with no dates.
- **S-lens-28-8** (R-lens-28, unhappy — a malformed key does not break a screen) — *Given* a period key that is not canonical for its horizon. *Then* the range is empty and the title renders the label alone; nothing throws and no row is hidden (R-lens-20's principle).
- **S-lens-29-1** (R-lens-29, happy — the flag, and where it goes) — *Given* today is Tue 1 Sep 2026 and the Monthly lens is on `Sep 2026`. *Then* one row below the title reads `This week is in Aug 2026` with a `Go there ›` link whose accessible name is `Go to Aug 2026`, and the live region announces the same sentence. *When* the link is used. *Then* the lens is at `2026-08`, the month whose weeks include Mon 31 Aug, and the flag is gone.
- **S-lens-29-2** (R-lens-29, unhappy — it does not fire when the two agree) — *Given* any day on which the current period holds the week containing today — every day of `Aug 2026` from the 3rd, and every Monday at every horizon. *Then* no such row renders at any lens, and `currentWeekPeriod` is `null` on the wire.
- **S-lens-29-3** (R-lens-29, happy — any lens, any period) — *Given* today is Fri 1 Jan 2027, whose week began Mon 28 Dec 2026. *Then* the Yearly lens flags `2026`, the Quarterly lens flags `Q4 2026` and the Monthly lens flags `Dec 2026`, all three at once. *And* the Weekly and Life lenses never flag: a week holds its own week, and Life has no period.
- **S-lens-29-4** (R-lens-29, unhappy — never a third row) — *Given* a **future** month, which is not current and whose payload still names where the current week is. *Then* the row carries `Future month — planning ahead` and the week flag does not render at all. There is no screen on which both appear, and the shell never carries three unconditional rows (R-nav-27).
- **S-lens-29-5** (R-lens-29, happy — the default did not move) — *Given* today is Tue 1 Sep 2026. *When* the Monthly lens is opened with no period in the URL. *Then* it opens on `2026-09`, marked `isCurrent`, with the create affordances present — **not** on `2026-08`, which the same read marks `isPast` and which would offer no create at all (R-goal-36, R-nav-25). The flag is what reconciles the two.
- **S-lens-29-6** (R-lens-29, happy — an agent is told the same two things) — *When* `list_lens` or `get_period` answers. *Then* each period carries `week_range`, and one that does not hold the current week also carries `current_week_period`. *And* the server-instructions block states both rules, so an agent asked about "September" quotes the span rather than the calendar month.
- **S-lens-30-1** (R-lens-30, happy — the owner's complaint, exactly) — *Given* the network is stubbed out entirely and `GET /goals` never answers. *When* `/month/2026-09` is opened. *Then* the title reads `Sep 2026` over `Mon 7 Sep – Sun 4 Oct` and the title button's accessible name is `Monthly lens, Sep 2026 · Mon 7 Sep – Sun 4 Oct. Change lens or period.` *And* `…` appears nowhere in that control, at any moment.
- **S-lens-30-2** (R-lens-30, happy — one request, not two) — *When* `/month` is opened with no period segment. *Then* exactly **one** `GET /goals` is issued, it carries `period=2026-08`, and the address bar reads `/month/2026-08`. *And* the same holds for `/week` and for every `Jump to now` and one-step zoom. *Given* the **Life** lens. *Then* one request carrying no `period` at all, because Life has none (R-lens-2).
- **S-lens-30-3** (R-lens-30, happy — the title needs no clock) — *Given* the owner's timezone is not yet known and the client is on its `'UTC'` fallback. *Then* the label and the range render correctly at every horizon, *and* neither the off-now badge nor the week-elsewhere flag renders at all — they are suppressed rather than guessed, so the fallback governs nothing the owner sees.
- **S-lens-30-4** (R-lens-30, happy — the boundary table, both sides) — *Given* the hand-written boundary fixtures (a month beginning on a Monday, a five-Monday month, December into January, a quarter whose first Monday is in the previous quarter, both 53-ISO-week years, both DST directions, a sub-hour offset, and the two ends of the 26-hour spread). *Then* the wire `PeriodView` from `GET /goals` and the locally computed `periodViewOf` each match every row, asserted by two tests that do not import each other's code.
- **S-lens-30-5** (R-lens-30, happy — the partition property) — *Given* every date from 2015-01-01 to 2040-12-31 at all five horizons. *Then* `firstWeekOf(next) === addWeeks(lastWeekOf(k), 1)` — consecutive periods' week ranges abut with no gap and no overlap — *and* stepping is invertible, containment holds, and lexicographic key order is chronological order.
- **S-lens-30-6** (R-lens-30, unhappy — the echo assertion fires) — *Given* a `LensResponse` whose `PeriodView` contradicts the calendar for that response's own `serverNow` (a wrong `weekRange`, a wrong `isPast`, a wrong `currentWeekPeriod`). *Then* under dev and test the read **throws**, naming the field; in production it warns **once per session** and the server's value is used for that render.
- **S-lens-30-7** (R-lens-30, unhappy — staleness is not drift) — *Given* a cached `LensResponse` computed on Mon 31 Aug, read after the day has rolled over to a week later, so the client's `isPast` and the payload's disagree. *Then* the echo assertion is **silent**, because the comparison is made on the response's own `serverNow` and the payload was right when it was made. *And* the rollover has invalidated it, so the correct value arrives on the refetch.
- **S-lens-30-8** (R-lens-30, happy — the day rolls over with the tab open) — *Given* the Weekly lens on the current week and a tab backgrounded across midnight into the following week. *When* the tab becomes visible. *Then* the badge reads `Past week — still editable`, the `+ Weekly goal` affordance is gone, and the goal, task, zoom and bootstrap reads have been invalidated. *And* nothing moved under the owner: the URL still names the same week, whose identity did not change — only its status did.
- **S-lens-30-9** (R-lens-30, happy — a traveller still gets their home week) — *Given* an account stored as `Europe/Berlin` and a device in `Pacific/Kiritimati`. *Then* the client's `today` is Berlin's, matching the server's, and the echo of `BootstrapResponse.week.weekStart` against the locally derived Monday agrees. *And* with no stored zone the fallback is `'UTC'`, never the device zone.
- **S-lens-30-10** (R-lens-30, happy — the Zoom sheet opens complete) — *When* the Zoom sheet is opened. *Then* all five rows render their horizon, their destination period's label and its span immediately, with no loading state; only the counts arrive with the read, and a zero count is omitted rather than placeheld (R-lens-22).
- **S-lens-30-11** (R-lens-30, unhappy — the format's own edge) — *Given* the Yearly lens at `9999`. *When* the forward chevron is used. *Then* nothing happens: the step returns the input unchanged rather than `10000`, which is not a canonical key and would be answered `422`. *And* the backward chevron at `1000` likewise. *And* `9998 → 9999` and `1000 → 1001` are ordinary steps, so this is the format's edge and not a product bound (R-lens-7, R-goal-36).
- **S-lens-30-12** (R-lens-30, happy — the create button does not blink) — *Given* a lens on a non-past period and a read still in flight. *Then* the one primary action renders, and opening it names the period the URL names — never `''`, which is a Life goal's key (R-goal-3). *And* it does not disappear and reappear on a period step.
- **S-lens-30-13** (R-lens-30, happy — moving to a cached period shows no loading state) — *Given* a lens that has settled, whose neighbouring periods have been prefetched (depth 1 each way, plus one further in the direction of travel after a step, idle-scheduled and skipped on save-data). *When* the owner steps to one of them. *Then* the body renders from cache with no request and no loading state, and the header repaints in the same frame.
- **S-lens-30-14** (R-lens-30, unhappy — no second calendar may be declared) — *Given* any file under `apps/web/src`, `apps/api/src` or `packages/shared/src` outside `packages/shared/src/calendar/`. *Then* it declares none of `weekStartOfDate`, `periodKeyOf`, `labelOf`, `weekRangeOf`, `stepPeriod`, `firstDayOf`, `dateInTimezone`, `addWeeks`, `zoomTo`, `periodViewOf` or their siblings. They may be **imported**, never re-declared.

### Amendment 6 — breadcrumbs, and loading

- **S-goal-41-1** (R-goal-41 A6, happy — every depth) — *Given* a five-level line. *Then* a Life goal's trail is `Goals`; a Yearly goal's is `Goals / <the Life root>` with no `…` and no eyebrow; and a Quarterly, Monthly or Weekly goal's is `Goals / … / <its immediate parent>` with the Life root on an eyebrow above the title. The segment count is **three at every depth from 3 to 5** and does not grow with the tree.
- **S-goal-41-2** (R-goal-41 A6, unhappy — a title far wider than the screen) — *Given* an ancestor whose title alone is several times the line's width. *Then* the parent crumb stays on one line and tail-truncates with `…`; `Goals` is untruncated; the top-right cluster is not pushed, moved or shrunk; and the crumb's accessible name is the **untruncated** title with its period. *And* the page's own `<h1>` does the opposite — it wraps, to three lines, then clamps.
- **S-goal-41-3** (R-goal-41 A6, happy — `Where this sits`) — *When* the `…` (accessible name `Show the full path`) is used. *Then* a `Sheet` headed `Where this sits` lists every ancestor root → parent, untruncated, each with `HORIZON · PERIOD`, and the current goal last, `aria-current="true"` and not a button. Focus moves to the heading and is trapped; `Escape` closes and returns focus to the `…`; choosing a row closes the sheet and opens that goal.
- **S-goal-41-4** (R-goal-41 A6, unhappy — an UNSORTED line) — *Given* a goal whose topmost ancestor is not a Life goal (R-lens-20). *Then* no eyebrow renders — a Yearly goal is not named as a Life line — and the sheet carries `These aren't under a Life goal yet.` above the list. The `…` still renders, because a segment was still dropped.
- **S-nav-30-1** (R-nav-30, happy — a cold screen) — *Given* an identity with no cached data and a read that has not answered by 150 ms. *Then* the lens shows three card-shaped skeletons in its body, the goal page shows its own beneath a real `Goals` and a real cluster, and the task page shows its own beneath a real `‹ Week of 31 Aug`. *And* no skeleton contains a button, a field, a checkbox or any focusable node.
- **S-nav-30-2** (R-nav-30, unhappy — cached data must never flash) — *Given* the Monthly lens on `2026-08` whose neighbour `2026-09` has been prefetched. *When* the owner steps forward. *Then* no skeleton appears at any moment, including a full grace-plus-minimum later. *And* the same holds for a window-focus refetch, a mutation invalidation and a period already known to be empty.
- **S-nav-30-3** (R-nav-30, happy — the two windows) — *Given* a read that answers in 90 ms. *Then* nothing grey is ever painted. *Given* one that answers at 160 ms. *Then* the skeleton appears at 150 ms and stays until 550 ms, and the content appears when it goes. *And* the minimum is armed by the skeleton's mount, so it can never delay content that was already available.
- **S-nav-30-4** (R-nav-30, unhappy — an error during either window) — *Given* a read that fails at 200 ms, inside the 400 ms minimum. *Then* `LoadError` replaces the skeleton immediately and the chrome around it is still real.
- **S-nav-30-5** (R-nav-30, happy — what a screen reader hears) — *While* loading, one polite `role="status"` announcement of that screen's own sentence (`Loading this goal…`, `Loading this task…`, `Loading…`) and nothing else; the region is `aria-busy="true"` and everything in it is `aria-hidden="true"`. *When* the content arrives, the busy region is gone and the real screen is what is announced.
- **S-nav-30-6** (R-nav-30, unhappy — no motion, in either preference) — *Given* `prefers-reduced-motion: reduce` and given it unset. *Then* the rendered skeleton is byte-identical, and no node in it declares an `animation`, an `animationName` or a `transition`. *And* neither the skeleton module nor `index.html` contains `@keyframes`, an `animation:` or a `transition:` at all.

### Amendment 7 — one goal picker

- **S-nav-31-1** (R-nav-31 / `parent`, happy and unhappy) — *Given* the create sheet for a **Quarterly** goal in `2026-Q3`. *Then* the picker offers the Life goals and the Yearly goals of the enclosing year, and offers no Quarterly, Monthly or Weekly goal at all (R-goal-5, R-goal-32).
- **S-nav-31-2** (R-nav-31 / `parent`, unhappy — a goal is never its own parent, nor its descendant's child) — *Given* `Move goal` on a Quarterly goal that has a Monthly child. *Then* neither the goal itself nor that child is offered. *And* the guarantee is structural: every descendant is strictly shorter-horizon and every option strictly longer, so no descendant at any depth can appear (R-goal-18, R-goal-32).
- **S-nav-31-3** (R-nav-31 / `backlogHost`, happy and unhappy) — *Given* the `+` drawer, or `Move to another goal` on a backlog item. *Then* the Yearly, Quarterly and Monthly goals are offered; **no Life goal and no Weekly goal is**, and on a move the item's own goal is not offered either (R-backlog-2, R-backlog-10, R-backlog-26).
- **S-nav-31-4** (R-nav-31 / `weeklyTarget`, happy and unhappy) — *Given* `+ Task` on a Monthly goal whose week holds two Weekly goals beneath it and one beneath another Monthly goal. *Then* exactly the two are offered, the **first is preselected and announced** as selected, and the third is not offered (R-task-41, R-task-49). *And given* a `409 AMBIGUOUS_CONVERSION_TARGET`. *Then* the picker renders the **server's** candidate list, because only the server knows the subtree at or under the item's goal.
- **S-nav-31-5** (R-nav-31 / `lifeLine`, happy and unhappy) — *Given* the Learnings capture form or a learning's `Attach to a goal`. *Then* `No goal` and the Life goals are offered and nothing else is; choosing a Life goal writes that `goalId`, and `No goal` writes `null` (R-learning-2/3).
- **S-nav-31-6** (R-nav-31, happy — ancestry) — *Given* two goals with the **same title** in two different Life lines. *Then* both are listed, each row's accessible name carries `<title> — <Life line> · <horizon> · <period>`, and inside a group — where the line is the header — the visible second line reads `<HORIZON> · <period>`. *And* the group's accessible name is the Life goal's title.
- **S-nav-31-7** (R-nav-31, happy — search ranks with the shared ranker) — *Given* more than eight options and the query `gym`. *Then* the results are exactly the goals that match, ordered exact title, prefix, substring, **Life line**, `why`; the list is **flat** while the field is non-empty; and the count is announced in a `role="status"`. *And* the same function orders `find_goal`'s matches for the assistant.
- **S-nav-31-8** (R-nav-31, unhappy — nothing matches) — *When* a query matches no option. *Then* the list is replaced by `No goals match “<query>”.`, there is no empty listbox left behind, and the announcement says the same thing.
- **S-nav-31-9** (R-nav-31, happy — the one threshold) — *Given* eight options or fewer. *Then* the picker is an inline listbox with **no search field and no field to open**. *Given* more than eight. *Then* it is one row showing the current choice — `Choose a goal` when nothing is chosen — which opens the full picker.
- **S-nav-31-10** (R-nav-31, happy — the takeover) — *When* the full picker is opened from a form sheet. *Then* there is still exactly **one** `role="dialog"` on screen, its heading reads `Choose a goal`, a back control names the sheet it came from, and going back restores the form **with anything already typed into it intact**. Choosing returns focus to the control that opened the picker.
- **S-nav-31-11** (R-nav-31, happy — the keyboard reaches everything the pointer does) — *When* the picker is operated by keyboard only. *Then* `Enter` on the field opens it, focus lands on the list as a **single tab stop** carrying `aria-activedescendant`, `↑`/`↓` move the active row, `Home`/`End` reach the ends, a printable character moves to the search field and is inserted, `Enter` chooses, and **Escape clears a non-empty search and then closes the sheet — selecting nothing at either stage.**
- **S-nav-31-12** (R-nav-31, unhappy — the cap is not silent) — *Given* an underlying lens read that came back with a `nextCursor`. *Then* the foot of the list reads `Showing the first 200. Search to narrow it.` *And given* a read with no cursor. *Then* no such line renders — it is a fact, not decoration.
- **S-nav-31-13** (R-nav-31, unhappy — no second picker may be built) — *Given* every file that lets a goal be chosen (`GoalModals.tsx`, `BacklogSheets.tsx`, `BacklogItemCard.tsx`, `CaptureScreens.tsx`). *Then* each imports the one picker, and none of the retired renderings — the 200px and 230px flat parent lists, the drawer's wall of goal chips, the two `WHICH WEEKLY GOAL?` chip rows, the move-item row with no selected state, the learning tag's chip row, the drawer's private last-used-goal variable — exists anywhere in the source.


### Amendment 8 — tasks at the month

- **S-task-51-1** (R-task-51, happy) — *When* a task is created under a **Monthly** goal. *Then* it succeeds, `goalId` is that goal, `scope = 'Monthly'`, and `originPeriodKey` is that goal's month key. *And* the identical create under a Weekly goal succeeds unchanged, with `scope = 'Weekly'`.
- **S-task-51-2** (R-task-51, unhappy — the line is still the horizon) — *When* a task create names a **Life**, **Yearly** or **Quarterly** goal. *Then* each is refused with **`NOT_A_TASK_GOAL`** (409) carrying `details.horizon`. *And* a **childless Quarterly** goal is refused identically — leaf-ness is not the condition (R-goal-37). *And* the string `NOT_A_WEEKLY_GOAL` appears in no error catalogue, MCP recovery line, client copy or test.
- **S-task-52-1** (R-task-52, happy — the key says the scope) — *Given* one month task and one week task. *Then* their `originPeriodKey`s are `2026-09` and `2026-09-07`, each matching its own `scope`, and neither carries a week field of any other name.
- **S-task-52-2** (R-task-52, unhappy — no client input, no derived period) — *When* a task create or patch carries `scope`, `originPeriodKey`, `originWeek`, `week` or `weekOffset`. *Then* it is refused as an unknown key. *And* no read model computes a task's period by reading its goal's `periodKey`: removing the goal row from a query result must not change any task's period or scope.
- **S-task-53-1** (R-task-53, happy — a month task carries) — *Given* an open month task with `originPeriodKey = 2026-08`. *When* the Monthly lens is viewed at `2026-09`, `2026-10` and `2026-11`. *Then* it is visible in all three, with no write performed and no `carried` event produced for a month that has not arrived. *And* it is **not** visible at `2026-07`.
- **S-task-53-2** (R-task-53, happy — a done month task) — *Given* a month task completed in `2026-09`. *Then* it is visible in the Monthly lens at `2026-09` only — not in `2026-08` where it was open, and not in `2026-10`.
- **S-task-53-3** (R-task-53, happy — the Monday rule decides which month a week shows) — *Given* today is Wed 2 Sep 2026 and an open month task on a Monthly goal for `2026-08`. *When* the Weekly lens is opened at the current week, `2026-08-31`. *Then* the task appears in that week's month band, because Mon 31 Aug belongs to August. *And* a month task for `2026-09` does **not** appear there; it first appears in the week of Mon 7 Sep.
- **S-task-54-1** (R-task-54, unhappy — never late in a week) — *Given* an open month task from `2026-08`, viewed in the week of Mon 21 Sep. *Then* its row in the month band renders **no** carry chip, **no** gray `since …` line and no badge of any kind. *And* the same task viewed in the Monthly lens at `2026-09` renders the gray one-period label, and at `2026-11` the red `3 months · since Aug` chip.
- **S-task-54-2** (R-task-54, happy — the sign survives the generalisation) — *Given* a month task on a Monthly goal for `2026-12` and today in September. *When* `2026-12` is viewed, and when `2027-02` is viewed. *Then* `carryAge` is negative in both and no label renders in either: the age is measured against the current period, not the viewed one (R-task-43's clause, unchanged).
- **S-task-55-1** (R-task-55, unhappy) — *Given* a month task on a Monthly goal for `2026-12` and today in September. *When* a completion is submitted for `2026-12` or any later month. *Then* it is refused with `WEEK_OUT_OF_RANGE`, and no checkbox is rendered on that row at any surface.
- **S-task-55-2** (R-task-55, happy — the seam, and the period is named not derived) — *Given* today is Wed 2 Sep 2026, so the current month is `2026-09` while the current week belongs to `2026-08`. *When* a month task is completed from the month band of the week of Mon 31 Aug. *Then* `donePeriodKey = 2026-08` — the period the client was standing in — the write succeeds although August is a past month, and nothing consulted "the current month" to decide it.
- **S-task-56-1** (R-task-56, happy — parking) — *Given* an open month task on Monthly goal `M` for `2026-09`, and exactly one Weekly goal `W` under `M` for the week of Mon 14 Sep. *When* it is parked into that week. *Then* `goalId = W`, `scope = 'Weekly'`, `originPeriodKey = 2026-09-14`; its title, done-condition, description, links, events and **every reading** are unchanged; a `Parked in the week of Mon 14 Sep` event is appended; and it no longer appears in any month band.
- **S-task-56-2** (R-task-56, happy — and back again) — *When* that task is moved to the month. *Then* it is on `M` with `scope = 'Monthly'` and `originPeriodKey = 2026-09`, a `Moved to Sep 2026` event is appended, and its readings are still all present. *And given* a Weekly goal whose only ancestor is a Life goal. *Then* the action is not rendered and a direct submission is refused with `HORIZON_CONFLICT`.
- **S-task-56-3** (R-task-56, unhappy — the bounds) — *When* a park names a past week, or a done task, or an exited task. *Then* each is refused (`PERIOD_IN_PAST` for the first) and nothing is written. *And when* two Weekly goals qualify under `M` for the target week. *Then* it is refused with `AMBIGUOUS_CONVERSION_TARGET` listing both, and no silent pick is made. *And when* none exists. *Then* R-task-48's inline `newWeeklyGoal` creates one and parks the task in **one** transaction; a failure creates neither.
- **S-task-56-4** (R-task-56, unhappy — not a fourth exit) — *Then* the product exposes exactly three exits (R-task-13), `retarget` is not one of them, a parked task is still open and still visible, and no route, tool or screen is named `defer`, `snooze`, `reschedule` or `move to another week`.
- **S-task-57-1** (R-task-57, happy — one row, no inference) — *Given* the Monthly lens at `2026-09` and a Monthly goal `M` with no Weekly children. *When* `+ Task` is used on `M`'s card. *Then* **exactly one row is created** — the task, on `M`, in `2026-09`; **no Weekly goal exists that did not before**; the lens does not navigate anywhere; the task appears on the card that was tapped; and no sheet copy mentions a weekly goal or a week.
- **S-task-57-2** (R-task-57, unhappy — no back-dating, forward unbounded) — *Given* a Monthly goal for a past month. *Then* no `+ Task` renders on it, and a direct create is refused with `PERIOD_IN_PAST`. *And given* one six months out. *Then* the create succeeds, the task is invisible in every earlier month, and it carries no label of any kind when that month is viewed early.
- **S-task-58-1** (R-task-58, happy and unhappy) — *Then* a month task's timeline can contain `Carried to <Mon YYYY>`, `Parked in the week of …`, `Moved to <Mon YYYY>`, `Measure added`, `Measure edited` and `Measure removed`, and every row R-task-30/R-task-46 already allow. *And* **no timeline anywhere contains an entry produced by recording or deleting a reading**, at any volume.
- **S-task-59-1** (R-task-59, happy — the demotion) — *Given* an open month task on Monthly goal `M`. *When* Move to Backlog is confirmed. *Then* a backlog item exists on **`M` itself** with the title, description and links, `fromWeek` is `null`, the row renders `from Sep 2026`, and the task leaves every month and every week.
- **S-lens-31-1** (R-lens-31, happy — the band) — *Given* a week with two month tasks in its month and one carried Weekly goal. *Then* the lens renders three sections in order: this week's plan, the carried band, the month band headed `THIS MONTH`; the band is collapsible as a whole; and it does not render at all in a week whose month holds no visible month task.
- **S-lens-31-3** (R-lens-31, unhappy — the header count) — *Given* a week with one open week task and four open month tasks in its month. *Then* its group header reads `1 OPEN`, not `5`, and the same holds on every other lens's header, which anchors on the current week.
- **S-lens-31-2** (R-lens-31, unhappy — the band never escalates) — *Then* no node inside the month band carries the carry chip's style, the gray carry label, a red token, or an accessible name containing `weeks`, `late`, `overdue` or `behind`.
- **S-lens-32-1** (R-lens-32, happy — the owner's request) — *Given* a Monthly goal with three month tasks in the selected month. *When* the Monthly lens is opened. *Then* the card lists all three with their checkboxes, nested under a hairline, with R-goal-47's line beneath them. *And given* the goal has month tasks and no Weekly children. *Then* that line reads `No weeks yet`, not `Nothing planned yet`.
- **S-lens-32-2** (R-lens-32, unhappy — no other lens gains tasks) — *Then* the Life, Yearly and Quarterly lenses render no task on any card, and no read for those lenses returns one.
- **S-backlog-30-1** (R-backlog-30, unhappy — the two do not converge) — *Then* no backlog item anywhere carries a `periodKey`, an `originPeriodKey`, a checkbox, a done-condition, a due date, a status or a carry label; no task anywhere lacks a period; and no entity, field, route, tool or screen exists for a third state between them.
- **S-backlog-30-2** (R-backlog-30, happy — both directions are one tap) — *Given* a backlog item on Monthly goal `M` and a month task on `M`. *When* `Add to this month` is used on the item and `Move to Backlog` on the task. *Then* each becomes the other kind, on the same goal, in one atomic operation, carrying its title, description and links; the source is consumed and never duplicated; and neither operation offers or requires a week.
- **S-backlog-31-1** (R-backlog-31, happy — the month path has no resolution step) — *Given* item `X` on Monthly goal `M` and **no** Weekly goal anywhere under `M`. *When* `Add to this month` is used. *Then* one month task exists on `M`, `X` is gone from every backlog list, the task logs `Created — pulled from Backlog`, and `NO_WEEKLY_GOAL` is neither raised nor reachable from this path.
- **S-backlog-31-2** (R-backlog-31, unhappy — the month path exists only where a month does) — *Given* an item on a **Yearly** or **Quarterly** goal. *Then* only `Add to this week` is offered, and a direct `Add to this month` is refused with `NOT_A_TASK_GOAL`. *And* the `Add to this week` path's ambiguity and inline-create behaviour is unchanged (S-backlog-26-2, S-backlog-26-3 still pass verbatim).
- **S-rm-6-1** (R-rm-6, unhappy — the audit) — *Then* `MonthlyCard` computes no target week and imports no `weekForMonth`; `LinkRow` has no `newWeekly` branch and no `weekStart` prop; `TaskCreateSheet` has no `newWeekly` sheet field, no `willCreateGoal` and no `implicitWeeklyGoalNote`; the strings `This starts a weekly goal` and `Added to week of` appear in no component reached from a Monthly card; creating a task from a Monthly card issues **one** write and performs **no** navigation. *And* `weekForMonth` still exists with exactly two consumers — R-lens-9's zoom and R-goal-47's scope — and both still pass their existing tests.

### Amendment 8 — measurable tasks

- **S-measure-1-1** (R-measure-1, happy — binary is the absence) — *Then* the `kind` union contains exactly `counter` and `gauge`; no `binary` member exists in any schema, enum, column or tool; a task created with no measure has `measure = null`; and its row, its page and its MCP payload are byte-identical to what they were before A8.
- **S-measure-1-2** (R-measure-1, happy — attach and remove) — *When* a measure is added to an existing task. *Then* a `Measure added` event is appended and the checkbox is still rendered. *And when* it is removed after 14 readings. *Then* the confirm names `14`, the measure and all 14 readings are deleted in one transaction, a `Measure removed` event is appended, and the task is an ordinary checkbox again.
- **S-measure-2-1** (R-measure-2, happy — direction is implied) — *Given* `start 0, target 15` and `start 80, target 75`. *Then* both are accepted, no direction field exists on either, and no schema, column or tool anywhere carries one.
- **S-measure-2-2** (R-measure-2, unhappy — the numeric floor) — *When* `start`, `target` or a reading `value` is `NaN`, `±Infinity`, or exceeds `1e9` in magnitude. *Then* it is refused, and no such value is ever stored or rendered.
- **S-measure-3-1** (R-measure-3, happy — the mistyped 240) — *Given* a gauge with readings `24`, `26`, then a mistyped `240`. *Then* `current = 240`. *When* the `240` reading is deleted. *Then* `current = 26`, the earlier readings are untouched, the sparkline redraws without it, and **no event of any kind is appended**.
- **S-measure-3-2** (R-measure-3, happy — one derivation for both kinds) — *Given* a counter at `start 0` bumped `+3`, `+5`. *Then* two readings exist with **absolute** values `3` and `8`, and `current = 8`. *When* the `+5` reading is deleted. *Then* `current = 3`. *When* the remaining one is deleted. *Then* `current = 0`, which is `start`.
- **S-measure-3-3** (R-measure-3, unhappy — the input asymmetry, and `current` is not writable) — *When* a `delta` is submitted against a **gauge**. *Then* it is refused with `MEASURE_KIND_MISMATCH`. *When* an absolute `value` is submitted against a **counter**. *Then* it is accepted and becomes the new `current`. *And when* any request supplies `current` directly. *Then* it is refused as a server-owned field.
- **S-measure-4-1** (R-measure-4, happy — one formula, both directions) — *Given* `start 0, target 15, current 12`. *Then* progress is `0.8`. *Given* `start 80, target 75, current 78`. *Then* progress is `0.4`.
- **S-measure-4-2** (R-measure-4, happy — no target is a first-class case) — *Given* an AMRAP gauge with `target = null` and readings `24, 31, 27`. *Then* no progress is computed, no percentage and no bar render anywhere, the task is still completable, and the sparkline and the three values render normally.
- **S-measure-4-3** (R-measure-4, unhappy — `target == start`) — *When* a measure is created or edited with `target === start`. *Then* it is refused with `MEASURE_TARGET_EQUALS_START` (422). *And given* such a row nonetheless exists in the data. *Then* **no division is performed**, the progress field is absent from the wire, the UI renders the numbers alone, and the strings `NaN`, `Infinity`, `0%` and `100%` appear nowhere on the screen.
- **S-measure-4-4** (R-measure-4, happy — overshoot is not clamped in the data) — *Given* `start 0, target 15, current 18`. *Then* progress is `1.2` on the wire, the row reads `18 / 15 leads`, `120%` renders nowhere, and only the bar's drawn fill is clamped.
- **S-measure-5-1** (R-measure-5, happy — readings survive everything) — *Given* a month task with six readings. *When* it carries into the next month, is parked into a week, is un-parked, is re-parented, is completed and is unchecked. *Then* all six readings are present and unchanged after every one of those operations, in that order.
- **S-measure-5-2** (R-measure-5, unhappy — no period on a reading) — *Then* the readings table has no week, month, period or scope column; no read filters readings by any period; and no reading is ever created, deleted or hidden by a period boundary.
- **S-measure-6-1** (R-measure-6, happy — completion is independent, both ways) — *Given* a counter at `15 / 15`. *Then* the task is still open, nothing completed it, and no prompt asks whether it is done. *And when* it is completed at `12 / 15`. *Then* it completes, `current` is still `12`, and **no reading was written by the completion**.
- **S-measure-7-1** (R-measure-7, unhappy — the timeline is not the log) — *Given* a counter bumped once a day for 90 days. *Then* its timeline contains one `Measure added` row and no reading rows at all, and its page renders the 90 values in the readings list.
- **S-measure-8-1** (R-measure-8, unhappy — the audit) — *Then* no route, screen, read model, wire field, MCP tool, prompt or accessible name in the product produces or presents a pace, a projection, a forecast, a trend line, a moving average, an on-track / behind / ahead state in any form, a streak, a completion rate, a burndown, a per-period measure summary, or **any aggregation of a measure across two or more tasks**. *And* a Monthly goal's target is never computed from anything beneath it, because a goal has no target at all (Q-25).
- **S-measure-8-2** (R-measure-8, unhappy — the colour is not a verdict) — *Then* the measure's bar uses one neutral token in both themes at every value, including above `1.0` and below `0`, and no measure anywhere selects a colour, an icon or a word as a function of its progress.
- **S-measure-8-3** (R-measure-8, unhappy — ratios, checklists, recurrence) — *Then* no schema accepts a numerator/denominator pair, no measure holds a list of named items, and no template entity, series id, materialisation job, detached-from-series state or edit-this-versus-all-future decision exists anywhere (R-goal-46, unchanged).
- **S-measure-9-1** (R-measure-9, happy — an agent gets the model, not a verdict) — *When* the server-instructions block is read. *Then* it states the two kinds, the implied direction, the optional target, that `current` is derived from the readings, and that readings follow the task and never the week. *And when* an agent is asked whether the owner is on track for a measure. *Then* the instructions require it to report the recorded numbers and refuse the verdict, exactly as they already refuse a report.
- **S-measure-9-2** (R-measure-9, unhappy) — *Then* no MCP tool completes a task as a consequence of its target being met, and none records a reading as a side effect of completing a task.

### Amendment 9 — a horizon-scoped picker, named task destinations, and the month clamp

- **S-nav-31-14** (R-nav-31 / A9, happy — the surface decides the shape) — *Given* the create sheet for a Quarterly goal with **four** legal parents, comfortably under the threshold. *Then* the picker renders as **one compact row** and there is no `role="listbox"` and no `role="option"` anywhere in the sheet; the form's own fields and `Save goal` are unobstructed. *And given* `Move goal`, where the picker is the sheet's whole body. *Then* it is the inline listbox, with no compact row.
- **S-nav-31-15** (R-nav-31 / A9, happy and unhappy — horizon scoping) — *Given* the picker opened from `New Quarterly goal`. *Then* the horizon selector offers exactly `Life` and `Yearly` — the mode's rule, read a second way — with `Yearly` selected, and **no** chip for Quarterly, Monthly or Weekly. *And* no illegal goal is reachable through any chip. *And given* `backlogHost`. *Then* the chips are exactly `Yearly · Quarterly · Monthly`, opening on `Monthly`. *And given* `weeklyTarget` or `lifeLine`. *Then* there is **no selector at all**, because the mode has one legal horizon.
- **S-nav-31-16** (R-nav-31 / A9, happy — the default and the escape) — *Given* a picker whose most specific legal horizon holds goals. *Then* it opens on that horizon; *given* one that is empty, on the most specific that is not; *given* an existing choice, on that goal's own horizon with the goal `aria-selected`. *And when* anything is typed. *Then* the scope is dropped and the ranked results cross **every** horizon, and the search field's own threshold counts the **total** options, not the scoped ones.
- **S-nav-31-17** (R-nav-31 / A9, happy — the selector's keyboard, and the third empty state) — *When* the horizon selector is operated by keyboard. *Then* it is **one** tab stop (`tabIndex` 0 on the selected chip, −1 on the rest), `←`/`→` move **and** select and move focus, `Home`/`End` reach the ends, and there is still exactly **one** `role="dialog"` on screen. *And given* a horizon with no goals while other horizons have some. *Then* the list is replaced by `No <horizon> goal to choose here. Pick another horizon above, or search across all of them.` — never the account-level empty sentence.
- **S-goal-5-2** (R-goal-5 / R-nav-31 / A9, happy — the default parent) — *Given* `New Monthly goal` in `Sep 2026` with a Life goal, a Yearly goal for `2026` and a Quarterly goal for `Q3 2026` all legal. *Then* the parent field reads the **Quarterly goal for Q3 2026** — the deepest goal whose period contains the new one — it is `aria-selected` in the picker, saving without touching the field writes that `parentId`, and the Life goal is neither chosen nor made to look chosen.
- **S-task-49-1** (R-task-49 / A9, happy — the destination is named at every count) — *Given* `+ Task` on a Monthly goal. *Then* the sheet renders `WHERE THIS GOES` with the resolved weekly goal as a **filled** choice at **one** candidate and at **several** (the first preselected), the create sentence naming the week at **none**, and in all three the line `Lands in the week of <d Mon> · <Month YYYY>.` before `Save task` is reachable. *And* the row opens the picker with the current choice selected, so the destination can be changed.
- **S-task-49-2** (R-task-49 / A9, unhappy — the target week is inside the month) — *Given* the `Sep 2026` Monthly lens on **Wed 2 Sep 2026**, the day the owner lost three tasks. *Then* `+ Task` resolves the week of **Mon 7 Sep**, the sheet says `Sep 2026`, the write and the navigation both land on `2026-09-07`, and neither `31 Aug` nor `Aug 2026` appears anywhere in the sheet. *And given* the same day and the `Aug 2026` lens. *Then* it resolves **Mon 31 Aug** — the week the owner is standing in, which is August's — so the fix never pushes work backwards into a past week.
- **S-lens-9-7** (R-lens-9 / A9, happy — the zoom keeps its answer) — *Given* `zoomWeekForMonth('2026-09', today = 2026-09-02)`. *Then* it is `2026-08-31`, a week `periodKeyOf('Monthly', …)` calls `2026-08`, and that is correct: a zoom lands on the week you are living in and R-lens-29's line names the seam. *And* `zoomWeekForMonth` and `taskWeekForMonth` are both declared only under `packages/shared/src/calendar/` (`no-second-calendar.test.ts`), and `apps/web/src/utils/periodKeys.ts` declares neither.


### Auth

- **S-auth-2-1** ⚠ **unchanged by A2** (R-auth-2, unhappy) — *When* user B requests, updates, or deletes any entity owned by user A. *Then* it is refused, indistinguishably from a non-existent id.
- **S-auth-2-2** (R-auth-2, unhappy) — *When* user B creates a task whose `goalId` belongs to user A, or moves their own backlog item onto user A's goal. *Then* it is refused; every referenced id is ownership-checked, not just the target.
- **S-auth-4-1** (R-auth-4, unhappy) — *When* any request arrives unauthenticated. *Then* it is refused, including reads.
- **S-auth-5-1** (R-auth-5, happy) — *Given* the account timezone is Europe/Berlin and a client in UTC−8 near a Sunday/Monday boundary. *Then* both agree on the current week, because it is computed server-side from the account timezone.

---

## 4. Rules the mockup cannot express

The mockup is single-user, in-memory, and calls a stub API (`apps/web/src/api/client.ts` — `persist()` logs to the console). These questions have no answer in the design; each carries a `[recommended]` default so builders are not blocked.

**Q-1 — Ownership and identity.** There is no login, no account, no user entity. `[recommended]` One account = one owner = one goal tree. Every row carries `ownerId`; all reads and writes are scoped by it (R-auth-2). No sharing, no roles, no org concept in v1.

**Q-2 — Concurrency on single entities.** Two devices editing the same task or goal both call `persist` fire-and-forget with no version. `[recommended]` Optimistic concurrency: every mutable entity exposes `version` (or `updatedAt` as an ETag); an update carrying a stale version is refused with a conflict and the current server state, and the client re-applies. Field-level last-write-wins is acceptable only for `pulse` and `desc`.

**Q-3 — Concurrency on the plan save.** `savePlan` is a whole-week replace across all leaves; two concurrent saves silently clobber. `[recommended]` The save carries the `weekStart` plus a plan version; a stale version is refused wholesale (never partially applied). The save is one transaction.

**Q-4 — Conversion atomicity and idempotency.** Backlog → task is two writes in the mockup, and the delete is never even persisted. `[recommended]` One transactional operation that deletes the item and creates the task, keyed by the item id: a repeat is refused as already-converted (R-backlog-9), and a client-supplied idempotency key returns the original task rather than a second one.

**Q-5 — Goal deletion.** No delete-goal action exists anywhere in the mockup, so nothing defines what happens to the subtree, focuses, tasks, and backlog items. `[recommended]` Deleting a goal deletes its **entire subtree** and, transactionally, every WeeklyFocus, Task (with its events), and BacklogItem attached to any goal in that subtree; Idea and Learning tags pointing at a deleted goal are set to `null` (they fall into `Unsorted`, per S-idea-7-1) rather than cascading. Deletion requires an explicit confirmation naming the counts (`N sub-goals, M tasks, K backlog items`). Nothing is ever orphaned; there is no soft-delete or trash in v1.
⚠ **A2.** `WeeklyFocus` and `Idea` leave the cascade with their tables (R-rm-1, R-rm-2). The cascade is otherwise **unchanged and already correct for the new level**: it is defined over the subtree, not over a fixed depth, so deleting a Monthly goal takes its Weekly children and all of their tasks, events and links (R-task-47). Two consequences to build for: the counts are now much larger (a Monthly goal a year old can hold ~52 Weekly goals — R-goal-46), so the confirmation must render a big number without alarm; and there is no longer any Idea or Learning tag to null out on a Weekly goal, because neither may be tagged to one (R-idea-* retired; Learnings tag Life goals only).

**Q-6 — Task deletion vs. exits.** Cancel and Move-to-Backlog delete the row in the mockup, which contradicts R-task-30's `Canceled` / `Moved to Backlog` events. `[recommended]` Tasks get a server-owned `status: 'open' | 'done' | 'canceled' | 'movedToBacklog'` with an `exitReason` and `exitedAt`. Exited tasks are excluded from every week view and every count, but the record and its timeline survive. See §5 D-15.

**Q-7 — Ordering and tie-breaks.** The mockup relies on array insertion order everywhere. `[recommended]` Goals: siblings ordered by `createdAt` ascending, `id` ascending as tie-break (add an explicit `sortKey` only if manual re-ordering is ever requested). Tasks within a section: open before done, then `createdAt` ascending, `id` ascending. Backlog items, Ideas, Learnings: `capturedAt` descending, `id` descending. Task events: `at` descending, then insertion sequence descending. Every list order must be total and stable, never dependent on storage order.
⚠ **A2.** `WeeklyFocus.sortKey` disappears with the entity. Goals gain **no** `sortKey`: within a lens group, items share one `periodKey` and are ordered `createdAt` asc, `id` asc (R-lens-5), and lens groups are ordered by their Life goal's `createdAt` asc, `id` asc with `UNSORTED` last (R-lens-20) (R-lens-3). The carried band in the Weekly lens is ordered by `periodKey` **ascending** — oldest first — which is the one place a period is a sort key rather than a filter (R-lens-12). `BacklogItem.sortKey` is unchanged.
⚠ **Answered by A1.** Manual re-ordering *has* been requested, for backlog items. `BacklogItem.sortKey` now exists (R-backlog-17), scoped per goal: within a goal, `sortKey` asc then `capturedAt` desc then `id` desc; across goals, unchanged. Goals, Tasks, Ideas, Learnings and Task events keep the orders above and gain no `sortKey`. `WeeklyFocus` also gains a `sortKey` (R-plan-14), an integer, because a week's sentences are re-written wholesale on every save and never re-ordered in isolation.

**Q-8 — Id generation.** `'t' + Date.now()` collides within a millisecond and is guessable. `[recommended]` Server-generated UUIDv7 (sortable, collision-free); clients never mint ids and any client-supplied id is ignored.

**Q-9 — Week boundaries and timezone.** `mondayOf()` uses the browser clock. `[recommended]` The account stores an IANA timezone; the server computes "current week" from it (R-auth-5). Weeks are stored as the ISO date of their Monday. DST is irrelevant to date-only arithmetic; do not store week offsets (see §5 D-1).

**Q-10 — What must be refused (validation floor).** `[recommended]` Refuse, with a machine-readable error code: goal create/move violating R-goal-5/6/7/17/18; any focus on a Life goal or non-leaf; a task whose `goalId` is not an active non-Life leaf at creation time; a task complete for a future week or a week before its origin; a backlog item on a Life goal; an idea or learning tagged to a non-Life goal; any write to a server-owned field; any reference to an entity the caller does not own. Refusals are validation errors, never silent no-ops (the mockup's `return` pattern).

**Q-11 — Field lengths.** `[recommended]` `Goal.title` 200, `Goal.why` 200, `Goal.period` 32; `WeeklyFocus.sentence` 280; `Task.title` 200, `Task.cond` 200, `Task.desc` 4000; `link.url` 2048 and must parse as `http`/`https` (refuse other schemes); `BacklogItem.title` 200, `.desc` 4000; `Idea.text` 500; `Learning.text` 500; exit reason 280. All strings trimmed before validation; graphemes counted, not bytes.
⚠ **A1 adds:** `BacklogItem.sortKey` ≤ 100 chars, `[A-Za-z0-9]` only, server-minted and never client-supplied; a goal whose keys would exceed it is re-keyed server-side inside the same transaction (R-backlog-19).

**Q-12 — Collection sizes.** ~~`[recommended]` Max 4 levels of goal depth (structural, R-goal-7); max 100 children per goal; max 500 goals per owner; max 20 links per task and per backlog item; max 5 weekly-focus sentences per leaf per week (R-plan-13); max 200 open tasks per leaf per week; max 2000 backlog items per owner; max 5000 ideas and 5000 learnings per owner; max 500 events per task (older ones compacted, never deleted from the visible top). Every list endpoint is paginated with a hard page cap of 200.~~

⚠ **A2 — three of these caps are broken by the Weekly horizon, and this is the highest-cost thing in the redesign.** A weekly intent used to be a `weekly_focus` row; it is now a **goal**. A single repeating intention produces ~52 goals a year (R-goal-46), and an ordinary account with a handful of them produces on the order of **1,000 goals a year**. Against the old numbers that account is illegal within twelve months, silently and gradually.

| Cap | Was | Now | Why |
|---|---|---|---|
| Goal depth | 4 | **5** | R-goal-32. Structural. |
| Children per goal | 100 | **1,000** | A Monthly goal holds ~5 Weekly children, but R-goal-32 lets a Weekly goal hang off a Yearly or Life goal directly, and such a parent accumulates one child per week indefinitely. |
| Goals per owner | 500 | **10,000** | ~1,000/year of ordinary use; ten years of headroom. |
| Focus sentences | 5 per leaf per week | **retired** | The entity is gone (R-rm-2). Its multiplicity is now several Weekly goals under one parent, bounded only by the children cap. |
| Open tasks | 200 per leaf per week | **200 per Weekly goal** | Same number, re-scoped to the goal that now holds work. |
| Ideas | 5,000 | **retired** | R-rm-1. |
| Links, backlog items, learnings, task events, page cap | — | **unchanged** | Nothing in A2 moves them. |

**The consequential part is not the numbers, it is what they invalidate.** `domain/goal-tree.ts` states its own design premise as "at most 500 nodes, at most 4 levels deep … so nothing here needs a query", and every function in it takes the owner's **full goal list** and scans it. **A2 therefore invalidates the in-memory-whole-tree design, not merely a constant.** Two rules already follow from this and are stated in §2: the lens read is scoped to one horizon and one period and never returns the whole tree (R-lens-16), and the server — not the client — resolves each item's Life root (R-lens-3). **A build that raises the caps and leaves the scans is a build that gets slower every week.**

⚠ **The reconciliation pass measured all of this, and three of the sentences above were wrong.** Full working in `docs/work/14-redesign/RECONCILIATION.md` §3.

| Claim | Verified |
|---|---|
| "`isLeaf` … called from inside `orderedTree`'s walk" | **False.** `orderedTree` is Θ(n log c) and never calls `isLeaf` — it is the one correctly-indexed walk in the file. The quadratic is `GoalService.toView` (`goal.service.ts:456-486`), mapped over `orderedTree`'s **output** at `goal.service.ts:81` |
| "O(n²)" | **Understated.** `toView` runs `isLeaf` + `descendantIds` + a per-descendant `isLeaf` for every goal, and Σ subtree sizes ≈ n·d, so `GET /goals` is **Θ(n²·d)** |
| "~1,000 goals a year" | **~2.5–6× high.** That rate needs ~19 new Weekly goals every week. A five-line account with one Weekly goal per Monthly goal per week produces **≈ 395 goals in year one**. The conclusion holds; the cliff moves from year 2 to year 4–5 |
| "a 500-goal cap, a 100-children cap" | **Neither exists.** `MAX_GOALS` and `MAX_CHILDREN` are not in the codebase; the numbers are prose in five files and enforced nowhere. Depth is the only real bound, enforced by `checkCreate`'s rank comparison |

**Measured** (`orderedTree` + `toView` reproduced exactly; element visits; one modern laptop core, a Worker isolate is slower): 395 goals → 1.4 M visits / 5 ms. 785 → 5.4 M / 18 ms. 1 565 → 21.7 M / 64 ms. 3 905 → 135 M / 423 ms. **9 755 → 845 M visits / 2 932 ms per request.** Quadratic confirmed; it runs on `GET /goals`, on `GET /bootstrap`, and again after every goal mutation. `POST /goals` and `POST /goals/:id/move` each run `SELECT * FROM goals WHERE user_id = ?` **three times**.

⚠ **The caps in the table above are therefore replaced.** Raising a lifetime goal cap measures the wrong thing:

| Cap | A2 said | **Reconciliation pass** | Why |
|---|---|---|---|
| Goal depth | 5 | **5**, unchanged | Structural, already enforced |
| Interior goals per owner (horizon ≠ Weekly) | — | **1 000**, enforced on create | This is the set every request holds in memory (R-lens-27). It grows ~85/year, so 1 000 is a decade of headroom, and it is the only number that protects the read strategy |
| Weekly goals per (owner, week) | — | **50**, enforced on create | A *shape* cap, not a lifetime one. It never trips in ordinary use and it bounds a lens page |
| Total goals per owner | 10 000 | **no cap** | A lifetime cap on Weekly goals is a cap on how long you may use the product. It would fire silently on the most engaged owner — the exact failure this exercise removes |
| Children per goal | 1 000 | **100 non-Weekly children**, plus the per-week cap above | The 1 000 papered over R-goal-32's real problem: a Weekly goal hung off a Life goal gives that parent one child per week *forever*, so no fixed fan-out number is right. Scoping the Weekly cap to the week makes fan-out bounded per period and unbounded across time, which is the truth |
| Page cap | 200 | **200, and finally wired** | `MAX_PAGE` exists at `packages/shared/src/common.ts:152` and is referenced nowhere; no endpoint in the product paginates |

**No archival, no pruning.** The owner's dislike of clutter is about screens, not rows, and period-scoped reads already answer it: a Weekly goal from 2024 is invisible unless you navigate to its week. An archive state would need a place to see archived things, a rule for unarchiving into a past period (R-goal-36 forbids the write), and eventually a prompt saying "you have 400 old goals" — the nag the product refuses (R-nav-26, R-goal-44).

**Q-13 — History depth.** Nothing says how far back weeks are readable. `[recommended]` All history is retained; the week switcher exposes the last 8 weeks (R-nav-4) and an explicit `weekStart` may address anything back to the account's first week. ~~Never expose a future week.~~
⚠ **A1 supersedes the last sentence.** The forward horizon is `PLAN_AHEAD_WEEKS = 4` (R-plan-15) and it is a *hard validation bound*, not a picker bound — the two directions are deliberately asymmetric. Backwards, the bound limits a control over weeks that already exist and anything older stays addressable by `weekStart`. Forwards, every addressable week is a week a write would create, so `+5` is refused everywhere: schema, edge, service.
⚠ **A2 supersedes A1's answer in turn, in both directions.** There is now **no bound either way** (owner decision 5, R-lens-7): every past period is readable and every future period is readable *and writable*. The asymmetry A1 built is gone, and with it `PLAN_AHEAD_WEEKS` and `WEEK_HISTORY_WEEKS`-as-a-bound (R-rm-3). What replaces both is a **window, not a limit**: the picker lists a window of periods centred on the selected one and re-centres as it moves, so the two controls still address the same range (D-24) without either of them capping anything. The only surviving refusal in the period dimension is `PERIOD_IN_PAST` on a **write** (R-goal-36) — reads are unbounded, and the absolute storage range (`−520 … +520` weeks) is a sanity bound, not a product rule.

**Q-14 — Failure and rollback.** `persist()` is fire-and-forget with a `TODO: add error handling/rollback`. `[recommended]` Optimistic UI with rollback: on a failed write, revert the local change and surface a non-toast error (a toast alone is insufficient for a lost write, per R-nav-13). Reads on reconnect are authoritative.

**Q-15 — Offline / PWA.** It is a PWA with in-memory state only. `[recommended]` v1 is online-only with a read cache; queued offline mutations are out of scope. If added later, conversions and plan saves must remain server-arbitrated (Q-3, Q-4).

**Q-16 — Rate limits and abuse.** `[recommended]` Per-owner write budget (e.g. 600 writes/minute) sufficient for a human but not a runaway client retry loop; the auto-carry job (R-task-29) is server-scheduled and exempt.

**Q-17 — Where the carry log comes from.** `Carried to week of …` needs a producer. `[recommended]` A per-owner weekly rollover job at the Monday boundary in the account timezone, idempotent per `(taskId, weekStart)` so re-runs never duplicate; a lazy catch-up on first read of a new week covers accounts the job missed.

#### Amendment 2 — new questions

**Q-18 — What happens to existing `period` strings on migration?** `period` becomes a derived label over `periodKey` (R-goal-33), so every existing goal needs a key. `[recommended]` Backfill by parsing the stored label with the same grammar `defaultPeriod` emits (`2026`, `Q4 2026`, `Sep 2026`); an unparseable or empty label falls back to the period **containing the goal's `createdAt`**, in the owner's timezone. That is a guess, but it is a guess that puts the goal in a lens where its owner will find it, which is strictly better than leaving it unreachable. The migration must report how many rows it guessed at.

**Q-19 — Does the redesign need a data migration for Weekly goals?** No. `weekly_focus` rows are **dropped, not converted** (R-rm-2). `[recommended]` Drop them. Converting each row into a Weekly goal would manufacture history — a goal that claims to have existed in a past week, which is exactly what R-lens-10 forbids — and past focus rows exist only to make old weeks readable, a property nothing else depends on. If the owner wants their past weeks to keep rendering, the honest answer is that they will render empty, and that must be said out loud before the migration runs. **This is the one question in A2 whose wrong answer is irreversible.**
  - **The one exception, and it is about work rather than plan.** Every existing task points at a non-Life leaf, which under R-goal-39 is not a legal task parent — so the migration must create one Weekly goal per distinct `(goalId, originWeekStart)` among existing tasks and re-point them, including for weeks in the past. That is a **migration**, not a write through the product, and R-goal-36 binds the product: the rule exists so that *planning* cannot rewrite history, and re-homing work that already happened onto a legal parent is not planning. The goal's title comes from that week's focus sentence when one exists and from the parent goal's title otherwise. No route, service or MCP tool may ever perform this write.

**Q-20 — Should a Weekly goal be creatable from the Monthly lens?** ~~`[recommended]` Yes, and it is the natural flow: a Monthly goal's row offers `+ Weekly goal`, which creates it into the **current** week by default (or, when the Monthly lens is showing a future month, the first week of that month).~~
⚠ **Answered differently by the reconciliation pass, and split by surface.** The instinct is right — requiring a zoom to Weekly would make the commonest create a two-lens journey — but `+ Weekly goal` is the wrong affordance for it. A create button for the horizon below, on every card, is a tree growing back one affordance at a time. `[recommended]` **A Monthly goal's card in a lens offers `+ Task` and `Pull from backlog` and no `+ Weekly goal`**; the Weekly goal is *inferred* from the same week clamp (R-task-49) and named before it is created, which answers the same need in one interaction instead of two. ~~The Monthly goal's **detail page** keeps `+ Weekly goal` as its one primary action (R-nav-25) — a detail page is not a lens and already carries exactly one.~~ ⚠ **superseded by R-nav-29 (A3)**: the detail page keeps the *create*, in the `Sub-goals` section it belongs to (R-goal-48), and keeps no primary action at all. The half of this bullet the Monthly **card** depends on — it offers no `+ Weekly goal` — is unchanged.

**Q-21 — How large may the carried band grow before it needs a control?** R-lens-12 deliberately never ages anything out. `[recommended]` No control, and no cap — but the band is collapsible **as a whole** (one disclosure, remembered per session, never per goal), so a week with twelve carried goals still opens on this week's plan. That is presentation, not a rule, and it introduces no state on any row. ⚠ **The reconciliation pass gives it the same vocabulary as everything else that collapses:** R-lens-19's session-scoped, per-lens, never-persisted disclosure, with `aria-expanded` on the band heading. And it records that the UX plan renders **no carried band at all** — §6.5's Weekly lens has no band, no `from week of …` label and no copy for either, while its own mockup draws a task carrying at age 3 inside a *current-week* goal, which R-task-40 makes impossible. R-lens-12 stands; the UX plan changes. If the band is routinely large the product is telling the truth about the account, and the answer is to finish or cancel work, not to hide it.

**Q-22 — Does `Repeat last week` copy across all Life lines or one?** `[recommended]` One line at a time, because "repeat everything" on a busy account creates twenty goals in one tap with no review. An account-wide variant is a follow-up, not a v1.
⚠ **The reconciliation pass moves where it is tapped.** ~~From the Life group's own header~~ — impossible: the header row is entirely the collapse toggle, with no separate button (R-lens-19). `[recommended]` **The group foot in the Weekly lens, beside that group's `+ Weekly goal`** (R-goal-46). That row already exists, keeps the action per-line, adds no chrome, and leaves the header one gesture.

**Q-23 — Are a future period's items editable before the period arrives?** `[recommended]` Yes — unchanged from A1's Q-9. Editing a plan is not doing work; only **completion** is bounded (R-task-44), and R-task-26 already keeps even done tasks editable.

**Q-24 — May a Weekly goal be re-parented?** The owner's ruling says a Weekly goal is "never re-parented or moved forward". This spec reads that as one statement about the **week** (R-goal-40): `periodKey` is immutable, and Move stays available, because re-parenting changes no week and rewrites no history — it corrects which intention a week served. `[recommended]` Keep Move. Forbidding it would make Weekly the only horizon in the product that cannot be corrected after the fact, and the correction it enables — "this belonged under the other monthly goal" — is exactly the kind of tidying the tree already supports everywhere else. **If the owner meant Move as well, say so and R-goal-40 loses one clause; nothing else in A2 depends on it.**

#### Amendment 8 — new questions

**Q-25 — Should goals carry targets too?** Raised in the A8 conversation; the owner did not answer. The evidence for it is real and specific: their own Quarterly goal is titled *"Sign at least 2 clients for application-processing automation"*, with the number in the title **because there is nowhere else to put it**. `[recommended]` **No — not in A8, and not as an extension of the measure model.** Three reasons, and one honest alternative:
  1. **A goal has no completion state, by design** (R-goal-45), and that is not an omission — it is the rule that keeps the product from acquiring a completion *rate*, which wants a week report, which is the surface R-nav-26 removes. A target on a goal asks for a progress bar on a goal within one release.
  2. **Whose readings?** If the goal's own, the owner maintains one number in two places and they drift. If rolled up from the tasks beneath it, **the app is computing a number about the owner** — the exact line R-measure-8 draws, and the reason there is no roll-up anywhere.
  3. **The friction is already answered.** *"Sign at least 2 clients"* is a counter with `start 0, target 2, unit clients`, on a **Monthly task** on that quarter's monthly goal — which A8 makes possible for the first time. That is a real answer, not a deferral: the number gets a home, it accumulates, it has a history, and it does not need a goal to grow a completion model.
  - **If it is ever revisited**, the shape that would be acceptable is narrow and should be stated now: a measure on a goal with **no roll-up from anything below it**, **no bar on a lens card**, and **no completion state** — a number on the detail page and in the goal's accessible name, and nothing else. Anything wider reopens R-goal-45 and R-nav-26 together.

**Q-26 — How many readings, and is a long history ever compacted?** A daily counter produces ~365 readings a year and a task can carry indefinitely. `[recommended]` Cap at **2,000 readings per task**, enforced on write, with **no compaction, no rollup and no pruning** — the same answer Q-12 gives for goals and for the same reason: the owner's dislike of clutter is about screens, not rows, and the task page renders a sparkline plus the *recent* values, so a long history costs a scroll nobody performs. Compacting would average or bucket the owner's own numbers, which is the app editing their data. The cap exists to bound one payload, and the refusal names it.

**Q-27 — Does the readings list need paging on the task page?** `[recommended]` The task-page read returns the readings for the sparkline (all of them, bounded by Q-26) and renders the most recent **20** as values, with `Show all` expanding in place — presentation, not a rule, and no second read. If Q-26's cap is ever raised the read must page instead.

**Q-28 — May a *week* task be created with a month's deadline in mind, i.e. does parking need a memory?** `[recommended]` **No.** Parking sets the task's period to the week and the month deadline is gone; a "parked from Sep 2026" note would be a second period on a task that has one, which is D-1's failure mode. If the week passes and the work is still wanted, it carries as a week task with the week's own chip — a *stronger* signal than the month's, not a weaker one — and `Move to the month` returns it (R-task-56).

---

## 5. Mockup bugs and spec corrections

Each entry: what the mockup does → what the spec requires → why. The rule text in §2 already reflects the corrected behaviour.

**D-1 — Week offsets are stored as relative integers and decay over time.**
*Mockup:* `Task.originWeek` and `doneWeek` are integers relative to "this week" (`originWeek: -2`), and `visibleIn` compares them to the viewed offset. Every persisted row therefore means something different next Monday: a task stored with `originWeek = -2` silently becomes three weeks old with no write.
*Spec:* store absolute Monday dates (`originWeek`, `doneWeek`, `fromWeek`, `WeeklyFocus.weekStart`). Offsets are a presentation-layer projection computed against the current week (R-task-5, Q-9).
*Why:* a relative offset is only correct at the instant it is written. This is the single most damaging thing to inherit, because the mockup looks correct forever — its data is regenerated on every reload.

**D-2 — Weekly focus is a string on Goal, so it has no week dimension.** ⚠ **A2 — the entity is deleted, the principle is not.** D-2's content was never really about `weekly_focus`; it was *planning must not rewrite history*. That is now **R-lens-10** and **R-goal-36**, applied to all five horizons: a goal is never created into or moved into a past period, and a past period renders exactly what was there. Cite R-lens-10 where you would have cited D-2.
*Mockup:* `Goal.focus: string`; `isActive` = leaf with a non-empty `focus`. Viewing a past week hides the sentence (`w === 0 && g.focus`) precisely because the model cannot say what the focus *was*.
*Spec:* WeeklyFocus is its own entity keyed `(goalId, weekStart)` (§1, R-plan-1). "Active" means "has a focus for the current week" (R-goal-9). Past weeks render their own focus sentence.
*Why:* BUSINESS-RULES calls it "one sentence per leaf **per week**"; a single mutable string cannot represent that, cannot be audited, and makes the current week's plan destroy last week's.

**D-3 — `defaultPeriod` and `replanPeriods` are hardcoded 2026 literals.**
*Mockup:* `defaultPeriod` returns `'2026' / 'Q4 2026' / 'Sep 2026'`; `replanPeriods` returns `['Oct 2026','Nov 2026'] / ['Q4 2026','Q1 2027'] / ['2027']` — constants, never derived from the clock. In September 2026 a new Quarterly goal defaults to `Q4 2026` (the *next* quarter, not the current one) and a Quarterly re-plan offers `Q4 2026` as a "next" period even when the goal is already in it.
*Spec:* both are pure functions of `(horizon, today)` — R-goal-13, R-goal-23. Re-plan options are strictly *after* the goal's current period.
*Why:* the mockup is frozen at its authoring date; shipping these makes every default wrong from the first day of the next period, and lets re-plan "move" a goal to the period it is already in.

**D-4 — `doneLabel` records today, not the day of completion in the viewed week.**
*Mockup:* `toggleTask` sets `doneWeek: viewedWeek` but `doneLabel: todayStr()`. Completing a task while viewing week −2 stamps it `Done <today>` inside a week that ended a fortnight ago, and the string is never cleared on uncheck (a stale `doneLabel` survives on an open task).
*Spec:* store `doneAt` (a timestamp) and derive the label; on uncheck clear both `doneWeek` and `doneAt` (R-task-14, R-task-19).
*Why:* an internally contradictory record — a completion dated outside the week it claims to belong to.

**D-5 — Store-level validation is absent: the UI is the only guard.**
*Mockup:* `moveGoal` writes `parentId` with no descendant or horizon check; `saveGoal` performs no rank check; `savePlan` trusts the client's leaf set; `saveNewTask` never verifies the target is an active leaf. Every constraint in §2 is enforced only by disabling a button.
*Spec:* the server re-validates every invariant regardless of what the client renders (Q-10, and the "submitted directly" halves of S-goal-5-2, S-goal-6-1, S-goal-18-1, S-backlog-8-3).
*Why:* a disabled button is a hint, not an invariant. The mockup can be driven into an illegal tree (a cycle, Monthly-under-Monthly) with two lines in the console.

**D-6 — `+ Sub-goal` under a Monthly goal produces an illegal goal if reached.** ⚠ **A2 — moved one level, not fixed.** Monthly now accepts children (R-goal-31); the identical clamp defect now applies to **Weekly**, which is the terminal horizon. The guard and its scenario must move with it (S-goal-31-1), not be deleted along with the Monthly rule.
*Mockup:* the affordance is hidden for Monthly, but `openGoalModal({parentId: monthlyId})` computes `minRank = 4` and clamps to `HORIZONS[Math.min(4,3)] = 'Monthly'`; every chip is then locked *except* the already-selected Monthly, so `saveGoal` happily creates a Monthly child of a Monthly parent.
*Spec:* R-goal-6 — refuse at the server; the client must not be able to open the modal in that state.
*Why:* the clamp turns an impossible state into a plausible-looking one instead of an error.

**D-7 — The move sheet filters the goal itself out instead of disabling it.**
*Mockup:* `targets = flatTree(...).filter(r => r.g.id !== mvNode.id)` — the goal silently vanishes from its own move list, while BUSINESS-RULES says invalid targets are "shown disabled with the reason". The current parent is also offered as a valid target (a no-op move).
*Spec:* R-goal-18/19 — show the goal itself disabled with `its own descendant`; the current parent may stay selectable but the move is a no-op that logs nothing.
*Why:* consistency of the disabled-with-reason affordance; a row that disappears reads as a bug to the user.

**D-8 — Giving a leaf a child orphans its focus and hides its tasks.** ⚠ **A2 — MOOT.** Only Weekly goals hold tasks and a Weekly goal can never gain a child, so the leaf → non-leaf transition can no longer strand anything (R-goal-42). The refusal it prescribed, and the `GOAL_HAS_OPEN_TASKS` code, are removed rather than reimplemented.
*Mockup:* nothing runs when a goal gains a child. The ex-leaf keeps its `focus` string (inert, because `isActive` requires `isLeaf` — but it silently reactivates if the child is ever moved away), and its tasks keep pointing at it. `TasksScreen`'s `sectionGoals` requires `isLeaf`, so those tasks vanish from every week with no message, while `savePlan` never clears the stale focus because it only maps over leaves.
*Spec:* R-goal-28 — on the transition leaf → non-leaf, delete the current-week focus, and either refuse the operation while open tasks exist or re-parent them to the new child, in the same transaction. Recommended: **refuse** with `goal has open tasks; move or close them first`, because silently re-homing someone's work is worse than a clear error.
*Why:* silent data disappearance plus a latent resurrection of a focus nobody wrote.

**D-9 — Checking a leaf with a blank sentence silently drops the check.** ⚠ **A2 — MOOT.** There is no plan screen and no checkbox to drop. Its principle — a refused write must be surfaced, never silently discarded — is Q-10's and survives there.
*Mockup:* `savePlan` writes `''` for a checked leaf with an empty draft and toasts `Plan saved`; the user believes the branch is active and finds it dormant.
*Spec:* R-plan-5 — the client blocks the save (or flags the row) and tells the user which checked branches lack a sentence.
*Why:* BUSINESS-RULES says "focus sentence required for it to stick"; that requirement needs feedback, not a silent discard.

**D-10 — Hardcoded mock goal ids in production paths.** ⚠ **A2 — unchanged in force and newly relevant.** R-task-48 makes "no Weekly goal exists" a routine state rather than an edge case, and the temptation to resolve it with an implicit inbox or default goal is exactly this defect. There is no fallback goal: the flow creates a real one the owner named (S-task-48-3).
*Mockup:* `initialState.tmGoalId = 'g4'`, `blGoal = 'g3'`, `bdGoal = 'g3'`, and `IdeasScreen`'s "Task this week" falls back to `'g4'` when no leaf is active — literal seed ids from `data/mock.ts`.
*Spec:* R-auth-6, R-task-4 — no fallback goal exists; when no leaf is active, creation is blocked and the user is routed to planning. Last-used-goal defaults resolve to a real id or to "none".
*Why:* against any real account these ids belong to nothing (or, worse, to something else).

**D-11 — "Dormant … never on the Tasks screen" vs. dormant leaves carrying open tasks.** ⚠ **A2 — this one is load-bearing and survives verbatim in force.** Its ruling (carried work is never hidden the moment its container goes quiet) is now **R-lens-12**'s carried band. The failure it describes is the single easiest one to reintroduce in this redesign, because a Weekly goal is bound to a week in a way a leaf never was.
*Mockup:* `sectionGoals` includes any leaf with visible tasks, active or not — so a dormant leaf's carried tasks still appear.
*Spec:* the mockup is right and the prose is loose. R-task-9/R-nav-8 — dormancy removes the *empty* section, the focus sentence, and the `+ Task` affordance; it never hides existing open work.
*Why:* hiding carried tasks the moment a branch goes dormant would delete the carry mechanic (R-task-7) and lose work silently.

**D-12 — `fromWeek` on a moved-out task is always the current week.**
*Mockup:* `confirmAction` writes `fromWeek: 'week of ' + wm(0)` regardless of the week being viewed, and stores it as a display string.
*Spec:* R-task-15 — `fromWeek` is the Monday date of the week the task was live in, stored as a date.
*Why:* the note exists to say where the item came from; hardcoding "this week" makes it noise.

**D-13 — Link removal is silent.**
*Mockup:* `removeTaskLink` mutates `links` and logs nothing, while `addTaskLink` logs `Link added: <host>`.
*Spec:* R-task-25 — log `Link removed: <host>`.
*Why:* an activity timeline that records additions but not removals misrepresents the task's history.

**D-14 — Nothing produces the `Carried to week of …` entries.**
*Mockup:* they exist only in `data/mock.ts` fixture rows; no code path creates one.
*Spec:* R-task-29 + Q-17 — a server-side, idempotent weekly rollover produces exactly one per task per week crossed.
*Why:* BUSINESS-RULES lists it as a timeline entry; without a producer the design's most visible "the app noticed" signal never fires in production.

**D-15 — Move-to-Backlog and Cancel destroy the record, and with it the event and the reason.**
*Mockup:* both `filter` the task out of the array. The optional reason is passed to `persist()` and then lost; the `Moved to Backlog` / `Canceled` entries in BUSINESS-RULES have nowhere to be written.
*Spec:* R-task-32 + Q-6 — the task survives with a terminal `status`, `exitReason`, `exitedAt`, and its final event; it is excluded from every week view and count.
*Why:* the ruleset explicitly names two events that the implementation makes unrepresentable.

**D-16 — `Math.max(under.length, 1)` fabricates a branch.**
*Mockup:* a Life goal with no leaves renders `0 of 1 branches active`.
*Spec:* R-goal-26 — `0 of 0 branches`.
*Why:* the summary states a count that is not true.

**D-17 — "Newest first" is not actually implemented.**
*Mockup:* `when`/`fromWeek`/`doneLabel` are display strings (`'Today'`, `'25 Aug'`, `'Last week'`) with no sortable value; ordering comes from `addBacklogItem` prepending. `moveBacklogItem` and any refetch scramble it.
*Spec:* R-backlog-5 + Q-7 — sort by real timestamps with an explicit tie-break; display strings are rendered, never stored.
*Why:* the stated ordering rule is unenforceable against the stored shape.

**D-18 — `pullToWeek` resolves the target leaf arbitrarily.** ⚠ **A2 — unchanged in force**, with "active leaf" reading "Weekly goal for the target week" (R-backlog-26). One candidate is used silently; two or more require the owner to choose; array order is still not a decision.
*Mockup:* `activeLeafFor` returns `goals.find(...)` — the first active leaf in array order at or under the item's goal. An item on a Quarterly goal with two active Monthly children lands under whichever happens to come first in the array, with no indication to the user. The planning screen does the right thing (it passes the leaf explicitly); the Backlog and goal-detail screens do not.
*Spec:* R-backlog-7 — a single candidate is used silently; two or more requires the user to choose.
*Why:* the task's `goalId` determines which focus it belongs to for the rest of its life; array order is not a decision.

**D-19 — Double conversion creates a duplicate task from a vanished item.**
*Mockup:* `saveNewTask` does `backlog.find(...)` for the description/links and `backlog.filter(...)` to remove. If the item is already gone (a stale second modal, a retry), `find` returns `undefined`, `filter` is a no-op, and a **second** task is created — titled from the stale prefill, sourced `Created — pulled from Backlog`, missing its description and links. Worse, the removal is never sent to the API at all (only `task.create` is persisted), so a real server would never learn the item was consumed.
*Spec:* R-backlog-6/9 + Q-4 — one atomic, idempotent conversion; a repeat is refused.
*Why:* this is the "converting a backlog item twice" case (S-backlog-6-2) and the mockup gets both halves wrong: it duplicates, and it never deletes.

**D-20 — Backlog affordances differ by screen.**
*Mockup:* the goal-detail backlog block offers `Add to this week` and `Delete` but not `Move to another goal`; the Backlog page offers all three.
*Spec:* R-backlog-11 — the same three actions on both.
*Why:* BUSINESS-RULES lists move as a first-class backlog action; an item's available actions should not depend on which screen you found it from.

**D-21 — "Also add to the current week" does not *also* do anything.** ⚠ **A2 — unchanged**, with the target resolved to a Weekly goal and the fallback toast reworded (R-backlog-27).
*Mockup:* with the box ticked and a leaf active, `saveBacklogDrawer` creates a task and **no** backlog item; with no leaf active it creates a backlog item and no task. Either way exactly one entity is created, never both.
*Spec:* R-backlog-15 keeps the single-entity behaviour (it matches conversion semantics: work lives in one place) and corrects the copy to `Add to this week instead`.
*Why:* the label promises two records; shipping "also" while creating one would be a data bug reported by the first user who looked in the backlog for it.

**D-22 — "Task this week" deletes the idea before the task is saved.** ⚠ **A2 — MOOT.** Ideas are deleted (R-rm-1). Its principle — consume the source only on a successful write, in the same transaction — survives and is exactly what R-task-48's atomic goal-plus-task create must honour.
*Mockup:* `IdeasScreen` removes the idea from `parking` and *then* opens the create modal. Dismissing the modal loses the idea permanently, with no undo — in the one feature whose whole promise is "capture it and get back to work".
*Spec:* R-idea-4 — the idea is consumed only on successful task creation, in the same transaction.
*Why:* unrecoverable data loss on a cancel.

**D-23 — `Learning.applied` can never be set.**
*Mockup:* the field exists and renders the `changed the plan` badge, but no UI writes it; only the seed data has `applied: true`.
*Spec:* R-learning-4 — an explicit user action toggles it.
*Why:* a badge nobody can earn is a dead field; BUSINESS-RULES names it as a real product signal.

**D-24 — The two week controls disagree on how far back you can go.** ⚠ **A2 — restated, not retired.** With both bounds gone (R-lens-7) the rule is no longer "one bound for both controls" but "**one range** for both controls": the picker becomes a re-centring window rather than a fixed list, so no period is reachable by one control and invisible to the other. The defect this prevents is unchanged; only the shape of the fix moves.
*Mockup:* the chevron clamps at `-8` while the picker lists `0, -1 … -5`. Weeks −6 to −8 are reachable by one control and invisible to the other.
*Spec:* R-nav-4 — one bound for both (recommended: 8 weeks).
*Why:* two sources of truth for the same limit.

**D-25 — Dark mode is a CSS filter on `<html>`.**
*Mockup:* `applyTheme` sets `filter: invert(1) hue-rotate(180deg)` (the file says so: "Demo-level dark mode"). It inverts images, breaks the pulse colours' meaning, and is not persisted across reloads.
*Spec:* R-nav-12 — real light/dark tokens, persisted per user.
*Why:* an inverted screenshot is not a theme.

**D-26 — Deletes and captures are not persisted.**
*Mockup:* idea `Delete`, learning `Discard`, learning re-tag, and the backlog side of a conversion all mutate local state without any `api.persist` call; every write is fire-and-forget with no error handling (`client.ts` says "add error handling/rollback").
*Spec:* every state change is a server operation with a response and rollback on failure (Q-14).
*Why:* in the mockup a reload restores deleted items; against a real API these operations would appear to work and then silently revert.

**D-27 — Non-null assertions on goal lookups will crash once goals can be deleted.**
*Mockup:* `rootOf(st.goals, s.node(t.goalId)!)` in `TasksScreen.openCount` and `GoalsScreen.carryLine` assume a task's goal always exists. No delete-goal action exists yet, so the assumption holds only by omission.
*Spec:* Q-5 — deletion cascades so no task ever outlives its goal; the client still handles a missing goal defensively rather than throwing.
*Why:* the first delete feature turns two summary lines into a white screen.

---

## 6. Amendments

An amendment is a set of changes applied after the first draft, recorded so a reviewer can diff intent
rather than archaeology. Every rule an amendment touches is marked `⚠` in §2 with the rule that replaces
it. Superseded rule text is **left in place, struck through by the marker rather than deleted**, so the
before and after sit next to each other.

### Amendment 1 — several weekly focus sentences, planning ahead, tasks in future weeks, manual backlog order

Requested changes: (1) several focus sentences per goal per week; (2) plan future weeks; (3) create tasks
in future weeks, including a backlog pull; (4) manual per-goal ordering of backlog items by drag **and by
keyboard**.

**Added:** 30 rules — `R-plan-13 … R-plan-20` (8), `R-task-33 … R-task-38` (6),
`R-backlog-17 … R-backlog-25` (9), `R-nav-16 … R-nav-22` (7). Total rules 125 → 155.
**Scenarios added:** 54 (103 → 157). **Existing rules superseded or modified:** 31, each marked `⚠` in §2
and listed below. **Scenarios superseded, re-pointed or narrowed:** 4.
**New constant:** `PLAN_AHEAD_WEEKS = 4`. **New error code:** `WEEK_NOT_PLANNABLE` (409), replacing
`WEEK_NOT_CURRENT`. **New fields:** `WeeklyFocus.sortKey` (int), `BacklogItem.sortKey` (string).

#### The four questions this amendment had to settle

| Question | Ruling | Rule |
|---|---|---|
| Do tasks attach to a focus sentence? | **No** — leaf + week only. No `focusId`, not even optional. Sentences are parallel intents for one leaf, not sub-buckets. | R-task-33 |
| What is an "active leaf" now? | A non-Life leaf with **at least one** focus row for the week in question. Every dependent rule (dormancy, propagation, branch counts, conversion targets) holds unchanged, because all of them already asked "is there a row?", never "is there exactly one?". | R-goal-9 |
| How far ahead can you plan? | Current week + 4. A validation bound, not a picker bound; deliberately asymmetric with the 8-week history bound. | R-plan-15 |
| Can a past week's plan still not be edited? | **Correct, unchanged.** Writable weeks are exactly offsets `0 … +4`. Past weeks are readable forever and writable never (D-2). | R-plan-15 |

#### Superseded and modified rules — before → after

| Rule | Before | After |
|---|---|---|
| R-goal-9 | active = leaf with **a** WeeklyFocus for the **current** week | active = leaf with **at least one** WeeklyFocus for **the week in question** |
| R-goal-10 | dormant = no focus for the current week | dormant = **no** focus row for the week in question |
| R-goal-25 | tree row shows "the focus sentence when active" | shows the **first** sentence + `+N more` (R-nav-21) |
| R-goal-27 | detail shows "the weekly-focus block" | shows the week's **ordered list** of sentences |
| R-goal-28 | leaf gains a child ⇒ its **current-week** focus is deleted | ⇒ its focus rows for the current week **and every later week** are deleted; rows for past weeks survive as history |
| R-plan-1 | one sentence per non-Life leaf per week | **one to five** sentences (R-plan-13) |
| R-plan-2 | planning edits the **current week only**; save returns to Tasks at week 0 | planning edits any week in `0 … +4`; save returns to Tasks **at the week planned** (R-plan-15, R-plan-17) |
| R-plan-3 | one textarea per leaf; screen copy fixed to "this week" | a removable list of fields per leaf; the screen names the week it is planning (R-plan-17/18) |
| R-plan-4 | textarea pre-filled with **the** current focus | fields pre-filled with **the** week's sentences, in order (R-plan-18) |
| R-plan-7 | whole-week replace over the current week | whole-week replace over **one named plannable week**, with entry `id`s so `createdAt` survives an edit (R-plan-16) |
| R-plan-9 | backlog pull is bound to this week | bound to **the week being planned** (R-backlog-25) |
| R-plan-11 | toast `Plan saved` | `Plan saved for week of <Mon d Mon>` when the week is not the current one |
| R-task-4 | target list = currently active leaves, labelled with **the** focus sentence | leaves active **in the target week**, labelled with the first sentence + `+N more` |
| R-task-5 | `originWeek` is always the **current** week | `originWeek` is the **target** week, in `0 … +4`; still server-assigned and immutable (R-task-34) |
| R-task-6 | tasks can only be created into the current week; no back-dating; `+ Task` only at week 0 | created into any plannable week; **no back-dating, unchanged**; `+ Task` at any plannable week (R-task-34, R-nav-22) |
| R-task-10/11/12 | `age = viewWeek − originWeek` | `age = max(0, viewWeek′ − originWeek)` where `viewWeek′ = min(viewedWeek, currentWeek)` (R-task-37) |
| R-task-14 | complete in **any** viewed week | unchanged in substance; R-task-35 states the bound explicitly: `originWeek ≤ week ≤ currentWeek` |
| R-task-29 | `Carried to week of …` once per week crossed | unchanged, **plus** a clamp: never logged for a week later than the current one, however far ahead the user looks (R-task-38) |
| R-backlog-5 | items ordered `capturedAt` desc within their group | within a **goal**, `sortKey` asc then `capturedAt` desc; across goals, unchanged (R-backlog-17/21) |
| R-backlog-7 | conversion target = active leaf at/under the item's goal | active **in the target week** (R-backlog-25) |
| R-backlog-8 | refusal copy "This branch isn't active **this** week" | "…isn't active **that** week" when the target is not the current week |
| R-backlog-10 | move changes `goalId`; `capturedAt`/`fromWeek` unchanged | unchanged, **plus** a fresh `sortKey` at the top of the destination (R-backlog-20) |
| R-backlog-13 | Backlog page groups newest first | groups newest first; **within** a group, that goal's manual order (R-backlog-21) |
| R-nav-3 | forward chevron disabled at week 0; future never selectable | forward chevron disabled at `+4`; `−7 … +4` selectable (R-nav-16) |
| R-nav-4 | picker = the current week and the previous N | picker = `−7 … +4`, both controls, one bound per direction (R-nav-16) |
| R-nav-5 | past weeks badged `Past week — still editable` | unchanged, plus `Future week — planning ahead` (R-nav-17) |
| R-nav-8 | section when ≥1 visible task **or (week 0 only)** active; focus sentence **week 0 only** | section when ≥1 visible task or the week is plannable and the leaf is active in it; sentences render in **whatever week is viewed** — the old clause contradicted D-2 (R-nav-21/22) |
| R-nav-9 | two empty states (week 0, past week) | three: the future week gets its own copy and CTA (R-nav-20) |
| R-nav-10 | `Edit plan` at week 0 only | `Edit plan` at any plannable week, opening the plan screen on it (R-nav-20) |

#### Superseded scenarios

| Scenario | Disposition |
|---|---|
| S-nav-3-1 | **Retired.** It asserts precisely the behaviour this amendment removes. Replaced by S-nav-16-1 and S-nav-16-2. |
| S-plan-2-1 | **Kept verbatim, re-pointed** from R-plan-2 to R-plan-15; the refusal code becomes `WEEK_NOT_PLANNABLE`. |
| S-goal-9-1 | **Narrowed.** "The stale row must not exist" now applies to the current week and every later week; past rows survive as history. |
| S-task-5-1 | **Re-pointed** to R-task-34 and reworded: the target week falls back to the current week when the viewed week is not plannable. |
| S-task-11-2 | **Unchanged and load-bearing** — it is the proof that R-task-37's clamp is inert for past and current views. |
| S-task-14-2 | **Unchanged and now reachable.** "Or a future week" was previously unhittable through the UI; it is the guard R-task-35 relies on. |
| S-backlog-5-1 | **Kept** as the no-manual-order default (R-backlog-18 makes it still true). |

#### Consequences checked and found to hold unchanged

- **R-goal-11 (dormancy propagates up)** — asks only whether *any* leaf below is active; several sentences on one leaf change nothing.
- **R-goal-26 (`A of B branches active`)** — counts leaves, not sentences. A leaf with three sentences is one active branch.
- **R-goal-24 (life-goal carry signal)** — counts open tasks originating *before the current week*; a future origin can never qualify. No guard needed.
- **R-task-7/8 (visibility)** — unchanged, and now the mechanism that keeps future work out of today's numbers (R-task-38).
- **R-task-13 (exactly three exits)** — unchanged. A future-dated task uses two of the same three (R-task-36); no "move to another week" exists, and S-task-13-1 still refuses one.
- **R-task-19 (uncheck)** — unchanged: a task completed in a past week and unchecked carries into the current week under its original origin. No future-week interaction.
- **R-backlog-6/9 (conversion is atomic and once-only)** — unchanged; only the target week is new.
- **R-backlog-12 (Life-goal read-only aggregate)** — unchanged, and explicitly exempt from manual order (R-backlog-21).
- **R-nav-14 (removed by design)** — unchanged, and R-plan-20 defends it: an arriving plan gets no review step.
- **R-auth-5 / Q-9 (week boundaries from the owner's timezone)** — unchanged and now more load-bearing: `PLAN_AHEAD_WEEKS` is counted from the same server-derived current week.
- **Q-5 (goal deletion cascade)** — unchanged: it already deletes every WeeklyFocus in the subtree, of every week.

### Amendment 2 — lens navigation, the Weekly horizon, Ideas removed

The owner reviewed the product in use and asked for six changes at once
(`docs/work/14-redesign/CHANGE-REQUEST.md`): lenses instead of a tree, a period dimension inside each
lens, the Tasks page absorbed into the Weekly lens, weekly focus becoming Weekly goals, a task detail
page, and Ideas deleted. Two of them change the shape of the goal tree and retire an entity, which is
why they are batched.

**Added:** 56 rules — `R-goal-30 … R-goal-46` (17), `R-lens-1 … R-lens-16` (16, a new area),
`R-task-39 … R-task-48` (10), `R-backlog-26 … R-backlog-29` (4), `R-nav-23 … R-nav-26` (4),
`R-rm-1 … R-rm-5` (5, a new area). Total rules 155 → **211**.
⚠ **The reconciliation pass adds 16 more** — `R-goal-47`, `R-lens-17 … R-lens-27` (11), `R-task-49`,
`R-task-50`, `R-nav-27`, `R-nav-28` — taking the total to **227**. See "Reconciliation pass" at the end
of this amendment.
**Scenarios added:** 99 (157 → **256**).
**Existing rules superseded, retired or modified:** 84 — every one marked `⚠` in §2 and listed below.
Of those, **32 are retired outright**, 23 of them the whole of `### Plan` and `### Idea`.
Thirteen rules carry an Amendment-1 marker that A2 has since superseded in turn (`R-nav-3/4/8/10`,
`R-task-2/5/6/14/29/30`, `R-backlog-4/5/13`); follow the chain one more hop — A1's replacement is
itself marked, and the table below names the A2 rule that ends it.
**Scenarios retired, superseded or re-pointed:** 43 individually, plus the whole `### Plan` and
`### Idea` scenario sections.
**New field:** `Goal.periodKey`. **Removed fields:** `GoalView.focus`, `.isLeaf`, `.isActive`,
`.dormant`, `.subtreeActive`, `.branches`; `Goal.period` becomes server-derived.
**New error codes:** `PERIOD_IN_PAST` (409), `NOT_A_WEEKLY_GOAL` (409), `NO_WEEKLY_GOAL` (409).
**Removed error codes:** `WEEK_NOT_CURRENT`, `NOT_A_LEAF`, `BRANCH_NOT_ACTIVE`, `GOAL_HAS_OPEN_TASKS`.
**Removed constants:** `PLAN_AHEAD_WEEKS`, `MAX_PLAN_ENTRIES`, `MAX_FOCUS_SENTENCES`;
`WEEK_HISTORY_WEEKS` survives only as a picker window, not a bound.
**Deleted entities:** `WeeklyFocus`, `Idea`.

#### The seven questions this amendment had to settle

| Question | Ruling | Rule |
|---|---|---|
| Is Weekly a real horizon with a parent? | **Yes** — rank 4, terminal. Monthly accepts children; levels may still be skipped, so a Weekly goal may hang off any longer horizon including Life. | R-goal-30/31/32 |
| Which goals hold tasks? | **Weekly goals, and only Weekly goals.** The condition is `horizon = 'Weekly'`, **never** leaf-ness — a childless Monthly goal is a leaf and must never hold a task. | R-goal-39 |
| Is a task's week its own field, or implied by its Weekly parent? | **Its own stored field**, seeded once from the parent at creation and immutable. Carry, uncheck and D-1 each independently require it; deriving it would put the two halves of the week model in different places. | R-task-40 |
| What happens to *leaf*, *active*, *dormant*? | **leaf: retired** as a product word (it stopped being coextensive with "holds work"). **active: redefined** — a Weekly goal is active in the one week it belongs to. **dormant: redefined** per week, off `periodKey`, with exactly one surface and no styling anywhere. | R-goal-37, R-goal-38 |
| What identifies a period? | A canonical, sortable **`periodKey`** per horizon. Free-text `period` becomes a derived label: a lens must *partition* a horizon's goals, and free text partitions nothing. | R-goal-33 |
| How far can you plan ahead? | **No bound, in either direction.** Every future period is writable, every past period readable; the only period refusal is a **write into the past**. This reverses A1's `PLAN_AHEAD_WEEKS = 4`. | R-goal-36, R-lens-7 |
| What happens to existing Ideas? | **Deleted with the table.** No migration, no export. The owner: *"forget about it nor i care about its data as i didnt use it."* | R-rm-1 |

#### Superseded, retired and modified rules — before → after

| Rule | Before | After |
|---|---|---|
| R-goal-1 | goal has `period`, children, four horizons | `periodKey` (R-goal-33); Monthly may have children (R-goal-31) |
| R-goal-2 | four horizons, ranks 0–3 | **five**, ranks 0–4 (R-goal-30) |
| R-goal-5 | strictly decreasing rank | unchanged in form; the rank set is 0–4 and Monthly is no longer terminal |
| R-goal-6 | **Monthly** can never have sub-goals | **Weekly** can never have sub-goals; Monthly now accepts Weekly children (R-goal-31) |
| R-goal-7 | max depth 4 | max depth 5; levels may still be skipped (R-goal-32) |
| R-goal-8 | leaf = zero children, and the thing that holds work | **retired as a word.** Every use becomes "a Weekly goal" or "a goal with no children" (R-goal-37) |
| R-goal-9 | active = non-Life leaf with a focus row for the week | active = a **Weekly goal whose `periodKey` is that week** (R-goal-38) |
| R-goal-10 | dormant = a non-Life leaf with no focus row; rendered muted with a `DORMANT` line | dormant = a **non-Weekly goal with no active Weekly goal below it** that week; **nothing is muted or labelled anywhere** (R-goal-38) |
| R-goal-11 | dormancy propagates up from focus rows | unchanged in shape, read off `periodKey`; no styling (R-goal-38) |
| R-goal-12 | goals never hold tasks; tasks hang off a focus | tasks hang off **Weekly goals** directly (R-goal-39) |
| R-goal-13 | `period` free text, defaulted from today | `periodKey` canonical and required; `period` a derived label (R-goal-33) |
| R-goal-14 | edit may change `period` | edit may change `periodKey`, never into a past period (R-goal-36) |
| R-goal-22/23 | re-plan sets `period`; options per horizon | re-plan sets `periodKey`; **a Weekly goal is not re-plannable** and its week is immutable (R-goal-40) |
| R-goal-25 | the goals tree: grouped under Life roots, expand/collapse per node, focus sentence on the row | **retired.** Five flat lenses grouped by Life goal, no tree, no collapse (R-lens-1 … R-lens-6) |
| R-goal-26 | `A of B branches active` on a life-goal card | **retired, no replacement.** The surviving group-header number is the open-task count (R-lens-4) |
| R-goal-27 | detail shows focus block, dormant block, per-child active/dormant labels | detail shows ancestry **with periods**, children with periods, tasks on a Weekly goal; no focus or dormant block (R-goal-41) |
| R-goal-28 | leaf gains a child ⇒ delete its focus rows, re-parent or refuse its tasks | **retired.** Unreachable: only Weekly goals hold tasks and they can never gain children (R-goal-42) |
| R-plan-1 … R-plan-8, R-plan-11 … R-plan-14, R-plan-16 … R-plan-18 | the `weekly_focus` entity, the plan screen, the whole-week replace, several sentences per leaf | **retired, no replacement** (R-rm-2, R-rm-3). Multiplicity is now several Weekly goals under one parent |
| R-plan-9 / R-plan-10 | `FROM THE BACKLOG` under each checked leaf on the plan screen | the same list on a **Weekly goal's detail page**, over its ancestors (R-backlog-28) |
| R-plan-15 | writable weeks are `0 … +4`; past weeks readable, never writable | **no forward bound**; past **periods** readable, never writable, at every horizon (R-goal-36, R-lens-7, R-lens-10) |
| R-plan-19 | `planned N weeks ago` on a focus row | the same muted line on a **Weekly goal** (R-goal-43) |
| R-plan-20 | an arrived plan is asked nothing | unchanged, restated for a Weekly goal (R-goal-44) |
| R-task-1 | a task lives under an active non-Life leaf's focus | a task lives under a **Weekly goal** (R-task-39) |
| R-task-2 | four creation sources | **three** — the Idea source is deleted (R-task-41) |
| R-task-4 | target list = leaves active in the target week, labelled with a focus sentence | target list = **Weekly goals for the target week**, labelled with their titles (R-task-41); the dead-end case becomes an inline create (R-task-48) |
| R-task-9 | a dormant leaf's open tasks stay visible | **every** task visible in a week appears in that week's lens, its goal carrying with it (R-lens-12) |
| R-task-10/11/12 | `age = max(0, …)`, clamped at 0 | `age` is **signed** and may be negative; the 1-week and 2-week thresholds are unchanged (R-task-43) |
| R-task-20 | uncheck does not require the owning leaf to be active | the clause is vacuous and removed; no re-parent, no goal write — unchanged |
| R-task-22 | the task detail **sheet** | a routed task **page** (R-task-45) |
| R-task-29/30 | timeline incl. `Created — weekly planning` and `Created — from an Idea` | those two rows renamed and retired; every other entry unchanged (R-task-46) |
| R-task-33 | no `focusId` on Task — a task keys on (leaf, week) | there are no focus sentences; the ruling survives as (Weekly goal, own stored week) (R-task-40) |
| R-task-34 | `originWeek` is a **target week** input, bounded `0 … +4` | there is **no week input**: `originWeek` is seeded from the Weekly parent. No-back-dating survives, enforced through the parent (R-task-40, R-task-41) |
| R-task-37 | `carryWeeks` clamped to `≥ 0` | signed; `TaskView.carryWeeks` stops being `nonnegative` — a **silent wire break** (R-task-43) |
| R-task-38 | future work is out of today's numbers, incl. the filter-pill counts | unchanged **except** the pill bullet, which retires with the pills; the counts move to group headers (R-lens-4) |
| R-backlog-2 | never a Life goal | never a Life goal **and never a Weekly goal** — a backlog item has no week (R-backlog-26) |
| R-backlog-4 | four creation sources | **three** — the Idea source is deleted |
| R-backlog-7 | conversion target = the active leaf at/under the item's goal | = the **Weekly goal** at/under it for the target week; the ambiguity ruling and D-18 unchanged (R-backlog-26) |
| R-backlog-8 | `BRANCH_NOT_ACTIVE`; sheet "This branch isn't active this week" → `[Set a weekly focus]` | `NO_WEEKLY_GOAL`; sheet "No weekly goal here for that week" → **inline create** (R-backlog-26, R-task-48) |
| R-backlog-15 | `+` drawer resolves an active leaf | resolves a **Weekly goal**; fallback toast reworded (R-backlog-27) |
| R-backlog-25 | conversion is week-aware against active leaves | week-aware against **Weekly goals** (R-backlog-26) |
| R-task-15 (via R-backlog-29) | move-to-backlog creates an item on **the owning goal** | the owning goal is now a Weekly goal, which may hold no backlog — the item lands on its **nearest non-Weekly ancestor** (R-backlog-29). *This was a direct contradiction between R-task-15 and R-backlog-2 introduced by the redesign.* |
| R-idea-1 … R-idea-8 | the parking lot, its tag, its three actions, its grouping and empty states | **retired, no replacement** — the entity is deleted (R-rm-1) |
| R-nav-1 | five tabs `Tasks · Goals · + · Ideas · Learnings` | **three**: `Goals · + · Learnings` (R-nav-23) |
| R-nav-2 | screen and overlay are React state, URL synced one way | a **router**; lens, goal, task, backlog and learnings are routes (R-nav-24) |
| R-nav-5/17 | `Past week — still editable` / `Future week — planning ahead` | **the same shape, generalised**: `Past <horizon> — still editable` / `Future <horizon> — planning ahead`, at every horizon (R-lens-11) ⚠ *this row read `Past — still editable` / `Planning ahead` — the horizon-less copy the reconciliation pass replaced (C-5). The week case is unchanged from R-nav-5; it is the other four horizons that are new.* |
| R-nav-6 | changing the week resets the goal filter | **retired** — there is no filter (R-rm-4) |
| R-nav-7 | goal filter pills with open-task counts | **the counts survive on the Life-goal group headers**; the pills do not (R-lens-4, R-lens-15) |
| R-nav-8/21/22 | Tasks-screen sections, focus sentences per viewed week, `+ Task` gating | the Weekly lens's two bands and its `+ Task` gating (R-lens-12) |
| R-nav-9/20 | three week empty states; `Edit plan` at any plannable week | two lens empty states, past periods CTA-less; **no `Edit plan`** (R-lens-6, R-rm-3) |
| R-nav-11 | one primary action per page | unchanged; the screen→action mapping changes (R-nav-25) |
| R-nav-16 | both controls span `−7 … +4` | both controls span **everything**; the picker is a re-centring window (R-lens-7) |
| R-nav-18 | the picker marks a future week holding work | generalised: any period holding work is marked, at five horizons (R-lens-7) |
| R-nav-19 | creating into a future week moves the Tasks screen there | unchanged, restated for the Weekly lens (R-task-41) |
| R-task-15 | move-to-backlog creates an item on **the owning goal** | the owning goal is a Weekly goal, which may hold no backlog — the item lands on its **nearest non-Weekly ancestor** (R-backlog-29) |
| R-backlog-10 | move target = any non-Life goal | any non-Life, **non-Weekly** goal |
| R-backlog-11 | every non-Life goal's detail shows `Backlog (N)` with `+ Add` | Yearly/Quarterly/Monthly only; a **Weekly** goal shows its tasks and the pull list instead (R-backlog-28) |
| R-backlog-14 | `+` drawer chips list non-Life goals | non-Life **and non-Weekly** (R-backlog-27) |
| R-learning-2 | "the same chip row as ideas" | the phrase names no surviving surface; the rule is otherwise unchanged |
| R-auth-2 | ownership covers Goal, WeeklyFocus, Task, TaskEvent, BacklogItem, Idea, Learning | the two deleted entities leave the list; the scoping rule is unchanged |

#### Retired scenarios

| Scenario | Disposition |
|---|---|
| `### Plan` and `#### Plan — Amendment 1` (all `S-plan-*`) | **Retired in full.** Two survive re-pointed: S-plan-9-1/9-2 → R-backlog-28; S-plan-15-3 → restated as **S-lens-10-1**. |
| `### Idea` (all `S-idea-*`) | **Retired in full** with the entity. |
| S-goal-6-1 | **Superseded by S-goal-31-1/31-2.** Its subject inverted: the request it required to be refused (a sub-goal under a Monthly goal) must now **succeed**, which is why S-goal-31-2 exists. |
| S-goal-9-1, S-goal-10-1, S-goal-11-2 | **Retired** — they assert focus rows and muted rendering. |
| S-goal-11-1 | **Superseded by S-goal-38-1** — dormancy read off `periodKey`, with no styling to assert. |
| S-goal-13-1, S-goal-23-1 | **Superseded by S-goal-33-1 / S-goal-40-1** — the field is `periodKey`. |
| S-goal-28-1 | **Retired** — the transition is unreachable (R-goal-42). |
| S-task-4-1 | **Superseded by S-task-48-1** — the dead end becomes an inline create. |
| S-task-5-1, S-task-34-2, S-task-34-3, S-task-34-5 | **Retired** — no target-week parameter, no forward cap, no `BRANCH_NOT_ACTIVE`, no Idea source. |
| S-task-34-4 | **Kept verbatim, re-pointed** to R-task-41; the code becomes `PERIOD_IN_PAST` and the guard is the Weekly parent. |
| S-task-9-1 | **Superseded by S-lens-12-2** — the dormant-leaf section becomes the carried band. |
| S-task-33-1, S-task-33-2 | **Retired**; S-task-40-3 pins the surviving ruling in the new shape. |
| S-task-37-1 | **Superseded by S-task-43-1** — the age is −1, not clamped to 0. |
| S-task-11-2 | **Unchanged and still load-bearing** — it is the proof that the signed age is inert for past and current views (S-task-43-3 restates it). |
| S-task-14-2 | **Unchanged** — the future-week completion guard, now reachable at any distance. |
| S-backlog-7-1/7-2, 8-3, 15-1/15-2, 25-1/25-3 | **Re-pointed** to R-backlog-26/27 with "active leaf" reading "Weekly goal for the target week". |
| S-backlog-8-1/8-2, 25-2 | **Superseded by S-backlog-26-2** — new code, new copy, new action. |
| S-backlog-5-1, S-backlog-17-1 … S-backlog-23-1 | **Unchanged.** Manual backlog ordering is untouched by this redesign. |
| S-nav-4-1, S-nav-16-2, S-nav-20-1, S-nav-21-1 | **Retired** — both week bounds, `Edit plan` and focus sentences are gone. |
| S-nav-6-1 | **Retired** — there is no filter to reset. |
| S-nav-7-1, S-nav-8-1, S-nav-9-1, S-nav-16-1, S-nav-17-1, S-nav-18-1, S-nav-22-1 | **Superseded** by the corresponding `S-lens-*` scenario. |
| S-nav-19-1 | **Kept verbatim, re-pointed** to R-task-41. |
| S-nav-3-1 | Already retired by A1; it stays retired for a different reason — future weeks are now ordinary. |

#### Consequences checked, and what they cost

- **R-task-7/8 (visibility)** — unchanged, and now doing more work than ever: it is what makes the carried band possible (R-lens-12) and what keeps carrying free of writes and jobs.
- **R-task-13 (exactly three exits)** — unchanged. A carried Weekly goal introduces no fourth exit; its work is completed, moved to backlog or cancelled where it stands.
- **R-task-19 (uncheck)** — unchanged, and R-lens-12 is what makes it coherent: an unchecked task's goal reappears in the current week's carried band rather than the task floating without one.
- **R-goal-24 (life-goal carry signal)** — unchanged; it counts open tasks originating before the current week, which a future origin can never satisfy.
- **R-goal-16/17/18/19/20 (Move)** — unchanged, and now applicable to Weekly goals (see Q-24).
- **R-backlog-6/9 (conversion is atomic and once-only)** — unchanged; only the target resolution moves.
- **R-backlog-12 (Life-goal read-only aggregate)** — unchanged; a Life goal still holds no backlog of its own.
- **R-backlog-17 … R-backlog-24 (manual ordering)** — unchanged and carried forward from the halted work; nothing in A2 touches `backlog_items`.
- **R-learning-* (Learnings)** — entirely unchanged. It is the one capture surface that survives, and the one tab that does not move.
- **R-auth-5 / Q-9 (weeks from the owner's timezone)** — unchanged and **four times more load-bearing**: every horizon now has a "current period" derived from the same account timezone (R-goal-34).
- **R-nav-12/13/15 (theme, toasts, overlay dismissal)** — unchanged.
- **Q-5 (deletion cascade)** — unchanged in mechanism and much larger in scope; see §4.
- **Q-12 (collection sizes)** — **broken in three places and rewritten.** This is the cost the redesign does not pay for itself: a weekly intent is now a row in `goals`, and `domain/goal-tree.ts`'s whole-list design is premised on 500. R-lens-16 is the rule that follows; the query work is the build's. ⚠ **Rewritten again by the reconciliation pass** against measured numbers: the cost is Θ(n²·d) rather than Θ(n²), the growth estimate was ~2.5–6× high, the "caps" it proposed to raise are enforced nowhere, and the replacement caps bound the *interior* tree and the *per-week* fan-out rather than a lifetime total. R-lens-27 is the rule that follows.

---

#### Reconciliation pass — `UX-PLAN.md` against these rules

`docs/work/14-redesign/UX-PLAN.md` was written in parallel with this amendment and neither document saw
the other. `docs/work/14-redesign/RECONCILIATION.md` is the pass that closed the gap: 26 conflicts, ten
of which needed a real decision, plus the scale measurements above.

**Added (16):** `R-goal-47` (the planned-ness line, dormancy's successor); `R-lens-17` (the title is the
lens control), `R-lens-18` (the zoom anchor), `R-lens-19` (group rendering and collapse), `R-lens-20`
(`UNSORTED`), `R-lens-21` (the off-now row), `R-lens-22` (the Zoom sheet's counts), `R-lens-23` (the
parent line), `R-lens-24` (the third empty state), `R-lens-25` (the swipe and its keyboard equal),
`R-lens-26` (the forward-content marker), `R-lens-27` (no read loads the whole goal list); `R-task-49`
(`+ Task` from a Monthly goal), `R-task-50` (the task page's checkbox); `R-nav-27` (two rows of chrome),
`R-nav-28` (where the app opens). **Total rules 211 → 227.**

**Superseded (1):** `R-lens-13` (the five-way switcher) → `R-lens-17`.

**Modified (19):** `R-goal-38`, `R-goal-43`, `R-goal-46`; `R-lens-1`, `R-lens-3`, `R-lens-4`, `R-lens-6`,
`R-lens-7`, `R-lens-8`, `R-lens-9`, `R-lens-11`, `R-lens-14`, `R-lens-16`; `R-nav-24`, `R-nav-25`,
`R-nav-26`; `R-task-41`, `R-task-45`, `R-task-48`.

**Open questions amended (4):** `Q-12`, `Q-20`, `Q-21`, `Q-22`.

**The ten decisions, in one line each:**

| Decision | Ruling | Rule |
|---|---|---|
| The lens control | The title button + a Zoom sheet, not a persistent five-way strip. The complaint was clutter, and the strip is a permanent row | R-lens-17 supersedes R-lens-13 |
| The period picker | Deleted. One control per dimension, so D-24 is unrepresentable rather than guarded against | R-lens-7, R-lens-26 |
| Empty groups | Not rendered. A lens is not a roster | R-lens-19 retires R-lens-6's clause |
| Dormancy's surface | Follows the empty-group line out and lands on the Monthly card | R-goal-38, R-goal-47 |
| The group count's scope | **The spec's, not the UX plan's** — one anchoring week. The period-spanning version is untruthful in both directions and R-lens-11 forbids the forward half | R-lens-4 |
| Monthly → Weekly zoom | The first week whose **Monday** falls in the month. The spec's "week containing the 1st" contradicted its own Monday model | R-lens-9 |
| The carried band | **The spec's, unchanged** — the UX plan renders none, and its own mockup draws a carried task somewhere R-task-40 makes impossible | R-lens-12, R-task-40 |
| `Repeat last week` | Moves to the group foot; Q-22's header placement is impossible under R-lens-19 | R-goal-46, Q-22 |
| `+ Weekly goal` on a Monthly card | Removed from the lens, kept on the detail page; `+ Task` infers the weekly goal instead | Q-20, R-task-49 |
| Inferring the weekly goal | The UX plan's flow on the spec's wire: `newWeeklyGoal` pre-filled and stated, never an empty field | R-task-48, R-task-49 |

**What `UX-PLAN.md` must change** — it is not edited by this pass; the list is
`RECONCILIATION.md` §1.4. The load-bearing item is §6.5: the Weekly lens must render R-lens-12's
carried band, or an open task whose goal's week has passed renders nowhere at all.

---

### Amendment 3 — sub-goals from the goal page

The owner hit this in use, standing on a Yearly goal: *"look if im in a goal page. i would also want to
add sub goals in the same page."* Two rules combined to make it impossible. R-nav-25 gave a goal page one
primary action mapped by horizon — `+ Weekly goal` on Monthly, `+ Task` on Weekly, **nothing on Life,
Yearly or Quarterly** — so the three horizons whose entire purpose is to hold sub-goals were the three
that could not create one; and the `Sub-goals` section rendered only when the goal already had children,
so a goal with none showed no section to add the first one to.

**Added:** 2 rules — `R-goal-48` (the section and its inline capture), `R-nav-29` (a goal page's one
primary action). **Total rules 227 → 229.**
**Scenarios added:** 8 — `S-goal-48-1 … S-goal-48-7`, `S-nav-29-1` (256 → **264**).
**Existing rules superseded or modified:** 3, each marked `⚠` in §2 — `R-nav-25` (its goal-detail
mapping only; its form is unchanged), `R-goal-41` (the child list gains an empty state and a create),
`R-goal-38` (its Monthly-page clause, which named the dropped primary action).
Running totals across all three amendments: **86 rules superseded, retired or modified** (84 by A2, 3 by
A3, of which `R-nav-25` was already counted by the reconciliation pass), **32 retired outright**
(unchanged — A3 retires none).
**Scenarios modified:** 1 — `S-goal-5-1`, whose legal-horizon set A2 had silently widened and nobody had
re-pointed.
**No new endpoint, schema, field, error code, constant or MCP tool.** This amendment is the client only:
the write is `POST /goals` with a `parentId`, and `create_goal` already exposes it to agents.

#### The three questions this amendment had to settle

| Question | Ruling | Rule |
|---|---|---|
| A new primary action, or an inline capture? | **Inline**, in the `Sub-goals` section. R-nav-25 allows one primary action per page and the goal page's is the horizon's; a create that belongs to a section belongs *in* it, next to where the result appears. It also sidesteps the one-action rule rather than fighting it. | R-goal-48 |
| What happens to `+ Weekly goal` on a Monthly page? | **Dropped.** Keeping it would leave one horizon of four with two routes to the same create, a screen-inch apart — the clutter R-nav-27 refuses. `More…` in the capture opens the identical sheet, pre-filled the same way, so nothing is lost. | R-nav-29 |
| Quick capture, or the full form? | **Quick capture, title only, with `More…` out to the full form carrying the typed title.** Title is a goal's one required field; horizon, period and parent are all inferable from the page, and asking again is the friction the owner is complaining about. | R-goal-48 |

#### Consequences checked and found to hold unchanged

- **R-goal-5 / R-goal-31 / R-goal-32 (the horizon rules)** — untouched, and still the server's alone. The
  picker is *shaped* by the shared `HORIZONS` order and never restates the comparison; a Weekly parent is
  refused by `GoalTreeGuard` exactly as before, whatever a client sends (D-5).
- **R-goal-36 (`PERIOD_IN_PAST`)** — untouched. The defaulted period is the current one, or the parent's
  first enclosed period when that is later, so the affordance cannot reach a past period — but the guard
  is still what enforces it.
- **R-nav-25's form, R-nav-27 (the chrome budget)** — both improve: a goal page now carries **fewer**
  unconditional controls, not more, and the new one is inside a section that already existed.
- **R-nav-26 (no new numbers)** — honoured. The `Sub-goals` section gains an empty-state line and a
  control, and no count.
- **R-backlog-11 (`+ Add`)** — unchanged and now has a sibling. The two are deliberately named
  differently: two controls on one page with one accessible name is a control you cannot ask for (D-20).

### Amendment 4 — period ranges, and the week that is somewhere else

The owner opened the Monthly lens on Tue 1 Sep 2026 and could not find the week they were living in:
*"why is Sep 2026 this month? look the last Month week hadn't completed yet? is this right or wrong?
this is confusing, i think for monthly we need to note it as a range."*

**The model is right and does not change.** A week is keyed by its Monday everywhere (R-goal-33), so the
week of Mon 31 Aug is August's and `Sep 2026` is the four weeks beginning 7, 14, 21 and 28 Sep. That was
decided deliberately in RECONCILIATION ★C-19, against an alternative that made one week belong to two
months and put R-lens-9's zoom, R-goal-47's planned-ness scope and R-task-49's target week in
disagreement. **The defect is that the label over-promises**: `Sep 2026` reads as 1–30 September, and the
period is Mon 7 Sep – Sun 4 Oct. This is the broadcast-calendar model, and this amendment adopts the
convention those calendars use — publish the range beside the name, never the name alone.

**Added:** 2 rules — `R-lens-28` (the range label), `R-lens-29` (the flag and its jump).
**Total rules 229 → 231.**
**Scenarios added:** 14 — `S-lens-28-1 … S-lens-28-8`, `S-lens-29-1 … S-lens-29-6` (264 → **278**).
**Existing rules superseded or modified:** 3, each marked `⚠` in §2 — `R-lens-17` (its title gains a
second line and its accessible name gains the span), `R-lens-21` (its conditional row gains a second,
mutually exclusive occupant), `R-lens-22` (each Zoom row gains its period's span).
Running totals across all four amendments: **89 rules superseded, retired or modified** (84 by A2, 3 by
A3, 3 by A4, of which `R-nav-25` was already counted by the reconciliation pass), **32 retired outright**
(unchanged — A4 retires none).
**New wire fields:** `PeriodView.weekRange`, `PeriodView.currentWeekPeriod`, `ZoomRowView.weekRange` —
and the MCP projections `week_range` / `current_week_period` on `list_lens` and `get_period`.
**No new endpoint, error code, constant, MCP tool or dependency**, and no schema migration: every field
is derived from a `periodKey` that is already stored.

#### The four questions this amendment had to settle

| Question | Ruling | Rule |
|---|---|---|
| Which period should the Monthly lens default to? | **Unchanged — the calendar period containing today.** Defaulting to the period holding the current *week* would open the lens, on 1 Sep 2026, on `Aug 2026`: a period the same payload calls `isPast`, which strips every create affordance (R-goal-36, R-nav-25) and badges it `Past month — still editable`. Landing somewhere you cannot plan is worse than landing somewhere honestly labelled. The label and the flag carry the weight instead. | R-lens-29 |
| Where does the range go, inside a two-row budget? | **A second LINE inside the existing title button, never a second row.** R-nav-27 budgets *rows of chrome above the first item*, and a row of chrome is one that carries a control; this carries none — no tap target, no tab stop, no focus order change. It could not go on the first line: at 21px `Sep 2026 · Mon 7 Sep – Sun 4 Oct` is 32 characters and ellipsises the range away at 360px, and a half-shown range is a wrong one. | R-lens-28 |
| Where does the flag go? | **In R-lens-21's row, which it can never share.** The off-now row renders only when the period is *not* current; the flag only when it *is*. The conditions are complements, so the conditional row gains an occupant and the shell gains no row. | R-lens-29 |
| Server-side or client-side? | **Server-side, beside the period helpers.** The range needs the Monday rule, and the client deliberately holds none (D-1) — `utils/periodKeys.ts` says outright that there is no `weekStartOfDate` in it and there must not be. It is also needed by the MCP surface, so computing it once in `domain/periods.ts` leaves one implementation for three consumers instead of three. | R-lens-28 |

#### Consequences checked and found to hold unchanged

- **R-goal-33 / RECONCILIATION ★C-19 (a week belongs to its Monday's period)** — untouched, and now
  *stated* rather than merely implied. `firstMondayIn` / `lastMondayIn` become the Monthly case of the
  general `firstWeekOf` / `lastWeekOf` and delegate to them, so the range the header prints and the scope
  R-goal-47 counts over are the same two Mondays by construction.
- **R-lens-8 (where a lens opens)** — deliberately unchanged; see the first question above. A period is
  still current iff it contains today (R-goal-34), and every past/future judgement still turns on that.
- **R-goal-34 / R-goal-36 (`isCurrent`, `isPast`, `PERIOD_IN_PAST`)** — untouched. `currentWeekPeriod` is
  a **statement of fact and never a permission**: nothing about write-eligibility reads it.
- **R-lens-11 (nothing is styled as late before it is due)** — honoured. The flag is the same muted pill
  in the same register as the badge it replaces; a period that begins next week is a fact about the
  calendar, not a problem with the plan, and the red carry chip is still the only escalation.
- **R-nav-26 (no new numbers)** — honoured. A range is two dates, not a count, and no lens gained one.
- **R-lens-27 (no read loads the whole goal list)** — untouched. Both fields are pure arithmetic over a
  key the read already holds; neither costs a row.


### Amendment 5 — the calendar is shared vocabulary, and the lens header never waits

The owner: *"changing the horizon or the period shouldn't take time as it doesnt need backend, its the
calander that can be computed in ui… also the down arrow is missaligned for changing the lense"* — and,
separately, *"why is the ui goal navigation shows ... in lense loading"*.

They are right, and the code said so plainly. `LensRow` read `period?.label ?? '…'`, so until `GET /goals`
landed the header of the entire screen was a literal ellipsis; `lens/copy.ts` recorded why —
*"Both halves are the SERVER's strings … the client formats no date here, because it holds no Monday rule
to format one with (D-1)."* Every field on that header is calendar arithmetic over
`(horizon, periodKey, today)`. Not one of them needs the database.

**The prohibition was half true, and half true is worse than false.** D-1's rule is that two
implementations of a date rule drift on the first boundary. The conclusion drawn from it — *the client may
not hold a Monday rule* — was enforced by a doc block and not by anything else, and
`apps/web/src/utils/periodKeys.ts` had meanwhile grown line-for-line copies of `stepPeriod`, `firstDayOf`
and `periodKeyOf` under a header arguing at length that it was not a second implementation. **The drift
this design guarded against already existed.** So the rule is restated as what it was reaching for: *the
client may not hold a **second** implementation of a date rule; it may import the **only** one* — and the
module moved to `packages/shared/src/calendar/`, where both sides import it.

**Added:** 1 rule — `R-lens-30`. **Total rules 231 → 232.**
**Scenarios added:** 14 — `S-lens-30-1 … S-lens-30-14` (278 → **292**).
**Existing rules superseded or modified:** 2, each marked `⚠` in §2 — `R-goal-34` (the calendar half of
"the client never re-derives one" is now one shared implementation both sides call, with the wire value
kept and checked against the client's; the data half is untouched), `R-lens-28` (the client formats both
halves; the wire fields stay as the reference the client's formatter is tested against).
Running totals across all five amendments: **91 rules superseded, retired or modified**, **32 retired
outright** (unchanged — A5 retires none).
**No new wire field, endpoint, error code, MCP tool, constant, dependency or migration.** `PeriodView` is
unchanged on the wire; what changed is that the client can now compute all of it but `hasWork`.

#### The four questions this amendment had to settle

| Question | Ruling | Rule |
|---|---|---|
| Does moving the calendar client-side reopen D-1? | **No — it closes it.** D-1 forbids a *second* implementation. One module in `packages/shared`, imported by the Worker and the browser bundle, is *fewer* implementations than before, not more: three copies of the key predicate became one, and six duplicated functions in `utils/periodKeys.ts` and `utils/dates.ts` became zero. What R-auth-5 forbids is deriving a day from the **device clock**, and `today` is the stored account timezone applied to the **server's** clock — the same two inputs the server itself uses. | R-lens-30 |
| Is one shared module enough to prevent drift? | **No, and that is why there are three layers.** A shared module cannot drift — but a shared module plus an installed PWA holding a client bundle a week older than the Worker can, and nothing in a monorepo notices. So: (1) one module, which *prevents*; (2) a hand-written boundary fixture table checked independently by an api test and a web test that do not import each other, which *detects in CI*; (3) a **runtime echo assertion** on every read, which *detects in the field*. Layer 3 is the only one that survives a stale service worker, and it throws in dev rather than warning because the failure it catches is silent. | R-lens-30 |
| Which day does the echo assertion compare on? | **The day the SERVER computed the payload for**, from that response's own `serverNow` — not the client's current `today`. This is what separates **version skew** (a payload that was wrong when it was made) from **staleness** (one that was right when it was made and has been overtaken by midnight). Comparing against the client's now would fire on every rollover, which is an ordinary race the invalidation repairs, and an assertion that cries wolf is an assertion someone deletes. | R-lens-30 |
| What is the client's fallback timezone before preferences load? | **`'UTC'`, matching `isValidTimezone` and the server middleware — never the device zone.** The device fallback is precisely the traveller disagreement R-auth-5 forbids: an owner whose account is `Europe/Berlin`, in Tokyo, would have got Tokyo's date while the server computed Berlin's. It is a behaviour change, and it governs nothing the owner sees, because `label` and `weekRange` need no clock at all and the three fields that do are suppressed until the zone is known. | R-lens-30 |

#### Consequences checked and found to hold unchanged

- **R-lens-7 / R-goal-36 / R-rm-3 (no bound in either direction)** — untouched. Neither chevron is ever
  disabled. `stepPeriod`'s new clamp is the **format's** edge (1000-01-01 … 9999-12-31, from
  `PeriodKey`'s own `max(10)` and `\d{4}`), not a product bound: it turns a key the server would answer
  `422` into a silent no-op at a place no owner will reach and a fling might.
- **R-lens-8 (where a lens opens)** — unchanged. A lens still opens on the calendar period containing
  today; what changed is only *who computes which period that is*, and both sides now compute it the same
  way because it is the same function.
- **R-lens-14 (a period the URL does not name)** — honoured, and now answered without a round trip. A URL
  segment is still attacker-supplied and a non-canonical key is still dropped rather than trusted.
- **R-nav-24 (the URL carries the key, the screen shows the label)** — honoured, and better than before:
  one empty-state sentence had been rendering the raw key `2026-Q1` because the wire label happened to be
  absent, and it now reads `Q1 2026`.
- **R-nav-27 (two rows of chrome)** — untouched. No row is added or removed; the conditional row simply
  settles at the same moment as the title instead of 300 ms later.
- **R-lens-27 (no read loads the whole goal list)** — honoured. The neighbour prefetch is **depth 1**,
  idle-scheduled, save-data-aware and skipped on the Life lens; it issues scoped lens reads, which
  R-lens-27 permits, and the *total* number of requests for a session that opens one lens went **down**,
  because opening a lens used to cost two.
- **R-task-43 / R-task-7/8/32 (carry age, week visibility)** — deliberately **not** moved. They are
  read-model policy about *work*, not arithmetic about *dates*, and only one side may have an opinion
  about them; they stay in `apps/api/src/domain/weeks.ts`, which is now that file's whole content.
- **Q-15 (online-only with a read cache)** — unchanged. Nothing here is offline-first; a longer `gcTime`
  and a depth-1 prefetch are cache tuning, and every write still goes to the server.

### Amendment 6 — the breadcrumb that never wraps, and the skeleton that never flashes

The owner, on two of the seven problems in `docs/work/22-ux-fixes/UX-PLAN.md`:

> *"for the contents inside i would want skeleton loader"* … *"there is problem with breadcrumbs if the
> title of the goal is large the is looks messed up. probably add elipsis in middle or pick best practices"*

**Added:** 1 rule — `R-nav-30`. **Total rules 232 → 233.**
**Scenarios added:** 10 — `S-goal-41-1 … S-goal-41-4` and `S-nav-30-1 … S-nav-30-6` (292 → **302**).
**Existing rules superseded or modified:** 1, marked `⚠` in §2 — `R-goal-41` (the breadcrumb clause, in
three parts: one non-wrapping line of at most three segments, the Life root onto an eyebrow, and the
per-ancestor period labels into a `Where this sits` sheet). Running totals across all six amendments:
**92 rules superseded, retired or modified**, **32 retired outright** (unchanged — A6 retires none).
**No new wire field, endpoint, error code, MCP tool, colour token, type size, constant, dependency or
migration.** `GoalDetailResponse.ancestors` is unchanged; what changed is how much of it fits on a line.

### Amendment 7 — one goal picker

The owner: *"i need a better way select goal example when i add a backlog in goal everything is listed.
lets say if i have many the ui is messed up. i have seen similar practices in other pages too."*

He is right about both halves. `GoalModals.tsx` rendered every legal parent into a `maxHeight: 200`
scroller with no search, no grouping and no ancestry; the `+` drawer rendered a wrapping wall of pills
carrying titles and nothing else; and the pattern recurred at **seven** sites, no two alike — one of
which conveyed its selection with a background colour and one of which had no selected state at all.
Six properties were missing from every one of them: no search anywhere in the app, no ancestry (so **two
goals with the same title in different Life lines were indistinguishable in every picker**), no grouping
though `LensResponse.groups` was already on the wire, no shared recency, no keyboard model, and a
**silent** truncation at `MAX_PAGE = 200`.

**The fix is one component and a mode.** A surface says which rule applies — `parent`, `backlogHost`,
`weeklyTarget`, `lifeLine` — and supplies nothing else. Each mode is a rule the server already enforces,
used to shape the offer rather than to re-decide it; where the two could ever disagree the server wins
and its refusal renders, exactly as before.

**Added:** 1 rule — `R-nav-31`. **Total rules 232 → 233.**
**Scenarios added:** 13 — `S-nav-31-1 … S-nav-31-13` (292 → **305**).
**Existing rules modified or generalised:** 5, each marked `⚠` in §2 — `R-lens-13` (its surviving
accessibility clause now binds every picker, not only the Zoom sheet), `R-lens-15` (clarified: a modal's
transient search is not a lens filter), `R-lens-19` (the one-group header suppression is the picker's
too), `R-backlog-10` (the move list is `backlogHost` mode), `R-backlog-14` (the drawer's private
last-used-goal memory becomes the picker's shared `RECENT`).
Running totals across all six amendments: **96 rules superseded, retired or modified**, **32 retired
outright** (unchanged — A6 retires none).
**No new wire field, endpoint, error code, MCP tool, dependency or migration.** One module moved:
`rankGoals` / `isAmbiguous` / the diacritic fold, out of `apps/api/src/api/mcp/shapes.ts` and into
`packages/shared/src/search/rank-goals.ts`, with one rung added (`line`, `0.5`) that is **invisible to
every caller that does not ask for it** — the MCP surface passes no `lineTitleOf`, so `find_goal` ranks
exactly as it did.

#### The four questions this amendment had to settle

| Question | Ruling | Rule |
|---|---|---|
| Middle-ellipsis, which the owner asked for? | **No — tail, for the titles; middle, for the trail.** Middle-ellipsis is right for **paths and filenames**, where head and tail are both identifying (`/Users/…/report.pdf`). It is wrong for **sentences**, where the head carries the meaning and the tail is a modifier: `Set up my AI c…paying client` is less legible than `Set up my AI consultancy and land a…`, which is a readable clause. The owner's instinct — collapse the middle — is right at the granularity of the *trail*, which is a path, and wrong at the granularity of a *title*, which is a sentence. Both halves of that are implemented. | R-goal-41 |
| Measure the line in JavaScript and collapse to fit? | **No.** A self-measuring trail is correct and needs a `ResizeObserver`, a measurement pass and a re-layout on every font load — for a product with one 640 px centred column, no breakpoint and no desktop layout. The depth rule plus flexbox produces the same answer at every width this app actually renders at. The segment *count* deliberately does not change with width either: a trail that grows a segment at 1024 px is a second layout to design, test and keep true. | R-goal-41 |
| Where do the ancestors' period labels go, given the rule has always required them and the screen has never rendered one? | **Into `Where this sits`.** The honest reason they went unbuilt is that there has never been room for four periods on one line, and there still is not. In a sheet there is no width pressure at all, so that is where the untruncated titles, the periods and the current-goal marker live — reached by a real button with a real accessible name, a keyboard route and R-nav-15's whole dismissal contract, inherited from `Sheet` rather than reinvented. | R-goal-41 |
| Does a skeleton reintroduce the flashing the owner complained about? | **Only if it has no windows, which is why it has two.** A skeleton with no grace window flashes for 40 ms on a fast read — the same defect one layer down — and one with no minimum flickers out the instant it is fixated. So: 150 ms before it may mount, 400 ms once it has, worst case 550. The minimum is armed by the **mount** and never by the request, which is what keeps it from ever delaying content that was already cached; and the cold flag is React Query's `isPending`, never `isFetching`, which is what keeps a revalidation from putting grey over a list that is on screen. | R-nav-30 |

#### Consequences checked and found to hold unchanged

- **R-nav-27 (two rows of chrome)** — untouched, and improved on the goal page. A skeleton occupies the
  space its content will occupy and adds no row; the goal page gains an eyebrow at depth ≥ 3 and loses the
  two-to-four wrapped trail lines that eyebrow replaces, which is a net reduction.
- **R-lens-30 (the lens header never waits)** — the reason the lens skeleton is a **body** skeleton. The
  period's name, its span and both notices are calendar facts and are already on screen above the grey; the
  list is the only thing left that can be unknown.
- **R-goal-35 / R-goal-34's containment note** — honoured for the first time. The note says *"a goal's
  ancestry with each ancestor's period is shown on its detail page (R-goal-41), which is where a mismatch
  is visible"*; until now no period was rendered there at all, so the mismatch was visible nowhere. It is
  visible in `Where this sits`.
- **R-task-45 (the task page's context line)** — both segments are still tappable and both accessible names
  are still the full titles. Only the wrapping changed.
- **R-lens-23 (the parent line)** — unchanged in substance; it clamps to one line, and its `aria-label`
  already carried the full name *and* the period, so nothing is lost to a screen reader.
- **R-lens-13's surviving clause (a selection is announced, never merely coloured)** — honoured by the
  sheet's current row, which is `aria-current="true"` and not only tinted.
- **R-nav-15 (tap outside dismisses without acting)** — inherited whole. `Where this sits` is the existing
  `Sheet`; no second modal pattern was invented for it.
- **Contrast (`tests/screens/contrast.test.ts`)** — cannot be threatened by this amendment, which adds no
  colour. Skeleton bars are `T.line`, carry no text and are `aria-hidden`, so the 4.5:1 rule — which is
  about the legibility of type — is not engaged; the eyebrow, the crumbs and the sheet's second line are all
  `T.mut`, already measured at 4.61:1 on `paper` and 4.99:1 on `card`.
- **`prefers-reduced-motion`** — still has nothing to honour anywhere in this product, which is a stated
  design outcome rather than an omission. If any skeleton ever animates, that reversal owns a
  `prefers-reduced-motion` branch and a second design, and this is the paragraph that records it did not.

| Does a search field in a picker reopen R-lens-15 / R-rm-4? | **No.** R-lens-15's every clause is about **a lens** — a screen — and about **persistent filter state a user has to remember they set**. This search lives inside a modal, resets to empty on every open, cannot outlive the choice it was typed for, and adds no parameter to any lens read. What R-rm-4 deleted was a row of pills that changed what a *screen* showed until you changed it back; this changes what a *list you are standing in* offers, for two seconds. | R-nav-31, R-lens-15 |
| How does the full picker open without stacking sheets? | **It takes over the sheet it was opened from.** Two of the sites already render their picker inside a sheet, so a picker that were always a sheet would need a sheet stack — two `aria-modal` dialogs and two focus traps, which is the bug `docs/work/09-e2e-browser` finding A already fixed once. The sheet swaps its body, its heading becomes `Choose a goal`, a back control names where you came from, and **the sheet never unmounts**, so typed work is preserved by construction — no draft to hoist, no z-index stack, and no change to `Sheet` at all. | R-nav-31 |
| Should the ranking be promoted to `packages/shared`, and should an HTTP goal search ship with it? | **Promote the ranking; defer the endpoint.** MCP's `find_goal` already ranks exactly this question, and two implementations of "does this phrase mean that goal" would disagree on the first near-miss — the drift A5 moved the calendar to end. The **endpoint** is a different matter: no mode of this picker reaches 200 without a data pathology, so an endpoint would be built for a case that has not occurred, which R-nav-26 exists to refuse. What the picker owes the owner meanwhile is not reach but **honesty**: when a read came back capped, it says so. | R-nav-31 |
| Where does the threshold sit, and does it govern one thing or three? | **Eight, and one thing.** Above eight the search field appears, `RECENT` becomes worth rendering, and the inline list becomes a field — three consequences of one number, roughly a phone screenful of two-line rows inside a sheet. One number to remember, one number to retune. ⚠ **Answered again by A9, and the third consequence is withdrawn**: the inline-list-becomes-a-field half was the wrong half, because the question it answers is *how much room does the rest of this surface need*, and a count cannot see the rest of the surface. A picker in a form sheet is a row at every count; a picker that is the whole surface is a list at every count; eight still governs the search field, and `RECENT` with it. | R-nav-31 |

#### Consequences checked and found to hold unchanged

- **D-5 (a disabled button is a hint, not an invariant)** — honoured, and more visibly than before. The
  picker's modes narrow the *offer*; every refusal path still exists and still renders from the server's
  code. `WOULD_CREATE_CYCLE`, `HORIZON_CONFLICT`, `NOT_A_LIFE_GOAL`, `LIFE_GOAL_NO_BACKLOG`,
  `NOT_A_WEEKLY_GOAL` and `AMBIGUOUS_CONVERSION_TARGET` are unchanged, and the last of them now feeds the
  picker its rows.
- **R-lens-16 / S-lens-16-2 (the client holds no tree)** — honoured. Every mode is built from ordinary
  scoped lens reads the app already makes and React Query already caches; nothing walks an ancestor
  chain, and the one question that needs a subtree — "is this Weekly goal at or under that goal" — is
  still answered only by the server.
- **R-lens-27 (no read loads the whole goal list)** — honoured. No new read shape: `parent` is
  `useParentOptions`' existing four scoped reads, `backlogHost` is the drawer's existing three,
  `weeklyTarget` is one week, `lifeLine` is the Life lens.
- **R-nav-27 (two rows of chrome)** — untouched. Nothing here renders on a lens at all.
- **R-lens-14 (overlays are not routes)** — honoured. The picker is not a route and takes over an
  existing overlay rather than adding one.
- **R-backlog-28 (the pull lists)** — untouched. They pick a backlog **item**, not a goal.
- **Contrast (`tests/screens/contrast.test.ts`)** — no new colour and no new token: rows are
  `S.pickerRow`, headers `S.sectionLabel`, the second line `T.mut`, the search field `S.input`.

### Amendment 8 — tasks at the month, and tasks that carry a number

Two features, specified as one unit because they land on the same row and would otherwise be two
migrations of the same table. The owner, on the first:

> *"instead why dont we allow adding task directly to a month not just week. becuse i might have some
> task thats not high proprity but should be prioratised in this month. so if i add a task this month i
> can either have option to park it inside a week or as an independednt task this month. what this means
> it in my monthly view i can see the tasks that is part of this month. also in my weekly task i can see
> my months task so if i dont do it this week its ok as the deadline is end for the current month"*

And on the second: *"reach 15 leads daily"*, *"close 2 calls weekly"*, *"lose 5 kg this month"*, and an
AMRAP workout whose reps go up and down.

**Added:** 23 rules — `R-task-51 … R-task-59`, `R-lens-31`, `R-lens-32`, `R-backlog-30`, `R-backlog-31`,
`R-measure-1 … R-measure-9` (a new area), `R-rm-6`. **Total rules 233 → 256.**
**Scenarios added:** 49 — `S-task-51-1 … S-task-59-1`, `S-lens-31-1/2`, `S-lens-32-1/2`,
`S-backlog-30-1/2`, `S-backlog-31-1/2`, `S-rm-6-1`, `S-measure-1-1 … S-measure-9-2` (305 → **354**).
**Retired outright:** 1 rule — `R-task-49` (**built, and must be deleted rather than left dormant** —
R-rm-6) — and with it one error code, `NOT_A_WEEKLY_GOAL`.
**Existing rules superseded or modified:** 21, each marked `⚠` in §2 — `R-goal-39` and `R-task-39`
(superseded by R-task-51), `R-task-40` (generalised by R-task-52), `R-task-41` (its fourth source
retired), `R-task-42` (generalised by R-task-53), `R-task-43` (by R-task-54), `R-task-44` (by
R-task-55), `R-task-46` (amended again by R-task-58), `R-task-48` (its premise narrowed to two
callers), `R-goal-47` (a new empty case and a new position), `R-lens-2` (two rows of its table),
`R-lens-12` (a third section), `R-lens-4` (the group header counts week tasks only), `R-goal-42` (its
reason restated, the rule unchanged), `R-goal-41` and
`R-nav-29` (a Monthly goal's page gains a task list and `+ Task`), `R-backlog-3` (unchanged, and now
load-bearing), `R-backlog-26` (a second conversion target), `R-backlog-29` (the walk terminates for a
month task), `R-nav-26` (its list of permitted numbers), `R-nav-31` (`weeklyTarget` loses a caller).
Running totals across all eight amendments: **117 rules superseded, retired or modified**, **33 rules
retired outright**.
**Superseded scenarios:** 2 — `S-goal-37-1` and `S-goal-39-1`, both of which assert that a **Monthly**
goal refuses a task. They are restated one horizon up as `S-task-51-2`; their point — that the
condition is the horizon and never leaf-ness — is unchanged and is the reason they are restated rather
than deleted.
**New questions:** `Q-25 … Q-28`.

**New wire, schema and error surface** — the first amendment since A2 to carry a migration:

- **Renamed** on `tasks`: `origin_week_start` → `origin_period_key`, `done_week_start` →
  `done_period_key`. **Every existing value is a Monday and is unchanged**; only the column name and the
  format's domain widen.
- **Added** to `tasks`: `scope` (`'Monthly' | 'Weekly'`, backfilled `'Weekly'`), and five nullable
  measure columns — `measure_kind`, `measure_start`, `measure_current`, `measure_target`,
  `measure_unit`.
- **Added**: table `task_readings` (`id`, `user_id`, `task_id`, `value`, `at`, `created_at`) with
  `ix_task_readings_task (user_id, task_id, at, id)`.
- **Reindexed**: `ix_tasks_open_week` / `ix_tasks_done_week` become `ix_tasks_open_period` /
  `ix_tasks_done_period`, keyed `(user_id, status, scope, origin_period_key)` and
  `(user_id, status, scope, done_period_key)`. `scope` is what makes them selective, which is the whole
  reason it is stored (R-task-52).
- **Error codes**: `NOT_A_WEEKLY_GOAL` → **`NOT_A_TASK_GOAL`** (409); added
  **`MEASURE_TARGET_EQUALS_START`** (422), **`MEASURE_KIND_MISMATCH`** (422), **`NO_MEASURE`** (409).
- **Commands**: `retarget` (Park / Move to the month), `record_reading`, `delete_reading`,
  `set_measure`, `clear_measure`. `CreateTaskRequest` is unchanged in shape — it still names a goal and
  still accepts no period.
- Full builder's inventory, blast radius and migration order: `docs/work/26-measurables/spec-delta.md`.

#### The seven questions this amendment had to settle

| Question | Ruling | Rule |
|---|---|---|
| What separates a month task from a **backlog item** on the same Monthly goal? | **The period, and nothing else.** The owner's line — *backlog is "maybe, someday"; a month task is "yes, this month"* — is the right thing to say to a person and the wrong thing to build on, because "maybe" and "yes" are feelings and no rule can check one. The enforceable line is that **a backlog item is the only work object in this product with no period key**, and a period key is exactly what makes something appear in a lens. Backlog never appears in a week *because it has no week to appear in*; a month task always does *because its month contains that week*. Everything else — no checkbox, no ageing, manual order — follows. | R-backlog-30 |
| Does binary unify with counter in the **data model**? | **No: binary is `measure = null`, and there are two kinds, not three.** Formally a checkbox is the degenerate counter `0 → 1`, and unifying is still wrong, for four reasons that bind in order: completion is **already** modelled and is not a number (`donePeriodKey`, the uncheck flow, the three exits, R-task-55's bound), so unifying creates a second definition of done; a **gauge with no target has no completion at all**, so completion cannot be a function of the triple for every task; every task in the product would grow a measure it never asked for, on every row and every payload; and the migration would have to invent a reading, with a timestamp, for every task ever completed — manufacturing history, which Q-19 refuses. The UI keeps a checkbox a checkbox because a task with no measure is *literally unchanged*. | R-measure-1 |
| `target == start` — what does progress do? | **It is refused at the edge, and rendered as nothing if it slips through.** Both halves are required. `MEASURE_TARGET_EQUALS_START` (422) on create and edit, because a target equal to start names no movement and "maintain" is out of scope. And where such a row exists anyway — a migration, a hand-edit — **no division is performed**: the progress field is absent from the wire and the UI renders the numbers alone. `NaN`, `Infinity`, `0%` and `100%` are each specifically forbidden as the answer, because this is the one place a divide-by-zero can reach a screen and a wrong number is worse than no number. | R-measure-4 |
| Does a month task ever wear the red chip? | **In the Monthly lens yes, in a week never.** These look contradictory and are one rule: **the age is counted in the task's own scope**. A month has a deadline; a week does not, so a week has no standing to call a month task late — hence no chip, no gray line and no badge anywhere in the month band. Between *months* the same escalation fires at the same thresholds in the right unit (`3 months · since Aug`), and it has to: without it a month task quietly becomes a second backlog within about three months of ordinary use, which is the failure mode the whole line in R-backlog-30 exists to prevent. It is one escalation at two scales, not two escalations. | R-task-54 |
| What does **Park** do to the task's parent and week, and is it a fourth exit? | **It sets `goalId`, `originPeriodKey` and `scope` together, and it is not an exit.** The three move as one — a task's period is always its goal's period *at creation*, and parking is a re-creation of that fact by an explicit write. Nothing else changes: title, condition, description, links, events and **every reading** survive (R-measure-5). It is not a fourth exit because the task is still open, still visible and still yours to finish — an exit takes work *out* of a period, and this moves it between two it was already committed to. It is **reversible** (`Move to the month`) on purpose: a one-way narrowing makes a mis-tap unfixable and pushes people to cancel-and-retype, which loses the readings and the timeline. `originPeriodKey` remains immutable against everything except this one named, logged, confirmed operation — the narrowest possible weakening of R-task-40, whose fear is a period that changes **without a write**. | R-task-56 |
| Should `+ Task` from a Monthly goal keep inferring a weekly goal? | **No — it is deleted, not repaired**, and it turns out to have been carrying a defect the whole time (below). Its entire purpose was to paper over the missing month-level task; with R-task-51 there is no second step to infer, no target week to clamp, no picker, no implicitly created goal, no sentence explaining what is about to happen, and **no forced navigation to another lens**. One tap, one row, on the card you tapped. That is a net *deletion* of a flow, a sheet branch and a navigation — the rare case where a new capability removes more than it adds. | R-task-57, R-rm-6 |
| Do the owner's measurable examples reopen **recurrence**? | **No, and the reason is that a measure is what those examples were actually missing.** R-goal-46 refused recurrence once — no template entity, no series id, no materialisation job, no detached-from-series state, no edit-this-versus-all-future, the interaction every calendar product is most complained about — and **that decision stands**. *"Update any day"* needs no day concept because **a gauge is overwritten whenever you measure it**; *"15 leads daily"* is a **counter you bump**, with `daily` as context in the title and nowhere else in the model. What both examples needed was somewhere for a number to accumulate across time, which is precisely what a measure that follows the task (R-measure-5) provides — and it provides it with one nullable field, against recurrence's five entities. | R-measure-8, R-goal-46 |

#### The defect in R-task-49's target-week clamp — verified, not inferred

R-task-49 and UX-PLAN §6.7.1 both claim *"one rule answers 'which week does this month mean' for zoom,
for this creation and for R-goal-47's scope, so the three can never disagree."* The three do agree with
**each other**. All three disagree with **R-goal-33**, and the retirement should be read with that in
view rather than as a matter of taste.

`weekForMonth` (`packages/shared/src/calendar/periods.ts:315`) is:

```ts
export function weekForMonth(monthKey: string, today: string): string {
  if (periodKeyOf('Monthly', today) === monthKey) return weekStartOfDate(today);
  return firstMondayIn(monthKey);
}
```

Its first branch asks whether the **calendar month** of `today` equals `monthKey` — not whether the
month's *week range* holds today, which is what R-lens-28 and R-goal-33 mean by a month containing
anything. Run against the source (not reasoned from the docs), with today = **Wed 2 Sep 2026**:

```
weekForMonth('2026-09', today='2026-09-02')  =  2026-08-31
periodKeyOf('Monthly', '2026-08-31')         =  2026-08
Mondays belonging to 2026-09                 =  07, 14, 21, 28 Sep
```

So `+ Task` on a **September** Monthly goal on 2 Sep 2026 resolves its target week to **Mon 31 Aug — a
week that belongs to August by the product's own Monday rule.** The web copy is identical
(`apps/web/src/utils/periodKeys.ts:84`, `monthKey === todayMonthKey` where `todayMonthKey =
periodKeyOf('Monthly', today)`, `apps/web/src/lib/weekClock.ts:55`), and its own test asserts the seam
in the other direction — `weekForMonth('2026-09', …) === '2026-09-07'` **only when today is in August**
(`apps/web/tests/utils/periodKeys.test.ts:74`). The failing case is the one nobody wrote: today inside
September's *calendar* month but outside September's *week range*, which is every year, for between one
and six days.

Three consequences, all latent today:

1. A Weekly goal is created for the week of Mon 31 Aug **under a September Monthly goal**, which is
   legal (R-goal-35 — periods do not nest) and is not what anyone asked for.
2. **R-goal-47's planned-ness line does not count it**, because its scope is Mondays falling in the
   viewed month. The September card still reads `Nothing planned yet` immediately after the owner
   planned something from it.
3. The app navigates to the Weekly lens at `2026-08-31`, so a create started in September lands the
   owner in August, one row below R-lens-29's `This week is in Aug 2026` pill — which is the app
   correctly explaining a seam it had just walked into.

**A8 does not fix this clamp; it removes its worst consumer.** `+ Task` from a Monthly goal no longer
calls it (R-rm-6). The two survivors — R-lens-9's Monthly → Weekly zoom and R-goal-47's scope — are
**not** wrong in the same way and must not be "fixed" by reflex: a zoom that lands on the week you are
living in is right even when that week belongs to the previous month (it is *where you are*, and
R-lens-29 already names the discrepancy), and R-goal-47's scope never calls the today branch at all. The
open item is therefore narrower than it looked: **`weekForMonth`'s first branch is a `zoom` rule wearing
a general name**, and it should be renamed to say so rather than generalised. Recorded here, not
actioned, because A8 removes the only caller for which it was wrong.

⚠ **ACTIONED BY A9, ahead of A8 and for a different reason: the defect above is LIVE and the owner lost
work to it, and A8 is a later, larger pass.** A9 does not wait for the caller to be deleted; it gives the
caller a correct rule. `weekForMonth` is split in two — `zoomWeekForMonth` (unchanged body, R-lens-9's
consumer, the recommended rename) and `taskWeekForMonth` (R-task-49's, whose predicate is the month of the
**current week** rather than of `today`, so its answer is inside the month asked for by construction). Both
names join `packages/shared/tests/no-second-calendar.test.ts`'s census, and the web wrapper in
`apps/web/src/utils/periodKeys.ts` — the last of R-lens-30's six duplicated calendar functions, which
survived only because its signature looked like vocabulary — is deleted rather than renamed. When A8
deletes R-task-49's caller it will delete `taskWeekForMonth` with it; until then the rule is right.

#### Consequences checked and found to hold unchanged

- **R-task-13 (exactly three exits)** — unchanged. `retarget` is not an exit (R-task-56), and all three
  exits work on a month task, with Move to Backlog landing on the goal it is already on (R-task-59).
- **R-task-40 (the period is the task's own stored field)** — its four reasons are unchanged and now
  bind at two scopes; carry is still a comparison with **no write, no prompt and no job**, so A8 gives
  the product no cron and none of the ~52-goals-a-year pressure Q-12 measured. A month task is one row.
- **R-goal-45 / R-nav-26 (no completion state, no rate, no report)** — untouched, and the one place
  A8 could have breached them is closed twice: Q-25 keeps targets off goals, and R-measure-8 forbids any
  roll-up of a measure across tasks.
- **R-lens-11 (nothing is styled as late before it is due)** — honoured at both scopes by R-task-54's
  signed age, and honoured a second way in the month band, which renders no age at all.
- **R-lens-27 / R-lens-16 (no read loads the whole goal list)** — untouched. The Monthly lens read gains
  its month tasks by the same shape the Weekly lens already uses for week tasks — one index seek on
  `(user_id, status, scope, origin_period_key)` — and the month band is that same read, keyed by the
  month the viewed week's **Monday** belongs to. No new unbounded read, no join to `goals`.
- **R-nav-27 (two rows of chrome)** — untouched. The month band is a section in the body, not a row of
  chrome; the measure renders inside a task row that already exists.
- **R-goal-36 (nothing is created into or moved into a past period)** — binds unchanged at month scope,
  on create (R-task-57) and on Park (R-task-56). Completion in a past period is still permitted, and
  R-task-55's seam case is the first place that permission is load-bearing rather than theoretical.
- **R-task-47 (a task never outlives its goal)** — unchanged, and the cascade already covers the new
  rows because it is defined over the subtree: deleting a Monthly goal now also takes its **own** tasks,
  their events, links and readings, in the same transaction. The confirmation's counts grow.
- **R-nav-31 (one goal picker)** — `weeklyTarget` survives with two callers instead of three (Park and
  the backlog week path) and needs no change; `S-nav-31-4`'s premise is restated against Park.
- **R-task-48 (`newWeeklyGoal`, one step not two)** — survives for those same two callers. Its stated
  premise — *"creating a task now presupposes a Weekly goal"* — is false from A8 onward and is marked so
  in place, rather than left to read as still true.
- **R-backlog-17 … R-backlog-24 (manual ordering)** — untouched. A month task is not manually ordered
  and gains no `sortKey`; ordering by hand remains a backlog property and is one of the six differences
  R-backlog-30 tabulates.
- **R-auth-2 / R-auth-3 (ownership scoping)** — extended by name: a `Reading` is an owned entity, every
  read is owner-scoped, and a reading id belonging to another owner is refused indistinguishably from a
  missing one.
- **Contrast (`tests/screens/contrast.test.ts`)** — the measure adds no colour that carries meaning
  (R-measure-8): the bar is one neutral fill in both themes at every value, and the numbers are ordinary
  body text beside a title.
- **`prefers-reduced-motion`** — still has nothing to honour. A sparkline is a static path; it does not
  animate, draw in, or transition between values.

### Amendment 9 — a horizon-scoped picker, named task destinations, and the month clamp

Four defects the owner hit in real use, in one pass because three of them meet in the same sheet. This
amendment builds **none** of Amendment 8's body — no month tasks, no measurables, no migration. It fixes
what is live.

**The owner, on the picker:**

> *"instead we put everything under with all the goals from all the lense. we can have another option to
> select which lense to focus on and based on it i get the goals for that lense."*

That is a better answer than the threshold tweak the symptom invited, and it is the one built. The four:

1. **The picker floods a form sheet.** R-nav-31's one threshold governed the search field *and* the shape,
   and the shape half was wrong: a `New Monthly goal` sheet with three legal parents rendered three
   two-line rows inline and pushed `Save goal` below the fold. A count cannot see the rest of the surface.
   **The surface now decides the shape** — a compact row in a form, the inline list where the picker is the
   whole surface — and the list is **scoped by horizon**, which bounds it structurally rather than by a
   number.
2. **The default parent was the wrong one, and was not even a default.** `GoalFormSheet` preselected only
   when *exactly one* parent was legal; with three it selected nothing, and the roving-focus ring sat on
   row 0 — which is a Life goal. The owner reported that `Sep 2026` "preselects" *Be financially
   independent*; it did not, which is worse. It now defaults to the **nearest legal ancestor**.
3. **`+ Task` on a Monthly goal never said where the task went.** The weekly-goal picker rendered only at
   `choices.length > 1`; at exactly one the code path was, in its own comment, *"used silently"*. Three
   tasks went somewhere the owner was never told and could not find. **The destination is named at every
   count.**
4. **The target-week clamp put tasks outside the month on screen.** Verified live, not inferred:
   `weekForMonth('2026-09', '2026-09-02') = '2026-08-31'` and `periodKeyOf('Monthly', '2026-08-31') =
   '2026-08'`. A8 recorded this and deferred it because A8 deletes the caller; A9 does not wait, because
   the defect is live and it is how the three tasks were lost.

**Added:** 0 rules. **Total rules unchanged at 256.**
**Scenarios added:** 8 — `S-nav-31-14 … S-nav-31-17`, `S-goal-5-2`, `S-task-49-1`, `S-task-49-2`,
`S-lens-9-7` (354 → **362**).
**Retired outright:** 0 rules.
**Existing rules modified, each marked `⚠` in §2:** 4 — `R-nav-31` (the threshold governs the search field
alone; the surface governs the shape; horizon scoping and its default; the field's accessible name),
`R-task-49` (its target-week clamp, and the retirement of "used silently"), `R-lens-9` (unchanged in
behaviour, renamed `zoomWeekForMonth`), `R-goal-47` (its claim that one answer serves all three consumers
is withdrawn; the scope itself is untouched).
Running totals across all nine amendments: **121 rules superseded, retired or modified**, **33 retired
outright** (unchanged — A9 retires none).
**No new wire field, endpoint, error code, MCP tool, colour token, type size, dependency or migration.**
One function splits into two, both inside `packages/shared/src/calendar/periods.ts`, and one client wrapper
is deleted.

#### The three questions this amendment had to settle

| Question | Ruling | Rule |
|---|---|---|
| Scope the picker by horizon, or just raise the threshold? | **Scope it, which is the owner's own proposal.** A threshold is a number someone tuned against one account's shape; it says nothing about *why* eight is the line and it is wrong again the moment an account grows. Scoping by horizon bounds the list **structurally** — the list is one horizon's goals — and it fits the mental model the product already has, which is lens-shaped end to end. It also costs nothing new: the reads were already one per horizon (`useParentOptions`' four, `backlogHost`'s three), so the scope is a filter over data already in hand, not a new query. The threshold survives for the one job it was always right about: whether a list you can see whole needs a search field. | R-nav-31 |
| Which week should `+ Task` from a Monthly goal use at the seam — the month's first week, or the current week with the month named? | **The month's first week.** Both options are honest, and only one of them is *useful*. A task is created to be seen in the lens that created it; a week the viewed month's lens will never show is a leak, not a destination, and naming it preserves all three of the defect's consequences (a Weekly goal minted in the wrong month, R-goal-47's line still reading `Nothing planned yet`, a navigation into the previous month) while merely narrating them. The first-week answer is always current-or-future at the seam, so nothing is back-dated and R-goal-36 is not engaged. And the month is named **anyway**, in all three destination rows — the fix and the disclosure are not alternatives. | R-task-49 |
| Rename `weekForMonth`, or fix it in place? | **Split it, and rename the survivor.** The two questions genuinely differ: "which week am I living in, viewed from this month" (zoom) and "which week inside this month should new work go to" (create). One function answering both is how a zoom rule ended up deciding where work lands. A8's spec pass already recommended `zoomWeekForMonth`; A9 takes it and adds `taskWeekForMonth` beside it, puts **both** in `no-second-calendar.test.ts`'s census, and deletes the web wrapper — the last of R-lens-30's six duplicated calendar functions, which survived only because its signature looked like vocabulary rather than calendar. | R-lens-9, R-task-49 |

#### Consequences checked and found to hold unchanged

- **R-lens-15 / R-rm-4 (no filters in a lens)** — untouched, and the horizon selector does not reopen it
  for the reason A7 already gave: it lives inside a modal, resets on every open, holds no state past the
  choice it was typed for, and adds no parameter to any lens read (S-lens-3-3 untouched). It narrows a
  *list you are standing in*, not a *screen you have to change back*.
- **R-lens-13's surviving accessibility clause** — met by the second control as it is by the first: one tab
  stop, arrows along the axis the control runs, the selection announced (`aria-checked` plus a
  `role="status"` count) and never merely coloured. **Two tab stops, never two focus traps** — the picker
  still renders inside the one dialog `Sheet` already traps, and A7's `aria-modal` stacking rule is
  untouched.
- **R-lens-16 / R-lens-27 (no read loads the whole goal list)** — untouched. A9 adds no read, no endpoint
  and no query parameter; horizon scoping filters options the picker already held.
- **R-goal-36 (nothing is created into a past period)** — honoured by construction at the seam. The month
  holding the current week keeps it, so the first-week fallback only fires for a month the current week is
  not in, and can therefore never answer a week earlier than the one the owner is standing in.
- **R-goal-47's planned-ness scope** — literally unchanged, and now *correct in company*: the week
  `+ Task` targets is inside the viewed month, so the line counts what the owner just planned instead of
  reading `Nothing planned yet` immediately after they planned it.
- **R-nav-19 / R-task-41 (nothing is created into a period and then vanishes)** — strengthened. The forced
  move to the Weekly lens now lands on a week the viewed month actually contains, which is what that rule
  was always trying to guarantee.
- **D-18 (array order is not a decision)** — untouched. The server still refuses an ambiguous conversion
  and still names its candidates, and its list still wins over the client's filter. What A9 changes is a
  *client-side default the owner can see and change in one tap*, which is the distinction D-18 turns on.
- **D-5 (a disabled button is a hint, not an invariant)** — honoured. `permittedHorizons` is the mode's own
  legality rule read a second way rather than a second rule, so a horizon chip can never offer what the
  server would refuse; where the two could ever disagree the server still wins and its refusal still
  renders at the form.
- **R-nav-27 (two rows of chrome)** — untouched. Nothing here renders on a lens.
- **Contrast (`tests/screens/contrast.test.ts`)** — no new colour and no new token: the horizon chips are
  the product's existing `S.chipBtn`, the destination lines are `T.mut` body text.
- **`docs/BUSINESS-RULES.md`** — one sentence changes, in the Goal section's create bullet (the parent
  default and the horizon scoping). `apps/api/src/api/mcp/business-rules.ts` is regenerated in the same
  commit, and `apps/api/tests/mcp/verbatim.test.ts` is what proves it.
