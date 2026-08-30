import type { GoalView } from '@goal-cascade/shared';
import { describe, expect, it } from 'vitest';
import { defaultPeriod, replanPeriods } from '../../src/domain/goal-tree';
import { createTestApp, signedInOwner } from '../helpers/app';
import { codeOf, createGoal, detailsOf, makeLine } from './fixtures';

/**
 * R-goal-13/22/23 + D-3 — periods.
 *
 * The mockup's `defaultPeriod` and `replanPeriods` were frozen 2026 string literals: in September 2026 a
 * new Quarterly goal defaulted to `Q4 2026` (the NEXT quarter, not the one containing today), and a
 * Quarterly re-plan offered `Q4 2026` as a "next" period to a goal already sitting in it. Both are pure
 * functions of `(horizon, today)` here, `today` being the date in the OWNER's timezone (R-auth-5).
 *
 * The derivation lives in `domain/goal-tree.ts` — the same module that owns the tree rules — so these
 * unit tests sit right next to the HTTP tests that prove the service actually calls it.
 */
const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });

describe('D-3 (unit) — the period containing today, across a QUARTER boundary', () => {
  it('the last day of Q3 and the first day of Q4 land in different quarters and months', () => {
    expect(defaultPeriod('Quarterly', '2026-09-30')).toBe('Q3 2026');
    expect(defaultPeriod('Quarterly', '2026-10-01')).toBe('Q4 2026');
    expect(defaultPeriod('Monthly', '2026-09-30')).toBe('Sep 2026');
    expect(defaultPeriod('Monthly', '2026-10-01')).toBe('Oct 2026');
    // …and the year is unchanged by a quarter roll.
    expect(defaultPeriod('Yearly', '2026-10-01')).toBe('2026');
  });

  it('re-plan options roll over the quarter, and are strictly AFTER the current one', () => {
    expect(replanPeriods('Quarterly', '2026-09-30')).toEqual(['Q4 2026', 'Q1 2027']);
    expect(replanPeriods('Quarterly', '2026-10-01')).toEqual(['Q1 2027', 'Q2 2027']);
    // the mockup's bug: offering the period the goal is already in
    expect(replanPeriods('Quarterly', '2026-09-30', 'Q4 2026')).toEqual(['Q1 2027', 'Q2 2027']);
    expect(replanPeriods('Monthly', '2026-09-30')).toEqual(['Oct 2026', 'Nov 2026']);
  });
});

describe('D-3 (unit) — the period containing today, across a YEAR boundary', () => {
  it('31 Dec and 1 Jan land in different years, quarters and months', () => {
    expect(defaultPeriod('Yearly', '2026-12-31')).toBe('2026');
    expect(defaultPeriod('Yearly', '2027-01-01')).toBe('2027');
    expect(defaultPeriod('Quarterly', '2026-12-31')).toBe('Q4 2026');
    expect(defaultPeriod('Quarterly', '2027-01-01')).toBe('Q1 2027');
    expect(defaultPeriod('Monthly', '2026-12-31')).toBe('Dec 2026');
    expect(defaultPeriod('Monthly', '2027-01-01')).toBe('Jan 2027');
    expect(defaultPeriod('Life', '2027-01-01')).toBe('');
  });

  it('S-goal-23-1 — re-plan options carry the year with them', () => {
    expect(replanPeriods('Monthly', '2026-12-31')).toEqual(['Jan 2027', 'Feb 2027']);
    expect(replanPeriods('Quarterly', '2026-12-31')).toEqual(['Q1 2027', 'Q2 2027']);
    expect(replanPeriods('Yearly', '2026-12-31')).toEqual(['2027']);
    expect(replanPeriods('Yearly', '2027-01-01')).toEqual(['2028']);
    // R-goal-21 — a Life goal is not re-plannable at all.
    expect(replanPeriods('Life', '2026-12-31')).toEqual([]);
  });
});

describe('R-goal-13 / R-auth-5 — the service derives the default from TODAY in the OWNER’s timezone', () => {
  it('the default moves with the clock across the year boundary', async () => {
    const { cookie } = await signedInOwner(t);
    const life = await createGoal(t, cookie, { title: 'Life', horizon: 'Life' });

    t.clock.set('2026-12-31T12:00:00.000Z');
    expect((await createGoal(t, cookie, { title: 'this year', horizon: 'Yearly', parentId: life.id })).period).toBe('2026');

    t.clock.set('2027-01-01T12:00:00.000Z');
    expect((await createGoal(t, cookie, { title: 'next year', horizon: 'Yearly', parentId: life.id })).period).toBe('2027');
    t.clock.set('2026-08-31T10:00:00.000Z');
  });

  it('S-auth-5-1 — two accounts at the same instant get the period of THEIR OWN day, not the server’s', async () => {
    // 2026-12-31T20:00Z is already 1 Jan 2027 in Auckland (UTC+13) and still 31 Dec in New York.
    t.clock.set('2026-12-31T20:00:00.000Z');
    const nz = await signedInOwner(t, { timezone: 'Pacific/Auckland' });
    const us = await signedInOwner(t, { timezone: 'America/New_York' });

    const nzLife = await createGoal(t, nz.cookie, { title: 'Life', horizon: 'Life' });
    const usLife = await createGoal(t, us.cookie, { title: 'Life', horizon: 'Life' });
    expect((await createGoal(t, nz.cookie, { title: 'Y', horizon: 'Yearly', parentId: nzLife.id })).period).toBe('2027');
    expect((await createGoal(t, us.cookie, { title: 'Y', horizon: 'Yearly', parentId: usLife.id })).period).toBe('2026');
    t.clock.set('2026-08-31T10:00:00.000Z');
  });
});

describe('R-goal-22/23 — re-plan', () => {
  const replan = (cookie: string, id: string, json: unknown) =>
    t.fetch(`/api/goals/${id}/replan`, { method: 'POST', cookie, idempotencyKey: crypto.randomUUID(), json });

  it('S-goal-22-1 — a Monthly goal moves to the next month with NO reason given', async () => {
    const { cookie } = await signedInOwner(t);
    const { monthly } = await makeLine(t, cookie);
    expect(monthly.period).toBe('Aug 2026');

    const res = await replan(cookie, monthly.id, { period: 'Sep 2026' });
    expect(res.status).toBe(200);
    const goal = ((await res.json()) as { goal: GoalView }).goal;
    expect(goal.period).toBe('Sep 2026');
    expect(goal.horizon).toBe('Monthly');
    expect(goal.version).toBe(monthly.version + 1);
  });

  it('R-goal-22 — the one-line reason is optional and accepted, and nothing else about the goal changes', async () => {
    const { cookie } = await signedInOwner(t);
    const { monthly } = await makeLine(t, cookie);
    const res = await replan(cookie, monthly.id, { period: 'Oct 2026', reason: 'travelling all September' });
    expect(res.status).toBe(200);
    const goal = ((await res.json()) as { goal: GoalView }).goal;
    expect([goal.period, goal.title, goal.pulse]).toEqual(['Oct 2026', monthly.title, monthly.pulse]);
  });

  it('D-3 — re-planning to the period the goal is ALREADY in is refused, with the real options in `details`', async () => {
    const { cookie } = await signedInOwner(t);
    const { monthly } = await makeLine(t, cookie);
    const res = await replan(cookie, monthly.id, { period: 'Aug 2026' });
    expect(res.status).toBe(422);
    expect(await codeOf(res.clone())).toBe('VALIDATION_FAILED');
    // derived from today (2026-08-31) and the goal's current period — never a frozen literal
    expect(await detailsOf(res)).toMatchObject({ options: ['Sep 2026', 'Oct 2026'] });
  });
});
