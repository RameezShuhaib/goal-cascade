import { API_BASE, ENDPOINTS } from '@goal-cascade/shared';
import { describe, expect, it } from 'vitest';
import { createTestApp, signedInOwner } from './helpers/app';

/**
 * The route census.
 *
 * The foundation registers EVERY endpoint now — validated, session-gated, idempotency-wrapped — and
 * leaves the service behind it unimplemented. That is deliberate: three feature agents left to design
 * their own route shapes will design three different ones.
 *
 * This test is what makes "every endpoint is registered" a checked fact. A route that is missing (or
 * mounted at the wrong path) answers 404 NOT_FOUND, which fails here; a route that is registered but
 * unimplemented answers 501, which passes. When a feature agent lands a service, its rows flip from 501
 * to a real status and the "not 404" assertion still holds.
 */
const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });
const ULID = '01J9ZQ8V2M7K3PQRSTVWXY0123';

type Row = { method: string; path: string; json?: unknown; command?: boolean };

/** Every endpoint in the ENDPOINTS map, with a body that PASSES its schema. */
const ROUTES: Row[] = [
  { method: 'GET', path: ENDPOINTS.me },
  { method: 'GET', path: ENDPOINTS.mePreferences },
  { method: 'PATCH', path: ENDPOINTS.mePreferences, json: { theme: 'dark' } },
  { method: 'GET', path: ENDPOINTS.bootstrap },

  { method: 'GET', path: ENDPOINTS.goals },
  { method: 'POST', path: ENDPOINTS.goals, json: { title: 'A life goal', horizon: 'Life' }, command: true },
  { method: 'GET', path: ENDPOINTS.goal(ULID) },
  { method: 'PATCH', path: ENDPOINTS.goal(ULID), json: { title: 'Renamed' } },
  { method: 'DELETE', path: ENDPOINTS.goal(ULID) },
  { method: 'POST', path: ENDPOINTS.goalMove(ULID), json: { parentId: ULID }, command: true },
  { method: 'POST', path: ENDPOINTS.goalReplan(ULID), json: { period: '2027' }, command: true },

  { method: 'GET', path: ENDPOINTS.plan },
  { method: 'PUT', path: ENDPOINTS.plan, json: { weekStart: '2026-08-31', entries: [] }, command: true },

  { method: 'GET', path: ENDPOINTS.tasks },
  { method: 'POST', path: ENDPOINTS.tasks, json: { goalId: ULID, title: 'Do the thing' }, command: true },
  { method: 'GET', path: ENDPOINTS.task(ULID) },
  { method: 'PATCH', path: ENDPOINTS.task(ULID), json: { title: 'Renamed' } },
  { method: 'POST', path: ENDPOINTS.taskComplete(ULID), json: {}, command: true },
  { method: 'POST', path: ENDPOINTS.taskUncheck(ULID), json: {}, command: true },
  { method: 'POST', path: ENDPOINTS.taskMoveToBacklog(ULID), json: {}, command: true },
  { method: 'POST', path: ENDPOINTS.taskCancel(ULID), json: {}, command: true },
  { method: 'POST', path: ENDPOINTS.taskLinks(ULID), json: { url: 'https://example.com/x' }, command: true },
  { method: 'DELETE', path: ENDPOINTS.taskLink(ULID, ULID) },

  { method: 'GET', path: ENDPOINTS.backlog },
  { method: 'POST', path: ENDPOINTS.backlog, json: { goalId: ULID, title: 'Later' }, command: true },
  { method: 'PATCH', path: ENDPOINTS.backlogItem(ULID), json: { title: 'Renamed' } },
  { method: 'DELETE', path: ENDPOINTS.backlogItem(ULID) },
  { method: 'POST', path: ENDPOINTS.backlogItemMove(ULID), json: { goalId: ULID }, command: true },
  { method: 'POST', path: ENDPOINTS.backlogItemConvert(ULID), json: {}, command: true },

  { method: 'GET', path: ENDPOINTS.ideas },
  { method: 'POST', path: ENDPOINTS.ideas, json: { text: 'a thought' }, command: true },
  { method: 'DELETE', path: ENDPOINTS.idea(ULID) },
  { method: 'POST', path: ENDPOINTS.ideaAttach(ULID), json: { goalId: ULID }, command: true },
  { method: 'POST', path: ENDPOINTS.ideaConvert(ULID), json: { goalId: ULID }, command: true },

  { method: 'GET', path: ENDPOINTS.learnings },
  { method: 'POST', path: ENDPOINTS.learnings, json: { text: 'an insight' }, command: true },
  { method: 'PATCH', path: ENDPOINTS.learning(ULID), json: { applied: true } },
  { method: 'DELETE', path: ENDPOINTS.learning(ULID) },
  { method: 'POST', path: ENDPOINTS.learningAttach(ULID), json: { goalId: null }, command: true },
];

describe('the route surface', () => {
  it('every endpoint in ENDPOINTS is registered', async () => {
    const { cookie } = await signedInOwner(t);
    for (const r of ROUTES) {
      const res = await t.fetch(`${API_BASE}${r.path}`, {
        method: r.method,
        cookie,
        ...(r.json !== undefined ? { json: r.json } : {}),
        idempotencyKey: crypto.randomUUID(),
      });
      const body = res.status === 404 ? ((await res.json()) as { error: { message: string } }) : null;
      // An UNREGISTERED path answers the notFound handler's `route not found`. A registered one whose
      // referenced entity does not exist (these use a syntactically valid but unused ULID) answers
      // `goal not found` etc. — that is the guard doing its job, not a missing route.
      expect(body?.error.message, `${r.method} ${r.path} is not registered`).not.toBe('route not found');
      expect([200, 201, 204, 404, 409, 501], `${r.method} ${r.path} → ${res.status}`).toContain(res.status);
    }
  });

  it('every route is behind the session gate — R-auth-4 has no exceptions', async () => {
    for (const r of ROUTES) {
      const res = await t.fetch(`${API_BASE}${r.path}`, {
        method: r.method,
        ...(r.json !== undefined ? { json: r.json } : {}),
        idempotencyKey: crypto.randomUUID(),
      });
      expect(res.status, `${r.method} ${r.path} is reachable without a session`).toBe(401);
    }
  });

  it('the census covers the whole ENDPOINTS map — a new endpoint must be added here too', () => {
    const covered = new Set(ROUTES.map((r) => r.path));
    const declared = Object.entries(ENDPOINTS)
      // `health` is public and lives in app.ts, not a route module.
      .filter(([name]) => name !== 'health')
      .map(([, v]) => (typeof v === 'function' ? (v as (...a: string[]) => string)(ULID, ULID) : v));
    for (const path of declared) expect(covered.has(path), `${path} is in ENDPOINTS but not exercised here`).toBe(true);
  });

  it('R-nav-14 — nothing removed by design has an endpoint', async () => {
    const { cookie } = await signedInOwner(t);
    // No weekly review wizard, no audit trail, no week report, no push flow. These must not exist —
    // "out of scope and must be refused, not deferred".
    for (const path of ['/reviews', '/audit', '/reports', '/weeks/report', '/push/subscribe', '/push/vapid-public-key']) {
      const res = await t.fetch(`${API_BASE}${path}`, { cookie });
      expect(res.status, path).toBe(404);
      expect(((await res.json()) as { error: { message: string } }).error.message, path).toBe('route not found');
    }
  });

  it('R-task-13 — there is no fourth task exit: no defer, snooze, reschedule or move-to-another-week', async () => {
    const { cookie } = await signedInOwner(t);
    for (const action of ['defer', 'snooze', 'reschedule', 'move-to-week']) {
      const res = await t.fetch(`${API_BASE}${ENDPOINTS.task(ULID)}/${action}`, {
        method: 'POST',
        cookie,
        idempotencyKey: crypto.randomUUID(),
        json: {},
      });
      expect(res.status, action).toBe(404);
      expect(((await res.json()) as { error: { message: string } }).error.message, action).toBe('route not found');
    }
  });
});
