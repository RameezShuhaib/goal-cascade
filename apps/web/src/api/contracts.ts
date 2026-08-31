import { z } from 'zod';

/**
 * ASSUMED BACKEND CONTRACTS — the endpoints this web build was written against **before they existed**.
 *
 * Everything else the client talks to is described by a shared Zod schema in `@goal-cascade/shared`, and
 * `api/http.ts` parses every response with the schema the server was built from — so a drift is a loud
 * `BAD_RESPONSE` rather than a screen quietly rendering `undefined`. These two features were built in
 * parallel with the API that serves them, so there was no shared schema to import yet. Rather than invent
 * one under `packages/shared/` (owned by the API agent at the time, and a guaranteed conflict), the paths
 * and shapes are written down HERE, once.
 *
 * **When the real endpoints land, this is the only file that has to change.** Delete a schema, import the
 * shared one in its place, and the four methods in `api/http.ts` that reference them keep working. Nothing
 * in `api/queries.ts`, in `components/AgentAccess.tsx` or in `components/GoalModals.tsx` names a path or a
 * field that is not re-exported from here.
 *
 * See `docs/work/12-web-agent-access/build.md` for the assumption list and how each one was arrived at.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Agent access — one API token per account, hash-only, shown once
// ─────────────────────────────────────────────────────────────────────────────

export const ASSUMED_ENDPOINTS = {
  /**
   * `GET` = status (no password) · `POST` = create-or-replace (password) · `DELETE` = revoke (idempotent).
   *
   * Sits under `/me` because it is a property of the signed-in account, like `/me/preferences` and
   * `/me/change-password` — both of which are already in the shared `ENDPOINTS` map at that prefix.
   */
  agentToken: '/me/agent-token',
} as const;

/**
 * The MCP endpoint's path on this deployment's own origin. Used only when the status response does not
 * name an absolute `mcpUrl` — the hostname is NEVER written down in the client (a build pinned to
 * `goals.rameezshuhaib.com` is a build that shows the wrong URL in dev and in preview).
 */
export const MCP_PATH = '/mcp';

/** What a status read may say about the token that exists. Never the token itself — it is hash-only. */
export const AgentTokenSummary = z.object({
  createdAt: z.string().min(1),
  /** The last four characters of the plaintext, so a person can tell one token from another. */
  last4: z.string().min(1),
});
export type AgentTokenSummary = z.infer<typeof AgentTokenSummary>;

/** `GET /me/agent-token`. `token: null` means there is none — that is a state, not an error. */
export const AgentTokenStatusResponse = z.object({
  token: AgentTokenSummary.nullable(),
  /** Absolute URL of this deployment's MCP endpoint, if the server names one. */
  mcpUrl: z.string().optional(),
});
export type AgentTokenStatusResponse = z.infer<typeof AgentTokenStatusResponse>;

/**
 * `POST /me/agent-token` — create or replace. The plaintext comes back HERE and nowhere else, ever.
 *
 * `createdAt` and `last4` are optional on purpose. If the server answers with the secret and nothing else,
 * a schema that insisted on the metadata would throw `BAD_RESPONSE` and destroy the one copy of a token
 * that has already been written to the database — the single worst failure this screen can have. The
 * component derives `last4` from the plaintext when it is missing.
 */
export const AgentTokenCreatedResponse = z.object({
  token: z.string().min(1),
  createdAt: z.string().min(1).optional(),
  last4: z.string().min(1).optional(),
  mcpUrl: z.string().optional(),
});
export type AgentTokenCreatedResponse = z.infer<typeof AgentTokenCreatedResponse>;

/** `DELETE /me/agent-token` — idempotent, so revoking twice is a success, not a 404. */
export const AgentTokenRevokedResponse = z.object({ deleted: z.boolean() });

// ─────────────────────────────────────────────────────────────────────────────
// Goal deletion — what a delete would destroy, without destroying it
// ─────────────────────────────────────────────────────────────────────────────

const Count = z.int().nonnegative();

/** Q-5's three numbers: `N sub-goals, M tasks, K backlog items`. */
export const GoalDeletePreview = z.object({ subGoals: Count, tasks: Count, backlogItems: Count });
export type GoalDeletePreview = z.infer<typeof GoalDeletePreview>;

/**
 * `DELETE /goals/:id?dryRun=true` — the counts, with nothing removed.
 *
 * Three shapes are accepted, because the endpoint did not exist when this was written and all three are
 * plausible readings of "returns those counts":
 *
 *  1. the counts at the top level — the shape the `GOAL_HAS_CHILDREN` refusal already puts in `details`,
 *     and therefore the likeliest;
 *  2. nested under `counts`;
 *  3. the existing `DeleteGoalResponse` shape with nothing deleted — natural if the route reuses its own
 *     response schema. `removed.goals` counts the goal itself, so the sub-goal count is one less.
 *
 * This is tolerance about SHAPE only. A response that carries none of the three still fails loudly, and
 * the delete sheet falls back to the `GOAL_HAS_CHILDREN` refusal it has always handled.
 */
export const GoalDeletePreviewResponse = z.union([
  GoalDeletePreview,
  z.object({ counts: GoalDeletePreview }).transform((v) => v.counts),
  z
    .object({ removed: z.object({ goals: Count, tasks: Count, backlogItems: Count }) })
    .transform((v) => ({ subGoals: Math.max(0, v.removed.goals - 1), tasks: v.removed.tasks, backlogItems: v.removed.backlogItems })),
]);

/** True when a delete would destroy anything at all — the whole test for "does this need confirming?". */
export const destroysSomething = (c: GoalDeletePreview): boolean => c.subGoals + c.tasks + c.backlogItems > 0;
