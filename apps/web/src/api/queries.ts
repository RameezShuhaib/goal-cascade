import { useCallback, useRef } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient, type UseMutationResult } from '@tanstack/react-query';
import type {
  BacklogItemView,
  BacklogResponse,
  GoalDetailResponse,
  GoalView,
  GoalsResponse,
  IdeasResponse,
  LearningView,
  LearningsResponse,
  PlanResponse,
  TaskDetailView,
  TaskView,
  TasksResponse,
} from '@goal-cascade/shared';
import { useApi } from '../context/ApiContext';
import { useUI } from '../context/UIContext';
import { newIdempotencyKey, type ApiClient } from './http';
import { isApiError, isTransient, toApiError, type ApiError, type ApiErrorCode } from './errors';
import { presentError, type Refresh } from '../lib/errorCopy';
import { keys, shouldRetry } from '../lib/queryClient';
import { recordLiveIdentity } from '../auth/identity';

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
const READ_MODEL = { staleTime: 30_000 } as const;

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

/** Everything for one week in one request — the cold-open read (the mockup's `fetchAll`). */
export function useBootstrap(week = 0) {
  const client = useApi();
  const enabled = useSignedIn();
  return useQuery({ queryKey: keys.bootstrap(week), queryFn: () => client.bootstrap(week), enabled, ...READ_MODEL });
}

/** The whole tree, flat, with the derived flags computed for `week` (R-goal-8..11, R-goal-25). */
export function useGoals(week = 0) {
  const client = useApi();
  const enabled = useSignedIn();
  return useQuery({ queryKey: keys.goals(week), queryFn: () => client.goals(week), enabled, ...READ_MODEL });
}

/** R-goal-27 — one goal's detail screen: the goal, its ancestors, children, backlog and learnings. */
export function useGoal(id: string | null, week = 0) {
  const client = useApi();
  const enabled = useSignedIn() && !!id;
  return useQuery({ queryKey: keys.goal(id ?? '', week), queryFn: () => client.goal(id!, week), enabled, ...READ_MODEL });
}

/** D-2 — any addressable week's focus set; a past week renders the sentences it actually had. */
export function usePlan(week = 0) {
  const client = useApi();
  const enabled = useSignedIn();
  return useQuery({ queryKey: keys.plan(week), queryFn: () => client.plan(week), enabled, ...READ_MODEL });
}

/** R-nav-8 — the tasks visible in one week, with that week's plan alongside. Visibility is server-applied. */
export function useTasks(week = 0, goalId?: string) {
  const client = useApi();
  const enabled = useSignedIn();
  return useQuery({
    queryKey: keys.tasks(week, goalId),
    queryFn: () => client.tasks({ week, ...(goalId ? { goalId } : {}) }),
    enabled,
    ...READ_MODEL,
  });
}

/** R-task-30 — one task with its full activity log. Lists omit `events`; only the detail sheet needs them. */
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

export function useIdeas() {
  const client = useApi();
  const enabled = useSignedIn();
  return useQuery({ queryKey: keys.ideas, queryFn: () => client.ideas(), enabled, ...READ_MODEL });
}

export function useLearnings() {
  const client = useApi();
  const enabled = useSignedIn();
  return useQuery({ queryKey: keys.learnings, queryFn: () => client.learnings(), enabled, ...READ_MODEL });
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
    case 'plan':
      inv(keys.planAll);
      inv(keys.goalsAll);
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
      inv(keys.planAll);
      inv(keys.ideas);
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
// dumb: replace the row, do not recompute anything derived from it. `isLeaf`, `isActive`, `carryWeeks`,
// `backlogCount` and friends are the server's (R-goal-8..11) and are only correct in a payload the server
// built — which is why every patch is followed by an invalidation rather than trusted as final.

function patchGoal(qc: QueryClient, goal: GoalView) {
  qc.setQueriesData<GoalsResponse>({ queryKey: keys.goalsAll }, (prev) =>
    prev ? { ...prev, goals: prev.goals.map((g) => (g.id === goal.id ? goal : g)) } : prev,
  );
  qc.setQueriesData<GoalDetailResponse>({ queryKey: keys.goalAll(goal.id) }, (prev) => (prev ? { ...prev, goal } : prev));
}

function patchTask(qc: QueryClient, task: TaskDetailView) {
  qc.setQueriesData<TasksResponse>({ queryKey: keys.tasksAll }, (prev) =>
    prev ? { ...prev, tasks: prev.tasks.map((t): TaskView => (t.id === task.id ? task : t)) } : prev,
  );
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

function dropIdea(qc: QueryClient, id: string) {
  qc.setQueryData<IdeasResponse>(keys.ideas, (prev) => (prev ? { ...prev, ideas: prev.ideas.filter((i) => i.id !== id) } : prev));
}

function patchLearning(qc: QueryClient, learning: LearningView) {
  qc.setQueryData<LearningsResponse>(keys.learnings, (prev) =>
    prev ? { ...prev, learnings: prev.learnings.map((l) => (l.id === learning.id ? learning : l)) } : prev,
  );
}

/** Everything a week's shape depends on. A plan save changes which leaves are active, so goals move too. */
const WEEK_KEYS: readonly (readonly unknown[])[] = [keys.tasksAll, keys.planAll, keys.goalsAll, ['bootstrap']];

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

// ---- goals -----------------------------------------------------------------

export function useCreateGoal() {
  return useCommand<Parameters<ApiClient['createGoal']>[0], Awaited<ReturnType<ApiClient['createGoal']>>>({
    run: (c, v, k) => c.createGoal(v, k),
    // No patch: a new goal changes its parent's `isLeaf`, `branches` and the whole ordering (Q-7), none of
    // which this response carries. The refetch is the honest answer.
    invalidate: [keys.goalsAll, ['goal'], ['bootstrap']],
    inline: true,
  });
}

export function usePatchGoal() {
  return useCommand<{ id: string; patch: Parameters<ApiClient['patchGoal']>[1] }, Awaited<ReturnType<ApiClient['patchGoal']>>>({
    run: (c, v) => c.patchGoal(v.id, v.patch),
    onSuccess: (d, _v, qc) => patchGoal(qc, d.goal),
    invalidate: [keys.goalsAll, ['goal'], ['bootstrap']],
    inline: true,
  });
}

export function useMoveGoal() {
  return useCommand<{ id: string; parentId: string; version?: number }, Awaited<ReturnType<ApiClient['moveGoal']>>>({
    run: (c, v, k) => c.moveGoal(v.id, { parentId: v.parentId, ...(v.version ? { version: v.version } : {}) }, k),
    onSuccess: (d, _v, qc) => patchGoal(qc, d.goal),
    // Descendants moved with it and every ancestor's `branches` roll-up changed: refetch the tree.
    invalidate: [keys.goalsAll, ['goal'], ['bootstrap']],
    inline: true,
  });
}

export function useReplanGoal() {
  return useCommand<{ id: string; period: string; reason?: string; version?: number }, Awaited<ReturnType<ApiClient['replanGoal']>>>({
    run: (c, v, k) =>
      c.replanGoal(v.id, { period: v.period, ...(v.reason ? { reason: v.reason } : {}), ...(v.version ? { version: v.version } : {}) }, k),
    onSuccess: (d, _v, qc) => patchGoal(qc, d.goal),
    invalidate: [keys.goalsAll, ['goal']],
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
    // A cascade removes tasks, focuses and backlog items and un-tags ideas and learnings: everything moved.
    invalidate: [keys.goalsAll, ['goal'], keys.tasksAll, keys.backlogAll, keys.planAll, keys.ideas, keys.learnings, ['bootstrap']],
    inline: true,
    quiet: ['GOAL_HAS_CHILDREN'],
  });
}

// ---- the weekly plan -------------------------------------------------------

/**
 * R-plan-7 — the whole week, atomically. This is a REPLACE: any non-Life leaf absent from `entries`, or
 * named with a blank sentence, has its focus for that week cleared.
 *
 * R-plan-2 / Q-3 — a save that names anything but the current week is refused wholesale with
 * `WEEK_NOT_CURRENT`, never partly applied. Sending `weekStart` explicitly (rather than letting the server
 * assume "now") is what makes a save that crossed a Monday boundary fail loudly instead of writing into the
 * wrong week.
 */
export function useSavePlan() {
  return useCommand<Parameters<ApiClient['savePlan']>[0], Awaited<ReturnType<ApiClient['savePlan']>>>({
    run: (c, v, k) => c.savePlan(v, k),
    onSuccess: (d, _v, qc) => qc.setQueryData<PlanResponse>(keys.plan(d.week.offset), d),
    // Activity is "a focus row exists this week" (D-2), so every goal's `isActive` / `subtreeActive` /
    // `focus` just changed, and with them which leaves get a section on the Tasks screen.
    invalidate: WEEK_KEYS,
    inline: true,
  });
}

// ---- tasks -----------------------------------------------------------------

export function useCreateTask() {
  return useCommand<Parameters<ApiClient['createTask']>[0], Awaited<ReturnType<ApiClient['createTask']>>>({
    run: (c, v, k) => c.createTask(v, k),
    invalidate: [keys.tasksAll, keys.goalsAll, ['bootstrap']],
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
  return useCommand<{ id: string; week?: number; version?: number }, Awaited<ReturnType<ApiClient['completeTask']>>>({
    run: (c, v, k) => c.completeTask(v.id, { week: v.week ?? 0, ...(v.version ? { version: v.version } : {}) }, k),
    onSuccess: (d, _v, qc) => patchTask(qc, d.task),
    invalidate: [keys.tasksAll, keys.goalsAll, ['bootstrap']],
  });
}

/** R-task-19/21 — not an exit. `cond` is the skippable inline edit; omitted or unchanged logs nothing. */
export function useUncheckTask() {
  return useCommand<{ id: string; cond?: string; version?: number }, Awaited<ReturnType<ApiClient['uncheckTask']>>>({
    run: (c, v, k) => c.uncheckTask(v.id, { ...(v.cond !== undefined ? { cond: v.cond } : {}), ...(v.version ? { version: v.version } : {}) }, k),
    onSuccess: (d, _v, qc) => patchTask(qc, d.task),
    invalidate: [keys.tasksAll, keys.goalsAll, ['bootstrap']],
  });
}

/** Exit 2 of 3 (R-task-15) — the response carries both the exited task and the item it became. */
export function useMoveTaskToBacklog() {
  return useCommand<{ id: string; week?: number; reason?: string; version?: number }, Awaited<ReturnType<ApiClient['moveTaskToBacklog']>>>({
    run: (c, v, k) =>
      c.moveTaskToBacklog(
        v.id,
        { week: v.week ?? 0, ...(v.reason ? { reason: v.reason } : {}), ...(v.version ? { version: v.version } : {}) },
        k,
      ),
    onSuccess: (d, _v, qc) => {
      dropTaskFromLists(qc, d.task);
      patchBacklogItem(qc, d.item);
    },
    invalidate: [keys.tasksAll, keys.backlogAll, keys.goalsAll, ['bootstrap']],
  });
}

/** Exit 3 of 3 (R-task-16). The row survives with `status: 'canceled'` — the log entry needs somewhere to live. */
export function useCancelTask() {
  return useCommand<{ id: string; reason?: string; version?: number }, Awaited<ReturnType<ApiClient['cancelTask']>>>({
    run: (c, v, k) => c.cancelTask(v.id, { ...(v.reason ? { reason: v.reason } : {}), ...(v.version ? { version: v.version } : {}) }, k),
    onSuccess: (d, _v, qc) => dropTaskFromLists(qc, d.task),
    invalidate: [keys.tasksAll, keys.goalsAll, ['bootstrap']],
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
    invalidate: [keys.backlogAll, keys.goalsAll, ['goal'], ['bootstrap']],
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
    invalidate: [keys.backlogAll, keys.goalsAll, ['goal'], ['bootstrap']],
  });
}

export function useDeleteBacklogItem() {
  return useCommand<{ id: string }, Awaited<ReturnType<ApiClient['deleteBacklogItem']>>>({
    run: (c, v) => c.deleteBacklogItem(v.id),
    onSuccess: (_d, v, qc) => dropBacklogItem(qc, v.id),
    invalidate: [keys.backlogAll, keys.goalsAll, ['goal'], ['bootstrap']],
  });
}

/**
 * R-backlog-6/7/8/9 — "Add to this week", the ONE way backlog becomes work.
 *
 * `goalId` names the ACTIVE leaf that receives the task and is required whenever more than one such leaf
 * sits under the item's goal: D-18 forbids the server picking silently. With no active leaf at all the call
 * is refused with `BRANCH_NOT_ACTIVE`, which the "this branch isn't active this week" sheet explains — hence
 * `quiet`.
 */
export function useConvertBacklogItem() {
  return useCommand<
    { id: string; goalId?: string; title?: string; cond?: string; version?: number },
    Awaited<ReturnType<ApiClient['convertBacklogItem']>>
  >({
    run: (c, v, k) =>
      c.convertBacklogItem(
        v.id,
        {
          ...(v.goalId ? { goalId: v.goalId } : {}),
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
    invalidate: [keys.backlogAll, keys.tasksAll, keys.goalsAll, ['goal'], ['bootstrap']],
    inline: true,
    quiet: ['BRANCH_NOT_ACTIVE', 'ALREADY_CONVERTED'],
  });
}

// ---- ideas -----------------------------------------------------------------

export function useCreateIdea() {
  return useCommand<Parameters<ApiClient['createIdea']>[0], Awaited<ReturnType<ApiClient['createIdea']>>>({
    run: (c, v, k) => c.createIdea(v, k),
    invalidate: [keys.ideas, ['bootstrap']],
    inline: true,
  });
}

export function useDeleteIdea() {
  return useCommand<{ id: string }, Awaited<ReturnType<ApiClient['deleteIdea']>>>({
    run: (c, v) => c.deleteIdea(v.id),
    onSuccess: (_d, v, qc) => dropIdea(qc, v.id),
    invalidate: [keys.ideas, ['bootstrap']],
  });
}

/** R-idea-5 — the idea becomes a backlog item on the chosen non-Life goal and is consumed, in one transaction. */
export function useAttachIdea() {
  return useCommand<{ id: string; goalId: string }, Awaited<ReturnType<ApiClient['attachIdea']>>>({
    run: (c, v, k) => c.attachIdea(v.id, { goalId: v.goalId }, k),
    onSuccess: (d, _v, qc) => {
      dropIdea(qc, d.ideaId);
      patchBacklogItem(qc, d.item);
    },
    invalidate: [keys.ideas, keys.backlogAll, keys.goalsAll, ['goal'], ['bootstrap']],
    inline: true,
  });
}

/**
 * R-idea-4 / D-22 — "Task this week". The idea is consumed ONLY on successful creation: the mockup deleted
 * it before the modal was saved and lost it on cancel, in the one feature whose whole promise is "capture it
 * and get back to work".
 */
export function useConvertIdea() {
  return useCommand<{ id: string; goalId: string; title?: string; cond?: string }, Awaited<ReturnType<ApiClient['convertIdea']>>>({
    run: (c, v, k) => c.convertIdea(v.id, { goalId: v.goalId, ...(v.title ? { title: v.title } : {}), cond: v.cond ?? '' }, k),
    onSuccess: (d, _v, qc) => {
      dropIdea(qc, d.ideaId);
      patchTask(qc, d.task);
    },
    invalidate: [keys.ideas, keys.tasksAll, keys.goalsAll, ['bootstrap']],
    inline: true,
    quiet: ['BRANCH_NOT_ACTIVE', 'NOT_A_LEAF'],
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
