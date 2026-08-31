import { describe, expect, it } from 'vitest';
import { DARK, LIGHT, type Tokens } from '../../src/context/ThemeContext';

/**
 * WCAG AA on the muted token, computed from the palette itself.
 *
 * The browser walkthrough (docs/work/09-e2e-browser, finding B) measured the light `mut` at 3.21:1 on the
 * page and 3.48:1 on a card, at 11–13.5px — under the 18.66px/24px large-text exemption, so 4.5:1 applies.
 * That token carries the bottom tab bar, every breadcrumb, every section header and every eyebrow: most of
 * the app's secondary type failed AA in light mode while dark mode passed, which is exactly what happens
 * when the design is tuned in dark and the light set is derived by eye.
 *
 * A darker hex fixes it once. This test is what keeps it fixed: it recomputes the ratios from the tokens
 * rather than asserting a literal, so any future palette edit — a "slightly softer grey", a re-tuned
 * `paper`, a new card colour — is measured, not trusted. A comment saying "keep this above 4.5" is not a
 * mechanism; this is.
 */

/** WCAG 2.x relative luminance. `#abc` and `#aabbcc` both, because `card` is `#fff`. */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  expect(full, `${hex} is not a plain hex colour — this test cannot measure oklch()`).toMatch(/^[0-9a-f]{6}$/i);
  const channel = (i: number) => {
    const c = parseInt(full.slice(i * 2, i * 2 + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** AA for text below 18.66px bold / 24px regular. Every use of `mut` in this app is 11–13.5px. */
const AA = 4.5;

const surfaces = (T: Tokens) => [
  ['the page background', T.paper],
  ['a card', T.card],
] as const;

describe('Palette — muted text meets WCAG AA on every surface it is drawn on', () => {
  for (const [theme, T] of [
    ['light', LIGHT],
    ['dark', DARK],
  ] as const) {
    for (const [where, bg] of surfaces(T)) {
      it(`${theme}: mut on ${where} is at least ${AA}:1`, () => {
        const ratio = contrastRatio(T.mut, bg);
        expect(
          ratio,
          `${theme} mut ${T.mut} on ${bg} is ${ratio.toFixed(2)}:1 — under AA. Darken (light) or lighten (dark) the token; keep its OKLCH hue.`,
        ).toBeGreaterThanOrEqual(AA);
      });
    }
  }

  /** The check on the check: the formula has to report the known failure it was written for. */
  it('the ratio it computes is the one the browser reported for the old token', () => {
    expect(contrastRatio('#8a8a82', LIGHT.paper)).toBeCloseTo(3.21, 2);
    expect(contrastRatio('#8a8a82', LIGHT.card)).toBeCloseTo(3.48, 2);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
  });

  /**
   * ⚠ **A1 (R-backlog-22)** — the reorder control's own colour.
   *
   * R-backlog-22 requires the always-visible `Reorder "<title>"` control to meet "the enforced contrast
   * rule", and S-backlog-22-3 fails the build if it does not. The control deliberately introduces **no new
   * token**: it draws in `body`, the same colour the app's menu buttons already use, on `card` and on the
   * softer `cardSoft` it takes while grabbed. Asserting it here is what makes "it reuses an existing token"
   * a checked fact rather than a claim in a comment — and what catches a future palette edit that softens
   * `body` for text but forgets this control.
   */
  for (const [theme, T, bodyToken] of [
    ['light', LIGHT, '#4a4a44'],
    ['dark', DARK, '#c9c9c1'],
  ] as const) {
    it(`${theme}: the reorder control's label clears AA on a card and on a grabbed card`, () => {
      for (const bg of [T.card, T.cardSoft]) {
        const ratio = contrastRatio(bodyToken, bg);
        expect(ratio, `${theme} reorder control ${bodyToken} on ${bg} is ${ratio.toFixed(2)}:1 — under AA`).toBeGreaterThanOrEqual(AA);
      }
    });
  }

  /** Body copy and headings sit on the same two surfaces and must not regress either. */
  for (const [theme, T] of [
    ['light', LIGHT],
    ['dark', DARK],
  ] as const) {
    it(`${theme}: primary text clears AA on both surfaces too`, () => {
      for (const [, bg] of surfaces(T)) expect(contrastRatio(T.ink, bg)).toBeGreaterThanOrEqual(AA);
    });
  }
});
