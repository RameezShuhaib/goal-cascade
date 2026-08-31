import { API_BASE, API_TOKEN_PREFIX, ENDPOINTS, MCP_PATH } from '@goal-cascade/shared';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { DB } from '../../src/application/services/guarded-batch';
import { sha256Hex } from '../../src/application/services/api-token.service';
import type { Db } from '../../src/infrastructure/persistence/db';
import { apiTokens } from '../../src/infrastructure/persistence/schema';
import { PASSWORD, createTestApp, signedInOwner, type TestApp } from '../helpers/app';
import { mcp, mintToken, rpc } from './helpers';

/**
 * A token that was genuinely issued and then revoked — the closest a wrong guess can get to a real one.
 *
 * It belongs to its OWN fresh owner on purpose: minting for the account under test would replace that
 * account's live token (creating replaces, always), and the revocation would then kill the credential
 * the rest of the suite is using.
 */
async function revokedToken(app: TestApp): Promise<string> {
  const other = await signedInOwner(app);
  const dead = await mintToken(app, other.cookie);
  await app.fetch(`${API_BASE}${ENDPOINTS.meApiToken}`, { method: 'DELETE', cookie: other.cookie });
  return dead;
}

const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });

/**
 * The agent-access token: the credential behind `/mcp`.
 *
 * It is the most powerful thing in this product — no expiry, no session, full read and write on the
 * whole account — so the properties below are the ones that actually keep it safe, and each is asserted
 * against real behaviour rather than against a comment.
 */
describe('the one agent-access token', () => {
  let cookie: string;
  let userId: string;
  beforeAll(async () => {
    const owner = await signedInOwner(t);
    cookie = owner.cookie;
    userId = owner.userId;
  });

  const status = async (c = cookie) =>
    (await t.fetch(`${API_BASE}${ENDPOINTS.meApiToken}`, { cookie: c })).json() as Promise<{
      token: { createdAt: string; last4: string } | null;
      mcpUrl: string;
    }>;

  const create = async (password: string, c = cookie) =>
    t.fetch(`${API_BASE}${ENDPOINTS.meApiToken}`, {
      method: 'POST',
      cookie: c,
      idempotencyKey: crypto.randomUUID(),
      json: { password },
    });

  it('status needs no password, and never returns the plaintext', async () => {
    const before = await status();
    expect(before.token).toBeNull();
    // The URL is readable in BOTH states, which is the UX doc's one hard requirement: the non-secret
    // half of an agent config must be recoverable without replacing a working token.
    expect(before.mcpUrl).toMatch(new RegExp(`${MCP_PATH}$`));

    await mintToken(t, cookie);
    const after = await status();
    expect(after.token).not.toBeNull();
    expect(after.token!.last4).toHaveLength(4);
    // Whatever else the status body carries, no field of it may be a usable token.
    expect(JSON.stringify(after)).not.toContain(API_TOKEN_PREFIX);
  });

  it('creating requires the CORRECT password', async () => {
    const wrong = await create('not the real password');
    expect(wrong.status).toBe(422);
    const body = (await wrong.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    // The same sentence `change-password` returns, so the pair cannot become a password oracle.
    expect(body.error.message).toBe('the current password is not correct');

    const right = await create(PASSWORD);
    expect(right.status).toBe(201);
  });

  it('a wrong password creates NOTHING — the previous token keeps working', async () => {
    const token = await mintToken(t, cookie);
    expect((await mcp(t, token, 'tools/list')).status).toBe(200);

    expect((await create('wrong')).status).toBe(422);
    expect((await mcp(t, token, 'tools/list')).status, 'a failed create disturbed the live token').toBe(200);
  });

  it('the stored value is a HASH — the row cannot authenticate on its own', async () => {
    const token = await mintToken(t, cookie);
    const db = t.container().resolve<Db>(DB);
    const rows = await db.select().from(apiTokens).where(eq(apiTokens.userId, userId));

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    // The plaintext appears nowhere in the row, in any column.
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.tokenHash).not.toBe(token);
    // …and it is specifically SHA-256 of the plaintext, which is what makes the lookup possible at all.
    expect(row.tokenHash).toBe(await sha256Hex(token));
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.last4).toBe(token.slice(-4));
  });

  it('creating REPLACES: the old token stops working immediately', async () => {
    const first = await mintToken(t, cookie);
    expect((await mcp(t, first, 'tools/list')).status).toBe(200);

    const second = await mintToken(t, cookie);
    expect(second).not.toBe(first);
    expect((await mcp(t, first, 'tools/list')).status, 'the REPLACED token still authenticates').toBe(401);
    expect((await mcp(t, second, 'tools/list')).status).toBe(200);

    // Exactly one row, always — "two live tokens" is not a representable state.
    const db = t.container().resolve<Db>(DB);
    expect(await db.select().from(apiTokens).where(eq(apiTokens.userId, userId))).toHaveLength(1);
  });

  it('the token format is prefixed and high-entropy', async () => {
    const a = await mintToken(t, cookie);
    const b = await mintToken(t, cookie);
    expect(a.startsWith(API_TOKEN_PREFIX)).toBe(true);
    // 32 random bytes → 43 base64url chars. Greppable prefix, unguessable body.
    expect(a.length).toBeGreaterThanOrEqual(API_TOKEN_PREFIX.length + 40);
    expect(a.slice(API_TOKEN_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
  });

  it('revoke needs no password, is idempotent, and kills the token', async () => {
    const token = await mintToken(t, cookie);
    const revoke = () => t.fetch(`${API_BASE}${ENDPOINTS.meApiToken}`, { method: 'DELETE', cookie });

    const first = await revoke();
    expect(first.status).toBe(200);
    expect((await first.json() as { revoked: boolean }).revoked).toBe(true);
    expect((await mcp(t, token, 'tools/list')).status).toBe(401);
    expect((await status()).token).toBeNull();

    // Idempotent: revoking when nothing is active succeeds silently.
    const second = await revoke();
    expect(second.status).toBe(200);
    expect((await second.json() as { revoked: boolean }).revoked).toBe(true);
    expect((await status()).token).toBeNull();
  });

  it('all three endpoints are behind the session gate', async () => {
    for (const [method, json] of [
      ['GET', undefined],
      ['POST', { password: PASSWORD }],
      ['DELETE', undefined],
    ] as const) {
      const res = await t.fetch(`${API_BASE}${ENDPOINTS.meApiToken}`, {
        method,
        idempotencyKey: crypto.randomUUID(),
        ...(json ? { json } : {}),
      });
      expect(res.status, `${method} reachable without a session`).toBe(401);
    }
  });
});

describe('/mcp bearer authentication', () => {
  let cookie: string;
  let token: string;
  beforeAll(async () => {
    cookie = (await signedInOwner(t)).cookie;
    token = await mintToken(t, cookie);
  });

  it('no token → 401 with the bearer challenge an MCP client can read', async () => {
    const res = await mcp(t, null, 'tools/list');
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate') ?? '').toMatch(/Bearer/i);
  });

  it('a malformed token → 401, and every WRONG token looks identical', async () => {
    const bodies = new Set<string>();
    for (const bad of [
      'garbage', // not even the prefix
      'gcm_', // prefix only
      `${API_TOKEN_PREFIX}short`, // prefix, too short
      `${API_TOKEN_PREFIX}${'A'.repeat(43)}`, // right shape, wrong value — no such row
      token.slice(0, -1), // one character off the real one
      `${token}x`, // the real one with a character appended
      await revokedToken(t), // correct shape, correct entropy, genuinely issued, revoked
    ]) {
      const res = await mcp(t, bad, 'tools/list');
      expect(res.status, `"${bad}" was accepted`).toBe(401);
      bodies.add(await res.text());
    }
    // ONE answer for every one of them. An attacker learns nothing from the difference between
    // "malformed", "no such token", "off by one character" and "revoked" — including whether a guess
    // was structurally closer than the last.
    expect(bodies.size, 'the 401 body differs between failure modes — that is an oracle').toBe(1);
  });

  it('an absent header is refused too, and says so plainly', async () => {
    // This one legitimately differs: "you sent no credential" is not a fact about any token value, and
    // an MCP client needs to be able to tell it apart from "your credential is wrong".
    const res = await mcp(t, null, 'tools/list');
    expect(res.status).toBe(401);
    expect(await res.text()).toMatch(/Missing Authorization header/);
  });

  it('a session cookie is NOT accepted at /mcp, and a token is NOT accepted at /api', async () => {
    // The two credentials are separate on purpose; neither is a way around the other's guard.
    const cookieAtMcp = await t.fetch(MCP_PATH, { method: 'POST', cookie, json: {} });
    expect(cookieAtMcp.status).toBe(401);

    const tokenAtApi = await t.fetch(`${API_BASE}${ENDPOINTS.me}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(tokenAtApi.status).toBe(401);
  });

  it('a valid token reaches the tools, and they see the RIGHT user', async () => {
    const list = await rpc(await mcp(t, token, 'tools/list'));
    expect(list.result.tools.length).toBeGreaterThan(0);

    const body = await rpc(await mcp(t, token, 'tools/call', { name: 'get_account', arguments: {} }));
    const account = JSON.parse(body.result.content[0].text);
    const me = (await (await t.fetch(`${API_BASE}${ENDPOINTS.me}`, { cookie })).json()) as { user: { id: string; email: string } };
    expect(account.user.id).toBe(me.user.id);
    expect(account.user.email).toBe(me.user.email);
  });

  it('a request with no Origin header is allowed — a non-browser client sends none', async () => {
    // The spec requires validating Origin when PRESENT; its absence is not a claim about anything, and
    // refusing it would lock out every real MCP client.
    expect((await mcp(t, token, 'tools/list')).status).toBe(200);
  });
});
