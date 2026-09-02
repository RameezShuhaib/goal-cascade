import { useEffect, useRef, useState } from 'react';
import { HORIZONS, type Horizon } from '@goal-cascade/shared';
import { useSkin } from '../skin';

/**
 * R-lens-33 — **the lens tab strip.** Five tabs, in horizon order, one tap to change lens.
 *
 * It replaces the Zoom sheet outright (`29-ux-navigation` §2.8). The sheet's argument for existing was
 * that it named the destination period *before* you committed; tabs make the commit free and one tap
 * reversible, so the preview's whole justification is deleted and the period row one line below answers
 * the same question in the same frame (R-lens-30).
 *
 * ── Why a scroller and not a segmented control ────────────────────────────────
 * `14-redesign` §1.4 refused a five-way segmented control and was right to: at 360px five equal cells are
 * 65px each and `Quarterly` needs 87px, so truncation is its only failure mode. **This layout has no
 * failure mode.** The track is as wide as its five words (~390px at Manrope 13/700 with `0 14px`
 * padding), the window scrolls over it, and **no label is ever shortened, abbreviated, truncated,
 * ellipsised, wrapped or scaled down.** At 360px it scrolls 30px; at 390px and above it does not scroll at
 * all. The scroll is a capability, not a feature — it is what makes a sixth horizon, a longer word or a
 * wider fallback face a non-event.
 *
 * ── The active state, and why the weight does not move ────────────────────────
 * Colour (`T.mut` → `T.ink`), a 2px `T.accent` rule inset at the bottom edge, and `aria-selected`. Three
 * signals, one more than the accessibility floor asks for, and **not** a weight change: 700 → 800 changes
 * the glyph advances, which changes the tab's width, which reflows every tab to its right on every
 * selection. A control whose siblings shift when you use it cannot be aimed at twice.
 *
 * The 2px rule shares the strip's own `borderBottom` baseline, so it reads as a thickening of the hairline
 * rather than a second line. The idiom is `S.navBtn`'s `inset 0 3px 0` inverted: the bottom bar marks the
 * selected tab at the edge facing its content, and so does this. No new token, no new colour.
 *
 * ── Motion ───────────────────────────────────────────────────────────────────
 * `behavior: 'instant'`, always, on every platform and every preference. **There is no animation to
 * reduce, so there is no `prefers-reduced-motion` branch** and the product's "no animation anywhere" line
 * is not crossed. No `scroll-snap` either: snap points settle with an animation and fight a deliberate
 * drag.
 *
 * ── Keyboard (R-lens-13's surviving accessibility clause) ─────────────────────
 * One tab stop for the whole strip (roving `tabindex`), `←`/`→` to move focus **without activating**,
 * `Home`/`End` for the ends, `Enter`/`Space` to activate. **Manual activation, not automatic**: arrowing
 * from `Life` to `Weekly` under automatic activation would fire three route changes, three lens reads and
 * three history entries to reach one destination. It does not wrap at either end — an ordered scale has a
 * first and a last, and a carousel would say Weekly and Life are neighbours.
 *
 * ── Where it is mounted ──────────────────────────────────────────────────────
 * **Once, in `LensChrome`, above the router outlet** — never inside the per-lens body. Activating a tab is
 * a route change; a strip inside the child would unmount, drop focus to `<body>` and reset `scrollLeft` on
 * every lens change.
 */

/** The tab that names a lens, so the body's `aria-labelledby` can point at it. */
export const lensTabId = (lens: Horizon): string => `lens-tab-${lens}`;

/** The one lens body, named once so `aria-controls` and `id` cannot drift apart. */
export const LENS_PANEL_ID = 'lens-panel';

export function LensTabs({ lens, onChange }: { lens: Horizon; onChange: (to: Horizon) => void }) {
  const S = useSkin();
  const refs = useRef(new Map<Horizon, HTMLButtonElement | null>());
  /**
   * The roving index. It starts on the selected tab and follows arrow-key focus, so `Tab` always lands
   * where the eye left off and the strip is one stop either way. Selection does not follow it.
   */
  const [roving, setRoving] = useState<Horizon>(lens);
  useEffect(() => setRoving(lens), [lens]);

  /**
   * `inline: 'nearest'` is doing real work: a tab already fully visible **does not move the strip at
   * all**, so tapping `Yearly` from `Life` scrolls nothing. `block: 'nearest'` keeps a sticky strip from
   * scrolling the page vertically to reach itself.
   *
   * Optional-called because jsdom does not implement `scrollIntoView`, and a header that throws in the
   * test environment is a header nobody can test.
   */
  useEffect(() => {
    refs.current.get(lens)?.scrollIntoView?.({ inline: 'nearest', block: 'nearest', behavior: 'instant' });
  }, [lens]);

  const focus = (to: Horizon) => {
    setRoving(to);
    refs.current.get(to)?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = HORIZONS.indexOf(roving);
    // `stopPropagation` on every key this strip owns, so the lens body's `←`/`→` period shortcut can
    // never also fire from inside it. Altitude is horizontal *in here*; time is horizontal out there.
    if (e.key === 'ArrowLeft' && i > 0) {
      e.preventDefault();
      e.stopPropagation();
      focus(HORIZONS[i - 1]!);
    } else if (e.key === 'ArrowRight' && i < HORIZONS.length - 1) {
      e.preventDefault();
      e.stopPropagation();
      focus(HORIZONS[i + 1]!);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      // At an end. Still swallowed — the strip does not wrap, and it does not hand the key onward either.
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === 'Home') {
      e.preventDefault();
      e.stopPropagation();
      focus(HORIZONS[0]!);
    } else if (e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      focus(HORIZONS[HORIZONS.length - 1]!);
    }
  };

  return (
    /*
     * ⚠ **Full bleed, and both consequences are wanted.** The strip escapes `S.page`'s 16px gutter, so a
     * clipped tab is cut by the SCREEN rather than by a box — which reads as *there is more over there*
     * and is the only affordance the pattern needs (no gradient mask, no arrow buttons) — and the hairline
     * runs the full width, so it is the boundary between *which lens* and *the lens*. Over 640px the bleed
     * stops at `S.page`'s column edge. No media query, no breakpoint.
     */
    <div style={{ marginLeft: -16, marginRight: -16, borderBottom: `1px solid ${S.T.line}` }}>
      <div
        role="tablist"
        aria-label="Lens"
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        /*
         * `data-h-scroll` is the marker `LensScreen`'s swipe handler checks today; `data-no-swipe` is the
         * one `22-ux-fixes` §6.3 generalises it to. Both ship, so the period swipe can never fire from
         * inside the strip under either code path. `data-lens-tabs` is what `index.html` hangs the
         * WebKit scrollbar rule on.
         */
        data-lens-tabs=""
        data-h-scroll=""
        data-no-swipe=""
        style={{
          display: 'flex',
          overflowX: 'auto',
          overflowY: 'hidden',
          // The lead and trail padding of §2.2's width ledger: `Life` starts 16px in, `Weekly` ends 16px
          // from the far edge, and the track is exactly as wide as its content plus those two.
          paddingLeft: 16,
          paddingRight: 16,
          scrollPaddingInline: 24,
          // No scrollbar: Firefox here, WebKit in `index.html`'s `[data-lens-tabs]::-webkit-scrollbar`.
          scrollbarWidth: 'none',
          // A horizontal flick at either end must not chain into the page or the browser's back gesture.
          overscrollBehaviorX: 'contain',
        }}
      >
        {HORIZONS.map((h) => {
          const selected = h === lens;
          return (
            <button
              key={h}
              type="button"
              role="tab"
              id={lensTabId(h)}
              ref={(el) => {
                refs.current.set(h, el);
              }}
              aria-selected={selected}
              aria-controls={LENS_PANEL_ID}
              tabIndex={roving === h ? 0 : -1}
              onFocus={() => setRoving(h)}
              onClick={() => onChange(h)}
              style={{
                // `flex: 0 0 auto` and `nowrap`: the tab is as wide as its word, at every viewport. This
                // is the rule the whole pattern exists to hold — nothing here may shrink, wrap or
                // ellipsise, and there is deliberately no `maxWidth` and no `textOverflow`.
                flex: '0 0 auto',
                whiteSpace: 'nowrap',
                minHeight: 44,
                padding: '0 14px',
                border: 'none',
                background: 'none',
                fontFamily: 'inherit',
                fontSize: 13,
                // 700 in BOTH states. See the block comment: a weight change reflows the track.
                fontWeight: 700,
                letterSpacing: 0,
                cursor: 'pointer',
                color: selected ? S.T.ink : S.T.mut,
                ...(selected ? { boxShadow: `inset 0 -2px 0 ${S.T.accent}` } : {}),
              }}
            >
              {h}
            </button>
          );
        })}
      </div>
    </div>
  );
}
