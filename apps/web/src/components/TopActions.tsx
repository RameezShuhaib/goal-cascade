import { useState, type ReactNode } from 'react';
import { useThemeChoice } from '../context/ThemeContext';
import { useAuthActions } from '../auth/session';
import { useMe } from '../api/queries';
import { useSkin } from '../skin';
import { AgentAccess } from './AgentAccess';
import { Sheet } from './Sheet';
import VerifyEmailScreen from './auth/VerifyEmailScreen';

/**
 * R-nav-25 — the consistent top-right cluster on every page: the theme toggle, the account button, and at
 * most one primary action.
 *
 * ⚠ **A2** — the mapping changed with the screens: a lens's action names its own horizon (`+ Life goal` …
 * `+ Weekly goal`) and is **absent** on a past period (R-goal-36); goal detail carries `+ Weekly goal` on a
 * Monthly goal and `+ Task` on a Weekly one; and the **task page** carries the cluster, which goal detail
 * used to omit. `Edit plan` is gone with the plan screen (R-rm-3).
 *
 * The toggle is real now (R-nav-12 / D-25): `useThemeChoice` writes the choice to `/me/preferences`, so it
 * follows the person across devices instead of vanishing on reload, and repaints token sets rather than
 * setting `filter: invert(1) hue-rotate(180deg)` on `<html>`.
 *
 * **The account button is a judgement call, recorded.** R-nav-11 describes a cluster of "theme toggle plus
 * at most one primary action", and this adds a second icon — but an app you cannot sign out of is not
 * shippable, and `VerifyEmailScreen` was written, tested and left unrouted for want of a settings surface.
 * Both live behind one 40px icon that matches the toggle, so the cluster still reads as two quiet circles
 * and a pill. The alternative was inventing a Settings tab, which R-nav-1 does not have.
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

/**
 * R-lens-25 — the keyboard accelerators, documented where the rule says they must be.
 *
 * They are a **convenience and never a route**: every one of them has a visible control one `Tab` away
 * (the chevrons for the period, the lens title for the altitude), so the accessibility floor never depends
 * on a shortcut. This list exists because an undocumented accelerator is one nobody uses, and because if
 * they are ever dropped nothing regresses.
 */
function Shortcuts() {
  const S = useSkin();
  const rows: [string, string][] = [
    ['← / →', 'Earlier / later period'],
    ['Shift + ↑ / ↓', 'Zoom out / in a lens'],
    ['Escape', 'Close a sheet, or leave the task page'],
  ];
  return (
    <div style={{ border: `1px solid ${S.T.line}`, borderRadius: 12, padding: '10px 12px' }}>
      <div style={{ ...S.sectionLabel, marginBottom: 6 }}>Keyboard</div>
      {rows.map(([keys, what]) => (
        <div key={keys} style={{ display: 'flex', gap: 10, fontSize: 12.5, color: S.T.mut, padding: '2px 0' }}>
          <span style={{ minWidth: 96, fontWeight: 700, color: S.T.ink }}>{keys}</span>
          <span style={{ flex: 1, minWidth: 0 }}>{what}</span>
        </div>
      ))}
    </div>
  );
}

function AccountSheet({ onClose, onVerify }: { onClose: () => void; onVerify: () => void }) {
  const S = useSkin();
  const { signOut, signingOut } = useAuthActions();
  const user = useMe().data?.user;

  return (
    <Sheet label="Account" onClose={onClose}>
      <div style={{ fontSize: 13.5, color: S.T.mut, margin: '0 0 16px 0' }}>{user?.email ?? '…'}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {user && !user.emailVerified && (
          <button type="button" style={{ ...S.btn(false), width: '100%' }} onClick={onVerify}>
            Verify this email address
          </button>
        )}
        {/*
         * Agent access sits ABOVE Sign out, and Sign out stays last. The order is the order you reach for
         * them: identity, then the thing you came here to set up, then the way out. A destructive-adjacent
         * control below the exit is a control people find by accident on their way to leaving.
         */}
        <AgentAccess />
        <Shortcuts />
        <button type="button" style={{ ...S.btn(false, true), width: '100%' }} disabled={signingOut} onClick={() => void signOut()}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </Sheet>
  );
}
