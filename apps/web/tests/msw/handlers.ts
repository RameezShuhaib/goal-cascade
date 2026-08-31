import { http, HttpResponse, type HttpHandler } from 'msw';
import { setupServer } from 'msw/node';
import { ERROR_STATUS, type ErrorCode } from '@goal-cascade/shared';
import * as F from './fixtures';

/**
 * MSW stands in for the Worker. Tests exercise the REAL client, the real query wiring and the real screens
 * — only the socket is faked — so a test that passes is evidence about the code that ships, and a contract
 * drift shows up as a Zod parse failure rather than as a green test against a hand-stubbed client.
 */

/** The SPEC §5 envelope, with the status from the shared table so the two can never disagree. */
export const apiError = (code: ErrorCode, message: string = code, details?: Record<string, unknown>) =>
  HttpResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status: ERROR_STATUS[code] });

/** Better Auth's error body: `{ code, message }`, no envelope, its own status. */
export const authError = (code: string, status: number, message: string = code) => HttpResponse.json({ code, message }, { status });

/** Better Auth's sign-in / sign-up success body. */
export const authSuccess = (user: Record<string, unknown> = F.authUser()) =>
  HttpResponse.json({ redirect: false, token: 'session-token', user });

/** Commands must carry an Idempotency-Key — mirror the Worker's middleware so a missing one fails here too. */
const requireKey = (request: Request) => (request.headers.get('Idempotency-Key') ? null : apiError('IDEMPOTENCY_KEY_MISSING'));

const cmd =
  (respond: (request: Request) => Response | Promise<Response>) =>
  async ({ request }: { request: Request }) =>
    requireKey(request) ?? (await respond(request));

/** Default happy path. Tests narrow with `server.use(...)`. */
export const handlers: HttpHandler[] = [
  http.get('/api/me', () => HttpResponse.json(F.me())),
  http.get('/api/me/preferences', () => HttpResponse.json(F.preferencesResponse())),
  http.patch('/api/me/preferences', () => HttpResponse.json(F.preferencesResponse())),
  http.get('/api/bootstrap', () => HttpResponse.json(F.bootstrapResponse())),

  http.get('/api/goals', () => HttpResponse.json(F.goalsResponse())),
  http.get('/api/goals/:id', () => HttpResponse.json(F.goalDetailResponse())),
  http.post('/api/goals', cmd(() => HttpResponse.json(F.goalResponse(), { status: 201 }))),
  http.patch('/api/goals/:id', () => HttpResponse.json(F.goalResponse())),
  http.delete('/api/goals/:id', () =>
    HttpResponse.json({
      deleted: true,
      removed: { goals: 1, weeklyFocuses: 0, tasks: 0, taskEvents: 0, backlogItems: 0 },
      untagged: { ideas: 0, learnings: 0 },
      serverNow: F.NOW,
    }),
  ),
  http.post('/api/goals/:id/move', cmd(() => HttpResponse.json(F.goalResponse()))),
  http.post('/api/goals/:id/replan', cmd(() => HttpResponse.json(F.goalResponse()))),

  http.get('/api/plan', () => HttpResponse.json(F.planResponse())),
  http.put('/api/plan', cmd(() => HttpResponse.json(F.planResponse()))),

  http.get('/api/tasks', () => HttpResponse.json(F.tasksResponse())),
  http.get('/api/tasks/:id', () => HttpResponse.json(F.taskResponse())),
  http.post('/api/tasks', cmd(() => HttpResponse.json(F.taskResponse(), { status: 201 }))),
  http.patch('/api/tasks/:id', () => HttpResponse.json(F.taskResponse())),
  http.post('/api/tasks/:id/complete', cmd(() => HttpResponse.json(F.taskResponse({ status: 'done', done: true, doneWeekStart: F.THIS_MONDAY, doneAt: F.NOW })))),
  http.post('/api/tasks/:id/uncheck', cmd(() => HttpResponse.json(F.taskResponse()))),
  http.post(
    '/api/tasks/:id/move-to-backlog',
    cmd(() =>
      HttpResponse.json({
        task: F.taskDetail({ status: 'movedToBacklog', exitedAt: F.NOW }),
        item: F.backlogItem({ fromWeekStart: F.THIS_MONDAY }),
        serverNow: F.NOW,
      }),
    ),
  ),
  http.post('/api/tasks/:id/cancel', cmd(() => HttpResponse.json(F.taskResponse({ status: 'canceled', exitedAt: F.NOW })))),
  http.post('/api/tasks/:id/links', cmd(() => HttpResponse.json(F.taskResponse()))),
  http.delete('/api/tasks/:id/links/:linkId', () => HttpResponse.json(F.taskResponse())),

  http.get('/api/backlog', () => HttpResponse.json(F.backlogResponse())),
  http.post('/api/backlog', cmd(() => HttpResponse.json(F.backlogItemResponse(), { status: 201 }))),
  http.patch('/api/backlog/:id', () => HttpResponse.json(F.backlogItemResponse())),
  http.delete('/api/backlog/:id', () => HttpResponse.json({ deleted: true, serverNow: F.NOW })),
  http.post('/api/backlog/:id/move', cmd(() => HttpResponse.json(F.backlogItemResponse()))),
  http.post(
    '/api/backlog/:id/convert-to-task',
    cmd(() =>
      HttpResponse.json(
        { task: F.taskDetail(), item: F.backlogItem({ status: 'converted', convertedToTaskId: F.ulid(20), convertedAt: F.NOW }), serverNow: F.NOW },
        { status: 201 },
      ),
    ),
  ),

  http.get('/api/ideas', () => HttpResponse.json(F.ideasResponse())),
  http.post('/api/ideas', cmd(() => HttpResponse.json({ idea: F.idea(), serverNow: F.NOW }, { status: 201 }))),
  http.delete('/api/ideas/:id', () => HttpResponse.json({ deleted: true, serverNow: F.NOW })),
  http.post('/api/ideas/:id/attach', cmd(() => HttpResponse.json({ item: F.backlogItem(), ideaId: F.ulid(50), serverNow: F.NOW }))),
  http.post('/api/ideas/:id/convert-to-task', cmd(() => HttpResponse.json({ task: F.taskDetail(), ideaId: F.ulid(50), serverNow: F.NOW }, { status: 201 }))),

  http.get('/api/learnings', () => HttpResponse.json(F.learningsResponse())),
  http.post('/api/learnings', cmd(() => HttpResponse.json({ learning: F.learning(), serverNow: F.NOW }, { status: 201 }))),
  http.patch('/api/learnings/:id', () => HttpResponse.json({ learning: F.learning(), serverNow: F.NOW })),
  http.delete('/api/learnings/:id', () => HttpResponse.json({ deleted: true, serverNow: F.NOW })),
  http.post('/api/learnings/:id/attach', cmd(() => HttpResponse.json({ learning: F.learning(), serverNow: F.NOW }))),

  // ---- Better Auth (mounted at /api/auth/*; bodies are Better Auth's, not the §5 envelope) ----
  http.post('/api/auth/sign-in/email', () => authSuccess()),
  http.post('/api/auth/sign-up/email', () => authSuccess()),
  http.post('/api/auth/sign-out', () => HttpResponse.json({ success: true })),
  http.get('/api/auth/get-session', () => HttpResponse.json(null)),
  http.post('/api/auth/send-verification-email', () => HttpResponse.json({ status: true })),
  http.post('/api/auth/request-password-reset', () => HttpResponse.json({ status: true })),
  http.post('/api/auth/reset-password', () => HttpResponse.json({ status: true })),
];

export const server = setupServer(...handlers);

// ---- request recorder ------------------------------------------------------

const recorded: Request[] = [];
server.events.on('request:start', ({ request }) => {
  recorded.push(request.clone());
});
export const resetRequests = () => {
  recorded.length = 0;
};

/**
 * Requests seen so far, filtered by method and path. A full `/api/...` path matches exactly; a fragment
 * (`/complete`) or a prefix ending in `/` matches by substring.
 */
const pathMatches = (pathname: string, path: string) =>
  path.startsWith('/api/') && !path.endsWith('/') ? pathname === path : pathname.includes(path);
export const requests = (method?: string, path?: string) =>
  recorded.filter((r) => (!method || r.method === method) && (!path || pathMatches(new URL(r.url).pathname, path)));
export const lastRequest = (method?: string, path?: string) => requests(method, path).at(-1);
export const bodyOf = async (r: Request | undefined) => (r ? ((await r.json()) as Record<string, unknown>) : undefined);
export const keysOf = (method: string, path: string) => requests(method, path).map((r) => r.headers.get('Idempotency-Key'));
