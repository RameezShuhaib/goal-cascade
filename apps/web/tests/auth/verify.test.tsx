import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import VerifyEmailScreen from '../../src/components/auth/VerifyEmailScreen';
import { renderApp } from '../render';
import { requests, server } from '../msw/handlers';
import * as F from '../msw/fixtures';

/**
 * The copy on this screen is the thing under test. This Worker has no mail binding — none, by design — so
 * any sentence implying an email is on its way sends the one person who uses this app to sit refreshing an
 * empty mailbox. These assertions are what stops that wording drifting back in.
 */
describe('VerifyEmailScreen', () => {
  const render = (onVerified = vi.fn(), onBack = vi.fn()) =>
    renderApp(<VerifyEmailScreen email="me@rameezshuhaib.com" onVerified={onVerified} onBack={onBack} />);

  it('never promises an email, and says where the link actually goes', async () => {
    render();
    expect(await screen.findByText(/This app cannot send email, on purpose/)).toBeInTheDocument();
    expect(screen.getByText(/written to the server's outbox/)).toBeInTheDocument();
    expect(screen.queryByText(/check your (inbox|email)/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/we sent|we've sent|sent you a link/i)).not.toBeInTheDocument();
  });

  it('says plainly that nothing is blocked — sign-in works unverified', async () => {
    render();
    expect(await screen.findByText(/Nothing in Goal Cascade is blocked by this/)).toBeInTheDocument();
  });

  it('the resend button is labelled for what it does, and does it', async () => {
    const { user } = render();
    const button = await screen.findByRole('button', { name: 'Write a new link to the outbox' });
    await user.click(button);
    expect(await screen.findByText('New link written to the outbox')).toBeInTheDocument();
    expect(requests('POST', '/api/auth/send-verification-email')).toHaveLength(1);
    // A cooldown, so a stuck owner cannot hammer the rate limiter.
    expect(await screen.findByRole('button', { name: /New link in \d+s/ })).toBeInTheDocument();
  });

  it('"I\'ve opened the link" refetches /me and continues once the server agrees', async () => {
    const onVerified = vi.fn();
    server.use(http.get('/api/me', () => HttpResponse.json(F.me({ user: F.user({ emailVerified: false }) }))));
    const { user } = render(onVerified);

    await user.click(await screen.findByRole('button', { name: "I've opened the link" }));
    expect(await screen.findByText('Still unverified — open the link from the outbox first')).toBeInTheDocument();
    expect(onVerified).not.toHaveBeenCalled();

    server.use(http.get('/api/me', () => HttpResponse.json(F.me())));
    await user.click(screen.getByRole('button', { name: "I've opened the link" }));
    await vi.waitFor(() => expect(onVerified).toHaveBeenCalled());
  });
});
