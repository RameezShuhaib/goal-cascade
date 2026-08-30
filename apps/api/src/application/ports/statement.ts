import type { BatchItem } from 'drizzle-orm/batch';

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
  /** Rows the statement must change; default 1. Use 0 for best-effort statements that may legitimately no-op. */
  expectedChanges?: number;
  /**
   * For every UPDATE/DELETE with `expectedChanges >= 1`, `GuardedBatch` derives a precondition from the
   * statement's WHERE clause and asserts it FIRST in the batch, so a failed guard raises a SQL error and
   * D1 rolls back every statement (including unconditional INSERTs).
   *
   * Set `assert: false` only when the guard is expected to be satisfied by an EARLIER statement of the
   * same batch (the precondition is evaluated against the pre-batch state); the `meta.changes`
   * post-check still applies.
   */
  assert?: boolean;
};
