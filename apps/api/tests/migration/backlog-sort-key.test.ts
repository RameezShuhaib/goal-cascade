import { sql } from 'drizzle-orm';
import migrationSql from '../../migrations/0004_backlog_sort_key.sql?raw';
import { beforeAll, describe, expect, it } from 'vitest';
import { DB } from '../../src/application/services/guarded-batch';
import { backlogItems } from '../../src/infrastructure/persistence/schema';
import type { Db } from '../../src/infrastructure/persistence/db';
import { createTestApp, ids, signedInOwner } from '../helpers/app';

/**
 * ⚠ **A1 — migration `0004_backlog_sort_key`, against real seeded data.**
 *
 * The column is useless without a backfill, and a wrong backfill is invisible: leaving every row on `''`
 * produces *today's exact order* (`captured_at` desc is the tie-break), so the list would look right and
 * the first capture afterwards would have no key space above it. This file is the alarm on that.
 *
 * ── How it works ─────────────────────────────────────────────────────────────────────────────────
 *
 * The suite applies every migration before any test runs, so the column and the index are already there.
 * This file rebuilds the PRE-migration row state — items with `sort_key = ''` — and then executes the
 * migration's own backfill statement, read from `0004_backlog_sort_key.sql` and split on the same
 * `--> statement-breakpoint` marker wrangler uses. Nothing is re-implemented: a change to the SQL is a
 * change to what this asserts. The two DDL statements are skipped (already applied by the real run).
 *
 * The backfill is run TWICE, which is the idempotency proof its `WHERE sort_key = ''` guard exists for.
 */
const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });
const NOW = '2026-08-31T10:00:00.000Z';

const STATEMENTS = migrationSql
  .split('--> statement-breakpoint')
  .map((s) =>
    s
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
      .trim(),
  )
  .filter((s) => s.length > 0);

const backfill = () => STATEMENTS.filter((s) => /^UPDATE/i.test(s));

let db: Db;
let userId: string;

const F = {
  goalA: ids.ulid(),
  goalB: ids.ulid(),
  // Three on A across three instants, two on B, one of them already converted.
  a1: ids.ulid(),
  a2: ids.ulid(),
  a3: ids.ulid(),
  b1: ids.ulid(),
  b2: ids.ulid(),
};

async function run(statements: readonly string[]) {
  for (const stmt of statements) await db.run(sql.raw(stmt));
}

beforeAll(async () => {
  const owner = await signedInOwner(t);
  userId = owner.userId;
  db = t.container().resolve<Db>(DB);

  // The pre-migration shape: every row's key is the column default, `''`.
  const row = (id: string, goalId: string, title: string, capturedAt: string, status: 'open' | 'converted' = 'open') => ({
    id,
    userId,
    goalId,
    title,
    description: '',
    capturedAt,
    fromPeriodKey: null,
    sortKey: '',
    status,
    convertedToTaskId: null,
    convertedAt: null,
    createdAt: capturedAt,
    updatedAt: capturedAt,
    version: 1,
  });

  await db.insert(backlogItems).values([
    row(F.a1, F.goalA, 'A oldest', '2026-08-01T10:00:00.000Z'),
    row(F.a2, F.goalA, 'A middle', '2026-08-10T10:00:00.000Z'),
    row(F.a3, F.goalA, 'A newest', '2026-08-20T10:00:00.000Z'),
    row(F.b1, F.goalB, 'B older', '2026-08-05T10:00:00.000Z'),
    row(F.b2, F.goalB, 'B newer', '2026-08-15T10:00:00.000Z', 'converted'),
  ]);
  void NOW;
});

async function keys(goalId: string): Promise<{ title: string; sortKey: string }[]> {
  const rows = await db.all<{ title: string; sort_key: string }>(sql`
    SELECT title, sort_key FROM ${backlogItems}
     WHERE user_id = ${userId} AND goal_id = ${goalId}
     ORDER BY sort_key, captured_at DESC, id DESC
  `);
  return rows.map((r) => ({ title: r.title, sortKey: r.sort_key }));
}

describe('migration 0004 — the backfill', () => {
  it('puts every goal’s existing rows in today’s order, per goal, with room left above the first', async () => {
    await run(backfill());

    // R-backlog-5, made explicit: newest first, and the order it reproduces is the one the account
    // already had — nobody's backlog is rearranged by deploying this.
    expect(await keys(F.goalA)).toEqual([
      { title: 'A newest', sortKey: '000001000000' },
      { title: 'A middle', sortKey: '000002000000' },
      { title: 'A oldest', sortKey: '000003000000' },
    ]);

    // R-backlog-18 — the first key is 1,000,000 and not 0, so the very next capture lands on top with
    // no re-key at all. That is the whole reason the backfill cannot be skipped.
    expect(Number((await keys(F.goalA))[0]!.sortKey)).toBeGreaterThan(0);
  });

  it('ranks each goal SEPARATELY — manual order is per goal and starts at the top in each one', async () => {
    // R-backlog-21. Both goals start at 1,000,000: a global rank would have made goal B's list start
    // wherever goal A's happened to end, which is a cross-goal order the product does not have.
    expect(await keys(F.goalB)).toEqual([
      { title: 'B newer', sortKey: '000001000000' },
      { title: 'B older', sortKey: '000002000000' },
    ]);
  });

  it('backfills CONVERTED rows too — every row has a key, which is the cheaper invariant', async () => {
    // A converted row participates in no order (R-backlog-20), but leaving it on `''` would put it above
    // every future item in every query that does not filter status.
    const converted = (await keys(F.goalB)).find((r) => r.title === 'B newer')!;
    expect(converted.sortKey).not.toBe('');
  });

  it('is IDEMPOTENT — a second run changes nothing', async () => {
    const before = [...(await keys(F.goalA)), ...(await keys(F.goalB))];
    await run(backfill());
    expect([...(await keys(F.goalA)), ...(await keys(F.goalB))]).toEqual(before);
  });

  it('leaves a row a later capture already keyed alone', async () => {
    // The `WHERE sort_key = ''` guard is what makes a replay safe against a database that has been live
    // since the migration: an item captured after it has a real key and must not be renumbered by a
    // re-run into a position its owner never chose.
    const fresh = ids.ulid();
    await db.insert(backlogItems).values({
      id: fresh,
      userId,
      goalId: F.goalA,
      title: 'A captured after the deploy',
      description: '',
      capturedAt: '2026-08-31T09:00:00.000Z',
      fromPeriodKey: null,
      sortKey: '000000500000',
      status: 'open',
      convertedToTaskId: null,
      convertedAt: null,
      createdAt: '2026-08-31T09:00:00.000Z',
      updatedAt: '2026-08-31T09:00:00.000Z',
      version: 1,
    });

    await run(backfill());
    const list = await keys(F.goalA);
    expect(list[0]).toEqual({ title: 'A captured after the deploy', sortKey: '000000500000' });
    expect(list.map((r) => r.title)).toEqual(['A captured after the deploy', 'A newest', 'A middle', 'A oldest']);
  });
});
