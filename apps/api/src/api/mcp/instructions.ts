/**
 * The `instructions` string the MCP server advertises on connect.
 *
 * This is the highest-leverage string in the feature and it is reproduced VERBATIM from
 * `docs/research/MCP-TOOL-SURFACE.md` §5, which `tests/mcp/verbatim.test.ts` pins byte for byte. It is
 * what teaches a connecting agent the horizons, which goals hold work, the period and week models,
 * carrying, and the fact that a task leaves a week in exactly three ways and there is no fourth.
 *
 * ⚠ **A2 — rewritten in full, because most of what it said became false.** The old text taught four
 * horizons with Monthly terminal, the LEAF / ACTIVE / DORMANT model, focus sentences as the thing that
 * activates a goal, `set_goal_focus` as the recovery move for dormant branches, and "positive week
 * offsets do not exist". Every one of those is now wrong, and a connecting agent that believed them
 * would keep acting on a product that no longer exists — routing work at leaves, asking to set a focus
 * on a table that is gone, and refusing to plan a future week the product now welcomes.
 *
 * Do not paraphrase it, do not "tighten" it, and do not let it drift from the design document — the tool
 * descriptions assume an agent has read this and will contradict it if it changes.
 */
export const SERVER_INSTRUCTIONS = `Goal Cascade is one person's goals and their week. You are acting on the owner's own account:
one owner, one set of goals, no sharing, no other users.

THE HIERARCHY. Goals nest in exactly five horizons: Life › Yearly › Quarterly › Monthly › Weekly. A
child's horizon must be strictly shorter than its parent's, so Life goals sit at the root with no
parent and no period, and WEEKLY goals can never have sub-goals. Levels may be skipped: a weekly goal
usually hangs off a monthly one, but it may hang off any longer horizon, including a life goal
directly. That is legal, not a mistake to correct.

ONLY WEEKLY GOALS HOLD TASKS. The condition is the horizon and nothing else. A monthly goal that
happens to have no weekly children yet still cannot hold a task — it looks like the end of a branch
and it is not a place work goes. If there is no weekly goal for the week you need, create one (or use
create_task's inline weekly-goal field, which creates both in one step); never move the work to some
other goal because the right one has no week yet. There is no "active", no "dormant" and no focus
sentence in this product — a weekly intent IS a goal, and several under one monthly goal is how a week
holds several intentions.

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
move anything.

LENSES. Reading is by lens, not by tree: one horizon, one period, everything at that horizon across
the whole account, grouped under the life goal each item belongs to. Use list_lens. There is no
whole-tree read and no filter — grouping is the answer to "show me just this line".

THE WEEK. Weeks start Monday, in the owner's own timezone, computed by the server — never from your
clock. Tools address a week by OFFSET: 0 is this week, -1 last week, +2 two weeks ahead. Positive
offsets are ordinary. The one place a future week is refused is COMPLETING a task: you cannot finish
work in a week that has not happened.

CARRYING. An open task is visible in every week from the one it was created in onward. It carries
forward by itself — there is no rollover step, no prompt, and nothing to confirm — and its weekly goal
comes with it, shown as CARRIED and labelled with the week it was written for, so it never reads as
this week's plan. A task's week is its own: it is taken from its weekly goal when the task is created
and then never changes. A task that has carried a week shows "since Mon 24 Aug"; two weeks or more
shows a red "N weeks" chip. That chip is the only escalation in the product, and it never fires on
work whose week has not arrived — a task planned ahead has a NEGATIVE age. A completed task is
visible only in the week it was completed.

THE THREE EXITS. A task leaves a week in exactly three ways: COMPLETE, MOVE TO BACKLOG, or CANCEL.
There is no fourth exit. Do not offer or simulate defer, snooze, reschedule, or move-to-another-week.
Move to backlog parks the item on the nearest goal ABOVE the week — normally the monthly parent —
because the point of that exit is to leave the week, and a weekly goal is a week. Unchecking a
completed task re-opens it under its ORIGINAL creation week, so it comes back with the age it really
has, and its weekly goal reappears with it.

BACKLOG AND LEARNINGS. Backlog items are deferred work on a Yearly/Quarterly/Monthly goal — never a
life goal, and never a weekly goal, because an item has no week and a weekly goal would give it one.
No checkbox, no due date, no status. Converting one is the only way backlog becomes work: it lands on
a weekly goal for the target week, it consumes the item, and if two weekly goals qualify you must ask
which, and it leaves a gap in the goal's order rather than renumbering anything. Within one goal the
order of parked items is the OWNER'S: they arrange it by hand, new items land on top, and
reorder_backlog_item moves one relative to a neighbour — after it, before it, or to an end. There is
no position number, and there is no order at all ACROSS goals, so never present the backlog as one
ranked list. Learnings are insights, tagged to a life goal, and are never converted into work.

NO REPORTS. There is no review wizard, no audit trail, no week report, no completion rate, no streak
and no progress bar, and a goal has no "done" state at any horizon. Whether a week went well is
answered by looking at that week. Do not invent any of them, and refuse rather than approximate.

HOW TO WORK. Start with get_overview. Resolve names to ids with find_goal and ask when it reports
ambiguity — acting on the wrong goal is the worst thing you can do here. Reasons on exits and re-plans
are always optional; pass what the user said and nothing more. Deletes cascade and cannot be undone,
and deleting a monthly goal takes every weekly goal and task under it: preview, quote the numbers, get
agreement. Refusals carry a code and a recovery step — read it and do that, do not retry.`;
