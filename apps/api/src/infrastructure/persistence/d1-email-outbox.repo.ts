import { desc, eq, lt } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import type { IEmailOutboxRepo } from '../../application/ports';
import { DB } from '../../application/services/guarded-batch';
import type { OutboxEmail } from '../../domain/entities';
import type { Db } from './db';
import { emailOutbox } from './schema';

@injectable()
export class D1EmailOutboxRepo implements IEmailOutboxRepo {
  constructor(@inject(DB) private readonly db: Db) {}

  async insert(email: OutboxEmail): Promise<void> {
    await this.db.insert(emailOutbox).values(email).run();
  }

  listByTo(to: string, limit = 20): Promise<OutboxEmail[]> {
    return this.db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.to, to))
      .orderBy(desc(emailOutbox.createdAt), desc(emailOutbox.id))
      .limit(limit)
      .all();
  }

  async deleteByTo(to: string): Promise<number> {
    const r = await this.db.delete(emailOutbox).where(eq(emailOutbox.to, to)).run();
    return r.meta.changes ?? 0;
  }

  async purgeBefore(createdBefore: string): Promise<number> {
    const r = await this.db.delete(emailOutbox).where(lt(emailOutbox.createdAt, createdBefore)).run();
    return r.meta.changes ?? 0;
  }
}
