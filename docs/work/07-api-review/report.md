# 07 — API review

An adversarial review of the API built by three parallel agents (03-goals-plan, 04-tasks,
05-backlog-capture) on the 01-foundation spine. The reviewer wrote none of this code.

`npm run typecheck` and `npm run test` pass in `apps/api` (**32 files, 345 tests**, up from 293) and
`packages/shared` (**21 tests**). `apps/web/` was not touched.

Every finding below carries the command that produced it and the output. Where a fix changed behaviour,
the pre-fix state was restored, the test run red, and the fix re-applied — a green test that was never
red proves nothing.

---

## Findings, by severity

| # | Finding | Severity | State |
|---|---|---|---|
| 1 | `expectedChanges: 0` had silently stopped meaning "must change zero rows" | HIGH | **FIXED** |
| 2 | The Q-5 cascade delete orphaned rows it had not read | HIGH | **FIXED** |
| 3 | `PUT /plan` did not deliver the Q-3 guarantee it documents | HIGH | **FIXED** |
| 4 | The "no email can be sent" guard was a keyword filter, defeated four ways | HIGH (claim) | **FIXED** |
| 5 | Leaf-gains-a-child destroyed weekly-focus history for every week | MEDIUM | **FIXED** |
| 6 | The error-envelope claim was false for `/api/auth/*`; `RATE_LIMITED` unreachable | MEDIUM | **FIXED** (documentation + tests) |
| 7 | A task/item can still be inserted against a goal being deleted concurrently | MEDIUM | **DEBATABLE — not fixed** |
| 8 | `GET /ideas` / `GET /learnings` accepted unvalidated query params | LOW | **FIXED** |
| 9 | The allowlist refusal test was a substring match on raw text | LOW | **FIXED** |
| A | Contract gap: `AMBIGUOUS_CONVERSION_TARGET: 409` | — | **IMPLEMENTED** |
| B | Contract gap: `replanOptions: string[]` on `GoalDetailResponse` | — | **IMPLEMENTED** |
| C | Account recovery: `POST /me/change-password` + `POST /internal/reset-link` | — | **IMPLEMENTED** |

Attacked and found clean, with evidence: authorization on every route, the sign-up allowlist, the week
model across five kinds of boundary, idempotency, response-shape contract drift, request strictness, and
the three cross-agent seam round trips. See **Clean** below — a negative result from a serious attempt is
worth as much as a positive one.

---

## 1 — HIGH — `expectedChanges: 0` had silently stopped meaning "must change zero rows"

**FIXED.** `apps/api/src/application/ports/statement.ts`, `application/services/guarded-batch.ts`.

Two agents changed `GuardedBatch` independently and git auto-merged them without a conflict, which is
exactly when a merge is clean but wrong. The result:

- the post-check said `if (expected === 0) return;` — "best-effort, assert nothing";
- `preconditionOf` said `if (expected < 1 …) return [];` — no precondition below 1.

So `0` no longer meant anything at all, in either half. The port's own documentation still said
*"Rows the statement must change; default 1. Use 0 for best-effort statements that may legitimately
no-op"* — two contradictory meanings for one value, which is how findings 2 and 3 below happened.

The tasks agent's change was correct in isolation: the lazy carry-log insert (`insertCarriedIgnoreStmt`,
R-task-29/Q-17) genuinely writes 1 row on the first read of a week and 0 on every re-read, and an
exact-equality check turned the successful first insert into a 409 on a GET. But `0` was the wrong lever:
two other callers compute `expectedChanges` from a row count and legitimately reach 0
(`GoalService.remove`, `PlanService.save`), and both were silently disarmed.

**Fix.** `expectedChanges?: number | 'any'`. A number is asserted exactly, `0` included, and now also
produces a precondition. `'any'` is the only opt-out; the carry-log insert is its one caller. This is the
`'any'` the goals agent proposed in `docs/work/03-goals-plan/build.md` §5.

Call-site audit — every guarded write in the tree:

```
$ grep -rn "expectedChanges" apps/api/src | grep -v ports/ | grep -v guarded-batch
plan.service.ts:112      expectedChanges: existing.length   -> finding 3
activity-log.ts:102      expectedChanges: 'any'             -> the one best-effort caller
backlog.service.ts:342   expectedChanges: existing.length   -> guarded by `existing.length > 0`; see Debatable
backlog.service.ts:393   expectedChanges: links.length      -> same
goal.service.ts:263      expectedChanges: rows              -> finding 2
goal.service.ts:276      expectedChanges: subtree.length    -> never 0 (the goal itself)
goal.service.ts:366      expectedChanges: doomed.length     -> guarded by an early return
```

Tests: `apps/api/tests/review/guarded-semantics.test.ts` (8). The pre-existing negative control —
*"`expectedChanges: 0` allows a statement that may legitimately match nothing"* — still passes unchanged,
because 0 expected against 0 present is still success.

---

## 2 — HIGH — the Q-5 cascade delete orphaned rows it had not read

**FIXED.** `apps/api/src/application/services/goal.service.ts` (`remove`).

`docs/work/03-goals-plan/build.md` §3.5 promises: *"a task created under the subtree between the read and
the write rolls the whole delete back with a 409 rather than leaving an orphan."* The mechanism was:

```ts
const removal = (label, stmt, rows) => {
  if (rows > 0) writes.push({ label, stmt, expectedChanges: rows });   // <- the hole
};
```

When the read found **zero** rows of a kind, no statement was emitted, therefore no precondition existed,
therefore a row created in that window survived. And nothing else catches it: `schema.ts` deliberately
declares **no foreign key** on `tasks.goal_id`, `backlog_items.goal_id` or `weekly_focus.goal_id` —
referential integrity is held by the cascade being transactional, which is precisely what had a hole.

`0 → 1` is not an exotic case; it is the ordinary one. Delete a goal that has no tasks while another
device creates one.

**Evidence.** `apps/api/tests/review/cascade-race.test.ts` decorates the repo read so the concurrent write
lands after the read and before the batch — the read-then-write window, deterministically.

Pre-fix (the `if (rows > 0)` skip restored):

```
$ npx vitest run tests/review/cascade-race.test.ts
 x a TASK created between the read and the batch is a 409, not an orphan (the read found ZERO)
 x a BACKLOG ITEM created between the read and the batch is a 409, not an orphan
 x a WEEKLY FOCUS created between the read and the batch is a 409, not an orphan
-   "itsGoalSurvives": true,      -   "status": 409,
+   "itsGoalSurvives": false,     +   "status": 200,
```

`itsGoalSurvives: false` with the row still present **is** the orphan: the goal was deleted, the row was
not. The assertion is stated as one object so the failure prints the orphan rather than a status code.

Negative controls in the same file: when the read found **one** row, the same race was already a 409 — so
the guard worked and the hole was exactly the zero case. Post-fix, all seven pass, including *"the
ordinary cascade still succeeds and still reports its counts"* and *"a childless goal with nothing under
it still deletes cleanly"* — a fix that 409s honest deletes would be worse than the bug.

```
$ npx vitest run tests/review/cascade-race.test.ts
      Tests  7 passed (7)
```

---

## 3 — HIGH — `PUT /plan` did not deliver the Q-3 guarantee it documents

**FIXED.** `apps/api/src/application/services/plan.service.ts`, plus `IWeeklyFocusRepo.deleteByWeekStmt`.

`docs/work/03-goals-plan/build.md` §3.4: *"a concurrent save from another device loses cleanly with
`409 CONCURRENT_UPDATE` instead of interleaving two half-plans (Q-3)."* It did not, in two ways:

1. The delete targeted **only the goal ids this save had read**
   (`deleteByGoalsAndWeekStmt(userId, existing.map(f => f.goalId), week)`). A row another device added for
   a goal absent from that list survived the "whole-week replace", so the stored plan became a **merge of
   two plans** — a leaf the saving device believed dormant stayed active.
2. When the week was empty the statement was skipped entirely (finding 1), so a concurrent first save of a
   fresh week was clobbered with no precondition at all.

**Fix.** Delete by **week**, with `expectedChanges = <rows read for that week>`. The precondition then
reads "this week still holds exactly the plan I was built on", which is the guarantee as written — and it
is meaningful at 0.

```
$ # pre-fix behaviour restored:
$ npx vitest run tests/review/guarded-semantics.test.ts -t "Q-3"
 x the week was EMPTY when this save read it, and another device planned a leaf meanwhile -> 409
 x the week held one row and another device added a SECOND for a goal this save never read -> 409
AssertionError: expected 200 to be 409
      Tests  2 failed | 1 passed | 5 skipped (8)
$ # fix restored:
      Tests  3 passed | 5 skipped (8)
```

The third test in that block is the negative control — an **uncontended** save of the same shape — and it
passed in both states, so the 409 is the race and not the fix over-firing.

`deleteByGoalsAndWeekStmt` is now unused. It was kept rather than deleted; see **Debatable**.

---

## 4 — HIGH (claim) — the "no email can be sent" guard was a keyword filter

**FIXED.** `apps/api/tests/security/no-real-email.test.ts`.

The tree is genuinely clean today — no `send_email` binding, no adapter, `createEmailSender` passes a
literal `null`. But the guarantee was **asserted, not enforced**: the guard was five regexes over file
text, and it stayed green through four independent evasions.

The sharpest was the comment stripper itself. It was `source.replace(/\/\*[\s\S]*?\*\//g, '')`, which does
not know what a string literal is: a file that declares a `'/*'` constant, then a live
`ResendEmailSender` calling `fetch('https://api.resend.com/emails')`, then a `'*/'` constant, had the
adapter deleted before any pattern ran. A verbatim Resend adapter, in `src/infrastructure/email/`, was
invisible. The comment stripping advertised as making the scan *precise* was what made it *blind*. It also
had the opposite bug — `/^\s*\/\/.*$/gm` only stripped whole-line comments, so a *trailing* comment
explaining the absent binding tripped a false alarm.

The other three: rename the class (`OutboundDeliveryAdapter` — a fully wired live sender behind an env var
passed 10/10); split the token (`['re','send'].join('')`); use an extension the glob missed (`.mts`). And
the factory assertion `toMatch(/new LogEmailSender\([\s\S]*?null,/)` is lazy and unanchored, so a ternary
selecting a live adapter still satisfied it — *some* later argument was `null,`.

**Fix — two tiers, and the tier that matters cannot be talked around.**

- **TIER A, capability, on RAW text.** No file under `src/` may contain a bare `fetch(`, `new WebSocket`,
  `cloudflare:sockets`, `cloudflare:email`, `EmailMessage`, a dynamic `import(`, or `eval`/`new Function`.
  Name-blind: it asks "can this reach the network at all", which is the actual invariant, and it runs on
  the source exactly as written so no stripping bug can hide anything. `.fetch(` on an object is
  permitted, which is why `app.fetch(…)` and `c.env.ASSETS.fetch(…)` pass without an allowlist. Plus:
  `src/infrastructure/email/` must contain exactly its three known files; the glob must match named anchor
  files (a glob typo would make every scan vacuous); and `createEmailSender`'s **body** is parsed and must
  contain no ternary, no branch, and no `new` other than `LogEmailSender` with `null` in the fourth
  positional slot.
- **TIER B, names, on comment-stripped text**, so the files may keep explaining why there is no adapter.
  The stripper is now a string-aware character walk, and the provider list gained MailChannels, SES,
  Mandrill, SparkPost, Brevo, nodemailer.

**Proof it now bites.** Each breakage applied, run, reverted, re-run:

```
(b2) token-split provider name, renamed class, bare fetch
 x TIER A — NO file under `src/` can reach the network at all
+   ".../notify-adapter.ts contains a bare `fetch(` — an outbound HTTP request"
 x TIER A — the email layer contains exactly the files it is supposed to, and no more
      Tests  2 failed | 12 passed (14)          -> reverted -> 14 passed (14)

(b4+b5) adapter hidden between comment-delimiter STRINGS, in a .mts file
 x TIER A — NO file under `src/` can reach the network at all
 x TIER A — the email layer contains exactly the files it is supposed to, and no more
 x TIER B — no known mail provider is named anywhere in the source tree
      Tests  3 failed | 11 passed (14)          -> reverted -> 14 passed (14)

(b3) live sender wired behind env.OUTBOUND_MAIL_KEY, class renamed
 x TIER A — `createEmailSender` is a single unconditional construction, with no branch to take
   AssertionError: createEmailSender constructs something other than the sink
 x createEmailSender returns the SINK — `forward` is null, always
      Tests  2 failed | 12 passed (14)          -> reverted -> 14 passed (14)
```

And both controls on `wrangler.jsonc`:

```
NEGATIVE — a TRAILING comment mentioning send_email must NOT trip the alarm
      Tests  14 passed (14)                     <- the old false positive is gone
POSITIVE — a REAL "send_email": [{ "name": "EMAIL" }] binding
 Error: [no-real-email] the vitest environment can send REAL mail: a `send_email` (EMAIL) binding is present.
 > fail tests/setup/no-real-email.ts:28:9       <- kills the WHOLE suite, via the setup file
```

`git diff --stat` was empty after every revert. `tests/setup/no-real-email.ts` (the runtime egress block)
was already sound and is unchanged; it is the layer that caught the binding.

---

## 5 — MEDIUM — leaf-gains-a-child destroyed weekly-focus history for every week

**FIXED.** `apps/api/src/application/services/goal.service.ts` (`exLeafWrites`), plus
`IWeeklyFocusRepo.deleteByGoalsFromWeekStmt`.

**This was the question put to the review, so here is the verdict in full: the proposed alternative holds,
and it is now implemented.**

The author's behaviour: when a leaf acquires a child, delete **every** `weekly_focus` row that goal holds,
across all weeks. The reasoning (`docs/work/03-goals-plan/build.md` §3.1) was S-goal-9-1 — *"the stale row
must not exist"* — and the fear of D-8's silent resurrection: the mockup's ex-leaf kept its focus string,
inert only because `isActive` also required `isLeaf`, and it came back to life the moment the child moved
away.

**The defence against resurrection is not deletion; it is the derivation — and the derivation already does
it.** Every reader was checked:

```
$ grep -rn "listByWeek\|findByGoalAndWeek\|activeLeavesUnder\|focusByGoal" apps/api/src
```

| Reader | How activeness is derived | Can a stale row resurrect? |
|---|---|---|
| `GoalService.toView` | `leaf && !isLife && focusByGoal.has(id)`, `leaf = isLeaf(s.goals, …)` at read time | No |
| `domain/goal-tree.ts` `isActive` / `isDormant` / `subtreeActive` / `activeLeavesUnder` | all gate on `isLeaf(goals, id)` | No |
| `TaskService.assertActiveLeaf` | `isLeaf` **and** `findByGoalAndWeek(…, ctx.currentWeekStart)` | No |
| `IdeaService.requireActiveLeaf` | same | No |
| `BacklogService.resolveConversionTarget` | `activeLeavesUnder(all, …, focusedGoalIds)` | No |
| `PlanService.get` / `TaskService.list` (`plan[]`) | raw rows for the week, no leaf check | **This is the point** — it is how a past week renders truthfully (D-2) |

So leaf-ness is already required at read time everywhere activeness is decided. The only row that could
matter is one for the **current** week, and the alternative deletes exactly that.

Against that, deleting the past is a real loss and it is the exact bug D-2 exists to prevent. D-2 made
focus a per-week table so that *"past weeks render their own focus sentence"* and this week's plan cannot
destroy last week's. Under the author's behaviour, adding a sub-goal today silently rewrites the record of
six weeks ago, and `GET /plan?week=-6` goes blank for a week that really did have a focus.

**On the spec being wrong.** S-goal-9-1's observable assertion is *"it is reported as not active and holds
no focus"* — satisfied either way, because read-time leaf-ness decides it. Its parenthetical *"(the stale
row must not exist — D-2)"* cites D-2 while requiring the thing D-2 forbids. The observable half is the
rule; the parenthetical is an implementation preference, and it is the wrong one.

**The problem the reviewer anticipated, stated honestly:** `GoalView.isActive` for a **past** week is
derived from **today's** tree, because "was a leaf then" is not stored. So for a goal that has since gained
a child, `GET /plan?week=-2` will show its old sentence while `GET /goals?week=-2` reports
`isActive: false`. That divergence is new. It is small — one goal, in the weeks between its focus and its
becoming a parent — and it is strictly better than the alternative, which is that neither read model can
show the truth because the truth was deleted. It does not license a resurrection: the current week is clear
either way.

**Implemented:** delete the current week and any later one, keep the past. ("And future" is belt and braces
— `PUT /plan` refuses a non-current `weekStart`, so no API path creates a future row.)

**Per-test verdict — `tests/plan/plan.test.ts`, "D-8 — the focus is removed for EVERY week, so it cannot
come back if the child moves away later":** *legitimately retired, and strengthened.* Its first assertion,
`expect(await focusesUnder(…)).toHaveLength(0)`, asserted the **mechanism**, not the rule. Its second — the
child is moved away and the ex-leaf comes back `[isLeaf, isActive, dormant] = [true, false, true]` — is the
rule, is what the test exists to prove, and is **unchanged**. The replacement adds: the past row survives
with its sentence, the past week still renders it through `GET /plan`, the current week holds nothing, the
ex-leaf reports `isActive: false` (S-goal-9-1), and the resurrection check is re-run after the move. Five
assertions where there were two.

The two neighbouring R-goal-28 tests needed no change at all: their only focus row is the current week's,
so it is still deleted and they still read zero.

---

## 6 — MEDIUM — the error-envelope claim was false for `/api/auth/*`

**FIXED as documentation and tests — deliberately NOT by re-wrapping the responses.**
`packages/shared/src/errors.ts`, `apps/api/tests/security/error-envelope-scope.test.ts`.

`errors.ts` claimed *"Every non-2xx response from `/api/*` and `/internal/*` has exactly this shape."* Two
refusals do not — and they are the two a new or locked-out user is most likely to hit:

```
SIGNUP_NOT_ALLOWED (403): {"code":"SIGNUP_NOT_ALLOWED","message":"sign-up is not open: …"}
RATE_LIMITED       (429): {"message":"Too many requests. Please try again later."}
```

Both flat, no `error` wrapper. Cause: `app.on(['GET','POST'], '/api/auth/*', …)` **returns** Better Auth's
Response rather than throwing, so `app.onError(errorHandler)` never runs. And the 429 carries no `code` at
all, so `RATE_LIMITED` is declared, documented as client-mappable, and **unreachable**.

**Why not re-wrap.** `apps/web` talks to that router through the Better Auth **client SDK**, which parses
the flat shape, and `tests/auth.test.ts:89` already asserts it (`{ code: 'MISSING_OR_NULL_ORIGIN' }`).
Re-wrapping would break sign-in error handling in order to satisfy a comment. The comment was wrong, not
the code. So the claim was narrowed to the truth, `RATE_LIMITED` was annotated with why nothing emits it
(Q-16: no per-owner write budget; the only limiter is Better Auth's, on its own router), and a new test
pins **both** shapes so the boundary cannot drift unnoticed.

---

## 7 — MEDIUM — a row can still be inserted against a goal being deleted concurrently

**DEBATABLE — not fixed. Reported rather than redesigned.**

Finding 2 closed the cascade's side of the race: a delete that loses now 409s. The other direction is still
open, and it is one-directional:

- `DELETE /goals/:leaf` commits first; then `BacklogService.convert` (or `TaskService.create`, or
  `BacklogService.create`, or `IdeaService.convert`) commits an INSERT naming that goal, having read the
  tree before the delete. The task insert is unconditional and no precondition covers the goal's existence,
  so the row is written against a goal that no longer exists.
- The reverse order is safe: the conversion commits first, the cascade's exact-count precondition is now
  stale, and the delete 409s.

The window is narrow (both must be in flight, and only the delete-first order loses). It is **not** fixed
here because every plausible fix is a design decision spanning four services and the foundation's own
primitives, and picking one unilaterally is exactly what this review is supposed to avoid:

- **A foreign key** on `tasks.goal_id` / `backlog_items.goal_id` / `weekly_focus.goal_id`. Structural and
  total. Needs a migration, and `schema.ts` records a deliberate decision not to have them ("D1 applies FKs
  per statement, and the subtree cascade deletes parents and children in one batched DELETE") — that
  reasoning is about `goals.parent_id` and may not transfer, but it is the foundation owner's call.
- **A first-class `requires?: { table, where, count }` on `GuardedWrite`**, so an INSERT can assert its
  referent still exists. Small, general, and the natural home for it is `GuardedBatch`.
- A no-op guarded UPDATE on the goal row inside the same batch. Works today with no new primitive, but it
  writes to `goals` on every conversion and turns a concurrent goal rename into a false 409.

Recommendation: the `requires` primitive, applied at all four insert sites at once.

---

## 8 — LOW — `GET /ideas` and `GET /learnings` accepted unvalidated query params

**FIXED.** `apps/api/src/api/routes/capture.routes.ts`, `packages/shared/src/commands.ts` (`NoQuery`).

Every other list route names a query schema; these two named none, so `?__x=1` returned 200. Harmless in
itself, but `GET /backlog?goalId=…` **filters** while `GET /ideas?goalId=…` silently returned the
unfiltered list — the shape of mistake a client makes once and never sees. Both now validate against a
strict empty schema and answer 422.

---

## 9 — LOW — the allowlist refusal test could not see a shape change

**FIXED.** `apps/api/tests/security/signup-allowlist.test.ts`.

`expect(await res.text()).toMatch(/SIGNUP_NOT_ALLOWED|single-user|not open/i)` — a substring match on raw
text, which passes for *any* response shape, which is why finding 6 survived. Replaced with a parse:
`expect(await res.json()).toMatchObject({ code: 'SIGNUP_NOT_ALLOWED' })`. Strictly stronger; the test's
subject (a refused sign-up leaves no user row, no session cookie) is untouched.

---

## A / B — the two contract gaps

Both were raised by feature agents that correctly declined to edit a shared file unilaterally.

**`AMBIGUOUS_CONVERSION_TARGET: 409`** — `packages/shared/src/errors.ts`,
`apps/api/src/application/services/backlog.service.ts`. Converting a backlog item whose goal has more than
one active leaf answered `422 VALIDATION_FAILED` with `details.candidates`. The input was well formed — the
product has no single answer yet — so it is a product refusal, not a validation failure, and the client
needs to tell them apart to render a chooser rather than a field error. The candidate list stays in
`details`; re-submitting with `goalId` still resolves it.

*Per-test verdict — `tests/backlog/convert.test.ts` S-backlog-7-2: legitimately retired.* The status and
code assertions changed because the contract changed, on the orchestrator's instruction. Every behavioural
assertion the test exists to make — no silent pick, both candidates named in `details.candidates`, the item
still `open`, naming one of them succeeds and lands the task exactly there — is unchanged.

**`replanOptions: string[]` on `GoalDetailResponse`** — `packages/shared/src/read-models.ts`,
`apps/api/src/application/services/goal.service.ts`. Populated from the existing
`domain/goal-tree.replanPeriods(horizon, today, currentPeriod)`, derived from the **owner's** calendar day
(R-auth-5), empty for a Life goal (R-goal-21). `tests/review/seams.test.ts` asserts it is the *same* list
the server refuses a no-op re-plan with, so the two derivations cannot drift, and that it moves with the
clock rather than being a literal (D-3).

---

## Clean — attacked, nothing found

**Authorization, every route (R-auth-2/3/4).** Two accounts; 39 cross-account attempts covering goals,
tasks, task events, focus rows, backlog items, ideas, learnings, `/bootstrap`, `/me`, `/me/preferences`,
and every id-bearing sub-resource. All 39 -> `404 NOT_FOUND`, byte-identical (status, code **and** message)
to the same request with a valid-but-unowned ULID. No 403 anywhere. Every referenced id is checked, not
just the target: `POST /backlog/:mine/move` onto A's goal, `POST /ideas/:mine/attach` to A's goal,
`PUT /plan` naming A's `goalId`, `POST /tasks` with A's leaf — all 404. The sub-resource case
`DELETE /tasks/:mine/links/:theirLink` -> `404 "link not found"`, and A's link row survived. A's state
after the whole run was unchanged down to `version = 1` on the task: not one guarded write was attempted.
All 39 routes unauthenticated -> 401, reads included. `grep` confirms no `userId`/`ownerId` field exists in
any request schema and the only assignment is from the verified session in `middleware/auth.ts`.

**The sign-up allowlist.** 23 bypass variants: casing (allowed by design, and a second account is still
refused `USER_ALREADY_EXISTS`), surrounding whitespace, Cyrillic a/e, fullwidth `@` and letters, combining
and NFD sequences, a trailing dot on the domain, sub-addressing, a display-name wrapper, angle brackets, a
quoted local part, a dot-atom variation, an embedded space, a null byte, comma injection, a sub-domain, a
suffix domain, an ideographic dot. Every one refused; every one left `user` unchanged. 12 empty/absent/
pattern allowlists (`undefined`, `""`, `"   "`, `","`, `"*"`, `"*@rameezshuhaib.com"`, `".*"`, `"%"`, …)
x 3 addresses = 36/36 `403 SIGNUP_NOT_ALLOWED` — **including the owner's own address**, which is the
correct failure mode: a lost env var closes sign-up rather than opening it. No refusal left a row or a
session cookie; the check is in `databaseHooks.user.create.before`, inside the insert's transaction.

**The week model (D-1).** `apps/api/tests/review/week-boundaries.test.ts` (8). No offset is stored, cached
or compared anywhere: `grep -rn "offset" apps/api/src` returns only `api/week.ts` (the single wire->absolute
resolution), two projection call sites, and prose. `FakeClock` driven across a Monday (a stored
`originWeekStart` does not move; `carryWeeks` re-projects 0 -> 1; last week's plan stops being this week's),
a month end, a quarter end, a year end (`2026-12-28` -> `2027-01-04`), and southern-hemisphere DST:
Pacific/Auckland's spring-forward, where Monday 00:00 local is an hour earlier in UTC than the week before
and a `getDay()` on the UTC instant still says Sunday; plus Australia/Lord_Howe's 30-minute shift. A plan
save that crosses the Monday with the screen open is `409 WEEK_NOT_CURRENT`, not a write into the wrong
week. Carry thresholds land correctly at **exactly** 1 (gray) and **exactly** 2 (red chip), including
across a year end, and depend on the viewed week rather than today (S-task-11-2).

**Idempotency (Q-4).** Already covered end to end and re-verified: replay returns the cached response with
`Idempotent-Replayed: true` and does not re-execute; a different body with the same key -> 422
`IDEMPOTENCY_KEY_REUSED`; an in-flight key -> 409 `IDEMPOTENCY_IN_PROGRESS`; a 5xx releases the key; a 4xx
is cached so a refusal replays as the same refusal; keys are scoped per owner. A replayed conversion
returns the **original** task, and a genuinely second attempt is `409 ALREADY_CONVERTED` with one task in
the database (`tests/backlog/convert.test.ts`, plus `tests/review/seams.test.ts` for the round-tripped
item).

**Contract drift.** 34 endpoints driven through the real router against seeded, non-empty data; every body
strict-parsed against its declared schema plus a recursive undeclared-key walk (a stray key nested inside
`goals[].carrying` or `tasks[].links[]` would escape `.strict()` alone). Zero undeclared keys, zero missing
or mistyped fields. Coverage was checked rather than assumed — `carrying` and `branches` non-null,
`taskEvents` and `taskLinks` populated, the Life-goal backlog aggregate non-empty. Request strictness: 23
write endpoints x (`__x` + 23 server-owned field names) = 562 probes, all 422 with an `unrecognized_keys`
issue **naming the exact key**, so no probe passed for the wrong reason; nested strictness holds inside
`PUT /plan`'s `entries[]`. 21 of 26 error codes reached, each a valid envelope with the status
`ERROR_STATUS` declares.

**The cross-agent seams.** `apps/api/tests/review/seams.test.ts` (8), all green first run. The full round
trip — task -> move-to-backlog -> convert back to task — leaves exactly one exited task (status
`movedToBacklog`, its reason, and its `Moved to Backlog — …` event), one converted item pointing at the new
task and keeping its `fromWeekStart`, and one live task with `Created — pulled from Backlog` and the links
carried across. A second conversion of the round-tripped item is still `409 ALREADY_CONVERTED`; a second
exit is `409 TASK_ALREADY_EXITED` with only one item ever minted. The cascade removes both sides and a
whole-table sweep finds no task, item or focus naming a goal that no longer exists. A goal deleted while
one of its tasks is mid-exit gives a clean 404 with no item minted on the dead goal.

---

## Debatable — listed, not changed

- **`BacklogService.patch` / `remove` still skip the link delete when `existing.length === 0`.** With
  finding 1 fixed, emitting it with `expectedChanges: 0` would also catch a link added concurrently during
  a link-replace. It is the same shape as finding 2 but far less consequential (an orphaned link row on a
  live item, not a row outliving its parent). Left alone rather than changed on the reviewer's taste.
- **`deleteByGoalsAndWeekStmt` is now unused** after finding 3. Kept: removing a port method is a
  shared-file deletion, and the churn is not worth it in a review.
- **Deleting a backlog item leaves `tasks.moved_to_backlog_item_id` dangling** on the task that produced
  it. Nothing reads that column in a response today, so it is inert; whether it should be nulled or the
  delete refused is a product question.
- **`SIGNUP_ALLOWLIST` is a list, not a single value.** Two entries yields two accounts. The isolation
  evidence above shows two accounts would be fully separated, so this is a configuration risk rather than a
  vulnerability — but if "single-user" is meant structurally, the create hook could also refuse when a
  `user` row already exists.
- **Straight vs. typographic quotes in event text** (`docs/work/04-tasks/build.md` §7.1) — a design call,
  untouched.

---

## Account recovery

**Read this before you need it.** This deployment **cannot send email**, by construction — no `send_email`
binding, no adapter, no branch that could select one (finding 4). `LogEmailSender` stores a message body
only for addresses matching `E2E_EMAIL_PATTERN`, which is restricted to *non-registrable* domains so
`GET /internal/outbox` can never become a standing oracle for the real account. Reset tokens are stored
hashed. Together those mean **"forgot password" has no completion for the owner's real address**: the mail
is generated, has nowhere to go, and its token cannot be read out of the database.

Two endpoints close that trap.

### Prevention — change your password while signed in

The ordinary path, and the one that will actually be used. It requires the current password (a live session
on a borrowed laptop must not be enough to re-key the account) and revokes every other session by default.

```bash
curl -sS -X POST https://goal-cascade-api.<your-subdomain>.workers.dev/api/me/change-password \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(openssl rand -hex 16)" \
  -b 'better-auth.session_token=<your session cookie>' \
  -d '{"currentPassword":"<current>","newPassword":"<new, 8+ chars>"}'
# -> {"changed":true,"revokedOtherSessions":true,"serverNow":"…"}
```

Pass `"revokeOtherSessions": false` to keep your other devices signed in. The response's `Set-Cookie`
re-issues the calling session, so the device you ran it from stays signed in.

### Cure — mint a reset link when you are locked out

`POST /internal/reset-link` mints a **real** Better Auth reset token — same hashing, same one-hour TTL,
same `revokeSessionsOnPasswordReset` — and returns the landing URL in the response body. It is never
stored, never emailed, never logged. Like every `/internal` route it does not exist unless
`INTERNAL_SECRET` is set.

```bash
# 1. Confirm the secret is set (if it is not, set it and redeploy — see below).
cd apps/api && npx wrangler secret list

# 2. Mint the link.
curl -sS -X POST https://goal-cascade-api.<your-subdomain>.workers.dev/internal/reset-link \
  -H 'Content-Type: application/json' \
  -H "X-Internal-Secret: $INTERNAL_SECRET" \
  -d '{"email":"me@rameezshuhaib.com"}'
# -> {"resetUrl":"https://…/?reset=1&token=…"}

# 3. Open that URL in a browser and set a new password. It expires in ONE HOUR and is single-use.
#    Or complete it from the shell:
curl -sS -X POST https://goal-cascade-api.<your-subdomain>.workers.dev/api/auth/reset-password \
  -H 'Content-Type: application/json' \
  -d '{"token":"<the token from resetUrl>","newPassword":"<new, 8+ chars>"}'

# 4. Sign in with the new password. Every previous session is already revoked.
```

If `INTERNAL_SECRET` is not set, set it and deploy — the endpoint 404s without it:

```bash
cd apps/api
openssl rand -hex 24                      # keep this somewhere you can reach when locked out
npx wrangler secret put INTERNAL_SECRET   # paste it
npm run deploy
```

`{"resetUrl": null}` with a 200 means the address is not registered — the response shape is identical
either way, so it is not an enumeration oracle. A 403 means the secret is wrong; a 404 means it is unset.

### What this costs, stated plainly

**`INTERNAL_SECRET` is an account-takeover credential for this deployment.** Whoever holds it can mint a
password reset for any address and take the account. Treat it like the account password itself: store it
where you store that, and rotate it (`wrangler secret put INTERNAL_SECRET && npm run deploy`) if it is ever
exposed.

That is an acceptable trade **here and only here**, and it rests on two properties of this specific
product: there is exactly one account, and its owner is the sole holder of the secret. Under those two
facts the endpoint grants the owner nothing they do not already have, and it is strictly better than the
alternative — an account that is permanently unrecoverable the first time a password is forgotten. It would
**not** be acceptable in a multi-user product, where one operational secret becomes a master key to every
user's account with no audit trail and no consent. If you copy this pattern, that is the property you are
relying on; check that you still have it.

**What was deliberately *not* done:** widening `E2E_EMAIL_PATTERN` to the owner's real address. That would
make `GET /internal/outbox` a *standing* oracle for every verification and reset link the account ever
generates, rather than a single deliberate act that leaves no artefact. The pattern validator refuses
registrable domains for exactly this reason, and that control is untouched.

Both endpoints are covered by `apps/api/tests/account-recovery.test.ts` (11): the wrong current password is
refused and the old password still works; other sessions are revoked and the calling one survives;
`revokeOtherSessions: false` is honoured; the reset-link endpoint is refused without the secret, with the
wrong secret, and 404s when the secret is unset; the returned token completes a real reset end to end for a
registrable address; nothing is written to the outbox and the outbox still refuses that address; and the
response does not reveal whether an address exists.

---

## Files changed

| File | Why |
|---|---|
| `packages/shared/src/errors.ts` | `AMBIGUOUS_CONVERSION_TARGET` (gap A); envelope-scope and `RATE_LIMITED` notes (6) |
| `packages/shared/src/read-models.ts` | `replanOptions` on `GoalDetailResponse` (gap B) |
| `packages/shared/src/commands.ts` | `NoQuery` (8); `ChangePasswordRequest`/`Response` (C) |
| `packages/shared/src/endpoints.ts` | `meChangePassword` (C) |
| `apps/api/src/application/ports/statement.ts` | `expectedChanges: number \| 'any'` (1) |
| `apps/api/src/application/ports/repositories.ts` | `deleteByWeekStmt`, `deleteByGoalsFromWeekStmt`; corrected `expectedChanges` docs (1, 3, 5) |
| `apps/api/src/application/services/guarded-batch.ts` | exact-`0` semantics; `'any'` opt-out (1) |
| `apps/api/src/application/services/activity-log.ts` | carry insert -> `'any'` (1) |
| `apps/api/src/application/services/goal.service.ts` | cascade emits every statement (2); ex-leaf keeps the past (5); `replanOptions` (gap B) |
| `apps/api/src/application/services/plan.service.ts` | delete by week, always (3) |
| `apps/api/src/application/services/backlog.service.ts` | `AMBIGUOUS_CONVERSION_TARGET` (gap A) |
| `apps/api/src/infrastructure/persistence/d1-goal.repo.ts` | the two new focus statements |
| `apps/api/src/api/routes/me.routes.ts` | `POST /me/change-password` (C) |
| `apps/api/src/api/routes/internal.routes.ts` | `POST /internal/reset-link` (C) |
| `apps/api/src/api/routes/capture.routes.ts` | query validation on the two list reads (8) |
| `apps/api/.dev.vars.example` | `INTERNAL_SECRET` is now an account-takeover credential (C) |
| `apps/api/tests/review/*.test.ts` | 4 new files, 31 tests — findings 1, 2, 3, 5, gaps A/B, seams, week model |
| `apps/api/tests/account-recovery.test.ts` | 11 new tests (C) |
| `apps/api/tests/security/no-real-email.test.ts` | rewritten as capability + names (4) |
| `apps/api/tests/security/error-envelope-scope.test.ts` | new, 6 tests (6) |
| `apps/api/tests/security/signup-allowlist.test.ts` | substring -> parse (9) |
| `apps/api/tests/plan/plan.test.ts` | one test retired and strengthened (5) |
| `apps/api/tests/backlog/convert.test.ts` | one test re-pointed at the new code (gap A) |
| `apps/api/tests/route-surface.test.ts` | census row for `/me/change-password` (C) |
