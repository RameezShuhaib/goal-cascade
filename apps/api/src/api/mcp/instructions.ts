/**
 * The `instructions` string the MCP server advertises on connect.
 *
 * This is the highest-leverage string in the feature and it is reproduced VERBATIM from
 * `docs/research/MCP-TOOL-SURFACE.md` §5, which `tests/mcp/verbatim.test.ts` pins byte for byte. It is
 * what teaches a connecting agent the horizons, which goals hold work, the period and week models,
 * carrying, and the fact that a task leaves a period in exactly three ways and there is no fourth.
 *
 * ⚠ **A2 — rewritten in full**, because most of what it said became false: four horizons with Monthly
 * terminal, the LEAF / ACTIVE / DORMANT model, focus sentences, and "positive week offsets do not exist".
 *
 * ⚠ **A8 — four paragraphs rewritten and three added, because a connecting agent that believed the old
 * text would now do real damage.** `ONLY WEEKLY GOALS HOLD TASKS` became `MONTHLY AND WEEKLY GOALS HOLD
 * TASKS` and says where the line falls and why (R-task-51); `CARRYING` gained the month scope and the
 * Monday rule (R-task-53); `THE THREE EXITS` gained the sentence that Park is not a fourth (R-task-56);
 * `NO REPORTS` gained the measure clause by name (R-measure-8). The three new paragraphs are
 * `A TASK'S PERIOD, AND ITS SCOPE`, `A MONTH TASK IS NEVER LATE IN A WEEK` and `MEASURES`.
 *
 * The month-band paragraph is the one that earns its length: an agent that reads "it has been three
 * weeks" off a month task's carry age and reports it as late has told the owner the opposite of the rule
 * the whole amendment exists to state (R-task-54, S-lens-31-2).
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
a code and a recovery step — read it and do that, do not retry.`;
