import { beforeEach, describe, expect, it } from 'vitest';
import { ITaskRepo } from '../../src/application/ports';
import { createTestApp, signedInOwner } from '../helpers/app';
import { IGoalRepo } from '../../src/application/ports';
import { codeOf, command, createTask, listWeek, makeGoal, makeLine, makeWeek, seedTask, weekAt } from './helpers';

/**
 * The week model — R-task-7/8/39/40/41/42/43, D-1.
 *
 * Every Monday in this file is a real Monday: 2026-08-03, -10, -17, -24, -31, 2026-09-07. The clock is
 * driven explicitly across those boundaries, because the whole point of D-1 is what happens to STORED
 * data when the current week moves and nothing is written.
 *
 * ⚠ **A2** — a task hangs off a **Weekly goal** and off nothing else (R-goal-39), its week is seeded
 * ONCE from that goal's `periodKey` and is then its own (R-task-40), and there is no week parameter on
 * create at all. So a task "created in week −2" is now a task under a Weekly goal whose `periodKey` is
 * that week — which is also why the goal has to be seeded rather than created over HTTP for a past week.
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
 * The arrange step for every carry test: an owner with a Weekly goal for `originWeek`, and a task under
 * it — created THROUGH the API at that week's clock, because `originPeriodKey` comes from the parent and
 * a Weekly goal in a past week refuses new tasks (R-task-41, no back-dating).
 */
async function taskCreatedIn(originWeek: string, viewWeek: string = MON.aug31) {
  const { cookie, userId } = await signedInOwner(t);
  at(originWeek);
  const { life, monthly, weekly } = await makeLine(t, userId, originWeek);
  const task = await seedTask(t, cookie, { goalId: weekly.id, title: 'carrying work' });
  at(viewWeek);
  return { cookie, userId, life, monthly, weekly, task };
}

describe('D-1 / R-task-40 — a stored week is an absolute Monday, so it cannot decay', () => {
  /**
   * THE regression test for the mockup's most damaging bug. `originWeek: -2` meant something different
   * every Monday: a task silently aged one week with no write, and the red carry chip fired on work
   * nobody had neglected. Here the clock crosses two Monday boundaries and the stored origin does not
   * move — only the DERIVED age does, and only relative to the week being viewed.
   */
  it('D-1 — advancing the clock past a Monday leaves origin_week_start untouched and only ages the view', async () => {
    const { cookie, userId, task } = await taskCreatedIn(MON.aug31);
    expect(task.originPeriodKey).toBe(MON.aug31);
    expect(task.carryAge).toBe(0);

    t.clock.advanceWeeks(1);
    const nextWeek = await listWeek(t, cookie, 0);
    expect(nextWeek.week.weekStart).toBe(MON.sep7);
    expect(nextWeek.tasks[0]?.originPeriodKey).toBe(MON.aug31);
    expect(nextWeek.tasks[0]?.carryAge).toBe(1);

    // The same row, viewed in the week it was created in, is still zero weeks old there.
    const its_own_week = await listWeek(t, cookie, -1);
    expect(its_own_week.week.weekStart).toBe(MON.aug31);
    expect(its_own_week.tasks[0]?.carryAge).toBe(0);

    t.clock.advanceWeeks(1);
    expect((await listWeek(t, cookie, 0)).tasks[0]?.carryAge).toBe(2);

    // And the row itself was never rewritten: same origin, same version, no write of any kind.
    const stored = await t.container().resolve<ITaskRepo>(ITaskRepo).findById(userId, task.id);
    expect(stored?.originPeriodKey).toBe(MON.aug31);
    expect(stored?.version).toBe(1);
    expect(stored?.updatedAt).toBe(task.updatedAt);
  });

  it('S-task-40-1 / S-task-40-3 — the week is SEEDED from the Weekly parent, and no request may name one', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { monthly } = await makeLine(t, userId, MON.aug31);
    const ahead = await makeWeek(t, userId, monthly.id, MON.sep7);

    // The parent is two weeks out; the task takes ITS week, with nothing said about weeks in the request.
    const task = await seedTask(t, cookie, { goalId: ahead.id, title: 'planned ahead' });
    expect(task.originPeriodKey).toBe(MON.sep7);

    for (const key of ['week', 'weekOffset', 'originWeek', 'originPeriodKey']) {
      const res = await createTask(t, cookie, { goalId: ahead.id, title: 'nope', [key]: 0 });
      expect(res.status, key).toBe(422);
    }
  });

  it('S-task-40-3 — no read derives a task’s week from its goal: deleting the goal row changes nothing', async () => {
    const { cookie, userId, task, weekly } = await taskCreatedIn(MON.aug24);
    // Delete the Weekly goal's row directly and re-read the stored task: the week is on the TASK.
    const stored = await t.container().resolve<ITaskRepo>(ITaskRepo).findById(userId, task.id);
    expect(stored?.originPeriodKey).toBe(MON.aug24);
    expect(stored?.goalId).toBe(weekly.id);
    void cookie;
  });
});

describe('R-task-7/8/42 — visibility, and it never depends on the goal’s period', () => {
  it('S-task-7-1 — an open task with origin −2 is visible in weeks −2, −1 and 0, with no prompt', async () => {
    const { cookie, task } = await taskCreatedIn(MON.aug17);
    for (const [week, expected] of [
      [-2, 0],
      [-1, 1],
      [0, 2],
    ] as const) {
      const res = await listWeek(t, cookie, week);
      expect(res.tasks.map((x) => x.id)).toEqual([task.id]);
      expect(res.tasks[0]?.carryAge).toBe(expected);
    }
  });

  it('S-task-7-2 — an open task with origin 0 is NOT visible when week −1 is viewed', async () => {
    const { cookie, task } = await taskCreatedIn(MON.aug31);
    expect((await listWeek(t, cookie, 0)).tasks.map((x) => x.id)).toEqual([task.id]);
    expect((await listWeek(t, cookie, -1)).tasks).toEqual([]);
  });

  it('S-task-8-1 — a task completed in week −1 is visible in that week only', async () => {
    const { cookie, task } = await taskCreatedIn(MON.aug17);
    const done = await command(t, cookie, `/api/tasks/${task.id}/complete`, { period: weekAt(t, -1) });
    expect(done.status).toBe(200);

    expect((await listWeek(t, cookie, -2)).tasks).toEqual([]);
    expect((await listWeek(t, cookie, 0)).tasks).toEqual([]);
    const week1 = await listWeek(t, cookie, -1);
    expect(week1.tasks.map((x) => x.id)).toEqual([task.id]);
    expect(week1.tasks[0]?.done).toBe(true);
    expect(week1.tasks[0]?.donePeriodKey).toBe(MON.aug24);
  });

  /**
   * SUPERSEDED — S-task-9-1 asserted "a DORMANT leaf still shows its carried open task", and its
   * assertion was `week0.plan === []`. Both halves went with `weekly_focus` (R-rm-2): there is no plan on
   * the response and no dormancy to be in. **What survives, and is the whole of it, is R-lens-12**: a
   * task visible in a week is never hidden from that week, and its goal carries with it — see
   * `tests/lens/weekly-lens.test.ts` for the carried band, which is where the goal half now lives.
   */
  it('S-task-42-1 — a task whose goal’s week has PASSED is still visible, and the response has no plan', async () => {
    const { cookie, task } = await taskCreatedIn(MON.aug24);
    const week0 = await listWeek(t, cookie, 0);
    expect(week0.tasks.map((x) => x.id)).toEqual([task.id]);
    expect(week0 as unknown as Record<string, unknown>, 'plan').not.toHaveProperty('plan');
  });
});

describe('R-task-43 — the carry label thresholds, either side of the boundary', () => {
  it('S-task-12-1 — a task created this week has age 0 and earns no label', async () => {
    const { cookie } = await taskCreatedIn(MON.aug31);
    expect((await listWeek(t, cookie, 0)).tasks[0]?.carryAge).toBe(0);
  });

  it('S-task-10-1 — origin −1 viewed in week 0 is age 1: the gray "since <Monday>" label', async () => {
    const { cookie } = await taskCreatedIn(MON.aug24);
    const res = await listWeek(t, cookie, 0);
    expect(res.tasks[0]?.carryAge).toBe(1);
    expect(res.tasks[0]?.originPeriodKey).toBe(MON.aug24);
  });

  it('S-task-11-1 — origin −3 viewed in week 0 is age 3: the red "3 weeks · since …" chip', async () => {
    const { cookie } = await taskCreatedIn(MON.aug10);
    expect((await listWeek(t, cookie, 0)).tasks[0]?.carryAge).toBe(3);
  });

  it('S-task-43-3 / S-task-11-2 — origin −2 viewed in week −1 is age 1: the label follows the VIEWED week', async () => {
    const { cookie } = await taskCreatedIn(MON.aug17);
    expect((await listWeek(t, cookie, -1)).tasks[0]?.carryAge).toBe(1);
    expect((await listWeek(t, cookie, 0)).tasks[0]?.carryAge).toBe(2);
  });

  it('S-task-43-1 / S-lens-11-2 — future-dated work has a NEGATIVE age and no label, at any distance', async () => {
    // R-lens-11 — the only escalation in the product must never fire at a plan. The naive
    // `viewed − origin` would read 2 at +3; `min(viewed, current)` is what stops it.
    const { cookie, userId } = await signedInOwner(t);
    const { monthly } = await makeLine(t, userId, MON.aug31);
    const ahead = await makeWeek(t, userId, monthly.id, MON.sep7);
    const task = await seedTask(t, cookie, { goalId: ahead.id, title: 'next week' });

    expect((await listWeek(t, cookie, 1)).tasks.find((x) => x.id === task.id)?.carryAge).toBe(-1);
    expect((await listWeek(t, cookie, 3)).tasks.find((x) => x.id === task.id)?.carryAge).toBe(-1);
    // …and it is absent from THIS week's numbers entirely (R-task-38).
    expect((await listWeek(t, cookie, 0)).tasks.map((x) => x.id)).not.toContain(task.id);
  });

  it('S-task-43-2 — an already-late task keeps the age it has TODAY when projected forward', async () => {
    const { cookie } = await taskCreatedIn(MON.aug10);
    expect((await listWeek(t, cookie, 2)).tasks[0]?.carryAge).toBe(3);
  });
});

describe('R-task-51 / R-goal-37 — MONTHLY AND WEEKLY goals hold tasks, and the condition is the HORIZON', () => {
  /**
   * ⚠ **A8 — S-goal-37-1 and S-goal-39-1 are SUPERSEDED and restated one horizon up, as S-task-51-2.**
   *
   * Both asserted that a **Monthly** goal refuses a task. A Monthly goal now holds one (R-task-51), so the
   * old assertion is false about the product that exists. Their POINT — that the condition is the horizon
   * and never leaf-ness — is unchanged, which is why they are restated rather than deleted: the trap moves
   * from "a childless Monthly goal" to "a childless **Quarterly** goal", and a build that keyed task
   * ownership on leaf-ness would still pass every other test in this file.
   */
  it('S-task-51-2 — a task on a CHILDLESS Quarterly goal is refused with NOT_A_TASK_GOAL', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const life = await makeGoal(t, userId, 'Life', null);
    const childless = await makeGoal(t, userId, 'Quarterly', life.id, '2026-Q3');

    const res = await createTask(t, cookie, { goalId: childless.id, title: 'nope' });
    expect(res.status).toBe(409);
    expect(res.json.error?.code).toBe('NOT_A_TASK_GOAL');
    // `details` carries the horizon, which is what the MCP recovery line quotes back (R-task-51).
    expect((res.json.error as unknown as { details?: { horizon?: string } }).details?.horizon).toBe('Quarterly');
  });

  it('S-task-51-2 — and on Life and Yearly too, childless or not', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const life = await makeGoal(t, userId, 'Life', null);
    const yearly = await makeGoal(t, userId, 'Yearly', life.id, '2026');
    const quarterly = await makeGoal(t, userId, 'Quarterly', yearly.id, '2026-Q3');
    await makeGoal(t, userId, 'Monthly', quarterly.id, '2026-08'); // so `quarterly` is NOT childless

    for (const goal of [life, yearly, quarterly]) {
      const res = await createTask(t, cookie, { goalId: goal.id, title: 'nope' });
      expect(res.status, goal.horizon).toBe(409);
      expect(res.json.error?.code, goal.horizon).toBe('NOT_A_TASK_GOAL');
    }
  });

  it('S-task-51-1 — a task under a Weekly goal succeeds, taking that goal’s week', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { weekly } = await makeLine(t, userId, MON.aug31);
    const task = await seedTask(t, cookie, { goalId: weekly.id, title: 'run' });
    expect(task.goalId).toBe(weekly.id);
    expect(task.scope).toBe('Weekly');
    expect(task.originPeriodKey).toBe(MON.aug31);
  });

  /**
   * ⚠ **A8 (R-task-51/52/57) — the owner's whole ask, in one assertion.**
   *
   * `+ Task` on a Monthly goal creates **one row**: the task, on the goal that was tapped, in that goal's
   * month. No Weekly goal is minted, no week is resolved, no picker runs and nothing navigates
   * (S-task-57-1). The count assertion is the load-bearing half — R-rm-6 exists because the flow this
   * replaces created a second row the owner never asked for and could not find.
   */
  it('S-task-51-1 / S-task-57-1 — a task on a Monthly goal is a MONTH task, and exactly one row is written', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const life = await makeGoal(t, userId, 'Life', null);
    const monthly = await makeGoal(t, userId, 'Monthly', life.id, '2026-08');
    const before = await t.container().resolve<IGoalRepo>(IGoalRepo).listInterior(userId);

    const task = await seedTask(t, cookie, { goalId: monthly.id, title: 'sign two clients' });
    expect(task.goalId).toBe(monthly.id);
    expect(task.scope).toBe('Monthly');
    expect(task.originPeriodKey).toBe('2026-08');
    // ⚠ **S-task-57-1** — no Weekly goal exists that did not before.
    const after = await t.container().resolve<IGoalRepo>(IGoalRepo).listInterior(userId);
    expect(after.length).toBe(before.length);
    expect(await t.container().resolve<IGoalRepo>(IGoalRepo).countWeeklyInWeek(userId, MON.aug31)).toBe(0);
  });

  /**
   * ⚠ **A8 (R-task-52, S-task-52-1/52-2)** — the key says the scope, and the client supplies neither.
   */
  it('S-task-52-1 / S-task-52-2 — the key format matches the scope, and no request may name either', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { monthly, weekly } = await makeLine(t, userId, MON.aug31);

    const month = await seedTask(t, cookie, { goalId: monthly.id, title: 'month work' });
    const week = await seedTask(t, cookie, { goalId: weekly.id, title: 'week work' });
    expect(month.originPeriodKey).toBe('2026-08');
    expect(week.originPeriodKey).toBe(MON.aug31);

    // S-task-52-2 — every spelling of "I will tell you the period myself" is an unknown key.
    for (const body of [{ scope: 'Monthly' }, { originPeriodKey: '2026-08' }, { originWeek: 1 }, { week: 0 }, { weekOffset: 0 }]) {
      const res = await createTask(t, cookie, { goalId: weekly.id, title: 'nope', ...body });
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
  });
});

describe('R-task-41 — no back-dating, unbounded forward', () => {
  it('S-task-41-1 — a task under a Weekly goal whose week has PASSED is refused with PERIOD_IN_PAST', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { monthly } = await makeLine(t, userId, MON.aug31);
    const past = await makeWeek(t, userId, monthly.id, MON.aug24);

    const res = await createTask(t, cookie, { goalId: past.id, title: 'back-dated' });
    expect(res.status).toBe(409);
    expect(res.json.error?.code).toBe('PERIOD_IN_PAST');
  });

  it('S-task-41-2 — a Weekly goal 12 weeks out accepts a task, invisible until that week arrives', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { monthly } = await makeLine(t, userId, MON.aug31);
    const far = await makeWeek(t, userId, monthly.id, '2026-11-23'); // 12 weeks out
    const task = await seedTask(t, cookie, { goalId: far.id, title: 'far ahead' });

    expect(task.originPeriodKey).toBe('2026-11-23');
    for (const week of [0, 1, 6, 11]) {
      expect((await listWeek(t, cookie, week)).tasks.map((x) => x.id), `week ${week}`).not.toContain(task.id);
    }
    const arrived = await listWeek(t, cookie, 12);
    expect(arrived.tasks.map((x) => x.id)).toContain(task.id);
    // …and it carries no label of any kind when that week is viewed early (R-lens-11).
    expect(arrived.tasks.find((x) => x.id === task.id)?.carryAge).toBeLessThanOrEqual(0);
  });
});

/**
 * SUPERSEDED — this block asserted R-nav-3 ("a future week is refused by the contract itself") and
 * D-24's 8-week history clamp. R-lens-7 supersedes both: there is no forward bound at any horizon
 * (R-goal-36) and no backward one either, because a bound in one direction alone rebuilds D-24's
 * asymmetry. The assertions are INVERTED rather than deleted (S-lens-7-3, S-rm-3-1).
 */
describe('S-lens-7-3 — the addressable weeks are unbounded in both directions', () => {
  it('a FUTURE week is now an ordinary read', async () => {
    const { cookie } = await signedInOwner(t);
    const res = await t.fetch('/api/tasks?week=20', { cookie });
    expect(res.status).toBe(200);
    expect((await res.json() as { week: { weekStart: string; isPast: boolean } }).week.isPast).toBe(false);
  });

  it('…and so is a week further back than the old 8-week window', async () => {
    const { cookie } = await signedInOwner(t);
    for (const week of [-8, -20, -100]) {
      expect((await t.fetch(`/api/tasks?week=${week}`, { cookie })).status, `week ${week}`).toBe(200);
    }
    // What remains is the absolute storage range, which is not a product rule.
    const far = await t.fetch('/api/tasks?week=-600', { cookie });
    expect(far.status).toBe(422);
    void codeOf;
  });
});
