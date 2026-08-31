import type {
  AttachLearningRequest,
  BootstrapResponse,
  CreateLearningRequest,
  DeleteResponse,
  LearningResponse,
  LearningsResponse,
  LearningView,
  PatchLearningRequest,
} from '@goal-cascade/shared';
import { inject, injectable } from 'tsyringe';
import type { RequestContext } from '../context';
import type { Learning } from '../../domain/entities';
import { DomainError, notFound } from '../../domain/errors';
import { isLifeHorizon } from '../../domain/goal-tree';
import { IGoalRepo, IIdGenerator, ILearningRepo } from '../ports';
import { BacklogService, newestFirst } from './backlog.service';
import { GoalService } from './goal.service';
import { GuardedBatch } from './guarded-batch';
import { MeService } from './me.service';
import { weekView } from './views';

/**
 * R-learning-2 — a Learning is tagged to a **Life goal or nothing**. A tag pointing at a
 * Yearly/Quarterly/Monthly goal is refused (`NOT_A_LIFE_GOAL`): a learning files an insight by LINE,
 * not by the sub-goal of the week.
 *
 * `null` is always valid and means Unsorted — which is also where a tag ends up when its goal is deleted
 * (Q-5 nulls the tag rather than cascading), so every read here must tolerate a null tag and a tag is
 * never a foreign key the reader can rely on.
 */
async function assertLifeGoalTag(ctx: RequestContext, goals: IGoalRepo, goalId: string | null): Promise<void> {
  if (goalId === null) return;
  const goal = await goals.findById(ctx.userId, goalId);
  if (!goal) throw notFound('goal');
  if (!isLifeHorizon(goal.horizon)) {
    throw new DomainError('NOT_A_LIFE_GOAL', 'learnings are tagged to a Life goal, or to nothing', {
      goalId,
      horizon: goal.horizon,
    });
  }
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

  /** R-learning-2 / Q-7 — newest first; the `Unsorted` grouping is the client's. */
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
 * rule here: a second implementation of "which tasks are visible this week" or "which goals are in this
 * lens" is exactly how the bootstrap payload and the per-screen fetches start disagreeing, and the client
 * would have no way to tell which one was lying. Every array below comes from the service that owns it —
 * including the lazy `Carried to week of …` producer inside `TaskService.list` (R-task-29, Q-17), which
 * must fire on a cold open just as it does on a lens fetch.
 *
 * ── ⚠ **A2 (R-rm-5, R-nav-28) — it no longer ships every goal** ────────────────────────────────────
 *
 * It used to call `GoalService.list` (the whole tree, flat) AND `PlanService.get`, which meant
 * `SELECT * FROM goals WHERE user_id = ?` **twice per cold open**, then Θ(n²·d) of derivation on top.
 *
 * A cold start opens the **Weekly lens at the week containing today** (R-nav-28), so that is exactly what
 * this carries now: the **Life goals** — bounded by the number of Life lines, and the one list guaranteed
 * complete, because the Life lens is where every Life goal is always visible — that lens, and its week's
 * tasks. `plan` went with the entity (R-rm-2) and `ideas` with theirs (R-rm-1).
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
    @inject(BacklogService) private readonly backlog: BacklogService,
    @inject(LearningService) private readonly learnings: LearningService,
  ) {}

  async get(ctx: RequestContext, week: { weekStart: string }): Promise<BootstrapResponse> {
    // The reads are independent, so they run concurrently: one round trip for the client should not be
    // several serialised round trips to D1.
    const [me, lifeLens, weeklyLens, backlog, learnings] = await Promise.all([
      this.me.getMe(ctx),
      this.goals.lens(ctx, { lens: 'Life' }),
      this.goals.lens(ctx, { lens: 'Weekly', period: week.weekStart }),
      this.backlog.list(ctx, {}),
      this.learnings.list(ctx),
    ]);

    return {
      user: me.user,
      preferences: me.preferences,
      week: weekView(ctx, week.weekStart),
      lifeGoals: lifeLens.items,
      lens: weeklyLens,
      backlog: backlog.items,
      learnings: learnings.learnings,
      serverNow: ctx.now,
    };
  }
}
