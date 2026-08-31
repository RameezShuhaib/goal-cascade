import type { CallToolResult } from '@modelcontextprotocol/server';
import type { ErrorCode } from '@goal-cascade/shared';
import { DomainError } from '../../domain/errors';

/**
 * Refusals, written for a model to act on.
 *
 * A 409 in this product means "do something DIFFERENT", never "retry". An agent that reads
 * `HORIZON_CONFLICT` as a transient failure and fires the identical call again burns turns, confuses the
 * user, and eventually gives up and invents a workaround — which is the failure mode this table exists
 * to prevent. So every code carries an explicit `recovery` sentence naming the NEXT tool call, and an
 * explicit `retryable` flag that is `false` for everything except the three genuinely transient codes.
 *
 * `code` and `details` are the existing `DomainError`'s, verbatim; `recovery` and `retryable` are written
 * here, for the model, and are the only part of the envelope this layer authors.
 */

/** Repeating the identical call could only ever succeed for these three. Everything else: no. */
const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['IDEMPOTENCY_IN_PROGRESS', 'RATE_LIMITED', 'INTERNAL']);

/**
 * The recovery move for every code an agent can provoke.
 *
 * The six that get the longest entries are the six a model gets wrong: they all look like "try again"
 * and none of them is. Each names the tool to call next and, where the product forbids a plausible
 * workaround, says so — `BRANCH_NOT_ACTIVE` in particular, because "just use a goal that IS active" is
 * the single substitution this product explicitly refuses.
 */
const RECOVERY: Partial<Record<ErrorCode, string>> = {
  HORIZON_CONFLICT:
    "The child's horizon is not strictly shorter than the parent's — they are equal rank, or the parent is Monthly, which is terminal and can never have sub-goals. Do NOT retry with the same pair. On create: pick a shorter horizon than the parent (Life › Yearly › Quarterly › Monthly), or a different parent. On move: `details` carries both horizons — pick a target with a LONGER horizon, or tell the user this parent cannot hold this goal.",
  WOULD_CREATE_CYCLE:
    'The move target is the goal itself or one of its own descendants. This check runs BEFORE the horizon check, so it is the reason you get when both apply. Never retry. Re-read the tree (`list_goals` or goalcascade://tree) and choose a target OUTSIDE the moved goal\'s subtree. If the user pointed at a descendant, say plainly that a goal cannot move under its own child.',
  BRANCH_NOT_ACTIVE:
    "No leaf at or under that goal has a focus this week, so nothing can receive the task. `details` carries `goalId` and `weekStart`. Offer the product's own two options: activate a branch with set_goal_focus on a specific non-Life leaf — ask the user which — or leave the work parked. Never route the task to a DIFFERENT goal that happens to be active; that is the one substitution this product forbids.",
  ALREADY_CONVERTED:
    'This backlog item already became a task — a retry, a stale id, or a second agent got there first. No second task was created. Do not retry and do not re-create the work by hand. Call list_backlog or get_task to find the task it became (`convertedToTaskId`) and continue with that task, and tell the user it had already been pulled in.',
  AMBIGUOUS_CONVERSION_TARGET:
    'Two or more active leaves at or under this item\'s goal could receive it, and the server refuses to choose because this id fixes which focus the task belongs to for the rest of its life. `details.candidates` is `[{ id, title }]`. Ask the user which branch, using those titles, then repeat the call with `goal_id` set to the one they name. Do not pick the first candidate, do not pick by ordering, and do not pick by string similarity.',
  GOAL_HAS_CHILDREN:
    'A delete was attempted on a goal that has sub-goals without the cascade flag. `details` carries `subGoals`, `tasks` and `backlogItems`. Do NOT simply repeat the call with `cascade: true`. Call preview_goal_deletion, report those counts to the user, get an explicit yes, and only then delete. This refusal is the confirmation step, not an argument you forgot.',

  NOT_A_LEAF:
    'That goal is a Life goal or it has children, and only a non-Life LEAF can hold a weekly focus or own a task. Pick a leaf below it — find_goal with only="leaves" (or only="active_leaves" if the task needs a live branch).',
  NOT_A_LIFE_GOAL:
    'An Idea or Learning tag must be a LIFE goal or null. Use that goal\'s Life root (the first segment of its path), or pass null for "Unsorted".',
  LIFE_GOAL_NO_BACKLOG:
    'Backlog items live on a Yearly, Quarterly or Monthly goal — never a Life goal. Pick a descendant of that Life goal; find_goal with only="can_hold_backlog" lists the valid targets.',
  LIFE_GOAL_IMMUTABLE:
    'Life goals cannot be moved or re-planned. Say so plainly and stop; there is no workaround and constructing one would misrepresent the product.',
  GOAL_HAS_OPEN_TASKS:
    'Turning a leaf into a parent while it still holds open tasks is refused, because those tasks would be silently re-homed. `details` names them. Complete, cancel or move-to-backlog those tasks first, then retry this call once.',
  TASK_ALREADY_EXITED:
    'The task is done, cancelled, or already in the backlog — only OPEN tasks can be moved to the backlog or cancelled. Re-read it with get_task and tell the user its actual state.',
  WEEK_NOT_CURRENT:
    'Planning edits the current week only, and the save was refused WHOLESALE — nothing was written. This normally means the week rolled over while you were working. Call get_weekly_plan again, take the fresh `week_start` from it, and re-send.',
  WEEK_OUT_OF_RANGE:
    "The week is in the future, or (on complete_task) earlier than the task's own origin week. Use an offset of 0 or less, and not earlier than the task's `origin_week_start` from get_task.",
  CONCURRENT_UPDATE:
    "Someone — the owner's phone, most likely — changed this row first. Re-read the entity, check the user's intent still applies to the new state, then write ONCE. Never loop on this.",
  VALIDATION_FAILED:
    '`details` names the field that is out of bounds, whitespace-only, or otherwise malformed. Fix that one field and retry once. If the value came from the user verbatim, tell them what the limit is rather than silently truncating.',
  NOT_FOUND:
    'That id does not exist for this owner — deleted, or never existed. Re-resolve it with find_goal or the matching list tool. Do NOT report this as "permission denied": this product cannot distinguish the two, on purpose.',
  IDEMPOTENCY_IN_PROGRESS:
    'An identical write is already in flight. Wait a moment and RE-READ to see whether it landed. Do not fire a second write.',
  UNAUTHENTICATED:
    'The credential is gone. Stop and tell the user to check their Goal Cascade agent-access token.',
  INVALID_API_TOKEN:
    'The bearer token is not valid. Stop and tell the user to open Goal Cascade → Account → Agent access and paste a fresh token into your config.',
  FORBIDDEN: 'This operation is not permitted. Stop and report it; do not look for another route to the same effect.',
  RATE_LIMITED: 'Transient. Back off once, then report it to the user rather than hammering.',
  INTERNAL: 'A server fault, not something you did wrong. Retry once at most, then report it.',
};

const GENERIC = 'Read the code and message, tell the user what was refused, and do not retry the identical call.';

/**
 * A `DomainError` as a tool result the model can act on.
 *
 * `isError: true` (rather than a thrown protocol fault) is what makes this recoverable: the model SEES
 * the text and can choose a different call. A JSON-RPC error would look like a broken tool.
 */
export function toolError(err: DomainError): CallToolResult {
  const payload = {
    code: err.code,
    message: err.message,
    recovery: RECOVERY[err.code] ?? GENERIC,
    retryable: RETRYABLE.has(err.code),
    ...(err.details ? { details: err.details } : {}),
  };
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: true };
}

/**
 * The static form of the table above, served at `goalcascade://rules/errors` so an agent can read the
 * whole recovery map ONCE instead of discovering it one refusal at a time.
 */
export function errorCatalogue(statuses: Readonly<Record<string, number>>): unknown {
  return Object.fromEntries(
    Object.entries(statuses).map(([code, status]) => [
      code,
      { status, retryable: RETRYABLE.has(code as ErrorCode), recovery: RECOVERY[code as ErrorCode] ?? GENERIC },
    ]),
  );
}

/**
 * Run a tool body, turning any refusal into an actionable `isError` result.
 *
 * A NON-`DomainError` is deliberately NOT re-thrown as-is. The SDK catches a thrown error and uses
 * `error.message` as the model-visible text, so a raw D1 failure would put SQL — potentially with row
 * contents in it — straight into the model's context. This maps it to `INTERNAL` with a generic message
 * and logs the real one server-side, which is the same discipline `errorHandler` already applies to
 * `/api/*`.
 */
export async function guard(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DomainError) return toolError(err);
    console.error('[mcp] unhandled tool error', err);
    return toolError(new DomainError('INTERNAL', 'internal error'));
  }
}
