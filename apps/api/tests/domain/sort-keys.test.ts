import { describe, expect, it } from 'vitest';
import {
  between,
  FIRST_SORT_KEY,
  format,
  rekey,
  SORT_KEY_GAP,
  SORT_KEY_WIDTH,
  topKey,
  withinGoal,
} from '../../src/domain/sort-keys';

/**
 * R-backlog-17/19 — the key scheme, as arithmetic.
 *
 * It is unit-tested rather than only exercised through HTTP because the two properties everything else
 * assumes — *lexicographic order is numeric order*, and *the mid-point is strictly between* — are
 * properties of the strings, not of the endpoint. A regression here would show up as a list in a
 * plausible but wrong order, which is exactly the class of bug an integration test can miss.
 */

describe('R-backlog-17 — a key is fixed-width, so lexicographic order IS numeric order', () => {
  it('pads every key to the same width, which is what stops "9" sorting after "10"', () => {
    expect(format(1)).toHaveLength(SORT_KEY_WIDTH);
    expect(format(999_999_999_999)).toHaveLength(SORT_KEY_WIDTH);
    // The classic failure this width exists to prevent.
    expect(String(9) < String(10)).toBe(false);
    expect(format(9) < format(10)).toBe(true);
  });

  it('sorts a hundred ascending numbers into the same order as strings', () => {
    const numbers = Array.from({ length: 100 }, (_, i) => i * 7919 + 3);
    const keys = numbers.map(format);
    expect([...keys].sort()).toEqual(keys);
  });

  it('the first item of a fresh goal leaves room ABOVE it (R-backlog-18)', () => {
    // Starting at 0 would make the very first capture after it re-key the whole list.
    expect(FIRST_SORT_KEY).toBe(format(SORT_KEY_GAP));
    expect(between(null, FIRST_SORT_KEY)).not.toBeNull();
  });
});

describe('R-backlog-19 — the mid-point, at both ends and in the middle', () => {
  it('lands strictly between two neighbours', () => {
    const a = format(1_000_000);
    const b = format(2_000_000);
    const mid = between(a, b)!;
    expect(mid > a).toBe(true);
    expect(mid < b).toBe(true);
  });

  it('a null lower bound is the TOP of the list and a null upper bound is the BOTTOM', () => {
    const only = format(1_000_000);
    expect(between(null, only)! < only).toBe(true);
    expect(between(only, null)! > only).toBe(true);
  });

  it('answers null — not a duplicate key — when two neighbours are adjacent', () => {
    // The caller's cue to re-key. It must never silently mint a key equal to a neighbour's, which would
    // make the position depend on the `capturedAt` tie-break rather than on what the owner asked for.
    expect(between(format(5), format(6))).toBeNull();
    expect(between(format(5), format(5))).toBeNull();
  });

  it('survives twenty successive splits into the same gap before it needs a re-key', () => {
    let lo = format(1_000_000);
    const hi = format(2_000_000);
    let splits = 0;
    for (;;) {
      const mid = between(lo, hi);
      if (mid === null) break;
      expect(mid > lo && mid < hi).toBe(true);
      lo = mid;
      splits += 1;
    }
    expect(splits).toBeGreaterThanOrEqual(19);
  });

  it('topKey mints the first key on an empty goal and halves downward on a full one', () => {
    expect(topKey(null)).toBe(FIRST_SORT_KEY);
    const top = topKey(format(1_000_000))!;
    expect(top < format(1_000_000)).toBe(true);
    // No room left above the very first position: the caller re-keys rather than colliding.
    expect(topKey(format(1))).toBeNull();
  });

  it('rekey renumbers onto the default grid and changes no order', () => {
    const grid = rekey(4);
    expect(grid).toEqual([...grid].sort());
    expect(grid).toHaveLength(4);
    // Every adjacent pair has a full gap again, so the retry after a re-key cannot fail too.
    for (let i = 1; i < grid.length; i += 1) expect(between(grid[i - 1]!, grid[i]!)).not.toBeNull();
  });
});

describe('R-backlog-17 — the order is total and stable even when two keys collide (Q-7)', () => {
  const row = (id: string, sortKey: string, capturedAt: string) => ({ id, sortKey, capturedAt });

  it('S-backlog-17-2 — two items minted in the same millisecond with the same key still have one order', () => {
    const key = format(1_000_000);
    const a = row('01J00000000000000000000001', key, '2026-08-31T10:00:00.000Z');
    const b = row('01J00000000000000000000002', key, '2026-08-31T10:00:00.000Z');
    // `capturedAt` ties, so `id` desc decides — and it decides the same way from either input order.
    expect(withinGoal([a, b]).map((r) => r.id)).toEqual([b.id, a.id]);
    expect(withinGoal([b, a]).map((r) => r.id)).toEqual([b.id, a.id]);
  });

  it('sortKey wins over capturedAt — a manual order is not undone by a newer capture', () => {
    const older = row('01J00000000000000000000001', format(1_000_000), '2026-08-01T10:00:00.000Z');
    const newer = row('01J00000000000000000000002', format(2_000_000), '2026-08-31T10:00:00.000Z');
    expect(withinGoal([newer, older]).map((r) => r.id)).toEqual([older.id, newer.id]);
  });
});
