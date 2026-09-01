import type { CalendarPeriodView, Horizon } from '@goal-cascade/shared';
import { useSkin } from '../skin';
import { PERIOD_UNIT } from '../utils/periodKeys';
import { periodTitle } from './copy';

/**
 * R-lens-17 — **the lens control is the title.** One row: `‹`, the period label, `›`.
 *
 * There is no persistent lens switcher, and this is the whole argument in one component. A permanent
 * five-way strip would be a third unconditional row on the screen whose complaint was *"its too clutered"*
 * (R-nav-27); it is 42 characters at 360px; four of its five labels are always wrong; and it treats an
 * ordered scale as five peers. The title already names the altitude — a bare year is a year, `Q` is a
 * quarter, a month name is a month — so tapping it opens the Zoom sheet instead, which carries strictly
 * more information than a strip has room for (each row's destination period and its count, R-lens-22).
 *
 * **Altitude is vertical and time is horizontal; the two dimensions never share a widget.** That is also
 * what makes D-24 unrepresentable rather than merely guarded against: with one control per dimension, no
 * two controls can disagree about a range.
 *
 * On the **Life** lens both chevrons render **disabled, not hidden** (R-lens-17): a control that vanishes
 * moves everything after it in the tab order, and the thumb should land in the same place on every lens.
 */
export function LensRow({
  lens,
  period,
  hasForwardContent,
  onStep,
  onZoom,
}: {
  lens: Horizon;
  /**
   * ⚠ **R-lens-30** — the LOCALLY computed view (`useCalendarPeriod`), not `LensResponse.period`. It is
   * present on the first render, so this component never has a period it cannot name.
   */
  period: CalendarPeriodView;
  hasForwardContent: boolean;
  onStep: (n: -1 | 1) => void;
  onZoom: () => void;
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
      <button
        type="button"
        onClick={onZoom}
        // R-lens-17 — the title's accessible name IS the lens change announcement: the sheet closes, focus
        // lands here, and the platform reads it. The live region then carries only the payload (§8.2).
        // R-lens-28 — one name for both lines: a screen reader gets `Sep 2026 · Mon 7 Sep – Sun 4 Oct`.
        aria-label={`${lens} lens, ${periodTitle(label, range)}. Change lens or period.`}
        style={{
          flex: 1,
          minWidth: 0,
          border: 'none',
          background: 'none',
          padding: 0,
          color: S.T.ink,
          cursor: 'pointer',
          minHeight: 44,
          overflow: 'hidden',
          fontFamily: 'inherit',
          // The two lines are one control, left-aligned as a block — `text-align` is the only thing a
          // `<button>` needs told, since its default is `center`.
          textAlign: 'left',
        }}
      >
        {/*
         * ⚠ **UX-PLAN §5 (item F) — the misaligned chevron, and why it is a flex row now.**
         *
         * It was `{label} <span style={{ fontSize: 13 }}>▾</span>` inside one 21/800 ellipsising span,
         * and it had four defects of which the first two are the misalignment the owner reported:
         *
         *  1. **A different font from every glyph beside it.** `▾` is U+25BE, and neither Manrope
         *     `@font-face` block's `unicode-range` contains it — the nearest are `U+2000-206F` and the
         *     singletons `U+2191`/`U+2193`. So it fell through to the platform sans (SF Pro on iOS,
         *     Roboto on Android) while the label beside it was Manrope, and the two typefaces disagree
         *     about a small triangle's baseline offset and side bearings by an amount that CHANGES WITH
         *     THE DEVICE. The two step chevrons are unaffected: `‹` and `›` are U+2039/U+203A, inside
         *     `U+2000-206F`, and render in Manrope.
         *  2. **Baseline-aligned against text half again its size** — 13 px inside a 21 px block. Inline
         *     boxes align on the baseline, so its optical centre sat 4–5 px above it while the label's
         *     sat 7–8 px above it. It read as sunk.
         *  3. **It inherited `letterSpacing: -0.01em`**, applied after the literal space, so the gap was
         *     a space *minus* tracking.
         *  4. **It was inside the truncating span**, so on a long label (`Week of Mon 4 Jan 2027`) the
         *     ellipsis ate it — the one affordance saying "this title is a control" vanished precisely
         *     when the title was long. Not alignment, but the worse defect.
         *
         * The fix is four properties and a shape: `alignItems: 'center'` puts it on the label's optical
         * centre; `flex: 0 0 auto` makes it survive any title length; `gap: 6` replaces the literal space
         * so tracking cannot reach it; and an inline `<svg>` removes the `unicode-range` lottery entirely
         * — one shape, identical on every platform, no font dependency, no asset, no library. It stays
         * `aria-hidden`, because the button's own name already ends `Change lens or period.`
         */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              fontSize: 21,
              fontWeight: 800,
              letterSpacing: '-0.01em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {label}
          </span>
          <svg
            aria-hidden="true"
            data-testid="lens-zoom-marker"
            width="8"
            height="5"
            viewBox="0 0 8 5"
            focusable="false"
            // `display: block` so it carries no line-height box of its own and the flex centring is exact.
            style={{ flex: '0 0 auto', display: 'block', color: S.T.mut }}
          >
            <path d="M0 0h8L4 5z" fill="currentColor" />
          </svg>
        </span>
        {/*
         * R-lens-28 / R-nav-27 — the range is a **second line inside this button**, never a row of its
         * own. R-nav-27 budgets *rows of chrome above the first item*, and a row of chrome is a row that
         * carries a control: this adds no control, no tap target and no tab stop, so the shell still
         * carries exactly two unconditional rows. It could not go on the first line — `Sep 2026 · Mon 7
         * Sep – Sun 4 Oct` is 32 characters and would ellipsise the range away at 360px, which is worse
         * than not printing it, because a half-shown range is a wrong one.
         *
         * `aria-hidden`, because the button's own name already carries it and hearing it twice is worse
         * than not hearing it at all.
         */}
        {range && (
          <span aria-hidden="true" style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: S.T.mut, letterSpacing: 0, marginTop: 1 }}>
            {range}
          </span>
        )}
      </button>
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
