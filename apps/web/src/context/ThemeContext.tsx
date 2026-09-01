import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Theme } from '@goal-cascade/shared';
import { colors } from '../ui';

/**
 * R-nav-12 / D-25 — a REAL light/dark token set, persisted per user.
 *
 * The mockup faked dark mode with `document.documentElement.style.filter = 'invert(1) hue-rotate(180deg)'`
 * (`store.tsx#applyTheme`). Its own README says to replace it, and it has to go: a whole-document filter
 * inverts images and embeds along with the chrome, defeats `color-scheme` (so form controls, scrollbars and
 * the overscroll band stay light), cannot be overridden for a single element, and forces a repaint of the
 * entire page on every toggle. It also makes the *palette* undefinable — there is no dark red, only an
 * inverted light red, which lands on cyan.
 *
 * So: two token sets, one shape. Names mirror `src/ui.ts`'s `colors` so a screen migrates by swapping
 * `colors.x` for `T.x`, and `LIGHT` is `colors` exactly — which is what keeps `src/pwa/manifest.ts`'s
 * install colours (`MANIFEST_THEME_COLOR` = `colors.paper`, `MANIFEST_DARK_THEME_COLOR` = `colors.ink`)
 * honest. `tests/pwa/manifest.test.ts` asserts that pairing so a palette edit cannot silently desync the
 * splash screen from the app. (It named `tests/api/theme.test.ts`, which does not exist — a reader who
 * greps for the drift alarm should find it, not conclude there is none.)
 */
export interface Tokens {
  ink: string;
  paper: string;
  card: string;
  cardSoft: string;
  line: string;
  lineSoft: string;
  border: string;
  mut: string;
  disabled: string;
  accent: string;
  accentSoft: string;
  accentLink: string;
  green: string;
  red: string;
  redText: string;
  /** `true` while the dark set is in use — for `color-scheme` and for the few places that need to branch. */
  night: boolean;
}

/** The light set IS `src/ui.ts`'s palette. One source of truth for the colour the manifest ships. */
export const LIGHT: Tokens = { ...colors, night: false };

/**
 * The dark set. Paper and ink swap roles (which is why `MANIFEST_DARK_THEME_COLOR` is `colors.ink`), and
 * every oklch token keeps its hue and chroma while its lightness moves to the other side of the range —
 * so the accent is recognisably the same green and the red is still a red, at contrast that works on a
 * dark ground. The greys are hand-picked rather than inverted: a mathematically inverted `#e7e7e2` is
 * `#18181d`, which is bluer than this app's warm neutral.
 */
export const DARK: Tokens = {
  ink: '#f0f0ea',
  paper: '#1c1c19',
  card: '#242420',
  cardSoft: '#201f1c',
  line: '#33332e',
  lineSoft: '#2a2a26',
  border: '#3a3a34',
  mut: '#9a9a90',
  disabled: '#5a5a53',
  accent: 'oklch(0.78 0.09 125)',
  accentSoft: 'oklch(0.28 0.035 125)',
  accentLink: 'oklch(0.8 0.09 125)',
  green: 'oklch(0.68 0.11 125)',
  red: 'oklch(0.68 0.13 25)',
  redText: 'oklch(0.72 0.13 25)',
  night: true,
};

export const THEME_STORAGE_KEY = 'goal-cascade.theme';

export interface ThemeState {
  tokens: Tokens;
  /** The stored CHOICE (`system` included), not the resolved one. */
  theme: Theme;
  /** Persists to `/me/preferences` and caches locally so the next cold start paints right immediately. */
  setTheme: (t: Theme) => void;
  /** R-nav-11's top-right toggle: flips between the two concrete choices, never back to `system`. */
  toggleTheme: () => void;
}

const ThemeCtx = createContext<ThemeState | null>(null);

export function readCachedTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

function writeCachedTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode — the server preference is still authoritative on the next load */
  }
}

function systemDark(): boolean {
  return typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)').matches : false;
}

export const resolveTokens = (theme: Theme, dark: boolean): Tokens => (theme === 'dark' || (theme === 'system' && dark) ? DARK : LIGHT);

/**
 * Paint the DOCUMENT, not just the React tree. `#root` is inset by the safe areas and the app is a centred
 * 640px column, so everything the tree does not cover — the gutters, the notch strips, the overscroll
 * rubber band — shows `html`'s background. Without this it stays on `index.html`'s literal `#f6f6f3` and a
 * dark app renders inside white gutters. `color-scheme` brings form controls and scrollbars along, and the
 * `theme-color` metas are rewritten so an installed PWA's status bar follows the user's choice even when
 * that choice disagrees with `prefers-color-scheme` (index.html ships both media variants for first paint).
 */
export function applyDocumentTheme(tokens: Tokens): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.backgroundColor = tokens.paper;
  root.style.colorScheme = tokens.night ? 'dark' : 'light';
  /**
   * The focus ring every control draws (`index.html`'s `:focus-visible` rule reads this). The browser
   * default is blue on a light page and white on a dark one — the one piece of chrome in this app nobody
   * chose, and visibly wrong on the task sheet's done-condition input.
   */
  root.style.setProperty('--focus-ring', tokens.green);
  /*
   * The body followed neither. `index.html` hardcoded `background: #f6f6f3; color-scheme: light` on it, and
   * a stylesheet declaration beats an inherited value — so in dark mode `getComputedStyle(document.body)`
   * still said `light`, native controls rendered light inside a dark app, and a light body sat under it
   * ready to flash white. The rule is gone from `index.html`; these two lines make the body's own state
   * explicit anyway, so nothing can quietly re-pin it.
   */
  // `null` only if this ever runs from `<head>`; the entry module is deferred, so in practice it is there.
  const body: HTMLElement | null = document.body;
  if (body) {
    body.style.backgroundColor = tokens.paper;
    body.style.colorScheme = tokens.night ? 'dark' : 'light';
  }
  // Belt and braces against the mockup's filter surviving a hot reload during the migration.
  root.style.filter = '';
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', tokens.paper));
}

/** Boot-time paint (`main.tsx`), before React mounts: the cached choice, resolved the way the provider will. */
export function bootDocumentTheme(): void {
  applyDocumentTheme(resolveTokens(readCachedTheme(), systemDark()));
}

function useSystemDark(): boolean {
  const query = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null);
  const [dark, setDark] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const mq = query();
    if (!mq) return;
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return dark;
}

export interface ThemeProviderProps {
  children: ReactNode;
  /** Test seam: pin the rendered theme and ignore both the server preference and the cache. */
  theme?: Theme;
  /**
   * The user's stored preference, from `/me/preferences`. `undefined` until it loads — which is why the
   * cache below exists at all.
   */
  serverTheme?: Theme | undefined;
  /** Persist a change. `App.tsx` passes `usePatchPreferences`; omitted, the choice stays on this device. */
  onChange?: (theme: Theme) => void;
}

/**
 * The theme is a per-user preference (D-25), so the server is the source of truth — but the last choice is
 * also cached in localStorage, because the first paint after a cold start happens long before `/me` lands
 * and a white flash on a dark-mode phone is exactly the kind of thing that reads as "cheap".
 *
 * The provider takes the server value and the writer as PROPS rather than calling the query hooks itself.
 * It has to sit above the auth gate (the sign-in screen is themed too), and a provider that queried `/me`
 * from up there would fetch before the gate had decided whether there is a session at all. `App.tsx` — which
 * is inside the gate — supplies both.
 */
export function ThemeProvider({ children, theme: forced, serverTheme, onChange }: ThemeProviderProps) {
  const [cached, setCached] = useState<Theme>(readCachedTheme);
  const system = useSystemDark();

  // The server's answer wins over the cache and is written back to it for the next cold start.
  useEffect(() => {
    if (!serverTheme) return;
    setCached(serverTheme);
    writeCachedTheme(serverTheme);
  }, [serverTheme]);

  const theme = forced ?? cached;
  const tokens = useMemo(() => resolveTokens(theme, system), [theme, system]);

  const setTheme = useCallback(
    (next: Theme) => {
      setCached(next);
      writeCachedTheme(next);
      onChange?.(next);
    },
    [onChange],
  );

  const toggleTheme = useCallback(() => {
    setTheme(resolveTokens(theme, system).night ? 'light' : 'dark');
  }, [setTheme, theme, system]);

  // The page outside the app column follows the same state the tree does, so a toggle repaints it too.
  useEffect(() => {
    applyDocumentTheme(tokens);
  }, [tokens]);

  const value = useMemo<ThemeState>(() => ({ tokens, theme, setTheme, toggleTheme }), [tokens, theme, setTheme, toggleTheme]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

function useThemeState(): ThemeState {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

/** The tokens — what a screen actually renders with. */
export const useTheme = (): Tokens => useThemeState().tokens;
/** The choice and its setters — what the top-right toggle needs (R-nav-11). */
export const useThemeChoice = (): Omit<ThemeState, 'tokens'> => {
  const { theme, setTheme, toggleTheme } = useThemeState();
  return { theme, setTheme, toggleTheme };
};
