import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { HttpApiClient, type ApiClient } from '../api/http';

const ApiCtx = createContext<ApiClient | null>(null);

/**
 * Dependency injection, NOT state. It exists so a test can hand the tree a different client — one with a
 * fixed timezone, a stubbed `fetch`, a one-millisecond in-progress delay — without any component knowing.
 *
 * This is the single seam through which the network is replaced. Nothing below it constructs an
 * `HttpApiClient`, and nothing below it calls `fetch`.
 */
export function ApiProvider({ client, children }: { client?: ApiClient; children: ReactNode }) {
  const instance = useMemo<ApiClient>(() => client ?? new HttpApiClient(), [client]);
  return <ApiCtx.Provider value={instance}>{children}</ApiCtx.Provider>;
}

/** Throws when the provider is missing, so the mistake surfaces at the first render, not as a silent default. */
export function useApi(): ApiClient {
  const ctx = useContext(ApiCtx);
  if (!ctx) throw new Error('useApi must be used inside <ApiProvider>');
  return ctx;
}
