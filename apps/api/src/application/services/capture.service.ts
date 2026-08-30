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
  LearningResponse,
  LearningsResponse,
  PatchLearningRequest,
} from '@goal-cascade/shared';
import { injectable } from 'tsyringe';
import { NotImplementedError } from '../../domain/errors';
import type { RequestContext } from '../context';

/**
 * FOUNDATION STUB — ideas. Rules owed: R-idea-1..8, D-22.
 *
 * The tag is a LIFE goal or nothing (`NOT_A_LIFE_GOAL`), and an idea whose tagged goal no longer exists
 * renders as Unsorted rather than disappearing — which the Q-5 cascade guarantees by nulling the tag
 * instead of deleting the row (S-idea-7-1).
 */
@injectable()
export class IdeaService {
  /** R-idea-7 / Q-7 — newest first; grouping by Life goal then Unsorted is the client's job. */
  async list(_ctx: RequestContext): Promise<IdeasResponse> {
    throw new NotImplementedError('GET /ideas');
  }

  async create(_ctx: RequestContext, _input: CreateIdeaRequest): Promise<IdeaResponse> {
    throw new NotImplementedError('POST /ideas');
  }

  /** R-idea-6 — no confirmation, no archive. */
  async remove(_ctx: RequestContext, _id: string): Promise<DeleteResponse> {
    throw new NotImplementedError('DELETE /ideas/:id');
  }

  /** R-idea-5 — the text becomes a backlog item on a NON-Life goal and the idea is removed, atomically. */
  async attach(_ctx: RequestContext, _id: string, _input: AttachIdeaRequest): Promise<AttachIdeaResponse> {
    throw new NotImplementedError('POST /ideas/:id/attach');
  }

  /**
   * R-idea-4 / D-22 — "Task this week". The idea is consumed ONLY on successful creation, in the same
   * transaction: the mockup deleted it before the modal was saved, so cancelling lost it permanently in
   * the one feature whose whole promise is "capture it and get back to work".
   */
  async convert(_ctx: RequestContext, _id: string, _input: ConvertIdeaRequest): Promise<ConvertIdeaResponse> {
    throw new NotImplementedError('POST /ideas/:id/convert-to-task');
  }
}

/**
 * FOUNDATION STUB — learnings. Rules owed: R-learning-1..7, D-23.
 * A learning is never converted into work; the only actions are re-tag and discard.
 */
@injectable()
export class LearningService {
  async list(_ctx: RequestContext): Promise<LearningsResponse> {
    throw new NotImplementedError('GET /learnings');
  }

  async create(_ctx: RequestContext, _input: CreateLearningRequest): Promise<LearningResponse> {
    throw new NotImplementedError('POST /learnings');
  }

  /** R-learning-4 / D-23 — `applied` ("changed the plan") is set by an explicit user action, not by seed data. */
  async patch(_ctx: RequestContext, _id: string, _input: PatchLearningRequest): Promise<LearningResponse> {
    throw new NotImplementedError('PATCH /learnings/:id');
  }

  /** R-learning-6 — discard; there is no archive. */
  async remove(_ctx: RequestContext, _id: string): Promise<DeleteResponse> {
    throw new NotImplementedError('DELETE /learnings/:id');
  }

  /** R-learning-3 — re-tag to another LIFE goal, or `null` for Unsorted (`NOT_A_LIFE_GOAL` otherwise). */
  async attach(_ctx: RequestContext, _id: string, _input: AttachLearningRequest): Promise<LearningResponse> {
    throw new NotImplementedError('POST /learnings/:id/attach');
  }
}

/**
 * FOUNDATION STUB — the cold-open read model (the mockup's `fetchAll`).
 *
 * It composes the other services' reads for ONE week and must not re-derive anything independently: a
 * second implementation of "which tasks are visible" or "which leaves are active" is how the bootstrap
 * payload and the per-screen fetches start disagreeing. Whoever implements it last should call the
 * existing readers, not copy them.
 */
@injectable()
export class BootstrapService {
  async get(_ctx: RequestContext, _week: { weekStart: string }): Promise<BootstrapResponse> {
    throw new NotImplementedError('GET /bootstrap');
  }
}
