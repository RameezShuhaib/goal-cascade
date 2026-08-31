# 11 — MCP server and static-token auth

`POST /mcp` lets an external AI agent drive the owner's Goal Cascade account. **43 tools, 11 resources,
5 prompts**, behind one static bearer token.

Design inputs: `docs/research/MCP-ON-WORKERS.md` (transport, SDK, citations),
`docs/research/MCP-TOOL-SURFACE.md` (the semantic surface), `docs/research/UX-API-TOKEN.md` §7 (the
backend contract with the UI agent).

---

## 1. What shipped

### Packages

One dependency: **`@modelcontextprotocol/server@2.0.0`** in `apps/api`. Nothing else — no `agents`, no
Durable Object, no `@cloudflare/workers-oauth-provider`, no `@modelcontextprotocol/sdk`, no new
compatibility flags. The SDK bundles its Workers-safe JSON Schema validator (`@cfworker/json-schema`)
*inline* in `dist/`, so its `devDependency` status is not a runtime gap.

### The tools, as implemented

`snake_case` inputs; the server maps them onto the existing camelCase Zod request schemas from
`packages/shared`. **Every tool calls an application service** through the per-request tsyringe
container. No repository is touched directly and no domain rule is reimplemented — `create_goal` and
`move_goal` call `GoalTreeGuard` first, exactly as `goals.routes.ts` does, because the services
deliberately do not re-check the tree rules.

| Family | Tools | File |
|---|---|---|
| Discovery & goals (read) | `get_overview` `find_goal` `list_goals` `get_goal` `preview_goal_deletion` | `mcp/tools/goals.ts` |
| Goals (write) | `create_goal` `update_goal` `move_goal` `replan_goal` `delete_goal` | `mcp/tools/goals.ts` |
| Weekly plan | `get_weekly_plan` `set_goal_focus` `clear_goal_focus` `save_weekly_plan` | `mcp/tools/plan.ts` |
| Tasks | `list_tasks` `get_task` `create_task` `update_task` `complete_task` `uncheck_task` `move_task_to_backlog` `cancel_task` `add_task_link` `remove_task_link` | `mcp/tools/tasks.ts` |
| Backlog | `list_backlog` `create_backlog_item` `update_backlog_item` `move_backlog_item` `delete_backlog_item` `convert_backlog_item_to_task` | `mcp/tools/backlog.ts` |
| Ideas | `list_ideas` `capture_idea` `attach_idea_to_goal` `convert_idea_to_task` `delete_idea` | `mcp/tools/capture.ts` |
| Learnings | `list_learnings` `capture_learning` `update_learning` `attach_learning_to_goal` `discard_learning` | `mcp/tools/capture.ts` |
| Account | `get_account` `update_preferences` `change_password` | `mcp/tools/account.ts` |

42 from the design, plus `change_password` which the owner added by overruling the design's rail 2.

**Resources** (11): `goalcascade://tree`, `tree/outline`, `week/current`, `week/{week_start}` (a
template), `backlog`, `ideas`, `learnings`, `account`, `rules/business-rules`, `rules/errors`,
`rules/week-model`.

**Prompts** (5): `plan_the_week`, `review_the_carry`, `triage_the_backlog`, `process_ideas`,
`goal_health_check` — reproduced from the design document, including the constraint line each one ends
with ("Do not create, complete, or cancel any task…", "Never offer to defer, snooze, reschedule…").

**The server instructions block** is `MCP-TOOL-SURFACE.md` §5 **verbatim**, in
`mcp/instructions.ts`. `tests/mcp/verbatim.test.ts` extracts §5 from the document at build time and
asserts byte equality, so the copy cannot drift. Note that it is served on **`server/discover`**, not
`initialize` (see §4).

### Owner's overrides, as built

- **No guardrails.** `delete_goal` takes no preview call and no echoed counts — just `cascade` when the
  goal has descendants, which is the API's own existing guard. `save_weekly_plan` takes no
  `confirm_deactivations`; it *reports* `activated` / `deactivated` afterwards instead, so the agent can
  still tell the user what it stood down. `change_password` is exposed.
- **`preview_goal_deletion` ships as an optional read-only capability**, not a gate.
- **Exactly one token**, replaceable, password required to create or replace.
- **No `snippet` field.** The status read returns `mcpUrl` and the token summary, nothing more.

---

## 2. New backend work

**`DELETE /goals/:id?dryRun=true`** → `GoalService.remove(ctx, id, { cascade, dryRun: true })`.

It runs the entire read phase — same subtree walk, same five queries — then returns the existing
`DeleteGoalResponse` shape with `deleted: false` and writes nothing. Two things it does that the live
delete does not:

1. **It emits counts for LEAF goals.** The `GOAL_HAS_CHILDREN` guard only fires when
   `descendants.size > 0`, so deleting a leaf carrying forty open tasks and a full backlog previously
   succeeded on the first call with no counts and no warning. The most dangerous delete in the product
   was the one with no preview.
2. **It pays for one extra query** (`taskEvents.listByTasks`) to report `task_events`. "11 tasks"
   understates the loss when those tasks carry 63 timeline entries that vanish with them. Only the dry
   run pays it; the real delete already needs the ids.

No new route, no new response schema — the design's own recommendation (open question #1).

---

## 3. Auth and scoping

### The token

`api_tokens` (`schema.ts`), migration `0001_busy_mentor.sql`:

```
user_id    TEXT PRIMARY KEY  → user(id) ON DELETE CASCADE
token_hash TEXT NOT NULL     -- sha256Hex(plaintext). UNIQUE INDEX ux_api_tokens_hash
last4      TEXT NOT NULL
created_at TEXT NOT NULL
```

- **`user_id` is the primary key.** "Exactly one token, creating replaces it" is a database constraint,
  not a property the service hopes for — `upsert` is a single `onConflictDoUpdate`, so there is no
  window in which two hashes are present and no code path that could insert a second row.
- **Only a hash is stored.** `sha256Hex` — the same primitive `api/middleware/idempotency.ts` uses for
  request hashes and the same shape Better Auth gives reset tokens under
  `verification: { storeIdentifier: 'hashed' }`. Checked, not invented. A plain unsalted digest is
  correct here and would be wrong for a password: the input is 256 bits of CSPRNG output, so there is no
  dictionary to attack and no work factor worth paying. What it buys is the only thing that matters — a
  D1 export contains no live key.
- **Token format:** `gcm_` + 43 chars of base64url (32 random bytes from `crypto.getRandomValues`).
  Prefixed so a leak is recognisable on sight and greppable.
- **Constant-time compare** (`timingSafeEqual`, same shape as `internal-secret.ts`). Both operands are
  64-char hex digests, so the length guard leaks nothing.

### Endpoints (`/api/me/api-token`, session-gated like everything else under `/api`)

| Method | Password? | Answers |
|---|---|---|
| `GET` | no | `{ token: { createdAt, last4 } \| null, mcpUrl, serverNow }` |
| `POST` | **yes** | `201 { token: { createdAt, last4, plaintext }, mcpUrl, serverNow }` — the plaintext, once |
| `DELETE` | no | `{ revoked: true, serverNow }`, idempotent |

- The password check is `auth.api.verifyPassword` — Better Auth's own session-gated check, which returns
  `{ status }` with **no side effect**. The two alternatives both write: signing in again mints a session
  row, and re-running `changePassword` with the same value re-hashes the account row and revokes the
  caller's other sessions. Minting a token must do neither.
- A wrong password answers the same sentence `POST /me/change-password` answers, so the pair cannot
  become a password oracle by differing.
- Revoke needs no password: the safe direction never needs a guard. An owner who thinks their key leaked
  must be able to kill it in one tap, not find their password first.
- `mcpUrl` is derived from the **request origin**, never a var — the same rule `better-auth.ts` follows
  for `baseURL`. It is on both the status and create responses because the non-secret half of an agent
  config must be recoverable without replacing a working token (UX §7.2).

New error code: **`INVALID_API_TOKEN: 401`**. Distinct from `UNAUTHENTICATED` because that one means
"sign in again", which an external agent cannot act on — it has no browser. Same status, different
recovery advice.

### How a request is authenticated (`api/routes/mcp.routes.ts`)

1. `originValidationResponse(req, [self, 'localhost', '127.0.0.1'])` — the spec's DNS-rebinding defence.
   **The SDK does not do this**; origin/Host checking lives in Cloudflare's `agents` wrapper, which this
   repo does not use. A non-browser client sends no `Origin` and passes through, which is correct: the
   header exists to protect a browser, and its absence is not a claim about anything.
2. `requireBearerAuth({ verifier })` → `ApiTokenService.resolveOwner(token)` → prefix/length reject →
   `sha256Hex` → indexed lookup on `ux_api_tokens_hash` → constant-time compare → `userId`.
   Every failure collapses to the same `OAuthError(InvalidToken, 'invalid token')`. The 401 body is
   **byte-identical** for malformed, unknown, off-by-one and revoked tokens (asserted in
   `tests/mcp/api-token.test.ts`).
3. The owner's `RequestContext` is built once — mirroring `requireSession` + `resolveTimezone`, using the
   same `weekStartOf(now, tz)` from the same stored preference, so the MCP path and the API path can
   never disagree about which week "now" is.
4. `createMcpHandler(() => createMcpServer(deps))` — the factory **closes over that ctx**.

### Why scoping is safe

**No tool takes a user id.** `ctx.userId` is captured once in the factory and every service call receives
that same `ctx`. A tool cannot forget to scope because scoping is not something a tool does, and no tool
*argument* can be made to point at another account because no argument carries a scope. The repositories
close the loop: every owner-scoped read takes `userId` explicitly and every index leads with it, so
another owner's entity is refused identically to a non-existent one (R-auth-3).

`tests/mcp/scoping.test.ts` proves it rather than asserting it: a second user is inserted **directly into
D1** with a full set of entities, then user A's token is pointed at every one of B's ids through all 37
id-taking tool calls. All must refuse, and refuse as `NOT_FOUND` — a "forbidden" would itself be a leak,
since it confirms the id exists. A census test reads the live tool list and fails if any tool declaring an
id-shaped input is missing from that list, so the coverage claim stays true as tools are added.

**That test found a real bug.** Five tools accepted an unknown id and returned a silent success:
`list_goals`/`list_tasks`/`list_backlog` with `under_goal_id`, `list_tasks` with `goal_id`, and
`clear_goal_focus`. No data crossed accounts — a subtree filter is a set intersection, so a foreign id
simply matched nothing — but each returned `[]` or `cleared: true` for an id that does not resolve. An
agent told "show me what's under X" would report an empty branch rather than a bad id. Fixed with
`requireGoal()` in `mcp/shapes.ts`, which `subtreeIds()` now calls unconditionally.

### Idempotency

Server-generated, one fresh ULID per mutating tool invocation (`stampIdempotencyKey`). The agent never
supplies one and never sees one.

**One correction to the design document.** It claims this means "a dropped response never double-writes".
It does not. That guarantee requires the *client* to send the identical key again, and the stateless MCP
transport gives us no hook to make it do so — one POST is one complete interaction. A per-invocation key
is exactly the guarantee that is implementable here.

---

## 4. Where reality differed from the research brief

The brief flagged that `@modelcontextprotocol/server@2.0.0` was a month old and that several behaviours
came from shipped JSDoc rather than documentation. Re-verified against the installed package:

| Claim | Reality |
|---|---|
| **`AuthInfo.expiresAt` must be set or every request 401s** | **CONFIRMED, and it is silent.** `dist/index.mjs:1408`: `if (typeof authInfo.expiresAt !== "number" \|\| Number.isNaN(...)) throw new OAuthError(InvalidToken, "Token has no expiration time")`. A static token has none, so the verifier synthesises a rolling 1-hour value purely to satisfy the check. It is a fiction: the token's real lifetime is "until the owner replaces or revokes it". |
| Package is one dependency with two transitive deps | Confirmed. `@cfworker/json-schema` is a *dev*dependency but is **bundled inline** into `dist/`, so nothing extra is needed at runtime. |
| Exports `requireBearerAuth`, `originValidationResponse`, `OAuthError`, `createMcpHandler`, `McpServer`, `ResourceTemplate` | All present and used. |
| `.refine()` is dropped from the advertised JSON Schema | Confirmed. `save_weekly_plan.week_start` advertises `format: date` plus a generic ISO pattern that a **Tuesday satisfies**. The Monday rule survives only in the prose — asserted in `tests/mcp/tools.test.ts`. |
| **The brief's sketch reads instructions via `initialize`** | **WRONG.** `initialize` answers `-32601 Method not found` — the 2026-07-28 revision removed the handshake. Instructions and capabilities come from **`server/discover`**. This matters for any manual test. |
| — (not covered by the brief) | **Prompt arguments are STRINGS on the wire.** `GetPromptRequest.params.arguments` is `Record<string, string>`; sending a number is `-32603`. That is why `review_the_carry.weeks` is `z.coerce.number()`. Prompts advertise no JSON Schema (only name/description/required), so the coercion is invisible to the model and cannot mislead it. |
| — (not covered by the brief) | **`prompts/get` requires `arguments` to be present**, even as `{}`, whenever the prompt declares an `argsSchema`. Omitting the key entirely is `-32602`. |
| `resolveWeek` reusable as-is | Needed a one-word change: `maxHistory` was inferred as the literal `8` from its default, so no other bound could be passed. Annotated `number`. MCP tools reach back 520 weeks (the schema's own bound); the 8-week clamp is the week *switcher's* range, a UI bound. |
| — | The repo's `no-real-email` drift alarm greps for `/resend/i`, which matched the ordinary English word in two of my comments. **False positive of an existing guard**; I reworded my prose rather than weakening the guard. |

---

## 5. Wiring

- **`wrangler.jsonc`: `"/mcp"` added to `assets.run_worker_first`.** Without it the asset router owns the
  path and `not_found_handling: "single-page-application"` answers `index.html` with a 200 — the Worker
  never runs. The failure reads as "the MCP server returns HTML", which is nothing like its cause.
- **`app.ts`: `app.route(MCP_PATH, mcpRoutes)` sits ABOVE `app.use(\`${API_BASE}/*\`, checkOrigin,
  requireSession, resolveTimezone)`.** `requireSession` demands a cookie; an agent has a bearer token.
  Below that line, every MCP request 401s. `cors()` still applies and is harmless (`if (!origin) return
  origin`). The SPA not-found fallback never sees `/mcp` because it is a registered route.
- **`wrangler.jsonc` records that `goals.rameezshuhaib.com` is a dashboard-managed custom domain that
  this config does NOT reproduce.** A fresh deploy from a clean checkout serves `*.workers.dev` and
  nothing listens on the custom domain unless it is re-attached by hand. **No `routes` block was added** —
  `routes` and a dashboard custom domain are two mechanisms for one hostname, and declaring one while the
  other exists is how a working route gets replaced by a broken one.

`tests/security/mcp-wiring.test.ts` pins all of the above, in the same style as
`tests/security/no-real-email.test.ts`.

---

## 6. Testing it by hand

```bash
URL=https://goals.rameezshuhaib.com/mcp     # or http://localhost:8787/mcp under `wrangler dev`
TOKEN=gcm_...                               # Account → Agent access → Create a token
```

The mirrored headers are **required**: `MCP-Protocol-Version` must match the value inside `_meta`, and
`Mcp-Name` must equal `params.name`, or you get `400 / -32020 HeaderMismatch` before any handler runs.
There is no handshake — one POST is a complete interaction.

```bash
# The server's own briefing: capabilities + the instructions block. NOT `initialize`.
curl -sS "$URL" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' -H 'Mcp-Method: server/discover' \
  -d '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{
        "io.modelcontextprotocol/protocolVersion":"2026-07-28",
        "io.modelcontextprotocol/clientInfo":{"name":"curl","version":"1.0.0"},
        "io.modelcontextprotocol/clientCapabilities":{}}}}' | jq -r .result.instructions

# tools/list — expect 43
curl -sS "$URL" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' -H 'Mcp-Method: tools/list' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{
        "io.modelcontextprotocol/protocolVersion":"2026-07-28",
        "io.modelcontextprotocol/clientInfo":{"name":"curl","version":"1.0.0"},
        "io.modelcontextprotocol/clientCapabilities":{}}}}' | jq '.result.tools | length'

# tools/call — Mcp-Name MUST equal params.name
curl -sS "$URL" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' -H 'Mcp-Method: tools/call' -H 'Mcp-Name: get_overview' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_overview","arguments":{},"_meta":{
        "io.modelcontextprotocol/protocolVersion":"2026-07-28",
        "io.modelcontextprotocol/clientInfo":{"name":"curl","version":"1.0.0"},
        "io.modelcontextprotocol/clientCapabilities":{}}}}' | jq -r '.result.content[0].text'

# auth negative — expect 401 + WWW-Authenticate: Bearer
curl -sS -i "$URL" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' -H 'Mcp-Method: tools/list' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | head -20

# run_worker_first regression guard — must NOT be 200 text/html
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' "$URL"
```

Responses may be `application/json` **or** `text/event-stream`; add `-N` when you get a stream.

Connecting Claude Code:

```bash
claude mcp add --transport http goal-cascade "$URL" --header "Authorization: Bearer $TOKEN"
claude mcp get goal-cascade      # look for "✔ Connected"
```

Use the default **local** scope, or `user`. Never `--scope project`: that writes `.mcp.json`, and the
token must not be committed.

---

## 7. Risks accepted, not solved

1. **`change_password` is exposed.** The design recommended omitting it (rail 2) and the reasoning is
   unchanged: this deployment cannot send mail, so changing the password while signed in is the owner's
   *only* recovery path, and an agent that changes it from a mis-parsed instruction or a prompt injection
   inside a task description locks the owner out permanently. The owner was shown this and chose full
   access. The only mitigation left is the tool description, which is therefore a tested deliverable.
   Its `current_password` requirement means a stolen token *alone* cannot re-key the account.
2. **The token is a standing full-access credential** with no expiry — strictly more powerful than a
   browser session, since it bypasses Better Auth entirely. It is a second standing credential alongside
   `INTERNAL_SECRET`.
3. **`save_weekly_plan` can silently deactivate branches.** With `confirm_deactivations` overruled, the
   guarantee is that the agent is *told* afterwards (`deactivated: [{id, path}]`), not that it is stopped.
   `set_goal_focus` / `clear_goal_focus` exist so it rarely needs the raw primitive.
4. **`tools/list` CPU on the free plan.** Stateless means the Zod→JSON-Schema conversion happens on every
   request with no session to cache in. 43 tools is a lot of schemas. Untested against the 10 ms free-plan
   CPU limit; measure before assuming it fits.
5. **`change_password` mints and immediately revokes a temporary session**, because Better Auth's
   `changePassword` requires one and this path has none. The sign-out is not optional tidiness —
   `revokeOtherSessions` spares the session performing the change, so skipping it would leave a live
   session row that nothing holds.
