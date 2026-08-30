import { beforeEach, describe, expect, it } from 'vitest';
import { ITaskRepo } from '../../src/application/ports';
import { createTestApp, signedInOwner } from '../helpers/app';
import { activate, codeOf, command, createTask, listWeek, makeLine, seedTask } from './helpers';

/**
 * The week model — R-task-5/6/7/8/10/11/12, D-1.
 *
 * Every Monday in this file is a real Monday: 2026-08-03, -10, -17, -24, -31, 2026-09-07. The clock is
 * driven explicitly across those boundaries, because the whole point of D-1 is what happens to STORED
 * data when the current week moves and nothing is written.
 */
const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });

const MON = {
  aug3: '2026-08-03',
  aug10: '2026-08-10',
  aug17: '2026-08-17',
  aug24: '2026-08-24',
  aug31: '2026-08-31',
  sep7: '2026-09-07',
} as const;

const at = (weekStart: string, time = 'T10:00:00.000Z') => t.clock.set(`${weekStart}${time}`);

beforeEach(() => at(MON.aug31));

/**
 * The arrange step for every carry test: an owner with one active leaf, and a task created in
 * `originWeek` — created THROUGH the API, at that week's clock, because `originWeekStart` is
 * server-assigned from the current week and there is no back-dating (R-task-6).
 */
async function taskCreatedIn(originWeek: string, viewWeek: string = MON.aug31) {
  const { cookie, userId } = await signedInOwner(t);
  const { leaf } = await makeLine(t, userId);
  at(originWeek);
  await activate(t, userId, leaf.id, originWeek);
  const task = await seedTask(t, cookie, { goalId: leaf.id, title: 'carrying work' });
  at(viewWeek);
  return { cookie, userId, leaf, task };
}

describe('D-1 — a stored week is an absolute Monday, so it cannot decay', () => {
  /**
   * THE regression test for the mockup's most damaging bug. `originWeek: -2` meant something different
   * every Monday: a task silently aged one week with no write, and the red carry chip fired on work
   * nobody had neglected. Here the clock crosses two Monday boundaries and the stored origin does not
   * move — only the DERIVED age does, and only relative to the week being viewed.
   */
  it('D-1 — advancing the clock past a Monday leaves origin_week_start untouched and only ages the view', async () => {
    const { cookie, userId, task } = await taskCreatedIn(MON.aug31);
    expect(task.originWeekStart).toBe(MON.aug31);
    expect(task.carryWeeks).toBe(0);

    t.clock.advanceWeeks(1);
    const nextWeek = await listWeek(t, cookie, 0);
    expect(nextWeek.week.weekStart).toBe(MON.sep7);
    expect(nextWeek.tasks[0]?.originWeekStart).toBe(MON.aug31);
    expect(nextWeek.tasks[0]?.carryWeeks).toBe(1);

    // The same row, viewed in the week it was created in, is still zero weeks old there.
    const its_own_week = await listWeek(t, cookie, -1);
    expect(its_own_week.week.weekStart).toBe(MON.aug31);
    expect(its_own_week.tasks[0]?.carryWeeks).toBe(0);

    t.clock.advanceWeeks(1);
    expect((await listWeek(t, cookie, 0)).tasks[0]?.carryWeeks).toBe(2);

    // And the row itself was never rewritten: same origin, same version, no write of any kind.
    const stored = await t.container().resolve<ITaskRepo>(ITaskRepo).findById(userId, task.id);
    expect(stored?.originWeekStart).toBe(MON.aug31);
    expect(stored?.version).toBe(1);
    expect(stored?.updatedAt).toBe(task.updatedAt);
  });
});

describe('R-task-7/8 — visibility', () => {
  it('S-task-7-1 — an open task with origin −2 is visible in weeks −2, −1 and 0, with no prompt', async () => {
    const { cookie, task } = await taskCreatedIn(MON.aug17);
    for (const [week, expected] of [
      [-2, 0],
      [-1, 1],
      [0, 2],
    ] as const) {
      const res = await listWeek(t, cookie, week);
      expect(res.tasks.map((x) => x.id)).toEqual([task.id]);
      expect(res.tasks[0]?.carryWeeks).toBe(expected);
    }
  });

  it('S-task-7-2 — an open task with origin 0 is NOT visible when week −1 is viewed', async () => {
    const { cookie, task } = await taskCreatedIn(MON.aug31);
    expect((await listWeek(t, cookie, 0)).tasks.map((x) => x.id)).toEqual([task.id]);
    expect((await listWeek(t, cookie, -1)).tasks).toEqual([]);
  });

  it('S-task-8-1 — a task completed in week −1 is visible in that week only', async () => {
    const { cookie, task } = await taskCreatedIn(MON.aug17);
    const done = await command(t, cookie, `/api/tasks/${task.id}/complete`, { week: -1 });
    expect(done.status).toBe(200);

    expect((await listWeek(t, cookie, -2)).tasks).toEqual([]);
    expect((await listWeek(t, cookie, 0)).tasks).toEqual([]);
    const week1 = await listWeek(t, cookie, -1);
    expect(week1.tasks.map((x) => x.id)).toEqual([task.id]);
    expect(week1.tasks[0]?.done).toBe(true);
    expect(week1.tasks[0]?.doneWeekStart).toBe(MON.aug24);
  });

  it('S-task-9-1 — a dormant leaf still shows its carried open task (dormancy hides the section, not the work)', async () => {
    // The leaf is active only in the week the task was created in; week 0 has no focus row at all.
    const { cookie, task } = await taskCreatedIn(MON.aug24);
    const week0 = await listWeek(t, cookie, 0);
    expect(week0.plan).toEqual([]);
    expect(week0.tasks.map((x) => x.id)).toEqual([task.id]);
  });
});

describe('R-task-10/11/12 — the carry label thresholds, either side of the boundary', () => {
  it('S-task-12-1 — a task created this week has age 0 and earns no label', async () => {
    const { cookie } = await taskCreatedIn(MON.aug31);
    expect((await listWeek(t, cookie, 0)).tasks[0]?.carryWeeks).toBe(0);
  });

  it('S-task-10-1 — origin −1 viewed in week 0 is age 1: the gray "since <Monday>" label', async () => {
    const { cookie } = await taskCreatedIn(MON.aug24);
    const res = await listWeek(t, cookie, 0);
    expect(res.tasks[0]?.carryWeeks).toBe(1);
    expect(res.tasks[0]?.originWeekStart).toBe(MON.aug24);
  });

  it('S-task-11-1 — origin −3 viewed in week 0 is age 3: the red "3 weeks · since …" chip', async () => {
    const { cookie } = await taskCreatedIn(MON.aug10);
    expect((await listWeek(t, cookie, 0)).tasks[0]?.carryWeeks).toBe(3);
  });

  it('S-task-11-2 — origin −2 viewed in week −1 is age 1: the label follows the VIEWED week, not today', async () => {
    const { cookie } = await taskCreatedIn(MON.aug17);
    expect((await listWeek(t, cookie, -1)).tasks[0]?.carryWeeks).toBe(1);
    expect((await listWeek(t, cookie, 0)).tasks[0]?.carryWeeks).toBe(2);
  });
});

describe('R-task-5/6 — origin is the current week, always', () => {
  it('S-task-5-1 — a task created while a past week is on screen still belongs to the current week', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { leaf } = await makeLine(t, userId);
    await activate(t, userId, leaf.id, MON.aug31);

    // The client is looking at week −2; creation carries no week and cannot back-date (R-task-6).
    expect((await listWeek(t, cookie, -2)).week.weekStart).toBe(MON.aug17);
    const task = await seedTask(t, cookie, { goalId: leaf.id, title: 'from an idea', source: 'idea' });

    expect(task.originWeekStart).toBe(MON.aug31);
    expect((await listWeek(t, cookie, -2)).tasks).toEqual([]);
    expect((await listWeek(t, cookie, 0)).tasks.map((x) => x.id)).toEqual([task.id]);
  });

  it('S-task-4-1 — a task against a DORMANT leaf is refused; there is no fallback goal (D-10)', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { life, leaf } = await makeLine(t, userId);
    // The leaf was active LAST week and is dormant this week: activity in a past week must not count.
    await activate(t, userId, leaf.id, MON.aug24);

    const dormant = await createTask(t, cookie, { goalId: leaf.id, title: 'nope' });
    expect(dormant.status).toBe(409);
    expect(dormant.json.error?.code).toBe('BRANCH_NOT_ACTIVE');

    // R-task-1 — a Life goal is not a target either, active or not.
    const onLife = await createTask(t, cookie, { goalId: life.id, title: 'nope' });
    expect(onLife.status).toBe(409);
    expect(onLife.json.error?.code).toBe('NOT_A_LEAF');
  });

  it('S-task-4-1 — a goal that has children is not a leaf, even with a focus row on it', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { life, leaf } = await makeLine(t, userId);
    await activate(t, userId, life.id, MON.aug31);
    await activate(t, userId, leaf.id, MON.aug31);

    const res = await createTask(t, cookie, { goalId: life.id, title: 'nope' });
    expect(res.status).toBe(409);
    expect(res.json.error?.code).toBe('NOT_A_LEAF');
  });
});

describe('R-nav-3/4 — the addressable weeks', () => {
  it('S-nav-3-1 — a future week is refused by the contract itself', async () => {
    const { cookie } = await signedInOwner(t);
    const res = await t.fetch('/api/tasks?week=1', { cookie });
    expect(res.status).toBe(422);
  });

  it('D-24 — one bound for both week controls: week −8 is out of range', async () => {
    const { cookie } = await signedInOwner(t);
    const res = await t.fetch('/api/tasks?week=-8', { cookie });
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe('WEEK_OUT_OF_RANGE');
    expect((await t.fetch('/api/tasks?week=-7', { cookie })).status).toBe(200);
  });
});
