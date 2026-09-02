import { describe, expect, it } from 'vitest';
import { carryAge, carryUnitOf, isVisibleInPeriod } from '../../src/domain/weeks';

/**
 * **Period POLICY** — the two functions that stayed behind when the calendar moved to
 * `packages/shared/src/calendar/` (R-lens-30).
 *
 * They stayed because they are not calendar arithmetic: they are decisions about WORK — R-task-54's
 * signed carry age and R-task-53's period visibility — and only the server is allowed to have an opinion
 * about either. The client receives both answers on the wire and must never recompute them. The Monday
 * and month arithmetic these are built from is tested in `packages/shared/tests/`.
 *
 * ⚠ **A8** — every case below is now stated at BOTH scopes, because the whole claim of R-task-53/54 is
 * that a month is the same three comparisons one scale up. A case that passed at week scope and was not
 * re-asserted at month scope would be exactly the gap the amendment could ship with.
 */

describe('R-task-43 / R-task-54 — carry age is SIGNED, measured against min(viewed, current), at one scope', () => {
  const current = '2026-08-31';
  const currentMonth = '2026-08';

  it('S-task-43-3 / S-task-11-2 — past and current views are UNCHANGED by the signed age', () => {
    // The load-bearing regression guard: dropping R-task-37's outer `max(0, …)` clamp must change
    // nothing that renders. Origin two weeks back, viewed one week back, is age 1 (gray), not 2 (red).
    expect(carryAge('Weekly', '2026-08-17', '2026-08-24', current)).toBe(1);
    expect(carryAge('Weekly', '2026-08-17', current, current)).toBe(2);
    expect(carryAge('Weekly', current, current, current)).toBe(0);
  });

  it('S-task-54-1 — the same three readings at MONTH scope, counted in months', () => {
    expect(carryAge('Monthly', '2026-06', '2026-07', currentMonth)).toBe(1);
    expect(carryAge('Monthly', '2026-06', currentMonth, currentMonth)).toBe(2);
    expect(carryAge('Monthly', currentMonth, currentMonth, currentMonth)).toBe(0);
    // R-task-54's own example: carried since August, read in November, in the one place the unit means
    // something. `3 months · since Aug`.
    expect(carryAge('Monthly', '2026-08', '2026-11', '2026-11')).toBe(3);
  });

  it('S-task-43-1 — a task planned AHEAD has a negative age, and the age does not grow with the view', () => {
    // The rule that must not fire (R-lens-11): the naive `viewed − origin` would read 2 at +3 and
    // escalate work nobody is late with. `min(viewed, current)` is what stops it.
    const origin = '2026-09-07'; // +1
    expect(carryAge('Weekly', origin, '2026-09-07', current)).toBe(-1);
    expect(carryAge('Weekly', origin, '2026-09-21', current)).toBe(-1); // viewed at +3, still −1
  });

  it('S-task-54-2 — the sign survives the generalisation: a December month task is negative in February', () => {
    // R-task-43's clause, unchanged, at month scope: the age is measured against the CURRENT period,
    // not the viewed one, so looking further ahead does not age a plan.
    expect(carryAge('Monthly', '2026-12', '2026-12', currentMonth)).toBe(-4);
    expect(carryAge('Monthly', '2026-12', '2027-02', currentMonth)).toBe(-4);
    expect(carryAge('Monthly', '2026-12', '2027-02', currentMonth)).toBeLessThan(0);
  });

  it('S-task-43-2 — an ALREADY-LATE task keeps the age it has today when projected forward', () => {
    // It is late now and still open then, so the chip is correct there.
    expect(carryAge('Weekly', '2026-08-10', '2026-09-14', current)).toBe(3);
    expect(carryAge('Monthly', '2026-05', '2026-12', currentMonth)).toBe(3);
  });

  /**
   * SUPERSEDED — the old assertion ("never reports a negative age") encoded R-task-37's `max(0, …)`
   * clamp, which R-task-43 supersedes: the value may be negative, and a negative age is the honest
   * reading of "not due yet". No label fires below 1 either way, so nothing that renders changed —
   * which is precisely why this needs an assertion rather than a comment.
   */
  it('R-task-43 — a period before the origin now reads negative rather than clamping to 0', () => {
    expect(carryAge('Weekly', current, '2026-08-24', current)).toBe(-1);
    expect(carryAge('Monthly', currentMonth, '2026-07', currentMonth)).toBe(-1);
  });

  it('R-task-54 — the unit is the scope, and the two are never mixed', () => {
    expect(carryUnitOf('Weekly')).toBe('weeks');
    expect(carryUnitOf('Monthly')).toBe('months');
  });
});

describe('R-task-53 — period visibility, derived with no write at all, at one scope', () => {
  const open = { status: 'open' as const, scope: 'Weekly' as const, originPeriodKey: '2026-08-17', donePeriodKey: null };
  const openMonth = { status: 'open' as const, scope: 'Monthly' as const, originPeriodKey: '2026-08', donePeriodKey: null };

  it('S-task-7-1 — an open task is visible in every week at or after its origin, with no prompt', () => {
    for (const w of ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07']) {
      expect(isVisibleInPeriod(open, 'Weekly', w), w).toBe(true);
    }
  });

  it('S-task-53-1 — an open MONTH task carries into every later month, with no write and no job', () => {
    for (const m of ['2026-08', '2026-09', '2026-10', '2026-11']) {
      expect(isVisibleInPeriod(openMonth, 'Monthly', m), m).toBe(true);
    }
    // …and not before its origin.
    expect(isVisibleInPeriod(openMonth, 'Monthly', '2026-07')).toBe(false);
  });

  it('S-task-7-2 — and in no week before it', () => {
    expect(isVisibleInPeriod(open, 'Weekly', '2026-08-10')).toBe(false);
  });

  /**
   * ⚠ **A8 (R-task-52) — the guard that stops a week read and a month read scanning each other's rows.**
   *
   * `2026-09` and `2026-09-07` are both strings and would otherwise compare: `'2026-09' <= '2026-09-07'`
   * is TRUE, so a month task would appear in every week list from September onward if scope were not in
   * the predicate. This is the assertion for the SQL half in `d1-task.repo.ts`, which has the same
   * `eq(tasks.scope, scope)` for the same reason.
   */
  it('S-task-52-1 — a task is invisible at a scope that is not its own, in BOTH directions', () => {
    expect(isVisibleInPeriod(openMonth, 'Weekly', '2026-09-07')).toBe(false);
    expect(isVisibleInPeriod(open, 'Monthly', '2026-09')).toBe(false);
  });

  it('S-task-8-1 — a done task is visible ONLY in the period it was completed in, at either scope', () => {
    const done = { status: 'done' as const, scope: 'Weekly' as const, originPeriodKey: '2026-08-17', donePeriodKey: '2026-08-24' };
    expect(isVisibleInPeriod(done, 'Weekly', '2026-08-24')).toBe(true);
    expect(isVisibleInPeriod(done, 'Weekly', '2026-08-17')).toBe(false);
    expect(isVisibleInPeriod(done, 'Weekly', '2026-08-31')).toBe(false);

    // S-task-53-2 — a month task completed in September shows in September and in no other month, not
    // even the August it was open in.
    const doneMonth = { status: 'done' as const, scope: 'Monthly' as const, originPeriodKey: '2026-08', donePeriodKey: '2026-09' };
    expect(isVisibleInPeriod(doneMonth, 'Monthly', '2026-09')).toBe(true);
    expect(isVisibleInPeriod(doneMonth, 'Monthly', '2026-08')).toBe(false);
    expect(isVisibleInPeriod(doneMonth, 'Monthly', '2026-10')).toBe(false);
  });

  it('D-15 — an exited task is visible in NO period, though its row and timeline survive', () => {
    for (const status of ['canceled', 'movedToBacklog'] as const) {
      const exited = { status, scope: 'Weekly' as const, originPeriodKey: '2026-08-17', donePeriodKey: null };
      for (const w of ['2026-08-10', '2026-08-17', '2026-08-31']) {
        expect(isVisibleInPeriod(exited, 'Weekly', w), `${status} @ ${w}`).toBe(false);
      }
      const exitedMonth = { status, scope: 'Monthly' as const, originPeriodKey: '2026-08', donePeriodKey: null };
      for (const m of ['2026-07', '2026-08', '2026-11']) {
        expect(isVisibleInPeriod(exitedMonth, 'Monthly', m), `${status} @ ${m}`).toBe(false);
      }
    }
  });
});
