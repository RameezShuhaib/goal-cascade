import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import type { IBacklogLinkRepo, IBacklogRepo, WriteStmt } from '../../application/ports';
import { DB } from '../../application/services/guarded-batch';
import type { BacklogItem, BacklogLink } from '../../domain/entities';
import type { Db } from './db';
import { backlogItems, backlogLinks } from './schema';

const NEVER = ' never ';
const ids = (list: readonly string[]) => (list.length > 0 ? list : [NEVER]);

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

  /** R-backlog-5 / Q-7 — newest first. `status = 'open'`: a converted item never appears in a list again. */
  listOpen(userId: string): Promise<BacklogItem[]> {
    return this.db
      .select()
      .from(backlogItems)
      .where(and(eq(backlogItems.userId, userId), eq(backlogItems.status, 'open')))
      .orderBy(desc(backlogItems.capturedAt), desc(backlogItems.id))
      .all();
  }

  /** R-backlog-11/12 and R-plan-9 (the pull-based list under a checked leaf: the leaf + its ancestors). */
  listOpenByGoals(userId: string, goalIds: readonly string[]): Promise<BacklogItem[]> {
    return this.db
      .select()
      .from(backlogItems)
      .where(and(eq(backlogItems.userId, userId), eq(backlogItems.status, 'open'), inArray(backlogItems.goalId, ids(goalIds))))
      .orderBy(desc(backlogItems.capturedAt), desc(backlogItems.id))
      .all();
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

  listByItems(userId: string, itemIds: readonly string[]): Promise<BacklogLink[]> {
    return this.db
      .select()
      .from(backlogLinks)
      .where(and(eq(backlogLinks.userId, userId), inArray(backlogLinks.itemId, ids(itemIds))))
      .orderBy(asc(backlogLinks.createdAt), asc(backlogLinks.id))
      .all();
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
