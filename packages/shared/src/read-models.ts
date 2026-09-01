import { z } from 'zod';
import {
  BacklogItemView,
  GoalRefView,
  GoalView,
  Horizon,
  Iso,
  LearningView,
  LifeGroupView,
  PeriodKey,
  PeriodView,
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
 *   lens items       — `createdAt` asc, `id` asc (served straight off `ix_goals_lens`)
 *   carried band     — `periodKey` asc (oldest week first), then `createdAt` asc, `id` asc
 *   groups           — the Life goals' own `createdAt` asc, `id` asc, with `UNSORTED` last
 *   tasks            — open before done, then `createdAt` asc, `id` asc
 *   backlog          — `capturedAt` desc, `id` desc
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
 * ⚠ **A2 (R-lens-16, R-lens-27, R-rm-5)** — one LENS: one horizon, one period, paginated. This is what
 * replaced the whole-tree, flat `GET /goals` read model.
 *
 * **Why the old one could not survive.** With a Weekly horizon an account accumulates hundreds of goals a
 * year, and a cold open that shipped every goal — plus a client that rebuilt a tree from them and derived
 * leaf-ness with an O(n²) scan — stops working somewhere in the second year, silently and gradually. The
 * server-side cost was measured at Θ(n²·d): 1.4 M element visits at 395 goals and 845 M at 9,755.
 *
 * **What the server owes the client, so the client never walks a tree it does not hold** (S-lens-16-2):
 *  - `items` — this period's goals at this horizon, from ALL Life lines, each carrying its resolved
 *    `lifeRootId` (R-lens-3). Never a subtree of one branch, never expandable per node (R-lens-1).
 *  - `groups` — the Life-goal headers with their open-task counts (R-lens-4), already ordered
 *    (R-lens-5). A group with no items in this period is not sent (R-lens-19); `UNSORTED` is last
 *    (R-lens-20).
 *  - `carried` / `tasks` — the **Weekly lens only**. See the field docs.
 *  - `hasForwardContent` — R-lens-26's dot on the forward chevron.
 */
export const LensResponse = z.object({
  lens: Horizon,
  /** `null` on the **Life** lens, which has no period dimension: it is simply all of them (R-lens-2). */
  period: PeriodView.nullable(),
  groups: z.array(LifeGroupView),
  /** R-lens-12 case 1 — "this week's plan" in the Weekly lens; simply "this period's goals" elsewhere. */
  items: z.array(GoalView),
  /**
   * R-lens-12 case 2 — **the carried band**, Weekly lens only, empty everywhere else.
   *
   * A Weekly goal appears in week `W` iff `periodKey = W` **OR** it still holds at least one open task
   * visible in `W`. The second kind renders BELOW the week's own goals, **oldest `periodKey` first**, each
   * labelled with the week it was written for (`from week of 24 Aug`) so it is never mistaken for this
   * week's plan. Its own `periodKey` is the label, and it is why the two bands are separate arrays rather
   * than one flagged list: the whole point is that they are never mixed.
   *
   * **Nothing ages out of it, ever.** A goal with one task open for ten weeks appears in ten consecutive
   * lenses, and that is correct — the escalation is the red chip on the TASK, and it is the only one there
   * is (R-lens-11). An age-out rule would be a second escalation, or a silent disappearance of open work.
   *
   * `+ Task` renders on a goal in `items` whose week is current or later, and **never** on one in this
   * band: adding new work to a past week's goal would be back-dating (R-task-41).
   */
  carried: z.array(GoalView),
  /**
   * R-lens-12 — the tasks visible in the selected week. **Weekly lens only**; empty in the other four,
   * which show no tasks at all. Visibility is R-task-7/8 and is applied by the server.
   */
  tasks: z.array(TaskView),
  /** Q-12 / R-lens-16 — the opaque cursor for the next page, or `null` when this is the last one. */
  nextCursor: z.string().nullable(),
  /**
   * ⚠ **A2, new (R-lens-23)** — **the parent lines, as a lookup keyed off `GoalView.parentId`.**
   *
   * One entry per DISTINCT parent of the goals in `items` + `carried`; the client looks its item's
   * `parentId` up and renders `under <title>` when it finds one.
   *
   * **A map, not a field on each item, and the reason is the cap.** A Weekly lens page is bounded by
   * `MAX_WEEKLY_GOALS_PER_WEEK` — 50 goals in one week — and those 50 hang off a handful of Monthly goals,
   * because that is what a month *is*. Denormalising the parent onto each item would repeat the same title
   * up to fifty times in one payload (~6 kB at the cap, most of it duplicate); the distinct-parent map is
   * a few hundred bytes and cannot get larger than the denormalised form even in the pathological case
   * where every item has its own parent.
   *
   * **The suppression rule is the server's, and it is expressed as an ABSENCE** (R-lens-23: nothing renders
   * when the parent is the group's own Life goal). A Life parent is simply not put in this map, so a
   * client that renders every hit it finds implements the rule by doing nothing. That also covers the
   * Yearly lens, whose items' parents are always Life goals, with no horizon test on either side.
   */
  parents: z.array(GoalRefView),
  /**
   * R-lens-26 — the dot on the forward chevron: does ANY later period at this horizon hold at least one
   * goal, or one task originating in it? One dot, no number. Without it a goal written three months out
   * is invisible from every screen except that month's, which unbounded forward creation makes far more
   * likely than it was.
   */
  hasForwardContent: z.boolean(),
  /**
   * ⚠ **A2, new (R-lens-24)** — **has this horizon EVER held a goal, in any period?**
   *
   * It is what separates R-lens-6's *"`Q3 2026` is unclaimed"* (this period is empty) from R-lens-24's
   * *"Nothing quarterly yet"* (you have never used this lens). The two copies say different things and
   * only one of them can be true, so the client cannot pick between them from a period-scoped payload —
   * `hasForwardContent` only looks forward, and saying "nothing quarterly yet" to someone with last year's
   * quarterly goals is a lie.
   *
   * **It is never a second scan.** For the four INTERIOR horizons the answer is already in memory: the
   * lens read loads the interior tree once per request (R-lens-27) and it contains every Yearly, Quarterly
   * and Monthly goal the account has, so this is an array test costing nothing. Only **Weekly** needs the
   * database, and only when the page came back empty — a `(user_id, horizon)` exact-prefix seek on
   * `ix_goals_lens` with `LIMIT 1`, which never counts and never fetches a second row. A non-empty page
   * answers `true` with no query at all.
   */
  hasAnyAtHorizon: z.boolean(),
  /**
   * R-lens-24's other half — *"When the account has Life goals but no goals at this horizon…"*. A brand
   * new account gets the cold-start state, not "Nothing quarterly yet" beside a `+ Quarterly goal` button
   * with no legal parent to hang it off.
   *
   * Free: the interior tree the lens already read contains every Life goal (R-lens-2).
   */
  hasLifeGoals: z.boolean(),
  serverNow: Iso,
});

/** `GET /goals` — the lens read. The name is kept so the endpoint constant does not have to move. */
export const GoalsResponse = LensResponse;

/**
 * ⚠ **A2, new (R-lens-22)** — the Zoom sheet's rows: for each of the five horizons, the period that row
 * would land on (R-lens-9's anchor mapping) and how many GOALS are there.
 *
 * **It is ONE read, not five.** A single grouped query over `ix_goals_lens` — four horizon/period seeks
 * plus the Life count — serves the whole sheet. Written naively as five lens reads it would be five scans
 * on every sheet open, which is exactly how this class of defect returns (R-lens-27).
 *
 * A zero count is omitted by the CLIENT, not here: the server answers truthfully and the sheet decides.
 * The Life row has no period and reads `everything`.
 */
export const ZoomRowView = z.object({
  lens: Horizon,
  /** `null` on the Life row. */
  periodKey: PeriodKey.nullable(),
  label: z.string(),
  count: z.int().nonnegative(),
  isCurrent: z.boolean(),
});
export const ZoomResponse = z.object({ anchor: z.iso.date(), rows: z.array(ZoomRowView), serverNow: Iso });

/**
 * `GET /bootstrap` — everything the app needs on cold open, in ONE request.
 *
 * ⚠ **A2 (R-rm-5, R-nav-28)** — it **must not ship every goal**, and no longer does. A cold start opens
 * the **Weekly lens at the week containing today** (R-nav-28), so that is exactly what this carries: the
 * Life goals (bounded by the number of Life lines, and the one list guaranteed complete — the Life lens
 * is where every Life goal is always visible), that lens, and its week's tasks.
 *
 * `plan` is gone with the entity (R-rm-2) and `ideas` with theirs (R-rm-1). Every week in the payload is
 * an ABSOLUTE Monday date (D-1), so the snapshot does not decay across a Monday boundary — but
 * `week.offset` and `carryWeeks` are projections against `serverNow`, and a client holding a stale payload
 * must refetch rather than re-derive them.
 */
export const BootstrapResponse = z.object({
  user: UserView,
  preferences: PreferencesView,
  week: WeekView,
  /** R-lens-2 — every Life goal. The Life lens is the only unscoped read, and this is it. */
  lifeGoals: z.array(GoalView),
  /** R-nav-28 — the Weekly lens at the week containing today, exactly as `GET /goals` would answer it. */
  lens: LensResponse,
  backlog: z.array(BacklogItemView),
  learnings: z.array(LearningView),
  serverNow: Iso,
});

/**
 * R-goal-41 / R-backlog-11/12/28 / R-learning-5 — one goal's detail page, in one request.
 *
 * ⚠ **A2** — `children` is now the ONLY source of "has children" (R-goal-37: `isLeaf` left the wire and
 * is not coming back under another name), and a **Weekly** goal additionally carries its `tasks` and its
 * backlog `pullList`.
 */
export const GoalDetailResponse = z.object({
  goal: GoalView,
  /** Root → parent, for the breadcrumb path, each with its own period label (R-goal-41). Empty for Life. */
  ancestors: z.array(GoalView),
  children: z.array(GoalView),
  /**
   * R-backlog-11/12 — for a Yearly/Quarterly/Monthly goal, its OWN open items with per-item actions. For a
   * **Life** goal, the READ-ONLY aggregate of every open item on any descendant, each labelled by its own
   * `goalId`. Always **empty** for a **Weekly** goal, which may hold no backlog items at all
   * (R-backlog-2) — see `pullList` instead.
   */
  backlog: z.array(BacklogItemView),
  /** R-backlog-12 — true when `backlog` is the Life-goal roll-up and carries no per-item actions. */
  backlogIsAggregate: z.boolean(),
  /**
   * ⚠ **A2, new (R-backlog-28)** — `FROM THE BACKLOG` on a **Weekly** goal's page: every open backlog item
   * on any ANCESTOR of it, excluding the Life root, which cannot hold items. This is the one surviving
   * half of the plan screen (it superseded R-plan-9/10). Empty for every other horizon.
   */
  pullList: z.array(BacklogItemView),
  /** ⚠ **A2, new** — R-goal-41: the task list on a **Weekly** goal. Empty for every other horizon. */
  tasks: z.array(TaskView),
  /** R-learning-5 — the learnings tagged to this goal's LIFE ROOT, i.e. the whole line. */
  learnings: z.array(LearningView),
  /**
   * R-goal-40 / D-3 — the contextual re-plan options for THIS goal as `periodKey`s, derived server-side
   * from the owner's calendar day and the goal's horizon, strictly after the period it is already in.
   *
   * Empty for a **Life** goal, which has no period (R-goal-21), and empty for a **Weekly** goal, which is
   * not re-plannable: a Weekly goal *is* a week, and moving it would silently restate what a past week
   * contained (R-goal-40, S-goal-40-2).
   *
   * It is on the wire so the re-plan sheet renders the server's own derivation. A client that re-derived
   * the list from `serverNow` would be a second implementation of the same date rule, and two
   * implementations drift on the first boundary (D-3).
   */
  replanOptions: z.array(PeriodView),
  serverNow: Iso,
});

/**
 * R-lens-12 — the tasks visible in one week, and the Weekly lens's data source.
 *
 * ⚠ **A2 (R-rm-5)** — the Tasks SCREEN is gone; this read is not. `plan` went with `weekly_focus`
 * (R-rm-2), and there is no `goalId` filter any more (R-rm-4).
 */
export const TasksResponse = z.object({
  week: WeekView,
  tasks: z.array(TaskView),
  nextCursor: z.string().nullable(),
  serverNow: Iso,
});

export const TaskDetailResponse = z.object({ task: TaskDetailView, serverNow: Iso });

/** R-backlog-13 — the full backlog page. Converted items are never listed. */
export const BacklogResponse = z.object({
  items: z.array(BacklogItemView),
  nextCursor: z.string().nullable(),
  serverNow: Iso,
});
/**
 * ⚠ **A2 (Q-12)** — `nextCursor` added. This list was the one that never got the page cap, so it was
 * also the one with nowhere to say "there is more". It carries the id of the last row on the page, the
 * same shape `BacklogResponse` uses.
 */
export const LearningsResponse = z.object({
  learnings: z.array(LearningView),
  nextCursor: z.string().nullable(),
  serverNow: Iso,
});

export const HealthResponse = z.object({ ok: z.boolean(), app: z.string(), now: z.string() });

export type MeResponse = z.infer<typeof MeResponse>;
export type LensResponse = z.infer<typeof LensResponse>;
export type ZoomRowView = z.infer<typeof ZoomRowView>;
export type ZoomResponse = z.infer<typeof ZoomResponse>;
export type BootstrapResponse = z.infer<typeof BootstrapResponse>;
export type GoalsResponse = z.infer<typeof GoalsResponse>;
export type GoalDetailResponse = z.infer<typeof GoalDetailResponse>;
export type TasksResponse = z.infer<typeof TasksResponse>;
export type TaskDetailResponse = z.infer<typeof TaskDetailResponse>;
export type BacklogResponse = z.infer<typeof BacklogResponse>;
export type LearningsResponse = z.infer<typeof LearningsResponse>;
export type HealthResponse = z.infer<typeof HealthResponse>;
