import type { MoveTaskToBacklogResponse, TaskResponse } from '@goal-cascade/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { IBacklogLinkRepo, IBacklogRepo, ITaskRepo } from '../../src/application/ports';
import { createTestApp, signedInOwner } from '../helpers/app';
import { activate, codeOf, command, detail, kinds, listWeek, makeLine, seedTask, texts } from './helpers';

/**
 * The three exits and the uncheck — R-task-13..21, D-15.
 *
 * The load-bearing correction here is D-15: Move-to-Backlog and Cancel must NOT delete the row. The
 * mockup filtered the task out of its array, which destroyed the very `Moved to Backlog` / `Canceled`
 * entries the ruleset requires, and the optional reason with them. So every exit test asserts BOTH
 * halves: the task is gone from every week, and its record and timeline survived.
 */
const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });

const MON = { aug10: '2026-08-10', aug17: '2026-08-17', aug24: '2026-08-24', aug31: '2026-08-31' } as const;
const at = (weekStart: string) => t.clock.set(`${weekStart}T10:00:00.000Z`);

beforeEach(() => at(MON.aug31));

async function openTask(originWeek: string = MON.aug31, body: Record<string, unknown> = {}) {
  const { cookie, userId } = await signedInOwner(t);
  const { leaf } = await makeLine(t, userId);
  at(originWeek);
  await activate(t, userId, leaf.id, originWeek);
  const task = await seedTask(t, cookie, { goalId: leaf.id, title: 'ship the thing', ...body });
  at(MON.aug31);
  return { cookie, userId, leaf, task };
}

describe('R-task-14 — exit 1 of 3: complete', () => {
  it('S-task-14-1 — completing in a PAST week stamps that week, logs Completed, and leaves week 0', async () => {
    const { cookie, task } = await openTask(MON.aug17);
    const res = await command(t, cookie, `/api/tasks/${task.id}/complete`, { week: -1 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TaskResponse;

    expect(body.task.status).toBe('done');
    expect(body.task.done).toBe(true);
    expect(body.task.doneWeekStart).toBe(MON.aug24);
    // D-4 — `doneAt` is the instant of completion; the "Done Fri 28 Aug" label is derived, never stored.
    expect(body.task.doneAt).toBe('2026-08-31T10:00:00.000Z');
    expect(texts(await detail(t, cookie, task.id))).toContain('Completed');

    expect((await listWeek(t, cookie, 0)).tasks).toEqual([]);
    expect((await listWeek(t, cookie, -1)).tasks.map((x) => x.id)).toEqual([task.id]);
  });

  it('S-task-14-2 — completing in a week EARLIER than the origin is refused', async () => {
    const { cookie, task } = await openTask(MON.aug24);
    const res = await command(t, cookie, `/api/tasks/${task.id}/complete`, { week: -2 });
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe('WEEK_OUT_OF_RANGE');
  });

  it('S-task-14-2 — a future week is refused by the contract itself', async () => {
    const { cookie, task } = await openTask();
    const res = await command(t, cookie, `/api/tasks/${task.id}/complete`, { week: 1 });
    expect(res.status).toBe(422);
  });
});

describe('R-task-15 — exit 2 of 3: move to backlog', () => {
  it('S-task-15-1 — the item lands on the task’s own goal with title, description, links and fromWeek', async () => {
    const { cookie, userId, leaf, task } = await openTask(MON.aug24, {
      description: 'the long version',
      links: ['https://www.github.com/acme/pr/1'],
    });

    const res = await command(t, cookie, `/api/tasks/${task.id}/move-to-backlog`, { week: -1, reason: 'not this month' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MoveTaskToBacklogResponse;

    expect(body.item.goalId).toBe(leaf.id);
    expect(body.item.title).toBe('ship the thing');
    expect(body.item.description).toBe('the long version');
    expect(body.item.links.map((l) => l.url)).toEqual(['https://www.github.com/acme/pr/1']);
    // D-12 — the week the task was LIVE in, as a date. Not "this week", and not a display string.
    expect(body.item.fromWeekStart).toBe(MON.aug24);

    const c = t.container();
    const items = await c.resolve<IBacklogRepo>(IBacklogRepo).listOpen(userId);
    expect(items.map((i) => i.id)).toEqual([body.item.id]);
    const itemLinks = await c.resolve<IBacklogLinkRepo>(IBacklogLinkRepo).listByItems(userId, [body.item.id]);
    expect(itemLinks).toHaveLength(1);

    // The task left every week, in both directions.
    for (const week of [0, -1, -2]) expect((await listWeek(t, cookie, week)).tasks).toEqual([]);
  });

  it('S-task-15-1 / D-15 — the record and its timeline survive the exit, reason and all', async () => {
    const { cookie, userId, task } = await openTask();
    await command(t, cookie, `/api/tasks/${task.id}/move-to-backlog`, { reason: 'waiting on design' });

    const stored = await t.container().resolve<ITaskRepo>(ITaskRepo).findById(userId, task.id);
    expect(stored?.status).toBe('movedToBacklog');
    expect(stored?.exitReason).toBe('waiting on design');
    expect(stored?.exitedAt).toBe('2026-08-31T10:00:00.000Z');
    expect(stored?.movedToBacklogItemId).toBeTruthy();

    const d = await detail(t, cookie, task.id);
    expect(texts(d)).toContain('Moved to Backlog — waiting on design');
    expect(d.task.events.find((e) => e.kind === 'moved_to_backlog')?.glyph).toBe('→');
  });

  it('S-task-15-2 — a blank reason still succeeds and logs the bare line', async () => {
    const { cookie, task } = await openTask();
    const res = await command(t, cookie, `/api/tasks/${task.id}/move-to-backlog`, {});
    expect(res.status).toBe(200);
    expect(texts(await detail(t, cookie, task.id))).toContain('Moved to Backlog');
  });
});

describe('R-task-16 — exit 3 of 3: cancel', () => {
  it('S-task-16-1 — the task leaves every week and the reason is retained on the record', async () => {
    const { cookie, userId, task } = await openTask(MON.aug17);
    const res = await command(t, cookie, `/api/tasks/${task.id}/cancel`, { reason: 'changed my mind' });
    expect(res.status).toBe(200);

    for (const week of [0, -1, -2]) expect((await listWeek(t, cookie, week)).tasks).toEqual([]);

    const stored = await t.container().resolve<ITaskRepo>(ITaskRepo).findById(userId, task.id);
    expect(stored?.status).toBe('canceled');
    expect(stored?.exitReason).toBe('changed my mind');
    expect(texts(await detail(t, cookie, task.id))).toContain('Canceled — changed my mind');
  });

  it('S-task-16-1 — no backlog item is created by a cancel', async () => {
    const { cookie, userId, task } = await openTask();
    await command(t, cookie, `/api/tasks/${task.id}/cancel`, {});
    expect(await t.container().resolve<IBacklogRepo>(IBacklogRepo).listOpen(userId)).toEqual([]);
  });
});

describe('R-task-13/17 — exactly three exits, on open tasks only', () => {
  it('S-task-17-1 — move and cancel are refused on a DONE task', async () => {
    const { cookie, task } = await openTask();
    expect((await command(t, cookie, `/api/tasks/${task.id}/complete`, {})).status).toBe(200);

    for (const exit of ['move-to-backlog', 'cancel']) {
      const res = await command(t, cookie, `/api/tasks/${task.id}/${exit}`, {});
      expect(res.status).toBe(409);
      expect(await codeOf(res)).toBe('TASK_ALREADY_EXITED');
    }
  });

  it('S-task-17-1 — a second exit on an already-exited task is refused', async () => {
    const { cookie, task } = await openTask();
    expect((await command(t, cookie, `/api/tasks/${task.id}/cancel`, {})).status).toBe(200);
    const again = await command(t, cookie, `/api/tasks/${task.id}/move-to-backlog`, {});
    expect(again.status).toBe(409);
    expect(await codeOf(again)).toBe('TASK_ALREADY_EXITED');
  });

  it('S-task-13-1 — there is no fourth exit: defer / snooze / reschedule / move-to-week do not exist', async () => {
    const { cookie, task } = await openTask();
    for (const path of ['defer', 'snooze', 'reschedule', 'move-to-week']) {
      const res = await command(t, cookie, `/api/tasks/${task.id}/${path}`, { week: -1 });
      expect(res.status).toBe(404);
    }
  });
});

describe('R-task-19/20/21 — uncheck', () => {
  it('S-task-19-1 — unchecking a task completed three weeks ago keeps its ORIGINAL origin', async () => {
    // origin −4, completed in week −3, unchecked while viewing week −3 (the mockup's exact scenario).
    at(MON.aug10);
    const { cookie, userId } = await signedInOwner(t);
    const { leaf } = await makeLine(t, userId);
    await activate(t, userId, leaf.id, MON.aug10);
    const task = await seedTask(t, cookie, { goalId: leaf.id, title: 'four weeks old' });
    at(MON.aug17);
    await command(t, cookie, `/api/tasks/${task.id}/complete`, { week: 0 });
    at(MON.aug31);

    const res = await command(t, cookie, `/api/tasks/${task.id}/uncheck`, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as TaskResponse;
    expect(body.task.done).toBe(false);
    expect(body.task.doneWeekStart).toBeNull();
    expect(body.task.doneAt).toBeNull();
    // The whole point: the origin is NOT reset to today, so the age it earned is the age it shows.
    expect(body.task.originWeekStart).toBe(MON.aug10);
    expect(body.task.carryWeeks).toBe(3);

    // Open again in every week from its origin forward.
    for (const [week, age] of [
      [-3, 0],
      [-2, 1],
      [-1, 2],
      [0, 3],
    ] as const) {
      const list = await listWeek(t, cookie, week);
      expect(list.tasks.map((x) => x.id)).toEqual([task.id]);
      expect(list.tasks[0]?.carryWeeks).toBe(age);
    }
  });

  it('S-task-19-2 — no second task is created and the history is intact, newest first', async () => {
    const { cookie, userId, task } = await openTask();
    await command(t, cookie, `/api/tasks/${task.id}/complete`, {});
    await command(t, cookie, `/api/tasks/${task.id}/uncheck`, {});

    const all = await t.container().resolve<ITaskRepo>(ITaskRepo).listOpenByGoals(userId, [task.goalId]);
    expect(all.map((x) => x.id)).toEqual([task.id]);
    expect(kinds(await detail(t, cookie, task.id))).toEqual(['unchecked', 'completed', 'created']);
  });

  it('S-task-20-1 — unchecking works on a dormant leaf and does not re-parent the task', async () => {
    // Active in week −1 only; the leaf is dormant in week 0 when the uncheck happens.
    const { cookie, leaf, task } = await openTask(MON.aug24);
    await command(t, cookie, `/api/tasks/${task.id}/complete`, { week: -1 });
    const res = await command(t, cookie, `/api/tasks/${task.id}/uncheck`, {});
    expect(res.status).toBe(200);
    expect(((await res.json()) as TaskResponse).task.goalId).toBe(leaf.id);
  });

  it('S-task-21-1 / S-task-21-3 — a skipped, blank or unchanged condition writes and logs nothing', async () => {
    const { cookie, task } = await openTask(MON.aug31, { cond: 'the PR is merged' });
    await command(t, cookie, `/api/tasks/${task.id}/complete`, {});

    await command(t, cookie, `/api/tasks/${task.id}/uncheck`, {}); // Skip
    await command(t, cookie, `/api/tasks/${task.id}/complete`, {});
    await command(t, cookie, `/api/tasks/${task.id}/uncheck`, { cond: '   ' }); // whitespace only
    await command(t, cookie, `/api/tasks/${task.id}/complete`, {});
    await command(t, cookie, `/api/tasks/${task.id}/uncheck`, { cond: 'the PR is merged' }); // unchanged

    const d = await detail(t, cookie, task.id);
    expect(d.task.cond).toBe('the PR is merged');
    expect(kinds(d).filter((k) => k === 'cond_edited')).toEqual([]);
  });

  it('S-task-21-2 — a changed condition saved from the prompt logs one truncated cond_edited event', async () => {
    const { cookie, task } = await openTask(MON.aug31, { cond: 'the PR is merged' });
    await command(t, cookie, `/api/tasks/${task.id}/complete`, {});
    await command(t, cookie, `/api/tasks/${task.id}/uncheck`, { cond: 'the PR is merged AND deployed to production' });

    const d = await detail(t, cookie, task.id);
    expect(d.task.cond).toBe('the PR is merged AND deployed to production');
    // R-task-27 — the new value is longer than 24 chars, so it is cut to exactly 24 plus an ellipsis.
    expect(texts(d)[0]).toBe('Done-condition edited: "the PR is merged" → "the PR is merged AND dep…"');
    expect(kinds(d)).toEqual(['cond_edited', 'unchecked', 'completed', 'created']);
  });

  it('unchecking an open task is refused rather than silently doing nothing', async () => {
    const { cookie, task } = await openTask();
    const res = await command(t, cookie, `/api/tasks/${task.id}/uncheck`, {});
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe('VALIDATION_FAILED');
  });
});
