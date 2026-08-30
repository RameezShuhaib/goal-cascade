# 01 — Foundation: shared contract, API skeleton, auth stack

The spine every feature agent inherits. Nothing here is feature logic; everything here is a decision a
feature agent must not contradict.

Sources of truth, in order: `docs/SPEC.md` (rules `R-*`, scenarios `S-*`, open questions `Q-*`, mockup
corrections `D-*`) → `docs/BUSINESS-RULES.md` → the React mockup in `apps/web/src/`.

---

## 1. What was built

```
packages/shared/src/
├── errors.ts        ERROR_STATUS → ErrorCode + ErrorEnvelope; every domain code annotated with its rule
├── common.ts        scalars (Iso, Ulid, WeekStart, WeekOffset, Period, …) + every view type
├── endpoints.ts     API_BASE, ENDPOINTS (32 entries), HEADERS, IDEMPOTENCY_KEY_PATTERN
├── commands.ts      request AND response schema for every write
├── read-models.ts   response schema for every read
└── index.ts
tests/contract.test.ts — 21 tests

apps/api/
├── wrangler.jsonc, drizzle.config.ts, vitest.config.ts, .dev.vars.example (+ gitignored .dev.vars)
├── migrations/0000_lovely_cammi.sql  (generated, committed, applies clean)
└── src/
    ├── env.ts, worker.ts
    ├── domain/        entities, enums, errors, goal-tree.ts, weeks.ts   ← pure, no I/O
    ├── application/   context, ports/ (+ DI symbols), services/
    ├── infrastructure/ di, clock, ids/ulid, persistence (schema + 6 repo modules), auth, email
    └── api/           app.ts, types, validate, week.ts, middleware/ ×7, routes/ ×7
tests/ — 146 tests across 13 files
```

`npm run typecheck` and `npm run test` both pass. `npx wrangler d1 migrations apply goal-cascade-db
--local` applies 44 statements cleanly.

**45 routes registered**: 42 under `/api` (from a 32-entry `ENDPOINTS` map — several endpoints carry more
than one method), `GET /api/health`, and 2 under `/internal`, plus the Better Auth `/api/auth/*` router.

---

## 2. The endpoint surface

One line each. Every command carries `Idempotency-Key`; every route is session-gated (R-auth-4).

| Method | Path | Rules | State |
|---|---|---|---|
| GET | `/health` | — | **done** (public) |
| GET/POST | `/auth/*` | R-auth-1 | **done** (Better Auth) |
| GET | `/me` | R-auth-1/4 | **done** |
| GET | `/me/preferences` | R-nav-12 | **done** |
| PATCH | `/me/preferences` | R-nav-12, D-25 | **done** |
| GET | `/bootstrap?week=` | cold open (`fetchAll`) | stub |
| GET | `/goals?week=` | R-goal-25, Q-7 | stub |
| POST | `/goals` | R-goal-1/3/4/5/6/13/28 | **guard live**, service stub |
| GET | `/goals/:id?week=` | R-goal-27, R-backlog-11/12, R-learning-5 | stub |
| PATCH | `/goals/:id` | R-goal-14 | stub |
| DELETE | `/goals/:id?cascade=` | Q-5 | stub |
| POST | `/goals/:id/move` | R-goal-16/17/18/19/21/28 | **guard live**, service stub |
| POST | `/goals/:id/replan` | R-goal-22/23, D-3 | stub |
| GET | `/plan?week=` | R-plan-1, D-2 | stub |
| PUT | `/plan` | R-plan-2/5/6/7/8, Q-3 | stub |
| GET | `/tasks?week=&goalId=` | R-nav-7/8, R-task-7/8/29 | stub |
| POST | `/tasks` | R-task-2/3/4/5/6 | stub |
| GET | `/tasks/:id?week=` | R-task-22/30 | stub |
| PATCH | `/tasks/:id` | R-task-23/26/27 | stub |
| POST | `/tasks/:id/complete` | R-task-14 (exit 1/3) | stub |
| POST | `/tasks/:id/uncheck` | R-task-19/20/21 | stub |
| POST | `/tasks/:id/move-to-backlog` | R-task-15/17, D-12, D-15 (exit 2/3) | stub |
| POST | `/tasks/:id/cancel` | R-task-16/17/18, D-15 (exit 3/3) | stub |
| POST | `/tasks/:id/links` | R-task-24 | stub |
| DELETE | `/tasks/:id/links/:linkId` | R-task-25, D-13 | stub |
| GET | `/backlog?goalId=` | R-backlog-5/13, Q-7 | stub |
| POST | `/backlog` | R-backlog-2/4/16 | stub |
| PATCH | `/backlog/:id` | R-backlog-3 | stub |
| DELETE | `/backlog/:id` | R-backlog-10 | stub |
| POST | `/backlog/:id/move` | R-backlog-10, S-backlog-10-1 | stub |
| POST | `/backlog/:id/convert-to-task` | R-backlog-6/7/8/9, Q-4, D-18, D-19 | stub |
| GET | `/ideas` | R-idea-7 | stub |
| POST | `/ideas` | R-idea-1/2 | stub |
| DELETE | `/ideas/:id` | R-idea-6 | stub |
| POST | `/ideas/:id/attach` | R-idea-5 | stub |
| POST | `/ideas/:id/convert-to-task` | R-idea-4, D-22 | stub |
| GET | `/learnings` | R-learning-2 | stub |
| POST | `/learnings` | R-learning-1 | stub |
| PATCH | `/learnings/:id` | R-learning-4, D-23 | stub |
| DELETE | `/learnings/:id` | R-learning-6 | stub |
| POST | `/learnings/:id/attach` | R-learning-3 | stub |
| GET/DELETE | `/internal/outbox?to=` | e2e mail sink | **done** |

Deliberately absent, and they must stay absent (R-nav-14, R-task-13): any review wizard, audit trail,
week report, push endpoint, or a fourth task exit (`defer` / `snooze` / `reschedule` / move-to-week).
`tests/route-surface.test.ts` fails if one appears.

---

## 3. Decisions a feature agent must not contradict

### 3.1 A week is an absolute Monday date (D-1)

`WeekStart` is `YYYY-MM-DD` and the schema **refuses a date that is not a Monday**. Columns are
`origin_week_start`, `done_week_start`, `from_week_start`, `weekly_focus.week_start`.

Offsets (`WeekOffset`, `≤ 0`) exist **only on the wire**. `api/week.ts#resolveWeek` is the single place
one is turned into a `weekStart`, using `ctx.currentWeekStart` — which `resolveTimezone` derives once per
request from the **owner's** `preferences.timezone` (R-auth-5, Q-9), never the client clock.

Consequences, all load-bearing:
- **Carrying needs no job and no write.** An open task is visible in every week `>= origin_week_start`
  (`ITaskRepo.listVisibleInWeek`). This is why there is no cron.
- Read models answer with the absolute `weekStart` plus a server-computed `carryWeeks`, so the client
  never re-derives Monday. Do not add an offset column to any table.

### 3.2 Weekly focus is its own table (D-2)

`weekly_focus (user_id, goal_id, week_start, sentence)`, unique on the triple. A row exists **only while
the leaf is active in that week**: clearing a focus DELETES the row; a blank sentence is never stored.
"Active" is therefore exactly "a row exists for this week" (R-goal-9), and there is no second
representation of dormancy that can disagree. `GoalView.focus` is a projection for the week being read.

`PUT /plan` carries its own `weekStart` and must refuse anything but the current week
(`WEEK_NOT_CURRENT`, R-plan-2) — refused wholesale, never partially applied (Q-3).

### 3.3 Exits keep the row (D-15) and conversions mark, not delete (D-19)

- `tasks.status`: `open | done | canceled | movedToBacklog`, plus `exit_reason` and `exited_at`.
  Move-to-Backlog and Cancel set those and append their event. **Never delete a task on an exit** — the
  `Moved to Backlog` / `Canceled` entries R-task-30 requires cannot live on a deleted row.
  `listVisibleInWeek` excludes exited tasks in SQL, so no read model can leak one.
- `backlog_items.status`: `open | converted`, with `converted_to_task_id` **unique**. Conversion goes
  through `markConvertedGuardedStmt`, which pins `status = 'open'` + the version inside a `GuardedBatch`:
  a second conversion changes zero rows, the batch rolls back, and the task insert dies with it. That is
  S-backlog-6-2 enforced by the database rather than hoped for.

### 3.4 Tree invariants live in the domain and are already wired (D-5)

`domain/goal-tree.ts` is pure and is the authority: `checkCreate`, `checkMove`, `moveTargetReason`
(descendant reason wins, R-goal-19), `descendantIds`, `isActive`/`isDormant`/`subtreeActive`,
`activeLeavesUnder` (returns **all** candidates — D-18 forbids picking silently), `orderedTree` (Q-7),
`defaultPeriod`/`replanPeriods` (derived from today, strictly forward — D-3).

`GoalTreeGuard` is **not a stub**. `POST /goals` and `POST /goals/:id/move` call it before the service,
so `HORIZON_CONFLICT`, `WOULD_CREATE_CYCLE`, `LIFE_GOAL_IMMUTABLE` and `GOAL_HAS_OPEN_TASKS` are enforced
today (14 tests in `tests/goal-tree-guard.test.ts` assert 409-before-501). **Do not remove the guard from
the route, and do not re-implement the same checks differently inside `GoalService`.**

R-goal-28 / D-8 is settled as *refuse*: a leaf carrying open tasks cannot become a parent
(`GOAL_HAS_OPEN_TASKS`, "move or close them first"). Silently re-homing someone's work is worse.

### 3.5 Scope, concurrency, atomicity

- **`ctx.userId` is the only scope** (SPEC's `ownerId`). It always comes from the session, never from
  input. Every repo read takes it explicitly; another owner's row is a plain 404 (R-auth-3).
- **`version` is the optimistic-concurrency guard** (Q-2). Requests may send it; guarded updates pin it
  and a mismatch is `409 CONCURRENT_UPDATE`. Omitting it is last-write-wins.
- **One read phase → one `GuardedBatch.run`.** D1 has no interactive transactions and a zero-row UPDATE
  is not an error, so `GuardedBatch` prepends a precondition that trips `_guard`'s `CHECK (0)` and rolls
  the whole batch back. Append the activity event and the row change in the SAME batch — an event that
  can commit without its cause is a lie in the timeline.
- **Repos never call `Date.now()`.** Timestamps arrive as ISO strings from `IClock`.

### 3.6 Errors and validation

Every refusal is a machine-readable code (Q-10) — never the mockup's silent `return`. New domain codes,
each documented with its rule: `HORIZON_CONFLICT`, `WOULD_CREATE_CYCLE`, `GOAL_HAS_CHILDREN`,
`GOAL_HAS_OPEN_TASKS`, `LIFE_GOAL_IMMUTABLE`, `NOT_A_LEAF`, `NOT_A_LIFE_GOAL`, `BRANCH_NOT_ACTIVE`,
`LIFE_GOAL_NO_BACKLOG`, `ALREADY_CONVERTED`, `TASK_ALREADY_EXITED`, `WEEK_NOT_CURRENT`,
`WEEK_OUT_OF_RANGE`, `SIGNUP_NOT_ALLOWED`.

Validation is middleware (`zJson`/`zQuery`/`zParams`), named at route registration. Every request schema
is `.strict()`, so an unknown key — a typo, a stale client, an attempt to write a `[srv]` field — is a
422. Lengths (Q-11) and caps (Q-12) live in the shared schemas so both sides enforce them.

### 3.7 Auth

Ported from the reference codebase with every flow intact: sign-up, sign-in, sign-out, email
verification, password reset (hashed tokens, 1-hour TTL, sessions revoked on reset), D1-backed rate
limiting, `cf-connecting-ip`, and `baseURL` from the request origin (there is no `BASE_URL` var).

Two changes:
- **No tenants.** `ProvisionUserService` seeds ONE row — preferences (theme + timezone). A new account's
  goal tree is EMPTY (R-auth-6); none of the mockup's fixture ids exist anywhere (D-10).
- **Sign-up is allowlisted.** `SIGNUP_ALLOWLIST` holds EXACT addresses (comma-separated, compared
  trimmed + lowercased); production is `me@rameezshuhaib.com`. Enforced in
  `databaseHooks.user.create.before`, the last point before a row exists — so a refusal leaves the `user`
  table untouched, which the tests assert. **Unset or empty refuses everything.** There is deliberately
  no glob support: a pattern is one edit away from `*`.

### 3.8 Email: the Worker cannot send it, by construction

The owner's sending domain was previously flagged for a high bounce rate caused by this project's own
test traffic. Goal Cascade removes the capability rather than guarding it:

- **no `send_email` binding** in `wrangler.jsonc` — absent, not commented out;
- **no Resend/Cloudflare/SMTP adapter anywhere in `src/`**;
- `createEmailSender` returns `LogEmailSender` with `forward = null` **unconditionally** — there is no
  configuration that turns delivery on;
- `EMAIL_FROM` is `Goal Cascade <noreply@goal-cascade.local>` (non-registrable on purpose);
- `E2E_EMAIL_PATTERN` is `*@test.goal-cascade.local`, and a pattern on a **registrable** domain is
  ignored with a loud error — so widening it makes `/internal/outbox` inert rather than an
  account-takeover oracle.

Verification and reset links land in `email_outbox` and are read through `GET /internal/outbox` behind
`X-Internal-Secret`. `tests/security/no-real-email.test.ts` fails the build if a `send_email` binding, a
`remote: true`, a cron trigger, or a network-capable adapter ever reappears — it scans the whole `src/`
tree at build time, with comments stripped. **Do not add a mail provider. Ask the owner first.**

---

## 4. Orchestrator rulings recorded here

| Q | Ruling |
|---|---|
| Q-5 | Cascade the whole subtree transactionally; Idea/Learning tags null out to Unsorted. Response reports the counts. `?cascade=true` is the explicit acknowledgement; without it a goal with children refuses `GOAL_HAS_CHILDREN` with the counts in `details`. No soft-delete. |
| Q-8 | **ULID, not UUIDv7** — `UlidGenerator` ported unchanged. Clients never mint ids. |
| Q-10 | Affirmed: every violation gets a code from `ERROR_STATUS`. |
| Q-11 / Q-12 | Lengths and caps live in the shared zod schemas. |
| Q-15 | Online-only with a read cache. No offline mutation queue; do not design for replay-after-reconnect. |
| Q-16 | **No per-owner write budget.** The Better Auth limiter (unauthenticated endpoints) is the only one. |
| Q-17 | **No cron.** Carrying is derived. The cosmetic `Carried to week of …` entry is produced lazily on first read of a week, idempotent via `ux_task_events_carried (user_id, task_id, week_start) WHERE kind='carried'` — use `insertCarriedIgnoreStmt` with `expectedChanges: 0`. |

---

## 5. Left for feature agents

Every service in `application/services/` except `MeService`, `ProvisionUserService`, `GoalTreeGuard` and
`GuardedBatch` is a stub throwing `NotImplementedError`. Signatures are typed against the shared schemas
and carry the rule ids they owe — **fill in the service, do not change the route or the schema.**

- `GoalService` — list, detail, create, patch, move, replan, cascade delete
- `PlanService` — get, save (whole-week replace)
- `TaskService` — list (+ the lazy carry-log producer), get, create, patch, and the three exits, links
- `BacklogService` — list, create, patch, move, delete, convert
- `IdeaService` / `LearningService` — list, create, delete, attach, convert / patch
- `BootstrapService` — composes the others; must NOT re-derive visibility or activity independently

Also deliberately not done here: the four `carrying` / `branches` / `backlogCount` aggregate fields on
`GoalView` (shapes are fixed, computation is the goals agent's), and the `TaskEvent` copy table
(R-task-30) — `TASK_EVENT_GLYPHS` in `domain/enums.ts` fixes the glyphs; the text strings are the task
agent's, and R-task-27's truncation rule applies to every interpolated value.

---

## 6. Shared files touched

- `.gitignore` — one additive line, `!.dev.vars.example`, so the committed secrets TEMPLATE survives the
  `.dev.vars.*` rule. Nothing else in the root was changed.
- `apps/web/` was not touched.
