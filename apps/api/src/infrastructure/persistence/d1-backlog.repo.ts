import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import { chunkIds } from '../../application/ports';
import type { IBacklogLinkRepo, IBacklogRepo, WriteStmt } from '../../application/ports';
import { DB } from '../../application/services/guarded-batch';
import type { BacklogItem, BacklogLink } from '../../domain/entities';
import type { Db } from './db';
import { backlogItems, backlogLinks } from './schema';

const NEVER = ' never ';
const ids = (list: readonly string[]) => (list.length > 0 ? list : [NEVER]);

/** See `d1-task.repo.ts` — the bind-parameter cliff (RECONCILIATION §3.3), one chunk at a time. */
async function inChunks<I, R>(list: readonly I[], read: (part: I[]) => Promise<R[]>): Promise<R[]> {
  if (list.length === 0) return [];
  const pages = await Promise.all(chunkIds(list).map(read));
  return pages.flat();
}

@injectable()
export class D1BacklogRepo implements IBacklogRepo {
  constructor(@inject(DB) private readonly db: Db) {}

  findById(userId: string, id: string): Promise<BacklogItem | null> {
    return this.db
      .select()
      .from(backlogItems)
      .where(and(eq(backlogItems.userId, userId), eq(backlogItems.id, id)))
      .get()
      .then((r) => r ?? null);
  }

  /**
   * R-backlog-5 / Q-7 — newest first. `status = 'open'`: a converted item never appears in a list again.
   * ⚠ **A2 (Q-12)** — `limit` wires `MAX_PAGE`, which existed and was referenced nowhere.
   */
  listOpen(userId: string, limit?: number): Promise<BacklogItem[]> {
    const q = this.db
      .select()
      .from(backlogItems)
      .where(and(eq(backlogItems.userId, userId), eq(backlogItems.status, 'open')))
      .orderBy(desc(backlogItems.capturedAt), desc(backlogItems.id));
    return limit === undefined ? q.all() : q.limit(limit).all();
  }

  /**
   * ⚠ **A1, new (R-backlog-17)** — ONE goal's open items in the owner's **manual** order:
   * `sort_key` asc, `captured_at` desc, `id` desc — an exact-prefix seek on `ix_backlog_goal_sort` with
   * the sort keys already in place, so there is no filesort.
   *
   * The three terms are all required. `sort_key` alone is not a total order, because two captures in the
   * same millisecond can mint the same key and nothing refuses them (Q-7, and a unique index would turn
   * that tie into a lost capture).
   */
  listOpenByGoalOrdered(userId: string, goalId: string): Promise<BacklogItem[]> {
    return this.db
      .select()
      .from(backlogItems)
      .where(and(eq(backlogItems.userId, userId), eq(backlogItems.goalId, goalId), eq(backlogItems.status, 'open')))
      .orderBy(asc(backlogItems.sortKey), desc(backlogItems.capturedAt), desc(backlogItems.id))
      .all();
  }

  /** R-backlog-18/20 — the top of a goal's list, for the key a new or moved-in item gets. `LIMIT 1`. */
  async topSortKey(userId: string, goalId: string): Promise<string | null> {
    const row = await this.db
      .select({ sortKey: backlogItems.sortKey })
      .from(backlogItems)
      .where(and(eq(backlogItems.userId, userId), eq(backlogItems.goalId, goalId), eq(backlogItems.status, 'open')))
      .orderBy(asc(backlogItems.sortKey), desc(backlogItems.capturedAt), desc(backlogItems.id))
      .limit(1)
      .get();
    return row?.sortKey ?? null;
  }

  /** R-backlog-11/12 and R-backlog-28's pull list (a Weekly goal's ancestors). **Chunked.** */
  listOpenByGoals(userId: string, goalIds: readonly string[]): Promise<BacklogItem[]> {
    return inChunks(goalIds, (part) =>
      this.db
        .select()
        .from(backlogItems)
        .where(and(eq(backlogItems.userId, userId), eq(backlogItems.status, 'open'), inArray(backlogItems.goalId, part)))
        .orderBy(desc(backlogItems.capturedAt), desc(backlogItems.id))
        .all(),
    );
  }

  /** Q-5 — every item under these goals, converted ones included (they still own link rows). Chunked. */
  listByGoals(userId: string, goalIds: readonly string[]): Promise<BacklogItem[]> {
    return inChunks(goalIds, (part) =>
      this.db
        .select()
        .from(backlogItems)
        .where(and(eq(backlogItems.userId, userId), inArray(backlogItems.goalId, part)))
        .orderBy(desc(backlogItems.capturedAt), desc(backlogItems.id))
        .all(),
    );
  }

  insertStmt(item: BacklogItem): WriteStmt {
    return this.db.insert(backlogItems).values(item);
  }

  updateGuardedStmt(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: Partial<Omit<BacklogItem, 'id' | 'userId'>> & { updatedAt: string; version: number },
  ): WriteStmt {
    return this.db
      .update(backlogItems)
      .set(patch)
      .where(and(eq(backlogItems.userId, userId), eq(backlogItems.id, id), eq(backlogItems.version, expectedVersion)));
  }

  /**
   * D-19 / S-backlog-6-2 — the conversion half of "converted, never duplicated".
   *
   * The WHERE clause pins `status = 'open'` AND the expected version, so a SECOND conversion changes zero
   * rows; `GuardedBatch` turns that into a rolled-back batch, which takes the task INSERT down with it.
   * The `ux_backlog_converted_task` unique index is the belt to this braces. The mockup's
   * `find`-then-`filter` had neither, and produced a duplicate task from a vanished item.
   */
  markConvertedGuardedStmt(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: { convertedToTaskId: string; convertedAt: string; updatedAt: string; version: number },
  ): WriteStmt {
    return this.db
      .update(backlogItems)
      .set({ ...patch, status: 'converted' })
      .where(
        and(
          eq(backlogItems.userId, userId),
          eq(backlogItems.id, id),
          eq(backlogItems.status, 'open'),
          eq(backlogItems.version, expectedVersion),
        ),
      );
  }

  /**
   * ⚠ **A1, new (R-backlog-19)** — the RE-KEY write, and the ONLY statement that touches `sort_key`
   * without touching anything else.
   *
   * No `version` bump and no `updatedAt`: a re-key is invisible to the client, changes no order, and the
   * client never holds a key to go stale. Bumping the version would make another device's pending title
   * edit lose a race to a write nobody can see.
   */
  setSortKeyStmt(userId: string, id: string, sortKey: string): WriteStmt {
    return this.db
      .update(backlogItems)
      .set({ sortKey })
      .where(and(eq(backlogItems.userId, userId), eq(backlogItems.id, id)));
  }

  /** R-backlog-10 — the explicit Delete action. Conversion never deletes. */
  deleteStmt(userId: string, id: string): WriteStmt {
    return this.db.delete(backlogItems).where(and(eq(backlogItems.userId, userId), eq(backlogItems.id, id)));
  }

  deleteByGoalsStmt(userId: string, goalIds: readonly string[]): WriteStmt {
    return this.db
      .delete(backlogItems)
      .where(and(eq(backlogItems.userId, userId), inArray(backlogItems.goalId, ids(goalIds))));
  }
}

@injectable()
export class D1BacklogLinkRepo implements IBacklogLinkRepo {
  constructor(@inject(DB) private readonly db: Db) {}

  /** **Chunked** — the delete cascade passes a whole subtree's item ids. */
  listByItems(userId: string, itemIds: readonly string[]): Promise<BacklogLink[]> {
    return inChunks(itemIds, (part) =>
      this.db
        .select()
        .from(backlogLinks)
        .where(and(eq(backlogLinks.userId, userId), inArray(backlogLinks.itemId, part)))
        .orderBy(asc(backlogLinks.createdAt), asc(backlogLinks.id))
        .all(),
    );
  }

  insertStmt(link: BacklogLink): WriteStmt {
    return this.db.insert(backlogLinks).values(link);
  }

  deleteByItemsStmt(userId: string, itemIds: readonly string[]): WriteStmt {
    return this.db
      .delete(backlogLinks)
      .where(and(eq(backlogLinks.userId, userId), inArray(backlogLinks.itemId, ids(itemIds))));
  }
}
