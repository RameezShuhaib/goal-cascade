/**
 * Week math — timezone-aware, and **shared** by the Worker and the browser bundle.
 *
 * Two rules govern everything here, and a feature agent must not work around either:
 *
 *  1. **A week is an absolute ISO date: the Monday of that week** (SPEC D-1). The mockup stored relative
 *     offsets, so every persisted row changed meaning at midnight on Monday — a task written with
 *     `originWeek: -2` silently reads as three weeks old the next week, with no write, and the red
 *     "N weeks" carry chip fires on tasks nobody neglected. Offsets exist ONLY on the wire, and are
 *     resolved to a `weekStart` at the request boundary.
 *  2. **The week is computed from the OWNER's timezone** (R-auth-5, Q-9), never the device clock — so a
 *     phone in UTC−8 and one in Europe/Berlin agree on "this week" near a Sunday/Monday boundary. On the
 *     client that means the STORED account zone applied to the SERVER's clock, never the device zone: see
 *     `apps/web/src/lib/ownerClock.ts`.
 *
 * Because a week is a date, all arithmetic here is date-only and DST is irrelevant.
 *
 * ── Why this lives in `packages/shared` (R-lens-30) ────────────────────────────
 * It used to be `apps/api/src/domain/weeks.ts`, and the client held a partial re-implementation of it in
 * `utils/periodKeys.ts` + `utils/dates.ts` while a doc block insisted it did not. **A rule the two sides
 * must agree about is shared vocabulary and belongs in one module**; a rule only one side is allowed to
 * have an opinion about is policy and stays on the server. `carryWeeks` and `isVisibleInWeek` are policy
 * and remain in `apps/api/src/domain/weeks.ts`; every function below is vocabulary.
 *
 * Zero runtime imports: this module is pure and depends on nothing but `Intl`.
 */

const MS_PER_DAY = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for an IANA zone this runtime accepts. Anything else must fall back to `UTC`, never throw. */
export function isValidTimezone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * The calendar date (`YYYY-MM-DD`) at `instantIso` **in `tz`**. This is the single place the owner's
 * timezone turns an instant into a day; everything else here is pure date arithmetic.
 */
export function dateInTimezone(instantIso: string, tz: string): string {
  const zone = isValidTimezone(tz) ? tz : 'UTC';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instantIso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function assertDate(date: string): number {
  if (!DATE_RE.test(date)) throw new RangeError(`not an ISO date: ${JSON.stringify(date)}`);
  const t = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(t)) throw new RangeError(`not an ISO date: ${JSON.stringify(date)}`);
  return t;
}

/** 0 = Sunday … 6 = Saturday, for a plain date. */
function dayOfWeek(date: string): number {
  return new Date(assertDate(date)).getUTCDay();
}

export function isMonday(date: string): boolean {
  return DATE_RE.test(date) && dayOfWeek(date) === 1;
}

function toDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The Monday of the week containing `date`. Weeks start Monday, so Sunday belongs to the week before. */
export function weekStartOfDate(date: string): string {
  const ms = assertDate(date);
  // getUTCDay(): Sun=0..Sat=6. `(dow + 6) % 7` maps Monday→0 … Sunday→6, i.e. days since Monday.
  const sinceMonday = (new Date(ms).getUTCDay() + 6) % 7;
  return toDate(ms - sinceMonday * MS_PER_DAY);
}

/** The Monday of the week containing `instantIso`, evaluated in the owner's timezone. */
export function weekStartOf(instantIso: string, tz: string): string {
  return weekStartOfDate(dateInTimezone(instantIso, tz));
}

/** `weekStart` shifted by `n` whole weeks (negative = earlier). */
export function addWeeks(weekStart: string, n: number): string {
  return toDate(assertDate(weekStart) + n * 7 * MS_PER_DAY);
}

/**
 * Whole weeks from `from` to `to` (positive when `to` is later). Both must be Mondays, so the difference
 * is always an exact multiple of 7 days and no rounding is involved.
 */
export function weeksBetween(from: string, to: string): number {
  return Math.round((assertDate(to) - assertDate(from)) / (7 * MS_PER_DAY));
}

/**
 * The wire projection: how many weeks `weekStart` is from the current week. 0 = this week, negative =
 * past, **positive = future**.
 *
 * ⚠ **A2 (R-lens-7)** — a positive value is now ordinary. The old doc block here said "positive is only
 * ever produced by bad data", which is false: any future period is reachable and writable at every
 * horizon (R-goal-36), and the forward chevron is never disabled.
 */
export function offsetOf(weekStart: string, currentWeekStart: string): number {
  return weeksBetween(currentWeekStart, weekStart);
}

/** Resolve a wire offset against the current week, in either direction. The inverse of `offsetOf`. */
export function weekStartFromOffset(currentWeekStart: string, offset: number): string {
  return addWeeks(currentWeekStart, offset);
}
