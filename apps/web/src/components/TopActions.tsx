import { useState, type ReactNode } from 'react';
import { useThemeChoice } from '../context/ThemeContext';
import { useAuthActions } from '../auth/session';
import { useMe } from '../api/queries';
import { useSkin } from '../skin';
import { Sheet } from './Sheet';
import VerifyEmailScreen from './auth/VerifyEmailScreen';

/**
 * R-nav-11 — the consistent top-right cluster on every page: the theme toggle, the account button, and at
 * most one primary action (`+ New goal`, `+ Add`, `Edit plan`; none on Ideas, Learnings, Plan and Goal
 * detail).
 *
 * The toggle is real now (R-nav-12 / D-25): `useThemeChoice` writes the choice to `/me/preferences`, so it
 * follows the person across devices instead of vanishing on reload, and repaints token sets rather than
 * setting `filter: invert(1) hue-rotate(180deg)` on `<html>`.
 *
 * **The account button is a judgement call, recorded.** R-nav-11 describes a cluster of "theme toggle plus
 * at most one primary action", and this adds a second icon — but an app you cannot sign out of is not
 * shippable, and `VerifyEmailScreen` was written, tested and left unrouted for want of a settings surface.
 * Both live behind one 40px icon that matches the toggle, so the cluster still reads as two quiet circles
 * and a pill. The alternative was inventing a Settings tab, which R-nav-1 fixes at five.
 */
export function TopActions({ children }: { children?: ReactNode }) {
  const S = useSkin();
  const { toggleTheme } = useThemeChoice();
  const me = useMe();
  const [panel, setPanel] = useState<'closed' | 'account' | 'verify'>('closed');

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <button type="button" aria-label="Toggle dark mode" style={S.themeBtn} onClick={toggleTheme}>
        {S.T.night ? '☀' : '☾'}
      </button>
      <button type="button" aria-label="Account" style={S.themeBtn} onClick={() => setPanel('account')}>
        ⌾
      </button>
      {children}
      {panel === 'account' && <AccountSheet onClose={() => setPanel('closed')} onVerify={() => setPanel('verify')} />}
      {panel === 'verify' && (
        // `VerifyEmailScreen` is a full-page layout, so it takes the page rather than sitting in a sheet.
        <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: S.T.paper, overflow: 'auto' }}>
          <VerifyEmailScreen
            email={me.data?.user.email ?? ''}
            onVerified={() => setPanel('closed')}
            onBack={() => setPanel('account')}
          />
        </div>
      )}
    </div>
  );
}

function AccountSheet({ onClose, onVerify }: { onClose: () => void; onVerify: () => void }) {
  const S = useSkin();
  const { signOut, signingOut } = useAuthActions();
  const user = useMe().data?.user;

  return (
    <Sheet label="Account" onClose={onClose}>
      <div style={{ fontSize: 16, fontWeight: 800 }}>Account</div>
      <div style={{ fontSize: 13.5, color: S.T.mut, margin: '4px 0 16px 0' }}>{user?.email ?? '…'}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {user && !user.emailVerified && (
          <button type="button" style={{ ...S.btn(false), width: '100%' }} onClick={onVerify}>
            Verify this email address
          </button>
        )}
        <button type="button" style={{ ...S.btn(false, true), width: '100%' }} disabled={signingOut} onClick={() => void signOut()}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </Sheet>
  );
}
