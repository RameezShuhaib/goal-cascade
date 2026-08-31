import type { Horizon, PeriodView } from '@goal-cascade/shared';
import { useSkin } from '../skin';
import { PERIOD_UNIT } from '../utils/periodKeys';

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
  period: PeriodView | null;
  hasForwardContent: boolean;
  onStep: (n: -1 | 1) => void;
  onZoom: () => void;
}) {
  const S = useSkin();
  const unit = PERIOD_UNIT[lens];
  const isLife = lens === 'Life';
  const label = isLife ? 'Life' : (period?.label ?? '…');

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
        aria-label={`${lens} lens, ${label}. Change lens or period.`}
        style={{
          flex: 1,
          minWidth: 0,
          border: 'none',
          background: 'none',
          padding: 0,
          fontSize: 21,
          fontWeight: 800,
          letterSpacing: '-0.01em',
          color: S.T.ink,
          cursor: 'pointer',
          minHeight: 44,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          fontFamily: 'inherit',
        }}
      >
        {label} <span aria-hidden="true" style={{ fontSize: 13, color: S.T.mut }}>▾</span>
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
  const S = useSkin();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
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
      <button type="button" style={{ ...S.linkBtn, padding: '0 2px' }} onClick={onNow}>
        Now ›
      </button>
    </div>
  );
}
