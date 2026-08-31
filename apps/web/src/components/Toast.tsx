import { useUI } from '../context/UIContext';
import { useSkin } from '../skin';

/**
 * The ONE toast. There is no second one.
 *
 * While the migration was in flight `App.tsx` mounted this (driven by `UIContext`) alongside the mockup's
 * own `useStore`-driven toast, so a command failure and a screen confirmation could stack. The mockup's is
 * deleted with `store.tsx`; this is what `useCommand` writes to via `presentError`, and what a screen
 * writes to for a confirmation.
 *
 * R-nav-13 — transient, ~2.6s (errors and anything with an action linger, in `UIContext`), and never the
 * only record of a state change: every toast here restates something the screen already shows.
 */
export function UIToast() {
  const { toast, hideToast } = useUI();
  const S = useSkin();
  if (!toast) return null;
  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: `calc(76px + var(--safe-bottom, 0px))`,
        zIndex: 60,
        display: 'flex',
        justifyContent: 'center',
        padding: '0 16px',
      }}
    >
      <div
        role="status"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: toast.tone === 'error' ? S.T.red : S.T.ink,
          color: toast.tone === 'error' ? '#fff' : S.onInk,
          borderRadius: 20,
          padding: '10px 18px',
          fontSize: 13.5,
          fontWeight: 600,
          maxWidth: '100%',
        }}
      >
        <span>{toast.message}</span>
        {/* Announced, not shown — see `ToastOptions.detail` (R-task-49). */}
        {toast.detail && <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{toast.detail}</span>}
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action?.onClick();
              hideToast();
            }}
            style={{
              border: 'none',
              background: 'none',
              color: 'inherit',
              fontWeight: 800,
              fontSize: 13.5,
              textDecoration: 'underline',
              cursor: 'pointer',
              fontFamily: 'inherit',
              padding: 0,
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>
    </div>
  );
}
