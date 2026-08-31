import { API_BASE, ENDPOINTS as E, LearningsResponse } from '@goal-cascade/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signedInOwner } from '../helpers/app';
import { deleteGoalAndUntag, seedGoal, type Fixture } from '../backlog/fixtures';

/** Learnings (R-learning-1..7, D-23). Never converted into work: re-tag and discard are the only actions. */
const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });

let f: Fixture;
let lineA: string;
let lineB: string;
let monthly: string;

beforeAll(async () => {
  const owner = await signedInOwner(t);
  f = { t, userId: owner.userId, cookie: owner.cookie };
  lineA = (await seedGoal(f, { parentId: null, horizon: 'Life', title: 'Health' })).id;
  lineB = (await seedGoal(f, { parentId: null, horizon: 'Life', title: 'Craft' })).id;
  const yearly = (await seedGoal(f, { parentId: lineA, horizon: 'Yearly', title: 'Marathon', periodKey: '2026' })).id;
  monthly = (await seedGoal(f, { parentId: yearly, horizon: 'Monthly', title: 'Long runs', periodKey: '2026-08' })).id;
});

const post = (path: string, json: unknown) =>
  t.fetch(`${API_BASE}${path}`, { method: 'POST', cookie: f.cookie, json, idempotencyKey: crypto.randomUUID() });

async function capture(text: string, goalId: string | null = null, applied = false) {
  const res = await post(E.learnings, { text, goalId, applied });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { learning: { id: string; goalId: string | null; applied: boolean; version: number } }).learning;
}

async function learnings() {
  const res = await t.fetch(`${API_BASE}${E.learnings}`, { cookie: f.cookie });
  expect(res.status).toBe(200);
  return LearningsResponse.parse(await res.json()).learnings;
}

describe('learnings', () => {
  it('R-learning-1/2 — a short insight with an optional Life-goal tag, newest first', async () => {
    t.clock.set('2026-08-26T09:00:00.000Z');
    const older = await capture('Mornings work better than evenings');
    t.clock.set('2026-08-31T10:00:00.000Z');
    const newer = await capture('Two rest days is not laziness', lineA);

    expect(newer.goalId).toBe(lineA);
    const order = (await learnings()).map((l) => l.id);
    expect(order.indexOf(newer.id)).toBeLessThan(order.indexOf(older.id));
  });

  it('R-learning-2 — a tag pointing at a non-Life goal is refused, on create and on re-tag', async () => {
    const create = await post(E.learnings, { text: 'Wrong tag', goalId: monthly });
    expect(create.status).toBe(409);
    expect(((await create.json()) as { error: { code: string } }).error.code).toBe('NOT_A_LIFE_GOAL');

    const learning = await capture('Right tag', lineA);
    const retag = await post(E.learningAttach(learning.id), { goalId: monthly });
    expect(retag.status).toBe(409);
    expect(((await retag.json()) as { error: { code: string } }).error.code).toBe('NOT_A_LIFE_GOAL');
    expect((await learnings()).find((l) => l.id === learning.id)!.goalId).toBe(lineA);
  });

  it('S-learning-3-1 — re-tagging from a Life goal to `No goal` sets goalId null (Unsorted)', async () => {
    const learning = await capture('Long runs need a flat route', lineA);

    const toB = await post(E.learningAttach(learning.id), { goalId: lineB });
    expect(toB.status).toBe(200);
    expect(((await toB.json()) as { learning: { goalId: string | null } }).learning.goalId).toBe(lineB);

    const toNone = await post(E.learningAttach(learning.id), { goalId: null });
    expect(toNone.status).toBe(200);
    expect(((await toNone.json()) as { learning: { goalId: string | null } }).learning.goalId).toBeNull();
    expect((await learnings()).find((l) => l.id === learning.id)!.goalId).toBeNull();
  });

  it('S-learning-4-1 / D-23 — `changed the plan` is a badge a user can actually earn', async () => {
    const learning = await capture('The plan was wrong about the taper', lineA);
    expect(learning.applied).toBe(false);

    const res = await t.fetch(`${API_BASE}${E.learning(learning.id)}`, {
      method: 'PATCH',
      cookie: f.cookie,
      json: { applied: true },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { learning: { applied: boolean } }).learning.applied).toBe(true);
    expect((await learnings()).find((l) => l.id === learning.id)!.applied).toBe(true);

    // …and it is a toggle, not a one-way door.
    const off = await t.fetch(`${API_BASE}${E.learning(learning.id)}`, {
      method: 'PATCH',
      cookie: f.cookie,
      json: { applied: false },
    });
    expect(((await off.json()) as { learning: { applied: boolean } }).learning.applied).toBe(false);
  });

  it('R-learning-6 — Discard removes it; there is no archive', async () => {
    const learning = await capture('Not worth keeping');
    const res = await t.fetch(`${API_BASE}${E.learning(learning.id)}`, { method: 'DELETE', cookie: f.cookie });
    expect(res.status).toBe(200);
    expect((await learnings()).some((l) => l.id === learning.id)).toBe(false);
    expect((await t.fetch(`${API_BASE}${E.learning(learning.id)}`, { method: 'DELETE', cookie: f.cookie })).status).toBe(404);
  });

  it('Q-2 — a stale version is refused rather than clobbering another device’s edit', async () => {
    const learning = await capture('Versioned');
    const res = await t.fetch(`${API_BASE}${E.learning(learning.id)}`, {
      method: 'PATCH',
      cookie: f.cookie,
      json: { text: 'Edited from a stale tab', version: learning.version + 3 },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('CONCURRENT_UPDATE');
    expect((await learnings()).find((l) => l.id === learning.id)!.text).toBe('Versioned');
  });

  it('Q-5 — a tag whose goal is deleted becomes Unsorted, not a deleted learning', async () => {
    const doomed = await seedGoal(f, { parentId: null, horizon: 'Life', title: 'A line that ends' });
    const learning = await capture('Survives its tag', doomed.id);

    await deleteGoalAndUntag(f, doomed.id);

    const after = (await learnings()).find((l) => l.id === learning.id);
    expect(after).toBeDefined();
    expect(after!.goalId).toBeNull();
  });

  it('R-learning-1 — a learning is never work: there is no convert-to-task endpoint for one', async () => {
    const learning = await capture('Insight, not a task');
    for (const path of [`${E.learning(learning.id)}/convert-to-task`, `${E.learning(learning.id)}/attach-to-backlog`]) {
      const res = await post(path, { goalId: lineA });
      expect(res.status, path).toBe(404);
      expect(((await res.json()) as { error: { message: string } }).error.message, path).toBe('route not found');
    }
  });
});
