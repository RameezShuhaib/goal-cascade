# Serving MCP from the Goal Cascade Worker

Research date: **2026-08-31**. Every load-bearing claim carries a source URL. Claims I could not
verify from a primary source are marked `[unverified]`.

Verification method: Cloudflare + MCP primary docs (fetched 2026-08-31), the npm registry, and — for
anything the docs summarise loosely — the **published `.d.ts` and runtime bundles** of
`agents@0.22.0` and `@modelcontextprotocol/server@2.0.0`, downloaded and read directly. Where a doc
page and the shipped types disagree, the types win and the disagreement is called out.

---

## Recommendation (three sentences)

Install `@modelcontextprotocol/server@2.0.0` (+ the `zod@^4` already present) and mount the SDK's own
`createMcpHandler` as a single Hono route at `POST /mcp`, above the `/api/*` session guard — no
Durable Object, no `agents` dependency, no new compatibility flags. Authenticate with the SDK's
`requireBearerAuth` against a `MCP_TOKEN` secret, mirroring the existing `requireInternalSecret`
constant-time pattern, and resolve the single owner's `userId` once per request through the existing
tsyringe container so every tool is scoped exactly like an `/api/*` route. The only `wrangler.jsonc`
change is adding `"/mcp"` to `assets.run_worker_first` — without it the SPA asset router swallows the
path before the Worker ever runs.

---

## 1. What is the current recommended way to serve MCP from a Worker?

**`McpAgent` is deprecated and feature-frozen.** The MCP `2026-07-28` revision made the protocol
stateless, which removed the reason `McpAgent` existed.

> "McpAgent creates a stateful legacy MCP server backed by a Durable Object… deprecated and
> feature-frozen… Migrate to `createMcpHandler` at your earliest convenience."
> — <https://developers.cloudflare.com/agents/model-context-protocol/apis/agent-api/> (fetched 2026-08-31)

> "MCP is now a fully stateless protocol… MCP servers can now run in just a Worker, with no stateful
> infrastructure needed… While Durable Objects remain the right primitive when an application itself
> needs state, MCP itself no longer requires a Durable Object to speak the protocol."
> — <https://blog.cloudflare.com/mcp-v2/> (published 2026-08-06)

**A Durable Object is NOT required.** That is the headline change. `McpAgent` needed one; the
stateless path needs none. Trade-off: you give up per-session server-side state, server-initiated
push (sampling / elicitation as server→client *requests*), and hibernation-backed long-lived
connections. In the new protocol those are replaced by **MRTR** (Multi Round-Trip Requests): the
server returns an `input_required` result and the client retries with the answer
(<https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http>).
Goal Cascade needs none of them.

### Package names and versions (npm, checked 2026-08-31)

| Package | latest | published | Notes |
|---|---|---|---|
| `@modelcontextprotocol/server` | **2.0.0** | 2026-07-28 | SDK v2, server half. deps: `zod@^4.2.0`, `@modelcontextprotocol/core@2.0.0` |
| `@modelcontextprotocol/core` | 2.0.0 | 2026-07-28 | transitive |
| `@modelcontextprotocol/client` | 2.0.0 | 2026-07-28 | client half; not needed to *serve* |
| `@modelcontextprotocol/sdk` | 1.30.0 | 2026-07-27 | **v1, legacy.** Still maintained, but this is the old single-package SDK |
| `agents` | **0.22.0** | 2026-08-27 | Cloudflare Agents SDK. Docs currently describe v0.20.0 |
| `@cloudflare/workers-oauth-provider` | 0.10.3 | 2026-08-10 | only if you want OAuth |
| `@modelcontextprotocol/inspector` | 2.4.0 | 2026-08-26 | testing |

`agents@0.22.0` peer-depends on `@modelcontextprotocol/server@2.0.0` **pinned exactly** (not a range)
and `zod@^4.0.0` — verified from `npm view agents@0.22.0 peerDependencies`.

### Two viable paths, both DO-free

**(a) SDK-direct — `@modelcontextprotocol/server`.** `createMcpHandler` is exported by the SDK
itself and returns a web-standard `{ fetch, close, notify, bus }`:

```ts
declare function createMcpHandler(
  factory: McpServerFactory,
  options?: CreateMcpHandlerOptions,
): McpHttpHandler;
// verified: @modelcontextprotocol/server@2.0.0 dist/createMcpHandler-CLhGwQTn.d.mts:4040
```

The SDK ships an explicit **`workerd` export condition** that swaps in a Workers-safe JSON Schema
validator (`CfWorkerJsonSchemaValidator`, backed by `@cfworker/json-schema`) instead of Ajv, which
uses `eval` and is unusable on Workers — verified in `package.json` `exports["./_shims"].workerd` and
`dist/shimsWorkerd.d.mts`. Workers support is first-class, not incidental. **No Node builtins are
required** on this path.

**(b) Cloudflare's wrapper — `agents/mcp/server`.** Re-exports the SDK's handler with a
Worker-shaped signature `(request, env, ctx)` plus `route`, `corsOptions`, `allowedHostnames`,
`allowedOriginHostnames`, and `authContext`:

```ts
import { createMcpHandler } from "agents/mcp/server";
export default { fetch(request, env, ctx) { return createMcpHandler(createServer)(request, env, ctx); } };
// — https://blog.cloudflare.com/mcp-v2/ and
//   https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/
```

`agents/mcp/server` imports `AsyncLocalStorage` from `node:async_hooks` (verified:
`agents@0.22.0 dist/handler-stateless-VvrWSAVA.js:1`), so path (b) **does** require `nodejs_compat`
(or at minimum `nodejs_als`). This repo already has `nodejs_compat`, so either path works here.

**No specific `compatibility_date` is documented as a requirement** for either path
`[unverified]` — I found no docs page stating a minimum. The repo's `2026-08-01` is newer than both
packages' publication dates, so this is not a practical concern.

**Why (a) for this repo:** the wrapper's value is `route` matching, CORS, and Host/Origin validation
— all of which Hono already owns here. Adding `agents` pulls in `esbuild`, `partysocket`,
`@babel/plugin-proposal-decorators`, `cron-schedule` and more (`npm view agents@0.22.0 dependencies`)
for a wrapper this app does not need. Path (a) is one dependency with two transitive deps.

---

## 2. Transports

**Streamable HTTP. Only. One endpoint. `POST /mcp`.**

> "The server **MUST** provide a single HTTP endpoint path (hereafter referred to as the **MCP
> endpoint**) that supports POST. For example, this could be a URL like `https://example.com/mcp`."
> — <https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http>

What `2026-07-28` **removed** from Streamable HTTP (same page):

- the standalone **GET** SSE stream → answer `405 Method Not Allowed`
- **protocol-level sessions** — no `Mcp-Session-Id`, no DELETE; "ignore it, and do not mint or echo session IDs"
- resumability via `Last-Event-ID` → "ignore it; streams are not resumable"

SSE is still used, but only as a *per-request response body* (`Content-Type: text/event-stream`
scoped to one POST), never as a separate connection.

**The 2024-11-05 HTTP+SSE transport is Deprecated** (formal lifecycle status): "New implementations
**SHOULD NOT** adopt it" (same page). Cloudflare agrees: "Server-Sent Events (SSE) … Deprecated"
— <https://developers.cloudflare.com/agents/model-context-protocol/transport/>. **Do not implement
`/sse`.**

**Backward compatibility is free.** `createMcpHandler`'s `legacy` option defaults to `'stateless'`,
which serves 2025-era clients from the *same factory* over a per-request stateless transport; set
`legacy: 'reject'` for modern-only. Verified from `CreateMcpHandlerOptions.legacy` docs in
`dist/createMcpHandler-CLhGwQTn.d.mts:3829-3860`. So one `/mcp` route serves both eras — you do not
need to know which era a given client speaks.

**Required request headers** (spec, same page) — these matter for hand-rolled `curl` tests:

| Header | Required for |
|---|---|
| `MCP-Protocol-Version: 2026-07-28` | every POST; must match `_meta."io.modelcontextprotocol/protocolVersion"` or `400` + `-32020 HeaderMismatch` |
| `Mcp-Method` | all requests (mirrors `method`) |
| `Mcp-Name` | `tools/call`, `resources/read`, `prompts/get` (mirrors `params.name` / `params.uri`) |
| `Accept: application/json, text/event-stream` | client MUST list both |

**Which era real clients speak today is `[unverified]`.** I confirmed Claude Code supports
`--transport http` against a remote URL (<https://code.claude.com/docs/en/mcp>) and that Inspector
2.4 negotiates "legacy vs. modern (2026-07-28)"
(<https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector>), but I did not find a primary
statement of which protocol revision Claude Desktop / Claude Code emit. Keeping `legacy: 'stateless'`
(the default) makes this moot.

---

## 3. Mounting alongside the existing Hono app

The MCP handler is just a `fetch(Request) => Promise<Response>`, so it drops into a Hono route.
Five things in this repo's chain interact with it:

| Thing | Effect on `/mcp` | Action |
|---|---|---|
| **`assets.run_worker_first`** | **BREAKING.** `["/api/*", "/internal/*"]` does not cover `/mcp`, so the asset router handles it and `not_found_handling: "single-page-application"` returns `index.html` — the Worker never runs. | **Add `"/mcp"`.** Exact non-glob entries are supported: the docs' own example is `"run_worker_first": ["/oauth/callback"]` (<https://developers.cloudflare.com/workers/static-assets/routing/worker-script/>) |
| **`cors()` (`app.use('*', …)`)** | Harmless. Its origin callback opens with `if (!origin) return origin;` and non-browser MCP clients send no `Origin`. | none |
| **`checkOrigin`** | Not applied — it is scoped to `${API_BASE}/*` in `app.ts`, and `/mcp` is not under `/api`. | none |
| **`requireSession`** | Not applied for the same reason. Register `/mcp` **before** the `app.use(\`${API_BASE}/*\`, …)` line to keep it that way. | register early |
| **`notFoundHandler`** | Never reached once `/mcp` is a registered route. | none |
| **`errorHandler`** | Would render the app's JSON error envelope instead of a JSON-RPC error if the handler throws. | catch inside the route |

**Origin validation is your job on path (a).** The spec says servers **MUST** validate `Origin` and
answer `403` when present-and-invalid
(<https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http>). The
SDK's `createMcpHandler` does **not** do this — I read the `agents` wrapper's source and origin/Host
checking lives there (`allowedOriginHostnames` / `allowedHostnames`,
`agents@0.22.0 dist/handler-stateless-VvrWSAVA.js:265-283`), not in the SDK entry. The SDK does
export the primitives (`validateOriginHeader`, `originValidationResponse`, `validateHostHeader`,
`hostHeaderValidationResponse`) — use them, or reuse this repo's `checkOrigin`. **Do not skip this.**

---

## 4. Authentication — a static bearer token is fine

**The spec does not require OAuth.** "While authorization for MCP servers is **optional**, it is
strongly recommended when…" — <https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/authorization>.
The `2026-07-28` authorization work (RFC 9207 `iss`, CIMD replacing DCR, RFC 8707 `resource`) governs
servers that *choose* to be OAuth resource servers.

**The SDK ships first-class static-bearer support.** `@modelcontextprotocol/server@2.0.0` exports
`requireBearerAuth`, `verifyBearerToken`, `bearerAuthChallengeResponse`, and the `OAuthTokenVerifier`
interface. From the shipped types, the documented Workers/Hono example is exactly this shape:

```ts
// dist/index.d.mts — requireBearerAuth JSDoc, verbatim
const gate = requireBearerAuth({ verifier, requiredScopes: ['mcp'] });

async function fetchHandler(request: Request): Promise<Response> {
    const auth: AuthInfo | Response = await gate(request);
    if (auth instanceof Response) return auth;
    return handler.fetch(request, { authInfo: auth });
}
```

> "The framework-free counterpart of `requireBearerAuth` from `@modelcontextprotocol/express`, for
> hosts whose HTTP surface is a `fetch(request)` handler — **Cloudflare Workers**, Deno, Bun, Hono."

`OAuthTokenVerifier` is one method — `verifyAccessToken(token) => Promise<AuthInfo>` — and is
explicitly "intentionally narrower than a full OAuth Authorization Server provider". A verifier that
compares against a secret is a legitimate implementation.

**Gotcha, verified from the types:** "bearer-auth verification rejects tokens whose
`AuthInfo.expiresAt` is unset (matches v1 behavior)." A static-token verifier **must** synthesise an
`expiresAt`, or every request 401s. This is not in any docs page I found.

**How clients pass a static header today.** Claude Code, verbatim from
<https://code.claude.com/docs/en/mcp>:

```bash
claude mcp add --transport http secure-api https://api.example.com/mcp \
  --header "Authorization: Bearer your-token"
```

and in `.mcp.json`:

```json
{ "mcpServers": { "goal-cascade": {
    "type": "http",
    "url": "https://…/mcp",
    "headers": { "Authorization": "Bearer …" } } } }
```

**How identity reaches tool handlers.** Two mechanisms, both verified in the shipped types:

1. **`ctx.http.authInfo` in every handler.** `BaseContext.http?: { authInfo?: AuthInfo }`
   (`dist/createMcpHandler-CLhGwQTn.d.mts:2171-2176`), populated at runtime from the `authInfo` you
   pass to `handler.fetch` (`dist/src-CX2iR2pK.mjs:6443` — `http: extra?.authInfo ? { authInfo: extra.authInfo } : void 0`).
   `AuthInfo.extra?: Record<string, unknown>` is the documented slot for "additional data … attached
   to the token" — put `userId` there.
2. **`ctx.authInfo` in the server *factory*.** `McpServerFactory = (ctx: McpRequestContext) => …`
   where `McpRequestContext = { era, authInfo?, requestInfo? }`
   (`dist/createMcpHandler-CLhGwQTn.d.mts:3781-3808`). The JSDoc names this exact use case: "the
   context exists for factories that vary by principal … for example multi-tenant servers keyed off
   `authInfo`". **This is the cleaner route** — resolve `userId` once, close over it when registering
   tools, and no handler can forget to scope.

> "The entry performs no token verification: `authInfo` given to `fetch` is passed through to handlers
> and the factory as-is and is never derived from request headers."
> — `createMcpHandler` JSDoc, `dist/createMcpHandler-CLhGwQTn.d.mts:4036`

So the auth gate is *entirely* yours, which is exactly what "static bearer, not Better Auth" wants.

**If you later want OAuth**, `@cloudflare/workers-oauth-provider@0.10.3` wraps the handler
(<https://blog.cloudflare.com/mcp-v2/>), and on the `agents` path `getMcpAuthContext()` then surfaces
the OAuth props. Not needed for a single-owner server.

---

## 5. Tools, resources, prompts — and reusing this repo's Zod schemas

All three are registered on an `McpServer` instance. Signatures verified from
`dist/createMcpHandler-CLhGwQTn.d.mts:3264-3350`:

```ts
server.registerTool(name, {
  title?, description?, inputSchema?, outputSchema?, annotations?, icons?, _meta?
}, cb: (args, ctx: ServerContext) => CallToolResult | InputRequiredResult | Promise<…>);

server.registerResource(name, uri: string | ResourceTemplate,
  config: ResourceMetadata & { cacheHint? }, readCallback);

server.registerPrompt(name, { title?, description?, argsSchema?, icons?, _meta? }, cb);
```

The SDK's own examples (verbatim from the JSDoc):

```ts
server.registerTool('calculate-bmi',
  { title: 'BMI Calculator', description: 'Calculate Body Mass Index',
    inputSchema:  z.object({ weightKg: z.number(), heightM: z.number() }),
    outputSchema: z.object({ bmi: z.number() }) },
  async ({ weightKg, heightM }) => {
    const output = { bmi: weightKg / (heightM * heightM) };
    return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
  });

server.registerResource('config', 'config://app',
  { title: 'Application Config', mimeType: 'text/plain' },
  async uri => ({ contents: [{ uri: uri.href, text: 'App configuration here' }] }));

server.registerPrompt('review-code',
  { title: 'Code Review', description: 'Review code for best practices',
    argsSchema: z.object({ code: z.string() }) },
  ({ code }) => ({ messages: [{ role: 'user' as const,
                                content: { type: 'text' as const, text: `Please review this code:\n\n${code}` } }] }));
```

### Schemas: Zod **or** JSON Schema, via Standard Schema

The accepted type is `StandardSchemaWithJSON` — the intersection of Standard Schema (for validation)
and Standard **JSON** Schema (for advertising in `tools/list`):

> "This is the type accepted by `registerTool` / `registerPrompt`. The SDK needs
> `~standard.jsonSchema` to advertise the tool's argument shape in `tools/list`, and
> `~standard.validate` to check incoming arguments when a `tools/call` arrives. Zod v4, ArkType, and
> Valibot … all implement both interfaces."
> — `dist/createMcpHandler-CLhGwQTn.d.mts:1330-1345`

Raw JSON Schema is also supported via the exported `fromJsonSchema` helper.

**Can `packages/shared` Zod schemas be reused directly? Yes — no conversion.** I ran this against the
repo's actual installed `zod@4.5.4`:

```
zod version: 4.5.4
~standard keys: [ 'validate', 'vendor', 'version', 'jsonSchema' ]   ← jsonSchema present
```

and converted each schema pattern the repo actually uses. All six converted cleanly:

| Repo pattern (from `packages/shared/src/`) | JSON Schema conversion |
|---|---|
| `z.object({…}).strict()` | OK → `additionalProperties: false` |
| `.default(0)` | OK → `default` emitted |
| `.refine(…)` (`Url`, `WeekStart`) | OK — but **the refinement is dropped from the JSON Schema** |
| `z.coerce.number()` (`WeekOffsetParam`) | OK → `{"type":"integer"}` |
| `z.stringbool()` (`DeleteGoalQuery`) | OK → `{"type":"string"}` |
| `.transform((s, ctx) => …)` (`common.ts:16`) | OK (input side) |
| `z.enum(…).describe(…)` | OK → `enum` + `description` |

Two consequences worth knowing:

- **`.refine()` constraints vanish from the advertised schema but are still enforced at call time**
  (`validateToolInput` runs `~standard.validate` and throws `-32602` on failure —
  `dist/mcp-DXXb3Vv3.mjs:1426-1432`). The model just cannot see the rule. Put it in `.describe()`.
- **Coercion schemas advertise the wire type, not the intent.** `WeekOffsetParam` is
  `z.coerce.number()` because it parses a query *string*; as a tool input it advertises `integer`,
  which is right, but `z.stringbool()` advertises `string` — misleading for a tool arg. For tools,
  prefer the non-coercing twins the repo already has (`WeekOffset` is `z.int().max(0)` with a
  `.describe()` — use that, not `WeekOffsetParam`).

**Zod version compatibility.** `@modelcontextprotocol/server@2.0.0` depends on `zod@^4.2.0`; the repo
has `zod@^4.5.4`. Compatible, single copy. **Zod v3 will not work** — `~standard.jsonSchema` is a v4
feature. The deprecated "raw shape" overload (`inputSchema: { a: z.string() }` without `z.object`)
still exists but is marked `@deprecated Wrap with z.object({...}) instead`
(`dist/createMcpHandler-CLhGwQTn.d.mts:3288`) — always wrap.

---

## 6. Errors and limits

### Domain error vs transport error

Verified from the runtime (`@modelcontextprotocol/server@2.0.0 dist/mcp-DXXb3Vv3.mjs:1400-1424`):

- **Domain error → `isError: true` result.** Return
  `{ content: [{ type: 'text', text: '…' }], isError: true }`. The model sees the text and can
  recover. Confirmed by Cloudflare: "Setting `isError: true` signals failure to the LLM"
  (<https://developers.cloudflare.com/agents/model-context-protocol/protocol/tools/>).
- **A thrown error from a `tools/call` handler is caught and converted to the same `isError` result**,
  using `error.message` as the text. Only `ProtocolError` with code `UrlElicitationRequired` is
  re-thrown. **Practical consequence: throwing leaks `error.message` to the model.** For this repo,
  `DomainError.message` is user-facing prose, so throwing is acceptable — but a raw D1 error would
  also leak. Catch and map deliberately.
- **Transport / protocol errors** are JSON-RPC error responses with `ProtocolErrorCode`
  (`-32602` invalid params, `-32601` method not found, `-32603` internal, `-32020` HeaderMismatch).
  These are emitted by the SDK, not by tool code: input-schema validation failure →
  `-32602 "Input validation error: …"`. For **`prompts/get` and `resources/read`**, a thrown error
  *does* surface as a JSON-RPC error rather than `isError` — "Per-family surfacing: tools/call →
  isError result (the 2025 idiom); prompts/resources → JSON-RPC error"
  (`dist/mcp-DXXb3Vv3.mjs:526`).
- **`outputSchema` is enforced.** Declaring one makes `structuredContent` mandatory on non-error
  results (`-32602` otherwise) and validates it (`dist/mcp-DXXb3Vv3.mjs:1436-1444`). Declare it only
  when you will populate it.

### Workers limits that matter

From <https://developers.cloudflare.com/workers/platform/limits/> (fetched 2026-08-31):

| Limit | Free | Paid |
|---|---|---|
| CPU time / request | 10 ms | 5 min max, **30 s default** |
| Wall clock (HTTP) | no limit while client connected | same |
| Request body | 100 MB (account plan, Free/Pro) | 100 MB / 200 MB / 500 MB by account plan |
| Subrequests / request | 50 | 10,000 |
| Memory / isolate | 128 MB | 128 MB |
| Simultaneous open connections | 6 awaiting response headers | 6 |

Relevant reads:

- **CPU, not wall clock, is the binding constraint.** A tool doing several D1 round-trips is I/O, not
  CPU. On the free plan 10 ms CPU is tight for a large `tools/list` with many Zod→JSON-Schema
  conversions; the SDK converts lazily but a fat schema set costs CPU on every stateless request
  (there is no session to cache it in). Mitigation: the spec's `ttlMs` / `cacheScope` result hints
  (<https://blog.cloudflare.com/mcp-v2/>) and the SDK's `cacheHints` option.
- **Subrequests:** each D1 query counts. A tool that fans out across the goal tree could approach 50
  on the free plan. This repo's `IGoalRepo` already reads the whole tree in one query, which helps.
- **Concurrency:** the stateless protocol means N concurrent tool calls are N independent POSTs — no
  shared state, no lock. `maxSubscriptions` (default 1024) only bounds `subscriptions/listen`
  streams, which this server will not serve.
- **No documented MCP-specific payload cap** `[unverified]` — I found no MCP or Cloudflare page
  stating a tool-result size limit. Client-side context limits will bite long before Workers does;
  paginate list-shaped tool results yourself.

---

## 7. Testing

### MCP Inspector 2.4 — the reference tool

Verbatim from <https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector> (requires **Node ≥ 22.19.0**):

```bash
# Web UI
npx @modelcontextprotocol/inspector --server-url https://api.example.com/mcp --transport http

# CLI, scriptable
npx @modelcontextprotocol/inspector --cli https://api.example.com/mcp --transport http \
  --method tools/call --tool-name get_weather --tool-arg city=Boston --format json | jq .result
```

Mode flags (`--web` default / `--cli` / `--tui`) are launcher-owned and must come **first**;
everything after the first non-mode token goes to the client.

**Passing a bearer token to the Inspector CLI is `[unverified]`.** The docs page above does not list a
`--header` flag, and the flag reference lives on a sub-page
(`/docs/2026-07-28/tools/inspector/configuration`) I did not fetch. The Inspector README documents a
bearer-token field in the **web UI** sidebar
(<https://github.com/modelcontextprotocol/inspector>). Run `npx @modelcontextprotocol/inspector --cli --help`
to get the authoritative CLI flag list at implementation time.

### `curl` against Streamable HTTP — fully self-contained

Because `2026-07-28` is stateless, there is **no handshake** — one POST is a complete interaction.
Note the mirrored headers are **REQUIRED**, and `MCP-Protocol-Version` must match the value in
`_meta` or you get `400 / -32020 HeaderMismatch`
(<https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http>).

```bash
URL=https://goal-cascade-api.<subdomain>.workers.dev/mcp
TOKEN=$MCP_TOKEN

# tools/list
curl -sS "$URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: tools/list' \
  -d '{
    "jsonrpc":"2.0","id":1,"method":"tools/list",
    "params":{"_meta":{
      "io.modelcontextprotocol/protocolVersion":"2026-07-28",
      "io.modelcontextprotocol/clientInfo":{"name":"curl","version":"1.0.0"},
      "io.modelcontextprotocol/clientCapabilities":{}
    }}}'

# tools/call — Mcp-Name MUST equal params.name
curl -sS "$URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: tools/call' \
  -H 'Mcp-Name: list_goals' \
  -d '{
    "jsonrpc":"2.0","id":2,"method":"tools/call",
    "params":{"name":"list_goals","arguments":{},"_meta":{
      "io.modelcontextprotocol/protocolVersion":"2026-07-28",
      "io.modelcontextprotocol/clientInfo":{"name":"curl","version":"1.0.0"},
      "io.modelcontextprotocol/clientCapabilities":{}
    }}}'

# auth negative test — expect 401 + WWW-Authenticate: Bearer …
curl -sS -i "$URL" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' -H 'Mcp-Method: tools/list' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"curl","version":"1.0"},"io.modelcontextprotocol/clientCapabilities":{}}}}' | head -20

# regression guard: prove run_worker_first covers /mcp (must NOT be the SPA's index.html)
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' "$URL"   # GET → expect 405, not 200 text/html
```

The response may be `application/json` **or** `text/event-stream` — the spec requires clients to
support both. Add `-N` when you get a stream.

### Adding it to Claude Code

```bash
claude mcp add --transport http goal-cascade \
  https://goal-cascade-api.<subdomain>.workers.dev/mcp \
  --header "Authorization: Bearer $MCP_TOKEN"

claude mcp get goal-cascade      # look for "✔ Connected"
```

Scopes: `--scope local` (default, private), `--scope project` (writes `.mcp.json` — **do not commit a
token**), `--scope user` (all your projects). Source: <https://code.claude.com/docs/en/mcp>.

Given the token is a secret and this is a single-user product, use the default **local** scope, or
`user` scope. Never `project`.

---

## Concrete integration sketch for this repo

### Install

```bash
npm i -w @goal-cascade/api @modelcontextprotocol/server@2.0.0
```

`zod@^4.5.4`, `hono`, `tsyringe`, `reflect-metadata` are already present. **Nothing else.** No
`agents`, no `@cloudflare/workers-oauth-provider`, no `@modelcontextprotocol/sdk`.

### `apps/api/wrangler.jsonc` — the only change

```jsonc
  "assets": {
    "directory": "../web/dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    // `/mcp` MUST be here. Without it the asset router serves index.html for /mcp and the
    // Worker never runs — the failure looks like "the MCP server returns HTML".
    "run_worker_first": ["/api/*", "/internal/*", "/mcp"]
  },
```

**Not needed:** no `durable_objects`, no `migrations`, no new `compatibility_flags`
(`nodejs_compat` is already on and is not required on this path anyway), no `compatibility_date` bump.
This preserves both "deliberately absent" invariants — no `send_email`, no `triggers.crons` — and
adds no third.

Secret:

```bash
wrangler secret put MCP_TOKEN     # openssl rand -base64 32
```

### `apps/api/src/env.ts`

```ts
  /**
   * Static bearer token for the MCP endpoint. Unset → `/mcp` 404s, mirroring INTERNAL_SECRET.
   * This is a FULL-ACCESS credential for the owner's data — every MCP tool runs as the owner.
   */
  MCP_TOKEN?: string;
```

### `apps/api/src/api/mcp/server.ts` — the factory

```ts
import { McpServer } from '@modelcontextprotocol/server';
import { WeekOffset, CreateTaskRequest } from '@goal-cascade/shared';
import { z } from 'zod';
import type { DependencyContainer } from 'tsyringe';
import { TaskService, GoalService } from '../../application/services';
import { DomainError } from '../../domain/errors';
import type { RequestContext } from '../../application/context';

/**
 * ONE factory, closed over the resolved owner context. Tools cannot forget to scope, because the
 * userId is not a parameter they receive — it is captured here, exactly like `ctx` on an /api route.
 */
export function createMcpServer(dc: DependencyContainer, ctx: RequestContext): McpServer {
  const server = new McpServer({ name: 'goal-cascade', version: '0.1.0' });

  server.registerTool(
    'list_tasks',
    {
      title: 'List tasks for a week',
      description: 'Tasks for one week. week=0 is the current week; negative values go back.',
      // The repo's own Zod v4 schema, used verbatim — zod@4.5.4 exposes `~standard.jsonSchema`.
      inputSchema: z.object({ week: WeekOffset.default(0) }).strict(),
    },
    async ({ week }) => {
      try {
        const tasks = await dc.resolve(TaskService).list(ctx, { week });
        return { content: [{ type: 'text', text: JSON.stringify(tasks) }] };
      } catch (e) {
        // Domain refusal → isError, so the model can recover rather than seeing a protocol fault.
        if (e instanceof DomainError) return { content: [{ type: 'text', text: e.message }], isError: true };
        throw e;   // becomes isError anyway; do not let a raw D1 message reach the model
      }
    },
  );

  server.registerTool(
    'create_task',
    { title: 'Create a task', description: '…', inputSchema: CreateTaskRequest },
    async (args) => { /* dc.resolve(TaskService).create(ctx, args) */ },
  );

  // Resources and prompts use the same closure.
  server.registerResource(
    'goal-tree', 'goal-cascade://goals',
    { title: 'Goal tree', mimeType: 'application/json' },
    async (uri) => ({ contents: [{ uri: uri.href,
        text: JSON.stringify(await dc.resolve(GoalService).tree(ctx)) }] }),
  );

  return server;
}
```

*(Service method names above are illustrative — wire them to the real `application/services` API.)*

### `apps/api/src/api/routes/mcp.routes.ts` — auth + handler

```ts
import { Hono } from 'hono';
import {
  createMcpHandler, requireBearerAuth, OAuthError, OAuthErrorCode,
  originValidationResponse, type AuthInfo,
} from '@modelcontextprotocol/server';
import { IUserRepo, IClock } from '../../application/ports';
import { DomainError } from '../../domain/errors';
import { createMcpServer } from '../mcp/server';
import type { AppBindings } from '../types';

/** Same constant-time shape as `requireInternalSecret`. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const mcpRoutes = new Hono<AppBindings>().all('/', async (c) => {
  const secret = c.env.MCP_TOKEN;
  if (!secret) throw new DomainError('NOT_FOUND', 'route not found');   // unset ⇒ endpoint does not exist

  // Spec MUST: validate Origin (DNS-rebinding). The SDK entry does NOT do this — only the
  // `agents` wrapper does. Non-browser clients send no Origin and pass through.
  const selfHost = new URL(c.req.url).hostname;
  const originRejection = originValidationResponse(c.req.raw, [selfHost, 'localhost', '127.0.0.1']);
  if (originRejection) return originRejection;

  const gate = requireBearerAuth({
    requiredScopes: ['mcp'],
    verifier: {
      async verifyAccessToken(token: string): Promise<AuthInfo> {
        if (!timingSafeEqual(token, secret)) {
          throw new OAuthError(OAuthErrorCode.InvalidToken, 'invalid token');
        }
        return {
          token,
          clientId: 'goal-cascade-agent',
          scopes: ['mcp'],
          // REQUIRED: verifyBearerToken rejects an AuthInfo with no expiresAt.
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        };
      },
    },
  });

  const auth = await gate(c.req.raw);
  if (auth instanceof Response) return auth;   // 401/403 with WWW-Authenticate

  // Per-request identity. Goal Cascade is single-user: the owner is the SIGNUP_ALLOWLIST address.
  const dc = c.get('container');                       // the existing per-request tsyringe container
  const email = (c.env.SIGNUP_ALLOWLIST ?? '').split(',')[0]?.trim().toLowerCase();
  const user = email ? await dc.resolve<IUserRepo>(IUserRepo).findByEmail(email) : null;
  if (!user) throw new DomainError('UNAUTHENTICATED', 'owner account not provisioned');

  const clock = dc.resolve<IClock>(IClock);
  const ctx = {
    userId: user.id,
    user: { id: user.id, name: user.name, email: user.email,
            emailVerified: user.emailVerified, image: user.image ?? null },
    tz: 'UTC', now: clock.nowIso(), currentWeekStart: '', idempotencyKey: null,
  };
  // NOTE: currentWeekStart must be filled the same way `resolveTimezone` does, from the owner's
  // stored preference — reuse that middleware's helper rather than re-deriving it here.

  const handler = createMcpHandler(() => createMcpServer(dc, ctx));
  return handler.fetch(c.req.raw, { authInfo: auth });
});
```

**Why the handler is built per request:** it closes over the per-request container and `ctx`, which is
this repo's existing model ("one child container per request"). The alternative — a module-scope
handler with `userId` smuggled through `authInfo.extra` and read from `ctx.authInfo` in the factory —
is documented in §4 and avoids reconstruction, but needs env/DB reached some other way. Only the
module-scope form supports `handler.notify` (list-changed pushes), which this server does not use.

### `apps/api/src/api/app.ts` — one line, placed early

```ts
  app.route('/internal', internalRoutes);
  app.route('/mcp', mcpRoutes);        // ← BEFORE the /api/* session guard, so requireSession
                                       //   and checkOrigin never see it

  // ── R-auth-4: everything else under /api needs a session. Including every read. ──
  app.use(`${API_BASE}/*`, checkOrigin, requireSession, resolveTimezone);
```

`worker.ts` needs **no change** — it already delegates everything to `app.fetch`.

### A test worth adding, in the repo's existing style

`tests/security/no-real-email.test.ts` fails the build if `send_email` reappears in `wrangler.jsonc`.
Add the mirror: a test asserting `"/mcp"` **is** present in `assets.run_worker_first` whenever
`mcpRoutes` is mounted. That failure mode (SPA HTML served at `/mcp`) is silent and confusing, and a
comment is not a mechanism.

---

## Risks and unknowns

**Could not verify from a primary source:**

1. **Which protocol era Claude Code / Claude Desktop actually emit.** No primary statement found.
   Mitigated by `legacy: 'stateless'` (the default), which serves both eras from one factory — so
   this is a non-blocker, but it means you cannot assume the modern envelope in logs.
2. **MCP Inspector CLI flag for a bearer token.** The quickstart page lists no `--header`. Run
   `npx @modelcontextprotocol/inspector --cli --help` at implementation time, or use the web UI's
   bearer-token sidebar field. `curl` (§7) is the fallback that definitely works.
3. **Any MCP-specific tool-result payload cap.** Found none. Assume client context is the real limit.
4. **Minimum `compatibility_date`** for either path. Not documented. `2026-08-01` is almost certainly
   fine (both packages predate it) but this is an inference, not a citation.
5. **`run_worker_first` glob semantics** — the docs show an array with an exact path
   (`["/oauth/callback"]`) but do not formally specify wildcard/negation rules or a rule-count limit.
   Verify `/mcp` actually reaches the Worker with the `curl` regression check in §7 before building on
   it.

**Version-dependent — re-check at implementation time:**

6. **`agents` is moving fast:** 0.6.0 (2026-02-25) → 0.20.0 (2026-07-27) → 0.22.0 (2026-08-27). The
   Cloudflare docs currently describe **0.20.0** while npm serves **0.22.0**. Path (a) avoids this
   entirely; if you take path (b), read the changelog, not the docs.
7. **`agents@0.22.0` pins `@modelcontextprotocol/server@2.0.0` exactly** as a peer dep. If you ever
   add `agents`, an SDK patch release could produce a peer conflict.
8. **`@modelcontextprotocol/server` is at 2.0.0, published 2026-07-28** — one month old at time of
   writing, with no patch releases yet. Expect churn. Several behaviours I relied on come from JSDoc
   in the shipped `.d.ts` rather than a documentation page, and JSDoc is not a stability contract.
9. **`McpAgent` has no announced removal date** — "feature-frozen, no removal date announced"
   (<https://developers.cloudflare.com/changelog/post/2026-07-27-agents-sdk-v0.20.0-mcp-sdk-v2/>).
   The spec's feature-lifecycle policy guarantees deprecated features stay ≥ 12 months
   (<https://blog.cloudflare.com/mcp-v2/>). Not a concern here since we never adopt it.
10. **DCR is deprecated for removal after summer 2027** in favour of CIMD
    (<https://blog.cloudflare.com/mcp-v2/>). Only relevant if this server ever becomes an OAuth
    resource server.

**Judgement calls in the sketch, not facts:**

11. **`expiresAt` on a static token is a lie told to satisfy a check.** The verifier mints a rolling
    1-hour expiry on a token that never expires. It is required (§4) but it means the token's real
    lifetime is "until you rotate the secret". Rotate via `wrangler secret put MCP_TOKEN` and re-add
    the client.
12. **`MCP_TOKEN` is a full-access credential for the owner's data** — strictly more powerful than
    a browser session, since it bypasses Better Auth entirely and has no expiry. It is a *second*
    standing credential alongside `INTERNAL_SECRET`, whose own doc comment already concedes it is an
    account-takeover credential. Adding `/mcp` widens that surface. Consider scoping the first
    implementation to **read-only tools** and adding writes only once the endpoint has proven itself.
13. **`currentWeekStart` in the sketch is left blank.** Every week-scoped service depends on it and on
    the owner's stored timezone; `resolveTimezone` derives it today. Do not hand-roll a second
    derivation — extract the helper and call it from both places, or the MCP path and the API path
    will disagree about what "this week" means.
14. **CPU budget on `tools/list`.** Stateless means schema→JSON-Schema conversion happens on every
    request with no session to cache in. Untested here. If you register many fat schemas, measure
    before assuming it fits, especially on the free plan's 10 ms.

---

## Source index

| # | URL | Fetched / published |
|---|---|---|
| 1 | <https://blog.cloudflare.com/mcp-v2/> | published 2026-08-06 |
| 2 | <https://developers.cloudflare.com/changelog/post/2026-07-27-agents-sdk-v0.20.0-mcp-sdk-v2/> | published 2026-07-27 |
| 3 | <https://developers.cloudflare.com/agents/model-context-protocol/apis/agent-api/> | fetched 2026-08-31 |
| 4 | <https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/> | fetched 2026-08-31 |
| 5 | <https://developers.cloudflare.com/agents/model-context-protocol/transport/> | fetched 2026-08-31 |
| 6 | <https://developers.cloudflare.com/agents/model-context-protocol/protocol/tools/> | fetched 2026-08-31 |
| 7 | <https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http> | fetched 2026-08-31 |
| 8 | <https://modelcontextprotocol.io/specification/2026-07-28/basic/transports> | fetched 2026-08-31 |
| 9 | <https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/authorization> | fetched 2026-08-31 |
| 10 | <https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector> | fetched 2026-08-31 |
| 11 | <https://code.claude.com/docs/en/mcp> | fetched 2026-08-31 |
| 12 | <https://developers.cloudflare.com/workers/platform/limits/> | fetched 2026-08-31 |
| 13 | <https://developers.cloudflare.com/workers/static-assets/routing/worker-script/> | fetched 2026-08-31 |
| 14 | npm registry — `agents`, `@modelcontextprotocol/{server,core,client,sdk,inspector}`, `@cloudflare/workers-oauth-provider` | queried 2026-08-31 |
| 15 | Shipped types & bundles: `agents@0.22.0`, `@modelcontextprotocol/server@2.0.0` (tarballs read directly) | 2026-08-31 |
