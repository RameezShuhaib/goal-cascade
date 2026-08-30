import { useSyncExternalStore } from 'react';

/**
 * Install state. `beforeinstallprompt` fires once, early, and is gone if nobody called `preventDefault()` on
 * it — which is why capture happens in `pwa/boot.ts` at module load and not in a component effect. What is
 * captured here is what any "Add to Home Screen" affordance later replays.
 *
 * iOS never fires the event at all (Safari has no programmatic install), so a prompt on iOS has to be
 * instructions, not a button — hence `isIOS` and `isStandalone` alongside `canPrompt`.
 */
export interface Platform {
  isIOS: boolean;
  isStandalone: boolean;
}

export interface InstallState extends Platform {
  /** A `beforeinstallprompt` event was captured and can be replayed via `promptInstall()`. */
  canPrompt: boolean;
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type NavLike = Partial<Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>> & { standalone?: boolean };
type WinLike = { matchMedia?: (q: string) => { matches: boolean } };

export function detectPlatform(nav: NavLike = navigator, win: WinLike = window as unknown as WinLike): Platform {
  const ua = nav.userAgent ?? '';
  // iPadOS 13+ reports a Mac UA; the touch points give it away.
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1);
  let displayStandalone = false;
  try {
    displayStandalone = win.matchMedia?.('(display-mode: standalone)').matches ?? false;
  } catch {
    displayStandalone = false;
  }
  // `navigator.standalone` is the iOS-only signal; `display-mode` is everyone else's.
  const isStandalone = nav.standalone === true || displayStandalone;
  return { isIOS, isStandalone };
}

// ---- beforeinstallprompt capture (module store) -------------------------------

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
let version = 0;
const subscribers = new Set<() => void>();
const notify = () => {
  version++;
  for (const s of subscribers) s();
};

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
  notify();
}
function onAppInstalled() {
  deferredPrompt = null;
  installed = true;
  notify();
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const p = deferredPrompt;
  if (!p) return 'unavailable';
  // A captured event is single-use: clear it before prompting, or a second tap throws.
  deferredPrompt = null;
  notify();
  try {
    await p.prompt();
    const { outcome } = await p.userChoice;
    return outcome;
  } catch {
    return 'dismissed';
  }
}

export function canPromptInstall(): boolean {
  return deferredPrompt !== null;
}

/** Test hook. */
export function resetInstallPrompt(): void {
  deferredPrompt = null;
  installed = false;
  notify();
}

const subscribe = (cb: () => void) => {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
};

// `useSyncExternalStore` calls the getter on every render and compares by identity, so the snapshot must be
// memoised on a version counter — returning a fresh object each time is an infinite render loop.
let snapshot: { version: number; state: InstallState } | null = null;
function getSnapshot(): InstallState {
  if (snapshot && snapshot.version === version) return snapshot.state;
  const platform = detectPlatform();
  const state: InstallState = {
    ...platform,
    isStandalone: platform.isStandalone || installed,
    canPrompt: deferredPrompt !== null,
    promptInstall,
  };
  snapshot = { version, state };
  return state;
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
