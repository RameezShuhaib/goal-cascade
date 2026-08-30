import type {
  AttachIdeaRequest,
  AttachIdeaResponse,
  AttachLearningRequest,
  BootstrapResponse,
  ConvertIdeaRequest,
  ConvertIdeaResponse,
  CreateIdeaRequest,
  CreateLearningRequest,
  DeleteResponse,
  IdeaResponse,
  IdeasResponse,
  IdeaView,
  LearningResponse,
  LearningsResponse,
  LearningView,
  PatchLearningRequest,
} from '@goal-cascade/shared';
import { WEEK_HISTORY_WEEKS } from '@goal-cascade/shared';
import { inject, injectable } from 'tsyringe';
import type { RequestContext } from '../context';
import type { Goal, Idea, Learning } from '../../domain/entities';
import { DomainError, notFound } from '../../domain/errors';
import { isLeaf, isLifeHorizon } from '../../domain/goal-tree';
import {
  IBacklogLinkRepo,
  IBacklogRepo,
  IGoalRepo,
  IIdeaRepo,
  IIdGenerator,
  ILearningRepo,
  ITaskEventRepo,
  ITaskLinkRepo,
  ITaskRepo,
  IWeeklyFocusRepo,
} from '../ports';
import {
  assertCanHoldBacklog,
  BacklogService,
  buildBacklogItem,
  buildTaskWrites,
  newestFirst,
  toBacklogItemView,
  toNewTaskDetailView,
} from './backlog.service';
import { GoalService } from './goal.service';
import { GuardedBatch } from './guarded-batch';
import { MeService } from './me.service';
import { PlanService } from './plan.service';
import { TaskService } from './task.service';

/**
 * R-idea-2 / R-learning-2 — an Idea or a Learning is tagged to a **Life goal or nothing**. A tag pointing
 * at a Yearly/Quarterly/Monthly goal is refused (`NOT_A_LIFE_GOAL`, S-idea-2-1): these are the two
 * capture surfaces of the product and they file thoughts by LINE, not by the sub-goal of the week.
 *
 * `null` is always valid and means Unsorted — which is also where a tag ends up when its goal is deleted
 * (Q-5 nulls the tag rather than cascading, S-idea-7-1), so every read here must tolerate a null tag and
 * a tag is never a foreign key the reader can rely on.
 */
async function assertLifeGoalTag(ctx: RequestContext, goals: IGoalRepo, goalId: string | null): Promise<void> {
  if (goalId === null) return;
  const goal = await goals.findById(ctx.userId, goalId);
  if (!goal) throw notFound('goal');
  if (!isLifeHorizon(goal.horizon)) {
    throw new DomainError('NOT_A_LIFE_GOAL', 'ideas and learnings are tagged to a Life goal, or to nothing', {
      goalId,
      horizon: goal.horizon,
    });
  }
}

/** Q-11 — `Idea.text` is up to 500 chars; `BacklogItem.title` / `Task.title` are 200. */
const TITLE_MAX = 200;

/**
 * Carry an idea's text into a field that is half its length.
 *
 * The text is NOT silently cut: whatever does not fit the title is preserved verbatim in the body field,
 * because the whole promise of the parking lot is that nothing you dropped there is lost. A short idea —
 * which is nearly all of them — produces a title and an empty body, exactly as if it had been typed in.
 */
function splitCapture(text: string): { title: string; body: string } {
  if (text.length <= TITLE_MAX) return { title: text, body: '' };
  return { title: `${text.slice(0, TITLE_MAX - 1).trimEnd()}…`, body: text };
}

function toIdeaView(i: Idea): IdeaView {
  return { id: i.id, goalId: i.goalId, text: i.text, capturedAt: i.capturedAt, createdAt: i.createdAt };
}

function toLearningView(l: Learning): LearningView {
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
 * Ideas — the parking lot (R-idea-1..8).
 *
 * Both write actions that consume an idea (`attach`, `convert`) remove it in the SAME batch as the thing
 * it becomes. D-22: the mockup removed the idea and THEN opened the create modal, so dismissing the modal
 * lost the thought permanently — unrecoverable data loss on a cancel, in the one feature whose whole
 * promise is "capture it and get back to work".
 */
@injectable()
export class IdeaService {
  constructor(
    @inject(IIdeaRepo) private readonly ideas: IIdeaRepo,
    @inject(IGoalRepo) private readonly goals: IGoalRepo,
    @inject(IWeeklyFocusRepo) private readonly focuses: IWeeklyFocusRepo,
    @inject(IBacklogRepo) private readonly items: IBacklogRepo,
    @inject(IBacklogLinkRepo) private readonly backlogLinks: IBacklogLinkRepo,
    @inject(ITaskRepo) private readonly tasks: ITaskRepo,
    @inject(ITaskLinkRepo) private readonly taskLinks: ITaskLinkRepo,
    @inject(ITaskEventRepo) private readonly taskEvents: ITaskEventRepo,
    @inject(IIdGenerator) private readonly ids: IIdGenerator,
    @inject(GuardedBatch) private readonly batch: GuardedBatch,
  ) {}

  /**
   * R-idea-7 / Q-7 — newest first, total and stable. Grouping by Life goal then `Unsorted` is the
   * client's job, and an idea whose tag points at a goal that no longer exists simply carries
   * `goalId: null` (S-idea-7-1) — it never disappears and never errors.
   */
  async list(ctx: RequestContext): Promise<IdeasResponse> {
    const rows = await this.ideas.listAll(ctx.userId);
    return { ideas: newestFirst(rows).map(toIdeaView), serverNow: ctx.now };
  }

  /** R-idea-1/2 — text plus an optional Life-goal tag, and nothing else to fill in. */
  async create(ctx: RequestContext, input: CreateIdeaRequest): Promise<IdeaResponse> {
    await assertLifeGoalTag(ctx, this.goals, input.goalId);
    const idea: Idea = {
      id: this.ids.ulid(),
      userId: ctx.userId,
      goalId: input.goalId,
      text: input.text,
      capturedAt: ctx.now,
      createdAt: ctx.now,
    };
    await this.batch.run([{ label: 'idea.insert', stmt: this.ideas.insertStmt(idea) }]);
    return { idea: toIdeaView(idea), serverNow: ctx.now };
  }

  /** R-idea-6 — no confirmation and no archive; the parking lot is meant to be emptied. */
  async remove(ctx: RequestContext, id: string): Promise<DeleteResponse> {
    await this.requireIdea(ctx, id);
    await this.batch.run([{ label: 'idea.delete', stmt: this.ideas.deleteStmt(ctx.userId, id) }]);
    return { deleted: true, serverNow: ctx.now };
  }

  /**
   * R-idea-5 — "Attach to a goal": the idea's text becomes a backlog item on the chosen NON-Life goal
   * and the idea is removed, in ONE batch. Note the asymmetry with the idea's own tag, and that it is
   * deliberate: an idea is FILED against a Life line, but work is DEFERRED against a real sub-goal
   * (R-backlog-2), so this picker lists `nonLife()` only.
   */
  async attach(ctx: RequestContext, id: string, input: AttachIdeaRequest): Promise<AttachIdeaResponse> {
    const idea = await this.requireIdea(ctx, id);
    const goal = await this.goals.findById(ctx.userId, input.goalId);
    if (!goal) throw notFound('goal');
    assertCanHoldBacklog(goal);

    const { title, body } = splitCapture(idea.text);
    const { item, links } = buildBacklogItem(ctx, this.ids, {
      goalId: goal.id,
      title,
      description: body,
      links: [],
    });

    await this.batch.run([
      { label: 'backlogItem.insert', stmt: this.items.insertStmt(item) },
      ...links.map((l) => ({ label: 'backlogLink.insert', stmt: this.backlogLinks.insertStmt(l) })),
      { label: 'idea.delete', stmt: this.ideas.deleteStmt(ctx.userId, id) },
    ]);
    return { item: toBacklogItemView(item, links), ideaId: idea.id, serverNow: ctx.now };
  }

  /**
   * R-idea-4 / D-22 — "Task this week". The idea is consumed ONLY here, as part of the same batch that
   * inserts the task: there is no request that deletes an idea "in preparation" for a task, so an
   * abandoned create modal leaves the idea exactly where it was (S-idea-4-2).
   *
   * R-task-4 / D-10 — the target must be an ACTIVE non-Life leaf. There is no fallback goal: the mockup
   * fell back to the literal seed id `'g4'` when nothing was active (S-idea-4-3).
   */
  async convert(ctx: RequestContext, id: string, input: ConvertIdeaRequest): Promise<ConvertIdeaResponse> {
    const idea = await this.requireIdea(ctx, id);
    const goal = await this.requireActiveLeaf(ctx, input.goalId);
    const { title, body } = splitCapture(idea.text);

    const built = buildTaskWrites(
      ctx,
      { ids: this.ids, tasks: this.tasks, taskLinks: this.taskLinks, taskEvents: this.taskEvents },
      {
        goalId: goal.id,
        title: input.title ?? title,
        cond: input.cond,
        description: input.title === undefined ? body : idea.text,
        links: [],
        source: 'idea',
        detail: { ideaId: idea.id },
      },
    );

    await this.batch.run([...built.writes, { label: 'idea.delete', stmt: this.ideas.deleteStmt(ctx.userId, id) }]);
    return { task: toNewTaskDetailView(built), ideaId: idea.id, serverNow: ctx.now };
  }

  private async requireIdea(ctx: RequestContext, id: string): Promise<Idea> {
    const idea = await this.ideas.findById(ctx.userId, id);
    if (!idea) throw notFound('idea');
    return idea;
  }

  /** R-task-4 — `NOT_A_LEAF` for a Life goal or a parent; `BRANCH_NOT_ACTIVE` when it holds no focus. */
  private async requireActiveLeaf(ctx: RequestContext, goalId: string): Promise<Goal> {
    const all = await this.goals.listAll(ctx.userId);
    const goal = all.find((g) => g.id === goalId);
    if (!goal) throw notFound('goal');
    if (isLifeHorizon(goal.horizon) || !isLeaf(all, goal.id)) {
      throw new DomainError('NOT_A_LEAF', 'a task lives under a non-Life leaf goal', { goalId, horizon: goal.horizon });
    }
    const focus = await this.focuses.findByGoalAndWeek(ctx.userId, goal.id, ctx.currentWeekStart);
    if (!focus) {
      throw new DomainError('BRANCH_NOT_ACTIVE', 'this branch has no weekly focus — set one first', {
        goalId,
        weekStart: ctx.currentWeekStart,
      });
    }
    return goal;
  }
}

/**
 * Learnings (R-learning-1..7).
 *
 * A learning is an insight that might change the plan — it is never converted into work, so there is no
 * `convert` here and no attach-to-backlog. The only actions are re-tag and discard, plus the explicit
 * toggle that makes the "changed the plan" badge earnable (R-learning-4 / D-23: in the mockup only seed
 * data could ever have `applied: true`).
 */
@injectable()
export class LearningService {
  constructor(
    @inject(ILearningRepo) private readonly learnings: ILearningRepo,
    @inject(IGoalRepo) private readonly goals: IGoalRepo,
    @inject(IIdGenerator) private readonly ids: IIdGenerator,
    @inject(GuardedBatch) private readonly batch: GuardedBatch,
  ) {}

  /** R-learning-2 / Q-7 — newest first; `Unsorted` grouping is the client's, same as ideas. */
  async list(ctx: RequestContext): Promise<LearningsResponse> {
    const rows = await this.learnings.listAll(ctx.userId);
    return { learnings: newestFirst(rows).map(toLearningView), serverNow: ctx.now };
  }

  async create(ctx: RequestContext, input: CreateLearningRequest): Promise<LearningResponse> {
    await assertLifeGoalTag(ctx, this.goals, input.goalId);
    const learning: Learning = {
      id: this.ids.ulid(),
      userId: ctx.userId,
      goalId: input.goalId,
      text: input.text,
      applied: input.applied,
      capturedAt: ctx.now,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      version: 1,
    };
    await this.batch.run([{ label: 'learning.insert', stmt: this.learnings.insertStmt(learning) }]);
    return { learning: toLearningView(learning), serverNow: ctx.now };
  }

  /** R-learning-4 / D-23 — this is where `changed the plan` becomes a badge a user can actually earn. */
  async patch(ctx: RequestContext, id: string, input: PatchLearningRequest): Promise<LearningResponse> {
    const current = await this.require(ctx, id, input.version);
    const next: Learning = {
      ...current,
      ...(input.text !== undefined ? { text: input.text } : {}),
      ...(input.applied !== undefined ? { applied: input.applied } : {}),
      updatedAt: ctx.now,
      version: current.version + 1,
    };
    await this.write(ctx, current, next, 'learning.update');
    return { learning: toLearningView(next), serverNow: ctx.now };
  }

  /** R-learning-6 — Discard. There is no archive. */
  async remove(ctx: RequestContext, id: string): Promise<DeleteResponse> {
    await this.require(ctx, id);
    await this.batch.run([{ label: 'learning.delete', stmt: this.learnings.deleteStmt(ctx.userId, id) }]);
    return { deleted: true, serverNow: ctx.now };
  }

  /** R-learning-3 / S-learning-3-1 — re-tag to another Life goal, or `null` to go back to Unsorted. */
  async attach(ctx: RequestContext, id: string, input: AttachLearningRequest): Promise<LearningResponse> {
    const current = await this.require(ctx, id, input.version);
    await assertLifeGoalTag(ctx, this.goals, input.goalId);
    const next: Learning = { ...current, goalId: input.goalId, updatedAt: ctx.now, version: current.version + 1 };
    await this.write(ctx, current, next, 'learning.attach');
    return { learning: toLearningView(next), serverNow: ctx.now };
  }

  private async write(ctx: RequestContext, current: Learning, next: Learning, label: string): Promise<void> {
    await this.batch.run([
      {
        label,
        stmt: this.learnings.updateGuardedStmt(ctx.userId, current.id, current.version, {
          goalId: next.goalId,
          text: next.text,
          applied: next.applied,
          updatedAt: next.updatedAt,
          version: next.version,
        }),
      },
    ]);
  }

  private async require(ctx: RequestContext, id: string, version?: number): Promise<Learning> {
    const learning = await this.learnings.findById(ctx.userId, id);
    if (!learning) throw notFound('learning');
    if (version !== undefined && version !== learning.version) {
      throw new DomainError('CONCURRENT_UPDATE', 'this learning changed on another device — reload and retry', {
        expected: version,
        actual: learning.version,
      });
    }
    return learning;
  }
}

/**
 * `GET /bootstrap` — everything the app needs on cold open, in ONE round trip (the mockup's `fetchAll`).
 * A PWA's first paint after a cold start should cost one request, not seven.
 *
 * It **composes the other services' readers and derives nothing of its own**. That is the whole design
 * rule here: a second implementation of "which tasks are visible this week" or "which leaves are active"
 * is exactly how the bootstrap payload and the per-screen fetches start disagreeing, and the client
 * would have no way to tell which one was lying. Every array below comes from the service that owns it —
 * including the lazy `Carried to week of …` producer inside `TaskService.list` (R-task-29, Q-17), which
 * must fire on a cold open just as it does on a Tasks-screen fetch.
 *
 * The payload is a snapshot of ONE week (`week` says which). Weeks in it are absolute Mondays (D-1) so
 * it does not decay across a Monday boundary, but `week.offset` and `carryWeeks` are projections against
 * `serverNow`: a client holding a stale payload must refetch rather than re-derive them.
 */
@injectable()
export class BootstrapService {
  constructor(
    @inject(MeService) private readonly me: MeService,
    @inject(GoalService) private readonly goals: GoalService,
    @inject(PlanService) private readonly plan: PlanService,
    @inject(TaskService) private readonly tasks: TaskService,
    @inject(BacklogService) private readonly backlog: BacklogService,
    @inject(IdeaService) private readonly ideas: IdeaService,
    @inject(LearningService) private readonly learnings: LearningService,
  ) {}

  async get(ctx: RequestContext, week: { weekStart: string; offset?: number; isCurrent?: boolean }): Promise<BootstrapResponse> {
    // The reads are independent, so they run concurrently: one round trip for the client should not be
    // seven serialised round trips to D1.
    const [me, goals, plan, tasks, backlog, ideas, learnings] = await Promise.all([
      this.me.getMe(ctx),
      this.goals.list(ctx, week),
      this.plan.get(ctx, week),
      this.tasks.list(ctx, { weekStart: week.weekStart }),
      this.backlog.list(ctx, {}),
      this.ideas.list(ctx),
      this.learnings.list(ctx),
    ]);

    return {
      user: me.user,
      preferences: me.preferences,
      // The week the payload is about, as the goals reader resolved it — one answer, not two.
      week: goals.week,
      /** R-nav-4 / D-24 — echoed so the client never hardcodes the bound its two week controls share. */
      weekHistoryWeeks: WEEK_HISTORY_WEEKS,
      goals: goals.goals,
      plan: plan.entries,
      tasks: tasks.tasks,
      backlog: backlog.items,
      ideas: ideas.ideas,
      learnings: learnings.learnings,
      serverNow: ctx.now,
    };
  }
}
