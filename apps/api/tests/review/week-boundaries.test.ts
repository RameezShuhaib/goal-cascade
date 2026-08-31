import { describe, expect, it } from 'vitest';
import { addWeeks, carryWeeks, offsetOf, weekStartOf, weekStartOfDate, weeksBetween } from '../../src/domain/weeks';
import { createTestApp, signedInOwner } from '../helpers/app';
import { createGoal, goalById, makeLine, planIn, savePlan, seedFocus, seedTask } from '../goals/fixtures';

/**
 * REVIEW — attack 5: the D-1 class of bug, where anything relative to "now" changes meaning as time
 * passes. The stored model is an absolute Monday everywhere, so what has to be proved is that a stored
 * row does NOT move when the clock does, and that the derived projections DO.
 *
 * The clock is driven across a Monday, a month end, a quarter end, a year end, and a southern-hemisphere
 * DST transition (Pacific/Auckland springs forward on the last Sunday of September — the change lands on
 * the Sunday/Monday boundary, which is exactly where a naive `getDay()` implementation breaks).
 */
describe('REVIEW / attack 5 — a stored week is an absolute Monday and never decays', () => {
  it('crossing a MONDAY re-projects the offsets and leaves every stored value alone', async () => {
    const t = createTestApp({ now: '2026-09-03T09:00:00.000Z' }); // Thursday; week 0 = 2026-08-31
    const { cookie, userId } = await signedInOwner(t);
    const { monthly } = await makeLine(t, cookie);
    await savePlan(t, cookie, '2026-08-31', [{ goalId: monthly.id, sentence: 'this week' }]);
    const task = await seedTask(t, userId, monthly.id, '2026-08-31');

    const before = (await (await t.fetch(`/api/tasks/${task.id}`, { cookie })).json()) as {
      task: { originWeekStart: string; carryWeeks: number };
    };
    expect(before.task).toMatchObject({ originWeekStart: '2026-08-31', carryWeeks: 0 });

    t.clock.set('2026-09-07T00:00:01.000Z'); // one second into the next Monday, UTC

    const after = (await (await t.fetch(`/api/tasks/${task.id}`, { cookie })).json()) as {
      task: { originWeekStart: string; carryWeeks: number };
    };
    // The ROW did not move; the projection did. That is D-1 in one assertion.
    expect(after.task.originWeekStart).toBe('2026-08-31');
    expect(after.task.carryWeeks).toBe(1);
    expect((await planIn(t, cookie, 0)).entries).toHaveLength(0); // last week's plan is not this week's
    expect((await planIn(t, cookie, -1)).entries.map((e) => e.sentence)).toEqual(['this week']);
    expect((await goalById(t, cookie, monthly.id, 0)).isActive).toBe(false);
    expect((await goalById(t, cookie, monthly.id, -1)).isActive).toBe(true);
  });

  it('a plan save that crosses the Monday while the screen is open is refused, not written into the wrong week', async () => {
    const t = createTestApp({ now: '2026-09-06T23:59:00.000Z' }); // Sunday; the week is still 2026-08-31
    const { cookie } = await signedInOwner(t);
    const { monthly } = await makeLine(t, cookie);
    expect((await savePlan(t, cookie, '2026-08-31', [{ goalId: monthly.id, sentence: 'ok' }])).status).toBe(200);

    t.clock.set('2026-09-07T00:00:30.000Z'); // Monday
    const late = await savePlan(t, cookie, '2026-08-31', [{ goalId: monthly.id, sentence: 'too late' }]);
    expect(late.status).toBe(409);
    expect(((await late.json()) as { error: { code: string } }).error.code).toBe('WEEK_NOT_CURRENT');
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
    const weekOf = async (cookie: string) => (await planIn(t, cookie)).week.weekStart;

    expect(await weekOf(nz.cookie)).toBe('2026-08-31');
    expect(await weekOf(hi.cookie)).toBe('2026-08-24');
  });

  it('R-task-10/11 — the carry threshold lands on the correct side at EXACTLY 1 and EXACTLY 2 weeks', () => {
    // The label is a client rendering of `carryWeeks`, which is `viewed − origin` in whole weeks.
    expect(carryWeeks('2026-08-31', '2026-08-31')).toBe(0); // R-task-12: no label
    expect(carryWeeks('2026-08-24', '2026-08-31')).toBe(1); // R-task-10: gray "since …"
    expect(carryWeeks('2026-08-17', '2026-08-31')).toBe(2); // R-task-11: red chip, at exactly 2
    expect(carryWeeks('2026-08-10', '2026-08-31')).toBe(3);
    // …and across a year end, where naive month/day arithmetic would drift.
    expect(carryWeeks('2026-12-28', '2027-01-04')).toBe(1);
    expect(carryWeeks('2026-12-21', '2027-01-04')).toBe(2);
    // It depends on the VIEWED week, never on today (S-task-11-2).
    expect(carryWeeks('2026-08-17', '2026-08-24')).toBe(1);
    // A task can never be "negative" weeks old.
    expect(carryWeeks('2026-08-31', '2026-08-24')).toBe(0);
    expect(offsetOf('2026-08-24', '2026-08-31')).toBe(-1);
  });

  it('R-task-10/11 over HTTP — the same task reads 1 week in one viewed week and 2 in the next', async () => {
    const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });
    const { cookie, userId } = await signedInOwner(t);
    const { monthly } = await makeLine(t, cookie);
    await savePlan(t, cookie, '2026-08-31', [{ goalId: monthly.id, sentence: 'live' }]);
    const task = await seedTask(t, userId, monthly.id, '2026-08-17');

    const at = async (week: number) => {
      const res = (await (await t.fetch(`/api/tasks?week=${week}`, { cookie })).json()) as {
        tasks: { id: string; carryWeeks: number }[];
      };
      return res.tasks.find((x) => x.id === task.id)?.carryWeeks;
    };
    expect(await at(0)).toBe(2); // exactly 2 → the red chip
    expect(await at(-1)).toBe(1); // exactly 1 → the gray label
    expect(await at(-2)).toBe(0); // its origin week → no label
  });

  it('a past week’s focus survives every later save, and the current week never reads it', async () => {
    const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });
    const { cookie, userId } = await signedInOwner(t);
    const { quarterly, monthly } = await makeLine(t, cookie);
    const other = await createGoal(t, cookie, { title: 'Other', horizon: 'Monthly', parentId: quarterly.id });
    await seedFocus(t, userId, monthly.id, '2026-08-17', 'two weeks ago');
    await seedFocus(t, userId, monthly.id, '2026-08-24', 'one week ago');

    await savePlan(t, cookie, '2026-08-31', [{ goalId: other.id, sentence: 'this week' }]);

    expect((await planIn(t, cookie, -2)).entries.map((e) => e.sentence)).toEqual(['two weeks ago']);
    expect((await planIn(t, cookie, -1)).entries.map((e) => e.sentence)).toEqual(['one week ago']);
    expect((await planIn(t, cookie, 0)).entries.map((e) => e.sentence)).toEqual(['this week']);
  });
});
