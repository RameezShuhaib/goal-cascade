import { API_BASE, ENDPOINTS, MCP_PATH } from '@goal-cascade/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { API_KEY_HEADERS } from '../../src/api/mcp/token-headers';
import { createTestApp, signedInOwner, type TestApp } from '../helpers/app';
import { PROTOCOL_VERSION, mintToken, rpc } from './helpers';

/**
 * Reaching `/mcp` from a BROWSER — specifically Claude web's MCP connector.
 *
 * Two independent things stop it, and fixing either alone changes nothing:
 *
 *  1. **The header name.** The connector UI does not offer `Authorization`. It makes the user pick one
 *     name from a fixed list of seven api-key spellings and sends the raw token as its value. A server
 *     that reads only `Authorization` cannot be configured from that UI at all.
 *  2. **CORS.** It is a page making a cross-origin request, so the preflight has to be answered with an
 *     `Access-Control-Allow-Origin` and an `Access-Control-Allow-Headers` naming every header the
 *     protocol sends. Production answered the preflight `204` with neither, and the connector failed
 *     with nothing in it about why.
 *
 * The security property this file is really here to pin is the LAST test: `/mcp` must never send
 * `Access-Control-Allow-Credentials`. The token is put on the request by hand; an ambient cookie
 * attached cross-origin would buy nothing and would make every page on an allowed origin a CSRF gun.
 */

const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });

/** `tools/list`, with whatever auth headers the caller wants to try — including none, or several. */
function call(app: TestApp, headers: Record<string, string> | Headers, origin?: string): Promise<Response> {
  const h = new Headers(headers);
  h.set('Content-Type', 'application/json');
  h.set('Accept', 'application/json, text/event-stream');
  h.set('MCP-Protocol-Version', PROTOCOL_VERSION);
  h.set('Mcp-Method', 'tools/list');
  if (origin) h.set('Origin', origin);
  return app.fetch(MCP_PATH, {
    method: 'POST',
    headers: h,
    json: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION,
          'io.modelcontextprotocol/clientInfo': { name: 'vitest', version: '1.0.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    },
  });
}

/** The preflight a browser sends before that POST. */
function preflight(app: TestApp, origin: string, requestHeaders = 'content-type,api-key,mcp-method'): Promise<Response> {
  return app.fetch(MCP_PATH, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': requestHeaders,
    },
  });
}

const allowedHeaders = (res: Response) =>
  (res.headers.get('Access-Control-Allow-Headers') ?? '').split(',').map((s) => s.trim().toLowerCase());

describe('the token is accepted from every header name a connector UI offers', () => {
  let token: string;
  beforeAll(async () => {
    token = await mintToken(t, (await signedInOwner(t)).cookie);
  });

  // Seven names, one credential. The list is the connector UI's, not ours — it is fixed by the client,
  // so a name dropping off this list is a regression that only shows up as "it will not connect".
  for (const name of API_KEY_HEADERS) {
    it(`${name}: the raw token authenticates`, async () => {
      const res = await call(t, { [name]: token });
      expect(res.status, `${name} did not authenticate`).toBe(200);
      const body = await rpc(res);
      expect(body.result!.tools.length).toBeGreaterThan(0);
    });

    it(`${name}: a WRONG value is refused`, async () => {
      const res = await call(t, { [name]: `${token}x` });
      expect(res.status, `${name} accepted a wrong token`).toBe(401);
      expect(res.headers.get('WWW-Authenticate') ?? '').toMatch(/Bearer/i);
    });
  }

  it('`Authorization: Bearer` still works — it is what Claude Code and every CLI client sends', async () => {
    expect((await call(t, { Authorization: `Bearer ${token}` })).status).toBe(200);
    expect((await call(t, { Authorization: `Bearer ${token}x` })).status).toBe(401);
  });

  it('a `Bearer ` prefix INSIDE an api-key header is tolerated — some clients add it', async () => {
    for (const value of [`Bearer ${token}`, `bearer ${token}`, `  Bearer   ${token}  `]) {
      expect((await call(t, { 'api-key': value })).status, `"${value}" was refused`).toBe(200);
    }
  });

  it('the same token in Authorization AND an api-key header is fine — they agree', async () => {
    expect((await call(t, { Authorization: `Bearer ${token}`, 'x-api-key': token })).status).toBe(200);
  });

  it('two auth headers carrying DIFFERENT tokens are refused, not silently reconciled', async () => {
    // A stale credential left in a proxy or connector config, beside the live one. Preferring either
    // produces a 401 (or a success) the owner cannot explain from anything they can see.
    const conflicts: Record<string, string>[] = [
      { Authorization: `Bearer ${token}`, 'api-key': `${token}x` },
      { Authorization: `Bearer ${token}x`, 'api-key': token },
      { 'api-key': token, 'x-auth-token': `${token}x` },
      // A non-Bearer Authorization is a different credential too, not noise to be ignored.
      { Authorization: 'Basic Zm9vOmJhcg==', 'api-key': token },
    ];
    for (const headers of conflicts) {
      const res = await call(t, headers);
      expect(res.status, `accepted conflicting headers: ${JSON.stringify(headers)}`).toBe(401);
      expect(await res.text(), 'the refusal does not say WHY').toMatch(/Conflicting credentials/i);
    }
  });

  it('the SAME token spelled into several headers is not a conflict', async () => {
    expect((await call(t, { 'api-key': token, apikey: token, 'x-api-key': `Bearer ${token}` })).status).toBe(200);
  });

  it('an empty api-key header is not a credential — the absent-header 401 still says so', async () => {
    const res = await call(t, { 'api-key': '' });
    expect(res.status).toBe(401);
    expect(await res.text()).toMatch(/Missing Authorization header/);
  });
});

describe('CORS on /mcp — its own policy, not the app’s', () => {
  let token: string;
  beforeAll(async () => {
    token = await mintToken(t, (await signedInOwner(t)).cookie);
  });

  for (const origin of ['https://claude.ai', 'https://claude.com']) {
    it(`preflight from ${origin} is 204 with the origin echoed`, async () => {
      const res = await preflight(t, origin);
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      expect((res.headers.get('Access-Control-Allow-Methods') ?? '').toUpperCase()).toContain('POST');
    });
  }

  it('the preflight names every api-key header, or the browser will not send one', async () => {
    const allowed = allowedHeaders(await preflight(t, 'https://claude.ai'));
    for (const name of API_KEY_HEADERS) expect(allowed, `${name} is not allowed by the preflight`).toContain(name);
    expect(allowed).toContain('authorization');
  });

  it('the preflight names every MCP protocol header the SDK reads', async () => {
    // Verified against the installed `@modelcontextprotocol/server@2.0.0`: `dist/index.mjs` reads
    // exactly these off inbound requests, plus `host` and `origin`, which a page cannot set anyway.
    const allowed = allowedHeaders(await preflight(t, 'https://claude.ai'));
    for (const name of [
      'mcp-protocol-version',
      'mcp-method',
      'mcp-name',
      'mcp-session-id',
      'last-event-id',
      'content-type',
      'accept',
    ]) {
      expect(allowed, `${name} is not allowed by the preflight`).toContain(name);
    }
  });

  it('a browser can READ the headers the SDK answers with', async () => {
    const exposed = (await preflight(t, 'https://claude.ai')).headers.get('Access-Control-Expose-Headers') ?? '';
    expect(exposed.toLowerCase()).toContain('mcp-session-id');
    expect(exposed.toLowerCase()).toContain('www-authenticate');
  });

  it('a DISALLOWED origin gets no allow-origin header — and never a wildcard', async () => {
    for (const origin of ['https://claude.ai.evil.example', 'http://localhost:5173', 'null']) {
      const res = await preflight(t, origin);
      const acao = res.headers.get('Access-Control-Allow-Origin');
      expect(acao, `${origin} was allowed`).toBeNull();
    }
  });

  it('the POST that follows the preflight is answered, not 403 by the origin check', async () => {
    // The second half of the fix. CORS headers on the preflight are worth nothing if the SDK's own
    // DNS-rebinding origin validation then refuses the real request.
    const res = await call(t, { 'api-key': token }, 'https://claude.ai');
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://claude.ai');
  });

  it('an origin that is on NEITHER list is still refused outright by the origin check', async () => {
    const res = await call(t, { 'api-key': token }, 'https://evil.example');
    expect(res.status).toBe(403);
  });

  /**
   * THE security property. Asserted on every kind of `/mcp` answer, because it is the header that would
   * turn an allowed third-party origin into a CSRF surface, and it is one word away at all times.
   */
  it('Access-Control-Allow-Credentials is NEVER true on /mcp', async () => {
    const responses = [
      await preflight(t, 'https://claude.ai'),
      await preflight(t, 'https://claude.com'),
      await preflight(t, 'https://evil.example'),
      await call(t, { 'api-key': token }, 'https://claude.ai'), // 200
      await call(t, { 'api-key': 'nope' }, 'https://claude.ai'), // 401
      await call(t, {}, 'https://claude.ai'), // 401, no credential at all
    ];
    for (const res of responses) {
      expect(
        res.headers.get('Access-Control-Allow-Credentials'),
        'a cookie may now ride cross-origin to /mcp — that is a CSRF surface for no benefit',
      ).toBeNull();
    }
  });

  it('the /api/* policy is untouched: still narrow, still credentialed', async () => {
    // The two policies exist because they guard different things. Widening the cookie-authenticated one
    // is the mistake this split was made to prevent, so its behaviour is pinned here too.
    const trusted = await t.fetch(`${API_BASE}${ENDPOINTS.me}`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' },
    });
    expect(trusted.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(trusted.headers.get('Access-Control-Allow-Credentials')).toBe('true');

    // Claude web is allowed at /mcp and nowhere else.
    const claude = await t.fetch(`${API_BASE}${ENDPOINTS.me}`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://claude.ai', 'Access-Control-Request-Method': 'GET' },
    });
    expect(claude.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
