import { API_BASE, BacklogResponse, ENDPOINTS as E } from '@goal-cascade/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signedInOwner } from '../helpers/app';
import { seedGoal, type Fixture } from './fixtures';

/**
 * The backlog, minus conversion (which has its own file).
 *
 * Every test here goes through the real router, the real middleware chain and real SQL, with only the
 * clock faked. Named after the `S-*` scenarios in `docs/SPEC.md` §3.
 */
const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });

let f: Fixture;
let life: string;
let yearly: string;
let quarterly: string;
let monthly: string;
let otherMonthly: string;

beforeAll(async () => {
  const owner = await signedInOwner(t);
  f = { t, userId: owner.userId, cookie: owner.cookie };
  life = (await seedGoal(f, { parentId: null, horizon: 'Life', title: 'Health' })).id;
  yearly = (await seedGoal(f, { parentId: life, horizon: 'Yearly', title: 'Run a marathon', periodKey: '2026' })).id;
  quarterly = (await seedGoal(f, { parentId: yearly, horizon: 'Quarterly', title: 'Base miles', periodKey: '2026-Q3' })).id;
  monthly = (await seedGoal(f, { parentId: quarterly, horizon: 'Monthly', title: 'Long runs', periodKey: '2026-08' })).id;
  otherMonthly = (await seedGoal(f, { parentId: quarterly, horizon: 'Monthly', title: 'Strength', periodKey: '2026-08' })).id;
});

const post = (path: string, json: unknown) =>
  t.fetch(`${API_BASE}${path}`, { method: 'POST', cookie: f.cookie, json, idempotencyKey: crypto.randomUUID() });

async function createItem(goalId: string, title: string, extra: Record<string, unknown> = {}) {
  const res = await post(E.backlog, { goalId, title, ...extra });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { item: { id: string; goalId: string; capturedAt: string; fromWeekStart: string | null } }).item;
}

async function listBacklog(goalId?: string) {
  const path = goalId ? `${E.backlog}?goalId=${goalId}` : E.backlog;
  const res = await t.fetch(`${API_BASE}${path}`, { cookie: f.cookie });
  expect(res.status).toBe(200);
  return BacklogResponse.parse(await res.json());
}

describe('backlog capture and listing', () => {
  it('R-backlog-1/4 — an item is captured on a non-Life goal with a title and a captured date', async () => {
    const item = await createItem(monthly, 'Book the race entry', {
      description: 'before prices go up',
      links: ['https://example.com/race'],
    });
    expect(item.goalId).toBe(monthly);
    // R-backlog-3 — deliberately no `done`, `cond`, `dueDate` or user-settable status on this shape.
    expect(item).not.toHaveProperty('done');
    expect(item).not.toHaveProperty('cond');
    expect(item).not.toHaveProperty('dueDate');

    const listed = (await listBacklog()).items.find((i) => i.id === item.id)!;
    expect(listed.description).toBe('before prices go up');
    expect(listed.links.map((l) => l.url)).toEqual(['https://example.com/race']);
    expect(listed.status).toBe('open');
    expect(listed.fromWeekStart).toBeNull();
  });

  it('S-backlog-2-1 — an item on a Life goal is refused, on create and on move', async () => {
    const create = await post(E.backlog, { goalId: life, title: 'Nope' });
    expect(create.status).toBe(409);
    expect(((await create.json()) as { error: { code: string } }).error.code).toBe('LIFE_GOAL_NO_BACKLOG');

    const item = await createItem(monthly, 'Movable');
    const move = await post(E.backlogItemMove(item.id), { goalId: life });
    expect(move.status).toBe(409);
    expect(((await move.json()) as { error: { code: string } }).error.code).toBe('LIFE_GOAL_NO_BACKLOG');
    // The refusal left the item where it was — a refusal is never a partial write.
    expect((await listBacklog(monthly)).items.find((i) => i.id === item.id)!.goalId).toBe(monthly);
  });

  it('S-backlog-16 (R-backlog-16) — a whitespace-only title is refused', async () => {
    const res = await post(E.backlog, { goalId: monthly, title: '   ' });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it('S-backlog-5-1 — items list newest first (capturedAt desc, id desc), and a new one appears at the top', async () => {
    t.clock.set('2026-08-25T09:00:00.000Z');
    const oldest = await createItem(monthly, 'Oldest');
    t.clock.set('2026-08-27T09:00:00.000Z');
    const middle = await createItem(monthly, 'Middle');
    t.clock.set('2026-08-31T10:00:00.000Z');
    const newest = await createItem(monthly, 'Newest');

    const ordered = (await listBacklog(monthly)).items.map((i) => i.id);
    expect(ordered.indexOf(newest.id)).toBeLessThan(ordered.indexOf(middle.id));
    expect(ordered.indexOf(middle.id)).toBeLessThan(ordered.indexOf(oldest.id));
    expect(ordered[0]).toBe(newest.id);

    // Q-7 — the order is TOTAL: two items captured at the same instant still have one stable order.
    const tieA = await createItem(monthly, 'Tie A');
    const tieB = await createItem(monthly, 'Tie B');
    expect(tieA.capturedAt).toBe(tieB.capturedAt);
    const again = (await listBacklog(monthly)).items.map((i) => i.id);
    expect(again.indexOf(tieB.id)).toBeLessThan(again.indexOf(tieA.id));
  });

  it('S-backlog-10-1 — a move re-homes the item and leaves capturedAt and fromWeekStart untouched', async () => {
    t.clock.set('2026-08-24T08:00:00.000Z');
    const item = await createItem(monthly, 'Relocate me');
    t.clock.set('2026-08-31T10:00:00.000Z');

    const res = await post(E.backlogItemMove(item.id), { goalId: otherMonthly });
    expect(res.status).toBe(200);
    const moved = ((await res.json()) as { item: { goalId: string; capturedAt: string; fromWeekStart: string | null } }).item;
    expect(moved.goalId).toBe(otherMonthly);
    expect(moved.capturedAt).toBe(item.capturedAt);
    expect(moved.fromWeekStart).toBe(item.fromWeekStart);

    expect((await listBacklog(otherMonthly)).items.some((i) => i.id === item.id)).toBe(true);
    expect((await listBacklog(monthly)).items.some((i) => i.id === item.id)).toBe(false);
  });

  it('R-backlog-10 — Delete removes the item outright; there is no archive', async () => {
    const item = await createItem(monthly, 'Drop me');
    const res = await t.fetch(`${API_BASE}${E.backlogItem(item.id)}`, { method: 'DELETE', cookie: f.cookie });
    expect(res.status).toBe(200);
    expect((await listBacklog()).items.some((i) => i.id === item.id)).toBe(false);

    // R-auth-3 / Q-10 — a second delete is a machine-readable refusal, never a silent no-op.
    const again = await t.fetch(`${API_BASE}${E.backlogItem(item.id)}`, { method: 'DELETE', cookie: f.cookie });
    expect(again.status).toBe(404);
  });

  it('S-backlog-11-1 — a non-Life goal lists only ITS OWN items', async () => {
    const mine = await createItem(monthly, 'Only on Monthly');
    const theirs = await createItem(otherMonthly, 'Only on the other Monthly');

    const own = (await listBacklog(monthly)).items.map((i) => i.id);
    expect(own).toContain(mine.id);
    expect(own).not.toContain(theirs.id);
  });

  it('S-backlog-12-1 — a Life goal shows the READ-ONLY aggregate of its descendants, each labelled with its own goal', async () => {
    const onYearly = await createItem(yearly, 'On the yearly');
    const onQuarterly = await createItem(quarterly, 'On the quarterly');
    const onMonthly = await createItem(monthly, 'On the monthly');

    const aggregate = await listBacklog(life);
    const byId = new Map(aggregate.items.map((i) => [i.id, i]));
    for (const item of [onYearly, onQuarterly, onMonthly]) {
      expect(byId.has(item.id), `${item.id} missing from the life-line roll-up`).toBe(true);
    }
    // Each row carries its OWN goalId, which is what the client labels it with — the roll-up never
    // re-attributes an item to the Life goal, because a Life goal holds none (R-backlog-2).
    expect(byId.get(onYearly.id)!.goalId).toBe(yearly);
    expect(byId.get(onQuarterly.id)!.goalId).toBe(quarterly);
    expect(byId.get(onMonthly.id)!.goalId).toBe(monthly);
    expect(aggregate.items.every((i) => i.goalId !== life)).toBe(true);

    // Read-only means it cannot be written THROUGH either: the Life goal itself takes no items.
    const write = await post(E.backlog, { goalId: life, title: 'Into the roll-up' });
    expect(write.status).toBe(409);
  });

  it('S-backlog-12-2 — a Life line with no items anywhere below it aggregates to nothing', async () => {
    const emptyLife = await seedGoal(f, { parentId: null, horizon: 'Life', title: 'Craft' });
    await seedGoal(f, { parentId: emptyLife.id, horizon: 'Yearly', title: 'Learn woodworking', periodKey: '2026' });
    expect((await listBacklog(emptyLife.id)).items).toEqual([]);
  });

  it('R-auth-2/3 — another owner’s item and another owner’s goal are both plain 404s', async () => {
    const item = await createItem(monthly, 'Mine alone');
    const intruder = await signedInOwner(t);

    const read = await t.fetch(`${API_BASE}${E.backlogItem(item.id)}`, { method: 'DELETE', cookie: intruder.cookie });
    expect(read.status).toBe(404);

    // S-auth-2-2 — the REFERENCED goal is ownership-checked too, not just the target.
    const cross = await t.fetch(`${API_BASE}${E.backlog}`, {
      method: 'POST',
      cookie: intruder.cookie,
      json: { goalId: monthly, title: 'On your goal' },
      idempotencyKey: crypto.randomUUID(),
    });
    expect(cross.status).toBe(404);
  });
});
