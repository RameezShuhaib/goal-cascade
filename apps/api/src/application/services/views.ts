import type { BacklogItemView, ExternalLinkView, ReadingView, TaskView, WeekView } from '@goal-cascade/shared';
import type { BacklogItem, BacklogLink, Goal, Reading, Task, TaskLink } from '../../domain/entities';
import type { TaskScope } from '../../domain/enums';
import { toMeasureView } from '../../domain/measures';
import { isLifeHorizon, lifeRootIn, type TreeIndex } from '../../domain/goal-tree';
import { dateInTimezone, offsetOf, periodKeyOf } from '@goal-cascade/shared';
import { carryAge, carryUnitOf } from '../../domain/weeks';
import type { RequestContext } from '../context';

/**
 * The projections more than one service needs.
 *
 * They live here rather than in whichever service happened to own them first: `GoalService.lens` renders
 * the Weekly lens's tasks (R-lens-12) and `TaskService` renders the same tasks for `GET /tasks`, so a
 * second implementation of `carryAge` would be a second implementation of R-task-43 — and the two
 * would disagree the first time one of them was "tidied".
 *
 * ⚠ **A1/A2** — `toBacklogItemView` joined them, for the same reason and after the same near miss: three
 * copies of it had grown (here, `goal.service.ts` and `task.service.ts`), and R-backlog-13's branch-path
 * labels plus R-backlog-17's `sortKey` would have had to land in all three, correctly, three times.
 */

export const toLinkView = (l: TaskLink | BacklogLink): ExternalLinkView => ({
  id: l.id,
  url: l.url,
  createdAt: l.createdAt,
});

/**
 * ⚠ **A2, new (R-backlog-13)** — **the branch path a backlog item is grouped under**, resolved once from
 * the interior tree.
 *
 * `<Life goal> › <owning goal>` is what the Backlog page groups by, and the client cannot build it: an
 * item carries a `goalId` whose goal sits in whatever period it happens to sit in, and the client holds
 * one lens page and no tree (R-lens-16). Before this, the page guessed from the current period's lens
 * reads and bucketed the misses under `Elsewhere` — a truthful name for a client limitation and a
 * meaningless one for an owner.
 *
 * **It costs no read.** A backlog item can only ever hang off a Yearly, Quarterly or Monthly goal
 * (R-backlog-2), so its owner is always in the interior set the request already loaded (R-lens-27), and
 * the Life root is the same `parentId` walk R-lens-3 does for a lens item.
 *
 * `lifeGoalTitle` is null when the chain does not reach a Life goal — R-lens-20's `UNSORTED` condition —
 * and the goal title falls back to `UNSORTED` in the (unreachable-through-the-product) case where the
 * owning goal row itself is gone. Both surface a data problem rather than dropping the row.
 */
export type BacklogLabels = { goalTitle: string; lifeGoalTitle: string | null };

export function backlogLabelsOf(interior: TreeIndex<Goal>, goalId: string): BacklogLabels {
  const goal = interior.byId.get(goalId);
  if (!goal) return { goalTitle: 'UNSORTED', lifeGoalTitle: null };
  if (isLifeHorizon(goal.horizon)) return { goalTitle: goal.title, lifeGoalTitle: goal.title };
  return { goalTitle: goal.title, lifeGoalTitle: lifeRootIn(interior, goal.id)?.title ?? null };
}

/**
 * One backlog item, as every list and every command response renders it.
 *
 * `labels` is passed in rather than resolved here because resolving it needs the interior tree, and a
 * projection that reaches for a repository is a projection that will do it once per row.
 */
export function toBacklogItemView(
  item: BacklogItem,
  links: readonly BacklogLink[],
  labels: BacklogLabels,
): BacklogItemView {
  return {
    id: item.id,
    goalId: item.goalId,
    goalTitle: labels.goalTitle,
    lifeGoalTitle: labels.lifeGoalTitle,
    title: item.title,
    description: item.description,
    links: links.filter((l) => l.itemId === item.id).map(toLinkView),
    capturedAt: item.capturedAt,
    fromPeriodKey: item.fromPeriodKey,
    sortKey: item.sortKey,
    status: item.status,
    convertedToTaskId: item.convertedToTaskId,
    convertedAt: item.convertedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    version: item.version,
  };
}

/**
 * A task as any list renders it.
 *
 * ⚠ **A8 (R-task-52/54/55) — every one of the three derived fields is computed AT THE TASK'S OWN SCOPE**,
 * against a period of that scope, and `viewedPeriodKey` must be one. Callers pass the period they are
 * rendering: the selected week for a week task, the selected month for a month task, and — for the month
 * band inside a week — **the month that week belongs to**, never the week (R-lens-31).
 *
 * ⚠ **A2 (R-task-43) / A8 (R-task-54) — `carryAge` is SIGNED**, measured against
 * `min(viewedPeriod, currentPeriod)` rather than against the viewed period alone, and counted in
 * `carryUnit`.
 *
 * Two terms, each answering a different way of being wrong: it depends on the **viewed** period, so a
 * past one reads as it read then (S-task-11-2); and the `min` is what keeps a **plan** from ageing, so a
 * task planned for `+1` and viewed at `+3` is age `−1`, not 2. The naive `viewed − origin` would read 2
 * and fire the product's only escalation at work nobody is late with, which R-lens-11 forbids outright.
 * Anything that SUMS these values, or re-parses them as `nonnegative`, is now wrong.
 *
 * ⚠ **A month task's `carryAge` is NOT zeroed for the month band, and must not be.** R-task-54 says a
 * month task wears no carry label of any kind inside a week; the suppression belongs to the band that
 * renders it (`LensResponse.monthTasks`), because the SAME task in the Monthly lens must show its chip. A
 * field that lied in one lens to save a branch in another would be the harder bug of the two.
 *
 * `completable` (R-task-44, R-task-55) is on the wire so the client does not re-derive a date rule to
 * decide whether to render a checkbox: the bound is `origin <= period <= currentPeriod` **at the task's
 * own scope**, so a task under a FUTURE goal has no legal completion period at all and its row renders
 * none (S-task-44-1, S-task-55-1). ⚠ **Its NAME did not move and its MEANING did** — for a month task it
 * now answers about the MONTH.
 *
 * `measure` is `null` for the vast majority of tasks, and such a row is byte-identical to what it was
 * before A8 (R-measure-1, S-measure-1-1).
 */
export function toTaskView(
  task: Task,
  links: readonly TaskLink[],
  viewedPeriodKey: string,
  currentPeriodKey: string,
): TaskView {
  return {
    id: task.id,
    goalId: task.goalId,
    scope: task.scope,
    title: task.title,
    cond: task.cond,
    description: task.description,
    links: links.filter((l) => l.taskId === task.id).map(toLinkView),
    status: task.status,
    done: task.status === 'done',
    originPeriodKey: task.originPeriodKey,
    donePeriodKey: task.donePeriodKey,
    doneAt: task.doneAt,
    exitReason: task.exitReason,
    exitedAt: task.exitedAt,
    carryAge: carryAge(task.scope, task.originPeriodKey, viewedPeriodKey, currentPeriodKey),
    carryUnit: carryUnitOf(task.scope),
    completable:
      task.status === 'open' && viewedPeriodKey >= task.originPeriodKey && viewedPeriodKey <= currentPeriodKey,
    measure: toMeasureView(task),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    version: task.version,
  };
}

/**
 * ⚠ **A8, new (R-task-52, R-lens-31)** — **the period of `scope` that a given WEEK belongs to.**
 *
 * A week task is viewed in the week; a month task is viewed in **the month that week belongs to**, which
 * is R-goal-33's Monday rule and nothing else. On 2 Sep 2026 the current week is Mon 31 Aug, so the band
 * on screen is `2026-08`'s while the calendar month is September — the seam R-lens-29 already names, and
 * the one S-task-55-2 requires a completion to write.
 *
 * ⚠ **This is the BAND's question, and it is NOT "what is the current month".** `currentPeriodOf` below
 * answers that one, from TODAY, and the two genuinely differ for the **1-6 days of every month before its
 * first Monday**. Using this one for both makes a September month task un-completable on 2 September and
 * negatively aged in its own month, while `ensureCarried` — which clamps correctly — has already logged
 * `Carried to Sep 2026` beside it. It is `zoomWeekForMonth` versus `taskWeekForMonth` again: two
 * questions that look like one, one function apart, and the first build of A8 got it wrong at four call
 * sites.
 *
 * ⚠ **It has exactly ONE legitimate caller: `TaskService.get`**, because the task page is addressed by a
 * `?week=` and a month task's viewed period is the month that week belongs to. **Every other caller wants
 * `currentPeriodOf`.** If you are reaching for this to fill `toTaskView`'s `currentPeriodKey`, you want
 * the other one — `tests/tasks/month-tasks.test.ts`'s `R-goal-34` block pins the distinction at the exact
 * date that separates them, and four call sites got it wrong before it existed.
 */
export const periodForScope = (scope: TaskScope, weekStart: string): string =>
  scope === 'Monthly' ? periodKeyOf('Monthly', weekStart) : weekStart;

/**
 * ⚠ **A8, new (R-goal-34, R-task-54, R-task-55)** — **the CURRENT period at a scope, from the owner's
 * today.**
 *
 * The clamp in `carryAge` and the upper bound in `completable` are both against this, at both scopes, and
 * it is `periodKeyOf(scope, today)` — R-goal-34's definition, the same one `isPastPeriod` uses, so a
 * period that refuses a create is exactly a period that is behind the clamp.
 *
 * The Weekly case reads `ctx.currentWeekStart` rather than re-deriving the Monday, so the timezone ladder
 * (R-auth-5) has one implementation and this cannot disagree with the rest of the product about which
 * week it is.
 */
export const currentPeriodOf = (ctx: RequestContext, scope: TaskScope): string =>
  scope === 'Monthly' ? periodKeyOf('Monthly', dateInTimezone(ctx.now, ctx.tz)) : ctx.currentWeekStart;

/**
 * ⚠ **A8, new (R-measure-5)** — one reading on the wire. Oldest first at the call site; no period, ever.
 */
export const toReadingView = (r: Reading): ReadingView => ({ id: r.id, taskId: r.taskId, value: r.value, at: r.at });

/**
 * D-1 — the read models answer with the ABSOLUTE Monday plus its projection against the current week, so
 * the client never re-derives Monday from its own clock (R-auth-5).
 *
 * ⚠ **A2** — `isPast` is on the wire now, because write-eligibility is a server judgement (R-goal-34,
 * R-goal-36) and a client that derived it would be a second implementation of the rule that stops
 * planning from rewriting history.
 */
export function weekView(ctx: RequestContext, weekStart: string): WeekView {
  return {
    weekStart,
    offset: offsetOf(weekStart, ctx.currentWeekStart),
    isCurrent: weekStart === ctx.currentWeekStart,
    isPast: weekStart < ctx.currentWeekStart,
  };
}
