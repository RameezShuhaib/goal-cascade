import { useStore } from '../store';
import { colors, navBtn } from '../ui';

export function TabBar() {
  const s = useStore();
  const v = s.st.view;
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20, background: '#fffffe', borderTop: `1px solid ${colors.line}` }}>
      <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex' }}>
        <button style={navBtn(v === 'home')} onClick={() => s.set({ view: 'home' })}>Tasks</button>
        <button style={navBtn(v === 'goals' || v === 'line')} onClick={() => s.set({ view: 'goals' })}>Goals</button>
        <button
          aria-label="Add"
          onClick={() => s.openBacklogDrawer()}
          style={{ flex: 1, minHeight: 56, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <span style={{ width: 40, height: 40, borderRadius: '50%', background: colors.ink, color: '#fff', fontSize: 20, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</span>
        </button>
        <button style={navBtn(v === 'ideas')} onClick={() => s.set({ view: 'ideas' })}>Ideas</button>
        <button style={navBtn(v === 'learn')} onClick={() => s.set({ view: 'learn' })}>Learnings</button>
      </div>
    </div>
  );
}
