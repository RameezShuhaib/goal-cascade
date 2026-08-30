import { is, sql, type SQL } from 'drizzle-orm';
import { SQLiteDeleteBase, SQLiteTable, SQLiteUpdateBase } from 'drizzle-orm/sqlite-core';
import { inject, injectable } from 'tsyringe';
import { ConcurrencyError } from '../../domain/errors';
import type { Db } from '../../infrastructure/persistence/db';
import { guard } from '../../infrastructure/persistence/schema';
import type { GuardedWrite } from '../ports/statement';

export const DB = Symbol.for('goal-cascade.Db');

/** Matches the SQLite/D1 error raised by `_guard`'s `CHECK (0)` (the only CHECK constraint in the schema). */
const GUARD_ERROR = /CHECK constraint failed/i;

type Precondition = { label: string; expected: number; table: SQLiteTable; where: SQL };

/**
 * The atomic unit of every command. Runs all statements in ONE D1 `batch()` (a SQLite transaction: any
 * statement error rolls back the whole sequence) and verifies each statement's `meta.changes`.
 *
 * **Why the extra machinery.** D1 has no interactive transactions, and a 0-row UPDATE is NOT a SQL
 * error — so on its own, a failed optimistic-concurrency guard would let the unconditional statements of
 * the same batch commit anyway. That is exactly the shape of the writes this product makes: "insert the
 * activity event AND update the task", "insert the task AND mark the backlog item converted".
 *
 * Therefore, for every UPDATE/DELETE with `expectedChanges >= 1`, `run()` derives the precondition from
 * the statement's WHERE clause and prepends
 * `INSERT INTO _guard(label) SELECT ? WHERE (SELECT count(*) FROM <table> WHERE <where>) <> ?`.
 * When the precondition is false the insert trips `_guard`'s `CHECK (0)`, D1 rolls back the ENTIRE batch,
 * and the error is mapped to `ConcurrencyError` (409). The `meta.changes` post-check remains as the
 * second line of defence.
 *
 * This is what makes S-backlog-6-2 enforceable: a second conversion cannot create a task, because the
 * guarded `status = 'open'` update fails first and takes the insert down with it (D-19).
 *
 * Usage in a handler — guards are derived automatically, nothing to add:
 *   await this.batch.run([
 *     { label: 'taskEvent.insert', stmt: events.insertStmt(event) },
 *     { label: 'task.update',      stmt: tasks.updateGuardedStmt(userId, id, version, patch) },
 *   ]);
 */
@injectable()
export class GuardedBatch {
  constructor(@inject(DB) private readonly db: Db) {}

  async run(writes: readonly GuardedWrite[]): Promise<D1Result[]> {
    if (writes.length === 0) return [];
    const preconditions = writes.flatMap((w) => this.preconditionOf(w));
    const stmts = [...preconditions.map((p) => this.assertStmt(p)), ...writes.map((w) => w.stmt)];
    const [first, ...rest] = stmts;

    let all: D1Result[];
    try {
      all = (await this.db.batch([first!, ...rest] as unknown as [
        GuardedWrite['stmt'],
        ...GuardedWrite['stmt'][],
      ])) as unknown as D1Result[];
    } catch (err) {
      if (preconditions.length > 0 && err instanceof Error && GUARD_ERROR.test(err.message)) {
        throw await this.concurrencyErrorFor(preconditions);
      }
      throw err;
    }

    const results = all.slice(preconditions.length);
    writes.forEach((w, i) => {
      const expected = w.expectedChanges ?? 1;
      const actual = results[i]?.meta?.changes ?? 0;
      if (actual !== expected) throw new ConcurrencyError(w.label, expected, actual);
    });
    return results;
  }

  /** The precondition implied by a guarded UPDATE/DELETE: exactly `expectedChanges` rows match its WHERE. */
  private preconditionOf(w: GuardedWrite): Precondition[] {
    const expected = w.expectedChanges ?? 1;
    if (expected < 1 || w.assert === false) return [];
    if (!is(w.stmt, SQLiteUpdateBase) && !is(w.stmt, SQLiteDeleteBase)) return [];
    const config = (w.stmt as unknown as { config?: { table?: unknown; where?: SQL } }).config;
    if (!config || !is(config.table, SQLiteTable) || !config.where) return [];
    return [{ label: w.label, expected, table: config.table, where: config.where }];
  }

  /** Inserts a row into `_guard` (→ CHECK violation → batch rollback) iff the precondition is FALSE. */
  private assertStmt(p: Precondition) {
    return this.db
      .insert(guard)
      .select(sql`SELECT ${p.label} WHERE (SELECT count(*) FROM ${p.table} WHERE ${p.where}) <> ${p.expected}`);
  }

  /** Failure path only: re-evaluate the preconditions (reads) to name the one that failed. */
  private async concurrencyErrorFor(preconditions: Precondition[]): Promise<ConcurrencyError> {
    const counts = await Promise.all(
      preconditions.map((p) =>
        this.db
          .select({ n: sql<number>`count(*)` })
          .from(p.table)
          .where(p.where)
          .get(),
      ),
    );
    const i = preconditions.findIndex((p, idx) => (counts[idx]?.n ?? 0) !== p.expected);
    const failed = preconditions[i] ?? preconditions[0]!;
    return new ConcurrencyError(failed.label, failed.expected, i >= 0 ? (counts[i]?.n ?? 0) : 0);
  }
}
