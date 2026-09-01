import { dateInTimezone, periodViewOf, weekStartOfDate, type Horizon, type PeriodView } from '@goal-cascade/shared';

/**
 * ⚠ **ANTI-DRIFT LAYER 3 of 3 — the runtime echo assertion** (R-lens-30).
 *
 * Layer 1 is the shared module, which **prevents** drift. Layer 2 is the hand-written boundary fixture
 * table, checked independently by an api test and a web test, which **detects** it in CI.
 *
 * Neither catches the case this does. **A shared module cannot drift; a shared module plus a client
 * bundle a week older than the Worker can** — an installed PWA with a stale service worker is exactly
 * that. So on every read that carries one, the server's `PeriodView` is compared against the view the
 * client just computed, field by field, ignoring `hasWork` (the one field that needs a database).
 *
 * **In dev and test it throws.** That is deliberate and it is proportionate to how invisible the failure
 * would otherwise be: a client that put the week of Mon 31 Aug in September would render
 * `Sep 2026 · Mon 31 Aug – …` over the server's September, which begins on the 7th. Nothing errors. The
 * screen is simply, quietly wrong for the first days of seven months a year.
 *
 * **In production it warns ONCE per session and yields to the server** — the server is the authority, the
 * owner's screen stays correct, and the disagreement becomes a reported bug instead of a wrong month.
 * Once, not per response, because a mismatch is a property of the deployment and not of the request: one
 * line in the console is a signal, four hundred is noise someone mutes.
 *
 * It costs one object comparison per response.
 */

/** `import.meta.env.DEV` is true under Vite dev and under Vitest; `MODE === 'test'` covers the rest. */
const STRICT = (() => {
  try {
    const env = import.meta.env as { DEV?: boolean; MODE?: string } | undefined;
    return !!env?.DEV || env?.MODE === 'test';
  } catch {
    return false;
  }
})();

let warned = false;

/** Test hook — the once-per-session latch is module state, and a test asserting it needs to clear it. */
export function resetPeriodEchoWarning(): void {
  warned = false;
}

type Echoed = Omit<PeriodView, 'hasWork'>;

function diff(server: Echoed, local: Echoed): string[] {
  const out: string[] = [];
  const cmp = (field: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${field}: server ${JSON.stringify(a)} ≠ local ${JSON.stringify(b)}`);
  };
  cmp('periodKey', server.periodKey, local.periodKey);
  cmp('label', server.label, local.label);
  cmp('weekRange', server.weekRange, local.weekRange);
  cmp('isCurrent', server.isCurrent, local.isCurrent);
  cmp('isPast', server.isPast, local.isPast);
  cmp('currentWeekPeriod', server.currentWeekPeriod, local.currentWeekPeriod);
  return out;
}

function report(what: string, mismatches: string[]): void {
  const message = `[period echo] ${what} — the server and this client disagree about the calendar. ${mismatches.join('; ')}`;
  if (STRICT) throw new Error(message);
  if (warned) return;
  warned = true;
  // eslint-disable-next-line no-console
  console.warn(`${message} — deferring to the server. This client bundle may be older than the API.`);
}

const clockFree = (v: Echoed): Echoed => ({ ...v, isCurrent: false, isPast: false, currentWeekPeriod: null });

/**
 * Compare a wire `PeriodView` against the locally computed one. Call it wherever a `LensResponse`,
 * `GoalDetailResponse` or `ZoomResponse` is consumed.
 *
 * ── ⚠ **Which day the comparison is made ON, which is the whole subtlety** ────
 * **The day the SERVER computed the payload for**, derived from that response's own `serverNow` in the
 * owner's stored zone — *not* the client's current `today`.
 *
 * This is what separates the two things that would otherwise look identical. A **stale cached payload**
 * is a payload that was *right when it was made*: at a midnight rollover the client's `isPast` moves and
 * the cached response's does not, and that is not drift — it is `lib/ownerClock`'s invalidation not
 * having landed yet, which is a race the design expects and repairs. **Version skew**, on the other hand,
 * is a payload that was *wrong when it was made*, and it is wrong on its own day too. Comparing against
 * the response's own instant catches the second and is silent about the first.
 *
 * **Skipped when the timezone is not yet known.** Three of the six fields depend on it, and while
 * preferences are unknown the client is deliberately using `'UTC'` — a disagreement there would be the
 * client not knowing yet, and firing on it would make the assertion cry wolf on every cold open.
 * `periodKey`, `label` and `weekRange` need no clock, so those three are checked either way.
 */
export function assertPeriodAgrees(
  what: string,
  lens: Horizon,
  server: PeriodView | null | undefined,
  /** The response's own `serverNow`. */
  serverNow: string | undefined,
  /** The owner's stored zone, or `null` while preferences are unknown. */
  tz: string | null,
): void {
  if (!server || lens === 'Life') return;
  const known = tz !== null && !!serverNow;
  const at = known ? dateInTimezone(serverNow!, tz!) : '1970-01-01';
  const local = periodViewOf(lens, server.periodKey, at);
  const mismatches = known ? diff(server, local) : diff(clockFree(server), clockFree(local));
  if (mismatches.length > 0) report(what, mismatches);
}

/**
 * The one live check on the timezone ladder (`lib/ownerClock`'s table).
 *
 * `BootstrapResponse.week.weekStart` is the Monday the SERVER resolved from the account's stored zone.
 * `weekStartOfDate(dateInTimezone(serverNow, tz))` is the Monday the client derives from *its* resolution
 * of that same zone. If the client's `tz` is wrong for any reason — a preferences read that answered for
 * the wrong account, a fallback that fired when it should not have — these two disagree, and **nothing
 * else in the app would notice**: every week boundary in the product would simply be a day out.
 *
 * Same instant discipline as above: the comparison is made on the response's own `serverNow`, so a
 * bootstrap payload cached across a midnight is not mistaken for a broken timezone.
 */
export function assertCurrentMondayAgrees(serverWeekStart: string | undefined, serverNow: string | undefined, tz: string | null): void {
  if (!serverWeekStart || !serverNow || tz === null) return;
  const local = weekStartOfDate(dateInTimezone(serverNow, tz));
  if (local === serverWeekStart) return;
  report('BootstrapResponse.week.weekStart', [`weekStart: server ${JSON.stringify(serverWeekStart)} ≠ local ${JSON.stringify(local)}`]);
}
