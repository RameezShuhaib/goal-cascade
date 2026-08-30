import type {
  BacklogItemView,
  CreateGoalRequest,
  DeleteGoalResponse,
  GoalDetailResponse,
  GoalResponse,
  GoalView,
  GoalsResponse,
  LearningView,
  MoveGoalRequest,
  PatchGoalRequest,
  ReplanGoalRequest,
  WeekView,
} from '@goal-cascade/shared';
import { inject, injectable } from 'tsyringe';
import type { BacklogItem, Goal, Learning, Task } from '../../domain/entities';
import { DomainError, notFound } from '../../domain/errors';
import {
  ancestors,
  children,
  defaultPeriod,
  descendantIds,
  isLeaf,
  orderedTree,
  replanPeriods,
  rootOf,
} from '../../domain/goal-tree';
import { dateInTimezone, offsetOf, weeksBetween } from '../../domain/weeks';
import type { RequestContext } from '../context';
import {
  IBacklogLinkRepo,
  IBacklogRepo,
  IClock,
  IGoalRepo,
  IIdGenerator,
  IIdeaRepo,
  ILearningRepo,
  ITaskEventRepo,
  ITaskLinkRepo,
  ITaskRepo,
  IWeeklyFocusRepo,
} from '../ports';
import type { GuardedWrite } from '../ports/statement';
import { GuardedBatch } from './guarded-batch';

/**
 * The goal tree, as behaviour.
 *
 * What is already done before any of these runs:
 *  - the session exists and `ctx.userId` is the ONLY scope (R-auth-2); nothing here reads a scope from input;
 *  - the body/query/params are validated, trimmed and bounded by the shared schemas (Q-11/Q-12);
 *  - `POST /goals` and `POST /goals/:id/move` have passed `GoalTreeGuard` (R-goal-3/4/5/6/17/18/21/28),
 *    so the tree rules hold by the time `create`/`move` is called. They are NOT re-checked here — one
 *    implementation of a rule, in `domain/goal-tree.ts`, called from one place.
 *
 * Derived state is never stored (SPEC §1): `isLeaf`, `isActive`, `dormant`, `subtreeActive`, `carrying`
 * and `branches` are all computed per read, for the week the read is about.
 */
@injectable()
export class GoalService {
  constructor(
    @inject(IGoalRepo) private readonly goals: IGoalRepo,
    @inject(IWeeklyFocusRepo) private readonly focuses: IWeeklyFocusRepo,
    @inject(ITaskRepo) private readonly tasks: ITaskRepo,
    @inject(ITaskLinkRepo) private readonly taskLinks: ITaskLinkRepo,
    @inject(ITaskEventRepo) private readonly taskEvents: ITaskEventRepo,
    @inject(IBacklogRepo) private readonly backlog: IBacklogRepo,
    @inject(IBacklogLinkRepo) private readonly backlogLinks: IBacklogLinkRepo,
    @inject(IIdeaRepo) private readonly ideas: IIdeaRepo,
    @inject(ILearningRepo) private readonly learnings: ILearningRepo,
    @inject(IIdGenerator) private readonly ids: IIdGenerator,
    @inject(IClock) private readonly clock: IClock,
    @inject(GuardedBatch) private readonly batch: GuardedBatch,
  ) {}

  /** R-goal-25 — the whole tree, flat and ordered (Q-7), with `week`'s derived flags. */
  async list(ctx: RequestContext, week: { weekStart: string }): Promise<GoalsResponse> {
    const snapshot = await this.snapshot(ctx, week.weekStart);
    return {
      week: weekView(ctx, week.weekStart),
      goals: orderedTree(snapshot.goals).map((g) => this.toView(g, snapshot)),
      serverNow: ctx.now,
    };
  }

  /** R-goal-27 / R-backlog-11/12 / R-learning-5 — the detail screen in one request. */
  async detail(ctx: RequestContext, id: string, week: { weekStart: string }): Promise<GoalDetailResponse> {
    const snapshot = await this.snapshot(ctx, week.weekStart);
    const goal = snapshot.goals.find((g) => g.id === id);
    if (!goal) throw notFound('goal');

    const isLife = goal.parentId === null;
    // R-backlog-11 — a non-Life goal shows its OWN items; R-backlog-12 — a Life goal shows the
    // read-only roll-up of every item on any descendant. A Life goal can never hold items itself.
    const scope = isLife ? [...descendantIds(snapshot.goals, id)] : [id];
    const items = await this.backlog.listOpenByGoals(ctx.userId, scope);
    // R-learning-5 — the learnings of the whole LINE, i.e. tagged to this goal's Life root.
    const root = rootOf(snapshot.goals, id);
    const lineLearnings = root ? await this.learnings.listByGoals(ctx.userId, [root.id]) : [];
    const links = await this.backlogLinks.listByItems(ctx.userId, items.map((i) => i.id));

    return {
      goal: this.toView(goal, snapshot),
      ancestors: ancestors(snapshot.goals, id).map((g) => this.toView(g, snapshot)),
      children: siblingOrder(children(snapshot.goals, id)).map((g) => this.toView(g, snapshot)),
      backlog: items.map((i) => backlogItemView(i, links)),
      backlogIsAggregate: isLife,
      learnings: lineLearnings.map(learningView),
      serverNow: ctx.now,
    };
  }

  /**
   * R-goal-13 / D-3 — `period` defaults from the horizon and TODAY in the OWNER's timezone, never a
   * frozen literal: the mockup's `defaultPeriod` returned `'Q4 2026'` forever, so every default was
   * wrong from the first day of the next period.
   */
  async create(ctx: RequestContext, input: CreateGoalRequest): Promise<GoalResponse> {
    const all = await this.goals.listAll(ctx.userId);
    const isLife = input.horizon === 'Life';
    // R-goal-3 — a Life goal has no target period. Refused rather than silently blanked (Q-10).
    if (isLife && input.period) {
      throw new DomainError('VALIDATION_FAILED', 'a Life goal has no target period', { period: input.period });
    }

    const now = this.clock.nowIso();
    const goal: Goal = {
      id: this.ids.ulid(),
      userId: ctx.userId,
      parentId: isLife ? null : input.parentId,
      horizon: input.horizon,
      title: input.title,
      why: input.why,
      pulse: input.pulse,
      period: isLife ? '' : (input.period ?? defaultPeriod(input.horizon, this.today(ctx))),
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    const writes: GuardedWrite[] = [{ label: 'goal.insert', stmt: this.goals.insertStmt(goal) }];
    writes.push(...(await this.exLeafWrites(ctx, all, goal.parentId)));
    await this.batch.run(writes);

    return { goal: this.toView(goal, await this.snapshot(ctx, ctx.currentWeekStart)), serverNow: ctx.now };
  }

  /**
   * R-goal-14 — title / why / period / pulse only. `horizon` and `parentId` are immutable through edit
   * (the request schema is `.strict()`, so sending either is a 422); re-parenting is Move, re-scheduling
   * is Re-plan.
   */
  async patch(ctx: RequestContext, id: string, input: PatchGoalRequest): Promise<GoalResponse> {
    const goal = await this.require(ctx, id);
    if (goal.parentId === null && input.period) {
      throw new DomainError('VALIDATION_FAILED', 'a Life goal has no target period', { period: input.period });
    }

    const patch = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.why !== undefined ? { why: input.why } : {}),
      ...(input.period !== undefined ? { period: input.period } : {}),
      ...(input.pulse !== undefined ? { pulse: input.pulse } : {}),
    };
    const next = await this.applyPatch(ctx, goal, patch, input.version);
    return { goal: this.toView(next, await this.snapshot(ctx, ctx.currentWeekStart)), serverNow: ctx.now };
  }

  /**
   * R-goal-16 — Move changes ONLY `parentId`; the goal's horizon is untouched and its children move with
   * it, which needs no write of their own because the tree is an adjacency list.
   *
   * R-goal-28 / D-8 — if the TARGET was a leaf it stops being one, so its weekly focus rows go in the
   * SAME batch. Open tasks on the target were already refused by `GoalTreeGuard`.
   */
  async move(ctx: RequestContext, id: string, input: MoveGoalRequest): Promise<GoalResponse> {
    const all = await this.goals.listAll(ctx.userId);
    const goal = all.find((g) => g.id === id);
    if (!goal) throw notFound('goal');

    const next = await this.applyPatch(ctx, goal, { parentId: input.parentId }, input.version, () =>
      this.exLeafWrites(ctx, all, input.parentId),
    );
    return { goal: this.toView(next, await this.snapshot(ctx, ctx.currentWeekStart)), serverNow: ctx.now };
  }

  /**
   * R-goal-22/23 — a new target period plus an OPTIONAL one-line reason ("No mandatory fields. Fast and
   * guilt-free"). A Life goal is not re-plannable (R-goal-21).
   *
   * D-3 — a re-plan that lands on the period the goal is already in is refused rather than written: that
   * is precisely the mockup bug (its frozen option list offered the current quarter as a "next" one).
   * The contextual options for this horizon and today are returned in `details` so the client can
   * re-render the sheet from the server's own derivation instead of a literal.
   */
  async replan(ctx: RequestContext, id: string, input: ReplanGoalRequest): Promise<GoalResponse> {
    const goal = await this.require(ctx, id);
    if (goal.parentId === null) {
      throw new DomainError('LIFE_GOAL_IMMUTABLE', 'a Life goal cannot be moved or re-planned');
    }
    if (input.period === goal.period) {
      throw new DomainError('VALIDATION_FAILED', 'that is already this goal’s target period', {
        period: input.period,
        options: replanPeriods(goal.horizon, this.today(ctx), goal.period),
      });
    }

    // The reason is deliberately not persisted: goals have no activity log in this product (R-nav-14 —
    // no audit trail, no review wizard), and inventing a column for a string nothing renders would be a
    // feature the ruleset explicitly removes. It is accepted, and it is the client's toast copy.
    const next = await this.applyPatch(ctx, goal, { period: input.period }, input.version);
    return { goal: this.toView(next, await this.snapshot(ctx, ctx.currentWeekStart)), serverNow: ctx.now };
  }

  /**
   * Q-5 — the whole subtree, transactionally: goals, weekly focuses, tasks (with their links and
   * events), backlog items (with their links). Idea and Learning tags pointing INTO the subtree null out
   * to Unsorted instead of cascading, so an idea survives the deletion of the Life goal it was filed
   * under (S-idea-7-1). No soft-delete, no trash.
   *
   * Without `?cascade=true`, a goal that still has children is refused with `GOAL_HAS_CHILDREN` and the
   * counts in `details` — exactly the "N sub-goals, M tasks, K backlog items" confirmation the client has
   * to render. A childless goal needs no acknowledgement.
   *
   * Every statement states the exact number of rows it must remove, which `GuardedBatch` turns into a
   * precondition: if another device added a task under this subtree between the read and the write, the
   * batch rolls back with a clean 409 rather than leaving that task orphaned.
   */
  async remove(ctx: RequestContext, id: string, opts: { cascade: boolean }): Promise<DeleteGoalResponse> {
    const all = await this.goals.listAll(ctx.userId);
    if (!all.some((g) => g.id === id)) throw notFound('goal');

    const descendants = descendantIds(all, id);
    const subtree = [id, ...descendants];
    const [taskRows, itemRows, focusRows, ideaRows, learningRows] = await Promise.all([
      this.tasks.listByGoals(ctx.userId, subtree),
      this.backlog.listByGoals(ctx.userId, subtree),
      this.focuses.listByGoals(ctx.userId, subtree),
      this.ideas.listAll(ctx.userId),
      this.learnings.listByGoals(ctx.userId, subtree),
    ]);

    if (!opts.cascade && descendants.size > 0) {
      throw new DomainError('GOAL_HAS_CHILDREN', 'this goal has sub-goals; confirm the cascade to delete them', {
        goalId: id,
        subGoals: descendants.size,
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
    const taggedIdeas = ideaRows.filter((i) => i.goalId !== null && subtree.includes(i.goalId));

    const writes: GuardedWrite[] = [];
    const removal = (label: string, stmt: GuardedWrite['stmt'], rows: number) => {
      if (rows > 0) writes.push({ label, stmt, expectedChanges: rows });
    };
    removal('taskEvent.deleteByTasks', this.taskEvents.deleteByTasksStmt(ctx.userId, taskIds), eventRows.length);
    removal('taskLink.deleteByTasks', this.taskLinks.deleteByTasksStmt(ctx.userId, taskIds), linkRows.length);
    removal('task.deleteByGoals', this.tasks.deleteByGoalsStmt(ctx.userId, subtree), taskRows.length);
    removal('backlogLink.deleteByItems', this.backlogLinks.deleteByItemsStmt(ctx.userId, itemIds), itemLinkRows.length);
    removal('backlog.deleteByGoals', this.backlog.deleteByGoalsStmt(ctx.userId, subtree), itemRows.length);
    removal('weeklyFocus.deleteByGoals', this.focuses.deleteByGoalsStmt(ctx.userId, subtree), focusRows.length);
    removal('idea.untagByGoals', this.ideas.untagByGoalsStmt(ctx.userId, subtree), taggedIdeas.length);
    removal('learning.untagByGoals', this.learnings.untagByGoalsStmt(ctx.userId, subtree), learningRows.length);
    writes.push({
      label: 'goal.deleteMany',
      stmt: this.goals.deleteManyStmt(ctx.userId, subtree),
      expectedChanges: subtree.length,
    });
    await this.batch.run(writes);

    return {
      deleted: true,
      removed: {
        goals: subtree.length,
        weeklyFocuses: focusRows.length,
        tasks: taskRows.length,
        taskEvents: eventRows.length,
        backlogItems: itemRows.length,
      },
      untagged: { ideas: taggedIdeas.length, learnings: learningRows.length },
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
   * One guarded row update. `version` pins the row (Q-2): a request carrying a stale one changes zero
   * rows, `GuardedBatch` trips its precondition and the whole batch — including any focus deletion —
   * rolls back as a clean 409 rather than applying half of it.
   */
  private async applyPatch(
    ctx: RequestContext,
    goal: Goal,
    patch: Partial<Omit<Goal, 'id' | 'userId'>>,
    version: number | undefined,
    extra?: () => Promise<GuardedWrite[]>,
  ): Promise<Goal> {
    const companions = extra ? await extra() : [];
    // An edit that changes nothing writes nothing — and does not bump `version` out from under the
    // other device that is about to save a real change.
    if (Object.keys(patch).length === 0 && companions.length === 0) return goal;

    const expected = version ?? goal.version;
    const now = this.clock.nowIso();
    const next: Goal = { ...goal, ...patch, updatedAt: now, version: expected + 1 };
    await this.batch.run([
      {
        label: 'goal.update',
        stmt: this.goals.updateGuardedStmt(ctx.userId, goal.id, expected, {
          ...patch,
          updatedAt: now,
          version: expected + 1,
        }),
      },
      ...companions,
    ]);
    return next;
  }

  /**
   * R-goal-28 / D-8 — the leaf → non-leaf transition.
   *
   * A goal that gains a child can no longer hold a weekly focus (R-goal-9/12), so EVERY focus row it
   * holds is deleted in the same batch as the create/move. The mockup ran nothing here: the ex-leaf kept
   * its focus string, inert only because `isActive` also required `isLeaf` — and it silently came back
   * to life the moment the child was moved away. Deleting only the current week's row would leave that
   * resurrection possible for any other week, and would leave a row pointing at a goal that can never be
   * active again, which is the second representation of dormancy D-2 exists to prevent.
   *
   * The cost is deliberate and documented: a past week no longer renders that leaf's sentence. Its open
   * tasks are untouched — `GoalTreeGuard` refuses the whole operation while any exist, rather than
   * silently re-homing someone's work.
   */
  private async exLeafWrites(ctx: RequestContext, all: readonly Goal[], parentId: string | null): Promise<GuardedWrite[]> {
    if (parentId === null || !isLeaf(all, parentId)) return [];
    const rows = await this.focuses.listByGoals(ctx.userId, [parentId]);
    if (rows.length === 0) return [];
    return [
      {
        label: 'weeklyFocus.deleteExLeaf',
        stmt: this.focuses.deleteByGoalsStmt(ctx.userId, [parentId]),
        expectedChanges: rows.length,
      },
    ];
  }

  /** Everything a week's worth of derived flags needs, read once. */
  private async snapshot(ctx: RequestContext, weekStart: string): Promise<TreeSnapshot> {
    const goals = await this.goals.listAll(ctx.userId);
    const goalIds = goals.map((g) => g.id);
    const [focusRows, openTasks, backlogRows] = await Promise.all([
      this.focuses.listByWeek(ctx.userId, weekStart),
      this.tasks.listOpenByGoals(ctx.userId, goalIds),
      this.backlog.listOpenByGoals(ctx.userId, goalIds),
    ]);
    const backlogCounts = new Map<string, number>();
    for (const item of backlogRows) backlogCounts.set(item.goalId, (backlogCounts.get(item.goalId) ?? 0) + 1);
    return {
      weekStart,
      goals,
      // D-2 — "active" is exactly "a focus row exists for this week". There is no second representation.
      focusByGoal: new Map(focusRows.map((f) => [f.goalId, f.sentence])),
      openTasks,
      backlogCounts,
    };
  }

  /** R-goal-8..11 / R-goal-24/25/26 — the derived half of a goal, for ONE week. Never stored (§1). */
  private toView(goal: Goal, s: TreeSnapshot): GoalView {
    const leaf = isLeaf(s.goals, goal.id);
    const isLife = goal.parentId === null;
    // R-goal-9 — only a non-Life LEAF can be active, whatever rows happen to exist.
    const active = leaf && !isLife && s.focusByGoal.has(goal.id);
    const descendants = descendantIds(s.goals, goal.id);
    const anyActiveBelow = [...descendants].some((d) => isLeaf(s.goals, d) && s.focusByGoal.has(d));

    return {
      id: goal.id,
      parentId: goal.parentId,
      horizon: goal.horizon,
      title: goal.title,
      why: goal.why,
      pulse: goal.pulse,
      period: goal.period,
      focus: active ? (s.focusByGoal.get(goal.id) ?? '') : '',
      isLeaf: leaf,
      isActive: active,
      // R-goal-10 — a non-Life leaf with no focus this week. A Life goal is never "dormant" itself.
      dormant: leaf && !isLife && !active,
      // R-goal-11 — one active leaf anywhere below lights the whole ancestor chain.
      subtreeActive: leaf ? active : anyActiveBelow,
      backlogCount: s.backlogCounts.get(goal.id) ?? 0,
      carrying: isLife ? carryingOf(s, descendants) : null,
      branches: isLife ? branchesOf(s, descendants) : null,
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
      version: goal.version,
    };
  }
}

type TreeSnapshot = {
  weekStart: string;
  goals: Goal[];
  focusByGoal: Map<string, string>;
  openTasks: Task[];
  backlogCounts: Map<string, number>;
};

/**
 * R-goal-24 — the ONE quiet signal on a life-goal card: `N tasks carrying · oldest W weeks`, counting
 * open tasks under it that originated BEFORE the viewed week. `null` when there are none, so the line is
 * hidden rather than rendered as a zero. There is no audit page behind it (R-nav-14).
 */
function carryingOf(s: TreeSnapshot, descendants: ReadonlySet<string>): { openTasks: number; oldestWeeks: number } | null {
  let count = 0;
  let oldest = 0;
  for (const task of s.openTasks) {
    if (!descendants.has(task.goalId)) continue;
    const age = weeksBetween(task.originWeekStart, s.weekStart);
    if (age < 1) continue;
    count += 1;
    oldest = Math.max(oldest, age);
  }
  return count > 0 ? { openTasks: count, oldestWeeks: oldest } : null;
}

/**
 * R-goal-26 / D-16 — `<A> of <B> branches active`, where B is the number of non-Life LEAVES on this
 * line. A line with no leaves reads `0 of 0`, never the mockup's fabricated `0 of 1`.
 */
function branchesOf(s: TreeSnapshot, descendants: ReadonlySet<string>): { active: number; total: number } {
  let total = 0;
  let active = 0;
  for (const id of descendants) {
    if (!isLeaf(s.goals, id)) continue;
    total += 1;
    if (s.focusByGoal.has(id)) active += 1;
  }
  return { active, total };
}

/** Q-7 — siblings by `createdAt` asc, `id` asc. Total and stable, never storage order. */
function siblingOrder(goals: readonly Goal[]): Goal[] {
  return [...goals].sort((a, b) =>
    a.createdAt === b.createdAt ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.createdAt < b.createdAt ? -1 : 1,
  );
}

/** Local projections. `BacklogService` / `LearningService` own the canonical ones; these read only. */
function backlogItemView(item: BacklogItem, links: readonly { id: string; itemId: string; url: string; createdAt: string }[]): BacklogItemView {
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

/**
 * D-1 — the read models answer with the ABSOLUTE Monday plus its projection against the current week, so
 * the client never re-derives Monday from its own clock (R-auth-5).
 */
export function weekView(ctx: RequestContext, weekStart: string): WeekView {
  return {
    weekStart,
    offset: offsetOf(weekStart, ctx.currentWeekStart),
    isCurrent: weekStart === ctx.currentWeekStart,
  };
}
