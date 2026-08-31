import { z } from 'zod';
import {
  BacklogItemView,
  CaptureText,
  GoalView,
  Horizon,
  IanaTimezone,
  Iso,
  LearningView,
  LongText,
  MAX_LINKS,
  MAX_PLAN_ENTRIES,
  OneLiner,
  Period,
  PlanEntryView,
  PreferencesView,
  Pulse,
  Reason,
  Sentence,
  TaskDetailView,
  TaskSource,
  Theme,
  Title,
  Ulid,
  Url,
  WeekOffset,
  WeekOffsetParam,
  WeekStart,
  WeekView,
} from './common';

/**
 * Request AND response schema for every write.
 *
 * Conventions, all load-bearing:
 *  - **`.strict()` on every request schema.** An unknown key is a bug — a typo, a stale client, or an
 *    attempt to write a server-owned field (SPEC §1 `[srv]`, Q-10) — not something to silently drop.
 *  - **Lengths and caps live here** (Q-11, Q-12), so both sides enforce the same bounds.
 *  - **`version` is the optimistic-concurrency guard** (Q-2). Where a request accepts it, sending the
 *    `version` from the corresponding view makes the write conditional: if another device changed the row
 *    first, the write is refused with `409 CONCURRENT_UPDATE` instead of silently clobbering. Omitting it
 *    is last-write-wins. Clients that have a version SHOULD send it.
 *  - **Weeks arrive as an offset and are answered as an absolute `weekStart`** (D-1).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Shared request pieces
// ─────────────────────────────────────────────────────────────────────────────

/** Path params for every `/:id` route. */
export const IdParams = z.object({ id: Ulid }).strict();
/** Path params for `/tasks/:id/links/:linkId`. */
export const TaskLinkParams = z.object({ id: Ulid, linkId: Ulid }).strict();

/**
 * `?week=` on every week-scoped read. Absent = the current week. A positive offset is refused, not
 * clamped: no screen in this product can select a future week (R-nav-3, S-nav-3-1).
 */
export const WeekQuery = z.object({ week: WeekOffsetParam.optional() }).strict();

/** `?week=` + `?goalId=` — the Tasks screen (week switcher + goal filter pills, R-nav-7). */
export const TasksQuery = z.object({ week: WeekOffsetParam.optional(), goalId: Ulid.optional() }).strict();

/** `?goalId=` narrows the backlog to one goal. */
export const GoalFilterQuery = z.object({ goalId: Ulid.optional() }).strict();

/**
 * Q-5 — deletion cascades the WHOLE subtree (focuses, tasks, task events, backlog items) in one
 * transaction; Learning tags pointing into it null out to Unsorted rather than cascading. There is
 * no soft-delete and no trash.
 *
 * `cascade` is the explicit acknowledgement of that: without it, deleting a goal that has children is
 * refused with `409 GOAL_HAS_CHILDREN` whose `details` carry the counts, which is exactly what the
 * client needs to render the required "N sub-goals, M tasks, K backlog items" confirmation. A leaf goal
 * needs no acknowledgement.
 */
/**
 * `dryRun=true` computes exactly what the delete WOULD remove and writes nothing, answering with the
 * same `DeleteGoalResponse` shape and `deleted: false`. It ignores `cascade` — a preview is never
 * refused — and, unlike the live delete's `GOAL_HAS_CHILDREN` guard, it emits counts for LEAF goals too.
 * That is the whole point: a leaf carrying forty open tasks and a full backlog is the delete with no
 * warning, so it is the one that most needs a preview.
 */
export const DeleteGoalQuery = z.object({ cascade: z.stringbool().optional(), dryRun: z.stringbool().optional() }).strict();

const OptionalVersion = z.int().positive().optional();

/** Every command answers with the server's clock so the client can agree on "now" without guessing. */
const ServerNow = { serverNow: Iso };

export const DeleteResponse = z.object({ deleted: z.boolean(), ...ServerNow });

/** Q-5 — the counts the cascade actually removed, so the client can confirm what happened. */
export const DeleteGoalResponse = z.object({
  deleted: z.boolean(),
  removed: z.object({
    goals: z.int().nonnegative(),
    weeklyFocuses: z.int().nonnegative(),
    tasks: z.int().nonnegative(),
    taskEvents: z.int().nonnegative(),
    backlogItems: z.int().nonnegative(),
  }),
  /** Learnings whose tag pointed into the removed subtree and are now Unsorted (Q-5). */
  untagged: z.object({ learnings: z.int().nonnegative() }),
  ...ServerNow,
});

// ─────────────────────────────────────────────────────────────────────────────
// Preferences — the only thing a brand-new account has (R-auth-6)
// ─────────────────────────────────────────────────────────────────────────────

/** R-nav-12 — the theme is a real per-user preference, persisted across sessions (D-25). */
/**
 * A read that takes no query parameters at all. Named and `.strict()` rather than simply omitted, so an
 * unknown or misremembered param (`?goalId=…` on a list that does not filter) is a 422 instead of being
 * accepted and quietly ignored — the same rule every other list route already follows.
 */
export const NoQuery = z.object({}).strict();

export const PatchPreferencesRequest = z
  .object({ theme: Theme.optional(), timezone: IanaTimezone.optional() })
  .strict();
export const PreferencesResponse = z.object({ preferences: PreferencesView, ...ServerNow });

/**
 * `POST /me/change-password` — the ordinary way this account stays recoverable.
 *
 * This Worker has no way to deliver mail, so the usual "forgot password → check your inbox" loop cannot
 * complete for the owner's real address (the outbox deliberately stores mail only for non-registrable
 * test addresses, so that it can never be an account-takeover oracle). Changing the password while
 * still signed in is therefore the path that must always work.
 *
 * `currentPassword` is required — a live session is not enough to re-key the account — and
 * `revokeOtherSessions` defaults to TRUE, because the reason to change a password is usually that
 * another session should stop working.
 */
export const ChangePasswordRequest = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(8).max(200),
    revokeOtherSessions: z.boolean().default(true),
  })
  .strict();
export const ChangePasswordResponse = z.object({ changed: z.literal(true), revokedOtherSessions: z.boolean(), ...ServerNow });

// ─────────────────────────────────────────────────────────────────────────────
// The agent-access token — the credential behind `/mcp`
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `POST /me/api-token` — create the token, or REPLACE the one that exists.
 *
 * The password is required and the reason is the same one recorded on `change-password`: this token is a
 * standing, non-expiring, full-access credential for the whole account — strictly more powerful than the
 * browser session that is asking for it, because it bypasses Better Auth entirely. An unlocked laptop
 * must not be enough to mint one.
 *
 * A wrong password answers `422 VALIDATION_FAILED` with the same flat sentence `change-password` uses, so
 * neither endpoint can become a password oracle.
 */
export const CreateApiTokenRequest = z.object({ password: z.string().min(1).max(200) }).strict();

/**
 * What the owner can be told about a token that already exists — and the complete list of it.
 *
 * There is no `token`, no `hash`, no `prefix+suffix` reconstruction: the row stores a SHA-256 hash and
 * `last4`, so a D1 export, a backup or a `wrangler d1 execute` cannot yield a live key. `last4` exists
 * only so the owner can tell "the token my agent is using" from "some other token" without revealing one.
 */
export const ApiTokenStatusView = z.object({ createdAt: Iso, last4: z.string().length(4) });

/**
 * `GET /me/api-token` — needs no password, because it reveals nothing secret.
 *
 * `mcpUrl` is on BOTH this response and the create response deliberately: the non-secret half of an agent
 * config (the URL) is easy to forget and available nowhere else in the product, so the owner must be able
 * to recover it without replacing a working token. It is derived from the request origin, never a var —
 * the same rule `better-auth.ts` follows for `baseURL`, so localhost, `workers.dev`, versioned preview
 * URLs and `goals.rameezshuhaib.com` all answer with themselves and nothing needs configuring.
 */
export const ApiTokenStatusResponse = z.object({ token: ApiTokenStatusView.nullable(), mcpUrl: z.url(), ...ServerNow });

/** The ONE response that ever carries `plaintext`. It is never stored and never returned again. */
export const CreateApiTokenResponse = z.object({
  token: ApiTokenStatusView.extend({ plaintext: z.string() }),
  mcpUrl: z.url(),
  ...ServerNow,
});

/** `DELETE /me/api-token` — idempotent. Revoking when nothing is active succeeds. */
export const RevokeApiTokenResponse = z.object({ revoked: z.literal(true), ...ServerNow });

// ─────────────────────────────────────────────────────────────────────────────
// Goals
// ─────────────────────────────────────────────────────────────────────────────

/**
 * R-goal-1/3/4/5/6 — title is the only required content field. `parentId` is null ONLY for a Life goal;
 * every other horizon needs a parent whose horizon is strictly longer, and a Monthly parent is refused
 * outright (`HORIZON_CONFLICT`). `period` defaults from the horizon and TODAY when omitted (R-goal-13,
 * D-3), and is always `''` for a Life goal.
 */
export const CreateGoalRequest = z
  .object({
    title: Title,
    why: OneLiner.default(''),
    horizon: Horizon,
    parentId: Ulid.nullable().default(null),
    period: Period.optional(),
    pulse: Pulse.default('On track'),
  })
  .strict();

/**
 * R-goal-14 — editing changes `title`, `why`, `period` and `pulse` ONLY. `horizon` and `parentId` are
 * immutable through edit (S-goal-14-2); re-parenting is `POST /goals/:id/move` and re-scheduling is
 * `POST /goals/:id/replan`, each with its own rules. `.strict()` is what refuses them.
 */
export const PatchGoalRequest = z
  .object({
    title: Title.optional(),
    why: OneLiner.optional(),
    period: Period.optional(),
    pulse: Pulse.optional(),
    version: OptionalVersion,
  })
  .strict();

/**
 * R-goal-16/17/18 — Move changes only `parentId`; the goal's own horizon is unchanged and every
 * descendant moves with it. The target must not be the goal itself or a descendant
 * (`WOULD_CREATE_CYCLE`, checked FIRST per R-goal-19) and must have a strictly longer horizon
 * (`HORIZON_CONFLICT`). A Life goal cannot be moved at all (`LIFE_GOAL_IMMUTABLE`, R-goal-21).
 */
export const MoveGoalRequest = z.object({ parentId: Ulid, version: OptionalVersion }).strict();

/**
 * R-goal-22/23 — Re-plan sets `period` to a contextual next period and takes an OPTIONAL one-line
 * reason. Nothing is mandatory but the period. Life goals are not re-plannable (R-goal-21).
 */
export const ReplanGoalRequest = z.object({ period: Period, reason: Reason.optional(), version: OptionalVersion }).strict();

export const GoalResponse = z.object({ goal: GoalView, ...ServerNow });

// ─────────────────────────────────────────────────────────────────────────────
// The weekly plan
// ─────────────────────────────────────────────────────────────────────────────

/**
 * R-plan-7 — the whole week's focus set, saved atomically. This is `savePlan`, not a per-leaf toggle:
 * every non-Life leaf named with a non-empty sentence gets/keeps a focus, and EVERY other non-Life leaf's
 * focus for that week is removed. An entry with a blank sentence is therefore a clear (R-plan-5), and a
 * leaf absent from `entries` is cleared too.
 *
 * `weekStart` is required and must be the CURRENT week (R-plan-2): a save naming any other week is
 * refused wholesale with `409 WEEK_NOT_CURRENT`, never partially applied (S-plan-2-1, Q-3). Sending it
 * explicitly rather than defaulting to "now" is what makes a save that crossed a Monday boundary fail
 * loudly instead of writing into the wrong week.
 */
export const SavePlanRequest = z
  .object({
    weekStart: WeekStart,
    entries: z.array(z.object({ goalId: Ulid, sentence: Sentence }).strict()).max(MAX_PLAN_ENTRIES),
  })
  .strict();

export const PlanResponse = z.object({
  week: WeekView,
  entries: z.array(PlanEntryView),
  ...ServerNow,
});

// ─────────────────────────────────────────────────────────────────────────────
// Tasks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * R-task-1/3/5/6 — a task is always created in the CURRENT week (there is no back-dating, and
 * `originWeekStart` is server-assigned and immutable) under an ACTIVE non-Life leaf. The three entry
 * points (planning, a backlog pull, the + drawer) differ only in `source`, which is recorded on the
 * `created` event. `cond` (the done-condition) is optional by design.
 *
 * A `goalId` that is not an active non-Life leaf is refused: `NOT_A_LEAF` if it has children or is a Life
 * goal, `BRANCH_NOT_ACTIVE` if it holds no focus this week (R-task-4, D-10 — there is no fallback goal).
 */
export const CreateTaskRequest = z
  .object({
    goalId: Ulid,
    title: Title,
    cond: OneLiner.default(''),
    description: LongText.default(''),
    links: z.array(Url).max(MAX_LINKS).default([]),
    source: TaskSource.default('planning'),
  })
  .strict();

/** R-task-23/26 — done tasks remain editable; only the exits are withdrawn. */
export const PatchTaskRequest = z
  .object({
    title: Title.optional(),
    cond: OneLiner.optional(),
    description: LongText.optional(),
    version: OptionalVersion,
  })
  .strict();

/**
 * R-task-14 — exit 1 of 3. Any viewed week is completable, including past ones (past weeks stay fully
 * interactive), so the week is explicit. A week before the task's origin, or a future week, is refused
 * with `422 WEEK_OUT_OF_RANGE` (S-task-14-2).
 */
export const CompleteTaskRequest = z.object({ week: WeekOffset.default(0), version: OptionalVersion }).strict();

/**
 * R-task-19/21 — unchecking clears `doneWeekStart` and `doneAt`, keeps `originWeekStart`, logs
 * `Unchecked`, and the task carries into the current week under its ORIGINAL origin with the carry label
 * its real age earns. `cond` is the skippable inline "Update the done-condition?" edit; omitted, blank,
 * or unchanged is a no-op that logs nothing (S-task-21-1, S-task-21-3).
 */
export const UncheckTaskRequest = z.object({ cond: OneLiner.optional(), version: OptionalVersion }).strict();

/**
 * R-task-15 — exit 2 of 3. The task keeps its row with `status: 'movedToBacklog'` (D-15) and becomes a
 * backlog item on its OWN goal carrying title, description and links, with `fromWeekStart` = the week it
 * was live in (D-12). The reason is optional (R-task-18) and is retained on the record.
 */
export const MoveTaskToBacklogRequest = z
  .object({ week: WeekOffset.default(0), reason: Reason.optional(), version: OptionalVersion })
  .strict();

/** R-task-16 — exit 3 of 3. The reason is optional and is retained on the record (D-15). */
export const CancelTaskRequest = z.object({ reason: Reason.optional(), version: OptionalVersion }).strict();

/** R-task-24 — logs `Link added: <host>`, host = hostname minus a leading `www.`. */
export const AddTaskLinkRequest = z.object({ url: Url }).strict();

export const TaskResponse = z.object({ task: TaskDetailView, ...ServerNow });
/** The task's terminal state plus the backlog item it became, so the client can patch both caches. */
export const MoveTaskToBacklogResponse = z.object({ task: TaskDetailView, item: BacklogItemView, ...ServerNow });

// ─────────────────────────────────────────────────────────────────────────────
// Backlog
// ─────────────────────────────────────────────────────────────────────────────

/** R-backlog-2 — `goalId` must be a Yearly/Quarterly/Monthly goal; a Life goal is refused. */
export const CreateBacklogItemRequest = z
  .object({
    goalId: Ulid,
    title: Title,
    description: LongText.default(''),
    links: z.array(Url).max(MAX_LINKS).default([]),
  })
  .strict();

export const PatchBacklogItemRequest = z
  .object({
    title: Title.optional(),
    description: LongText.optional(),
    links: z.array(Url).max(MAX_LINKS).optional(),
    version: OptionalVersion,
  })
  .strict();

/** R-backlog-10 — move to any other non-Life goal. `capturedAt` and `fromWeekStart` are unchanged. */
export const MoveBacklogItemRequest = z.object({ goalId: Ulid, version: OptionalVersion }).strict();

/**
 * R-backlog-6/7/8/9 — "Add to this week", the ONLY way backlog becomes work. One atomic operation: the
 * item is marked converted with a pointer to the task it became (never deleted, never duplicated — D-19),
 * and the task logs `Created — pulled from Backlog`.
 *
 * `goalId` is the ACTIVE leaf at or under the item's goal that receives the task. It is required when
 * more than one such leaf exists: the server must not pick silently (D-18, S-backlog-7-2). With no active
 * leaf under the item's goal the call is refused with `BRANCH_NOT_ACTIVE`; a second conversion of the
 * same item is refused with `ALREADY_CONVERTED`.
 */
export const ConvertBacklogItemRequest = z
  .object({ goalId: Ulid.optional(), title: Title.optional(), cond: OneLiner.default(''), version: OptionalVersion })
  .strict();

export const BacklogItemResponse = z.object({ item: BacklogItemView, ...ServerNow });
export const ConvertBacklogItemResponse = z.object({ task: TaskDetailView, item: BacklogItemView, ...ServerNow });

// ─────────────────────────────────────────────────────────────────────────────
// Learnings — an insight that might change the plan. Never converted into work.
// ─────────────────────────────────────────────────────────────────────────────

export const CreateLearningRequest = z
  .object({ text: CaptureText, goalId: Ulid.nullable().default(null), applied: z.boolean().default(false) })
  .strict();

/** R-learning-4 / D-23 — `applied` is set by an explicit user action; the badge must be earnable. */
export const PatchLearningRequest = z
  .object({ text: CaptureText.optional(), applied: z.boolean().optional(), version: OptionalVersion })
  .strict();

/** R-learning-3 — re-tag to another Life goal, or `null` to move it back to Unsorted (S-learning-3-1). */
export const AttachLearningRequest = z.object({ goalId: Ulid.nullable(), version: OptionalVersion }).strict();

export const LearningResponse = z.object({ learning: LearningView, ...ServerNow });

export type IdParams = z.infer<typeof IdParams>;
export type TaskLinkParams = z.infer<typeof TaskLinkParams>;
export type WeekQuery = z.infer<typeof WeekQuery>;
export type TasksQuery = z.infer<typeof TasksQuery>;
export type GoalFilterQuery = z.infer<typeof GoalFilterQuery>;
export type DeleteGoalQuery = z.infer<typeof DeleteGoalQuery>;
export type DeleteResponse = z.infer<typeof DeleteResponse>;
export type DeleteGoalResponse = z.infer<typeof DeleteGoalResponse>;
export type NoQuery = z.infer<typeof NoQuery>;
export type PatchPreferencesRequest = z.infer<typeof PatchPreferencesRequest>;
export type PreferencesResponse = z.infer<typeof PreferencesResponse>;
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>;
export type ChangePasswordResponse = z.infer<typeof ChangePasswordResponse>;
export type CreateApiTokenRequest = z.infer<typeof CreateApiTokenRequest>;
export type ApiTokenStatusView = z.infer<typeof ApiTokenStatusView>;
export type ApiTokenStatusResponse = z.infer<typeof ApiTokenStatusResponse>;
export type CreateApiTokenResponse = z.infer<typeof CreateApiTokenResponse>;
export type RevokeApiTokenResponse = z.infer<typeof RevokeApiTokenResponse>;
export type CreateGoalRequest = z.infer<typeof CreateGoalRequest>;
export type PatchGoalRequest = z.infer<typeof PatchGoalRequest>;
export type MoveGoalRequest = z.infer<typeof MoveGoalRequest>;
export type ReplanGoalRequest = z.infer<typeof ReplanGoalRequest>;
export type GoalResponse = z.infer<typeof GoalResponse>;
export type SavePlanRequest = z.infer<typeof SavePlanRequest>;
export type PlanResponse = z.infer<typeof PlanResponse>;
export type CreateTaskRequest = z.infer<typeof CreateTaskRequest>;
export type PatchTaskRequest = z.infer<typeof PatchTaskRequest>;
export type CompleteTaskRequest = z.infer<typeof CompleteTaskRequest>;
export type UncheckTaskRequest = z.infer<typeof UncheckTaskRequest>;
export type MoveTaskToBacklogRequest = z.infer<typeof MoveTaskToBacklogRequest>;
export type CancelTaskRequest = z.infer<typeof CancelTaskRequest>;
export type AddTaskLinkRequest = z.infer<typeof AddTaskLinkRequest>;
export type TaskResponse = z.infer<typeof TaskResponse>;
export type MoveTaskToBacklogResponse = z.infer<typeof MoveTaskToBacklogResponse>;
export type CreateBacklogItemRequest = z.infer<typeof CreateBacklogItemRequest>;
export type PatchBacklogItemRequest = z.infer<typeof PatchBacklogItemRequest>;
export type MoveBacklogItemRequest = z.infer<typeof MoveBacklogItemRequest>;
export type ConvertBacklogItemRequest = z.infer<typeof ConvertBacklogItemRequest>;
export type BacklogItemResponse = z.infer<typeof BacklogItemResponse>;
export type ConvertBacklogItemResponse = z.infer<typeof ConvertBacklogItemResponse>;
export type CreateLearningRequest = z.infer<typeof CreateLearningRequest>;
export type PatchLearningRequest = z.infer<typeof PatchLearningRequest>;
export type AttachLearningRequest = z.infer<typeof AttachLearningRequest>;
export type LearningResponse = z.infer<typeof LearningResponse>;
