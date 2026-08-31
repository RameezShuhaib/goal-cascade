import { firstIssueMessage, isTransient, type ApiError } from '../api/errors';

/** Which read models are stale after an error, so the screen catches up with whatever really happened. */
export type Refresh = 'none' | 'goals' | 'tasks' | 'backlog' | 'plan' | 'me' | 'all';

export interface ErrorPresentation {
  /** Toast text, or `null` when the screen explains itself (the sheet already says it). */
  message: string | null;
  tone: 'default' | 'error';
  /** Offer a Retry action that reuses the same Idempotency-Key. */
  retryable: boolean;
  refresh: Refresh;
}

/**
 * The copy sheet. Pure — `useApiErrorHandler` applies it.
 *
 * Q-10 is what makes this file possible and necessary: every refusal in this product is a machine-readable
 * code, never the mockup's silent `return`. Where a mockup method just stopped (a blank title, an inactive
 * branch, a horizon clash), the server now answers with a code, and this is where that code becomes a
 * sentence a person can act on. A refusal with no line here falls through to the generic default, which is
 * correct but says nothing useful — so a new domain code should arrive with a case.
 *
 * `tone: 'default'` is for "someone/something else already changed this" — true, not alarming. `'error'` is
 * for "your action did not happen and you need to do something".
 */
export function presentError(err: ApiError): ErrorPresentation {
  const e = (message: string | null, opts: Partial<ErrorPresentation> = {}): ErrorPresentation => ({
    message,
    tone: 'error',
    retryable: false,
    refresh: 'none',
    ...opts,
  });
  switch (err.code) {
    // ---- the goal tree (R-goal-5/6/17/18/19/21/28) ----
    case 'HORIZON_CONFLICT':
      return e('A sub-goal has to sit on a shorter horizon than its parent.', { refresh: 'goals' });
    case 'WOULD_CREATE_CYCLE':
      return e("A goal can't move under itself or one of its own sub-goals.", { refresh: 'goals' });
    case 'GOAL_HAS_CHILDREN':
      // Q-5 — `details` carries the counts, and the delete sheet renders them. Not a toast.
      return e(null, { refresh: 'goals' });
    case 'GOAL_HAS_OPEN_TASKS':
      return e('This goal still has open tasks — move or close them first.', { refresh: 'goals' });
    case 'LIFE_GOAL_IMMUTABLE':
      return e("A Life goal can't be moved or re-planned.", { refresh: 'goals' });
    case 'NOT_A_LEAF':
      return e('Only a sub-goal with no children of its own can hold work.', { refresh: 'goals' });
    case 'NOT_A_LIFE_GOAL':
      return e('Ideas and learnings tag a Life goal, or nothing at all.', { refresh: 'goals' });
    case 'LIFE_GOAL_NO_BACKLOG':
      return e('Backlog items live on a Yearly, Quarterly or Monthly goal — not a Life goal.', { refresh: 'goals' });

    // ---- the week (R-plan-2, R-task-14, R-nav-3) ----
    case 'WEEK_NOT_CURRENT':
      // A plan save that crossed a Monday boundary. Refused wholesale (Q-3), never partly applied.
      return e("The week rolled over while you were planning — that's next week's plan now. Reload and try again.", {
        refresh: 'plan',
      });
    case 'WEEK_OUT_OF_RANGE':
      return e("That week isn't addressable — the future never is, and a task can't close before it existed.", {
        refresh: 'tasks',
      });

    // ---- backlog and its one conversion (R-backlog-6/8/9, D-19) ----
    case 'BRANCH_NOT_ACTIVE':
      // R-backlog-8: the sheet offers [Set a weekly focus] / [Cancel]; a toast would be in its way.
      return e(null, { refresh: 'goals' });
    case 'ALREADY_CONVERTED':
      return e('That one is already this week — nothing new was created.', { tone: 'default', refresh: 'backlog' });

    // ---- tasks ----
    case 'TASK_ALREADY_EXITED':
      return e('That task has already left the board.', { tone: 'default', refresh: 'tasks' });

    // ---- concurrency and plumbing ----
    case 'CONCURRENT_UPDATE':
      // Q-2 — another device won the race. Refresh everything; the next tap goes out against fresh state
      // under a NEW key (the 409 is stored under the old one and would only be replayed).
      return e('Something changed on another device — try again.', { tone: 'default', refresh: 'all' });
    case 'IDEMPOTENCY_KEY_REUSED':
    case 'IDEMPOTENCY_KEY_MISSING':
    case 'IDEMPOTENCY_IN_PROGRESS':
      return e("Couldn't save — try again.");
    case 'UNAUTHENTICATED':
      return e('Signed out — sign in again.', { refresh: 'me' });
    case 'SIGNUP_NOT_ALLOWED':
      // Reachable only through the Better Auth channel, where `authCopy` owns the wording. Never a toast.
      return e(null);
    case 'FORBIDDEN':
      return e("That isn't allowed.");
    case 'NOT_FOUND':
      // R-auth-3 — indistinguishable from someone else's row, by design. Refresh: our copy is stale.
      return e("That's no longer here.", { refresh: 'all' });
    case 'VALIDATION_FAILED':
      return e(firstIssueMessage(err) ?? "Couldn't save — check the values.");
    case 'RATE_LIMITED':
      return e('Too many tries — give it a minute.');
    case 'BAD_RESPONSE':
      return e("The server answered in a way this version doesn't understand — reload to update.");
    case 'NETWORK':
    case 'INTERNAL':
    case 'NOT_IMPLEMENTED':
      return e("Couldn't reach Goal Cascade — try again.", { retryable: true });
    default:
      // Only a transient failure earns a same-key Retry: a stored 4xx would be replayed verbatim.
      return isTransient(err) ? e("Couldn't reach Goal Cascade — try again.", { retryable: true }) : e("Couldn't save — try again.");
  }
}
