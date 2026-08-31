import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Horizon } from '@goal-cascade/shared';
import { DEFAULT_LENS } from '../routes';

/**
 * Everything the SERVER does not know, and nothing it does — **minus everything the URL now knows.**
 *
 * The rule this file exists to enforce is unchanged: React Query owns every read model; this context owns
 * browser-only state. What changed in A2 is that "which screen is showing" stopped being browser-only
 * state and became the address bar (R-nav-24). Four fields left with it:
 *
 *  - `screen` / `goalId` — the router's, now. `lib/useUrlSync.ts` (the one-way mirror that stood in for a
 *    router) is deleted.
 *  - **`viewedWeek` / `selectWeek`** — the week is `/week/:monday`, an absolute Monday (D-1). This is
 *    where the amendment's second silent break lived: `selectWeek` clamped with `Math.min(0, offset)`
 *    against `WeekOffset`'s old `.max(0)`, so with the schema widened (R-goal-36, R-rm-3) every forward
 *    navigation would have compiled, rendered and silently pinned to the current week. **It is deleted,
 *    not relaxed** — there is no client-side week clamp left to go stale (see `lib/weekClock.ts`).
 *  - `taskGoalFilter` / `backlogGoalFilter` — the goal-filter pills are deleted outright (R-rm-4,
 *    R-lens-15). Grouping by Life goal is the whole answer.
 *  - `menuGoalId` — the tree's per-row `⋯` menu went with the tree (R-rm-5).
 *
 * FORM DRAFTS ARE NOT HERE. A sheet's draft is local state inside that sheet; this context only says
 * WHICH sheet is open and what it is about.
 */

/**
 * The open overlay, as a discriminated union carrying what it is about.
 *
 * R-lens-14 — **overlays are not routes.** Each is a two-second interaction whose URL nobody wants: the
 * `+` drawer, every confirm sheet, the create and edit forms, the Zoom sheet. Reloading the page must not
 * reopen one (S-nav-24-2).
 */
export type Sheet =
  /**
   * ⚠ **A2 (R-task-48/49)** — the create sheet takes a Weekly goal **or** the makings of one. `newWeekly`
   * is R-task-49's inferred second step, stated before it happens: the sheet says what will be created.
   */
  | {
      kind: 'taskCreate';
      goalId?: string;
      newWeekly?: { parentId: string; title: string };
      /** Candidates when more than one Weekly goal could take it — the first is preselected (R-task-49). */
      candidates?: { id: string; title: string }[];
      /** The absolute Monday the task will land in, for the copy and for the navigation afterwards. */
      weekStart?: string;
      title?: string;
      fromBacklogId?: string;
    }
  | { kind: 'backlogDrawer'; goalId?: string }
  /** R-task-15/16 — the confirm sheet for exit 2 and exit 3, both of which take an optional reason. */
  | { kind: 'confirmTaskExit'; taskId: string; exit: 'backlog' | 'cancel'; week: number }
  /** R-task-21 — the skippable "update the done-condition?" prompt after an uncheck. Rendered inline. */
  | { kind: 'uncheck'; taskId: string }
  /** R-goal-40 — re-plan to a contextual next period, with an optional one-line reason. */
  | { kind: 'confirmReplan'; goalId: string }
  /** Q-5 — the "N sub-goals, M tasks, K backlog items" acknowledgement before a cascade delete. */
  | { kind: 'confirmDeleteGoal'; goalId: string }
  /**
   * ⚠ **A2 (UX §6.7)** — the create form. The horizon and the period are the LENS's and are not editable:
   * the period is a read-only chip with its reason beside it, and if you want another one you navigate
   * there. `lifeGoalId` narrows the parent picker to one line (the per-group `+ <Horizon> goal`).
   */
  | { kind: 'goalForm'; editId: string | null; horizon: Horizon; periodKey: string; lifeGoalId?: string | null; parentId?: string | null }
  | { kind: 'moveGoal'; goalId: string; lifeGoalsOnly?: boolean }
  /** R-lens-17 — the Zoom sheet. The lens title is its only trigger. */
  | { kind: 'zoom' }
  /** R-backlog-28 — `Pull from the backlog`, from a Weekly or Monthly goal's card. */
  | { kind: 'pull'; goalId: string; horizon: Horizon; weekStart?: string };

export interface ToastAction {
  label: string;
  onClick: () => void;
}
export interface ToastOptions {
  tone?: 'default' | 'error';
  action?: ToastAction;
  /**
   * R-task-49 — a clause the screen reader gets and the screen does not. The toast's visible copy is
   * fixed (`Added to week of Mon 31 Aug`, §7.3), but when a Weekly goal was created without being asked
   * for, the announcement has to name it: *"…, under Run 4 times a week in August."* It is rendered
   * visually-hidden inside the toast's own `role="status"`, so there is still exactly one live region.
   */
  detail?: string;
}
export interface ToastState extends ToastOptions {
  message: string;
  tone: 'default' | 'error';
}

/** R-nav-13 — toasts are transient confirmations, ~2.6s, and never the only record of a state change. */
const TOAST_MS = 2600;
const TOAST_ERROR_MS = 4200;

export interface UIState {
  sheet: Sheet | null;
  openSheet: (s: Sheet) => void;
  closeSheet: () => void;

  /**
   * R-nav-28 — the lens the `Goals` tab returns to, so daily use never opens the Zoom sheet. Session
   * state only: a cold start opens the **Weekly** lens, and the period always resets to the one
   * containing today (R-lens-8) — an app that opened on a remembered future period would quietly lie
   * about now.
   */
  lastLens: Horizon;
  rememberLens: (lens: Horizon) => void;

  /**
   * R-lens-18 — the session **anchor date**, held only so the **Life** lens (which has no period) can
   * hand one to the Zoom sheet. Every other lens derives its anchor from the period it is showing, which
   * is what makes zoom lossless without anything to keep in step.
   */
  anchor: string | null;
  setAnchor: (date: string) => void;

  /**
   * R-lens-19 — collapsed Life-goal groups, keyed `<lens>|<groupId>`. **Session-scoped and per-lens,
   * never persisted**: a collapsed group that survives a restart is a hidden goal.
   */
  collapsed: Record<string, boolean>;
  toggleCollapsed: (key: string) => void;

  toast: ToastState | null;
  showToast: (message: string, opts?: ToastOptions) => void;
  hideToast: () => void;

  /**
   * Bumped on sign-out. `<App key={sessionEpoch} />` remounts the whole tree so every query observer starts
   * clean against the cleared cache.
   */
  sessionEpoch: number;
  resetSession: () => void;
}

const UICtx = createContext<UIState | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [lastLens, setLastLens] = useState<Horizon>(DEFAULT_LENS);
  const [anchor, setAnchorState] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<ToastState | null>(null);
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const openSheet = useCallback((s: Sheet) => setSheet(s), []);
  const closeSheet = useCallback(() => setSheet(null), []);
  const rememberLens = useCallback((lens: Horizon) => setLastLens((prev) => (prev === lens ? prev : lens)), []);
  const setAnchor = useCallback((date: string) => setAnchorState((prev) => (prev === date ? prev : date)), []);

  const toggleCollapsed = useCallback((key: string) => {
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));
  }, []);

  const hideToast = useCallback(() => {
    clearTimeout(timer.current);
    setToast(null);
  }, []);

  const showToast = useCallback((message: string, opts: ToastOptions = {}) => {
    const tone = opts.tone ?? 'default';
    setToast({ message, tone, action: opts.action, detail: opts.detail });
    clearTimeout(timer.current);
    // Errors and anything offering an action linger, so there is time to read it and tap Retry.
    timer.current = setTimeout(() => setToast(null), tone === 'error' || opts.action ? TOAST_ERROR_MS : TOAST_MS);
  }, []);

  const resetSession = useCallback(() => {
    clearTimeout(timer.current);
    setSheet(null);
    setLastLens(DEFAULT_LENS);
    setAnchorState(null);
    setCollapsed({});
    setToast(null);
    setSessionEpoch((e) => e + 1);
  }, []);

  const value = useMemo<UIState>(
    () => ({
      sheet,
      openSheet,
      closeSheet,
      lastLens,
      rememberLens,
      anchor,
      setAnchor,
      collapsed,
      toggleCollapsed,
      toast,
      showToast,
      hideToast,
      sessionEpoch,
      resetSession,
    }),
    [sheet, openSheet, closeSheet, lastLens, rememberLens, anchor, setAnchor, collapsed, toggleCollapsed, toast, showToast, hideToast, sessionEpoch, resetSession],
  );

  return <UICtx.Provider value={value}>{children}</UICtx.Provider>;
}

export function useUI(): UIState {
  const ctx = useContext(UICtx);
  if (!ctx) throw new Error('useUI must be used inside <UIProvider>');
  return ctx;
}
