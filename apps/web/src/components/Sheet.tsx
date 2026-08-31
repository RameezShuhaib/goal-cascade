import type { ReactNode } from 'react';
import { useSkin } from '../skin';

/**
 * The bottom sheet every overlay in this app uses.
 *
 * R-nav-15 — tapping the overlay closes it WITHOUT acting. That is the property worth keeping: every
 * destructive confirm in this product is one mis-tap away from being dismissed harmlessly.
 */
export function Sheet({ onClose, children, label }: { onClose: () => void; children: ReactNode; label?: string }) {
  const S = useSkin();
  return (
    <>
      <div style={S.overlay} onClick={onClose} data-testid="sheet-overlay" />
      <div style={S.sheet} data-screen-label={label} role="dialog" aria-modal="true" aria-label={label}>
        <div style={S.sheetInner}>{children}</div>
      </div>
    </>
  );
}

/** The grab handle the task detail sheet shows above its content. */
export function SheetGrip() {
  const S = useSkin();
  return <div style={{ width: 36, height: 4, borderRadius: 2, background: S.T.border, margin: '0 auto 14px auto' }} />;
}
