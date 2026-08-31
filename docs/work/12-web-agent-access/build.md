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
