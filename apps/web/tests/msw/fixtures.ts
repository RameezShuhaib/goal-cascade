import type {
  BacklogItemView,
  GoalView,
  IdeaView,
  LearningView,
  MeResponse,
  PlanEntryView,
  PreferencesView,
  TaskDetailView,
  TaskView,
  UserView,
  WeekView,
} from '@goal-cascade/shared';

/**
 * Fixtures for the data layer's tests. Deliberately minimal: this agent owns the client, the query wiring
 * and auth, so the fixtures only need to be schema-valid — the screens agent will grow them into something
 * that tells a story.
 *
 * Every shape here goes through the real shared Zod schema on its way into the client, so a fixture that
 * drifts from the contract fails the test rather than passing against a hand-written type.
 */

export const NOW = '2026-08-31T09:00:00.000Z';
/** 2026-08-31 is a Monday, which `WeekStart` requires. */
export const THIS_MONDAY = '2026-08-31';
export const LAST_MONDAY = '2026-08-24';

/** ULIDs are 26 chars of Crockford base32; a fixture just needs to satisfy the pattern. */
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

export const week = (over: Partial<WeekView> = {}): WeekView => ({
  weekStart: THIS_MONDAY,
  offset: 0,
  isCurrent: true,
  ...over,
});

export const goal = (over: Partial<GoalView> = {}): GoalView => ({
  id: ulid(1),
  parentId: null,
  horizon: 'Life',
  title: 'Be strong at 60',
  why: 'so the next thirty years are mine',
  pulse: 'On track',
  period: '',
  focus: '',
  isLeaf: false,
  isActive: false,
  dormant: false,
  subtreeActive: true,
  backlogCount: 0,
  carrying: null,
  branches: { active: 1, total: 2 },
  createdAt: NOW,
  updatedAt: NOW,
  version: 1,
  ...over,
});

export const leaf = (over: Partial<GoalView> = {}): GoalView =>
  goal({
    id: ulid(2),
    parentId: ulid(1),
    horizon: 'Monthly',
    title: 'Lift three times a week',
    period: 'Sep 2026',
    focus: 'Three sessions, no excuses.',
    isLeaf: true,
    isActive: true,
    branches: null,
    ...over,
  });

export const planEntry = (over: Partial<PlanEntryView> = {}): PlanEntryView => ({
  id: ulid(10),
  goalId: ulid(2),
  weekStart: THIS_MONDAY,
  sentence: 'Three sessions, no excuses.',
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

export const task = (over: Partial<TaskView> = {}): TaskView => ({
  id: ulid(20),
  goalId: ulid(2),
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
  carryWeeks: 0,
  createdAt: NOW,
  updatedAt: NOW,
  version: 1,
  ...over,
});

export const taskDetail = (over: Partial<TaskDetailView> = {}): TaskDetailView => ({
  ...task(),
  events: [{ id: ulid(30), kind: 'created', at: NOW, text: 'Created', glyph: '＋', detail: null }],
  ...over,
});

export const backlogItem = (over: Partial<BacklogItemView> = {}): BacklogItemView => ({
  id: ulid(40),
  goalId: ulid(2),
  title: 'Find a squat rack that is free at 7am',
  description: '',
  links: [],
  capturedAt: NOW,
  fromWeekStart: null,
  status: 'open',
  convertedToTaskId: null,
  convertedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  version: 1,
  ...over,
});

export const idea = (over: Partial<IdeaView> = {}): IdeaView => ({
  id: ulid(50),
  goalId: null,
  text: 'Try the 5am gym slot for a week',
  capturedAt: NOW,
  createdAt: NOW,
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

// ---- a tree that tells a story --------------------------------------------
//
// The screen tests need a cascade with real shape, not two rows: two Life lines, one active leaf, three
// dormant ones, and an unrelated Monthly goal so the move sheet can show BOTH disabled reasons.
//
//   L  Be strong at 60            (Life)      branches 1 of 2
//   └ Y  Get back under 80kg      (Yearly)
//     └ Q  Rebuild the gym habit  (Quarterly)
//       ├ M  Lift three times a week   (Monthly)  ACTIVE — "Three sessions, no excuses."
//       └ D  Sleep before midnight     (Monthly)  dormant
//   L2 Ship the thing             (Life)      branches 0 of 1
//   └ Y2 Launch v1                (Yearly)
//     └ M2 Write the changelog     (Monthly)  dormant
//
// Ordered parents-before-children, then `createdAt` — the order the server guarantees (Q-7). Nothing in
// the app re-sorts, so a fixture in the wrong order would be a real finding.

export const L = ulid(1);
export const M = ulid(2);
export const Y = ulid(3);
export const Q = ulid(4);
export const D = ulid(5);
export const L2 = ulid(6);
export const Y2 = ulid(7);
export const M2 = ulid(8);

const BASE: GoalView[] = [
  goal({ id: L, title: 'Be strong at 60', branches: { active: 1, total: 2 }, subtreeActive: true }),
  goal({ id: Y, parentId: L, horizon: 'Yearly', title: 'Get back under 80kg', period: '2026', why: '', branches: null, subtreeActive: true }),
  goal({ id: Q, parentId: Y, horizon: 'Quarterly', title: 'Rebuild the gym habit', period: 'Q3 2026', why: '', branches: null, subtreeActive: true }),
  goal({
    id: M,
    parentId: Q,
    horizon: 'Monthly',
    title: 'Lift three times a week',
    period: 'Sep 2026',
    why: '',
    focus: 'Three sessions, no excuses.',
    isLeaf: true,
    isActive: true,
    subtreeActive: true,
    branches: null,
  }),
  goal({
    id: D,
    parentId: Q,
    horizon: 'Monthly',
    title: 'Sleep before midnight',
    period: 'Sep 2026',
    why: '',
    isLeaf: true,
    dormant: true,
    subtreeActive: false,
    branches: null,
  }),
  goal({ id: L2, title: 'Ship the thing', why: '', branches: { active: 0, total: 1 }, subtreeActive: false }),
  goal({ id: Y2, parentId: L2, horizon: 'Yearly', title: 'Launch v1', period: '2026', why: '', branches: null, subtreeActive: false }),
  goal({
    id: M2,
    parentId: Y2,
    horizon: 'Monthly',
    title: 'Write the changelog',
    period: 'Sep 2026',
    why: '',
    isLeaf: true,
    dormant: true,
    subtreeActive: false,
    branches: null,
  }),
];

/** The tree, with per-goal overrides keyed by id: `tree({ [F.M]: { isActive: false } })`. */
export const tree = (over: Record<string, Partial<GoalView>> = {}): GoalView[] => BASE.map((g) => ({ ...g, ...(over[g.id] ?? {}) }));

export const treeResponse = (over: Record<string, Partial<GoalView>> = {}, w = week()) => ({
  week: w,
  goals: tree(over),
  serverNow: NOW,
});

/**
 * `GoalDetailResponse.replanOptions` — the server's own derivation (R-goal-23 / D-3), which the fixture
 * mirrors as literals rather than re-deriving: `NOW` is 2026-08-31 in Europe/Amsterdam, so the list is
 * the periods strictly after BOTH today's period and the goal's current one. A Life goal is not
 * re-plannable (R-goal-21) and offers none.
 */
const REPLAN_OPTIONS: Record<string, string[]> = {
  'Sep 2026': ['Oct 2026', 'Nov 2026'],
  'Q3 2026': ['Q4 2026', 'Q1 2027'],
  '2026': ['2027'],
};

export const replanOptionsOf = (g: GoalView): string[] => (g.parentId === null ? [] : (REPLAN_OPTIONS[g.period] ?? []));

/** One goal's detail screen, built out of the same tree so the two can never disagree. */
export const detailOf = (
  id: string,
  extra: { backlog?: BacklogItemView[]; backlogIsAggregate?: boolean; learnings?: LearningView[] } = {},
) => {
  const all = tree();
  const self = all.find((g) => g.id === id)!;
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
    backlogIsAggregate: extra.backlogIsAggregate ?? self.parentId === null,
    learnings: extra.learnings ?? [],
    replanOptions: replanOptionsOf(self),
    serverNow: NOW,
  };
};

// ---- whole responses -------------------------------------------------------

export const goalsResponse = () => ({ week: week(), goals: [goal(), leaf()], serverNow: NOW });
export const tasksResponse = () => ({ week: week(), tasks: [task()], plan: [planEntry()], serverNow: NOW });
export const planResponse = () => ({ week: week(), entries: [planEntry()], serverNow: NOW });
export const backlogResponse = () => ({ items: [backlogItem()], serverNow: NOW });
export const ideasResponse = () => ({ ideas: [idea()], serverNow: NOW });
export const learningsResponse = () => ({ learnings: [learning()], serverNow: NOW });
export const preferencesResponse = () => ({ preferences: preferences(), serverNow: NOW });
export const goalResponse = (over: Partial<GoalView> = {}) => ({ goal: goal(over), serverNow: NOW });
export const taskResponse = (over: Partial<TaskDetailView> = {}) => ({ task: taskDetail(over), serverNow: NOW });
export const backlogItemResponse = (over: Partial<BacklogItemView> = {}) => ({ item: backlogItem(over), serverNow: NOW });
export const goalDetailResponse = () => ({
  goal: goal(),
  ancestors: [],
  children: [leaf()],
  backlog: [backlogItem()],
  backlogIsAggregate: true,
  learnings: [learning()],
  // `goal()` is the Life root, and a Life goal is not re-plannable (R-goal-21).
  replanOptions: [],
  serverNow: NOW,
});
export const bootstrapResponse = () => ({
  user: user(),
  preferences: preferences(),
  week: week(),
  weekHistoryWeeks: 8,
  goals: [goal(), leaf()],
  plan: [planEntry()],
  tasks: [task()],
  backlog: [backlogItem()],
  ideas: [idea()],
  learnings: [learning()],
  serverNow: NOW,
});

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
