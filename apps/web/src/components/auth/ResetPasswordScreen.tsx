import { useState, type FormEvent } from 'react';
import { auth, authCopy, toAuthError, type AuthError } from '../../auth/client';
import { AuthFrame, ErrorText, Lede, PrimaryButton, TextButton, TextField, Title, Wordmark } from './ui';

/**
 * Landed on from the reset link: `/?reset=1&token=…`.
 *
 * That URL is built by the Worker itself (`resetPasswordUrl` in `infrastructure/auth/better-auth.ts`),
 * not by a Better Auth redirect — so the link sitting in the outbox IS this page, and there is no
 * intermediate `/api/auth/reset-password/:token` hop that could consume the token before it gets here.
 *
 * `App.tsx` strips `?reset=1&token=…` from the address bar as soon as it has been read, so a reload
 * does not re-enter this flow with a token that has already been spent.
 *
 * A successful reset revokes every existing session (`revokeSessionsOnPasswordReset`), which is the point:
 * this is the recovery path for a lost or stolen password, so the old one must stop working everywhere.
 */
export default function ResetPasswordScreen({
  token,
  linkError,
  onDone,
}: {
  token: string | null;
  linkError: string | null;
  onDone: (message: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const broken = !token || !!linkError;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending || !token) return;
    if (password.length < 8) {
      setFieldError('Passwords need at least 8 characters.');
      return;
    }
    setFieldError(null);
    setError(null);
    setPending(true);
    try {
      await auth.resetPassword({ token, newPassword: password });
      onDone('Password saved — sign in to continue');
    } catch (err) {
      setError(toAuthError(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthFrame>
      <Wordmark />
      <Title>Choose a new password</Title>
      {broken ? (
        <>
          <Lede>
            That link is expired or incomplete — reset links last an hour. Request another from Sign in, then fetch the new one from the
            server&apos;s outbox.
          </Lede>
          <TextButton onClick={() => onDone('')}>Back to sign in</TextButton>
        </>
      ) : (
        <form aria-label="Choose a new password" onSubmit={(e) => void submit(e)} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Lede>Saving a new password signs this account out everywhere else.</Lede>
          <TextField
            label="New password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            error={fieldError}
            hint="At least 8 characters."
          />
          {error && <ErrorText>{authCopy(error)}</ErrorText>}
          <PrimaryButton disabled={pending}>{pending ? 'Saving…' : 'Save password'}</PrimaryButton>
          <TextButton onClick={() => onDone('')}>Back to sign in</TextButton>
        </form>
      )}
    </AuthFrame>
  );
}
