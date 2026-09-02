import { describe, expect, it } from 'vitest';
import { addWeeks, offsetOf, weekStartOf, weekStartOfDate, weeksBetween } from '@goal-cascade/shared';
import { carryAge } from '../../src/domain/weeks';
import { createTestApp, signedInOwner } from '../helpers/app';
import { createGoal, lens, makeLine, seedGoal, seedTask } from '../goals/fixtures';

/**
 * REVIEW — attack 5: the D-1 class of bug, where anything relative to "now" changes meaning as time
 * passes. The stored model is an absolute Monday everywhere, so what has to be proved is that a stored
 * row does NOT move when the clock does, and that the derived projections DO.
 *
 * The clock is driven across a Monday, a month end, a quarter end, a year end, and a southern-hemisphere
 * DST transition (Pacific/Auckland springs forward on the last Sunday of September — the change lands on
 * the Sunday/Monday boundary, which is exactly where a naive `getDay()` implementation breaks).
 *
 * ⚠ **A2** — a week's INTENTION is now a Weekly goal rather than a focus row (R-rm-2), so the "does a
 * stored row move" question is asked of `goals.period_key` as well as of `tasks.origin_week_start`. Both
 * are absolute Mondays, and neither is ever rewritten.
 */
describe('REVIEW / attack 5 — a stored week is an absolute Monday and never decays', () => {
  it('crossing a MONDAY re-projects the offsets and leaves every stored value alone', async () => {
    const t = createTestApp({ now: '2026-09-03T09:00:00.000Z' }); // Thursday; week 0 = 2026-08-31
    const { cookie, userId } = await signedInOwner(t);
    const { weekly } = await makeLine(t, cookie);
    const task = await seedTask(t, userId, weekly.id, '2026-08-31');

    const before = (await (await t.fetch(`/api/tasks/${task.id}`, { cookie })).json()) as {
      task: { originPeriodKey: string; carryAge: number };
    };
    expect(before.task).toMatchObject({ originPeriodKey: '2026-08-31', carryAge: 0 });

    t.clock.set('2026-09-07T00:00:01.000Z'); // one second into the next Monday, UTC

    const after = (await (await t.fetch(`/api/tasks/${task.id}`, { cookie })).json()) as {
      task: { originPeriodKey: string; carryAge: number };
    };
    // The ROW did not move; the projection did. That is D-1 in one assertion.
    expect(after.task.originPeriodKey).toBe('2026-08-31');
    expect(after.task.carryAge).toBe(1);

    /**
     * SUPERSEDED — the old assertions here were `planIn(…).entries` and `goalById(…).isActive`, which
     * asked "does last week's PLAN read as this week's". Both are gone (R-rm-2). The successor question
     * is R-lens-12's, and it is sharper: **the goal itself moves between the two bands.** Last week's
     * Weekly goal is no longer in this week's plan — it is in the CARRIED band, because its task is
     * still open — and it is still in its own week's plan when that week is viewed.
     */
    const thisWeek = await lens(t, cookie, { lens: 'Weekly', period: '2026-09-07' });
    expect(thisWeek.items.map((g) => g.id)).not.toContain(weekly.id);
    expect(thisWeek.carried.map((g) => g.id)).toContain(weekly.id);

    const itsOwnWeek = await lens(t, cookie, { lens: 'Weekly', period: '2026-08-31' });
    expect(itsOwnWeek.items.map((g) => g.id)).toContain(weekly.id);
    expect(itsOwnWeek.carried).toEqual([]);
  });

  /**
   * SUPERSEDED — this asserted `WEEK_NOT_CURRENT`: a plan save that crossed the Monday while the screen
   * was open was refused rather than written into the wrong week. There is no plan save (R-rm-3), and
   * the code is retired (R-rm-2). **The defect it protected against is unchanged and now generalised to
   * every horizon**: a write into a period that has become past is refused with `PERIOD_IN_PAST`
   * (R-goal-36). The screen crossing a boundary is exactly how that becomes reachable in ordinary use.
   */
  it('S-goal-36-1 — a create that crosses the Monday while the screen is open is refused, not back-dated', async () => {
    const t = createTestApp({ now: '2026-09-06T23:59:00.000Z' }); // Sunday; the week is still 2026-08-31
    const { cookie } = await signedInOwner(t);
    const { monthly } = await makeLine(t, cookie);
    const ok = await createGoal(t, cookie, { title: 'ok', horizon: 'Weekly', parentId: monthly.id, periodKey: '2026-08-31' });
    expect(ok.periodKey).toBe('2026-08-31');

    t.clock.set('2026-09-07T00:00:30.000Z'); // Monday: that week is now PAST
    const late = await t.fetch('/api/goals', {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { title: 'too late', horizon: 'Weekly', parentId: monthly.id, periodKey: '2026-08-31' },
    });
    expect(late.status).toBe(409);
    expect(((await late.json()) as { error: { code: string } }).error.code).toBe('PERIOD_IN_PAST');
  });

  it('MONTH, QUARTER and YEAR ends: the week Monday is arithmetic, not calendar-aware', () => {
    expect(weekStartOfDate('2026-08-31')).toBe('2026-08-31'); // Monday that is also a month end-ish
    expect(weekStartOfDate('2026-09-01')).toBe('2026-08-31'); // month boundary inside a week
    expect(weekStartOfDate('2026-09-30')).toBe('2026-09-28'); // quarter end (Wed) → its Monday
    expect(weekStartOfDate('2026-10-01')).toBe('2026-09-28'); // …the same week
    expect(weekStartOfDate('2026-12-31')).toBe('2026-12-28'); // year end (Thu) → its Monday
    expect(weekStartOfDate('2027-01-01')).toBe('2026-12-28'); // …the same week, across the year
    expect(weekStartOfDate('2027-01-03')).toBe('2026-12-28'); // Sunday belongs to the week before
    expect(weekStartOfDate('2027-01-04')).toBe('2027-01-04'); // …and Monday starts the new one
    expect(addWeeks('2026-12-28', 1)).toBe('2027-01-04');
    expect(weeksBetween('2026-12-28', '2027-01-04')).toBe(1);
  });

  it('a southern-hemisphere DST transition on the Sunday/Monday boundary does not move a week', () => {
    // Pacific/Auckland: NZDT starts 2026-09-27 02:00 local (UTC+12 → UTC+13). The Monday after is 09-28.
    const tz = 'Pacific/Auckland';
    expect(weekStartOf('2026-09-26T11:00:00.000Z', tz)).toBe('2026-09-21'); // Sat 26th 23:00 local
    expect(weekStartOf('2026-09-27T10:59:59.000Z', tz)).toBe('2026-09-21'); // Sun 27th 23:59 local
    // The clocks went forward at 02:00 on Sun 27th, so Monday 28th 00:00 local is 11:00Z, an hour
    // earlier in UTC than the week before. A `getDay()` on the UTC instant would still say Sunday.
    expect(weekStartOf('2026-09-27T11:00:00.000Z', tz)).toBe('2026-09-28'); // Mon 28th 00:00 local
    expect(weekStartOf('2026-09-27T13:00:00.000Z', tz)).toBe('2026-09-28'); // Mon 28th 02:00 local
    // Australia/Lord_Howe uses a 30-MINUTE DST shift — the pathological case for offset arithmetic.
    expect(weekStartOf('2026-10-03T13:30:00.000Z', 'Australia/Lord_Howe')).toBe('2026-09-28'); // Sun 00:00
    expect(weekStartOf('2026-10-04T13:29:00.000Z', 'Australia/Lord_Howe')).toBe('2026-10-05'); // Mon 00:29
    expect(weekStartOf('2026-10-04T13:30:00.000Z', 'Australia/Lord_Howe')).toBe('2026-10-05');
    // A week is a date, so the difference is always a whole number of weeks either side of the change.
    expect(weeksBetween('2026-09-21', '2026-10-05')).toBe(2);
  });

  it('S-auth-5-1 — two accounts at the SAME instant, in zones a day apart, each get their own week', async () => {
    // 2026-08-31T01:00Z is Monday 31st in Auckland (+12 → 13:00) and still Sunday 30th in Honolulu (−10).
    const t = createTestApp({ now: '2026-08-31T01:00:00.000Z' });
    const nz = await signedInOwner(t, { timezone: 'Pacific/Auckland' });
    const hi = await signedInOwner(t, { timezone: 'Pacific/Honolulu' });
    const weekOf = async (cookie: string) => (await lens(t, cookie, { lens: 'Weekly' })).period?.periodKey;

    expect(await weekOf(nz.cookie)).toBe('2026-08-31');
    expect(await weekOf(hi.cookie)).toBe('2026-08-24');
  });

  it('R-task-43 — the carry threshold lands on the correct side at EXACTLY 1 and EXACTLY 2 weeks', () => {
    // The label is a client rendering of `carryAge`, which is `min(viewed, current) − origin` in whole
    // weeks (⚠ A2: signed, R-task-43). These are all past/current views, where the `min` is inert.
    const current = '2026-08-31';
    expect(carryAge('2026-08-31', '2026-08-31', current)).toBe(0); // R-task-12: no label
    expect(carryAge('2026-08-24', '2026-08-31', current)).toBe(1); // R-task-10: gray "since …"
    expect(carryAge('2026-08-17', '2026-08-31', current)).toBe(2); // R-task-11: red chip, at exactly 2
    expect(carryAge('2026-08-10', '2026-08-31', current)).toBe(3);
    // …and across a year end, where naive month/day arithmetic would drift.
    expect(carryAge('2026-12-28', '2027-01-04', '2027-01-04')).toBe(1);
    expect(carryAge('2026-12-21', '2027-01-04', '2027-01-04')).toBe(2);
    // It depends on the VIEWED week, never on today (S-task-11-2).
    expect(carryAge('2026-08-17', '2026-08-24', current)).toBe(1);
    /**
     * SUPERSEDED — the last line used to read "a task can never be 'negative' weeks old", asserting
     * R-task-37's `max(0, …)` clamp. R-task-43 supersedes it: the age is SIGNED, and a negative value is
     * the honest reading of "not due yet". No label fires below 1 either way, which is why this needs an
     * assertion rather than a comment — nothing that renders changed.
     */
    expect(carryAge('2026-08-31', '2026-08-24', current)).toBe(-1);
    expect(offsetOf('2026-08-24', '2026-08-31')).toBe(-1);
  });

  it('R-task-43 over HTTP — the same task reads 1 week in one viewed week and 2 in the next', async () => {
    const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });
    const { cookie, userId } = await signedInOwner(t);
    const { life } = await makeLine(t, cookie);
    // A Weekly goal for a PAST week, which R-goal-36 refuses through the product — hence the seed.
    const past = await seedGoal(t, userId, { parentId: life.id, horizon: 'Weekly', title: 'two weeks ago', periodKey: '2026-08-17' });
    const task = await seedTask(t, userId, past.id, '2026-08-17');

    const at = async (week: number) => {
      const res = (await (await t.fetch(`/api/tasks?week=${week}`, { cookie })).json()) as {
        tasks: { id: string; carryAge: number }[];
      };
      return res.tasks.find((x) => x.id === task.id)?.carryAge;
    };
    expect(await at(0)).toBe(2); // exactly 2 → the red chip
    expect(await at(-1)).toBe(1); // exactly 1 → the gray label
    expect(await at(-2)).toBe(0); // its origin week → no label
  });

  /**
   * SUPERSEDED — this asserted "a past week's FOCUS survives every later save, and the current week never
   * reads it". There are no focus rows and no whole-week save (R-rm-2, R-rm-3), so the mechanism it
   * tested is gone. **The principle is not**: it is D-2, and R-lens-10 restates it for the goal table —
   * *a past period renders exactly what was there, and no write may create an item in it or move one
   * into it.* Which is what this now asserts, in the shape that replaced it.
   */
  it('S-lens-10-1 / R-lens-10 — a past week renders its OWN goals, and no later write touches them', async () => {
    const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });
    const { cookie, userId } = await signedInOwner(t);
    const { life, monthly } = await makeLine(t, cookie);
    const twoAgo = await seedGoal(t, userId, { parentId: monthly.id, horizon: 'Weekly', title: 'two weeks ago', periodKey: '2026-08-17' });
    const oneAgo = await seedGoal(t, userId, { parentId: monthly.id, horizon: 'Weekly', title: 'one week ago', periodKey: '2026-08-24' });

    // Writing THIS week changes nothing about either past week.
    await createGoal(t, cookie, { title: 'this week', horizon: 'Weekly', parentId: monthly.id });

    expect((await lens(t, cookie, { lens: 'Weekly', period: '2026-08-17' })).items.map((g) => g.title)).toEqual(['two weeks ago']);
    expect((await lens(t, cookie, { lens: 'Weekly', period: '2026-08-24' })).items.map((g) => g.title)).toEqual(['one week ago']);
    expect((await lens(t, cookie, { lens: 'Weekly', period: '2026-08-31' })).items.map((g) => g.title)).toEqual([
      makeLineWeeklyTitle,
      'this week',
    ]);

    // …and a create INTO one of those weeks is refused, leaving them byte-identical (D-2).
    const back = await t.fetch('/api/goals', {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { title: 'rewriting history', horizon: 'Weekly', parentId: life.id, periodKey: '2026-08-17' },
    });
    expect(back.status).toBe(409);
    const stillTwoAgo = await lens(t, cookie, { lens: 'Weekly', period: '2026-08-17' });
    expect(stillTwoAgo.items.map((g) => g.id)).toEqual([twoAgo.id]);
    expect(stillTwoAgo.items[0]).toMatchObject({ title: 'two weeks ago', version: 1 });
    void oneAgo;
  });
});

/** `makeLine` seeds one Weekly goal for the current week; its title is fixed by the fixture. */
const makeLineWeeklyTitle = 'This week';
