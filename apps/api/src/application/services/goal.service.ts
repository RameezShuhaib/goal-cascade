import type {
  BacklogItemView,
  CreateGoalRequest,
  DeleteGoalResponse,
  GoalDetailResponse,
  GoalResponse,
  GoalView,
  Horizon,
  LensQuery,
  LensResponse,
  LearningView,
  LifeGroupView,
  MoveGoalRequest,
  PatchGoalRequest,
  PeriodView,
  RepeatWeekRequest,
  ReplanGoalRequest,
  TaskView,
  WeekView,
  ZoomResponse,
  ZoomRowView,
} from '@goal-cascade/shared';
import { MAX_INTERIOR_GOALS, MAX_PAGE, MAX_WEEKLY_GOALS_PER_WEEK } from '@goal-cascade/shared';
import { inject, injectable } from 'tsyringe';
import type { BacklogItem, Goal, Learning } from '../../domain/entities';
import { HORIZONS } from '../../domain/enums';
import { DomainError, notFound } from '../../domain/errors';
import {
  ancestorsIn,
  childrenIn,
  indexTree,
  isLifeHorizon,
  lifeRootIn,
  siblingCompare,
  type TreeIndex,
} from '../../domain/goal-tree';
import {
  firstMondayIn,
  isPastPeriod,
  isPeriodKey,
  labelOf,
  lastMondayIn,
  periodKeyOf,
  replanPeriods,
  zoomTo,
} from '../../domain/periods';
import { dateInTimezone, offsetOf, weekStartOf, weeksBetween } from '../../domain/weeks';
import type { RequestContext } from '../context';
import {
  IBacklogLinkRepo,
  IBacklogRepo,
  IClock,
  IGoalRepo,
  IIdGenerator,
  ILearningRepo,
  ITaskEventRepo,
  ITaskLinkRepo,
  ITaskRepo,
  chunkIds,
} from '../ports';
import type { GuardedWrite } from '../ports/statement';
import { GuardedBatch } from './guarded-batch';
import { toTaskView, weekView } from './views';

/**
 * Goals, and the five lenses (R-lens-1 … R-lens-27).
 *
 * What is already done before any of these runs:
 *  - the session exists and `ctx.userId` is the ONLY scope (R-auth-2); nothing here reads a scope from input;
 *  - the body/query/params are validated, trimmed and bounded by the shared schemas (Q-11/Q-12);
 *  - `POST /goals` and `POST /goals/:id/move` have passed `GoalTreeGuard` (R-goal-3/4/5/17/18/21/31),
 *    so the tree rules hold by the time `create`/`move` is called. They are NOT re-checked here — one
 *    implementation of a rule, in `domain/goal-tree.ts`, called from one place.
 *
 * ── ⚠ **A2 — what this service used to be, and why every read here is different** ──────────────────
 *
 * `list()` returned the whole tree, flat, and `toView()` derived `isLeaf` + `descendantIds` + a
 * per-descendant `isLeaf` for EVERY goal, mapped over `orderedTree`'s output — Θ(n²·d), measured at
 * 1.4 M element visits over 395 goals and 845 M / 2.9 s at 9,755. `snapshot()` then handed **all n goal
 * ids** to `inArray`, one bound parameter per goal. `POST /goals` ran the whole-table read three times.
 *
 * Every one of those is gone:
 *  - `list()` → **`lens()`**: one horizon, one period, one indexed seek on `ix_goals_lens`, paginated at
 *    `MAX_PAGE` (R-lens-16). It is the read `GET /goals` now serves.
 *  - the whole-tree walk → **the interior tree**, read once per request and indexed by id. It grows with
 *    the plan, not with use, and it never carries a Weekly goal the lens is not rendering (R-lens-27).
 *  - the guards → **one row** (create) and **one subtree CTE** (move, delete).
 *  - `inArray(all n)` → per-page or per-subtree id sets, chunked (`chunkIds`).
 *
 * Derived state is still never stored (SPEC §1) — but the derived SET changed: `isLeaf`, `isActive`,
 * `dormant`, `subtreeActive` and `branches` are gone from the wire entirely (R-rm-2, R-goal-37), and
 * `lifeRootId`, `plannedAgeWeeks` and `weeklyBreakdown` replace them.
 */
@injectable()
export class GoalService {
  constructor(
    @inject(IGoalRepo) private readonly goals: IGoalRepo,
    @inject(ITaskRepo) private readonly tasks: ITaskRepo,
    @inject(ITaskLinkRepo) private readonly taskLinks: ITaskLinkRepo,
    @inject(ITaskEventRepo) private readonly taskEvents: ITaskEventRepo,
    @inject(IBacklogRepo) private readonly backlog: IBacklogRepo,
    @inject(IBacklogLinkRepo) private readonly backlogLinks: IBacklogLinkRepo,
    @inject(ILearningRepo) private readonly learnings: ILearningRepo,
    @inject(IIdGenerator) private readonly ids: IIdGenerator,
    @inject(IClock) private readonly clock: IClock,
    @inject(GuardedBatch) private readonly batch: GuardedBatch,
  ) {}

  /**
   * R-lens-1 … R-lens-27 — **one lens: one horizon, one period, grouped by Life goal, paginated.**
   *
   * Six reads, every one of them indexed and bounded, and not one of them touches the whole goal table:
   *
   *   1. `listByLens`               — the page. One exact-prefix seek on `ix_goals_lens`.
   *   2. `listInterior`             — the interior tree, for grouping (R-lens-3) and the group order.
   *   3. `countOpenVisibleByGoal`   — the group headers' open-task counts (R-lens-4), one grouped query.
   *   4. `listByIds`                — the Weekly goals behind (3) and behind the week's tasks, so each
   *                                   maps to its Life root. Bounded by OPEN WORK, not by history.
   *   5. `listOpenByGoals`          — `N in backlog` for the page's own goals. Bounded by the page.
   *   6. `listVisibleInWeek`        — the Weekly lens's tasks (R-lens-12). Empty in the other four.
   *
   * plus two `LIMIT 1` probes for R-lens-26's forward dot, which say *there is something ahead* and never
   * how much.
   *
   * **An absent or unparseable period falls back to the CURRENT one rather than erroring** (R-lens-14,
   * S-lens-14-1): a deep link that has rotted should land you somewhere real.
   */
  async lens(ctx: RequestContext, q: LensQuery): Promise<LensResponse> {
    const today = this.today(ctx);
    const horizon = q.lens;
    const isLife = horizon === 'Life';
    // R-lens-2 — the Life lens has no period dimension: it is simply all of them.
    const periodKey = isLife ? '' : q.period && isPeriodKey(horizon, q.period) ? q.period : periodKeyOf(horizon, today);
    const limit = Math.min(q.limit ?? MAX_PAGE, MAX_PAGE);

    // R-lens-4 — the anchoring week: the SELECTED week in the Weekly lens, the CURRENT week in every
    // other lens, which have no week of their own. Stating it once means the number never changes
    // meaning as you browse, and R-task-38 then holds automatically — a future-origin task is not
    // visible in the current week and cannot inflate it.
    const anchorWeek = horizon === 'Weekly' ? periodKey : ctx.currentWeekStart;

    const [page, interiorRows, openByGoal, weekTasks] = await Promise.all([
      this.goals.listByLens(ctx.userId, { horizon, periodKey }, { limit, ...(q.cursor ? { cursor: q.cursor } : {}) }),
      this.goals.listInterior(ctx.userId),
      this.tasks.countOpenVisibleByGoal(ctx.userId, anchorWeek),
      horizon === 'Weekly' ? this.tasks.listVisibleInWeek(ctx.userId, periodKey, MAX_PAGE) : Promise.resolve([]),
    ]);
    const interior = indexTree(interiorRows);

    // R-lens-12 — **the carried band.** A Weekly goal appears in week W iff `periodKey = W` OR it still
    // holds an open task visible in W. The second kind is found from the WEEK'S TASKS, never by scanning
    // goals: a task's visibility is a function of its own stored week and never of its goal's period
    // (R-task-42), which is exactly what makes carrying free.
    const taskGoalIds = [...new Set(weekTasks.map((t) => t.goalId))];
    const pageIds = new Set(page.items.map((g) => g.id));
    const weeklyGoalRows = await this.goals.listByIds(ctx.userId, [
      ...new Set([...taskGoalIds, ...openByGoal.map((r) => r.goalId)].filter((id) => !pageIds.has(id))),
    ]);
    const byId = new Map<string, Goal>([...page.items, ...weeklyGoalRows].map((g) => [g.id, g]));

    const carried = weeklyGoalRows
      .filter((g) => g.horizon === 'Weekly' && g.periodKey !== periodKey && taskGoalIds.includes(g.id))
      // oldest `periodKey` FIRST, so the longest-outstanding work is always at the top of the band. That
      // ordering is the whole ergonomic answer to "nothing ever ages out of it" (R-lens-12).
      .sort((a, b) => (a.periodKey === b.periodKey ? siblingCompare(a, b) : a.periodKey < b.periodKey ? -1 : 1));

    const rendered = [...page.items, ...carried];
    const [backlogRows, forwardGoals, forwardTasks] = await Promise.all([
      this.backlog.listOpenByGoals(ctx.userId, rendered.map((g) => g.id)),
      isLife ? Promise.resolve(false) : this.goals.hasLaterPeriod(ctx.userId, horizon, periodKey),
      horizon === 'Weekly' ? this.tasks.hasOriginAfter(ctx.userId, periodKey) : Promise.resolve(false),
    ]);

    const view = await this.viewContext(ctx, { interior, today, rendered, backlogRows });
    const items = page.items.map((g) => this.toView(g, view));
    const carriedViews = carried.map((g) => this.toView(g, view));

    return {
      lens: horizon,
      period: isLife ? null : this.periodView(horizon, periodKey, today, page.items.length > 0),
      groups: this.groupsOf(interior, [...items, ...carriedViews], openByGoal, byId),
      items,
      carried: carriedViews,
      // R-lens-12 — no task visible in a week is ever hidden from that week's lens, and no open task is
      // ever without its goal. Hiding carried work the moment its goal's week passed would delete the
      // carry mechanic and lose work silently.
      tasks: weekTasks.map((t) => toTaskView(t, [], periodKey, ctx.currentWeekStart)),
      nextCursor: page.nextCursor,
      hasForwardContent: forwardGoals || forwardTasks,
      serverNow: ctx.now,
    };
  }

  /**
   * R-lens-22 — **the Zoom sheet's five rows, in ONE grouped read.**
   *
   * Each row names the exact period that horizon would land on for the session anchor (R-lens-9) and how
   * many goals are there, so the promise "you see the destination before you commit" is true — which is
   * the whole argument for a sheet over a permanent five-way strip (R-lens-17).
   *
   * **It must never be five lens reads and must never fetch rows in order to count them** (R-lens-27).
   * Four horizon/period seeks plus the Life count, grouped, in one query.
   */
  async zoom(ctx: RequestContext, anchorInput?: string): Promise<ZoomResponse> {
    const today = this.today(ctx);
    const anchor = anchorInput ?? today;
    const keys = HORIZONS.map((horizon) => ({ horizon, periodKey: zoomTo(horizon, anchor, today) }));
    const counts = await this.goals.countByLens(ctx.userId, keys);
    const at = new Map(counts.map((c) => [`${c.horizon}|${c.periodKey}`, c.count]));

    const rows: ZoomRowView[] = keys.map((k) => ({
      lens: k.horizon,
      periodKey: k.horizon === 'Life' ? null : k.periodKey,
      // The Life row reads `everything`: it has no period, and saying so beats an empty cell.
      label: k.horizon === 'Life' ? 'everything' : labelOf(k.horizon, k.periodKey),
      count: at.get(`${k.horizon}|${k.periodKey}`) ?? 0,
      isCurrent: k.horizon !== 'Life' && k.periodKey === periodKeyOf(k.horizon, today),
    }));
    return { anchor, rows, serverNow: ctx.now };
  }

  /**
   * R-goal-41 / R-backlog-11/12/28 / R-learning-5 — the detail page in one request.
   *
   * ⚠ **A2** — `children` is the only source of "has children" now (R-goal-37), and a **Weekly** goal
   * additionally carries its `tasks` (R-goal-41) and its backlog `pullList` (R-backlog-28), while holding
   * no backlog of its own (R-backlog-2).
   */
  async detail(ctx: RequestContext, id: string): Promise<GoalDetailResponse> {
    const today = this.today(ctx);
    const goal = await this.require(ctx, id);
    const interiorRows = await this.goals.listInterior(ctx.userId);
    const interior = indexTree(interiorRows);

    const isLife = isLifeHorizon(goal.horizon);
    const isWeekly = goal.horizon === 'Weekly';
    // ⚠ **A2 (R-goal-37)** — `children` is the ONLY source of "has children" on the wire now, so it is
    // read directly rather than derived: one seek on `ix_goals_owner_parent`. A **Weekly** goal is
    // terminal (R-goal-31), so it needs no read at all.
    const children = isWeekly ? [] : await this.goals.listChildren(ctx.userId, id);

    // R-backlog-11/12/28 — three different lists, one per horizon class:
    //   Life    → the READ-ONLY roll-up of every open item on any descendant (it holds none itself)
    //   Weekly  → nothing of its own; the pull list is its ANCESTORS' items
    //   else    → its own items
    const subtree = isLife ? await this.goals.subtreeIds(ctx.userId, id) : [];
    const ancestorChain = isWeekly ? this.ancestorsOf(interior, goal) : [];
    const pullScope = ancestorChain.filter((a) => !isLifeHorizon(a.horizon)).map((a) => a.id);

    const [ownItems, pullItems, lineLearnings, weeklyTasks] = await Promise.all([
      isWeekly ? Promise.resolve([]) : this.backlog.listOpenByGoals(ctx.userId, isLife ? subtree.filter((x) => x !== id) : [id]),
      isWeekly && pullScope.length > 0 ? this.backlog.listOpenByGoals(ctx.userId, pullScope) : Promise.resolve([]),
      this.lineLearnings(ctx, interior, goal),
      isWeekly ? this.tasks.listByGoals(ctx.userId, [id]) : Promise.resolve([]),
    ]);

    const rendered = [goal, ...children, ...ancestorChain];
    const backlogRows = await this.backlog.listOpenByGoals(ctx.userId, rendered.map((g) => g.id));
    const view = await this.viewContext(ctx, { interior, today, rendered, backlogRows });
    const links = await this.backlogLinks.listByItems(ctx.userId, [...ownItems, ...pullItems].map((i) => i.id));
    const taskLinks = await this.taskLinks.listByTasks(ctx.userId, weeklyTasks.map((t) => t.id));

    return {
      goal: this.toView(goal, view),
      ancestors: this.ancestorsOf(interior, goal).map((g) => this.toView(g, view)),
      children: children.map((g) => this.toView(g, view)),
      backlog: ownItems.map((i) => backlogItemView(i, links)),
      backlogIsAggregate: isLife,
      pullList: pullItems.map((i) => backlogItemView(i, links)),
      tasks: weeklyTasks
        .filter((t) => t.status === 'open' || t.status === 'done')
        .map((t) => toTaskView(t, taskLinks, goal.periodKey, ctx.currentWeekStart)),
      learnings: lineLearnings.map(learningView),
      // R-goal-40 / D-3 — derived here, once, from the OWNER's calendar day (R-auth-5). Neither a Life
      // goal nor a Weekly goal is re-plannable, for opposite reasons. The client renders this list rather
      // than re-deriving it: two implementations of a date rule drift on the first period boundary.
      replanOptions: replanPeriods(goal.horizon, today, goal.periodKey).map((k) => this.periodView(goal.horizon, k, today, false)),
      serverNow: ctx.now,
    };
  }

  /**
   * R-goal-33/36 + Q-12 — create.
   *
   * `periodKey` defaults from the horizon and TODAY in the OWNER's timezone, never a frozen literal
   * (D-3). The two refusals here are the ones no schema can make, because both need the server's clock or
   * a count:
   *
   *  - **`PERIOD_IN_PAST`** (R-goal-36) — a goal is never created into a past period. This is D-2
   *    generalised: a goal written into last month is a plan claiming to have existed then, and it
   *    changes what a past lens says happened. There is **no forward bound** at any horizon.
   *  - **the two caps** (Q-12) — the interior set is the only thing every request holds in memory, and
   *    the per-week Weekly count is what bounds one lens page. Neither is a lifetime cap on goals.
   */
  async create(ctx: RequestContext, input: CreateGoalRequest): Promise<GoalResponse> {
    const today = this.today(ctx);
    const isLife = input.horizon === 'Life';
    // R-goal-3 — a Life goal has no target period. Refused rather than silently blanked (Q-10).
    if (isLife && input.periodKey) {
      throw new DomainError('VALIDATION_FAILED', 'a Life goal has no target period', { periodKey: input.periodKey });
    }
    const periodKey = isLife ? '' : (input.periodKey ?? periodKeyOf(input.horizon, today));
    this.assertNotPast(input.horizon, periodKey, today);
    await this.assertCapacity(ctx, input.horizon, periodKey);

    const now = this.clock.nowIso();
    const goal: Goal = {
      id: this.ids.ulid(),
      userId: ctx.userId,
      parentId: isLife ? null : input.parentId,
      horizon: input.horizon,
      title: input.title,
      why: input.why,
      pulse: input.pulse,
      periodKey,
      // R-goal-33 — `period` is [srv]: the rendered label of the key, written by the same code that
      // writes the key. There is no request field it could disagree with.
      period: labelOf(input.horizon, periodKey),
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.batch.run([{ label: 'goal.insert', stmt: this.goals.insertStmt(goal) }]);
    return { goal: await this.oneView(ctx, goal), serverNow: ctx.now };
  }

  /**
   * R-goal-14 / R-goal-36 / R-goal-40 — title / why / periodKey / pulse only. `horizon` and `parentId`
   * are immutable through edit (the request schema is `.strict()`, so sending either is a 422).
   *
   * ⚠ **A2 — a `periodKey` patch on a WEEKLY goal is refused outright** (R-goal-40, S-goal-40-2). A
   * Weekly goal *is* a week: moving it forward would silently restate what a past week contained, which
   * is D-2, the defect that made focus per-week in the first place. An intention that did not happen is
   * carried by its **open tasks** (R-lens-12), not by moving the goal; an intention with nothing under it
   * is re-written as a new Weekly goal, which costs one line and leaves the record intact.
   */
  async patch(ctx: RequestContext, id: string, input: PatchGoalRequest): Promise<GoalResponse> {
    const today = this.today(ctx);
    const goal = await this.require(ctx, id);
    if (input.periodKey !== undefined) {
      if (isLifeHorizon(goal.horizon)) {
        throw new DomainError('VALIDATION_FAILED', 'a Life goal has no target period', { periodKey: input.periodKey });
      }
      this.assertPeriodMutable(goal);
      if (!isPeriodKey(goal.horizon, input.periodKey)) {
        throw new DomainError('VALIDATION_FAILED', `not a valid periodKey for a ${goal.horizon} goal`, {
          periodKey: input.periodKey,
          horizon: goal.horizon,
        });
      }
      this.assertNotPast(goal.horizon, input.periodKey, today);
    }

    const patch = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.why !== undefined ? { why: input.why } : {}),
      ...(input.periodKey !== undefined
        ? { periodKey: input.periodKey, period: labelOf(goal.horizon, input.periodKey) }
        : {}),
      ...(input.pulse !== undefined ? { pulse: input.pulse } : {}),
    };
    const next = await this.applyPatch(ctx, goal, patch, input.version);
    return { goal: await this.oneView(ctx, next), serverNow: ctx.now };
  }

  /**
   * R-goal-16 — Move changes ONLY `parentId`; the goal's horizon is untouched and its children move with
   * it, which needs no write of their own because the tree is an adjacency list.
   *
   * ⚠ **A2 (R-goal-42)** — the leaf → non-leaf cascade that used to live here is GONE. The transition
   * R-goal-28 and D-8 existed to handle is **unreachable**: only Weekly goals hold tasks, and a Weekly
   * goal can never gain a child (R-goal-31). Adding a child to a goal, or moving a goal under it, now
   * moves nothing, deletes nothing and refuses nothing — the one place the redesign removes a class of
   * defect outright rather than relocating it.
   *
   * ⚠ **A2 (R-goal-40, SPEC Q-24) — MOVE MAY NEVER CHANGE A WEEKLY GOAL'S `periodKey`.**
   *
   * The guard below looks redundant: `MoveGoalRequest` has no `periodKey` field, and the patch built here
   * carries only `parentId`. It is here because **nothing breaks in the data if a Weekly goal crosses
   * weeks, and that is precisely the danger.** `tasks.origin_week_start` is the task's own stored,
   * immutable field (R-task-40) — it is not re-read from the parent — so re-parenting a Weekly goal to a
   * different week would move the goal and leave every task's week exactly where it was. No error, no
   * cascade, no test failure. What breaks is the Weekly LENS: the goal would claim a week its tasks were
   * never live in, appear in two weeks with different work under it, and the carried band (R-lens-12)
   * could no longer tell "written this week" from "carrying" — which re-opens D-2, the defect that made
   * focus per-week in the first place. So the boundary is asserted rather than inferred.
   */
  async move(ctx: RequestContext, id: string, input: MoveGoalRequest): Promise<GoalResponse> {
    const goal = await this.require(ctx, id);
    const patch: Partial<Goal> = { parentId: input.parentId };
    assertNoPeriodWrite(goal, patch);
    const next = await this.applyPatch(ctx, goal, patch, input.version);
    return { goal: await this.oneView(ctx, next), serverNow: ctx.now };
  }

  /**
   * R-goal-40 — a new target `periodKey` plus an OPTIONAL one-line reason ("No mandatory fields. Fast and
   * guilt-free").
   *
   * Neither a **Life** goal nor a **Weekly** goal is re-plannable, for opposite reasons: a Life goal has
   * no period at all (R-goal-21), and a Weekly goal's week is immutable after creation (R-goal-40).
   *
   * D-3 — a re-plan that lands on the period the goal is already in is refused rather than written: that
   * is precisely the mockup bug (its frozen option list offered the current quarter as a "next" one). The
   * contextual options for this horizon and today are returned in `details` so the client can re-render
   * the sheet from the server's own derivation instead of a literal.
   */
  async replan(ctx: RequestContext, id: string, input: ReplanGoalRequest): Promise<GoalResponse> {
    const today = this.today(ctx);
    const goal = await this.require(ctx, id);
    if (isLifeHorizon(goal.horizon)) {
      throw new DomainError('LIFE_GOAL_IMMUTABLE', 'a Life goal cannot be moved or re-planned');
    }
    this.assertPeriodMutable(goal);
    if (!isPeriodKey(goal.horizon, input.periodKey)) {
      throw new DomainError('VALIDATION_FAILED', `not a valid periodKey for a ${goal.horizon} goal`, {
        periodKey: input.periodKey,
        horizon: goal.horizon,
      });
    }
    if (input.periodKey === goal.periodKey) {
      throw new DomainError('VALIDATION_FAILED', 'that is already this goal’s target period', {
        periodKey: input.periodKey,
        options: replanPeriods(goal.horizon, today, goal.periodKey),
      });
    }
    this.assertNotPast(goal.horizon, input.periodKey, today);

    // The reason is deliberately not persisted: goals have no activity log in this product (R-nav-14 —
    // no audit trail, no review wizard), and inventing a column for a string nothing renders would be a
    // feature the ruleset explicitly removes. It is accepted, and it is the client's toast copy.
    const next = await this.applyPatch(
      ctx,
      goal,
      { periodKey: input.periodKey, period: labelOf(goal.horizon, input.periodKey) },
      input.version,
    );
    return { goal: await this.oneView(ctx, next), serverNow: ctx.now };
  }

  /**
   * ⚠ **A2, new (R-goal-46)** — `Repeat last week`, for ONE Life line.
   *
   * Copies the previous week's Weekly goals under that line into `weekStart` as **ordinary new goals**:
   * `title`, `why` and `parentId` carried over, `pulse` reset to `On track`, `periodKey` set to the
   * target week, new ids, **no tasks copied**, and nothing linking a copy to its source.
   *
   * **This is deliberately not a recurrence feature.** There is no template entity, no series id, no
   * materialisation job, no "detached from the series" state and no edit-this-one-versus-all-future
   * decision — the interaction every calendar product is most complained about, and precisely the
   * complexity this redesign is removing. A repeating intention costs one tap per week and produces
   * ordinary rows that can be edited, moved and deleted like any other.
   *
   * Per line rather than account-wide (Q-22): account-wide creates twenty goals in one tap with no
   * review. Offered only on the current week or a later one, and a no-op when the previous week held
   * nothing (S-goal-46-2).
   */
  async repeatWeek(ctx: RequestContext, input: RepeatWeekRequest): Promise<{ created: GoalView[]; serverNow: string }> {
    const today = this.today(ctx);
    this.assertNotPast('Weekly', input.weekStart, today);

    const lifeGoal = await this.require(ctx, input.lifeGoalId);
    if (!isLifeHorizon(lifeGoal.horizon)) {
      throw new DomainError('NOT_A_LIFE_GOAL', 'Repeat last week works on one Life line at a time', {
        goalId: input.lifeGoalId,
        horizon: lifeGoal.horizon,
      });
    }

    const previousWeek = addWeeksTo(input.weekStart, -1);
    const [source, interiorRows] = await Promise.all([
      this.goals.listWeeklyInWeek(ctx.userId, previousWeek),
      this.goals.listInterior(ctx.userId),
    ]);
    const interior = indexTree(interiorRows);
    const mine = source.filter((g) => this.lifeRootIdOf(interior, g) === lifeGoal.id);
    if (mine.length === 0) return { created: [], serverNow: ctx.now };

    // Q-12 — the copies count against the target week's cap like any other Weekly goal. A repeat that
    // would overflow the week is refused whole rather than applied partially.
    const existing = await this.goals.countWeeklyInWeek(ctx.userId, input.weekStart);
    if (existing + mine.length > MAX_WEEKLY_GOALS_PER_WEEK) {
      throw new DomainError('VALIDATION_FAILED', `a week holds at most ${MAX_WEEKLY_GOALS_PER_WEEK} weekly goals`, {
        weekStart: input.weekStart,
        existing,
        wouldAdd: mine.length,
        max: MAX_WEEKLY_GOALS_PER_WEEK,
      });
    }

    const now = this.clock.nowIso();
    const copies: Goal[] = mine.map((g) => ({
      id: this.ids.ulid(),
      userId: ctx.userId,
      parentId: g.parentId,
      horizon: 'Weekly',
      title: g.title,
      why: g.why,
      // R-goal-46 — `pulse` RESETS. A copy inherits the intention, not last week's self-assessment.
      pulse: 'On track',
      periodKey: input.weekStart,
      period: labelOf('Weekly', input.weekStart),
      createdAt: now,
      updatedAt: now,
      version: 1,
    }));
    await this.batch.run(copies.map((g) => ({ label: 'goal.repeatWeek', stmt: this.goals.insertStmt(g) })));

    const view = await this.viewContext(ctx, { interior, today, rendered: copies, backlogRows: [] });
    return { created: copies.map((g) => this.toView(g, view)), serverNow: ctx.now };
  }

  /**
   * Q-5 / R-task-47 — the whole subtree, transactionally: goals, tasks (with their links and events),
   * backlog items (with their links). Learning tags pointing INTO the subtree null out to Unsorted
   * instead of cascading, so an insight survives the deletion of the Life goal it was filed under. No
   * soft-delete, no trash.
   *
   * ⚠ **A2** — three changes, none of them to the mechanism:
   *  - the subtree comes from **one recursive CTE** (`subtreeIds`) rather than from `descendantIds` over
   *    the whole table (R-lens-27). This is the one place a big set is CORRECT — deleting a Life goal
   *    takes the line — so every id list here is **chunked** (`chunkIds`), which is the bind-parameter
   *    cliff RECONCILIATION §3.3 names.
   *  - `weekly_focus` rows are gone with the entity (R-rm-2), and `removed.weeklyGoals` replaces the
   *    count: deleting a Monthly goal now takes its Weekly children and all of their tasks, so the number
   *    can be large. It is a summary and must never become a list.
   *  - the confirmation still names the counts, and `dryRun` still answers for a childless goal, which is
   *    the case that matters most — a Weekly goal carrying forty open tasks deletes with no warning.
   *
   * Every statement states the exact number of rows it must remove, which `GuardedBatch` turns into a
   * precondition: if another device added a task under this subtree between the read and the write, the
   * batch rolls back with a clean 409 rather than leaving that task orphaned. **`0` is a real assertion**
   * — skipping the statement when nothing was read would leave no precondition at all, and there is no FK
   * on `tasks.goal_id`, so that row would simply outlive its goal.
   */
  async remove(ctx: RequestContext, id: string, opts: { cascade: boolean; dryRun?: boolean }): Promise<DeleteGoalResponse> {
    const subtree = await this.goals.subtreeIds(ctx.userId, id);
    if (subtree.length === 0) throw notFound('goal');

    const [subtreeRows, taskRows, itemRows, learningRows] = await Promise.all([
      this.goals.listByIds(ctx.userId, subtree),
      this.tasks.listByGoals(ctx.userId, subtree),
      this.backlog.listByGoals(ctx.userId, subtree),
      this.learnings.listByGoals(ctx.userId, subtree),
    ]);
    const weeklyGoals = subtreeRows.filter((g) => g.horizon === 'Weekly').length;
    const descendants = subtree.length - 1;

    if (opts.dryRun) {
      // The event count is the one number a preview cannot get from the reads above without a further
      // query, and it is worth it: "11 tasks" understates the loss when those tasks carry 63 timeline
      // entries that also vanish. Only the dry run pays for it — the real delete already needs the ids.
      const events = await this.taskEvents.listByTasks(ctx.userId, taskRows.map((t) => t.id));
      return {
        deleted: false,
        removed: {
          goals: subtree.length,
          weeklyGoals,
          tasks: taskRows.length,
          taskEvents: events.length,
          backlogItems: itemRows.length,
        },
        untagged: { learnings: learningRows.length },
        serverNow: ctx.now,
      };
    }

    if (!opts.cascade && descendants > 0) {
      throw new DomainError('GOAL_HAS_CHILDREN', 'this goal has sub-goals; confirm the cascade to delete them', {
        goalId: id,
        subGoals: descendants,
        weeklyGoals,
        tasks: taskRows.length,
        backlogItems: itemRows.length,
      });
    }

    const taskIds = taskRows.map((t) => t.id);
    const itemIds = itemRows.map((i) => i.id);
    const [linkRows, eventRows, itemLinkRows] = await Promise.all([
      this.taskLinks.listByTasks(ctx.userId, taskIds),
      this.taskEvents.listByTasks(ctx.userId, taskIds),
      this.backlogLinks.listByItems(ctx.userId, itemIds),
    ]);

    const writes: GuardedWrite[] = [];
    /**
     * One statement per CHUNK, each stating the exact rows ITS chunk must remove.
     *
     * The chunking is the fix for RECONCILIATION §3.3's bind-parameter cliff: a Life goal's subtree is
     * legitimately large, and one bound parameter per id fails on account size rather than on request
     * shape. The per-chunk count has to be computed here, because `GuardedBatch` asserts per statement
     * and only this method knows which rows it read.
     */
    const removal = <R>(
      label: string,
      keys: readonly string[],
      rows: readonly R[],
      keyOf: (r: R) => string,
      stmtFor: (part: string[]) => GuardedWrite['stmt'],
    ) => {
      const parts = keys.length === 0 ? [[]] : chunkIds(keys);
      for (const part of parts) {
        const set = new Set(part);
        writes.push({ label, stmt: stmtFor(part), expectedChanges: rows.filter((r) => set.has(keyOf(r))).length });
      }
    };

    removal('taskEvent.deleteByTasks', taskIds, eventRows, (e) => e.taskId, (p) => this.taskEvents.deleteByTasksStmt(ctx.userId, p));
    removal('taskLink.deleteByTasks', taskIds, linkRows, (l) => l.taskId, (p) => this.taskLinks.deleteByTasksStmt(ctx.userId, p));
    removal('task.deleteByGoals', subtree, taskRows, (t) => t.goalId, (p) => this.tasks.deleteByGoalsStmt(ctx.userId, p));
    removal('backlogLink.deleteByItems', itemIds, itemLinkRows, (l) => l.itemId, (p) => this.backlogLinks.deleteByItemsStmt(ctx.userId, p));
    removal('backlog.deleteByGoals', subtree, itemRows, (i) => i.goalId, (p) => this.backlog.deleteByGoalsStmt(ctx.userId, p));
    removal('learning.untagByGoals', subtree, learningRows, (l) => l.goalId ?? '', (p) => this.learnings.untagByGoalsStmt(ctx.userId, p));
    for (const part of chunkIds(subtree)) {
      writes.push({ label: 'goal.deleteMany', stmt: this.goals.deleteManyStmt(ctx.userId, part), expectedChanges: part.length });
    }
    await this.batch.run(writes);

    return {
      deleted: true,
      removed: {
        goals: subtree.length,
        weeklyGoals,
        tasks: taskRows.length,
        taskEvents: eventRows.length,
        backlogItems: itemRows.length,
      },
      untagged: { learnings: learningRows.length },
      serverNow: ctx.now,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // internals
  // ───────────────────────────────────────────────────────────────────────────

  /** R-auth-2/3 — another owner's goal is refused identically to a non-existent one. */
  private async require(ctx: RequestContext, id: string): Promise<Goal> {
    const goal = await this.goals.findById(ctx.userId, id);
    if (!goal) throw notFound('goal');
    return goal;
  }

  /** The owner-local calendar date (R-auth-5): every period default is derived from THIS, not the clock. */
  private today(ctx: RequestContext): string {
    return dateInTimezone(ctx.now, ctx.tz);
  }

  /**
   * R-goal-36 — **the one refusal that makes planning unable to rewrite history.** There is no forward
   * half: any future period is writable, at every horizon.
   */
  private assertNotPast(horizon: Horizon, periodKey: string, today: string): void {
    if (!isPastPeriod(horizon, periodKey, today)) return;
    throw new DomainError('PERIOD_IN_PAST', 'nothing is created into, or moved into, a past period', {
      horizon,
      periodKey,
      currentPeriodKey: periodKeyOf(horizon, today),
    });
  }

  /** R-goal-40 — a Weekly goal's `periodKey` is immutable after creation, and it is not re-plannable. */
  private assertPeriodMutable(goal: Goal): void {
    if (goal.horizon !== 'Weekly') return;
    throw new DomainError('VALIDATION_FAILED', 'a weekly goal is a week: its period cannot be changed', {
      goalId: goal.id,
      periodKey: goal.periodKey,
    });
  }

  /**
   * Q-12 — the two caps that are actually enforced. Two `COUNT(*)`s on create, each an exact-prefix seek
   * on `ix_goals_lens`, and neither is a lifetime cap on goals.
   */
  private async assertCapacity(ctx: RequestContext, horizon: Horizon, periodKey: string): Promise<void> {
    if (horizon === 'Weekly') {
      const n = await this.goals.countWeeklyInWeek(ctx.userId, periodKey);
      if (n >= MAX_WEEKLY_GOALS_PER_WEEK) {
        throw new DomainError('VALIDATION_FAILED', `a week holds at most ${MAX_WEEKLY_GOALS_PER_WEEK} weekly goals`, {
          weekStart: periodKey,
          existing: n,
          max: MAX_WEEKLY_GOALS_PER_WEEK,
        });
      }
      return;
    }
    const n = await this.goals.countInterior(ctx.userId);
    if (n >= MAX_INTERIOR_GOALS) {
      throw new DomainError('VALIDATION_FAILED', `an account holds at most ${MAX_INTERIOR_GOALS} non-weekly goals`, {
        existing: n,
        max: MAX_INTERIOR_GOALS,
      });
    }
  }

  /**
   * One guarded row update. `version` pins the row (Q-2): a request carrying a stale one changes zero
   * rows, `GuardedBatch` trips its precondition and the whole batch rolls back as a clean 409.
   */
  private async applyPatch(
    ctx: RequestContext,
    goal: Goal,
    patch: Partial<Omit<Goal, 'id' | 'userId'>>,
    version: number | undefined,
  ): Promise<Goal> {
    // An edit that changes nothing writes nothing — and does not bump `version` out from under the other
    // device that is about to save a real change.
    if (Object.keys(patch).length === 0) return goal;

    const expected = version ?? goal.version;
    const now = this.clock.nowIso();
    const next: Goal = { ...goal, ...patch, updatedAt: now, version: expected + 1 };
    await this.batch.run([
      {
        label: 'goal.update',
        stmt: this.goals.updateGuardedStmt(ctx.userId, goal.id, expected, { ...patch, updatedAt: now, version: expected + 1 }),
      },
    ]);
    return next;
  }

  /** A mutation's single-goal response. One interior read, bounded by the plan — never the whole table. */
  private async oneView(ctx: RequestContext, goal: Goal): Promise<GoalView> {
    const interior = indexTree(await this.goals.listInterior(ctx.userId));
    const backlogRows = await this.backlog.listOpenByGoals(ctx.userId, [goal.id]);
    const view = await this.viewContext(ctx, { interior, today: this.today(ctx), rendered: [goal], backlogRows });
    return this.toView(goal, view);
  }

  private ancestorsOf(interior: TreeIndex<Goal>, goal: Goal): Goal[] {
    // A Weekly goal is not in the interior index, so its chain starts at its parent.
    if (goal.horizon !== 'Weekly') return ancestorsIn(interior, goal.id);
    const parent = goal.parentId ? interior.byId.get(goal.parentId) : undefined;
    return parent ? [...ancestorsIn(interior, parent.id), parent] : [];
  }

  /** R-learning-5 — the learnings of the whole LINE, i.e. tagged to this goal's Life root. */
  private async lineLearnings(ctx: RequestContext, interior: TreeIndex<Goal>, goal: Goal): Promise<Learning[]> {
    const rootId = this.lifeRootIdOf(interior, goal);
    return rootId ? this.learnings.listByGoals(ctx.userId, [rootId]) : [];
  }

  /**
   * R-lens-3 / R-lens-20 — the Life goal an item groups under.
   *
   * A **Weekly** goal is not in the interior index (that is the point of the index — it never carries a
   * Weekly goal the lens is not rendering), so its walk starts at its parent, which always is. `null`
   * means the chain does not reach a Life goal — a dangling `parentId` or a cycle — and the item groups
   * under `UNSORTED`, pinned last, rather than being dropped from the view.
   */
  private lifeRootIdOf(interior: TreeIndex<Goal>, goal: Goal): string | null {
    if (isLifeHorizon(goal.horizon)) return goal.id;
    if (goal.parentId === null) return null;
    if (goal.horizon !== 'Weekly') return lifeRootIn(interior, goal.id)?.id ?? null;
    const parent = interior.byId.get(goal.parentId);
    if (!parent) return null;
    return isLifeHorizon(parent.horizon) ? parent.id : (lifeRootIn(interior, parent.id)?.id ?? null);
  }

  /**
   * Everything the goals being RENDERED need, and nothing else.
   *
   * Note what is not here any more: no `focusByGoal`, no whole-tree `openTasks` array, no `descendantIds`
   * per goal. Each map below is keyed by the ids actually on the page (R-lens-27).
   */
  private async viewContext(
    ctx: RequestContext,
    input: { interior: TreeIndex<Goal>; today: string; rendered: readonly Goal[]; backlogRows: readonly BacklogItem[] },
  ): Promise<ViewContext> {
    const backlogCounts = new Map<string, number>();
    for (const item of input.backlogRows) backlogCounts.set(item.goalId, (backlogCounts.get(item.goalId) ?? 0) + 1);

    // R-goal-24 — the Life-goal carry signal, ONE grouped query over open work that originated before the
    // current week. A future origin can never satisfy that, so the rule needs no future guard (R-task-38).
    const lifeIds = input.rendered.filter((g) => isLifeHorizon(g.horizon)).map((g) => g.id);
    const carrying = new Map<string, { openTasks: number; oldestWeeks: number }>();
    if (lifeIds.length > 0) {
      const rows = await this.tasks.carryingByGoal(ctx.userId, ctx.currentWeekStart);
      const owners = await this.goals.listByIds(ctx.userId, rows.map((r) => r.goalId));
      const rootOf = new Map(owners.map((g) => [g.id, this.lifeRootIdOf(input.interior, g)]));
      for (const row of rows) {
        const rootId = rootOf.get(row.goalId);
        if (!rootId || !lifeIds.includes(rootId)) continue;
        const previous = carrying.get(rootId) ?? { openTasks: 0, oldestWeeks: 0 };
        carrying.set(rootId, {
          openTasks: previous.openTasks + row.open,
          oldestWeeks: Math.max(previous.oldestWeeks, weeksBetween(row.oldestOrigin, ctx.currentWeekStart)),
        });
      }
    }

    // R-goal-47 — the planned-ness line, as ONE range scan over the Monthly goals on this page:
    // `horizon='Weekly' AND period_key BETWEEN <first Monday> AND <last Monday> AND parent_id IN (page)`,
    // about five weeks wide. It works only because `period_key` sorts lexicographically (R-goal-33).
    const weeklyBreakdown = new Map<string, { weeklyGoals: number; thisWeek: number | null }>();
    const monthly = input.rendered.filter((g) => g.horizon === 'Monthly');
    if (monthly.length > 0) {
      const byMonth = new Map<string, Goal[]>();
      for (const g of monthly) byMonth.set(g.periodKey, [...(byMonth.get(g.periodKey) ?? []), g]);
      for (const [monthKey, page] of byMonth) {
        const rows = await this.goals.weeklyUnderParents(
          ctx.userId,
          page.map((g) => g.id),
          firstMondayIn(monthKey),
          lastMondayIn(monthKey),
        );
        // `thisWeek` is null when the viewed month does not contain today — the state whose copy is
        // `3 weekly goals` with no second clause at all.
        const containsToday = periodKeyOf('Monthly', input.today) === monthKey;
        for (const g of page) {
          const mine = rows.filter((r) => r.parentId === g.id);
          weeklyBreakdown.set(g.id, {
            weeklyGoals: mine.length,
            thisWeek: containsToday ? mine.filter((r) => r.periodKey === ctx.currentWeekStart).length : null,
          });
        }
      }
    }

    return { interior: input.interior, today: input.today, currentWeekStart: ctx.currentWeekStart, tz: ctx.tz, backlogCounts, carrying, weeklyBreakdown };
  }

  /** R-lens-3/4/5/19/20 — the group headers, already ordered, with the empty ones omitted. */
  private groupsOf(
    interior: TreeIndex<Goal>,
    rendered: readonly GoalView[],
    openByGoal: readonly { goalId: string; open: number }[],
    goalsById: ReadonlyMap<string, Goal>,
  ): LifeGroupView[] {
    // R-lens-19 — a group with no items in the selected period is NOT rendered. A lens is not a roster;
    // a twelve-line account would otherwise render twelve headers on a lens where two have items, which
    // is the clutter complaint restated. The Life lens is where every Life goal is guaranteed visible.
    const present = new Set(rendered.map((g) => g.lifeRootId));

    // R-lens-4 — the count is open tasks under that Life goal visible in the anchoring week. Each row of
    // the grouped query is keyed by a WEEKLY goal, which maps to its Life root through the interior index
    // in O(d) — bounded by open work, never by history.
    const open = new Map<string | null, number>();
    for (const row of openByGoal) {
      const owner = goalsById.get(row.goalId);
      const rootId = owner ? this.lifeRootIdOf(interior, owner) : null;
      open.set(rootId, (open.get(rootId) ?? 0) + row.open);
    }

    const groups: LifeGroupView[] = [];
    // R-lens-5 — groups in their Life goals' own `createdAt` asc, `id` asc order. Never by count: a list
    // that reorders itself when you tick a checkbox is a list you cannot build muscle memory for.
    for (const life of interior.all.filter((g) => isLifeHorizon(g.horizon)).sort(siblingCompare)) {
      if (!present.has(life.id)) continue;
      groups.push({ id: life.id, title: life.title, pulse: life.pulse, openTasks: open.get(life.id) ?? 0 });
    }
    // R-lens-20 — `UNSORTED`, pinned LAST, with no count and never collapsed by default. This state is
    // not reachable through the product; it is a data-integrity surface, and it must surface rather than
    // silently drop a row from a view.
    if (present.has(null)) groups.push({ id: null, title: 'UNSORTED', pulse: null, openTasks: 0 });
    return groups;
  }

  private periodView(horizon: Horizon, periodKey: string, today: string, hasWork: boolean): PeriodView {
    const current = periodKeyOf(horizon, today);
    return {
      periodKey,
      label: labelOf(horizon, periodKey),
      isCurrent: periodKey === current,
      isPast: periodKey < current,
      hasWork,
    };
  }

  /** The derived half of a goal. Never stored (§1), and computed only for the goals being rendered. */
  private toView(goal: Goal, s: ViewContext): GoalView {
    const isLife = isLifeHorizon(goal.horizon);
    return {
      id: goal.id,
      parentId: goal.parentId,
      horizon: goal.horizon,
      title: goal.title,
      why: goal.why,
      pulse: goal.pulse,
      periodKey: goal.periodKey,
      period: goal.period,
      lifeRootId: this.lifeRootIdOf(s.interior, goal),
      backlogCount: s.backlogCounts.get(goal.id) ?? 0,
      carrying: isLife ? (s.carrying.get(goal.id) ?? null) : null,
      plannedAgeWeeks: plannedAgeOf(goal, s),
      weeklyBreakdown: goal.horizon === 'Monthly' ? (s.weeklyBreakdown.get(goal.id) ?? null) : null,
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
      version: goal.version,
    };
  }
}

type ViewContext = {
  interior: TreeIndex<Goal>;
  today: string;
  currentWeekStart: string;
  tz: string;
  backlogCounts: Map<string, number>;
  carrying: Map<string, { openTasks: number; oldestWeeks: number }>;
  weeklyBreakdown: Map<string, { weeklyGoals: number; thisWeek: number | null }>;
};

/**
 * R-goal-43 — `planned N weeks ago`, on a **Weekly** goal whose week has ARRIVED.
 *
 * `plannedAgeWeeks = weeksBetween(weekStartOf(updatedAt), periodKey)`. Null when the goal is not Weekly,
 * and null when its week has not arrived — that goal is **early, not stale**, and a label there would be
 * a count firing on work whose period has not come due (R-lens-11). The client renders the muted line at
 * `>= 2`; age 1 is ordinary planning and carries nothing.
 */
function plannedAgeOf(goal: Goal, s: ViewContext): number | null {
  if (goal.horizon !== 'Weekly') return null;
  if (goal.periodKey > s.currentWeekStart) return null;
  return weeksBetween(weekStartOf(goal.updatedAt, s.tz), goal.periodKey);
}

/**
 * R-goal-40 — **the `periodKey` immutability guard, asserted rather than inferred.**
 *
 * Move builds a patch containing only `parentId`, and `MoveGoalRequest` has no `periodKey` field, so
 * this can only fire if someone later adds one. That is exactly why it is here: crossing weeks breaks
 * NOTHING in the data — `tasks.origin_week_start` is the task's own stored field and is not re-read from
 * the parent (R-task-40) — so the failure would be silent, and it would re-open D-2. A guard that costs
 * one comparison beats a defect nothing catches.
 */
function assertNoPeriodWrite(goal: Goal, patch: Partial<Goal>): void {
  if (goal.horizon !== 'Weekly') return;
  if (patch.periodKey === undefined && patch.period === undefined) return;
  throw new DomainError('VALIDATION_FAILED', 'move may change a weekly goal’s parent, never its week', {
    goalId: goal.id,
    periodKey: goal.periodKey,
  });
}

/** Local, because `domain/weeks` owns the arithmetic and this file owns no date rules of its own. */
function addWeeksTo(weekStart: string, n: number): string {
  const t = Date.parse(`${weekStart}T00:00:00.000Z`);
  return new Date(t + n * 7 * 86_400_000).toISOString().slice(0, 10);
}

/** Local projections. `BacklogService` / `LearningService` own the canonical ones; these read only. */
function backlogItemView(
  item: BacklogItem,
  links: readonly { id: string; itemId: string; url: string; createdAt: string }[],
): BacklogItemView {
  return {
    id: item.id,
    goalId: item.goalId,
    title: item.title,
    description: item.description,
    links: links.filter((l) => l.itemId === item.id).map((l) => ({ id: l.id, url: l.url, createdAt: l.createdAt })),
    capturedAt: item.capturedAt,
    fromWeekStart: item.fromWeekStart,
    status: item.status,
    convertedToTaskId: item.convertedToTaskId,
    convertedAt: item.convertedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    version: item.version,
  };
}

function learningView(l: Learning): LearningView {
  return {
    id: l.id,
    goalId: l.goalId,
    text: l.text,
    applied: l.applied,
    capturedAt: l.capturedAt,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
    version: l.version,
  };
}
