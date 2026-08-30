/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { colors } from '../../src/ui';
import { ICONS, MANIFEST_BACKGROUND_COLOR, MANIFEST_DARK_THEME_COLOR, MANIFEST_THEME_COLOR, manifest } from '../../src/pwa/manifest';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC = join(WEB, 'public');

describe('web app manifest', () => {
  /**
   * The install colours exist in three places that no compiler connects: `src/ui.ts` (the app's palette),
   * `src/pwa/manifest.ts` (the installed splash and status bar), and `index.html` (first paint, before React).
   * A comment saying "keep these in sync" is not a mechanism; this test is. If it fails, the palette moved and
   * the manifest and HTML have to move with it — a splash screen that flashes the old colour is exactly the
   * kind of bug nobody files.
   */
  it('keeps the manifest and index.html colours in sync with the src/ui.ts palette', () => {
    expect(MANIFEST_THEME_COLOR).toBe(colors.paper);
    expect(MANIFEST_BACKGROUND_COLOR).toBe(colors.paper);
    expect(MANIFEST_DARK_THEME_COLOR).toBe(colors.ink);
    expect(manifest).toMatchObject({
      name: 'Goal Cascade',
      short_name: 'Cascade',
      display: 'standalone',
      start_url: '/',
      scope: '/',
      theme_color: colors.paper,
      background_color: colors.paper,
    });

    const html = readFileSync(join(WEB, 'index.html'), 'utf8');
    expect(html).toContain(`name="theme-color" content="${MANIFEST_THEME_COLOR}"`);
    expect(html).toContain(`name="theme-color" content="${MANIFEST_DARK_THEME_COLOR}"`);
    // The pre-React page colour, which is what the user actually stares at during a cold start.
    expect(html).toContain(`background: ${colors.paper}`);
  });

  it('ships 192 + 512 any icons and a distinct 512 maskable icon, all real PNGs of the declared size', () => {
    // `purpose: 'any maskable'` on one file is the classic mistake: Android then masks an icon drawn for an
    // unmasked tile and crops the glyph. The maskable variant is a separate, full-bleed image.
    expect(manifest.icons.map((i) => `${i.sizes}:${i.purpose}`)).toEqual(['192x192:any', '512x512:any', '512x512:maskable']);

    for (const src of Object.values(ICONS)) {
      const file = join(PUBLIC, src);
      expect(existsSync(file), `${src} is missing — run \`npm run icons\``).toBe(true);
      const bytes = readFileSync(file);
      // PNG signature, then IHDR's width/height at a fixed offset. Catches a truncated or placeholder file.
      expect(Array.from(bytes.subarray(0, 8)), src).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const declared = Number(/-(\d+)\.png$/.exec(src)?.[1]);
      expect(bytes.readUInt32BE(16), `${src} width`).toBe(declared);
      expect(bytes.readUInt32BE(20), `${src} height`).toBe(declared);
    }
  });

  it('index.html carries the install metas, the icons, viewport-fit=cover and the safe-area insets', () => {
    const html = readFileSync(join(WEB, 'index.html'), 'utf8');
    expect(html).toContain('viewport-fit=cover');
    // vite-plugin-pwa injects the manifest link at build time and does not dedupe: a hand-written one here
    // lands a second `<link rel="manifest">` in dist/index.html.
    expect(html).not.toContain('rel="manifest"');
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="apple-mobile-web-app-status-bar-style"');
    expect(html).toContain(`rel="apple-touch-icon" href="${ICONS.apple180}"`);
    expect(html).toContain(ICONS.favicon32);
    expect(html).toContain('env(safe-area-inset-top');
    expect(html).toContain('--safe-bottom');
  });

  it('self-hosts both fonts and reaches no third-party origin from the HTML', () => {
    const html = readFileSync(join(WEB, 'index.html'), 'utf8');
    // The CSP in `public/_headers` is `default-src 'self'` with no font hosts. If a Google Fonts link ever
    // comes back into the head, the fonts will not load in production at all — they will be blocked, and the
    // app will quietly render in the system font. Fail here instead.
    expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    expect(html).not.toMatch(/https?:\/\//);
    for (const font of ['manrope-latin.woff2', 'manrope-latin-ext.woff2', 'newsreader-italic-latin.woff2', 'newsreader-italic-latin-ext.woff2']) {
      expect(html, `@font-face src for ${font}`).toContain(`/fonts/${font}`);
      const file = join(PUBLIC, 'fonts', font);
      expect(existsSync(file), `${font} is missing from public/fonts`).toBe(true);
      // woff2 magic number, 'wOF2'.
      expect(readFileSync(file).subarray(0, 4).toString('ascii'), font).toBe('wOF2');
    }
  });
});
