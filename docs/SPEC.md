# Goal Cascade — Product Specification

Extracted from `docs/BUSINESS-RULES.md` (authoritative prose) and the React mockup in `apps/web/src/`.
Where the two disagree, BUSINESS-RULES wins and the divergence is recorded in §5.

Conventions used throughout:

- **Week model.** Weeks start Monday. The client addresses weeks by *offset* relative to the current week (`0` = current, negative = past, future not addressable). The stored model uses an absolute `weekStart` date (see §5, D-1). `offset = (weekStart − mondayOf(today)) / 7 days`.
- **Horizon rank.** `Life=0, Yearly=1, Quarterly=2, Monthly=3`. "Shorter horizon" = higher rank.
- Ids in §3 refer to rules in §2. Test names and conformance reporting key off scenario ids.

---

## 1. Entities and fields

Server-owned fields are marked **[srv]**: the client never supplies them and any client-supplied value is ignored. All entities carry `ownerId` **[srv]** (see R-auth-2); it is omitted from the per-entity tables below to avoid repetition.

### Goal

| Field | Type | Req. | Meaning |
|---|---|---|---|
| `id` | string | **[srv]** | Stable goal identifier. |
| `parentId` | string \| null | required (nullable) | Parent goal; `null` only for Life goals. |
| `horizon` | `'Life' \| 'Yearly' \| 'Quarterly' \| 'Monthly'` | required | Position in the cascade; fixed after creation. |
| `title` | string | required | The goal, one line. Non-empty after trim. |
| `why` | string | optional (`''`) | One-line motivation. |
| `pulse` | `'On track' \| 'At risk' \| 'Rethink'` | required (default `'On track'`) | Self-reported health. |
| `period` | string | optional (`''`) | Target period label, e.g. `2026`, `Q4 2026`, `Sep 2026`. Always `''` on Life goals. |
| `createdAt` / `updatedAt` | timestamp | **[srv]** | Audit timestamps. |

Derived, never stored (see R-goal-8..11): `isLeaf`, `isActive`, `dormant`, `subtreeActive`, `ancestors`, `descendants`, `path`.
The mockup's `Goal.focus: string` is **not** a Goal field in this spec — see WeeklyFocus and §5 D-2.

### WeeklyFocus

| Field | Type | Req. | Meaning |
|---|---|---|---|
| `id` | string | **[srv]** | Identifier. |
| `goalId` | string | required | The non-Life leaf goal this focus belongs to. |
| `weekStart` | date (Monday) | required | The week this focus applies to. |
| `sentence` | string | required | One sentence, non-empty after trim; a blank sentence means "no focus" and the record must not exist. |
| `createdAt` / `updatedAt` | timestamp | **[srv]** | Audit timestamps. |

Unique on `(goalId, weekStart)`.

### Task

| Field | Type | Req. | Meaning |
|---|---|---|---|
| `id` | string | **[srv]** | Identifier. |
| `goalId` | string | required | The active non-Life leaf goal whose weekly focus holds it. |
| `title` | string | required | What to do. Non-empty after trim. |
| `cond` | string | optional (`''`) | Done-condition — how you'll know it's done. |
| `desc` | string | optional (`''`) | Free-text notes. |
| `links` | `{ url: string }[]` | optional (`[]`) | External links, insertion-ordered. |
| `done` | boolean | **[srv]** | Derived from `doneWeek != null`; set via the complete/uncheck operations, never written directly. |
| `doneWeek` | week (Monday date) \| null | **[srv]** | The week the task was completed in; `null` while open. |
| `doneAt` | timestamp \| null | **[srv]** | Instant of completion; renders as `Done Fri 28 Aug`. |
| `originWeek` | week (Monday date) | **[srv]** | The week the task was created in. Immutable for the life of the task. |
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
| `goalId` | string | required | A Yearly/Quarterly/Monthly goal. Never a Life goal. |
| `title` | string | required | The deferred work, one line. Non-empty after trim. |
| `desc` | string | optional (`''`) | Free-text notes. |
| `links` | `{ url: string }[]` | optional (`[]`) | External links. |
| `capturedAt` | timestamp | **[srv]** | When it was captured; renders as `Added 25 Aug` / `Added Today`. |
| `fromWeek` | week (Monday date) \| null | **[srv]** | Set when the item came from a task moved out of a week; renders `from week of 24 Aug`. |

No checkbox, done-condition, due date, or status — deliberately (R-backlog-3).

### Idea

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

- **R-goal-1** — A goal has `title` (required, non-empty after trim), optional `why`, a `horizon`, a `pulse`, a target `period`, an optional `parentId`, and any number of children. (BUSINESS-RULES §Goal bullet 1; `types.ts:Goal`.)
- **R-goal-2** — The four horizons are Life → Yearly → Quarterly → Monthly with ranks 0–3. (`utils/tree.ts:rank`.)
- **R-goal-3** — A Life goal has `parentId = null` and `period = ''`; the create modal hides the period field when the horizon is Life. (`GoalModals.tsx` — `st.gmHorizon !== 'Life'` gate; `defaultPeriod('Life') === ''`.)
- **R-goal-4** — A non-Life goal must have a parent. Create is refused without one. (`store.saveGoal`: `if (gmHorizon !== 'Life' && !gmParentId) return`.)
- **R-goal-5 (horizon-rank ordering, create)** — On create, `rank(parent.horizon) < rank(child.horizon)` strictly. The parent picker lists only goals satisfying this; the horizon picker offers only ranks `> rank(parent)`. (`GoalModals.tsx`: `parents = flatTree(...).filter(r => rank(r.g.horizon) < rank(gmHorizon))`; `gmMinRank = rank(parent) + 1`.)
- **R-goal-6** — A Monthly goal can never have sub-goals: the `+ Sub-goal` action is absent on Monthly rows and on a Monthly goal's detail screen. The server refuses the create regardless of what the client sends. (BUSINESS-RULES §Goal bullet 2; `GoalsScreen.tsx` `g.horizon !== 'Monthly' &&`; `GoalDetailScreen.tsx` same guard. §5 D-6.)
- **R-goal-7** — Nesting never exceeds Life › Yearly › Quarterly › Monthly, i.e. max depth 4 and each level strictly shorter than the last. This is a consequence of R-goal-5 + R-goal-6 and must hold as a stored invariant.
- **R-goal-8 (leaf)** — A goal is a **leaf** iff it has zero children. (`utils/tree.ts:isLeaf`.)
- **R-goal-9 (active)** — A goal is **active** iff it is a leaf, is not a Life goal, and has a WeeklyFocus for the current week. Goals that are not leaves are never active. (`utils/tree.ts:isActive`; `leaves()` requires `g.parentId`.)
- **R-goal-10 (dormant)** — A non-Life leaf with no focus for the current week is **dormant**: rendered muted with `DORMANT — no focus this week` in the tree, and `DORMANT / No weekly focus this week. Activate it in weekly planning.` on its detail screen. Dormancy must read as intentional, not broken. (`GoalsScreen.tsx`, `GoalDetailScreen.tsx`.)
- **R-goal-11 (dormancy propagates up)** — A non-leaf goal is muted iff **no** leaf anywhere in its subtree is active; one active leaf anywhere below lights the whole ancestor chain. (`utils/tree.ts:subtreeActive` — recursive `some`.)
- **R-goal-12** — Goals never hold tasks directly; tasks hang off the leaf's weekly focus. (BUSINESS-RULES §Goal bullet 3.)
- **R-goal-13** — `period` defaults from the horizon on create and is derived from **today**: Yearly → the current year, Quarterly → the current quarter, Monthly → the current month, Life → `''`. (`utils/tree.ts:defaultPeriod`, corrected by §5 D-3.)
- **R-goal-14 (edit)** — Editing a goal may change `title`, `why`, `period`, and `pulse` only. `horizon` and `parentId` are immutable through edit; the horizon chips are locked and the parent picker is hidden while editing. Re-parenting is done through Move (R-goal-16). (`store.saveGoal` edit branch writes only title/why/period; `GoalModals.tsx` `locked = !!st.gmEditId`, `needsParent = ... && !st.gmEditId`.)
- **R-goal-15** — `pulse` is one of On track / At risk / Rethink, per goal, and drives the coloured dot everywhere the goal is listed. (BUSINESS-RULES §Goal bullet 6; `ui.ts:dot`.)
- **R-goal-16 (move / re-parent)** — Move changes only `parentId`. The moved goal's own `horizon` is unchanged, and all descendants move with it, keeping their relative structure. (`store.moveGoal`; `MoveGoalModal` copy: "Its children move with it.")
- **R-goal-17 (horizon-rank ordering, move)** — A move target is valid only if `rank(target.horizon) < rank(moved.horizon)`. Because horizons are unchanged by the move and the subtree was already strictly decreasing, this single check preserves R-goal-7 for the whole subtree.
- **R-goal-18 (invalid move targets)** — A target is invalid if it is (a) the goal itself, (b) any descendant of the goal, or (c) of equal or shorter horizon. (`MoveGoalModal`: self filtered out; `desc.includes(...)`; `rank(r.g.horizon) >= rank(mvNode.horizon)`.)
- **R-goal-19 (the two disabled reasons)** — Invalid targets are listed but disabled, annotated with exactly one of two reasons: `its own descendant` (checked first) or `horizon conflict`. The goal itself is also disabled with `its own descendant`. No other reason strings exist. (`MoveGoalModal`; §5 D-7 for the self row.)
- **R-goal-20 (move preview)** — Once a target is selected and before confirming, a preview line reads `<goal> will move under <full ancestor path of target ›-joined>`. Confirm is disabled until a target is chosen. (`MoveGoalModal` `preview`, `saveBtn(!st.mvParentId)`.)
- **R-goal-21** — A Life goal cannot be moved and cannot be re-planned; its row menu offers only `+ Sub-goal` and `Edit`. (`GoalsScreen.tsx` life-goal menu.)
- **R-goal-22 (re-plan)** — Re-plan sets `period` to a contextual next period and takes an **optional** one-line reason. Nothing is mandatory; the sheet says "No mandatory fields. Fast and guilt-free." (BUSINESS-RULES §Goal bullet 5; `ConfirmSheet`.)
- **R-goal-23 (re-plan options)** — Options are derived from today and the goal's horizon: Monthly → the next two months; Quarterly → the next two quarters; Yearly → next year. Life goals are not re-plannable (R-goal-21). (`utils/tree.ts:replanPeriods`, corrected by §5 D-3.)
- **R-goal-24 (life-goal quiet signal)** — A life-goal card shows `N task[s] carrying · oldest W week[s]` when open tasks exist under it whose `originWeek` is before the current week. `N` = count of those tasks; `W` = the largest age in weeks. The line is hidden when `N = 0`. There are no audit pages, review wizards, or reports anywhere in the product. (BUSINESS-RULES §Goal bullet 7; `GoalsScreen.tsx:carryLine`.)
- **R-goal-25** — The goals tree groups every branch under its Life root, is expand/collapse per node (expanded by default), and shows per row: title, horizon chip, pulse dot, `N in backlog` when the goal holds backlog items, the focus sentence when active, and the dormant line when a dormant leaf. (`GoalsScreen.tsx:renderRows`.)
- **R-goal-26** — A life-goal summary chip shows `<A> of <B> branches active` where `B` is the number of non-Life leaves under it and `A` how many are active. When `B = 0`, the chip reads `0 of 0 branches`. (`GoalsScreen.tsx`, corrected by §5 D-16.)
- **R-goal-27** — A goal's detail screen shows breadcrumbs to the root, title, horizon · period chip, `why`, sub-goal list with per-child active/dormant labels, the weekly-focus block when active, the dormant block when a dormant leaf, a backlog block (R-backlog-11/12), and the learnings attached to its Life line.
- **R-goal-28** — Adding a child to a leaf, or moving a goal under a leaf, makes that leaf a non-leaf: its current-week focus is deleted and its open tasks are re-parented per §5 D-2/D-8. The operation must never leave a focus or task attached to a non-leaf.
- **R-goal-29** — `title` and `why` are trimmed on save; a whitespace-only title is a validation failure, not a silent no-op.

### Plan (weekly focus)

- **R-plan-1** — A weekly focus is one sentence per non-Life leaf per week, written on the Weekly-planning screen. (BUSINESS-RULES §Weekly focus bullet 1.)
- **R-plan-2** — Planning edits the **current week only**. `Edit plan` appears in the Tasks header only when the viewed week is 0, and saving the plan returns to the Tasks screen at week 0. (`TasksScreen.tsx` `w === 0 &&`; `store.savePlan` sets `view:'home', viewWeek:0`.)
- **R-plan-3** — The planning screen lists every non-Life leaf, grouped by Life root, with a Life-goal filter chip row (`All` + one chip per life goal). Screen copy: "Check the branches that are active this week, one focus sentence each. Unchecked branches go dormant." (`PlanScreen.tsx`.)
- **R-plan-4** — A leaf's checkbox is pre-checked iff it is currently active; its textarea is pre-filled with the current focus. Placeholder: `This week's focus — one sentence`. (`store.planChecked` / `planDraft`.)
- **R-plan-5** — Checking a leaf activates it **only if a non-empty focus sentence is supplied**; checked-with-blank-sentence saves as no focus (dormant). The client must surface this rather than silently dropping the check. (`store.savePlan`: `checked && draft.trim() ? draft.trim() : ''`; §5 D-9.)
- **R-plan-6** — Unchecking a leaf clears its focus for the week → the leaf becomes dormant. Its existing open tasks are **not** deleted (R-task-9).
- **R-plan-7** — Save-plan is a whole-week replace over all non-Life leaves in one transaction: leaves checked with text get/keep a focus; every other non-Life leaf's current-week focus is removed. (`store.savePlan` maps all leaves.)
- **R-plan-8** — Non-leaf and Life goals are never touched by save-plan and can never hold a focus.
- **R-plan-9 (pull-based planning)** — Under each checked leaf, a `FROM THE BACKLOG` list shows every backlog item whose `goalId` is the leaf itself or any of its ancestors (excluding the Life root, which cannot hold items). Tapping one opens the task-create modal pre-filled with the item's title and bound to that leaf. (`PlanScreen.tsx` `chainIds = [l.id, ...ancestors]`.)
- **R-plan-10** — The backlog list is hidden for unchecked leaves and when the pool is empty.
- **R-plan-11** — Saving the plan shows the toast `Plan saved`.
- **R-plan-12** — Draft check-state and draft sentences are client-local until Save; leaving the screen without saving discards them.

### Task

- **R-task-1** — A task lives under an active non-Life leaf's weekly focus, referenced by `goalId`. (BUSINESS-RULES §Task bullet 1.)
- **R-task-2 (creation sources — four)** — (a) `+ Task` on the Tasks screen or a goal's focus block, (b) a Backlog pull, (c) an Idea's "Task this week", (d) the `+` drawer with "Also add to the current week". (BUSINESS-RULES §Task bullet 1; `store.openTaskCreate` / `saveBacklogDrawer`.)
- **R-task-3** — Fields: `title` required; `cond` (done-condition) **optional**; `desc` and `links` optional. The create modal's hint reads "Done-condition (optional) / How will you know it's done?". (`TaskCreateModal`.)
- **R-task-4** — The create modal's target selector lists **only currently active leaves**, labelled `<Life root title> — <focus sentence>`. Creating a task is impossible when no leaf is active. (`TaskCreateModal` `options = s.activeLeaves()`; §5 D-10.)
- **R-task-5** — `originWeek` is always the **current** week at creation time, regardless of which week is being viewed. It is server-assigned and immutable thereafter. (`store.saveNewTask` `originWeek: 0`.)
- **R-task-6** — Tasks can only be created into the current week; there is no back-dating. The `+ Task` affordance is rendered only when the viewed week is 0 and the leaf is active. (`TasksScreen.tsx`.)
- **R-task-7 (visibility, open)** — An **open** task is visible in every viewed week `w` with `w ≥ originWeek`. It carries forward automatically with no prompt, wizard, or confirmation. (`store.visibleIn`: `t.originWeek <= w`.)
- **R-task-8 (visibility, done)** — A **done** task is visible **only** in `doneWeek` — not in earlier weeks it was open in, not in later weeks. (`store.visibleIn`: `t.doneWeek === w`.)
- **R-task-9** — Task visibility does not depend on whether the owning leaf is currently active; a dormant leaf's open tasks remain visible and interactive in the weeks they belong to. Dormancy suppresses the *empty* section and the `+ Task` affordance, not existing work. (§5 D-11.)
- **R-task-10 (carry label, 1 week)** — In the viewed week, `age = w − originWeek`. At `age === 1` an open task shows a gray label `since Mon 24 Aug` (the Monday of `originWeek`). (`TaskRow.tsx`, `ui.ts:carryLabel('gray')`.)
- **R-task-11 (carry label, 2+ weeks)** — At `age ≥ 2` an open task shows a **red chip** `N weeks · since 10 Aug`, where `N = age`. This is the only escalation in the product: no popups, no nags, no flags. (`TaskRow.tsx` `sev = age >= 2 ? 'chip' : 'gray'`.)
- **R-task-12** — At `age === 0`, and for any done task, no carry label is shown. (`showCarry = !t.done && age >= 1`.)
- **R-task-13 (exits — exactly three)** — A task leaves a week in exactly one of three ways: **Complete**, **Move to Backlog**, **Cancel**. There is no fourth exit and no "defer", "snooze", or "reschedule". (BUSINESS-RULES §Task Exits.)
- **R-task-14 (exit: complete)** — The checkbox completes a task in **any** viewed week, including past weeks; past weeks stay fully interactive. Completing sets `doneWeek = the viewed week`, `doneAt = now`, logs `Completed`. (`store.toggleTask`; §5 D-4 on the label.)
- **R-task-15 (exit: move to backlog)** — Moves the task out of the week into the **owning goal's** backlog as a new BacklogItem carrying over `title`, `desc`, `links` and `fromWeek = the week it was live in`, then removes the task from the week. Confirm sheet takes an **optional** reason. Toast: `Moved to Backlog` (`— reason noted` appended when a reason was given). (`store.confirmAction` moveTask; §5 D-12 on `fromWeek`.)
- **R-task-16 (exit: cancel)** — Drops the task. Confirm sheet takes an **optional** reason. Toast: `Task canceled`.
- **R-task-17** — Move and Cancel are offered only on **open** tasks; the detail sheet hides both once the task is done. (`TaskDetailSheet` `{!dt.done && ...}`.)
- **R-task-18** — Neither Move nor Cancel may require any field. The confirm sheet states "No mandatory fields. Fast and guilt-free."
- **R-task-19 (uncheck)** — Unchecking a completed task, in any week, sets `doneWeek = null`, `doneAt = null`, `done = false`, keeps `originWeek` unchanged, and logs `Unchecked`. The task is immediately open again and therefore carries into the current week under its **original** origin — with the carry label its original age earns (R-task-10/11). (BUSINESS-RULES §Task bullet on Unchecking; `store.toggleTask` else-branch.)
- **R-task-20** — Unchecking does **not** re-parent the task, does not touch the owning goal, and does not require the owning leaf to be active.
- **R-task-21 (uncheck follow-up)** — After an uncheck, an inline, **skippable** prompt `Update the done-condition?` appears under the row, pre-filled with the current condition, with `Save` and `Skip`. Skipping is a no-op; saving an unchanged or blank value is also a no-op. Saving a changed value logs `Done-condition edited`. (`TaskRow.tsx`, `store.saveUncheck`.)
- **R-task-22** — The task detail sheet shows the goal path, the done date when done, editable `title` / `cond` / `desc`, the links list with add and remove, the exits when open, and the read-only activity timeline.
- **R-task-23** — The `Save changes` button in the detail sheet appears only when a field is dirty; saving shows toast `Task updated`. A blank title falls back to the existing title and logs nothing. (`TaskDetailSheet` `dirty`; `store.saveTaskDetail`.)
- **R-task-24** — Adding a link appends `{url}` and logs `Link added: <host>`, where host is the URL's hostname minus a leading `www.`, falling back to the raw string truncated to 28 chars + `…` when unparseable. (`utils/tree.ts:hostOf`.)
- **R-task-25** — Removing a link removes it by index and logs `Link removed: <host>`. (`store.removeTaskLink`; event added by §5 D-13.)
- **R-task-26** — Done tasks remain editable (title, condition, description, links); only the exits are withdrawn.
- **R-task-27 (truncation in events)** — Values interpolated into event text are truncated: empty → `(none)`; longer than 24 chars → first 24 chars + `…`. (`utils/tree.ts:trunc`.)
- **R-task-28** — Task rows render title, `Done when: <cond>` when a condition exists, `Done <date>` when done (with the title struck through and muted), and the carry label when applicable.
- **R-task-29 (auto-carry log)** — When an open task first becomes visible in a week later than its origin, a `Carried to week of <Mon d Mon>` entry is logged once per week crossed. This is automatic; the user is never prompted. (BUSINESS-RULES §Task Activity; mock data `t3`; §5 D-14 — no code produces it.)
- **R-task-30 (activity timeline — the complete set)** — The timeline is read-only, newest first, and can contain exactly these entries:

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

### Backlog

- **R-backlog-1** — A backlog item is deferred future work attached to a single Yearly, Quarterly, or Monthly goal.
- **R-backlog-2 (never Life, never a week)** — A backlog item may **never** be attached to a Life goal and never to a week. Every goal picker in the backlog flows lists `nonLife()` only. (BUSINESS-RULES §Backlog bullet 1; `BacklogDrawer`, `BacklogScreen` move chips, `IdeasScreen` attach chips.)
- **R-backlog-3** — A backlog item has no checkbox, no done-condition, no due date, and no status, and must be rendered visibly differently from a task.
- **R-backlog-4 (creation sources — four)** — (a) the global `+` drawer (goal defaults to the last used), (b) a goal detail `+ Add`, (c) a task moved out of a week (R-task-15), (d) an Idea attached to a goal (R-idea-5).
- **R-backlog-5** — Items are ordered newest first within their group, by `capturedAt` descending, `id` descending as tie-break. (BUSINESS-RULES §Backlog bullet 5; §5 D-17.)
- **R-backlog-6 (conversion — the only way backlog becomes work)** — `Add to this week` opens the standard task-create modal pre-filled with the item's title, description and links. **On save the item is converted: the backlog item is deleted and a task is created in one atomic operation.** It is never duplicated, never left behind, never copied. The task logs `Created — pulled from Backlog`. (BUSINESS-RULES §Backlog bullet 4; `store.saveNewTask`.)
- **R-backlog-7** — Conversion is target-bound: the created task's `goalId` is the **active leaf at or under the item's goal**. From the planning screen it is the leaf whose card the item was tapped under; from the backlog screens it is resolved by lookup. When more than one active leaf qualifies, the user must choose — the client must not pick silently. (`store.pullToWeek` → `activeLeafFor`; §5 D-18.)
- **R-backlog-8 (inactive-branch prompt)** — If no leaf at or under the item's goal has a focus this week, conversion is refused and a sheet appears: title `This branch isn't active this week`, body `"<item title>" can only become a task under an active weekly focus.`, actions `[Set a weekly focus]` (navigates to weekly planning) and `[Cancel]` (dismisses; the item is untouched). (`store.pullToWeek` else-branch; `InactiveBranchSheet`.)
- **R-backlog-9** — Converting an item that no longer exists (already converted, deleted, or moved) is refused; no task is created. (§5 D-19.)
- **R-backlog-10 (other actions)** — Besides conversion: `Move to another goal` (target = any non-Life goal, toast `Moved to <goal title>`) and `Delete`. There is no edit-in-place and no archive.
- **R-backlog-11 (goal detail, non-Life)** — A non-Life goal's detail screen shows `Backlog (N)` listing only the items attached to **that** goal, an inline `+ Add` quick-capture (Enter or `Save item` commits; `Never mind` cancels), and per-item `Add to this week` / `Move to another goal` / `Delete`. Empty state: `Nothing deferred on this goal.` (`GoalDetailScreen.tsx`; move action added by §5 D-20.)
- **R-backlog-12 (goal detail, Life — read-only aggregate)** — A **Life** goal's detail screen shows `Backlog across this line (N)`: a **read-only** roll-up of every item on any descendant goal, each row labelled `<owning goal title> · added <date>`. No per-item actions here — only `Open Backlog →`. (BUSINESS-RULES §Backlog bullet 5; `GoalDetailScreen.tsx` `isLife` branch.)
- **R-backlog-13 (full backlog page)** — The Backlog page groups items by branch path `<Life goal> › <owning goal>`, newest first, showing title, `Added <date>`, description, `N link[s]`, and `from <week of …>` when the item came out of a week. Tapping a row reveals its actions. Empty state: `Nothing in the backlog.` / `Future work lives here until you pull it into a week.` (`BacklogScreen.tsx`.)
- **R-backlog-14 (`+` drawer)** — The `+` tab opens `Add to Backlog`: goal chips (non-Life, defaulting to the last-used goal), title (required), description, links, and a checkbox `Also add to the current week`, plus a `View Backlog →` shortcut. (BUSINESS-RULES §Nav; `BacklogDrawer`.)
- **R-backlog-15 (`+` drawer with "also add to the current week")** — When the box is ticked and a leaf at or under the chosen goal is active, a **task only** is created (no backlog item) with `Created — added to this week`; toast `Added to this week`. When the box is ticked but no leaf is active, a backlog item is created instead and the toast explains: `Branch isn't active this week — parked in Backlog`. When the box is unticked, a backlog item is created; toast `Added to Backlog`. (`store.saveBacklogDrawer`; copy corrected by §5 D-21.)
- **R-backlog-16** — `title` is trimmed; a whitespace-only title is refused and the Save button stays disabled.

### Idea

- **R-idea-1** — An idea is a two-second capture of a distracting thought: text only, no fields to fill.
- **R-idea-2** — The optional tag is a **Life goal** or nothing; the chip row is `No goal` + one chip per life goal. Untagged ideas group under `Unsorted`. (`GoalChipRow`; `CaptureScreens.groupByGoal`.)
- **R-idea-3** — The list is read-only apart from tap actions; the only three are `Task this week`, `Attach to a goal`, `Delete`.
- **R-idea-4 (task this week)** — Opens the task-create modal pre-filled with the idea's text, target = an active leaf. The idea is deleted **only when the task is actually saved**; abandoning the modal leaves the idea in place. The created task logs `Created — from an Idea`. (§5 D-22.)
- **R-idea-5 (attach to a goal)** — Attaching sends the idea's text to the chosen **non-Life** goal's backlog as a new BacklogItem and removes the idea. Prompt copy: `SEND TO WHICH GOAL'S BACKLOG?`; toast `Moved to Backlog under <goal title>`. (`store.ideaToBacklog`.)
- **R-idea-6** — `Delete` removes the idea with no confirmation.
- **R-idea-7** — Ideas are grouped by Life goal then `Unsorted`, newest first. An idea whose tagged goal no longer exists falls into `Unsorted`. (`groupByGoal` `!s.node(x.goalId)` branch.)
- **R-idea-8** — Empty state: `Nothing parked.` / `When an idea grabs you mid-task, drop it here and get back to work.` Capture button label: `Park it`; Enter in the field also commits.

### Learning

- **R-learning-1** — A learning is a short insight that might change the plan. It is not a journal entry and not a task; it has no actions beyond re-tagging and discarding.
- **R-learning-2** — Optional **Life-goal** tag, same chip row as ideas, same `Unsorted` grouping, newest first.
- **R-learning-3** — Tap actions are exactly two: `Attach to a goal` (re-tag to another life goal or back to `No goal`) and `Discard`.
- **R-learning-4** — `applied` renders a `changed the plan` badge. It is set explicitly by the user; the client needs an affordance for it. (BUSINESS-RULES §Learning bullet 3; §5 D-23 — the mockup has none.)
- **R-learning-5** — A goal's detail screen lists the learnings tagged to that goal's **Life root** (the whole line, not just the goal), plus `See all learnings →`. Empty state: `No learnings attached to this branch yet.` (`GoalDetailScreen.tsx`.)
- **R-learning-6** — Discarding removes the learning; there is no archive.
- **R-learning-7** — Empty state: `No learnings yet.` / `When reality surprises you, write it down — future-you will use it.` Capture button label: `Capture it`.

### Navigation & system

- **R-nav-1** — Five tabs, fixed bottom: `Tasks · Goals · + · Ideas · Learnings`. The `+` is a circular button that opens the Add-to-Backlog drawer, not a page. (BUSINESS-RULES §Nav bullet 1; `TabBar.tsx`.)
- **R-nav-2** — The Goals tab stays highlighted while on a goal detail screen. The Backlog page has no tab; it is reached from the `+` drawer (`View Backlog →`) or a Life goal's detail screen (`Open Backlog →`).
- **R-nav-3** — The Tasks header carries a week switcher: `‹` / `Week of <Mon d Mon>` (tap to open the picker) / `›`. The forward chevron is disabled at week 0; future weeks are never selectable. (`TasksScreen.tsx`.)
- **R-nav-4** — The week picker offers the current week and the previous N weeks as chips (`This week`, then `Week of …`); the chevrons address the same range. The bound is a single number — the mockup's picker (6) and chevron clamp (9) disagree; see §5 D-24. Recommended bound: the last 8 weeks.
- **R-nav-5** — Past weeks show the badge `Past week — still editable` and remain fully interactive.
- **R-nav-6** — Changing the week via the picker resets the goal filter to `All`.
- **R-nav-7** — The Tasks screen shows goal filter pills: `All` plus one pill per Life root that has a visible section, each with its count of **open** tasks visible in the viewed week.
- **R-nav-8** — A leaf gets a section on the Tasks screen when it has ≥1 visible task in the viewed week, or (week 0 only) it is active. Sections show the full goal path, the focus sentence (week 0 only), the task rows, and `+ Task` (week 0, active leaf only). (`TasksScreen.tsx`.)
- **R-nav-9** — Tasks empty states: week 0 → `A new week, still unplanned.` / `Pick which branches are active this week, then write each focus.` / `[Plan this week]`; past week → `Nothing happened this week.` / `No tasks were live in this week.` with no CTA.
- **R-nav-10** — `Edit plan` appears in the Tasks header only at week 0 (R-plan-2).
- **R-nav-11** — Every page carries the same top-right cluster: a light/dark theme toggle plus at most one primary action (`+ New goal` on Goals, `+ Add` on Backlog, `Edit plan` on Tasks, none on Ideas/Learnings/Plan/Goal detail). (BUSINESS-RULES §Nav bullet 3; `TopActions.tsx`.)
- **R-nav-12** — The theme preference is per-user and persisted across sessions; it must be a real light/dark token set, not a display filter. (§5 D-25.)
- **R-nav-13** — Toasts are transient confirmations, auto-dismissing after ~2.6s; they are never the only record of a state change.
- **R-nav-14 (removed by design)** — There is no weekly review wizard, no push flow with mandatory reasons, no audit-trail view, no week report, and no carry-count flag. Any such feature is out of scope and must be refused, not deferred. (BUSINESS-RULES §Nav last bullet.)
- **R-nav-15** — Every destructive or state-changing confirm sheet closes on overlay tap without acting.

### Auth

- **R-auth-1** — The product is single-user-per-account: one person's cascade. There is no sharing, no delegation, no multi-tenant goal tree, and no collaborator role. (The mockup has no auth surface at all; this is the recommended baseline — see §4 Q-1.)
- **R-auth-2 (ownership scoping)** — Every Goal, WeeklyFocus, Task, TaskEvent, BacklogItem, Idea, and Learning belongs to exactly one owner. Every read is scoped to the caller's owner id; every write asserts ownership of the target **and** of every referenced entity (e.g. a task's `goalId`, a backlog item's move target).
- **R-auth-3** — A reference to another owner's entity is indistinguishable from a non-existent one: refuse identically, leaking nothing about existence.
- **R-auth-4** — An unauthenticated request is refused for every operation, including reads. There is no public or demo mode.
- **R-auth-5** — "The current week" is computed from the owner's timezone, stored on the account, not from the client clock — otherwise `originWeek`, carry ages, and plan editability differ per device. (§4 Q-9.)
- **R-auth-6** — The seed data in `apps/web/src/data/mock.ts` (`g1`…`g15`, `t1`…`t7`, `b1`…`b5`) is fixture data only. No production default tree, no hardcoded ids (`g3`, `g4`) may survive into the real client. (§5 D-26.)

---

## 3. Testable scenarios

### Goal — create

- **S-goal-5-1** (R-goal-5, happy) — *Given* a Quarterly goal `Q`. *When* the user adds a sub-goal under `Q`. *Then* the horizon picker offers only `Monthly`, the horizon defaults to `Monthly`, the period defaults to the current month, and the created goal has `parentId = Q`.
- **S-goal-5-2** (R-goal-5, unhappy) — *Given* a Yearly goal `Y`. *When* a create is submitted with `parentId = Y` and `horizon = 'Yearly'`. *Then* it is refused for equal rank and no goal is created.
- **S-goal-5-3** (R-goal-5, unhappy) — *When* a create is submitted with `parentId` = a Monthly goal and `horizon = 'Quarterly'` (parent rank > child rank). *Then* it is refused and no goal is created.
- **S-goal-6-1** (R-goal-6, unhappy — sub-goal under a Monthly goal) — *Given* a Monthly goal `M`. *Then* no `+ Sub-goal` affordance is rendered on `M`'s row or detail screen; *and when* a create with `parentId = M` is submitted directly (any horizon), it is refused with "Monthly goals cannot have sub-goals" and `M` still has zero children.
- **S-goal-4-1** (R-goal-4, unhappy) — *When* a non-Life goal is created with no `parentId`. *Then* it is refused; the Create button is disabled in the client.
- **S-goal-3-1** (R-goal-3, happy) — *When* a Life goal is created. *Then* `parentId = null`, `period = ''`, and the period field is not offered.
- **S-goal-29-1** (R-goal-29, unhappy) — *When* a goal is created with title `"   "`. *Then* it is refused as a validation error; no goal is created.
- **S-goal-13-1** (R-goal-13, happy) — *Given* today is 2026-08-31. *When* the horizon `Quarterly` is chosen. *Then* the period pre-fills `Q3 2026` (the quarter containing today), not a hardcoded literal.

### Goal — edit

- **S-goal-14-1** (R-goal-14, happy) — *When* a goal's title, why, period and pulse are edited. *Then* all four persist and `horizon` and `parentId` are unchanged.
- **S-goal-14-2** (R-goal-14, unhappy) — *When* an edit payload includes a different `horizon` or `parentId`. *Then* those keys are refused (or ignored) and the stored horizon/parent are unchanged; re-parenting must go through Move.

### Goal — move

- **S-goal-18-1** (R-goal-18, unhappy — into a descendant) — *Given* Life `L` › Yearly `Y` › Quarterly `Q` › Monthly `M`. *When* the user opens Move on `Y`. *Then* `Q` and `M` are listed disabled with the reason `its own descendant`, and `Y` itself is disabled with the same reason. *And when* a move of `Y` under `Q` is submitted directly. *Then* it is refused and no cycle is created.
- **S-goal-18-2** (R-goal-18, unhappy — into a shorter horizon) — *Given* Quarterly `Q` and Monthly `M` in an unrelated branch. *When* the user opens Move on `Q`. *Then* `M` is listed disabled with the reason `horizon conflict` (not `its own descendant`). *And when* a move of `Q` under `M` is submitted directly. *Then* it is refused.
- **S-goal-19-1** (R-goal-19, ordering of reasons) — *Given* a goal `Q` (Quarterly) with a Monthly child `M`. *When* Move is opened on `Q`. *Then* `M` shows exactly one reason, `its own descendant` — the descendant check wins over the horizon check.
- **S-goal-17-1** (R-goal-17, happy) — *Given* Quarterly `Q` with a Monthly child under Yearly `Y1`, and another Yearly `Y2`. *When* `Q` is moved under `Y2`. *Then* `Q.parentId = Y2`, `Q.horizon` is still Quarterly, its Monthly child still hangs off `Q`, and the whole subtree still satisfies R-goal-7.
- **S-goal-20-1** (R-goal-20, happy) — *When* a valid target is selected in the Move sheet. *Then* the preview reads `<goal> will move under <Life › … › target>` and the confirm button becomes enabled; with no target selected the button is disabled.
- **S-goal-28-1** (R-goal-28, unhappy) — *Given* an **active** leaf `A` with a focus and two open tasks. *When* a sub-goal is created under `A` (or a goal is moved under `A`). *Then* `A` is no longer a leaf, `A`'s current-week focus is deleted, and no task or focus is left referencing a non-leaf goal (per D-8's re-parent-or-refuse decision).
- **S-goal-21-1** (R-goal-21, unhappy) — *When* a Move or Re-plan is attempted on a Life goal. *Then* the affordances are absent and a direct request is refused.

### Goal — re-plan, dormancy, aggregates

- **S-goal-22-1** (R-goal-22, happy) — *When* a Monthly goal is re-planned to the next month with no reason. *Then* `period` becomes the chosen month, the operation succeeds, and the toast reads `Re-planned to <period>`.
- **S-goal-23-1** (R-goal-23, happy) — *Given* today is in September 2026 and a Monthly goal. *When* the re-plan sheet opens. *Then* the options are `Oct 2026` and `Nov 2026`, derived from today — and given today is in December 2026, they are `Jan 2027` and `Feb 2027`.
- **S-goal-9-1** (R-goal-9, unhappy) — *Given* a non-leaf goal that has a focus row from before it gained a child. *Then* it is reported as not active and holds no focus (the stale row must not exist — D-2).
- **S-goal-10-1** (R-goal-10, happy) — *Given* a non-Life leaf with no focus this week. *Then* its tree row is muted and reads `DORMANT — no focus this week`, and its detail screen shows the DORMANT block.
- **S-goal-11-1** (R-goal-11, happy) — *Given* Life `L` › Yearly `Y` › Quarterly `Q` › Monthly `M`, with `M` active. *Then* `L`, `Y` and `Q` all render un-muted. *When* `M`'s focus is cleared. *Then* all four render muted.
- **S-goal-11-2** (R-goal-11, happy) — *Given* Yearly `Y` with two Quarterly children, one holding an active leaf and one entirely dormant. *Then* `Y` is un-muted and the dormant Quarterly is muted.
- **S-goal-24-1** (R-goal-24, happy) — *Given* under Life `L`: one open task with origin 3 weeks ago and one with origin 1 week ago. *Then* `L`'s card reads `2 tasks carrying · oldest 3 weeks`.
- **S-goal-24-2** (R-goal-24, happy) — *Given* every task under `L` is either done or originated this week. *Then* no carrying line is rendered on `L`.
- **S-goal-24-3** (R-goal-24, copy) — *Given* exactly one carrying task, one week old. *Then* the line reads `1 task carrying · oldest 1 week` (singular both times).

### Plan

- **S-plan-5-1** (R-plan-5, happy) — *Given* a dormant leaf. *When* it is checked, a sentence is typed, and the plan is saved. *Then* the leaf is active, its focus is the trimmed sentence, and it appears on the Tasks screen for week 0.
- **S-plan-5-2** (R-plan-5, unhappy) — *When* a leaf is checked but the sentence is left blank and the plan is saved. *Then* no focus is stored, the leaf is dormant, and the user is told the check did not stick (not silently dropped).
- **S-plan-6-1** (R-plan-6, happy) — *Given* an active leaf with two open tasks. *When* it is unchecked and the plan saved. *Then* its focus is cleared, it renders dormant, and both tasks still exist and remain visible in week 0 (R-task-9).
- **S-plan-2-1** (R-plan-2, unhappy) — *Given* the viewed week is `-2`. *Then* `Edit plan` is not rendered; *and* a plan-save request naming a past week is refused.
- **S-plan-7-1** (R-plan-7, happy) — *Given* leaves `A` (active) and `B` (dormant). *When* the plan is saved with `A` unchecked and `B` checked with a sentence. *Then* in one transaction `A`'s focus is removed and `B`'s is created.
- **S-plan-9-1** (R-plan-9, happy) — *Given* a checked leaf `M` whose Quarterly parent holds backlog item `X` and whose Monthly self holds item `Y`, and an unrelated Yearly goal holds `Z`. *Then* `FROM THE BACKLOG` under `M` lists `X` and `Y` and not `Z`.
- **S-plan-9-2** (R-plan-9, happy) — *When* a listed backlog item is tapped. *Then* the task-create modal opens pre-filled with the item's title and bound to that leaf.
- **S-plan-8-1** (R-plan-8, unhappy) — *When* a plan-save payload includes a focus for a Life goal or a non-leaf goal. *Then* it is refused.

### Task — visibility and carry

- **S-task-7-1** (R-task-7, happy) — *Given* an open task with `originWeek = −2`. *Then* it is visible in weeks −2, −1 and 0, with no prompt or confirmation on any transition.
- **S-task-7-2** (R-task-7, unhappy) — *Given* an open task with `originWeek = 0`. *Then* it is **not** visible when week −1 is viewed.
- **S-task-8-1** (R-task-8, happy) — *Given* a task with `originWeek = −2` completed in week −1. *Then* it is visible only in week −1: absent from week −2 and from week 0.
- **S-task-10-1** (R-task-10, happy) — *Given* an open task with `originWeek = −1`, viewed in week 0. *Then* a gray label reads `since <Monday of originWeek>` with no chip styling.
- **S-task-11-1** (R-task-11, happy — carrying 2+ weeks) — *Given* an open task with `originWeek = −3`, viewed in week 0. *Then* a red chip reads `3 weeks · since <Monday of originWeek>`, and no popup, modal, or nag is shown.
- **S-task-11-2** (R-task-11, boundary) — *Given* an open task with `originWeek = −2`, viewed in week −1 (age 1). *Then* the gray one-week label is shown, not the red chip: the label depends on the **viewed** week, not on today.
- **S-task-12-1** (R-task-12, happy) — *Given* a task created this week, viewed in week 0. *Then* no carry label is rendered.
- **S-task-9-1** (R-task-9, happy) — *Given* a dormant leaf carrying one open task. *Then* the Tasks screen shows a section for that leaf containing the task, with no focus sentence and no `+ Task` button.

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

- **S-task-5-1** (R-task-5, happy) — *Given* the viewed week is `−2`. *When* a task is created (e.g. from an Idea). *Then* `originWeek` is the **current** week, so it does not appear in the viewed week −2 and does appear in week 0.
- **S-task-4-1** (R-task-4, unhappy) — *Given* no leaf is active this week. *When* the task-create modal is opened from any source. *Then* it offers no target, creation is blocked, and the user is routed to weekly planning — never to a hardcoded fallback goal.
- **S-task-3-1** (R-task-3, happy) — *When* a task is saved with a title and no done-condition. *Then* it is created with `cond = ''` and no validation error.
- **S-task-3-2** (R-task-3, unhappy) — *When* a task is saved with a whitespace-only title. *Then* it is refused and the Save button stays disabled.
- **S-task-23-1** (R-task-23, happy) — *When* title, condition and description are all changed and saved in one edit. *Then* exactly three events are logged (Renamed, Done-condition edited, Description updated), newest first, and the toast reads `Task updated`.
- **S-task-27-1** (R-task-27, happy) — *When* a done-condition is changed from `''` to a 40-character string. *Then* the event text reads `Done-condition edited: "(none)" → "<first 24 chars>…"`.
- **S-task-24-1** (R-task-24, happy) — *When* `https://www.github.com/acme/pr/1` is added as a link. *Then* the event reads `Link added: github.com`.
- **S-task-24-2** (R-task-24, unhappy) — *When* an unparseable string longer than 28 chars is added. *Then* the label falls back to the first 28 chars + `…` and the link is still stored (or refused per Q-11's chosen validation).
- **S-task-29-1** (R-task-29, happy) — *Given* an open task with `originWeek = −2`. *Then* its timeline contains exactly two `Carried to week of …` entries (for weeks −1 and 0), each logged once, with no user interaction at any point.
- **S-task-30-1** (R-task-30, unhappy) — *When* a client attempts to create, edit, or delete a TaskEvent. *Then* it is refused; the timeline is append-only and server-authored.
- **S-task-31-1** (R-task-31, happy) — *For* every operation in R-task-30's table, performing it produces exactly one event of the stated type with the stated glyph, and performing a no-op edit produces none.

### Backlog

- **S-backlog-2-1** (R-backlog-2, unhappy) — *When* a backlog item is created or moved with `goalId` = a Life goal. *Then* it is refused. *And* no goal picker in any backlog flow lists a Life goal.
- **S-backlog-6-1** (R-backlog-6, happy) — *Given* a backlog item `X` on Monthly goal `M`, which is active. *When* `Add to this week` is used and the task saved. *Then* one task exists under `M` with `X`'s title, description and links and a `Created — pulled from Backlog` event, **and** `X` no longer exists in the backlog — not on `M`, not anywhere.
- **S-backlog-6-2** (R-backlog-6, unhappy — converting a backlog item twice) — *Given* item `X` was converted in one session. *When* a second conversion of `X` is submitted (a stale open modal, a retried request, a second device). *Then* it is refused as already converted, **no second task is created**, and the first task is untouched.
- **S-backlog-6-3** (R-backlog-6, unhappy) — *When* the pre-filled task-create modal is abandoned without saving. *Then* the backlog item still exists and no task was created.
- **S-backlog-8-1** (R-backlog-8, unhappy — pull into a dormant branch) — *Given* item `X` on Quarterly goal `Q` and no leaf at or under `Q` has a focus this week. *When* `Add to this week` is tapped. *Then* no task-create modal opens; the sheet `This branch isn't active this week` appears with body `"<X title>" can only become a task under an active weekly focus.` and the two actions.
- **S-backlog-8-2** (R-backlog-8, happy) — *From* that sheet, `[Set a weekly focus]` navigates to weekly planning and `[Cancel]` dismisses; in both cases `X` is unchanged and no task exists.
- **S-backlog-8-3** (R-backlog-8, unhappy) — *When* a conversion is submitted directly against a goal with no active leaf under it. *Then* the server refuses it; the client-side prompt is not the only guard.
- **S-backlog-7-1** (R-backlog-7, happy) — *Given* item `X` on Quarterly `Q` with exactly one active leaf `M` beneath it. *When* `X` is converted. *Then* the created task's `goalId` is `M`.
- **S-backlog-7-2** (R-backlog-7, unhappy) — *Given* item `X` on Quarterly `Q` with **two** active leaves beneath it. *When* `X` is converted from the Backlog page. *Then* the user is asked which focus receives it; no silent pick is made.
- **S-backlog-9-1** (R-backlog-9, unhappy) — *When* a conversion names a backlog item that was deleted or moved. *Then* it is refused and no task is created.
- **S-backlog-10-1** (R-backlog-10, happy) — *When* an item is moved to another non-Life goal. *Then* its `goalId` updates, it re-groups under the new branch path, its `capturedAt` and `fromWeek` are unchanged, and the toast names the new goal.
- **S-backlog-12-1** (R-backlog-12, happy — read-only aggregate) — *Given* Life goal `L` with items on its Yearly, Quarterly and Monthly descendants. *When* `L`'s detail screen is opened. *Then* all of them are listed under `Backlog across this line (N)`, each labelled with its owning goal title and captured date, with **no** per-item action (no add-to-week, no move, no delete) — only `Open Backlog →`.
- **S-backlog-12-2** (R-backlog-12, unhappy) — *Given* `L` has no descendants holding items. *Then* the block reads `Nothing deferred anywhere on this line.`
- **S-backlog-11-1** (R-backlog-11, happy) — *Given* Monthly goal `M` holding two items. *Then* `M`'s detail screen shows `Backlog (2)` listing only `M`'s own items, with `+ Add` quick capture and per-item actions.
- **S-backlog-15-1** (R-backlog-15, happy) — *When* the `+` drawer is saved with `Also add to the current week` ticked and an active leaf under the chosen goal. *Then* exactly one entity exists: a task. No backlog item is created.
- **S-backlog-15-2** (R-backlog-15, unhappy) — *When* the same is saved but no leaf under the chosen goal is active. *Then* exactly one backlog item is created, no task, and the toast explains why.
- **S-backlog-5-1** (R-backlog-5, happy) — *Given* three items captured on different days. *Then* they list newest-first within their group, and a newly created item appears at the top.

### Idea

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

- **S-nav-3-1** (R-nav-3, unhappy) — *Given* the viewed week is 0. *Then* the forward chevron is disabled and no future week is reachable by chevron, picker, or direct request.
- **S-nav-4-1** (R-nav-4, happy) — *Then* the week picker and the back chevron reach the same earliest week; no week is reachable by one control and not the other.
- **S-nav-6-1** (R-nav-6, happy) — *Given* a goal filter is applied. *When* the week is changed via the picker. *Then* the filter resets to `All`.
- **S-nav-7-1** (R-nav-7, happy) — *Given* week 0 with two open and one done task under Life root `L`. *Then* `L`'s filter pill reads `<L title> · 2`.
- **S-nav-8-1** (R-nav-8, happy) — *Given* an active leaf with no tasks at week 0. *Then* a section renders with its focus sentence and a `+ Task` button. *And given* the same leaf viewed at week −1 with no tasks then. *Then* no section renders for it.
- **S-nav-9-1** (R-nav-9, happy) — *Given* nothing is planned at week 0. *Then* the empty state offers `Plan this week`; at a past week with no tasks, the empty state offers no CTA.
- **S-nav-14-1** (R-nav-14, unhappy) — *Then* no route, screen, or endpoint exists for a weekly review wizard, an audit trail view, a week report, or a push flow with mandatory reasons.

### Auth

- **S-auth-2-1** (R-auth-2, unhappy) — *When* user B requests, updates, or deletes any entity owned by user A. *Then* it is refused, indistinguishably from a non-existent id.
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

**Q-6 — Task deletion vs. exits.** Cancel and Move-to-Backlog delete the row in the mockup, which contradicts R-task-30's `Canceled` / `Moved to Backlog` events. `[recommended]` Tasks get a server-owned `status: 'open' | 'done' | 'canceled' | 'movedToBacklog'` with an `exitReason` and `exitedAt`. Exited tasks are excluded from every week view and every count, but the record and its timeline survive. See §5 D-15.

**Q-7 — Ordering and tie-breaks.** The mockup relies on array insertion order everywhere. `[recommended]` Goals: siblings ordered by `createdAt` ascending, `id` ascending as tie-break (add an explicit `sortKey` only if manual re-ordering is ever requested). Tasks within a section: open before done, then `createdAt` ascending, `id` ascending. Backlog items, Ideas, Learnings: `capturedAt` descending, `id` descending. Task events: `at` descending, then insertion sequence descending. Every list order must be total and stable, never dependent on storage order.

**Q-8 — Id generation.** `'t' + Date.now()` collides within a millisecond and is guessable. `[recommended]` Server-generated UUIDv7 (sortable, collision-free); clients never mint ids and any client-supplied id is ignored.

**Q-9 — Week boundaries and timezone.** `mondayOf()` uses the browser clock. `[recommended]` The account stores an IANA timezone; the server computes "current week" from it (R-auth-5). Weeks are stored as the ISO date of their Monday. DST is irrelevant to date-only arithmetic; do not store week offsets (see §5 D-1).

**Q-10 — What must be refused (validation floor).** `[recommended]` Refuse, with a machine-readable error code: goal create/move violating R-goal-5/6/7/17/18; any focus on a Life goal or non-leaf; a task whose `goalId` is not an active non-Life leaf at creation time; a task complete for a future week or a week before its origin; a backlog item on a Life goal; an idea or learning tagged to a non-Life goal; any write to a server-owned field; any reference to an entity the caller does not own. Refusals are validation errors, never silent no-ops (the mockup's `return` pattern).

**Q-11 — Field lengths.** `[recommended]` `Goal.title` 200, `Goal.why` 200, `Goal.period` 32; `WeeklyFocus.sentence` 280; `Task.title` 200, `Task.cond` 200, `Task.desc` 4000; `link.url` 2048 and must parse as `http`/`https` (refuse other schemes); `BacklogItem.title` 200, `.desc` 4000; `Idea.text` 500; `Learning.text` 500; exit reason 280. All strings trimmed before validation; graphemes counted, not bytes.

**Q-12 — Collection sizes.** `[recommended]` Max 4 levels of goal depth (structural, R-goal-7); max 100 children per goal; max 500 goals per owner; max 20 links per task and per backlog item; max 200 open tasks per leaf per week; max 2000 backlog items per owner; max 5000 ideas and 5000 learnings per owner; max 500 events per task (older ones compacted, never deleted from the visible top). Every list endpoint is paginated with a hard page cap of 200.

**Q-13 — History depth.** Nothing says how far back weeks are readable. `[recommended]` All history is retained; the week switcher exposes the last 8 weeks (R-nav-4) and an explicit `weekStart` may address anything back to the account's first week. Never expose a future week.

**Q-14 — Failure and rollback.** `persist()` is fire-and-forget with a `TODO: add error handling/rollback`. `[recommended]` Optimistic UI with rollback: on a failed write, revert the local change and surface a non-toast error (a toast alone is insufficient for a lost write, per R-nav-13). Reads on reconnect are authoritative.

**Q-15 — Offline / PWA.** It is a PWA with in-memory state only. `[recommended]` v1 is online-only with a read cache; queued offline mutations are out of scope. If added later, conversions and plan saves must remain server-arbitrated (Q-3, Q-4).

**Q-16 — Rate limits and abuse.** `[recommended]` Per-owner write budget (e.g. 600 writes/minute) sufficient for a human but not a runaway client retry loop; the auto-carry job (R-task-29) is server-scheduled and exempt.

**Q-17 — Where the carry log comes from.** `Carried to week of …` needs a producer. `[recommended]` A per-owner weekly rollover job at the Monday boundary in the account timezone, idempotent per `(taskId, weekStart)` so re-runs never duplicate; a lazy catch-up on first read of a new week covers accounts the job missed.

---

## 5. Mockup bugs and spec corrections

Each entry: what the mockup does → what the spec requires → why. The rule text in §2 already reflects the corrected behaviour.

**D-1 — Week offsets are stored as relative integers and decay over time.**
*Mockup:* `Task.originWeek` and `doneWeek` are integers relative to "this week" (`originWeek: -2`), and `visibleIn` compares them to the viewed offset. Every persisted row therefore means something different next Monday: a task stored with `originWeek = -2` silently becomes three weeks old with no write.
*Spec:* store absolute Monday dates (`originWeek`, `doneWeek`, `fromWeek`, `WeeklyFocus.weekStart`). Offsets are a presentation-layer projection computed against the current week (R-task-5, Q-9).
*Why:* a relative offset is only correct at the instant it is written. This is the single most damaging thing to inherit, because the mockup looks correct forever — its data is regenerated on every reload.

**D-2 — Weekly focus is a string on Goal, so it has no week dimension.**
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

**D-6 — `+ Sub-goal` under a Monthly goal produces an illegal goal if reached.**
*Mockup:* the affordance is hidden for Monthly, but `openGoalModal({parentId: monthlyId})` computes `minRank = 4` and clamps to `HORIZONS[Math.min(4,3)] = 'Monthly'`; every chip is then locked *except* the already-selected Monthly, so `saveGoal` happily creates a Monthly child of a Monthly parent.
*Spec:* R-goal-6 — refuse at the server; the client must not be able to open the modal in that state.
*Why:* the clamp turns an impossible state into a plausible-looking one instead of an error.

**D-7 — The move sheet filters the goal itself out instead of disabling it.**
*Mockup:* `targets = flatTree(...).filter(r => r.g.id !== mvNode.id)` — the goal silently vanishes from its own move list, while BUSINESS-RULES says invalid targets are "shown disabled with the reason". The current parent is also offered as a valid target (a no-op move).
*Spec:* R-goal-18/19 — show the goal itself disabled with `its own descendant`; the current parent may stay selectable but the move is a no-op that logs nothing.
*Why:* consistency of the disabled-with-reason affordance; a row that disappears reads as a bug to the user.

**D-8 — Giving a leaf a child orphans its focus and hides its tasks.**
*Mockup:* nothing runs when a goal gains a child. The ex-leaf keeps its `focus` string (inert, because `isActive` requires `isLeaf` — but it silently reactivates if the child is ever moved away), and its tasks keep pointing at it. `TasksScreen`'s `sectionGoals` requires `isLeaf`, so those tasks vanish from every week with no message, while `savePlan` never clears the stale focus because it only maps over leaves.
*Spec:* R-goal-28 — on the transition leaf → non-leaf, delete the current-week focus, and either refuse the operation while open tasks exist or re-parent them to the new child, in the same transaction. Recommended: **refuse** with `goal has open tasks; move or close them first`, because silently re-homing someone's work is worse than a clear error.
*Why:* silent data disappearance plus a latent resurrection of a focus nobody wrote.

**D-9 — Checking a leaf with a blank sentence silently drops the check.**
*Mockup:* `savePlan` writes `''` for a checked leaf with an empty draft and toasts `Plan saved`; the user believes the branch is active and finds it dormant.
*Spec:* R-plan-5 — the client blocks the save (or flags the row) and tells the user which checked branches lack a sentence.
*Why:* BUSINESS-RULES says "focus sentence required for it to stick"; that requirement needs feedback, not a silent discard.

**D-10 — Hardcoded mock goal ids in production paths.**
*Mockup:* `initialState.tmGoalId = 'g4'`, `blGoal = 'g3'`, `bdGoal = 'g3'`, and `IdeasScreen`'s "Task this week" falls back to `'g4'` when no leaf is active — literal seed ids from `data/mock.ts`.
*Spec:* R-auth-6, R-task-4 — no fallback goal exists; when no leaf is active, creation is blocked and the user is routed to planning. Last-used-goal defaults resolve to a real id or to "none".
*Why:* against any real account these ids belong to nothing (or, worse, to something else).

**D-11 — "Dormant … never on the Tasks screen" vs. dormant leaves carrying open tasks.**
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

**D-18 — `pullToWeek` resolves the target leaf arbitrarily.**
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

**D-21 — "Also add to the current week" does not *also* do anything.**
*Mockup:* with the box ticked and a leaf active, `saveBacklogDrawer` creates a task and **no** backlog item; with no leaf active it creates a backlog item and no task. Either way exactly one entity is created, never both.
*Spec:* R-backlog-15 keeps the single-entity behaviour (it matches conversion semantics: work lives in one place) and corrects the copy to `Add to this week instead`.
*Why:* the label promises two records; shipping "also" while creating one would be a data bug reported by the first user who looked in the backlog for it.

**D-22 — "Task this week" deletes the idea before the task is saved.**
*Mockup:* `IdeasScreen` removes the idea from `parking` and *then* opens the create modal. Dismissing the modal loses the idea permanently, with no undo — in the one feature whose whole promise is "capture it and get back to work".
*Spec:* R-idea-4 — the idea is consumed only on successful task creation, in the same transaction.
*Why:* unrecoverable data loss on a cancel.

**D-23 — `Learning.applied` can never be set.**
*Mockup:* the field exists and renders the `changed the plan` badge, but no UI writes it; only the seed data has `applied: true`.
*Spec:* R-learning-4 — an explicit user action toggles it.
*Why:* a badge nobody can earn is a dead field; BUSINESS-RULES names it as a real product signal.

**D-24 — The two week controls disagree on how far back you can go.**
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
