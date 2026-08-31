import { API_TOKEN_PREFIX, ENDPOINTS, MCP_PATH, API_BASE } from '@goal-cascade/shared';
import { expect } from 'vitest';
import { PASSWORD, type TestApp } from '../helpers/app';

export const PROTOCOL_VERSION = '2026-07-28';

/**
 * Speak Streamable HTTP the way a real client does.
 *
 * The 2026-07-28 revision is STATELESS: there is no handshake, so one POST is a complete interaction.
 * It is also strict about mirrored headers — `MCP-Protocol-Version` must match the value inside
 * `_meta`, and `Mcp-Name` must equal `params.name` — or the server answers `400 / -32020 HeaderMismatch`
 * before any handler runs. Getting those wrong is the most likely reason a hand-rolled `curl` fails, so
 * this helper builds them from the arguments rather than letting a caller type them twice.
 */
export async function mcp(
  t: TestApp,
  token: string | null,
  method: string,
  params: Record<string, unknown> = {},
): Promise<Response> {
  const name = typeof params.name === 'string' ? params.name : typeof params.uri === 'string' ? params.uri : undefined;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': PROTOCOL_VERSION,
    'Mcp-Method': method,
    ...(name ? { 'Mcp-Name': name } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  return t.fetch(MCP_PATH, {
    method: 'POST',
    headers,
    json: {
      jsonrpc: '2.0',
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION,
          'io.modelcontextprotocol/clientInfo': { name: 'vitest', version: '1.0.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    },
  });
}

/** A JSON-RPC response body, whether it arrived as JSON or inside a one-shot SSE stream. */
export async function rpc(res: Response): Promise<{ result?: any; error?: { code: number; message: string } }> {
  const text = await res.text();
  if ((res.headers.get('Content-Type') ?? '').includes('text/event-stream')) {
    const line = text.split('\n').find((l) => l.startsWith('data:'));
    return JSON.parse(line!.slice(5).trim());
  }
  return JSON.parse(text);
}

/** Call one tool and return its parsed payload plus whether the server flagged it as an error. */
export async function callTool(
  t: TestApp,
  token: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ isError: boolean; payload: any; raw: any }> {
  const body = await rpc(await mcp(t, token, 'tools/call', { name, arguments: args }));
  if (body.error) throw new Error(`${name} produced a PROTOCOL error, not a tool result: ${JSON.stringify(body.error)}`);
  const result = body.result;
  const text = result?.content?.[0]?.text ?? '';
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }
  return { isError: result?.isError === true, payload, raw: result };
}

/** A tool call that must succeed. Fails loudly with the agent-facing error text when it does not. */
export async function ok(t: TestApp, token: string, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const r = await callTool(t, token, name, args);
  expect(r.isError, `${name} failed: ${JSON.stringify(r.payload)}`).toBe(false);
  return r.payload;
}

/** A tool call that must be refused, with the code the product promises. */
export async function refused(
  t: TestApp,
  token: string,
  name: string,
  args: Record<string, unknown>,
  code: string,
): Promise<any> {
  const r = await callTool(t, token, name, args);
  expect(r.isError, `${name} unexpectedly SUCCEEDED: ${JSON.stringify(r.payload)}`).toBe(true);
  expect(r.payload.code, `${name} refused with the wrong code: ${JSON.stringify(r.payload)}`).toBe(code);
  return r.payload;
}

/** Mint the owner's one agent-access token through the real endpoint, password and all. */
export async function mintToken(t: TestApp, cookie: string): Promise<string> {
  const res = await t.fetch(`${API_BASE}${ENDPOINTS.meApiToken}`, {
    method: 'POST',
    cookie,
    idempotencyKey: crypto.randomUUID(),
    json: { password: PASSWORD },
  });
  if (res.status !== 201) throw new Error(`mint failed ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { token: { plaintext: string } };
  expect(body.token.plaintext.startsWith(API_TOKEN_PREFIX)).toBe(true);
  return body.token.plaintext;
}
