import type { CSSProperties } from 'react';
import type { Pulse } from '@goal-cascade/shared';
// Type-only, so there is no import cycle at runtime: `ThemeContext` imports `colors` from here, and this
// module never imports a value from there.
import type { Tokens } from './context/ThemeContext';

type CSS = CSSProperties;

/**
 * The LIGHT palette, and the one place it is written down.
 *
 * `ThemeContext.LIGHT` **is** this object, and `pwa/manifest.ts` reads `colors.paper` / `colors.ink` for
 * the install and splash colours — so this stays exported even though no screen imports it any more.
 * Screens render through `styles(useTheme())` (see `src/skin.ts`), which is what makes dark mode a real
 * token set rather than the mockup's `invert(1) hue-rotate(180deg)` filter (R-nav-12 / D-25).
 */
export const colors = {
  ink: '#1c1c19',
  paper: '#f6f6f3',
  card: '#fff',
  cardSoft: '#fdfdfb',
  line: '#e7e7e2',
  lineSoft: '#f0f0eb',
  border: '#dededa',
  /**
   * Secondary text — tab bar, breadcrumbs, section headers, eyebrows. It is used at 11–13.5px, so WCAG AA
   * asks for 4.5:1 and the large-text exemption does not apply.
   *
   * Was `#8a8a82`, which is 3.21:1 on `paper` and 3.48:1 on `card` — a fail on both, and most of the app's
   * secondary type (the browser walkthrough's finding B). This is the same colour one step darker in
   * OKLCH — hue 106.7° and chroma 0.011 unchanged, lightness 0.631 → 0.543 — so the palette's warm grey is
   * intact and only the contrast moves: 4.61:1 on `paper`, 4.99:1 on `card`.
   *
   * `tests/screens/contrast.test.ts` recomputes both ratios (and the dark set's) from these tokens and
   * fails under 4.5:1, because a comment is not a mechanism.
   */
  mut: '#707069',
  faint: '#b5b5ad',
  disabled: '#c0c0b8',
  accent: 'oklch(0.42 0.09 125)',
  accentSoft: 'oklch(0.95 0.025 125)',
  accentLink: 'oklch(0.45 0.09 125)',
  green: 'oklch(0.55 0.11 125)',
  red: 'oklch(0.55 0.13 25)',
  redText: 'oklch(0.5 0.13 25)',
};

const pulseHue = (p: Pulse) => (p === 'On track' ? '125' : p === 'At risk' ? '70' : '25');

/**
 * Every style the app renders with, resolved against one token set.
 *
 * The mockup's module-level constants were baked against the light palette, so a screen could not change
 * theme without a document filter. These are the same shapes, one indirection later. Names match the
 * mockup's one-for-one, deliberately: the migration is a swap, not a redesign — the visual identity, the
 * oklch palette, the `#f6f6f3` ground, the Manrope/Newsreader pairing and the restraint are the product
 * owner's approved design and are preserved exactly.
 */
function build(T: Tokens) {
  /** Text on an `ink`-filled control. In dark mode `ink` is the light token, so `paper` is the contrast. */
  const onInk = T.paper;
  /** The mockup's `#4a4a44` — body copy a step softer than `ink`. */
  const body = T.night ? '#c9c9c1' : '#4a4a44';
  /** The mockup's `#2a2a26` — the serif focus sentence. */
  const quote = T.night ? '#dedcd4' : '#2a2a26';
  /** The move sheet's disabled-reason amber. Never red: an invalid target is information, not a failure. */
  const warn = T.night ? 'oklch(0.78 0.1 60)' : 'oklch(0.55 0.1 60)';
  /** The ring around a selected list card. */
  const ring = T.night ? 'oklch(0.55 0.07 125)' : 'oklch(0.75 0.06 125)';
  const softL = T.night ? '0.28' : '0.95';
  const softC = T.night ? '0.035' : '0.03';
  const softInk = T.night ? '0.82' : '0.42';

  const page: CSS = { maxWidth: 640, margin: '0 auto', padding: '20px 16px 110px 16px' };
  const card: CSS = { background: T.card, border: `1px solid ${T.line}`, borderRadius: 16 };
  const input: CSS = {
    width: '100%',
    minHeight: 48,
    border: `1px solid ${T.border}`,
    borderRadius: 12,
    padding: '0 14px',
    fontSize: 15,
    background: T.card,
    color: T.ink,
    fontFamily: 'inherit',
  };

  return {
    T,
    onInk,
    body,
    quote,
    warn,
    ring,

    page,
    card,
    input,
    eyebrow: { fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.mut } as CSS,
    h1: { margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: '-0.01em', color: T.ink } as CSS,
    serif: { fontFamily: "'Newsreader', serif", fontStyle: 'italic' } as CSS,
    sectionLabel: { fontSize: 11.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: T.mut } as CSS,
    fieldLabel: { fontSize: 12, fontWeight: 700, color: T.mut } as CSS,
    textarea: {
      width: '100%',
      border: `1px solid ${T.border}`,
      borderRadius: 12,
      padding: '10px 14px',
      fontSize: 14,
      background: T.card,
      color: T.ink,
      resize: 'none',
      fontFamily: 'inherit',
    } as CSS,

    chipBtn: (active: boolean): CSS => ({
      minHeight: 38,
      padding: '0 13px',
      borderRadius: 19,
      fontSize: 12.5,
      fontWeight: 700,
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      fontFamily: 'inherit',
      ...(active ? { border: 'none', background: T.accent, color: onInk } : { border: `1px solid ${T.border}`, background: T.card, color: body }),
    }),

    btn: (active: boolean, danger = false): CSS => ({
      minHeight: 44,
      padding: '0 14px',
      borderRadius: 12,
      fontSize: 13.5,
      fontWeight: 700,
      cursor: 'pointer',
      fontFamily: 'inherit',
      ...(danger
        ? active
          ? { border: 'none', background: T.red, color: onInk }
          : { border: `1px solid ${T.border}`, background: T.card, color: T.mut }
        : active
          ? { border: 'none', background: T.ink, color: onInk }
          : { border: `1px solid ${T.border}`, background: T.card, color: body }),
    }),

    menuBtn: {
      minHeight: 40,
      padding: '0 13px',
      border: `1px solid ${T.border}`,
      borderRadius: 20,
      background: T.card,
      fontSize: 12.5,
      fontWeight: 700,
      color: body,
      cursor: 'pointer',
      fontFamily: 'inherit',
    } as CSS,
    dangerBtn: {
      minHeight: 40,
      padding: '0 13px',
      border: `1px solid ${T.border}`,
      borderRadius: 20,
      background: T.card,
      fontSize: 12.5,
      fontWeight: 700,
      color: T.redText,
      cursor: 'pointer',
      fontFamily: 'inherit',
    } as CSS,
    topBtn: {
      minHeight: 40,
      padding: '0 14px',
      border: 'none',
      borderRadius: 20,
      background: T.ink,
      color: onInk,
      fontSize: 12.5,
      fontWeight: 700,
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      fontFamily: 'inherit',
    } as CSS,
    themeBtn: {
      width: 40,
      height: 40,
      minWidth: 40,
      border: `1px solid ${T.border}`,
      borderRadius: '50%',
      background: T.card,
      color: body,
      fontSize: 15,
      cursor: 'pointer',
      padding: 0,
      fontFamily: 'inherit',
    } as CSS,
    smallDarkBtn: {
      minHeight: 40,
      padding: '0 16px',
      border: 'none',
      borderRadius: 20,
      background: T.ink,
      color: onInk,
      fontSize: 12.5,
      fontWeight: 700,
      cursor: 'pointer',
      marginTop: 8,
      fontFamily: 'inherit',
    } as CSS,
    linkBtn: {
      minHeight: 44,
      textAlign: 'left',
      border: 'none',
      background: 'none',
      padding: '4px 0',
      fontSize: 13.5,
      fontWeight: 700,
      color: T.accentLink,
      cursor: 'pointer',
      fontFamily: 'inherit',
    } as CSS,

    saveBtn: (disabled: boolean): CSS => ({
      width: '100%',
      minHeight: 50,
      marginTop: 14,
      border: 'none',
      borderRadius: 14,
      fontSize: 15,
      fontWeight: 800,
      fontFamily: 'inherit',
      ...(disabled ? { background: T.line, color: T.disabled, cursor: 'not-allowed' } : { background: T.ink, color: onInk, cursor: 'pointer' }),
    }),

    checkBox: (on: boolean): CSS => ({
      width: 26,
      height: 26,
      minWidth: 26,
      marginTop: 2,
      borderRadius: 8,
      cursor: 'pointer',
      fontSize: 15,
      lineHeight: 1,
      padding: 0,
      fontFamily: 'inherit',
      ...(on ? { border: 'none', background: T.green, color: T.paper } : { border: `2px solid ${T.border}`, background: T.card, color: 'transparent' }),
    }),

    navBtn: (on: boolean): CSS => ({
      flex: 1,
      minHeight: 56,
      border: 'none',
      background: 'none',
      fontSize: 11.5,
      cursor: 'pointer',
      padding: '0 2px',
      fontFamily: 'inherit',
      ...(on ? { fontWeight: 800, color: T.ink, boxShadow: `inset 0 3px 0 ${T.green}` } : { fontWeight: 600, color: T.mut }),
    }),

    pulseBadge: (p: Pulse): CSS => ({
      fontSize: 12,
      fontWeight: 700,
      padding: '4px 10px',
      borderRadius: 11,
      whiteSpace: 'nowrap',
      background: `oklch(${softL} ${softC} ${pulseHue(p)})`,
      color: `oklch(${softInk} 0.1 ${pulseHue(p)})`,
    }),

    /** R-goal-15 — the pulse dot. `dim` is dormancy, and dormancy must read as intentional, not broken. */
    dot: (p: Pulse, dim: boolean): CSS => ({
      display: 'inline-block',
      width: 8,
      height: 8,
      minWidth: 8,
      borderRadius: '50%',
      background: `oklch(${T.night ? '0.68' : '0.55'} 0.11 ${pulseHue(p)})`,
      opacity: dim ? 0.35 : 1,
    }),

    hChip: (active: boolean): CSS => ({
      fontSize: 10,
      fontWeight: 800,
      letterSpacing: '0.06em',
      padding: '2px 7px',
      borderRadius: 8,
      whiteSpace: 'nowrap',
      ...(active ? { background: T.accentSoft, color: T.accent } : { background: T.lineSoft, color: T.mut }),
    }),

    pickerRow: (state: 'ok' | 'sel' | 'dis'): CSS => ({
      display: 'flex',
      alignItems: 'center',
      width: '100%',
      textAlign: 'left',
      border: 'none',
      borderBottom: `1px solid ${T.lineSoft}`,
      background: state === 'sel' ? T.accentSoft : T.card,
      minHeight: 46,
      padding: '6px 12px',
      fontSize: 13.5,
      fontWeight: 600,
      fontFamily: 'inherit',
      color: state === 'dis' ? T.disabled : T.ink,
      cursor: state === 'dis' ? 'not-allowed' : 'pointer',
    }),

    /**
     * R-task-10/11 — the carry label. The red chip at two weeks is the ONLY escalation in this product:
     * no popup, no nag, no flag. Keep it that way.
     */
    carryLabel: (sev: 'gray' | 'chip'): CSS =>
      sev === 'chip'
        ? { display: 'inline-block', fontSize: 11.5, fontWeight: 700, color: T.paper, background: T.red, borderRadius: 9, padding: '2px 8px' }
        : { fontSize: 11.5, fontWeight: 700, color: T.faint },

    overlay: { position: 'fixed', inset: 0, background: 'rgba(20,20,18,0.4)', zIndex: 42 } as CSS,
    sheet: {
      position: 'fixed',
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 43,
      background: T.card,
      borderRadius: '18px 18px 0 0',
      maxHeight: '88vh',
      overflow: 'auto',
    } as CSS,
    sheetInner: { maxWidth: 640, margin: '0 auto', padding: '20px 20px 30px 20px' } as CSS,

    /** The sheet header: the heading (the dialog's `aria-labelledby` target) and the quiet ✕. */
    sheetHeader: { display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 } as CSS,
    sheetTitle: { flex: 1, minWidth: 0, margin: 0, fontSize: 16, fontWeight: 800, color: T.ink, outlineOffset: 3 } as CSS,
    /**
     * The dismiss control. A ✕ in the header, not a button bar: the app's chrome is quiet, and a sheet
     * that shouts about leaving is a sheet that reads as a commitment.
     */
    sheetClose: {
      width: 36,
      height: 36,
      minWidth: 36,
      marginTop: -6,
      marginRight: -6,
      border: 'none',
      borderRadius: '50%',
      background: 'none',
      color: T.mut,
      fontSize: 16,
      lineHeight: 1,
      cursor: 'pointer',
      padding: 0,
      fontFamily: 'inherit',
    } as CSS,
    /** Shown only when a sheet holding typed work is asked to close (see `Sheet`'s `unsaved`). */
    discardBar: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap',
      background: T.paper,
      border: `1px solid ${T.border}`,
      borderRadius: 12,
      padding: '9px 12px',
      marginBottom: 12,
      fontSize: 13,
      fontWeight: 600,
      color: T.ink,
    } as CSS,

    /** The dashed frame every empty state in the mockup uses. */
    dashed: { background: T.card, border: `1px dashed ${T.border}`, borderRadius: 16 } as CSS,
  };
}

export type Styles = ReturnType<typeof build>;

// `Tokens` is memoised by `ThemeProvider`, so one entry per theme is all this ever holds.
const cache = new WeakMap<Tokens, Styles>();

export function styles(T: Tokens): Styles {
  const hit = cache.get(T);
  if (hit) return hit;
  const made = build(T);
  cache.set(T, made);
  return made;
}
