/**
 * Web app manifest, as a TS module rather than a JSON file so that exactly one place in the repo owns the
 * install colours: `vite.config.ts` imports `manifest` from here, `index.html`'s `<meta name="theme-color">`
 * carries the same literals, and `tests/pwa/manifest.test.ts` fails if either drifts from `src/ui.ts`.
 *
 * Two constraints on this file:
 *  1. **No React or DOM imports.** Vite loads it in Node while building the config; a `CSSProperties` import
 *     (or anything that reaches one, e.g. `src/ui.ts`) is fine at type level but a trap the moment someone
 *     adds a value import. Keep the colours as literals here and let the test do the syncing.
 *  2. **The literals are duplicated on purpose.** A comment naming the token is documentation; the test in
 *     `tests/pwa/manifest.test.ts` is the mechanism. If you change a colour in `src/ui.ts`, that test tells
 *     you to change it here too.
 */

/** `colors.paper` in `src/ui.ts` — the page background, so the splash screen and status bar match first paint. */
export const MANIFEST_THEME_COLOR = '#f6f6f3';
/** `colors.paper` — the splash background behind the icon. */
export const MANIFEST_BACKGROUND_COLOR = '#f6f6f3';
/**
 * `colors.ink` — the dark-theme paper (R-nav-12: a real token set, not a filter). `src/ui.ts` is light-only
 * today; the dark palette inverts paper and ink, so the darkest existing token is the honest dark background.
 * Used by `index.html`'s `prefers-color-scheme: dark` `theme-color` variant, not by the manifest itself —
 * the manifest has one colour, and an installed app's splash should match the light default.
 */
export const MANIFEST_DARK_THEME_COLOR = '#1c1c19';

export const ICONS = {
  any192: '/icons/icon-192.png',
  any512: '/icons/icon-512.png',
  maskable512: '/icons/maskable-512.png',
  apple180: '/icons/apple-touch-icon-180.png',
  favicon32: '/icons/favicon-32.png',
} as const;

export const manifest = {
  id: '/',
  name: 'Goal Cascade',
  short_name: 'Cascade',
  description: 'Life goals, cascaded down to what you are actually doing this week.',
  start_url: '/',
  scope: '/',
  display: 'standalone' as const,
  orientation: 'portrait' as const,
  theme_color: MANIFEST_THEME_COLOR,
  background_color: MANIFEST_BACKGROUND_COLOR,
  categories: ['productivity', 'lifestyle'],
  icons: [
    { src: ICONS.any192, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: ICONS.any512, sizes: '512x512', type: 'image/png', purpose: 'any' },
    // Separate `maskable` entry, never `purpose: 'any maskable'`: one image cannot satisfy both, and Android
    // will happily letterbox the `any` icon inside its mask if you let it.
    { src: ICONS.maskable512, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
