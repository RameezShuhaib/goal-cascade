import { eq, lt, sql } from 'drizzle-orm';
import type { IAuthRateLimitRepo } from '../../application/ports';
import type { Db } from '../persistence/db';
import { authRateLimits } from '../persistence/schema';

/**
 * `rateLimit.customStorage` for Better Auth 1.7.2 — ported unchanged from the reference codebase.
 *
 * The contract (`BetterAuthRateLimitStorage`) is a single `consume(key, rule)` that must ATOMICALLY record one
 * request and say whether it is allowed; Better Auth explicitly refuses a get/set pair because that shape cannot
 * hold a limit under concurrency. Its own memory backend is useless to us — this Worker constructs one auth
 * instance per request, so nothing survives between two attempts — and its `database` backend wants a `rateLimit`
 * model registered on the Drizzle adapter. So we implement `consume` directly against D1 in ONE statement:
 *
 *   INSERT … ON CONFLICT(key) DO UPDATE SET count = <reset or +1>, last_request = now
 *   WHERE <window elapsed> OR count < max
 *   RETURNING …
 *
 * SQLite evaluates the upsert's WHERE against the *existing* row, so a request over the limit updates nothing and
 * `RETURNING` yields no row — the counter is not bumped and the window cannot be extended by hammering it (which
 * would otherwise turn a burst into a permanent lockout). Rolling window, same semantics as Better Auth's own
 * `decideConsume`: the window restarts when `now - last_request >= window`.
 */
export class D1RateLimitStore implements IAuthRateLimitRepo {
  constructor(private readonly db: Db) {}

  consume = async (key: string, rule: { window: number; max: number }): Promise<{ allowed: boolean; retryAfter: number | null }> => {
    const now = Date.now();
    const windowMs = Math.max(1, Math.round(rule.window * 1000));
    const max = Math.max(1, Math.floor(rule.max));

    const rows = await this.db
      .insert(authRateLimits)
      .values({ key, count: 1, lastRequest: now })
      .onConflictDoUpdate({
        target: authRateLimits.key,
        set: {
          count: sql`case when ${now} - ${authRateLimits.lastRequest} >= ${windowMs} then 1 else ${authRateLimits.count} + 1 end`,
          lastRequest: sql`${now}`,
        },
        setWhere: sql`${now} - ${authRateLimits.lastRequest} >= ${windowMs} or ${authRateLimits.count} < ${max}`,
      })
      .returning({ lastRequest: authRateLimits.lastRequest })
      .all();

    if (rows.length > 0) return { allowed: true, retryAfter: null };

    // Denied. Re-read to report how long the caller has to wait; a row that vanished under us (pruned) is a pass.
    const current = await this.db.select().from(authRateLimits).where(eq(authRateLimits.key, key)).get();
    if (!current) return { allowed: true, retryAfter: null };
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((current.lastRequest + windowMs - Date.now()) / 1000)) };
  };

  /**
   * Prune counters that can no longer deny anything. Nothing calls it on a schedule: this product has no
   * cron, so it exists for an ops/internal sweep.
   *
   * ⚠ **Decided once, and kept.** This and its two siblings (`IIdempotencyRepo`, `IEmailOutboxRepo`) were
   * registered, implemented and unreachable end to end — no caller, and the DI binding below was never
   * resolved. The alternative was an internal route to exercise them, which is the same defect one level
   * up: an admin endpoint nothing calls, on a single-user deployment with no operator. Instead
   * `tests/ops-sweep.test.ts` resolves all three from the real container and runs them against real D1,
   * so the seam is proven rather than merely present. It is also the only caller of
   * `AUTH_RATE_LIMIT_MAX_WINDOW_MS`, which computes exactly the cutoff this takes.
   */
  async purgeBefore(lastRequestBeforeMs: number): Promise<number> {
    const r = await this.db.delete(authRateLimits).where(lt(authRateLimits.lastRequest, lastRequestBeforeMs)).run();
    return r.meta.changes ?? 0;
  }
}
