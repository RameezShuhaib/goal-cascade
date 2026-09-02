import type { LensResponse, MoveTaskToBacklogResponse, TaskResponse } from '@goal-cascade/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { IBacklogRepo } from '../../src/application/ports';
import { createTestApp, signedInOwner } from '../helpers/app';
import { codeOf, command, createTask, detail, listWeek, makeGoal, seedTask, texts } from './helpers';

/**
 * ⚠ **A8 — tasks at the month** (R-task-51 … R-task-59, R-lens-31/32, R-backlog-30/31).
 *
 * The claim A8 makes is that a month is the **same three comparisons one scale up**: visibility, carry
 * and completion, made within one scope against keys of one format. This file is where that claim is
 * either true or a comment. Every assertion here has a week-scoped twin somewhere in `week-model.test.ts`
 * or `exits.test.ts`; what is new is that the month answers the same way, and that the two scopes cannot
 * see each other's rows.
 *
 * The dates are the ones the spec argues from, and they are not arbitrary: **today is Wed 2 Sep 2026**,
 * so the current week is Mon 31 Aug — which belongs to **August** — while the current month is September.
 * That seam is where every off-by-one in this amendment would live (R-lens-29, S-task-53-3, S-task-55-2).
 */
const t = createTestApp({ now: '2026-09-02T10:00:00.000Z' }); // a Wednesday
const CURRENT_WEEK = '2026-08-31'; // …whose month is AUGUST
const AUG = '2026-08';
const SEP = '2026-09';

const NOW = '2026-09-02T10:00:00.000Z';
beforeEach(() => t.clock.set(NOW));

/** Life › Monthly(Aug) › Weekly(this week), plus a September Monthly goal for the seam cases. */
async function line() {
  const { cookie, userId } = await signedInOwner(t);
  const life = await makeGoal(t, userId, 'Life', null);
  const august = await makeGoal(t, userId, 'Monthly', life.id, AUG);
  const september = await makeGoal(t, userId, 'Monthly', life.id, SEP);
  const weekly = await makeGoal(t, userId, 'Weekly', august.id, CURRENT_WEEK);
  return { cookie, userId, life, august, september, weekly };
}

/**
 * ⚠ **The seam, from the arrange side, and it is worth stating in full because it surprised this build.**
 *
 * On Wed 2 Sep the current week is Mon 31 Aug, whose month is **August** — but `Aug 2026` is a **past
 * month** for planning, because `isPastPeriod('Monthly', '2026-08', today)` compares calendar months
 * (R-goal-36). So the month band on screen is August's while `+ Task` in it may only create into the
 * CURRENT or a later month (R-lens-31's own words). The two are not in tension: a past period is closed
 * to new **plan** and to nothing else, so an August month task can still be **completed** from that band
 * (S-task-55-2), moved to the backlog, parked and cancelled — it simply cannot be born there.
 *
 * A test therefore arranges an August month task the way `exits.test.ts` arranges a past week's task: by
 * rewinding the clock, which is the only thing R-goal-36 permits.
 */
async function seedMonthTask(cookie: string, goalId: string, whenIso: string, body: Record<string, unknown> = {}) {
  t.clock.set(whenIso);
  const task = await seedTask(t, cookie, { goalId, title: 'month work', ...body });
  t.clock.set(NOW);
  return task;
}

const lens = async (cookie: string, q: { lens: string; period?: string }): Promise<LensResponse> => {
  const qs = new URLSearchParams({ lens: q.lens, ...(q.period ? { period: q.period } : {}) });
  const res = await t.fetch(`/api/goals?${qs}`, { cookie });
  if (res.status !== 200) throw new Error(`lens ${res.status}: ${await res.text()}`);
  return (await res.json()) as LensResponse;
};

describe('R-task-53 — a month task carries into the next month, by the mechanism a week task carries', () => {
  it('S-task-53-1 — visible in every month at or after its origin, with no write and no job', async () => {
    const { cookie, august } = await line();
    const task = await seedMonthTask(cookie, august.id, '2026-08-10T10:00:00.000Z', { title: 'sign two clients' });

    for (const month of [AUG, SEP, '2026-10', '2026-11']) {
      const page = await lens(cookie, { lens: 'Monthly', period: month });
      expect(page.tasks.map((x) => x.id), month).toContain(task.id);
    }
    // …and in no month before it.
    expect((await lens(cookie, { lens: 'Monthly', period: '2026-07' })).tasks).toEqual([]);

    /**
     * The load-bearing half: **nothing was written**. Carrying is a `>=` comparison over lexicographically
     * sortable keys, which is why this product has no cron and why A8 does not give it one. The one thing
     * a read may produce is the cosmetic `Carried to …` line, and only for months that have ARRIVED
     * (R-task-38): reading November in September must log nothing.
     */
    const timeline = texts(await detail(t, cookie, task.id));
    expect(timeline.filter((x) => x.startsWith('Carried to'))).toEqual(['Carried to Sep 2026']);
    expect(timeline).not.toContain('Carried to Oct 2026');
    expect(timeline).not.toContain('Carried to Nov 2026');
  });

  it('S-task-53-2 — a DONE month task is visible in the month it was completed in and no other', async () => {
    const { cookie, august } = await line();
    const task = await seedMonthTask(cookie, august.id, '2026-08-10T10:00:00.000Z', { title: 'sign two clients' });
    expect((await command(t, cookie, `/api/tasks/${task.id}/complete`, { period: SEP })).status).toBe(200);

    expect((await lens(cookie, { lens: 'Monthly', period: SEP })).tasks.map((x) => x.id)).toEqual([task.id]);
    // Not in August, where it was open, and not in October.
    expect((await lens(cookie, { lens: 'Monthly', period: AUG })).tasks).toEqual([]);
    expect((await lens(cookie, { lens: 'Monthly', period: '2026-10' })).tasks).toEqual([]);
  });

  /**
   * ⚠ **S-task-52-1 — the two scopes cannot see each other's rows, and this is not a formality.**
   *
   * `'2026-08' <= '2026-09-07'` is TRUE as a string comparison, so a month task would appear in every
   * week list from September onward if `scope` were not in the query's predicate. This asserts the SQL
   * half of `isVisibleInPeriod`'s first line.
   */
  it('S-task-52-1 — a month task is in no week list, and a week task is in no month lens', async () => {
    const { cookie, august, weekly } = await line();
    const month = await seedMonthTask(cookie, august.id, '2026-08-10T10:00:00.000Z');
    const week = await seedTask(t, cookie, { goalId: weekly.id, title: 'week work' });

    expect((await listWeek(t, cookie)).tasks.map((x) => x.id)).toEqual([week.id]);
    expect((await lens(cookie, { lens: 'Monthly', period: AUG })).tasks.map((x) => x.id)).toEqual([month.id]);
    for (const offset of [0, 1, 2, 5]) {
      expect((await listWeek(t, cookie, offset)).tasks.map((x) => x.id), `week +${offset}`).not.toContain(month.id);
    }
  });
});

describe('R-lens-31 — the month band, and the Monday rule that decides which month it is', () => {
  /**
   * **S-task-53-3 — the whole seam, in one test.**
   *
   * Today is Wed 2 Sep 2026. The Weekly lens is at the week of Mon 31 Aug, and Mon 31 Aug belongs to
   * AUGUST — so the band is August's, not September's, on a day in September. This is the same rule that
   * makes `Sep 2026` run 7 Sep – 4 Oct and the same rule `This week is in Aug 2026` already tells the
   * owner about. One rule, said once more.
   */
  it('S-task-53-3 — the week of Mon 31 Aug shows AUGUST’s month tasks, on 2 September', async () => {
    const { cookie, august, september } = await line();
    const augTask = await seedMonthTask(cookie, august.id, '2026-08-10T10:00:00.000Z', { title: 'august work' });
    const sepTask = await seedTask(t, cookie, { goalId: september.id, title: 'september work' });

    const week = await lens(cookie, { lens: 'Weekly', period: CURRENT_WEEK });
    expect(week.monthPeriodKey).toBe(AUG);
    expect(week.monthTasks.map((x) => x.id)).toEqual([augTask.id]);
    expect(week.monthTasks.map((x) => x.id)).not.toContain(sepTask.id);

    // September's task first appears in the week of Mon 7 Sep, which is September's first week.
    const next = await lens(cookie, { lens: 'Weekly', period: '2026-09-07' });
    expect(next.monthPeriodKey).toBe(SEP);
    expect(next.monthTasks.map((x) => x.id)).toContain(sepTask.id);
    // …and August's carries into it, because an open month task is visible in every later month.
    expect(next.monthTasks.map((x) => x.id)).toContain(augTask.id);
  });

  it('S-lens-31-1 — the band is a separate array from the week’s own tasks, and empty when the month holds none', async () => {
    const { cookie, august, weekly } = await line();
    const week = await seedTask(t, cookie, { goalId: weekly.id, title: 'week work' });

    const before = await lens(cookie, { lens: 'Weekly', period: CURRENT_WEEK });
    expect(before.tasks.map((x) => x.id)).toEqual([week.id]);
    expect(before.monthTasks).toEqual([]);

    const month = await seedMonthTask(cookie, august.id, '2026-08-10T10:00:00.000Z');
    const after = await lens(cookie, { lens: 'Weekly', period: CURRENT_WEEK });
    // Never mixed: the whole point of two arrays is that the band is not this week's plan.
    expect(after.tasks.map((x) => x.id)).toEqual([week.id]);
    expect(after.monthTasks.map((x) => x.id)).toEqual([month.id]);
  });

  it('S-lens-31-2 — the band’s rows carry their honest MONTH-scale age, in months, not weeks', async () => {
    const { cookie, userId, life } = await line();
    // A month task from June, carried into August: three months old, and it must say months.
    const june = await makeGoal(t, userId, 'Monthly', life.id, '2026-06');
    t.clock.set('2026-06-10T10:00:00.000Z');
    const task = await seedTask(t, cookie, { goalId: june.id, title: 'still not done' });
    t.clock.set('2026-09-02T10:00:00.000Z');

    const row = (await lens(cookie, { lens: 'Weekly', period: CURRENT_WEEK })).monthTasks[0]!;
    expect(row.id).toBe(task.id);
    /**
     * ⚠ **The value is honest and the SUPPRESSION is the render site's** (R-task-54). If the server
     * zeroed it here, the same task in the Monthly lens — where the chip is correct and required — would
     * have to be fetched a second way. The client suppresses; the wire does not lie.
     */
    expect(row.carryUnit).toBe('months');
    expect(row.carryAge).toBe(2); // June → August, measured at the CURRENT month
    // …and it is the same value the Monthly lens gives, which is what makes one field serve both.
    const inMonthly = (await lens(cookie, { lens: 'Monthly', period: AUG })).tasks.find((x) => x.id === task.id)!;
    expect(inMonthly.carryAge).toBe(row.carryAge);
    expect(inMonthly.carryUnit).toBe('months');
  });

  /**
   * ⚠ **S-lens-31-3 — the group header counts WEEK tasks only, and this is the number that would lie.**
   *
   * R-lens-4's count answers *"what is on me this week"*. A month task is precisely the work A8 exists to
   * say is **not** on you this week, so counting one here would contradict, in a number, the no-late rule
   * of the band that renders it one row below.
   */
  it('S-lens-31-3 — four open month tasks do not appear in the group header’s open count', async () => {
    const { cookie, august, weekly } = await line();
    await seedTask(t, cookie, { goalId: weekly.id, title: 'the one week task' });
    for (const n of [1, 2, 3, 4]) await seedMonthTask(cookie, august.id, '2026-08-10T10:00:00.000Z', { title: `month ${n}` });

    for (const q of [{ lens: 'Weekly', period: CURRENT_WEEK }, { lens: 'Monthly', period: AUG }, { lens: 'Life' }]) {
      const page = await lens(cookie, q);
      expect(page.groups.map((g) => g.openTasks), JSON.stringify(q)).toEqual([1]);
    }
  });

  it('S-lens-32-2 — no other lens returns a task, because those horizons hold none', async () => {
    const { cookie, august, weekly } = await line();
    await seedMonthTask(cookie, august.id, '2026-08-10T10:00:00.000Z');
    await seedTask(t, cookie, { goalId: weekly.id, title: 'week work' });

    for (const q of [{ lens: 'Life' }, { lens: 'Yearly', period: '2026' }, { lens: 'Quarterly', period: '2026-Q3' }]) {
      const page = await lens(cookie, q);
      expect(page.tasks, JSON.stringify(q)).toEqual([]);
      expect(page.monthTasks, JSON.stringify(q)).toEqual([]);
      expect(page.monthPeriodKey, JSON.stringify(q)).toBeNull();
    }
    // The Monthly lens carries its tasks in `tasks` and has NO band: a month task carries onto the same
    // goal, so there is nothing to separate it from (R-lens-32's stated absence).
    const monthly = await lens(cookie, { lens: 'Monthly', period: AUG });
    expect(monthly.tasks).toHaveLength(1);
    expect(monthly.monthTasks).toEqual([]);
    expect(monthly.monthPeriodKey).toBeNull();
  });
});

describe('R-task-55 — completion is bounded in the task’s own scope', () => {
  /**
   * **S-task-55-2 — the seam, and the reason `period` replaced `week_offset`.**
   *
   * On 2 Sep the month band of the current week is AUGUST's. Completing from it writes `2026-08` — a past
   * month — and the write succeeds, because R-goal-36 closes a past period to *plan* and to nothing else.
   * Nothing consulted "the current month" to decide it: the client named the period it was standing in,
   * which an offset could not have expressed.
   */
  it('S-task-55-2 — completing from the month band writes the month the WEEK is in, not today’s month', async () => {
    const { cookie, august } = await line();
    const task = await seedMonthTask(cookie, august.id, '2026-08-10T10:00:00.000Z', { title: 'august work' });

    const res = await command(t, cookie, `/api/tasks/${task.id}/complete`, { period: AUG });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TaskResponse;
    expect(body.task.donePeriodKey).toBe(AUG);
    expect(body.task.doneAt).toBe('2026-09-02T10:00:00.000Z');
  });

  it('S-task-55-1 — a FUTURE month is refused, and the row says so before it is tried', async () => {
    const { cookie, userId, life } = await line();
    const december = await makeGoal(t, userId, 'Monthly', life.id, '2026-12');
    const task = await seedTask(t, cookie, { goalId: december.id, title: 'not yet' });

    for (const period of ['2026-12', '2027-01']) {
      const res = await command(t, cookie, `/api/tasks/${task.id}/complete`, { period });
      expect(res.status, period).toBe(422);
      expect(await codeOf(res), period).toBe('WEEK_OUT_OF_RANGE');
    }
    // `completable` is on the wire so the client renders no checkbox rather than re-deriving the rule.
    const row = (await lens(cookie, { lens: 'Monthly', period: '2026-12' })).tasks[0]!;
    expect(row.completable).toBe(false);
  });

  it('S-task-55-1 — a month EARLIER than the task’s origin is refused too', async () => {
    const { cookie, august } = await line();
    const task = await seedMonthTask(cookie, august.id, '2026-08-10T10:00:00.000Z', { title: 'august work' });
    const res = await command(t, cookie, `/api/tasks/${task.id}/complete`, { period: '2026-07' });
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe('WEEK_OUT_OF_RANGE');
  });

  it('R-task-55 — the scopes do not cross: a Monday is not a legal completion period for a month task', async () => {
    const { cookie, august } = await line();
    const task = await seedMonthTask(cookie, august.id, '2026-08-10T10:00:00.000Z', { title: 'august work' });
    // `2026-08-31` sorts ABOVE `2026-08`, so an unscoped bound would happily accept it and stamp a
    // Monday into `done_period_key` — a value no month lens could ever match again.
    const res = await command(t, cookie, `/api/tasks/${task.id}/complete`, { period: CURRENT_WEEK });
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe('WEEK_OUT_OF_RANGE');
  });
});

describe('R-task-57 / R-goal-36 — creating a month task, and the two bounds on it', () => {
  it('S-task-57-2 — a PAST month refuses the create, and a month six ahead accepts it unbounded', async () => {
    const { cookie, userId, life } = await line();
    const july = await makeGoal(t, userId, 'Monthly', life.id, '2026-07');
    const march = await makeGoal(t, userId, 'Monthly', life.id, '2027-03');

    const past = await createTask(t, cookie, { goalId: july.id, title: 'too late' });
    expect(past.status).toBe(409);
    expect(past.json.error?.code).toBe('PERIOD_IN_PAST');

    const ahead = await seedTask(t, cookie, { goalId: march.id, title: 'a long way off' });
    expect(ahead.originPeriodKey).toBe('2027-03');
    // Invisible in every earlier month, and carrying NO label when its month is viewed early
    // (R-lens-11 — the escalation must never fire at a plan).
    expect((await lens(cookie, { lens: 'Monthly', period: SEP })).tasks).toEqual([]);
    const row = (await lens(cookie, { lens: 'Monthly', period: '2027-03' })).tasks[0]!;
    expect(row.carryAge).toBeLessThan(0);
  });

  /**
   * ⚠ **A11 (`32-week-selection` §8.3) — a week is an explicit choice, and the month is the default.**
   *
   * The owner's ruling: `+ Task` on a Monthly goal defaults to the MONTH. Naming one of that month's
   * Mondays takes R-backlog-31's `Add to this week` path for a fresh task. Both are asserted here,
   * together, because the pair is the whole design: a control the owner drives is not an inference.
   */
  it('R-task-57 / A11 — naming a week on a Monthly goal resolves the weekly goal under it', async () => {
    const { cookie, august, weekly } = await line();

    const asMonth = await seedMonthTask(cookie, august.id, '2026-08-10T10:00:00.000Z', { title: 'no particular week' });
    expect(asMonth.scope).toBe('Monthly');
    expect(asMonth.goalId).toBe(august.id);

    // ⚠ The WEEK path is not back-dating: the week of Mon 31 Aug is the CURRENT week, which R-goal-36
    // permits, even though the month that contains it is past. The bound is checked at the scope named.
    const asWeek = await seedTask(t, cookie, { goalId: august.id, period: CURRENT_WEEK, title: 'this week' });
    expect(asWeek.scope).toBe('Weekly');
    expect(asWeek.goalId).toBe(weekly.id); // resolved, not the goal that was named
    expect(asWeek.originPeriodKey).toBe(CURRENT_WEEK);
  });

  it('R-task-57 / A11 — a week with NO weekly goal under it is NO_WEEKLY_GOAL, and mints nothing', async () => {
    const { cookie, userId, september } = await line();
    const res = await createTask(t, cookie, { goalId: september.id, period: '2026-09-07', title: 'next week' });
    expect(res.status).toBe(409);
    expect(res.json.error?.code).toBe('NO_WEEKLY_GOAL');
    // ⚠ The refusal is the point: the flow R-rm-6 deletes would have minted one silently.
    expect(await t.container().resolve<import('../../src/application/ports').IGoalRepo>(
      (await import('../../src/application/ports')).IGoalRepo,
    ).countWeeklyInWeek(userId, '2026-09-07')).toBe(0);
  });

  it('R-task-52 — a period that is not the goal’s own month, or of another horizon, is refused', async () => {
    const { cookie, august } = await line();
    for (const period of [SEP, '2026', '2026-Q3']) {
      const res = await createTask(t, cookie, { goalId: august.id, period, title: 'nope' });
      expect(res.status, period).toBe(422);
    }
  });
});

describe('R-task-59 / R-backlog-30/31 — the boundary between a month task and a backlog item', () => {
  /**
   * **S-task-59-1 — the demotion, and the walk that terminates immediately.**
   *
   * A month task that has carried three months and earned its chip is answered by finishing it,
   * cancelling it, or admitting it is a *maybe*. Move to Backlog lands it on **the goal it is already
   * on**, because a Monthly goal holds both a backlog and tasks, deliberately (R-backlog-30). That is
   * the pressure valve without which a month task quietly becomes a second backlog.
   */
  it('S-task-59-1 — Move to Backlog lands a month task on the SAME monthly goal, with the month as provenance', async () => {
    const { cookie, userId, august } = await line();
    const task = await seedMonthTask(cookie, august.id, '2026-08-10T10:00:00.000Z', {
      title: 'maybe after all',
      description: 'the long version',
      links: ['https://example.com/a'],
    });

    const res = await command(t, cookie, `/api/tasks/${task.id}/move-to-backlog`, { period: AUG });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MoveTaskToBacklogResponse;

    expect(body.item.goalId).toBe(august.id); // the walk terminated at the goal it was already on
    expect(body.item.title).toBe('maybe after all');
    expect(body.item.description).toBe('the long version');
    expect(body.item.links.map((l) => l.url)).toEqual(['https://example.com/a']);
    // ⚠ The provenance is the MONTH, which renders `from Sep 2026` rather than `from week of …`.
    expect(body.item.fromPeriodKey).toBe(AUG);

    // The task left every month and every week.
    expect((await lens(cookie, { lens: 'Monthly', period: AUG })).tasks).toEqual([]);
    expect((await lens(cookie, { lens: 'Weekly', period: CURRENT_WEEK })).monthTasks).toEqual([]);
    const items = await t.container().resolve<IBacklogRepo>(IBacklogRepo).listOpen(userId);
    expect(items.map((i) => i.id)).toEqual([body.item.id]);
  });

  /**
   * **S-backlog-30-2 — both directions, one operation each, and neither offers a week.**
   *
   * This is what keeps the two concepts from collapsing into each other: the move between them is cheap
   * and explicit in both directions, so neither has to absorb the other's job.
   */
  it('S-backlog-30-2 — `Add to this month` promotes an item in place, on the goal it is already on', async () => {
    const { cookie, september } = await line();
    const created = await t.fetch('/api/backlog', {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { goalId: september.id, title: 'decided on it' },
    });
    const item = ((await created.json()) as { item: { id: string } }).item;

    const res = await command(t, cookie, `/api/backlog/${item.id}/convert-to-task`, { period: SEP });
    expect(res.status).toBe(201);
    const task = ((await res.json()) as { task: { goalId: string; scope: string; originPeriodKey: string } }).task;
    expect(task.goalId).toBe(september.id); // no resolution, no candidate list, no created goal
    expect(task.scope).toBe('Monthly');
    expect(task.originPeriodKey).toBe(SEP);
    // The item is CONSUMED, never duplicated (D-19), and is gone from every backlog list.
    const backlog = await t.fetch('/api/backlog', { cookie });
    expect(((await backlog.json()) as { items: { id: string }[] }).items.map((i) => i.id)).not.toContain(item.id);
  });

  it('S-backlog-31-2 — the month path exists only where a month does', async () => {
    const { cookie, userId, life } = await line();
    const quarterly = await makeGoal(t, userId, 'Quarterly', life.id, '2026-Q3');
    const created = await t.fetch('/api/backlog', {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { goalId: quarterly.id, title: 'on a quarter' },
    });
    const item = ((await created.json()) as { item: { id: string } }).item;

    const res = await command(t, cookie, `/api/backlog/${item.id}/convert-to-task`, { period: SEP });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('NOT_A_TASK_GOAL');
  });

  /**
   * **S-backlog-30-1 — the line, stated so it can be audited.**
   *
   * A backlog item is the only work object in this product with no period key, and a period key is
   * exactly what makes something appear in a lens. That is why backlog never appears in a week — not a
   * rendering choice, a consequence.
   */
  it('S-backlog-30-1 — a backlog item has no period, no checkbox and no age, and appears in no lens', async () => {
    const { cookie, august } = await line();
    const created = await t.fetch('/api/backlog', {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { goalId: august.id, title: 'maybe, someday' },
    });
    const item = ((await created.json()) as { item: Record<string, unknown> }).item;

    for (const forbidden of ['periodKey', 'originPeriodKey', 'scope', 'done', 'donePeriodKey', 'carryAge', 'cond', 'status_due']) {
      expect(Object.hasOwn(item, forbidden), forbidden).toBe(false);
    }
    // `fromPeriodKey` is provenance on a row that has no period of its own, and here there is none at all.
    expect(item.fromPeriodKey).toBeNull();

    // It appears in no lens, at either scope.
    expect((await lens(cookie, { lens: 'Monthly', period: AUG })).tasks).toEqual([]);
    const week = await lens(cookie, { lens: 'Weekly', period: CURRENT_WEEK });
    expect(week.tasks).toEqual([]);
    expect(week.monthTasks).toEqual([]);
  });
});

describe('R-task-58 — the timeline at month scale', () => {
  it('S-task-58-1 — `Carried to <Mon YYYY>` is the month form, and it is clamped at the current month', async () => {
    const { cookie, userId, life } = await line();
    const june = await makeGoal(t, userId, 'Monthly', life.id, '2026-06');
    t.clock.set('2026-06-10T10:00:00.000Z');
    const task = await seedTask(t, cookie, { goalId: june.id, title: 'since June' });
    t.clock.set('2026-09-02T10:00:00.000Z');

    // Read a month far ahead: R-task-38 says a month that has not arrived has not been crossed.
    await lens(cookie, { lens: 'Monthly', period: '2027-01' });
    const timeline = texts(await detail(t, cookie, task.id));
    expect(timeline).toContain('Carried to Jul 2026');
    expect(timeline).toContain('Carried to Aug 2026');
    // The current month is September (today is 2 Sep), so August is the last one crossed... and
    // September itself has begun, so it is crossed too.
    expect(timeline).toContain('Carried to Sep 2026');
    expect(timeline).not.toContain('Carried to Oct 2026');
    expect(timeline).not.toContain('Carried to Jan 2027');
    // …and never a week form on a month task.
    expect(timeline.some((x) => x.startsWith('Carried to week of'))).toBe(false);
  });

  it('R-task-29 / Q-17 — the producer is idempotent at month scale: two reads write one line', async () => {
    const { cookie, august } = await line();
    const task = await seedMonthTask(cookie, august.id, '2026-08-10T10:00:00.000Z', { title: 'august work' });
    for (let i = 0; i < 3; i++) await lens(cookie, { lens: 'Monthly', period: SEP });
    const carried = texts(await detail(t, cookie, task.id)).filter((x) => x === 'Carried to Sep 2026');
    expect(carried).toHaveLength(1);
  });
});

/**
 * ⚠ **THE SEAM, ON THE READ SIDE — R-goal-34, R-task-54, R-task-55.**
 *
 * `views.ts` splits two questions that look like one: **which month does this WEEK belong to**
 * (`periodForScope` — the band's question, R-lens-31) and **what is the current month**
 * (`currentPeriodOf` — from TODAY, R-goal-34). A read model that answers the second with the first is
 * wrong for the **1-6 days of every month before its first Monday**, which is exactly where the owner is
 * on 2 Sep 2026: the current week is Mon 31 Aug, whose month is August, while the current month is
 * September.
 *
 * The damage is not cosmetic. `completable` and `carryAge` are both clamped against "the current period",
 * so getting it wrong makes a **September month task un-completable in September** — the wire telling the
 * client to hide a checkbox for an action the server allows — and negatively aged in its own month, while
 * the timeline beside it has already logged `Carried to Sep 2026` from the correct clamp. Two halves of
 * one response disagreeing is worse than either being wrong alone.
 */
describe('R-goal-34 — every read clamps against the CURRENT month, never the current week’s month', () => {
  it('a month task in its OWN month is completable and age 0, in the lens as well as in the create response', async () => {
    const { cookie, september } = await line();
    const created = await seedTask(t, cookie, { goalId: september.id, title: 'this month’s work' });
    // The command response is built from `currentPeriodOf` and has always been right.
    expect(created.completable).toBe(true);
    expect(created.carryAge).toBe(0);

    // ...and the lens must agree with it. Clamping against the current WEEK's month (August) reads this
    // task as planned for a future month: `completable: false`, `carryAge: -1`.
    const row = (await lens(cookie, { lens: 'Monthly', period: SEP })).tasks.find((x) => x.id === created.id)!;
    expect(row.completable, 'the lens hid a checkbox for a completion the server allows').toBe(true);
    expect(row.carryAge, 'a task in its own month is not planned ahead').toBe(0);

    // The proof that the disagreement is real and not a matter of taste: the write the lens said was
    // illegal succeeds.
    expect((await command(t, cookie, `/api/tasks/${created.id}/complete`, { period: SEP })).status).toBe(200);
  });

  it('an Aug-origin month task reads age 1 in the Sep lens, agreeing with the `Carried to Sep 2026` beside it', async () => {
    const { cookie, august } = await line();
    const task = await seedMonthTask(cookie, august.id, '2026-08-10T10:00:00.000Z', { title: 'since August' });

    const row = (await lens(cookie, { lens: 'Monthly', period: SEP })).tasks.find((x) => x.id === task.id)!;
    expect(row.carryAge, 'the lens and the timeline disagreed about how far this has carried').toBe(1);
    expect(row.carryUnit).toBe('months');
    // `ensureCarried` uses the correct clamp, so the two must land on the same month.
    expect(texts(await detail(t, cookie, task.id))).toContain('Carried to Sep 2026');
  });

  it('the month band clamps the same way: a Sep task viewed from its own month’s week is not aged backwards', async () => {
    const { cookie, september } = await line();
    const task = await seedTask(t, cookie, { goalId: september.id, title: 'september work' });

    // The band of the week of Mon 7 Sep is September's; the task is in its own month, so age 0.
    const band = await lens(cookie, { lens: 'Weekly', period: '2026-09-07' });
    const row = band.monthTasks.find((x) => x.id === task.id)!;
    expect(row.carryAge).toBe(0);
    expect(row.completable).toBe(true);
  });

  it('a goal’s own detail page clamps the same way as its lens', async () => {
    const { cookie, september } = await line();
    const task = await seedTask(t, cookie, { goalId: september.id, title: 'on the goal page' });

    const res = await t.fetch(`/api/goals/${september.id}`, { cookie });
    const body = (await res.json()) as { tasks: { id: string; completable: boolean; carryAge: number }[] };
    const row = body.tasks.find((x) => x.id === task.id)!;
    expect(row.completable).toBe(true);
    expect(row.carryAge).toBe(0);
  });

  it('a backlog item promoted to THIS month comes back completable, not planned-ahead', async () => {
    const { cookie, september } = await line();
    const created = await t.fetch('/api/backlog', {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { goalId: september.id, title: 'decided on it' },
    });
    const item = ((await created.json()) as { item: { id: string } }).item;

    const res = await command(t, cookie, `/api/backlog/${item.id}/convert-to-task`, { period: SEP });
    expect(res.status).toBe(201);
    const task = ((await res.json()) as { task: { completable: boolean } }).task;
    expect(task.completable, 'a conversion into the current month answered `completable: false`').toBe(true);
  });
});
