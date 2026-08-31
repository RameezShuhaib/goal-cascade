import { API_BASE, BacklogResponse, ENDPOINTS as E, HEADERS } from '@goal-cascade/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signedInOwner } from '../helpers/app';
import { backlogRow, openTasksUnder, seedFocus, seedGoal, type Fixture } from './fixtures';

/**
 * Conversion — R-backlog-6/7/8/9, Q-4, D-18, D-19.
 *
 * This is the sharpest rule in the backlog area and the mockup got both halves of it wrong: it created a
 * SECOND task from an item that had already vanished, and it never persisted the item's removal at all.
 * The tests below are the ones that must never be weakened.
 */
const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });
const CURRENT_WEEK = '2026-08-31';

let f: Fixture;
/** Active line: Life › Yearly › Quarterly › Monthly(active). */
let quarterly: string;
let monthlyActive: string;
/** Dormant line: no focus anywhere below it this week. */
let dormantQuarterly: string;
let dormantMonthly: string;

beforeAll(async () => {
  const owner = await signedInOwner(t);
  f = { t, userId: owner.userId, cookie: owner.cookie };

  const life = (await seedGoal(f, { parentId: null, horizon: 'Life', title: 'Health' })).id;
  const yearly = (await seedGoal(f, { parentId: life, horizon: 'Yearly', title: 'Marathon', period: '2026' })).id;
  quarterly = (await seedGoal(f, { parentId: yearly, horizon: 'Quarterly', title: 'Base miles', period: 'Q3 2026' })).id;
  monthlyActive = (await seedGoal(f, { parentId: quarterly, horizon: 'Monthly', title: 'Long runs', period: 'Aug 2026' })).id;
  await seedFocus(f, monthlyActive, CURRENT_WEEK, 'One long run every Sunday');

  dormantQuarterly = (await seedGoal(f, { parentId: yearly, horizon: 'Quarterly', title: 'Strength', period: 'Q3 2026' })).id;
  dormantMonthly = (await seedGoal(f, { parentId: dormantQuarterly, horizon: 'Monthly', title: 'Squats', period: 'Aug 2026' })).id;
});

const post = (path: string, json: unknown, key = crypto.randomUUID()) =>
  t.fetch(`${API_BASE}${path}`, { method: 'POST', cookie: f.cookie, json, idempotencyKey: key });

async function createItem(goalId: string, title: string, extra: Record<string, unknown> = {}) {
  const res = await post(E.backlog, { goalId, title, ...extra });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { item: { id: string; version: number } }).item;
}

async function backlogIds() {
  const res = await t.fetch(`${API_BASE}${E.backlog}`, { cookie: f.cookie });
  return BacklogResponse.parse(await res.json()).items.map((i) => i.id);
}

describe('backlog → task conversion', () => {
  it('S-backlog-6-1 — the item becomes a task carrying its title, description and links, and is gone from the backlog', async () => {
    const item = await createItem(monthlyActive, 'Order new shoes', {
      description: 'the ones that were on sale',
      links: ['https://example.com/shoes', 'https://example.com/reviews'],
    });

    const res = await post(E.backlogItemConvert(item.id), {});
    expect(res.status, await res.clone().text()).toBe(201);
    const out = (await res.json()) as {
      task: {
        id: string;
        goalId: string;
        title: string;
        description: string;
        links: { url: string }[];
        originWeekStart: string;
        events: { kind: string; text: string; glyph: string }[];
      };
      item: { status: string; convertedToTaskId: string | null; convertedAt: string | null };
    };

    expect(out.task.goalId).toBe(monthlyActive);
    expect(out.task.title).toBe('Order new shoes');
    expect(out.task.description).toBe('the ones that were on sale');
    expect(out.task.links.map((l) => l.url)).toEqual(['https://example.com/shoes', 'https://example.com/reviews']);
    // R-task-5 — origin is the CURRENT week, always.
    expect(out.task.originWeekStart).toBe(CURRENT_WEEK);
    // R-task-30 — the source is recorded on the created event, once, and never changes.
    expect(out.task.events).toHaveLength(1);
    expect(out.task.events[0]).toMatchObject({ kind: 'created', text: 'Created — pulled from Backlog', glyph: '＋' });

    // D-19 — the item is MARKED converted, with a pointer to the task it became. Not deleted: a deleted
    // row cannot refuse a second conversion.
    expect(out.item.status).toBe('converted');
    expect(out.item.convertedToTaskId).toBe(out.task.id);
    expect(out.item.convertedAt).not.toBeNull();

    // …and it is gone from the backlog — not on this goal, not anywhere.
    expect(await backlogIds()).not.toContain(item.id);
  });

  it('S-backlog-6-2 — converting the same item twice is refused, and EXACTLY ONE task exists', async () => {
    const item = await createItem(monthlyActive, 'Convert me once');

    const first = await post(E.backlogItemConvert(item.id), {});
    expect(first.status).toBe(201);
    const taskId = ((await first.json()) as { task: { id: string } }).task.id;

    // A stale second modal, a second device, a retry with a FRESH key — all the same attempt.
    const second = await post(E.backlogItemConvert(item.id), {});
    expect(second.status).toBe(409);
    const err = (await second.json()) as { error: { code: string; details?: Record<string, unknown> } };
    expect(err.error.code).toBe('ALREADY_CONVERTED');
    // The refusal names the task the item already became, so the client can navigate to it instead.
    expect(err.error.details?.taskId).toBe(taskId);

    const tasks = await openTasksUnder(f, [monthlyActive]);
    expect(tasks.filter((task) => task.title === 'Convert me once')).toHaveLength(1);
    expect(tasks.find((task) => task.title === 'Convert me once')!.id).toBe(taskId);

    // The first task is untouched and the item still points at it.
    const row = await backlogRow(f, item.id);
    expect(row!.status).toBe('converted');
    expect(row!.convertedToTaskId).toBe(taskId);
  });

  it('Q-4 — a replay with the SAME idempotency key returns the ORIGINAL task, not a second one', async () => {
    const item = await createItem(monthlyActive, 'Retried over a flaky network');
    const key = crypto.randomUUID();

    const first = await post(E.backlogItemConvert(item.id), {}, key);
    expect(first.status).toBe(201);
    const firstTask = ((await first.json()) as { task: { id: string } }).task;

    const replay = await post(E.backlogItemConvert(item.id), {}, key);
    expect(replay.status).toBe(201);
    expect(replay.headers.get(HEADERS.idempotentReplayed)).toBe('true');
    expect(((await replay.json()) as { task: { id: string } }).task.id).toBe(firstTask.id);

    expect((await openTasksUnder(f, [monthlyActive])).filter((x) => x.title === 'Retried over a flaky network')).toHaveLength(1);
  });

  it('S-backlog-8-3 — a conversion into a branch with no active focus is refused BRANCH_NOT_ACTIVE, server-side', async () => {
    const item = await createItem(dormantQuarterly, 'Deferred strength work');

    const res = await post(E.backlogItemConvert(item.id), {});
    expect(res.status).toBe(409);
    const err = (await res.json()) as { error: { code: string; message: string } };
    expect(err.error.code).toBe('BRANCH_NOT_ACTIVE');
    // The copy the sheet needs: `"<item title>" can only become a task under an active weekly focus.`
    expect(err.error.message).toContain('Deferred strength work');
    expect(err.error.message).toContain('active weekly focus');

    // S-backlog-8-2 — the item is untouched and no task exists under the dormant branch.
    expect(await backlogIds()).toContain(item.id);
    expect((await backlogRow(f, item.id))!.status).toBe('open');
    expect(await openTasksUnder(f, [dormantQuarterly, dormantMonthly])).toEqual([]);
  });

  it('S-backlog-7-1 — one active leaf under the item’s goal receives the task, silently and correctly', async () => {
    const item = await createItem(quarterly, 'Captured on the quarterly');
    const res = await post(E.backlogItemConvert(item.id), {});
    expect(res.status).toBe(201);
    // The task lands on the LEAF, never on the quarterly goal the item was filed under.
    expect(((await res.json()) as { task: { goalId: string } }).task.goalId).toBe(monthlyActive);
  });

  it('S-backlog-7-2 / D-18 — two active leaves under the item’s goal: the server refuses to pick, and no task is created', async () => {
    const second = await seedGoal(f, { parentId: quarterly, horizon: 'Monthly', title: 'Speed work', period: 'Aug 2026' });
    await seedFocus(f, second.id, CURRENT_WEEK, 'Two interval sessions');
    const item = await createItem(quarterly, 'Ambiguous target');

    const res = await post(E.backlogItemConvert(item.id), {});
    // REVIEW: was `422 VALIDATION_FAILED`. The input was well formed — the product has no single answer
    // yet — so this is a product refusal with its own 409 code, which the client branches on to render a
    // chooser instead of a field error. The assertions this test exists to make (no silent pick, both
    // candidates named, the item untouched, naming one resolves it) are unchanged.
    expect(res.status).toBe(409);
    const err = (await res.json()) as { error: { code: string; details?: { candidates?: { id: string }[] } } };
    expect(err.error.code).toBe('AMBIGUOUS_CONVERSION_TARGET');
    // The refusal carries the choice the user has to make — it is not a dead end.
    expect(err.error.details?.candidates?.map((c) => c.id).sort()).toEqual([monthlyActive, second.id].sort());
    expect((await backlogRow(f, item.id))!.status).toBe('open');

    // Naming one of them resolves it, and the task lands exactly there.
    const chosen = await post(E.backlogItemConvert(item.id), { goalId: second.id });
    expect(chosen.status).toBe(201);
    expect(((await chosen.json()) as { task: { goalId: string } }).task.goalId).toBe(second.id);
  });

  it('R-backlog-7 — a named target that is not an active leaf at or under the item is refused', async () => {
    const item = await createItem(monthlyActive, 'Wrong target');
    const res = await post(E.backlogItemConvert(item.id), { goalId: dormantMonthly });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BRANCH_NOT_ACTIVE');
    expect((await backlogRow(f, item.id))!.status).toBe('open');
  });

  it('S-backlog-9-1 — converting an item that was deleted is refused, and no task is created', async () => {
    const item = await createItem(monthlyActive, 'Deleted before conversion');
    const before = (await openTasksUnder(f, [monthlyActive])).length;

    const del = await t.fetch(`${API_BASE}${E.backlogItem(item.id)}`, { method: 'DELETE', cookie: f.cookie });
    expect(del.status).toBe(200);

    const res = await post(E.backlogItemConvert(item.id), {});
    expect(res.status).toBe(404);
    expect(await openTasksUnder(f, [monthlyActive])).toHaveLength(before);
  });

  it('R-backlog-6 — a converted item is no longer editable or movable: it is a task now', async () => {
    const item = await createItem(monthlyActive, 'Then locked');
    expect((await post(E.backlogItemConvert(item.id), {})).status).toBe(201);

    const patch = await t.fetch(`${API_BASE}${E.backlogItem(item.id)}`, {
      method: 'PATCH',
      cookie: f.cookie,
      json: { title: 'Renamed after the fact' },
    });
    expect(patch.status).toBe(409);
    expect(((await patch.json()) as { error: { code: string } }).error.code).toBe('ALREADY_CONVERTED');

    const move = await post(E.backlogItemMove(item.id), { goalId: dormantMonthly });
    expect(move.status).toBe(409);
    expect(((await move.json()) as { error: { code: string } }).error.code).toBe('ALREADY_CONVERTED');
  });

  it('D-19 — two conversions racing at the same instant produce one task and one refusal, never two tasks', async () => {
    const item = await createItem(monthlyActive, 'Two devices at once');

    // The read-phase `ALREADY_CONVERTED` check cannot separate these: both may read `status = 'open'`.
    // What separates them is `markConvertedGuardedStmt` pinning `status='open' AND version` INSIDE the
    // same GuardedBatch as the task INSERT — the loser changes zero rows, `_guard` trips, and D1 rolls
    // the task insert back with it. That is the layer the mockup had no equivalent of.
    const [a, b] = await Promise.all([post(E.backlogItemConvert(item.id), {}), post(E.backlogItemConvert(item.id), {})]);

    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(201);
    expect(statuses[1]).toBe(409);
    const refused = a.status === 409 ? a : b;
    expect(['ALREADY_CONVERTED', 'CONCURRENT_UPDATE']).toContain(
      ((await refused.json()) as { error: { code: string } }).error.code,
    );

    expect((await openTasksUnder(f, [monthlyActive])).filter((x) => x.title === 'Two devices at once')).toHaveLength(1);
  });

  it('Q-2 — a conversion carrying a stale version loses cleanly, with no task created', async () => {
    const item = await createItem(monthlyActive, 'Stale version');
    const before = (await openTasksUnder(f, [monthlyActive])).length;

    const res = await post(E.backlogItemConvert(item.id), { version: item.version + 5 });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('CONCURRENT_UPDATE');
    expect(await openTasksUnder(f, [monthlyActive])).toHaveLength(before);
    expect((await backlogRow(f, item.id))!.status).toBe('open');
  });
});
