import { eq } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import type { IApiTokenRepo } from '../../application/ports';
import { DB } from '../../application/services/guarded-batch';
import type { ApiToken } from '../../domain/entities';
import type { Db } from './db';
import { apiTokens } from './schema';

/**
 * The one agent-access token per account.
 *
 * Every method here handles HASHES only. The plaintext is generated, returned once and discarded by
 * `ApiTokenService`; nothing below that line has ever seen one, so nothing below that line can leak one.
 */
@injectable()
export class D1ApiTokenRepo implements IApiTokenRepo {
  constructor(@inject(DB) private readonly db: Db) {}

  async findByUser(userId: string): Promise<ApiToken | null> {
    return (await this.db.select().from(apiTokens).where(eq(apiTokens.userId, userId)).get()) ?? null;
  }

  /**
   * The `/mcp` bearer lookup — one seek on `ux_api_tokens_hash`.
   *
   * A miss returns `null` rather than throwing, so the caller answers with the SAME 401 for "no such
   * token", "revoked token" and "token belonging to nobody". A different answer for each would tell an
   * attacker which guesses were closer.
   */
  async findByHash(tokenHash: string): Promise<ApiToken | null> {
    return (await this.db.select().from(apiTokens).where(eq(apiTokens.tokenHash, tokenHash)).get()) ?? null;
  }

  /**
   * Create or REPLACE, in ONE statement.
   *
   * `onConflictDoUpdate` on the `user_id` primary key is what makes "creating a new token instantly
   * invalidates the old one" atomic: there is no window in which both hashes are present, and no path
   * that inserts a second row. A read-then-branch would have both.
   */
  async upsert(token: ApiToken): Promise<void> {
    await this.db
      .insert(apiTokens)
      .values(token)
      .onConflictDoUpdate({
        target: apiTokens.userId,
        set: { tokenHash: token.tokenHash, last4: token.last4, createdAt: token.createdAt },
      })
      .run();
  }

  /** Idempotent by construction: deleting nothing changes 0 rows and is still a success. */
  async deleteByUser(userId: string): Promise<number> {
    const r = await this.db.delete(apiTokens).where(eq(apiTokens.userId, userId)).run();
    return r.meta.changes ?? 0;
  }
}
