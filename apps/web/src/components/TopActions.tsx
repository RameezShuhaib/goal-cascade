import type { ReactNode } from 'react';
import { useStore } from '../store';
import { themeBtn } from '../ui';

/** Consistent top-right cluster: theme toggle + optional page action. */
export function TopActions({ children }: { children?: ReactNode }) {
  const s = useStore();
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <button aria-label="Toggle dark mode" style={themeBtn} onClick={() => s.toggleTheme()}>
        {s.st.dark ? '☀' : '☾'}
      </button>
      {children}
    </div>
  );
}
