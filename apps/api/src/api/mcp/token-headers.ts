import { OAuthError, OAuthErrorCode, bearerAuthChallengeResponse } from '@modelcontextprotocol/server';

/**
 * Where the presented token is read from — ONE place, feeding ONE verification path.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────────────────────────
 * Claude web's MCP connector UI does not offer `Authorization`. It lets the user pick exactly one
 * header name out of a fixed list of seven, and sends the raw token as its value — no `Bearer` scheme,
 * no OAuth. A server that only reads `Authorization` is unreachable from that UI no matter what the
 * user types. So these seven names are accepted as ALIASES for the same credential.
 *
 * ── What this file deliberately does NOT do ──────────────────────────────────────────────────────
 * It does not verify anything. It resolves "the token this request presents" into a normal
 * `Authorization: Bearer …` request and hands that to the SDK's own `requireBearerAuth` gate, which
 * stays the only code that parses a scheme, calls the verifier, enforces scopes, checks `expiresAt`
 * and builds the 401. A second verification path is how two ways of authenticating end up disagreeing
 * about what a valid token is.
 *
 * ── `Authorization` is untouched ─────────────────────────────────────────────────────────────────
 * When no alias header is present — the case for Claude Code, the CLI, `curl` and every standard MCP
 * client — this returns the ORIGINAL request, byte for byte. The alias support cannot regress the
 * path that already works, because on that path it does not run.
 */

/**
 * The seven header names Claude web's connector UI offers, lowercased (HTTP header names are
 * case-insensitive and `Headers.get` folds case, so these are the canonical lookup keys).
 *
 * This list is the UI's, not ours: it is fixed by the client, so adding to it is pointless and
 * removing from it breaks whichever option a user has already selected.
 */
export const API_KEY_HEADERS = [
  'x-api-key',
  'api-key',
  'apikey',
  'x-apikey',
  'x-api-token',
  'api-token',
  'x-auth-token',
] as const;

/**
 * All seven are equally correct, and `AgentAccess` deliberately names none of them. Recommending one
 * would imply the other six are wrong — the opposite of true — and would go stale the moment Claude
 * web's list changes. Whatever a client offers is fine; that is the whole point of the alias set.
 */

/** `Bearer gcm_…` → `gcm_…`. Case-insensitive, and tolerant of the whitespace a proxy config adds. */
function stripBearer(raw: string): string {
  return raw.trim().replace(/^bearer\s+/i, '').trim();
}

/**
 * Every distinct token value presented through the alias headers.
 *
 * A repeated header arrives from `Headers` joined by `, `, so each value is split before it is read —
 * otherwise two identical `api-key` headers would look like one token containing a comma. The token
 * alphabet is base64url, which has no comma in it, so splitting cannot damage a real value.
 */
function aliasTokens(headers: Headers): string[] {
  const seen = new Set<string>();
  for (const name of API_KEY_HEADERS) {
    const raw = headers.get(name);
    if (raw === null) continue;
    for (const part of raw.split(',')) {
      const token = stripBearer(part);
      if (token) seen.add(token);
    }
  }
  return [...seen];
}

/**
 * Refusing conflicting credentials, rather than picking one.
 *
 * A proxy or a connector config that still carries a replaced token, alongside a header that carries
 * the current one, is a real and unglamorous situation. Silently preferring either header produces a
 * 401 (or, worse, a success) that the owner cannot explain from anything they can see. Saying "you
 * sent two different tokens" costs one sentence and ends the investigation.
 *
 * This is not a token oracle: it is a fact about the SHAPE of the request, decided before any value is
 * compared against anything stored, so it reveals nothing about whether either token is real.
 */
const CONFLICT =
  'Conflicting credentials: this request presents more than one different token across Authorization and the api-key headers. Send exactly one.';

export type PresentedToken = { ok: true; request: Request } | { ok: false; response: Response };

/**
 * Resolve the credential this request presents into a request the SDK's bearer gate understands.
 *
 * - No alias header → the original request, unchanged. The `Authorization` path is not re-parsed, not
 *   re-formatted and not second-guessed; a malformed one still earns the SDK's own format message.
 * - Alias only → a synthetic request carrying `Authorization: Bearer <token>`. Nothing but headers is
 *   read from it.
 * - Both, agreeing → the original request.
 * - Two different tokens, however they were spelled → refused, in the SDK's own 401 shape.
 */
export function resolvePresentedToken(req: Request): PresentedToken {
  const aliases = aliasTokens(req.headers);
  if (aliases.length === 0) return { ok: true, request: req };

  // `requireBearerAuth` reads `(authorization ?? '').split(',')[0]`. Read it the same way, so "what the
  // gate would have seen" and "what we compare against" cannot drift apart.
  const authorization = (req.headers.get('authorization') ?? '').split(',')[0]?.trim() ?? '';

  if (aliases.length > 1) return refuse();

  const alias = aliases[0]!;
  if (!authorization) {
    return {
      ok: true,
      // Headers only — the gate reads `authorization` and nothing else, and the real request's body is
      // left untouched for `handler.fetch` further down.
      request: new Request(req.url, { method: req.method, headers: { authorization: `Bearer ${alias}` } }),
    };
  }

  // Both present. A non-Bearer `Authorization` counts as a different credential rather than as noise to
  // be ignored: ignoring it is exactly the silent preference this refusal exists to prevent.
  const bearer = /^bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim();
  return bearer === alias ? { ok: true, request: req } : refuse();
}

function refuse(): { ok: false; response: Response } {
  // The SDK's own challenge builder, so the body and the `WWW-Authenticate: Bearer` header are the
  // shape every MCP client already knows how to read.
  return { ok: false, response: bearerAuthChallengeResponse(new OAuthError(OAuthErrorCode.InvalidToken, CONFLICT)) };
}
