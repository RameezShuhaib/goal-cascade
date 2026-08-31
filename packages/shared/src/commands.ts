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
  MAX_PAGE,
  OneLiner,
  PeriodKey,
  PeriodKeyParam,
  PreferencesView,
  Pulse,
  Reason,
  TaskDetailView,
  TaskSource,
  Theme,
  Title,
  Ulid,
  Url,
  WeekOffset,
  WeekOffsetParam,
  WeekStart,
  isPeriodKeyFor,
} from './common';

/**
 * Request AND response schema for every write.
 *
 * Conventions, all load-bearing:
 *  - **`.strict()` on every request schema.** An unknown key is a bug — a typo, a stale client, or an
 *    attempt to write a server-owned field (SPEC §1 `[srv]`, Q-10) — not something to silently drop.
 *    ⚠ **A2** — this is what makes `period` server-owned by construction (S-goal-33-3) and what refuses a
 *    `week` on task create (S-task-40-3): neither field exists on any request schema, so sending one is a
 *    422 rather than a value quietly ignored.
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
 * `?week=` on every week-scoped read. Absent = the current week.
 *
 * ⚠ **A2 (R-lens-7)** — a POSITIVE offset is now ordinary: a future week is reachable and writable, and
 * the forward chevron is never disabled. `WeekOffset`'s bound is the absolute storage range, not a
 * product rule.
 */
export const WeekQuery = z.object({ week: WeekOffsetParam.optional() }).strict();

/**
 * `?week=` on the Weekly lens's task read. ⚠ **A2 (R-rm-4)** — the `goalId` filter is GONE: there are no
 * filter pills, no `All` chip and no goal filter of any kind in any lens (R-lens-15). Grouping by Life
 * goal is the whole answer, and it is the server's job (R-lens-3).
 */
export const TasksQuery = z.object({ week: WeekOffsetParam.optional(), limit: z.coerce.number().int().min(1).max(MAX_PAGE).optional() }).strict();

/**
 * ⚠ **A2, new (R-lens-16, R-lens-27)** — the scoped lens read that replaces the whole-tree `GET /goals`.
 *
 * One horizon and one period, paginated. `period` is omitted for the **Life** lens, which has no period
 * dimension and is bounded by the number of Life goals; for every other lens an absent or unparseable
 * period falls back to the CURRENT one rather than erroring (R-lens-14, S-lens-14-1).
 *
 * `cursor` is the opaque `<createdAt>|<id>` of the last row of the previous page — the same total order
 * every sibling list uses (Q-7), served straight off `ix_goals_lens` with no filesort.
 */
export const LensQuery = z
  .object({
    lens: Horizon.default('Weekly'),
    period: PeriodKeyParam.optional(),
    cursor: z.string().max(64).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE).optional(),
  })
  .strict();

/** `?anchor=` on the Zoom sheet's count read (R-lens-22). Absent = the server's today. */
export const ZoomQuery = z.object({ anchor: z.iso.date().optional() }).strict();

/** `?goalId=` narrows the backlog to one goal; `?limit=` pages it (`MAX_PAGE`). */
export const BacklogQuery = z
  .object({ goalId: Ulid.optional(), limit: z.coerce.number().int().min(1).max(MAX_PAGE).optional() })
  .strict();

/**
 * Q-5 — deletion cascades the WHOLE subtree (tasks, task events, backlog items) in one transaction;
 * Learning tags pointing into it null out to Unsorted rather than cascading. There is no soft-delete and
 * no trash.
 *
 * `cascade` is the explicit acknowledgement of that: without it, deleting a goal that has children is
 * refused with `409 GOAL_HAS_CHILDREN` whose `details` carry the counts, which is exactly what the
 * client needs to render the required "N sub-goals, M tasks, K backlog items" confirmation. A childless
 * goal needs no acknowledgement.
 *
 * ⚠ **A2 (R-task-47)** — the cascade already covered the new level, because it is defined over the
 * subtree and not over a fixed depth; what changed is that deleting a Monthly goal now takes its Weekly
 * children and all of their tasks, so the counts can be large and the confirmation matters more.
 *
 * `dryRun=true` computes exactly what the delete WOULD remove and writes nothing, answering with the
 * same `DeleteGoalResponse` shape and `deleted: false`. It ignores `cascade` — a preview is never
 * refused — and, unlike the live delete's `GOAL_HAS_CHILDREN` guard, it emits counts for childless goals
 * too. That is the whole point: a Weekly goal carrying forty open tasks is the delete with no warning.
 */
export const DeleteGoalQuery = z.object({ cascade: z.stringbool().optional(), dryRun: z.stringbool().optional() }).strict();

const OptionalVersion = z.int().positive().optional();

/** Every command answers with the server's clock so the client can agree on "now" without guessing. */
const ServerNow = { serverNow: Iso };

export const DeleteResponse = z.object({ deleted: z.boolean(), ...ServerNow });

/**
 * Q-5 — the counts the cascade actually removed, so the client can confirm what happened.
 *
 * ⚠ **A2** — `weeklyFocuses` is gone with the entity (R-rm-2) and `weeklyGoals` replaces it: the number
 * that now matters is how many WEEKS of intention a delete takes with it (R-task-47, R-goal-46). It is a
 * summary and must never become a list.
 */
export const DeleteGoalResponse = z.object({
  deleted: z.boolean(),
  removed: z.object({
    goals: z.int().nonnegative(),
    /** Of `goals`, how many were Weekly. Reported separately because it is the number that can be large. */
    weeklyGoals: z.int().nonnegative(),
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

/**
 * A read that takes no query parameters at all. Named and `.strict()` rather than simply omitted, so an
 * unknown or misremembered param (`?goalId=…` on a list that does not filter) is a 422 instead of being
 * accepted and quietly ignored — the same rule every other list route already follows.
 */
export const NoQuery = z.object({}).strict();

/** R-nav-12 — the theme is a real per-user preference, persisted across sessions (D-25). */
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
 * R-goal-33 — a `periodKey` is refused unless it is the canonical shape for the horizon it is being
 * written against: `2026-Q5`, `2026-13` and a Weekly key that is not a Monday are validation failures
 * (S-goal-33-2). The refinement lives here rather than in a handler so both sides enforce it.
 */
function refinePeriodKey<T extends { horizon?: Horizon; periodKey?: string }>(
  schema: z.ZodType<T>,
  horizonOf: (v: T) => Horizon | undefined,
): z.ZodType<T> {
  return schema.superRefine((v, ctx) => {
    const horizon = horizonOf(v);
    if (v.periodKey === undefined || horizon === undefined) return;
    if (!isPeriodKeyFor(horizon, v.periodKey)) {
      ctx.addIssue({
        code: 'custom',
        path: ['periodKey'],
        message: `not a valid periodKey for a ${horizon} goal`,
      });
    }
  }) as unknown as z.ZodType<T>;
}

/**
 * R-goal-1/3/4/5/30/31/32/33/36 — title is the only required content field.
 *
 * `parentId` is null ONLY for a Life goal; every other horizon needs a parent whose horizon is strictly
 * longer. ⚠ **A2** — the terminal horizon moved: a **Weekly** parent is now refused outright
 * (`HORIZON_CONFLICT`), and a **Monthly** parent is legal, which is the exact request the old rule
 * required to be refused (S-goal-31-2). Levels may be skipped, so a Weekly goal may hang off a Life,
 * Yearly, Quarterly or Monthly goal (R-goal-32, S-goal-32-1).
 *
 * `periodKey` defaults from the horizon and the owner's TODAY when omitted (R-goal-33, D-3), and is
 * always `''` for a Life goal. A key naming a period earlier than the current one for its horizon is
 * refused with `PERIOD_IN_PAST` (R-goal-36); there is **no forward bound at any horizon**.
 *
 * There is no `period` field. It is server-derived (R-goal-33) and `.strict()` is what says so.
 */
export const CreateGoalRequest = refinePeriodKey(
  z
    .object({
      title: Title,
      why: OneLiner.default(''),
      horizon: Horizon,
      parentId: Ulid.nullable().default(null),
      periodKey: PeriodKey.optional(),
      pulse: Pulse.default('On track'),
    })
    .strict(),
  (v) => v.horizon,
);

/**
 * R-goal-14 / R-goal-36 / R-goal-40 — editing changes `title`, `why`, `periodKey` and `pulse` ONLY.
 * `horizon` and `parentId` are immutable through edit (S-goal-14-2); re-parenting is
 * `POST /goals/:id/move` and re-scheduling is `POST /goals/:id/replan`. `.strict()` is what refuses them.
 *
 * ⚠ **A2 (R-goal-40) — a `periodKey` patch on a WEEKLY goal is refused outright.** A Weekly goal *is* a
 * week; moving it would silently restate what a past week contained, which is D-2, the defect that made
 * focus per-week in the first place. The refusal is in the SERVICE and not here, because this schema does
 * not know the target's horizon — see `GoalService.patch` (S-goal-40-2).
 */
export const PatchGoalRequest = z
  .object({
    title: Title.optional(),
    why: OneLiner.optional(),
    periodKey: PeriodKey.optional(),
    pulse: Pulse.optional(),
    version: OptionalVersion,
  })
  .strict();

/**
 * R-goal-16/17/18 — Move changes only `parentId`; the goal's own horizon is unchanged and every
 * descendant moves with it. The target must not be the goal itself or a descendant
 * (`WOULD_CREATE_CYCLE`, checked FIRST per R-goal-19) and must have a strictly longer horizon
 * (`HORIZON_CONFLICT`). A Life goal cannot be moved at all (`LIFE_GOAL_IMMUTABLE`, R-goal-21).
 *
 * ⚠ **A2 (R-goal-40, SPEC Q-24)** — Move REMAINS available on a Weekly goal, and it may never change
 * that goal's `periodKey`. There is no `periodKey` field on this request and the service does not write
 * one; see the guard in `GoalService.move` for why crossing weeks breaks nothing in the data and
 * everything in the lens.
 */
export const MoveGoalRequest = z.object({ parentId: Ulid, version: OptionalVersion }).strict();

/**
 * R-goal-40 — Re-plan sets `periodKey` to a contextual next period of the goal's OWN horizon and takes an
 * OPTIONAL one-line reason. Nothing is mandatory but the period.
 *
 * Neither a **Life** goal (R-goal-21) nor a **Weekly** goal (R-goal-40) is re-plannable, for opposite
 * reasons: a Life goal has no period at all, and a Weekly goal's period is immutable after creation.
 */
export const ReplanGoalRequest = z.object({ periodKey: PeriodKey, reason: Reason.optional(), version: OptionalVersion }).strict();

/**
 * ⚠ **A2, new (R-goal-46)** — `Repeat last week`: copies the previous week's Weekly goals **for one Life
 * line** into `weekStart` as ORDINARY new goals — `title`, `why` and `parentId` carried over, `pulse`
 * reset to `On track`, `periodKey` set to the target week, new ids, **no tasks copied**, and nothing
 * linking a copy to its source.
 *
 * This is deliberately not a recurrence feature: no template entity, no series id, no materialisation
 * job, and no edit-this-one-versus-all-future decision. A repeating intention costs one tap per week and
 * produces ordinary rows.
 *
 * Per Life line, not account-wide (Q-22): account-wide creates twenty goals in one tap with no review.
 * It is offered only on the current week or a later one — a past week is `PERIOD_IN_PAST` (R-goal-36).
 */
export const RepeatWeekRequest = z.object({ lifeGoalId: Ulid, weekStart: WeekStart }).strict();

export const GoalResponse = z.object({ goal: GoalView, ...ServerNow });

// ─────────────────────────────────────────────────────────────────────────────
// Tasks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ **A2, new (R-task-48)** — the inline weekly-goal half of a one-step create.
 *
 * Creating a task presupposes a Weekly goal, and the common case is "I need to do this, this week".
 * Structurally that is two creates; made literal it is the worst flow in the product. So the task-create
 * sheet, when no Weekly goal exists for the target week under the chosen parent, creates one in the SAME
 * sheet and the save writes both rows **in one transaction** — a failure creates neither (S-task-48-2).
 *
 * `title` is PRE-FILLED from the chosen parent and the sheet states what will happen before you save
 * (R-task-49): nothing may be created invisibly.
 */
export const NewWeeklyGoalInput = z.object({ parentId: Ulid, title: Title }).strict();

/**
 * R-task-3/39/40/41/48 — a task is created **under a Weekly goal**, and under nothing else.
 *
 * ⚠ **A2 — there is NO week field on this request, at all.** `originWeekStart` is seeded once from the
 * Weekly parent's `periodKey` and is immutable thereafter (R-task-40); a request carrying `week`,
 * `weekOffset` or `originWeek` is refused as an unknown key by `.strict()` (S-task-40-3). Nothing derives
 * a task's week by reading its goal at read time either — deleting the goal row from a query result must
 * not change any task's week.
 *
 * Exactly ONE of `goalId` (an existing Weekly goal) or `newWeeklyGoal` must be given; both, or neither,
 * is refused (S-task-48-3). There is no goal-less task, no implicit inbox and no nullable `goalId`.
 *
 * A `goalId` naming any non-Weekly goal — including a **Monthly goal with no children**, which is a leaf
 * by the structural definition and is precisely the trap — is refused with `NOT_A_WEEKLY_GOAL`
 * (R-goal-39, S-goal-37-1). A Weekly goal whose week is in the PAST is refused with `PERIOD_IN_PAST`
 * (R-task-41): there is no back-dating. Creating forward is unbounded.
 */
export const CreateTaskRequest = z
  .object({
    goalId: Ulid.optional(),
    newWeeklyGoal: NewWeeklyGoalInput.optional(),
    title: Title,
    cond: OneLiner.default(''),
    description: LongText.default(''),
    links: z.array(Url).max(MAX_LINKS).default([]),
    source: TaskSource.default('goal'),
  })
  .strict()
  .refine(
    (v) => (v.goalId === undefined) !== (v.newWeeklyGoal === undefined),
    'exactly one of goalId or newWeeklyGoal is required',
  );

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
 * R-task-14/44 — exit 1 of 3. Any week that has BEGUN is completable, including past ones (past weeks
 * stay fully interactive), so the week is explicit.
 *
 * ⚠ **A2 (R-rm-3, R-task-44) — the `.max(0)` on this line is NEW and load-bearing.** It used to be
 * inherited from `WeekOffset`, which no longer carries one; widening that schema would have removed this
 * guard **with no diff on this line at all**. You cannot finish work in a week that has not happened, and
 * the bound is now reachable at any distance because there is no forward cap anywhere else.
 *
 * A week before the task's own origin is refused with `422 WEEK_OUT_OF_RANGE` (S-task-14-2). A task under
 * a FUTURE Weekly goal therefore cannot be completed at all until that week arrives — no week satisfies
 * both bounds — and its row renders no checkbox (S-task-44-1).
 */
export const CompleteTaskRequest = z.object({ week: WeekOffset.max(0).default(0), version: OptionalVersion }).strict();

/**
 * R-task-19/21 — unchecking clears `doneWeekStart` and `doneAt`, keeps `originWeekStart`, logs
 * `Unchecked`, and the task carries into the current week under its ORIGINAL origin with the carry label
 * its real age earns. `cond` is the skippable inline "Update the done-condition?" edit; omitted, blank,
 * or unchanged is a no-op that logs nothing (S-task-21-1, S-task-21-3).
 */
export const UncheckTaskRequest = z.object({ cond: OneLiner.optional(), version: OptionalVersion }).strict();

/**
 * R-task-15/36 / R-backlog-29 — exit 2 of 3. The task keeps its row with `status: 'movedToBacklog'`
 * (D-15) and becomes a backlog item carrying title, description and links, with `fromWeekStart` = the
 * week it was live in (D-12). The reason is optional (R-task-18) and is retained on the record.
 *
 * ⚠ **A2 (R-backlog-29) — the item does NOT land on the task's own goal any more.** That goal is now a
 * Weekly goal, which may hold no backlog items (R-backlog-2): "move to backlog" means *not this week*, so
 * the item must leave the week, and a Weekly goal IS a week. It lands on the nearest **non-Weekly
 * ancestor**, normally the Monthly parent. A Weekly goal whose only ancestor is a Life goal has no legal
 * target and the exit is refused with `LIFE_GOAL_NO_BACKLOG` (S-backlog-29-2).
 *
 * The week may be a future one (R-task-36): changing your mind about next week is not a fourth exit.
 */
export const MoveTaskToBacklogRequest = z
  .object({ week: WeekOffset.default(0), reason: Reason.optional(), version: OptionalVersion })
  .strict();

/** R-task-16 — exit 3 of 3. The reason is optional and is retained on the record (D-15). */
export const CancelTaskRequest = z.object({ reason: Reason.optional(), version: OptionalVersion }).strict();

/** R-task-24 — logs `Link added: <host>`, host = hostname minus a leading `www.`. */
export const AddTaskLinkRequest = z.object({ url: Url }).strict();

export const TaskResponse = z.object({ task: TaskDetailView, ...ServerNow });
/**
 * The created task plus the Weekly goal that was created for it, when one was (R-task-48). `goal` is
 * null on the ordinary path; when it is not, the client must say so — nothing may be created invisibly
 * (R-task-49) — and move the Weekly lens to that week (R-task-41, S-task-41-3).
 */
export const CreateTaskResponse = z.object({ task: TaskDetailView, goal: GoalView.nullable(), ...ServerNow });
/** The task's terminal state plus the backlog item it became, so the client can patch both caches. */
export const MoveTaskToBacklogResponse = z.object({ task: TaskDetailView, item: BacklogItemView, ...ServerNow });

// ─────────────────────────────────────────────────────────────────────────────
// Backlog
// ─────────────────────────────────────────────────────────────────────────────

/**
 * R-backlog-2/26 — `goalId` must be a Yearly/Quarterly/Monthly goal. A **Life** goal is refused
 * (`LIFE_GOAL_NO_BACKLOG`) and so is a **Weekly** goal: a backlog item is deferred work with no week, and
 * a Weekly goal would give it one (S-backlog-26-4).
 */
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

/** R-backlog-10 — move to any other non-Life, non-Weekly goal. `capturedAt`/`fromWeekStart` unchanged. */
export const MoveBacklogItemRequest = z.object({ goalId: Ulid, version: OptionalVersion }).strict();

/**
 * R-backlog-6/9/26, Q-4, D-18, D-19 — "Add to this week", the ONLY way backlog becomes work. One atomic
 * operation: the item is marked converted with a pointer to the task it became (never deleted, never
 * duplicated — D-19), and the task logs `Created — pulled from Backlog`.
 *
 * ⚠ **A2 (R-backlog-26)** — the receiving goal is the **Weekly goal at or under the item's goal whose
 * `periodKey` is the target week**, not an "active leaf". `week` names that target and may not be in the
 * past (R-goal-36); it defaults to the current week.
 *
 * Exactly one candidate → used silently. Two or more → `AMBIGUOUS_CONVERSION_TARGET` with
 * `details.candidates`, and the owner chooses: the server refuses to pick, because that id decides which
 * week the task belongs to for the rest of its life and array order is not a decision. **None** →
 * `NO_WEEKLY_GOAL`, and the client offers `newWeeklyGoal` rather than sending the owner away (R-task-48).
 * A second conversion of the same item is refused with `ALREADY_CONVERTED`.
 */
export const ConvertBacklogItemRequest = z
  .object({
    goalId: Ulid.optional(),
    newWeeklyGoal: NewWeeklyGoalInput.optional(),
    week: WeekOffset.min(0).default(0),
    title: Title.optional(),
    cond: OneLiner.default(''),
    version: OptionalVersion,
  })
  .strict()
  .refine((v) => !(v.goalId !== undefined && v.newWeeklyGoal !== undefined), 'goalId and newWeeklyGoal are mutually exclusive');

export const BacklogItemResponse = z.object({ item: BacklogItemView, ...ServerNow });
export const ConvertBacklogItemResponse = z.object({
  task: TaskDetailView,
  item: BacklogItemView,
  /** The Weekly goal created for this conversion, when one was (R-task-48). Null on the ordinary path. */
  goal: GoalView.nullable(),
  ...ServerNow,
});

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
export type LensQuery = z.infer<typeof LensQuery>;
export type ZoomQuery = z.infer<typeof ZoomQuery>;
export type BacklogQuery = z.infer<typeof BacklogQuery>;
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
export type RepeatWeekRequest = z.infer<typeof RepeatWeekRequest>;
export type GoalResponse = z.infer<typeof GoalResponse>;
export type NewWeeklyGoalInput = z.infer<typeof NewWeeklyGoalInput>;
export type CreateTaskRequest = z.infer<typeof CreateTaskRequest>;
export type PatchTaskRequest = z.infer<typeof PatchTaskRequest>;
export type CompleteTaskRequest = z.infer<typeof CompleteTaskRequest>;
export type UncheckTaskRequest = z.infer<typeof UncheckTaskRequest>;
export type MoveTaskToBacklogRequest = z.infer<typeof MoveTaskToBacklogRequest>;
export type CancelTaskRequest = z.infer<typeof CancelTaskRequest>;
export type AddTaskLinkRequest = z.infer<typeof AddTaskLinkRequest>;
export type TaskResponse = z.infer<typeof TaskResponse>;
export type CreateTaskResponse = z.infer<typeof CreateTaskResponse>;
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
