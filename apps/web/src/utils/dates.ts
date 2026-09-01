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
 * `mondayOf(offset)` here: deriving a Monday from the device clock is exactly the disagreement that rule
 * exists to prevent.
 */

/** Parse a `YYYY-MM-DD` as a UTC instant, so formatting never shifts it across a timezone boundary. */
const dateOnly = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

const fmt = (d: Date, opts: Intl.DateTimeFormatOptions): string => d.toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts });

/**
 * Another Monday, `weeks` away from a Monday the SERVER sent. Date-only arithmetic on a UTC instant, so
 * DST cannot move it (Q-9) and no device clock is consulted — this walks away from a known-correct anchor
 * rather than deriving one. It is how the week picker labels the chips either side of the viewed week.
 */
export function addWeeks(weekStart: string, weeks: number): string {
  const d = dateOnly(weekStart);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

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
  return fmt(dateOnly(weekStart), { weekday: 'short', day: 'numeric', month: 'short' });
}

/** `24 Aug` — the short form used inside the red carry chip, and the date half of a period's week label. */
export function shortDate(weekStart: string): string {
  return fmt(dateOnly(weekStart), { day: 'numeric', month: 'short' });
}

/**
 * `Week of 31 Aug` — **the server's own week label**, rendered client-side.
 *
 * It is deliberately byte-identical to what `domain/periods.labelOf('Weekly', key)` sends on
 * `PeriodView.label`, because the client sometimes has to name a week the server did not label for it
 * (a task's `originWeekStart`, an item's `fromWeekStart`). `routes.ts` states the rule — periods are
 * machine-formatted in the URL and human-formatted on screen — and this is the one client spelling of
 * the human form. One concept, one shape.
 */
export function weekOfLabel(weekStart: string): string {
  return `Week of ${shortDate(weekStart)}`;
}

/** `Fri 28 Aug` — an instant (`doneAt`, `capturedAt`), in the viewer's own zone. */
export function instantLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
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
  return sameDay ? 'Today' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** The owner-local date (`YYYY-MM-DD`) as the server would compute it, for the period defaults (R-goal-13). */
export function todayInZone(timezone: string | undefined): string {
  const at = new Date(nowMs());
  try {
    // `en-CA` renders `YYYY-MM-DD`, which is the shape the period helpers parse.
    return at.toLocaleDateString('en-CA', { timeZone: timezone || undefined });
  } catch {
    return at.toLocaleDateString('en-CA');
  }
}
