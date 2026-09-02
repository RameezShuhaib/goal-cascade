import type { RetargetTaskResponse, TaskDetailResponse } from '@goal-cascade/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { IGoalRepo } from '../../src/application/ports';
import { createTestApp, signedInOwner } from '../helpers/app';
import { codeOf, command, detail, kinds, makeGoal, seedTask, texts } from './helpers';

/**
 * ⚠ **A8 — Park in a week / Move to the month** (R-task-56, S-task-56-1 … S-task-56-4).
 *
 * **The one operation that rewrites a task's scope, and the one that is most likely to be built as a
 * fourth exit by accident.** An exit takes work *out* of a period; Park moves it between two it was
 * already committed to, and the task stays open, visible and finishable throughout. Everything below is
 * organised around that distinction: what moves (three fields, together), what does not (everything
 * else, and every reading), and what is refused (both spellings of "reschedule").
 */
const t = createTestApp({ now: '2026-09-02T10:00:00.000Z' }); // Wed 2 Sep; the current week is Mon 31 Aug
const NOW = '2026-09-02T10:00:00.000Z';
const SEP = '2026-09';
const SEP_WEEK_1 = '2026-09-07';
const SEP_WEEK_2 = '2026-09-14';

beforeEach(() => t.clock.set(NOW));

/** Life › Monthly(Sep) with one Weekly goal in each of two September weeks. */
async function line() {
  const { cookie, userId } = await signedInOwner(t);
  const life = await makeGoal(t, userId, 'Life', null);
  const september = await makeGoal(t, userId, 'Monthly', life.id, SEP);
  const w1 = await makeGoal(t, userId, 'Weekly', september.id, SEP_WEEK_1);
  const w2 = await makeGoal(t, userId, 'Weekly', september.id, SEP_WEEK_2);
  return { cookie, userId, life, september, w1, w2 };
}

const retarget = (cookie: string, id: string, body: unknown) => command(t, cookie, `/api/tasks/${id}/retarget`, body);

describe('R-task-56 — parking a month task into a week', () => {
  /**
   * **S-task-56-1 — the three fields move together, and NOTHING else does.**
   *
   * A task's period is always its goal's period *at creation*; parking is a re-creation of that fact by
   * an explicit write, so `goalId`, `scope` and `originPeriodKey` are one change and not three. The
   * survival list is the other half of the assertion, and the readings are on it deliberately
   * (R-measure-5): a history that reset when work moved would be worthless.
   */
  it('S-task-56-1 — goalId, scope and originPeriodKey move together; title, links, timeline and readings do not', async () => {
    const { cookie, september, w2 } = await line();
    const task = await seedTask(t, cookie, {
      goalId: september.id,
      title: 'sign two clients',
      cond: 'both contracts signed',
      description: 'the long version',
      links: ['https://example.com/a'],
      measure: { kind: 'counter', start: 0, target: 2, unit: 'clients' },
    });
    await command(t, cookie, `/api/tasks/${task.id}/readings`, { delta: 1 });

    const res = await retarget(cookie, task.id, { period: SEP_WEEK_2 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as RetargetTaskResponse;

    expect(body.task.goalId).toBe(w2.id);
    expect(body.task.scope).toBe('Weekly');
    expect(body.task.originPeriodKey).toBe(SEP_WEEK_2);
    expect(body.task.carryUnit).toBe('weeks');
    // Nothing else changed.
    expect(body.task.title).toBe('sign two clients');
    expect(body.task.cond).toBe('both contracts signed');
    expect(body.task.description).toBe('the long version');
    expect(body.task.links.map((l) => l.url)).toEqual(['https://example.com/a']);
    // ⚠ **R-measure-5** — every reading survives, and `current` with it.
    expect(body.task.readings.map((r) => r.value)).toEqual([1]);
    expect(body.task.measure?.current).toBe(1);
    // …and no Weekly goal was invented: `w2` already existed.
    expect(body.goal).toBeNull();

    expect(texts(await detail(t, cookie, task.id))).toContain('Parked in the week of Mon 14 Sep');
    expect(kinds(await detail(t, cookie, task.id))).toContain('parked');
  });

  it('S-task-56-3 — two qualifying weekly goals are refused with the candidate list, and nothing is written', async () => {
    const { cookie, userId, september, w1 } = await line();
    const other = await makeGoal(t, userId, 'Weekly', september.id, SEP_WEEK_1);
    const task = await seedTask(t, cookie, { goalId: september.id, title: 'which week' });

    const res = await retarget(cookie, task.id, { period: SEP_WEEK_1 });
    expect(res.status).toBe(409);
    const err = (await res.json()) as { error: { code: string; details: { candidates: { id: string }[] } } };
    expect(err.error.code).toBe('AMBIGUOUS_CONVERSION_TARGET');
    // D-18 — the server refuses to pick, and it NAMES both so the owner can. Array order is not a decision.
    expect(err.error.details.candidates.map((c) => c.id).sort()).toEqual([w1.id, other.id].sort());

    const after = ((await detail(t, cookie, task.id)) as TaskDetailResponse).task;
    expect(after.goalId).toBe(september.id);
    expect(after.scope).toBe('Monthly');

    // Naming one of them succeeds.
    expect((await retarget(cookie, task.id, { period: SEP_WEEK_1, goalId: other.id })).status).toBe(200);
  });

  it('S-task-56-3 — no qualifying goal is NO_WEEKLY_GOAL, and the inline create makes both in ONE transaction', async () => {
    const { cookie, userId, september } = await line();
    const task = await seedTask(t, cookie, { goalId: september.id, title: 'a week with nothing in it' });
    const empty = '2026-09-21';

    const refused = await retarget(cookie, task.id, { period: empty });
    expect(refused.status).toBe(409);
    expect(await codeOf(refused)).toBe('NO_WEEKLY_GOAL');
    expect(await t.container().resolve<IGoalRepo>(IGoalRepo).countWeeklyInWeek(userId, empty)).toBe(0);

    const res = await retarget(cookie, task.id, {
      period: empty,
      newWeeklyGoal: { parentId: september.id, title: 'The week of the 21st' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as RetargetTaskResponse;
    expect(body.goal).not.toBeNull();
    expect(body.goal!.periodKey).toBe(empty);
    expect(body.task.goalId).toBe(body.goal!.id);
    expect(body.task.originPeriodKey).toBe(empty);
    expect(await t.container().resolve<IGoalRepo>(IGoalRepo).countWeeklyInWeek(userId, empty)).toBe(1);
  });

  it('S-task-56-3 — a PAST week, a done task and an exited task are each refused, and nothing is written', async () => {
    const { cookie, september, w2 } = await line();

    const past = await seedTask(t, cookie, { goalId: september.id, title: 'backwards' });
    // ⚠ `2026-08-31` is the CURRENT week on 2 Sep, not a past one — the seam again. A genuinely past
    // week is the one before it.
    const back = await retarget(cookie, past.id, { period: '2026-08-24' });
    expect(back.status).toBe(409);
    expect(await codeOf(back)).toBe('PERIOD_IN_PAST');

    const done = await seedTask(t, cookie, { goalId: september.id, title: 'already done' });
    expect((await command(t, cookie, `/api/tasks/${done.id}/complete`, { period: SEP })).status).toBe(200);
    const onDone = await retarget(cookie, done.id, { period: SEP_WEEK_2 });
    expect(onDone.status).toBe(409);
    expect(await codeOf(onDone)).toBe('TASK_ALREADY_EXITED');

    const gone = await seedTask(t, cookie, { goalId: september.id, title: 'cancelled' });
    expect((await command(t, cookie, `/api/tasks/${gone.id}/cancel`, {})).status).toBe(200);
    const onExited = await retarget(cookie, gone.id, { period: SEP_WEEK_2 });
    expect(onExited.status).toBe(409);
    expect(await codeOf(onExited)).toBe('TASK_ALREADY_EXITED');

    void w2;
  });
});

describe('R-task-56 — moving a week task back to its month', () => {
  it('S-task-56-2 — it lands on the nearest Monthly ancestor, at that goal’s month, with every reading intact', async () => {
    const { cookie, september, w1 } = await line();
    const task = await seedTask(t, cookie, {
      goalId: w1.id,
      title: 'not this week after all',
      measure: { kind: 'gauge', start: 80, target: 75, unit: 'kg' },
    });
    await command(t, cookie, `/api/tasks/${task.id}/readings`, { value: 78 });

    const res = await retarget(cookie, task.id, { period: SEP });
    expect(res.status).toBe(200);
    const body = (await res.json()) as RetargetTaskResponse;
    expect(body.task.goalId).toBe(september.id);
    expect(body.task.scope).toBe('Monthly');
    expect(body.task.originPeriodKey).toBe(SEP);
    expect(body.task.carryUnit).toBe('months');
    expect(body.task.readings.map((r) => r.value)).toEqual([78]);
    expect(body.task.measure?.current).toBe(78);
    // Un-parking resolves nothing, so nothing is ever created for it.
    expect(body.goal).toBeNull();

    expect(texts(await detail(t, cookie, task.id))).toContain('Moved to Sep 2026');
  });

  it('S-task-56-2 — a weekly goal with NO monthly ancestor has no month to move to', async () => {
    const { cookie, userId, life } = await line();
    // R-goal-32 permits a Weekly goal directly under a Life goal, which is where this case comes from.
    const orphan = await makeGoal(t, userId, 'Weekly', life.id, SEP_WEEK_1);
    const task = await seedTask(t, cookie, { goalId: orphan.id, title: 'nowhere above' });

    const res = await retarget(cookie, task.id, { period: SEP });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('HORIZON_CONFLICT');
  });

  it('R-task-56 — the month is DERIVED, so naming a different one is refused rather than redirected', async () => {
    const { cookie, w1 } = await line();
    const task = await seedTask(t, cookie, { goalId: w1.id, title: 'october instead' });
    const res = await retarget(cookie, task.id, { period: '2026-10' });
    expect(res.status).toBe(422);
    const err = (await res.json()) as { error: { details: { monthPeriodKey: string } } };
    expect(err.error.details.monthPeriodKey).toBe(SEP);
  });
});

describe('R-task-56 / S-task-56-4 — it is not a fourth exit, and it is not a reschedule', () => {
  /**
   * ⚠ **The two refusals that keep Park from becoming the operation R-task-13 does not have.**
   *
   * Moving a week task to a *different week* is `reschedule`. Moving a month task to a *different month*
   * is the same thing one scale up. Both are refused, because the product's answer to "not this week" is
   * one of the three exits, and its answer to "a different week" is to complete or cancel and write the
   * work again.
   */
  it('S-task-56-4 — a week task cannot be parked into another week, and a month task cannot move months', async () => {
    const { cookie, september, w1 } = await line();

    const week = await seedTask(t, cookie, { goalId: w1.id, title: 'next week instead' });
    const reschedule = await retarget(cookie, week.id, { period: SEP_WEEK_2 });
    expect(reschedule.status).toBe(422);

    const month = await seedTask(t, cookie, { goalId: september.id, title: 'october instead' });
    const slip = await retarget(cookie, month.id, { period: '2026-10' });
    expect(slip.status).toBe(422);
  });

  it('R-task-56 — retargeting to the period the task is already in is a no-op that writes NO event', async () => {
    const { cookie, september } = await line();
    const task = await seedTask(t, cookie, { goalId: september.id, title: 'already here' });
    const before = kinds(await detail(t, cookie, task.id));

    const res = await retarget(cookie, task.id, { period: SEP });
    expect(res.status).toBe(200);
    expect(((await res.json()) as RetargetTaskResponse).task.version).toBe(task.version);
    expect(kinds(await detail(t, cookie, task.id))).toEqual(before);
  });

  it('S-task-56-4 — a parked task is still OPEN and still visible, and the three exits are still three', async () => {
    const { cookie, september, w2 } = await line();
    const task = await seedTask(t, cookie, { goalId: september.id, title: 'still mine to finish' });
    await retarget(cookie, task.id, { period: SEP_WEEK_2 });

    const after = ((await detail(t, cookie, task.id)) as TaskDetailResponse).task;
    expect(after.status).toBe('open');
    expect(after.done).toBe(false);
    expect(after.goalId).toBe(w2.id);

    // No route named for the operation the product refuses to have (S-task-13-1, restated for Park).
    for (const path of ['defer', 'snooze', 'reschedule', 'move-to-week']) {
      expect((await command(t, cookie, `/api/tasks/${task.id}/${path}`, { period: SEP_WEEK_2 })).status).toBe(404);
    }
  });

  it('R-task-56 — a key of no task scope at all is refused', async () => {
    const { cookie, september } = await line();
    const task = await seedTask(t, cookie, { goalId: september.id, title: 'a year is not a destination' });
    for (const period of ['2026', '2026-Q4']) {
      expect((await retarget(cookie, task.id, { period })).status, period).toBe(422);
    }
  });
});
