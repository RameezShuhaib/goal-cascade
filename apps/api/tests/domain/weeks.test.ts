import { describe, expect, it } from 'vitest';
import { carryWeeks, isVisibleInWeek } from '../../src/domain/weeks';

/**
 * **Week POLICY** — the two functions that stayed behind when the calendar moved to
 * `packages/shared/src/calendar/weeks.ts` (R-lens-30).
 *
 * They stayed because they are not calendar arithmetic: they are decisions about WORK — R-task-43's
 * signed carry age and R-task-7/8/32's week visibility — and only the server is allowed to have an
 * opinion about either. The client receives both answers on the wire and must never recompute them.
 * The Monday arithmetic these are built from is tested in `packages/shared/tests/weeks.test.ts`.
 */

describe('R-task-43 — carry age is SIGNED, and measured against min(viewed, current)', () => {
  const current = '2026-08-31';

  it('S-task-43-3 / S-task-11-2 — past and current views are UNCHANGED by the signed age', () => {
    // The load-bearing regression guard: dropping R-task-37's outer `max(0, …)` clamp must change
    // nothing that renders. Origin two weeks back, viewed one week back, is age 1 (gray), not 2 (red).
    expect(carryWeeks('2026-08-17', '2026-08-24', current)).toBe(1);
    expect(carryWeeks('2026-08-17', current, current)).toBe(2);
    expect(carryWeeks(current, current, current)).toBe(0);
  });

  it('S-task-43-1 — a task planned AHEAD has a negative age, and the age does not grow with the view', () => {
    // The rule that must not fire (R-lens-11): the naive `viewed − origin` would read 2 at +3 and
    // escalate work nobody is late with. `min(viewed, current)` is what stops it.
    const origin = '2026-09-07'; // +1
    expect(carryWeeks(origin, '2026-09-07', current)).toBe(-1);
    expect(carryWeeks(origin, '2026-09-21', current)).toBe(-1); // viewed at +3, still −1
  });

  it('S-task-43-2 — an ALREADY-LATE task keeps the age it has today when projected forward', () => {
    // It is late now and still open then, so the chip is correct there.
    expect(carryWeeks('2026-08-10', '2026-09-14', current)).toBe(3);
  });

  /**
   * SUPERSEDED — the old assertion ("never reports a negative age") encoded R-task-37's `max(0, …)`
   * clamp, which R-task-43 supersedes: the value may be negative, and a negative age is the honest
   * reading of "not due yet". No label fires below 1 either way, so nothing that renders changed —
   * which is precisely why this needs an assertion rather than a comment.
   */
  it('R-task-43 — a week before the origin now reads negative rather than clamping to 0', () => {
    expect(carryWeeks(current, '2026-08-24', current)).toBe(-1);
  });
});

describe('R-task-7/8/32 — week visibility, derived with no write at all', () => {
  const open = { status: 'open' as const, originWeekStart: '2026-08-17', doneWeekStart: null };

  it('S-task-7-1 — an open task is visible in every week at or after its origin, with no prompt', () => {
    for (const w of ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07']) {
      expect(isVisibleInWeek(open, w), w).toBe(true);
    }
  });

  it('S-task-7-2 — and in no week before it', () => {
    expect(isVisibleInWeek(open, '2026-08-10')).toBe(false);
  });

  it('S-task-8-1 — a done task is visible ONLY in the week it was completed', () => {
    const done = { status: 'done' as const, originWeekStart: '2026-08-17', doneWeekStart: '2026-08-24' };
    expect(isVisibleInWeek(done, '2026-08-24')).toBe(true);
    expect(isVisibleInWeek(done, '2026-08-17')).toBe(false);
    expect(isVisibleInWeek(done, '2026-08-31')).toBe(false);
  });

  it('D-15 — an exited task is visible in NO week, though its row and timeline survive', () => {
    for (const status of ['canceled', 'movedToBacklog'] as const) {
      const exited = { status, originWeekStart: '2026-08-17', doneWeekStart: null };
      for (const w of ['2026-08-10', '2026-08-17', '2026-08-31']) {
        expect(isVisibleInWeek(exited, w), `${status} @ ${w}`).toBe(false);
      }
    }
  });
});
