import { useState, type FormEvent } from 'react';
import { auth, authCopy, toAuthError, type AuthError } from '../../auth/client';
import { useAuthActions } from '../../auth/session';
import { AuthFrame, ErrorText, Lede, Notice, PrimaryButton, Segmented, TextButton, TextField, Title, Wordmark } from './ui';
import ResetPasswordScreen from './ResetPasswordScreen';

type Mode = 'signin' | 'signup' | 'forgot' | 'sent';
const TABS = ['signin', 'signup'] as const;

export interface ResetLanding {
  token: string | null;
  error: string | null;
}

/**
 * The whole signed-out surface: sign in, create account, forgot password, and (from the `?reset=` landing)
 * choose a new password. Rendered by the gate in `App.tsx` when `/me` answers 401 — never by a URL.
 *
 * Two things about this app shape the copy, and both are deliberate rather than unfinished:
 *
 *  1. **Sign-up is allowlisted to one address** (R-auth-1). A refusal is `403 SIGNUP_NOT_ALLOWED` and is
 *     rendered as a plain statement of what the product is, not as a fault — see `authCopy`.
 *  2. **This deployment cannot send email at all.** There is no mail binding in the Worker, by design
 *     (the owner's sending domain was flagged for bounces caused by this project's own test traffic).
 *     So "we've sent you a link" would be a lie: the link is written to a server-side outbox and has to
 *     be fetched from there. Every screen here says exactly that.
 */
export default function AuthScreen({
  notice,
  reset,
  onResetDone,
}: {
  notice?: string | null;
  reset?: ResetLanding | null;
  onResetDone?: () => void;
}) {
  const { afterSignIn } = useAuthActions();
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);
  const [fieldError, setFieldError] = useState<{ name?: string; email?: string; password?: string }>({});
  const [banner, setBanner] = useState<string | null>(notice ?? null);
  const [showReset, setShowReset] = useState(!!reset);

  if (showReset && reset) {
    return (
      <ResetPasswordScreen
        token={reset.token}
        linkError={reset.error}
        onDone={(msg) => {
          setShowReset(false);
          setBanner(msg || null);
          setMode('signin');
          onResetDone?.();
        }}
      />
    );
  }

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setFieldError({});
  };

  /**
   * Client-side checks exist to save a round trip on the two things that are certainly wrong, not to
   * duplicate the server's rules. Everything else — the allowlist, whether the account exists, the real
   * password policy — is the server's answer, rendered inline.
   */
  const validate = (): boolean => {
    const fe: typeof fieldError = {};
    if (!email.trim()) fe.email = 'Enter your email.';
    if (mode === 'signup') {
      if (!name.trim()) fe.name = 'Enter the name to sign the account with.';
      if (password.length < 8) fe.password = 'Passwords need at least 8 characters.';
    } else if (mode === 'signin' && !password) {
      fe.password = 'Enter your password.';
    }
    setFieldError(fe);
    return Object.keys(fe).length === 0;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending || !validate()) return;
    setError(null);
    setBanner(null);
    setPending(true);
    try {
      if (mode === 'forgot') {
        await auth.requestPasswordReset(email.trim());
        setMode('sent');
        return;
      }
      if (mode === 'signup') await auth.signUp({ name: name.trim(), email: email.trim(), password });
      else await auth.signIn({ email: email.trim(), password });
      // The gate re-runs off `/me`; nothing here decides what renders next.
      await afterSignIn();
    } catch (err) {
      setError(toAuthError(err));
    } finally {
      setPending(false);
    }
  };

  const exists = error && (error.code === 'USER_ALREADY_EXISTS' || error.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL');
  const title = mode === 'signup' ? 'Create your account' : mode === 'signin' ? 'Welcome back' : 'Reset your password';
  const buttonLabel = pending
    ? mode === 'signup'
      ? 'Creating account…'
      : mode === 'signin'
        ? 'Signing in…'
        : 'Requesting…'
    : mode === 'signup'
      ? 'Create account'
      : mode === 'signin'
        ? 'Sign in'
        : 'Request a reset link';

  return (
    <AuthFrame>
      <Wordmark />
      <Title>{title}</Title>

      {mode === 'sent' ? (
        <>
          {/*
           * NOT "check your inbox". No mail leaves this Worker — there is no binding to send it with. The
           * reset link is written to the server's outbox, where the owner reads it out of band. Saying
           * anything else would send the one person who uses this app to refresh an empty mailbox.
           */}
          <Lede>
            No email will arrive — this app has no way to send one, on purpose. The link was written to the server&apos;s outbox instead, and it
            works for one hour. Fetch it from there, then open it on this device.
          </Lede>
          <Notice tone="plain">
            The retrieval steps are in <code>docs/work/06-web-data/build.md</code> → &ldquo;Getting your own reset link&rdquo;.
          </Notice>
          <TextButton onClick={() => switchMode('signin')}>Back to sign in</TextButton>
        </>
      ) : (
        <>
          {mode !== 'forgot' ? (
            <Segmented
              options={TABS}
              value={mode === 'signup' ? 'signup' : 'signin'}
              onChange={(v) => switchMode(v)}
              labels={(v) => (v === 'signin' ? 'Sign in' : 'Create account')}
            />
          ) : (
            <Lede>
              Enter the account&apos;s address. The link is written to the server&apos;s outbox rather than emailed — this app cannot send mail —
              and it works for one hour.
            </Lede>
          )}

          {banner && <Notice>{banner}</Notice>}

          <form aria-label={title} onSubmit={(e) => void submit(e)} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {mode === 'signup' && (
              <TextField
                label="Your name"
                value={name}
                onChange={setName}
                autoComplete="name"
                maxLength={64}
                error={fieldError.name}
              />
            )}
            <TextField label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" error={fieldError.email} />
            {mode !== 'forgot' && (
              <TextField
                label="Password"
                type="password"
                value={password}
                onChange={setPassword}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                error={fieldError.password}
                hint={mode === 'signup' ? 'At least 8 characters.' : undefined}
              />
            )}

            {error && (
              <ErrorText>
                {exists ? (
                  <>
                    There is already an account for that email —{' '}
                    <button
                      type="button"
                      onClick={() => switchMode('signin')}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'inherit',
                        fontWeight: 800,
                        textDecoration: 'underline',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: 13,
                        padding: 0,
                      }}
                    >
                      sign in instead?
                    </button>
                  </>
                ) : (
                  authCopy(error)
                )}
              </ErrorText>
            )}

            <PrimaryButton disabled={pending} style={{ marginTop: 4 }}>
              {buttonLabel}
            </PrimaryButton>
          </form>

          {mode === 'signin' && <TextButton onClick={() => switchMode('forgot')}>Forgot password?</TextButton>}
          {mode === 'forgot' && <TextButton onClick={() => switchMode('signin')}>Back to sign in</TextButton>}
          {mode === 'signup' && (
            <Lede>
              Goal Cascade holds one person&apos;s cascade. Sign-up is open to a single address, so if yours is not it, there is nothing to
              create here.
            </Lede>
          )}
        </>
      )}
    </AuthFrame>
  );
}
