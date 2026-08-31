import type { TaskEventView } from '@goal-cascade/shared';
import { inject, injectable } from 'tsyringe';
import type { Task, TaskEvent } from '../../domain/entities';
import { TASK_EVENT_GLYPHS, type TaskEventKind, type TaskSource } from '../../domain/enums';
import { addWeeks, weeksBetween } from '../../domain/weeks';
import type { RequestContext } from '../context';
import { IIdGenerator, ITaskEventRepo, type GuardedWrite } from '../ports';
import { GuardedBatch } from './guarded-batch';

/**
 * How many weeks of `Carried to week of …` a single read may backfill.
 *
 * ⚠ **A2 (R-rm-3)** — this used to be `WEEK_HISTORY_WEEKS`, which is retired as a BOUND. It is not a
 * product rule and must never be read as one: it is the fan-out limit on one lazy write batch, so a read
 * of a task that has carried for three years does not emit 150 statements. Every week a read actually
 * visits still gets its line, because the window slides forward with the week being read.
 */
const CARRY_BACKFILL_WEEKS = 8;

/**
 * R-task-30/31 — the activity timeline: the ONE place a task's history is written.
 *
 * Everything here is a side effect of an operation the owner performed; nothing is ever user-authored,
 * editable or deletable, and no operation ever asks for a reason it can refuse to accept (R-task-18).
 * `text` and `glyph` are rendered HERE, at append time, so a line reads the same forever even if the copy
 * changes later — the client never rebuilds a sentence from `detail`.
 *
 * `append()` returns an UNEXECUTED write so the caller can put the event in the SAME `GuardedBatch` as
 * the change that caused it (an event that can commit without its cause is a lie in the timeline).
 * `ensureCarried()` is the one exception and is explained on its own doc block.
 */
@injectable()
export class ActivityLog {
  constructor(
    @inject(ITaskEventRepo) private readonly events: ITaskEventRepo,
    @inject(IIdGenerator) private readonly ids: IIdGenerator,
    @inject(GuardedBatch) private readonly batch: GuardedBatch,
  ) {}

  /**
   * Build one timeline entry plus the write that appends it. Stamped with `ctx.now` — the ONE instant
   * the whole request agrees on — so several events appended by one command share an `at` and fall back
   * to `id` (a monotonic ULID) for their order, which is exactly insertion order (Q-7).
   */
  append(
    ctx: RequestContext,
    taskId: string,
    kind: TaskEventKind,
    text: string,
    detail: Record<string, unknown> | null = null,
  ): { event: TaskEvent; write: GuardedWrite } {
    const event: TaskEvent = {
      id: this.ids.ulid(),
      userId: ctx.userId,
      taskId,
      kind,
      text,
      glyph: TASK_EVENT_GLYPHS[kind],
      detail: detail === null ? null : JSON.stringify(detail),
      weekStart: null,
      at: ctx.now,
    };
    return { event, write: { label: `taskEvent.${kind}`, stmt: this.events.insertStmt(event) } };
  }

  /**
   * R-task-29 / D-14 / Q-17 — the `Carried to week of …` producer.
   *
   * Carrying itself is DERIVED (an open task is visible in every week at or after its origin, with no
   * write of any kind — D-1), so nothing in the product naturally writes this line. There is deliberately
   * no cron in this Worker, so it is produced LAZILY, on the first read of a week, and made idempotent by
   * the unique index `ux_task_events_carried (user_id, task_id, week_start) WHERE kind = 'carried'`:
   * `insertCarriedIgnoreStmt` is an `INSERT … ON CONFLICT DO NOTHING`, so a re-read, a refresh, or two
   * devices opening the same new week at once add nothing the second time. Re-reads are the normal case,
   * which is why every statement here is best-effort (`expectedChanges: 'any'` — the ONE caller that needs
   * it; a numeric `0` would be an assertion that the FIRST insert, which really does write a row, fails).
   *
   * `at` is the Monday of the week carried INTO, not "now": the entry describes something that happened
   * at the start of that week, and stamping today's clock onto it would push a carry from three weeks ago
   * above a `Completed` from last week in a newest-first timeline. That is D-4's mistake in a new place.
   *
   * ⚠ **A2 (R-task-38, R-task-46) — the producer is CLAMPED AT THE CURRENT WEEK, and that clamp is far
   * more reachable than it was.** A `Carried to week of …` entry is logged once per week CROSSED, and a
   * week that has not arrived has not been crossed. Viewing week `+3` must write nothing to any task's
   * timeline (S-task-38-2). Before A2 no screen could address a future week at all, so this was
   * theoretical; now the lens scrolls forward without bound (R-lens-7), so it is the ordinary case.
   *
   * The backfill window is bounded to `CARRY_BACKFILL_WEEKS` so a single read cannot fan out into an
   * unbounded batch for a very old task. It is a **batch-size bound, not a product rule** — it replaces
   * the old `WEEK_HISTORY_WEEKS`, which was retired as a bound (R-rm-3) and must not be mistaken for one
   * here either. The window slides forward with the current week, so every week a read actually visits
   * gets its line.
   *
   * Failures are swallowed: this is a cosmetic log line produced during a READ, and a task list must not
   * 500 because a log entry raced with another device that had just written it.
   */
  async ensureCarried(ctx: RequestContext, tasks: readonly Task[], viewedWeekStart: string): Promise<void> {
    const writes: GuardedWrite[] = [];
    // R-task-38 — never log a carry into a week that has not arrived, however far ahead a lens looks.
    const upTo = viewedWeekStart < ctx.currentWeekStart ? viewedWeekStart : ctx.currentWeekStart;
    for (const task of tasks) {
      // R-task-7/12 — only an OPEN task carries, and only into weeks strictly after its origin.
      if (task.status !== 'open') continue;
      const age = weeksBetween(task.originWeekStart, upTo);
      for (let n = Math.max(1, age - (CARRY_BACKFILL_WEEKS - 1)); n <= age; n++) {
        const weekStart = addWeeks(task.originWeekStart, n);
        const event: TaskEvent & { weekStart: string } = {
          id: this.ids.ulid(),
          userId: ctx.userId,
          taskId: task.id,
          kind: 'carried',
          text: carriedText(weekStart),
          glyph: TASK_EVENT_GLYPHS.carried,
          detail: JSON.stringify({ weekStart }),
          weekStart,
          at: `${weekStart}T00:00:00.000Z`,
        };
        writes.push({
          label: 'taskEvent.carried',
          stmt: this.events.insertCarriedIgnoreStmt(event),
          expectedChanges: 'any',
        });
      }
    }
    if (writes.length === 0) return;
    try {
      await this.batch.run(writes);
    } catch {
      // Deliberately ignored — see the doc block above.
    }
  }

  list(userId: string, taskId: string): Promise<TaskEvent[]> {
    return this.events.listByTask(userId, taskId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Copy. R-task-30 fixes these strings; R-task-27 fixes how values are interpolated.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * R-task-27 — every value interpolated into an event line is truncated: empty → `(none)`, longer than 24
 * characters → the first 24 plus an ellipsis. The log is a glanceable history, not a diff.
 */
export function trunc(value: string): string {
  const v = value.trim() === '' ? '(none)' : value;
  return v.length > 24 ? `${v.slice(0, 24)}…` : v;
}

/**
 * R-task-24/25 — the label a link is logged under: its hostname minus a leading `www.`, falling back to
 * the raw string truncated to 28 characters when it will not parse.
 */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return url.length > 28 ? `${url.slice(0, 28)}…` : url;
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * A week rendered as `Mon 24 Aug`. A `weekStart` is always a Monday (the schema refuses anything else),
 * so the weekday is a constant and this needs no `Intl` locale — the log must read identically for every
 * reader, and a formatted date inside a stored string is not the place to discover a locale difference.
 */
export function weekLabel(weekStart: string): string {
  const [, month, day] = weekStart.split('-');
  return `Mon ${Number(day)} ${MONTHS[Number(month) - 1]}`;
}

/**
 * R-task-41/46 — the three creation sources, each with its own line.
 *
 * ⚠ **A2** — R-task-30's table changes in exactly two rows and no other way: `Created — weekly planning`
 * is **renamed** `Created — added to a goal` (there is no planning screen), and `Created — from an Idea`
 * is **retired** with the entity (S-task-46-1).
 */
const CREATED_TEXT: Record<TaskSource, string> = {
  goal: 'Created — added to a goal',
  backlog: 'Created — pulled from Backlog',
  drawer: 'Created — added to this week',
};

export const createdText = (source: TaskSource): string => CREATED_TEXT[source];
export const carriedText = (weekStart: string): string => `Carried to week of ${weekLabel(weekStart)}`;
export const renamedText = (from: string, to: string): string => `Renamed: "${trunc(from)}" → "${trunc(to)}"`;
export const condEditedText = (from: string, to: string): string =>
  `Done-condition edited: "${trunc(from)}" → "${trunc(to)}"`;
export const DESCRIPTION_UPDATED_TEXT = 'Description updated';
export const linkAddedText = (url: string): string => `Link added: ${hostOf(url)}`;
export const linkRemovedText = (url: string): string => `Link removed: ${hostOf(url)}`;
export const COMPLETED_TEXT = 'Completed';
export const UNCHECKED_TEXT = 'Unchecked';
/** R-task-16/18 / D-15 — the reason is OPTIONAL, and when it is given it is kept, not dropped. */
const withReason = (base: string, reason?: string): string => (reason ? `${base} — ${reason}` : base);
export const movedToBacklogText = (reason?: string): string => withReason('Moved to Backlog', reason);
export const canceledText = (reason?: string): string => withReason('Canceled', reason);

/**
 * `detail` is stored as JSON text. A row whose JSON is unreadable still renders — `text` and `glyph` are
 * the timeline; `detail` is the structured extra.
 */
export function toEventView(event: TaskEvent): TaskEventView {
  let detail: Record<string, unknown> | null = null;
  if (event.detail) {
    try {
      const parsed: unknown = JSON.parse(event.detail);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) detail = parsed as Record<string, unknown>;
    } catch {
      detail = null;
    }
  }
  return { id: event.id, kind: event.kind, at: event.at, text: event.text, glyph: event.glyph, detail };
}
