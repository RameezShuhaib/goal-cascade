import { API_TOKEN_PREFIX, MCP_PATH } from '@goal-cascade/shared';
import type {
  BacklogItemView,
  GoalRefView,
  GoalView,
  Horizon,
  LearningView,
  LensResponse,
  LifeGroupView,
  MeResponse,
  PeriodView,
  PreferencesView,
  TaskDetailView,
  TaskView,
  UserView,
  WeekView,
  ZoomResponse,
} from '@goal-cascade/shared';

/**
 * Fixtures for the web tests.
 *
 * Every shape here goes through the real shared Zod schema on its way into the client, so a fixture that
 * drifts from the contract fails the test rather than passing against a hand-written type.
 *
 * ⚠ **A2** — this file was rebuilt, because the read model it described no longer exists. `treeResponse`
 * (the whole tree, flat) is gone with R-lens-16; `planEntry` is gone with the entity (R-rm-2); and every
 * goal has lost `focus`, `isLeaf`, `isActive`, `dormant`, `subtreeActive` and `branches` and gained
 * `periodKey`, `lifeRootId`, `plannedAgeWeeks` and `weeklyBreakdown`. What replaces it is `lens()`, which
 * builds one horizon's page the way `GoalService.lens` does.
 */

export const NOW = '2026-08-31T09:00:00.000Z';
/** 2026-08-31 is a Monday, which `WeekStart` requires. */
export const THIS_MONDAY = '2026-08-31';
export const LAST_MONDAY = '2026-08-24';
export const THREE_WEEKS_AGO = '2026-08-10';
export const NEXT_MONDAY = '2026-09-07';

export const ulid = (n: number) => '01J' + String(n).padStart(23, '0');

export const user = (over: Partial<UserView> = {}): UserView => ({
  id: 'user_owner',
  name: 'Rameez',
  email: 'me@rameezshuhaib.com',
  emailVerified: true,
  image: null,
  ...over,
});

export const preferences = (over: Partial<PreferencesView> = {}): PreferencesView => ({
  theme: 'system',
  timezone: 'Europe/Amsterdam',
  updatedAt: NOW,
  ...over,
});

export const me = (over: Partial<MeResponse> = {}): MeResponse => ({
  user: user(),
  preferences: preferences(),
  serverNow: NOW,
  ...over,
});

/** ⚠ **A2** — `isPast` is new: write-eligibility is a `periodKey` comparison the SERVER owns (R-goal-34). */
export const week = (over: Partial<WeekView> = {}): WeekView => ({
  weekStart: THIS_MONDAY,
  offset: 0,
  isCurrent: true,
  isPast: false,
  ...over,
});

export const goal = (over: Partial<GoalView> = {}): GoalView => ({
  id: ulid(1),
  parentId: null,
  horizon: 'Life',
  title: 'Be strong at 60',
  why: 'so the next thirty years are mine',
  pulse: 'On track',
  periodKey: '',
  period: '',
  lifeRootId: ulid(1),
  backlogCount: 0,
  carrying: null,
  plannedAgeWeeks: null,
  weeklyBreakdown: null,
  createdAt: NOW,
  updatedAt: NOW,
  version: 1,
  ...over,
});

export const task = (over: Partial<TaskView> = {}): TaskView => ({
  id: ulid(20),
  goalId: ulid(9),
  title: 'Book the Tuesday slot',
  cond: 'confirmation in the calendar',
  description: '',
  links: [],
  status: 'open',
  done: false,
  originWeekStart: THIS_MONDAY,
  doneWeekStart: null,
  doneAt: null,
  exitReason: null,
  exitedAt: null,
  /** ⚠ signed (R-task-43): negative means work that is not due yet. */
  carryWeeks: 0,
  /** ⚠ new (R-task-44/50): the row renders no checkbox when this is false. */
  completable: true,
  createdAt: NOW,
  updatedAt: NOW,
  version: 1,
  ...over,
});

export const taskDetail = (over: Partial<TaskDetailView> = {}): TaskDetailView => ({
  ...task(),
  events: [{ id: ulid(30), kind: 'created', at: NOW, text: 'Created — added to a goal', glyph: '＋', detail: null }],
  ...over,
});

export const backlogItem = (over: Partial<BacklogItemView> = {}): BacklogItemView => ({
  id: ulid(40),
  goalId: ulid(2),
  // ⚠ **A2 (R-backlog-13)** — the branch path is the SERVER's now. The default matches `M` / `L` below,
  // which is the goal the default item hangs off, so a fixture that forgets to override `goalId` and the
  // labels together fails loudly rather than rendering a header for the wrong goal.
  goalTitle: 'Lift three times a week',
  lifeGoalTitle: 'Be strong at 60',
  title: 'Find a squat rack that is free at 7am',
  description: '',
  links: [],
  capturedAt: NOW,
  fromWeekStart: null,
  /** ⚠ **A1 (R-backlog-17)** — opaque, server-minted, never parsed by the client. */
  sortKey: '000001000000',
  status: 'open',
  convertedToTaskId: null,
  convertedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  version: 1,
  ...over,
});

export const learning = (over: Partial<LearningView> = {}): LearningView => ({
  id: ulid(60),
  goalId: null,
  text: 'Evening sessions never survive a busy week',
  applied: false,
  capturedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
  version: 1,
  ...over,
});

// ---- an account that tells a story -----------------------------------------
//
// Two Life lines, one of them broken into weeks, and one Weekly goal from three weeks back that is still
// holding an open task — which is R-lens-12's carried band, the shape the UX plan's own mockup drew in the
// wrong place.
//
//   L   Be strong at 60          (Life)
//   └ Y   Get back under 80kg    (Yearly     2026)
//     └ Q   Rebuild the gym habit(Quarterly  2026-Q3)
//       └ M   Lift three times a week (Monthly 2026-08)  3 weekly goals · 1 this week
//         ├ W   Three easy runs and one long run (Weekly 2026-08-31)  ← this week's plan
//         └ WC  Sort out the long-run route      (Weekly 2026-08-10)  ← CARRIED, oldest first
//   L2  Ship the thing           (Life)
//   └ Y2  Launch v1              (Yearly     2026)
//     └ M2  Write the changelog  (Monthly    2026-08)  Nothing planned yet

export const L = ulid(1);
export const M = ulid(2);
export const Y = ulid(3);
export const Q = ulid(4);
export const L2 = ulid(6);
export const Y2 = ulid(7);
export const M2 = ulid(8);
export const W = ulid(9);
export const WC = ulid(10);

export const lifeGoals = (): GoalView[] => [
  goal({ id: L, title: 'Be strong at 60' }),
  goal({ id: L2, title: 'Ship the thing', why: '', lifeRootId: L2 }),
];

export const yearlyGoals = (): GoalView[] => [
  goal({ id: Y, parentId: L, horizon: 'Yearly', title: 'Get back under 80kg', why: '', periodKey: '2026', period: '2026', lifeRootId: L }),
  goal({ id: Y2, parentId: L2, horizon: 'Yearly', title: 'Launch v1', why: '', periodKey: '2026', period: '2026', lifeRootId: L2 }),
];

export const quarterlyGoals = (): GoalView[] => [
  goal({ id: Q, parentId: Y, horizon: 'Quarterly', title: 'Rebuild the gym habit', why: '', periodKey: '2026-Q3', period: 'Q3 2026', lifeRootId: L }),
];

export const monthlyGoals = (): GoalView[] => [
  goal({
    id: M,
    parentId: Q,
    horizon: 'Monthly',
    title: 'Lift three times a week',
    why: '',
    periodKey: '2026-08',
    period: 'Aug 2026',
    lifeRootId: L,
    backlogCount: 2,
    weeklyBreakdown: { weeklyGoals: 3, thisWeek: 1 },
  }),
  goal({
    id: M2,
    parentId: Y2,
    horizon: 'Monthly',
    title: 'Write the changelog',
    why: '',
    periodKey: '2026-08',
    period: 'Aug 2026',
    lifeRootId: L2,
    weeklyBreakdown: { weeklyGoals: 0, thisWeek: 0 },
  }),
];

export const weeklyGoal = (over: Partial<GoalView> = {}): GoalView =>
  goal({
    id: W,
    parentId: M,
    horizon: 'Weekly',
    title: 'Three easy runs and one long run',
    why: '',
    periodKey: THIS_MONDAY,
    period: 'Week of 31 Aug',
    lifeRootId: L,
    ...over,
  });

export const carriedGoal = (over: Partial<GoalView> = {}): GoalView =>
  weeklyGoal({ id: WC, title: 'Sort out the long-run route', periodKey: THREE_WEEKS_AGO, period: 'Week of 10 Aug', ...over });

// ---- read models -----------------------------------------------------------

const LABELS: Record<string, string> = {
  '2026': '2026',
  '2026-Q3': 'Q3 2026',
  '2026-08': 'Aug 2026',
  [THIS_MONDAY]: 'Week of 31 Aug',
  [LAST_MONDAY]: 'Week of 24 Aug',
  [THREE_WEEKS_AGO]: 'Week of 10 Aug',
  [NEXT_MONDAY]: 'Week of 7 Sep',
};

export const period = (over: Partial<PeriodView> & { periodKey: string }): PeriodView => ({
  label: LABELS[over.periodKey] ?? over.periodKey,
  isCurrent: true,
  isPast: false,
  hasWork: true,
  ...over,
});

export const group = (over: Partial<LifeGroupView> & { id: string | null }): LifeGroupView => ({
  title: over.id === L2 ? 'Ship the thing' : over.id === null ? 'UNSORTED' : 'Be strong at 60',
  pulse: over.id === null ? null : 'On track',
  openTasks: 0,
  ...over,
});

/** One lens page, exactly as `GoalService.lens` builds it (R-lens-16). */
export function lens(over: Partial<LensResponse> & { lens: Horizon }): LensResponse {
  const items = over.items ?? [];
  const groups = over.groups ?? [...new Set(items.map((i) => i.lifeRootId))].map((id) => group({ id, openTasks: 0 }));
  return {
    nextCursor: null,
    hasForwardContent: false,
    // R-lens-24 — an account with life goals that has used this horizon before is the ORDINARY case, so
    // it is the default; the two empty states are what a test opts into.
    hasAnyAtHorizon: true,
    hasLifeGoals: true,
    serverNow: NOW,
    ...over,
    lens: over.lens,
    period: over.lens === 'Life' ? null : (over.period ?? period({ periodKey: defaultKey(over.lens) })),
    groups,
    items,
    carried: over.carried ?? [],
    tasks: over.tasks ?? [],
    // R-lens-23 — one entry per DISTINCT parent, with Life parents left out (the suppression is an
    // absence). Derived here exactly as `GoalService.lens` derives it, from the same fixture tree.
    parents: over.parents ?? parentsOf([...items, ...(over.carried ?? [])]),
  };
}

/** Every interior goal in the fixture account, by id — the set `GoalService` resolves parent lines from. */
const INTERIOR = (): GoalView[] => [...lifeGoals(), ...yearlyGoals(), ...quarterlyGoals(), ...monthlyGoals()];

function parentsOf(items: readonly GoalView[]): GoalRefView[] {
  const byId = new Map(INTERIOR().map((g) => [g.id, g]));
  const out: GoalRefView[] = [];
  const seen = new Set<string>();
  for (const g of items) {
    if (g.parentId === null || seen.has(g.parentId)) continue;
    seen.add(g.parentId);
    const parent = byId.get(g.parentId);
    if (!parent || parent.horizon === 'Life') continue;
    out.push({ id: parent.id, title: parent.title, period: parent.period });
  }
  return out;
}

const defaultKey = (h: Horizon) => (h === 'Yearly' ? '2026' : h === 'Quarterly' ? '2026-Q3' : h === 'Monthly' ? '2026-08' : THIS_MONDAY);

/** The default page for each lens, so a screen test can render any of the five without extra setup. */
export function lensFor(horizon: Horizon, periodKey?: string): LensResponse {
  switch (horizon) {
    case 'Life':
      return lens({ lens: 'Life', items: lifeGoals(), groups: [group({ id: L, openTasks: 2 }), group({ id: L2 })] });
    case 'Yearly':
      return lens({ lens: 'Yearly', items: yearlyGoals(), groups: [group({ id: L, openTasks: 2 }), group({ id: L2 })] });
    case 'Quarterly':
      return lens({ lens: 'Quarterly', items: quarterlyGoals(), groups: [group({ id: L, openTasks: 2 })] });
    case 'Monthly':
      return lens({ lens: 'Monthly', items: monthlyGoals(), groups: [group({ id: L, openTasks: 2 }), group({ id: L2 })] });
    default:
      return weeklyLens(periodKey);
  }
}

/**
 * The Weekly lens: this week's plan, the carried band below it, and the tasks visible in the week —
 * R-lens-12's two cases, which are two arrays precisely because they are never mixed.
 */
export function weeklyLens(periodKey = THIS_MONDAY): LensResponse {
  return lens({
    lens: 'Weekly',
    period: period({ periodKey, isCurrent: periodKey === THIS_MONDAY, isPast: periodKey < THIS_MONDAY }),
    items: [weeklyGoal()],
    carried: [carriedGoal()],
    groups: [group({ id: L, openTasks: 2 })],
    tasks: [
      task({ id: ulid(20), goalId: W, title: 'Tuesday easy 6k', carryWeeks: 0 }),
      task({ id: ulid(21), goalId: WC, title: 'Find a route with no traffic lights', carryWeeks: 3, originWeekStart: THREE_WEEKS_AGO }),
    ],
  });
}

export const zoomResponse = (over: Partial<ZoomResponse> = {}): ZoomResponse => ({
  anchor: '2026-08-31',
  rows: [
    { lens: 'Life', periodKey: null, label: 'everything', count: 2, isCurrent: false },
    { lens: 'Yearly', periodKey: '2026', label: '2026', count: 2, isCurrent: true },
    { lens: 'Quarterly', periodKey: '2026-Q3', label: 'Q3 2026', count: 1, isCurrent: true },
    { lens: 'Monthly', periodKey: '2026-08', label: 'Aug 2026', count: 2, isCurrent: true },
    { lens: 'Weekly', periodKey: THIS_MONDAY, label: 'Week of 31 Aug', count: 1, isCurrent: true },
  ],
  serverNow: NOW,
  ...over,
});

/** One goal's detail page, built out of the same account so the two can never disagree. */
export const detailOf = (
  id: string,
  extra: { backlog?: BacklogItemView[]; backlogIsAggregate?: boolean; learnings?: LearningView[]; tasks?: TaskView[]; pullList?: BacklogItemView[] } = {},
) => {
  const all = [...lifeGoals(), ...yearlyGoals(), ...quarterlyGoals(), ...monthlyGoals(), weeklyGoal(), carriedGoal()];
  const self = all.find((g) => g.id === id) ?? weeklyGoal();
  const ancestors: GoalView[] = [];
  let p = all.find((g) => g.id === self.parentId);
  while (p) {
    ancestors.unshift(p);
    p = all.find((g) => g.id === p!.parentId);
  }
  return {
    goal: self,
    ancestors,
    children: all.filter((g) => g.parentId === id),
    backlog: extra.backlog ?? [],
    backlogIsAggregate: extra.backlogIsAggregate ?? self.horizon === 'Life',
    pullList: extra.pullList ?? [],
    tasks: extra.tasks ?? [],
    learnings: extra.learnings ?? [],
    // ⚠ **A2** — `PeriodView[]`, not `Period[]`: the key is what is written, the label is what is shown.
    replanOptions:
      self.horizon === 'Quarterly'
        ? [period({ periodKey: '2026-Q4', label: 'Q4 2026', isCurrent: false }), period({ periodKey: '2027-Q1', label: 'Q1 2027', isCurrent: false })]
        : [],
    serverNow: NOW,
  };
};

// ---- whole responses -------------------------------------------------------

export const backlogResponse = () => ({ items: [backlogItem()], nextCursor: null, serverNow: NOW });
export const tasksResponse = () => ({ week: week(), tasks: [task()], nextCursor: null, serverNow: NOW });
export const learningsResponse = () => ({ learnings: [learning()], serverNow: NOW });
export const preferencesResponse = () => ({ preferences: preferences(), serverNow: NOW });
export const goalResponse = (over: Partial<GoalView> = {}) => ({ goal: goal(over), serverNow: NOW });
export const taskResponse = (over: Partial<TaskDetailView> = {}) => ({ task: taskDetail(over), serverNow: NOW });
/** ⚠ **A2 (R-task-48)** — `POST /tasks` answers with the Weekly goal it created, when it created one. */
export const createTaskResponse = (over: Partial<TaskDetailView> = {}, createdGoal: GoalView | null = null) => ({
  task: taskDetail(over),
  goal: createdGoal,
  serverNow: NOW,
});
export const backlogItemResponse = (over: Partial<BacklogItemView> = {}) => ({ item: backlogItem(over), serverNow: NOW });

/** ⚠ **A2 (R-rm-5, R-nav-28)** — no `goals`, no `plan`: the Life goals plus the Weekly lens at this week. */
export const bootstrapResponse = () => ({
  user: user(),
  preferences: preferences(),
  week: week(),
  lifeGoals: lifeGoals(),
  lens: weeklyLens(),
  backlog: [backlogItem()],
  learnings: [learning()],
  serverNow: NOW,
});

// ---- agent access ----------------------------------------------------------

export const PLAINTEXT_TOKEN = `${API_TOKEN_PREFIX}9f3b7c11e4a24d8fb0c6e57a2d1934kt`;
export const TOKEN_LAST4 = PLAINTEXT_TOKEN.slice(-4);
export const mcpUrl = () => `${globalThis.location?.origin ?? 'http://localhost'}${MCP_PATH}`;
export const agentTokenSummary = (over: Record<string, unknown> = {}) => ({ createdAt: NOW, last4: TOKEN_LAST4, ...over });
export const agentTokenStatus = (over: Record<string, unknown> = {}) => ({ token: agentTokenSummary(), mcpUrl: mcpUrl(), serverNow: NOW, ...over });
export const agentTokenAbsent = (over: Record<string, unknown> = {}) => ({ token: null, mcpUrl: mcpUrl(), serverNow: NOW, ...over });
export const agentTokenCreated = (over: Record<string, unknown> = {}) => ({
  token: { createdAt: NOW, last4: TOKEN_LAST4, plaintext: PLAINTEXT_TOKEN },
  mcpUrl: mcpUrl(),
  serverNow: NOW,
  ...over,
});
export const agentTokenRevoked = () => ({ revoked: true as const, serverNow: NOW });

/** Better Auth's own success body (not the SPEC §5 envelope). */
export const authUser = (over: Record<string, unknown> = {}) => ({
  id: 'user_owner',
  name: 'Rameez',
  email: 'me@rameezshuhaib.com',
  emailVerified: true,
  image: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});
