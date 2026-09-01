import { isPeriodKeyFor, type Horizon } from '../common';
import { addWeeks, weekStartOfDate } from './weeks';

/**
 * Period arithmetic — **the one place it lives** (R-goal-33, R-goal-34, R-lens-9).
 *
 * A2 gave every non-Life goal a canonical, sortable `periodKey`, one format per horizon, and made the
 * old free-text `period` a derived label. That turns four separate ad-hoc date rules into one module,
 * and the reason it must be one module is D-3: the mockup hardcoded 2026 literals in three places and
 * every one of them was wrong from the first day of the next period. Two implementations of a date rule
 * drift on the first boundary.
 *
 * | Horizon | `periodKey` | label | example |
 * |---|---|---|---|
 * | Life | `''` | `''` | — |
 * | Yearly | `YYYY` | `YYYY` | `2026` |
 * | Quarterly | `YYYY-Qn` | `Qn YYYY` | `Q3 2026` |
 * | Monthly | `YYYY-MM` | `Mon YYYY` | `Sep 2026` |
 * | Weekly | a **Monday** `YYYY-MM-DD` | `Week of D Mon` | `Week of 7 Sep` |
 *
 * **The keys sort lexicographically in chronological order, and that is load-bearing**, not a
 * coincidence of formatting: R-goal-47's planned-ness read is a `period_key BETWEEN` range scan over
 * `ix_goals_lens`, R-lens-26's "is there anything later" is a `>` probe on the same index, and
 * R-lens-12's carried band is an `ORDER BY period_key`. Change a format and all three become scans.
 *
 * **The week model is a special case of the period model, not a parallel one** (R-goal-33). A Weekly
 * key IS a `WeekStart`, so `weeks.ts` remains the authority on Mondays and this module defers to it.
 *
 * Pure: every function is `(horizon, a date or a key) → a string`. `today` is always the OWNER's local
 * calendar date (R-auth-5) — resolve it with `weeks.dateInTimezone` before calling in.
 *
 * ── Why this lives in `packages/shared` (R-lens-30) ────────────────────────────
 * It used to be `apps/api/src/domain/periods.ts`, and `apps/web/src/utils/periodKeys.ts` held a
 * line-for-line copy of `stepPeriod`, `firstDayOf` and `periodKeyOf` under a doc block arguing at length
 * that it was not a second implementation. It was, and the drift D-3 warns about was already latent.
 * **The client may not hold a *second* implementation of a date rule; it may import the *only* one.**
 *
 * Every field of `PeriodView` except `hasWork` is a pure function of `(horizon, periodKey, today)`, and
 * `label` and `weekRange` need no `today` at all — which is why the lens header renders correctly before
 * the session, the timezone or the network are known (`calendar/period-view.ts`).
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
/** Monday first, because a week starts on Monday here (D-1) and this indexes off that Monday. */
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const YEAR_RE = /^\d{4}$/;
const QUARTER_RE = /^(\d{4})-Q([1-4])$/;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `today` is `YYYY-MM-DD`; splitting is safe because every producer of it emits exactly that. */
function ymd(date: string): { year: number; month: number; day: number } {
  const [y, m, d] = date.split('-');
  return { year: Number(y), month: Number(m), day: Number(d) };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * R-goal-33 / R-goal-34 — the canonical key for the period of `horizon` that CONTAINS `date`.
 *
 * With `date` = the owner's today this is "the current period" (R-goal-34), which is what every past /
 * future judgement in A2 compares against — computed server-side from the account timezone and echoed on
 * the wire, so the client never re-derives one. That is R-auth-5's disagreement, now four times over
 * instead of once.
 */
export function periodKeyOf(horizon: Horizon, date: string): string {
  const { year, month } = ymd(date);
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
      // A Weekly key IS a WeekStart (D-1). `weeks.ts` owns the Monday rule; this never re-derives it.
      return weekStartOfDate(date);
  }
}

/*
 * ⚠ **R-lens-30** — `isPeriodKey` is DELETED, not moved. It was a third copy of a predicate that already
 * existed twice (`common.ts:isPeriodKeyFor`, and the `isMondayKey` it was cut out of), and it lived
 * beside them for as long as the calendar and the schemas were in different packages. They are in one
 * package now, so `isPeriodKeyFor` is the only spelling and there is nothing left to disagree with it.
 */

/**
 * R-goal-33 — the rendered label. `period` on the wire is **[srv]** and is exactly this: a client-supplied
 * value is ignored, and no goal in the account has a `period` that is not the rendering of its own key
 * (S-goal-33-3).
 *
 * An unrecognised key renders as itself rather than throwing. A label is display text, and a read that
 * 500s because one row's key is malformed hides the row instead of surfacing it (R-lens-20's principle).
 */
export function labelOf(horizon: Horizon, key: string): string {
  if (horizon === 'Life' || key === '') return '';
  // A yearly period's key IS its label (`2026`), well-formed or not — this function renders what it is
  // given rather than validating it (see above). This read `YEAR_RE.test(key) ? key : key`, which
  // evaluated the regex and discarded the answer: a lost branch, not a rule.
  if (horizon === 'Yearly') return key;
  const q = QUARTER_RE.exec(key);
  if (horizon === 'Quarterly' && q) return `Q${q[2]} ${q[1]}`;
  const m = MONTH_RE.exec(key);
  if (horizon === 'Monthly' && m) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  if (horizon === 'Weekly' && DAY_RE.test(key)) {
    const { month, day } = ymd(key);
    return `Week of ${day} ${MONTHS[month - 1]}`;
  }
  return key;
}

/**
 * R-lens-28 — **the range label**: the whole weeks the period `key` actually contains, e.g.
 * `Mon 7 Sep – Sun 4 Oct` for `2026-09`.
 *
 * `labelOf` names a period and this one **measures** it, and the pair exists because the name
 * over-promises on its own. A week belongs to its Monday's month (R-goal-33, RECONCILIATION ★C-19), so
 * `Sep 2026` is the four weeks beginning 7, 14, 21 and 28 Sep — it does not contain the week of Mon
 * 31 Aug, and it runs four days past the 30th. `Sep 2026` alone reads as 1–30 September and is
 * therefore a promise the lens does not keep; this is the broadcast-calendar convention that answers
 * it, which is to publish the span beside the name and never the name alone.
 *
 * **The years appear only when the two ends disagree about one** — `Mon 7 Dec 2026 – Sun 3 Jan 2027`,
 * where the title's own `Dec 2026` cannot disambiguate the far end, and never otherwise, because a
 * year repeated three times in one header is the clutter this shell is budgeted against (R-nav-27).
 *
 * An unrecognised key measures to `''` rather than throwing, for `labelOf`'s reason: display text that
 * 500s hides the row it was meant to describe.
 */
export function weekRangeOf(horizon: Horizon, key: string): string {
  if (horizon === 'Life' || key === '' || !isPeriodKeyFor(horizon, key)) return '';
  const from = firstWeekOf(horizon, key);
  const to = shiftDays(lastWeekOf(horizon, key), 6);
  const spansYears = ymd(from).year !== ymd(to).year;
  return `${dayLabel(from, spansYears)} – ${dayLabel(to, spansYears)}`;
}

/** `Mon 7 Sep`, or `Mon 7 Sep 2026` — the client's `weekLabel` shape, byte for byte (`utils/dates.ts`). */
function dayLabel(date: string, withYear: boolean): string {
  const { year, month, day } = ymd(date);
  return `${DAYS[dayIndexOf(date)]} ${day} ${MONTHS[month - 1]}${withYear ? ` ${year}` : ''}`;
}

/**
 * Monday = 0 … Sunday = 6, **derived from `weeks.ts`'s own Monday** rather than from a second
 * `getUTCDay()` call. There is one authority on where a week starts and this defers to it.
 */
function dayIndexOf(date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00.000Z`) - Date.parse(`${weekStartOfDate(date)}T00:00:00.000Z`)) / 86_400_000);
}

/**
 * R-lens-28 — the **first** week of the period `key`: the first Monday whose own period at that horizon
 * is `key`. `firstMondayIn` is this at the Monthly horizon and now delegates to it, so the month rule
 * R-goal-47 scans with and the range the header prints cannot disagree.
 */
export function firstWeekOf(horizon: Horizon, key: string): string {
  if (horizon === 'Weekly') return key;
  const first = firstDayOf(horizon, key);
  const monday = weekStartOfDate(first);
  // `weekStartOfDate` lands in the PREVIOUS period whenever the 1st is not a Monday; that week is the
  // previous period's by the Monday rule, so step forward one.
  return monday >= first ? monday : addWeeks(monday, 1);
}

/** R-lens-28 — the **last** week of `key`: the last Monday whose own period at that horizon is `key`. */
export function lastWeekOf(horizon: Horizon, key: string): string {
  if (horizon === 'Weekly') return key;
  return weekStartOfDate(lastDayOf(horizon, key));
}

/**
 * R-lens-29 — the period of `horizon` that holds **the week containing `today`**, which is not always
 * the period that holds today. On Tue 1 Sep 2026 the current month is `2026-09` and the current week
 * begins Mon 31 Aug, so this answers `2026-08`: the month the owner's actual week sits in.
 *
 * The two only diverge inside a period's opening days, and that gap is the whole of the defect this
 * exists for — the Monthly lens opens on a month that legitimately excludes the week you are living
 * in, and nothing on screen said so.
 */
export function periodKeyOfCurrentWeek(horizon: Horizon, today: string): string {
  if (horizon === 'Life') return '';
  return periodKeyOf(horizon, weekStartOfDate(today));
}

/**
 * R-goal-36 — is `key` earlier than the current period of its horizon?
 *
 * A plain string comparison, which is only correct because the keys sort chronologically. This is the
 * whole of `PERIOD_IN_PAST`: **a goal is never created into, or moved into, a past period.** There is no
 * forward half — any future period is writable at every horizon (owner decision 5, R-lens-7).
 */
export function isPastPeriod(horizon: Horizon, key: string, today: string): boolean {
  if (horizon === 'Life') return false;
  return key < periodKeyOf(horizon, today);
}

/** Is `key` the period of `horizon` containing `today`? Life has no current period, so always false. */
export function isCurrentPeriod(horizon: Horizon, key: string, today: string): boolean {
  return horizon !== 'Life' && key === periodKeyOf(horizon, today);
}

/** The first calendar date inside the period `key` names. Used to step and to zoom (R-lens-9/18). */
export function firstDayOf(horizon: Horizon, key: string): string {
  if (horizon === 'Yearly' && YEAR_RE.test(key)) return `${key}-01-01`;
  const q = QUARTER_RE.exec(key);
  if (horizon === 'Quarterly' && q) return `${q[1]}-${pad2((Number(q[2]) - 1) * 3 + 1)}-01`;
  const m = MONTH_RE.exec(key);
  if (horizon === 'Monthly' && m) return `${m[1]}-${m[2]}-01`;
  if (horizon === 'Weekly' && DAY_RE.test(key)) return key;
  return key;
}

/** The last calendar date inside the period `key` names. */
export function lastDayOf(horizon: Horizon, key: string): string {
  if (horizon === 'Life') return key;
  if (horizon === 'Weekly' && DAY_RE.test(key)) return shiftDays(key, 6);
  // `stepUnclamped`, not `stepPeriod`: this needs the arithmetic next period, and the representable-range
  // clamp would make `lastDayOf('Yearly','9999')` step to itself and answer 9998-12-31.
  return shiftDays(firstDayOf(horizon, stepUnclamped(horizon, key, 1)), -1);
}

function shiftDays(date: string, n: number): string {
  const t = Date.parse(`${date}T00:00:00.000Z`);
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * R-lens-7 — step a period by `n` of its own unit: a year, a quarter, a month, a week.
 *
 * **Neither direction is bounded, as a product rule.** There is no forward cap (R-goal-36) and the
 * backward clamp went with `WEEK_HISTORY_WEEKS` (R-rm-3): a bound in one direction only rebuilds D-24's
 * asymmetry, and greying out one control would cost a `MIN(period_key)` probe on every render. Neither
 * chevron is ever disabled and this does not reopen that.
 *
 * ⚠ **The one bound that does exist is the FORMAT's, not the product's** (R-lens-30). A `PeriodKey` is at
 * most ten characters and a year is `\d{4}`, so the representable range is 1000-01-01 … 9999-12-31.
 * `stepPeriod('Yearly', '9999', 1)` used to return `'10000'` — a string that fails `isPeriodKeyFor`,
 * fails `PeriodKeyParam` and is answered `422` by the server. It took thousands of clicks to reach, which
 * is why it survived; with an instantly-repainting header and swipe navigation ahead of it, a fling is
 * exactly how you get there. **A step that would leave the representable range returns the input
 * unchanged**, so the chevron is a silent no-op at the two ends rather than a key nothing can parse. It
 * belongs here, beside the format it is an edge of, and nowhere else.
 */
export function stepPeriod(horizon: Horizon, key: string, n: number): string {
  const stepped = stepUnclamped(horizon, key, n);
  // Life's `''` and an unrecognised key both come back unchanged from `stepUnclamped`; the guard is only
  // ever consulted for a key that was canonical going in, so an already-malformed key is not "fixed" here.
  if (stepped === key || !isPeriodKeyFor(horizon, key)) return stepped;
  return isPeriodKeyFor(horizon, stepped) ? stepped : key;
}

function stepUnclamped(horizon: Horizon, key: string, n: number): string {
  if (horizon === 'Life') return '';
  if (horizon === 'Weekly') return addWeeks(key, n);
  if (horizon === 'Yearly') return YEAR_RE.test(key) ? String(Number(key) + n) : key;
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

/**
 * R-lens-9 — map one lens's period onto another's, given the session **anchor date** (R-lens-18).
 *
 * The lens control carries an anchor, not a period label, and each lens renders the period containing it.
 * Two cases, and the second is where the spec's own worked example was wrong:
 *
 *  - **Zoom out** (shorter → longer): the period CONTAINING the anchor. Always unambiguous.
 *  - **Zoom in** (longer → shorter): the period containing **today** when the current period contains
 *    today — in `Q3 2026` on 31 Aug, zooming to Monthly gives `Aug 2026`, the month you are living in —
 *    otherwise the FIRST sub-period.
 *
 * Zooming never moves the anchor, which is what makes it lossless and reversible (S-lens-9-4), and Life
 * leaves it untouched, so going up to Life and back down returns you where you were (S-lens-9-6).
 *
 * **The Monthly → Weekly case is the one that needed correcting.** Zooming into `Nov 2026` must give the
 * first week whose **Monday** falls in November, not "the week containing the 1st" — that would have
 * landed on the week of Mon 26 Oct, a week every other rule counts as October's, including R-goal-47's
 * planned-ness scope and R-task-49's target week. One Monday rule, three consumers, no disagreement.
 */
export function zoomTo(target: Horizon, anchor: string, today: string): string {
  if (target === 'Life') return '';
  // **Why zoom is one line for four of the five horizons.** R-lens-18 does the work: stepping moves the
  // anchor to the first day of the newly selected period UNLESS today falls inside it, in which case the
  // anchor IS today. So "the period containing the anchor" already resolves to the period containing
  // today when the source period contains today, and to the first sub-period otherwise — R-lens-9's two
  // cases, with no branch and no way for them to disagree.
  if (target !== 'Weekly') return periodKeyOf(target, anchor);
  // Weekly is the exception, and it is the correction: a week belongs to its MONDAY's month, so the
  // destination is the first week whose Monday falls in the anchor's month — never the week containing
  // the 1st, which would land in the previous month. See `weekForMonth`.
  return weekForMonth(periodKeyOf('Monthly', anchor), today);
}

/**
 * R-lens-9 / R-goal-47 / R-task-49 — **the one answer to "which week does this month mean"**.
 *
 * The week containing today when the month contains today; otherwise the first week whose **Monday**
 * falls in that month. One rule serves the Monthly → Weekly zoom, `+ Task` from a Monthly card, and the
 * planned-ness line's scope, so the three can never disagree.
 */
export function weekForMonth(monthKey: string, today: string): string {
  if (periodKeyOf('Monthly', today) === monthKey) return weekStartOfDate(today);
  return firstMondayIn(monthKey);
}

/**
 * The first Monday whose own month is `monthKey`. R-lens-9: a week belongs to its Monday's month.
 *
 * The Monthly case of `firstWeekOf`, and it delegates rather than restating: the range R-lens-28 prints
 * on the header and the scope R-goal-47's planned-ness line counts over are the same two Mondays, and a
 * second copy of the step-forward clause is how they would come to disagree on one month in seven.
 */
export function firstMondayIn(monthKey: string): string {
  return firstWeekOf('Monthly', monthKey);
}

/** The last Monday whose own month is `monthKey`. The other end of R-goal-47's `BETWEEN` range. */
export function lastMondayIn(monthKey: string): string {
  return lastWeekOf('Monthly', monthKey);
}

/**
 * R-goal-40 / D-3 — the contextual next periods the re-plan sheet offers: Monthly → the next two months,
 * Quarterly → the next two quarters, Yearly → next year.
 *
 * Options are strictly AFTER both today's period and the goal's CURRENT period, so a re-plan can never
 * "move" a goal to the period it is already in — precisely the mockup bug (its frozen option list offered
 * the current quarter as a "next" one).
 *
 * **Two horizons offer nothing, for opposite reasons.** A **Life** goal has no period at all (R-goal-21).
 * A **Weekly** goal *is* a week: moving it forward would silently restate what a past week contained,
 * which is D-2, the defect that made focus per-week in the first place. An intention that did not happen
 * carries forward through its open tasks (R-lens-12), or is written again as a new Weekly goal.
 */
export function replanPeriods(horizon: Horizon, today: string, currentKey = ''): string[] {
  if (horizon === 'Life' || horizon === 'Weekly') return [];
  const todayKey = periodKeyOf(horizon, today);
  const base = isPeriodKeyFor(horizon, currentKey) && currentKey > todayKey ? currentKey : todayKey;
  const count = horizon === 'Yearly' ? 1 : 2;
  return Array.from({ length: count }, (_, i) => stepPeriod(horizon, base, i + 1));
}
