import {
  API_BASE,
  BacklogResponse,
  BootstrapResponse,
  ENDPOINTS as E,
  LearningsResponse,
  WEEK_HISTORY_WEEKS,
  type GoalsResponse,
  type PlanResponse,
  type TasksResponse,
} from '@goal-cascade/shared';
import type { DependencyContainer } from 'tsyringe';
import { beforeAll, describe, expect, it } from 'vitest';
import { GoalService, PlanService, TaskService } from '../../src/application/services';
import { createTestApp, signedInOwner } from '../helpers/app';
import { seedFocus, seedGoal, type Fixture } from '../backlog/fixtures';

/**
 * `GET /bootstrap` — the cold-open read model (the mockup's `fetchAll`).
 *
 * `BootstrapService` composes the OTHER services' readers and derives nothing of its own, so these tests
 * stand in for `GoalService`, `PlanService` and `TaskService` — which belong to other agents and are
 * still stubs — through the ONE container seam. That is the point of the test as much as a convenience:
 * it proves the composition, and it proves that bootstrap does not quietly grow its own second answer to
 * "which leaves are active" or "which tasks are visible". When those services land, the fakes come out
 * and the assertions do not change.
 */
const t = createTestApp({ now: '2026-08-31T10:00:00.000Z', overrides: (c) => installReaderFakes(c) });
const CURRENT_WEEK = '2026-08-31';

let f: Fixture;
let life: string;
let monthly: string;

/** Filled in by `beforeAll`, read by the fakes below. */
const stub = {
  goals: [] as GoalsResponse['goals'],
  plan: [] as PlanResponse['entries'],
  tasks: [] as TasksResponse['tasks'],
  calls: { goals: 0, plan: 0, tasks: 0 },
};

function installReaderFakes(c: DependencyContainer): void {
  c.registerInstance(GoalService, {
    async list(_ctx: unknown, week: { weekStart: string }) {
      stub.calls.goals++;
      return {
        week: { weekStart: week.weekStart, offset: 0, isCurrent: week.weekStart === CURRENT_WEEK },
        goals: stub.goals,
        serverNow: '2026-08-31T10:00:00.000Z',
      };
    },
  } as unknown as GoalService);

  c.registerInstance(PlanService, {
    async get(_ctx: unknown, week: { weekStart: string }) {
      stub.calls.plan++;
      return {
        week: { weekStart: week.weekStart, offset: 0, isCurrent: true },
        entries: stub.plan,
        serverNow: '2026-08-31T10:00:00.000Z',
      };
    },
  } as unknown as PlanService);

  c.registerInstance(TaskService, {
    async list(_ctx: unknown, query: { weekStart: string }) {
      stub.calls.tasks++;
      return {
        week: { weekStart: query.weekStart, offset: 0, isCurrent: true },
        tasks: stub.tasks,
        plan: stub.plan,
        serverNow: '2026-08-31T10:00:00.000Z',
      };
    },
  } as unknown as TaskService);
}

const post = (path: string, json: unknown) =>
  t.fetch(`${API_BASE}${path}`, { method: 'POST', cookie: f.cookie, json, idempotencyKey: crypto.randomUUID() });

beforeAll(async () => {
  const owner = await signedInOwner(t);
  f = { t, userId: owner.userId, cookie: owner.cookie };

  life = (await seedGoal(f, { parentId: null, horizon: 'Life', title: 'Health' })).id;
  const yearly = (await seedGoal(f, { parentId: life, horizon: 'Yearly', title: 'Marathon', period: '2026' })).id;
  monthly = (await seedGoal(f, { parentId: yearly, horizon: 'Monthly', title: 'Long runs', period: 'Aug 2026' })).id;
  const focus = await seedFocus(f, monthly, CURRENT_WEEK, 'One long run every Sunday');

  // What the goals/plan readers would answer for this week, in the real shapes.
  stub.goals = [life, yearly, monthly].map((id, i) => ({
    id,
    parentId: i === 0 ? null : [life, yearly][i - 1]!,
    horizon: (['Life', 'Yearly', 'Monthly'] as const)[i]!,
    title: ['Health', 'Marathon', 'Long runs'][i]!,
    why: '',
    pulse: 'On track' as const,
    period: ['', '2026', 'Aug 2026'][i]!,
    focus: i === 2 ? focus.sentence : '',
    isLeaf: i === 2,
    isActive: i === 2,
    dormant: false,
    subtreeActive: true,
    backlogCount: 0,
    carrying: null,
    branches: i === 0 ? { active: 1, total: 1 } : null,
    createdAt: '2026-08-31T10:00:00.000Z',
    updatedAt: '2026-08-31T10:00:00.000Z',
    version: 1,
  }));
  stub.plan = [
    {
      id: focus.id,
      goalId: monthly,
      weekStart: CURRENT_WEEK,
      sentence: focus.sentence,
      createdAt: focus.createdAt,
      updatedAt: focus.updatedAt,
    },
  ];

  await post(E.backlog, { goalId: monthly, title: 'Book the race entry' });
  await post(E.learnings, { text: 'Two rest days is not laziness', goalId: life });
});

describe('GET /bootstrap', () => {
  it('returns a coherent snapshot of one week in ONE round trip', async () => {
    stub.calls = { goals: 0, plan: 0, tasks: 0 };
    const res = await t.fetch(`${API_BASE}${E.bootstrap}`, { cookie: f.cookie });
    expect(res.status, await res.clone().text()).toBe(200);

    // The strongest coherence check available: the whole payload parses against the shared contract.
    const boot = BootstrapResponse.parse(await res.json());

    expect(boot.user.id).toBe(f.userId);
    expect(boot.preferences.timezone).toBeTruthy();
    expect(boot.week).toEqual({ weekStart: CURRENT_WEEK, offset: 0, isCurrent: true });
    // R-nav-4 / D-24 — the ONE bound both week controls use, echoed so the client never hardcodes it.
    expect(boot.weekHistoryWeeks).toBe(WEEK_HISTORY_WEEKS);

    expect(boot.goals.map((g) => g.id)).toEqual([life, boot.goals[1]!.id, monthly]);
    expect(boot.plan.map((p) => p.goalId)).toEqual([monthly]);
    expect(boot.tasks).toEqual([]);
    expect(boot.backlog.map((i) => i.title)).toEqual(['Book the race entry']);
    expect(boot.learnings.map((l) => l.text)).toEqual(['Two rest days is not laziness']);

    // Every array is internally consistent with the tree it ships alongside.
    const goalIds = new Set(boot.goals.map((g) => g.id));
    for (const entry of boot.plan) expect(goalIds.has(entry.goalId)).toBe(true);
    for (const item of boot.backlog) expect(goalIds.has(item.goalId)).toBe(true);
    for (const l of boot.learnings) expect(l.goalId === null || goalIds.has(l.goalId)).toBe(true);
  });

  it('composes the owning services rather than re-deriving anything — each reader is called exactly once', async () => {
    stub.calls = { goals: 0, plan: 0, tasks: 0 };
    const res = await t.fetch(`${API_BASE}${E.bootstrap}`, { cookie: f.cookie });
    expect(res.status).toBe(200);
    // Once each: the lazy `Carried to week of …` producer lives inside `TaskService.list` (R-task-29,
    // Q-17) and must fire on a cold open exactly as it does on a Tasks-screen fetch — no more, no less.
    expect(stub.calls).toEqual({ goals: 1, plan: 1, tasks: 1 });
  });

  it('agrees, field for field, with the endpoints it replaces', async () => {
    const boot = BootstrapResponse.parse(await (await t.fetch(`${API_BASE}${E.bootstrap}`, { cookie: f.cookie })).json());

    const backlog = BacklogResponse.parse(await (await t.fetch(`${API_BASE}${E.backlog}`, { cookie: f.cookie })).json());
    const learnings = LearningsResponse.parse(await (await t.fetch(`${API_BASE}${E.learnings}`, { cookie: f.cookie })).json());

    expect(boot.backlog).toEqual(backlog.items);
    expect(boot.learnings).toEqual(learnings.learnings);
  });

  it('R-nav-3 / D-1 — `?week=` addresses a past week absolutely, and a future week is refused', async () => {
    const past = await t.fetch(`${API_BASE}${E.bootstrap}?week=-1`, { cookie: f.cookie });
    expect(past.status).toBe(200);
    expect(((await past.json()) as { week: { weekStart: string } }).week.weekStart).toBe('2026-08-24');

    const future = await t.fetch(`${API_BASE}${E.bootstrap}?week=1`, { cookie: f.cookie });
    expect(future.status).toBe(422);
  });

  it('R-auth-4 — the cold open is behind the session gate like everything else', async () => {
    expect((await t.fetch(`${API_BASE}${E.bootstrap}`)).status).toBe(401);
  });
});
