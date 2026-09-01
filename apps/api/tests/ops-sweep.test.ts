import { AUTH_RATE_LIMIT_MAX_WINDOW_MS } from '../src/infrastructure/auth/rate-limit';
import { describe, expect, it } from 'vitest';
import { IAuthRateLimitRepo, IEmailOutboxRepo, IIdempotencyRepo } from '../src/application/ports';
import { createTestApp } from './helpers/app';

/**
 * **The ops sweep — kept, and now reachable.**
 *
 * Three ports carry a `purgeBefore`: `IIdempotencyRepo`, `IEmailOutboxRepo` and `IAuthRateLimitRepo`.
 * They had no caller anywhere, the DI binding behind the third was never resolved, and
 * `AUTH_RATE_LIMIT_MAX_WINDOW_MS` — which computes exactly the cutoff that third one takes — had no
 * caller either. **Registered, implemented, and unreachable end to end** is the shape of code that
 * looks maintained and is not: nothing would have failed if one of the three had been written against
 * the wrong column.
 *
 * **The decision, made once and recorded here: keep the seam, and prove it rather than route it.**
 *
 * The alternative on offer was an internal HTTP route that exercises the sweep. That trades this defect
 * for the same defect one level up — an authenticated admin endpoint nothing calls, on a single-user
 * deployment with no operator, no cron and no story for who would hold the credential. The three tables
 * genuinely accumulate (idempotency records per write, outbox rows per email, one counter row per rate
 * limit key), the SQL is four lines each, and `d1-rate-limit-store.ts` states outright that this exists
 * for an ops sweep because the product has no cron. What was missing was never the route; it was any
 * evidence the code works. This is that evidence, against real D1, through the real container.
 *
 * If a sweep is ever scheduled, it calls these three and this file already says they do what they say.
 */
describe('the ops-sweep seam', () => {
  const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });

  it('purges idempotency records older than the cutoff, and keeps the rest', async () => {
    const repo = t.container().resolve<IIdempotencyRepo>(IIdempotencyRepo);
    const scope = `sweep-${crypto.randomUUID()}`;
    const userId = `u-${crypto.randomUUID()}`;

    const put = async (key: string, createdAt: string) => {
      const r = await repo.begin({ scope, key, userId, requestHash: 'h', createdAt });
      expect(r.inserted).toBe(true);
    };
    await put('old', '2026-01-01T00:00:00.000Z');
    await put('older', '2025-06-01T00:00:00.000Z');
    await put('fresh', '2026-08-30T00:00:00.000Z');

    const purged = await repo.purgeBefore('2026-06-01T00:00:00.000Z');
    expect(purged).toBe(2);

    // The boundary is `<`, so a record newer than the cutoff survives — and a survivor is what proves
    // the delete was scoped rather than a table wipe that happened to return the right number.
    const again = await repo.begin({ scope, key: 'fresh', userId, requestHash: 'h', createdAt: '2026-08-31T00:00:00.000Z' });
    expect(again.inserted, 'the fresh record should still be there, so a re-begin replays it').toBe(false);
  });

  it('purges outbox emails older than the cutoff', async () => {
    const repo = t.container().resolve<IEmailOutboxRepo>(IEmailOutboxRepo);
    const to = `sweep-${crypto.randomUUID()}@example.com`;
    const mail = (id: string, createdAt: string) => ({
      id,
      to,
      subject: 's',
      body: 'b',
      createdAt,
    });
    await repo.insert(mail(crypto.randomUUID(), '2026-01-01T00:00:00.000Z'));
    await repo.insert(mail(crypto.randomUUID(), '2026-08-30T00:00:00.000Z'));

    await repo.purgeBefore('2026-06-01T00:00:00.000Z');
    const left = await repo.listByTo(to);
    expect(left).toHaveLength(1);
    expect(left[0]!.createdAt).toBe('2026-08-30T00:00:00.000Z');
  });

  it('purges rate-limit counters that can no longer deny anything, at the window the constant computes', async () => {
    const repo = t.container().resolve<IAuthRateLimitRepo>(IAuthRateLimitRepo);
    const key = `sweep-${crypto.randomUUID()}`;
    const rule = { window: 60, max: 1 };

    // One consume mints the counter row and uses up its single allowance.
    expect((await repo.consume(key, rule)).allowed).toBe(true);
    expect((await repo.consume(key, rule)).allowed).toBe(false);

    /**
     * `AUTH_RATE_LIMIT_MAX_WINDOW_MS` is the longest window any rule can be asked about, so a counter
     * whose last request is older than that can no longer deny anything under ANY rule. That is the
     * argument the sweep takes, and this is its only caller — which is the point: the constant computed
     * the right number and nothing had ever used it.
     */
    const cutoff = Date.now() - AUTH_RATE_LIMIT_MAX_WINDOW_MS;
    expect(await repo.purgeBefore(cutoff), 'a counter used a moment ago is still live and must survive').toBe(0);
    expect((await repo.consume(key, rule)).allowed, 'still denied — the purge did not drop a live counter').toBe(false);

    // Now sweep with a cutoff in the future: every counter is stale, and the key is allowed again.
    expect(await repo.purgeBefore(Date.now() + 1)).toBeGreaterThanOrEqual(1);
    expect((await repo.consume(key, rule)).allowed, 'the counter was pruned, so the key starts over').toBe(true);
  });
});
