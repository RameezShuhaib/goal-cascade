import type { GoalDetailResponse, GoalView } from '@goal-cascade/shared';
import { describe, expect, it } from 'vitest';
import { createTestApp, ids, signedInOwner } from '../helpers/app';
import { codeOf, createGoal, goalById, goalsIn, makeLine, savePlan, seedTask } from './fixtures';

/**
 * The goal tree, end to end through the real router (R-goal-1..29, Q-5, Q-7, D-3, D-5, D-6, D-8, D-16).
 *
 * Every refusal here is asserted as a MACHINE-READABLE code and as an unchanged tree: SPEC D-5's whole
 * point is that the mockup enforced these rules by disabling buttons, so a request submitted directly
 * could drive the store into an illegal shape.
 */
const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' }); // a Monday; week 0 = 2026-08-31

describe('R-goal-3/5/6/13 — create', () => {
  it('S-goal-3-1 — a Life goal has no parent and no target period', async () => {
    const { cookie } = await signedInOwner(t);
    const life = await createGoal(t, cookie, { title: 'Health', horizon: 'Life' });
    expect(life.parentId).toBeNull();
    expect(life.period).toBe('');
    expect(life.isLeaf).toBe(true);
    // R-goal-9 — a Life goal is never "active" and never "dormant"; it has no focus of its own.
    expect(life.isActive).toBe(false);
    expect(life.dormant).toBe(false);
  });

  it('S-goal-5-1 / S-goal-13-1 — a sub-goal lands under its parent with the period CONTAINING today', async () => {
    const { cookie } = await signedInOwner(t);
    const { quarterly } = await makeLine(t, cookie);
    const monthly = await createGoal(t, cookie, { title: 'Squats', horizon: 'Monthly', parentId: quarterly.id });
    expect(monthly.parentId).toBe(quarterly.id);
    // D-3 — derived from today (2026-08-31), never the mockup's frozen 'Sep 2026' literal.
    expect(monthly.period).toBe('Aug 2026');
    expect((await goalById(t, cookie, quarterly.id)).isLeaf).toBe(false);
  });

  it('S-goal-13-1 — a Quarterly goal defaults to the quarter containing today, a Yearly one to the year', async () => {
    const { cookie } = await signedInOwner(t);
    const life = await createGoal(t, cookie, { title: 'Craft', horizon: 'Life' });
    const yearly = await createGoal(t, cookie, { title: 'Ship it', horizon: 'Yearly', parentId: life.id });
    expect(yearly.period).toBe('2026');
    expect((await createGoal(t, cookie, { title: 'Q', horizon: 'Quarterly', parentId: yearly.id })).period).toBe('Q3 2026');
  });

  it('S-goal-6-1 / D-6 — a sub-goal under a Monthly goal is refused and M still has zero children', async () => {
    const { cookie } = await signedInOwner(t);
    const { monthly } = await makeLine(t, cookie);
    const res = await t.fetch('/api/goals', {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { title: 'illegal', horizon: 'Monthly', parentId: monthly.id },
    });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('HORIZON_CONFLICT');
    expect((await goalsIn(t, cookie)).filter((g) => g.parentId === monthly.id)).toHaveLength(0);
    expect((await goalById(t, cookie, monthly.id)).isLeaf).toBe(true);
  });

  it('S-goal-29-1 — a whitespace-only title is a validation failure, not a silent no-op', async () => {
    const { cookie } = await signedInOwner(t);
    const before = (await goalsIn(t, cookie)).length;
    const res = await t.fetch('/api/goals', {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { title: '   ', horizon: 'Life' },
    });
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe('VALIDATION_FAILED');
    expect((await goalsIn(t, cookie)).length).toBe(before);
  });

  it('R-goal-3 — a Life goal created WITH a period is refused rather than silently blanked (Q-10)', async () => {
    const { cookie } = await signedInOwner(t);
    const res = await t.fetch('/api/goals', {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { title: 'Life', horizon: 'Life', period: '2027' },
    });
    expect(res.status).toBe(422);
  });

  it('Q-7 — the tree comes back parents-before-children, siblings by createdAt then id', async () => {
    const { cookie } = await signedInOwner(t);
    const { life, yearly, quarterly, monthly, yearly2 } = await makeLine(t, cookie);
    expect((await goalsIn(t, cookie)).map((g) => g.id)).toEqual([life.id, yearly.id, quarterly.id, monthly.id, yearly2.id]);
  });
});

describe('R-goal-14 — edit', () => {
  it('S-goal-14-1 — title, why, period and pulse persist; horizon and parent are untouched', async () => {
    const { cookie } = await signedInOwner(t);
    const { monthly } = await makeLine(t, cookie);
    const res = await t.fetch(`/api/goals/${monthly.id}`, {
      method: 'PATCH',
      cookie,
      json: { title: 'Renamed', why: 'because', period: 'Dec 2026', pulse: 'At risk' },
    });
    expect(res.status).toBe(200);
    const goal = ((await res.json()) as { goal: GoalView }).goal;
    expect([goal.title, goal.why, goal.period, goal.pulse]).toEqual(['Renamed', 'because', 'Dec 2026', 'At risk']);
    expect(goal.horizon).toBe(monthly.horizon);
    expect(goal.parentId).toBe(monthly.parentId);
    expect(goal.version).toBe(monthly.version + 1);
  });

  it('S-goal-14-2 — an edit carrying `horizon` or `parentId` is refused; re-parenting must go through Move', async () => {
    const { cookie } = await signedInOwner(t);
    const { quarterly, monthly, yearly2 } = await makeLine(t, cookie);
    for (const payload of [{ horizon: 'Yearly' }, { parentId: yearly2.id }]) {
      const res = await t.fetch(`/api/goals/${monthly.id}`, { method: 'PATCH', cookie, json: payload });
      expect(res.status, JSON.stringify(payload)).toBe(422);
    }
    const after = await goalById(t, cookie, monthly.id);
    expect([after.horizon, after.parentId]).toEqual(['Monthly', quarterly.id]);
  });

  it('Q-2 — a stale `version` loses the race with a clean 409 rather than clobbering', async () => {
    const { cookie } = await signedInOwner(t);
    const { monthly } = await makeLine(t, cookie);
    await t.fetch(`/api/goals/${monthly.id}`, { method: 'PATCH', cookie, json: { title: 'first' } });
    const res = await t.fetch(`/api/goals/${monthly.id}`, { method: 'PATCH', cookie, json: { title: 'second', version: 1 } });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('CONCURRENT_UPDATE');
    expect((await goalById(t, cookie, monthly.id)).title).toBe('first');
  });
});

describe('R-goal-16/17/18 — move', () => {
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
    const after = await goalById(t, cookie, yearly.id);
    expect(after.parentId).toBe(yearly.parentId);
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
    expect((await goalById(t, cookie, a.quarterly.id)).parentId).toBe(a.yearly.id);
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
    expect((await goalById(t, cookie, monthly.id)).parentId).toBe(quarterly.id);
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
      json: { period: '2027' },
    });
    expect(replanned.status).toBe(409);
    expect(await codeOf(replanned)).toBe('LIFE_GOAL_IMMUTABLE');
  });
});

describe('R-goal-9/10/11 — activity and dormancy are DERIVED, never stored', () => {
  it('S-goal-10-1 — a non-Life leaf with no focus this week is dormant', async () => {
    const { cookie } = await signedInOwner(t);
    const { monthly } = await makeLine(t, cookie);
    const goal = await goalById(t, cookie, monthly.id);
    expect([goal.isActive, goal.dormant, goal.focus]).toEqual([false, true, '']);
  });

  it('S-goal-11-1 — one active leaf lights the whole ancestor chain, two levels up and more', async () => {
    const { cookie } = await signedInOwner(t);
    const { life, yearly, quarterly, monthly } = await makeLine(t, cookie);
    expect((await savePlan(t, cookie, '2026-08-31', [{ goalId: monthly.id, sentence: 'three sessions' }])).status).toBe(200);

    const lit = await goalsIn(t, cookie);
    for (const id of [life.id, yearly.id, quarterly.id]) {
      expect(lit.find((g) => g.id === id)!.subtreeActive, id).toBe(true);
    }
    const leaf = lit.find((g) => g.id === monthly.id)!;
    expect([leaf.isActive, leaf.dormant, leaf.focus]).toEqual([true, false, 'three sessions']);

    // …and clearing it mutes all four again.
    expect((await savePlan(t, cookie, '2026-08-31', [])).status).toBe(200);
    const muted = await goalsIn(t, cookie);
    for (const id of [life.id, yearly.id, quarterly.id, monthly.id]) {
      expect(muted.find((g) => g.id === id)!.subtreeActive, id).toBe(false);
    }
  });

  it('S-goal-11-2 — a sibling branch with no active leaf stays muted while its parent is lit', async () => {
    const { cookie } = await signedInOwner(t);
    const life = await createGoal(t, cookie, { title: 'Life', horizon: 'Life' });
    const yearly = await createGoal(t, cookie, { title: 'Y', horizon: 'Yearly', parentId: life.id });
    const q1 = await createGoal(t, cookie, { title: 'Q1', horizon: 'Quarterly', parentId: yearly.id });
    const q2 = await createGoal(t, cookie, { title: 'Q2', horizon: 'Quarterly', parentId: yearly.id });
    const m1 = await createGoal(t, cookie, { title: 'M1', horizon: 'Monthly', parentId: q1.id });
    await createGoal(t, cookie, { title: 'M2', horizon: 'Monthly', parentId: q2.id });

    await savePlan(t, cookie, '2026-08-31', [{ goalId: m1.id, sentence: 'the one live branch' }]);
    const tree = await goalsIn(t, cookie);
    expect(tree.find((g) => g.id === yearly.id)!.subtreeActive).toBe(true);
    expect(tree.find((g) => g.id === q1.id)!.subtreeActive).toBe(true);
    expect(tree.find((g) => g.id === q2.id)!.subtreeActive).toBe(false);
  });

  it('S-goal-26-1 / D-16 — a Life line reports `<A> of <B> branches`, and B is 0 when it has no leaves', async () => {
    const { cookie } = await signedInOwner(t);
    const empty = await createGoal(t, cookie, { title: 'Empty line', horizon: 'Life' });
    expect((await goalById(t, cookie, empty.id)).branches).toEqual({ active: 0, total: 0 });

    const { life, monthly, yearly2 } = await makeLine(t, cookie);
    // non-Life leaves under L: `monthly` and `yearly2`
    expect((await goalById(t, cookie, life.id)).branches).toEqual({ active: 0, total: 2 });
    await savePlan(t, cookie, '2026-08-31', [{ goalId: monthly.id, sentence: 'go' }]);
    expect((await goalById(t, cookie, life.id)).branches).toEqual({ active: 1, total: 2 });
    expect((await goalById(t, cookie, yearly2.id)).dormant).toBe(true);
  });
});

describe('R-goal-24 — the quiet carrying signal on a life-goal card', () => {
  it('S-goal-24-1 — two open tasks, origins 3 and 1 weeks back → 2 carrying, oldest 3', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { life, monthly } = await makeLine(t, cookie);
    await seedTask(t, userId, monthly.id, '2026-08-10'); // 3 weeks before 2026-08-31
    await seedTask(t, userId, monthly.id, '2026-08-24'); // 1 week before
    expect((await goalById(t, cookie, life.id)).carrying).toEqual({ openTasks: 2, oldestWeeks: 3 });
  });

  it('S-goal-24-2 — a task that originated THIS week is not carrying, so the line is hidden (null)', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { life, monthly } = await makeLine(t, cookie);
    await seedTask(t, userId, monthly.id, '2026-08-31');
    expect((await goalById(t, cookie, life.id)).carrying).toBeNull();
  });
});

describe('R-goal-27 — the detail screen in one request', () => {
  it('breadcrumbs, children and the Life-goal backlog aggregate flag', async () => {
    const { cookie } = await signedInOwner(t);
    const { life, yearly, quarterly, monthly } = await makeLine(t, cookie);

    const res = await t.fetch(`/api/goals/${quarterly.id}`, { cookie });
    expect(res.status).toBe(200);
    const detail = (await res.json()) as GoalDetailResponse;
    expect(detail.ancestors.map((g) => g.id)).toEqual([life.id, yearly.id]);
    expect(detail.children.map((g) => g.id)).toEqual([monthly.id]);
    expect(detail.backlogIsAggregate).toBe(false);

    // R-backlog-12 — a Life goal's block is the read-only roll-up of the whole line.
    const lifeDetail = (await (await t.fetch(`/api/goals/${life.id}`, { cookie })).json()) as GoalDetailResponse;
    expect(lifeDetail.backlogIsAggregate).toBe(true);
    expect(lifeDetail.ancestors).toHaveLength(0);
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
