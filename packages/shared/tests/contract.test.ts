import { describe, expect, it } from 'vitest';
import {
  API_BASE,
  API_TOKEN_PREFIX,
  ApiTokenStatusResponse,
  ApiTokenStatusView,
  CreateApiTokenRequest,
  CreateApiTokenResponse,
  CompleteTaskRequest,
  CreateGoalRequest,
  CreateTaskRequest,
  DeleteGoalQuery,
  ENDPOINTS,
  ERROR_CODES,
  ERROR_STATUS,
  HORIZONS,
  LensQuery,
  MAX_INTERIOR_GOALS,
  MAX_PAGE,
  MAX_WEEKLY_GOALS_PER_WEEK,
  MCP_PATH,
  IDEMPOTENCY_KEY_PATTERN,
  Iso,
  PatchGoalRequest,
  PeriodKey,
  PeriodView,
  TASK_SOURCES,
  TasksQuery,
  Ulid,
  Url,
  WeekOffset,
  WeekOffsetParam,
  WeekStart,
  isPeriodKeyFor,
} from '../src/index';
import * as shared from '../src/index';

describe('error codes', () => {
  it('every code maps to a plausible HTTP status', () => {
    for (const code of ERROR_CODES) {
      const status = ERROR_STATUS[code];
      expect(status, code).toBeGreaterThanOrEqual(400);
      expect(status, code).toBeLessThan(600);
    }
  });

  it('the domain codes the SPEC needs are present with the documented status', () => {
    expect(ERROR_STATUS.HORIZON_CONFLICT).toBe(409); // R-goal-5/31/17
    expect(ERROR_STATUS.WOULD_CREATE_CYCLE).toBe(409); // R-goal-18
    expect(ERROR_STATUS.GOAL_HAS_CHILDREN).toBe(409); // Q-5
    expect(ERROR_STATUS.LIFE_GOAL_IMMUTABLE).toBe(409); // R-goal-21
    expect(ERROR_STATUS.NOT_A_LIFE_GOAL).toBe(409); // R-learning-2
    expect(ERROR_STATUS.LIFE_GOAL_NO_BACKLOG).toBe(409); // R-backlog-2 / R-backlog-29
    expect(ERROR_STATUS.ALREADY_CONVERTED).toBe(409); // R-backlog-6 / D-19
    expect(ERROR_STATUS.TASK_ALREADY_EXITED).toBe(409); // R-task-17
    expect(ERROR_STATUS.WEEK_OUT_OF_RANGE).toBe(422); // R-task-44
    expect(ERROR_STATUS.SIGNUP_NOT_ALLOWED).toBe(403); // R-auth-1
    expect(ERROR_STATUS.NOT_IMPLEMENTED).toBe(501);
  });

  it('S-goal-37-1 / S-backlog-26-2 / S-goal-36-1: A2 adds three codes, each 409', () => {
    expect(ERROR_STATUS.NOT_A_WEEKLY_GOAL).toBe(409); // R-goal-39
    expect(ERROR_STATUS.NO_WEEKLY_GOAL).toBe(409); // R-backlog-26
    expect(ERROR_STATUS.PERIOD_IN_PAST).toBe(409); // R-goal-36
  });

  /**
   * RETIRED, with a verdict per code — each named a rule A2 removed outright (R-rm-2's error list):
   *   `NOT_A_LEAF`          → `NOT_A_WEEKLY_GOAL` (R-goal-39 — the condition is the HORIZON, never
   *                            leaf-ness; a childless Monthly goal is a leaf and must never hold a task)
   *   `BRANCH_NOT_ACTIVE`   → `NO_WEEKLY_GOAL`    (R-backlog-26 — there are no focus rows to be active)
   *   `WEEK_NOT_CURRENT`    → `PERIOD_IN_PAST`    (R-goal-36 — the bound is the past, at five horizons)
   *   `GOAL_HAS_OPEN_TASKS` → nothing at all      (R-goal-42 — the transition is UNREACHABLE: only
   *                            Weekly goals hold tasks and a Weekly goal can never gain a child)
   * The assertions are INVERTED rather than deleted, so a re-introduction fails here (S-rm-2-1).
   */
  it('S-rm-2-1: the four codes A2 retired do not exist', () => {
    for (const gone of ['NOT_A_LEAF', 'BRANCH_NOT_ACTIVE', 'WEEK_NOT_CURRENT', 'GOAL_HAS_OPEN_TASKS']) {
      expect(ERROR_CODES as readonly string[], gone).not.toContain(gone);
    }
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

  /**
   * SUPERSEDED — the old assertion ("WeekOffset refuses the future") encoded R-nav-3, which R-lens-7
   * supersedes: there is no forward bound at any horizon and the forward chevron is never disabled
   * (R-goal-36, R-rm-3). It is INVERTED rather than deleted, because the widening is a SILENT break —
   * see the `CompleteTaskRequest.week` case immediately below, which used to inherit its guard from
   * this line and would have lost it with no diff of its own.
   */
  it('S-rm-3-1 / S-lens-7-3: WeekOffset accepts a positive offset — there is no forward cap', () => {
    expect(WeekOffset.parse(0)).toBe(0);
    expect(WeekOffset.parse(-4)).toBe(-4);
    expect(WeekOffset.parse(20)).toBe(20);
    expect(WeekOffset.safeParse(-1.5).success).toBe(false);
    // What remains is the absolute storage range, in BOTH directions — not a product rule.
    expect(WeekOffset.safeParse(521).success).toBe(false);
    expect(WeekOffset.safeParse(-521).success).toBe(false);
  });

  it('WeekOffsetParam coerces a query string and accepts the future too', () => {
    expect(WeekOffsetParam.parse('-2')).toBe(-2);
    expect(WeekOffsetParam.parse('3')).toBe(3);
    expect(WeekOffsetParam.safeParse('soon').success).toBe(false);
  });

  it('S-rm-3-1 / R-task-44: CompleteTaskRequest.week carries its OWN future guard', () => {
    // THE silent break of this amendment. You cannot finish work in a week that has not happened, and
    // that guard used to come free from `WeekOffset`'s `.max(0)`.
    expect(CompleteTaskRequest.parse({}).week).toBe(0);
    expect(CompleteTaskRequest.parse({ week: -3 }).week).toBe(-3);
    expect(CompleteTaskRequest.safeParse({ week: 1 }).success).toBe(false);
  });

  it('S-rm-3-1: no forward-week bound constant survives anywhere in the contract', () => {
    for (const banned of ['PLAN_AHEAD_WEEKS', 'WEEK_HISTORY_WEEKS', 'MAX_PLAN_ENTRIES', 'MAX_FOCUS_SENTENCES']) {
      expect(shared as Record<string, unknown>, banned).not.toHaveProperty(banned);
    }
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
    expect(r).toMatchObject({ cond: '', description: '', links: [], source: 'goal' });
    expect(CreateTaskRequest.safeParse({ title: 'Run' }).success).toBe(false);
  });

  it('S-task-40-3: a task create carries NO week key of any kind', () => {
    // `originWeekStart` is seeded once from the Weekly parent's `periodKey` and is immutable thereafter
    // (R-task-40). There is no target-week parameter that could disagree with the parent, so `.strict()`
    // is the whole guard: every spelling of "week" is an unknown key.
    const base = { goalId: '01J9ZQ8V2M7K3PQRSTVWXY0123', title: 'Run' };
    for (const key of ['week', 'weekOffset', 'originWeek', 'originWeekStart']) {
      expect(CreateTaskRequest.safeParse({ ...base, [key]: 0 }).success, key).toBe(false);
    }
  });

  it('S-task-48-3: exactly one of goalId or newWeeklyGoal — both, or neither, is refused', () => {
    const inline = { parentId: '01J9ZQ8V2M7K3PQRSTVWXY0123', title: 'Run four times in August' };
    expect(CreateTaskRequest.safeParse({ newWeeklyGoal: inline, title: 'Run' }).success).toBe(true);
    expect(CreateTaskRequest.safeParse({ title: 'Run' }).success).toBe(false);
    expect(
      CreateTaskRequest.safeParse({ goalId: '01J9ZQ8V2M7K3PQRSTVWXY0123', newWeeklyGoal: inline, title: 'Run' }).success,
    ).toBe(false);
  });

  it('S-task-46-1: TASK_SOURCES is exactly goal | backlog | drawer', () => {
    // `planning` is renamed (there is no planning screen) and `idea` retired with the entity.
    expect([...TASK_SOURCES]).toEqual(['goal', 'backlog', 'drawer']);
  });

  it('S-goal-14-2: PatchGoalRequest cannot re-parent or re-horizon a goal', () => {
    expect(PatchGoalRequest.safeParse({ parentId: null }).success).toBe(false);
    expect(PatchGoalRequest.safeParse({ horizon: 'Yearly' }).success).toBe(false);
  });

  /**
   * RETIRED — `SavePlanRequest` / `PlanResponse` / `PlanEntryView` asserted R-plan-7's whole-week focus
   * replace. The `weekly_focus` entity, the plan screen and both plan endpoints are deleted outright
   * (R-rm-2, R-rm-3); a week now holds several intentions as several Weekly goals under one parent
   * (R-goal-31). Inverted, not deleted, so the schemas cannot come back (S-rm-2-1).
   */
  it('S-rm-2-1: the plan schemas do not exist', () => {
    for (const gone of ['SavePlanRequest', 'PlanResponse', 'PlanEntryView']) {
      expect(shared as Record<string, unknown>, gone).not.toHaveProperty(gone);
    }
  });

  it('S-rm-4-1: TasksQuery has no goalId — no lens read accepts a goal filter of any kind', () => {
    expect(TasksQuery.parse({ week: '-1' })).toEqual({ week: -1 });
    expect(TasksQuery.parse({})).toEqual({});
    expect(TasksQuery.safeParse({ week: 'soon' }).success).toBe(false);
    expect(TasksQuery.safeParse({ goalId: '01J9ZQ8V2M7K3PQRSTVWXY0123' }).success).toBe(false);
    expect(Object.keys(TasksQuery.shape).sort()).toEqual(['limit', 'week']);
    expect(shared as Record<string, unknown>, 'GoalFilterQuery').not.toHaveProperty('GoalFilterQuery');
  });

  it('S-lens-3-3 / S-lens-16-1: a lens read is one horizon, one period, paginated — nothing else', () => {
    expect(LensQuery.parse({})).toMatchObject({ lens: 'Weekly' }); // R-nav-28 — where the app opens
    expect(LensQuery.parse({ lens: 'Quarterly', period: '2026-Q3' })).toMatchObject({ period: '2026-Q3' });
    expect(LensQuery.safeParse({ lens: 'Quarterly', goalId: '01J9ZQ8V2M7K3PQRSTVWXY0123' }).success).toBe(false);
    expect(LensQuery.safeParse({ lens: 'Quarterly', period: '2026-Q5' }).success).toBe(false);
    expect(LensQuery.safeParse({ limit: String(MAX_PAGE + 1) }).success).toBe(false);
  });

  it('Q-5: the destructive subtree delete is opt-in through an explicit query flag', () => {
    expect(DeleteGoalQuery.parse({ cascade: 'true' })).toEqual({ cascade: true });
    expect(DeleteGoalQuery.parse({})).toEqual({});
    expect(DeleteGoalQuery.safeParse({ cascade: 'maybe' }).success).toBe(false);
  });
});

describe('A2: five horizons and canonical periods', () => {
  it('S-goal-30-1: HORIZONS is five members, longest first, and the index IS the rank', () => {
    expect([...HORIZONS]).toEqual(['Life', 'Yearly', 'Quarterly', 'Monthly', 'Weekly']);
    // R-goal-31 — the terminal horizon MOVED. Weekly has the maximum rank, so nothing can be strictly
    // greater than it and the single rank comparison in `checkCreate` keeps enforcing both rules.
    expect(HORIZONS.indexOf('Weekly')).toBe(HORIZONS.length - 1);
    expect(HORIZONS.indexOf('Monthly')).toBeLessThan(HORIZONS.indexOf('Weekly'));
  });

  it('S-goal-33-2: a periodKey is canonical, and is validated against its OWN horizon', () => {
    expect(isPeriodKeyFor('Life', '')).toBe(true);
    expect(isPeriodKeyFor('Yearly', '2026')).toBe(true);
    expect(isPeriodKeyFor('Quarterly', '2026-Q3')).toBe(true);
    expect(isPeriodKeyFor('Monthly', '2026-09')).toBe(true);
    expect(isPeriodKeyFor('Weekly', '2026-08-31')).toBe(true); // a Monday

    expect(isPeriodKeyFor('Quarterly', '2026-Q5')).toBe(false);
    expect(isPeriodKeyFor('Monthly', '2026-13')).toBe(false);
    expect(isPeriodKeyFor('Yearly', 'not-a-period')).toBe(false);
    expect(isPeriodKeyFor('Weekly', '2026-09-01')).toBe(false); // a Tuesday
    // A key valid for one horizon is not valid for another: a lens must PARTITION its horizon.
    expect(isPeriodKeyFor('Monthly', '2026')).toBe(false);
    expect(isPeriodKeyFor('Yearly', '')).toBe(false);
  });

  it('R-goal-33: periodKeys sort lexicographically in chronological order', () => {
    // This is the whole reason the key has this shape: R-goal-47's `BETWEEN` range read and R-lens-26's
    // "any later period" probe are single index seeks only because it holds.
    expect(['2026-Q4', '2026-Q1', '2027-Q1'].sort()).toEqual(['2026-Q1', '2026-Q4', '2027-Q1']);
    expect(['2026-10', '2026-02', '2027-01'].sort()).toEqual(['2026-02', '2026-10', '2027-01']);
    expect(['2026-09-07', '2026-08-31'].sort()).toEqual(['2026-08-31', '2026-09-07']);
  });

  it('S-goal-33-3: no request schema carries a `period` — it is server-derived', () => {
    const parent = '01J9ZQ8V2M7K3PQRSTVWXY0123';
    expect(
      CreateGoalRequest.safeParse({ title: 'Ship it', horizon: 'Monthly', parentId: parent, period: 'whenever' }).success,
    ).toBe(false);
    expect(PatchGoalRequest.safeParse({ period: 'whenever' }).success).toBe(false);
  });

  it('S-goal-33-2: CreateGoalRequest refines periodKey against the horizon it is written with', () => {
    const parent = '01J9ZQ8V2M7K3PQRSTVWXY0123';
    expect(CreateGoalRequest.safeParse({ title: 'Q3', horizon: 'Quarterly', parentId: parent, periodKey: '2026-Q3' }).success).toBe(true);
    expect(CreateGoalRequest.safeParse({ title: 'Q5', horizon: 'Quarterly', parentId: parent, periodKey: '2026-Q5' }).success).toBe(false);
    // A Monthly key parses as SOME period key but not as this horizon's.
    expect(CreateGoalRequest.safeParse({ title: 'W', horizon: 'Weekly', parentId: parent, periodKey: '2026-09' }).success).toBe(false);
    // …and a Weekly key that is not a Monday.
    expect(CreateGoalRequest.safeParse({ title: 'W', horizon: 'Weekly', parentId: parent, periodKey: '2026-09-01' }).success).toBe(false);
    expect(PeriodKey.safeParse('2026-13').success).toBe(false);
  });

  it('⚠ A4 (R-lens-28/29): a PeriodView carries what it SPANS and where the current week is', () => {
    const base = { periodKey: '2026-09', label: 'Sep 2026', isCurrent: true, isPast: false, hasWork: true };
    // Both fields are REQUIRED, so a server that computes the label and forgets the range breaks at the
    // boundary rather than shipping a period that quietly over-promises again. That is the whole point of
    // parsing on both sides.
    expect(PeriodView.safeParse(base).success).toBe(false);
    expect(PeriodView.safeParse({ ...base, weekRange: 'Mon 7 Sep – Sun 4 Oct' }).success).toBe(false);

    const seam = PeriodView.safeParse({
      ...base,
      weekRange: 'Mon 7 Sep – Sun 4 Oct',
      currentWeekPeriod: { periodKey: '2026-08', label: 'Aug 2026' },
    });
    expect(seam.success).toBe(true);
    // `null` is the ordinary case — this period holds the week containing today — and it is a real
    // `null`, not an absent key, because absence would be indistinguishable from a stale client.
    expect(PeriodView.safeParse({ ...base, weekRange: 'Mon 3 Aug – Sun 6 Sep', currentWeekPeriod: null }).success).toBe(true);
    // The destination is a canonical key like any other (R-goal-33), so it is validated like any other.
    expect(
      PeriodView.safeParse({ ...base, weekRange: '', currentWeekPeriod: { periodKey: '2026-13', label: 'nope' } }).success,
    ).toBe(false);
  });

  it('Q-12: the three caps that are actually enforced — and no lifetime goal cap', () => {
    // The old 500 / 100 were PROSE in five files and code in none, so raising them would have shipped
    // nothing. These bound what actually costs something: the interior set every request holds in
    // memory, the per-week fan-out, and the page.
    expect(MAX_INTERIOR_GOALS).toBe(1000);
    expect(MAX_WEEKLY_GOALS_PER_WEEK).toBe(50);
    expect(MAX_PAGE).toBe(200);
    for (const banned of ['MAX_GOALS', 'MAX_CHILDREN']) {
      expect(shared as Record<string, unknown>, banned).not.toHaveProperty(banned);
    }
  });
});

describe('endpoints', () => {
  it('are constants and id-functions, never inline strings', () => {
    expect(API_BASE).toBe('/api');
    expect(ENDPOINTS.goal('abc')).toBe('/goals/abc');
    expect(ENDPOINTS.taskLink('t', 'l')).toBe('/tasks/t/links/l');
    expect(ENDPOINTS.bootstrap).toBe('/bootstrap');
  });

  it('S-rm-3-1 / S-rm-1-1: the census carries no /plan path and mentions no idea', () => {
    const paths = Object.values(ENDPOINTS)
      .map((v) => (typeof v === 'function' ? (v as (...a: string[]) => string)('x', 'y') : v))
      .join(' ');
    expect(paths).not.toContain('/plan');
    expect(paths).not.toContain('idea');
  });

  it('A2 adds the two goal routes the redesign needs', () => {
    expect(ENDPOINTS.goalsZoom).toBe('/goals/zoom'); // R-lens-22 — one grouped read, never five
    expect(ENDPOINTS.goalsRepeatWeek).toBe('/goals/repeat-week'); // R-goal-46
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

describe('the agent-access token contract', () => {
  it('the MCP path is NOT under /api — it has no session, so it must not sit behind the session guard', () => {
    expect(MCP_PATH).toBe('/mcp');
    expect(MCP_PATH.startsWith(API_BASE)).toBe(false);
  });

  it('the token prefix is short, distinctive and greppable', () => {
    // A leaked key must be recognisable on sight in a log, and findable with one grep.
    expect(API_TOKEN_PREFIX).toBe('gcm_');
    expect(API_TOKEN_PREFIX.endsWith('_')).toBe(true);
  });

  it('a bad or absent agent token has its own 401 code, distinct from a dead session', () => {
    // `UNAUTHENTICATED` means "sign in again", which an external agent cannot do — it has no browser
    // and no cookie jar. The distinct code is what lets the recovery advice differ while the HTTP
    // status stays the same.
    expect(ERROR_STATUS.INVALID_API_TOKEN).toBe(401);
    expect(ERROR_STATUS.UNAUTHENTICATED).toBe(401);
    expect(ERROR_CODES).toContain('INVALID_API_TOKEN');
  });

  it('creating a token requires a password; reading its status does not', () => {
    expect(CreateApiTokenRequest.safeParse({ password: 'hunter2' }).success).toBe(true);
    expect(CreateApiTokenRequest.safeParse({}).success, 'the password guard is gone').toBe(false);
    // `.strict()` — an unknown key is a bug, not something to drop silently. There is deliberately no
    // `name` field: exactly one token exists per account, so there is no list to label.
    expect(CreateApiTokenRequest.safeParse({ password: 'x', name: 'my laptop' }).success).toBe(false);
  });

  it('the status response carries a summary or nothing, and has no plaintext field at all', () => {
    expect(
      ApiTokenStatusResponse.safeParse({
        token: null,
        mcpUrl: 'https://goals.example.com/mcp',
        serverNow: '2026-08-31T00:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      ApiTokenStatusResponse.safeParse({
        token: { createdAt: '2026-08-31T00:00:00.000Z', last4: 'a1b2' },
        mcpUrl: 'https://goals.example.com/mcp',
        serverNow: '2026-08-31T00:00:00.000Z',
      }).success,
    ).toBe(true);
    // The absence is the guarantee: there is no plaintext member to accidentally populate.
    expect(Object.keys(ApiTokenStatusView.shape).sort()).toEqual(['createdAt', 'last4']);
  });

  it('only the CREATE response carries the plaintext, and it is the only one that ever does', () => {
    expect(Object.keys(CreateApiTokenResponse.shape.token.shape).sort()).toEqual(['createdAt', 'last4', 'plaintext']);
  });

  it('the delete-goal query accepts a dry run, so a preview needs no new route or response shape', () => {
    // Q-5's `DeleteGoalResponse` is reused with `deleted: false`; `dryRun` arrives as a query string, so
    // it coerces from "true" exactly the way `cascade` already does.
    expect(DeleteGoalQuery.parse({ dryRun: 'true' })).toEqual({ dryRun: true });
    expect(DeleteGoalQuery.parse({ dryRun: 'false' })).toEqual({ dryRun: false });
    // `z.stringbool()` has its own truthy vocabulary ("true", "1", "yes", "on", "y", "enabled"), so
    // this asserts the boundary with a word that is in none of them rather than assuming a narrow set.
    expect(DeleteGoalQuery.safeParse({ dryRun: 'maybe' }).success).toBe(false);
    // …and, like every other query schema here, an unknown key is refused rather than ignored.
    expect(DeleteGoalQuery.safeParse({ dryrun: 'true' }).success).toBe(false);
  });
});
