import { API_TOKEN_PREFIX, type ApiTokenStatusView } from '@goal-cascade/shared';
import { inject, injectable } from 'tsyringe';
import { DomainError } from '../../domain/errors';
import type { RequestContext } from '../context';
import { IApiTokenRepo, IClock } from '../ports';

/**
 * How many random bytes go into a token. 32 bytes = 256 bits of entropy, base64url-encoded to 43
 * characters. `crypto.getRandomValues` is the platform CSPRNG; `Math.random` would be a catastrophe here
 * and there is deliberately no seam that could substitute one.
 */
const TOKEN_BYTES = 32;

/**
 * SHA-256 hex. The SAME primitive `api/middleware/idempotency.ts#sha256Hex` uses for request hashes and
 * the same one Better Auth applies to reset tokens under `verification: { storeIdentifier: 'hashed' }`
 * (`infrastructure/auth/better-auth.ts`) — checked rather than invented, so this codebase has one hashing
 * story and not two.
 *
 * A plain digest with no salt and no stretching is correct HERE and would be wrong for a password: the
 * input is 256 bits of CSPRNG output, so there is no dictionary to attack and no work factor worth
 * paying. What it buys is the only thing that matters — a D1 export contains no live key.
 *
 * It is duplicated rather than imported from the middleware because `application/` must not depend on
 * `api/`; the middleware's copy is the one with the request-hashing comment.
 */
export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Constant-time string comparison — the same shape as `api/middleware/internal-secret.ts`.
 *
 * Both inputs here are 64-char hex digests of the same fixed length, so the length guard can never leak
 * anything about the stored value, and the loop's timing does not depend on WHERE the first mismatch is.
 * A `===` on a secret comparison is a timing oracle; this is not.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** `gcm_` + 43 chars of base64url. Recognisable in a log, greppable in a leak, unguessable in practice. */
function mintToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64url = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${API_TOKEN_PREFIX}${b64url}`;
}

/**
 * The ONE agent-access token.
 *
 * Everything secret about this feature lives in this file: minting, hashing, comparing. The repo sees
 * only hashes, the routes see only the service, and the plaintext exists for exactly the length of one
 * `create` call.
 *
 * The password check is NOT here — it belongs to Better Auth, which owns password hashing, and it is done
 * in `me.routes.ts` exactly the way `change-password` does it. Splitting it that way keeps this service
 * free of any auth dependency and therefore trivially testable.
 */
@injectable()
export class ApiTokenService {
  constructor(
    @inject(IApiTokenRepo) private readonly tokens: IApiTokenRepo,
    @inject(IClock) private readonly clock: IClock,
  ) {}

  /** The whole non-secret truth about the token: does one exist, since when, what does it end in. */
  async status(ctx: RequestContext): Promise<ApiTokenStatusView | null> {
    const row = await this.tokens.findByUser(ctx.userId);
    return row ? { createdAt: row.createdAt, last4: row.last4 } : null;
  }

  /**
   * Create the token, or replace the one that exists — one operation, because there is no state with two
   * live tokens. The returned `plaintext` is the only time it ever leaves this process.
   *
   * The caller MUST have verified the owner's password first (`me.routes.ts`). This method cannot check
   * it: it has no auth dependency, on purpose.
   */
  async create(ctx: RequestContext): Promise<ApiTokenStatusView & { plaintext: string }> {
    const plaintext = mintToken();
    const createdAt = this.clock.nowIso();
    const last4 = plaintext.slice(-4);
    await this.tokens.upsert({ userId: ctx.userId, tokenHash: await sha256Hex(plaintext), last4, createdAt });
    return { createdAt, last4, plaintext };
  }

  /** Idempotent. Revoking when nothing is active is a success that lands the UI on "nothing connected". */
  async revoke(ctx: RequestContext): Promise<void> {
    await this.tokens.deleteByUser(ctx.userId);
  }

  /**
   * The `/mcp` gate. Turns a bearer string into the owner's `userId`, or refuses.
   *
   * Every refusal is the SAME `INVALID_API_TOKEN` with the same message, whatever went wrong — wrong
   * prefix, wrong length, no row, revoked row. An attacker learns nothing from the difference between
   * "malformed" and "not found", and there is no path here that returns a partial success.
   *
   * The prefix and length checks are a cheap reject for garbage, not a security boundary; the boundary is
   * the hash lookup plus the constant-time compare below it.
   */
  async resolveOwner(rawToken: string): Promise<string> {
    const refuse = () => new DomainError('INVALID_API_TOKEN', 'the agent access token is not valid');
    const token = rawToken.trim();
    if (!token.startsWith(API_TOKEN_PREFIX) || token.length < API_TOKEN_PREFIX.length + 20) throw refuse();

    const hash = await sha256Hex(token);
    const row = await this.tokens.findByHash(hash);
    // The lookup already matched on the hash, so this compare is belt-and-braces — but it is the line
    // that stays correct if `findByHash` is ever reimplemented as a scan rather than an indexed seek.
    if (!row || !timingSafeEqual(row.tokenHash, hash)) throw refuse();
    return row.userId;
  }
}
