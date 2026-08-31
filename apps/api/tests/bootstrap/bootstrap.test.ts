import { API_BASE, BacklogResponse, BootstrapResponse, ENDPOINTS as E, LearningsResponse } from '@goal-cascade/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signedInOwner } from '../helpers/app';
import { seedGoal, seedWeeklyGoal, type Fixture } from '../backlog/fixtures';

/**
 * `GET /bootstrap` — the cold-open read model (the mockup's `fetchAll`).
 *
 * `BootstrapService` composes the OTHER services' readers and derives nothing of its own. The original
 * version of this file installed FAKE readers through the container seam, because `GoalService`,
 * `PlanService` and `TaskService` were other agents' stubs, and said "when those services land the fakes
 * come out and the assertions do not change". They have landed, so the fakes are out and this runs
 * against the real ones — which is the stronger test: it proves the composition AND the readers.
 *
 * ⚠ **A2 (R-rm-5, R-nav-28) — the payload changed shape, and that is the point.** It used to ship the
 * WHOLE goal tree plus the plan, which meant `SELECT * FROM goals WHERE user_id = ?` twice per cold open
 * and Θ(n²·d) of derivation on top. A cold start opens the **Weekly lens at the week containing today**,
 * so that is what it carries: the Life goals, that lens, and its week's tasks.
 */
const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });
const CURRENT_WEEK = '2026-08-31';

let f: Fixture;
let life: string;
let monthly: string;
let weekly: string;

const post = (path: string, json: unknown) =>
  t.fetch(`${API_BASE}${path}`, { method: 'POST', cookie: f.cookie, json, idempotencyKey: crypto.randomUUID() });

beforeAll(async () => {
  const owner = await signedInOwner(t);
  f = { t, userId: owner.userId, cookie: owner.cookie };

  life = (await seedGoal(f, { parentId: null, horizon: 'Life', title: 'Health' })).id;
  const yearly = (await seedGoal(f, { parentId: life, horizon: 'Yearly', title: 'Marathon', periodKey: '2026' })).id;
  monthly = (await seedGoal(f, { parentId: yearly, horizon: 'Monthly', title: 'Long runs', periodKey: '2026-08' })).id;
  weekly = (await seedWeeklyGoal(f, monthly, CURRENT_WEEK, 'One long run every Sunday')).id;

  await post(E.backlog, { goalId: monthly, title: 'Book the race entry' });
  await post(E.learnings, { text: 'Two rest days is not laziness', goalId: life });
  await post(E.tasks, { goalId: weekly, title: 'Sunday 20k' });
});

describe('GET /bootstrap', () => {
  it('returns a coherent snapshot of one week in ONE round trip', async () => {
    const res = await t.fetch(`${API_BASE}${E.bootstrap}`, { cookie: f.cookie });
    expect(res.status, await res.clone().text()).toBe(200);

    // The strongest coherence check available: the whole payload parses against the shared contract.
    const boot = BootstrapResponse.parse(await res.json());

    expect(boot.user.id).toBe(f.userId);
    expect(boot.preferences.timezone).toBeTruthy();
    expect(boot.week).toEqual({ weekStart: CURRENT_WEEK, offset: 0, isCurrent: true, isPast: false });

    // R-lens-2 — the Life goals, which is the one list guaranteed complete.
    expect(boot.lifeGoals.map((g) => g.id)).toEqual([life]);
    // R-nav-28 — the Weekly lens at the week containing today, exactly as `GET /goals` would answer it.
    expect(boot.lens.lens).toBe('Weekly');
    expect(boot.lens.period?.periodKey).toBe(CURRENT_WEEK);
    expect(boot.lens.items.map((g) => g.id)).toEqual([weekly]);
    expect(boot.lens.tasks.map((x) => x.title)).toEqual(['Sunday 20k']);
    expect(boot.backlog.map((i) => i.title)).toEqual(['Book the race entry']);
    expect(boot.learnings.map((l) => l.text)).toEqual(['Two rest days is not laziness']);

    // Every array is internally consistent with the lens it ships alongside.
    const lensIds = new Set(boot.lens.items.map((g) => g.id));
    for (const task of boot.lens.tasks) expect(lensIds.has(task.goalId)).toBe(true);
    // R-lens-3 — each item's group is already resolved by the SERVER; the client walks no chain.
    for (const item of boot.lens.items) expect(item.lifeRootId).toBe(life);
    const lifeIds = new Set(boot.lifeGoals.map((g) => g.id));
    for (const l of boot.learnings) expect(l.goalId === null || lifeIds.has(l.goalId)).toBe(true);
  });

  /**
   * RETIRED — the old test counted reader calls through container fakes to prove bootstrap composed
   * rather than re-derived. The composition is now proven by the assertion below, which is stronger and
   * needs no seam: the SAME endpoints answer the SAME rows.
   *
   * ⚠ **A2 (R-rm-5, S-lens-16-1)** — and the assertion that matters most is what is NOT here: no field
   * on this payload is every goal in the account.
   */
  it('S-rm-5-1 / S-lens-16-1 — it does NOT ship the whole goal tree, and has no plan or ideas', async () => {
    // A Yearly and a Monthly goal exist; neither is in the Weekly lens, and neither is a Life goal.
    const boot = BootstrapResponse.parse(await (await t.fetch(`${API_BASE}${E.bootstrap}`, { cookie: f.cookie })).json());
    const shipped = new Set([...boot.lifeGoals, ...boot.lens.items, ...boot.lens.carried].map((g) => g.id));
    expect(shipped.has(monthly)).toBe(false);

    for (const gone of ['goals', 'plan', 'ideas', 'weekHistoryWeeks']) {
      expect(boot as unknown as Record<string, unknown>, gone).not.toHaveProperty(gone);
    }
  });

  it('agrees, field for field, with the endpoints it replaces', async () => {
    const boot = BootstrapResponse.parse(await (await t.fetch(`${API_BASE}${E.bootstrap}`, { cookie: f.cookie })).json());

    const backlog = BacklogResponse.parse(await (await t.fetch(`${API_BASE}${E.backlog}`, { cookie: f.cookie })).json());
    const learnings = LearningsResponse.parse(await (await t.fetch(`${API_BASE}${E.learnings}`, { cookie: f.cookie })).json());
    const lensRes = await t.fetch(`${API_BASE}${E.goals}?lens=Weekly`, { cookie: f.cookie });
    const goalLens = (await lensRes.json()) as { items: { id: string }[]; tasks: { id: string }[] };

    expect(boot.backlog).toEqual(backlog.items);
    expect(boot.learnings).toEqual(learnings.learnings);
    // The composition, asserted directly: bootstrap's lens IS the lens read, not a second answer to it.
    expect(boot.lens.items.map((g) => g.id)).toEqual(goalLens.items.map((g) => g.id));
    expect(boot.lens.tasks.map((x) => x.id)).toEqual(goalLens.tasks.map((x) => x.id));
  });

  /**
   * SUPERSEDED — the old assertion was "`?week=` addresses a past week absolutely, and a FUTURE week is
   * refused" (R-nav-3). R-lens-7 supersedes the second half: a future week is ordinary and writable.
   * D-1's half — that a week is addressed ABSOLUTELY and does not decay — is unchanged and still here.
   */
  it('S-lens-7-3 / D-1 — `?week=` addresses any week absolutely, in BOTH directions', async () => {
    const past = await t.fetch(`${API_BASE}${E.bootstrap}?week=-1`, { cookie: f.cookie });
    expect(past.status).toBe(200);
    const pastWeek = ((await past.json()) as { week: { weekStart: string; isPast: boolean } }).week;
    expect(pastWeek).toMatchObject({ weekStart: '2026-08-24', isPast: true });

    const future = await t.fetch(`${API_BASE}${E.bootstrap}?week=1`, { cookie: f.cookie });
    expect(future.status).toBe(200);
    const futureWeek = ((await future.json()) as { week: { weekStart: string; isPast: boolean } }).week;
    expect(futureWeek).toMatchObject({ weekStart: '2026-09-07', isPast: false });
  });

  it('R-auth-4 — the cold open is behind the session gate like everything else', async () => {
    expect((await t.fetch(`${API_BASE}${E.bootstrap}`)).status).toBe(401);
  });
});
