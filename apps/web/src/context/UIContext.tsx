import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Everything the SERVER does not know, and nothing it does.
 *
 * The rule this file exists to enforce: React Query owns every read model; this context owns which screen is
 * showing, which sheet is open, what is filtered, which week is being looked at, the toast, and the session
 * epoch. There is no `goals` array here, no `tasks` array, no `backlog`. If a value can be answered by an
 * endpoint, it does not belong in this file — it belongs in `api/queries.ts`, where caching, refetching,
 * staleness and errors are already solved.
 *
 * (The mockup's `store.tsx` mixed both halves in one 405-line class. Splitting it is the whole point of this
 * layer: see `docs/work/06-web-data/build.md` for the method-by-method map.)
 *
 * FORM DRAFTS ARE NOT HERE EITHER. The mockup kept `gmTitle`, `dtCond`, `bdLinks` and two dozen siblings in
 * global state, which is why every keystroke re-rendered every screen. A sheet's draft is local state inside
 * that sheet; this context only says WHICH sheet is open and what it is about.
 */

/** R-nav-1/2 — four tabs plus two screens that have no tab of their own (goal detail, backlog). */
export type Screen = 'tasks' | 'goals' | 'goal' | 'backlog' | 'learnings' | 'plan';

/**
 * The open overlay, as a discriminated union carrying what it is about. One `sheet` field replaces the
 * mockup's parallel `dtId` / `tmOpen` / `cfOpen` / `ibOpen` / `gmOpen` / `mvOpen` booleans, which could
 * (and did) all be true at once.
 */
export type Sheet =
  | { kind: 'taskDetail'; taskId: string }
  | { kind: 'taskCreate'; goalId: string; title?: string; fromBacklogId?: string }
  | { kind: 'backlogDrawer'; goalId?: string }
  /** R-task-15/16 — the confirm sheet for exit 2 and exit 3, both of which take an optional reason. */
  | { kind: 'confirmTaskExit'; taskId: string; exit: 'backlog' | 'cancel' }
  /** R-task-21 — the skippable "update the done-condition?" prompt after an uncheck. */
  | { kind: 'uncheck'; taskId: string }
  /** R-goal-22/23 — re-plan to a contextual next period, with an optional one-line reason. */
  | { kind: 'confirmReplan'; goalId: string }
  /** Q-5 — the "N sub-goals, M tasks, K backlog items" acknowledgement before a cascade delete. */
  | { kind: 'confirmDeleteGoal'; goalId: string }
  /** R-backlog-8 — "This branch isn't active this week" → [Set a weekly focus] / [Cancel]. */
  | { kind: 'inactiveBranch'; itemId: string; title: string }
  | { kind: 'goalForm'; editId: string | null; parentId: string | null }
  | { kind: 'moveGoal'; goalId: string }
  | { kind: 'weekPicker' };

export interface ToastAction {
  label: string;
  onClick: () => void;
}
export interface ToastOptions {
  tone?: 'default' | 'error';
  action?: ToastAction;
}
export interface ToastState extends ToastOptions {
  message: string;
  tone: 'default' | 'error';
}

/** R-nav-13 — toasts are transient confirmations, ~2.6s, and never the only record of a state change. */
const TOAST_MS = 2600;
const TOAST_ERROR_MS = 4200;

export interface UIState {
  screen: Screen;
  setScreen: (s: Screen) => void;
  /** Which goal the detail screen (`screen === 'goal'`) is showing. */
  goalId: string | null;
  /** R-nav-2 — opening a goal detail keeps the Goals tab lit; this does both in one call. */
  openGoal: (id: string) => void;

  sheet: Sheet | null;
  openSheet: (s: Sheet) => void;
  closeSheet: () => void;

  /**
   * The week being looked at, as an OFFSET (0 = this week, negative = past). R-nav-3: a positive offset is
   * not representable in the UI because no control can produce one and the API refuses it.
   */
  viewedWeek: number;
  /** R-nav-6 — changing the week resets the goal filter to `All`. One call, so it cannot be half-done. */
  selectWeek: (offset: number) => void;

  /** R-nav-7 — the Tasks screen's Life-root filter pill. `null` = All. */
  taskGoalFilter: string | null;
  setTaskGoalFilter: (id: string | null) => void;
  /** The Backlog page's goal filter. `null` = every goal. */
  backlogGoalFilter: string | null;
  setBacklogGoalFilter: (id: string | null) => void;

  /** Collapsed goal-tree rows, by goal id. Purely visual; the server has no opinion. */
  collapsed: Record<string, boolean>;
  toggleCollapsed: (id: string) => void;
  /** The goal row whose `…` menu is open. */
  menuGoalId: string | null;
  setMenuGoalId: (id: string | null) => void;

  toast: ToastState | null;
  showToast: (message: string, opts?: ToastOptions) => void;
  hideToast: () => void;

  /**
   * Bumped on sign-out. `<App key={sessionEpoch} />` remounts the whole tree so every query observer starts
   * clean against the cleared cache. Cheap, and far more reliable than resetting state by hand — a missed
   * field is a signed-out screen still showing the last account's goal titles.
   */
  sessionEpoch: number;
  resetSession: () => void;
}

const UICtx = createContext<UIState | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [screen, setScreen] = useState<Screen>('tasks');
  const [goalId, setGoalId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [viewedWeek, setViewedWeek] = useState(0);
  const [taskGoalFilter, setTaskGoalFilter] = useState<string | null>(null);
  const [backlogGoalFilter, setBacklogGoalFilter] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [menuGoalId, setMenuGoalId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const openGoal = useCallback((id: string) => {
    setGoalId(id);
    setScreen('goal');
    setMenuGoalId(null);
  }, []);

  const openSheet = useCallback((s: Sheet) => {
    setSheet(s);
    setMenuGoalId(null);
  }, []);
  const closeSheet = useCallback(() => setSheet(null), []);

  const selectWeek = useCallback((offset: number) => {
    // R-nav-3 — future weeks are not selectable anywhere. Clamping here means no caller can produce one,
    // not even by arithmetic on a chevron.
    setViewedWeek(Math.min(0, offset));
    setTaskGoalFilter(null);
    setSheet((s) => (s?.kind === 'weekPicker' ? null : s));
  }, []);

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsed((c) => ({ ...c, [id]: !c[id] }));
  }, []);

  const hideToast = useCallback(() => {
    clearTimeout(timer.current);
    setToast(null);
  }, []);

  const showToast = useCallback((message: string, opts: ToastOptions = {}) => {
    const tone = opts.tone ?? 'default';
    setToast({ message, tone, action: opts.action });
    clearTimeout(timer.current);
    // Errors and anything offering an action linger, so there is time to read it and tap Retry.
    timer.current = setTimeout(() => setToast(null), tone === 'error' || opts.action ? TOAST_ERROR_MS : TOAST_MS);
  }, []);

  const resetSession = useCallback(() => {
    clearTimeout(timer.current);
    setScreen('tasks');
    setGoalId(null);
    setSheet(null);
    setViewedWeek(0);
    setTaskGoalFilter(null);
    setBacklogGoalFilter(null);
    setCollapsed({});
    setMenuGoalId(null);
    setToast(null);
    setSessionEpoch((e) => e + 1);
  }, []);

  const value = useMemo<UIState>(
    () => ({
      screen,
      setScreen,
      goalId,
      openGoal,
      sheet,
      openSheet,
      closeSheet,
      viewedWeek,
      selectWeek,
      taskGoalFilter,
      setTaskGoalFilter,
      backlogGoalFilter,
      setBacklogGoalFilter,
      collapsed,
      toggleCollapsed,
      menuGoalId,
      setMenuGoalId,
      toast,
      showToast,
      hideToast,
      sessionEpoch,
      resetSession,
    }),
    [
      screen,
      goalId,
      openGoal,
      sheet,
      openSheet,
      closeSheet,
      viewedWeek,
      selectWeek,
      taskGoalFilter,
      backlogGoalFilter,
      collapsed,
      toggleCollapsed,
      menuGoalId,
      toast,
      showToast,
      hideToast,
      sessionEpoch,
      resetSession,
    ],
  );

  return <UICtx.Provider value={value}>{children}</UICtx.Provider>;
}

export function useUI(): UIState {
  const ctx = useContext(UICtx);
  if (!ctx) throw new Error('useUI must be used inside <UIProvider>');
  return ctx;
}
