import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { manifest } from './src/pwa/manifest';

// The SPA and the API share one origin in production (one Worker serves both), so the client uses relative
// `/api/*` URLs. In dev, proxy those to `wrangler dev`.
const apiProxy = process.env.VITE_API_PROXY ?? 'http://localhost:8787';

export default defineConfig({
  // Root-absolute asset URLs (`/assets/…`): the Worker serves index.html for every unknown path (SPA
  // fallback), so a relative `./assets/…` would resolve against `/some/deep/route/` and 404.
  base: '/',
  plugins: [
    react(),
    // Custom service worker `src/sw.ts` with the Workbox precache manifest injected into it. `autoUpdate`
    // takes control immediately, but we register the worker ourselves in `src/pwa/boot.ts` so the reload is
    // a user's decision — hence `injectRegister: null`.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: null,
      manifest,
      manifestFilename: 'manifest.webmanifest',
      // The icons are already matched by the `png` glob below. Left on (the default), this adds them to the
      // precache list a second time — same url, same revision, twice the entries.
      includeManifestIcons: false,
      injectManifest: {
        // `woff2` matters here: the fonts are self-hosted (see `public/_headers`), so precaching them is what
        // makes an offline open render in Manrope instead of falling back to the system font mid-session.
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // The service worker is built as its own bundle, and vite-plugin-pwa is hoisted to the workspace
        // root — so it resolves the ROOT's vite (8.x, rolldown) while the app below builds with this
        // package's vite 5. Without an explicit target that second bundle inherits vite's default browser
        // list, which includes safari14, and esbuild refuses to down-transform Workbox's destructuring to
        // it ("Transforming destructuring to the configured target environment is not supported yet") —
        // 40 errors, no `dist`, no deploy. Service workers only ever run in browsers that already support
        // all of this, so targeting them directly is correct rather than a workaround.
        target: 'es2022',
      },
      devOptions: { enabled: false },
      // Vitest loads this config too; building a service worker has nothing to do there, and the
      // `injectManifest` build fails outright without a `dist`.
      disable: !!process.env.VITEST,
    }),
  ],
  server: {
    proxy: {
      // `changeOrigin: false` is deliberate. Rewriting the Host header would make the API's session cookie a
      // third-party cookie in dev, so it would be dropped by the browser and auth would work in production
      // and nowhere else. Keeping the origin keeps the cookie first-party, which is what ships.
      '/api': { target: apiProxy, changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    css: false,
  },
});
