# Goal Cascade — Business Rules

The rules of the final design, by entity. This is the contract the UI already implements; the API enforces the same.

## Goal

- A goal is a tree node: `title` (required), optional one-line `why`, `horizon`, `pulse`, `period` (target period), optional `parentId`, any number of children.
- Horizons: **Life → Yearly → Quarterly → Monthly** (rank 0–3).
  - Life goals have no parent and no target period.
  - A child's horizon must be **strictly shorter** than its parent's; nesting can never exceed Life › Yearly › Quarterly › Monthly. Monthly goals cannot have sub-goals.
- **Leaf** = a goal with no children. Only non-life leaves can hold a weekly focus. Goals never hold tasks directly.
- **Active** leaf = has a weekly focus this week. Otherwise the leaf (and any branch with no active leaf below it) is **dormant**: visible in the tree but muted, never on the Tasks screen. Dormant must look intentional, not broken.
- **Create**: title required. When created as a sub-goal, the horizon picker only allows ranks below the parent's; the parent picker only offers goals with a longer horizon. Target period defaults from the horizon.
- **Move (re-parent)**: valid targets have a longer horizon (lower rank) and are not the goal itself or one of its descendants — invalid targets are shown disabled with the reason ("horizon conflict" / "its own descendant"). Children move with the goal. A preview of the new path is shown before confirming.
- **Re-plan**: replaces the old "push" — changes the target period to a contextual next period (Monthly → next months, Quarterly → next quarters, Yearly → next year) with an **optional** one-line reason. No mandatory fields.
- **Pulse**: one of On track / At risk / Rethink, per goal.
- Quiet signal only: a life-goal card shows "N tasks carrying · oldest W weeks" when open carried tasks exist under it. There are no audit pages, review wizards, or reports.

## Weekly focus

- One sentence per leaf per week, written in **Weekly planning** (Edit plan — current week only).
- Checking a leaf activates it (focus sentence required for it to stick); unchecking clears the focus → dormant.
- Planning is **pull-based**: under each checked leaf, "From the backlog" lists items from that leaf's monthly goal and its ancestors; tapping one opens the task-create modal pre-filled.

## Task

- Lives under an active leaf's weekly focus. Created from: planning/+ Task, a Backlog pull, an Idea ("Task this week"), or the + drawer with "Also add to the current week".
- Fields: `title` (required), `cond` done-condition (**optional**), optional `desc` description and external `links`.
- **Week model**: `originWeek` (creation week offset), `doneWeek` (completion week or null). Weeks start **Monday**; offsets ≤ 0; future weeks not selectable.
  - An **open** task is visible in every week ≥ its origin — it auto-carries into the current week with no prompt or wizard.
  - A **done** task is visible only in the week it was completed, with a muted "Done Fri 28 Aug" date.
- **Carry labels** (in the viewed week, age = viewWeek − originWeek):
  - age 1 week → gray "since Mon 24 Aug"
  - age ≥ 2 weeks → red chip "N weeks · since 10 Aug" (the only escalation; no popups).
- **Exits** (exactly three):
  1. **Complete** — checkbox, any week (past weeks stay fully interactive).
  2. **Move to Backlog** — item goes to the parent goal's backlog with a "from week of …" note, keeping description/links.
  3. **Cancel** — task dropped.
  - Move and Cancel use a lightweight confirm with an **optional** reason. Fast and guilt-free; nothing mandatory.
- **Unchecking** a completed task (any week) logs "Unchecked" and offers a skippable inline "Update the done-condition?" edit; the task then carries into the current week with its original origin.
- **Activity**: a read-only, auto-logged timeline per task, newest first — Created (with source: planning / Backlog pull / Idea), Carried to week of …, Renamed (old → new, truncated), Done-condition edited (old → new, truncated), Description updated, Link added, Completed, Unchecked, Moved to Backlog / Canceled (with reason if given). Never requires user input.

## Backlog item

- Deferred future work attached to any **yearly/quarterly/monthly** goal (never Life, never a week).
- Fields: `title` + captured date; optional description and links. **No** checkbox, done-condition, due date, or status. Rendered clearly differently from tasks.
- Created from: the global **+** drawer (goal defaults to last used), a goal detail "+ Add", a task moved out of a week, or an Idea attached to a goal.
- **The only way backlog becomes work**: "Add to this week" → opens the standard task-create modal pre-filled; on save the item is **converted** (removed), never duplicated. If the item's branch has no active weekly focus: "This branch isn't active this week" → [Set a weekly focus] / [Cancel].
- Other actions: Move to another goal (any non-life goal), Delete.
- Grouped by life goal › sub-goal (branch path), newest first. A life goal's detail screen shows a **read-only aggregate** of its descendants' items, each labeled with its goal.

## Idea (parking lot)

- Two-second capture of a distracting thought; optional **life-goal** tag, default "No goal" (Unsorted).
- List is read-only apart from tap actions: **Task this week** (task-create pre-filled), **Attach to a goal** (→ that goal's backlog, with confirmation toast), **Delete**.
- Grouped by life goal / Unsorted, newest first.

## Learning

- A short insight that might change the plan; optional life-goal tag; not a journal, not a task.
- Tap actions: **Attach to a goal** (re-tag), **Discard**.
- A learning that changed the plan carries a "changed the plan" badge.

## Navigation & system

- Tabs: Tasks · Goals · **+** (opens the Add-to-Backlog drawer; "View Backlog →" inside reaches the full page) · Ideas · Learnings.
- Tasks header: week switcher (chevrons + week picker; current week default; past weeks labeled "still editable"), goal filter pills with open-task counts, Edit plan top-right (current week only).
- Every page: consistent top-right cluster — theme toggle (light/dark) + one primary action.
- Removed entirely: weekly review wizard, push flow with mandatory reasons, audit-trail views, week reports, carry-count flags.
