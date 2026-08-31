/**
 * Week math — the server-side, timezone-aware replacement for the mockup's `utils/dates.ts`.
 *
 * Two rules govern everything here, and a feature agent must not work around either:
 *
 *  1. **A week is an absolute ISO date: the Monday of that week** (SPEC D-1). The mockup stored relative
 *     offsets, so every persisted row changed meaning at midnight on Monday — a task written with
 *     `originWeek: -2` silently reads as three weeks old the next week, with no write, and the red
 *     "N weeks" carry chip fires on tasks nobody neglected. Offsets exist ONLY on the wire, and are
 *     resolved to a `weekStart` at the request boundary.
 *  2. **The week is computed from the OWNER's timezone** (R-auth-5, Q-9), never the client clock — so a
 *     phone in UTC−8 and one in Europe/Berlin agree on "this week" near a Sunday/Monday boundary.
 *
 * Because a week is a date, all arithmetic here is date-only and DST is irrelevant.
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

/**
 * R-task-43 — the **signed** carry age of a task in the week being viewed:
 * `weeksBetween(origin, min(viewedWeek, currentWeek))`.
 *
 * Labels: `<= 0` → none; `= 1` → the gray "since Mon 24 Aug"; `>= 2` → the red "N weeks · since 10 Aug"
 * chip, the only escalation in the product. The 1-week and 2-week thresholds are unchanged from
 * R-task-10/11/12.
 *
 * **Two terms, and each answers a different way of being wrong.**
 *
 *  1. It is measured against the **VIEWED** week, not today (S-task-11-2): a task with origin two weeks
 *     ago, viewed in the week after its origin, is one week old THERE and shows the gray label. A past
 *     week must read as it read then.
 *  2. `min(…, currentWeek)` is what keeps a **plan** from ageing. A task planned for `+1` and viewed at
 *     `+3` is age `−1`, not 2 — the naive `viewed − origin` would read 2 and fire the product's only
 *     escalation at work nobody is late with, which R-lens-11 forbids outright.
 *
 * ⚠ **A2 supersedes R-task-37's outer `max(0, …)` clamp.** Dropping it changes nothing that renders —
 * no label fires below 1 either way — and leaves ONE guard instead of two, carried in the sign. A
 * negative age is the honest reading of "not due yet". **`TaskView.carryWeeks` therefore stops being
 * `nonnegative`: it is a silent wire break, and anything summing these values is now wrong.**
 *
 * An already-late open task (origin in the past) projected into a future week keeps the age it has
 * TODAY: it is late now and still open then, so the chip is correct there (S-task-43-2).
 */
export function carryWeeks(originWeekStart: string, viewedWeekStart: string, currentWeekStart: string): number {
  const measuredAt = viewedWeekStart < currentWeekStart ? viewedWeekStart : currentWeekStart;
  return weeksBetween(originWeekStart, measuredAt);
}

/**
 * R-task-7/8 / R-task-32 — is this task visible in `viewedWeekStart`?
 *
 * An OPEN task is visible in every week at or after its origin: it carries forward with no prompt and,
 * crucially, with NO WRITE — carrying is derived, which is why this product has no cron (Q-17). A DONE
 * task is visible only in the week it was completed. An EXITED task (canceled / movedToBacklog) is
 * visible in no week at all (D-15).
 */
export function isVisibleInWeek(
  task: { status: 'open' | 'done' | 'canceled' | 'movedToBacklog'; originWeekStart: string; doneWeekStart: string | null },
  viewedWeekStart: string,
): boolean {
  if (task.status === 'open') return weeksBetween(task.originWeekStart, viewedWeekStart) >= 0;
  if (task.status === 'done') return task.doneWeekStart === viewedWeekStart;
  return false;
}

/*
 * ⚠ **A2 (R-lens-7, R-rm-3)** — `selectableWeeks` is DELETED, not left unused.
 *
 * It computed "the weeks the switcher may address": the current week and the previous
 * `WEEK_HISTORY_WEEKS - 1`. Both halves of that are retired. There is no picker to enumerate (the lens
 * title opens the Zoom sheet instead — R-lens-17), no forward bound (R-goal-36) and no backward bound
 * either: greying out the back chevron at the account's first period would cost a `MIN(period_key)`
 * probe on every render to disable one control, and a bound in one direction only rebuilds D-24's
 * asymmetry. D-24's rule is now satisfied by CONSTRUCTION — one control per dimension, so no two
 * controls can disagree about a range.
 *
 * The function is removed rather than deprecated because an unused range helper is one refactor away
 * from being a used one (the R-rm-* discipline).
 */
