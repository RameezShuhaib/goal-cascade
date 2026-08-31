/**
 * Endpoint paths, relative to the `/api` base path. Constants and id-functions ONLY — never an inline
 * string at a call site, on either side. The client cannot typo a path, and renaming a route is one edit.
 */
export const API_BASE = '/api' as const;

export const ENDPOINTS = {
  // ── session ──
  health: '/health',
  me: '/me',
  mePreferences: '/me/preferences',
  /**
   * The lockout guard. This deployment cannot SEND mail (see `apps/api/src/infrastructure/email/`), so
   * "forgot password" is not a recovery path here: changing the password while still signed in is.
   */
  meChangePassword: '/me/change-password',
  /**
   * The ONE static bearer token that lets an external AI agent drive this account through `/mcp`.
   *
   * `GET` = status (`{ createdAt, last4 }` or `null`) — no password, never the plaintext.
   * `POST` = create-or-REPLACE, password required, returns the plaintext exactly ONCE.
   * `DELETE` = revoke, idempotent.
   *
   * There is deliberately no list and no `:id`: exactly one token exists per account, creating replaces,
   * so there is no state in which two tokens are live and therefore no endpoint that could produce one.
   */
  meApiToken: '/me/api-token',

  // ── cold open ──
  /** Everything the app needs on cold open, in one request (the mockup's `fetchAll`). */
  bootstrap: '/bootstrap',

  // ── goals ──
  /**
   * ⚠ **A2 (R-lens-16)** — `GET /goals?lens=<horizon>&period=<periodKey>` is a **scoped lens read**: one
   * horizon, one period, paginated, with each item's Life-goal group already resolved by the server. It
   * is NOT the whole tree, flat — that read model is retired (R-rm-5), because with a Weekly horizon it
   * would ship hundreds of goals a year and stop working in the second year, silently and gradually.
   *
   * `POST /goals` creates one. Levels may be skipped and **Weekly** is the terminal horizon (R-goal-31).
   */
  goals: '/goals',
  /**
   * ⚠ **A2, new (R-lens-22)** — the Zoom sheet's five rows in ONE grouped read: for each horizon, the
   * period an anchor date would land on and how many goals are there. It must never be five lens reads.
   *
   * Registered BEFORE `goal(':id')` so the literal wins the route match.
   */
  goalsZoom: '/goals/zoom',
  /**
   * ⚠ **A2, new (R-goal-46)** — `Repeat last week`: copies one Life line's previous-week Weekly goals into
   * the named week as ordinary new goals. No template, no series, no recurrence machinery.
   */
  goalsRepeatWeek: '/goals/repeat-week',
  /** `GET` = the detail page (R-goal-41); `PATCH` = edit; `DELETE?cascade=true` = subtree delete (Q-5). */
  goal: (id: string) => `/goals/${id}`,
  /**
   * Re-parent. Children move with the goal; the target must have a LONGER horizon and not be a descendant.
   * ⚠ **A2** — available on a **Weekly** goal too, and it may never change that goal's `periodKey`
   * (R-goal-40).
   */
  goalMove: (id: string) => `/goals/${id}/move`,
  /** Replaces the old "push": a new target `periodKey` plus an OPTIONAL one-line reason. */
  goalReplan: (id: string) => `/goals/${id}/replan`,

  // ── tasks (always scoped to a week via `?week=`) ──
  /**
   * ⚠ **A2 (R-rm-5)** — the Tasks SCREEN is gone; this read is not. It is the Weekly lens's data source
   * and it survives verbatim, minus the plan (R-rm-2) and the goal filter (R-rm-4).
   */
  tasks: '/tasks',
  task: (id: string) => `/tasks/${id}`,
  taskComplete: (id: string) => `/tasks/${id}/complete`,
  taskUncheck: (id: string) => `/tasks/${id}/uncheck`,
  /** Exit 2 of 3: the task becomes a backlog item under its goal, keeping description and links. */
  taskMoveToBacklog: (id: string) => `/tasks/${id}/move-to-backlog`,
  /** Exit 3 of 3: the task is dropped. */
  taskCancel: (id: string) => `/tasks/${id}/cancel`,
  taskLinks: (id: string) => `/tasks/${id}/links`,
  taskLink: (id: string, linkId: string) => `/tasks/${id}/links/${linkId}`,

  // ── backlog ──
  backlog: '/backlog',
  backlogItem: (id: string) => `/backlog/${id}`,
  /** Move to another non-life goal. */
  backlogItemMove: (id: string) => `/backlog/${id}/move`,
  /** The ONLY way backlog becomes work. The item is CONVERTED (removed), never duplicated. */
  backlogItemConvert: (id: string) => `/backlog/${id}/convert-to-task`,

  // ── learnings ──
  learnings: '/learnings',
  learning: (id: string) => `/learnings/${id}`,
  /** Re-tag to a (life) goal. A learning is never converted into work. */
  learningAttach: (id: string) => `/learnings/${id}/attach`,
} as const;

/**
 * The MCP endpoint. NOT under `${API_BASE}`, and that is load-bearing in three places:
 *
 *  - `app.ts` mounts it BEFORE `app.use(`${API_BASE}/*`, checkOrigin, requireSession, …)`, so the
 *    session guard never sees it — an external agent has a bearer token, not a cookie.
 *  - `wrangler.jsonc` must list `"/mcp"` in `assets.run_worker_first`; without it the SPA asset router
 *    answers `index.html` here and the Worker never runs (`tests/security/mcp-wiring.test.ts`).
 *  - it is one path, POST only. There is no `/sse`: the 2026-07-28 revision made MCP stateless and
 *    deprecated the 2024-11-05 HTTP+SSE transport.
 */
export const MCP_PATH = '/mcp' as const;

/** `gcm_` = **G**oal **C**ascade **M**CP. Prefixed so a leaked key is greppable and obvious in a log. */
export const API_TOKEN_PREFIX = 'gcm_' as const;

/** Headers the client must/should send. */
export const HEADERS = {
  idempotencyKey: 'Idempotency-Key',
  idempotentReplayed: 'Idempotent-Replayed',
  /** IANA zone of the caller's device. Seeds `preferences.timezone` at sign-up; the stored zone wins after. */
  timezone: 'X-Timezone',
  internalSecret: 'X-Internal-Secret',
} as const;

/** UUID v4 or any 16–64 chars of `[A-Za-z0-9_-]`. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
