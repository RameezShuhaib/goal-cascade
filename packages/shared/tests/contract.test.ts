import { describe, expect, it } from 'vitest';
import {
  API_BASE,
  CreateGoalRequest,
  CreateTaskRequest,
  DeleteGoalQuery,
  ENDPOINTS,
  ERROR_CODES,
  ERROR_STATUS,
  IDEMPOTENCY_KEY_PATTERN,
  Iso,
  PatchGoalRequest,
  SavePlanRequest,
  TasksQuery,
  Ulid,
  Url,
  WEEK_HISTORY_WEEKS,
  WeekOffset,
  WeekOffsetParam,
  WeekStart,
} from '../src/index';

describe('error codes', () => {
  it('every code maps to a plausible HTTP status', () => {
    for (const code of ERROR_CODES) {
      const status = ERROR_STATUS[code];
      expect(status, code).toBeGreaterThanOrEqual(400);
      expect(status, code).toBeLessThan(600);
    }
  });

  it('the domain codes the SPEC needs are present with the documented status', () => {
    expect(ERROR_STATUS.HORIZON_CONFLICT).toBe(409); // R-goal-5/6/17
    expect(ERROR_STATUS.WOULD_CREATE_CYCLE).toBe(409); // R-goal-18
    expect(ERROR_STATUS.GOAL_HAS_CHILDREN).toBe(409); // Q-5
    expect(ERROR_STATUS.GOAL_HAS_OPEN_TASKS).toBe(409); // R-goal-28 / D-8
    expect(ERROR_STATUS.LIFE_GOAL_IMMUTABLE).toBe(409); // R-goal-21
    expect(ERROR_STATUS.NOT_A_LEAF).toBe(409); // R-plan-8
    expect(ERROR_STATUS.NOT_A_LIFE_GOAL).toBe(409); // R-idea-2
    expect(ERROR_STATUS.BRANCH_NOT_ACTIVE).toBe(409); // R-backlog-8
    expect(ERROR_STATUS.LIFE_GOAL_NO_BACKLOG).toBe(409); // R-backlog-2
    expect(ERROR_STATUS.ALREADY_CONVERTED).toBe(409); // R-backlog-6 / D-19
    expect(ERROR_STATUS.TASK_ALREADY_EXITED).toBe(409); // R-task-17
    expect(ERROR_STATUS.WEEK_NOT_CURRENT).toBe(409); // R-plan-2
    expect(ERROR_STATUS.WEEK_OUT_OF_RANGE).toBe(422); // R-task-14
    expect(ERROR_STATUS.SIGNUP_NOT_ALLOWED).toBe(403); // R-auth-1
    expect(ERROR_STATUS.NOT_IMPLEMENTED).toBe(501);
  });
});

describe('scalars normalise in the schema, not in handlers', () => {
  it('Iso accepts an offset and normalises to 24-char UTC', () => {
    expect(Iso.parse('2026-08-31T12:00:00+02:00')).toBe('2026-08-31T10:00:00.000Z');
    expect(Iso.parse('2026-08-31T10:00:00.000Z')).toHaveLength(24);
  });

  it('Ulid rejects lowercase and the excluded Crockford letters', () => {
    expect(Ulid.safeParse('01J9ZQ8V2M7K3PQRSTVWXY0123').success).toBe(true);
    expect(Ulid.safeParse('01j9zq8v2m7k3pqrstvwxy0123').success).toBe(false);
    expect(Ulid.safeParse('01J9ZQ8V2M7K3PQRSTVWXY012I').success).toBe(false);
  });

  it('D-1: WeekStart must be an ISO date that really is a Monday', () => {
    expect(WeekStart.parse('2026-08-31')).toBe('2026-08-31'); // a Monday
    expect(WeekStart.safeParse('2026-09-01').success).toBe(false); // Tuesday
    expect(WeekStart.safeParse('2026-08-30').success).toBe(false); // Sunday
    expect(WeekStart.safeParse('2026-08-31T00:00:00Z').success).toBe(false);
  });

  it('R-nav-3: WeekOffset refuses the future — no screen can select a week > 0', () => {
    expect(WeekOffset.parse(0)).toBe(0);
    expect(WeekOffset.parse(-4)).toBe(-4);
    expect(WeekOffset.safeParse(1).success).toBe(false);
    expect(WeekOffset.safeParse(-1.5).success).toBe(false);
  });

  it('WeekOffsetParam coerces a query string and still refuses the future', () => {
    expect(WeekOffsetParam.parse('-2')).toBe(-2);
    expect(WeekOffsetParam.safeParse('3').success).toBe(false);
  });

  it('D-24: there is exactly one week-history bound, and both controls read it from here', () => {
    expect(WEEK_HISTORY_WEEKS).toBe(8);
  });

  it('Q-11: a link must parse as http(s); other schemes are refused, not stored', () => {
    expect(Url.safeParse('https://github.com/acme/pr/1').success).toBe(true);
    expect(Url.safeParse('javascript:alert(1)').success).toBe(false);
    expect(Url.safeParse('mailto:me@example.com').success).toBe(false);
  });
});

describe('request schemas are strict', () => {
  it('an unknown key is refused, not dropped', () => {
    const r = CreateGoalRequest.safeParse({ title: 'Ship it', horizon: 'Life', typo: 1 });
    expect(r.success).toBe(false);
  });

  it('defaults fill in the optional fields', () => {
    const r = CreateGoalRequest.parse({ title: '  Ship it  ', horizon: 'Life' });
    expect(r).toMatchObject({ title: 'Ship it', why: '', parentId: null, pulse: 'On track' });
  });

  it('S-goal-29-1: a whitespace-only title is a validation failure, not a silent no-op', () => {
    expect(CreateGoalRequest.safeParse({ title: '   ', horizon: 'Life' }).success).toBe(false);
    expect(CreateTaskRequest.safeParse({ goalId: '01J9ZQ8V2M7K3PQRSTVWXY0123', title: '  ' }).success).toBe(false);
  });

  it('S-task-3-1: a task always names its goal and its source; cond is optional', () => {
    const r = CreateTaskRequest.parse({ goalId: '01J9ZQ8V2M7K3PQRSTVWXY0123', title: 'Run' });
    expect(r).toMatchObject({ cond: '', description: '', links: [], source: 'planning' });
    expect(CreateTaskRequest.safeParse({ title: 'Run' }).success).toBe(false);
  });

  it('S-goal-14-2: PatchGoalRequest cannot re-parent or re-horizon a goal', () => {
    expect(PatchGoalRequest.safeParse({ parentId: null }).success).toBe(false);
    expect(PatchGoalRequest.safeParse({ horizon: 'Yearly' }).success).toBe(false);
  });

  it('R-plan-7: the plan is saved as a whole set, and always names its week', () => {
    const r = SavePlanRequest.parse({
      weekStart: '2026-08-31',
      entries: [{ goalId: '01J9ZQ8V2M7K3PQRSTVWXY0123', sentence: 'Three runs' }],
    });
    expect(r.entries).toHaveLength(1);
    // no weekStart → the server could not tell a stale save from a current one (R-plan-2)
    expect(SavePlanRequest.safeParse({ entries: [] }).success).toBe(false);
    expect(
      SavePlanRequest.safeParse({ weekStart: '2026-08-31', entries: [{ goalId: '01J9ZQ8V2M7K3PQRSTVWXY0123' }] }).success,
    ).toBe(false);
  });

  it('TasksQuery coerces week and rejects junk', () => {
    expect(TasksQuery.parse({ week: '-1' })).toEqual({ week: -1 });
    expect(TasksQuery.parse({})).toEqual({});
    expect(TasksQuery.safeParse({ week: 'soon' }).success).toBe(false);
  });

  it('Q-5: the destructive subtree delete is opt-in through an explicit query flag', () => {
    expect(DeleteGoalQuery.parse({ cascade: 'true' })).toEqual({ cascade: true });
    expect(DeleteGoalQuery.parse({})).toEqual({});
    expect(DeleteGoalQuery.safeParse({ cascade: 'maybe' }).success).toBe(false);
  });
});

describe('endpoints', () => {
  it('are constants and id-functions, never inline strings', () => {
    expect(API_BASE).toBe('/api');
    expect(ENDPOINTS.goal('abc')).toBe('/goals/abc');
    expect(ENDPOINTS.taskLink('t', 'l')).toBe('/tasks/t/links/l');
    expect(ENDPOINTS.bootstrap).toBe('/bootstrap');
  });

  it('every path starts with a slash and carries no /api prefix (API_BASE is added once)', () => {
    for (const [name, v] of Object.entries(ENDPOINTS)) {
      const path = typeof v === 'function' ? (v as (...a: string[]) => string)('x', 'y') : v;
      expect(path.startsWith('/'), name).toBe(true);
      expect(path.startsWith('/api'), name).toBe(false);
    }
  });

  it('R-nav-14: nothing removed by design has an endpoint', () => {
    const paths = Object.values(ENDPOINTS)
      .map((v) => (typeof v === 'function' ? (v as (...a: string[]) => string)('x', 'y') : v))
      .join(' ');
    for (const banned of ['review', 'audit', 'report', 'push', 'wizard', 'defer', 'snooze', 'reschedule']) {
      expect(paths, banned).not.toContain(banned);
    }
  });

  it('the idempotency key pattern accepts a UUID and refuses a short key', () => {
    expect(IDEMPOTENCY_KEY_PATTERN.test(crypto.randomUUID())).toBe(true);
    expect(IDEMPOTENCY_KEY_PATTERN.test('short')).toBe(false);
  });
});
