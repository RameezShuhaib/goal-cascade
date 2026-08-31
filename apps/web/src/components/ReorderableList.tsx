import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import type { BacklogItemView } from '@goal-cascade/shared';
import { useReorderBacklogItem } from '../api/queries';
import { commandError } from './states';
import { useSkin } from '../skin';

/**
 * R-backlog-22/23/24 — **manual backlog order, with the keyboard as the reference implementation.**
 *
 * ── Why this file exists at all ───────────────────────────────────────────────
 * Drag is never the only way to re-order (R-backlog-22, "non-negotiable"). So the design here is the
 * inverse of the usual one: **the keyboard path is the feature and drag is a second front-end on it**
 * (R-backlog-24). Both end up calling the same relative move (R-backlog-19) with the same neighbour ids,
 * so a drag and an arrow press cannot produce different orders or different writes — there is no
 * drag-only code path to diverge.
 *
 * ── No drag-and-drop library, and why that is safe here ───────────────────────
 * The three hard parts of a DnD library — collision detection across nested droppables, virtualised
 * lists, and cross-container transfer — are all things this list does not have. It is one flat vertical
 * list, within one goal, with no cross-list drop target (R-backlog-21: a manual order across goals is not
 * defined and must not be invented). What is left is comparing a pointer's Y against row midpoints, which
 * is ~20 lines. A library would also bring its own keyboard sensor, and this list's keyboard behaviour is
 * specified to the announcement string — so it would have to be overridden anyway.
 *
 * ── The four requirements of R-backlog-22, and where each one is ──────────────
 *  1. **a roving-tabindex list** — exactly one reorder control is tabbable (`tabIndex 0`), the rest are
 *     `-1`; `↑`/`↓` move focus between rows, `Home`/`End` to the ends. One tab stop for the list.
 *  2. **a visible, always-rendered control on each row** — rendered unconditionally, never on hover,
 *     never on pointer-over, 44px tall, in the `body` token the app already uses (so it inherits the
 *     enforced contrast rule rather than introducing a colour that has to be re-argued).
 *  3. **grab mode** — `Space`/`Enter` picks up, `↑`/`↓` move the ROW, `Home`/`End` send it to an end,
 *     `Space`/`Enter` drops and commits, `Escape` cancels and **writes nothing**.
 *  4. **the row menu** — `Move up` / `Move down` / `Move to top` / `Move to bottom`, so the whole feature
 *     is reachable without ever entering grab mode. (`menuFor`, rendered by the row itself.)
 *
 * Focus stays on the moved row's control after a drop, a cancel or a failure, and is never lost to the
 * document: the control is keyed by item id, so React moves the same element and the browser keeps focus
 * on it for free.
 */

export interface ReorderList {
  /** The items in the order to RENDER — the optimistic arrangement while a grab or a write is in flight. */
  order: BacklogItemView[];
  /** R-backlog-23 — the one live region. Render it once, inside the list. */
  liveRegion: JSX.Element;
  /** Props for one row's always-visible `Reorder "<title>"` control. */
  controlProps: (item: BacklogItemView) => ReorderControlProps;
  /** R-backlog-22 (4) — the four row-menu actions, so grab mode is never required. */
  menuFor: (item: BacklogItemView) => ReorderMenu;
  /** Q-14 / R-nav-13 — a lost write needs more than a toast. Rendered inline by the list. */
  error: string | null;
  /** True while a row is picked up, so the list can show it lifted. */
  grabbedId: string | null;
}

export interface ReorderControlProps {
  ref: (el: HTMLButtonElement | null) => void;
  'aria-label': string;
  'aria-pressed': boolean;
  tabIndex: number;
  style: CSSProperties;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  onClick: () => void;
  onFocus: () => void;
  onPointerDown: (e: PointerEvent<HTMLButtonElement>) => void;
  children: string;
}

export interface ReorderMenu {
  moveUp: (() => void) | null;
  moveDown: (() => void) | null;
  moveTop: (() => void) | null;
  moveBottom: (() => void) | null;
}

/** R-backlog-23 — the announcements, verbatim. One place, so a drag and a keypress say the same thing. */
export const reorderCopy = {
  pickUp: (title: string, n: number, m: number) =>
    `Reorder: "${title}", position ${n} of ${m}. Arrow keys to move, Enter to drop, Escape to cancel.`,
  moved: (title: string, k: number, m: number) => `"${title}", position ${k} of ${m}.`,
  dropped: (title: string, k: number, m: number, goal: string) => `"${title}" moved to position ${k} of ${m} in ${goal}.`,
  canceled: (title: string, n: number, m: number) => `Reorder canceled. "${title}" returned to position ${n} of ${m}.`,
  failed: (title: string, n: number, m: number) => `Reorder failed. "${title}" returned to position ${n} of ${m}.`,
};

/**
 * R-backlog-19 — **the relative move a target index implies.**
 *
 * Never a position index on the wire: the command names the row it landed next to. Both ends are explicit
 * (`top` / `bottom`) rather than falling out of an `after`/`before` on the first or last row, because
 * "after the last item" and "the bottom" must survive the list changing under a concurrent write — and an
 * end named as an end still means the end.
 */
export function relativeMove(others: readonly BacklogItemView[], target: number): { after?: string; before?: string; to?: 'top' | 'bottom' } {
  if (target <= 0) return { to: 'top' };
  if (target >= others.length) return { to: 'bottom' };
  return { after: others[target - 1]!.id };
}

/** Move `from` to `to` in a copy of the array. */
function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [row] = next.splice(from, 1);
  if (row !== undefined) next.splice(Math.max(0, Math.min(next.length, to)), 0, row);
  return next;
}

/**
 * One re-orderable list: the Backlog page's group, or a goal-detail backlog block.
 *
 * `items` is the SERVER's order (R-backlog-17). Nothing here re-sorts it — the hook only ever holds a
 * `draft` while a grab or a write is in flight, and drops it the moment the server's own list comes back.
 * A client that re-sorted would be a second implementation of the ordering rule.
 */
export function useReorderList(input: { items: readonly BacklogItemView[]; goalTitle: string }): ReorderList {
  const S = useSkin();
  const reorder = useReorderBacklogItem();

  const [draft, setDraft] = useState<BacklogItemView[] | null>(null);
  const [grabbedId, setGrabbedId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  /** Where the grabbed row started, so `Escape` can put it back and say where "back" was. */
  const origin = useRef<{ index: number; list: BacklogItemView[] } | null>(null);
  const controls = useRef(new Map<string, HTMLButtonElement>());

  const server = useMemo(() => [...input.items], [input.items]);
  const order = draft ?? server;
  const total = order.length;

  // The server's list is the truth. When it lands, the draft has done its job — holding it any longer
  // would be the client having an opinion about an order it does not own.
  useEffect(() => {
    if (grabbedId === null && !reorder.isPending) setDraft(null);
  }, [server, grabbedId, reorder.isPending]);

  const indexOf = useCallback((id: string) => order.findIndex((i) => i.id === id), [order]);
  const focusControl = useCallback((id: string) => {
    // A frame later: the row has usually just moved in the DOM, and focus must follow the element.
    queueMicrotask(() => controls.current.get(id)?.focus());
  }, []);

  /**
   * Commit a move: apply it locally, then send the ONE relative command (R-backlog-19).
   *
   * On refusal the local order snaps back to the server's, R-backlog-23's failure line is announced, and
   * a non-toast error is rendered beside the list (Q-14 — a toast alone is insufficient for a lost write,
   * R-nav-13). Focus stays on the row's control throughout.
   */
  const commit = useCallback(
    (item: BacklogItemView, from: number, to: number, list: readonly BacklogItemView[]) => {
      if (from === to) {
        setDraft(null);
        return;
      }
      const next = moved(list, from, to);
      setDraft(next);
      const others = list.filter((i) => i.id !== item.id);
      reorder.mutate(
        { id: item.id, ...relativeMove(others, to), version: item.version },
        {
          onSuccess: () => {
            setAnnouncement(reorderCopy.dropped(item.title, to + 1, list.length, input.goalTitle));
            focusControl(item.id);
          },
          onError: () => {
            setDraft(null);
            setAnnouncement(reorderCopy.failed(item.title, from + 1, list.length));
            focusControl(item.id);
          },
        },
      );
    },
    [reorder, input.goalTitle, focusControl],
  );

  /** R-backlog-22 (4) — one of the four menu actions, which never enter grab mode. */
  const move = useCallback(
    (item: BacklogItemView, to: number) => {
      const from = indexOf(item.id);
      if (from < 0) return;
      commit(item, from, Math.max(0, Math.min(order.length - 1, to)), order);
      focusControl(item.id);
    },
    [indexOf, commit, order, focusControl],
  );

  /** R-backlog-22 (3) — pick the row up. The region goes `assertive` for the duration (R-backlog-23). */
  const grab = useCallback(
    (item: BacklogItemView) => {
      const at = indexOf(item.id);
      origin.current = { index: at, list: order };
      setDraft([...order]);
      setGrabbedId(item.id);
      setAnnouncement(reorderCopy.pickUp(item.title, at + 1, total));
    },
    [indexOf, order, total],
  );

  /** Drop and commit. */
  const drop = useCallback(
    (item: BacklogItemView) => {
      const start = origin.current;
      setGrabbedId(null);
      origin.current = null;
      if (!start) return;
      commit(item, start.index, indexOf(item.id), start.list);
      focusControl(item.id);
    },
    [commit, indexOf, focusControl],
  );

  /**
   * `Escape` — **restore the original position with NOTHING written** (S-backlog-22-2).
   *
   * The draft is thrown away rather than reversed, so there is no path on which a cancelled grab reaches
   * `reorder.mutate` at all. Focus stays on the control.
   */
  const cancel = useCallback(
    (item: BacklogItemView) => {
      const start = origin.current;
      setGrabbedId(null);
      setDraft(null);
      origin.current = null;
      if (start) setAnnouncement(reorderCopy.canceled(item.title, start.index + 1, start.list.length));
      focusControl(item.id);
    },
    [focusControl],
  );

  /** Move the GRABBED row one step, or to an end, announcing its new position each time. */
  const step = useCallback(
    (item: BacklogItemView, to: number) => {
      const from = indexOf(item.id);
      const clamped = Math.max(0, Math.min(total - 1, to));
      if (from < 0 || from === clamped) return;
      setDraft(moved(order, from, clamped));
      setAnnouncement(reorderCopy.moved(item.title, clamped + 1, total));
      focusControl(item.id);
    },
    [indexOf, order, total, focusControl],
  );

  const onKeyDown = useCallback(
    (item: BacklogItemView, e: KeyboardEvent<HTMLButtonElement>) => {
      const at = indexOf(item.id);
      const grabbed = grabbedId === item.id;
      const keys = ['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' ', 'Escape'];
      if (!keys.includes(e.key)) return;
      if (e.key === 'Escape' && !grabbed) return;
      e.preventDefault();
      // Arrows inside a grab must not also step the lens's period (R-lens-25's `←`/`→` are horizontal,
      // but `↑`/`↓` bubbling into a scroll container would still fight the drag).
      e.stopPropagation();

      if (grabbed) {
        if (e.key === 'ArrowUp') return step(item, at - 1);
        if (e.key === 'ArrowDown') return step(item, at + 1);
        if (e.key === 'Home') return step(item, 0);
        if (e.key === 'End') return step(item, total - 1);
        if (e.key === 'Escape') return cancel(item);
        return drop(item);
      }

      // Not grabbed: the arrows move FOCUS between rows, which is the roving-tabindex half.
      if (e.key === 'Enter' || e.key === ' ') return grab(item);
      const to = e.key === 'ArrowUp' ? at - 1 : e.key === 'ArrowDown' ? at + 1 : e.key === 'Home' ? 0 : total - 1;
      const next = order[Math.max(0, Math.min(total - 1, to))];
      if (next) {
        setActiveId(next.id);
        focusControl(next.id);
      }
    },
    [indexOf, grabbedId, step, total, cancel, drop, grab, order, focusControl],
  );

  /**
   * R-backlog-24 — **pointer and touch drag, on the same command.**
   *
   * The control itself is the drag handle and it works on touch with no long-press: `touch-action: none`
   * on a 44px control is enough, and a long-press requirement would make the touch path strictly worse
   * than the keyboard one. The target index is the pointer's Y against the rows' own midpoints, read from
   * the DOM at drag start.
   */
  const onPointerDown = useCallback(
    (item: BacklogItemView, e: PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      const container = (e.currentTarget as HTMLElement).closest('[data-reorder-list]');
      if (!container) return;
      const rows = [...container.querySelectorAll<HTMLElement>('[data-reorder-row]')];
      const boxes = rows.map((r) => ({ id: r.dataset.reorderRow!, mid: r.getBoundingClientRect().top + r.getBoundingClientRect().height / 2 }));
      const from = order.findIndex((i) => i.id === item.id);
      if (from < 0) return;

      let target = from;
      let dragged = false;
      const control = e.currentTarget;

      const onMove = (ev: globalThis.PointerEvent) => {
        // A press that never moves is a click — `onClick` grabs, so touch gets grab mode too.
        if (!dragged && Math.abs(ev.clientY - e.clientY) < 6) return;
        if (!dragged) {
          dragged = true;
          grab(item);
        }
        const above = boxes.filter((b) => b.id !== item.id && b.mid < ev.clientY).length;
        if (above !== target) {
          target = above;
          step(item, above);
        }
      };
      const onUp = () => {
        control.removeEventListener('pointermove', onMove);
        control.removeEventListener('pointerup', onUp);
        control.removeEventListener('pointercancel', onCancel);
        if (dragged) drop(item);
      };
      const onCancel = () => {
        control.removeEventListener('pointermove', onMove);
        control.removeEventListener('pointerup', onUp);
        control.removeEventListener('pointercancel', onCancel);
        if (dragged) cancel(item);
      };

      control.setPointerCapture?.(e.pointerId);
      control.addEventListener('pointermove', onMove);
      control.addEventListener('pointerup', onUp);
      control.addEventListener('pointercancel', onCancel);
    },
    [order, grab, step, drop, cancel],
  );

  const tabbableId = activeId && order.some((i) => i.id === activeId) ? activeId : (order[0]?.id ?? null);

  const controlProps = useCallback(
    (item: BacklogItemView): ReorderControlProps => {
      const at = indexOf(item.id);
      const grabbed = grabbedId === item.id;
      return {
        ref: (el) => {
          if (el) controls.current.set(item.id, el);
          else controls.current.delete(item.id);
        },
        // R-backlog-22 (2) — the control NAMES the row it moves, so a screen-reader user hearing a list
        // of them can tell them apart. The position is in the name too: it is the one number that makes
        // "move down" mean something before you press anything.
        'aria-label': grabbed
          ? `Reorder "${item.title}", grabbed, position ${at + 1} of ${total}. Arrow keys to move, Enter to drop, Escape to cancel.`
          : `Reorder "${item.title}", position ${at + 1} of ${total}`,
        'aria-pressed': grabbed,
        tabIndex: item.id === tabbableId ? 0 : -1,
        style: {
          // 44px touch target and no hover dependency: the control is ALWAYS rendered (R-backlog-22).
          width: 44,
          minWidth: 44,
          height: 44,
          border: `1px solid ${grabbed ? S.ring : S.T.border}`,
          borderRadius: 12,
          background: grabbed ? S.T.cardSoft : S.T.card,
          // `body`, the token the app's own menu buttons use — no new colour, so the enforced contrast
          // rule covers this control without an argument (S-backlog-22-3).
          color: S.body,
          fontSize: 15,
          lineHeight: '1',
          cursor: 'grab',
          padding: 0,
          fontFamily: 'inherit',
          touchAction: 'none',
        },
        onKeyDown: (e) => onKeyDown(item, e),
        onClick: () => (grabbedId === item.id ? drop(item) : grab(item)),
        onFocus: () => setActiveId(item.id),
        onPointerDown: (e) => onPointerDown(item, e),
        children: '⠿',
      };
    },
    [indexOf, grabbedId, total, tabbableId, S, onKeyDown, drop, grab, onPointerDown],
  );

  const menuFor = useCallback(
    (item: BacklogItemView): ReorderMenu => {
      const at = indexOf(item.id);
      const first = at <= 0;
      const last = at >= total - 1;
      return {
        moveUp: first ? null : () => move(item, at - 1),
        moveDown: last ? null : () => move(item, at + 1),
        moveTop: first ? null : () => move(item, 0),
        moveBottom: last ? null : () => move(item, total - 1),
      };
    },
    [indexOf, total, move],
  );

  /**
   * R-backlog-23 — **exactly one live region per list**, `assertive` for the duration of a grab so that
   * successive arrow presses are not swallowed by a polite queue, and `polite` again when the grab ends.
   */
  const liveRegion = (
    <div
      data-testid="reorder-live"
      aria-live={grabbedId ? 'assertive' : 'polite'}
      aria-atomic="true"
      style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}
    >
      {announcement}
    </div>
  );

  return {
    order,
    liveRegion,
    controlProps,
    menuFor,
    error: commandError(reorder.error),
    grabbedId,
  };
}
