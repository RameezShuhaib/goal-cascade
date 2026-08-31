/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell } from '../../src/AppShell';
import { ApiProvider } from '../../src/context/ApiContext';
import { UIProvider } from '../../src/context/UIContext';
import { DARK, LIGHT, ThemeProvider } from '../../src/context/ThemeContext';
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

  /**
   * Finding C of the browser walkthrough: in dark mode `getComputedStyle(document.body).colorScheme` was
   * still `light` and the body still carried the light `#f6f6f3`, because `index.html` hardcoded both on
   * `body` and a stylesheet declaration beats an inherited value. Native controls, scrollbars and form
   * widgets therefore rendered for a light page inside a dark app — the browser-default blue focus ring on
   * the task sheet's done-condition input was the visible symptom — and a light body sat under a dark app
   * ready to flash white on any paint the inner wrapper missed.
   */
  it('the body and the focus ring follow the theme, so native controls are never light inside a dark app', async () => {
    server.use(http.get('/api/goals', () => HttpResponse.json(F.treeResponse())));
    const user = userEvent.setup();
    const queryClient = createQueryClient({ retry: false });
    render(
      <QueryClientProvider client={queryClient}>
        <ApiProvider client={testClient()}>
          <UIProvider>
            <ThemeProvider onChange={() => {}}>
              <AppShell />
            </ThemeProvider>
          </UIProvider>
        </ApiProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(document.body.style.colorScheme).toBe('light'));
    expect(document.body.style.backgroundColor).toBe('rgb(246, 246, 243)');
    expect(document.documentElement.style.getPropertyValue('--focus-ring')).toBe(LIGHT.green);

    await user.click(await screen.findByRole('button', { name: 'Toggle dark mode' }));

    await waitFor(() => expect(document.body.style.colorScheme).toBe('dark'));
    expect(document.body.style.backgroundColor).toBe('rgb(28, 28, 25)');
    // The ring the app draws on `:focus-visible`, not the browser's blue one.
    expect(document.documentElement.style.getPropertyValue('--focus-ring')).toBe(DARK.green);
  });

  /** The first paint, before React: it can follow nothing but `prefers-color-scheme`, and it must. */
  it('index.html paints only html, and offers a dark first paint', () => {
    const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'index.html'), 'utf8');
    const css = html.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/html \{ background: #f6f6f3; color-scheme: light; \}/);
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\s*html \{ background: #1c1c19; color-scheme: dark; \}/);
    // The body's only declarations. It used to repeat the light background and pin `color-scheme: light`,
    // which beat the inherited value and left every native control light inside the dark app.
    expect(css).toMatch(/html, body \{ margin: 0; padding: 0; \}/);
    // `[{;]` so this counts DECLARATIONS, not the `(prefers-color-scheme: …)` queries around them.
    expect(css.match(/[{;]\s*color-scheme:/g), 'color-scheme belongs to html and its dark override, nowhere else').toHaveLength(2);
    expect(css).toContain('outline: 2px solid var(--focus-ring)');
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
