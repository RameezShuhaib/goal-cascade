import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { AppRoot } from '../../src/App';
import { useAuthActions } from '../../src/auth/session';
import { renderApp } from '../render';
import { apiError, authError, authSuccess, bodyOf, lastRequest, requests, server } from '../msw/handlers';
import * as F from '../msw/fixtures';

/** `/me` answers 401 until an auth endpoint flips the flag — the cookie a real browser would carry. */
function sessionSwitch(initial = false) {
  const s = { signedIn: initial };
  server.use(http.get('/api/me', () => (s.signedIn ? HttpResponse.json(F.me()) : apiError('UNAUTHENTICATED'))));
  return s;
}

const signInForm = () => within(screen.getByRole('form', { name: 'Welcome back' }));
const signUpForm = () => within(screen.getByRole('form', { name: 'Create your account' }));

describe('AuthScreen', () => {
  it('signs in, and renders a wrong password inline rather than as a toast', async () => {
    const s = sessionSwitch();
    server.use(
      http.post('/api/auth/sign-in/email', async ({ request }) => {
        const b = (await request.json()) as { password: string };
        if (b.password !== 'correct-horse') return authError('INVALID_EMAIL_OR_PASSWORD', 401, 'Invalid email or password');
        s.signedIn = true;
        return authSuccess();
      }),
    );
    const { user } = renderApp(<AppRoot />, { withToast: false });
    expect(await screen.findByText('Welcome back')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Email'), 'me@rameezshuhaib.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(signInForm().getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText("That email and password don't match.")).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'correct-horse');
    await user.click(signInForm().getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('button', { name: 'Goals' })).toBeInTheDocument();
    expect(requests('POST', '/api/auth/sign-in/email')).toHaveLength(2);
  });

  it('signs up with the timezone header and the verified callback, then lands in the app', async () => {
    const s = sessionSwitch();
    server.use(
      http.post('/api/auth/sign-up/email', () => {
        s.signedIn = true;
        return authSuccess(F.authUser({ emailVerified: false }));
      }),
    );
    const { user } = renderApp(<AppRoot />, { withToast: false });
    await screen.findByText('Welcome back');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await user.type(screen.getByLabelText('Your name'), 'Rameez');
    await user.type(screen.getByLabelText('Email'), 'me@rameezshuhaib.com');
    await user.type(screen.getByLabelText('Password'), 'longenough1');
    await user.click(signUpForm().getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('button', { name: 'Goals' })).toBeInTheDocument();
    const req = lastRequest('POST', '/api/auth/sign-up/email')!;
    // R-auth-5 — the provisioning hook seeds `preferences.timezone` from this header.
    expect(req.headers.get('X-Timezone')).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(await bodyOf(req)).toMatchObject({ name: 'Rameez', email: 'me@rameezshuhaib.com', callbackURL: '/?verified=1' });
  });

  /**
   * R-auth-1 — the allowlist refusing an address is the product working, not a fault. The copy has to say
   * what the app IS, stay on the form, and leave the sign-in tab reachable.
   */
  it('renders a non-allowlisted sign-up as a plain statement, not an error state', async () => {
    sessionSwitch();
    server.use(
      http.post('/api/auth/sign-up/email', () =>
        authError('SIGNUP_NOT_ALLOWED', 403, 'sign-up is not open: this deployment is single-user'),
      ),
    );
    const { user } = renderApp(<AppRoot />, { withToast: false });
    await screen.findByText('Welcome back');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await user.type(screen.getByLabelText('Your name'), 'Someone');
    await user.type(screen.getByLabelText('Email'), 'someone@example.com');
    await user.type(screen.getByLabelText('Password'), 'longenough1');
    await user.click(signUpForm().getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText(/single-person app/)).toBeInTheDocument();
    expect(screen.getByText(/sign-up is open to one address only/)).toBeInTheDocument();
    // Still usable: the form is intact and Sign in is one tap away.
    expect(signUpForm().getByRole('button', { name: 'Create account' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
  });

  it('an existing account offers the sign-in tab and keeps the email', async () => {
    sessionSwitch();
    server.use(http.post('/api/auth/sign-up/email', () => authError('USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', 422, 'exists')));
    const { user } = renderApp(<AppRoot />, { withToast: false });
    await screen.findByText('Welcome back');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await user.type(screen.getByLabelText('Your name'), 'Rameez');
    await user.type(screen.getByLabelText('Email'), 'me@rameezshuhaib.com');
    await user.type(screen.getByLabelText('Password'), 'longenough1');
    await user.click(signUpForm().getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText(/There is already an account for that email/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'sign in instead?' }));
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('me@rameezshuhaib.com');
  });

  it('blocks a short password client-side without a request', async () => {
    sessionSwitch();
    const { user } = renderApp(<AppRoot />, { withToast: false });
    await screen.findByText('Welcome back');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await user.type(screen.getByLabelText('Your name'), 'Rameez');
    await user.type(screen.getByLabelText('Email'), 'me@rameezshuhaib.com');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(signUpForm().getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Passwords need at least 8 characters.')).toBeInTheDocument();
    expect(requests('POST', '/api/auth/sign-up/email')).toHaveLength(0);
  });

  /**
   * The forgot-password copy is the one place a wrong word costs the owner an afternoon: this deployment
   * has no mail binding, so "check your inbox" would send them to a mailbox nothing will ever reach.
   */
  it('forgot password requests a link and says, honestly, that no email is coming', async () => {
    sessionSwitch();
    const { user } = renderApp(<AppRoot />, { withToast: false });
    await screen.findByText('Welcome back');
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    await user.type(screen.getByLabelText('Email'), 'me@rameezshuhaib.com');
    await user.click(screen.getByRole('button', { name: 'Request a reset link' }));

    expect(await screen.findByText(/No email will arrive/)).toBeInTheDocument();
    expect(screen.getByText(/written to the server's outbox/)).toBeInTheDocument();
    expect(screen.queryByText(/check your (inbox|email)/i)).not.toBeInTheDocument();
    expect(await bodyOf(lastRequest('POST', '/api/auth/request-password-reset'))).toMatchObject({
      email: 'me@rameezshuhaib.com',
      redirectTo: '/?reset=1',
    });
  });

  it('keeps the forgot form usable when the request fails', async () => {
    sessionSwitch();
    server.use(http.post('/api/auth/request-password-reset', () => HttpResponse.json({ message: 'nope' }, { status: 400 })));
    const { user } = renderApp(<AppRoot />, { withToast: false });
    await screen.findByText('Welcome back');
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    await user.type(screen.getByLabelText('Email'), 'me@rameezshuhaib.com');
    await user.click(screen.getByRole('button', { name: 'Request a reset link' }));
    expect(await screen.findByText(/Couldn't do that just now/)).toBeInTheDocument();
    expect(screen.queryByText(/No email will arrive/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request a reset link' })).toBeEnabled();
  });

  /**
   * `/?reset=1&token=…` is the URL the Worker's own mail template builds — the outbox link IS this page.
   * The token has to be read off the boot URL and then STRIPPED, or a reload re-enters the flow with a
   * token that has already been spent.
   */
  it('lands on the reset screen from ?reset=1&token=, posts the token, and clears the URL', async () => {
    sessionSwitch();
    window.history.replaceState(null, '', '/?reset=1&token=tok-123');
    const { user } = renderApp(<AppRoot />, { withToast: false });

    expect(await screen.findByText('Choose a new password')).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe(''));

    await user.type(screen.getByLabelText('New password'), 'brand-new-pass');
    await user.click(screen.getByRole('button', { name: 'Save password' }));

    expect(await screen.findByText('Password saved — sign in to continue')).toBeInTheDocument();
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
    expect(await bodyOf(lastRequest('POST', '/api/auth/reset-password'))).toMatchObject({ token: 'tok-123', newPassword: 'brand-new-pass' });
  });

  it('a reset link with no token says so instead of posting', async () => {
    sessionSwitch();
    window.history.replaceState(null, '', '/?reset=1&error=INVALID_TOKEN');
    renderApp(<AppRoot />, { withToast: false });
    expect(await screen.findByText(/expired or incomplete/)).toBeInTheDocument();
    expect(requests('POST', '/api/auth/reset-password')).toHaveLength(0);
  });

  it('?verified=1 while signed out shows the notice on the sign-in screen', async () => {
    sessionSwitch();
    window.history.replaceState(null, '', '/?verified=1');
    renderApp(<AppRoot />, { withToast: false });
    expect(await screen.findByText('Email verified — sign in to continue')).toBeInTheDocument();
  });
});

/** The mockup shell has no sign-out control yet, so drive the real hook the way a Settings screen will. */
function WithSignOut() {
  const { signOut } = useAuthActions();
  return (
    <>
      <AppRoot />
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </>
  );
}

describe('sign out', () => {
  it('posts sign-out, clears the cache and the persisted blob, and returns to the auth screen', async () => {
    const s = sessionSwitch(true);
    server.use(
      http.post('/api/auth/sign-out', () => {
        s.signedIn = false;
        return HttpResponse.json({ success: true });
      }),
    );
    window.localStorage.setItem('goal-cascade.query-cache:user_owner', '{"stale":"goals"}');
    window.localStorage.setItem('goal-cascade.theme', 'dark');

    const { user, queryClient } = renderApp(<WithSignOut />, { withToast: false });
    await screen.findByRole('button', { name: 'Goals' });
    await waitFor(() => expect(queryClient.getQueryData(['me'])).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByText('Welcome back')).toBeInTheDocument();
    expect(requests('POST', '/api/auth/sign-out')).toHaveLength(1);
    expect(window.localStorage.getItem('goal-cascade.query-cache:user_owner')).toBeNull();
    // The whole `goal-cascade.` namespace is swept, not a list of known keys.
    expect(window.localStorage.getItem('goal-cascade.theme')).toBeNull();
    expect(window.localStorage.getItem('goal-cascade.identity')).toBeNull();
  });

  it('a sign-out that cannot reach the server keeps the session and says so', async () => {
    // The cookie is still valid, so pretending to be signed out would leave the next person on this device
    // one tap from the account.
    sessionSwitch(true);
    server.use(http.post('/api/auth/sign-out', () => HttpResponse.error()));
    // `withToast: false` — `App` renders the one toast; a second from the harness would just be a duplicate.
    const { user, queryClient } = renderApp(<WithSignOut />, { withToast: false });
    await screen.findByRole('button', { name: 'Goals' });

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText("Couldn't sign out — check the connection and try again")).toBeInTheDocument();
    expect(screen.queryByText('Welcome back')).not.toBeInTheDocument();
    expect(queryClient.getQueryData(['me'])).toBeTruthy();
  });
});
