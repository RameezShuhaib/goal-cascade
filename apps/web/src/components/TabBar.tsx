import { useLocation, useNavigate } from 'react-router';
import { useUI } from '../context/UIContext';
import { useSkin } from '../skin';
import { LEARNINGS_PATH, LENS_SEGMENT, lensPath } from '../routes';

/**
 * R-nav-23 — **three** fixed tabs: `Goals · + · Learnings`. The `+` is a circular button that opens the
 * Add-to-Backlog drawer, not a page.
 *
 * `Tasks` is gone: tasks live in the Weekly lens (R-lens-12), which is behind `Goals`. `Ideas` is gone
 * with the entity (R-rm-1). The lens switcher is **not** a tab and must never become one (R-lens-13) —
 * five lenses in a five-item bar leaves no room for capture or Learnings, and the tab bar is a top-level
 * destination switcher, not a zoom.
 *
 * `Goals` stays lit on a goal page and on a task page (R-nav-2, extended), and returns you to the lens you
 * were last in at the period containing today (R-nav-28) — so daily use never opens the Zoom sheet.
 * Backlog still has no tab: it is reached from the drawer's `View Backlog →` or a goal's page.
 */
export function TabBar() {
  const ui = useUI();
  const S = useSkin();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const first = pathname.split('/')[1] ?? '';
  const onLearnings = pathname.startsWith(LEARNINGS_PATH);
  const onGoals = !onLearnings && (first === 'goal' || first === 'task' || Object.values(LENS_SEGMENT).includes(first) || first === '');

  return (
    // `--safe-bottom` is published by `index.html` for exactly this element — it is `position: fixed`, so
    // `#root`'s padding cannot move it. Without this the 56px buttons sit under a notched phone's home
    // indicator once the app is installed. The padding goes on the fixed wrapper, not the inner row, so
    // the bar's background still runs to the bottom edge of the screen.
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 20,
        background: S.T.card,
        borderTop: `1px solid ${S.T.line}`,
        paddingBottom: 'var(--safe-bottom, 0px)',
      }}
    >
      <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex' }}>
        <button type="button" style={S.navBtn(onGoals)} onClick={() => navigate(lensPath(ui.lastLens))}>
          Goals
        </button>
        <button
          type="button"
          aria-label="Add"
          onClick={() => ui.openSheet({ kind: 'backlogDrawer' })}
          style={{ flex: 1, minHeight: 56, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <span
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: S.T.ink,
              color: S.onInk,
              fontSize: 20,
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            +
          </span>
        </button>
        <button type="button" style={S.navBtn(onLearnings)} onClick={() => navigate(LEARNINGS_PATH)}>
          Learnings
        </button>
      </div>
    </div>
  );
}
