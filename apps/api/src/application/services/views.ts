import type { ExternalLinkView, TaskView, WeekView } from '@goal-cascade/shared';
import type { BacklogLink, Task, TaskLink } from '../../domain/entities';
import { carryWeeks, offsetOf } from '../../domain/weeks';
import type { RequestContext } from '../context';

/**
 * The two projections more than one service needs.
 *
 * They live here rather than in whichever service happened to own them first: `GoalService.lens` renders
 * the Weekly lens's tasks (R-lens-12) and `TaskService` renders the same tasks for `GET /tasks`, so a
 * second implementation of `carryWeeks` would be a second implementation of R-task-43 — and the two
 * would disagree the first time one of them was "tidied".
 */

export const toLinkView = (l: TaskLink | BacklogLink): ExternalLinkView => ({
  id: l.id,
  url: l.url,
  createdAt: l.createdAt,
});

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
