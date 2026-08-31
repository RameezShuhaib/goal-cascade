/**
 * PWA boot. Imported once from `main.tsx` for its side effects only — it renders nothing and exports nothing:
 *
 *   import './pwa/boot';
 *
 * Order matters, which is why this is a module import at the top of `main.tsx` and not an effect in a
 * component. Both of the first two steps race the browser:
 *
 *  1. `beforeinstallprompt` fires shortly after load and is unrecoverable if nobody called `preventDefault()`
 *     on it; by the time a component has mounted and run an effect it can already be gone.
 *  2. Registration is last: it is the only step that does not race anything.
 *
 * ⚠ **A2** — the deep-link capture that used to be step 2 is **deleted with `pwa/deepLink.ts`**. There is a
 * router now (R-nav-24), so a link IS the location: nothing has to read it off the initial URL before the
 * first render, and nothing has to park it in `sessionStorage` across the sign-in round trip. The Worker
 * already serves `index.html` for unknown paths, so an installed PWA deep-links by doing nothing at all.
 */
import { registerSW } from 'virtual:pwa-register';
import { captureInstallPrompt } from './installState';
import { showUpdateToast } from './updateToast';

captureInstallPrompt(window);

if ('serviceWorker' in navigator) {
  registerSW({
    // Register now rather than on `load`. The shell is precached either way, and waiting for `load` on a slow
    // connection is exactly when a first-time visitor is most likely to leave before the worker exists.
    immediate: true,
    // `registerType: 'autoUpdate'` would reload the page itself the moment a new worker takes control. We
    // intercept that and ask instead — see `updateToast.ts` for why an unannounced reload is a data-loss bug.
    onNeedReload: () => showUpdateToast(() => window.location.reload()),
  });
}
