/**
 * Every read model and every command response carries `serverNow`. We keep the offset between the server
 * clock and this device so anything the UI dates ("since Mon 24 Aug", a carry age, "this week") agrees with
 * the server's own decisions even when the phone's clock drifts.
 *
 * R-auth-5 is the reason this matters more here than it looks: the server resolves "the current week" from
 * the OWNER's timezone, never the client clock. The client must therefore never re-derive a week boundary —
 * read models answer with an absolute `weekStart` — and where it does need a "now" (relative labels), it
 * should use the server's.
 */
let skewMs = 0;
const listeners = new Set<() => void>();

export function recordServerNow(iso: string): void {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return;
  const next = t - Date.now();
  const changed = Math.abs(next - skewMs) > 500;
  skewMs = next;
  if (changed) for (const l of listeners) l();
}

/** Notified when the skew moves by more than half a second (first response, clock drift). */
export function subscribeServerClock(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const serverSkewMs = (): number => skewMs;

/** Current time in epoch ms, corrected to the server clock. */
export const nowMs = (): number => Date.now() + skewMs;

/** ISO string for "now" as the server sees it. */
export const nowIso = (): string => new Date(nowMs()).toISOString();

/** Test hook. */
export function resetServerClock(): void {
  skewMs = 0;
}
