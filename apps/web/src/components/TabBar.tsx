import { useUI } from '../context/UIContext';
import { useSkin } from '../skin';

/**
 * R-nav-1 — five fixed tabs: `Tasks · Goals · + · Ideas · Learnings`. The `+` is a circular button that
 * opens the Add-to-Backlog drawer, not a page.
 *
 * R-nav-2 — Goals stays lit on a goal detail screen, and the Backlog page has no tab at all: it is reached
 * from the drawer's `View Backlog →` or a Life goal's `Open Backlog →`.
 */
export function TabBar() {
  const ui = useUI();
  const S = useSkin();
  const on = ui.screen;
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20, background: S.T.card, borderTop: `1px solid ${S.T.line}` }}>
      <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex' }}>
        <button type="button" style={S.navBtn(on === 'tasks')} onClick={() => ui.setScreen('tasks')}>
          Tasks
        </button>
        <button type="button" style={S.navBtn(on === 'goals' || on === 'goal')} onClick={() => ui.setScreen('goals')}>
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
        <button type="button" style={S.navBtn(on === 'ideas')} onClick={() => ui.setScreen('ideas')}>
          Ideas
        </button>
        <button type="button" style={S.navBtn(on === 'learnings')} onClick={() => ui.setScreen('learnings')}>
          Learnings
        </button>
      </div>
    </div>
  );
}
