import { McpServer } from '@modelcontextprotocol/server';
import { SERVER_INSTRUCTIONS } from './instructions';
import { registerPrompts } from './prompts';
import { registerResources } from './resources';
import type { McpDeps } from './shapes';
import { registerAccountTools } from './tools/account';
import { registerBacklogTools } from './tools/backlog';
import { registerCaptureTools } from './tools/capture';
import { registerGoalTools } from './tools/goals';
import { registerTaskTools } from './tools/tasks';

export const MCP_SERVER_NAME = 'goal-cascade';
export const MCP_SERVER_VERSION = '1.0.0';

/**
 * ONE factory, closed over the owner context resolved from the verified bearer token.
 *
 * ── Why the closure is the whole security design ─────────────────────────────────────────────────
 * No tool on this surface takes a user id. `deps.ctx.userId` is captured here, once, from the token
 * lookup in `mcp.routes.ts`, and every service call below receives that same `ctx` — exactly as an
 * `/api/*` handler receives the one built by `requireSession`. A tool therefore CANNOT forget to scope,
 * because scoping is not something a tool does; and no tool ARGUMENT can be made to point at another
 * account, because there is no argument that carries a scope.
 *
 * The repositories close the loop: every owner-scoped read takes `userId` explicitly and every index
 * leads with it (`application/ports/repositories.ts`), so another owner's entity is refused identically
 * to a non-existent one (R-auth-3). `tests/mcp/scoping.test.ts` proves this end-to-end by creating a
 * second user directly in the database and driving user A's token at every id-taking tool.
 *
 * ── Why it is built per request ──────────────────────────────────────────────────────────────────
 * The MCP protocol has been stateless since 2026-07-28: one POST is one complete interaction, so a
 * per-request instance is the natural unit and matches this repo's "one child container per request"
 * model. The alternative — a module-scope handler with the userId smuggled through `authInfo.extra` —
 * would need the D1 binding reached some other way, and its only advantage (`handler.notify` for
 * list-changed pushes) is a feature this server does not offer.
 */
export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    {
      // The single highest-leverage string in this feature: it is what teaches a connecting agent the
      // five horizons, that only Weekly goals hold tasks, the period and week models, carrying, and the
      // three task exits. ⚠ A2 rewrote it in full — see `instructions.ts` for what became false.
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  registerGoalTools(server, deps);
  registerTaskTools(server, deps);
  registerBacklogTools(server, deps);
  registerCaptureTools(server, deps);
  registerAccountTools(server, deps);

  registerResources(server, deps);
  registerPrompts(server);

  return server;
}
