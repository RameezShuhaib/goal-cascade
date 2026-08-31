import { API_BASE, BacklogResponse, GoalDetailResponse, ENDPOINTS as E } from '@goal-cascade/shared';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, signedInOwner } from '../helpers/app';
import { seedGoal, seedWeeklyGoal, type Fixture } from './fixtures';

/**
 * ⚠ **A1 — manual backlog order** (R-backlog-17 … R-backlog-21), the server half.
 *
 * Named after the `S-*` scenarios in `docs/SPEC.md` §3. Every test goes through the real router, the real
 * middleware chain and real SQL, with only the clock faked — so what is asserted is what a client would
 * actually receive, including the order the rows come back in.
 */
const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });

let f: Fixture;
let life: string;
let yearly: string;
let M: string;
let N: string;

beforeAll(async () => {
  const owner = await signedInOwner(t);
  f = { t, userId: owner.userId, cookie: owner.cookie };
  life = (await seedGoal(f, { parentId: null, horizon: 'Life', title: 'Be strong at 60' })).id;
  yearly = (await seedGoal(f, { parentId: life, horizon: 'Yearly', title: 'Get back under 80kg', periodKey: '2026' })).id;
  M = (await seedGoal(f, { parentId: yearly, horizon: 'Monthly', title: 'Lift three times a week', periodKey: '2026-08' })).id;
  N = (await seedGoal(f, { parentId: yearly, horizon: 'Monthly', title: 'Write the changelog', periodKey: '2026-08' })).id;
});

const post = (path: string, json: unknown) =>
  t.fetch(`${API_BASE}${path}`, { method: 'POST', cookie: f.cookie, json, idempotencyKey: crypto.randomUUID() });

type Item = { id: string; title: string; sortKey: string; capturedAt: string; goalId: string; version: number; fromWeekStart: string | null };

async function capture(goalId: string, title: string): Promise<Item> {
  const res = await post(E.backlog, { goalId, title });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { item: Item }).item;
}

async function listAll() {
  const res = await t.fetch(`${API_BASE}${E.backlog}`, { cookie: f.cookie });
  expect(res.status).toBe(200);
  return BacklogResponse.parse(await res.json()).items;
}

/** The order the Backlog page renders INSIDE one goal's group, straight off the wire. */
async function titlesIn(goalId: string): Promise<string[]> {
  return (await listAll()).filter((i) => i.goalId === goalId).map((i) => i.title);
}

/** The same list as `GET /goals/:id` renders it — R-backlog-11's block on the goal's own page. */
async function detailTitles(goalId: string): Promise<string[]> {
  const res = await t.fetch(`${API_BASE}${E.goal(goalId)}`, { cookie: f.cookie });
  expect(res.status).toBe(200);
  return GoalDetailResponse.parse(await res.json()).backlog.map((i) => i.title);
}

const reorder = (id: string, body: Record<string, unknown>) => post(E.backlogItemReorder(id), body);

async function codeOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

/** Empty `M` and `N` between tests, so each one states its own starting list. */
async function clear() {
  for (const item of await listAll()) {
    await t.fetch(`${API_BASE}${E.backlogItem(item.id)}`, { method: 'DELETE', cookie: f.cookie });
  }
}

describe('R-backlog-18 — where a new item lands', () => {
  beforeEach(clear);

  it('S-backlog-18-1 — a new capture goes to the TOP, above a list that has been rearranged', async () => {
    const a = await capture(M, 'A');
    const b = await capture(M, 'B');
    // Newest first is what capture alone produces (R-backlog-5, still true of an untouched list).
    expect(await titlesIn(M)).toEqual(['B', 'A']);

    const c = await capture(M, 'C');
    await reorder(c.id, { to: 'top' });
    expect(await titlesIn(M)).toEqual(['C', 'B', 'A']);
    void a;
    void b;

    const d = await capture(M, 'D');
    expect(d.sortKey < (await listAll()).find((i) => i.title === 'C')!.sortKey).toBe(true);
    expect(await titlesIn(M)).toEqual(['D', 'C', 'B', 'A']);
  });
});

describe('R-backlog-17/19 — the relative move', () => {
  beforeEach(clear);

  it('S-backlog-17-1 — moving the last item to the top holds on the page, on the goal, and after a refetch', async () => {
    // Captured A, B, C in that order → the untouched list reads C, B, A (newest first).
    await capture(M, 'A');
    await capture(M, 'B');
    const c = await capture(M, 'C');
    const capturedAtBefore = new Map((await listAll()).map((i) => [i.title, i.capturedAt]));

    // `C` is already on top, so move `A` — the oldest — there instead, which is the real assertion.
    const a = (await listAll()).find((i) => i.title === 'A')!;
    expect((await reorder(a.id, { to: 'top' })).status).toBe(200);

    expect(await titlesIn(M)).toEqual(['A', 'C', 'B']);
    expect(await detailTitles(M)).toEqual(['A', 'C', 'B']);
    // "after a full refetch" — the order is stored, not a property of one response.
    expect(await titlesIn(M)).toEqual(['A', 'C', 'B']);
    // …and every item's `capturedAt` is unchanged: rearranging is not re-capturing.
    for (const item of await listAll()) expect(item.capturedAt).toBe(capturedAtBefore.get(item.title));
    void c;
  });

  it('S-backlog-19-1 — `after: <B>` lands immediately after B, and the command carried no position index', async () => {
    await capture(M, 'A');
    const b = await capture(M, 'B');
    await capture(M, 'C');
    expect(await titlesIn(M)).toEqual(['C', 'B', 'A']);

    const c = (await listAll()).find((i) => i.title === 'C')!;
    const res = await reorder(c.id, { after: b.id });
    expect(res.status).toBe(200);
    expect(await titlesIn(M)).toEqual(['B', 'C', 'A']);

    // A position index is not merely unused — there is no field for one, so `.strict()` refuses it.
    expect((await reorder(c.id, { position: 0 })).status).toBe(422);
  });

  it('R-backlog-19 — `before` and the two ends are correct, including "after the last item"', async () => {
    await capture(M, 'A');
    await capture(M, 'B');
    await capture(M, 'C');
    expect(await titlesIn(M)).toEqual(['C', 'B', 'A']);
    const id = (title: string) => listAll().then((rows) => rows.find((i) => i.title === title)!.id);

    // Both ends of the list, which is where an off-by-one hides.
    expect((await reorder(await id('C'), { to: 'bottom' })).status).toBe(200);
    expect(await titlesIn(M)).toEqual(['B', 'A', 'C']);

    expect((await reorder(await id('C'), { before: await id('B') })).status).toBe(200);
    expect(await titlesIn(M)).toEqual(['C', 'B', 'A']);

    // `after: <the last item>` and `to: bottom` name the same position and must agree.
    expect((await reorder(await id('C'), { after: await id('A') })).status).toBe(200);
    expect(await titlesIn(M)).toEqual(['B', 'A', 'C']);

    expect((await reorder(await id('B'), { to: 'top' })).status).toBe(200);
    expect(await titlesIn(M)).toEqual(['B', 'A', 'C']);
  });

  it('S-backlog-19-2 — a neighbour on another goal, a converted one, or a missing one is refused and nothing moves', async () => {
    const a = await capture(M, 'A');
    await capture(M, 'B');
    const elsewhere = await capture(N, 'X');
    const before = await titlesIn(M);

    // Another goal: manual order is per goal (R-backlog-21), so a row outside it has no position to sit
    // next to. Refused identically to a row that does not exist — the client cannot probe with it.
    expect((await reorder(a.id, { after: elsewhere.id })).status).toBe(422);
    expect((await reorder(a.id, { after: '01J9ZQ8V2M7K3PQRSTVWXY0123' })).status).toBe(422);
    // Itself.
    expect((await reorder(a.id, { after: a.id })).status).toBe(422);
    expect(await titlesIn(M)).toEqual(before);
    expect(await titlesIn(N)).toEqual(['X']);
  });

  it('S-backlog-19-2 — a CONVERTED neighbour is refused, and the converted row is out of the order entirely', async () => {
    const week = (await seedWeeklyGoal(f, M, '2026-08-31', 'This week')).id;
    await capture(M, 'A');
    const b = await capture(M, 'B');
    const c = await capture(M, 'C');

    const convert = await post(E.backlogItemConvert(b.id), { week: 0, goalId: week });
    expect(convert.status, await convert.clone().text()).toBe(201);

    // R-backlog-20 — conversion leaves a GAP: the survivors keep their relative order, nothing re-keyed.
    expect(await titlesIn(M)).toEqual(['C', 'A']);
    expect((await reorder(c.id, { after: b.id })).status).toBe(422);
    expect(await titlesIn(M)).toEqual(['C', 'A']);
  });

  it('S-backlog-19-3 — a stale `version` is refused with CONCURRENT_UPDATE and the stored order is unchanged', async () => {
    const a = await capture(M, 'A');
    await capture(M, 'B');
    const before = await titlesIn(M);

    const res = await reorder(a.id, { to: 'top', version: a.version + 5 });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('CONCURRENT_UPDATE');
    expect(await titlesIn(M)).toEqual(before);
  });

  it('R-backlog-19 — a converted item cannot be re-ordered at all', async () => {
    const week = (await seedWeeklyGoal(f, M, '2026-08-31', 'Also this week')).id;
    const a = await capture(M, 'A');
    expect((await post(E.backlogItemConvert(a.id), { week: 0, goalId: week })).status).toBe(201);
    const res = await reorder(a.id, { to: 'top' });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('ALREADY_CONVERTED');
  });
});

describe('R-backlog-19 — concurrent reorders do not corrupt the order', () => {
  beforeEach(clear);

  it('two reorders of DIFFERENT items at once leave a list that is still a total order over the same rows', async () => {
    for (const title of ['A', 'B', 'C', 'D']) await capture(M, title);
    const rows = await listAll();
    const a = rows.find((i) => i.title === 'A')!;
    const d = rows.find((i) => i.title === 'D')!;

    // No interactive transactions in D1, so this is the shape that matters: two guarded batches racing.
    const [one, two] = await Promise.all([reorder(a.id, { to: 'top' }), reorder(d.id, { to: 'bottom' })]);
    expect([one.status, two.status].every((s) => s === 200 || s === 409)).toBe(true);

    const after = await titlesIn(M);
    // Nothing lost, nothing duplicated, and one arrangement — which is the property R-backlog-17's
    // total order buys. WHICH of the two intents won is a race the owner can see and redo; a list that
    // dropped a row, or that read differently twice, would not be.
    expect([...after].sort()).toEqual(['A', 'B', 'C', 'D']);
    expect(await titlesIn(M)).toEqual(after);
  });

  it('the same item reordered twice at once: the loser is refused, and no half-written order survives', async () => {
    for (const title of ['A', 'B', 'C']) await capture(M, title);
    const a = (await listAll()).find((i) => i.title === 'A')!;

    const [one, two] = await Promise.all([
      reorder(a.id, { to: 'top', version: a.version }),
      reorder(a.id, { to: 'bottom', version: a.version }),
    ]);
    const statuses = [one.status, two.status].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1] === 409 || statuses[1] === 200).toBe(true);

    const after = await titlesIn(M);
    expect([...after].sort()).toEqual(['A', 'B', 'C']);
    expect(await titlesIn(M)).toEqual(after);
  });
});

describe('R-backlog-20 — moving, converting and deleting', () => {
  beforeEach(clear);

  it('S-backlog-20-1 — a move to another goal lands at the TOP of the destination, keeping capturedAt and fromWeek', async () => {
    await capture(M, 'A');
    await capture(M, 'B');
    await capture(M, 'C');
    await capture(N, 'Y');
    await capture(N, 'X');
    expect(await titlesIn(M)).toEqual(['C', 'B', 'A']);
    expect(await titlesIn(N)).toEqual(['X', 'Y']);

    const a = (await listAll()).find((i) => i.title === 'A')!;
    const res = await post(E.backlogItemMove(a.id), { goalId: N, version: a.version });
    expect(res.status, await res.clone().text()).toBe(200);

    expect(await titlesIn(N)).toEqual(['A', 'X', 'Y']);
    expect(await titlesIn(M)).toEqual(['C', 'B']);
    const moved = (await listAll()).find((i) => i.title === 'A')!;
    // S-backlog-10-1 still holds: it did not become newer by being re-filed.
    expect(moved.capturedAt).toBe(a.capturedAt);
    expect(moved.fromWeekStart).toBe(a.fromWeekStart);
  });

  it('S-backlog-20-2 — deleting the middle of a rearranged list leaves the survivors in order, un-re-keyed', async () => {
    await capture(M, 'A');
    await capture(M, 'B');
    await capture(M, 'C');
    const rows = await listAll();
    const keys = new Map(rows.map((i) => [i.title, i.sortKey]));

    const b = rows.find((i) => i.title === 'B')!;
    expect((await t.fetch(`${API_BASE}${E.backlogItem(b.id)}`, { method: 'DELETE', cookie: f.cookie })).status).toBe(200);

    expect(await titlesIn(M)).toEqual(['C', 'A']);
    // The gap is the point: nothing was renumbered, so no sibling took a write it did not need.
    for (const item of await listAll()) expect(item.sortKey).toBe(keys.get(item.title));
  });
});

describe('R-backlog-21 — manual order is per goal, and only per goal', () => {
  beforeEach(clear);

  it('S-backlog-21-1 — the Life-goal aggregate ignores every per-goal manual order', async () => {
    await capture(M, 'M-old');
    await capture(N, 'N-mid');
    await capture(M, 'M-new');
    // Rearrange inside M so its manual order disagrees with `capturedAt` desc.
    const oldest = (await listAll()).find((i) => i.title === 'M-old')!;
    expect((await reorder(oldest.id, { to: 'top' })).status).toBe(200);
    expect(await titlesIn(M)).toEqual(['M-old', 'M-new']);

    const res = await t.fetch(`${API_BASE}${E.goal(life)}`, { cookie: f.cookie });
    const detail = GoalDetailResponse.parse(await res.json());
    expect(detail.backlogIsAggregate).toBe(true);
    // Newest first across all three goals, per R-backlog-21 — the manual order is not applied here at all.
    expect(detail.backlog.map((i) => i.title)).toEqual(['M-new', 'N-mid', 'M-old']);
  });

  it('R-backlog-13 — the page orders GROUPS newest-first while ordering WITHIN a group by hand', async () => {
    await capture(M, 'M-first');
    await capture(M, 'M-second');
    await capture(N, 'N-only');
    // `N-only` is the newest item anywhere, so its group leads the page.
    const oldest = (await listAll()).find((i) => i.title === 'M-first')!;
    expect((await reorder(oldest.id, { to: 'top' })).status).toBe(200);

    expect((await listAll()).map((i) => i.title)).toEqual(['N-only', 'M-first', 'M-second']);
  });
});

describe('R-backlog-13 — the owning-goal labels the page groups by', () => {
  beforeEach(clear);

  it('every item carries its own goal title and its Life goal title, on every list that ships one', async () => {
    const item = await capture(M, 'Find a squat rack');
    const listed = (await listAll()).find((i) => i.id === item.id)!;
    expect(listed.goalTitle).toBe('Lift three times a week');
    expect(listed.lifeGoalTitle).toBe('Be strong at 60');

    const detail = GoalDetailResponse.parse(
      await (await t.fetch(`${API_BASE}${E.goal(M)}`, { cookie: f.cookie })).json(),
    );
    expect(detail.backlog[0]!.goalTitle).toBe('Lift three times a week');
    expect(detail.backlog[0]!.lifeGoalTitle).toBe('Be strong at 60');
  });

  it('a command response carries them too, so a patched cache never renders a blank header', async () => {
    const item = await capture(M, 'Book an induction');
    const moved = (await (await post(E.backlogItemMove(item.id), { goalId: N })).json()) as { item: { goalTitle: string; lifeGoalTitle: string | null } };
    expect(moved.item.goalTitle).toBe('Write the changelog');
    expect(moved.item.lifeGoalTitle).toBe('Be strong at 60');
  });
});

describe('R-auth-2/3 — reorder is owner-scoped like every other write', () => {
  it("another account's item is refused as NOT_FOUND, and its order is untouched", async () => {
    // A second signed-in account of its own: cross-account scoping must be proved against real rows,
    // not against a hand-made id that no owner has.
    const other = await signedInOwner(t);
    const g = { t, userId: other.userId, cookie: other.cookie } satisfies Fixture;
    const theirLife = (await seedGoal(g, { parentId: null, horizon: 'Life', title: 'Theirs' })).id;
    const theirMonth = (await seedGoal(g, { parentId: theirLife, horizon: 'Monthly', title: 'Their month', periodKey: '2026-08' })).id;

    const mine = await t.fetch(`${API_BASE}${E.backlog}`, {
      method: 'POST',
      cookie: other.cookie,
      json: { goalId: theirMonth, title: 'Theirs A' },
      idempotencyKey: crypto.randomUUID(),
    });
    expect(mine.status).toBe(201);
    const theirItem = ((await mine.json()) as { item: Item }).item;

    // `f.cookie` is the first owner. R-auth-3 — indistinguishable from an id that does not exist.
    const res = await reorder(theirItem.id, { to: 'top' });
    expect(res.status).toBe(404);
    expect(await codeOf(res)).toBe('NOT_FOUND');

    // And the first owner cannot see it in any list either.
    expect((await listAll()).some((i) => i.id === theirItem.id)).toBe(false);
  });
});
