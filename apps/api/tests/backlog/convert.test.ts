import { API_BASE, BacklogResponse, ENDPOINTS as E, HEADERS } from '@goal-cascade/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signedInOwner } from '../helpers/app';
import { backlogRow, openTasksUnder, seedGoal, seedWeeklyGoal, type Fixture } from './fixtures';

/**
 * Conversion — R-backlog-6/9/26, Q-4, D-18, D-19.
 *
 * This is the sharpest rule in the backlog area and the mockup got both halves of it wrong: it created a
 * SECOND task from an item that had already vanished, and it never persisted the item's removal at all.
 * The tests below are the ones that must never be weakened.
 *
 * A2 (R-backlog-26) — the rule kept its shape and changed its SUBJECT: the receiving goal is the
 * **Weekly goal at or under the item's goal whose `periodKey` is the target week**, not an "active
 * leaf". D-18's ambiguity ruling is untouched, `BRANCH_NOT_ACTIVE` becomes `NO_WEEKLY_GOAL`, and the
 * refusal is no longer a dead end: R-task-48's inline create makes the goal it needed.
 */
const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });
const CURRENT_WEEK = '2026-08-31';

let f: Fixture;
/** A line with a Weekly goal for THIS week: Life > Yearly > Quarterly > Monthly > Weekly. */
let quarterly: string;
let monthly: string;
let weeklyThisWeek: string;
/** A line with NO weekly goal for this week - the `NO_WEEKLY_GOAL` case. */
let emptyQuarterly: string;
let emptyMonthly: string;

beforeAll(async () => {
  const owner = await signedInOwner(t);
  f = { t, userId: owner.userId, cookie: owner.cookie };

  const life = (await seedGoal(f, { parentId: null, horizon: 'Life', title: 'Health' })).id;
  const yearly = (await seedGoal(f, { parentId: life, horizon: 'Yearly', title: 'Marathon', periodKey: '2026' })).id;
  quarterly = (await seedGoal(f, { parentId: yearly, horizon: 'Quarterly', title: 'Base miles', periodKey: '2026-Q3' })).id;
  monthly = (await seedGoal(f, { parentId: quarterly, horizon: 'Monthly', title: 'Long runs', periodKey: '2026-08' })).id;
  weeklyThisWeek = (await seedWeeklyGoal(f, monthly, CURRENT_WEEK, 'One long run every Sunday')).id;

  emptyQuarterly = (await seedGoal(f, { parentId: yearly, horizon: 'Quarterly', title: 'Strength', periodKey: '2026-Q3' })).id;
  emptyMonthly = (await seedGoal(f, { parentId: emptyQuarterly, horizon: 'Monthly', title: 'Squats', periodKey: '2026-08' })).id;
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
    const item = await createItem(monthly, 'Order new shoes', {
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
        originPeriodKey: string;
        events: { kind: string; text: string; glyph: string }[];
      };
      item: { status: string; convertedToTaskId: string | null; convertedAt: string | null };
    };

    expect(out.task.goalId).toBe(weeklyThisWeek);
    expect(out.task.title).toBe('Order new shoes');
    expect(out.task.description).toBe('the ones that were on sale');
    expect(out.task.links.map((l) => l.url)).toEqual(['https://example.com/shoes', 'https://example.com/reviews']);
    // A2 (R-task-40) - origin comes from the RECEIVING WEEKLY GOAL's own week, not from "today".
    // At creation the two are equal by construction, because there is no target-week parameter.
    expect(out.task.originPeriodKey).toBe(CURRENT_WEEK);
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
    const item = await createItem(monthly, 'Convert me once');

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

    const tasks = await openTasksUnder(f, [weeklyThisWeek]);
    expect(tasks.filter((task) => task.title === 'Convert me once')).toHaveLength(1);
    expect(tasks.find((task) => task.title === 'Convert me once')!.id).toBe(taskId);

    // The first task is untouched and the item still points at it.
    const row = await backlogRow(f, item.id);
    expect(row!.status).toBe('converted');
    expect(row!.convertedToTaskId).toBe(taskId);
  });

  it('Q-4 — a replay with the SAME idempotency key returns the ORIGINAL task, not a second one', async () => {
    const item = await createItem(monthly, 'Retried over a flaky network');
    const key = crypto.randomUUID();

    const first = await post(E.backlogItemConvert(item.id), {}, key);
    expect(first.status).toBe(201);
    const firstTask = ((await first.json()) as { task: { id: string } }).task;

    const replay = await post(E.backlogItemConvert(item.id), {}, key);
    expect(replay.status).toBe(201);
    expect(replay.headers.get(HEADERS.idempotentReplayed)).toBe('true');
    expect(((await replay.json()) as { task: { id: string } }).task.id).toBe(firstTask.id);

    expect((await openTasksUnder(f, [weeklyThisWeek])).filter((x) => x.title === 'Retried over a flaky network')).toHaveLength(1);
  });

  /**
   * SUPERSEDED - S-backlog-8-3 asserted `BRANCH_NOT_ACTIVE` and the copy "can only become a task under
   * an active weekly focus". R-backlog-26 replaces the code with **`NO_WEEKLY_GOAL`** and the copy with
   * "becomes a task under a weekly goal": there are no focus rows, so nothing can be inactive. **The
   * server-side half of the guard is unchanged in force** - a conversion submitted directly is refused
   * too, and the client prompt is never the only guard.
   */
  it('S-backlog-26-2 - no weekly goal for the target week is refused NO_WEEKLY_GOAL, server-side', async () => {
    const item = await createItem(emptyQuarterly, 'Deferred strength work');

    const res = await post(E.backlogItemConvert(item.id), {});
    expect(res.status).toBe(409);
    const err = (await res.json()) as { error: { code: string; message: string } };
    expect(err.error.code).toBe('NO_WEEKLY_GOAL');
    expect(err.error.message).toContain('Deferred strength work');
    expect(err.error.message).toContain('weekly goal');

    // The item is untouched and no task exists under that line.
    expect(await backlogIds()).toContain(item.id);
    expect((await backlogRow(f, item.id))!.status).toBe('open');
    expect(await openTasksUnder(f, [emptyQuarterly, emptyMonthly])).toEqual([]);
  });

  /**
   * A2, new (R-task-48 / R-backlog-26) - the refusal above is no longer a dead end.
   *
   * "This retires the `This branch isn't active this week` dead end entirely: there is no longer a state
   * in which a backlog item cannot become work, because the thing it needed to hang off is created for
   * it" - and both rows are written in ONE transaction, so a failure creates neither.
   */
  it('S-backlog-26-2 / S-task-48-1 - the inline newWeeklyGoal creates the goal AND the task, atomically', async () => {
    const item = await createItem(emptyMonthly, 'Start squatting again');

    const res = await post(E.backlogItemConvert(item.id), {
      newWeeklyGoal: { parentId: emptyMonthly, title: 'Squats' },
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const out = (await res.json()) as {
      task: { goalId: string; originPeriodKey: string };
      goal: { id: string; horizon: string; periodKey: string; title: string } | null;
      item: { status: string };
    };

    expect(out.goal).not.toBeNull();
    expect(out.goal!.horizon).toBe('Weekly');
    expect(out.goal!.periodKey).toBe(CURRENT_WEEK);
    // R-task-49 - the created goal is NAMED back, because it was created without being asked for.
    expect(out.goal!.title).toBe('Squats');
    expect(out.task.goalId).toBe(out.goal!.id);
    expect(out.task.originPeriodKey).toBe(CURRENT_WEEK);
    expect(out.item.status).toBe('converted');
  });

  it('S-backlog-26-1 - one weekly goal under the item goal receives the task, silently and correctly', async () => {
    const item = await createItem(quarterly, 'Captured on the quarterly');
    const res = await post(E.backlogItemConvert(item.id), {});
    expect(res.status).toBe(201);
    // The task lands on the WEEKLY goal, never on the quarterly goal the item was filed under.
    expect(((await res.json()) as { task: { goalId: string } }).task.goalId).toBe(weeklyThisWeek);
  });

  it('S-backlog-26-3 / D-18 - two weekly goals for that week: the server refuses to pick, and no task is created', async () => {
    // A2 - "several weekly goals under one parent in one week" is now the ORDINARY shape: it is how a
    // week holds several intentions (R-goal-31). D-18's ruling is untouched: array order is not a
    // decision, and that id fixes which week the task belongs to for the rest of its life.
    //
    // The second weekly goal hangs off a SECOND monthly goal, so the ambiguity is scoped to items filed
    // on the quarterly: items filed on `monthly` keep exactly one candidate for the tests after this one.
    const otherMonthly = await seedGoal(f, { parentId: quarterly, horizon: 'Monthly', title: 'Speed work', periodKey: '2026-08' });
    const second = await seedWeeklyGoal(f, otherMonthly.id, CURRENT_WEEK, 'Two interval sessions');
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
    expect(err.error.details?.candidates?.map((c) => c.id).sort()).toEqual([weeklyThisWeek, second.id].sort());
    expect((await backlogRow(f, item.id))!.status).toBe('open');

    // Naming one of them resolves it, and the task lands exactly there.
    const chosen = await post(E.backlogItemConvert(item.id), { goalId: second.id });
    expect(chosen.status).toBe(201);
    expect(((await chosen.json()) as { task: { goalId: string } }).task.goalId).toBe(second.id);
  });

  it('R-backlog-26 - a named target that is not a weekly goal at or under the item is refused', async () => {
    const item = await createItem(monthly, 'Wrong target');
    const res = await post(E.backlogItemConvert(item.id), { goalId: emptyMonthly });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NO_WEEKLY_GOAL');
    expect((await backlogRow(f, item.id))!.status).toBe('open');
  });

  /**
   * ⚠ **A8 (R-backlog-31) — rewritten, not weakened.** A2's version relied on `week: WeekOffset.min(0)`
   * refusing a negative offset in the SCHEMA. A8 replaces the offset with a canonical `period` (one field,
   * two scopes, the format the discriminator), so there is no negative number to refuse; the bound moves
   * to the service, where the scope is known, and answers `PERIOD_IN_PAST` — which is the code R-goal-36
   * actually names. The property is unchanged: nothing is created into a past period, at either scope.
   */
  it('R-goal-36 / R-backlog-31 - a conversion may never name a PAST period, at either scope', async () => {
    const item = await createItem(monthly, 'Not last week');
    const week = await post(E.backlogItemConvert(item.id), { period: '2026-08-24' });
    expect(week.status).toBe(409);
    expect(((await week.json()) as { error: { code: string } }).error.code).toBe('PERIOD_IN_PAST');
    expect((await backlogRow(f, item.id))!.status).toBe('open');

    // The month half needs an item on a goal whose OWN month is past, because the month path can only
    // ever name that goal's month (R-task-52 — a task takes its period from its goal, so a "different
    // month" names no destination at all and is refused one line earlier, as a validation failure).
    const july = (await seedGoal(f, { parentId: quarterly, horizon: 'Monthly', title: 'July', periodKey: '2026-07' })).id;
    const stale = await createItem(july, 'Should have been July');
    const month = await post(E.backlogItemConvert(stale.id), { period: '2026-07' });
    expect(month.status).toBe(409);
    expect(((await month.json()) as { error: { code: string } }).error.code).toBe('PERIOD_IN_PAST');
    expect((await backlogRow(f, stale.id))!.status).toBe('open');
  });

  it('S-backlog-9-1 — converting an item that was deleted is refused, and no task is created', async () => {
    const item = await createItem(monthly, 'Deleted before conversion');
    const before = (await openTasksUnder(f, [weeklyThisWeek])).length;

    const del = await t.fetch(`${API_BASE}${E.backlogItem(item.id)}`, { method: 'DELETE', cookie: f.cookie });
    expect(del.status).toBe(200);

    const res = await post(E.backlogItemConvert(item.id), {});
    expect(res.status).toBe(404);
    expect(await openTasksUnder(f, [weeklyThisWeek])).toHaveLength(before);
  });

  it('R-backlog-6 — a converted item is no longer editable or movable: it is a task now', async () => {
    const item = await createItem(monthly, 'Then locked');
    expect((await post(E.backlogItemConvert(item.id), {})).status).toBe(201);

    const patch = await t.fetch(`${API_BASE}${E.backlogItem(item.id)}`, {
      method: 'PATCH',
      cookie: f.cookie,
      json: { title: 'Renamed after the fact' },
    });
    expect(patch.status).toBe(409);
    expect(((await patch.json()) as { error: { code: string } }).error.code).toBe('ALREADY_CONVERTED');

    const move = await post(E.backlogItemMove(item.id), { goalId: emptyMonthly });
    expect(move.status).toBe(409);
    expect(((await move.json()) as { error: { code: string } }).error.code).toBe('ALREADY_CONVERTED');
  });

  it('D-19 — two conversions racing at the same instant produce one task and one refusal, never two tasks', async () => {
    const item = await createItem(monthly, 'Two devices at once');

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

    expect((await openTasksUnder(f, [weeklyThisWeek])).filter((x) => x.title === 'Two devices at once')).toHaveLength(1);
  });

  it('Q-2 — a conversion carrying a stale version loses cleanly, with no task created', async () => {
    const item = await createItem(monthly, 'Stale version');
    const before = (await openTasksUnder(f, [weeklyThisWeek])).length;

    const res = await post(E.backlogItemConvert(item.id), { version: item.version + 5 });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('CONCURRENT_UPDATE');
    expect(await openTasksUnder(f, [weeklyThisWeek])).toHaveLength(before);
    expect((await backlogRow(f, item.id))!.status).toBe('open');
  });
});
