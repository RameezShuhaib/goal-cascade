# Goal Cascade — Business Rules

The rules of the final design, by entity. This is the contract the UI implements; the API enforces the same.

## Goal

- A goal is a tree node: `title` (required), optional one-line `why`, `horizon`, `pulse`, `periodKey` (the period it sits in), optional `parentId`, any number of children.
- Horizons: **Life → Yearly → Quarterly → Monthly → Weekly** (rank 0–4).
  - Life goals have no parent and no period.
  - A child's horizon must be **strictly shorter** than its parent's; nesting can never exceed Life › Yearly › Quarterly › Monthly › Weekly. Weekly goals cannot have sub-goals.
  - Levels may be skipped. A weekly goal usually hangs off a monthly one, but it may hang off any longer horizon — including a life goal directly.
- **Period**: every non-life goal sits in exactly one period of its own horizon — a year, a quarter, a month, or a week (its Monday). The period is what each lens filters on, so it is a canonical key, not free text; the label you see (`2026`, `Q3 2026`, `Sep 2026`, `Week of 7 Sep`) is rendered from it. A goal's period is never checked against its parent's: a week that straddles a month boundary is ordinary, not an error.
- **Only weekly goals hold tasks.** Not monthly, not quarterly — and not a monthly goal that happens to have no weekly children yet. The rule is the horizon, nothing else.
- **Create**: title required. There are two ways in, and both already know everything except the title.
  - **From a lens**: the heading names the horizon, so there is no horizon picker; the period is a read-only chip taken from the lens you are standing in, so creating a goal into a period you are not looking at is impossible. The only choice is the parent, and the picker offers legal parents only — goals with a longer horizon, in the enclosing period. When exactly one qualifies it is preselected.
  - **From a goal's own page**: every goal that can hold children — that is, everything but a weekly one — lists its sub-goals whether it has any or not, with a "+ Sub-goal" line under them. The parent is the goal you are standing on. The horizon is whatever is legally shorter, and where only one is (a monthly goal, which can only hold weeks) you are not asked; where several are, it starts at the next one down. The period follows the horizon — the current one, or the parent's first if the parent starts later. Type a title and press Enter. "More…" opens the full form with all of it carried across, including what you have typed so far.
- **Nothing is created into a past period, and nothing is moved into one.** Past periods stay readable exactly as they were: planning does not rewrite history. There is no limit in the other direction — you can set goals as far ahead as you like.
  - A past period is closed to new plan and to nothing else. You can still correct a title, complete a task that was live that week, or uncheck one.
- **Move (re-parent)**: valid targets have a longer horizon (lower rank) and are not the goal itself or one of its descendants — invalid targets are shown disabled with the reason ("horizon conflict" / "its own descendant"). Children move with the goal. A preview of the new path is shown before confirming.
- **Re-plan**: changes the target period to a contextual next period (Monthly → next months, Quarterly → next quarters, Yearly → next year) with an **optional** one-line reason. No mandatory fields. A **weekly goal is not re-plannable**: it *is* a week, and moving it would restate what a past week held. An intention that did not happen carries forward through its open tasks, or is written again for the new week.
- **Pulse**: one of On track / At risk / Rethink, per goal.
- A goal is never "done". There is no completion state, no progress bar and no `N of M` at any horizon. Whether the week went well is answered by looking at that week; `pulse` is the one self-reported signal.
- Quiet signal only: a life-goal card shows "N tasks carrying · oldest W weeks" when open carried tasks exist under it. There are no audit pages, review wizards, or reports.

## Lenses

- The tree is not how you navigate. There are **five lenses, one per horizon**, and each is a flat list of every goal at that horizon across the whole account — not a branch you walk into. The hierarchy still exists; it shows up as context on an item, not as a path.
- Every lens except Life is scoped to **one period**, with a chevron each way: Yearly by year, Quarterly by quarter, Monthly by month, Weekly by week. Life is simply all of them. The two chevrons are the whole period control — there is no picker; the label between them opens the Zoom sheet, which changes lens, not period. There is no cap in either direction. When a later period holds work, a dot sits on the forward chevron, so a goal set three months out is not invisible until you get there.
- **Grouping, not filtering.** Every lens groups its items under the life goal each one ultimately belongs to, however deep the chain. There are no filter pills. A life goal with nothing in the selected period still shows, with one muted line — a group that disappears reads as a goal that was deleted.
- The group header carries the **open-task count**: what is visible in the selected week in the Weekly lens, and in the current week everywhere else. Nothing else on a lens is a number.
- **A period is the whole weeks it holds, and the lens says so.** A week belongs to the month, quarter and year its **Monday** falls in, so `Sep 2026` is the four weeks beginning 7, 14, 21 and 28 September — not the 1st to the 30th. The title carries the span underneath it: `Sep 2026` over `Mon 7 Sep – Sun 4 Oct`, with the years spelled out when the two ends fall in different ones. The Zoom sheet shows the same span on every row, so you see what you would land in before you go. A week's own label already names its Monday and needs nothing added.
- **When this week is somewhere else, the lens says that too.** For the first few days of a month, a quarter or a year, the period you open on does not hold the week you are living in — on Tue 1 Sep the Monthly lens is on `Sep 2026` and this week began Mon 31 Aug, in August. That reads as a bug and is not one, so a quiet line says `This week is in Aug 2026` with one tap to go there. It replaces the past/future badge in the same row rather than adding one, and it never shows when the two agree.
- **Zooming** between lenses keeps where you are. Zoom out and you get the period containing the one you were in. Zoom in and you get the period containing **today** when the one you were in contains today — from Q3 in August you land in August, not July — and otherwise the first sub-period.
- A future period is badged with its own horizon and nothing more — `Future month — planning ahead`, `Future week — planning ahead`. A past one reads `Past week — still editable`. The current period is unbadged. Work that has not come due is never styled as late.
- Tabs: **Goals · + · Learnings**. The lens switcher is not a tab; it lives in the Goals header. The **+** opens the Add-to-Backlog drawer ("View Backlog →" inside reaches the full page).

## The weekly lens

- A weekly goal is an ordinary goal with `horizon = 'Weekly'`, written for one week. Several can sit under the same monthly goal in the same week — that is how a week holds more than one intention.
- A weekly goal shows up in a week's lens if it **belongs to that week**, or if it **still has open tasks carrying into it**. The second kind is shown separately, below the week's own goals, labelled with the week it was written for and oldest first, so it never reads as this week's plan.
- Nothing ages out of that carried list. A goal with work open for ten weeks appears for ten weeks, and the growing red chip on the task is the only thing that escalates. Hiding it would lose work quietly, which is the one thing carrying exists to prevent.
- Everything that used to be on the Tasks page happens here: the week switcher, completing, unchecking, the three exits, carry labels, backlog pulls.
- A weekly goal written well in advance shows a muted "planned N weeks ago" once its week arrives, from two weeks out. Nothing is asked of you when a planned week arrives — the plan is just the plan.
- **Repeat last week** copies the previous week's weekly goals for a life line into the selected week as ordinary new goals — same titles, no tasks, nothing linking them. There is no recurring-goal machinery behind it.

## Task

- Lives under a **weekly goal**. Created from: `+ Task` on a weekly goal, a Backlog pull, or the + drawer with "Add to this week instead". When no weekly goal exists yet for the week, the same sheet takes a one-line weekly-goal title and creates both at once — one step, not two.
- Fields: `title` (required), `cond` done-condition (**optional**), optional `desc` description and external `links`.
- **Week model**: `originWeek` is the week the task was created into, taken from its weekly goal and then fixed for good; `doneWeek` is the week it was completed in, or null. Weeks start **Monday**. The weekly goal says what the work is *for*; the task's own week says *when it was live*, and only the task's week decides where it shows up.
  - An **open** task is visible in every week ≥ its origin — it auto-carries into the current week with no prompt, no wizard and no move operation. Its goal comes with it.
  - A **done** task is visible only in the week it was completed, with a muted "Done Fri 28 Aug" date.
  - You can create work in a week that has not started yet; it is invisible until that week arrives and never carries a late label before then. A task can only be **completed** in a week that has already begun, and never in a past week it was created into.
- **Carry labels** (in the viewed week, age counted against today, so a plan never ages):
  - age 1 week → gray "since Mon 24 Aug"
  - age ≥ 2 weeks → red chip "N weeks · since 10 Aug" (the only escalation; no popups).
  - age 0 or below → nothing. Work planned for a future week has a negative age; it is early, not late.
- **Exits** (exactly three):
  1. **Complete** — checkbox, any week that has begun (past weeks stay fully interactive).
  2. **Move to Backlog** — the item goes to the backlog of the nearest goal **above** the week (normally the monthly parent), with a "from week of …" note, keeping description and links. It has to leave the week; that is the point of the exit.
  3. **Cancel** — task dropped.
  - Move and Cancel use a lightweight confirm with an **optional** reason. Fast and guilt-free; nothing mandatory.
- **Unchecking** a completed task (any week) logs "Unchecked" and offers a skippable inline "Update the done-condition?" edit; the task then carries into the current week with its original origin, and its weekly goal reappears alongside it.
- Tapping a task opens its **own page**, not a drawer — it is a linkable thing.
- **Activity**: a read-only, auto-logged timeline per task, newest first — Created (with source: added to a goal / Backlog pull / + drawer), Carried to week of …, Renamed (old → new, truncated), Done-condition edited (old → new, truncated), Description updated, Link added, Completed, Unchecked, Moved to Backlog / Canceled (with reason if given). Never requires user input.

## Backlog item

- Deferred future work attached to any **yearly/quarterly/monthly** goal — never a life goal, and never a weekly goal, because a backlog item has no week and a weekly goal would give it one.
- Fields: `title` + captured date; optional description and links. **No** checkbox, done-condition, due date, or status. Rendered clearly differently from tasks.
- Created from: the global **+** drawer (goal defaults to last used), a goal detail "+ Add", or a task moved out of a week.
- **The only way backlog becomes work**: "Add to this week" → opens the task-create sheet pre-filled; on save the item is **converted** (removed), never duplicated. It lands on a weekly goal for the target week: if two qualify you choose, and if none exists the sheet takes a weekly-goal title and makes one.
- A weekly goal's page lists the backlog items sitting on the goals above it, ready to pull in.
- Other actions: Move to another goal (any yearly/quarterly/monthly goal), Delete.
- Grouped by life goal › sub-goal (branch path). Within a goal the order is yours: newest first until you rearrange it, then whatever order you put it in. Reordering works by dragging and by keyboard alike. A life goal's detail screen shows a **read-only aggregate** of its descendants' items, each labeled with its goal.

## Learning

- A short insight that might change the plan; optional life-goal tag; not a journal, not a task.
- Tap actions: **Attach to a goal** (re-tag), **Discard**.
- A learning that changed the plan carries a "changed the plan" badge.

## Navigation & system

- Tabs: Goals · **+** (opens the Add-to-Backlog drawer) · Learnings. The lens switcher and the period control live in the Goals header.
- Lenses, goal pages, task pages, the Backlog page and Learnings are all real addresses — back, forward and a pasted link all work. Capture drawers and confirm sheets are not; nobody wants a URL for those.
- Every page: consistent top-right cluster — theme toggle (light/dark) + one primary action.
- Removed entirely: the goal tree as a navigation surface, the Tasks page, the weekly-planning page, the Ideas parking lot, goal-filter pills, weekly review wizards, push flows with mandatory reasons, audit-trail views, week reports, carry-count flags, and any completion rate, streak or period summary. The only numbers in the product are the open-task count on a group header, the carrying line on a life goal, the backlog count on a goal, and the carry chip on a task.
