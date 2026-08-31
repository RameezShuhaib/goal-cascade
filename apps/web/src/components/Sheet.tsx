import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useSkin } from '../skin';

/**
 * The bottom sheet every overlay in this app uses — and the whole of the `aria-modal` contract, written
 * once so no sheet can forget half of it.
 *
 * The browser walkthrough (docs/work/09-e2e-browser, finding A) found every sheet declaring
 * `role="dialog" aria-modal="true"` while implementing none of what that promises: Escape did nothing,
 * there was no ✕ and no Cancel, focus never entered the dialog, and the only exit was an unmarked strip of
 * page above the sheet. `aria-modal` tells assistive tech to hide everything OUTSIDE the dialog, so a
 * screen-reader user who opened one could reach its content only by blind tabbing and leave only by
 * submitting. That is a trap, and this is the fix:
 *
 *  - **Escape closes.** Always. Even with typed work in the sheet (see `unsaved`), the second Escape gets
 *    you out — a trap is worse than a lost draft.
 *  - **A visible ✕** in the header, quiet, matching the chrome.
 *  - **Focus moves in** on open (to the heading, so nothing is typed into by accident and no phone keyboard
 *    springs up), is **trapped** while open, and **returns to the trigger** on close.
 *  - **The backdrop is a real element** that closes on click — R-nav-15's "tap outside dismisses without
 *    acting", which used to be an accidental gap rather than a target.
 *  - `aria-labelledby` points at the heading the sheet actually renders, so the accessible name and the
 *    visible title can never drift apart.
 *
 * No focus-trap library: the trap is ~20 lines of `Tab` handling below, and this app ships no dependency
 * it can write itself.
 */

/**
 * Everything tabbable, in DOM order. `:not([disabled])` matters — a disabled Move target or a blocked Save
 * must not be a stop on the way round, and this app disables a lot of things on purpose.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const focusables = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getAttribute('aria-hidden') !== 'true' && !el.hasAttribute('hidden'));

/**
 * Where focus goes when the discard strip is dismissed and the field it interrupted has since gone away —
 * the first thing you can actually type into, or failing that the first stop in the sheet. Never `<body>`:
 * outside the dialog is the one place an `aria-modal` sheet may not put you.
 */
const firstField = (root: HTMLElement): HTMLElement | undefined => {
  const items = focusables(root);
  return items.find((el) => /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) ?? items[0];
};

export interface SheetProps {
  onClose: () => void;
  children: ReactNode;
  /** The heading. It is rendered as the sheet's `<h2>` AND is the dialog's accessible name. */
  label: string;
  /** Rendered beside the heading, before the ✕ — the backlog drawer's "View Backlog →" lives here. */
  headerRight?: ReactNode;
  /** The task detail sheet's drag affordance, above the header. */
  grip?: boolean;
  /**
   * `true` while this sheet holds typed work that closing would discard.
   *
   * Only the task detail sheet sets it, and only while its form is dirty: it is the one sheet you can sit
   * in and write paragraphs. Every other sheet holds a line or two, and R-nav-14's "no mandatory fields,
   * fast and guilt-free" means they must never ask twice. The confirmation here is one strip, and it is
   * never a dead end — Escape while it is up discards and closes.
   */
  unsaved?: boolean;
}

export function Sheet({ onClose, children, label, headerRight, grip = false, unsaved = false }: SheetProps) {
  const S = useSkin();
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  /** Where the caret was when the strip went up, so `Keep editing` can put it back mid-sentence. */
  const interruptedRef = useRef<HTMLElement | null>(null);
  const [confirming, setConfirming] = useState(false);

  /**
   * A close REQUEST. With unsaved work it raises the strip instead of closing; once the strip is up (or the
   * sheet holds nothing worth keeping) it closes for real. So the second Escape always leaves.
   */
  const requestClose = useCallback(() => {
    if (unsaved && !confirming) {
      // Remembered BEFORE the strip mounts and steals focus — this is the field being typed into.
      interruptedRef.current = document.activeElement as HTMLElement | null;
      setConfirming(true);
      return;
    }
    onClose();
  }, [confirming, onClose, unsaved]);

  // Focus in on open, back to the trigger on close. The trigger is whatever was focused when the sheet
  // mounted — the `+ Task` button, the task row, the `…` menu item — and it may have been removed from the
  // DOM by the very action that closed us, hence the `isConnected` guard.
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    headingRef.current?.focus();
    return () => {
      if (trigger && trigger.isConnected && typeof trigger.focus === 'function') trigger.focus();
    };
  }, []);

  // Keep focus inside while the strip is up, so the choice cannot be tabbed past — and put it BACK when the
  // strip goes away.
  //
  // Dismissing the strip unmounts the button that holds focus, and the browser's answer to that is `<body>`:
  // outside the dialog, mid-sentence, with the caret gone (docs/work/09-e2e-browser, re-verification nit 1).
  // The trap still held — the next Tab re-entered the sheet — but a keyboard user had lost their place in a
  // sheet they had just chosen to stay in, which is the opposite of what `Keep editing` promises.
  useEffect(() => {
    if (confirming) {
      keepRef.current?.focus();
      return;
    }
    const interrupted = interruptedRef.current;
    interruptedRef.current = null;
    const el = sheetRef.current;
    if (!interrupted || !el) return;
    // Back to the field, unless the render that dismissed the strip also took it away (a link removed, a
    // `Save changes` button that is no longer dirty) — then the first field, never `<body>`.
    if (interrupted.isConnected && el.contains(interrupted)) interrupted.focus();
    else firstField(el)?.focus();
  }, [confirming]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = sheetRef.current;
      if (!el) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        // "Ask once, then out" counts DELIBERATE presses. Held down, Escape auto-repeats at ~30/s after
        // half a second, so the first repeat would answer the question the user has not been shown yet and
        // throw the draft away — the strip appears and vanishes inside one keypress. A repeat may raise the
        // strip; it may never be the press that discards.
        if (e.repeat && confirming) return;
        requestClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const items = focusables(el);
      if (items.length === 0) {
        e.preventDefault();
        headingRef.current?.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      // Focus somehow escaped (a click on the page behind, an autofocus elsewhere): pull it back.
      if (!active || !el.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      const i = items.indexOf(active);
      // `i === -1` is the heading, which is `tabindex="-1"` and therefore not in the ring: forward from it
      // falls through to the browser's own next stop (the ✕), backward wraps to the end.
      if (e.shiftKey ? i <= 0 : i === items.length - 1) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    // Capture, so a field that stops propagation cannot swallow Escape.
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [confirming, requestClose]);

  return (
    <>
      {/*
       * R-nav-15 — tapping the backdrop closes WITHOUT acting. That is the property worth keeping: every
       * destructive confirm in this product is one mis-tap away from being dismissed harmlessly. It is an
       * explicit element now, not the gap above the sheet.
       */}
      <div style={S.overlay} onClick={requestClose} data-testid="sheet-overlay" aria-hidden="true" />
      <div ref={sheetRef} style={S.sheet} data-screen-label={label} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div style={S.sheetInner}>
          {grip && <SheetGrip />}
          <div style={S.sheetHeader}>
            <h2 id={titleId} ref={headingRef} tabIndex={-1} style={S.sheetTitle}>
              {label}
            </h2>
            {headerRight}
            <button type="button" aria-label="Close" style={S.sheetClose} onClick={requestClose}>
              ✕
            </button>
          </div>
          {confirming && (
            <div style={S.discardBar}>
              <span style={{ flex: 1, minWidth: 140 }}>Discard your unsaved edits?</span>
              <button type="button" style={{ ...S.btn(false), minHeight: 36 }} onClick={onClose}>
                Discard
              </button>
              <button type="button" ref={keepRef} style={{ ...S.btn(true), minHeight: 36 }} onClick={() => setConfirming(false)}>
                Keep editing
              </button>
            </div>
          )}
          {children}
        </div>
      </div>
    </>
  );
}

/** The grab handle the task detail sheet shows above its header. */
export function SheetGrip() {
  const S = useSkin();
  return <div style={{ width: 36, height: 4, borderRadius: 2, background: S.T.border, margin: '0 auto 14px auto' }} />;
}
