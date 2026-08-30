import { HEADERS, IDEMPOTENCY_KEY_PATTERN } from '@goal-cascade/shared';
import type { MiddlewareHandler } from 'hono';
import { IIdempotencyRepo } from '../../application/ports';
import { DomainError } from '../../domain/errors';
import type { AppBindings } from '../types';

/** Stable JSON: object keys sorted recursively; empty body = `{}`. */
export function canonicalBody(text: string): string {
  if (text.trim() === '') return '{}';
  try {
    return JSON.stringify(sortKeys(JSON.parse(text)));
  } catch {
    return text;
  }
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Apply to every command route (after `requireSession`, before validation).
 *
 *  - Missing/invalid `Idempotency-Key` → 400 IDEMPOTENCY_KEY_MISSING.
 *  - Scope = `userId` — this product has no tenant, so the owner IS the scope.
 *    `request_hash = sha256(method + path + canonical body)`, so key ordering in the JSON does not matter.
 *  - Insert (status NULL). On conflict: NULL status → 409 IDEMPOTENCY_IN_PROGRESS; a different hash →
 *    422 IDEMPOTENCY_KEY_REUSED; otherwise replay the stored status + body with `Idempotent-Replayed: true`.
 *  - After the handler: store status + body (4xx too, so a refusal replays as the same refusal); on a
 *    5xx DELETE the row so the client can genuinely retry.
 *
 * This is what makes a flaky mobile network safe, and it is the second half of Q-4: a retried
 * backlog conversion returns the ORIGINAL task rather than creating a second one, and the guarded
 * `status='open'` update behind it refuses a genuinely new attempt.
 */
export const idempotent: MiddlewareHandler<AppBindings> = async (c, next) => {
  const key = c.req.header(HEADERS.idempotencyKey)?.trim();
  if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new DomainError(
      'IDEMPOTENCY_KEY_MISSING',
      `${HEADERS.idempotencyKey} header is required (16–64 chars of [A-Za-z0-9_-])`,
    );
  }
  const ctx = c.get('ctx');
  const scope = ctx.userId;
  const repo = c.get('container').resolve<IIdempotencyRepo>(IIdempotencyRepo);
  const path = new URL(c.req.url).pathname;
  const requestHash = await sha256Hex(`${c.req.method}\n${path}\n${canonicalBody(await c.req.text())}`);

  const begin = await repo.begin({ scope, key, userId: ctx.userId, requestHash, createdAt: ctx.now });
  if (!begin.inserted) {
    const ex = begin.existing;
    if (ex.statusCode === null) throw new DomainError('IDEMPOTENCY_IN_PROGRESS', 'a request with this key is still executing');
    if (ex.requestHash !== requestHash) throw new DomainError('IDEMPOTENCY_KEY_REUSED', 'this key was used for a different request');
    const headers = new Headers({ [HEADERS.idempotentReplayed]: 'true' });
    if (ex.statusCode !== 204) headers.set('Content-Type', 'application/json; charset=UTF-8');
    return new Response(ex.statusCode === 204 ? null : (ex.responseBody ?? ''), { status: ex.statusCode, headers });
  }

  ctx.idempotencyKey = key;
  await next();

  const res = c.res;
  if (res.status >= 500) {
    await repo.remove(scope, key);
    return;
  }
  const text = res.status === 204 ? '' : await res.clone().text();
  await repo.complete(scope, key, res.status, text);
};
