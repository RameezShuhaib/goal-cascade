import { z } from 'zod';
import {
  BacklogItemView,
  GoalView,
  IdeaView,
  Iso,
  LearningView,
  Period,
  PlanEntryView,
  PreferencesView,
  TaskDetailView,
  TaskView,
  UserView,
  WeekView,
} from './common';

/**
 * Response schemas for every read. The client parses each one, so a missing field breaks at the boundary
 * on both sides.
 *
 * Ordering is TOTAL and STABLE everywhere (SPEC Q-7, D-17) and is the server's job, never the client's:
 *   goals            — parents before children, then `createdAt` asc, `id` asc
 *   tasks            — open before done, then `createdAt` asc, `id` asc
 *   backlog / ideas  — `capturedAt` desc, `id` desc
 *   learnings        — `capturedAt` desc, `id` desc
 *   task events      — `at` desc, then insertion sequence desc
 */

/**
 * R-auth-4 — the session gate. `user` is always present (the route needs a session); `preferences` is the
 * row seeded at sign-up. There is no tenant, no membership and no invite list: this product is
 * single-user (R-auth-1).
 */
export const MeResponse = z.object({
  user: UserView,
  preferences: PreferencesView,
  serverNow: Iso,
});

/**
 * `GET /bootstrap` — everything the app needs on cold open, in ONE request (the mockup's `fetchAll`).
 *
 * It is a snapshot of ONE week: `week` says which, and `goals[].focus`, `plan` and `tasks` are that
 * week's. Every week in the payload is an ABSOLUTE Monday date (D-1), so the snapshot does not decay
 * across a Monday boundary — but `week.offset` and `carryWeeks` are projections against `serverNow` and
 * a client holding a stale payload must refetch rather than re-derive them.
 */
export const BootstrapResponse = z.object({
  user: UserView,
  preferences: PreferencesView,
  week: WeekView,
  /** R-nav-4 / D-24 — the ONE bound both week controls use. Echoed so the client never hardcodes it. */
  weekHistoryWeeks: z.int().positive(),
  goals: z.array(GoalView),
  plan: z.array(PlanEntryView),
  tasks: z.array(TaskView),
  backlog: z.array(BacklogItemView),
  ideas: z.array(IdeaView),
  learnings: z.array(LearningView),
  serverNow: Iso,
});

/** The whole tree, flat (R-goal-25). Derived flags are computed for `week`. */
export const GoalsResponse = z.object({
  week: WeekView,
  goals: z.array(GoalView),
  serverNow: Iso,
});

/** R-goal-27 / R-backlog-11 / R-backlog-12 / R-learning-5 — one goal's detail screen, in one request. */
export const GoalDetailResponse = z.object({
  goal: GoalView,
  /** Root → parent, for the breadcrumb path. Empty for a Life goal. */
  ancestors: z.array(GoalView),
  children: z.array(GoalView),
  /**
   * R-backlog-11/12 — for a non-Life goal, its OWN open items with per-item actions. For a Life goal,
   * the READ-ONLY aggregate of every open item on any descendant, each labelled by its own `goalId`.
   */
  backlog: z.array(BacklogItemView),
  /** R-backlog-12 — true when `backlog` is the Life-goal roll-up and carries no per-item actions. */
  backlogIsAggregate: z.boolean(),
  /** R-learning-5 — the learnings tagged to this goal's LIFE ROOT, i.e. the whole line. */
  learnings: z.array(LearningView),
  /**
   * R-goal-23 / D-3 — the contextual re-plan options for THIS goal, derived server-side from the owner's
   * calendar day and the goal's horizon, strictly after the period it is already in. Empty for a Life
   * goal, which is not re-plannable (R-goal-21).
   *
   * It is on the wire so the re-plan sheet renders the server's own derivation. The mockup's frozen 2026
   * literals are D-3, and a client that re-derives the list from `serverNow` would be a second
   * implementation of the same rule — two implementations of a date rule drift on the first boundary.
   */
  replanOptions: z.array(Period),
  serverNow: Iso,
});

/**
 * R-nav-8 — the tasks visible in one week. Server-applied visibility (R-task-7/8, exited tasks in
 * neither), with that week's plan alongside so the Tasks screen can render focus sentences and goal
 * filter pills without a second request.
 */
export const TasksResponse = z.object({
  week: WeekView,
  tasks: z.array(TaskView),
  plan: z.array(PlanEntryView),
  serverNow: Iso,
});

export const TaskDetailResponse = z.object({ task: TaskDetailView, serverNow: Iso });

/** R-backlog-13 — the full backlog page. Converted items are never listed. */
export const BacklogResponse = z.object({ items: z.array(BacklogItemView), serverNow: Iso });
export const IdeasResponse = z.object({ ideas: z.array(IdeaView), serverNow: Iso });
export const LearningsResponse = z.object({ learnings: z.array(LearningView), serverNow: Iso });

export const HealthResponse = z.object({ ok: z.boolean(), app: z.string(), now: z.string() });

export type MeResponse = z.infer<typeof MeResponse>;
export type BootstrapResponse = z.infer<typeof BootstrapResponse>;
export type GoalsResponse = z.infer<typeof GoalsResponse>;
export type GoalDetailResponse = z.infer<typeof GoalDetailResponse>;
export type TasksResponse = z.infer<typeof TasksResponse>;
export type TaskDetailResponse = z.infer<typeof TaskDetailResponse>;
export type BacklogResponse = z.infer<typeof BacklogResponse>;
export type IdeasResponse = z.infer<typeof IdeasResponse>;
export type LearningsResponse = z.infer<typeof LearningsResponse>;
export type HealthResponse = z.infer<typeof HealthResponse>;
