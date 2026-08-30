import type { ReactNode } from 'react';
import { overlay, sheet, sheetInner } from '../ui';

export function Sheet({ onClose, children, label }: { onClose: () => void; children: ReactNode; label?: string }) {
  return (
    <>
      <div style={overlay} onClick={onClose} />
      <div style={sheet} data-screen-label={label}>
        <div style={sheetInner}>{children}</div>
      </div>
    </>
  );
}
