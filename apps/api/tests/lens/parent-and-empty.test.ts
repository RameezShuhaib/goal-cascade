import { describe, expect, it } from 'vitest';
import { createTestApp, signedInOwner } from '../helpers/app';
import { createGoal, lens } from '../goals/fixtures';

/**
 * ⚠ **A2 — the two lens fields the web client could not render without** (R-lens-23, R-lens-24).
 *
 * Both are cases of the same thing: an id the client holds with no title to go with it, and a question
 * only the server can answer without a second table scan. Named after the `S-*` scenarios in
 * `docs/SPEC.md` §3.
 */
const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' }); // a Monday
const THIS_WEEK = '2026-08-31';

/** One Life line, broken all the way down to a Weekly goal for this week. */
async function line(cookie: string, name = 'Be strong at 60') {
  const life = await createGoal(t, cookie, { title: name, horizon: 'Life' });
  const yearly = await createGoal(t, cookie, { title: 'Run a sub-2h half marathon in 2026', horizon: 'Yearly', parentId: life.id });
  const quarterly = await createGoal(t, cookie, { title: 'Rebuild the gym habit', horizon: 'Quarterly', parentId: yearly.id });
  const monthly = await createGoal(t, cookie, { title: 'Lift three times a week', horizon: 'Monthly', parentId: quarterly.id });
  const weekly = await createGoal(t, cookie, { title: 'Three easy runs', horizon: 'Weekly', parentId: monthly.id });
  return { life, yearly, quarterly, monthly, weekly };
}

describe('R-lens-23 — the parent line', () => {
  it('S-lens-23-1 — an item whose parent is OUTSIDE the period still gets its parent’s name', async () => {
    const { cookie } = await signedInOwner(t);
    const g = await line(cookie);

    // This is the whole point. The Weekly lens is one week; the Monthly parent is in another lens
    // entirely and is not in `items`, `carried` or `groups` — so before this field there was nothing on
    // the wire to render `under Lift three times a week` from.
    const weekly = await lens(t, cookie, { lens: 'Weekly', period: THIS_WEEK });
    expect(weekly.items.map((i) => i.id)).toEqual([g.weekly.id]);
    expect(weekly.items.every((i) => i.parentId === g.monthly.id)).toBe(true);
    expect(weekly.items.some((i) => i.id === g.monthly.id)).toBe(false);

    expect(weekly.parents).toEqual([{ id: g.monthly.id, title: 'Lift three times a week', period: 'Aug 2026' }]);
  });

  it('S-lens-23-2 — nothing renders when the parent IS the group’s own Life goal', async () => {
    const { cookie } = await signedInOwner(t);
    const g = await line(cookie);

    // A Yearly item's parent is always its Life goal, so the Yearly lens must offer no parent at all —
    // and the suppression is expressed as an ABSENCE, so a client that renders every hit it finds
    // implements R-lens-23 by doing nothing.
    const yearly = await lens(t, cookie, { lens: 'Yearly', period: '2026' });
    expect(yearly.items.map((i) => i.id)).toEqual([g.yearly.id]);
    expect(yearly.parents).toEqual([]);
  });

  it('S-lens-23-2 — the same suppression covers a level-skipped Monthly goal hung off a Life goal (R-goal-32)', async () => {
    const { cookie } = await signedInOwner(t);
    const life = await createGoal(t, cookie, { title: 'Ship the thing', horizon: 'Life' });
    const skipped = await createGoal(t, cookie, { title: 'Write the changelog', horizon: 'Monthly', parentId: life.id });
    const under = await createGoal(t, cookie, { title: 'Under a quarter', horizon: 'Quarterly', parentId: life.id });
    const nested = await createGoal(t, cookie, { title: 'Nested month', horizon: 'Monthly', parentId: under.id });

    const monthly = await lens(t, cookie, { lens: 'Monthly', period: '2026-08' });
    expect(monthly.items.map((i) => i.id).sort()).toEqual([skipped.id, nested.id].sort());
    // Only the Quarterly parent is offered; the Life parent is left out by the same rule, with no
    // horizon test on the client side.
    expect(monthly.parents).toEqual([{ id: under.id, title: 'Under a quarter', period: 'Q3 2026' }]);
  });

  it('R-lens-23 — it is ONE entry per distinct parent, not one per item', async () => {
    const { cookie } = await signedInOwner(t);
    const g = await line(cookie);
    for (const n of [2, 3, 4]) {
      await createGoal(t, cookie, { title: `Week goal ${n}`, horizon: 'Weekly', parentId: g.monthly.id });
    }

    const weekly = await lens(t, cookie, { lens: 'Weekly', period: THIS_WEEK });
    expect(weekly.items).toHaveLength(4);
    // Four items, one parent, one entry. Denormalising would have repeated the same title four times —
    // and up to fifty at MAX_WEEKLY_GOALS_PER_WEEK.
    expect(weekly.parents).toHaveLength(1);
    expect(weekly.parents[0]!.id).toBe(g.monthly.id);
  });

  it('R-lens-12 — the carried band’s goals get parent lines too, not just this week’s plan', async () => {
    const { cookie } = await signedInOwner(t);
    const g = await line(cookie);
    // A Weekly goal for a LATER week, with a task originating there, so the future lens carries it.
    const later = await createGoal(t, cookie, { title: 'Next week', horizon: 'Weekly', parentId: g.monthly.id, periodKey: '2026-09-07' });
    await t.fetch('/api/tasks', {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { goalId: later.id, title: 'Something in the future' },
    });

    const twoWeeksOn = await lens(t, cookie, { lens: 'Weekly', period: '2026-09-14' });
    expect(twoWeeksOn.carried.map((c) => c.id)).toEqual([later.id]);
    expect(twoWeeksOn.parents.map((p) => p.id)).toContain(g.monthly.id);
  });
});

describe('R-lens-24 — the third empty state, and the two signals that distinguish it', () => {
  it('S-lens-24-1 — a horizon that has NEVER held a goal says so, at every horizon', async () => {
    const { cookie } = await signedInOwner(t);
    await createGoal(t, cookie, { title: 'Be strong at 60', horizon: 'Life' });

    for (const horizon of ['Yearly', 'Quarterly', 'Monthly', 'Weekly'] as const) {
      const l = await lens(t, cookie, { lens: horizon });
      expect(l.items, horizon).toEqual([]);
      // "you have never used this lens" — the state whose copy is `Nothing quarterly yet.`
      expect(l.hasAnyAtHorizon, horizon).toBe(false);
      // …and its precondition: the account HAS life goals, so this is not the cold start.
      expect(l.hasLifeGoals, horizon).toBe(true);
    }
  });

  it('S-lens-24-2 — a horizon used in ANOTHER period is "this period is empty", never "never used"', async () => {
    const { cookie } = await signedInOwner(t);
    const life = await createGoal(t, cookie, { title: 'Be strong at 60', horizon: 'Life' });
    const yearly = await createGoal(t, cookie, { title: '2026', horizon: 'Yearly', parentId: life.id });
    await createGoal(t, cookie, { title: 'Q4 push', horizon: 'Quarterly', parentId: yearly.id, periodKey: '2026-Q4' });

    // Q3 holds nothing, but the account plainly uses quarters — saying "Nothing quarterly yet" here
    // would be a lie, and it is exactly the lie this field exists to prevent.
    const q3 = await lens(t, cookie, { lens: 'Quarterly', period: '2026-Q3' });
    expect(q3.items).toEqual([]);
    expect(q3.hasAnyAtHorizon).toBe(true);

    const q4 = await lens(t, cookie, { lens: 'Quarterly', period: '2026-Q4' });
    expect(q4.items).toHaveLength(1);
    expect(q4.hasAnyAtHorizon).toBe(true);
  });

  it('S-lens-24-2 — the Weekly horizon, which is the one that reaches the database', async () => {
    const { cookie } = await signedInOwner(t);
    const life = await createGoal(t, cookie, { title: 'Ship the thing', horizon: 'Life' });
    const monthly = await createGoal(t, cookie, { title: 'Write the changelog', horizon: 'Monthly', parentId: life.id });

    expect((await lens(t, cookie, { lens: 'Weekly', period: THIS_WEEK })).hasAnyAtHorizon).toBe(false);

    // A Weekly goal in a LATER week — no goal exists in the viewed week at all, and the horizon-level
    // state must still switch off. `hasForwardContent` cannot answer this: it only looks forward.
    await createGoal(t, cookie, { title: 'Next week', horizon: 'Weekly', parentId: monthly.id, periodKey: '2026-09-07' });
    const thisWeek = await lens(t, cookie, { lens: 'Weekly', period: THIS_WEEK });
    expect(thisWeek.items).toEqual([]);
    expect(thisWeek.hasAnyAtHorizon).toBe(true);

    // …and a PAST week, which `hasForwardContent` cannot see at all.
    const later = await lens(t, cookie, { lens: 'Weekly', period: '2026-09-21' });
    expect(later.items).toEqual([]);
    expect(later.hasForwardContent).toBe(false);
    expect(later.hasAnyAtHorizon).toBe(true);
  });

  it('S-lens-24-3 — a brand-new account is the COLD START, not "nothing quarterly yet"', async () => {
    const { cookie } = await signedInOwner(t);
    // R-lens-24 begins "When the account has Life goals but…". With none, `+ Quarterly goal` would have
    // no legal parent to hang off, so the client must show R-lens-6's first-run state instead.
    const quarterly = await lens(t, cookie, { lens: 'Quarterly' });
    expect(quarterly.hasLifeGoals).toBe(false);
    expect(quarterly.hasAnyAtHorizon).toBe(false);
  });

  it('the Life lens has no third empty state — an empty Life lens IS the cold start', async () => {
    const { cookie } = await signedInOwner(t);
    const life = await lens(t, cookie, { lens: 'Life' });
    expect(life.items).toEqual([]);
    expect(life.hasAnyAtHorizon).toBe(true);
    expect(life.hasLifeGoals).toBe(false);
  });

  it('R-auth-2 — neither signal leaks another account’s use of a horizon', async () => {
    const a = await signedInOwner(t);
    const b = await signedInOwner(t);
    const lifeB = await createGoal(t, b.cookie, { title: "B's life", horizon: 'Life' });
    await createGoal(t, b.cookie, { title: "B's quarter", horizon: 'Quarterly', parentId: lifeB.id });

    const forA = await lens(t, a.cookie, { lens: 'Quarterly', period: '2026-Q3' });
    expect(forA.hasAnyAtHorizon).toBe(false);
    expect(forA.hasLifeGoals).toBe(false);
    expect(forA.parents).toEqual([]);
  });
});
