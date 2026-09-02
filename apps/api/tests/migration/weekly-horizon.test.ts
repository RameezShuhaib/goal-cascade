import { sql } from 'drizzle-orm';
import migrationSql from '../../migrations/0003_weekly_horizon.sql?raw';
import { beforeAll, describe, expect, it } from 'vitest';
import { DB } from '../../src/application/services/guarded-batch';
import type { Db } from '../../src/infrastructure/persistence/db';
import { createTestApp, ids, signedInOwner } from '../helpers/app';

/**
 * ⚠ **A2 — migration `0003_weekly_horizon`, against real seeded data.**
 *
 * The migration has one real data problem (spec-delta §4 Q-3, RECONCILIATION Q-A): **under R-goal-39
 * every existing task is illegal the moment the rule lands**, because today's tasks hang off non-Life
 * leaves — which are exactly the childless Monthly goals R-goal-37 warns must never hold work.
 *
 * Option A of three, and the only one that leaves ONE shape in the database: mint one Weekly goal per
 * distinct `(goal_id, origin_week_start)` and re-point. Every task keeps its week, its carry age, its
 * activity and its place in the Weekly lens.
 *
 * ── How this test works, and why it has to work this way ──────────────────────────────────────────
 *
 * The suite applies every migration before any test runs, so the database is already at 0003 and the
 * pre-A2 state does not exist. This file **rebuilds that state** — `weekly_focus` re-created, goals with
 * free-text `period` and an empty `period_key`, tasks pointing at Monthly goals — and then executes the
 * migration's own statements, read from `0003_weekly_horizon.sql` and split on the same
 * `--> statement-breakpoint` marker wrangler uses. Nothing is re-implemented: a change to the SQL is a
 * change to what this asserts.
 *
 * The two DDL statements are skipped (the column and the index are already present from the real run)
 * and the final `DROP TABLE` is executed last, once. The DATA steps are run TWICE, which is the
 * idempotency proof the guards exist for.
 */
const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });
const NOW = '2026-08-31T10:00:00.000Z';

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

const dataSteps = () => STATEMENTS.filter((s) => /^UPDATE|^INSERT/i.test(s));
const dropStep = () => STATEMENTS.find((s) => /^DROP TABLE/i.test(s))!;

let db: Db;
let userId: string;
let ownerCookie: string;

/** Ids for the legacy fixture, so every assertion can name the exact row it means. */
const F = {
  life: ids.ulid(),
  yearly: ids.ulid(),
  quarterly: ids.ulid(),
  monthlyA: ids.ulid(),
  monthlyB: ids.ulid(),
  yearlyLeaf: ids.ulid(),
  junkPeriod: ids.ulid(),
  // Three tasks on monthlyA across TWO weeks, two on monthlyB in one week, one done, one exited.
  t1: ids.ulid(),
  t2: ids.ulid(),
  t3: ids.ulid(),
  t4: ids.ulid(),
  t5: ids.ulid(),
  t6: ids.ulid(),
};

const WEEK_A = '2026-08-17';
const WEEK_B = '2026-08-24';
const WEEK_C = '2026-08-31';

async function run(statements: readonly string[]) {
  for (const stmt of statements) await db.run(sql.raw(stmt));
}

beforeAll(async () => {
  const owner = await signedInOwner(t);
  userId = owner.userId;
  ownerCookie = owner.cookie;
  db = t.container().resolve<Db>(DB);

  // ── rebuild the pre-A2 world ───────────────────────────────────────────────────────────────────
  await db.run(sql.raw('DROP TABLE IF EXISTS `weekly_focus`'));
  await db.run(
    sql.raw(
      'CREATE TABLE `weekly_focus` (`id` text PRIMARY KEY NOT NULL, `user_id` text NOT NULL, `goal_id` text NOT NULL, `week_start` text NOT NULL, `sentence` text NOT NULL, `created_at` text NOT NULL, `updated_at` text NOT NULL)',
    ),
  );

  const goal = (id: string, parentId: string | null, horizon: string, title: string, period: string, createdAt = NOW) =>
    sql.raw(
      `INSERT INTO goals (id, user_id, parent_id, horizon, title, why, pulse, period_key, period, created_at, updated_at, version)
       VALUES ('${id}', '${userId}', ${parentId === null ? 'NULL' : `'${parentId}'`}, '${horizon}', '${title}', '', 'On track', '', '${period}', '${createdAt}', '${createdAt}', 1)`,
    );

  // Free-text periods in exactly the grammar the app itself emitted, plus one it never could.
  await db.run(goal(F.life, null, 'Life', 'Health', ''));
  await db.run(goal(F.yearly, F.life, 'Yearly', 'Marathon', '2026'));
  await db.run(goal(F.quarterly, F.yearly, 'Quarterly', 'Base miles', 'Q3 2026'));
  await db.run(goal(F.monthlyA, F.quarterly, 'Monthly', 'Long runs', 'Aug 2026'));
  await db.run(goal(F.monthlyB, F.quarterly, 'Monthly', 'Strength', 'Sep 2026'));
  // A Yearly goal that is itself a leaf and holds work — legal before A2, and the reason the mint keys
  // on `(goal, week)` rather than assuming the parent is Monthly.
  await db.run(goal(F.yearlyLeaf, F.life, 'Yearly', 'Sleep better', '2026'));
  // An owner-typed label the app's own grammar cannot parse: the backfill GUESSES from `created_at`.
  await db.run(goal(F.junkPeriod, F.quarterly, 'Monthly', 'Before the move', 'H2', '2026-07-09T08:00:00.000Z'));

  const task = (id: string, goalId: string, week: string, status = 'open', doneWeek: string | null = null) =>
    sql.raw(
      `INSERT INTO tasks (id, user_id, goal_id, title, cond, description, status, origin_week_start, done_week_start, done_at, exit_reason, exited_at, moved_to_backlog_item_id, created_at, updated_at, version)
       VALUES ('${id}', '${userId}', '${goalId}', 'task ${id.slice(-4)}', '', '', '${status}', '${week}', ${doneWeek === null ? 'NULL' : `'${doneWeek}'`}, NULL, NULL, NULL, NULL, '${NOW}', '${NOW}', 1)`,
    );

  await db.run(task(F.t1, F.monthlyA, WEEK_A));
  await db.run(task(F.t2, F.monthlyA, WEEK_A)); // same (goal, week) as t1 → ONE minted goal, not two
  await db.run(task(F.t3, F.monthlyA, WEEK_C));
  await db.run(task(F.t4, F.monthlyB, WEEK_B, 'done', WEEK_B)); // a DONE task is re-pointed too
  await db.run(task(F.t5, F.monthlyB, WEEK_B, 'canceled')); // …and so is an EXITED one
  await db.run(task(F.t6, F.yearlyLeaf, WEEK_C));

  // A focus sentence for exactly one of the (goal, week) pairs. It is the ONLY place the migration
  // reads a focus row, and it is read to keep WORK legal rather than to reconstruct a plan.
  await db.run(
    sql.raw(
      `INSERT INTO weekly_focus (id, user_id, goal_id, week_start, sentence, created_at, updated_at)
       VALUES ('${ids.ulid()}', '${userId}', '${F.monthlyA}', '${WEEK_A}', 'One long run every Sunday', '${NOW}', '${NOW}')`,
    ),
  );
});

type GoalRow = { id: string; parent_id: string | null; horizon: string; title: string; period_key: string; period: string; created_at: string };
type TaskRow = { id: string; goal_id: string; origin_week_start: string; status: string; done_week_start: string | null };

const goalsOf = () => db.all<GoalRow>(sql`SELECT * FROM goals WHERE user_id = ${userId} ORDER BY id`);
const tasksOf = () => db.all<TaskRow>(sql`SELECT * FROM tasks WHERE user_id = ${userId} ORDER BY id`);

describe('migration 0003 — the Weekly horizon, on real pre-A2 data', () => {
  it('the fixture really is the pre-A2 world: every task points at a NON-Weekly goal', async () => {
    // Without this the whole file could pass vacuously.
    const goals = await goalsOf();
    const tasks = await tasksOf();
    expect(goals.every((g) => g.horizon !== 'Weekly')).toBe(true);
    expect(tasks).toHaveLength(6);
    const byId = new Map(goals.map((g) => [g.id, g]));
    for (const task of tasks) expect(byId.get(task.goal_id)?.horizon, task.id).not.toBe('Weekly');
    expect(goals.every((g) => g.period_key === '')).toBe(true);
  });

  it('R-goal-33 — the backfill parses the app’s own grammar, and GUESSES the rest from created_at', async () => {
    await run(dataSteps());
    const byId = new Map((await goalsOf()).map((g) => [g.id, g]));

    // Parsed from the label the app itself emitted.
    expect(byId.get(F.life)).toMatchObject({ period_key: '', period: '' });
    expect(byId.get(F.yearly)).toMatchObject({ period_key: '2026', period: '2026' });
    expect(byId.get(F.quarterly)).toMatchObject({ period_key: '2026-Q3', period: 'Q3 2026' });
    expect(byId.get(F.monthlyA)).toMatchObject({ period_key: '2026-08', period: 'Aug 2026' });
    expect(byId.get(F.monthlyB)).toMatchObject({ period_key: '2026-09', period: 'Sep 2026' });

    /**
     * `H2` is not in the grammar `defaultPeriod` emitted, so it falls back to the period CONTAINING the
     * goal's `created_at` (July 2026). It is a GUESS, deliberately: it puts the goal in a lens where its
     * owner will find it, which beats leaving it unreachable in no lens at all. What is lost is the
     * owner-typed label, which was read by nothing — a lens cannot be built on a value the product
     * cannot compare (R-goal-33).
     */
    expect(byId.get(F.junkPeriod)).toMatchObject({ period_key: '2026-07', period: 'Jul 2026' });

    // S-goal-33-3 — after this, no goal has a `period` that is not the rendering of its own key.
    for (const g of byId.values()) {
      if (g.horizon === 'Life') expect(g.period).toBe('');
      else expect(g.period.length, g.id).toBeGreaterThan(0);
    }
  });

  it('mints EXACTLY ONE Weekly goal per (goal, originWeek) pair — never one per task', async () => {
    const weekly = (await goalsOf()).filter((g) => g.horizon === 'Weekly');
    // Four distinct pairs among six tasks: (A, WEEK_A) twice, (A, WEEK_C), (B, WEEK_B) twice,
    // (yearlyLeaf, WEEK_C).
    expect(weekly).toHaveLength(4);
    const pairs = weekly.map((g) => `${g.parent_id}|${g.period_key}`).sort();
    expect(pairs).toEqual(
      [`${F.monthlyA}|${WEEK_A}`, `${F.monthlyA}|${WEEK_C}`, `${F.monthlyB}|${WEEK_B}`, `${F.yearlyLeaf}|${WEEK_C}`].sort(),
    );
    expect(new Set(pairs).size, 'a pair was minted twice').toBe(pairs.length);
  });

  it('titles them from the focus SENTENCE where one exists, and from the parent’s title otherwise', async () => {
    const weekly = (await goalsOf()).filter((g) => g.horizon === 'Weekly');
    const at = (parent: string, week: string) => weekly.find((g) => g.parent_id === parent && g.period_key === week)!;

    // 1. the owner's own words about that week's work — the truest available title.
    expect(at(F.monthlyA, WEEK_A).title).toBe('One long run every Sunday');
    // 2. otherwise the parent goal's own title: redundant, always recognisable, renamable in one tap.
    expect(at(F.monthlyA, WEEK_C).title).toBe('Long runs');
    expect(at(F.monthlyB, WEEK_B).title).toBe('Strength');
    expect(at(F.yearlyLeaf, WEEK_C).title).toBe('Sleep better');

    // What they must NOT be titled, and it is worth asserting: the lens already says the week, and a
    // machine word in the owner's own plan is the thing the ruling ruled out.
    for (const g of weekly) {
      expect(g.title).not.toMatch(/^Week of/);
      expect(g.title).not.toMatch(/Migrated|Imported/i);
    }

    // R-goal-33 — and each carries the rendered label of its own week.
    expect(at(F.monthlyA, WEEK_A).period).toBe('Week of 17 Aug');
    // The minted goal's `created_at` is its own week's Monday, so it sorts into that week's lens.
    expect(at(F.monthlyA, WEEK_A).created_at).toBe(`${WEEK_A}T00:00:00.000Z`);
  });

  it('the ids are valid ULIDs on the wire, so every read model still parses', async () => {
    // 26 uppercase hex characters: every one is inside Crockford's alphabet, which is what the shared
    // `Ulid` schema pins. They are not time-sortable, and nothing in the product requires them to be.
    for (const g of (await goalsOf()).filter((g) => g.horizon === 'Weekly')) {
      expect(g.id, g.title).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    }
  });

  it('PRESERVES EVERY TASK — same rows, same weeks, same statuses — and re-points all six', async () => {
    const tasks = await tasksOf();
    expect(tasks.map((x) => x.id).sort()).toEqual([F.t1, F.t2, F.t3, F.t4, F.t5, F.t6].sort());

    const weekly = new Map((await goalsOf()).filter((g) => g.horizon === 'Weekly').map((g) => [g.id, g]));
    for (const task of tasks) {
      const owner = weekly.get(task.goal_id);
      expect(owner, `${task.id} was not re-pointed`).toBeTruthy();
      // R-task-40 — `origin_week_start` is the task's OWN field and is NOT touched. At the moment of
      // migration it equals its new parent's week by construction, which is the same invariant a
      // create establishes.
      expect(owner!.period_key, `${task.id} landed in the wrong week`).toBe(task.origin_week_start);
    }

    // The two tasks that shared a `(goal, week)` pair share the ONE goal minted for it.
    expect(tasks.find((x) => x.id === F.t1)!.goal_id).toBe(tasks.find((x) => x.id === F.t2)!.goal_id);

    // DONE and EXITED tasks are re-pointed the same way, deliberately: leaving them on a non-Weekly
    // parent as inert history would make every query that touches the past special-case them, forever.
    expect(tasks.find((x) => x.id === F.t4)).toMatchObject({ status: 'done', done_week_start: WEEK_B, origin_week_start: WEEK_B });
    expect(tasks.find((x) => x.id === F.t5)!.status).toBe('canceled');
  });

  it('every task is LEGAL under R-goal-39 afterwards — the migration’s whole purpose', async () => {
    const byId = new Map((await goalsOf()).map((g) => [g.id, g]));
    for (const task of await tasksOf()) {
      expect(byId.get(task.goal_id)?.horizon, `${task.id} still hangs off a non-Weekly goal`).toBe('Weekly');
    }
  });

  it('IS IDEMPOTENT — running the data steps again mints nothing and moves nothing', async () => {
    const goalsBefore = await goalsOf();
    const tasksBefore = await tasksOf();

    await run(dataSteps());

    const goalsAfter = await goalsOf();
    const tasksAfter = await tasksOf();
    // Byte-identical, row for row: the `NOT EXISTS` guard on the mint and the `EXISTS` guard on the
    // re-point are what make a replay a no-op rather than a doubling.
    expect(goalsAfter).toEqual(goalsBefore);
    expect(tasksAfter).toEqual(tasksBefore);
    expect(goalsAfter.filter((g) => g.horizon === 'Weekly')).toHaveLength(4);
  });

  it('R-rm-2 — the last statement drops `weekly_focus`, and it is gone for good', async () => {
    await run([dropStep()]);
    await expect(db.all(sql`SELECT * FROM weekly_focus`)).rejects.toBeTruthy();

    // The goals and tasks the sentence was read for are untouched by its removal.
    expect((await goalsOf()).filter((g) => g.horizon === 'Weekly')).toHaveLength(4);
    expect(await tasksOf()).toHaveLength(6);
  });

  /**
   * The end-to-end proof, and the one that would catch a migration that produced rows the product
   * cannot read: the migrated account is driven through the REAL lens.
   *
   * R-lens-12 is the assertion that matters. Every one of the six preserved tasks was live in some
   * week, and every one of them must still have a home: the two whose weeks have passed carry into the
   * CURRENT week's band with the goals the migration minted for them, which is precisely what "no open
   * task is ever without its goal" means.
   */
  it('the migrated account READS correctly through the real lens, carried band and all', async () => {
    const week = (await (await t.fetch(`/api/goals?lens=Weekly&period=${WEEK_C}`, { cookie: ownerCookie })).json()) as {
      items: { id: string; title: string; periodKey: string }[];
      carried: { id: string; title: string; periodKey: string }[];
      tasks: { id: string; goalId: string; carryAge: number }[];
      groups: { id: string | null; title: string; openTasks: number }[];
    };

    // This week's plan: the two goals minted for WEEK_C.
    expect(week.items.map((g) => g.title).sort()).toEqual(['Long runs', 'Sleep better']);
    // R-lens-12 — the goals for WEEK_A and WEEK_B carry in, OLDEST FIRST, labelled with their own week.
    // WEEK_B's goal does NOT: both its tasks are done/exited, so nothing is outstanding there.
    expect(week.carried.map((g) => g.title)).toEqual(['One long run every Sunday']);
    expect(week.carried[0]?.periodKey).toBe(WEEK_A);

    // Every visible task has a home in one band or the other (S-lens-12-6).
    const shown = new Set([...week.items, ...week.carried].map((g) => g.id));
    for (const task of week.tasks) expect(shown.has(task.goalId), `task ${task.id} has no home`).toBe(true);

    // …and the carry ages the migration preserved are the ones the owner actually earned: the two
    // WEEK_A tasks are two weeks old in WEEK_C, which is the red chip.
    const carriedTasks = week.tasks.filter((x) => week.carried.some((g) => g.id === x.goalId));
    expect(carriedTasks).toHaveLength(2);
    expect(carriedTasks.every((x) => x.carryAge === 2)).toBe(true);

    // R-lens-3 — and the whole thing groups under the one Life goal, resolved by the server.
    expect(week.groups.map((g) => g.id)).toEqual([F.life]);
  });
});
