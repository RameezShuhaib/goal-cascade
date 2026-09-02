/**
 * Machine-readable error codes (SPEC Q-10 — "refusals are validation errors, never silent no-ops").
 * The HTTP status for each code lives in `ERROR_STATUS`; the API's error handler maps `DomainError.code`
 * through it, and the web client maps the same code to its copy. One map means the two sides can never
 * disagree about what a `409` means.
 *
 * Every domain code below is annotated with the SPEC rule it enforces.
 */
export const ERROR_STATUS = {
  IDEMPOTENCY_KEY_MISSING: 400,
  UNAUTHENTICATED: 401,
  /**
   * The MCP endpoint's static bearer token is absent, malformed, or does not match the one stored hash.
   *
   * Distinct from `UNAUTHENTICATED` on purpose: that code means "the Better Auth session cookie is gone,
   * sign in again", which is advice an external agent cannot act on — it has no browser and no cookie
   * jar. This one means "the `Authorization: Bearer …` header is wrong; the owner must mint a new token
   * in Agent access and paste it into your config". Same 401, different recovery.
   *
   * `/mcp` answers with the MCP SDK's own `401 + WWW-Authenticate: Bearer` challenge rather than this
   * envelope (that is what an MCP client parses), so this code is what the DOMAIN layer speaks and what
   * `goalcascade://rules/errors` documents.
   */
  INVALID_API_TOKEN: 401,
  FORBIDDEN: 403,
  /**
   * R-auth-1 — Goal Cascade is single-user. `SIGNUP_ALLOWLIST` holds the owner's address and nothing else;
   * every other sign-up is refused BEFORE a `user` row is created. An unset/empty allowlist refuses
   * everything: "closed" is the safe default, never "open".
   */
  SIGNUP_NOT_ALLOWED: 403,
  /** R-auth-3 — another owner's entity is refused identically to a non-existent one. */
  NOT_FOUND: 404,

  /**
   * R-goal-5 / R-goal-31 / R-goal-17 — a child's horizon must be strictly SHORTER than its parent's
   * (Life 0 › Yearly 1 › Quarterly 2 › Monthly 3 › **Weekly 4**), so **Weekly** is terminal and equal
   * rank is refused. Raised on create (S-goal-5-2, S-goal-5-3, S-goal-31-1) and on move (S-goal-18-2).
   *
   * ⚠ **A2** — the terminal horizon MOVED. A **Monthly** parent is now legal (S-goal-31-2 is the exact
   * request the old rule required to be refused), and levels may still be skipped, so a Weekly goal under
   * a Life, Yearly or Quarterly goal is not a conflict either (R-goal-32).
   */
  HORIZON_CONFLICT: 409,
  /** R-goal-18(a,b) — the move target is the goal itself or one of its descendants (S-goal-18-1). */
  WOULD_CREATE_CYCLE: 409,
  /** Q-5 — delete refused because the goal still has children and no explicit `?cascade=true` was given. */
  GOAL_HAS_CHILDREN: 409,
  /** R-goal-21 — a Life goal cannot be moved or re-planned (S-goal-21-1). */
  LIFE_GOAL_IMMUTABLE: 409,
  /** R-learning-2 — a Learning tag must be a Life goal or null. */
  NOT_A_LIFE_GOAL: 409,
  /**
   * ⚠ **A8, new (R-task-51) — this code REPLACES `NOT_A_WEEKLY_GOAL` outright**, taking its slot and its
   * status. `NOT_A_WEEKLY_GOAL` is retired with R-task-49's inference (R-rm-6) and the string must not
   * survive in an error catalogue, an MCP recovery line, a test or client copy (S-task-51-2).
   *
   * A task's `goalId` named a goal whose horizon is neither `Monthly` nor `Weekly`. `details.horizon`
   * carries which.
   *
   * **The condition is still the horizon, full stop — never leaf-ness** (R-goal-37). It now names two
   * horizons instead of one, and every other word of R-goal-39's ruling survives, including the trap it
   * exists to catch: a **Quarterly** goal with no Monthly children is a leaf by the structural definition
   * and still holds no task (S-task-51-2). A build that admits it has keyed task ownership on leaf-ness.
   *
   * **Why the line falls between Quarterly and Monthly.** The horizons that hold *deferred, undated* work
   * are Yearly, Quarterly and Monthly (R-backlog-1); the horizons that hold *committed, dated* work are
   * Monthly and Weekly; and Monthly is deliberately the one horizon that holds both, because it is where
   * the two decisions meet (R-backlog-30). A task with a three-month deadline carries for thirteen weeks
   * before anything says so, which is a backlog item that has learned to nag.
   */
  NOT_A_TASK_GOAL: 409,
  /**
   * ⚠ **A2, new (R-backlog-26, replaces `BRANCH_NOT_ACTIVE`)** — no Weekly goal exists at or under the
   * item's goal for the target week, so nothing can receive the conversion. The client answers with
   * "No weekly goal here for that week" and R-task-48's inline create, rather than sending the owner away
   * (S-backlog-26-2).
   */
  NO_WEEKLY_GOAL: 409,
  /**
   * ⚠ **A2, new (R-goal-36, replaces `WEEK_NOT_CURRENT`)** — a create, an edit, a re-plan or a
   * `Repeat last week` named a period earlier than the current one for its horizon.
   *
   * **This is D-2, generalised.** A goal written into last month is a plan claiming to have existed then,
   * and it changes what a past lens says happened. Planning never rewrites history. There is **no forward
   * bound at any horizon**: every future period is writable, so this code never means "too far ahead".
   *
   * Its converse binds equally: a past period is closed to new PLAN and to nothing else. Title, `why` and
   * `pulse` edits, Move, Delete, and every task operation — completing one included — still succeed
   * there (S-goal-36-4, S-lens-10-2).
   */
  PERIOD_IN_PAST: 409,
  /**
   * R-backlog-2 / R-backlog-26 — backlog items attach to Yearly/Quarterly/Monthly goals only. Never a
   * Life goal (a Life goal's detail screen shows a READ-ONLY aggregate of its descendants' items) and
   * ⚠ **A2** never a **Weekly** goal, because a backlog item has no week.
   *
   * It is also the refusal when Move-to-Backlog finds no legal target: a Weekly goal whose only ancestor
   * is a Life goal has nowhere above the week to land (R-backlog-29, S-backlog-29-2). That is the one
   * cost of R-goal-32's level-skipping, it is rare, and refusing beats inventing a home.
   */
  LIFE_GOAL_NO_BACKLOG: 409,
  /**
   * R-backlog-6 / R-backlog-9 / D-19 — the backlog item was already converted into a task. A repeat
   * conversion is refused and no second task is created (S-backlog-6-2, S-backlog-9-1).
   */
  ALREADY_CONVERTED: 409,
  /**
   * R-backlog-26 / D-18 / S-backlog-26-3 — more than one **Weekly goal** at or under the item's goal
   * qualifies to receive it for the target week, so the server refuses to pick: that id decides which
   * week the task belongs to for the rest of its life, and the mockup took whichever came first in array
   * order.
   *
   * It is a 409 and not a 422 on purpose. The request was well formed and the input was fine — the
   * product simply has no single answer yet — and the client needs to tell this apart from a validation
   * failure to render a chooser rather than a field error. `details.candidates` carries
   * `[{ id, title }]`; re-submitting with `goalId` set to one of them succeeds.
   */
  AMBIGUOUS_CONVERSION_TARGET: 409,
  /**
   * R-task-17 / D-15 — Move-to-Backlog and Cancel are offered only on OPEN tasks. A task that is done or
   * has already exited refuses both (S-task-17-1).
   */
  TASK_ALREADY_EXITED: 409,
  /**
   * ⚠ **A8, new (R-measure-3)** — a reading was recorded against, or deleted from, a task that carries no
   * measure. A task with `measure = null` is an ordinary checkbox and has nothing to record a value into
   * (R-measure-1); attach a measure first with `PUT /tasks/:id/measure`.
   *
   * A 409 and not a 422: the request was well formed and the input was fine — the task is simply not that
   * kind of thing yet — and the client needs to tell that apart from a validation failure.
   */
  NO_MEASURE: 409,
  /** Q-2 / Q-3 — a write carrying a stale `version` lost the race with another device. */
  CONCURRENT_UPDATE: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,

  /**
   * R-task-44 — a week outside the addressable range.
   *
   * ⚠ **A2** — its meaning NARROWED. It no longer means "a future week" in general: future periods are
   * ordinary and writable (R-goal-36, R-lens-7). It now means the absolute storage range, or — on
   * **complete** — a week outside `originWeek <= week <= currentWeek`. You cannot finish work in a week
   * that has not happened, and a task under a future Weekly goal cannot be completed at all until that
   * week arrives (S-task-44-1). A write into a past PERIOD is `PERIOD_IN_PAST`, not this.
   */
  WEEK_OUT_OF_RANGE: 422,
  /**
   * ⚠ **A8, new (R-measure-4)** — a measure was created or edited with `target === start`.
   *
   * It names no movement, and "maintain" — the only thing it could mean — is out of scope for this
   * amendment. **Refusing it at the edge is only half the rule**: where such a row exists in the data
   * anyway (a migration, a hand-edit, a bug), **no division is performed** — `progress` is absent from the
   * wire and the UI renders the numbers alone. `NaN`, `Infinity`, `0%` and `100%` are each specifically
   * forbidden as the answer, because this is the one place a divide-by-zero can reach a screen and a wrong
   * number is worse than no number (S-measure-4-3).
   */
  MEASURE_TARGET_EQUALS_START: 422,
  /**
   * ⚠ **A8, new (R-measure-3)** — a `delta` was submitted against a **gauge**. A gauge is *set*, not added
   * to, and there is nothing sensible to add a delta to when the owner's whole interaction is "it is 78.5
   * now". Re-send with `value`.
   *
   * **The asymmetry is deliberate and is not a bug to fix**: an absolute `value` against a **counter** is
   * *accepted*, because correcting a counter to where it actually is ("I'm at 12") is legitimate and a
   * counter is a gauge you usually bump (S-measure-3-3).
   */
  MEASURE_KIND_MISMATCH: 422,
  VALIDATION_FAILED: 422,
  IDEMPOTENCY_KEY_REUSED: 422,
  /**
   * Reserved. Goal Cascade applies NO per-owner write budget (the orchestrator's Q-16 ruling); the only
   * limiter in the product is Better Auth's, on the unauthenticated endpoints — and that one answers on
   * ITS router, in ITS flat shape, so it never carries this code. Nothing on a Goal Cascade route emits
   * `RATE_LIMITED` today. It stays in the map because `ERROR_STATUS` is also the client's status table
   * and 429 must map somewhere, but a client cannot detect rate limiting by code: it must read the
   * status on `/api/auth/*`.
   */
  RATE_LIMITED: 429,
  INTERNAL: 500,
  /** Returned by handler stubs a feature agent has not implemented yet. Never a client-visible state. */
  NOT_IMPLEMENTED: 501,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;
export const ERROR_CODES = Object.keys(ERROR_STATUS) as ErrorCode[];

/**
 * The ONE error envelope for Goal Cascade's own routes: every non-2xx response from `/api/*` and
 * `/internal/*` has exactly this shape.
 *
 * **The one documented exception — `/api/auth/*`.** That path is Better Auth's own router, mounted under
 * `/api` and returning its own `{ code, message }` shape (flat, no `error` wrapper). It is left alone
 * deliberately: the web client talks to it through the Better Auth CLIENT SDK, which parses that shape,
 * so re-wrapping these responses would break sign-in error handling to satisfy a comment. A client must
 * therefore read auth failures as `body.code`, and everything else as `body.error.code`.
 * `tests/security/error-envelope-scope.test.ts` pins BOTH shapes so the boundary cannot drift unnoticed.
 */
export type ErrorEnvelope = {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown> };
};
