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

/**
 * ⚠ `subscribeServerClock` and `serverSkewMs` are deleted, and the half-second change detection went with
 * them: nothing ever subscribed, so the notify loop walked an empty set on every response and the
 * `changed` comparison computed an answer no one read. `nowMs` reads `skewMs` directly, which is the only
 * way the skew has ever been consumed.
 */
export function recordServerNow(iso: string): void {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return;
  skewMs = t - Date.now();
}

/** Current time in epoch ms, corrected to the server clock. */
export const nowMs = (): number => Date.now() + skewMs;

/** ISO string for "now" as the server sees it. */
export const nowIso = (): string => new Date(nowMs()).toISOString();

/** Test hook. */
export function resetServerClock(): void {
  skewMs = 0;
}
