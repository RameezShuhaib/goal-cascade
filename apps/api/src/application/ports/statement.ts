import type { BatchItem } from 'drizzle-orm/batch';

/**
 * ⚠ **A2 (RECONCILIATION §3.3, §3.9)** — **the bound-parameter chunk size.**
 *
 * `goal.service.ts` used to build `goalIds = goals.map(g => g.id)` — ALL n — and hand it to `inArray`,
 * which becomes one bound parameter per goal. There was no chunking anywhere in the repository layer.
 * That is a cliff that fails on ACCOUNT SIZE rather than on request shape: it works every day until an
 * owner's tree crosses D1's per-query bound, and then a read that never changed starts failing.
 *
 * Most of those uses are simply gone with the read rewrite (R-lens-27). The delete cascade's is the one
 * that legitimately stays large — deleting a Life goal takes the whole line — so it chunks, and it does
 * so HERE rather than inside a repo because each chunk is a separate statement that needs its own
 * `expectedChanges` count, and only the caller knows the rows it read.
 *
 * D1 documents a per-query ceiling of 100 bound parameters. 90 leaves headroom for the `user_id`, the
 * status predicates and the sort keys that accompany every one of these lists.
 */
export const ID_CHUNK = 90;

export function chunkIds<T>(list: readonly T[], size = ID_CHUNK): T[][] {
  if (list.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * An unexecuted write statement (INSERT/UPDATE/DELETE) built by a repository and executed by
 * `GuardedBatch` as part of ONE atomic D1 `batch()`. Repos expose `*Stmt` methods for anything that must
 * participate in a guarded batch; plain methods execute immediately.
 */
export type WriteStmt = BatchItem<'sqlite'>;

export type GuardedWrite = {
  /** Human label used in ConcurrencyError messages, e.g. 'goal.update'. */
  label: string;
  stmt: WriteStmt;
  /**
   * Rows the statement must change; default 1.
   *
   * A NUMBER is asserted EXACTLY, and `0` is a real assertion — "this statement must change no rows" —
   * not a way of switching the check off. The Q-5 subtree delete depends on that: it states the count it
   * read for every table, `0` included, so a row created between the read and the batch trips the
   * precondition and rolls the delete back instead of surviving its parent goal.
   *
   * `'any'` is the ONLY way to say "best-effort, assert nothing". Exactly one caller needs it: the lazy
   * carry-log producer (R-task-29, Q-17), an `INSERT … ON CONFLICT DO NOTHING` that writes 1 row on the
   * first read of a week and 0 on every re-read — both correct, so there is nothing to assert.
   */
  expectedChanges?: number | 'any';
  /**
   * For every UPDATE/DELETE with a NUMERIC `expectedChanges` (including `0`), `GuardedBatch` derives a
   * precondition from the statement's WHERE clause and asserts it FIRST in the batch, so a failed guard
   * raises a SQL error and D1 rolls back every statement (including unconditional INSERTs).
   *
   * Set `assert: false` only when the guard is expected to be satisfied by an EARLIER statement of the
   * same batch (the precondition is evaluated against the pre-batch state); the `meta.changes`
   * post-check still applies.
   */
  assert?: boolean;
};
