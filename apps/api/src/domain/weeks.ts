import { weeksBetween } from '@goal-cascade/shared';

/**
 * **Week POLICY — the two functions only the server is allowed to have an opinion about.**
 *
 * The calendar itself moved to `packages/shared/src/calendar/weeks.ts` (R-lens-30), because both sides
 * must agree on what a Monday is and one module is the only thing that guarantees they do. What stays
 * here is not calendar arithmetic at all: it is read-model policy over work — R-task-43's signed carry
 * age, and R-task-7/8/32's week visibility.
 *
 * **The client already receives both answers** — `TaskView.carryWeeks`, and a task simply being present
 * in `LensResponse.tasks` — and must never recompute either, because they are decisions about work, not
 * about dates. That is where the line is drawn: **the calendar is shared vocabulary; visibility and age
 * are policy.**
 *
 * Every calendar helper this file used to export (`isValidTimezone`, `dateInTimezone`, `isMonday`,
 * `weekStartOfDate`, `weekStartOf`, `addWeeks`, `weeksBetween`, `offsetOf`, `weekStartFromOffset`) is
 * now imported from `@goal-cascade/shared` at its call sites, and deliberately **not** re-exported from
 * here: a re-export would leave two spellings of one import path, which is the first half of how the
 * duplicate this change deleted came to exist.
 */

/**
 * R-task-43 — the **signed** carry age of a task in the week being viewed:
 * `weeksBetween(origin, min(viewedWeek, currentWeek))`.
 *
 * Labels: `<= 0` → none; `= 1` → the gray "since Mon 24 Aug"; `>= 2` → the red "N weeks · since 10 Aug"
 * chip, the only escalation in the product. The 1-week and 2-week thresholds are unchanged from
 * R-task-10/11/12.
 *
 * **Two terms, and each answers a different way of being wrong.**
 *
 *  1. It is measured against the **VIEWED** week, not today (S-task-11-2): a task with origin two weeks
 *     ago, viewed in the week after its origin, is one week old THERE and shows the gray label. A past
 *     week must read as it read then.
 *  2. `min(…, currentWeek)` is what keeps a **plan** from ageing. A task planned for `+1` and viewed at
 *     `+3` is age `−1`, not 2 — the naive `viewed − origin` would read 2 and fire the product's only
 *     escalation at work nobody is late with, which R-lens-11 forbids outright.
 *
 * ⚠ **A2 supersedes R-task-37's outer `max(0, …)` clamp.** Dropping it changes nothing that renders —
 * no label fires below 1 either way — and leaves ONE guard instead of two, carried in the sign. A
 * negative age is the honest reading of "not due yet". **`TaskView.carryWeeks` therefore stops being
 * `nonnegative`: it is a silent wire break, and anything summing these values is now wrong.**
 *
 * An already-late open task (origin in the past) projected into a future week keeps the age it has
 * TODAY: it is late now and still open then, so the chip is correct there (S-task-43-2).
 */
export function carryWeeks(originWeekStart: string, viewedWeekStart: string, currentWeekStart: string): number {
  const measuredAt = viewedWeekStart < currentWeekStart ? viewedWeekStart : currentWeekStart;
  return weeksBetween(originWeekStart, measuredAt);
}

/**
 * R-task-7/8 / R-task-32 — is this task visible in `viewedWeekStart`?
 *
 * An OPEN task is visible in every week at or after its origin: it carries forward with no prompt and,
 * crucially, with NO WRITE — carrying is derived, which is why this product has no cron (Q-17). A DONE
 * task is visible only in the week it was completed. An EXITED task (canceled / movedToBacklog) is
 * visible in no week at all (D-15).
 */
export function isVisibleInWeek(
  task: { status: 'open' | 'done' | 'canceled' | 'movedToBacklog'; originWeekStart: string; doneWeekStart: string | null },
  viewedWeekStart: string,
): boolean {
  if (task.status === 'open') return weeksBetween(task.originWeekStart, viewedWeekStart) >= 0;
  if (task.status === 'done') return task.doneWeekStart === viewedWeekStart;
  return false;
}

/*
 * ⚠ **A2 (R-lens-7, R-rm-3)** — `selectableWeeks` is DELETED, not left unused.
 *
 * It computed "the weeks the switcher may address": the current week and the previous
 * `WEEK_HISTORY_WEEKS - 1`. Both halves of that are retired. There is no picker to enumerate (the lens
 * title opens the Zoom sheet instead — R-lens-17), no forward bound (R-goal-36) and no backward bound
 * either: greying out the back chevron at the account's first period would cost a `MIN(period_key)`
 * probe on every render to disable one control, and a bound in one direction only rebuilds D-24's
 * asymmetry. D-24's rule is now satisfied by CONSTRUCTION — one control per dimension, so no two
 * controls can disagree about a range.
 *
 * The function is removed rather than deprecated because an unused range helper is one refactor away
 * from being a used one (the R-rm-* discipline).
 */
