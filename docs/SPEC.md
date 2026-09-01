# Goal Cascade — Product Specification

Extracted from `docs/BUSINESS-RULES.md` (authoritative prose) and the React mockup in `apps/web/src/`.
Where the two disagree, BUSINESS-RULES wins and the divergence is recorded in §5.

Conventions used throughout:

- **Week model.** Weeks start Monday. The client addresses weeks by *offset* relative to the current week (`0` = current, negative = past, positive = a future week; ⚠ **A2** removes the forward bound — R-lens-7). The stored model uses an absolute `weekStart` date (see §5, D-1). `offset = (weekStart − mondayOf(today)) / 7 days`.
- **Period model** (⚠ **A2**, R-goal-33). Every non-Life goal sits in exactly one **period** of its own horizon, identified by a canonical `periodKey`: `2026` (Yearly), `2026-Q3` (Quarterly), `2026-09` (Monthly), `2026-09-07` — the Monday — (Weekly). A Life goal has `periodKey = ''`. A week is the Weekly horizon's period, so the week model above is a special case of this one.
- **Amendments.** §6 records amendment sets applied after the first draft. Every rule an amendment supersedes, retires or modifies is marked in place with `⚠` and the rule that replaces it; §6 carries the before/after so intent can be diffed. A rule with no `⚠` is unchanged. **A rule marked `RETIRED` describes a product that no longer exists and must not be implemented**; its text is left in place only so the diff is readable.
- **Horizon rank.** ⚠ **A2**: `Life=0, Yearly=1, Quarterly=2, Monthly=3, Weekly=4` (R-goal-30). "Shorter horizon" = higher rank. Weekly is terminal (R-goal-31) and is the only horizon that holds tasks (R-goal-39).
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
| `goalId` | string | required ⚠ **A2** | The **Weekly** goal that holds it. `horizon = 'Weekly'` is the whole condition (R-goal-39) — never leaf-ness, never any other horizon. |
| `title` | string | required | What to do. Non-empty after trim. |
| `cond` | string | optional (`''`) | Done-condition — how you'll know it's done. |
| `desc` | string | optional (`''`) | Free-text notes. |
| `links` | `{ url: string }[]` | optional (`[]`) | External links, insertion-ordered. |
| `done` | boolean | **[srv]** | Derived from `doneWeek != null`; set via the complete/uncheck operations, never written directly. |
| `doneWeek` | week (Monday date) \| null | **[srv]** | The week the task was completed in; `null` while open. |
| `doneAt` | timestamp \| null | **[srv]** | Instant of completion; renders as `Done Fri 28 Aug`. |
| `originWeek` | week (Monday date) | **[srv]** ⚠ **A2** | The week the task was created **into**. Seeded once from its Weekly goal's `periodKey` and immutable thereafter; it is **its own stored field, never re-derived from the parent** (R-task-40). There is no client input for it. |
| `events` | TaskEvent[] | **[srv]** | Activity timeline, newest first. |
| `createdAt` | timestamp | **[srv]** | Audit timestamp. |

The mockup's `doneLabel: string` is a rendering of `doneAt` and is not stored (§5 D-4).

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
- **R-goal-39 (only Weekly goals hold tasks)** — A task's `goalId` must name a goal with **`horizon = 'Weekly'`**. Life, Yearly, Quarterly and Monthly goals never hold tasks, and a Monthly goal with no Weekly children is no exception. A task create or re-parent naming any other horizon is refused with **`NOT_A_WEEKLY_GOAL`** (409, replacing `NOT_A_LEAF`). *Supersedes R-goal-12 ("goals never hold tasks directly; tasks hang off the leaf's weekly focus") and R-task-1.*
  - **The condition is the horizon, full stop — never leaf-ness** (R-goal-37). Because Weekly is terminal (R-goal-31), every Weekly goal is childless, so "Weekly" implies "no children"; **the converse is false and is the trap.**
  - `+ Task` is rendered on Weekly goals and nowhere else.
- **R-goal-40 (re-plan writes `periodKey`; a Weekly goal is not re-plannable)** — Re-plan sets `periodKey` to a contextual next period of the goal's own horizon and takes an **optional** one-line reason; nothing is mandatory (R-goal-22's substance unchanged). Options are derived from today and the goal's current period, strictly after both (D-3): Monthly → the next two months, Quarterly → the next two quarters, Yearly → next year. *Supersedes R-goal-23.*
  - **A Weekly goal's `periodKey` is immutable after creation**, and a Weekly goal is not re-plannable — the same exemption R-goal-21 gives a Life goal, for the opposite reason. A Weekly goal *is* a week: moving it forward would silently restate what a past week contained, which is D-2, the defect that made focus per-week in the first place. An intention that did not happen is carried by its **open tasks** (R-lens-12), not by moving the goal; an intention with nothing under it is re-written as a new Weekly goal in the new week, which costs one line and leaves the record intact.
  - **Move (re-parent) remains available on a Weekly goal** (R-goal-16/17/18 unchanged). Re-parenting changes no week and rewrites no history — it corrects *which intention a week served*, not when it happened. ⚠ *Interpretation:* the owner's ruling says a Weekly goal "is never re-parented or moved forward"; this spec reads that as one statement about the **week**, since forbidding Move as well would make Weekly the only horizon in the product that cannot be corrected. See §4 Q-24.
- **R-goal-41 (the goal detail page)** ⚠ **modified by R-goal-48 (A3) — the child list is a `Sub-goals` section that renders when empty and carries an inline `+ Sub-goal`** — A goal's detail page shows: breadcrumbs to the Life root **with each ancestor's period label** (R-goal-35); title; horizon · period chip; `why`; pulse; the child list with each child's period; the backlog block (R-backlog-11/12) on a Yearly/Quarterly/Monthly goal; the **task list** and the backlog pull list (R-backlog-28) on a Weekly goal; and the learnings attached to its Life line (R-learning-5). *Supersedes R-goal-27.* There is no weekly-focus block and no dormant block — both are deleted.
- **R-goal-42 (gaining a child can no longer strand work)** — Adding a child to a goal, or moving a goal under it, moves nothing, deletes nothing and refuses nothing. The transition R-goal-28 and D-8 existed to handle is **unreachable**: only Weekly goals hold tasks, and a Weekly goal can never gain a child (R-goal-31). *Retires R-goal-28 and the `GOAL_HAS_OPEN_TASKS` refusal.* This is the one place the redesign removes a class of defect outright rather than relocating it.
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

- **R-goal-47 (the planned-ness line, and dormancy's one surface)** — A Monthly goal's card, in the Monthly lens and on its detail page, carries **one muted line** stating how the month is broken into weeks. The scope is *Weekly goals whose parent chain reaches this Monthly goal and whose week's **Monday** falls in the viewed month* — the same Monday rule as R-lens-9's zoom and R-task-49's target week, so one answer serves all three and they can never disagree.

  | Situation | The line reads |
  |---|---|
  | No Weekly goals under it in any week of the viewed month | `Nothing planned yet` |
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
  | Monthly | month | every Monthly goal for the selected month, from all Life lines |
  | Weekly | week | every Weekly goal for the selected week, from all Life lines, **and the tasks** (R-lens-12) |

  Each lens shows the goals of its own horizon in exactly one period and no others. A goal appears in exactly one lens, in exactly one period of it. The Life lens has no period dimension: it is simply all of them.
- **R-lens-3 (grouping by Life goal, at any depth)** ⚠ **modified by the reconciliation pass — the root-less group is renamed `UNSORTED` (R-lens-20)** — Every lens except Life groups its items under **the Life goal each ultimately belongs to**, resolved by walking `parentId` to the root — any depth, with no assumption that the chain is four long or that the levels are adjacent (R-goal-32). Grouping is **not** filtering: there is no `All` chip and no way to view one Life line alone, because the grouping already answers that. *This is the replacement for the goal-filter pills (R-rm-4); the owner is explicit: "in each lense we donot need a filter on goals instead it will be catogrised by life goals."*
  - A goal whose ancestor chain is broken — a `parentId` pointing at nothing — groups under **`UNSORTED`**, last (R-lens-20). It is never dropped: a data problem must surface in the UI rather than silently delete a row from a view (`orderedTree` already takes this position for the tree).
  - The resolution is a walk, not a stored column, and it is cycle-safe (`ancestors` already is). A goal that is its own ancestor resolves to `UNSORTED` rather than looping.
  - **The walk reads the interior tree, never the whole goal list** (R-lens-27): every goal whose horizon is not Weekly is loaded once per request and indexed by id, so each hop is O(1) and no Weekly goal the lens is not rendering is ever held.
- **R-lens-4 (the group header)** ⚠ **modified by the reconciliation pass — a zero count is not rendered; the header's shape and collapse are R-lens-19's** — Each group header shows the Life goal's title, its pulse dot, and its **open-task count** — the surviving home of the counts the filter pills carried (R-nav-7, owner decision 7). The count is the number of **open tasks under that Life goal visible in the anchoring week**: the **selected** week in the Weekly lens, and the **current** week in every other lens, which have no week of their own.
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
  - Zooming **into Weekly** yields the week containing today when today is in that month, else the **first week whose Monday falls in that month**. ⚠ *The original text said "the week containing the 1st" and accepted a Monday in the previous month. That is retired: R-goal-33 keys a week by its Monday, so zooming into `Nov 2026` would have landed on the week of Mon 26 Oct — a week every other rule counts as October's, including R-goal-47's planned-ness scope and R-task-49's target week. One Monday rule, three consumers, no disagreement.*
  - **A week that straddles a month boundary belongs to its Monday's month.** Stated because otherwise it is arbitrary, and because the whole product already names a week by its Monday.
  - **Life has no period**, so zooming to Life discards the period; zooming out of Life uses the **anchor**, which Life leaves untouched (R-lens-18) — going up to Life and back down returns you where you were.
  - The anchor moves only when a period is chosen. Zooming never moves it, so Quarterly → Monthly → Quarterly returns you to the quarter you started in.
- **R-lens-10 (past periods stay readable and truthful)** — A past period renders exactly what was there, and no write may create an item in it or move one into it (R-goal-36). **Planning never rewrites history.** *This is D-2 — the defect that made focus per-week in the first place — restated for all five horizons, and it is now a property of the goal table rather than of a table that no longer exists.*
  - Its converse binds equally: a past period is **not** read-only for *work*. A task live in a past week can still be completed, unchecked, edited, moved to the backlog or cancelled there (R-task-14, R-nav-5's "still editable" badge, R-lens-11). The redesign closes past periods to plan, never to truth.
- **R-lens-11 (future periods are never styled as late)** ⚠ **modified by the reconciliation pass — the badge names its horizon** — A future period carries a neutral badge naming the horizon — `Future year — planning ahead` · `Future quarter — planning ahead` · `Future month — planning ahead` · `Future week — planning ahead` — and nothing else. It renders in the off-now row (R-lens-21). No carry label, no red chip, no warning and no count may fire on work whose period has not arrived. **The red carry chip is the only escalation in this product** (R-task-11); firing it at a plan would destroy the one signal that means anything. The mechanism is R-task-43's signed age, which is `≤ 0` for work that is not yet due. A past period keeps `Past <horizon> — still editable` (`Past week — still editable`, `Past month — still editable`, …); the current period is unbadged and the off-now row does not render at all.
- **R-lens-12 (the Weekly lens, and what carries into a week)** — A **Weekly goal appears in week `W`'s lens iff `periodKey = W` OR it still holds at least one open task visible in `W`** (R-task-7). The two cases render differently and are never mixed:
  1. **This week's plan** — goals with `periodKey = W`, in the ordinary group order (R-lens-5), each showing its title, pulse dot, `planned N weeks ago` when stale (R-goal-43), and its tasks visible in `W`.
  2. **Carried** — goals with `periodKey ≠ W` that still hold open work, rendered **below** the week's own goals in one band, **oldest `periodKey` first**, each labelled with the week it was written for (`from week of 24 Aug`) so it is never mistaken for this week's plan, and each showing only its tasks visible in `W`.

  **No task visible in a week is ever hidden from that week's lens, and no open task is ever without its goal.** This is the surviving half of R-task-9 and D-11 — hiding carried work the moment its goal's week passed would delete the carry mechanic (R-task-7) and lose work silently — and it is the whole of the carry story now: a task carries by remaining visible, its goal carries with it, and **neither involves a write, a prompt, a move operation or a job** (`isVisibleInWeek` is unchanged).
  - **Nothing ages out of the carried band, ever.** A goal with one task open for ten weeks appears in ten consecutive lenses, and that is correct: it is ten weeks of unfinished work and the product should say so every week. The escalation is on the **task** — the red `N weeks` chip, growing (R-task-11) — and it is the only one there is (R-lens-11). An age-out rule would be a second escalation, or worse, a silent disappearance of open work, which is the one thing R-task-7 exists to prevent. The carried band's ordering is the whole ergonomic answer: the oldest thing is always at the top of it.
  - This behaviour is not new. Before A2 a **dormant leaf** with a carried task appeared on the Tasks screen every week for as long as the task stayed open (R-task-9, D-11). What changes is only the name on the container.
  - `+ Task` renders on a Weekly goal whose week is the current one or later (R-task-41), and never on a goal in the carried band — carried work is finished, moved to the backlog or cancelled where it stands; adding *new* work to a past week's goal would be back-dating (R-task-41).
  - The Weekly lens is the only lens that shows tasks. Everything the Tasks screen did — the week switcher, completing, unchecking, the three exits, carry labels, backlog pulls — happens here (CR-3).
- **R-lens-16 (a lens read is scoped; the whole tree is never shipped)** — Every lens read is scoped to one horizon and one period and is paginated (Q-12's page cap). **The `GET /goals` "whole tree, flat" read model is retired** (R-rm-5): with a Weekly horizon an account accumulates on the order of a thousand goals a year (R-goal-46, Q-12), and a cold open that ships every goal — plus a client that rebuilds a tree from them and derives leaf-ness with an O(n²) scan — stops working somewhere in the second year, silently and gradually.
  - What replaces it: `GET /goals?lens=<horizon>&period=<periodKey>` returning that lens's items with their resolved `lifeRootId` (R-lens-3), plus the Life goals themselves for the group headers. The Life lens is the only unscoped read and is bounded by the number of Life goals.
  - The **server** resolves each item's Life root, its group and its counts. The client never walks an ancestor chain it does not hold, and must never assume it holds the whole tree.
  - Ancestry for one goal comes from `GET /goals/:id`, which already returns `ancestors` (R-goal-41).
  - ⚠ **the reconciliation pass measured this and R-lens-27 is the result.** The header's own premise — *"at most 500 nodes … so nothing here needs a query"* — was verified false and the cost is worse than the estimate: `GET /goals` is **Θ(n²·d)**, not Θ(n²), because `GoalService.toView` runs `isLeaf` + `descendantIds` + a per-descendant `isLeaf` for **every** goal. Measured: 1.4 M element visits at 395 goals (one year of ordinary use), 845 M and 2.9 s of CPU at 9 755. The named culprit in the delta — "`isLeaf` called from inside `orderedTree`'s walk" — is wrong: `orderedTree` is Θ(n log c) and calls `isLeaf` never. See `docs/work/14-redesign/RECONCILIATION.md` §3.
- **R-lens-13 (the lens switcher)** ⚠ **SUPERSEDED by R-lens-17 (reconciliation pass) — there is no persistent switcher; the title is the control** — ~~A five-way control — `Life · Yearly · Quarterly · Monthly · Weekly` — in the Goals screen header, above the period control.~~ The refusal it carried survives verbatim and is restated in R-lens-17 and R-nav-23: **it is not a tab and must never become one** — five lenses in a five-item tab bar leaves no room for capture or Learnings, and the tab bar is a top-level destination switcher, not a zoom. Its accessibility requirements also survive into the Zoom sheet: a single tab stop with `←`/`→` between options (the roving-tabindex pattern R-backlog-22 already requires), and the selected lens announced, not merely coloured.
  - **Why it went.** A permanent five-way strip is a third unconditional row on the screen whose complaint was *"its too clutered"* (R-nav-27); it is 42 characters at 360px; four of its five labels are always wrong; and it treats an ordered scale as five peers. The Zoom sheet costs one tap on a deliberate, infrequent act and carries strictly more information — each row names the exact period it would land on and how many goals are there (R-lens-22), which a five-label strip has no room for.
- **R-lens-14 (every lens, period, goal and task is addressable)** ⚠ **modified by the reconciliation pass — the route shapes are R-nav-24's, amended** — A router is adopted (owner decision 6). **Routes**, each restorable by URL and by back/forward: the lens (`lens` + `period`, one route shape per horizon — R-nav-24), a goal detail page, a **task page** (R-task-45), the Backlog page, Learnings. **Overlays**, not routes, because each is a two-second interaction whose URL nobody wants: the `+` capture drawer, every confirm sheet, the create and edit forms, the period picker. A deep link to a lens+period lands on that lens with that period selected; an unparseable or absent period falls back to the current one rather than erroring.
- **R-lens-15 (no filters, anywhere in a lens)** — There are no goal-filter pills, no `All` chip, no horizon filter, no pulse filter and no search-as-filter in any lens. Grouping (R-lens-3) is the whole answer. *Retires R-nav-6 and R-nav-7's pill row (R-rm-4).*

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
- **R-lens-19 (group rendering: collapse, suppression, and what is not drawn)** — The group header is one `S.sectionLabel` row: `▾ <LIFE GOAL TITLE> · 3 OPEN` (R-lens-4's count).
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

- **R-task-39 (a task hangs off a Weekly goal)** — A task's `goalId` names a goal with `horizon = 'Weekly'` and nothing else (R-goal-39). *Supersedes R-task-1.*
- **R-task-40 (the week is the task's own stored field — the modelling ruling)** — `originWeekStart` stays an **absolute Monday stored on the task**, server-assigned once at creation from its Weekly goal's `periodKey`, and immutable for the life of the task. It is **not implied by, and never re-read from, the Weekly parent.** `doneWeekStart` is unchanged. There is no client input for either. *Supersedes R-task-33 and R-task-34's target-week parameter.*
  - **The Weekly goal says what the work is for; the task's own week says when it was live.** Those are two different facts and the redesign is the moment they stop coinciding.
  - **Why stored and not implied**, in the order the reasons bind:
    1. **Carry** (R-task-7) is a comparison against `originWeekStart` with no write and no job — the single fact that lets this product have no cron. An open task must remain visible in every week `≥` its origin *while its goal stays anchored to one week* (R-goal-40); a derived week would make "which weeks was this live in" a question about the parent rather than about the task.
    2. **Uncheck** (R-task-19) requires the *original* origin to survive a completion and its reversal. `doneWeekStart` must be stored regardless; deriving `originWeekStart` would split the two halves of one week model across a stored field and a join, and "carries into the current week under its **original** origin" would have nothing to read.
    3. **D-1.** A week that is looked up rather than recorded changes meaning without a write. That is the most damaging thing this spec inherited, and the reason every week in the product is an absolute date. `periodKey` is immutable on a Weekly goal (R-goal-40), which makes an implied week *look* safe — but it is safe only for as long as that immutability holds, and a stored column is safe unconditionally.
    4. It costs nothing: the column exists, is indexed (`ix_tasks_open_week`), and every week-scoped read stays an index seek instead of a join to `goals`.
  - **What legitimately diverges, and it is exactly one thing:** the task **carried**. An open task is visible in weeks after its origin, so from the second week onward its week and its goal's week differ. That divergence is the product working, and R-lens-12 is how it renders. Because a Weekly goal's `periodKey` is immutable (R-goal-40), there is no other way for the two to come apart.
  - **What may not diverge:** at creation they are equal, by construction — there is no target-week parameter to disagree with the parent.
- **R-task-41 (where a task may be created)** ⚠ **modified by the reconciliation pass — a fourth source (R-task-49)** — A task is created **under a Weekly goal**, from four sources: (a) `+ Task` on a Weekly goal — in the Weekly lens or on its detail page; (b) a **Backlog pull** (R-backlog-26); (c) the `+` drawer's `Add to this week instead` (R-backlog-27); (d) **`+ Task` or `Pull from backlog` on a Monthly goal's card**, where the Weekly goal is resolved or created for you (R-task-49). *Supersedes R-task-2's four sources — the Idea source is deleted with the entity (R-rm-1) — and R-task-4's target selector, which now lists Weekly goals for the target week, labelled `<Life root title> — <weekly goal title>`.*
  - **No back-dating, unchanged, and now enforced through the parent** (R-task-6's surviving clause): a task may not be created under a Weekly goal whose week is in the past. The attempt is refused with `PERIOD_IN_PAST`, and no `+ Task` affordance renders on a past week or in the carried band (R-lens-12), from any source.
  - **Creating forward is unbounded** (R-goal-36): a Weekly goal three months out accepts tasks. They are invisible until that week arrives (R-task-7) and are never styled as late (R-lens-11).
  - Creating a task into a week other than the one being viewed **moves the Weekly lens to that week**, with the toast naming it: `Added to week of <Mon d Mon>`. Nothing may be created into a week and then vanish from the screen that created it (R-nav-19's reason, unchanged).
- **R-task-42 (visibility is unchanged)** — R-task-7 and R-task-8 stand verbatim: an **open** task is visible in every week `≥ originWeek`; a **done** task only in `doneWeek`; an **exited** task in none. Visibility is a function of the task's own weeks and **never of its goal's period** — which is what makes R-lens-12's carried band possible and what makes carrying free.
- **R-task-43 (carry age is signed)** — `carryAge = weeksBetween(originWeekStart, min(viewedWeek, currentWeek))`. The value **may be negative**. Labels: `≤ 0` → **none**; `= 1` → the gray `since Mon 24 Aug`; `≥ 2` → the red `N weeks · since 10 Aug` chip, the product's only escalation. *Supersedes R-task-37's `max(0, …)` clamp; R-task-10/11/12's thresholds are unchanged.*
  - The `min(…, currentWeek)` term is what keeps a plan from ageing: a task planned for `+1` and viewed at `+3` is age `−1`, not 2. Dropping the outer clamp changes nothing that renders — no label fires below 1 either way — and leaves **one** guard instead of two, carried in the sign. A negative age is the honest reading of "not due yet", and a client that ever wants to say `in 2 weeks` has the number.
  - An **already-late** open task (origin in the past) projected into a future week keeps the age it has *today*: it is late now and still open then, so the chip is correct there.
  - `TaskView.carryWeeks` therefore stops being `nonnegative`. **This is a silent wire break** — the type still parses and the semantics change underneath it — and is called out in the delta's compatibility section.
- **R-task-44 (completion is never in the future — unchanged)** — `originWeek ≤ week ≤ currentWeek`, refused with `WEEK_OUT_OF_RANGE` otherwise (R-task-35, unchanged and now reachable at any distance, because the forward bound is gone). A task under a future Weekly goal cannot be completed at all until that week arrives; its row renders with no completion checkbox.
- **R-task-45 (the task page)** ⚠ **modified by the reconciliation pass — it also carries the completion checkbox (R-task-50)** — Task detail is a **routed page**, not a drawer (CR-5, owner decision 6). It shows the **completion checkbox** (R-task-50), the goal path (Life root › … › Weekly goal, **with that goal's week**) as one muted line with both segments tappable, the done date when done, editable `title` / `cond` / `desc`, the links list with add and remove, the three exits when open, and the read-only activity timeline. It carries the top-right cluster (R-nav-25), which goal detail today does not. *Supersedes R-task-22.*
  - Back returns to the lens and period the task was opened from. A task page opened cold by URL falls back to the Weekly lens at the task's `originWeek`, not at the current week — landing somewhere the task is not visible would read as a broken link.
  - Everything else about the sheet's behaviour is unchanged in substance: the dirty-only `Save changes` button, the `Task updated` toast, the blank-title fallback (R-task-23), done tasks staying editable with only the exits withdrawn (R-task-26).
- **R-task-46 (the activity timeline, amended)** — R-task-30's table changes in exactly two rows and in no other way:

  | Entry | Disposition |
  |---|---|
  | `Created — weekly planning` | **renamed** `Created — added to a goal`; the `planning` source becomes `goal` (there is no planning screen). |
  | `Created — from an Idea` | **retired** with the entity (R-rm-1); the `idea` source is removed from `TASK_SOURCES`. |

  Every other entry, glyph and trigger is unchanged — including `Carried to week of …` and its clamp (R-task-29 + R-task-38: never logged for a week later than the current one, however far ahead a lens now looks, which R-lens-7's unbounded forward control makes far more reachable than it was).
- **R-task-47 (a task never outlives its goal)** — Unchanged from Q-5: deleting a goal deletes its entire subtree and, transactionally, every Task (with its events and links) and BacklogItem in it. Deleting a **Monthly** goal therefore deletes its Weekly children and all of their tasks — the cascade already covers the new level, because it is defined over the subtree and not over a fixed depth. The confirmation names the counts, which now include Weekly goals and their tasks and can be large (R-goal-46, Q-12).
- **R-task-48 (one step, not two — the capture rule)** ⚠ **modified by the reconciliation pass — the field is pre-filled and stated, not blank and asked (R-task-49)** — Creating a task now presupposes a Weekly goal, and the common case is "I need to do this, this week". That must stay **one interaction**, and it is solved in the flow rather than in the model: the task-create sheet, when no Weekly goal exists for the target week under the chosen parent, creates one in the **same** sheet, and the save creates both rows **in one transaction**. The title is **pre-filled** from the chosen parent and the sheet **says what will happen before you save** (R-task-49) rather than presenting an empty field to fill — a form to fill in before you are allowed to fill in the form you wanted is the friction this rule exists to remove, wearing a different hat.
  - On the wire: `CreateTaskRequest` accepts either `goalId` (an existing Weekly goal) **or** `newWeeklyGoal: { parentId, title }`, exactly one of the two, refined. The server creates the Weekly goal at the target week and the task under it atomically; a failure creates neither.
  - **The data model is not special-cased.** There is no goal-less task, no implicit "inbox" goal, no nullable `goalId`. R-goal-39 holds unconditionally, and the server still refuses a task naming any non-Weekly goal.
  - This subsumes the `[Add a weekly goal]` action on R-backlog-26's refusal sheet: a conversion with no Weekly goal for the target week takes the same path rather than sending the owner away and losing the flow.

#### Reconciliation pass — creation from the Monthly lens, and a second home for exit 1

- **R-task-49 (`+ Task` from a Monthly goal — the Weekly goal is inferred, never asked)** — `+ Task` and `Pull from backlog` on a **Monthly goal's card** create a task under a Weekly goal that the server resolves. *This is R-task-41's fourth source.* Tasks live on Weekly goals (R-goal-39), so this is structurally two creates; made literal it is the worst flow in the product, so the second step is inferred.
  - **The target week** is the same clamp as R-lens-9's Monthly → Weekly zoom: the week containing today when the viewed month contains today, otherwise the **first week whose Monday falls in that month**. One rule answers *"which week does this month mean"* for zoom, for this creation and for R-goal-47's scope.
  - **Resolution**, over the Weekly goals under this Monthly goal in the target week:

    | Candidates | What happens |
    |---|---|
    | exactly one | it is used — no picker, no extra field, no extra tap |
    | more than one | the sheet shows a picker with the first preselected — one tap to change, zero to accept |
    | none | one is **created**, using R-task-48's `newWeeklyGoal` in the same transaction |

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

### Backlog

- **R-backlog-1** — A backlog item is deferred future work attached to a single Yearly, Quarterly, or Monthly goal.
- **R-backlog-2 (never Life, never a week)** ⚠ **modified by R-backlog-26 (A2) — never a Life goal and never a **Weekly** goal either** — A backlog item may **never** be attached to a Life goal and never to a week. Every goal picker in the backlog flows lists `nonLife()` only. (BUSINESS-RULES §Backlog bullet 1; `BacklogDrawer`, `BacklogScreen` move chips, `IdeasScreen` attach chips.)
- **R-backlog-3** — A backlog item has no checkbox, no done-condition, no due date, and no status, and must be rendered visibly differently from a task.
- **R-backlog-4 (creation sources — four)** ⚠ **modified by R-task-41 (A2) — three sources; the Idea source is deleted** — (a) the global `+` drawer (goal defaults to the last used), (b) a goal detail `+ Add`, (c) a task moved out of a week (R-task-15), (d) an Idea attached to a goal (R-idea-5).
- **R-backlog-5** ⚠ **superseded within a goal by R-backlog-17/18; retained across goals by R-backlog-21** — Items are ordered newest first within their group, by `capturedAt` descending, `id` descending as tie-break. (BUSINESS-RULES §Backlog bullet 5; §5 D-17.)
- **R-backlog-6 (conversion — the only way backlog becomes work)** — `Add to this week` opens the standard task-create modal pre-filled with the item's title, description and links. **On save the item is converted: the backlog item is deleted and a task is created in one atomic operation.** It is never duplicated, never left behind, never copied. The task logs `Created — pulled from Backlog`. (BUSINESS-RULES §Backlog bullet 4; `store.saveNewTask`.)
- **R-backlog-7** ⚠ **modified by R-backlog-26 (A2) — "active leaf" reads "Weekly goal for the target week"; the ambiguity rule survives** — Conversion is target-bound: the created task's `goalId` is the **active leaf at or under the item's goal**. From the planning screen it is the leaf whose card the item was tapped under; from the backlog screens it is resolved by lookup. When more than one active leaf qualifies, the user must choose — the client must not pick silently. (`store.pullToWeek` → `activeLeafFor`; §5 D-18.)
- **R-backlog-8 (inactive-branch prompt)** ⚠ **modified by R-backlog-26 (A2) — the refusal survives with new copy and the code `NO_WEEKLY_GOAL`** — If no leaf at or under the item's goal has a focus in the target week, conversion is refused and a sheet appears: title `This branch isn't active this week`, body `"<item title>" can only become a task under an active weekly focus.`, actions `[Set a weekly focus]` (navigates to weekly planning) and `[Cancel]` (dismisses; the item is untouched). (`store.pullToWeek` else-branch; `InactiveBranchSheet`.)
- **R-backlog-9** — Converting an item that no longer exists (already converted, deleted, or moved) is refused; no task is created. (§5 D-19.)
- **R-backlog-10 (other actions)** ⚠ **modified by R-backlog-26 (A2) — a move target is any non-Life, **non-Weekly** goal** — Besides conversion: `Move to another goal` (target = any non-Life goal, toast `Moved to <goal title>`) and `Delete`. There is no edit-in-place and no archive.
- **R-backlog-11 (goal detail, non-Life)** ⚠ **modified by R-backlog-26/28 (A2) — the backlog block renders on a Yearly/Quarterly/Monthly goal; a **Weekly** goal shows the pull list (R-backlog-28) and its tasks instead, and holds no backlog of its own** — A non-Life goal's detail screen shows `Backlog (N)` listing only the items attached to **that** goal, an inline `+ Add` quick-capture (Enter or `Save item` commits; `Never mind` cancels), and per-item `Add to this week` / `Move to another goal` / `Delete`. Empty state: `Nothing deferred on this goal.` (`GoalDetailScreen.tsx`; move action added by §5 D-20.)
- **R-backlog-12 (goal detail, Life — read-only aggregate)** — A **Life** goal's detail screen shows `Backlog across this line (N)`: a **read-only** roll-up of every item on any descendant goal, each row labelled `<owning goal title> · added <date>`. No per-item actions here — only `Open Backlog →`. (BUSINESS-RULES §Backlog bullet 5; `GoalDetailScreen.tsx` `isLife` branch.)
- **R-backlog-13 (full backlog page)** ⚠ **modified by R-backlog-21** (within a group, the goal's manual order) — The Backlog page groups items by branch path `<Life goal> › <owning goal>`, newest first, showing title, `Added <date>`, description, `N link[s]`, and `from <week of …>` when the item came out of a week. Tapping a row reveals its actions. Empty state: `Nothing in the backlog.` / `Future work lives here until you pull it into a week.` (`BacklogScreen.tsx`.)
- **R-backlog-14 (`+` drawer)** ⚠ **modified by R-backlog-27 (A2) — the drawer's goal chips exclude Weekly goals as well as Life goals** — The `+` tab opens `Add to Backlog`: goal chips (non-Life, defaulting to the last-used goal), title (required), description, links, and a checkbox `Also add to the current week`, plus a `View Backlog →` shortcut. (BUSINESS-RULES §Nav; `BacklogDrawer`.)
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

- **R-backlog-26 (conversion targets a Weekly goal)** — `Add to this week` converts a backlog item into a task, which must land on a **Weekly goal** (R-goal-39). The conversion names a target week; the receiving goal is the Weekly goal **at or under the item's goal** whose `periodKey` is that week. *Amends R-backlog-7, R-backlog-8 and R-backlog-25 — each of which said "active leaf"; the resolution is otherwise identical, and D-18's ruling is untouched.*
  - Exactly one candidate → used silently. Two or more → the owner chooses; the server refuses to pick, with `AMBIGUOUS_CONVERSION_TARGET` and `details.candidates`. That id decides which week the task belongs to for the rest of its life, and array order is not a decision.
  - **None** → refused with **`NO_WEEKLY_GOAL`** (409, replacing `BRANCH_NOT_ACTIVE`), and the sheet offers R-task-48's inline `New weekly goal` field rather than sending the owner away: title `No weekly goal here for that week`, body `"<item title>" becomes a task under a weekly goal.`, actions `[Create one and add it]` / `[Cancel]` (the item is untouched on cancel). The copy names the week when the target is not the current one.
  - Everything else about conversion is unchanged: one atomic, idempotent operation; the item is converted, never duplicated, never left behind (R-backlog-6, R-backlog-9, D-19, Q-4); the task logs `Created — pulled from Backlog`.
  - A backlog item still may **not** be attached to a Weekly goal (R-backlog-2, amended): the whole point of a backlog item is that it has no week (R-backlog-1/3).
- **R-backlog-27 (the `+` drawer)** — Unchanged except in its target resolution: with `Add to this week instead` ticked, a **task only** is created under the Weekly goal at or under the chosen goal for the current week, logging `Created — added to this week`; with no such Weekly goal, a **backlog item** is created instead and the toast explains: `No weekly goal this week — parked in Backlog`. Unticked, a backlog item is created. *Amends R-backlog-15's copy and target rule; the single-entity behaviour (D-21) is unchanged.* The drawer's goal chips continue to list Yearly/Quarterly/Monthly goals only — never Life, and now never Weekly (R-backlog-2).
- **R-backlog-28 (the pull list moves to the Weekly goal's page)** — The `FROM THE BACKLOG` list that lived under each checked leaf on the plan screen survives on a **Weekly goal's detail page**: it lists every open backlog item whose `goalId` is any **ancestor** of that Weekly goal, excluding the Life root, which cannot hold items. Tapping one opens the task-create flow pre-filled with the item's title, bound to that Weekly goal and its week. The list is hidden when the pool is empty. *Supersedes R-plan-9 and R-plan-10 — the one surviving half of the plan screen.*
  - "At or under the leaf" becomes "any ancestor of the Weekly goal", because a backlog item can never sit on the Weekly goal itself (R-backlog-2).
- **R-backlog-29 (move-to-backlog lands on the nearest non-Weekly ancestor)** — R-task-15 says the Move-to-Backlog exit creates a backlog item on **the owning goal's** backlog. The owning goal is now a Weekly goal, which may not hold backlog items (R-backlog-2) — so the item is created on that Weekly goal's **nearest non-Weekly ancestor**, normally its Monthly parent. Everything else about R-task-15 is unchanged: `title`, `desc` and `links` carry over, `fromWeek` is the Monday of the week the task was live in, the confirm sheet takes an optional reason, and the toast reads `Moved to Backlog[ — reason noted]`.
  - This is the semantically right target as well as the only legal one: "move to backlog" means *not this week*, so the item must leave the week, and a Weekly goal **is** a week. Landing it on the week it is escaping would be a no-op wearing an exit's clothes.
  - A Weekly goal whose only ancestor is a Life goal has no legal target (a Life goal holds no backlog — R-backlog-2). The exit is then refused with `LIFE_GOAL_NO_BACKLOG` and the sheet says so; Cancel remains available. This is the one cost of R-goal-32's level-skipping, it is rare, and refusing is better than inventing a home.
- **R-backlog-17 … R-backlog-24 (manual ordering) — unchanged and carried forward.** The `sortKey`, the relative-move command, the per-goal scope, the keyboard-first requirement and the live-region announcements are untouched by this redesign: they were specified against `backlog_items`, and nothing in A2 moves that table. They remain halted work to be re-planned into this build rather than rewritten (`docs/work/13-planning-ahead/spec-delta.md` §2.1, §2.2, §3).


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
- **R-nav-26 (removed by design — extended)** — R-nav-14 is unchanged, and A2 adds to it: **a lens is not a report.** No weekly review wizard, no push flow with mandatory reasons, no audit-trail view, no week report, no carry-count flag — **and** no roll-up, completion rate, streak, burndown, or period summary on any lens header, and no completion state on a goal (R-goal-45). The only numbers in the product are R-lens-4's open count, R-goal-24's carrying line, `N in backlog`, the carry chip, ⚠ **and — added by the reconciliation pass — R-goal-47's planned-ness line and R-lens-22's Zoom-sheet goal counts.** Any other number is out of scope and must be refused, not deferred.
  - **Why the list grew by two, and only two.** R-goal-47's `3 weekly goals · 1 this week` **replaces** a surface rather than adding one: hiding empty groups (R-lens-19) deleted dormancy's only rendering, and this is its successor. R-lens-22's counts exist because the Zoom sheet must show where you would land *before* you commit, which is the whole argument for the sheet over a five-way strip (R-lens-17). Both are counts of things that exist, not measures of performance: neither fills up, neither is a rate, neither is coloured. **A completion rate, a streak, a burndown or a period summary is still refused.**

#### Reconciliation pass — the chrome budget, and where the app opens

- **R-nav-27 (two rows of chrome, and nothing else unconditional)** — Above the first item of any lens there are **at most two unconditional rows**: the top-right cluster (R-nav-25) and the lens row (R-lens-17). Everything else is conditional — the off-now row only off-now (R-lens-21), group headers only when there is more than one non-empty group (R-lens-19).
  - The unit is *rows of chrome above the first real item*. Today's Tasks screen carries **four** (eyebrow + `Edit plan`, week switcher, `Past week — still editable`, filter pills) and the goals tree carries **three plus depth**. Two is therefore not merely "no worse"; it removes half of what the owner complained about before any new capability is counted.
  - **This is the rule that refuses the next control.** A new unconditional row is refused, not deferred — it is why R-lens-13's five-way switcher was superseded, why there is no period picker (R-lens-7), and why the lens title carries the page identity instead of an eyebrow plus an H1.
- **R-nav-28 (where the app opens)** — A cold start opens the **Weekly lens** at the week containing today. It is the app's home for daily work now that it has absorbed the Tasks screen (R-lens-12), and it is the only lens where the answer to *"what do I do now"* is on screen.
  - Within a session the `Goals` tab returns to the lens last used, so daily use never opens the Zoom sheet (R-lens-17).
  - **The period always resets to the one containing today**, at every cold start, in every lens (R-lens-8). A remembered future period would let the app open on a screen that quietly lies about now.

#### Amendment 3 — sub-goals from the goal page

- **R-nav-29 (a goal detail page's one primary action)** — Goal detail → **`+ Task` on a Weekly goal, and nothing at any other horizon.** *Supersedes R-nav-25's goal-detail mapping* (`+ Weekly goal` on a Monthly goal, `+ Add` on Yearly/Quarterly, none on Life). R-nav-25's **form** is untouched: the theme toggle, the account button, and at most one primary action per page.
  - **`+ Weekly goal` is dropped from a Monthly goal's page, not kept alongside.** With R-goal-48's inline capture on every horizon that can hold children, the top action would be a second route to a create the `Sub-goals` section already offers one screen-inch below it, and only on one of the four horizons — the exact clutter R-nav-27 refuses. Where they differ, the inline one is the shorter path (tap, type, `Enter`), and `More…` reaches the identical sheet the top action opened, pre-filled the same way, so no capability is lost with it.
  - **`+ Add` on Yearly/Quarterly was never built** and is dropped rather than implemented: R-nav-25's own text records that no such branch was ever written, and backlog capture on those two horizons is the backlog section's own inline `+ Add` (R-backlog-11) plus the global `+` drawer, both of which reach any goal.
  - **Q-20 is narrowed, not reversed.** Its ruling — *a create button for the horizon below, on every card, is a tree growing back one affordance at a time* — held `+ Weekly goal` off the Monthly **card** and left it on the **page**. A2's reconciliation kept it there because a detail page carries exactly one primary action and had nothing else to put in it; R-goal-48 gives that create a better home than the cluster, so the page now carries none.
  - A Weekly goal's page is unchanged: `+ Task` is its one primary action (R-goal-39), and it is the only goal page that has one.


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
- **S-goal-37-1** (R-goal-37, unhappy — the trap) — *Given* a Monthly goal `M` with **no** children, so it is a leaf by the structural definition. *When* a task is created with `goalId = M`. *Then* it is refused with `NOT_A_WEEKLY_GOAL`. A build that admits it has keyed task ownership on leaf-ness instead of on the horizon.
- **S-goal-37-2** (R-goal-37, unhappy — the word is gone) — *Then* no read model exposes `isLeaf`, and no rule, error message, screen string, MCP tool description or resource uses the word "leaf" to mean "holds work".
- **S-goal-38-1** (R-goal-38, happy) — *Given* Life `L` › Yearly `Y` › Quarterly `Q` › Monthly `M`, with one Weekly goal `W` under `M` for week `W0`. *Then* `M`, `Q`, `Y` and `L` are all **not dormant** in `W0`, and all four **are** dormant in `W0 + 1` when `W` holds no open tasks then. *And* nothing anywhere is muted, greyed or labelled `DORMANT` in either case.
- **S-goal-38-2** (R-goal-38, happy) — *Given* a Monthly goal with no Weekly children at all. *Then* its row in the Monthly lens is styled identically to one that has them; the only difference in the product is that its detail page's primary action is `+ Weekly goal`.
- **S-goal-39-1** (R-goal-39, unhappy) — *When* a task create names a Life, Yearly, Quarterly or Monthly goal. *Then* each is refused with `NOT_A_WEEKLY_GOAL`, and no `+ Task` affordance is rendered at any of those four horizons.
- **S-goal-40-1** (R-goal-40, happy) — *Given* today is in September 2026 and a Monthly goal in `2026-09`. *When* the re-plan sheet opens. *Then* the options are `2026-10` and `2026-11`, derived from today and strictly after the goal's current period.
- **S-goal-40-2** (R-goal-40, unhappy — a Weekly goal is not re-plannable) — *Given* a Weekly goal. *Then* no re-plan affordance is rendered on it, and a direct re-plan or a `periodKey` patch is refused. Its week is immutable after creation.
- **S-goal-40-3** (R-goal-40, happy — Move still works) — *When* a Weekly goal is moved under a different Monthly goal. *Then* it succeeds, its `periodKey` is unchanged, and its tasks' `originWeekStart` values are unchanged.
- **S-goal-42-1** (R-goal-42, happy — the defect class is gone) — *When* a sub-goal is created under a goal that has no children, at every horizon that permits one. *Then* nothing is deleted, nothing is re-parented, no operation is refused for open tasks, and `GOAL_HAS_OPEN_TASKS` is raised by no code path in the product. It is unreachable because only Weekly goals hold tasks and a Weekly goal can never gain a child.
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
