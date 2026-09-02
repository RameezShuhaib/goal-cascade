import type { GoalDetailResponse, GoalView } from '@goal-cascade/shared';
import { describe, expect, it } from 'vitest';
import { createTestApp, ids, signedInOwner } from '../helpers/app';
import { codeOf, createGoal, createGoalRaw, goalInLens, lens, makeLine, seedGoal, seedTask } from './fixtures';

/**
 * The goal model, end to end through the real router (R-goal-1..47, Q-5, Q-7, D-3, D-5, D-8, D-16).
 *
 * Every refusal here is asserted as a MACHINE-READABLE code and as an unchanged tree: SPEC D-5's whole
 * point is that the mockup enforced these rules by disabling buttons, so a request submitted directly
 * could drive the store into an illegal shape.
 */
const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' }); // a Monday; week 0 = 2026-08-31
const THIS_WEEK = '2026-08-31';
const THIS_MONTH = '2026-08';

describe('R-goal-3/5/31/33 — create', () => {
  it('S-goal-3-1 — a Life goal has no parent and no target period', async () => {
    const { cookie } = await signedInOwner(t);
    const life = await createGoal(t, cookie, { title: 'Health', horizon: 'Life' });
    expect(life.parentId).toBeNull();
    expect(life.period).toBe('');
    expect(life.periodKey).toBe('');
    // R-lens-3 — a Life goal is its own group.
    expect(life.lifeRootId).toBe(life.id);
    /**
     * RETIRED — the old assertions here were `isLeaf === true`, `isActive === false` and
     * `dormant === false`. All three left the wire (R-rm-2, R-goal-37): "leaf" is retired as a product
     * word, and active/dormant are per-week predicates with one surface that is not on a goal card
     * (R-goal-38, R-goal-47). The absence is asserted, so they cannot come back under the old names.
     */
    for (const gone of ['isLeaf', 'isActive', 'dormant', 'subtreeActive', 'focus', 'branches']) {
      expect(life as unknown as Record<string, unknown>, gone).not.toHaveProperty(gone);
    }
  });

  it('S-goal-5-1 / S-goal-33-1 — a sub-goal lands under its parent with the period CONTAINING today', async () => {
    const { cookie } = await signedInOwner(t);
    const { quarterly } = await makeLine(t, cookie);
    const monthly = await createGoal(t, cookie, { title: 'Squats', horizon: 'Monthly', parentId: quarterly.id });
    expect(monthly.parentId).toBe(quarterly.id);
    // D-3 — derived from today (2026-08-31), never a frozen literal. The KEY is canonical; the LABEL is
    // rendered from it and is the only thing `period` ever holds (R-goal-33).
    expect(monthly.periodKey).toBe('2026-08');
    expect(monthly.period).toBe('Aug 2026');
  });

  it('S-goal-33-1 — every horizon defaults to the period containing today, in its own shape', async () => {
    const { cookie } = await signedInOwner(t);
    const life = await createGoal(t, cookie, { title: 'Craft', horizon: 'Life' });
    const yearly = await createGoal(t, cookie, { title: 'Ship it', horizon: 'Yearly', parentId: life.id });
    expect([yearly.periodKey, yearly.period]).toEqual(['2026', '2026']);
    const q = await createGoal(t, cookie, { title: 'Q', horizon: 'Quarterly', parentId: yearly.id });
    expect([q.periodKey, q.period]).toEqual(['2026-Q3', 'Q3 2026']);
    const m = await createGoal(t, cookie, { title: 'M', horizon: 'Monthly', parentId: q.id });
    expect([m.periodKey, m.period]).toEqual(['2026-08', 'Aug 2026']);
    const w = await createGoal(t, cookie, { title: 'W', horizon: 'Weekly', parentId: m.id });
    expect([w.periodKey, w.period]).toEqual([THIS_WEEK, 'Week of 31 Aug']);
  });

  /**
   * SUPERSEDED — S-goal-6-1 required a sub-goal under a Monthly goal to be REFUSED. Its subject
   * inverted under R-goal-31: Monthly now accepts children, and the only horizon it can accept is
   * Weekly. S-goal-31-2 is the exact request the old scenario required to be refused, so it is asserted
   * rather than dropped — "a build that still refuses it has implemented the old rule".
   */
  it('S-goal-31-2 — a Weekly goal under a Monthly goal SUCCEEDS (the rule that reversed)', async () => {
    const { cookie } = await signedInOwner(t);
    const { monthly } = await makeLine(t, cookie);
    const weekly = await createGoal(t, cookie, { title: 'This week', horizon: 'Weekly', parentId: monthly.id });
    expect(weekly.horizon).toBe('Weekly');
    expect(weekly.parentId).toBe(monthly.id);
  });

  it('S-goal-31-1 — a sub-goal under a WEEKLY goal is refused, at any horizon, and W keeps zero children', async () => {
    const { cookie } = await signedInOwner(t);
    const { weekly } = await makeLine(t, cookie);
    for (const horizon of ['Yearly', 'Quarterly', 'Monthly', 'Weekly'] as const) {
      const res = await createGoalRaw(t, cookie, { title: 'illegal', horizon, parentId: weekly.id });
      expect(res.status, horizon).toBe(409);
      expect(await codeOf(res), horizon).toBe('HORIZON_CONFLICT');
    }
    const detail = (await (await t.fetch(`/api/goals/${weekly.id}`, { cookie })).json()) as GoalDetailResponse;
    expect(detail.children).toHaveLength(0);
  });

  it('S-goal-32-1 — levels may be SKIPPED: a Weekly goal hangs off a Life or Quarterly goal', async () => {
    const { cookie } = await signedInOwner(t);
    const { life, quarterly } = await makeLine(t, cookie);
    const underLife = await createGoal(t, cookie, { title: 'Weekly practice', horizon: 'Weekly', parentId: life.id });
    expect(underLife.parentId).toBe(life.id);
    const underQuarter = await createGoal(t, cookie, { title: 'Q week', horizon: 'Weekly', parentId: quarterly.id });
    expect(underQuarter.parentId).toBe(quarterly.id);
    // Both still group under their Life root: the walk makes no assumption about chain length.
    expect(underLife.lifeRootId).toBe(life.id);
    expect(underQuarter.lifeRootId).toBe(life.id);
  });

  it('S-goal-32-2 — the inverted case is still refused (Monthly under Weekly)', async () => {
    const { cookie } = await signedInOwner(t);
    const { weekly } = await makeLine(t, cookie);
    const res = await createGoalRaw(t, cookie, { title: 'nope', horizon: 'Monthly', parentId: weekly.id });
    expect(await codeOf(res)).toBe('HORIZON_CONFLICT');
  });

  it('S-goal-33-2 — a periodKey that does not match its horizon is a validation failure', async () => {
    const { cookie } = await signedInOwner(t);
    const { quarterly, monthly } = await makeLine(t, cookie);
    for (const [horizon, parentId, periodKey] of [
      ['Quarterly', quarterly.id, '2026-Q5'],
      ['Monthly', quarterly.id, '2026-13'],
      ['Monthly', quarterly.id, 'not-a-period'],
      ['Weekly', monthly.id, '2026-09-01'], // a Tuesday
    ] as const) {
      const res = await createGoalRaw(t, cookie, { title: 'x', horizon, parentId, periodKey });
      expect(res.status, `${horizon} ${periodKey}`).toBe(422);
    }
  });

  it('S-goal-36-1 — a goal is never created into a PAST period, at any horizon', async () => {
    const { cookie } = await signedInOwner(t);
    const { monthly, quarterly } = await makeLine(t, cookie);
    for (const [horizon, parentId, periodKey] of [
      ['Weekly', monthly.id, '2026-08-24'],
      ['Monthly', quarterly.id, '2026-07'],
    ] as const) {
      const res = await createGoalRaw(t, cookie, { title: 'back-dated', horizon, parentId, periodKey });
      expect(res.status, periodKey).toBe(409);
      expect(await codeOf(res), periodKey).toBe('PERIOD_IN_PAST');
    }
  });

  it('S-goal-36-3 — forward is UNBOUNDED: 40 weeks and 18 months out both succeed', async () => {
    const { cookie } = await signedInOwner(t);
    const { monthly, quarterly } = await makeLine(t, cookie);
    const far = await createGoal(t, cookie, { title: 'far week', horizon: 'Weekly', parentId: monthly.id, periodKey: '2027-06-07' });
    expect(far.periodKey).toBe('2027-06-07');
    const month = await createGoal(t, cookie, { title: 'far month', horizon: 'Monthly', parentId: quarterly.id, periodKey: '2028-02' });
    expect(month.periodKey).toBe('2028-02');
  });

  it('S-goal-35-1 — a period is NEVER checked against its parent’s, and nothing warns about it', async () => {
    const { cookie } = await signedInOwner(t);
    const { quarterly } = await makeLine(t, cookie);
    // A Monthly goal for Oct under a Quarterly goal for Q3, and a Weekly goal for a week that starts in
    // the PREVIOUS month. Both ordinary: a week straddles a month boundary in most months.
    const oct = await createGoal(t, cookie, { title: 'October', horizon: 'Monthly', parentId: quarterly.id, periodKey: '2026-10' });
    const straddling = await createGoal(t, cookie, { title: 'straddles', horizon: 'Weekly', parentId: oct.id, periodKey: '2026-09-28' });
    expect(straddling.periodKey).toBe('2026-09-28');
    expect(straddling.parentId).toBe(oct.id);
  });

  it('S-goal-29-1 — a whitespace-only title is a validation failure, not a silent no-op', async () => {
    const { cookie } = await signedInOwner(t);
    const before = (await lens(t, cookie, { lens: 'Life' })).items.length;
    const res = await createGoalRaw(t, cookie, { title: '   ', horizon: 'Life' });
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe('VALIDATION_FAILED');
    expect((await lens(t, cookie, { lens: 'Life' })).items.length).toBe(before);
  });

  it('R-goal-3 — a Life goal created WITH a period is refused rather than silently blanked (Q-10)', async () => {
    const { cookie } = await signedInOwner(t);
    const res = await createGoalRaw(t, cookie, { title: 'Life', horizon: 'Life', periodKey: '2027' });
    expect(res.status).toBe(422);
  });

  it('S-goal-33-3 — a client-supplied `period` is not ignored, it is REFUSED as an unknown key', async () => {
    const { cookie } = await signedInOwner(t);
    const { quarterly } = await makeLine(t, cookie);
    const res = await createGoalRaw(t, cookie, { title: 'x', horizon: 'Monthly', parentId: quarterly.id, period: 'whenever' });
    expect(res.status).toBe(422);
  });
});

describe('R-goal-14/36/40 — edit', () => {
  it('S-goal-14-1 — title, why, periodKey and pulse persist; horizon and parent are untouched', async () => {
    const { cookie } = await signedInOwner(t);
    const { monthly } = await makeLine(t, cookie);
    const res = await t.fetch(`/api/goals/${monthly.id}`, {
      method: 'PATCH',
      cookie,
      json: { title: 'Renamed', why: 'because', periodKey: '2026-12', pulse: 'At risk' },
    });
    expect(res.status).toBe(200);
    const goal = ((await res.json()) as { goal: GoalView }).goal;
    expect([goal.title, goal.why, goal.periodKey, goal.period, goal.pulse]).toEqual([
      'Renamed',
      'because',
      '2026-12',
      'Dec 2026',
      'At risk',
    ]);
    expect(goal.horizon).toBe(monthly.horizon);
    expect(goal.parentId).toBe(monthly.parentId);
    expect(goal.version).toBe(monthly.version + 1);
  });

  it('S-goal-36-2 — an edit that moves a goal into a PAST period is refused and the key is unchanged', async () => {
    const { cookie } = await signedInOwner(t);
    const { monthly } = await makeLine(t, cookie);
    const res = await t.fetch(`/api/goals/${monthly.id}`, { method: 'PATCH', cookie, json: { periodKey: '2026-07' } });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('PERIOD_IN_PAST');
    expect((await goalInLens(t, cookie, monthly)).periodKey).toBe(THIS_MONTH);
  });

  it('S-goal-40-2 — a `periodKey` patch on a WEEKLY goal is refused OUTRIGHT, past or future', async () => {
    // R-goal-40 — a weekly goal IS a week. Moving it forward would silently restate what a past week
    // contained, which is D-2, the defect that made focus per-week in the first place.
    const { cookie } = await signedInOwner(t);
    const { weekly } = await makeLine(t, cookie);
    for (const periodKey of ['2026-09-07', '2026-08-24']) {
      const res = await t.fetch(`/api/goals/${weekly.id}`, { method: 'PATCH', cookie, json: { periodKey } });
      expect(res.status, periodKey).toBe(422);
    }
    expect((await goalInLens(t, cookie, weekly)).periodKey).toBe(THIS_WEEK);
  });

  it('S-goal-40-2 — and a WEEKLY goal is not re-plannable either', async () => {
    const { cookie } = await signedInOwner(t);
    const { weekly } = await makeLine(t, cookie);
    const res = await t.fetch(`/api/goals/${weekly.id}/replan`, {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { periodKey: '2026-09-07' },
    });
    expect(res.status).toBe(422);
    // …and its detail page offers no options at all, so no client can construct the call.
    const detail = (await (await t.fetch(`/api/goals/${weekly.id}`, { cookie })).json()) as GoalDetailResponse;
    expect(detail.replanOptions).toEqual([]);
  });

  it('S-goal-14-2 — an edit carrying `horizon` or `parentId` is refused; re-parenting goes through Move', async () => {
    const { cookie } = await signedInOwner(t);
    const { quarterly, monthly, yearly2 } = await makeLine(t, cookie);
    for (const payload of [{ horizon: 'Yearly' }, { parentId: yearly2.id }]) {
      const res = await t.fetch(`/api/goals/${monthly.id}`, { method: 'PATCH', cookie, json: payload });
      expect(res.status, JSON.stringify(payload)).toBe(422);
    }
    const after = await goalInLens(t, cookie, monthly);
    expect([after.horizon, after.parentId]).toEqual(['Monthly', quarterly.id]);
  });

  it('Q-2 — a stale `version` loses the race with a clean 409 rather than clobbering', async () => {
    const { cookie } = await signedInOwner(t);
    const { monthly } = await makeLine(t, cookie);
    await t.fetch(`/api/goals/${monthly.id}`, { method: 'PATCH', cookie, json: { title: 'first' } });
    const res = await t.fetch(`/api/goals/${monthly.id}`, { method: 'PATCH', cookie, json: { title: 'second', version: 1 } });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('CONCURRENT_UPDATE');
    expect((await goalInLens(t, cookie, monthly)).title).toBe('first');
  });

  it('S-goal-36-4 — a PAST period is closed to new plan and to NOTHING else', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { life } = await makeLine(t, cookie);
    const old = await seedGoal(t, userId, { parentId: life.id, horizon: 'Weekly', title: 'three weeks ago', periodKey: '2026-08-10' });
    const edited = await t.fetch(`/api/goals/${old.id}`, {
      method: 'PATCH',
      cookie,
      json: { title: 'corrected', why: 'a correction is not a plan', pulse: 'Rethink' },
    });
    expect(edited.status).toBe(200);
    const goal = ((await edited.json()) as { goal: GoalView }).goal;
    expect([goal.title, goal.pulse, goal.periodKey]).toEqual(['corrected', 'Rethink', '2026-08-10']);
  });
});

describe('R-goal-16/17/18/40 — move', () => {
  it('S-goal-18-1 — re-parenting INTO a descendant is refused as WOULD_CREATE_CYCLE and changes nothing', async () => {
    const { cookie } = await signedInOwner(t);
    const { yearly, quarterly, monthly } = await makeLine(t, cookie);
    for (const target of [yearly.id, quarterly.id, monthly.id]) {
      const res = await t.fetch(`/api/goals/${yearly.id}/move`, {
        method: 'POST',
        cookie,
        idempotencyKey: crypto.randomUUID(),
        json: { parentId: target },
      });
      expect(res.status, target).toBe(409);
      // R-goal-19 — the descendant reason wins over the horizon one, so the code must be the cycle code.
      expect(await codeOf(res), target).toBe('WOULD_CREATE_CYCLE');
    }
    expect((await goalInLens(t, cookie, yearly)).parentId).toBe(yearly.parentId);
  });

  it('S-goal-18-2 — re-parenting into a SHORTER horizon is a DISTINCT code (HORIZON_CONFLICT)', async () => {
    const { cookie } = await signedInOwner(t);
    const a = await makeLine(t, cookie);
    const b = await makeLine(t, cookie); // an unrelated line, so `b.monthly` is not a descendant of `a.quarterly`
    const res = await t.fetch(`/api/goals/${a.quarterly.id}/move`, {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { parentId: b.monthly.id },
    });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('HORIZON_CONFLICT');
    expect((await goalInLens(t, cookie, a.quarterly)).parentId).toBe(a.yearly.id);
  });

  it('S-goal-17-1 — a legal move keeps the horizon and takes the children with it', async () => {
    const { cookie } = await signedInOwner(t);
    const { quarterly, monthly, yearly2 } = await makeLine(t, cookie);
    const res = await t.fetch(`/api/goals/${quarterly.id}/move`, {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { parentId: yearly2.id },
    });
    expect(res.status).toBe(200);
    const moved = ((await res.json()) as { goal: GoalView }).goal;
    expect(moved.parentId).toBe(yearly2.id);
    expect(moved.horizon).toBe('Quarterly');
    // R-goal-16 — the child moved with it: it still hangs off Q, which now hangs off Y2.
    expect((await goalInLens(t, cookie, monthly)).parentId).toBe(quarterly.id);
  });

  /**
   * ⚠ **A2 (R-goal-40, SPEC Q-24) — THE `periodKey` immutability guard.**
   *
   * This is the test the brief names, and it is worth stating why it is not obvious: **nothing breaks in
   * the data if a Weekly goal crosses weeks.** `tasks.origin_week_start` is the task's own stored field
   * and is not re-read from the parent (R-task-40), so re-parenting would move the goal and leave every
   * task's week exactly where it was — no error, no cascade, no failure anywhere. What breaks is the
   * LENS: the goal would claim a week its tasks were never live in, appear in two weeks with different
   * work under it, and the carried band could no longer tell "written this week" from "carrying".
   */
  it('S-goal-40-3 — Move works on a Weekly goal, and CANNOT change its week or its tasks’ weeks', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const a = await makeLine(t, cookie);
    const b = await makeLine(t, cookie);
    const task = await seedTask(t, userId, a.weekly.id, THIS_WEEK);

    const res = await t.fetch(`/api/goals/${a.weekly.id}/move`, {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { parentId: b.monthly.id },
    });
    expect(res.status).toBe(200);
    const moved = ((await res.json()) as { goal: GoalView }).goal;
    expect(moved.parentId).toBe(b.monthly.id);
    expect(moved.periodKey).toBe(THIS_WEEK); // the week is untouched
    expect(moved.lifeRootId).toBe(b.life.id); // the GROUP moved, which is the point of Move

    const week = await lens(t, cookie, { lens: 'Weekly', period: THIS_WEEK });
    expect(week.tasks.find((x) => x.id === task.id)?.originPeriodKey).toBe(THIS_WEEK);
    // …and the goal appears in exactly ONE week, which is the property the guard protects.
    expect(week.items.filter((g) => g.id === a.weekly.id)).toHaveLength(1);
    expect((await lens(t, cookie, { lens: 'Weekly', period: '2026-09-07' })).items.map((g) => g.id)).not.toContain(a.weekly.id);
  });

  it('R-goal-40 — and a Move request that tries to carry a periodKey is refused as an unknown key', async () => {
    const { cookie } = await signedInOwner(t);
    const a = await makeLine(t, cookie);
    const b = await makeLine(t, cookie);
    const res = await t.fetch(`/api/goals/${a.weekly.id}/move`, {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { parentId: b.monthly.id, periodKey: '2026-09-07' },
    });
    expect(res.status).toBe(422);
  });

  it('S-goal-21-1 — a Life goal cannot be moved or re-planned', async () => {
    const { cookie } = await signedInOwner(t);
    const a = await makeLine(t, cookie);
    const b = await makeLine(t, cookie);
    const moved = await t.fetch(`/api/goals/${a.life.id}/move`, {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { parentId: b.life.id },
    });
    expect(await codeOf(moved)).toBe('LIFE_GOAL_IMMUTABLE');
    const replanned = await t.fetch(`/api/goals/${a.life.id}/replan`, {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { periodKey: '2027' },
    });
    expect(replanned.status).toBe(409);
    expect(await codeOf(replanned)).toBe('LIFE_GOAL_IMMUTABLE');
  });

  /**
   * S-goal-42-1 — **the defect class R-goal-28 and D-8 existed for is UNREACHABLE.**
   *
   * Adding a child to a goal, or moving one under it, moves nothing, deletes nothing and refuses
   * nothing: only Weekly goals hold tasks, and a Weekly goal can never gain a child. `GOAL_HAS_OPEN_TASKS`
   * is raised by no code path in the product, and the shared contract no longer defines the code.
   */
  it('S-goal-42-1 — giving a goal its first child never refuses for open tasks and re-homes nothing', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { life, monthly, weekly } = await makeLine(t, cookie);
    const task = await seedTask(t, userId, weekly.id, THIS_WEEK);

    // A second Weekly goal under the same Monthly parent, and a fresh Monthly goal gaining its first
    // child — the two shapes the old guard fired on.
    const second = await createGoal(t, cookie, { title: 'another intention', horizon: 'Weekly', parentId: monthly.id });
    expect(second.parentId).toBe(monthly.id);
    const fresh = await createGoal(t, cookie, { title: 'fresh', horizon: 'Monthly', parentId: life.id });
    const child = await createGoal(t, cookie, { title: 'under fresh', horizon: 'Weekly', parentId: fresh.id });
    expect(child.parentId).toBe(fresh.id);

    // Nothing was re-homed, and nothing was deleted.
    const week = await lens(t, cookie, { lens: 'Weekly', period: THIS_WEEK });
    expect(week.tasks.find((x) => x.id === task.id)?.goalId).toBe(weekly.id);
  });
});

describe('R-goal-24 — the quiet carrying signal on a life-goal card', () => {
  it('S-goal-24-1 — two open tasks, origins 3 and 1 weeks back → 2 carrying, oldest 3', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { life, weekly } = await makeLine(t, cookie);
    await seedTask(t, userId, weekly.id, '2026-08-10'); // 3 weeks before 2026-08-31
    await seedTask(t, userId, weekly.id, '2026-08-24'); // 1 week before
    expect((await goalInLens(t, cookie, life)).carrying).toEqual({ openTasks: 2, oldestWeeks: 3 });
  });

  it('S-goal-24-2 — a task that originated THIS week is not carrying, so the line is hidden (null)', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { life, weekly } = await makeLine(t, cookie);
    await seedTask(t, userId, weekly.id, THIS_WEEK);
    expect((await goalInLens(t, cookie, life)).carrying).toBeNull();
  });

  it('R-task-38 — a FUTURE-origin task can never satisfy the signal, so it needs no guard of its own', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { life, monthly } = await makeLine(t, cookie);
    const ahead = await createGoal(t, cookie, { title: 'next week', horizon: 'Weekly', parentId: monthly.id, periodKey: '2026-09-07' });
    await seedTask(t, userId, ahead.id, '2026-09-07');
    expect((await goalInLens(t, cookie, life)).carrying).toBeNull();
  });
});

describe('R-goal-41 — the detail page in one request', () => {
  it('ancestry with periods, children, and the Life-goal backlog aggregate flag', async () => {
    const { cookie } = await signedInOwner(t);
    const { life, yearly, quarterly, monthly } = await makeLine(t, cookie);

    const res = await t.fetch(`/api/goals/${quarterly.id}`, { cookie });
    expect(res.status).toBe(200);
    const detail = (await res.json()) as GoalDetailResponse;
    expect(detail.ancestors.map((g) => g.id)).toEqual([life.id, yearly.id]);
    // R-goal-41 — each ancestor carries its own period label.
    expect(detail.ancestors.map((g) => g.period)).toEqual(['', '2026']);
    expect(detail.children.map((g) => g.id)).toEqual([monthly.id]);
    expect(detail.backlogIsAggregate).toBe(false);

    // R-backlog-12 — a Life goal's block is the read-only roll-up of the whole line.
    const lifeDetail = (await (await t.fetch(`/api/goals/${life.id}`, { cookie })).json()) as GoalDetailResponse;
    expect(lifeDetail.backlogIsAggregate).toBe(true);
    expect(lifeDetail.ancestors).toHaveLength(0);
  });

  it('S-goal-37-2 / R-goal-41 — `children` is the ONLY source of "has children"; no isLeaf anywhere', async () => {
    const { cookie } = await signedInOwner(t);
    const { monthly, weekly } = await makeLine(t, cookie);
    const withChild = (await (await t.fetch(`/api/goals/${monthly.id}`, { cookie })).json()) as GoalDetailResponse;
    expect(withChild.children.map((g) => g.id)).toEqual([weekly.id]);
    const terminal = (await (await t.fetch(`/api/goals/${weekly.id}`, { cookie })).json()) as GoalDetailResponse;
    expect(terminal.children).toEqual([]);
    expect(JSON.stringify(withChild)).not.toContain('isLeaf');
  });

  it('R-auth-3 — another owner’s goal is a plain 404, indistinguishable from one that never existed', async () => {
    const a = await signedInOwner(t);
    const b = await signedInOwner(t);
    const theirs = await makeLine(t, b.cookie);
    expect((await t.fetch(`/api/goals/${theirs.monthly.id}`, { cookie: a.cookie })).status).toBe(404);
    expect((await t.fetch(`/api/goals/${ids.ulid()}`, { cookie: a.cookie })).status).toBe(404);
    // …and it cannot be written to either.
    const patched = await t.fetch(`/api/goals/${theirs.monthly.id}`, { method: 'PATCH', cookie: a.cookie, json: { title: 'mine' } });
    expect(patched.status).toBe(404);
  });
});
