import type { CalendarPeriodView, Horizon } from '@goal-cascade/shared';
import { useSkin } from '../skin';
import { PERIOD_UNIT } from '../utils/periodKeys';

/**
 * R-lens-17, rewritten — **the period row: `‹`, the period label as TEXT, `›`.**
 *
 * ⚠ **The title stopped being a control.** It used to open the Zoom sheet, which is deleted in full
 * (`29-ux-navigation` §2.8): two navigation systems for one job is the clutter the owner complained
 * about, and the sheet's own promise — *see the destination before you commit* — is only worth a surface
 * when the commit is expensive. The tab strip one row above makes it free and one tap reversible, and this
 * row, 44px below the tab you just pressed, answers "which period did I land on" in the SAME FRAME
 * (R-lens-30) rather than beforehand in a modal.
 *
 * So: no `▾` marker, no `aria-label`, no tab stop, no hover, no press state. **This is what pays for part
 * of the tab row** — row 3 loses its only non-chevron control and one tab stop, so the shell gains five
 * tabs and one stop and loses one, and the focus order gets shorter on any account with more than one
 * Life line.
 *
 * **Altitude is the strip and time is the chevrons; the two dimensions never share a widget.** That is
 * also what makes D-24 unrepresentable rather than merely guarded against: with one control per
 * dimension, no two controls can disagree about a range.
 *
 * On the **Life** lens both chevrons render **disabled, not hidden** (R-lens-17): a control that vanishes
 * moves everything after it in the tab order, and the thumb should land in the same place on every lens.
 */
export function LensRow({
  lens,
  period,
  hasForwardContent,
  onStep,
}: {
  lens: Horizon;
  /**
   * ⚠ **R-lens-30** — the LOCALLY computed view (`useCalendarPeriod`), not `LensResponse.period`. It is
   * present on the first render, so this component never has a period it cannot name.
   */
  period: CalendarPeriodView;
  hasForwardContent: boolean;
  onStep: (n: -1 | 1) => void;
}) {
  const S = useSkin();
  const unit = PERIOD_UNIT[lens];
  const isLife = lens === 'Life';
  /**
   * ⚠ **R-lens-30 — `…` is never a label.** This read `period?.label ?? '…'`, so until `GET /goals`
   * landed the header of the entire screen was a literal ellipsis: a period step was a network round trip
   * for calendar arithmetic the client had already done to build the URL. The fallback is **deleted, not
   * defaulted** — `labelOf(lens, periodKey)` needs no clock, no session and no network, so there is no
   * state in which the name of the period on screen is unknown.
   */
  const label = isLife ? 'Life' : period.label;
  /**
   * R-lens-28 — the range, on the **Yearly, Quarterly and Monthly** lenses only.
   *
   * Those three are the ones whose name over-promises: `Sep 2026` reads as 1–30 September and the period
   * is Mon 7 Sep – Sun 4 Oct. A **week** label does not have the problem — `Week of 31 Aug` already names
   * a specific Monday and a week is unambiguously the seven days from it — so nothing is appended there;
   * a range under it would be chrome restating what the title already said. Life spans everything.
   *
   * ⚠ **R-lens-30** — this used to be the SERVER's string, *"because deriving it here would need a Monday
   * rule this client deliberately does not have (D-1)"*. The client now imports that Monday rule rather
   * than copying it, and `weekRangeOf` is the same function the wire field is built from.
   */
  const range = isLife || lens === 'Weekly' ? '' : period.weekRange;

  const chevron = (dir: -1 | 1) => (
    <button
      type="button"
      aria-label={dir === -1 ? `Earlier ${unit}` : `Later ${unit}`}
      // R-lens-17 — `aria-disabled` AND the real attribute, so it leaves the tab ring and is announced.
      disabled={isLife}
      aria-disabled={isLife}
      aria-describedby={isLife ? 'lens-life-no-periods' : undefined}
      onClick={() => onStep(dir)}
      style={{
        position: 'relative',
        minWidth: 40,
        minHeight: 40,
        border: 'none',
        background: 'none',
        fontSize: 16,
        padding: 0,
        fontFamily: 'inherit',
        ...(isLife ? { color: S.T.disabled, cursor: 'not-allowed' } : { color: S.T.mut, cursor: 'pointer' }),
      }}
    >
      {dir === -1 ? '‹' : '›'}
      {/*
       * R-lens-26 — the forward-content marker. Without it a goal written three months out is invisible
       * from every screen except that month's, which unbounded forward creation makes far more likely.
       * One dot, no number: it says *there is something ahead*, never how much.
       */}
      {dir === 1 && hasForwardContent && !isLife && (
        <span
          data-testid="forward-content-dot"
          aria-hidden="true"
          style={{ position: 'absolute', top: 8, right: 6, width: 6, height: 6, borderRadius: '50%', background: S.T.accent }}
        />
      )}
    </button>
  );

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
      {chevron(-1)}
      {/*
       * The title is a `<div>` now, not a `<button>`: 21px/800 `T.ink`, `nowrap`, ellipsising, exactly as
       * before. `flex: 1` keeps the two chevrons pinned to the row's ends at every label length.
       */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', minHeight: 44, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <span
          // The one place the period's NAME is printed. `Life` is also a tab label, so a test that means
          // "the period on screen" needs something narrower than the string.
          data-testid="lens-period"
          style={{
            fontSize: 21,
            fontWeight: 800,
            letterSpacing: '-0.01em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            color: S.T.ink,
          }}
        >
          {label}
        </span>
        {/*
         * R-lens-28 / R-nav-27 — the range is a **second line inside this row**, never a row of its own.
         * R-nav-27 budgets *rows of chrome above the first item*, and a row of chrome is a row that
         * carries a control: this adds no control, no tap target and no tab stop. It could not go on the
         * first line — `Sep 2026 · Mon 7 Sep – Sun 4 Oct` is 32 characters and would ellipsise the range
         * away at 360px, which is worse than not printing it, because a half-shown range is a wrong one.
         *
         * `aria-hidden` no longer needs a companion accessible name on a button, because there is no
         * button: the live region in `LensChrome` carries `label · range` on every period and lens change
         * (§7.3), which is the one place a screen reader was ever going to hear it.
         */}
        {range && (
          <span aria-hidden="true" style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: S.T.mut, letterSpacing: 0, marginTop: 1 }}>
            {range}
          </span>
        )}
      </div>
      {chevron(1)}
      {isLife && (
        <span id="lens-life-no-periods" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          Life has no periods
        </span>
      )}
    </div>
  );
}

/**
 * R-lens-21 — the off-now row. **Conditional, and that is what keeps the shell at two unconditional rows**
 * (R-nav-27): the current period is unbadged and this does not render at all.
 *
 * It is the escape hatch unbounded forward navigation requires (R-lens-7): without it, fourteen months out
 * is fourteen taps home.
 */
export function OffNowRow({ badge, onNow }: { badge: string; onNow: () => void }) {
  return <NoticeRow badge={badge} action="Now ›" onAction={onNow} />;
}

/**
 * R-lens-29 — **this period is the current one and still does not hold the week you are living in.**
 *
 * On Tue 1 Sep 2026 the Monthly lens opens on `Sep 2026`, whose first week begins on the 7th, while the
 * current week began Mon 31 Aug and belongs to August (R-goal-33). The lens is correct and reads as
 * broken, so one quiet line says where the week is and offers the one tap to it.
 *
 * **It occupies R-lens-21's row and never adds one** (R-nav-27), and it can do that because the two are
 * mutually exclusive by construction: the off-now row renders only when the period is NOT current, and
 * this renders only when it IS. There is no state in which both are true, so the conditional row has two
 * occupants and the shell still has two unconditional rows.
 *
 * It is not an escalation — same `lineSoft` pill, same muted grey as the badge it replaces. A period
 * legitimately beginning next week is a fact about the calendar, not a problem with the plan (R-lens-11).
 */
export function WeekElsewhereRow({ badge, actionLabel, onGo }: { badge: string; actionLabel: string; onGo: () => void }) {
  // `Go there ›` visible, `Go to Aug 2026` announced: the pill one gap away already names the month for
  // the eye, and repeating it in the link is the clutter this shell is budgeted against (R-nav-27).
  return <NoticeRow badge={badge} action="Go there ›" actionLabel={actionLabel} onAction={onGo} testId="week-elsewhere-row" />;
}

/**
 * The one shape both notices take: a muted pill on the left, a link on the right. They were the same
 * fourteen lines twice over, which is how two rows one screen apart come to disagree about a radius.
 */
function NoticeRow({
  badge,
  action,
  actionLabel,
  onAction,
  testId,
}: {
  badge: string;
  action: string;
  /** The accessible name when the visible verb is shorter than the destination it names. */
  actionLabel?: string;
  onAction: () => void;
  testId?: string;
}) {
  const S = useSkin();
  return (
    <div data-testid={testId} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
      <span
        style={{
          display: 'inline-block',
          background: S.T.lineSoft,
          color: S.T.mut,
          borderRadius: 12,
          padding: '4px 10px',
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        {badge}
      </span>
      <span style={{ flex: 1 }} />
      <button type="button" aria-label={actionLabel} style={{ ...S.linkBtn, padding: '0 2px' }} onClick={onAction}>
        {action}
      </button>
    </div>
  );
}
