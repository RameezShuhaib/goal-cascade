import { describe, expect, it } from 'vitest';
import { periodOfLabel, shortDate, weekOfLabel } from '../../src/utils/dates';

/**
 * ⚠ **A8 — the three client renderers that meet a MONTH key, and what they used to do with one.**
 *
 * `shortDate`, `weekLabel` and `weekOfLabel` all split a `YYYY-MM-DD` and read the day segment. Handed
 * `'2026-08'` — which `BacklogItemView.fromPeriodKey` and `TaskView.originPeriodKey` now legitimately
 * carry (R-task-59, R-task-52) — the day segment is `undefined`, so `Number(undefined)` is `NaN` and the
 * owner reads **`from week of NaN Aug`** and **`Week of NaN Aug`**.
 *
 * This is reachable today, through the flow S-task-59-1 itself describes: move a month task to the
 * backlog over MCP or HTTP, then open the Backlog page. `common.ts` promises `from Sep 2026` for exactly
 * this case and nothing implemented it.
 *
 * `periodOfLabel` is the one renderer that takes a key at **either** scope and names it the way the
 * server would — the format is the discriminator, exactly as it is everywhere else in A8.
 */
describe('R-task-52 / R-task-59 — a period key renders at whichever scope it is in', () => {
  it('a MONTH key reads as its month, never as a NaN day', () => {
    expect(periodOfLabel('2026-08')).toBe('Aug 2026');
    expect(periodOfLabel('2026-09')).toBe('Sep 2026');
    expect(periodOfLabel('2026-01')).toBe('Jan 2026');
    for (const key of ['2026-08', '2026-09', '2026-12']) {
      expect(periodOfLabel(key), key).not.toContain('NaN');
      expect(periodOfLabel(key), key).not.toContain('week of');
    }
  });

  it('a WEEK key is unchanged, byte for byte, from what `weekOfLabel` already rendered', () => {
    // The week half must not move: it is the server's own `PeriodView.label` shape, and a second
    // spelling of it is the drift `weekOfLabel`'s own doc block exists to prevent.
    for (const monday of ['2026-08-31', '2026-09-07', '2026-01-05']) {
      expect(periodOfLabel(monday), monday).toBe(weekOfLabel(monday));
    }
    expect(periodOfLabel('2026-08-31')).toBe('Week of 31 Aug');
  });

  it('an unrecognisable key renders as itself rather than as NaN', () => {
    // A malformed key is a data problem to surface, not one to dress up — and never one to print `NaN`
    // over, which reads as a bug in the app rather than in the row.
    for (const junk of ['', 'sometime', '2026']) {
      expect(periodOfLabel(junk), junk).not.toContain('NaN');
    }
  });

  it('the underlying week helpers are the ones that could not do this, which is why the new one exists', () => {
    // Kept as the record of the defect: `shortDate` is right for a Monday and silently wrong for a month.
    expect(shortDate('2026-08-31')).toBe('31 Aug');
    expect(shortDate('2026-08')).toContain('NaN');
  });
});
