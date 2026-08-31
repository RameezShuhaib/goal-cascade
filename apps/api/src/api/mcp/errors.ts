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
 * The longest entries are the ones a model gets wrong: they all look like "try again" and none of them
 * is. Each names the tool to call next and, where the product forbids a plausible workaround, says so.
 *
 * ⚠ **A2** — four codes left this table with their rules (R-rm-2): `NOT_A_LEAF`, `BRANCH_NOT_ACTIVE`,
 * `WEEK_NOT_CURRENT` and `GOAL_HAS_OPEN_TASKS`. Three replacements carry the substitutions the product
 * refuses, and they are the ones worth reading twice:
 *  - **`NOT_A_WEEKLY_GOAL`** — never "use a leaf instead". The condition is the horizon.
 *  - **`NO_WEEKLY_GOAL`** — never "use a different goal that has one". Create the week's goal inline.
 *  - **`PERIOD_IN_PAST`** — never "write it and move it afterwards". Planning does not rewrite history.
 */
const RECOVERY: Partial<Record<ErrorCode, string>> = {
  HORIZON_CONFLICT:
    "The child's horizon is not strictly shorter than the parent's — they are equal rank, or the parent is WEEKLY, which is terminal and can never have sub-goals. Do NOT retry with the same pair. On create: pick a shorter horizon than the parent (Life › Yearly › Quarterly › Monthly › Weekly), or a different parent — and note that levels may be SKIPPED, so a weekly goal under a quarterly or life goal is legal and is not what this refusal is about. On move: `details` carries both horizons — pick a target with a LONGER horizon, or tell the user this parent cannot hold this goal.",
  WOULD_CREATE_CYCLE:
    "The move target is the goal itself or one of its own descendants. This check runs BEFORE the horizon check, so it is the reason you get when both apply. Never retry. Re-read the relevant lens (`list_lens`) and choose a target OUTSIDE the moved goal's subtree. If the user pointed at a descendant, say plainly that a goal cannot move under its own child.",
  NOT_A_WEEKLY_GOAL:
    "That goal's horizon is not Weekly, and ONLY weekly goals hold tasks. `details` carries the horizon. This is about the HORIZON and nothing else — a monthly goal with no weekly children looks like the end of a branch and still cannot hold a task, which is the mistake this code exists to catch. Find a weekly goal for the week you want with find_goal(only=\"weekly\"), or create the task with create_task's `new_weekly_goal`, which makes the weekly goal and the task in one step. Never route the work to some other goal because the right one has no week yet.",
  NO_WEEKLY_GOAL:
    "No weekly goal exists at or under that goal for the target week, so nothing can receive the conversion. `details` carries `goalId` and `weekStart`. Do NOT retry unchanged and do NOT pick a different goal that happens to have one — re-send with `new_weekly_goal` (a parent id and a one-line title), which creates it and converts the item in the same transaction. Ask the user for the title if it is not obvious; the monthly goal's own title is usually right.",
  PERIOD_IN_PAST:
    "The period named is earlier than the current one for that horizon, and nothing is ever created into, or moved into, a past period: planning does not rewrite history. `details` carries the period you sent and the current one. Do NOT retry with an earlier period, and do not try to work around it by moving something afterwards. Use the current period or a later one — get_period gives you the key. A past period is closed to new PLAN and to nothing else: completing a task that was live that week, unchecking one, or correcting a title all still work.",
  ALREADY_CONVERTED:
    'This backlog item already became a task — a retry, a stale id, or a second agent got there first. No second task was created. Do not retry and do not re-create the work by hand. Call list_backlog or get_task to find the task it became (`convertedToTaskId`) and continue with that task, and tell the user it had already been pulled in.',
  AMBIGUOUS_CONVERSION_TARGET:
    "Two or more weekly goals at or under this item's goal could receive it for that week, and the server refuses to choose because this id fixes which week the task belongs to for the rest of its life. `details.candidates` is `[{ id, title }]`. Ask the user which one, using those titles, then repeat the call with `goal_id` set to the one they name. Do not pick the first candidate, do not pick by ordering, and do not pick by string similarity.",
  GOAL_HAS_CHILDREN:
    'A delete was attempted on a goal that has sub-goals without the cascade flag. `details` carries `subGoals`, `weeklyGoals`, `tasks` and `backlogItems`. Do NOT simply repeat the call with `cascade: true`. Call preview_goal_deletion, report those counts to the user, get an explicit yes, and only then delete. This refusal is the confirmation step, not an argument you forgot.',

  NOT_A_LIFE_GOAL:
    'A Learning tag, and Repeat last week\'s target, must be a LIFE goal. Use that goal\'s life root, or pass null for "Unsorted" where the tool allows it.',
  LIFE_GOAL_NO_BACKLOG:
    "Backlog items live on a Yearly, Quarterly or Monthly goal — never a life goal, and never a weekly goal, because an item has no week. On create or move: pick a Yearly/Quarterly/Monthly goal; find_goal with only=\"can_hold_backlog\" lists the valid targets. On move_task_to_backlog: this weekly goal hangs directly off a life goal, so there is nothing above its week that can hold the item — say so, and offer complete or cancel instead.",
  LIFE_GOAL_IMMUTABLE:
    'Life goals cannot be moved or re-planned. Say so plainly and stop; there is no workaround and constructing one would misrepresent the product.',
  TASK_ALREADY_EXITED:
    'The task is done, cancelled, or already in the backlog — only OPEN tasks can be moved to the backlog or cancelled. Re-read it with get_task and tell the user its actual state.',
  WEEK_OUT_OF_RANGE:
    "On complete_task: the week is either in the FUTURE — you cannot finish work in a week that has not happened — or earlier than the task's own origin week. Read `completable` on the task: when it is false and the task's week is ahead, there is no legal completion week at all yet, and the answer is to wait, not to retry with a different offset. Elsewhere it means the offset is outside the storage range (±520).",
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
