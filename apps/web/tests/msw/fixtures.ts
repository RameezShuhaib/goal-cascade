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
