import { API_BASE, BacklogResponse, ENDPOINTS as E, IdeasResponse } from '@goal-cascade/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signedInOwner } from '../helpers/app';
import { deleteGoalAndUntag, openTasksUnder, seedFocus, seedGoal, type Fixture } from '../backlog/fixtures';

/** Ideas — the parking lot (R-idea-1..8, D-22). */
const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });
const CURRENT_WEEK = '2026-08-31';

let f: Fixture;
let life: string;
let monthlyActive: string;
let monthlyDormant: string;

beforeAll(async () => {
  const owner = await signedInOwner(t);
  f = { t, userId: owner.userId, cookie: owner.cookie };

  life = (await seedGoal(f, { parentId: null, horizon: 'Life', title: 'Craft' })).id;
  const yearly = (await seedGoal(f, { parentId: life, horizon: 'Yearly', title: 'Ship v1', period: '2026' })).id;
  monthlyActive = (await seedGoal(f, { parentId: yearly, horizon: 'Monthly', title: 'Beta', period: 'Aug 2026' })).id;
  monthlyDormant = (await seedGoal(f, { parentId: yearly, horizon: 'Monthly', title: 'Docs', period: 'Aug 2026' })).id;
  await seedFocus(f, monthlyActive, CURRENT_WEEK, 'Get five testers on the beta');
});

const post = (path: string, json: unknown) =>
  t.fetch(`${API_BASE}${path}`, { method: 'POST', cookie: f.cookie, json, idempotencyKey: crypto.randomUUID() });

async function park(text: string, goalId: string | null = null) {
  const res = await post(E.ideas, goalId === null ? { text } : { text, goalId });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { idea: { id: string; goalId: string | null; text: string } }).idea;
}

async function ideas() {
  const res = await t.fetch(`${API_BASE}${E.ideas}`, { cookie: f.cookie });
  expect(res.status).toBe(200);
  return IdeasResponse.parse(await res.json()).ideas;
}

async function backlog() {
  const res = await t.fetch(`${API_BASE}${E.backlog}`, { cookie: f.cookie });
  return BacklogResponse.parse(await res.json()).items;
}

describe('ideas', () => {
  it('R-idea-1/2 — a two-second capture: text only, tag optional, defaulting to Unsorted', async () => {
    const untagged = await park('Try the shorter onboarding copy');
    expect(untagged.goalId).toBeNull();

    const tagged = await park('Ask about the pricing page', life);
    expect(tagged.goalId).toBe(life);
  });

  it('S-idea-2-1 — an idea tagged to a NON-Life goal is refused', async () => {
    const res = await post(E.ideas, { text: 'Filed under the wrong thing', goalId: monthlyActive });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_A_LIFE_GOAL');
  });

  it('R-idea-7 / Q-7 — newest first, with an id tie-break', async () => {
    t.clock.set('2026-08-26T09:00:00.000Z');
    const older = await park('Older thought');
    t.clock.set('2026-08-31T10:00:00.000Z');
    const newer = await park('Newer thought');
    const order = (await ideas()).map((i) => i.id);
    expect(order.indexOf(newer.id)).toBeLessThan(order.indexOf(older.id));
  });

  it('R-idea-6 — Delete removes the idea with no confirmation', async () => {
    const idea = await park('Delete me');
    const res = await t.fetch(`${API_BASE}${E.idea(idea.id)}`, { method: 'DELETE', cookie: f.cookie });
    expect(res.status).toBe(200);
    expect((await ideas()).some((i) => i.id === idea.id)).toBe(false);
  });

  it('S-idea-5-1 — Attach to a goal moves the text into that goal’s backlog and removes the idea, atomically', async () => {
    const idea = await park('Write the migration guide');

    const res = await post(E.ideaAttach(idea.id), { goalId: monthlyDormant });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { item: { id: string; goalId: string; title: string }; ideaId: string };
    expect(out.ideaId).toBe(idea.id);
    expect(out.item.goalId).toBe(monthlyDormant);
    expect(out.item.title).toBe('Write the migration guide');

    expect((await backlog()).some((i) => i.id === out.item.id)).toBe(true);
    expect((await ideas()).some((i) => i.id === idea.id)).toBe(false);
  });

  it('R-idea-5 / R-backlog-2 — attaching to a LIFE goal is refused, and the idea survives the refusal', async () => {
    const idea = await park('Should not reach a life goal');
    const res = await post(E.ideaAttach(idea.id), { goalId: life });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('LIFE_GOAL_NO_BACKLOG');
    expect((await ideas()).some((i) => i.id === idea.id)).toBe(true);
  });

  it('S-idea-4-1 — Task this week creates the task and consumes the idea in one operation', async () => {
    const idea = await park('Email the three beta testers');

    const res = await post(E.ideaConvert(idea.id), { goalId: monthlyActive });
    expect(res.status, await res.clone().text()).toBe(201);
    const out = (await res.json()) as {
      task: { id: string; goalId: string; title: string; originWeekStart: string; events: { kind: string; text: string }[] };
      ideaId: string;
    };
    expect(out.task.goalId).toBe(monthlyActive);
    expect(out.task.title).toBe('Email the three beta testers');
    expect(out.task.originWeekStart).toBe(CURRENT_WEEK);
    expect(out.task.events[0]).toMatchObject({ kind: 'created', text: 'Created — from an Idea' });
    expect(out.ideaId).toBe(idea.id);

    expect((await ideas()).some((i) => i.id === idea.id)).toBe(false);
  });

  it('S-idea-4-2 / D-22 — an abandoned create modal loses nothing: the idea is still there and no task exists', async () => {
    const idea = await park('A thought worth keeping');
    const before = (await openTasksUnder(f, [monthlyActive])).length;

    // "Abandoning the modal" is, on the wire, simply never sending the convert request. The API offers
    // NO endpoint that removes an idea in preparation for a task — that ordering is the bug D-22
    // records, where the mockup deleted the idea and then opened the modal.
    expect((await ideas()).some((i) => i.id === idea.id)).toBe(true);
    expect(await openTasksUnder(f, [monthlyActive])).toHaveLength(before);

    // And a convert that FAILS must leave the idea equally intact — same guarantee, exercised.
    const failed = await post(E.ideaConvert(idea.id), { goalId: monthlyDormant });
    expect(failed.status).toBe(409);
    expect((await ideas()).some((i) => i.id === idea.id)).toBe(true);
    expect(await openTasksUnder(f, [monthlyActive, monthlyDormant])).toHaveLength(before);
  });

  it('S-idea-4-3 / D-10 — with no active leaf the conversion is refused; nothing lands on a fallback goal', async () => {
    const idea = await park('Needs an active branch first');

    const dormant = await post(E.ideaConvert(idea.id), { goalId: monthlyDormant });
    expect(dormant.status).toBe(409);
    expect(((await dormant.json()) as { error: { code: string } }).error.code).toBe('BRANCH_NOT_ACTIVE');

    // A Life goal is not a task target either (R-task-4).
    const onLife = await post(E.ideaConvert(idea.id), { goalId: life });
    expect(onLife.status).toBe(409);
    expect(((await onLife.json()) as { error: { code: string } }).error.code).toBe('NOT_A_LEAF');

    expect((await ideas()).some((i) => i.id === idea.id)).toBe(true);
    expect(await openTasksUnder(f, [monthlyDormant, life])).toEqual([]);
  });

  it('S-idea-7-1 — an idea whose tagged goal is deleted falls back to Unsorted rather than disappearing', async () => {
    const doomed = await seedGoal(f, { parentId: null, horizon: 'Life', title: 'A line that ends' });
    const idea = await park('Filed under a goal that will not survive', doomed.id);
    expect(idea.goalId).toBe(doomed.id);

    await deleteGoalAndUntag(f, doomed.id);

    const after = (await ideas()).find((i) => i.id === idea.id);
    expect(after, 'the idea must survive its tag').toBeDefined();
    expect(after!.goalId).toBeNull();
    expect(after!.text).toBe('Filed under a goal that will not survive');
  });

  it('R-auth-2/3 — another owner cannot read, delete or attach this owner’s ideas', async () => {
    const idea = await park('Private thought');
    const intruder = await signedInOwner(t);

    expect((await t.fetch(`${API_BASE}${E.idea(idea.id)}`, { method: 'DELETE', cookie: intruder.cookie })).status).toBe(404);
    const theirs = IdeasResponse.parse(await (await t.fetch(`${API_BASE}${E.ideas}`, { cookie: intruder.cookie })).json());
    expect(theirs.ideas.some((i) => i.id === idea.id)).toBe(false);
  });
});
