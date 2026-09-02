import { z } from 'zod';
import {
  BacklogItemView,
  CaptureText,
  MeasureKind,
  MeasureNumber,
  MeasureUnit,
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
/** ⚠ **A8** — path params for `DELETE /tasks/:id/readings/:readingId` (R-measure-5). */
export const TaskReadingParams = z.object({ id: Ulid, readingId: Ulid }).strict();

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
 * `?limit=` pages the learnings list (`MAX_PAGE`).
 *
 * ⚠ **A2 (Q-12)** — learnings were the one list endpoint the page cap never reached: `GET /learnings`
 * answered with an unbounded `SELECT`, so an account at Q-12's own 5,000-learning ceiling put 5,000 rows
 * in one response. Q-12 says *every* list endpoint is capped, and this is the endpoint that made that
 * false. Same shape as `BacklogQuery` on purpose — a list route that pages differently from its
 * neighbours is a list route someone gets wrong.
 */
export const LearningsQuery = z.object({ limit: z.coerce.number().int().min(1).max(MAX_PAGE).optional() }).strict();

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
 * **R-goal-46** — `Repeat last week`: copies the previous week's Weekly goals into `weekStart` as ORDINARY
 * new goals — `title`, `why` and `parentId` carried over, `pulse` reset to `On track`, `periodKey` set to
 * the target week, new ids, **no tasks copied**, and nothing linking a copy to its source.
 *
 * This is deliberately not a recurrence feature: no template entity, no series id, no materialisation
 * job, and no edit-this-one-versus-all-future decision. A repeating intention costs one tap per week and
 * produces ordinary rows.
 *
 * ⚠ **`lifeGoalId` is OPTIONAL, and absent means every Life line** (R-goal-46, amended). Q-22 required it
 * per line because the control lived at a group foot; there are no group feet (R-lens-3, deleted), so the
 * honest flat version is one link at the foot of the Weekly list copying the whole week. A per-line
 * variant would need a per-line row, which is a group header by another name. When it IS supplied the
 * behaviour is unchanged, byte for byte — the MCP tool still names a line, and so does any caller that
 * has one.
 *
 * It is offered only on the current week or a later one — a past week is `PERIOD_IN_PAST` (R-goal-36).
 */
export const RepeatWeekRequest = z.object({ lifeGoalId: Ulid.optional(), weekStart: WeekStart }).strict();

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
 * ⚠ **A8, new (R-measure-1, R-measure-2, Q-E)** — the measure half of a create, and the whole body of
 * `PUT /tasks/:id/measure`.
 *
 * `current` is **absent by construction**: it is derived from the readings (R-measure-3) and there is no
 * field here to supply it in, which is what makes S-measure-3-3's "any request supplying `current` is
 * refused" true through `.strict()` rather than through a handler remembering to drop it.
 *
 * `target` is **optional and nullable, and the two mean the same thing** — no target, the AMRAP case
 * (R-measure-4). `target === start` is refused with `MEASURE_TARGET_EQUALS_START` (422) here, at the
 * edge, because it names no movement and "maintain" is out of scope (S-measure-4-3).
 *
 * There is **no direction field** and there must never be one: `target > start` counts up, `target <
 * start` counts down, and a flag would restate what the two numbers already say (R-measure-2,
 * S-measure-2-1).
 */
export const MeasureInput = z
  .object({
    kind: MeasureKind,
    start: MeasureNumber.default(0),
    target: MeasureNumber.nullable().default(null),
    unit: MeasureUnit.default(''),
  })
  .strict()
  .refine((v) => v.target === null || v.target !== v.start, {
    error: 'MEASURE_TARGET_EQUALS_START',
    path: ['target'],
  });

/**
 * R-task-3/41/48 / **R-task-51/52/57** — a task is created under a **Monthly or a Weekly goal**, and
 * under nothing else.
 *
 * ⚠ **A2/A8 — there is still no `week`, `weekOffset`, `originWeek`, `originPeriodKey` or `scope` field on
 * this request** (S-task-52-2): every one of them is refused as an unknown key by `.strict()`. `scope` and
 * `originPeriodKey` are seeded server-side and are immutable except through Park (R-task-52, R-task-56).
 * Nothing derives a task's period by reading its goal at read time either — deleting the goal row from a
 * query result must not change any task's period or scope.
 *
 * ⚠ **A8 + A11 (`32-week-selection` §8.3) — `period` is the ONE field that names the destination, and it
 * is a `periodKey` at either scope.** The month key and a week key are the same field, not two, and the
 * key's **format is the discriminator** — which is R-task-52's model exactly. The resolution table, in
 * full:
 *
 * | `goalId`'s horizon | `period` | Result |
 * |---|---|---|
 * | Weekly | absent, or `= goal.periodKey` | a **week** task on that goal — today's behaviour, unchanged |
 * | Monthly | absent, or `= goal.periodKey` (a month) | a **month** task on that goal. One row, no inference, no created goal, and the lens does not move (R-task-57) |
 * | Monthly | a Monday | the `Add to this week` path for a fresh task: the Weekly goal at or under that Monthly goal for that week. Exactly one → used; ≥ 2 → `AMBIGUOUS_CONVERSION_TARGET`; none → `NO_WEEKLY_GOAL`, and the client re-sends with `newWeeklyGoal` (R-backlog-31, R-task-48) |
 * | — (`newWeeklyGoal`) | a Monday | the Weekly goal is minted **for that week** under `parentId`, atomically with the task |
 * | — (`newWeeklyGoal`) | absent | minted for the CURRENT week — the `+` drawer's `Add to this week instead` (R-backlog-27), unchanged |
 * | Life / Yearly / Quarterly | any | `NOT_A_TASK_GOAL` (409) |
 *
 * Any other combination — a month key against a Weekly goal, a month key that is not the goal's own, a
 * year or quarter key, a month key with `newWeeklyGoal` — is `VALIDATION_FAILED` (422). A period that is
 * **past** at its own scope is `PERIOD_IN_PAST` (R-goal-36, R-task-41, R-task-57): there is no
 * back-dating at either scope, and creating forward is unbounded at both.
 *
 * **A control the owner drives is not an inference.** R-task-57's "nothing is inferred" holds because the
 * zero-decision path — `period` omitted on a Monthly goal — is the zero-inference one: one row, on the
 * goal you tapped, in the month you are looking at. A week is an explicit narrowing the owner asked for.
 *
 * Exactly ONE of `goalId` or `newWeeklyGoal` (S-task-48-3). There is no goal-less task, no implicit inbox
 * and no nullable `goalId`.
 */
export const CreateTaskRequest = z
  .object({
    goalId: Ulid.optional(),
    newWeeklyGoal: NewWeeklyGoalInput.optional(),
    /** ⚠ **A8/A11, new** — the destination period. See the table above. */
    period: PeriodKeyParam.optional(),
    title: Title,
    cond: OneLiner.default(''),
    description: LongText.default(''),
    links: z.array(Url).max(MAX_LINKS).default([]),
    source: TaskSource.default('goal'),
    /**
     * ⚠ **A8, new (Q-E)** — a measure may be attached AT CREATE, in one command. A separate second step
     * for "reach 15 leads" is the two-step friction this amendment exists to remove, one layer down.
     */
    measure: MeasureInput.optional(),
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
 * R-task-14/44 — exit 1 of 3. Any period that has BEGUN is completable, including past ones (past periods
 * stay fully interactive), so the period is explicit.
 *
 * ⚠ **A8 (R-task-55) — `week: WeekOffset.max(0)` became `period`, an explicit canonical key.** An offset
 * cannot express *"the period I am standing in"* once a task may be scoped to a month: on Wed 2 Sep 2026
 * the current week belongs to **August** while the current month is September, so "offset 0" has two
 * different answers and the client is the only one that knows which surface it is on (S-task-55-2). The
 * `.max(0)` it used to carry becomes `period <= currentPeriod(scope)`, re-stated in the service against
 * the resolved key — the same bound, moved to where the scope is known.
 *
 * A period before the task's own origin is refused with `422 WEEK_OUT_OF_RANGE` (S-task-14-2, the code is
 * unchanged and is now scope-agnostic). A task under a FUTURE goal therefore cannot be completed at all
 * until that period arrives — no period satisfies both bounds — and its row renders no checkbox
 * (S-task-44-1, S-task-55-1).
 */
export const CompleteTaskRequest = z.object({ period: PeriodKeyParam, version: OptionalVersion }).strict();

/**
 * R-task-19/21 — unchecking clears `donePeriodKey` and `doneAt`, keeps `originPeriodKey`, logs
 * `Unchecked`, and the task carries into the current week under its ORIGINAL origin with the carry label
 * its real age earns. `cond` is the skippable inline "Update the done-condition?" edit; omitted, blank,
 * or unchanged is a no-op that logs nothing (S-task-21-1, S-task-21-3).
 */
export const UncheckTaskRequest = z.object({ cond: OneLiner.optional(), version: OptionalVersion }).strict();

/**
 * R-task-15/36 / R-backlog-29 — exit 2 of 3. The task keeps its row with `status: 'movedToBacklog'`
 * (D-15) and becomes a backlog item carrying title, description and links, with `fromPeriodKey` = the
 * week it was live in (D-12). The reason is optional (R-task-18) and is retained on the record.
 *
 * ⚠ **A2 (R-backlog-29) — the item does NOT land on the task's own goal any more.** That goal is now a
 * Weekly goal, which may hold no backlog items (R-backlog-2): "move to backlog" means *not this week*, so
 * the item must leave the week, and a Weekly goal IS a week. It lands on the nearest **non-Weekly
 * ancestor**, normally the Monthly parent. A Weekly goal whose only ancestor is a Life goal has no legal
 * target and the exit is refused with `LIFE_GOAL_NO_BACKLOG` (S-backlog-29-2).
 *
 * The period may be a future one (R-task-36): changing your mind about next week is not a fourth exit.
 *
 * ⚠ **A8 (R-task-55)** — `week: WeekOffset` became `period`, for the same reason `CompleteTaskRequest`'s
 * did: the client names the period it is standing in, because an offset cannot say which scope it means.
 */
export const MoveTaskToBacklogRequest = z
  .object({ period: PeriodKeyParam, reason: Reason.optional(), version: OptionalVersion })
  .strict();

/** R-task-16 — exit 3 of 3. The reason is optional and is retained on the record (D-15). */
export const CancelTaskRequest = z.object({ reason: Reason.optional(), version: OptionalVersion }).strict();

/**
 * ⚠ **A8, new (R-task-56)** — **Park in a week / Move to the month: the ONE operation that rewrites a
 * task's scope, and it is NOT a fourth exit.**
 *
 * An exit takes work *out* of a period (R-task-13, unchanged, still exactly three). Parking moves it
 * between two periods it was already committed to: the task is still open, still visible and still yours
 * to finish. No route, tool or screen anywhere is named `defer`, `snooze`, `reschedule` or
 * `move to another week` (S-task-56-4).
 *
 * **It sets `goalId`, `originPeriodKey` and `scope` together**, because a task's period is always its
 * goal's period *at creation* and this is a re-creation of that fact by an explicit write. **Nothing else
 * changes** — title, done-condition, description, links, the timeline and **every reading** are untouched
 * (R-measure-5, S-task-56-1). It is **reversible on purpose**: a one-way narrowing makes a mis-tap
 * unfixable and pushes people to cancel-and-retype, which loses the readings, the links and the history.
 *
 * ⚠ **A11 (`32-week-selection` §5.4)** — Park's target shares `CreateTaskRequest.period`'s shape exactly:
 * **one field, a `periodKey`, whose format is the discriminator.** The web control is the same component,
 * over the same option list, and there is not a second week chooser.
 *
 * | Task's scope | `period` | Result |
 * |---|---|---|
 * | Monthly | a Monday | **park**: the Weekly goal at or under the task's own Monthly goal for that week. One → used; ≥ 2 → `AMBIGUOUS_CONVERSION_TARGET` with its candidate list; none → `NO_WEEKLY_GOAL`, and the client re-sends with `newWeeklyGoal` (R-task-48, which is why it survives A8) |
 * | Weekly | a month key | **un-park**: the Weekly goal's **nearest Monthly ancestor**, at that goal's month. The key must equal it. A Weekly goal with no Monthly ancestor (R-goal-32 permits it) has no target: `HORIZON_CONFLICT`, and the action is not rendered |
 * | either | the period it is already in | an idempotent **no-op** that writes no event |
 * | Weekly | a different Monday | refused — that would be the reschedule R-task-13 does not have |
 * | Monthly | a different month | refused, same reason |
 *
 * **Bounds.** The target may not be in the past (`PERIOD_IN_PAST`) — parking is planning. Parking a
 * **done** or **exited** task is refused (`TASK_ALREADY_EXITED`).
 *
 * `originPeriodKey` is therefore immutable against everything except this one named operation, which is
 * the narrowest possible weakening of R-task-40: D-1's failure mode is a period that changes *without a
 * write*, and this is a write — confirmed, logged and reversible.
 */
export const RetargetTaskRequest = z
  .object({
    /** The destination period. A Monday parks; a month key un-parks. */
    period: PeriodKeyParam,
    /** Disambiguates when two or more Weekly goals qualify. Park only. */
    goalId: Ulid.optional(),
    /** R-task-48's inline create, when none qualifies. Park only. */
    newWeeklyGoal: NewWeeklyGoalInput.optional(),
    version: OptionalVersion,
  })
  .strict()
  .refine(
    (v) => !(v.goalId !== undefined && v.newWeeklyGoal !== undefined),
    'goalId and newWeeklyGoal are mutually exclusive',
  );

/**
 * ⚠ **A8, new (R-measure-1)** — `PUT /tasks/:id/measure`: attach a measure, or replace the one that is
 * there.
 *
 * It is **its own command and not a field on `PatchTaskRequest`**, so its events are unambiguous: a
 * measure's shape is timeline material (`Measure added` / `Measure edited`) and a title edit is not the
 * place to decide which one happened. `PatchTaskRequest` is deliberately unchanged.
 *
 * Editing a measure never touches its readings. `DELETE /tasks/:id/measure` removes the measure **and all
 * of its readings** in one transaction, which is why the client confirms it naming the count
 * (`This deletes 14 recorded values.` — R-measure-1, Q-5's discipline).
 */
export const SetMeasureRequest = z.object({ measure: MeasureInput, version: OptionalVersion }).strict();

/**
 * ⚠ **A8, new (R-measure-3)** — `POST /tasks/:id/readings`: record one value.
 *
 * **Exactly one of `value` or `delta`**, and the asymmetry between them is deliberate:
 *
 *  - a `delta` against a **gauge** is refused with `MEASURE_KIND_MISMATCH` (422) — a gauge is set, not
 *    added to;
 *  - an absolute `value` against a **counter** is **accepted**, because correcting a counter to where it
 *    actually is ("I'm at 12") is legitimate, and a counter is a gauge you usually bump (S-measure-3-3).
 *
 * Either way **what is STORED is the absolute value** of the measure after this reading (R-measure-3):
 * `delta` is resolved against `current` by the server before it is written. That is what makes deletion
 * correct with one rule instead of two — had a counter stored deltas and a gauge absolutes, `current`
 * would be computed two ways and the owner's own mistyped-240 example would resolve differently depending
 * on which kind it was typed into.
 *
 * A reading against a task with **no measure** is `NO_MEASURE` (409). A task at `MAX_READINGS` is
 * `VALIDATION_FAILED` naming the cap (Q-26). **No timeline entry is written, ever** (R-measure-7).
 */
export const RecordReadingRequest = z
  .object({
    value: MeasureNumber.optional(),
    delta: MeasureNumber.optional(),
    /** When it was recorded. Defaults to the server's `now`; back-dating a reading is legitimate. */
    at: Iso.optional(),
    version: OptionalVersion,
  })
  .strict()
  .refine((v) => (v.value === undefined) !== (v.delta === undefined), 'exactly one of value or delta is required');

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
/**
 * ⚠ **A8, new (R-task-56)** — the retargeted task, plus the Weekly goal a park minted, when it minted
 * one (R-task-48). `goal` is null on every other path, including every un-park.
 *
 * The task's new `goalId`, `scope` and `originPeriodKey` are on `task`; the client patches its caches from
 * that and does not re-derive where the row moved to.
 */
export const RetargetTaskResponse = z.object({ task: TaskDetailView, goal: GoalView.nullable(), ...ServerNow });

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

/**
 * R-backlog-10 — move to any other non-Life, non-Weekly goal. `capturedAt`/`fromPeriodKey` unchanged.
 *
 * ⚠ **A1 (R-backlog-20)** — the item also gets a **fresh `sortKey` at the top of the destination's list**.
 * Its old position is not preserved and there is no field here to preserve it with: manual order is per
 * goal (R-backlog-21), so a position in the goal it left means nothing in the goal it joined.
 */
export const MoveBacklogItemRequest = z.object({ goalId: Ulid, version: OptionalVersion }).strict();

/**
 * ⚠ **A1, new (R-backlog-19)** — **reorder is a RELATIVE MOVE, and never a position index.**
 *
 * Exactly one of `after`, `before` or `to` — the item goes immediately after a named neighbour,
 * immediately before one, or to the top/bottom of its own goal's list. The server mints a key strictly
 * between the two neighbours the move implies; a client never sees, parses or sends a key.
 *
 * **Why relative and not `{ position: 3 }`.** An index is a statement about the whole list, so it is wrong
 * the moment anything else in that list moved — and on a phone, where the other device is the same
 * person's laptop, that is a normal Tuesday. A neighbour id is a statement about two rows, and it either
 * still means what it meant or it is refused. It is also what lets drag and the keyboard share one code
 * path (R-backlog-24): both end up naming the row they landed next to.
 *
 * Refused, with the order unchanged: a neighbour in another goal, a converted neighbour, a neighbour that
 * does not exist, the item as its own neighbour, and a stale `version` (`CONCURRENT_UPDATE`, Q-2).
 */
export const ReorderBacklogItemRequest = z
  .object({
    after: Ulid.optional(),
    before: Ulid.optional(),
    to: z.enum(['top', 'bottom']).optional(),
    version: OptionalVersion,
  })
  .strict()
  .refine(
    (v) => [v.after, v.before, v.to].filter((x) => x !== undefined).length === 1,
    'name exactly one of after, before or to',
  );

/**
 * R-backlog-6/9/26, Q-4, D-18, D-19 — "Add to this week", the ONLY way backlog becomes work. One atomic
 * operation: the item is marked converted with a pointer to the task it became (never deleted, never
 * duplicated — D-19), and the task logs `Created — pulled from Backlog`.
 *
 * ⚠ **A2 (R-backlog-26)** — the receiving goal is the **Weekly goal at or under the item's goal whose
 * `periodKey` is the target week**, not an "active leaf".
 *
 * Exactly one candidate → used silently. Two or more → `AMBIGUOUS_CONVERSION_TARGET` with
 * `details.candidates`, and the owner chooses: the server refuses to pick, because that id decides which
 * week the task belongs to for the rest of its life and array order is not a decision. **None** →
 * `NO_WEEKLY_GOAL`, and the client offers `newWeeklyGoal` rather than sending the owner away (R-task-48).
 * A second conversion of the same item is refused with `ALREADY_CONVERTED`.
 *
 * ⚠ **A8 (R-backlog-31) — `week: WeekOffset` became `period`, and it now names TWO destinations.** One
 * field, a `periodKey`, the format the discriminator — the same shape `CreateTaskRequest` and
 * `RetargetTaskRequest` use, so there is one answer in this product to "which period does this land in".
 *
 * | `period` | Path |
 * |---|---|
 * | absent | **`Add to this week`**, the current week. The `+` drawer's meaning, unchanged (R-backlog-27) |
 * | a Monday | **`Add to this week`**, that week. Ambiguity, the inline create and every other particular unchanged (S-backlog-26-2, S-backlog-26-3 still pass verbatim) |
 * | a month key | **`Add to this month`** — available on a **Monthly** goal only, and it must be that goal's own month. The item becomes a **month task on the goal it is already attached to**: no resolution, no candidate list, no ambiguity, no `NO_WEEKLY_GOAL` and no implicitly created goal, because the target is the goal the item is already on (S-backlog-31-1) |
 * | a month key, item on a Yearly/Quarterly goal | `NOT_A_TASK_GOAL` — only a Monthly goal holds a month task (S-backlog-31-2) |
 *
 * **The month path is the one that removes a dead end.** `NO_WEEKLY_GOAL` was reachable from every
 * backlog item on a Monthly goal in a week nobody had planned yet; from A8 it is reachable only when the
 * owner has explicitly asked for a *week*. A past period is `PERIOD_IN_PAST` at either scope.
 */
export const ConvertBacklogItemRequest = z
  .object({
    goalId: Ulid.optional(),
    newWeeklyGoal: NewWeeklyGoalInput.optional(),
    /** ⚠ **A8** — the destination period; absent means the current week. See the table above. */
    period: PeriodKeyParam.optional(),
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
export type LearningsQuery = z.infer<typeof LearningsQuery>;
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
export type MeasureInput = z.infer<typeof MeasureInput>;
export type RetargetTaskRequest = z.infer<typeof RetargetTaskRequest>;
export type RetargetTaskResponse = z.infer<typeof RetargetTaskResponse>;
export type SetMeasureRequest = z.infer<typeof SetMeasureRequest>;
export type RecordReadingRequest = z.infer<typeof RecordReadingRequest>;
export type TaskReadingParams = z.infer<typeof TaskReadingParams>;
export type AddTaskLinkRequest = z.infer<typeof AddTaskLinkRequest>;
export type TaskResponse = z.infer<typeof TaskResponse>;
export type CreateTaskResponse = z.infer<typeof CreateTaskResponse>;
export type MoveTaskToBacklogResponse = z.infer<typeof MoveTaskToBacklogResponse>;
export type CreateBacklogItemRequest = z.infer<typeof CreateBacklogItemRequest>;
export type PatchBacklogItemRequest = z.infer<typeof PatchBacklogItemRequest>;
export type MoveBacklogItemRequest = z.infer<typeof MoveBacklogItemRequest>;
export type ReorderBacklogItemRequest = z.infer<typeof ReorderBacklogItemRequest>;
export type ConvertBacklogItemRequest = z.infer<typeof ConvertBacklogItemRequest>;
export type BacklogItemResponse = z.infer<typeof BacklogItemResponse>;
export type ConvertBacklogItemResponse = z.infer<typeof ConvertBacklogItemResponse>;
export type CreateLearningRequest = z.infer<typeof CreateLearningRequest>;
export type PatchLearningRequest = z.infer<typeof PatchLearningRequest>;
export type AttachLearningRequest = z.infer<typeof AttachLearningRequest>;
export type LearningResponse = z.infer<typeof LearningResponse>;
