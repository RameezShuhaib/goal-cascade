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

/** R-nav-25 — the cluster row's one primary action, naming the horizon it would create. */
export const createLabel = (lens: Horizon): string => `+ ${lens} goal`;

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
export function plannedNess(b: { weeklyGoals: number; thisWeek: number | null }): string {
  if (b.weeklyGoals === 0) return 'Nothing planned yet';
  const head = `${b.weeklyGoals} weekly goal${b.weeklyGoals === 1 ? '' : 's'}`;
  if (b.thisWeek === null) return head;
  return b.thisWeek > 0 ? `${head} · ${b.thisWeek} this week` : `${head} · nothing this week`;
}

/** R-goal-43 — `planned N weeks ago`, on a Weekly goal whose week has arrived and is `>= 2` weeks old. */
export const stalePlanLine = (weeks: number): string => `planned ${weeks} week${weeks === 1 ? '' : 's'} ago`;

/** R-lens-20 — the root-less group. A data-integrity surface, never an ordinary state. */
export const UNSORTED_NOTE = "These aren't under a Life goal yet.";

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
 * `lib/errorCopy.ts` is the one place it *is* said — the `NOT_A_WEEKLY_GOAL` refusal — and it imports
 * this rather than repeating the literal, which is what it used to do. A constant that exists to hold a
 * sentence, sitting beside a hardcoded copy of that sentence, is a rule with two definitions.
 */
export const TASKS_LIVE_ON_WEEKLY_GOALS = 'Tasks live on weekly goals.';
