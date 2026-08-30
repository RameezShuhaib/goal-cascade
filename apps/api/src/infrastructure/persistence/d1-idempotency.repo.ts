import { and, eq, lt } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import type { IIdempotencyRepo } from '../../application/ports';
import { DB } from '../../application/services/guarded-batch';
import type { IdempotencyRecord } from '../../domain/entities';
import type { Db } from './db';
import { idempotencyKeys } from './schema';

@injectable()
export class D1IdempotencyRepo implements IIdempotencyRepo {
  constructor(@inject(DB) private readonly db: Db) {}

  async begin(rec: Omit<IdempotencyRecord, 'statusCode' | 'responseBody'>) {
    const r = await this.db
      .insert(idempotencyKeys)
      .values({ ...rec, statusCode: null, responseBody: null })
      .onConflictDoNothing()
      .run();
    if ((r.meta.changes ?? 0) > 0) return { inserted: true as const };
    const existing = await this.db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, rec.scope), eq(idempotencyKeys.key, rec.key)))
      .get();
    // The row must exist if the insert conflicted; treat a vanished row as "in progress" to be safe.
    return { inserted: false as const, existing: existing ?? { ...rec, statusCode: null, responseBody: null } };
  }

  async complete(scope: string, key: string, statusCode: number, responseBody: string): Promise<void> {
    await this.db
      .update(idempotencyKeys)
      .set({ statusCode, responseBody })
      .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)))
      .run();
  }

  async remove(scope: string, key: string): Promise<void> {
    await this.db
      .delete(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)))
      .run();
  }

  async purgeBefore(createdBefore: string): Promise<number> {
    const r = await this.db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, createdBefore)).run();
    return r.meta.changes ?? 0;
  }
}
