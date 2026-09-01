import { z } from 'zod';
import {
  API_BASE,
  ApiTokenStatusResponse,
  BacklogItemResponse,
  BacklogResponse,
  BootstrapResponse,
  ConvertBacklogItemResponse,
  CreateApiTokenResponse,
  CreateTaskResponse,
  DeleteGoalResponse,
  DeleteResponse,
  ENDPOINTS,
  GoalDetailResponse,
  GoalResponse,
  GoalView,
  GoalsResponse,
  HEADERS,
  HealthResponse,
  Iso,
  LearningResponse,
  LearningsResponse,
  MeResponse,
  MoveTaskToBacklogResponse,
  PreferencesResponse,
  RevokeApiTokenResponse,
  TaskDetailResponse,
  TaskResponse,
  TasksResponse,
  ZoomResponse,
  type AddTaskLinkRequest,
  type AttachLearningRequest,
  type CancelTaskRequest,
  type CompleteTaskRequest,
  type ConvertBacklogItemRequest,
  type CreateBacklogItemRequest,
  type CreateGoalRequest,
  type CreateLearningRequest,
  type CreateTaskRequest,
  type Horizon,
  type MoveBacklogItemRequest,
  type MoveGoalRequest,
  type MoveTaskToBacklogRequest,
  type PatchBacklogItemRequest,
  type ReorderBacklogItemRequest,
  type PatchGoalRequest,
  type PatchLearningRequest,
  type PatchPreferencesRequest,
  type PatchTaskRequest,
  type ReplanGoalRequest,
  type RepeatWeekRequest,
  type UncheckTaskRequest,
} from '@goal-cascade/shared';
import { recordServerNow } from '../lib/serverClock';
import { ApiError, isKnownErrorCode } from './errors';

/**
 * `POST /goals/repeat-week` (R-goal-46). The API answers `{ created, serverNow }` and ships no response
 * schema of its own, so this one is **composed** from the shared `GoalView` rather than restating it —
 * a field renamed in `packages/shared` is a type error here, not a silent drift.
 */
const RepeatWeekResponse = z.object({ created: z.array(GoalView), serverNow: Iso });
export type RepeatWeekResponse = z.infer<typeof RepeatWeekResponse>;

/**
 * `POST /me/api-token`, parsed one notch looser than `CreateApiTokenResponse` — and ONLY here.
 *
 * This is the one response in the product that carries a value the server cannot produce a second time.
 * A `BAD_RESPONSE` thrown over a field the screen does not even render would destroy a token that has
 * already been written to the database, so the required set is narrowed to the single thing that matters:
 * `token.plaintext`. `createdAt`, `last4`, `mcpUrl` and `serverNow` are taken when they are there and
 * shrugged off when they are not — `AgentAccess` derives `last4` from the plaintext and the MCP URL from
 * this origin, so every one of them has an answer without the server.
 *
 * The shape is DERIVED from the shared schema rather than restated, so a field renamed in
 * `packages/shared` is a type error here rather than a silent drift. Nothing else in this client relaxes
 * a contract: everywhere else a mismatch should be loud, because everywhere else the data can be re-read.
 */
const ShownOnceApiTokenResponse = z.object({
  token: CreateApiTokenResponse.shape.token.partial().required({ plaintext: true }),
  // Loosened from `z.url()` / `Iso` on purpose — see above. A malformed value costs a fallback, not a token.
  mcpUrl: z.string().min(1).optional(),
  serverNow: z.string().optional(),
});

export interface HttpApiClientOptions {
  /** Origin the relative `/api` paths resolve against. Defaults to `location.origin`. */
  origin?: string;
  /** IANA timezone sent as `X-Timezone`. Defaults to the device timezone. */
  timezone?: string;
  fetch?: typeof fetch;
  /** `IDEMPOTENCY_IN_PROGRESS` is retried silently with the same key. */
  inProgressRetries?: number;
  inProgressDelayMs?: number;
}

type Query = Record<string, string | number | boolean | undefined>;

interface RequestInit_ {
  body?: unknown;
  query?: Query;
  idempotencyKey?: string;
}

/** `crypto.randomUUID` is missing on insecure origins (a phone on LAN http); fall back to v4 over getRandomValues. */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The ONE HTTP client. Endpoint-shaped methods — one per entry in the shared `ENDPOINTS` map — every
 * response parsed with its shared Zod schema, every failure surfaced as an `ApiError`.
 *
 * Everything the app knows about HTTP is in this file: URL building from `API_BASE`, the `X-Timezone` and
 * `Idempotency-Key` headers, the `{ error: { code, message } }` envelope, the silent retry on
 * `IDEMPOTENCY_IN_PROGRESS`. Hooks and components never see `fetch` — they see `useApi()`.
 *
 * Commands take their `Idempotency-Key` from the CALLER rather than minting one per request, so a retry of
 * the same intent reuses it (see `useCommand` in `queries.ts`). A client that minted its own key would make
 * every retry a fresh write, which is the one thing the header exists to prevent.
 *
 * Weeks go out as an OFFSET (`?week=-1`, `{ week: -1 }`) and come back as an absolute `weekStart` (D-1).
 * The client never derives a Monday: R-auth-5 puts that in the owner's timezone, server-side.
 */
export class HttpApiClient {
  private readonly origin: string;
  private readonly timezone: string;
  private readonly fetchFn: typeof fetch;
  private readonly inProgressRetries: number;
  private readonly inProgressDelayMs: number;

  constructor(opts: HttpApiClientOptions = {}) {
    this.origin = opts.origin ?? (typeof location !== 'undefined' ? location.origin : 'http://localhost');
    this.timezone = opts.timezone ?? deviceTimezone();
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
    this.inProgressRetries = opts.inProgressRetries ?? 3;
    this.inProgressDelayMs = opts.inProgressDelayMs ?? 500;
  }

  // ---- session ------------------------------------------------------------

  health() {
    return this.request('GET', ENDPOINTS.health, HealthResponse);
  }
  me() {
    return this.request('GET', ENDPOINTS.me, MeResponse);
  }
  preferences() {
    return this.request('GET', ENDPOINTS.mePreferences, PreferencesResponse);
  }
  patchPreferences(body: PatchPreferencesRequest) {
    return this.request('PATCH', ENDPOINTS.mePreferences, PreferencesResponse, { body });
  }

  // ---- agent access -------------------------------------------------------
  //
  // The three calls behind the Account sheet's "Agent access" section — one path, three methods, exactly
  // as `ENDPOINTS.meApiToken` and `me.routes.ts` have them. There is no list and no `:id`: one token per
  // account, and creating replaces.

  /** Status only — `{ createdAt, last4 }` or `null`, plus `mcpUrl`. Reading needs no password. */
  agentTokenStatus() {
    return this.request('GET', ENDPOINTS.meApiToken, ApiTokenStatusResponse);
  }
  /**
   * Create or replace. Re-authentication guards this call and only this call, and the plaintext comes back
   * exactly once — there is no read that can ever return it again. `Idempotency-Key` is REQUIRED: the route
   * is behind the `idempotent` middleware, and a request without the header is `400 IDEMPOTENCY_KEY_MISSING`.
   *
   * The secret is nested at `token.plaintext`, alongside the same `createdAt`/`last4` a status read gives.
   */
  createAgentToken(body: { password: string }, key: string) {
    return this.request('POST', ENDPOINTS.meApiToken, ShownOnceApiTokenResponse, { body, idempotencyKey: key });
  }
  /** Idempotent by construction — revoking when there is nothing to revoke answers `{ revoked: true }`. */
  revokeAgentToken() {
    return this.request('DELETE', ENDPOINTS.meApiToken, RevokeApiTokenResponse);
  }

  // ---- cold open ----------------------------------------------------------

  /** Everything the app needs on cold open, in one request (the mockup's `fetchAll`). */
  bootstrap(week?: number) {
    return this.request('GET', ENDPOINTS.bootstrap, BootstrapResponse, { query: { week } });
  }

  // ---- goals --------------------------------------------------------------

  /**
   * ⚠ **A2 (R-lens-16)** — `GET /goals` is the **scoped lens read**, not the whole tree flat. One horizon,
   * one period, paginated. `period` is omitted for the Life lens (which has none) and may be omitted
   * anywhere: the server then answers with the CURRENT period rather than erroring (R-lens-14), which is
   * how the client avoids ever deriving one (R-goal-34).
   */
  lens(q: { lens: Horizon; period?: string; cursor?: string; limit?: number }) {
    return this.request('GET', ENDPOINTS.goals, GoalsResponse, {
      query: { lens: q.lens, period: q.period, cursor: q.cursor, limit: q.limit },
    });
  }
  /** R-lens-22 — the Zoom sheet's five rows in ONE grouped read. Never five lens reads. */
  zoom(anchor?: string) {
    return this.request('GET', ENDPOINTS.goalsZoom, ZoomResponse, { query: { anchor } });
  }
  /** R-goal-46 — `Repeat last week`, for one Life line, into one week. Ordinary goals, no recurrence. */
  repeatWeek(body: RepeatWeekRequest, key: string) {
    return this.request('POST', ENDPOINTS.goalsRepeatWeek, RepeatWeekResponse, { body, idempotencyKey: key });
  }
  /** ⚠ **A2** — a goal's detail page is not week-scoped; only the Weekly lens is. No `?week=`. */
  goal(id: string) {
    return this.request('GET', ENDPOINTS.goal(id), GoalDetailResponse, {});
  }
  createGoal(body: CreateGoalRequest, key: string) {
    return this.request('POST', ENDPOINTS.goals, GoalResponse, { body, idempotencyKey: key });
  }
  patchGoal(id: string, body: PatchGoalRequest) {
    return this.request('PATCH', ENDPOINTS.goal(id), GoalResponse, { body });
  }
  /**
   * Q-5 — `cascade` is the explicit acknowledgement of a subtree delete. Without it a goal that still has
   * children is refused with `409 GOAL_HAS_CHILDREN` carrying the counts in `details`, which is exactly
   * what the confirmation sheet needs to render.
   */
  deleteGoal(id: string, opts: { cascade?: boolean } = {}) {
    return this.request('DELETE', ENDPOINTS.goal(id), DeleteGoalResponse, {
      query: opts.cascade ? { cascade: true } : undefined,
    });
  }
  /**
   * Q-5 — what deleting this goal WOULD destroy, with nothing destroyed. `dryRun` is the whole contract:
   * the same route, the same authorisation, no write.
   *
   * This exists because `GOAL_HAS_CHILDREN` only fires on descendant GOALS. A Monthly leaf holding forty
   * open tasks, their activity history and its backlog is childless by that test, so the refusal never
   * came and the confirmation the spec requires was never shown. A read is the only way to know before the
   * fact.
   *
   * The answer is a whole `DeleteGoalResponse` with `deleted: false` — the same schema the live delete
   * returns, because it is the same handler doing the same subtree walk. `cascade` is deliberately not
   * sent: a preview is never refused, so the parameter would change nothing.
   */
  goalDeletePreview(id: string) {
    return this.request('DELETE', ENDPOINTS.goal(id), DeleteGoalResponse, { query: { dryRun: true } });
  }
  moveGoal(id: string, body: MoveGoalRequest, key: string) {
    return this.request('POST', ENDPOINTS.goalMove(id), GoalResponse, { body, idempotencyKey: key });
  }
  replanGoal(id: string, body: ReplanGoalRequest, key: string) {
    return this.request('POST', ENDPOINTS.goalReplan(id), GoalResponse, { body, idempotencyKey: key });
  }

  // ---- tasks --------------------------------------------------------------
  //
  // ⚠ **A2 (R-rm-5)** — the Tasks SCREEN is gone, and so is this client's use of the read. The Weekly
  // lens takes its tasks from `LensResponse.tasks` in the same payload as its goals (`useLens`), which is
  // the whole point of one lens being one request. `GET /tasks` itself is very much alive — it is what
  // the MCP surface's `list_tasks` is backed by — but on THIS client the only caller is `useTasks`, and
  // `useTasks` has no production consumer. Kept because the endpoint is real and the wrapper is three
  // lines; do not describe it as a lens input again.

  tasks(q: { week?: number; limit?: number } = {}) {
    return this.request('GET', ENDPOINTS.tasks, TasksResponse, { query: { week: q.week, limit: q.limit } });
  }
  task(id: string, week?: number) {
    return this.request('GET', ENDPOINTS.task(id), TaskDetailResponse, { query: { week } });
  }
  /**
   * ⚠ **A2 (R-task-48)** — the response carries the Weekly goal that was created for this task, when one
   * was, so the client can say so: nothing may be created invisibly (R-task-49).
   */
  createTask(body: CreateTaskRequest, key: string) {
    return this.request('POST', ENDPOINTS.tasks, CreateTaskResponse, { body, idempotencyKey: key });
  }
  patchTask(id: string, body: PatchTaskRequest) {
    return this.request('PATCH', ENDPOINTS.task(id), TaskResponse, { body });
  }
  completeTask(id: string, body: CompleteTaskRequest, key: string) {
    return this.request('POST', ENDPOINTS.taskComplete(id), TaskResponse, { body, idempotencyKey: key });
  }
  uncheckTask(id: string, body: UncheckTaskRequest, key: string) {
    return this.request('POST', ENDPOINTS.taskUncheck(id), TaskResponse, { body, idempotencyKey: key });
  }
  /** Exit 2 of 3 — answers with the task's terminal state AND the item it became, so both caches patch. */
  moveTaskToBacklog(id: string, body: MoveTaskToBacklogRequest, key: string) {
    return this.request('POST', ENDPOINTS.taskMoveToBacklog(id), MoveTaskToBacklogResponse, { body, idempotencyKey: key });
  }
  cancelTask(id: string, body: CancelTaskRequest, key: string) {
    return this.request('POST', ENDPOINTS.taskCancel(id), TaskResponse, { body, idempotencyKey: key });
  }
  addTaskLink(id: string, body: AddTaskLinkRequest, key: string) {
    return this.request('POST', ENDPOINTS.taskLinks(id), TaskResponse, { body, idempotencyKey: key });
  }
  /** D-13 — links are addressed by their own id, never by list index. */
  removeTaskLink(id: string, linkId: string) {
    return this.request('DELETE', ENDPOINTS.taskLink(id, linkId), TaskResponse);
  }

  // ---- backlog ------------------------------------------------------------

  backlog(q: { goalId?: string; limit?: number } = {}) {
    return this.request('GET', ENDPOINTS.backlog, BacklogResponse, { query: { goalId: q.goalId, limit: q.limit } });
  }
  createBacklogItem(body: CreateBacklogItemRequest, key: string) {
    return this.request('POST', ENDPOINTS.backlog, BacklogItemResponse, { body, idempotencyKey: key });
  }
  patchBacklogItem(id: string, body: PatchBacklogItemRequest) {
    return this.request('PATCH', ENDPOINTS.backlogItem(id), BacklogItemResponse, { body });
  }
  deleteBacklogItem(id: string) {
    return this.request('DELETE', ENDPOINTS.backlogItem(id), DeleteResponse);
  }
  moveBacklogItem(id: string, body: MoveBacklogItemRequest, key: string) {
    return this.request('POST', ENDPOINTS.backlogItemMove(id), BacklogItemResponse, { body, idempotencyKey: key });
  }
  /**
   * R-backlog-19 — the manual order, as one RELATIVE move: `after`, `before`, `to`. The client never
   * computes, parses or sends a `sortKey`; there is no field for one.
   */
  reorderBacklogItem(id: string, body: ReorderBacklogItemRequest, key: string) {
    return this.request('POST', ENDPOINTS.backlogItemReorder(id), BacklogItemResponse, { body, idempotencyKey: key });
  }
  /** R-backlog-6 — the only way backlog becomes work. The item is CONVERTED, never duplicated (D-19). */
  convertBacklogItem(id: string, body: ConvertBacklogItemRequest, key: string) {
    return this.request('POST', ENDPOINTS.backlogItemConvert(id), ConvertBacklogItemResponse, { body, idempotencyKey: key });
  }

  // ---- learnings ----------------------------------------------------------

  learnings() {
    return this.request('GET', ENDPOINTS.learnings, LearningsResponse);
  }
  createLearning(body: CreateLearningRequest, key: string) {
    return this.request('POST', ENDPOINTS.learnings, LearningResponse, { body, idempotencyKey: key });
  }
  patchLearning(id: string, body: PatchLearningRequest) {
    return this.request('PATCH', ENDPOINTS.learning(id), LearningResponse, { body });
  }
  deleteLearning(id: string) {
    return this.request('DELETE', ENDPOINTS.learning(id), DeleteResponse);
  }
  attachLearning(id: string, body: AttachLearningRequest, key: string) {
    return this.request('POST', ENDPOINTS.learningAttach(id), LearningResponse, { body, idempotencyKey: key });
  }

  // ---- transport ----------------------------------------------------------

  private url(path: string, query?: Query): string {
    const u = new URL(API_BASE + path, this.origin);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        // Every request schema is `.strict()`, including the query ones: an `undefined` must be OMITTED,
        // never sent as the string "undefined", or the server answers 422 instead of defaulting.
        if (v === undefined) continue;
        u.searchParams.set(k, String(v));
      }
    }
    return u.toString();
  }

  private async request<S extends z.ZodType>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    schema: S,
    init: RequestInit_ = {},
  ): Promise<z.output<S>> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      // R-auth-5 — seeds `preferences.timezone` at sign-up; after that the STORED zone wins and this is
      // informational. Sent on every request anyway so the server never has to ask.
      [HEADERS.timezone]: this.timezone,
    };
    if (init.idempotencyKey) headers[HEADERS.idempotencyKey] = init.idempotencyKey;
    const hasBody = method !== 'GET' && method !== 'DELETE';
    if (hasBody) headers['Content-Type'] = 'application/json';

    const attempts = init.idempotencyKey ? this.inProgressRetries + 1 : 1;
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchFn(this.url(path, init.query), {
          method,
          headers,
          credentials: 'include',
          // The API sets no `Cache-Control` on `/api/*`, so pin it here: `no-store` keeps every
          // authenticated response out of the browser's HTTP cache in both directions. The service
          // worker's `CacheStorage` copy (the one an offline open reads) is written explicitly by
          // `sw/handlers.ts` and is unaffected.
          cache: 'no-store',
          body: hasBody ? JSON.stringify(init.body ?? {}) : undefined,
        });
      } catch (e) {
        throw new ApiError(0, 'NETWORK', e instanceof Error ? e.message : 'network error');
      }

      if (!res.ok) {
        const err = await this.toError(res);
        // The first request under this key is still executing on another connection. Same key, so the
        // retry either joins the stored response or executes once — never twice.
        if (err.code === 'IDEMPOTENCY_IN_PROGRESS' && attempt < attempts) {
          await sleep(this.inProgressDelayMs);
          continue;
        }
        throw err;
      }

      if (res.status === 204) return schema.parse(undefined) as z.output<S>;
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new ApiError(res.status, 'BAD_RESPONSE', 'response was not JSON');
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        const where = first ? first.path.join('.') + ': ' + first.message : 'unknown issue';
        throw new ApiError(res.status, 'BAD_RESPONSE', `${method} ${path} did not match the contract (${where})`, {
          issues: parsed.error.issues,
        });
      }
      const data = parsed.data as z.output<S>;
      const serverNow = (data as unknown as { serverNow?: unknown } | null)?.serverNow;
      if (typeof serverNow === 'string') recordServerNow(serverNow);
      return data;
    }
  }

  private async toError(res: Response): Promise<ApiError> {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* not JSON — a proxy error page, or an empty body */
    }
    const env = body as { error?: { code?: unknown; message?: unknown; details?: unknown } } | null;
    const code = env?.error?.code;
    const message = typeof env?.error?.message === 'string' ? env.error.message : `HTTP ${res.status}`;
    const details = env?.error?.details;
    const asDetails = details && typeof details === 'object' ? (details as Record<string, unknown>) : undefined;
    if (isKnownErrorCode(code)) return new ApiError(res.status, code, message, asDetails);
    // An unknown code (a newer server) still has a usable meaning by status. A 409 we do not recognise is
    // still "a guarded write lost a race"; anything else 4xx is not worth a same-key retry.
    const fallback: ApiError['code'] =
      res.status === 401
        ? 'UNAUTHENTICATED'
        : res.status === 403
          ? 'FORBIDDEN'
          : res.status === 404
            ? 'NOT_FOUND'
            : res.status === 409
              ? 'CONCURRENT_UPDATE'
              : res.status === 422
                ? 'VALIDATION_FAILED'
                : res.status === 429
                  ? 'RATE_LIMITED'
                  : 'INTERNAL';
    return new ApiError(res.status, fallback, message, asDetails);
  }
}

export type ApiClient = HttpApiClient;
