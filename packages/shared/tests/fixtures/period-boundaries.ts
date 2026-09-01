/**
 * ⚠ **THE BOUNDARY FIXTURE TABLE — anti-drift layer 2 of 3 (R-lens-30).**
 *
 * Layer 1 is the shared module, which *prevents* drift: there is no second implementation left to
 * disagree. Layer 2 is this table, which *detects* it, and layer 3 is the runtime echo assertion, which
 * catches the one thing a shared module cannot — a cached client bundle a week older than the Worker.
 *
 * ── The discipline, and it is the whole value ─────────────────────────────────
 * **Every string below was worked out from the Monday rule BY HAND. Nothing here was generated from an
 * implementation, and nothing here may be updated by pasting in what the code now returns.** A fixture
 * copied out of the thing it tests asserts only that the code equals itself. If a row here goes red, the
 * code is wrong until someone re-derives the row on paper and shows otherwise. (`21-period-ranges`'s
 * `RANGES` table used the same discipline; this extends it to the full `PeriodView`.)
 *
 * ── Consumed by two tests that do not import each other ───────────────────────
 *  - `apps/api/tests/lens/period-view-contract.test.ts` drives `GET /goals?lens=&period=` on a fake clock
 *    at `nowIso` with `preferences.timezone = tz`, and asserts the WIRE `PeriodView` matches the row.
 *  - `apps/web/tests/lens/period-view-contract.test.ts` asserts `periodViewOf(horizon, key, ownerToday)`
 *    matches the same row, with the owner clock stubbed to the same instant and zone.
 *
 * If either side ever drifts from the table, exactly one of the two goes red and names which.
 *
 * ── The Monday rule these are derived from ────────────────────────────────────
 * A week is its Monday (D-1), and **a week belongs to its Monday's period** (R-goal-33, ★C-19). So the
 * first week of a period is the first Monday whose own period is that period — which is the 1st when the
 * 1st is a Monday, and otherwise the next one — and the range runs to the Sunday six days after the last
 * such Monday. That is why `Sep 2026` is `Mon 7 Sep – Sun 4 Oct`: it excludes the week of Mon 31 Aug and
 * runs four days past the 30th.
 */

export interface PeriodBoundaryRow {
  /** What the case is, quoted in the failure message. */
  readonly name: string;
  /** The owner's stored timezone. `Europe/Berlin` throughout except where the case is about the zone. */
  readonly tz: string;
  /** The instant the server's clock is at. */
  readonly nowIso: string;
  /** The owner's calendar date at `nowIso` in `tz` — derived by hand, and itself an assertion. */
  readonly today: string;
  readonly horizon: 'Life' | 'Yearly' | 'Quarterly' | 'Monthly' | 'Weekly';
  readonly periodKey: string;
  readonly label: string;
  readonly weekRange: string;
  readonly isCurrent: boolean;
  readonly isPast: boolean;
  /** R-lens-29 — the period holding the week containing today, or `null` when that is this period. */
  readonly currentWeekPeriod: { periodKey: string; label: string } | null;
}

/** `Europe/Berlin`, deliberately: the task requires a non-UTC zone throughout the fixture set. */
const BERLIN = 'Europe/Berlin';

export const PERIOD_BOUNDARIES: readonly PeriodBoundaryRow[] = [
  /**
   * **The owner's actual case**, and the one the whole change exists for. 1 Sep 2026 is a Tuesday, so the
   * current week began Mon 31 Aug — which is August's. The Monthly lens opens on `Sep 2026`, correctly,
   * and the week the owner is living in is not in it (R-lens-29).
   */
  {
    name: 'Sep 2026 on Tue 1 Sep — the current month excludes the current week',
    tz: BERLIN,
    nowIso: '2026-09-01T09:00:00.000Z',
    today: '2026-09-01',
    horizon: 'Monthly',
    periodKey: '2026-09',
    label: 'Sep 2026',
    weekRange: 'Mon 7 Sep – Sun 4 Oct',
    isCurrent: true,
    isPast: false,
    currentWeekPeriod: { periodKey: '2026-08', label: 'Aug 2026' },
  },
  /** **A month starting on a Monday** — no leading gap at all. 1 Jun 2026 is a Monday. */
  {
    name: 'Jun 2026 begins on a Monday, so the range begins on the 1st',
    tz: BERLIN,
    nowIso: '2026-06-15T09:00:00.000Z',
    today: '2026-06-15',
    horizon: 'Monthly',
    periodKey: '2026-06',
    label: 'Jun 2026',
    // Mondays whose month is June 2026: 1, 8, 15, 22, 29. Last is the 29th; +6 days = Sun 5 Jul.
    weekRange: 'Mon 1 Jun – Sun 5 Jul',
    isCurrent: true,
    isPast: false,
    currentWeekPeriod: null,
  },
  /** **A five-Monday month** — Aug 2026's Mondays are 3, 10, 17, 24 and 31. */
  {
    name: 'Aug 2026 is a five-Monday month',
    tz: BERLIN,
    nowIso: '2026-08-31T09:00:00.000Z',
    today: '2026-08-31',
    horizon: 'Monthly',
    periodKey: '2026-08',
    label: 'Aug 2026',
    // 1 Aug 2026 is a Saturday, so the first Monday in August is the 3rd; the last is the 31st, +6 = 6 Sep.
    weekRange: 'Mon 3 Aug – Sun 6 Sep',
    isCurrent: true,
    isPast: false,
    currentWeekPeriod: null,
  },
  /** **The year boundary, where both years must be printed** and only there (R-lens-28). */
  {
    name: 'Dec 2026 straddles the year, so both years are printed',
    tz: BERLIN,
    nowIso: '2026-12-15T09:00:00.000Z',
    today: '2026-12-15',
    horizon: 'Monthly',
    periodKey: '2026-12',
    label: 'Dec 2026',
    // 1 Dec 2026 is a Tuesday → first Monday in December is the 7th. Mondays: 7, 14, 21, 28. 28 + 6 = 3 Jan.
    weekRange: 'Mon 7 Dec 2026 – Sun 3 Jan 2027',
    isCurrent: true,
    isPast: false,
    currentWeekPeriod: null,
  },
  /** The other side of that boundary: January's own range prints no year, because it straddles none. */
  {
    name: 'Jan 2027, viewed from Dec 2026 — a future month, no year in the range',
    tz: BERLIN,
    nowIso: '2026-12-15T09:00:00.000Z',
    today: '2026-12-15',
    horizon: 'Monthly',
    periodKey: '2027-01',
    label: 'Jan 2027',
    // 1 Jan 2027 is a Friday → first Monday in January is the 4th. Mondays: 4, 11, 18, 25. 25 + 6 = 31 Jan.
    weekRange: 'Mon 4 Jan – Sun 31 Jan',
    isCurrent: false,
    isPast: false,
    currentWeekPeriod: { periodKey: '2026-12', label: 'Dec 2026' },
  },
  /**
   * **A quarter whose first week belongs to the previous quarter.** 1 Oct 2026 is a Thursday, so the week
   * containing it began Mon 28 Sep — which is Q3's. Q4 therefore begins Mon 5 Oct.
   */
  {
    name: '2026-Q4 begins on the 5th, because 1 Oct 2026 is a Thursday',
    tz: BERLIN,
    nowIso: '2026-10-01T09:00:00.000Z',
    today: '2026-10-01',
    horizon: 'Quarterly',
    periodKey: '2026-Q4',
    label: 'Q4 2026',
    // Last Monday whose quarter is Q4 2026: 28 Dec 2026. 28 Dec + 6 = Sun 3 Jan 2027 → years printed.
    weekRange: 'Mon 5 Oct 2026 – Sun 3 Jan 2027',
    isCurrent: true,
    isPast: false,
    // On Thu 1 Oct the current week began Mon 28 Sep, which is Q3's.
    currentWeekPeriod: { periodKey: '2026-Q3', label: 'Q3 2026' },
  },
  /** A past quarter, viewed from Q4 — the state that strips every create affordance (R-goal-36). */
  {
    name: '2026-Q3 viewed from Q4 is past and still editable',
    tz: BERLIN,
    nowIso: '2026-10-01T09:00:00.000Z',
    today: '2026-10-01',
    horizon: 'Quarterly',
    periodKey: '2026-Q3',
    label: 'Q3 2026',
    // 1 Jul 2026 is a Wednesday → first Monday in Q3 is 6 Jul. Last is 28 Sep; 28 Sep + 6 = Sun 4 Oct.
    weekRange: 'Mon 6 Jul – Sun 4 Oct',
    isCurrent: false,
    isPast: true,
    currentWeekPeriod: null,
  },
  /**
   * **A 53-ISO-week year.** 1 Jan 2026 is a Thursday, which makes 2026 a 53-week ISO year. The product
   * keys weeks by Monday and never by ISO week number, so a 53rd week is not a special case in the model
   * at all — this row exists to *prove* that, by pinning the Yearly range and the Monday count it implies.
   */
  {
    name: '2026 is a 53-ISO-week year, and the model does not care',
    tz: BERLIN,
    nowIso: '2026-08-31T09:00:00.000Z',
    today: '2026-08-31',
    horizon: 'Yearly',
    periodKey: '2026',
    label: '2026',
    // 1 Jan 2026 is a Thursday → first Monday whose year is 2026 is 5 Jan. Last is 28 Dec; +6 = 3 Jan 2027.
    weekRange: 'Mon 5 Jan 2026 – Sun 3 Jan 2027',
    isCurrent: true,
    isPast: false,
    currentWeekPeriod: null,
  },
  /** The other 53-week year the plan names. 1 Jan 2020 is a Wednesday; 2020 has 53 ISO weeks. */
  {
    name: '2020 is a 53-ISO-week year, viewed from 2026 — long past',
    tz: BERLIN,
    nowIso: '2026-08-31T09:00:00.000Z',
    today: '2026-08-31',
    horizon: 'Yearly',
    periodKey: '2020',
    label: '2020',
    // 1 Jan 2020 is a Wednesday → first Monday whose year is 2020 is 6 Jan. Last is 28 Dec; +6 = 3 Jan 2021.
    weekRange: 'Mon 6 Jan 2020 – Sun 3 Jan 2021',
    isCurrent: false,
    isPast: true,
    currentWeekPeriod: { periodKey: '2026', label: '2026' },
  },
  /**
   * **The Weekly horizon**, where the key IS the Monday and the label names it. A weekly range is not
   * printed on screen (`LensRow` suppresses it — a week is unambiguous), but the field is still computed
   * and both sides must agree on it.
   */
  {
    name: 'Week of Mon 31 Aug 2026 — the current week',
    tz: BERLIN,
    nowIso: '2026-08-31T09:00:00.000Z',
    today: '2026-08-31',
    horizon: 'Weekly',
    periodKey: '2026-08-31',
    label: 'Week of 31 Aug',
    weekRange: 'Mon 31 Aug – Sun 6 Sep',
    isCurrent: true,
    isPast: false,
    currentWeekPeriod: null,
  },
  {
    name: 'Week of Mon 28 Dec 2026 straddles the year',
    tz: BERLIN,
    nowIso: '2026-08-31T09:00:00.000Z',
    today: '2026-08-31',
    horizon: 'Weekly',
    periodKey: '2026-12-28',
    label: 'Week of 28 Dec',
    weekRange: 'Mon 28 Dec 2026 – Sun 3 Jan 2027',
    isCurrent: false,
    isPast: false,
    currentWeekPeriod: { periodKey: '2026-08-31', label: 'Week of 31 Aug' },
  },
  /**
   * **A non-UTC zone at the Sunday/Monday boundary, checked against a device claiming UTC.** At
   * 23:30 UTC on Sun 30 Aug it is already 01:30 on Mon 31 Aug in Berlin, so the owner's week has turned
   * over and the device's has not. This is the disagreement R-auth-5 exists to prevent, pinned.
   */
  {
    name: 'Berlin at 01:30 Monday while UTC is still Sunday — the owner’s week has turned',
    tz: BERLIN,
    nowIso: '2026-08-30T23:30:00.000Z',
    today: '2026-08-31',
    horizon: 'Weekly',
    periodKey: '2026-08-31',
    label: 'Week of 31 Aug',
    weekRange: 'Mon 31 Aug – Sun 6 Sep',
    isCurrent: true,
    isPast: false,
    currentWeekPeriod: null,
  },
  /** The half-hour before it: 23:30 Berlin on Sun 30 Aug is still the previous week. */
  {
    name: 'Berlin at 23:30 Sunday — still the previous week',
    tz: BERLIN,
    nowIso: '2026-08-30T21:30:00.000Z',
    today: '2026-08-30',
    horizon: 'Weekly',
    periodKey: '2026-08-24',
    label: 'Week of 24 Aug',
    weekRange: 'Mon 24 Aug – Sun 30 Aug',
    isCurrent: true,
    isPast: false,
    currentWeekPeriod: null,
  },
  /**
   * **Northern DST, spring forward.** 29 Mar 2026 is the Sunday Berlin loses an hour (02:00 → 03:00). It
   * is a Sunday, so it belongs to the week of Mon 23 Mar. Every function here parses `T00:00:00.000Z` and
   * every week is a whole number of days, so the transition is a non-event — this pins that it stays one.
   */
  {
    name: 'Europe/Berlin spring forward, 29 Mar 2026 — a Sunday, in the week of Mon 23 Mar',
    tz: BERLIN,
    nowIso: '2026-03-29T08:00:00.000Z',
    today: '2026-03-29',
    horizon: 'Weekly',
    periodKey: '2026-03-23',
    label: 'Week of 23 Mar',
    weekRange: 'Mon 23 Mar – Sun 29 Mar',
    isCurrent: true,
    isPast: false,
    currentWeekPeriod: null,
  },
  /** **Northern DST, fall back.** 25 Oct 2026, Berlin gains an hour. Also a Sunday. */
  {
    name: 'Europe/Berlin fall back, 25 Oct 2026 — a Sunday, in the week of Mon 19 Oct',
    tz: BERLIN,
    nowIso: '2026-10-25T08:00:00.000Z',
    today: '2026-10-25',
    horizon: 'Weekly',
    periodKey: '2026-10-19',
    label: 'Week of 19 Oct',
    weekRange: 'Mon 19 Oct – Sun 25 Oct',
    isCurrent: true,
    isPast: false,
    currentWeekPeriod: null,
  },
  /**
   * **Southern DST**, so the transition runs the other way in the calendar year. Auckland moves to NZDT
   * on Sun 27 Sep 2026 at 02:00 local (= 14:00 UTC Sat 26 Sep). At 20:00 UTC on the 26th it is already
   * Sunday the 27th in Auckland.
   */
  {
    name: 'Pacific/Auckland across its spring-forward, and a day ahead of UTC',
    tz: 'Pacific/Auckland',
    nowIso: '2026-09-26T20:00:00.000Z',
    today: '2026-09-27',
    horizon: 'Weekly',
    periodKey: '2026-09-21',
    label: 'Week of 21 Sep',
    weekRange: 'Mon 21 Sep – Sun 27 Sep',
    isCurrent: true,
    isPast: false,
    currentWeekPeriod: null,
  },
  /**
   * **A sub-hour offset**, +05:45. At 18:30 UTC on Mon 31 Aug it is 00:15 on Tue 1 Sep in Kathmandu — so
   * the owner's month has turned and UTC's has not. An implementation that rounded to whole hours would
   * put this on the wrong day.
   */
  {
    name: 'Asia/Kathmandu (+05:45) at 00:15 — the owner’s month has turned, UTC’s has not',
    tz: 'Asia/Kathmandu',
    nowIso: '2026-08-31T18:30:00.000Z',
    today: '2026-09-01',
    horizon: 'Monthly',
    periodKey: '2026-09',
    label: 'Sep 2026',
    weekRange: 'Mon 7 Sep – Sun 4 Oct',
    isCurrent: true,
    isPast: false,
    currentWeekPeriod: { periodKey: '2026-08', label: 'Aug 2026' },
  },
  /**
   * **The two ends of the 26-hour spread.** At 11:00 UTC on 31 Aug it is already the 1st in Kiritimati
   * (+14) and still the 31st almost everywhere else — a client using the wrong zone is a whole calendar
   * day out here, and that is what makes `isPast` flip.
   */
  {
    name: 'Pacific/Kiritimati (+14) is a day ahead — Sep is already current',
    tz: 'Pacific/Kiritimati',
    nowIso: '2026-08-31T11:00:00.000Z',
    today: '2026-09-01',
    horizon: 'Monthly',
    periodKey: '2026-08',
    label: 'Aug 2026',
    weekRange: 'Mon 3 Aug – Sun 6 Sep',
    isCurrent: false,
    isPast: true,
    currentWeekPeriod: null,
  },
  {
    name: 'Pacific/Niue (−11) at the same instant is still on the 31st',
    tz: 'Pacific/Niue',
    nowIso: '2026-08-31T11:00:00.000Z',
    today: '2026-08-31',
    horizon: 'Monthly',
    periodKey: '2026-08',
    label: 'Aug 2026',
    weekRange: 'Mon 3 Aug – Sun 6 Sep',
    isCurrent: true,
    isPast: false,
    currentWeekPeriod: null,
  },
  /**
   * **Life** — `''` everywhere, `isCurrent` and `isPast` both false, no range and no elsewhere. Life has
   * no period at all (R-lens-2, R-goal-3), and the shape still has to be one shape.
   */
  {
    name: 'Life has no period at all',
    tz: BERLIN,
    nowIso: '2026-08-31T09:00:00.000Z',
    today: '2026-08-31',
    horizon: 'Life',
    periodKey: '',
    label: '',
    weekRange: '',
    isCurrent: false,
    isPast: false,
    currentWeekPeriod: null,
  },
];

/**
 * The stepping cases, kept separate because they are about `(horizon, key, n)` and consult no clock.
 * Hand-derived from the format, and both directions of every rollover.
 */
export const STEP_CASES: readonly { horizon: PeriodBoundaryRow['horizon']; from: string; n: -1 | 1; to: string }[] = [
  { horizon: 'Quarterly', from: '2026-Q4', n: 1, to: '2027-Q1' },
  { horizon: 'Quarterly', from: '2027-Q1', n: -1, to: '2026-Q4' },
  { horizon: 'Monthly', from: '2026-12', n: 1, to: '2027-01' },
  { horizon: 'Monthly', from: '2027-01', n: -1, to: '2026-12' },
  { horizon: 'Yearly', from: '2026', n: 1, to: '2027' },
  { horizon: 'Yearly', from: '2027', n: -1, to: '2026' },
  // A Weekly key is a Monday, and stepping walks whole weeks off it — across a month and a year boundary.
  { horizon: 'Weekly', from: '2026-08-31', n: 1, to: '2026-09-07' },
  { horizon: 'Weekly', from: '2026-12-28', n: 1, to: '2027-01-04' },
  { horizon: 'Weekly', from: '2027-01-04', n: -1, to: '2026-12-28' },
  // Life has no period to step.
  { horizon: 'Life', from: '', n: 1, to: '' },
  /*
   * R-lens-30 — the **FORMAT's** own edge, not a product bound. A `PeriodKey` is at most ten characters
   * and a year is `\d{4}`, so the representable range is 1000-01-01 … 9999-12-31 and both ends are
   * no-ops rather than keys nothing can parse: `stepPeriod('Yearly','9999',1)` used to return `'10000'`
   * (which fails `isPeriodKeyFor`, fails `PeriodKeyParam`, and is answered `422`), and `'1000'` stepped
   * back used to return `'999'`, three digits. Ordinary steps either side of them are unaffected.
   */
  { horizon: 'Yearly', from: '9999', n: 1, to: '9999' },
  { horizon: 'Yearly', from: '9999', n: -1, to: '9998' },
  { horizon: 'Yearly', from: '1000', n: -1, to: '1000' },
  { horizon: 'Yearly', from: '1000', n: 1, to: '1001' },
];

/**
 * R-lens-9's zoom correction, which is the one case the spec's own worked example got wrong: zooming into
 * `Nov 2026` must give the first week whose **Monday** falls in November (Mon 2 Nov), never the week of
 * Mon 26 Oct — a week every other rule counts as October's.
 */
export const ZOOM_CASES: readonly { target: PeriodBoundaryRow['horizon']; anchor: string; today: string; to: string }[] = [
  { target: 'Weekly', anchor: '2026-11-01', today: '2026-08-31', to: '2026-11-02' },
  // 1 Sep 2026 is a Tuesday; the first Monday whose own month is September is the 7th.
  { target: 'Weekly', anchor: '2026-09-01', today: '2026-08-31', to: '2026-09-07' },
  // A month that begins on a Monday keeps its own 1st.
  { target: 'Weekly', anchor: '2027-02-15', today: '2026-08-31', to: '2027-02-01' },
  // When the anchor's month contains today, the destination is the week containing TODAY (R-task-49).
  { target: 'Weekly', anchor: '2026-08-05', today: '2026-08-31', to: '2026-08-31' },
  { target: 'Monthly', anchor: '2026-11-01', today: '2026-08-31', to: '2026-11' },
  { target: 'Quarterly', anchor: '2026-11-01', today: '2026-08-31', to: '2026-Q4' },
  { target: 'Yearly', anchor: '2026-11-01', today: '2026-08-31', to: '2026' },
  { target: 'Life', anchor: '2026-11-01', today: '2026-08-31', to: '' },
];
