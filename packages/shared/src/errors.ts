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
   * R-goal-5 / R-goal-6 / R-goal-17 — a child's horizon must be strictly SHORTER than its parent's
   * (Life 0 › Yearly 1 › Quarterly 2 › Monthly 3), so Monthly is terminal and equal rank is refused.
   * Raised on create (S-goal-5-2, S-goal-5-3, S-goal-6-1) and on move (S-goal-18-2).
   */
  HORIZON_CONFLICT: 409,
  /** R-goal-18(a,b) — the move target is the goal itself or one of its descendants (S-goal-18-1). */
  WOULD_CREATE_CYCLE: 409,
  /** Q-5 — delete refused because the goal still has children and no explicit `?cascade=true` was given. */
  GOAL_HAS_CHILDREN: 409,
  /**
   * R-goal-28 / D-8 — giving a leaf a child (create-under or move-under) while it still carries open
   * tasks. Refused rather than silently re-homing someone's work: "move or close them first".
   */
  GOAL_HAS_OPEN_TASKS: 409,
  /** R-goal-21 — a Life goal cannot be moved or re-planned (S-goal-21-1). */
  LIFE_GOAL_IMMUTABLE: 409,
  /**
   * R-goal-9 / R-goal-12 / R-plan-8 — only a non-Life LEAF can hold a weekly focus or own a task.
   * Raised when a plan entry or a task points at a Life goal or at a goal that has children (S-plan-8-1).
   */
  NOT_A_LEAF: 409,
  /** R-idea-2 / R-learning-2 — an Idea or Learning tag must be a Life goal or null (S-idea-2-1). */
  NOT_A_LIFE_GOAL: 409,
  /**
   * R-backlog-8 — "Add to this week" on an item whose branch has no active weekly focus. The UI answers
   * with "This branch isn't active this week" → [Set a weekly focus] / [Cancel] (S-backlog-8-1/8-3).
   */
  BRANCH_NOT_ACTIVE: 409,
  /**
   * R-backlog-2 — backlog items attach to Yearly/Quarterly/Monthly goals only. Never a Life goal (a Life
   * goal's detail screen shows a READ-ONLY aggregate of its descendants' items) and never a week.
   */
  LIFE_GOAL_NO_BACKLOG: 409,
  /**
   * R-backlog-6 / R-backlog-9 / D-19 — the backlog item was already converted into a task. A repeat
   * conversion is refused and no second task is created (S-backlog-6-2, S-backlog-9-1).
   */
  ALREADY_CONVERTED: 409,
  /**
   * R-task-17 / D-15 — Move-to-Backlog and Cancel are offered only on OPEN tasks. A task that is done or
   * has already exited refuses both (S-task-17-1).
   */
  TASK_ALREADY_EXITED: 409,
  /**
   * R-plan-2 — planning edits the CURRENT week only. A plan save naming any other week is refused
   * wholesale, never partially applied (S-plan-2-1, Q-3).
   */
  WEEK_NOT_CURRENT: 409,
  /** Q-2 / Q-3 — a write carrying a stale `version` lost the race with another device. */
  CONCURRENT_UPDATE: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,

  /**
   * R-task-14 / R-nav-3 — a week outside the addressable range: a future week (never selectable anywhere)
   * or, on complete, a week earlier than the task's origin (S-task-14-2, S-nav-3-1).
   */
  WEEK_OUT_OF_RANGE: 422,
  VALIDATION_FAILED: 422,
  IDEMPOTENCY_KEY_REUSED: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  /** Returned by handler stubs a feature agent has not implemented yet. Never a client-visible state. */
  NOT_IMPLEMENTED: 501,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;
export const ERROR_CODES = Object.keys(ERROR_STATUS) as ErrorCode[];

/** The ONE error envelope. Every non-2xx response from `/api/*` and `/internal/*` has exactly this shape. */
export type ErrorEnvelope = {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown> };
};
