import { HORIZONS, isPeriodKeyFor, type Horizon } from '@goal-cascade/shared';
import { addWeeks } from './dates';

/**
 * Arithmetic over **canonical period keys** (R-goal-33), and nothing else.
 *
 * ── What this file is allowed to do, and why it is not a second implementation of a date rule ──
 *
 * Every *judgement* about time stays on the server and arrives on the wire: whether a period is current or
 * past (`PeriodView.isCurrent` / `.isPast`, R-goal-34), which period a lens opens on when the URL names
 * none (R-lens-14), which period each horizon zooms to (`GET /goals/zoom`, R-lens-9), and what a period is
 * called (`PeriodView.label`). None of that is re-derived here — D-3 is the reason, and `utils/periods.ts`
 * already lost `replanPeriods` to exactly that argument.
 *
 * What is left is **stepping and containment between two canonical keys**, which the wire cannot answer
 * because no read model carries "the next period". `2026-Q3 → 2026-Q4` is string arithmetic on a format
 * whose whole purpose is to be comparable and sortable; it consults no clock, so it cannot disagree with
 * the server about *now*.
 *
 * **The one Monday rule is never re-derived.** A Weekly key is a `WeekStart` (D-1) and Mondays are the
 * owner's timezone's, so every function here that needs one takes a **known Monday the server sent** and
 * walks whole weeks from it (`addWeeks`). There is no `weekStartOfDate` in this client and there must not
 * be one.
 */

export function rank(horizon: Horizon): number {
  return HORIZONS.indexOf(horizon);
}

/** Horizons strictly longer than `horizon` — the only legal parents of a goal at it (R-goal-5). */
export function longerHorizons(horizon: Horizon): Horizon[] {
  return HORIZONS.filter((h) => rank(h) < rank(horizon));
}

const QUARTER_RE = /^(\d{4})-Q([1-4])$/;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** The unit a lens steps by — the word the chevrons' accessible names and the off-now badge use. */
export const PERIOD_UNIT: Record<Horizon, string> = {
  Life: 'period',
  Yearly: 'year',
  Quarterly: 'quarter',
  Monthly: 'month',
  Weekly: 'week',
};

/**
 * R-lens-7 — step a period by `n` of its own unit. **Neither direction is bounded**: there is no forward
 * cap (R-goal-36) and the backward clamp went with `WEEK_HISTORY_WEEKS` (R-rm-3).
 *
 * The Weekly case walks whole weeks off the key itself, which the server guaranteed is a Monday, so the
 * result is a Monday without anyone re-deriving one.
 */
export function stepPeriod(horizon: Horizon, key: string, n: number): string {
  if (horizon === 'Life') return '';
  if (horizon === 'Weekly') return addWeeks(key, n);
  if (horizon === 'Yearly') return String(Number(key) + n);
  const q = QUARTER_RE.exec(key);
  if (horizon === 'Quarterly' && q) {
    const ord = Number(q[1]) * 4 + (Number(q[2]) - 1) + n;
    return `${Math.floor(ord / 4)}-Q${(((ord % 4) + 4) % 4) + 1}`;
  }
  const m = MONTH_RE.exec(key);
  if (horizon === 'Monthly' && m) {
    const ord = Number(m[1]) * 12 + (Number(m[2]) - 1) + n;
    return `${Math.floor(ord / 12)}-${pad2((((ord % 12) + 12) % 12) + 1)}`;
  }
  return key;
}

/** The first calendar date inside the period `key` names — R-lens-18's anchor when today is elsewhere. */
export function firstDayOf(horizon: Horizon, key: string): string {
  if (horizon === 'Yearly') return `${key}-01-01`;
  const q = QUARTER_RE.exec(key);
  if (horizon === 'Quarterly' && q) return `${q[1]}-${pad2((Number(q[2]) - 1) * 3 + 1)}-01`;
  const m = MONTH_RE.exec(key);
  if (horizon === 'Monthly' && m) return `${m[1]}-${m[2]}-01`;
  if (horizon === 'Weekly' && DAY_RE.test(key)) return key;
  return key;
}

/**
 * The key of the `horizon` period **containing** the calendar date `date` — used only to walk *up* from a
 * key we already hold (a Monthly goal's quarter, a Weekly goal's month), never to answer "what is now".
 *
 * A week belongs to its **Monday's** month (R-lens-9), which is why the Weekly case passes its own key in.
 */
export function containingKey(horizon: Horizon, date: string): string {
  const d = DAY_RE.exec(date);
  if (!d) return date;
  const year = Number(d[1]);
  const month = Number(d[2]);
  switch (horizon) {
    case 'Life':
      return '';
    case 'Yearly':
      return String(year);
    case 'Quarterly':
      return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
    case 'Monthly':
      return `${year}-${pad2(month)}`;
    case 'Weekly':
      return date;
  }
}

/** The period of `horizon` that encloses the period `key` of `of` — `2026-08` inside `2026-Q3`, `2026`. */
export function enclosingKey(horizon: Horizon, of: Horizon, key: string): string {
  if (horizon === 'Life') return '';
  return containingKey(horizon, firstDayOf(of, key));
}

const MS_DAY = 86_400_000;
const utc = (isoDate: string) => Date.parse(`${isoDate}T00:00:00.000Z`);

/** Whole weeks from `from` to `to`, both Mondays the server sent. Used for the `?week=` offsets. */
export function weeksBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / (7 * MS_DAY));
}

/**
 * R-lens-9 / R-goal-47 / R-task-49 — **the one answer to "which week does this month mean"**: the week
 * containing today when the month contains today, otherwise the first week whose **Monday** falls in it.
 *
 * `currentMonday` is the server's (`WeekView.weekStart`), and `todayMonthKey` is the month it falls in, so
 * neither a Monday nor a "today" is derived from the device clock here. The fallback walks whole weeks off
 * that same Monday, so its result is a Monday by construction.
 */
export function weekForMonth(monthKey: string, currentMonday: string, todayMonthKey: string): string {
  if (monthKey === todayMonthKey) return currentMonday;
  const first = firstDayOf('Monthly', monthKey);
  // How many whole weeks from the known Monday to the month's first day, rounded DOWN, then one more if
  // that lands before the month starts. The result is always `currentMonday + 7k`, hence always a Monday.
  const weeks = Math.floor((utc(first) - utc(currentMonday)) / (7 * MS_DAY));
  const candidate = addWeeks(currentMonday, weeks);
  return candidate >= first ? candidate : addWeeks(candidate, 1);
}

/** A URL segment is attacker-supplied: a key that is not canonical for its lens is dropped, not trusted. */
export function validKeyFor(horizon: Horizon, key: string | undefined): string | undefined {
  if (horizon === 'Life' || !key) return undefined;
  return isPeriodKeyFor(horizon, key) ? key : undefined;
}
