/**
 * R-backlog-17 — **the manual-order key scheme, and the only place it is written down.**
 *
 * A key is **twelve zero-padded decimal digits** (`000001000000`). Two properties do all the work:
 *
 *  - **Fixed width means lexicographic order IS numeric order**, so SQLite sorts it with no collation, no
 *    `CAST`, and no filesort — the index `ix_backlog_goal_sort` serves the list in order. A variable-width
 *    numeric string would sort `9` after `10`, which is the classic version of this bug.
 *  - **The space between neighbours is halved, never renumbered.** A new position is the mid-point of the
 *    two keys it lands between, so a reorder writes ONE row. A position INDEX would have to rewrite every
 *    row below the insertion point on every move and is racy against a concurrent one — R-backlog-19
 *    refuses it for exactly that reason.
 *
 * The default gap is 1,000,000, which is ~20 mid-point splits deep before two neighbours become adjacent.
 * When they do — and it takes twenty successive drops into the same gap to get there — `rekey` renumbers
 * that one goal's list inside the SAME transaction, changing no order and telling the client nothing
 * (R-backlog-19). That is a rare, bounded, invisible event rather than the cost of every insert.
 *
 * Nothing here reads a clock, a user or a database. It is arithmetic on strings, and it is unit-tested as
 * such (`tests/domain/sort-keys.test.ts`).
 */

/** Twelve digits: `999999999999` positions, which is more than any backlog will ever hold. */
export const SORT_KEY_WIDTH = 12;
const MAX = 10 ** SORT_KEY_WIDTH - 1;

/**
 * The step between two freshly-minted neighbours, and the depth of the mid-point space between them.
 * Big enough that `rekey` is a curiosity rather than a code path anyone exercises by hand.
 */
export const SORT_KEY_GAP = 1_000_000;

/** The key a brand-new goal's FIRST item gets. Deliberately not `0`: R-backlog-18 needs room above it. */
export const FIRST_SORT_KEY = format(SORT_KEY_GAP);

export function format(n: number): string {
  const clamped = Math.max(0, Math.min(MAX, Math.trunc(n)));
  return String(clamped).padStart(SORT_KEY_WIDTH, '0');
}

/** A stored key as a number. A malformed or legacy-empty key reads as `0`, which sorts it to the top. */
export function parse(key: string): number {
  const n = Number.parseInt(key, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The key strictly between `before` and `after`, or `null` when the two are adjacent and there is no room.
 *
 * `null` is the caller's cue to `rekey` and try again — it is never an error the owner sees, and it never
 * changes an order (R-backlog-19).
 *
 * `null` bounds mean "the end of the list": `between(null, first)` is the top, `between(last, null)` the
 * bottom. The top is the mid-point of `0` and the first key rather than `first - GAP`, so it cannot walk
 * off the bottom of the range no matter how many times an item is moved to the top.
 */
export function between(before: string | null, after: string | null): string | null {
  const lo = before === null ? 0 : parse(before);
  // Past the last row there is no upper neighbour to halve against, so the list simply extends by one gap.
  // It can still run out — at the very top of the range — and that answers `null` like any other
  // exhaustion, so there is exactly one recovery path.
  if (after === null) return lo + SORT_KEY_GAP > MAX ? (lo < MAX ? format(MAX) : null) : format(lo + SORT_KEY_GAP);
  const hi = parse(after);
  if (hi - lo < 2) return null;
  return format(lo + Math.floor((hi - lo) / 2));
}

/**
 * R-backlog-18 — the key for a NEWLY CAPTURED item: the top of its goal's list.
 *
 * Every capture flow in the product puts the newest thing where you can see it, and this keeps
 * R-backlog-5's arrangement (newest first) exactly true for any list nobody has re-ordered. `null` when
 * the top is full — the caller re-keys and retries, the same as any other insertion.
 */
export function topKey(currentTop: string | null): string | null {
  return currentTop === null ? FIRST_SORT_KEY : between(null, currentTop);
}

/**
 * R-backlog-19 — the whole list, renumbered onto the default grid, **in the order it is already in**.
 *
 * The input must be the list in its rendered order; the output is one key per row at the same index. It
 * changes no order by construction: position `i` gets key `(i + 1) * GAP`, monotonically increasing.
 */
export function rekey(count: number): string[] {
  return Array.from({ length: count }, (_, i) => format((i + 1) * SORT_KEY_GAP));
}

/**
 * R-backlog-17 — **the total, stable order within one goal**: `sortKey` asc, then `capturedAt` desc, then
 * `id` desc.
 *
 * The two tie-breaks are not decoration. Keys can collide — two captures in the same millisecond both mint
 * the mid-point of the same gap, and no unique index refuses them (a unique index would turn a tie into a
 * lost capture) — and Q-7 requires that no read ever returns a different arrangement of an unchanged list.
 * With these three terms the order is total whether or not a collision ever happens.
 */
export function withinGoal<T extends { sortKey: string; capturedAt: string; id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? -1 : 1;
    if (a.capturedAt !== b.capturedAt) return a.capturedAt < b.capturedAt ? 1 : -1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}
