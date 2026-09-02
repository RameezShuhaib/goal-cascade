import { useCallback, useRef } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient, type UseMutationResult } from '@tanstack/react-query';
import type {
  ApiTokenStatusResponse,
  BacklogItemView,
  BacklogResponse,
  GoalDetailResponse,
  GoalView,
  Horizon,
  LearningView,
  LearningsResponse,
  LensResponse,
  TaskDetailView,
  TaskView,
  TasksResponse,
} from '@goal-cascade/shared';
import { addWeeks, isPastPeriod } from '@goal-cascade/shared';
import { useApi } from '../context/ApiContext';
import { useUI } from '../context/UIContext';
import { newIdempotencyKey, type ApiClient } from './http';
import { isApiError, isTransient, toApiError, type ApiError, type ApiErrorCode } from './errors';
import { presentError, type Refresh } from '../lib/errorCopy';
import { keys, shouldRetry } from '../lib/queryClient';
import { recordLiveIdentity } from '../auth/identity';
import { useWeekClock } from '../lib/weekClock';
import { assertCurrentMondayAgrees, assertPeriodAgrees } from '../lens/assertPeriodAgrees';

export { keys };

/*
 * Thin hooks. The SERVER owns every invariant in this product — which goals are leaves, which branches are
 * active this week, which tasks carry, whether a backlog item may become work. These hooks fetch read
 * models, send commands, patch the cache from the response, then invalidate. No domain logic lives here,
 * and none may be added: a rule enforced in two places is a rule that will disagree with itself.
 */

// ---- read models -----------------------------------------------------------

/**
 * Read models are cheap and change only when this one person changes them, so there is no polling interval:
 * `refetchOnWindowFocus` plus the invalidations every command fires is the whole freshness story. (The
 * reference app polled because two parents wrote to one household; here there is exactly one writer.)
 */
export const READ_MODEL_STALE_MS = 30_000;
const READ_MODEL = { staleTime: READ_MODEL_STALE_MS } as const;

/**
 * ⚠ **R-lens-30** — a lens payload is kept for **ten** minutes rather than React Query's default five,
 * so a browse of roughly a dozen periods stays resident and stepping back over one you have seen is a
 * repaint with no loading state at all.
 *
 * The size is bounded by construction: `MAX_PAGE` caps a page, and `MAX_WEEKLY_GOALS_PER_WEEK` caps a
 * Weekly page at 50 goals, so twelve resident payloads are a few hundred kilobytes rather than a leak.
 */
const LENS_GC_MS = 10 * 60_000;

/**
 * ⚠ **R-lens-30** — a **past** period is stale after five minutes, not thirty seconds.
 *
 * A past period changes only when *you* edit it, and every write path calls `applyRefresh`, whose `goals`
 * and `all` cases both invalidate the `['goals']` PREFIX — which covers every period key, including this
 * one. So the longer window is not a bet that nothing changed; it is the observation that anything which
 * could change it has already invalidated it. The residual risk is a *future* write path that forgets to
 * declare a refresh, which is a bug that would show up in the current period first.
 */
const PAST_PERIOD_STALE_MS = 5 * 60_000;

export function useMe() {
  const client = useApi();
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      const me = await client.me();
      // The only place an identity is established. It keys the persisted cache blob (`lib/queryClient.ts`),
      // so it must be written from a LIVE 200 and nothing else.
      recordLiveIdentity(me.user.id);
      return me;
    },
    staleTime: 5 * 60_000,
    retry: shouldRetry,
  });
}

/**
 * Session state derived from `/me`. `signedOut` is true once `/me` answers 401 — even while stale data (a
 * restored persisted cache, a session that expired mid-use) is still in the cache — so every dependent query
 * stops refetching instead of looping 401 → invalidate `['me']` → 401.
 */
export function useSession() {
  const me = useMe();
  const signedOut = isApiError(me.error) && me.error.status === 401;
  return { me, signedOut, signedIn: !signedOut && !!me.data };
}

/**
 * The `enabled` guard every authenticated read is gated on. Without it a signed-out app fires one 401 per
 * query per focus, each of which invalidates `/me`, which re-enables the queries: a loop that looks like a
 * hung splash screen and reads as a denial-of-service to the rate limiter.
 */
function useSignedIn(): boolean {
  return useSession().signedIn;
}

/** R-nav-12 / D-25 — the theme preference; `App.tsx` feeds it to `ThemeProvider`. */
export function usePreferences() {
  const client = useApi();
  const enabled = useSignedIn();
  return useQuery({ queryKey: keys.preferences, queryFn: () => client.preferences(), enabled, staleTime: 5 * 60_000 });
}

/**
 * Everything the app needs on cold open, in one request.
 *
 * ⚠ **A2 (R-rm-5, R-nav-28)** — it no longer ships every goal: it carries the Life goals, the Weekly lens
 * at the week containing today, and that week's tasks.
 *
 * ⚠ **R-lens-30** — it is no longer *the client's only source of the current Monday*. `lib/weekClock`
 * derives that from the owner's today through the same `weekStartOfDate` the server calls, so the
 * `+ Weekly goal` affordance is live on a cold open instead of inert until this lands. `week.weekStart`
 * stays on the wire and becomes an **input to the echo assertion** (`lens/assertPeriodAgrees`), which is
 * the one live check on the client's timezone resolution.
 */
export function useBootstrap(week = 0) {
  const client = useApi();
  const enabled = useSignedIn();
  const clock = useWeekClock();
  const q = useQuery({ queryKey: keys.bootstrap(week), queryFn: () => client.bootstrap(week), enabled, ...READ_MODEL });
  /**
   * ⚠ **Anti-drift layer 3, applied to the timezone ladder.** This is the ONE live check that the client's
   * `tz` resolution matches the server's: if it did not, every week boundary in the product would be a
   * day out and nothing else would notice.
   */
  assertCurrentMondayAgrees(q.data?.week.weekStart, q.data?.serverNow, clock.tz);
  return q;
}

/**
 * R-lens-16 — **one lens: one horizon, one period, grouped by Life goal.** This replaced `useGoals`, the
 * whole-tree read.
 *
 * ⚠ **R-lens-30 — `period` is now `undefined` only on the Life lens**, which genuinely has none
 * (R-lens-2). Every other read carries an explicit canonical key, resolved by the route before the first
 * render (`LensScreen`). That is the whole cache win: **one address per period instead of two.** It used
 * to be `undefined` whenever the URL named no period — the read went out under `['goals','Monthly',null]`,
 * the answer arrived, the screen rewrote the URL, the key became `['goals','Monthly','2026-09']`, and that
 * was a cache miss, a second `GET /goals` and a second `Loading…`. A prefetch could never hit, either,
 * because the key it warmed was not the key the screen would settle on.
 *
 * The client now derives the period; it still derives no count and no `hasWork` (R-goal-34's spirit, with
 * the calendar half moved to `@goal-cascade/shared` so the two sides cannot disagree about it).
 */
export function useLens(lens: Horizon, period?: string, enabled = true) {
  const client = useApi();
  const signedIn = useSignedIn();
  const clock = useWeekClock();
  const isPast = !!period && lens !== 'Life' && isPastPeriod(lens, period, clock.today);
  return useQuery({
    queryKey: keys.lens(lens, period ?? null),
    queryFn: () => client.lens({ lens, ...(period ? { period } : {}) }),
    enabled: signedIn && enabled,
    staleTime: isPast ? PAST_PERIOD_STALE_MS : READ_MODEL_STALE_MS,
    gcTime: LENS_GC_MS,
  });
}

/**
 * ⚠ **`useZoom` is deleted with the Zoom sheet** (R-lens-17, rewritten; R-lens-22, deleted). The lens is a
 * tab strip in the shell and there are no per-lens counts to fetch — five ambient numbers in a permanent
 * strip is a report, which R-nav-26 refuses. `GET /goals/zoom` and `GoalService.zoom` now have **no
 * caller**: flagged for the server, and deliberately not deleted in this pass.
 */

/** R-goal-41 — one goal's detail page: the goal, its ancestors, children, tasks, backlog and learnings. */
export function useGoal(id: string | null | undefined) {
  const client = useApi();
  const enabled = useSignedIn() && !!id;
  const clock = useWeekClock();
  const q = useQuery({ queryKey: keys.goal(id ?? ''), queryFn: () => client.goal(id!), enabled, ...READ_MODEL });
  /**
   * ⚠ **Anti-drift layer 3.** `replanOptions` is a list of `PeriodView`s the server derived from its own
   * clock (R-goal-40), so it is the goal page's echo of the same calendar. Checking it here rather than at
   * the seven call sites of `useGoal` means every one of them is covered without any of them knowing.
   */
  for (const option of q.data?.replanOptions ?? []) {
    assertPeriodAgrees('GoalDetailResponse.replanOptions', q.data!.goal.horizon, option, q.data!.serverNow, clock.tz);
  }
  return q;
}

/** R-lens-12 — the tasks visible in one week. Visibility is entirely server-applied (R-task-7/8/32). */
export function useTasks(week = 0) {
  const client = useApi();
  const enabled = useSignedIn();
  return useQuery({ queryKey: keys.tasks(week), queryFn: () => client.tasks({ week }), enabled, ...READ_MODEL });
}

/** R-task-30 — one task with its full activity log. Lists omit `events`; only the task PAGE needs them. */
export function useTask(id: string | null, week = 0) {
  const client = useApi();
  const enabled = useSignedIn() && !!id;
  return useQuery({ queryKey: keys.task(id ?? ''), queryFn: () => client.task(id!, week), enabled, ...READ_MODEL });
}

/** R-backlog-13 — the backlog page. Converted items are never listed. */
export function useBacklog(goalId?: string) {
  const client = useApi();
  const enabled = useSignedIn();
  return useQuery({
    queryKey: keys.backlog(goalId),
    queryFn: () => client.backlog(goalId ? { goalId } : {}),
    enabled,
    ...READ_MODEL,
  });
}

export function useLearnings() {
  const client = useApi();
  const enabled = useSignedIn();
  return useQuery({ queryKey: keys.learnings, queryFn: () => client.learnings(), enabled, ...READ_MODEL });
}

/**
 * Whether an agent token exists, and enough of it to recognise. Reading STATUS needs no password — only
 * creating or replacing does — so this is an ordinary read model like any other.
 *
 * `retry: false` because a failure here is a state the section renders rather than one worth hiding: one
 * request, and it says it couldn't check and offers a retry, rather than three rounds behind a spinner.
 */
export function useAgentToken() {
  const client = useApi();
  const enabled = useSignedIn();
  return useQuery({ queryKey: keys.agentToken, queryFn: () => client.agentTokenStatus(), enabled, staleTime: 30_000, retry: false });
}

/**
 * Q-5 — what deleting this goal would destroy, read when the confirmation sheet opens.
 *
 * `gcTime: 0` and `staleTime: 0`: the sheet asks fresh every time it opens and the answer does not outlive
 * it. A confirmation that names counts from ten minutes ago is a confirmation that lies. `retry: false` so
 * a preview that fails for any reason costs one request, after which the sheet falls back to the
 * `GOAL_HAS_CHILDREN` refusal path it has always had.
 */
export function useGoalDeletePreview(id: string | null) {
  const client = useApi();
  const enabled = useSignedIn() && !!id;
  return useQuery({
    queryKey: keys.goalDeletePreview(id ?? ''),
    queryFn: () => client.goalDeletePreview(id!),
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

// ---- errors ----------------------------------------------------------------

function applyRefresh(qc: QueryClient, r: Refresh) {
  const inv = (k: readonly unknown[]) => void qc.invalidateQueries({ queryKey: k });
  switch (r) {
    case 'goals':
      inv(keys.goalsAll);
      inv(['goal']);
      break;
    case 'tasks':
      inv(keys.tasksAll);
      inv(['task']);
      break;
    case 'backlog':
      inv(keys.backlogAll);
      break;
    case 'me':
      inv(keys.me);
      break;
    case 'all':
      inv(keys.goalsAll);
      inv(['goal']);
      inv(keys.tasksAll);
      inv(['task']);
      inv(keys.backlogAll);
      inv(keys.learnings);
      inv(['bootstrap']);
      break;
    case 'none':
      break;
  }
}

export interface HandleErrorOptions {
  /** Called from the toast's Retry action — same Idempotency-Key. */
  retry?: () => void;
  /** The caller renders the failure inline with its own retry; skip the generic network toast. */
  inline?: boolean;
  /** Codes the screen explains itself (a field message, a sheet); refresh still applies, no toast. */
  quiet?: readonly ApiErrorCode[];
}

/** Maps any thrown value onto the copy sheet: refresh what is stale, toast, offer Retry. */
export function useApiErrorHandler() {
  const { showToast } = useUI();
  const qc = useQueryClient();
  return useCallback(
    (e: unknown, opts: HandleErrorOptions = {}): ApiError => {
      const err = toApiError(e);
      const p = presentError(err);
      applyRefresh(qc, p.refresh);
      if (p.message && !(p.retryable && opts.inline) && !opts.quiet?.includes(err.code)) {
        showToast(p.message, {
          tone: p.tone,
          action: p.retryable && opts.retry ? { label: 'Retry', onClick: opts.retry } : undefined,
        });
      }
      return err;
    },
    [qc, showToast],
  );
}

// ---- commands --------------------------------------------------------------

export type CommandResult<TData, TVars> = UseMutationResult<TData, ApiError, TVars> & {
  /** Re-send the last payload with the SAME Idempotency-Key. */
  retry: () => void;
};

export interface CommandOptions<TVars, TData> {
  run: (client: ApiClient, vars: TVars, idempotencyKey: string) => Promise<TData>;
  /** Patch the cache from the response — the first half of patch-then-invalidate. */
  onSuccess?: (data: TData, vars: TVars, qc: QueryClient) => void;
  invalidate?: readonly (readonly unknown[])[];
  /** The screen renders the failure inline; skip the generic network toast. */
  inline?: boolean;
  /** Codes the screen surfaces itself (a field message, a confirm sheet); no toast for these. */
  quiet?: readonly ApiErrorCode[];
}

/**
 * The ONE write wrapper. Every command in the app goes through it, which is what makes three things true
 * everywhere instead of per-call-site:
 *
 * **One Idempotency-Key per INTENT.** Minted when a new payload is sent, reused while that same payload is
 * retried after a TRANSIENT failure (network, 5xx, IN_PROGRESS — the server holds no committed response for
 * the key), and dropped on success. A different payload gets a new key, because it is a different intent. A
 * stored 4xx also drops it: the server keeps domain errors under the key, so re-sending the same key would
 * replay the 409 forever — the next attempt has to go out fresh against refreshed state.
 *
 * **Patch-then-invalidate.** The command's response already contains the new state, so `onSuccess` writes it
 * into the cache immediately (instant UI), and the invalidation then reconciles on the next fetch. That
 * gives optimistic-feeling UI without the rollback complexity of a true optimistic update — and, crucially,
 * without the mockup's `persist()` pattern, where the local edit was applied whether or not the server
 * agreed and a refusal left the screen lying.
 *
 * **One error path.** `useApiErrorHandler` refreshes what the failure made stale and shows the one toast.
 */
export function useCommand<TVars, TData>(opts: CommandOptions<TVars, TData>): CommandResult<TData, TVars> {
  const client = useApi();
  const qc = useQueryClient();
  const handleError = useApiErrorHandler();
  const keyRef = useRef<{ key: string; fingerprint: string } | null>(null);
  type MutateArgs = Parameters<UseMutationResult<TData, ApiError, TVars>['mutate']>;
  const last = useRef<MutateArgs | null>(null);

  const mutation = useMutation<TData, ApiError, TVars>({
    mutationFn: async (vars) => {
      const fingerprint = JSON.stringify(vars ?? null);
      if (!keyRef.current || keyRef.current.fingerprint !== fingerprint) {
        keyRef.current = { key: newIdempotencyKey(), fingerprint };
      }
      const { key } = keyRef.current;
      try {
        const data = await opts.run(client, vars, key);
        keyRef.current = null;
        return data;
      } catch (e) {
        const err = toApiError(e);
        if (!isTransient(err)) keyRef.current = null;
        throw err;
      }
    },
    onSuccess: (data, vars) => {
      opts.onSuccess?.(data, vars, qc);
      for (const k of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: k });
    },
    onError: (err) => {
      handleError(err, { retry, inline: opts.inline, quiet: opts.quiet });
    },
  });

  // Per-call callbacks (the screen's own toast, closing the sheet) must survive a retry, so remember them.
  const baseMutate = mutation.mutate;
  const mutate = useCallback(
    (...args: MutateArgs) => {
      last.current = args;
      baseMutate(...args);
    },
    [baseMutate],
  );
  function retry() {
    if (last.current) baseMutate(...last.current);
  }

  return Object.assign(mutation, { mutate, retry });
}

// ---- cache patch helpers ---------------------------------------------------
//
// Each one writes the server's fresh view into every cached shape that carries it. They are deliberately
// dumb: replace the row, do not recompute anything derived from it. `carryAge`, `completable`,
// `lifeRootId`, `plannedAgeWeeks`, `weeklyBreakdown` and `backlogCount` are all the SERVER's, computed for
// the period the read model was built for, and are only correct in a payload the server built — which is
// why every patch is followed by an invalidation rather than trusted as final.

/**
 * ⚠ **A2** — a lens response holds its goals in TWO arrays (`items` and R-lens-12's `carried` band), and
 * the same goal is never in both. Patching one and forgetting the other would leave a renamed carried goal
 * showing its old title until the refetch landed.
 */
function patchGoal(qc: QueryClient, goal: GoalView) {
  qc.setQueriesData<LensResponse>({ queryKey: keys.goalsAll }, (prev) =>
    prev
      ? {
          ...prev,
          items: prev.items.map((g) => (g.id === goal.id ? goal : g)),
          carried: prev.carried.map((g) => (g.id === goal.id ? goal : g)),
        }
      : prev,
  );
  qc.setQueriesData<GoalDetailResponse>({ queryKey: keys.goalAll(goal.id) }, (prev) => (prev ? { ...prev, goal } : prev));
}

function patchTask(qc: QueryClient, task: TaskDetailView) {
  const replace = (t: TaskView): TaskView => (t.id === task.id ? { ...t, ...task } : t);
  qc.setQueriesData<TasksResponse>({ queryKey: keys.tasksAll }, (prev) => (prev ? { ...prev, tasks: prev.tasks.map(replace) } : prev));
  // The Weekly lens carries its own week's tasks (R-lens-12), so it is patched from the same response.
  qc.setQueriesData<LensResponse>({ queryKey: keys.goalsAll }, (prev) => (prev ? { ...prev, tasks: prev.tasks.map(replace) } : prev));
  qc.setQueryData(keys.task(task.id), (prev: { task: TaskDetailView; serverNow: string } | undefined) =>
    prev ? { ...prev, task } : { task, serverNow: task.updatedAt },
  );
}

/**
 * A task that has EXITED (canceled, moved to backlog) is visible in no week (R-task-32), so it leaves every
 * list rather than being updated in place. Its detail cache keeps the row — the sheet still has to render
 * the `Canceled` / `Moved to Backlog` entry the activity log required (D-15).
 */
function dropTaskFromLists(qc: QueryClient, task: TaskDetailView) {
  qc.setQueriesData<TasksResponse>({ queryKey: keys.tasksAll }, (prev) =>
    prev ? { ...prev, tasks: prev.tasks.filter((t) => t.id !== task.id) } : prev,
  );
  qc.setQueriesData<LensResponse>({ queryKey: keys.goalsAll }, (prev) =>
    prev ? { ...prev, tasks: prev.tasks.filter((t) => t.id !== task.id) } : prev,
  );
  qc.setQueryData(keys.task(task.id), (prev: { task: TaskDetailView; serverNow: string } | undefined) =>
    prev ? { ...prev, task } : prev,
  );
}

function patchBacklogItem(qc: QueryClient, item: BacklogItemView) {
  qc.setQueriesData<BacklogResponse>({ queryKey: keys.backlogAll }, (prev) => {
    if (!prev) return prev;
    const has = prev.items.some((i) => i.id === item.id);
    // A converted item is never listed (D-19), and a moved item may no longer belong to a filtered list —
    // the invalidation that follows settles which; this just stops the stale row being on screen meanwhile.
    if (item.status === 'converted') return { ...prev, items: prev.items.filter((i) => i.id !== item.id) };
    return has ? { ...prev, items: prev.items.map((i) => (i.id === item.id ? item : i)) } : prev;
  });
}

function dropBacklogItem(qc: QueryClient, id: string) {
  qc.setQueriesData<BacklogResponse>({ queryKey: keys.backlogAll }, (prev) =>
    prev ? { ...prev, items: prev.items.filter((i) => i.id !== id) } : prev,
  );
}

function patchLearning(qc: QueryClient, learning: LearningView) {
  qc.setQueryData<LearningsResponse>(keys.learnings, (prev) =>
    prev ? { ...prev, learnings: prev.learnings.map((l) => (l.id === learning.id ? learning : l)) } : prev,
  );
}

/**
 * Everything a week's shape depends on. A lens read carries its own week's tasks (R-lens-12), so a task
 * write moves goals too.
 */
const WEEK_KEYS: readonly (readonly unknown[])[] = [keys.tasksAll, keys.goalsAll, ['bootstrap']];
/** Everything a goal write can move: the lens page, the carried band and the Life lens's own counts. */
const GOAL_KEYS: readonly (readonly unknown[])[] = [keys.goalsAll, ['goal'], ['bootstrap']];

// ---- preferences -----------------------------------------------------------

/** R-nav-12 — the theme (and the timezone, R-auth-5). `PATCH`, so no Idempotency-Key. */
export function usePatchPreferences() {
  return useCommand<Parameters<ApiClient['patchPreferences']>[0], Awaited<ReturnType<ApiClient['patchPreferences']>>>({
    run: (c, v) => c.patchPreferences(v),
    onSuccess: (d, _v, qc) => qc.setQueryData(keys.preferences, d),
    // The owner's timezone decides where every week boundary falls (R-auth-5); a change re-shapes every
    // week-scoped read model, so none of them may be trusted afterwards.
    invalidate: [keys.me, ...WEEK_KEYS],
  });
}

// ---- agent access ----------------------------------------------------------

/**
 * Codes the Agent access section explains next to the password field rather than in a toast.
 *
 * A wrong password is the expected way for this call to fail, and it is not clear which code the API will
 * answer with — 401, 403 and 422 are all defensible for "that password doesn't match" — so all three are
 * quiet here and the section renders its own sentence from the STATUS. `UNAUTHENTICATED` being quiet costs
 * nothing: `presentError` still refreshes `['me']`, and a session that has genuinely expired is caught by
 * the session gate, which is the mechanism that has always owned that.
 *
 * `NOT_FOUND` is quiet for a different reason: until the API ships this route, every call is a 404, and a
 * toast reading "That's no longer here" on a section that has never existed is noise.
 */
const AGENT_TOKEN_QUIET = ['UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION_FAILED', 'RATE_LIMITED', 'NOT_FOUND'] as const;

/**
 * Create or replace the one token, re-authenticated with the password.
 *
 * `useCommand` is what mints the `Idempotency-Key`, and `POST /me/api-token` is behind the API's
 * `idempotent` middleware — a call that bypassed this wrapper would be answered `400
 * IDEMPOTENCY_KEY_MISSING`, which is the shape of a bug this codebase has already had once.
 *
 * The plaintext in the response is **not** written to the cache — only `createdAt` and `last4` are. That is
 * the whole of "show once" on this side of the wire: the secret exists in one component's local state and
 * in nothing that outlives it. Both are read from `token`, where the server nests them next to the
 * plaintext, and both are optional in the parsed shape (`http.ts`), so both have a local fallback.
 */
export function useCreateAgentToken() {
  return useCommand<{ password: string }, Awaited<ReturnType<ApiClient['createAgentToken']>>>({
    run: (c, v, k) => c.createAgentToken({ password: v.password }, k),
    // Patched only when a status read has already landed: `ApiTokenStatusResponse` carries `mcpUrl` and
    // `serverNow` too, and half a response is not a read model. The invalidation below fetches the rest.
    onSuccess: (d, _v, qc) =>
      qc.setQueryData<ApiTokenStatusResponse>(keys.agentToken, (prev) =>
        prev
          ? {
              ...prev,
              token: { createdAt: d.token.createdAt ?? new Date().toISOString(), last4: d.token.last4 ?? d.token.plaintext.slice(-4) },
            }
          : prev,
      ),
    invalidate: [keys.agentToken],
    inline: true,
    quiet: AGENT_TOKEN_QUIET,
  });
}

/** Idempotent revoke — and no `Idempotency-Key`: the route carries no `idempotent` middleware, by design. */
export function useRevokeAgentToken() {
  return useCommand<void, Awaited<ReturnType<ApiClient['revokeAgentToken']>>>({
    run: (c) => c.revokeAgentToken(),
    onSuccess: (_d, _v, qc) => qc.setQueryData<ApiTokenStatusResponse>(keys.agentToken, (prev) => (prev ? { ...prev, token: null } : prev)),
    invalidate: [keys.agentToken],
    inline: true,
    quiet: AGENT_TOKEN_QUIET,
  });
}

// ---- goals -----------------------------------------------------------------

export function useCreateGoal() {
  return useCommand<Parameters<ApiClient['createGoal']>[0], Awaited<ReturnType<ApiClient['createGoal']>>>({
    run: (c, v, k) => c.createGoal(v, k),
    // No patch: a new goal changes its group's membership, its parent's planned-ness line (R-goal-47) and
    // the lens ordering (Q-7), none of which this response carries. The refetch is the honest answer.
    invalidate: GOAL_KEYS,
    inline: true,
  });
}

export function usePatchGoal() {
  return useCommand<{ id: string; patch: Parameters<ApiClient['patchGoal']>[1] }, Awaited<ReturnType<ApiClient['patchGoal']>>>({
    run: (c, v) => c.patchGoal(v.id, v.patch),
    onSuccess: (d, _v, qc) => patchGoal(qc, d.goal),
    invalidate: GOAL_KEYS,
    inline: true,
  });
}

export function useMoveGoal() {
  return useCommand<{ id: string; parentId: string; version?: number }, Awaited<ReturnType<ApiClient['moveGoal']>>>({
    run: (c, v, k) => c.moveGoal(v.id, { parentId: v.parentId, ...(v.version ? { version: v.version } : {}) }, k),
    onSuccess: (d, _v, qc) => patchGoal(qc, d.goal),
    // Descendants moved with it, so every group membership below it may have changed: refetch.
    invalidate: GOAL_KEYS,
    inline: true,
  });
}

/** ⚠ **A2 (R-goal-40)** — re-plan writes `periodKey`. A Weekly goal is not re-plannable at all. */
export function useReplanGoal() {
  return useCommand<{ id: string; periodKey: string; reason?: string; version?: number }, Awaited<ReturnType<ApiClient['replanGoal']>>>({
    run: (c, v, k) =>
      c.replanGoal(v.id, { periodKey: v.periodKey, ...(v.reason ? { reason: v.reason } : {}), ...(v.version ? { version: v.version } : {}) }, k),
    onSuccess: (d, _v, qc) => patchGoal(qc, d.goal),
    invalidate: GOAL_KEYS,
    inline: true,
  });
}

/**
 * R-goal-46, amended — `Repeat last week` into one week. `lifeGoalId` is **optional now**: absent means
 * every Life line, which is the honest flat version of a control that used to live at a group foot. It
 * creates ORDINARY goals — no template, no series and no recurrence machinery to keep in step — so nothing
 * is patched and the refetch is what the new rows arrive on.
 */
export function useRepeatWeek() {
  return useCommand<{ lifeGoalId?: string; weekStart: string }, Awaited<ReturnType<ApiClient['repeatWeek']>>>({
    run: (c, v, k) => c.repeatWeek({ weekStart: v.weekStart, ...(v.lifeGoalId ? { lifeGoalId: v.lifeGoalId } : {}) }, k),
    invalidate: GOAL_KEYS,
    inline: true,
  });
}

/**
 * Q-5 — without `cascade` a goal that still has children is refused with `GOAL_HAS_CHILDREN` and the counts
 * in `details`, which is exactly what the confirmation sheet renders. That refusal is therefore expected
 * flow, not an error to toast.
 */
export function useDeleteGoal() {
  return useCommand<{ id: string; cascade?: boolean }, Awaited<ReturnType<ApiClient['deleteGoal']>>>({
    run: (c, v) => c.deleteGoal(v.id, { ...(v.cascade ? { cascade: true } : {}) }),
    // A cascade removes weekly goals, tasks and backlog items and un-tags learnings: everything moved.
    invalidate: [...GOAL_KEYS, keys.tasksAll, keys.backlogAll, keys.learnings],
    inline: true,
    quiet: ['GOAL_HAS_CHILDREN'],
  });
}

// ---- tasks -----------------------------------------------------------------

/**
 * ⚠ **A2 (R-task-48/49)** — the request carries `goalId` **or** `newWeeklyGoal`, never both and never
 * neither, and the response carries the Weekly goal that was created when one was, so the caller can say
 * so and move the lens to its week. Nothing may be created invisibly.
 */
export function useCreateTask() {
  return useCommand<Parameters<ApiClient['createTask']>[0], Awaited<ReturnType<ApiClient['createTask']>>>({
    run: (c, v, k) => c.createTask(v, k),
    invalidate: WEEK_KEYS,
    inline: true,
  });
}

export function usePatchTask() {
  return useCommand<{ id: string; patch: Parameters<ApiClient['patchTask']>[1] }, Awaited<ReturnType<ApiClient['patchTask']>>>({
    run: (c, v) => c.patchTask(v.id, v.patch),
    onSuccess: (d, _v, qc) => patchTask(qc, d.task),
    invalidate: [keys.tasksAll],
    inline: true,
  });
}

/**
 * Exit 1 of 3 (R-task-14). The week is explicit because past weeks stay fully interactive (R-nav-5) and a
 * completion belongs to the week it was made in (R-task-8) — not to "now".
 */
export function useCompleteTask() {
  const { currentMonday } = useWeekClock();
  return useCommand<{ id: string; week?: number; version?: number }, Awaited<ReturnType<ApiClient['completeTask']>>>({
    run: (c, v, k) => c.completeTask(v.id, { period: addWeeks(currentMonday, v.week ?? 0), ...(v.version ? { version: v.version } : {}) }, k),
    onSuccess: (d, _v, qc) => patchTask(qc, d.task),
    invalidate: WEEK_KEYS,
  });
}

/** R-task-19/21 — not an exit. `cond` is the skippable inline edit; omitted or unchanged logs nothing. */
export function useUncheckTask() {
  return useCommand<{ id: string; cond?: string; version?: number }, Awaited<ReturnType<ApiClient['uncheckTask']>>>({
    run: (c, v, k) => c.uncheckTask(v.id, { ...(v.cond !== undefined ? { cond: v.cond } : {}), ...(v.version ? { version: v.version } : {}) }, k),
    onSuccess: (d, _v, qc) => patchTask(qc, d.task),
    invalidate: WEEK_KEYS,
  });
}

/** Exit 2 of 3 (R-task-15) — the response carries both the exited task and the item it became. */
export function useMoveTaskToBacklog() {
  const { currentMonday } = useWeekClock();
  return useCommand<{ id: string; week?: number; reason?: string; version?: number }, Awaited<ReturnType<ApiClient['moveTaskToBacklog']>>>({
    run: (c, v, k) =>
      c.moveTaskToBacklog(
        v.id,
        { period: addWeeks(currentMonday, v.week ?? 0), ...(v.reason ? { reason: v.reason } : {}), ...(v.version ? { version: v.version } : {}) },
        k,
      ),
    onSuccess: (d, _v, qc) => {
      dropTaskFromLists(qc, d.task);
      patchBacklogItem(qc, d.item);
    },
    invalidate: [...WEEK_KEYS, keys.backlogAll],
  });
}

/** Exit 3 of 3 (R-task-16). The row survives with `status: 'canceled'` — the log entry needs somewhere to live. */
export function useCancelTask() {
  return useCommand<{ id: string; reason?: string; version?: number }, Awaited<ReturnType<ApiClient['cancelTask']>>>({
    run: (c, v, k) => c.cancelTask(v.id, { ...(v.reason ? { reason: v.reason } : {}), ...(v.version ? { version: v.version } : {}) }, k),
    onSuccess: (d, _v, qc) => dropTaskFromLists(qc, d.task),
    invalidate: WEEK_KEYS,
  });
}

export function useAddTaskLink() {
  return useCommand<{ id: string; url: string }, Awaited<ReturnType<ApiClient['addTaskLink']>>>({
    run: (c, v, k) => c.addTaskLink(v.id, { url: v.url }, k),
    onSuccess: (d, _v, qc) => patchTask(qc, d.task),
    invalidate: [keys.tasksAll],
    inline: true,
  });
}

/** D-13 — by link id, never by list index: the mockup's index-based removal deleted the wrong row on a race. */
export function useRemoveTaskLink() {
  return useCommand<{ id: string; linkId: string }, Awaited<ReturnType<ApiClient['removeTaskLink']>>>({
    run: (c, v) => c.removeTaskLink(v.id, v.linkId),
    onSuccess: (d, _v, qc) => patchTask(qc, d.task),
    invalidate: [keys.tasksAll],
    inline: true,
  });
}

// ---- backlog ---------------------------------------------------------------

export function useCreateBacklogItem() {
  return useCommand<Parameters<ApiClient['createBacklogItem']>[0], Awaited<ReturnType<ApiClient['createBacklogItem']>>>({
    run: (c, v, k) => c.createBacklogItem(v, k),
    // R-goal-25 — the tree row's `N in backlog` count moved.
    invalidate: [keys.backlogAll, ...GOAL_KEYS],
    inline: true,
  });
}

export function usePatchBacklogItem() {
  return useCommand<
    { id: string; patch: Parameters<ApiClient['patchBacklogItem']>[1] },
    Awaited<ReturnType<ApiClient['patchBacklogItem']>>
  >({
    run: (c, v) => c.patchBacklogItem(v.id, v.patch),
    onSuccess: (d, _v, qc) => patchBacklogItem(qc, d.item),
    invalidate: [keys.backlogAll, ['goal']],
    inline: true,
  });
}

export function useMoveBacklogItem() {
  return useCommand<{ id: string; goalId: string; version?: number }, Awaited<ReturnType<ApiClient['moveBacklogItem']>>>({
    run: (c, v, k) => c.moveBacklogItem(v.id, { goalId: v.goalId, ...(v.version ? { version: v.version } : {}) }, k),
    onSuccess: (d, _v, qc) => patchBacklogItem(qc, d.item),
    invalidate: [keys.backlogAll, ...GOAL_KEYS],
  });
}

/**
 * R-backlog-19 — **the one write behind every reorder affordance in the app.**
 *
 * Drag, grab mode and the row menu's four items all end up here, which is what R-backlog-24 means by
 * "drag is a second front-end on one command": there is no drag-only write path and no drag-only
 * ordering semantics, so a drag and an arrow press cannot disagree about what happened.
 *
 * `quiet` on `CONCURRENT_UPDATE`: the list announces its own failure line into the live region and shows
 * a non-toast error beside the row (R-backlog-23, Q-14, R-nav-13). A toast alone is insufficient for a
 * lost write, and two messages for one failure is worse than one.
 *
 * The response is deliberately NOT patched into the cache. A reorder can re-key a whole goal's list
 * server-side, so the one item that came back is not enough to reconstruct the order — the invalidation
 * is what settles it, and the list renders its own optimistic arrangement until then.
 */
export function useReorderBacklogItem() {
  return useCommand<
    { id: string; after?: string; before?: string; to?: 'top' | 'bottom'; version?: number },
    Awaited<ReturnType<ApiClient['reorderBacklogItem']>>
  >({
    run: (c, v, k) =>
      c.reorderBacklogItem(
        v.id,
        {
          ...(v.after ? { after: v.after } : {}),
          ...(v.before ? { before: v.before } : {}),
          ...(v.to ? { to: v.to } : {}),
          ...(v.version ? { version: v.version } : {}),
        },
        k,
      ),
    invalidate: [keys.backlogAll, ...GOAL_KEYS],
    quiet: ['CONCURRENT_UPDATE', 'VALIDATION_FAILED'],
  });
}

export function useDeleteBacklogItem() {
  return useCommand<{ id: string }, Awaited<ReturnType<ApiClient['deleteBacklogItem']>>>({
    run: (c, v) => c.deleteBacklogItem(v.id),
    onSuccess: (_d, v, qc) => dropBacklogItem(qc, v.id),
    invalidate: [keys.backlogAll, ...GOAL_KEYS],
  });
}

/**
 * R-backlog-26 — "Add to this week", the ONE way backlog becomes work.
 *
 * ⚠ **A2** — the receiving goal is the **Weekly goal at or under the item's goal for the target week**, not
 * an "active leaf". `goalId` is required only when more than one such goal exists (D-18 forbids the server
 * picking silently, and the id it would pick decides which week the task belongs to for the rest of its
 * life). With **none**, the server answers `NO_WEEKLY_GOAL` and the sheet offers `newWeeklyGoal` inline
 * (R-task-48) rather than sending the owner away — hence `quiet`, and hence no dead end.
 */
export function useConvertBacklogItem() {
  return useCommand<
    {
      id: string;
      goalId?: string;
      newWeeklyGoal?: { parentId: string; title: string };
      week?: number;
      title?: string;
      cond?: string;
      version?: number;
    },
    Awaited<ReturnType<ApiClient['convertBacklogItem']>>
  >({
    run: (c, v, k) =>
      c.convertBacklogItem(
        v.id,
        {
          ...(v.goalId ? { goalId: v.goalId } : {}),
          ...(v.newWeeklyGoal ? { newWeeklyGoal: v.newWeeklyGoal } : {}),
          week: v.week ?? 0,
          ...(v.title ? { title: v.title } : {}),
          cond: v.cond ?? '',
          ...(v.version ? { version: v.version } : {}),
        },
        k,
      ),
    onSuccess: (d, _v, qc) => {
      patchBacklogItem(qc, d.item);
      patchTask(qc, d.task);
    },
    invalidate: [keys.backlogAll, ...WEEK_KEYS, ['goal']],
    inline: true,
    quiet: ['NO_WEEKLY_GOAL', 'ALREADY_CONVERTED'],
  });
}

// ---- learnings -------------------------------------------------------------

export function useCreateLearning() {
  return useCommand<Parameters<ApiClient['createLearning']>[0], Awaited<ReturnType<ApiClient['createLearning']>>>({
    run: (c, v, k) => c.createLearning(v, k),
    invalidate: [keys.learnings, ['goal'], ['bootstrap']],
    inline: true,
  });
}

/** R-learning-4 / D-23 — `applied` is the "changed the plan" badge, and it has to be earnable by an action. */
export function usePatchLearning() {
  return useCommand<{ id: string; patch: Parameters<ApiClient['patchLearning']>[1] }, Awaited<ReturnType<ApiClient['patchLearning']>>>({
    run: (c, v) => c.patchLearning(v.id, v.patch),
    onSuccess: (d, _v, qc) => patchLearning(qc, d.learning),
    invalidate: [keys.learnings, ['goal']],
    inline: true,
  });
}

export function useDeleteLearning() {
  return useCommand<{ id: string }, Awaited<ReturnType<ApiClient['deleteLearning']>>>({
    run: (c, v) => c.deleteLearning(v.id),
    onSuccess: (_d, v, qc) =>
      qc.setQueryData<LearningsResponse>(keys.learnings, (prev) =>
        prev ? { ...prev, learnings: prev.learnings.filter((l) => l.id !== v.id) } : prev,
      ),
    invalidate: [keys.learnings, ['goal'], ['bootstrap']],
  });
}

/** R-learning-3 — re-tag to another Life goal, or `null` for Unsorted. Never converted into work. */
export function useAttachLearning() {
  return useCommand<{ id: string; goalId: string | null; version?: number }, Awaited<ReturnType<ApiClient['attachLearning']>>>({
    run: (c, v, k) => c.attachLearning(v.id, { goalId: v.goalId, ...(v.version ? { version: v.version } : {}) }, k),
    onSuccess: (d, _v, qc) => patchLearning(qc, d.learning),
    invalidate: [keys.learnings, ['goal']],
    inline: true,
  });
}
