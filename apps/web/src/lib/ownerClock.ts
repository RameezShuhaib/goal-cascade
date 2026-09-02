import { useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { dateInTimezone } from '@goal-cascade/shared';
import { nowIso, observeServerClock } from './serverClock';
import { keys } from './queryClient';

/**
 * ⚠ **R-lens-30, new** — **the owner's calendar day, as an external store.**
 *
 * The app is an installed PWA that can sit open for days, so "today" is not a value you read once. This
 * module owns one string — `dateInTimezone(serverNow, storedTimezone)` — recomputes it on five triggers,
 * notifies only when it actually *changed*, and invalidates the read models whose meaning depends on it.
 *
 * ── The timezone ladder, which must mirror the server's exactly ────────────────
 * `apps/api/src/api/middleware/timezone.ts` is unambiguous: when the account has preferences,
 * `ctx.tz = preferences.timezone` and **`X-Timezone` is ignored** — "an owner travelling in another zone
 * must still get their home week" (S-auth-5-1). So:
 *
 * | Client state | `tz` used | Matches the server because |
 * |---|---|---|
 * | `['me','preferences']` in cache (live or restored) | `preferences.timezone` | Same value, same field; the persisted cache is keyed per user. |
 * | Neither | **`'UTC'`** | `isValidTimezone` fails → the server uses `'UTC'`. |
 *
 * **Not the device zone.** The `todayInZone` this replaced fell back to it, which is precisely the
 * disagreement R-auth-5 forbids. The `'UTC'` fallback governs nothing the owner sees, because the header's
 * title and range need no `today` at all and the badges that do are suppressed until a `tz` is known
 * (`lens/useCalendarPeriod.ts`).
 *
 * **Crossing a timezone while travelling changes nothing, by design.** The client uses the *stored* zone,
 * so a traveller in Tokyo at 08:00 whose account is `Europe/Berlin` sees Berlin's yesterday — and so does
 * the server.
 */

export interface OwnerClockState {
  /** The IANA zone in force, or `null` while preferences are unknown. */
  tz: string | null;
  /** The owner's calendar date, `YYYY-MM-DD`. Always a real date, even when `tz` is null (`'UTC'`). */
  today: string;
}

const FALLBACK_TZ = 'UTC';

/**
 * A re-arming timer capped at **15 minutes**, deliberately, rather than one armed to the next owner-local
 * midnight. Background timer throttling makes a 14-hour `setTimeout` unreliable in an installed PWA, and a
 * 15-minute wake that recomputes one string costs nothing. The `visibilitychange` trigger is what actually
 * carries the two-days-backgrounded case; this is the belt to its braces.
 */
const TICK_MS = 15 * 60_000;

let tz: string | null = null;
let today = dateInTimezone(nowIso(), FALLBACK_TZ);
let listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let snapshot: OwnerClockState = { tz, today };
let onDayChange: ((from: string, to: string) => void) | null = null;

function publish(): void {
  snapshot = { tz, today };
  for (const l of [...listeners]) l();
}

/**
 * Recompute, and notify **only if the string changed**. Every trigger funnels through here, so a wake, a
 * focus and a response landing in the same millisecond are one recomputation and at most one render.
 */
export function refreshOwnerToday(): void {
  const next = dateInTimezone(nowIso(), tz ?? FALLBACK_TZ);
  if (next === today) return;
  const from = today;
  today = next;
  publish();
  onDayChange?.(from, next);
}

/**
 * Trigger 5 — a `preferences.timezone` change. A traveller who updates their home zone gets a new `today`
 * without a reload, and the very first preferences read is what lifts the `'UTC'` fallback.
 */
export function setOwnerTimezone(next: string | null): void {
  if (next === tz) return;
  tz = next;
  const recomputed = dateInTimezone(nowIso(), tz ?? FALLBACK_TZ);
  const changed = recomputed !== today;
  const from = today;
  today = recomputed;
  // The `tz` half of the snapshot moved even when the date did not, and that matters: it is what tells the
  // header the badges may now render at all.
  publish();
  if (changed) onDayChange?.(from, today);
}

function arm(): void {
  if (timer !== null) return;
  timer = setTimeout(function tick() {
    timer = null;
    refreshOwnerToday();
    if (listeners.size > 0) arm();
  }, TICK_MS);
}

const wake = () => refreshOwnerToday();
const onVisible = () => {
  if (document.visibilityState === 'visible') refreshOwnerToday();
};

function subscribe(listener: () => void): () => void {
  const first = listeners.size === 0;
  listeners.add(listener);
  if (first) {
    // Triggers 2, 3 and 4. `visibilitychange` is the load-bearing one: an installed PWA backgrounded for
    // two days has had its timers frozen, and the first thing that happens when the owner looks at it is a
    // visibility change. `focus` covers the desktop tab; `online` covers the wake from airplane mode.
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    // Trigger 4 — `recordServerNow`, which runs on every response (`api/http.ts`). If the skew correction
    // moves `today`, this follows: the near-midnight-with-a-drifted-device case.
    observeServerClock(wake);
    arm();
    // Something may have moved between the module loading and the first subscriber mounting.
    refreshOwnerToday();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', wake);
    window.removeEventListener('online', wake);
    observeServerClock(null);
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
}

const getSnapshot = (): OwnerClockState => snapshot;

/**
 * The owner's calendar day and the zone it was computed in. `tz` is `null` until preferences are known,
 * which is the signal a caller uses to suppress a badge rather than guess at one.
 */
export function useOwnerClock(): OwnerClockState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** The owner's calendar date, `YYYY-MM-DD`. The stored account zone applied to the server's clock. */
export function useOwnerToday(): string {
  return useOwnerClock().today;
}

/**
 * **What the rollover invalidates, and why each one.**
 *
 * `BootstrapResponse`'s own doc block already states the caveat — *"`week.offset` and `carryAge` are
 * projections against `serverNow`, and a client holding a stale payload must refetch rather than re-derive
 * them."* Midnight is the moment that sentence comes due.
 *
 * **What the owner sees: nothing moves under them.** The URL still names a period, and a period's
 * *identity* does not change at midnight — its *status* does. The week being viewed may become the past
 * week, and a Monthly lens sitting on the current month may pick up or drop `This week is in Aug 2026`.
 * Without this, the client would keep offering `+ Goal` on a week that became past at midnight, and
 * the write would come back `PERIOD_IN_PAST` — a refusal with no visible cause.
 */
export function invalidateForDayChange(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: keys.goalsAll }); // isPast / hasWork / hasForwardContent per period
  void qc.invalidateQueries({ queryKey: ['bootstrap'] }); // week.offset and carryAge are projections
  void qc.invalidateQueries({ queryKey: keys.tasksAll }); // carryAge
}

/**
 * Mounted once by `AppShell`. It is the only thing that knows both the store and the cache, which keeps
 * `ownerClock` itself free of a React Query dependency and therefore trivially testable.
 */
export function useOwnerClockInvalidation(): void {
  const qc = useQueryClient();
  onDayChange = () => invalidateForDayChange(qc);
}

/** Test hook — resets the module's one piece of state between tests. */
export function resetOwnerClock(): void {
  tz = null;
  today = dateInTimezone(nowIso(), FALLBACK_TZ);
  snapshot = { tz, today };
  onDayChange = null;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  listeners = new Set();
}
