import { sql } from 'drizzle-orm';
import migrationSql from '../../migrations/0005_month_tasks_and_measures.sql?raw';
import { beforeAll, describe, expect, it } from 'vitest';
import { DB } from '../../src/application/services/guarded-batch';
import type { Db } from '../../src/infrastructure/persistence/db';
import { createTestApp, ids, signedInOwner } from '../helpers/app';

/**
 * ⚠ **A8 — migration `0005_month_tasks_and_measures`, against the production shape.**
 *
 * The suite applies every migration before any test runs, so the database is already at 0005 and the
 * pre-A8 state does not exist. What that leaves worth asserting is the two things that could actually be
 * wrong, and one thing that could be wrong LATER:
 *
 *  1. **The end state**, column by column and index by index, read from `PRAGMA` rather than from the
 *     ORM — because `schema.ts` and the SQL are two files and only the database knows which one ran.
 *  2. **That the migration transforms NO DATA.** 0003 shipped a defect of exactly this class: an
 *     `UPDATE … CASE … ELSE ''` whose replay wiped the `period_key` of every Weekly goal it had just
 *     minted. The guard against repeating it is not a cleverer `UPDATE`; it is that there is **no
 *     `UPDATE` or `INSERT` in this file at all** — nothing is read, so nothing can be re-interpreted.
 *     That is asserted over the SQL text, which is the only place it can be asserted.
 *  3. **That the replayable statements really are replayable**, run twice, with an identical end state.
 *     The renames and adds carry no SQL-level conditional form (SQLite has none), and their replay safety
 *     is wrangler's journal — which is what actually runs in production, and is exercised by applying the
 *     whole migration set twice against a scratch D1 (recorded in `docs/work/31-measurables-api/build.md`).
 *
 * The account shape it is checked against is the owner's live one: **5 goals, 3 tasks, 23 backlog items.**
 */
const t = createTestApp({ now: '2026-09-02T10:00:00.000Z' });
const NOW = '2026-09-02T10:00:00.000Z';

/** The migration's statements, in file order, exactly as wrangler would apply them. */
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

/** The ones SQLite can be asked to run twice: `IF EXISTS` / `IF NOT EXISTS` carry their own guard. */
const replayable = () => STATEMENTS.filter((s) => /IF (NOT )?EXISTS/i.test(s));

let db: Db;

type ColumnRow = { name: string; type: string; notnull: number; dflt_value: string | null };
const columns = (table: string) => db.all<ColumnRow>(sql.raw(`PRAGMA table_info('${table}')`));
const indexes = (table: string) => db.all<{ name: string }>(sql.raw(`PRAGMA index_list('${table}')`));
const indexColumns = (name: string) => db.all<{ name: string }>(sql.raw(`PRAGMA index_info('${name}')`));

beforeAll(() => {
  db = t.container().resolve<Db>(DB);
});

describe('the migration transforms no data, which is the class of defect 0003 shipped', () => {
  /**
   * ⚠ **The one assertion that would have caught 0003's replay-wipe before it ran.**
   *
   * 0003's `UPDATE goals SET period_key = CASE … ELSE '' END` read a value and wrote an interpretation of
   * it; on a second run the `Weekly` branch had to be added or it wiped the keys it had just minted. This
   * migration reads nothing: a rename moves a name, `DEFAULT 'Weekly'` fills a new column with a constant
   * that is true of every existing row (before A8 only a Weekly goal could hold a task), and the five
   * measure columns are born NULL, which is exactly "this task is an ordinary checkbox".
   */
  it('contains no UPDATE and no INSERT at all', () => {
    const writes = STATEMENTS.filter((s) => /^\s*(UPDATE|INSERT|DELETE)\b/i.test(s));
    expect(writes, 'a data statement in this migration is a replay hazard — see the file header').toEqual([]);
    // …and the sanity floor, so this cannot pass by matching nothing.
    expect(STATEMENTS.length).toBeGreaterThan(10);
    expect(STATEMENTS.filter((s) => /^\s*ALTER TABLE/i.test(s)).length).toBeGreaterThan(5);
  });

  it('every DROP/CREATE statement carries its own IF (NOT) EXISTS guard', () => {
    const bare = STATEMENTS.filter((s) => /^\s*(CREATE|DROP)\b/i.test(s) && !/IF (NOT )?EXISTS/i.test(s));
    expect(bare, 'a CREATE or DROP without a guard cannot be replayed').toEqual([]);
    expect(replayable().length).toBeGreaterThanOrEqual(5);
  });

  it('the replayable statements are a no-op the second time, with an identical end state', async () => {
    const before = {
      tasks: await columns('tasks'),
      readings: await columns('task_readings'),
      taskIndexes: (await indexes('tasks')).map((i) => i.name).sort(),
      readingIndexes: (await indexes('task_readings')).map((i) => i.name).sort(),
    };
    for (const statement of replayable()) await db.run(sql.raw(statement));
    for (const statement of replayable()) await db.run(sql.raw(statement));

    expect(await columns('tasks')).toEqual(before.tasks);
    expect(await columns('task_readings')).toEqual(before.readings);
    expect((await indexes('tasks')).map((i) => i.name).sort()).toEqual(before.taskIndexes);
    expect((await indexes('task_readings')).map((i) => i.name).sort()).toEqual(before.readingIndexes);
  });
});

describe('the end state, read from the database rather than from the ORM', () => {
  it('R-task-52 — `tasks` carries the renamed period columns and neither old name survives', async () => {
    const names = (await columns('tasks')).map((c) => c.name);
    expect(names).toContain('origin_period_key');
    expect(names).toContain('done_period_key');
    expect(names).not.toContain('origin_week_start');
    expect(names).not.toContain('done_week_start');
  });

  it('R-task-52 — `scope` is NOT NULL and defaults to `Weekly`, which IS the backfill', async () => {
    const scope = (await columns('tasks')).find((c) => c.name === 'scope')!;
    expect(scope.notnull).toBe(1);
    expect(scope.dflt_value).toBe("'Weekly'");
    // The default is what makes the migration need no data statement: every task that existed before A8
    // hung off a Weekly goal (R-goal-39, the rule A8 supersedes), so the constant is true of all of them.
  });

  it('R-measure-1 — five nullable measure columns, and the three numeric ones are REAL', async () => {
    const byName = new Map((await columns('tasks')).map((c) => [c.name, c]));
    for (const name of ['measure_kind', 'measure_start', 'measure_current', 'measure_target', 'measure_unit']) {
      expect(byName.has(name), name).toBe(true);
      expect(byName.get(name)!.notnull, name).toBe(0); // all-or-nothing is an APPLICATION invariant
    }
    // REAL and not INTEGER: `78.5 kg` is the owner's own example.
    for (const name of ['measure_start', 'measure_current', 'measure_target']) {
      expect(byName.get(name)!.type.toUpperCase(), name).toBe('REAL');
    }
  });

  /**
   * ⚠ **R-task-52 — `scope` between `status` and the key is the whole reason the column is stored.**
   *
   * `'2026-08' <= '2026-09-07'` is true as a string comparison, and no index can key on the length of a
   * string, so without `scope` in the index a week read would sweep every month key on the way. This
   * asserts the column ORDER, not merely the presence of the index.
   */
  it('R-task-52 — the two task indexes are renamed and keyed (user, status, scope, key)', async () => {
    const names = (await indexes('tasks')).map((i) => i.name);
    expect(names).toContain('ix_tasks_open_period');
    expect(names).toContain('ix_tasks_done_period');
    expect(names).not.toContain('ix_tasks_open_week');
    expect(names).not.toContain('ix_tasks_done_week');

    expect((await indexColumns('ix_tasks_open_period')).map((c) => c.name)).toEqual([
      'user_id',
      'status',
      'scope',
      'origin_period_key',
    ]);
    expect((await indexColumns('ix_tasks_done_period')).map((c) => c.name)).toEqual([
      'user_id',
      'status',
      'scope',
      'done_period_key',
    ]);
  });

  /**
   * ⚠ **S-measure-5-2 — the assertion this table exists to make.**
   *
   * A reading is keyed by `task_id` and by nothing else, so it survives carrying, parking, un-parking,
   * re-parenting, completion and unchecking. A week, month, period or scope column here would be the one
   * change that makes the whole feature worthless, and it is refused at the schema.
   */
  it('R-measure-5 — `task_readings` has exactly six columns, and no period of any kind', async () => {
    const names = (await columns('task_readings')).map((c) => c.name).sort();
    expect(names).toEqual(['at', 'created_at', 'id', 'task_id', 'user_id', 'value']);
    for (const forbidden of ['week_start', 'period_key', 'scope', 'month', 'origin_period_key']) {
      expect(names, forbidden).not.toContain(forbidden);
    }
    expect((await indexColumns('ix_task_readings_task')).map((c) => c.name)).toEqual(['user_id', 'task_id', 'at', 'id']);
  });

  it('R-task-53 / R-task-59 — the carry key and the backlog provenance are periods now', async () => {
    expect((await columns('task_events')).map((c) => c.name)).toContain('period_key');
    expect((await columns('task_events')).map((c) => c.name)).not.toContain('week_start');
    expect((await columns('backlog_items')).map((c) => c.name)).toContain('from_period_key');
    expect((await columns('backlog_items')).map((c) => c.name)).not.toContain('from_week_start');
  });
});

/**
 * ⚠ **The production shape, surviving the migration.**
 *
 * The live account is 5 goals, 3 tasks and 23 backlog items. The migration renames and adds; it must
 * leave every value in those rows exactly as it found it, and the three tasks must come out the other
 * side as legal, visible, week-scoped work — which is the only thing that would be silently wrong if
 * `scope`'s default were missing or the rename had lost a value.
 */
describe("the owner's live shape survives: 5 goals, 3 tasks, 23 backlog items", () => {
  it('every task keeps its period and comes out scoped Weekly, and no measure appears from nowhere', async () => {
    // Seeded INSIDE the test: per-test storage isolation means a `beforeAll` owner is not in this
    // test's database, and a fixture that is not there passes every count assertion vacuously.
    const { cookie, userId } = await signedInOwner(t);
    const life = ids.ulid();
    const monthly = ids.ulid();
    const q = ids.ulid();
    const yearly = ids.ulid();
    const weekly = ids.ulid();
    const goal = (id: string, parent: string | null, horizon: string, key: string) =>
      sql.raw(
        `INSERT INTO goals (id, user_id, parent_id, horizon, title, why, pulse, period_key, period, created_at, updated_at, version)
         VALUES ('${id}', '${userId}', ${parent === null ? 'NULL' : `'${parent}'`}, '${horizon}', 'g ${id.slice(-4)}', '', 'On track', '${key}', '', '${NOW}', '${NOW}', 1)`,
      );
    await db.run(goal(life, null, 'Life', ''));
    await db.run(goal(yearly, life, 'Yearly', '2026'));
    await db.run(goal(q, yearly, 'Quarterly', '2026-Q3'));
    await db.run(goal(monthly, q, 'Monthly', '2026-09'));
    await db.run(goal(weekly, monthly, 'Weekly', '2026-08-31'));

    const weeks = ['2026-08-17', '2026-08-24', '2026-08-31'];
    const taskIds = weeks.map(() => ids.ulid());
    for (const [i, id] of taskIds.entries()) {
      await db.run(
        sql.raw(
          `INSERT INTO tasks (id, user_id, goal_id, title, cond, description, status, scope, origin_period_key, done_period_key,
                              done_at, exit_reason, exited_at, moved_to_backlog_item_id, created_at, updated_at, version)
           VALUES ('${id}', '${userId}', '${weekly}', 'legacy ${i}', '', '', 'open', 'Weekly', '${weeks[i]}', NULL,
                   NULL, NULL, NULL, NULL, '${NOW}', '${NOW}', 1)`,
        ),
      );
    }
    for (let i = 0; i < 23; i++) {
      await db.run(
        sql.raw(
          `INSERT INTO backlog_items (id, user_id, goal_id, title, description, captured_at, from_period_key, sort_key, status,
                                      converted_to_task_id, converted_at, created_at, updated_at, version)
           VALUES ('${ids.ulid()}', '${userId}', '${monthly}', 'item ${i}', '', '${NOW}', NULL, '${String(i + 1).padStart(12, '0')}', 'open',
                   NULL, NULL, '${NOW}', '${NOW}', 1)`,
        ),
      );
    }

    // Re-run the replayable half over the seeded rows: a replay must not touch a value.
    for (const statement of replayable()) await db.run(sql.raw(statement));

    const rows = await db.all<{ id: string; scope: string; origin_period_key: string; measure_kind: string | null }>(
      sql.raw(`SELECT id, scope, origin_period_key, measure_kind FROM tasks WHERE user_id = '${userId}' ORDER BY origin_period_key`),
    );
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.origin_period_key)).toEqual(weeks);
    expect(rows.every((r) => r.scope === 'Weekly')).toBe(true);
    // ⚠ Nothing invented a measure: `measure_kind IS NULL` is the whole of "an ordinary checkbox".
    expect(rows.every((r) => r.measure_kind === null)).toBe(true);

    const counts = await db.get<{ goals: number; items: number; readings: number }>(
      sql.raw(
        `SELECT (SELECT COUNT(*) FROM goals WHERE user_id = '${userId}') AS goals,
                (SELECT COUNT(*) FROM backlog_items WHERE user_id = '${userId}') AS items,
                (SELECT COUNT(*) FROM task_readings WHERE user_id = '${userId}') AS readings`,
      ),
    );
    expect(counts).toEqual({ goals: 5, items: 23, readings: 0 });

    /**
     * …and they are not merely present, they are WORK: the current week's read finds the task whose
     * origin is this week plus the two carrying into it, all Weekly-scoped. This is the assertion a lost
     * value or a missing `scope` default would actually break — the rows would still be there and the
     * lens would be empty. It lives in the same test because per-test storage isolation would otherwise
     * give it an empty database.
     */
    const read = await t.fetch('/api/tasks?week=0', { cookie });
    expect(read.status).toBe(200);
    const body = (await read.json()) as { tasks: { scope: string }[] };
    expect(body.tasks).toHaveLength(3);
    expect(body.tasks.every((x) => x.scope === 'Weekly')).toBe(true);
  });
});
