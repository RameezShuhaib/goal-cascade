import { MCP_PATH } from '@goal-cascade/shared';
import { describe, expect, it } from 'vitest';
// Vite inlines the file's text, so this reads the REAL config — no fs in workerd needed.
import wranglerRaw from '../../wrangler.jsonc?raw';
import appRaw from '../../src/api/app.ts?raw';
import { createTestApp } from '../helpers/app';

/**
 * The `/mcp` wiring alarm — the same convention as `no-real-email.test.ts`.
 *
 * Both facts below are invisible when they break, which is exactly why they get a test rather than a
 * comment:
 *
 *  1. **`run_worker_first` must cover `/mcp`.** Without it the static-asset router owns the path and
 *     `not_found_handling: "single-page-application"` answers `index.html` with a 200. The Worker never
 *     runs. Every MCP client reports something like "invalid JSON" or "unexpected token <", which is
 *     nothing like the cause, and nothing in the source tree looks wrong.
 *  2. **The route must be registered ABOVE the `/api/*` session guard.** `requireSession` demands a
 *     Better Auth cookie and an external agent has a bearer token; below that line every MCP request
 *     401s with no hint that the ORDER is the problem.
 */
describe('the /mcp endpoint is wired so it can actually run', () => {
  it('wrangler.jsonc lists "/mcp" in assets.run_worker_first', () => {
    const assets = /"run_worker_first"\s*:\s*\[([^\]]*)\]/.exec(wranglerRaw);
    expect(assets, 'assets.run_worker_first is missing from wrangler.jsonc entirely').not.toBeNull();
    const entries = assets![1]!.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
    expect(
      entries,
      'the SPA asset router will serve index.html at /mcp and the Worker will never run — add "/mcp" to assets.run_worker_first',
    ).toContain(MCP_PATH);
  });

  it('wrangler.jsonc records that goals.rameezshuhaib.com is dashboard-managed and NOT reproduced here', () => {
    // A fresh deploy from a clean checkout will not recreate the custom domain. That has to be written
    // down where the person running the deploy will see it, or it is discovered as an outage.
    expect(wranglerRaw).toMatch(/goals\.rameezshuhaib\.com/);
    expect(wranglerRaw).toMatch(/custom domain/i);
  });

  it('wrangler.jsonc declares NO `routes` block — the working custom domain must not be disturbed', () => {
    // `routes` and a dashboard-managed custom domain are two mechanisms for one hostname. Declaring
    // one here while the other exists is how a working route is replaced by a broken one on deploy.
    expect(wranglerRaw).not.toMatch(/^\s*"routes"\s*:/m);
  });

  it('app.ts registers /mcp BEFORE the /api/* session guard', () => {
    const mount = appRaw.indexOf('app.route(MCP_PATH, mcpRoutes)');
    const guard = appRaw.indexOf('requireSession, resolveTimezone');
    expect(mount, '/mcp is not mounted in app.ts at all').toBeGreaterThan(-1);
    expect(guard, 'the /api/* session guard moved or was renamed — re-check this assertion').toBeGreaterThan(-1);
    expect(mount, '/mcp is mounted BELOW the session guard, so every MCP request will 401').toBeLessThan(guard);
  });

  it('/mcp is not swallowed by the SPA not-found fallback', async () => {
    const t = createTestApp();
    // No token: the route must answer the MCP bearer challenge, NOT the SPA and NOT `route not found`.
    const res = await t.fetch(MCP_PATH, { method: 'POST', json: {} });
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate') ?? '', 'the MCP bearer challenge is missing').toMatch(/Bearer/i);
    expect(res.headers.get('Content-Type') ?? '').not.toMatch(/text\/html/);
  });

  it('GET /mcp is answered by the Worker (405), never by index.html', async () => {
    const t = createTestApp();
    const res = await t.fetch(MCP_PATH, { method: 'GET' });
    // The 2026-07-28 revision removed the standalone GET SSE stream. Anything other than HTML here
    // proves the Worker ran; 200 text/html would mean the asset router won.
    expect(res.headers.get('Content-Type') ?? '').not.toMatch(/text\/html/);
    expect([401, 405]).toContain(res.status);
  });

  it('there is no /sse endpoint — the 2024-11-05 transport is deprecated and must not be adopted', async () => {
    const t = createTestApp();
    for (const path of ['/sse', '/mcp/sse', '/message']) {
      const res = await t.fetch(path, { method: 'POST', json: {} });
      expect(res.status, path).toBe(404);
    }
  });
});
