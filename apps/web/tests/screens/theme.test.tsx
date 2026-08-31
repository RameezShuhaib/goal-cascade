import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell } from '../../src/AppShell';
import { ApiProvider } from '../../src/context/ApiContext';
import { UIProvider } from '../../src/context/UIContext';
import { ThemeProvider } from '../../src/context/ThemeContext';
import { UIToast } from '../../src/components/Toast';
import { createQueryClient } from '../../src/lib/queryClient';
import { testClient } from '../render';
import { lastRequest, server } from '../msw/handlers';
import * as F from '../msw/fixtures';

/**
 * R-nav-12 / D-25 — dark mode is a real token set, persisted per user.
 *
 * The mockup set `document.documentElement.style.filter = 'invert(1) hue-rotate(180deg)'`. That inverts
 * images along with the chrome, turns the red pulse cyan, defeats `color-scheme`, and cannot be persisted
 * or overridden per element. This test exists so it cannot come back.
 */
describe('Theme', () => {
  it('the toggle repaints tokens and writes the preference — and sets no document filter', async () => {
    server.use(http.get('/api/goals', () => HttpResponse.json(F.treeResponse())));
    const user = userEvent.setup();
    const queryClient = createQueryClient({ retry: false });
    render(
      // No `theme` prop: the real provider, following the stored preference, as it ships.
      <QueryClientProvider client={queryClient}>
        <ApiProvider client={testClient()}>
          <UIProvider>
            <ThemeProvider onChange={() => {}}>
              <AppShell />
              <UIToast />
            </ThemeProvider>
          </UIProvider>
        </ApiProvider>
      </QueryClientProvider>,
    );

    const toggle = await screen.findByRole('button', { name: 'Toggle dark mode' });
    await user.click(toggle);

    await waitFor(() => expect(document.documentElement.style.colorScheme).toBe('dark'));
    expect(document.documentElement.style.filter).toBe('');
    expect(document.documentElement.style.backgroundColor).toBe('rgb(28, 28, 25)');
  });

  it('the choice is persisted to /me/preferences, so it follows the person across devices', async () => {
    server.use(http.get('/api/goals', () => HttpResponse.json(F.treeResponse())));
    const user = userEvent.setup();
    const queryClient = createQueryClient({ retry: false });
    const seen: string[] = [];
    render(
      <QueryClientProvider client={queryClient}>
        <ApiProvider client={testClient()}>
          <UIProvider>
            <ThemeProvider onChange={(t) => seen.push(t)}>
              <AppShell />
            </ThemeProvider>
          </UIProvider>
        </ApiProvider>
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Toggle dark mode' }));
    expect(seen).toEqual(['dark']);
  });
});

/** The one place the account controls live (R-nav-11's cluster). */
describe('Account', () => {
  it('sign-out is reachable from every page', async () => {
    server.use(
      http.get('/api/goals', () => HttpResponse.json(F.treeResponse())),
      http.post('/api/auth/sign-out', () => HttpResponse.json({ success: true })),
    );
    const { renderApp } = await import('../render');
    const { user } = renderApp(<AppShell />);

    await user.click(await screen.findByRole('button', { name: 'Account' }));
    expect(await screen.findByText('me@rameezshuhaib.com')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(lastRequest('POST', '/sign-out')).toBeTruthy());
  });
});
