import { useStore } from '../store';

export function Toast() {
  const s = useStore();
  if (!s.st.toast) return null;
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 76, zIndex: 50, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <div style={{ background: '#1c1c19', color: '#fff', borderRadius: 20, padding: '10px 18px', fontSize: 13.5, fontWeight: 600, maxWidth: '85%' }}>
        {s.st.toast}
      </div>
    </div>
  );
}
