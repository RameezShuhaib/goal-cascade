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
 *  2. The deep link is read off the *initial* URL. The UI shim strips those params once it applies a link, so
 *     whatever reads them has to run before the first render, not after.
 *  3. Registration is last: it is the only step that does not race anything.
 */
import { registerSW } from 'virtual:pwa-register';
import { captureDeepLink } from './deepLink';
import { captureInstallPrompt } from './installState';
import { showUpdateToast } from './updateToast';

captureInstallPrompt(window);
captureDeepLink(window.location);

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
