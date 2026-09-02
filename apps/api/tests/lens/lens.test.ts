import { MAX_PAGE, MAX_WEEKLY_GOALS_PER_WEEK, type LensResponse, type ZoomResponse } from '@goal-cascade/shared';
import { describe, expect, it } from 'vitest';
import { createTestApp, signedInOwner } from '../helpers/app';
import { codeOf, createGoal, createGoalRaw, lens, seedGoal, seedTask } from '../goals/fixtures';

/**
 * The five lenses, end to end (R-lens-1 … R-lens-27).
 *
 * This is the surface the redesign exists for, so the assertions are the ones that would let it rot:
 * one horizon and one period per read, grouping resolved by the SERVER, the carried band separate from
 * the week's own plan and ordered oldest-first, no escalation on work that has not come due, and every
 * bound actually enforced.
 */
const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' }); // a Monday
const THIS_WEEK = '2026-08-31';
const NEXT_WEEK = '2026-09-07';

/** Two Life lines, each with a Yearly › Quarterly › Monthly chain and a Weekly goal for this week. */
async function twoLines(cookie: string) {
  const make = async (name: string) => {
    const life = await createGoal(t, cookie, { title: name, horizon: 'Life' });
    const yearly = await createGoal(t, cookie, { title: `${name} year`, horizon: 'Yearly', parentId: life.id });
    const quarterly = await createGoal(t, cookie, { title: `${name} quarter`, horizon: 'Quarterly', parentId: yearly.id });
    const monthly = await createGoal(t, cookie, { title: `${name} month`, horizon: 'Monthly', parentId: quarterly.id });
    const weekly = await createGoal(t, cookie, { title: `${name} week`, horizon: 'Weekly', parentId: monthly.id });
    return { life, yearly, quarterly, monthly, weekly };
  };
  return { a: await make('Health'), b: await make('Craft') };
}

describe('R-lens-1/2/3/5 — a lens is flat, account-wide, one period, grouped by Life goal', () => {
  it('S-lens-1-1 — every goal at that horizon, from ALL life lines, with no way into a subtree', async () => {
    const { cookie } = await signedInOwner(t);
    const { a, b } = await twoLines(cookie);

    const quarterly = await lens(t, cookie, { lens: 'Quarterly', period: '2026-Q3' });
    expect(quarterly.items.map((g) => g.id).sort()).toEqual([a.quarterly.id, b.quarterly.id].sort());
    // R-lens-3 — the SERVER resolved each item's group; the client walks no ancestor chain.
    expect(quarterly.items.find((g) => g.id === a.quarterly.id)?.lifeRootId).toBe(a.life.id);
    expect(quarterly.items.find((g) => g.id === b.quarterly.id)?.lifeRootId).toBe(b.life.id);
  });

  it('S-lens-2-1 — one horizon and one period only', async () => {
    const { cookie } = await signedInOwner(t);
    const { a } = await twoLines(cookie);
    await createGoal(t, cookie, { title: 'Q4', horizon: 'Quarterly', parentId: a.yearly.id, periodKey: '2026-Q4' });

    const q3 = await lens(t, cookie, { lens: 'Quarterly', period: '2026-Q3' });
    expect(q3.items.every((g) => g.horizon === 'Quarterly')).toBe(true);
    expect(q3.items.every((g) => g.periodKey === '2026-Q3')).toBe(true);
    expect(q3.items.map((g) => g.title)).not.toContain('Q4');
  });

  it('S-lens-3-1 — grouping is depth-independent, and a Weekly goal off a LIFE goal groups the same way', async () => {
    const { cookie } = await signedInOwner(t);
    const { a } = await twoLines(cookie);
    const direct = await createGoal(t, cookie, { title: 'a weekly practice', horizon: 'Weekly', parentId: a.life.id });

    const week = await lens(t, cookie, { lens: 'Weekly', period: THIS_WEEK });
    expect(week.items.find((g) => g.id === direct.id)?.lifeRootId).toBe(a.life.id);
    expect(week.items.find((g) => g.id === a.weekly.id)?.lifeRootId).toBe(a.life.id);
  });

  it('S-lens-3-2 / R-lens-20 — a broken chain groups under UNSORTED, pinned last, and is never dropped', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { a } = await twoLines(cookie);
    // Not reachable through the product: `checkCreate` refuses a parentless non-Life goal, and a
    // dangling `parentId` cannot be written. It is a DATA-INTEGRITY surface, and it must surface.
    const orphan = await seedGoal(t, userId, { parentId: 'ghost-goal-id', horizon: 'Weekly', title: 'orphaned', periodKey: THIS_WEEK });

    const week = await lens(t, cookie, { lens: 'Weekly', period: THIS_WEEK });
    expect(week.items.map((g) => g.id)).toContain(orphan.id);
    expect(week.items.find((g) => g.id === orphan.id)?.lifeRootId).toBeNull();
    expect(week.groups.at(-1)).toMatchObject({ id: null, title: 'UNSORTED' });
    expect(week.groups.some((g) => g.id === a.life.id)).toBe(true);
    void a;
  });

  it('S-lens-3-3 / S-rm-4-1 — no lens read accepts a goal filter of any kind', async () => {
    const { cookie } = await signedInOwner(t);
    expect((await t.fetch('/api/goals?lens=Weekly&goalId=01J9ZQ8V2M7K3PQRSTVWXY0123', { cookie })).status).toBe(422);
    expect((await t.fetch('/api/goals?lens=Weekly&under_goal_id=x', { cookie })).status).toBe(422);
  });

  it('S-lens-5-1 — groups run in the Life goals’ own createdAt/id order, with UNSORTED last', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { a, b } = await twoLines(cookie);
    await seedGoal(t, userId, { parentId: 'ghost', horizon: 'Weekly', title: 'orphan', periodKey: THIS_WEEK });

    const week = await lens(t, cookie, { lens: 'Weekly', period: THIS_WEEK });
    expect(week.groups.map((g) => g.id)).toEqual([a.life.id, b.life.id, null]);
    // …and it is identical on every read of an unchanged account.
    const again = await lens(t, cookie, { lens: 'Weekly', period: THIS_WEEK });
    expect(again.groups.map((g) => g.id)).toEqual(week.groups.map((g) => g.id));
  });

  it('S-lens-6-1 / R-lens-19 — a group with NO items in the selected period is not rendered at all', async () => {
    // *Retires R-lens-6's empty-group clause.* A twelve-line account would otherwise render twelve
    // headers on a lens where two have items, which is the clutter complaint restated. The Life lens
    // is where every Life goal is guaranteed visible.
    const { cookie } = await signedInOwner(t);
    const { a, b } = await twoLines(cookie);
    const next = await lens(t, cookie, { lens: 'Weekly', period: NEXT_WEEK });
    expect(next.items).toEqual([]);
    expect(next.groups).toEqual([]);

    // …while the Life lens still shows both lines, which is what makes the suppression safe.
    const life = await lens(t, cookie, { lens: 'Life' });
    expect(life.items.map((g) => g.id).sort()).toEqual([a.life.id, b.life.id].sort());
    expect(life.period).toBeNull(); // R-lens-2 — Life has no period dimension
  });
});

describe('R-lens-4 — the group header count, anchored to ONE week', () => {
  it('S-lens-4-1 — it is the SELECTED week in the Weekly lens and the CURRENT week everywhere else', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { a } = await twoLines(cookie);
    await seedTask(t, userId, a.weekly.id, THIS_WEEK);
    await seedTask(t, userId, a.weekly.id, THIS_WEEK);
    const done = await seedTask(t, userId, a.weekly.id, THIS_WEEK);
    await t.fetch(`/api/tasks/${done.id}/complete`, { method: 'POST', cookie, idempotencyKey: crypto.randomUUID(), json: { period: THIS_WEEK } });

    const groupIn = async (q: Parameters<typeof lens>[2]) =>
      (await lens(t, cookie, q)).groups.find((g) => g.id === a.life.id)?.openTasks;

    // Two open, one done → 2, in every lens.
    expect(await groupIn({ lens: 'Weekly', period: THIS_WEEK })).toBe(2);
    expect(await groupIn({ lens: 'Monthly', period: '2026-08' })).toBe(2);
    expect(await groupIn({ lens: 'Life' })).toBe(2);
  });

  it('S-lens-4-2 — future work is NOT in today’s numbers, and only appears in its own week', async () => {
    // R-task-38 holds automatically: a future-origin task is not visible in the current week, so it
    // cannot inflate a count anchored there. R-lens-11 is why that matters — no count may fire on work
    // whose period has not arrived.
    const { cookie, userId } = await signedInOwner(t);
    const { a } = await twoLines(cookie);
    await seedTask(t, userId, a.weekly.id, THIS_WEEK);
    const ahead = await createGoal(t, cookie, { title: 'next week', horizon: 'Weekly', parentId: a.monthly.id, periodKey: NEXT_WEEK });
    await seedTask(t, userId, ahead.id, NEXT_WEEK);

    const groupIn = async (q: Parameters<typeof lens>[2]) =>
      (await lens(t, cookie, q)).groups.find((g) => g.id === a.life.id)?.openTasks;

    expect(await groupIn({ lens: 'Life' })).toBe(1);
    expect(await groupIn({ lens: 'Monthly', period: '2026-08' })).toBe(1);
    expect(await groupIn({ lens: 'Weekly', period: THIS_WEEK })).toBe(1);
    // …and 2 only when the Weekly lens is moved to that future week.
    expect(await groupIn({ lens: 'Weekly', period: NEXT_WEEK })).toBe(2);
  });
});

describe('R-lens-12 — the Weekly lens and the CARRIED band', () => {
  /** A Weekly goal for a past week with one still-open task. Seeded: R-goal-36 refuses the write. */
  async function carrying(cookie: string, userId: string, parentId: string, weekStart: string, title: string) {
    const goal = await seedGoal(t, userId, { parentId, horizon: 'Weekly', title, periodKey: weekStart });
    const task = await seedTask(t, userId, goal.id, weekStart, `${title} work`);
    void cookie;
    return { goal, task };
  }

  it('S-lens-12-2 — a goal whose week has passed renders in the CARRIED band, never in this week’s plan', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { a } = await twoLines(cookie);
    const old = await carrying(cookie, userId, a.monthly.id, '2026-08-10', 'three weeks ago');

    const week = await lens(t, cookie, { lens: 'Weekly', period: THIS_WEEK });
    expect(week.items.map((g) => g.id)).toContain(a.weekly.id);
    expect(week.items.map((g) => g.id)).not.toContain(old.goal.id);
    // The band is a SEPARATE array on purpose: "the two cases render differently and are never mixed".
    expect(week.carried.map((g) => g.id)).toEqual([old.goal.id]);
    // It is labelled with the week it was written FOR, which is how it is told from this week's plan.
    expect(week.carried[0]?.periodKey).toBe('2026-08-10');
    // …and its still-open task carries the red chip's age (R-task-11).
    expect(week.tasks.find((x) => x.id === old.task.id)?.carryAge).toBe(3);
  });

  it('S-lens-12-3 — the band is ordered OLDEST FIRST, so the longest-outstanding work is at the top', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { a } = await twoLines(cookie);
    // Created out of order on purpose: the ordering must come from `periodKey`, not from insert order.
    const w1 = await carrying(cookie, userId, a.monthly.id, '2026-08-24', 'one week ago');
    const w4 = await carrying(cookie, userId, a.monthly.id, '2026-08-03', 'four weeks ago');
    const w2 = await carrying(cookie, userId, a.monthly.id, '2026-08-17', 'two weeks ago');

    const week = await lens(t, cookie, { lens: 'Weekly', period: THIS_WEEK });
    expect(week.carried.map((g) => g.id)).toEqual([w4.goal.id, w2.goal.id, w1.goal.id]);
    expect(week.carried.map((g) => g.periodKey)).toEqual(['2026-08-03', '2026-08-17', '2026-08-24']);
  });

  it('S-lens-12-4 — nothing ages out: a ten-week-old goal appears in every intervening week', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { a } = await twoLines(cookie);
    const old = await carrying(cookie, userId, a.monthly.id, '2026-06-22', 'ten weeks ago');

    for (let back = 0; back <= 9; back++) {
      const weekStart = new Date(Date.parse(`${THIS_WEEK}T00:00:00Z`) - back * 7 * 86_400_000).toISOString().slice(0, 10);
      const res = await lens(t, cookie, { lens: 'Weekly', period: weekStart });
      const shown = [...res.items, ...res.carried].map((g) => g.id);
      expect(shown, `week ${weekStart}`).toContain(old.goal.id);
    }
  });

  it('S-lens-12-5 — it stops carrying the moment its last open task does, and stays in its OWN week', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { a } = await twoLines(cookie);
    const old = await carrying(cookie, userId, a.monthly.id, '2026-08-17', 'two weeks ago');
    expect((await lens(t, cookie, { lens: 'Weekly', period: THIS_WEEK })).carried.map((g) => g.id)).toContain(old.goal.id);

    const done = await t.fetch(`/api/tasks/${old.task.id}/complete`, {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { period: '2026-08-17' },
    });
    expect(done.status).toBe(200);

    expect((await lens(t, cookie, { lens: 'Weekly', period: THIS_WEEK })).carried).toEqual([]);
    // S-goal-45-2 — the week itself is the record: it still renders in ITS week, with the task done.
    const ownWeek = await lens(t, cookie, { lens: 'Weekly', period: '2026-08-17' });
    expect(ownWeek.items.map((g) => g.id)).toContain(old.goal.id);
    expect(ownWeek.tasks.find((x) => x.id === old.task.id)?.done).toBe(true);
  });

  it('S-lens-12-6 — no task visible in a week is ever without its goal on that week’s lens', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { a } = await twoLines(cookie);
    await carrying(cookie, userId, a.monthly.id, '2026-08-10', 'carrying');
    await seedTask(t, userId, a.weekly.id, THIS_WEEK);

    const week = await lens(t, cookie, { lens: 'Weekly', period: THIS_WEEK });
    const shown = new Set([...week.items, ...week.carried].map((g) => g.id));
    for (const task of week.tasks) expect(shown.has(task.goalId), `task ${task.id} has no home`).toBe(true);
  });

  it('R-lens-2 — the Weekly lens is the ONLY lens that carries tasks', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { a } = await twoLines(cookie);
    await seedTask(t, userId, a.weekly.id, THIS_WEEK);
    for (const l of ['Life', 'Yearly', 'Quarterly', 'Monthly'] as const) {
      const res = await lens(t, cookie, { lens: l, ...(l === 'Life' ? {} : { period: l === 'Yearly' ? '2026' : l === 'Quarterly' ? '2026-Q3' : '2026-08' }) });
      expect(res.tasks, l).toEqual([]);
      expect(res.carried, l).toEqual([]);
    }
  });
});

describe('R-lens-11 / R-goal-43 — future work is never styled as late; a stale plan says so quietly', () => {
  it('S-lens-11-2 — a Weekly goal at +3 with open tasks fires no chip, label, count or warning', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { a } = await twoLines(cookie);
    const far = await createGoal(t, cookie, { title: 'three weeks out', horizon: 'Weekly', parentId: a.monthly.id, periodKey: '2026-09-21' });
    await seedTask(t, userId, far.id, '2026-09-21');
    await seedTask(t, userId, far.id, '2026-09-21');

    const week = await lens(t, cookie, { lens: 'Weekly', period: '2026-09-21' });
    expect(week.items.map((g) => g.id)).toContain(far.id);
    for (const task of week.tasks) expect(task.carryAge).toBeLessThanOrEqual(0);
    // …and it is not late anywhere else either: it is absent from the current week's numbers.
    expect((await lens(t, cookie, { lens: 'Life' })).groups.find((g) => g.id === a.life.id)?.openTasks).toBe(0);
    expect(week.period).toMatchObject({ isPast: false, isCurrent: false });
  });

  it('S-goal-43-1 — `planned N weeks ago` is null until the week ARRIVES, and null at age 1', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { a } = await twoLines(cookie);

    // Written three weeks before its week, and that week is now the current one.
    const stale = await seedGoal(t, userId, {
      parentId: a.monthly.id,
      horizon: 'Weekly',
      title: 'written long ago',
      periodKey: THIS_WEEK,
      createdAt: '2026-08-10T10:00:00.000Z',
    });
    const week = await lens(t, cookie, { lens: 'Weekly', period: THIS_WEEK });
    expect(week.items.find((g) => g.id === stale.id)?.plannedAgeWeeks).toBe(3);
    // Age 1 is ordinary planning; the client renders nothing below 2.
    expect(week.items.find((g) => g.id === a.weekly.id)?.plannedAgeWeeks).toBe(0);

    // A week that has NOT arrived carries none at all: it is early, not stale.
    const ahead = await seedGoal(t, userId, {
      parentId: a.monthly.id,
      horizon: 'Weekly',
      title: 'early',
      periodKey: '2026-09-21',
      createdAt: '2026-08-10T10:00:00.000Z',
    });
    const future = await lens(t, cookie, { lens: 'Weekly', period: '2026-09-21' });
    expect(future.items.find((g) => g.id === ahead.id)?.plannedAgeWeeks).toBeNull();
  });
});

describe('R-goal-47 — the planned-ness line, dormancy’s one surface', () => {
  it('the four states, and they are the only number the Monthly lens gains', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { a } = await twoLines(cookie);
    const bare = await createGoal(t, cookie, { title: 'nothing planned', horizon: 'Monthly', parentId: a.quarterly.id });

    const monthly = async () => (await lens(t, cookie, { lens: 'Monthly', period: '2026-08' })).items;
    const breakdownOf = async (id: string) => (await monthly()).find((g) => g.id === id)?.weeklyBreakdown;

    // 1. no Weekly goals under it in any week of the month → `Nothing planned yet`
    expect(await breakdownOf(bare.id)).toEqual({ weeklyGoals: 0, thisWeek: 0 });
    // 2. one this week → `1 weekly goal · 1 this week`
    expect(await breakdownOf(a.monthly.id)).toEqual({ weeklyGoals: 1, thisWeek: 1 });

    // 3. a SECOND Weekly goal in the month, in a week that is not this one → `2 weekly goals · 1 this
    //    week`. It has to be seeded: every other Monday in August 2026 is in the past, and R-goal-36
    //    refuses that write through the product — which is itself the reason the scope is the MONTH
    //    rather than the week.
    await seedGoal(t, userId, { parentId: a.monthly.id, horizon: 'Weekly', title: 'earlier in August', periodKey: '2026-08-17' });
    expect(await breakdownOf(a.monthly.id)).toEqual({ weeklyGoals: 2, thisWeek: 1 });

    // 4. a month that does NOT contain today → `thisWeek: null`, i.e. no second clause at all
    const sept = await createGoal(t, cookie, { title: 'September', horizon: 'Monthly', parentId: a.quarterly.id, periodKey: '2026-09' });
    await createGoal(t, cookie, { title: 'in September', horizon: 'Weekly', parentId: sept.id, periodKey: '2026-09-07' });
    const septLens = await lens(t, cookie, { lens: 'Monthly', period: '2026-09' });
    expect(septLens.items.find((g) => g.id === sept.id)?.weeklyBreakdown).toEqual({ weeklyGoals: 1, thisWeek: null });
  });

  it('R-lens-9 / R-goal-47 — a week belongs to its MONDAY’s month, so a straddling week is not double-counted', async () => {
    const { cookie } = await signedInOwner(t);
    const { a } = await twoLines(cookie);
    const sept = await createGoal(t, cookie, { title: 'September', horizon: 'Monthly', parentId: a.quarterly.id, periodKey: '2026-09' });
    // Mon 31 Aug starts in August: it is AUGUST's week, however much of it falls in September.
    await createGoal(t, cookie, { title: 'straddles', horizon: 'Weekly', parentId: sept.id, periodKey: THIS_WEEK });

    const septLens = await lens(t, cookie, { lens: 'Monthly', period: '2026-09' });
    expect(septLens.items.find((g) => g.id === sept.id)?.weeklyBreakdown?.weeklyGoals).toBe(0);
  });

  it('R-goal-47 — it renders on a MONTHLY goal and nowhere else', async () => {
    const { cookie } = await signedInOwner(t);
    const { a } = await twoLines(cookie);
    for (const [l, period, id] of [
      ['Yearly', '2026', a.yearly.id],
      ['Quarterly', '2026-Q3', a.quarterly.id],
      ['Weekly', THIS_WEEK, a.weekly.id],
    ] as const) {
      const res = await lens(t, cookie, { lens: l, period });
      expect(res.items.find((g) => g.id === id)?.weeklyBreakdown, l).toBeNull();
    }
  });
});

describe('R-lens-22 / R-lens-26 — the Zoom sheet, and the forward-content dot', () => {
  it('S-lens-9-1/9-3 — one grouped read gives the period each horizon would land on, with its count', async () => {
    const { cookie } = await signedInOwner(t);
    await twoLines(cookie);
    const res = (await (await t.fetch('/api/goals/zoom', { cookie })).json()) as ZoomResponse;

    expect(res.rows.map((r) => r.lens)).toEqual(['Life', 'Yearly', 'Quarterly', 'Monthly', 'Weekly']);
    const at = Object.fromEntries(res.rows.map((r) => [r.lens, r]));
    expect(at.Life).toMatchObject({ periodKey: null, label: 'everything', count: 2 });
    expect(at.Yearly).toMatchObject({ periodKey: '2026', count: 2, isCurrent: true });
    expect(at.Quarterly).toMatchObject({ periodKey: '2026-Q3', label: 'Q3 2026', count: 2 });
    expect(at.Monthly).toMatchObject({ periodKey: '2026-08', label: 'Aug 2026', count: 2 });
    expect(at.Weekly).toMatchObject({ periodKey: THIS_WEEK, label: 'Week of 31 Aug', count: 2 });
  });

  it('S-lens-9-2 / R-lens-9 — an anchor that does not contain today lands on the FIRST sub-period', async () => {
    const { cookie } = await signedInOwner(t);
    const res = (await (await t.fetch('/api/goals/zoom?anchor=2027-01-01', { cookie })).json()) as ZoomResponse;
    const at = Object.fromEntries(res.rows.map((r) => [r.lens, r.periodKey]));
    expect(at.Quarterly).toBe('2027-Q1');
    expect(at.Monthly).toBe('2027-01');
    // …and the Weekly row is the first week whose MONDAY falls in that month (R-lens-9, amended).
    expect(at.Weekly).toBe('2027-01-04');
  });

  it('S-lens-7-2 / R-lens-26 — the forward dot fires on a later goal, and on a later task origin', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { a } = await twoLines(cookie);
    expect((await lens(t, cookie, { lens: 'Weekly', period: THIS_WEEK })).hasForwardContent).toBe(false);

    const ahead = await createGoal(t, cookie, { title: 'six weeks out', horizon: 'Weekly', parentId: a.monthly.id, periodKey: '2026-10-12' });
    expect((await lens(t, cookie, { lens: 'Weekly', period: THIS_WEEK })).hasForwardContent).toBe(true);
    // …and it says only "there is something ahead": no number, and nothing at that week itself.
    expect((await lens(t, cookie, { lens: 'Weekly', period: '2026-10-12' })).hasForwardContent).toBe(false);
    await seedTask(t, userId, ahead.id, '2026-10-12');
    expect((await lens(t, cookie, { lens: 'Weekly', period: '2026-10-19' })).hasForwardContent).toBe(false);
    // The Life lens has no period dimension, so it never carries the dot.
    expect((await lens(t, cookie, { lens: 'Life' })).hasForwardContent).toBe(false);
  });
});

describe('R-lens-14 / R-lens-16 — the period falls back, and the page is bounded', () => {
  it('S-lens-14-1 — an absent or unparseable period opens the CURRENT one rather than erroring', async () => {
    const { cookie } = await signedInOwner(t);
    await twoLines(cookie);
    expect((await lens(t, cookie, { lens: 'Monthly' })).period?.periodKey).toBe('2026-08');
    // A key that is valid for ANOTHER horizon parses at the schema and is ignored by the service.
    expect((await lens(t, cookie, { lens: 'Monthly', period: '2026-Q3' })).period?.periodKey).toBe('2026-08');
    // A key that is valid for none is refused at the schema, before any handler runs.
    expect((await t.fetch('/api/goals?lens=Monthly&period=nonsense', { cookie })).status).toBe(422);
  });

  it('Q-12 / S-lens-16-1 — MAX_PAGE is WIRED: a lens read is paged and hands back a cursor', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const life = await createGoal(t, cookie, { title: 'Many', horizon: 'Life' });
    const monthly = await createGoal(t, cookie, { title: 'Month', horizon: 'Monthly', parentId: life.id });
    for (let i = 0; i < 7; i++) {
      await seedGoal(t, userId, { parentId: monthly.id, horizon: 'Weekly', title: `w${i}`, periodKey: THIS_WEEK });
    }

    const first = await lens(t, cookie, { lens: 'Weekly', period: THIS_WEEK, limit: 3 });
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();

    const second = await lens(t, cookie, { lens: 'Weekly', period: THIS_WEEK, limit: 3, cursor: first.nextCursor! });
    expect(second.items).toHaveLength(3);
    // Q-7 — the page boundary follows the one total order, so no row is repeated or skipped.
    expect(second.items.map((g) => g.id)).not.toEqual(expect.arrayContaining(first.items.map((g) => g.id)));

    const third = await lens(t, cookie, { lens: 'Weekly', period: THIS_WEEK, limit: 3, cursor: second.nextCursor! });
    expect(third.items).toHaveLength(1);
    expect(third.nextCursor).toBeNull();

    // …and the cap itself is enforced: a client cannot ask for more than `MAX_PAGE`.
    expect((await t.fetch(`/api/goals?lens=Weekly&limit=${MAX_PAGE + 1}`, { cookie })).status).toBe(422);
  });
});

describe('Q-12 — the two caps, at the boundary', () => {
  it('the per-week Weekly cap refuses exactly at the boundary, and not before it', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const life = await createGoal(t, cookie, { title: 'Busy', horizon: 'Life' });
    const monthly = await createGoal(t, cookie, { title: 'Month', horizon: 'Monthly', parentId: life.id });
    // Seeded rather than created, so the test does not spend `MAX_WEEKLY_GOALS_PER_WEEK` HTTP calls
    // to reach the boundary. The write path is identical; only the cap check is under test.
    for (let i = 0; i < MAX_WEEKLY_GOALS_PER_WEEK - 1; i++) {
      await seedGoal(t, userId, { parentId: monthly.id, horizon: 'Weekly', title: `w${i}`, periodKey: THIS_WEEK });
    }
    // 49 present: the 50th succeeds.
    const last = await createGoal(t, cookie, { title: 'the fiftieth', horizon: 'Weekly', parentId: monthly.id });
    expect(last.periodKey).toBe(THIS_WEEK);

    // 50 present: the 51st is refused.
    const over = await createGoalRaw(t, cookie, { title: 'one too many', horizon: 'Weekly', parentId: monthly.id });
    expect(over.status).toBe(422);
    expect(await codeOf(over)).toBe('VALIDATION_FAILED');

    // It is a SHAPE cap, not a lifetime one: the next week is untouched.
    const nextWeek = await createGoal(t, cookie, { title: 'next week is fine', horizon: 'Weekly', parentId: monthly.id, periodKey: NEXT_WEEK });
    expect(nextWeek.periodKey).toBe(NEXT_WEEK);
  });

  it('the interior cap counts only non-Weekly goals — a Weekly goal never consumes it', async () => {
    // The interior set is the ONLY thing every request holds in memory, which is why it is the one
    // capped; a lifetime cap on Weekly goals would be a cap on how long the product may be used.
    const { cookie, userId } = await signedInOwner(t);
    const life = await createGoal(t, cookie, { title: 'Line', horizon: 'Life' });
    const monthly = await createGoal(t, cookie, { title: 'Month', horizon: 'Monthly', parentId: life.id });
    for (let i = 0; i < 60; i++) {
      await seedGoal(t, userId, { parentId: monthly.id, horizon: 'Weekly', title: `w${i}`, periodKey: NEXT_WEEK });
    }
    // 62 goals in the account, 2 of them interior. A new interior goal is still accepted.
    expect((await createGoal(t, cookie, { title: 'still fine', horizon: 'Monthly', parentId: life.id })).horizon).toBe('Monthly');
  });
});

describe('R-auth-2/3 — cross-account scoping holds on every lens endpoint', () => {
  it('another owner’s goals never appear in any lens, at any horizon or period', async () => {
    const a = await signedInOwner(t);
    const b = await signedInOwner(t);
    const theirs = await twoLines(b.cookie);
    const secrets = [theirs.a.life.id, theirs.a.weekly.id, theirs.a.monthly.id, theirs.b.life.id];

    const reads: LensResponse[] = [
      await lens(t, a.cookie, { lens: 'Life' }),
      await lens(t, a.cookie, { lens: 'Yearly', period: '2026' }),
      await lens(t, a.cookie, { lens: 'Quarterly', period: '2026-Q3' }),
      await lens(t, a.cookie, { lens: 'Monthly', period: '2026-08' }),
      await lens(t, a.cookie, { lens: 'Weekly', period: THIS_WEEK }),
    ];
    const haystack = JSON.stringify(reads);
    for (const id of secrets) expect(haystack.includes(id), `${id} leaked into a lens A can read`).toBe(false);
    for (const res of reads) {
      expect(res.items).toEqual([]);
      expect(res.groups).toEqual([]);
      expect(res.carried).toEqual([]);
    }
  });

  it('the Zoom counts, the detail page and the repeat-week write are all scoped too', async () => {
    const a = await signedInOwner(t);
    const b = await signedInOwner(t);
    const theirs = await twoLines(b.cookie);

    const zoom = (await (await t.fetch('/api/goals/zoom', { cookie: a.cookie })).json()) as ZoomResponse;
    expect(zoom.rows.every((r) => r.count === 0), "A sees B's goals in the Zoom counts").toBe(true);

    expect((await t.fetch(`/api/goals/${theirs.a.monthly.id}`, { cookie: a.cookie })).status).toBe(404);
    const repeat = await t.fetch('/api/goals/repeat-week', {
      method: 'POST',
      cookie: a.cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { lifeGoalId: theirs.a.life.id, weekStart: NEXT_WEEK },
    });
    expect(repeat.status).toBe(404);
  });
});

/**
 * ⚠ **R-lens-5, rewritten — the flat total order is on the WIRE now.**
 *
 * The client used to partition a lens page by Life root and draw a header per group; it does not any more
 * (R-lens-3, deleted by the owner's own reversal), so the order `items` arrives in is what the screen
 * renders. It is the reading order of the previously grouped screen with its headers removed, which is
 * what makes the change invisible to muscle memory: **the same goal is in the same place before and
 * after.**
 */
describe('R-lens-5 — `items` arrives in the flat total order the lens renders', () => {
  it('S-lens-5-1 — by the item’s Life root (createdAt, id), then by the item, with root-less LAST', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { a, b } = await twoLines(cookie);

    /*
     * Two more Monthly goals, created in an order that CROSSES the lines: `b` first, then `a`. Ordered by
     * the item's own `createdAt` alone — which is what `listByLens` pages on — they would interleave the
     * two lines. R-lens-5 says they must not.
     */
    const bSecond = await createGoal(t, cookie, { title: 'Craft month two', horizon: 'Monthly', parentId: b.quarterly.id, periodKey: '2026-08' });
    const aSecond = await createGoal(t, cookie, { title: 'Health month two', horizon: 'Monthly', parentId: a.quarterly.id, periodKey: '2026-08' });
    // R-lens-20 — an item whose chain reaches no Life goal. It sorts last, without a header to pin it.
    const orphan = await seedGoal(t, userId, { parentId: null, horizon: 'Monthly', title: 'An orphan', periodKey: '2026-08' });

    const monthly = await lens(t, cookie, { lens: 'Monthly', period: '2026-08' });

    expect(monthly.items.map((g) => g.id)).toEqual([a.monthly.id, aSecond.id, b.monthly.id, bSecond.id, orphan.id]);
    // Stated as the property rather than the sequence, so a future fixture cannot pass by coincidence:
    // every run of one line is contiguous, and the root-less item is at the end.
    const roots = monthly.items.map((g) => g.lifeRootId);
    expect(roots).toEqual([a.life.id, a.life.id, b.life.id, b.life.id, null]);
    expect(new Set(roots).size).toBe(3);
  });

  it('the Life lens is unaffected — each Life goal IS its own line, in its own createdAt order', async () => {
    const { cookie } = await signedInOwner(t);
    const { a, b } = await twoLines(cookie);
    const life = await lens(t, cookie, { lens: 'Life' });
    expect(life.items.map((g) => g.id)).toEqual([a.life.id, b.life.id]);
  });
});

describe('R-goal-46 — Repeat last week', () => {
  it('S-goal-46-1 — copies ONE life line’s previous week as ordinary goals, with no link to the source', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { a, b } = await twoLines(cookie);
    const lastA = await seedGoal(t, userId, { parentId: a.monthly.id, horizon: 'Weekly', title: 'run four times', periodKey: '2026-08-24' });
    await seedGoal(t, userId, { parentId: b.monthly.id, horizon: 'Weekly', title: 'B’s week', periodKey: '2026-08-24' });

    t.clock.set('2026-09-07T10:00:00.000Z'); // the target week's own week, so 2026-08-31 is "last week"
    const seeded = await seedGoal(t, userId, { parentId: a.monthly.id, horizon: 'Weekly', title: 'run four times', periodKey: '2026-08-31' });
    const res = await t.fetch('/api/goals/repeat-week', {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { lifeGoalId: a.life.id, weekStart: '2026-09-07' },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { created: { id: string; title: string; periodKey: string; pulse: string }[] };

    // Only A's line, and only last week's.
    expect(body.created.map((g) => g.title)).toContain('run four times');
    expect(body.created.every((g) => g.periodKey === '2026-09-07')).toBe(true);
    expect(body.created.every((g) => g.pulse === 'On track')).toBe(true);
    expect(body.created.map((g) => g.id)).not.toContain(seeded.id);
    expect(JSON.stringify(body)).not.toContain(lastA.id);
    // No tasks were copied.
    const week = await lens(t, cookie, { lens: 'Weekly', period: '2026-09-07' });
    expect(week.tasks).toEqual([]);
    t.clock.set('2026-08-31T10:00:00.000Z');
  });

  /**
   * ⚠ **R-goal-46, amended — `lifeGoalId` is OPTIONAL, and absent means every Life line.**
   *
   * Q-22 required it per line because the control lived at a group foot in the Weekly lens; there are no
   * group feet (R-lens-3, deleted), so `Repeat last week` is one link at the foot of the list and copies
   * the whole week. The old objection — *twenty goals in one tap with no review* — is answered by the cap
   * rather than by the parameter, and that is asserted below.
   */
  it('R-goal-46: with NO lifeGoalId it copies every line’s previous week, and the cap still bounds it', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { a, b } = await twoLines(cookie);
    await seedGoal(t, userId, { parentId: a.monthly.id, horizon: 'Weekly', title: 'A last week', periodKey: '2026-08-31' });
    await seedGoal(t, userId, { parentId: b.monthly.id, horizon: 'Weekly', title: 'B last week', periodKey: '2026-08-31' });

    const res = await t.fetch('/api/goals/repeat-week', {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { weekStart: NEXT_WEEK },
    });
    expect(res.status).toBe(201);
    const created = ((await res.json()) as { created: { title: string; periodKey: string; pulse: string }[] }).created;

    // BOTH lines, and only last week's — including the two `twoLines` seeded for this week.
    expect(created.map((g) => g.title).sort()).toEqual(['A last week', 'B last week', 'Craft week', 'Health week']);
    expect(created.every((g) => g.periodKey === NEXT_WEEK)).toBe(true);
    // Everything else is R-goal-46 verbatim: ordinary new goals with `pulse` reset and no tasks copied.
    expect(created.every((g) => g.pulse === 'On track')).toBe(true);
    expect((await lens(t, cookie, { lens: 'Weekly', period: NEXT_WEEK })).tasks).toEqual([]);
  });

  it('R-goal-46: naming a line still narrows to it, byte for byte — the parameter did not change meaning', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { a, b } = await twoLines(cookie);
    await seedGoal(t, userId, { parentId: b.monthly.id, horizon: 'Weekly', title: 'B last week', periodKey: '2026-08-31' });

    const res = await t.fetch('/api/goals/repeat-week', {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { lifeGoalId: a.life.id, weekStart: NEXT_WEEK },
    });
    expect(res.status).toBe(201);
    const created = ((await res.json()) as { created: { title: string }[] }).created;
    expect(created.map((g) => g.title)).toEqual(['Health week']);
  });

  it('S-goal-46-2 — a PAST week is refused, and an empty previous week creates nothing', async () => {
    const { cookie } = await signedInOwner(t);
    const { a } = await twoLines(cookie);

    const past = await t.fetch('/api/goals/repeat-week', {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { lifeGoalId: a.life.id, weekStart: '2026-08-24' },
    });
    expect(past.status).toBe(409);
    expect(await codeOf(past)).toBe('PERIOD_IN_PAST');

    // Nothing in the week before NEXT_WEEK for this line... except `a.weekly`, so use a line with none.
    const empty = await createGoal(t, cookie, { title: 'Empty line', horizon: 'Life' });
    const res = await t.fetch('/api/goals/repeat-week', {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { lifeGoalId: empty.id, weekStart: NEXT_WEEK },
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { created: unknown[] }).created).toEqual([]);
  });
});
