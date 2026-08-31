import { describe, expect, it } from 'vitest';
import { createTestApp, ids, signedInOwner } from '../helpers/app';
import {
  codeOf,
  createGoal,
  focusesUnder,
  goalById,
  makeLine,
  planIn,
  savePlan,
  seedFocus,
  seedTask,
  tasksUnder,
} from '../goals/fixtures';

/**
 * The weekly plan (R-plan-1..12, Q-3, D-2, D-9) and the leaf → non-leaf transition it depends on
 * (R-goal-28, D-8).
 *
 * D-2 is the model: a `weekly_focus` row exists ONLY while a leaf is active in that week. "Active" is
 * therefore exactly "a row exists for the week being viewed" — there is no second representation of
 * dormancy that can disagree with the first, and a past week renders the sentence it actually had.
 */
const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' }); // Monday; week 0 = 2026-08-31, week -1 = 2026-08-24

describe('R-plan-5/6/7 — the whole-week replace', () => {
  it('S-plan-5-1 — a checked leaf with a sentence becomes active, and the sentence is what was typed', async () => {
    const { cookie } = await signedInOwner(t);
    const { monthly } = await makeLine(t, cookie);

    const res = await savePlan(t, cookie, '2026-08-31', [{ goalId: monthly.id, sentence: '  three gym sessions  ' }]);
    expect(res.status).toBe(200);

    const plan = await planIn(t, cookie);
    expect(plan.week).toMatchObject({ weekStart: '2026-08-31', offset: 0, isCurrent: true });
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]).toMatchObject({ goalId: monthly.id, sentence: 'three gym sessions' });

    const goal = await goalById(t, cookie, monthly.id);
    expect([goal.isActive, goal.dormant, goal.focus]).toEqual([true, false, 'three gym sessions']);
  });

  it('S-plan-5-2 / D-9 — checked with a BLANK sentence stores no focus: the leaf stays dormant', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { monthly } = await makeLine(t, cookie);

    const res = await savePlan(t, cookie, '2026-08-31', [{ goalId: monthly.id, sentence: '   ' }]);
    expect(res.status).toBe(200);
    // The response is the client's evidence that the check did not stick — not a silent discard.
    expect(((await res.json()) as { entries: unknown[] }).entries).toHaveLength(0);
    expect(await focusesUnder(t, userId, [monthly.id])).toHaveLength(0);
    expect((await goalById(t, cookie, monthly.id)).dormant).toBe(true);
  });

  it('S-plan-7-1 — one save, one transaction: A is cleared and B is created together', async () => {
    const { cookie } = await signedInOwner(t);
    const { quarterly, monthly } = await makeLine(t, cookie);
    const b = await createGoal(t, cookie, { title: 'B', horizon: 'Monthly', parentId: quarterly.id });

    await savePlan(t, cookie, '2026-08-31', [{ goalId: monthly.id, sentence: 'A is live' }]);
    await savePlan(t, cookie, '2026-08-31', [{ goalId: b.id, sentence: 'B is live' }]);

    const plan = await planIn(t, cookie);
    expect(plan.entries.map((e) => e.goalId)).toEqual([b.id]);
    expect((await goalById(t, cookie, monthly.id)).isActive).toBe(false);
    expect((await goalById(t, cookie, b.id)).focus).toBe('B is live');
  });

  it('S-plan-6-1 — clearing a focus never touches that leaf’s open tasks (R-task-9)', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { monthly } = await makeLine(t, cookie);
    await savePlan(t, cookie, '2026-08-31', [{ goalId: monthly.id, sentence: 'live' }]);
    await seedTask(t, userId, monthly.id, '2026-08-31', 'one');
    await seedTask(t, userId, monthly.id, '2026-08-24', 'two');

    expect((await savePlan(t, cookie, '2026-08-31', [])).status).toBe(200);
    expect((await goalById(t, cookie, monthly.id)).dormant).toBe(true);
    expect((await tasksUnder(t, userId, [monthly.id])).map((x) => x.title).sort()).toEqual(['one', 'two']);
  });

  it('R-plan-7 — a leaf that keeps its focus keeps its row identity; only the sentence and updatedAt move', async () => {
    const { cookie } = await signedInOwner(t);
    const { monthly } = await makeLine(t, cookie);
    await savePlan(t, cookie, '2026-08-31', [{ goalId: monthly.id, sentence: 'first' }]);
    const before = (await planIn(t, cookie)).entries[0]!;

    t.clock.advance(60_000);
    await savePlan(t, cookie, '2026-08-31', [{ goalId: monthly.id, sentence: 'second' }]);
    const after = (await planIn(t, cookie)).entries[0]!;

    expect(after.id).toBe(before.id);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.sentence).toBe('second');
    expect(after.updatedAt > before.updatedAt).toBe(true);
    t.clock.set('2026-08-31T10:00:00.000Z');
  });
});

describe('R-plan-2 / R-plan-8 — what a save refuses, wholesale', () => {
  it('S-plan-2-1 — a save naming a PAST week is refused with WEEK_NOT_CURRENT and applies nothing', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { monthly } = await makeLine(t, cookie);

    const res = await savePlan(t, cookie, '2026-08-24', [{ goalId: monthly.id, sentence: 'back-dated' }]);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('WEEK_NOT_CURRENT');
    expect(await focusesUnder(t, userId, [monthly.id])).toHaveLength(0);
  });

  it('S-plan-8-1 — a focus on a LIFE goal is refused (NOT_A_LEAF) and the rest of the payload is not applied', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { life, monthly } = await makeLine(t, cookie);

    const res = await savePlan(t, cookie, '2026-08-31', [
      { goalId: monthly.id, sentence: 'this one is legal' },
      { goalId: life.id, sentence: 'a Life goal can never hold a focus' },
    ]);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('NOT_A_LEAF');
    // Q-3 — refused WHOLESALE: the legal line of the same save was not written either.
    expect(await focusesUnder(t, userId, [monthly.id, life.id])).toHaveLength(0);
  });

  it('S-plan-8-1 — a focus on a NON-LEAF is refused the same way', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { quarterly } = await makeLine(t, cookie); // Q has a Monthly child, so it is not a leaf

    const res = await savePlan(t, cookie, '2026-08-31', [{ goalId: quarterly.id, sentence: 'not a leaf' }]);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('NOT_A_LEAF');
    expect(await focusesUnder(t, userId, [quarterly.id])).toHaveLength(0);
  });

  it('R-auth-2/3 — an entry naming another owner’s goal is a plain 404, and nothing is written', async () => {
    const a = await signedInOwner(t);
    const b = await signedInOwner(t);
    const mine = await makeLine(t, a.cookie);
    const theirs = await makeLine(t, b.cookie);

    const res = await savePlan(t, a.cookie, '2026-08-31', [
      { goalId: mine.monthly.id, sentence: 'mine' },
      { goalId: theirs.monthly.id, sentence: 'theirs' },
    ]);
    expect(res.status).toBe(404);
    expect(await focusesUnder(t, a.userId, [mine.monthly.id])).toHaveLength(0);
    // …and an id that belongs to nobody answers identically (R-auth-3).
    expect((await savePlan(t, a.cookie, '2026-08-31', [{ goalId: ids.ulid(), sentence: 'ghost' }])).status).toBe(404);
  });
});

describe('D-2 — a week’s focus set belongs to that week', () => {
  it('a past week renders the sentences it actually had, and this week’s save leaves them alone', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { monthly } = await makeLine(t, cookie);
    // R-plan-2 blocks writing a past week through the API, so last week's row is seeded directly.
    await seedFocus(t, userId, monthly.id, '2026-08-24', 'last week’s focus');

    await savePlan(t, cookie, '2026-08-31', [{ goalId: monthly.id, sentence: 'this week’s focus' }]);

    expect((await planIn(t, cookie, -1)).entries.map((e) => e.sentence)).toEqual(['last week’s focus']);
    expect((await planIn(t, cookie, 0)).entries.map((e) => e.sentence)).toEqual(['this week’s focus']);
    // …and the derived flags follow the week being read.
    expect((await goalById(t, cookie, monthly.id, -1)).focus).toBe('last week’s focus');
  });
});

describe('R-goal-28 / D-8 — a leaf that gains a child stops being a focus holder', () => {
  it('S-goal-28-1 — creating a sub-goal under an active leaf deletes its focus, in the same transaction', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { yearly } = await makeLine(t, cookie);
    // The line's own Quarterly already has a Monthly child, so the subject is a fresh Quarterly LEAF.
    const leaf = await createGoal(t, cookie, { title: 'Leaf', horizon: 'Quarterly', parentId: yearly.id });
    await savePlan(t, cookie, '2026-08-31', [{ goalId: leaf.id, sentence: 'active until it gains a child' }]);
    expect((await goalById(t, cookie, leaf.id)).isActive).toBe(true);

    await createGoal(t, cookie, { title: 'the new child', horizon: 'Monthly', parentId: leaf.id });

    const after = await goalById(t, cookie, leaf.id);
    expect([after.isLeaf, after.isActive, after.focus]).toEqual([false, false, '']);
    // S-goal-9-1 — the stale row must not merely be ignored: it must not exist (D-2).
    expect(await focusesUnder(t, userId, [leaf.id])).toHaveLength(0);
    expect((await planIn(t, cookie)).entries).toHaveLength(0);
  });

  it('S-goal-28-1 — MOVING a goal under an active leaf clears that leaf’s focus too', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const a = await makeLine(t, cookie);
    const target = await createGoal(t, cookie, { title: 'Target leaf', horizon: 'Yearly', parentId: a.life.id });
    await savePlan(t, cookie, '2026-08-31', [{ goalId: target.id, sentence: 'active target' }]);

    const res = await t.fetch(`/api/goals/${a.quarterly.id}/move`, {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { parentId: target.id },
    });
    expect(res.status).toBe(200);
    expect(await focusesUnder(t, userId, [target.id])).toHaveLength(0);
    expect((await goalById(t, cookie, target.id)).isActive).toBe(false);
  });

  /**
   * REVIEW — this test previously asserted that EVERY week's row was deleted, and the resurrection half
   * below was what it existed to prove. Deleting the past weeks was the implementation's mechanism, not
   * the rule: it made today's create rewrite the record of a week that really did have a focus, which is
   * the very thing D-2 made focus a per-week table to prevent. The current week and later are cleared;
   * the past is kept; and the resurrection assertion — the point of the test — is unchanged below.
   */
  it('D-8 — the current week’s focus goes, the PAST weeks stay, and it cannot come back', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { life } = await makeLine(t, cookie);
    const leaf = await createGoal(t, cookie, { title: 'Ex-leaf', horizon: 'Yearly', parentId: life.id });
    await seedFocus(t, userId, leaf.id, '2026-08-24', 'a past week’s focus');
    await savePlan(t, cookie, '2026-08-31', [{ goalId: leaf.id, sentence: 'this week' }]);

    const child = await createGoal(t, cookie, { title: 'child', horizon: 'Quarterly', parentId: leaf.id });

    const rows = await focusesUnder(t, userId, [leaf.id]);
    expect(rows.map((r) => [r.weekStart, r.sentence])).toEqual([['2026-08-24', 'a past week’s focus']]);
    // D-2 — and the past week still RENDERS what it actually had.
    expect((await planIn(t, cookie, -1)).entries.map((e) => e.sentence)).toEqual(['a past week’s focus']);
    // …while the current week holds nothing and the ex-leaf reports itself inactive (S-goal-9-1).
    expect((await planIn(t, cookie, 0)).entries).toHaveLength(0);
    const now = await goalById(t, cookie, leaf.id);
    expect([now.isLeaf, now.isActive, now.focus]).toEqual([false, false, '']);

    // …and once it is a leaf again it is plainly dormant, never silently re-activated (the mockup's bug).
    const other = await createGoal(t, cookie, { title: 'Elsewhere', horizon: 'Yearly', parentId: life.id });
    const moved = await t.fetch(`/api/goals/${child.id}/move`, {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { parentId: other.id },
    });
    expect(moved.status).toBe(200);
    const back = await goalById(t, cookie, leaf.id);
    expect([back.isLeaf, back.isActive, back.dormant]).toEqual([true, false, true]);
    // The surviving past row is STILL not a resurrection: it is a past week's fact, and the current
    // week's derivation never consults it.
    expect((await planIn(t, cookie, 0)).entries).toHaveLength(0);
  });
});
