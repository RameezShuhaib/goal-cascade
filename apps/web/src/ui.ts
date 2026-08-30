import type { CSSProperties } from 'react';
import type { Pulse } from './types';

type CSS = CSSProperties;

export const colors = {
  ink: '#1c1c19',
  paper: '#f6f6f3',
  card: '#fff',
  cardSoft: '#fdfdfb',
  line: '#e7e7e2',
  lineSoft: '#f0f0eb',
  border: '#dededa',
  mut: '#8a8a82',
  faint: '#b5b5ad',
  disabled: '#c0c0b8',
  accent: 'oklch(0.42 0.09 125)',
  accentSoft: 'oklch(0.95 0.025 125)',
  accentLink: 'oklch(0.45 0.09 125)',
  green: 'oklch(0.55 0.11 125)',
  red: 'oklch(0.55 0.13 25)',
  redText: 'oklch(0.5 0.13 25)',
};

export const page: CSS = { maxWidth: 640, margin: '0 auto', padding: '20px 16px 110px 16px' };
export const eyebrow: CSS = { fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: colors.mut };
export const h1: CSS = { margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: '-0.01em' };
export const card: CSS = { background: colors.card, border: `1px solid ${colors.line}`, borderRadius: 16 };
export const serif: CSS = { fontFamily: "'Newsreader', serif", fontStyle: 'italic' };
export const sectionLabel: CSS = { fontSize: 11.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: colors.mut };
export const fieldLabel: CSS = { fontSize: 12, fontWeight: 700, color: colors.mut };
export const input: CSS = { width: '100%', minHeight: 48, border: `1px solid ${colors.border}`, borderRadius: 12, padding: '0 14px', fontSize: 15, background: colors.card };
export const textarea: CSS = { width: '100%', border: `1px solid ${colors.border}`, borderRadius: 12, padding: '10px 14px', fontSize: 14, background: colors.card, resize: 'none' };

export const chipBtn = (active: boolean): CSS => ({
  minHeight: 38, padding: '0 13px', borderRadius: 19, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
  ...(active
    ? { border: 'none', background: colors.accent, color: '#fff' }
    : { border: `1px solid ${colors.border}`, background: colors.card, color: '#4a4a44' }),
});

export const btn = (active: boolean, danger = false): CSS => ({
  minHeight: 44, padding: '0 14px', borderRadius: 12, fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
  ...(danger
    ? active
      ? { border: 'none', background: colors.red, color: '#fff' }
      : { border: `1px solid ${colors.border}`, background: colors.card, color: colors.mut }
    : active
      ? { border: 'none', background: colors.ink, color: '#fff' }
      : { border: `1px solid ${colors.border}`, background: colors.card, color: '#4a4a44' }),
});

export const menuBtn: CSS = { minHeight: 40, padding: '0 13px', border: `1px solid ${colors.border}`, borderRadius: 20, background: colors.card, fontSize: 12.5, fontWeight: 700, color: '#4a4a44', cursor: 'pointer' };
export const dangerBtn: CSS = { ...menuBtn, color: colors.redText };
export const topBtn: CSS = { minHeight: 40, padding: '0 14px', border: 'none', borderRadius: 20, background: colors.ink, color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' };
export const themeBtn: CSS = { width: 40, height: 40, minWidth: 40, border: `1px solid ${colors.border}`, borderRadius: '50%', background: colors.card, color: '#4a4a44', fontSize: 15, cursor: 'pointer', padding: 0 };
export const smallDarkBtn: CSS = { minHeight: 40, padding: '0 16px', border: 'none', borderRadius: 20, background: colors.ink, color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', marginTop: 8 };
export const linkBtn: CSS = { minHeight: 44, textAlign: 'left', border: 'none', background: 'none', padding: '4px 0', fontSize: 13.5, fontWeight: 700, color: colors.accentLink, cursor: 'pointer' };

export const saveBtn = (disabled: boolean): CSS => ({
  width: '100%', minHeight: 50, marginTop: 14, border: 'none', borderRadius: 14, fontSize: 15, fontWeight: 800,
  ...(disabled
    ? { background: '#e0e0da', color: '#a0a099', cursor: 'not-allowed' }
    : { background: colors.ink, color: '#fff', cursor: 'pointer' }),
});

export const checkBox = (on: boolean): CSS => ({
  width: 26, height: 26, minWidth: 26, marginTop: 2, borderRadius: 8, cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: 0,
  ...(on ? { border: 'none', background: colors.green, color: '#fff' } : { border: '2px solid #cfcfc8', background: colors.card, color: 'transparent' }),
});

export const navBtn = (on: boolean): CSS => ({
  flex: 1, minHeight: 56, border: 'none', background: 'none', fontSize: 11.5, cursor: 'pointer', padding: '0 2px',
  ...(on ? { fontWeight: 800, color: colors.ink, boxShadow: `inset 0 3px 0 ${colors.green}` } : { fontWeight: 600, color: colors.mut }),
});

const pulseHue = (p: Pulse) => (p === 'On track' ? '125' : p === 'At risk' ? '70' : '25');

export const pulseBadge = (p: Pulse): CSS => ({
  fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 11, whiteSpace: 'nowrap',
  background: `oklch(0.95 0.03 ${pulseHue(p)})`, color: `oklch(0.42 0.1 ${pulseHue(p)})`,
});

export const dot = (p: Pulse, dim: boolean): CSS => ({
  display: 'inline-block', width: 8, height: 8, minWidth: 8, borderRadius: '50%',
  background: `oklch(0.55 0.11 ${pulseHue(p)})`, opacity: dim ? 0.35 : 1,
});

export const hChip = (active: boolean): CSS => ({
  fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', padding: '2px 7px', borderRadius: 8, whiteSpace: 'nowrap',
  ...(active ? { background: colors.accentSoft, color: colors.accent } : { background: '#efefe9', color: colors.mut }),
});

export const pickerRow = (state: 'ok' | 'sel' | 'dis'): CSS => ({
  display: 'flex', alignItems: 'center', width: '100%', textAlign: 'left', border: 'none',
  borderBottom: `1px solid ${colors.lineSoft}`, background: state === 'sel' ? colors.accentSoft : colors.card,
  minHeight: 46, padding: '6px 12px', fontSize: 13.5, fontWeight: 600,
  color: state === 'dis' ? colors.disabled : colors.ink, cursor: state === 'dis' ? 'not-allowed' : 'pointer',
});

export const carryLabel = (sev: 'gray' | 'chip'): CSS =>
  sev === 'chip'
    ? { display: 'inline-block', fontSize: 11.5, fontWeight: 700, color: '#fff', background: colors.red, borderRadius: 9, padding: '2px 8px' }
    : { fontSize: 11.5, fontWeight: 700, color: '#a0a099' };

export const overlay: CSS = { position: 'fixed', inset: 0, background: 'rgba(20,20,18,0.4)', zIndex: 42 };
export const sheet: CSS = { position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 43, background: '#fffffe', borderRadius: '18px 18px 0 0', maxHeight: '88vh', overflow: 'auto' };
export const sheetInner: CSS = { maxWidth: 640, margin: '0 auto', padding: '20px 20px 30px 20px' };
