/**
 * Install-prompt capture. `beforeinstallprompt` fires once, early, and is gone if nobody called
 * `preventDefault()` on it — which is why capture happens in `pwa/boot.ts` at module load and not in a
 * component effect.
 *
 * ⚠ **The store half of this module is deleted.** It shipped a full `useSyncExternalStore` —
 * `useInstallState`, `canPromptInstall`, `resetInstallPrompt`, `getSnapshot`, `subscribe`, a memoised
 * snapshot and a subscriber set — and `docs/work/02-pwa/build.md` said it was *"available if an 'Add to
 * Home Screen' affordance is added"*. None was, in four subsequent work packages, and with no subscriber
 * the notify loop iterated a permanently empty set on every event. `detectPlatform` and the `Platform`
 * type went with it: their only reader was that snapshot.
 *
 * **Two things stay, and neither is dead code kept warm.** `captureInstallPrompt` has a caller
 * (`pwa/boot.ts`) and a deadline — the event arrives shortly after load and is unrecoverable once
 * discarded, so the listener must exist before any affordance does. `promptInstall` stays because it is
 * the only reader of what that listener saved: delete it and the capture becomes a `preventDefault()`
 * that files the event somewhere nothing can reach, which is worse than either keeping it or dropping
 * the whole module. iOS never fires the event at all, so an iOS affordance would be instructions rather
 * than a button — that is a UI decision to make when the affordance is written, not a platform probe to
 * keep running until then.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

/**
 * Must run at boot, before the browser fires the event (shortly after load). Called from `pwa/boot.ts`.
 * Safe to call more than once per window — `addEventListener` dedupes by function reference.
 */
export function captureInstallPrompt(win: Pick<Window, 'addEventListener'> = window): void {
  win.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  win.addEventListener('appinstalled', onAppInstalled);
}

function onBeforeInstallPrompt(e: Event) {
  // Without this the browser shows its own mini-infobar and the event is not replayable.
  e.preventDefault();
  deferredPrompt = e as BeforeInstallPromptEvent;
}

function onAppInstalled() {
  deferredPrompt = null;
}

/** Replay the captured prompt. The one reader of `deferredPrompt`, and what an affordance would call. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const p = deferredPrompt;
  if (!p) return 'unavailable';
  // A captured event is single-use: clear it before prompting, or a second tap throws.
  deferredPrompt = null;
  try {
    await p.prompt();
    const { outcome } = await p.userChoice;
    return outcome;
  } catch {
    return 'dismissed';
  }
}
