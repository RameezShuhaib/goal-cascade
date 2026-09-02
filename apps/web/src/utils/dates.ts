import { DAY_NAMES, MONTH_NAMES, dateLabel, dayLabel } from '@goal-cascade/shared';
import { nowMs } from '../lib/serverClock';

/**
 * Rendering dates. Nothing here DECIDES anything.
 *
 * D-1 — weeks are absolute Monday dates on the wire, never offsets. The week switcher still speaks in
 * offsets locally (that is what `?week=` takes and what `ui.viewedWeek` holds), but no offset is ever
 * persisted, cached as data, or turned back into a date by this client: every read model answers with the
 * `weekStart` it is about, and these functions format the string the server sent.
 *
 * R-auth-5 — "the current week" is the server's, resolved in the owner's timezone. So there is no
 * `mondayOf(offset)` here — but that is now because **there is exactly one `weekStartOfDate` in the repo
 * and it lives in `@goal-cascade/shared`** (R-lens-30), not because the client may not know where a week
 * starts. Deriving a Monday from the DEVICE CLOCK is still the disagreement R-auth-5 exists to prevent;
 * deriving one from the owner's today, in the owner's stored zone, through the same function the server
 * calls, is not. The rule is: **the client may not hold a *second* implementation of a date rule; it may
 * import the *only* one.**
 */


/*
 * ⚠ **A10** — the `en-GB` Intl formatter is GONE from this file. It rendered September as `Sept` under
 * modern ICU while `@goal-cascade/shared`'s MONTHS said `Sep`, so the lens header and the task sheet
 * spelled one month two ways, one tap apart — and which you got depended on the viewer's browser. Month
 * and weekday names now come from shared, the same array the server labels periods with.
 */

/*
 * ⚠ **R-lens-30** — `addWeeks` is DELETED. It was the sixth of the six duplicated calendar functions this
 * client carried, and it was identical to `@goal-cascade/shared:addWeeks` — same UTC-instant arithmetic,
 * same DST immunity, same doc block making the same argument. Import the one in shared; the reason the
 * duplicate existed at all is answered in `utils/periodKeys.ts`'s header.
 */

/**
 * `Mon 24 Aug` — a week, named by its Monday, **with the weekday**. Takes the absolute `weekStart` the
 * server sent.
 *
 * This is the **carry-label** form and only that: `since Mon 24 Aug`, which `docs/BUSINESS-RULES.md`
 * pins verbatim. The weekday earns its place there because the sentence is about a day work has been
 * open since.
 *
 * ⚠ **Never put this after the words "week of".** That phrase names a *period*, and the period's label
 * is the server's (`PeriodView.label`, `Week of 31 Aug`); splicing a weekday into it produced
 * `Week of Mon 31 Aug` on the task page's back button while the lens one tap away read `Week of 31 Aug`
 * — the same week, named two ways, one screen apart. Use `weekOfLabel` for that, which is the server's
 * shape by construction.
 */
export function weekLabel(weekStart: string): string {
  return dayLabel(weekStart);
}

/** `24 Aug` — the short form used inside the red carry chip, and the date half of a period's week label. */
export function shortDate(weekStart: string): string {
  return dateLabel(weekStart);
}

/**
 * `Week of 31 Aug` — **the server's own week label**, rendered client-side.
 *
 * It is deliberately byte-identical to what `domain/periods.labelOf('Weekly', key)` sends on
 * `PeriodView.label`, because the client sometimes has to name a week the server did not label for it
 * (a task's `originPeriodKey`, an item's `fromPeriodKey`). `routes.ts` states the rule — periods are
 * machine-formatted in the URL and human-formatted on screen — and this is the one client spelling of
 * the human form. One concept, one shape.
 */
export function weekOfLabel(weekStart: string): string {
  return `Week of ${shortDate(weekStart)}`;
}

/** `Fri 28 Aug` — an instant (`doneAt`, `capturedAt`), in the viewer's own zone. */
export function instantLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${DAY_NAMES[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`;
}

/**
 * `Today` / `25 Aug` — how a capture date reads in a list (R-backlog-13, R-learning-7).
 *
 * "Today" is measured against the SERVER's clock (`lib/serverClock`), not the device's, so a phone whose
 * clock has drifted does not label yesterday's capture as today's. The mockup stored this string on the
 * row (D-17), which is why its "newest first" ordering was unenforceable; here it is rendered from the
 * real `capturedAt` timestamp every time.
 */
export function capturedLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date(nowMs());
  const sameDay =
    d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  return sameDay ? 'Today' : `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

/*
 * ⚠ **R-lens-30** — `todayInZone` is DELETED. It was a second implementation of the server's
 * `dateInTimezone`: `toLocaleDateString('en-CA', { timeZone })` against the server's
 * `Intl.DateTimeFormat('en-US', { year, month, day }).formatToParts`. They agreed on every ICU build
 * anyone is likely to meet — **by convention, not by construction** — and `en-CA`'s `YYYY-MM-DD` pattern
 * is a locale-data fact rather than a guarantee.
 * `tests/utils/todayInZone-equivalence.test.ts` proved they agreed across a zone × instant matrix, and is
 * deleted with the next change that touches it.
 *
 * Its catch branch was worse than redundant: it fell back to the **device** zone, which is exactly the
 * traveller disagreement R-auth-5 forbids — an owner whose account is `Europe/Berlin`, in Tokyo, would
 * have got Tokyo's date while the server computed Berlin's. `@goal-cascade/shared:dateInTimezone` falls
 * back to `'UTC'`, matching the server middleware. Read the owner's today from
 * `lib/ownerClock.useOwnerToday`, which also re-checks it when the day rolls over.
 */
