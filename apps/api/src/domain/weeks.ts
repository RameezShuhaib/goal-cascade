import { periodsBetween } from '@goal-cascade/shared';
import type { TaskScope } from './enums';

/**
 * **Period POLICY — the two functions only the server is allowed to have an opinion about.**
 *
 * The calendar itself lives in `packages/shared/src/calendar/` (R-lens-30), because both sides must agree
 * on what a Monday and a month are and one module is the only thing that guarantees they do. What stays
 * here is not calendar arithmetic at all: it is read-model policy over work — R-task-54's signed carry
 * age, and R-task-53's period visibility.
 *
 * **The client already receives both answers** — `TaskView.carryAge` / `TaskView.carryUnit`, and a task
 * simply being present in `LensResponse.tasks` or `.monthTasks` — and must never recompute either,
 * because they are decisions about work, not about dates. That is where the line is drawn: **the calendar
 * is shared vocabulary; visibility and age are policy.**
 *
 * ⚠ **A8 (R-task-52) — both functions are now parameterised by SCOPE, and neither compares across one.**
 * A task of scope `S` is compared only against periods of `S`, in `S`'s canonical format. `periodsBetween`
 * is the shared arithmetic that generalises `weeksBetween`; the two comparisons, the two thresholds and
 * the sign are otherwise unchanged from A2.
 *
 * The file keeps its name because its callers do, and because the Weekly scope is still the one every
 * lens read outside the Monthly lens is written in.
 */

/** ⚠ **A8 (R-task-54)** — the unit `carryAge` is counted in, one per scope. Never mixed. */
export const carryUnitOf = (scope: TaskScope): 'weeks' | 'months' => (scope === 'Monthly' ? 'months' : 'weeks');

/**
 * R-task-43 / **R-task-54** — the **signed** carry age of a task in the period being viewed:
 * `periodsBetween(scope, origin, min(viewedPeriod, currentPeriod))`, counted **in the task's own scope**.
 *
 * Labels: `<= 0` → none; `= 1` → the gray "since …"; `>= 2` → the red "N weeks · since …" /
 * "N months · since …" chip, the only escalation in the product. The 1- and 2-period thresholds are
 * unchanged from R-task-10/11/12.
 *
 * **Two terms, and each answers a different way of being wrong.**
 *
 *  1. It is measured against the **VIEWED** period, not today (S-task-11-2): a task with origin two weeks
 *     ago, viewed in the week after its origin, is one week old THERE and shows the gray label. A past
 *     period must read as it read then.
 *  2. `min(…, currentPeriod)` is what keeps a **plan** from ageing. A task planned for `+1` and viewed at
 *     `+3` is age `−1`, not 2 — the naive `viewed − origin` would read 2 and fire the product's only
 *     escalation at work nobody is late with, which R-lens-11 forbids outright. ⚠ **A8** — this clause
 *     survives verbatim at month scope: a month task on a December goal, viewed in December and again in
 *     February, is negative in both (S-task-54-2).
 *
 * ⚠ **A2 supersedes R-task-37's outer `max(0, …)` clamp.** Dropping it changes nothing that renders and
 * leaves ONE guard instead of two, carried in the sign. A negative age is the honest reading of "not due
 * yet". **`TaskView.carryAge` is therefore not `nonnegative`, and anything summing these values is wrong.**
 *
 * ⚠ **A8 (R-task-54) — this value is honest at month scope and MUST NOT BE ZEROED for the month band.**
 * A month task wears no carry label of any kind inside a week, and that suppression belongs to the render
 * site (`LensResponse.monthTasks`), not here: the same task in the Monthly lens must show its chip, and a
 * field that lied in one lens to save a branch in another would be the harder bug of the two.
 *
 * The lexicographic ordering of period keys is what makes the `min` a string comparison at both scopes
 * (R-goal-33) — the same fact that makes the visibility query an index seek.
 */
export function carryAge(scope: TaskScope, originPeriodKey: string, viewedPeriodKey: string, currentPeriodKey: string): number {
  const measuredAt = viewedPeriodKey < currentPeriodKey ? viewedPeriodKey : currentPeriodKey;
  return periodsBetween(scope, originPeriodKey, measuredAt);
}

/**
 * R-task-7/8 / R-task-32 / **R-task-53** — is this task visible in `viewedPeriodKey`, at `scope`?
 *
 * An OPEN task is visible in every period at or after its origin: it carries forward with no prompt and,
 * crucially, with NO WRITE — carrying is derived, which is why this product has no cron (Q-17). A DONE
 * task is visible only in the period it was completed in. An EXITED task (canceled / movedToBacklog) is
 * visible in no period at all (D-15).
 *
 * ⚠ **A8** — *generalises* R-task-42/7/8, which stand verbatim at week scope. **An unfinished month task
 * at month end carries into the next month by exactly the mechanism a week task carries into the next
 * week** — a `>=` comparison over lexicographically sortable keys, with no write, no prompt, no move
 * operation and no job. A8 gives this product no cron either.
 *
 * **A task is invisible at a scope that is not its own**, which is the first line and the one that keeps
 * a week read and a month read from scanning each other's rows: `2026-09` and `2026-09-07` are both
 * strings and would otherwise compare.
 *
 * The comparison is a plain string `>=` rather than `periodsBetween(...) >= 0`, because the keys sort
 * chronologically at every horizon (R-goal-33) and the SQL half of this rule (`d1-task.repo.ts`) can only
 * express the string form. Two implementations of one predicate must be able to be the same predicate.
 */
export function isVisibleInPeriod(
  task: {
    status: 'open' | 'done' | 'canceled' | 'movedToBacklog';
    scope: TaskScope;
    originPeriodKey: string;
    donePeriodKey: string | null;
  },
  scope: TaskScope,
  viewedPeriodKey: string,
): boolean {
  if (task.scope !== scope) return false;
  if (task.status === 'open') return task.originPeriodKey <= viewedPeriodKey;
  if (task.status === 'done') return task.donePeriodKey === viewedPeriodKey;
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
