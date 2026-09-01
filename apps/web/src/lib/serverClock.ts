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
 * ⚠ **R-lens-30** — one observer, set by `lib/ownerClock`, so a skew correction that moves the owner's
 * calendar day moves the day too. That is the near-midnight-with-a-drifted-device case: the device says
 * 23:58 on the 31st, the server says 00:02 on the 1st, and the first response of the session is what tells
 * the client which.
 *
 * A callback rather than the `subscribeServerClock` set this module used to carry: that one walked an
 * empty listener set on every response for the whole of its life, because nothing ever subscribed. One
 * consumer, one slot.
 */
let observer: (() => void) | null = null;

export function observeServerClock(fn: (() => void) | null): void {
  observer = fn;
}

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
  observer?.();
}

/** Current time in epoch ms, corrected to the server clock. */
export const nowMs = (): number => Date.now() + skewMs;

/** ISO string for "now" as the server sees it. */
export const nowIso = (): string => new Date(nowMs()).toISOString();

/** Test hook. */
export function resetServerClock(): void {
  skewMs = 0;
  observer = null;
}
