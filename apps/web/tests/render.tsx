import type { ReactElement, ReactNode } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render, renderHook, type RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpApiClient } from '../src/api/http';
import { createQueryClient } from '../src/lib/queryClient';
import { ApiProvider } from '../src/context/ApiContext';
import { ThemeProvider } from '../src/context/ThemeContext';
import { UIProvider } from '../src/context/UIContext';
import { UIToast } from '../src/App';

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

export function Providers({
  children,
  queryClient,
  withToast = true,
}: {
  children: ReactNode;
  queryClient: QueryClient;
  withToast?: boolean;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={testClient()}>
        <UIProvider>
          <ThemeProvider theme="light">
            {children}
            {withToast && <UIToast />}
          </ThemeProvider>
        </UIProvider>
      </ApiProvider>
    </QueryClientProvider>
  );
}

/**
 * Render inside the stack. Bare components get a `<UIToast />` mounted for them; `<AppRoot />` renders its
 * own inside its own `ThemeProvider`, so pass `withToast: false` for it and avoid two.
 */
export function renderApp(ui: ReactElement, options: RenderOptions & { withToast?: boolean } = {}) {
  const { withToast = true, ...rest } = options;
  const queryClient = createQueryClient({ retry: false });
  const user = userEvent.setup();
  const result = render(ui, {
    wrapper: ({ children }) => (
      <Providers queryClient={queryClient} withToast={withToast}>
        {children}
      </Providers>
    ),
    ...rest,
  });
  return { ...result, user, queryClient };
}

export function renderAppHook<T>(hook: () => T, opts: { queryClient?: QueryClient } = {}) {
  const queryClient = opts.queryClient ?? createQueryClient({ retry: false });
  const result = renderHook(hook, {
    wrapper: ({ children }) => <Providers queryClient={queryClient}>{children}</Providers>,
  });
  return { ...result, queryClient };
}
