import type { ReadingView } from '@goal-cascade/shared';
import { useSkin } from '../skin';
import { sparklineText } from './measureCopy';

/**
 * **The first chart in this product**, and every one of its absences is a rule rather than an oversight.
 *
 * One inline `<svg>`, 40 px tall, full width, holding exactly **one `<path>`** — no library, no
 * dependency, no second element, no ref, no `ResizeObserver` and no measurement.
 *
 * It **is not**, and each of these is refused rather than deferred: an axis, a gridline, a tick, a value
 * label, a zero line, a **target line**, a **trend line**, a moving average, a projection, an area fill, a
 * gradient, a colour that means good or bad, a point marker, a hover, a tooltip, a crosshair, a legend, a
 * zoom, a pan, a click target, an animation, a transition, a `prefers-reduced-motion` branch (there is no
 * motion to reduce), or a chart library. `R-measure-8` names the first three by name; the rest follow from
 * the same sentence — *show what you recorded, never compute a verdict* — and a target line is the most
 * tempting of them precisely because it is one `<line>` and data the task already holds. The whole content
 * of *"am I near it"* is the app comparing your number to a goal and drawing the comparison.
 *
 * ── The geometry, and why each choice ─────────────────────────────────────────
 *
 * **x is the reading's INDEX, not its timestamp.** Deliberately. Readings arrive when the owner records
 * them, so a fortnight with no entries becomes a long flat run that reads as *"it held steady"* — a claim
 * about a period in which nothing was measured, which is the app inventing values between the owner's.
 * Equal index spacing makes exactly one claim, and it is true: *these are your readings, in the order you
 * made them.* It also removes a whole class of degenerate geometry (two readings a minute apart, then one
 * six months later) with no special case.
 *
 * **`L` only. Never `C`, never `Q`, never a smoothing pass.** A curve draws values between two readings
 * that were never recorded — the same objection as a trend line, at a smaller scale.
 *
 * **`preserveAspectRatio="none"` plus `vectorEffect="non-scaling-stroke"`** is the pair that makes one
 * path work at 328 px on a phone and 608 px on a wide `S.page`: stretching an index axis means nothing,
 * while the stroke stays 1.5 CSS px either way.
 *
 * **`max === min` draws a flat line at y = 20, and no division is performed** — the same discipline
 * `R-measure-4` applies to `target === start`, one axis over.
 *
 * **Every reading is plotted.** No downsampling, no bucketing, no "last 30": choosing which of the owner's
 * readings matter is the app deciding, and at `MAX_READINGS = 2000` on a 328 px line an SVG is untroubled.
 *
 * **`stroke = T.mut`.** Not accent (which in this palette means *chosen*), not green, not red, not a
 * gradient. `T.mut` is the product's secondary-information colour, and that is what this is.
 *
 * ── Accessibility ─────────────────────────────────────────────────────────────
 * `aria-hidden` and `pointer-events: none`, with **no `role="img"`**: an `img` needs an `alt` carrying the
 * picture's information, and here the information is a list of numbers already on the page. The visually
 * hidden line after it points at that list rather than reciting it (§5 G).
 */
export function Sparkline({ readings, unit }: { readings: readonly ReadingView[]; unit: string }) {
  const S = useSkin();
  /**
   * ⚠ **Below two readings it renders NOTHING** — no svg, no placeholder, no empty box. One point has no
   * shape, and drawing a flat line through it would imply a second reading that does not exist.
   */
  if (readings.length < 2) return null;

  const values = readings.map((r) => r.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const last = values.length - 1;
  const x = (i: number) => 2 + (i / last) * 316;
  const y = (v: number) => (max === min ? 20 : 34 - ((v - min) / (max - min)) * 28);
  const at = (n: number) => Math.round(n * 100) / 100;
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${at(x(i))} ${at(y(v))}`).join(' ');

  return (
    <>
      <svg
        width="100%"
        height="40"
        viewBox="0 0 320 40"
        preserveAspectRatio="none"
        aria-hidden="true"
        data-testid="measure-sparkline"
        style={{ display: 'block', pointerEvents: 'none', marginTop: 12 }}
      >
        <path
          d={d}
          fill="none"
          stroke={S.T.mut}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* Not a live region: nothing about a static picture needs announcing. */}
      <p style={VISUALLY_HIDDEN}>{sparklineText(readings.length, unit)}</p>
    </>
  );
}

/** The pattern this codebase already uses for a screen-reader-only line. */
export const VISUALLY_HIDDEN = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  margin: 0,
} as const;
