import { useEffect, useState } from 'react';
import { auth, authCopy, toAuthError } from '../../auth/client';
import { useAuthActions } from '../../auth/session';
import { useMe } from '../../api/queries';
import { useUI } from '../../context/UIContext';
import { useTheme } from '../../context/ThemeContext';
import { AuthFrame, Lede, Notice, PrimaryButton, TextButton, Title, Wordmark } from './ui';

const RESEND_COOLDOWN_S = 60;

/**
 * The verification screen — and the copy on it is the point of the file.
 *
 * **It must never say "check your inbox."** This Worker has no mail binding and no adapter that could
 * acquire one (`infrastructure/email/log-email-sender.ts`): the owner's sending domain was flagged for a
 * high bounce rate caused by this project's own test traffic, so the capability was removed rather than
 * guarded, and a test fails the API build if it comes back. A screen promising an email would send the one
 * person who uses this app to sit refreshing a mailbox that will never receive anything.
 *
 * So it says what is true: the link exists, it is in the server's outbox, and it is fetched out of band.
 * And it leads with the thing that keeps this from being a dead end — **sign-in works without verification**
 * (`requireEmailVerification: false`). Nothing in Goal Cascade is gated on a verified address today; this
 * screen is reachable only if the owner goes looking for it.
 *
 * "Write a new link" really does write one: `sendVerificationEmail` runs the same code path, and the mail
 * lands in `email_outbox` (for a sunk address) or nowhere at all. The button is honest about which.
 */
export default function VerifyEmailScreen({
  email,
  onVerified,
  onBack,
}: {
  email: string;
  onVerified: () => void;
  onBack: () => void;
}) {
  const T = useTheme();
  const ui = useUI();
  const me = useMe();
  const { signOut, signingOut } = useAuthActions();
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const check = async () => {
    setChecking(true);
    try {
      const res = await me.refetch();
      if (res.data?.user.emailVerified) onVerified();
      else ui.showToast('Still unverified — open the link from the outbox first');
    } finally {
      setChecking(false);
    }
  };

  const issue = async () => {
    if (cooldown > 0 || sending) return;
    setSending(true);
    try {
      await auth.sendVerificationEmail(email);
      setCooldown(RESEND_COOLDOWN_S);
      ui.showToast('New link written to the outbox');
    } catch (e) {
      const err = toAuthError(e);
      if (err.code === 'EMAIL_ALREADY_VERIFIED') onVerified();
      else ui.showToast(authCopy(err), { tone: 'error' });
    } finally {
      setSending(false);
    }
  };

  return (
    <AuthFrame>
      <Wordmark />
      <Title>Your email isn&apos;t verified</Title>
      <Lede>
        Nothing in Goal Cascade is blocked by this — you are signed in and everything works. Verification exists only so the address on{' '}
        <strong style={{ color: T.ink }}>{email}</strong> is confirmed to be yours.
      </Lede>
      <Notice tone="plain">
        This app cannot send email, on purpose: the Worker has no mail binding at all. A verification link is written to the server&apos;s
        outbox instead, and you open it from there. See <code>docs/work/06-web-data/build.md</code>.
      </Notice>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
        <PrimaryButton type="button" onClick={() => void check()} disabled={checking}>
          {checking ? 'Checking…' : "I've opened the link"}
        </PrimaryButton>
        <button
          type="button"
          onClick={() => void issue()}
          disabled={cooldown > 0 || sending}
          style={{
            minHeight: 48,
            border: `1px solid ${T.border}`,
            borderRadius: 14,
            background: T.card,
            color: cooldown > 0 ? T.mut : T.ink,
            fontSize: 14,
            fontWeight: 800,
            fontFamily: 'inherit',
            cursor: cooldown > 0 || sending ? 'default' : 'pointer',
            opacity: sending ? 0.6 : 1,
          }}
        >
          {cooldown > 0 ? `New link in ${cooldown}s` : sending ? 'Writing…' : 'Write a new link to the outbox'}
        </button>
        <TextButton onClick={onBack}>Not now</TextButton>
        <TextButton onClick={() => void signOut()} disabled={signingOut}>
          Sign out
        </TextButton>
      </div>
    </AuthFrame>
  );
}
