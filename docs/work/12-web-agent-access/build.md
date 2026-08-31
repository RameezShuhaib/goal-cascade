# 12 — Agent access, and confirming a goal deletion that would destroy something

Two web-only pieces, built against an API that was being written at the same time.

**`npm run typecheck --workspaces`: clean. `npm test -w @goal-cascade/web`: 221 passing** (197 before;
+24 new, no test weakened and none removed — the one existing delete test was rewritten, see §2.5).
**`npm run build -w @goal-cascade/web`: succeeds**, `dist/sw.js` emitted with its 13-entry precache
manifest. No dependency added. `apps/api/**`, `packages/shared/**` and `wrangler.jsonc` untouched.

---

## 0. The thing to read first: the UX design doc does not exist

The brief says `docs/research/UX-API-TOKEN.md` is a completed UX design — eleven states, all copy written
verbatim, placement justified against the navigation rules — and to read it in full before writing
anything. **It is not in this worktree, not on `origin/main`, and not in any commit on any branch**
(`git log --all -- docs/research` is empty; `docs/research/` does not exist). It was not deleted; it was
never committed.

So the design was reconstructed from the summary in the brief, which is specific enough to be actionable:
show-once, hash-only, exactly one per account, replaced in one tap; inside the existing Account sheet as a
section above Sign out, *not* a third icon in the top-right cluster (R-nav-11); re-authentication guards
creating and replacing, not reading status. Both owner overrides are honoured: **no config snippet**, and
the MCP URL is read from the server or derived from `window.location.origin` — never a hardcoded hostname.

**What that means for review.** The behaviour should be right. The *copy* is mine, not the specialist's:
every user-visible string in `src/components/AgentAccess.tsx` is a guess at the register of a doc I could
not read. If the doc turns up, diff the strings — the structure will survive, the wording may not. The
eleven states I implemented are listed in §1.2; if the doc's eleven are a different eleven, that is the
place to look.

---

## 1. Agent access

### 1.1 Where it lives, and why it is not a second sheet

`src/components/AgentAccess.tsx`, rendered by `AccountSheet` in `src/components/TopActions.tsx`, between
"Verify this email address" and "Sign out". Sign out stays last: the order is identity, then the thing you
came here to set up, then the way out.

It is a **section inside the Account sheet, not a sheet of its own.** `Sheet` installs a document-level
capture listener for Escape and Tab; two mounted sheets means two focus traps and two handlers racing over
one keypress, and `aria-modal` on the outer one hides the inner from assistive tech. The brief says "use
the existing `Sheet` component, do not invent a second modal pattern" — nesting one inside another would
have been inventing a second pattern in all but name. So the whole flow (status → password → reveal →
revoke) happens inside the Account sheet's own trap: one dialog, one way out, and the reveal is reachable
by Tab from the button that asked for it. *This is a judgement call and the orchestrator may overrule it* —
if the design doc specifies a dedicated sheet, moving it is a wrapper, not a rewrite.

### 1.2 The eleven states

| # | State | What is on screen |
|---|---|---|
| 1 | Checking | "Checking…"; the create button is disabled |
| 2 | Status unreadable | "Couldn't check whether a token exists." + `Try again` (refetches) |
| 3 | No token yet | "No token yet." + `Create a token` |
| 4 | One exists | "Created *Mon 31 Aug* · ends in *34kt*" + `Replace token` + `Revoke` |
| 5 | Password (create) | password field, `Create token` / `Cancel` |
| 6 | Password (replace) | as 5, plus "Replacing it stops the current token working straight away." |
| 7 | Working | the submit button reads `Creating…` / `Replacing…` and is disabled |
| 8 | Password refused | "That password doesn't match." beside the field, in a `FieldError` |
| 9 | Revealed | the show-once sentence, MCP URL + Copy, Token + Copy, `Done` |
| 10 | Copied | that row's button reads `Copied` for 2.4s; the live region says so |
| 11 | Clipboard refused | the value is focused and selected, "press ⌘C, or Ctrl+C, to copy it" |

A twelfth, small one: revoking asks once in the app's existing `discardBar` strip — "Revoke this token?
Anything using it stops working." `Revoke` / `Keep it` — rather than going on the first tap. That is the
same ask-once shape `Sheet` already uses for an unsaved draft, so it is not a new pattern.

### 1.3 Show once, and what "once" is enforced by

The plaintext exists on this side of the wire in exactly one place: the `phase` state of one mounted
component. Three things make that true rather than merely intended:

- **It is never written to the query cache.** `useCreateAgentToken`'s `onSuccess` writes only
  `{ createdAt, last4 }` into `keys.agentToken`. The cache is persisted to `localStorage` by
  `lib/queryClient.ts`, so a token in it would be a token on disk.
- **It is dropped from the mutation's own state** — `create.reset()` is called in the same tick the value
  is lifted into `phase`, so `create.data` does not hold it either.
- **Closing the sheet unmounts the component**, and there is no read that can return it again.

Two tests pin this: one closes and reopens the sheet and asserts only `last4` comes back, one greps the
whole query cache for the plaintext.

### 1.4 Copy, and the fallback that is not decoration

`src/lib/clipboard.ts`. Three rungs: the async Clipboard API; then `document.execCommand('copy')` over the
field; then leave the text **focused and selected** and report `'unavailable'` so the caller can name the
two keys. Rung 2 selects the field whether or not it succeeds, which is what makes rung 3 free.

Both values are rendered as `readOnly` `<input>`s rather than `<code>` blocks. That is the reason the
fallback is real work rather than an apology: the text is already in something focusable and selectable, so
"we have selected it, press ⌘C" is a complete instruction with nothing left to do but press it.

`navigator.clipboard` is absent on an insecure origin (a phone opening the PWA over plain http on the LAN),
can be denied by policy, and needs a focused document. jsdom has none of it, so the failure path is the
*default* in tests and the success path is the stubbed one — the fallback is exercised by construction.
**Watch out:** `userEvent.setup()` installs its own `navigator.clipboard`, so every clipboard stub in the
tests is installed *after* `renderApp`, or userEvent wins and every copy silently succeeds.

### 1.5 Accessibility

- One `aria-live="polite"` region, mounted with the section (so it pre-exists any change — a live region
  inserted together with its content is announced unreliably). It carries both required announcements:
  "Your agent token is ready. It is shown once — copy it now." and "Token copied to the clipboard." /
  "MCP URL copied to the clipboard." The secret itself is never read aloud.
- The visible show-once sentence is plain text, deliberately: a second live region there would say the same
  thing twice.
- On reveal, focus moves into the token field and selects it, so ⌘C costs zero taps.
- The two copy buttons carry `aria-label="Copy MCP URL"` / `"Copy Token"` (and `"… copied"` after) because
  two buttons named "Copy" in one dialog are two identical names. The visible word stays inside the
  accessible name (WCAG 2.5.3).
- The password form is a real `<form>`, so Enter submits. Every `<button>` states its `type`.
- Tested end to end by keyboard: Tab to the button, Enter, type, Enter, and the token appears — with an
  assertion on every Tab that focus is still inside the dialog.

### 1.6 Colour

No new colour. Everything is an existing token. The clipboard-refusal line uses `S.body` rather than the
amber `S.warn`: it is a sentence that has to be read at 12px on `paper`, and `warn` is tuned for a
one-word row label. `tests/screens/contrast.test.ts` is untouched and still passes.

---

## 2. Confirming a goal deletion

### 2.1 The bug

`GOAL_HAS_CHILDREN` fires only when a goal has descendant **goals**. A Monthly leaf is childless by that
test — and a Monthly leaf is exactly where the work lives. So the goal holding forty open tasks, their full
activity history and its backlog was the one goal that deleted on the first tap with nothing said, while a
Quarterly goal holding two empty sub-goals got a confirmation. Q-5 does not say "confirm a subtree delete";
it says deletion is confirmed with the counts named.

### 2.2 The fix

`DeleteGoalSheet` now reads `DELETE /goals/:id?dryRun=true` when it opens, for **every** goal, and does not
offer the delete button until the answer lands (`disabled` while `previewQ.isPending`). That wait is the
fix. Nothing is derived from a client-side subtree walk: the goal tree in the cache does not know how many
tasks hang off a leaf, and a confirmation that guesses is worse than one that waits.

| Preview says | Sheet says | Button |
|---|---|---|
| still loading | "Checking what this would remove…" | `Delete`, disabled |
| anything > 0 | "This removes *N sub-goals*, *M tasks* and *K backlog items*. Ideas and learnings tagged here move to Unsorted. There is no undo." | `Delete everything` |
| all zero | "This goal holds nothing else. There is no trash and no undo." | `Delete` |
| the read failed | "There is no trash and no undo." (as before) | `Delete` |

`cascade=true` is sent whenever anything would go with the goal, not only when a sub-goal would. The server
needs it only for sub-goals; sending it for a leaf full of tasks costs nothing and keeps "what the button
said" and "what was authorised" the same sentence.

### 2.3 Tone

The count sentence is the one that was already there, unchanged, so the register did not move. It sits in
`role="status"` — polite, because the paragraph is replaced under the reader when the counts arrive and the
replacement is the point. Not `role="alert"`. No red panel, no icon, no typing the goal's name, and `Keep
it` is still a plain button beside it. Tested: no `alert` and no `textbox` in the dialog.

### 2.4 The old path is still there

If the dry run fails — an API that does not know the parameter answers 422, since every query schema is
`.strict()` — the sheet says only what it can stand behind, the button is enabled, and the first tap is
refused with `GOAL_HAS_CHILDREN` carrying the counts exactly as before. That is why `GOAL_HAS_CHILDREN`
stays `quiet` in `useCommand`. So this ships safely against an API that has not landed the dry run yet: the
only regression is that a leaf's tasks are still unannounced, which is the status quo.

### 2.5 The one existing test that changed

`tests/screens/goals.test.tsx` → "the refusal IS the confirmation" was rewritten. Its assertion is
preserved verbatim as the last case of the new describe ("and when the dry run is not there, the
`GOAL_HAS_CHILDREN` refusal still is"), with a handler that also refuses the dry run — so the old flow is
still pinned, under the condition that now produces it. Four cases were added around it, including the leaf
case the bug was about and the "button is not offered while checking" case.

---

## 3. Every assumption about an endpoint that did not exist

All of them live in **`apps/web/src/api/contracts.ts`** — paths, Zod schemas, one helper. Nothing in
`api/queries.ts`, `components/AgentAccess.tsx` or `components/GoalModals.tsx` names a path or a field that
is not re-exported from there, so re-pointing is one file.

| # | Assumed | Confidence | If it is wrong |
|---|---|---|---|
| 1 | Path is `/api/me/agent-token` | medium | one constant in `ASSUMED_ENDPOINTS`. Chosen because `/me/preferences` and `/me/change-password` are already at that prefix in the shared `ENDPOINTS` map |
| 2 | `GET` → `{ token: { createdAt, last4 } \| null, mcpUrl?: string }` | medium | `AgentTokenStatusResponse`. `token: null` is a state, not a 404 |
| 3 | `POST` with body `{ password }` → `{ token: "<plaintext>", createdAt?, last4?, mcpUrl? }` | medium | `AgentTokenCreatedResponse`. `createdAt`/`last4` are **optional on purpose**: if the server answers with the secret and nothing else, a schema insisting on the metadata would throw `BAD_RESPONSE` and destroy the one copy of a token already written to the database. `last4` falls back to `token.slice(-4)` |
| 4 | `POST` is a command and carries `Idempotency-Key` | high | it goes through `useCommand`, like every other write |
| 5 | `DELETE` → `{ deleted: boolean }`, idempotent, **no password** | medium | `AgentTokenRevokedResponse` |
| 6 | A wrong password comes back as **401 or 403** | **low** | `refusalCopy()` in `AgentAccess.tsx` reads the STATUS, not the code, because 401/403/422 are all defensible. A 422 would currently read as a validation message rather than "That password doesn't match." — one line to fix once the API decides |
| 7 | `mcpUrl`, when present, is absolute | medium | otherwise it falls back to `location.origin + '/mcp'`, which is right in dev, preview and production |
| 8 | `DELETE /goals/:id?dryRun=true` returns the counts and writes nothing | high (given) | `goalDeletePreview` in `api/http.ts` |
| 9 | The dry-run body is `{ subGoals, tasks, backlogItems }` | medium | `GoalDeletePreviewResponse` accepts **three** shapes: top-level (the shape `GOAL_HAS_CHILDREN`'s `details` already uses), nested under `counts`, or the existing `DeleteGoalResponse` with `removed.goals` (from which `subGoals = goals - 1`). Tolerance about shape only — anything else fails loudly and falls back to §2.4 |
| 10 | The dry run needs no `Idempotency-Key` | high | it is modelled as a React Query read, not a command, because it does not write |

### What must be re-pointed when the backend lands

1. **`apps/web/src/api/contracts.ts`** — replace each schema with the shared one (`import { … } from
   '@goal-cascade/shared'`) and each path with its `ENDPOINTS` entry. Delete the file if everything in it
   has a shared equivalent; the four methods in `api/http.ts` are the only importers.
2. **Assumption 6** — set `refusalCopy()` to match the code the API actually answers with for a wrong
   password, and narrow `AGENT_TOKEN_QUIET` in `api/queries.ts` accordingly. It currently quiets
   `UNAUTHENTICATED`, `FORBIDDEN`, `VALIDATION_FAILED`, `RATE_LIMITED` and `NOT_FOUND`; `NOT_FOUND` is
   quiet only because until the route ships every call is a 404, and should come out once it does.
3. **`apps/web/tests/msw/fixtures.ts`** — `agentTokenStatus` / `agentTokenCreated` are hand-written; build
   them from the shared schemas like every other fixture, so a drift fails a test.
4. **`apps/web/tests/msw/handlers.ts`** — the default `DELETE /api/goals/:id` handler branches on `dryRun`;
   check the branch matches the real route's behaviour.
5. If the API names its MCP endpoint anywhere but `mcpUrl`, that is `MCP_PATH` and one field in
   assumption 2.

### Anything the orchestrator should overrule

- The section-not-a-sheet decision (§1.1), if the missing design doc says otherwise.
- Every user-visible string in `AgentAccess.tsx` (§0) — the design's copy was written verbatim and is lost.
- Assumption 6 is genuinely a guess, and it is the one a user meets on their first typo.

---

## Contract reconciliation

The backend shipped `/me/api-token` while §3's assumptions were being written against an endpoint that did
not exist yet. The API is authoritative and deployed; nothing under `apps/api/**` or `packages/shared/**`
was touched. Everything below is what the web client now does instead.

### Assumed vs. real

| # | Thing | Assumed (§3) | Real (`packages/shared`, `me.routes.ts`, `goals.routes.ts`) |
|---|---|---|---|
| 1 | Path | `/me/agent-token`, a local constant in `ASSUMED_ENDPOINTS` | **`/me/api-token`** — `ENDPOINTS.meApiToken`. Every UI call was 404ing in production |
| 2 | `MCP_PATH` | re-declared in `contracts.ts` as `'/mcp'` | `MCP_PATH` from `@goal-cascade/shared` — same value, one owner |
| 3 | Status response | `{ token: { createdAt, last4 } \| null, mcpUrl?: string }` | **`ApiTokenStatusResponse`** — `mcpUrl` is **required** (`z.url()`) and `serverNow` is present too. The assumed schema would still have parsed (unknown keys are ignored), but the client treated the URL as optional and never recorded the server clock |
| 4 | Create response | flat **`{ token: "<plaintext>", createdAt?, last4?, mcpUrl? }`** | **`CreateApiTokenResponse`** — the secret is nested: **`{ token: { createdAt, last4, plaintext }, mcpUrl, serverNow }`**. the assumed schema typed `token` as `z.string()`, so the real body would have failed to parse as `BAD_RESPONSE` — destroying, on the one screen that can never re-read it, a plaintext already written to the database |
| 5 | Create + `Idempotency-Key` | assumed a command | **correct, and required** — `POST E.meApiToken` is behind the `idempotent` middleware, so a call bypassing `useCommand` gets `400 IDEMPOTENCY_KEY_MISSING`. Verified: `useCreateAgentToken` runs through `useCommand`, which mints the key per intent |
| 6 | Revoke response | `{ deleted: boolean }` | **`RevokeApiTokenResponse` — `{ revoked: true, serverNow }`**. `deleted` does not exist; the parse would have thrown `BAD_RESPONSE` on a revoke that in fact succeeded |
| 7 | Revoke + `Idempotency-Key` | not sent | **correct** — `.delete(E.meApiToken, …)` carries **no** `idempotent` middleware. Idempotence here is a property of the operation, not of a stored key |
| 8 | Wrong password | "401, 403 or 422 — undecided" (§3 #6, flagged **low**) | **`422 VALIDATION_FAILED`**, worded identically to `change-password` so the pair cannot become a password oracle. 422 alone would have rendered the generic "Couldn't save — check the values." |
| 9 | Delete-preview query param | `?dryRun=true` | **correct** — `DeleteGoalQuery` is `{ cascade?, dryRun? }`, both `z.stringbool()` |
| 10 | Delete-preview response | **three** plausible shapes, unioned | **exactly one**: the whole **`DeleteGoalResponse`** with `deleted: false` — `{ removed: { goals, weeklyFocuses, tasks, taskEvents, backlogItems }, untagged: { ideas, learnings }, serverNow }`. It is guess 3 of the three. `removed.goals` counts the goal itself, so `subGoals = removed.goals - 1` |
| 11 | Delete-preview + `Idempotency-Key` | not sent | **correct** — the route has no `idempotent` middleware, and a dry run writes nothing |
| 12 | Token prefix | fixture used `gcs_` | **`API_TOKEN_PREFIX` = `gcm_`** (**G**oal **C**ascade **M**CP) |

### What changed

- **`apps/web/src/api/contracts.ts` is deleted.** Every path and schema in it has a shared equivalent, so
  keeping any of it would be restating the contract the two sides drifted over. The two genuinely
  web-only things it also held moved to their single consumers: the delete-preview *projection*
  (`countsOf`, `destroysSomething`) into `components/GoalModals.tsx`, and the lenient parse of the
  show-once response into `api/http.ts`.
- **`api/http.ts`** — `agentTokenStatus` / `createAgentToken` / `revokeAgentToken` now hit
  `ENDPOINTS.meApiToken` and parse `ApiTokenStatusResponse` / `RevokeApiTokenResponse`;
  `goalDeletePreview` parses `DeleteGoalResponse` and nothing else.
- **The show-once defensiveness is kept, and is now the only relaxed parse in the client.**
  `ShownOnceApiTokenResponse` is **derived** from the shared `CreateApiTokenResponse`
  (`.shape.token.partial().required({ plaintext: true })`), so a field renamed in `packages/shared` is a
  type error here rather than a silent drift — but the only field the client *insists* on is
  `token.plaintext`. `createdAt`, `last4`, `mcpUrl` and `serverNow` each have a local fallback, so no
  future drift in a field the screen does not render can throw away a token already written to the
  database. Nothing else in the client relaxes a contract; everywhere else the data can be re-read.
- **`api/queries.ts`** — reads `d.token.createdAt` / `d.token.last4` (falling back to
  `d.token.plaintext.slice(-4)`), and patches the status cache only when a status read has already landed,
  because `ApiTokenStatusResponse` now carries `mcpUrl` and `serverNow` and half a response is not a read
  model. The invalidation that follows fetches the rest.
- **`components/AgentAccess.tsx`** — imports `MCP_PATH` from `@goal-cascade/shared`, lifts the secret from
  `data.token.plaintext`, and `refusalCopy()` now catches `VALIDATION_FAILED` alongside 401/403. No state,
  flow or user-visible string changed.
- **`components/GoalModals.tsx`** — projects the sheet's three numbers out of `removed`.
- **MSW** — `tests/msw/handlers.ts` serves `/api/me/api-token` (the POST, and only the POST, wrapped in the
  `Idempotency-Key` check, mirroring the route); the goal DELETE returns one `DeleteGoalResponse` with
  `deleted: !dryRun`. `tests/msw/fixtures.ts` mirrors the real shapes, derives its plaintext from
  `API_TOKEN_PREFIX` and its `mcpUrl` from the request origin the way `me.routes.ts` does, and gained
  `agentTokenAbsent` / `agentTokenRevoked`.
- **Tests.** Nothing was skipped, weakened or deleted. Two assertions encoded the wrong contract and were
  corrected rather than retired:
  - *"the server's own mcpUrl wins when it names one"* previously worked only because the create fixture
    omitted `mcpUrl` — the real create response always carries it. The handler now overrides **both** the
    status and the create with the named URL, which is what a deployment on its own hostname actually
    does, and the assertion is unchanged.
  - *"a wrong password is refused next to the field"* stubbed a `FORBIDDEN`; it now stubs the real
    `422 VALIDATION_FAILED` with the API's own sentence.
  - *"when the dry run is not there, the GOAL_HAS_CHILDREN refusal still is"* kept its assertions; only
    its premise changed, from "an API without the parameter refuses the unknown query" (no longer
    possible — the parameter is real) to "the preview fails for any reason", which is the fallback the
    sheet actually needs.
  - One test was **added**: a create that answers with `token.plaintext` and nothing else still reveals
    the token and derives the MCP URL — the defensiveness in §"show-once" above, held down by a test
    rather than by a comment.

### Still open

- §3 #6's note to narrow `AGENT_TOKEN_QUIET` once the API decides: `NOT_FOUND` no longer needs to be quiet
  for the reason given there (the route ships), but it is left in place — it is not this change's call to
  make, and quieting it costs nothing while `refusalCopy` still explains it in the field.

## Walkthrough fixes

Three defects the browser walkthrough (`docs/work/09-e2e-browser/report.md#agent-access--deletion-confirmation`)
found in the shipped UI. Narrow fixes; nothing was redesigned, no test was weakened, and
`apps/api/**` and `packages/shared/**` were not touched — the backend was already right.

### 1. The MCP URL was show-once, and is not a secret

`AgentAccess` rendered the URL only inside the `Revealed` panel, so the endpoint inherited the
token's show-once behaviour: dismiss the reveal and the only in-app way to read
`https://goals.rameezshuhaib.com/mcp` back was to **replace the token** — destroying a working
credential to recover a public string.

`CopyRow` for the MCP URL now renders in the non-revealed branch too, so it is present in **every**
state: while the status read is in flight, when it fails, when there is no token yet, when one
exists, and while the password form is up. The reveal panel keeps its own copy of the row (it shows
`phase.mcpUrl`, the value the create response named), so nothing about the show-once path changed.

Confirmed against the contract rather than assumed: `ApiTokenStatusResponse` declares `mcpUrl` as a
**required** `z.url()` alongside `token: … .nullable()` (`packages/shared/src/commands.ts`), and
`me.routes.ts` builds it from `new URL(c.req.url).origin` before it asks the service whether a token
exists — so the status read carries it when `token` is `null`. The client reads
`statusQ.data.mcpUrl`; the origin-derived string is only the fallback for a read that has not landed
or has failed, which is what it already was.

Empty state before a token exists is deliberate, not incidental: knowing the endpoint is part of
deciding whether to make a credential for it.

### 2. Copy feedback was assistive-only

The button already flipped `Copy` → `Copied` for `COPIED_MS`, but the walkthrough looked for
confirmation and saw none — a 12px word swapping inside a control the eye has just left is easy to
miss, and the only other channel was the 1×1 visually-hidden `aria-live` node.

So the visible channel is now two things, not one: the label flip **plus** a
`Copied to the clipboard.` line in the same slot the clipboard refusal uses, directly under the
value it is about. Both are per-row state (`copied.field`), so copying the URL never confirms the
token and vice versa — the confirmation moves rather than accumulating. The live region is
**unchanged**: it still says which value (`MCP URL copied to the clipboard.`), still says it once,
and is still the only thing a screen reader is given. `S.T.mut` is the app's existing quiet grey
(4.61:1 on `paper`, 4.99:1 on `card`); no colour was introduced, so `tests/contrast.test.ts` has
nothing new to check.

The toast was considered and rejected. `UIToast` sits at `zIndex: 60` and would clear the sheet's
`43`, but the confirmation belongs at the point of action — one of two adjacent rows — and a
floating bar at the bottom of the screen cannot say which row without repeating its label.

Clipboard failure was re-checked, since the walkthrough never exercised it: both rungs still work
(`lib/clipboard.ts` unchanged), the value is still focused and selected, the two keys are still
named, and the button still refuses to claim a success it did not have. It is now covered in the
resting state as well as in the reveal.

### 3. "removes 0 sub-goals"

`DeleteGoalSheet` interpolated all three counts unconditionally, so a Monthly leaf read
`This removes 0 sub-goals, 2 tasks and 1 backlog item.` — naming a loss that is not a loss.
`removalList()` in `components/GoalModals.tsx` drops any category at zero and joins what is left
with commas and a final "and": one category reads `2 tasks`, two read `2 tasks and 1 backlog item`,
three keep the original sentence exactly. `plural()` still decides each surviving noun's ending, so
`1 backlog item` stays singular.

`destroysSomething()` is unchanged and still gates the branch, so `removalList` is never called with
every count at zero — that is the empty-goal state, which keeps its own distinct copy
("This goal holds nothing else. There is no trash and no undo.") and its plain `Delete` button.

### Tests

Twelve added, none removed or weakened; `apps/web` goes 222 → 234.

- **`tests/screens/agentAccess.test.tsx`** — a new `the MCP URL is not show-once` describe covering
  the five states (no token, no token with a server-named `mcpUrl`, resting beside an existing
  token, after `Done` dismisses the reveal, and during the password form), plus four in
  `— copying`: the visible confirmation alongside the live region, per-row independence across both
  controls, the revert after `COPIED_MS` under fake timers, and a copy — and a refusal — driven from
  the resting state.
- **`tests/screens/goals.test.tsx`** — one existing assertion was **corrected, not retired**: `THE
  BUG: a leaf goal with no sub-goals…` asserted `/0 sub-goals, 40 tasks and 6 backlog items/`, which
  encoded the defect. It now asserts the whole sentence and that `0 sub-goals` is absent. Two tests
  added for the one-category (`1 task`) and two-category (`1 sub-goal and 1 backlog item`) joins,
  each also asserting the omitted category is unnamed.

The keyboard test still passes unchanged — the two new focusable elements sit inside the Account
sheet, so the trap and the tab order are as they were.
