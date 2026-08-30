import { and, desc, eq, inArray } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import type { IIdeaRepo, ILearningRepo, IPreferencesRepo, IUserRepo, WriteStmt } from '../../application/ports';
import { DB } from '../../application/services/guarded-batch';
import type { AuthUser, Idea, Learning, Preferences } from '../../domain/entities';
import type { Db } from './db';
import { ideas, learnings, preferences, user } from './schema';

const NEVER = ' never ';
const ids = (list: readonly string[]) => (list.length > 0 ? list : [NEVER]);

@injectable()
export class D1UserRepo implements IUserRepo {
  constructor(@inject(DB) private readonly db: Db) {}

  private static toAuthUser(r: typeof user.$inferSelect): AuthUser {
    return { id: r.id, name: r.name, email: r.email, emailVerified: r.emailVerified, image: r.image ?? null };
  }

  findById(id: string): Promise<AuthUser | null> {
    return this.db
      .select()
      .from(user)
      .where(eq(user.id, id))
      .get()
      .then((r) => (r ? D1UserRepo.toAuthUser(r) : null));
  }

  findByEmail(email: string): Promise<AuthUser | null> {
    return this.db
      .select()
      .from(user)
      .where(eq(user.email, email.trim().toLowerCase()))
      .get()
      .then((r) => (r ? D1UserRepo.toAuthUser(r) : null));
  }
}

@injectable()
export class D1PreferencesRepo implements IPreferencesRepo {
  constructor(@inject(DB) private readonly db: Db) {}

  get(userId: string): Promise<Preferences | null> {
    return this.db
      .select()
      .from(preferences)
      .where(eq(preferences.userId, userId))
      .get()
      .then((r) => r ?? null);
  }

  insertStmt(prefs: Preferences): WriteStmt {
    return this.db.insert(preferences).values(prefs);
  }

  updateStmt(userId: string, patch: Partial<Omit<Preferences, 'userId'>>): WriteStmt {
    return this.db.update(preferences).set(patch).where(eq(preferences.userId, userId));
  }
}

@injectable()
export class D1IdeaRepo implements IIdeaRepo {
  constructor(@inject(DB) private readonly db: Db) {}

  findById(userId: string, id: string): Promise<Idea | null> {
    return this.db
      .select()
      .from(ideas)
      .where(and(eq(ideas.userId, userId), eq(ideas.id, id)))
      .get()
      .then((r) => r ?? null);
  }

  /** R-idea-7 / Q-7 — newest first. Grouping by Life goal (and Unsorted) is the read model's job. */
  listAll(userId: string): Promise<Idea[]> {
    return this.db
      .select()
      .from(ideas)
      .where(eq(ideas.userId, userId))
      .orderBy(desc(ideas.capturedAt), desc(ideas.id))
      .all();
  }

  insertStmt(idea: Idea): WriteStmt {
    return this.db.insert(ideas).values(idea);
  }

  deleteStmt(userId: string, id: string): WriteStmt {
    return this.db.delete(ideas).where(and(eq(ideas.userId, userId), eq(ideas.id, id)));
  }

  /**
   * Q-5 / S-idea-7-1 — an Idea tagged to a goal inside a deleted subtree falls back to Unsorted rather
   * than being deleted with it. A parked thought is not part of the goal it was filed under.
   */
  untagByGoalsStmt(userId: string, goalIds: readonly string[]): WriteStmt {
    return this.db
      .update(ideas)
      .set({ goalId: null })
      .where(and(eq(ideas.userId, userId), inArray(ideas.goalId, ids(goalIds))));
  }
}

@injectable()
export class D1LearningRepo implements ILearningRepo {
  constructor(@inject(DB) private readonly db: Db) {}

  findById(userId: string, id: string): Promise<Learning | null> {
    return this.db
      .select()
      .from(learnings)
      .where(and(eq(learnings.userId, userId), eq(learnings.id, id)))
      .get()
      .then((r) => r ?? null);
  }

  listAll(userId: string): Promise<Learning[]> {
    return this.db
      .select()
      .from(learnings)
      .where(eq(learnings.userId, userId))
      .orderBy(desc(learnings.capturedAt), desc(learnings.id))
      .all();
  }

  /** R-learning-5 — the learnings on a Life root's whole line (the caller passes the root's id set). */
  listByGoals(userId: string, goalIds: readonly string[]): Promise<Learning[]> {
    return this.db
      .select()
      .from(learnings)
      .where(and(eq(learnings.userId, userId), inArray(learnings.goalId, ids(goalIds))))
      .orderBy(desc(learnings.capturedAt), desc(learnings.id))
      .all();
  }

  insertStmt(learning: Learning): WriteStmt {
    return this.db.insert(learnings).values(learning);
  }

  updateGuardedStmt(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: Partial<Omit<Learning, 'id' | 'userId'>> & { updatedAt: string; version: number },
  ): WriteStmt {
    return this.db
      .update(learnings)
      .set(patch)
      .where(and(eq(learnings.userId, userId), eq(learnings.id, id), eq(learnings.version, expectedVersion)));
  }

  deleteStmt(userId: string, id: string): WriteStmt {
    return this.db.delete(learnings).where(and(eq(learnings.userId, userId), eq(learnings.id, id)));
  }

  untagByGoalsStmt(userId: string, goalIds: readonly string[]): WriteStmt {
    return this.db
      .update(learnings)
      .set({ goalId: null })
      .where(and(eq(learnings.userId, userId), inArray(learnings.goalId, ids(goalIds))));
  }
}
