import { and, asc, eq, gt, inArray, ne, or, sql } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import { chunkIds } from '../../application/ports';
import type { GoalPage, IGoalRepo, LensCount, LensKey, WeeklyUnderParent, WriteStmt } from '../../application/ports';
import { DB } from '../../application/services/guarded-batch';
import type { Goal } from '../../domain/entities';
import type { Db } from './db';
import { goals } from './schema';

/** A statement that is guaranteed to match nothing, for the empty-id-list case. */
const NEVER = ' never ';
const ids = (list: readonly string[]) => (list.length > 0 ? list : [NEVER]);

/** Q-7 — the opaque page cursor: the last row's `(createdAt, id)`, the one total order every list uses. */
function encodeCursor(row: { createdAt: string; id: string }): string {
  return `${row.createdAt}|${row.id}`;
}
function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  const i = cursor.indexOf('|');
  if (i <= 0) return null;
  return { createdAt: cursor.slice(0, i), id: cursor.slice(i + 1) };
}

@injectable()
export class D1GoalRepo implements IGoalRepo {
  constructor(@inject(DB) private readonly db: Db) {}

  findById(userId: string, id: string): Promise<Goal | null> {
    return this.db
      .select()
      .from(goals)
      .where(and(eq(goals.userId, userId), eq(goals.id, id)))
      .get()
      .then((r) => r ?? null);
  }

  /**
   * R-lens-16 / R-lens-27 — **the lens read: ONE indexed seek.**
   *
   * `WHERE user_id = ? AND horizon = ? AND period_key = ? ORDER BY created_at, id LIMIT ?` is an exact
   * prefix match on `ix_goals_lens` with the sort keys already in place, so there is no filesort and the
   * cost is the page, not the account. `period_key` sits before `created_at` in that index precisely so
   * this ordering is free.
   *
   * One row beyond the page is fetched to decide `nextCursor` without a second `COUNT` query.
   */
  async listByLens(userId: string, key: LensKey, page: { limit: number; cursor?: string }): Promise<GoalPage> {
    const after = page.cursor ? decodeCursor(page.cursor) : null;
    const rows = await this.db
      .select()
      .from(goals)
      .where(
        and(
          eq(goals.userId, userId),
          eq(goals.horizon, key.horizon),
          eq(goals.periodKey, key.periodKey),
          ...(after
            ? [
                or(
                  gt(goals.createdAt, after.createdAt),
                  and(eq(goals.createdAt, after.createdAt), gt(goals.id, after.id)),
                )!,
              ]
            : []),
        ),
      )
      .orderBy(asc(goals.createdAt), asc(goals.id))
      .limit(page.limit + 1)
      .all();

    const items = rows.slice(0, page.limit);
    const last = items[items.length - 1];
    return { items, nextCursor: rows.length > page.limit && last ? encodeCursor(last) : null };
  }

  /**
   * R-lens-27 — **the interior tree**: every goal whose horizon is not `Weekly`, read ONCE per request
   * and indexed by id (`domain/goal-tree.ts#indexTree`).
   *
   * It is what serves grouping, the Life-root walk (R-lens-3), the parent lines (R-lens-23) and the Move
   * sheet's target list, at O(1) per hop. The recommendation turns on one measured fact: **the tree above
   * Weekly does not accumulate with use.** A five-line account gains ~85 interior goals a year against
   * 300–1,000 Weekly ones, so at ten years the interior set is ~855 rows out of ~3,900 and at twenty-five
   * ~2,130 out of ~9,800. It never carries a Weekly goal the lens is not rendering.
   *
   * It also preserves R-lens-3 exactly as written — the Life root is a WALK, not a stored column, and it
   * is cycle-safe. Escalate to a denormalised `life_root_id` only if this set exceeds ~2,000 rows: that is
   * a schema change with a clear trigger rather than a guess.
   *
   * `ne(horizon, 'Weekly')` is served by `ix_goals_lens` as four horizon seeks under the `user_id`
   * prefix. Only the columns the walk needs are selected.
   */
  listInterior(userId: string): Promise<Goal[]> {
    return this.db
      .select()
      .from(goals)
      .where(and(eq(goals.userId, userId), ne(goals.horizon, 'Weekly')))
      .orderBy(asc(goals.createdAt), asc(goals.id))
      .all();
  }

  /** Every Life goal. The Life lens is the only unscoped read, and it is bounded by the number of lines. */
  listLifeGoals(userId: string): Promise<Goal[]> {
    return this.db
      .select()
      .from(goals)
      .where(and(eq(goals.userId, userId), eq(goals.horizon, 'Life')))
      .orderBy(asc(goals.createdAt), asc(goals.id))
      .all();
  }

  /**
   * The goals behind a set of ids — the Weekly lens's carried band reads it from the week's open tasks
   * (R-lens-12). **Chunked**: `ids` comes from a task list the owner controls, so it is bounded by open
   * work rather than by account size, but nothing here may assume that.
   */
  async listByIds(userId: string, list: readonly string[]): Promise<Goal[]> {
    if (list.length === 0) return [];
    const pages = await Promise.all(
      chunkIds(list).map((part) =>
        this.db
          .select()
          .from(goals)
          .where(and(eq(goals.userId, userId), inArray(goals.id, part)))
          .all(),
      ),
    );
    return pages.flat();
  }

  /**
   * R-goal-41 / R-goal-37 — one goal's direct children, in sibling order (Q-7). Served straight off
   * `ix_goals_owner_parent`, whose sort keys are exactly this ordering.
   */
  listChildren(userId: string, parentId: string): Promise<Goal[]> {
    return this.db
      .select()
      .from(goals)
      .where(and(eq(goals.userId, userId), eq(goals.parentId, parentId)))
      .orderBy(asc(goals.createdAt), asc(goals.id))
      .all();
  }

  /**
   * R-lens-27 / R-goal-18 / Q-5 — **one subtree, as a recursive CTE**, inclusive of the root.
   *
   * This replaces `descendantIds` over the whole table in the two places a real subtree is needed: the
   * move guard's cycle check and the delete cascade. Both run only on a WRITE, at most a few times a day
   * per owner, and a CTE bounded by one subtree at that frequency is the correct price — a full-table
   * scan three times per create was not.
   *
   * It returns **just the root** for a Weekly goal, which is terminal (R-goal-31) and can have no
   * descendants at all, so the move guard's cycle check costs one row there.
   *
   * `user_id` is inside the recursive step as well as the anchor: a `parent_id` is not a foreign key
   * (see `schema.ts`), so scoping only the anchor would let a crafted id walk into another owner's rows
   * (R-auth-2).
   */
  async subtreeIds(userId: string, rootId: string): Promise<string[]> {
    const rows = await this.db.all<{ id: string }>(sql`
      WITH RECURSIVE sub(id) AS (
        SELECT id FROM ${goals} WHERE user_id = ${userId} AND id = ${rootId}
        UNION
        SELECT g.id FROM ${goals} g JOIN sub ON g.parent_id = sub.id WHERE g.user_id = ${userId}
      )
      SELECT id FROM sub
    `);
    return rows.map((r) => r.id);
  }

  /**
   * R-backlog-26 — the Weekly goals **at or under** one goal for one week: the conversion targets.
   *
   * The subtree CTE, then one seek on `ix_goals_lens` for the exact `(horizon, period_key)` pair,
   * intersected. Two queries rather than one joined CTE, deliberately: a raw CTE returns SQL column
   * names and would need every `Goal` field aliased back to camelCase by hand, which is a mapping that
   * drifts silently the first time a column is added. Both are bounded by the item's own subtree, and
   * the item's goal is a Yearly/Quarterly/Monthly one, so that subtree is small.
   */
  async weeklyUnderForWeek(userId: string, rootId: string, weekStart: string): Promise<Goal[]> {
    const subtree = new Set(await this.subtreeIds(userId, rootId));
    if (subtree.size === 0) return [];
    const inWeek = await this.listWeeklyInWeek(userId, weekStart);
    return inWeek.filter((g) => g.parentId !== null && subtree.has(g.parentId));
  }

  /**
   * R-goal-47 — the planned-ness line's scope, as **one range scan per Monthly page**:
   * `horizon = 'Weekly' AND period_key BETWEEN <first Monday> AND <last Monday> AND parent_id IN (page)`.
   *
   * About five weeks wide. **It works only because `period_key` sorts lexicographically**, which is
   * R-goal-33's whole reason for existing; with a free-text period this would have been a scan.
   *
   * Only `parent_id` and `period_key` are selected — the line is two counts, not a list of goals. A
   * Monthly goal's only legal child is a Weekly one (R-goal-5), so "whose parent chain reaches this
   * Monthly goal" is exactly "whose `parent_id` is it", with no walk.
   */
  async weeklyUnderParents(
    userId: string,
    parentIds: readonly string[],
    fromKey: string,
    toKey: string,
  ): Promise<WeeklyUnderParent[]> {
    if (parentIds.length === 0) return [];
    const pages = await Promise.all(
      chunkIds(parentIds).map((part) =>
        this.db
          .select({ parentId: goals.parentId, periodKey: goals.periodKey })
          .from(goals)
          .where(
            and(
              eq(goals.userId, userId),
              eq(goals.horizon, 'Weekly'),
              inArray(goals.parentId, part),
              sql`${goals.periodKey} >= ${fromKey}`,
              sql`${goals.periodKey} <= ${toKey}`,
            ),
          )
          .all(),
      ),
    );
    return pages.flat().map((r) => ({ parentId: r.parentId ?? '', periodKey: r.periodKey }));
  }

  /**
   * R-lens-22 — **the Zoom sheet's counts: ONE grouped query, not five lens reads.**
   *
   * `SELECT horizon, COUNT(*) … WHERE (horizon='Yearly' AND period_key=?) OR (…) … GROUP BY horizon`,
   * plus the Life count in the same shape. Four index seeks on `ix_goals_lens`. Written naively as five
   * lens reads it would be five scans on every sheet open, which is exactly how this class of defect
   * returns (R-lens-27) — and it must never FETCH rows in order to count them.
   */
  async countByLens(userId: string, keys: readonly LensKey[]): Promise<LensCount[]> {
    if (keys.length === 0) return [];
    const pairs = keys.map((k) => and(eq(goals.horizon, k.horizon), eq(goals.periodKey, k.periodKey))!);
    const rows = await this.db
      .select({ horizon: goals.horizon, periodKey: goals.periodKey, n: sql<number>`count(*)` })
      .from(goals)
      .where(and(eq(goals.userId, userId), or(...pairs)))
      .groupBy(goals.horizon, goals.periodKey)
      .all();
    return rows.map((r) => ({ horizon: r.horizon, periodKey: r.periodKey, count: Number(r.n) }));
  }

  /**
   * R-lens-26 — the forward chevron's dot: does ANY later period at this horizon hold at least one goal?
   *
   * A `period_key > ?` probe on `ix_goals_lens` with `LIMIT 1`. It says *there is something ahead*, never
   * how much, so it never has to count.
   */
  async hasLaterPeriod(userId: string, horizon: Goal['horizon'], afterKey: string): Promise<boolean> {
    const row = await this.db
      .select({ id: goals.id })
      .from(goals)
      .where(and(eq(goals.userId, userId), eq(goals.horizon, horizon), gt(goals.periodKey, afterKey)))
      .limit(1)
      .get();
    return row !== undefined;
  }

  /**
   * ⚠ **A2, new (R-lens-24)** — has this horizon EVER held a goal, in any period?
   *
   * A `(user_id, horizon)` exact-prefix seek on `ix_goals_lens`, `LIMIT 1`. It is what separates "this
   * period is empty" from "you have never used this lens", and the two copies say different things.
   *
   * **It is not a second scan and it is not a count.** `GoalService.lens` calls it for **Weekly** alone,
   * and only when the page came back empty — every other horizon is answered from the interior tree that
   * request already read (R-lens-27), at zero cost.
   */
  async hasAnyAtHorizon(userId: string, horizon: Goal['horizon']): Promise<boolean> {
    const row = await this.db
      .select({ id: goals.id })
      .from(goals)
      .where(and(eq(goals.userId, userId), eq(goals.horizon, horizon)))
      .limit(1)
      .get();
    return row !== undefined;
  }

  /**
   * Q-12 — **the interior-goal cap**, counted on create. This is the set every request holds in memory
   * (R-lens-27), so it is the one number that protects the read strategy; it grows ~85/year, which makes
   * 1,000 a decade of headroom. It is deliberately NOT a lifetime cap on goals: that would be a cap on
   * how long the owner may use the product.
   */
  async countInterior(userId: string): Promise<number> {
    const row = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(goals)
      .where(and(eq(goals.userId, userId), ne(goals.horizon, 'Weekly')))
      .get();
    return Number(row?.n ?? 0);
  }

  /**
   * Q-12 — **the per-week Weekly-goal cap**, counted on create. A SHAPE cap, not a lifetime one: it
   * bounds one lens page and the fan-out of one week, and it never trips in ordinary use. An exact-prefix
   * `COUNT(*)` on `ix_goals_lens`.
   */
  async countWeeklyInWeek(userId: string, weekStart: string): Promise<number> {
    const row = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(goals)
      .where(and(eq(goals.userId, userId), eq(goals.horizon, 'Weekly'), eq(goals.periodKey, weekStart)))
      .get();
    return Number(row?.n ?? 0);
  }

  /** R-goal-46 — the previous week's Weekly goals for ONE Life line, for `Repeat last week`. */
  listWeeklyInWeek(userId: string, weekStart: string): Promise<Goal[]> {
    return this.db
      .select()
      .from(goals)
      .where(and(eq(goals.userId, userId), eq(goals.horizon, 'Weekly'), eq(goals.periodKey, weekStart)))
      .orderBy(asc(goals.createdAt), asc(goals.id))
      .all();
  }

  insertStmt(goal: Goal): WriteStmt {
    return this.db.insert(goals).values(goal);
  }

  updateGuardedStmt(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: Partial<Omit<Goal, 'id' | 'userId'>> & { updatedAt: string; version: number },
  ): WriteStmt {
    // The `version` predicate is the optimistic-concurrency guard (Q-2). GuardedBatch derives the
    // precondition from this WHERE clause, so a stale version rolls the WHOLE batch back — the activity
    // event and the row update succeed or fail together.
    return this.db
      .update(goals)
      .set(patch)
      .where(and(eq(goals.userId, userId), eq(goals.id, id), eq(goals.version, expectedVersion)));
  }

  /**
   * Q-5 — the subtree delete, one chunk at a time. `list` is a CHUNK of the set `subtreeIds`'s recursive
   * CTE returned; `GoalService.remove` splits it and states each chunk's own `expectedChanges`, because
   * only it knows the rows it read.
   */
  deleteManyStmt(userId: string, list: readonly string[]): WriteStmt {
    return this.db.delete(goals).where(and(eq(goals.userId, userId), inArray(goals.id, ids(list))));
  }
}
