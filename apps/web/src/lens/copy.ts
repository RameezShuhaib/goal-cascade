import type { Horizon } from '@goal-cascade/shared';
import { PERIOD_UNIT } from '../utils/periodKeys';

/**
 * Every string the lens shell renders, in one place — UX-PLAN §7, verbatim.
 *
 * Sentence case, no exclamation marks, no second-person imperative where a statement will do. Two lines
 * are kept **word for word** from before the redesign because they were already the best writing in the
 * app: the Life lens's first-run state and the current/past week headlines (R-nav-9).
 *
 * **`Tasks live on weekly goals.`** — never "leaves hold tasks" (R-goal-37). Under the new tree a Monthly
 * goal with no children is structurally a leaf and holds no tasks anyway, so the word would mislead.
 */

/**
 * R-nav-25, amended — **the cluster row's one primary action, and it is the same string at every lens.**
 *
 * It was `+ ${lens} goal`, five labels for one act. The button no longer commits to a horizon — it
 * *defaults* to one, and a label that names a default as if it were a destination is a label that lies
 * (R-nav-32). It is also 46px instead of 96px, which is width the cluster row did not have.
 */
export const CREATE_LABEL = '+ Goal';

/** R-nav-32 — the create sheet's heading. One sheet, one name, at every horizon. */
export const NEW_GOAL_HEADING = 'New goal';

/**
 * R-nav-32 — the read-only period chip's reason, in its two forms.
 *
 * The first is kept verbatim from before: the horizon you are creating at IS the lens on screen, so the
 * period is simply the one you are looking at. The second fires when the horizon selector has been moved
 * away from the lens — the period was then re-clamped by R-lens-9, and the sentence says what it was
 * clamped *from* rather than leaving a period on screen that nobody chose.
 */
export const periodBecauseLens = (label: string): string => `Because you're looking at ${label}.`;
export const periodClosestTo = (label: string, lens: Horizon): string => `Closest to ${label}, the ${PERIOD_UNIT[lens]} on screen.`;

/**
 * R-nav-32 — a parent that stopped being legal when the horizon changed. **Cleared, visibly and with a
 * sentence, never silently**, and `aria-live="polite"` so a change the user did not make is announced
 * rather than merely repainted.
 */
export const parentClearedNote = (horizon: Horizon, was: Horizon): string =>
  `Cleared — a ${horizon} goal can't sit under a ${was} one.`;

/**
 * R-nav-32 §3.6 — no legal parent at the chosen horizon. **Expected unreachable** (a Life goal is a legal
 * parent at every other horizon, R-goal-32), and built anyway, inline inside `UNDER` rather than as a
 * whole-sheet takeover: with a horizon selector on screen the escape is to pick a different horizon, not
 * to leave.
 */
export const noLegalParentNote = (horizon: Exclude<Horizon, 'Life'>): string => {
  const above =
    horizon === 'Yearly'
      ? 'a Life goal'
      : `a Life or ${horizon === 'Quarterly' ? 'Yearly' : horizon === 'Monthly' ? 'Quarterly' : 'Monthly'} goal`;
  return `Nothing to hang a ${horizon} goal on yet — it needs ${above} above it.`;
};

/** R-lens-11 / R-lens-21 — the off-now badge, naming its horizon. Neither on the current period. */
export const offNowBadge = (lens: Horizon, isPast: boolean): string =>
  isPast ? `Past ${PERIOD_UNIT[lens]} — still editable` : `Future ${PERIOD_UNIT[lens]} — planning ahead`;

/**
 * R-lens-28 — **the period's full name: what it is called, and what it actually spans.**
 *
 * `Sep 2026 · Mon 7 Sep – Sun 4 Oct`. The name alone over-promises — a week is keyed by its Monday
 * (R-goal-33), so `Sep 2026` is the weeks beginning 7, 14, 21 and 28 Sep and reads as 1–30 September.
 *
 * On screen the two halves sit on **two lines inside the one title button** (`LensRow`), not on one; this
 * is the form the accessible name and the live region use, where a line break carries nothing and a `·`
 * does.
 *
 * ⚠ **R-lens-30 / R-lens-28 amended** — this used to read *"Both halves are the SERVER's strings
 * (`PeriodView.label` / `.weekRange`) — the client formats no date here, because it holds no Monday rule
 * to format one with (D-1)."* **The client formats both now**, with `labelOf` and `weekRangeOf` imported
 * from `@goal-cascade/shared` — which is not a second Monday rule, it is *the* Monday rule, the same
 * function the Worker calls. That is what lets the header repaint in the same frame as the input that
 * changed it, instead of waiting a round trip for the name of a month.
 *
 * The wire fields stay: the MCP surface reads them, and they are what the runtime echo assertion compares
 * the client's own rendering against on every read. **The server remains the reference the client's
 * formatter is tested against; it is no longer the source the client renders from.**
 */
export const periodTitle = (label: string, weekRange: string): string => (weekRange ? `${label} · ${weekRange}` : label);

/**
 * R-lens-29 — the flag for *the current period is not the one holding this week*.
 *
 * It fires for the first few days of a month, quarter or year and no other time: on Tue 1 Sep 2026 the
 * Monthly lens opens on `Sep 2026`, whose weeks begin on the 7th, while the week the owner is living in
 * began Mon 31 Aug and is August's. The lens is right and looks broken, which is a labelling defect and
 * not a model one (RECONCILIATION ★C-19), so the screen says the true thing in one quiet line.
 *
 * It names the period rather than the week, because the period is where the tap goes. `Go there` is the
 * short visible verb; the row gives the button an accessible name that spells the destination out.
 */
export const weekElsewhereBadge = (label: string): string => `This week is in ${label}`;
export const weekElsewhereAction = (label: string): string => `Go to ${label}`;

export interface EmptyCopy {
  title: string;
  body: string;
  /** R-goal-36 — a past period offers no create affordance at all. History is not rewritten by planning. */
  cta: boolean;
}

/**
 * R-lens-6 / R-nav-9 — the period-level empty states.
 *
 * **The future line is the load-bearing one.** *"Nothing planned this far out yet — that's expected"* says
 * both facts a user needs in one clause: the screen is empty, and the emptiness is the truth rather than a
 * failure. **Four of the five horizons carry it verbatim; Weekly says the same thing in its own words** —
 * *"This week hasn't been laid out. You can plan it now, or leave it."* — because "this far out" is false
 * about next week, which is days away and the one future period a person genuinely might plan right now.
 * The invariant to hold is the *reassurance*, not the sentence: **no future variant may read as a
 * failure, and no past or present variant offers that reassurance**, because for those two the emptiness
 * really is the whole story.
 */
export function emptyCopy(lens: Horizon, label: string, isCurrent: boolean, isPast: boolean): EmptyCopy {
  if (lens === 'Life') {
    // Kept verbatim. It is the best line in the app and it did not need improving.
    return { title: 'Nothing planted yet.', body: 'Start with a Life goal — the thing the rest of the cascade hangs off.', cta: true };
  }
  if (isPast) {
    return lens === 'Weekly'
      ? { title: 'Nothing happened this week.', body: 'No tasks were live in this week.', cta: false }
      : { title: `Nothing was set for ${label}.`, body: `This ${PERIOD_UNIT[lens]} went unplanned. History stays as it was.`, cta: false };
  }
  if (!isCurrent) {
    return lens === 'Weekly'
      ? { title: 'Not planned yet.', body: "This week hasn't been laid out. You can plan it now, or leave it.", cta: true }
      : {
          title: `${label} is empty.`,
          body: "Nothing planned this far out yet — that's expected. Set something now, or come back later.",
          cta: true,
        };
  }
  switch (lens) {
    case 'Yearly':
      return { title: `${label} is still open.`, body: 'Nothing set for this year yet. Name the few things that would make it count.', cta: true };
    case 'Quarterly':
      return { title: `${label} is unclaimed.`, body: 'No quarterly goals here yet — nothing is missing, nothing is planned.', cta: true };
    case 'Monthly':
      return { title: `${label} is unwritten.`, body: 'Nothing planned for this month yet.', cta: true };
    default:
      // R-nav-9, verbatim — only the body changed, because the old one named the entity CR-4 deleted.
      return { title: 'A new week, still unplanned.', body: 'Pick what this week is for, then hang the tasks off it.', cta: true };
  }
}

/**
 * R-lens-24 — **the third empty state: a lens empty at EVERY period.**
 *
 * `Q3 2026 is unclaimed` misleads someone who has never opened the Quarterly lens at all — it says *this
 * quarter is empty*, which invites "so what was in the last one?", and the answer is "there has never been
 * one". These four lines say the true thing instead, and each one explains what the horizon is FOR,
 * because a person who has not used it does not need a period, they need a reason.
 *
 * There is no Life entry: an empty Life lens is the account's cold start, which `emptyCopy` already
 * answers. Copy is UX-PLAN §7.2, verbatim.
 */
export function horizonEmptyCopy(lens: Exclude<Horizon, 'Life'>): EmptyCopy {
  switch (lens) {
    case 'Yearly':
      return { title: 'Nothing yearly yet.', body: "A Life goal is the direction; a yearly goal is this year's version of it.", cta: true };
    case 'Quarterly':
      return { title: 'Nothing quarterly yet.', body: 'A quarter is long enough to change something and short enough to finish.', cta: true };
    case 'Monthly':
      return { title: 'Nothing monthly yet.', body: 'Months are where a quarter turns into something you can actually do.', cta: true };
    default:
      return {
        title: 'Nothing weekly yet.',
        body: 'Weekly goals are where tasks hang. Pick a monthly goal and give this week something concrete.',
        cta: true,
      };
  }
}

/**
 * R-goal-47 — the planned-ness line on a Monthly goal, and **dormancy's one surface**.
 *
 * Four states, mapped 1:1 off `weeklyBreakdown`. `thisWeek` is null when the viewed month does not contain
 * today, which is the state whose copy has no second clause at all.
 *
 * It is not an escalation: `nothing this week` is the same muted grey as `3 weekly goals`, because a month
 * being unplanned is a fact and not a failure. The red carry chip stays the only escalation in the product
 * (R-task-11, R-lens-11).
 */
export function plannedNess(b: { weeklyGoals: number; thisWeek: number | null }, hasTasks = false): string {
  /**
   * ⚠ **A8 (R-goal-47, amended) — one new case, and it exists because the screen contradicts the old
   * string.** `Nothing planned yet` above four visible month tasks is a claim about the month that the
   * tasks directly beneath it disprove; `No weeks yet` is the same fact narrowed to what the line is
   * actually about, which is how a month breaks into weeks. With no weeks **and** no tasks the original
   * string is unchanged, verbatim.
   */
  if (b.weeklyGoals === 0) return hasTasks ? NO_WEEKS_YET : 'Nothing planned yet';
  const head = `${b.weeklyGoals} weekly goal${b.weeklyGoals === 1 ? '' : 's'}`;
  if (b.thisWeek === null) return head;
  return b.thisWeek > 0 ? `${head} · ${b.thisWeek} this week` : `${head} · nothing this week`;
}

/** R-goal-43 — `planned N weeks ago`, on a Weekly goal whose week has arrived and is `>= 2` weeks old. */
export const stalePlanLine = (weeks: number): string => `planned ${weeks} week${weeks === 1 ? '' : 's'} ago`;

/**
 * R-lens-20, rewritten — **the root-less item, on its own card.** There is no `UNSORTED` group and no
 * group note, because there are no groups; the line is a button opening the Move sheet in `only: 'life'`
 * mode, which finally gives that mode the caller `25-goal-picker` records it has never had.
 */
export const NOT_UNDER_LIFE = 'Not under a Life goal yet';

/**
 * ⚠ The group note the lens used to print above an `UNSORTED` run. **It has no lens caller any more** —
 * there is no group to note — but it is NOT deleted: the goal page's trail sheet still says it, and that
 * is a different surface asking a different question (*this goal's chain*, not *this run of cards*). A
 * sentence with one honest caller left is kept where it was written rather than copied into that file.
 */
export const UNSORTED_NOTE = "These aren't under a Life goal yet.";
export const NOT_UNDER_LIFE_NAME = 'Not under a Life goal yet. Put it under one.';

/**
 * R-lens-23, rewritten — **the one line on an item, and it names the LIFE goal its chain reaches.**
 *
 * It used to name the *immediate* parent, suppressed when that parent was the group's own Life goal. Both
 * halves break without groups: the suppression has no referent, and a flat Yearly list would carry no
 * ancestry at all, because a Yearly goal's parent is always a Life goal and was therefore always
 * suppressed. One rule at four horizons beats four different kinds of fact wearing one word — and it is
 * exactly the string the deleted group header carried, so nothing left the screen, it moved onto the card.
 */
export const lifeLine = (title: string): string => `under ${title}`;
export const lifeLineName = (title: string): string => `under ${title}. Open goal.`;

/** R-task-49 — stated before it happens, so nothing is created invisibly. */
export const implicitWeeklyGoalNote = (title: string, week: string): string =>
  `This starts a weekly goal "${title}" for the week of ${week}. You can rename it after.`;

/**
 * ⚠ **A9 (R-task-49) — the week a task is about to land in, and the month that week belongs to.**
 *
 * Two facts, both of which the owner needed and neither of which the sheet said. The **week** because
 * `+ Task` from a Monthly goal resolves one and never showed it; the **month** because the week and the
 * month can honestly differ at a seam (a week belongs to its Monday's month) and a task that lands in a
 * different month from the lens you are standing in is exactly how three of them were lost.
 *
 * It reads as a statement of fact, not a warning: there is nothing wrong here, and after A9's clamp fix
 * the month named is the month you are looking at.
 */
export const taskDestinationNote = (week: string, month: string): string => `Lands in the week of ${week} · ${month}.`;

/**
 * The rule, wherever it must be said. Never "leaves hold tasks" (R-goal-37).
 *
 * `lib/errorCopy.ts` is the one place it *is* said — the `NOT_A_TASK_GOAL` refusal — and it imports
 * this rather than repeating the literal, which is what it used to do. A constant that exists to hold a
 * sentence, sitting beside a hardcoded copy of that sentence, is a rule with two definitions.
 */
export const TASKS_LIVE_ON_TASK_GOALS = 'Tasks live on monthly and weekly goals.';

// ---- A8: the month band, the Monthly lens's tasks, and Park ------------------

/**
 * ⚠ **R-lens-31, amended by `33-measurables-ux` §7.1 — the band's heading NAMES ITS MONTH, always.**
 *
 * The rule proposed the bare words `THIS MONTH`. On Wed 2 Sep the band holds **August** (a week belongs
 * to its Monday's month, R-goal-33), and a heading that will not name the month it is showing is exactly
 * the labelling defect R-lens-29 exists to fix one lens over — it also makes the seam unreportable, since
 * an owner seeing `THIS MONTH` above August's work has no way to tell a bug from the Monday rule.
 * `S.sectionLabel` renders it uppercase, so the screen reads `THIS MONTH · AUG 2026`.
 */
export const monthBandLabel = (month: string): string => `This month · ${month}`;
export const monthBandName = (month: string, tasks: number): string =>
  `This month, ${month} — ${tasks} task${tasks === 1 ? '' : 's'} whose deadline is the end of the month`;

/**
 * The band's one sentence. It, plus the band's position, is the **entire** signal that this is not this
 * week's work — nothing in the band is tinted, dimmed, indented, shrunk or greyed, because every cheap way
 * to say *"this is not this week"* is a way of saying *"this matters less"*, and the owner's sentence is
 * the opposite: the deadline is the end of the month, which is a commitment and not a footnote.
 */
export const monthBandNote = (month: string): string => `Due by the end of ${month}, not by the end of this week.`;

/**
 * ⚠ **The August trap, closed by omission** (`33-measurables-ux` §4.2/§4.3).
 *
 * On 2 Sep the band is August's and August is past for planning, so **no card in the band renders
 * `+ Task` at all** and `PERIOD_IN_PAST` is unreachable rather than handled. In its place the band's foot
 * takes R-lens-29's idiom one lens over: name the period that is elsewhere, say what is true, and offer
 * one tap to it. It carries no colour — a month that has ended is a fact about the calendar, not a
 * problem with the plan.
 */
export const monthEndedNote = (past: string, current: string): string =>
  `${past} has ended. New work for the month goes in ${current}.`;
/** The destination spelled out, R-lens-29's own rule for the same idiom. The visible half is `weekElsewhereAction`. */
export const monthLensLinkName = (month: string): string => `Go to ${month} on the Monthly lens`;

/**
 * ⚠ **R-lens-32** — and NOT `WeeklyCard`'s `Nothing on this yet.` A Monthly **goal's page** renders a task
 * list and a backlog block one above the other (R-goal-41 as amended), and two adjacent lists both reading
 * `Nothing on this yet.` is the one place R-backlog-30's distinction is lost in a word.
 */
export const NOTHING_ON_MONTH = 'Nothing on this month yet.';
/** R-goal-47's new case. See `plannedNess`. */
export const NO_WEEKS_YET = 'No weeks yet';

/**
 * ⚠ **A11 (`32-week-selection` §3.1) — `When this lands`, and never `Which week`.**
 *
 * The name has to stay true after A8 puts a **month** in the option list, and a control renamed between
 * amendments is a control screen-reader users learn twice. It also matches the block's own verb: the note
 * beneath it already says `Lands in …`.
 */
export const WHEN_THIS_LANDS = 'When this lands';
/** The month chip's accessible name — the label alone would not say what choosing it means. */
export const monthChipName = (month: string): string => `${month} — the whole month, no particular week`;
/** The destination line when the month is chosen. There is no goal row: with no week there is nothing to resolve. */
export const monthDestinationNote = (month: string): string => `Lands in ${month} — no particular week.`;
/** The consequence of changing the week, announced because the goal row changes under the user (R-lens-13). */
export const landsUnder = (note: string, goalTitle: string): string => `${note} Under ${goalTitle}.`;

/**
 * ⚠ **R-task-56, amended by `33-measurables-ux` §7.2 — `WHERE THIS GOES` on the task page.**
 *
 * The eyebrow is **the create sheet's own string, reused**, and the block sits above the three exits,
 * separated from them by that eyebrow and a gap and by nothing else — no border, no card, no colour,
 * because Park **is not an exit** (R-task-13 is unchanged at exactly three) and a coloured well would be
 * the first "this group is different" surface in the product.
 */
export const WHERE_THIS_GOES = 'WHERE THIS GOES';
export const monthTaskPlaceLine = (month: string): string => `In ${month} — the whole month, no particular week.`;
export const weekTaskPlaceLine = (week: string): string => `In the week of ${week}.`;
export const PARK_IN_A_WEEK = 'Park in a week';
/**
 * ⚠ The un-park button's **visible** label spells its destination — `Move to Sep 2026`, not `Move to the
 * month` — because there is no sheet on that path to state where the work lands, and a one-tap write that
 * does not name its destination is the defect A9 spent an amendment closing.
 */
export const moveToMonth = (month: string): string => `Move to ${month}`;
export const moveToMonthName = (month: string): string => `Move to ${month} — the whole month, no particular week.`;
export const parkedToast = (week: string): string => `Parked in the week of ${week}`;
export const movedToMonthToast = (month: string): string => `Moved to ${month}`;
export const PARK_IT = 'Park it';
/** The create sheet's toast for the month path — `Added to week of 31 Aug`'s twin, one scope up. */
export const addedToMonthToast = (month: string): string => `Added to ${month}`;
