import type { BacklogItemView, ExternalLinkView, TaskView, WeekView } from '@goal-cascade/shared';
import type { BacklogItem, BacklogLink, Goal, Task, TaskLink } from '../../domain/entities';
import { isLifeHorizon, lifeRootIn, type TreeIndex } from '../../domain/goal-tree';
import { offsetOf } from '@goal-cascade/shared';
import { carryWeeks } from '../../domain/weeks';
import type { RequestContext } from '../context';

/**
 * The projections more than one service needs.
 *
 * They live here rather than in whichever service happened to own them first: `GoalService.lens` renders
 * the Weekly lens's tasks (R-lens-12) and `TaskService` renders the same tasks for `GET /tasks`, so a
 * second implementation of `carryWeeks` would be a second implementation of R-task-43 — and the two
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
    fromWeekStart: item.fromWeekStart,
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
 * ⚠ **A2 (R-task-43) — `carryWeeks` is SIGNED**, and it is measured against
 * `min(viewedWeek, currentWeek)` rather than against the viewed week alone.
 *
 * Two terms, each answering a different way of being wrong: it depends on the **viewed** week, so a past
 * week reads as it read then (S-task-11-2); and the `min` is what keeps a **plan** from ageing, so a task
 * planned for `+1` and viewed at `+3` is age `−1`, not 2. The naive `viewed − origin` would read 2 and
 * fire the product's only escalation at work nobody is late with, which R-lens-11 forbids outright.
 * Anything that SUMS these values, or re-parses them as `nonnegative`, is now wrong.
 *
 * `completable` (R-task-44) is on the wire so the client does not re-derive a date rule to decide whether
 * to render a checkbox: the bound is `originWeek <= week <= currentWeek`, so a task under a FUTURE Weekly
 * goal has no legal completion week at all and its row renders none (S-task-44-1).
 */
export function toTaskView(
  task: Task,
  links: readonly TaskLink[],
  viewedWeekStart: string,
  currentWeekStart: string,
): TaskView {
  return {
    id: task.id,
    goalId: task.goalId,
    title: task.title,
    cond: task.cond,
    description: task.description,
    links: links.filter((l) => l.taskId === task.id).map(toLinkView),
    status: task.status,
    done: task.status === 'done',
    originWeekStart: task.originWeekStart,
    doneWeekStart: task.doneWeekStart,
    doneAt: task.doneAt,
    exitReason: task.exitReason,
    exitedAt: task.exitedAt,
    carryWeeks: carryWeeks(task.originWeekStart, viewedWeekStart, currentWeekStart),
    completable:
      task.status === 'open' && viewedWeekStart >= task.originWeekStart && viewedWeekStart <= currentWeekStart,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    version: task.version,
  };
}

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
