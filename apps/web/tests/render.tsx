import type { ReactElement, ReactNode } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render, renderHook, type RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter, MemoryRouter } from 'react-router';
import { HttpApiClient } from '../src/api/http';
import { createQueryClient } from '../src/lib/queryClient';
import { ApiProvider } from '../src/context/ApiContext';
import { ThemeProvider } from '../src/context/ThemeContext';
import { UIProvider } from '../src/context/UIContext';
import { UIToast } from '../src/components/Toast';

/**
 * The full provider stack, a fresh no-retry `QueryClient`, and a `userEvent` instance. MSW handles the
 * network (`tests/setup.ts` starts the server with `onUnhandledRequest: 'error'`, so an unstubbed call is a
 * failure rather than a hang).
 *
 * Tests built on this read as user behaviour — find the button, click it, assert what appears — rather than
 * as assertions about hooks. That is deliberate: the whole point of `ApiContext` is that the seam is the
 * network, so everything above it can be exercised exactly as it ships.
 */

/** `inProgressDelayMs: 1` so the `IDEMPOTENCY_IN_PROGRESS` retry does not add half a second to a test. */
export const testClient = () => new HttpApiClient({ timezone: 'Europe/Amsterdam', inProgressDelayMs: 1 });

/**
 * ⚠ **A2 (R-nav-24)** — the stack gained a router, and `MemoryRouter` is what lets a test open a screen
 * **at a URL** (`route: '/week/2026-08-24'`) rather than by driving the UI into it, and then assert on back
 * and forward the way a browser would.
 *
 * `initialEntries` is a real history stack, so `router.back()` in a test is the same operation the Android
 * back button performs — which is the property R-nav-24 exists to give the product.
 */
export function Providers({
  children,
  queryClient,
  withToast = true,
  route = '/',
  entries,
  browserHistory = false,
}: {
  children: ReactNode;
  queryClient: QueryClient;
  withToast?: boolean;
  route?: string;
  entries?: string[];
  browserHistory?: boolean;
}) {
  // `browserHistory` swaps in the real one, so a test can press `history.back()` and exercise the same
  // popstate path Android's back button does. jsdom implements it; `MemoryRouter` deliberately does not.
  const Router = browserHistory ? BrowserRouter : MemoryRouter;
  const routerProps = browserHistory ? {} : { initialEntries: entries ?? [route] };
  return (
    <QueryClientProvider client={queryClient}>
      <Router {...routerProps}>
        <ApiProvider client={testClient()}>
          <UIProvider>
            <ThemeProvider theme="light">
              {children}
              {withToast && <UIToast />}
            </ThemeProvider>
          </UIProvider>
        </ApiProvider>
      </Router>
    </QueryClientProvider>
  );
}

/**
 * Render inside the stack. Bare components get a `<UIToast />` mounted for them; `<AppRoot />` renders its
 * own inside its own `ThemeProvider`, so pass `withToast: false` for it and avoid two.
 */
export function renderApp(
  ui: ReactElement,
  options: RenderOptions & { withToast?: boolean; route?: string; entries?: string[]; browserHistory?: boolean } = {},
) {
  const { withToast = true, route, entries, browserHistory, ...rest } = options;
  const queryClient = createQueryClient({ retry: false });
  const user = userEvent.setup();
  if (browserHistory) for (const entry of entries ?? [route ?? '/']) window.history.pushState(null, '', entry);
  const result = render(ui, {
    wrapper: ({ children }) => (
      <Providers queryClient={queryClient} withToast={withToast} route={route} entries={entries} browserHistory={browserHistory}>
        {children}
      </Providers>
    ),
    ...rest,
  });
  return { ...result, user, queryClient };
}

export function renderAppHook<T>(hook: () => T, opts: { queryClient?: QueryClient; route?: string } = {}) {
  const queryClient = opts.queryClient ?? createQueryClient({ retry: false });
  const result = renderHook(hook, {
    wrapper: ({ children }) => (
      <Providers queryClient={queryClient} route={opts.route}>
        {children}
      </Providers>
    ),
  });
  return { ...result, queryClient };
}
