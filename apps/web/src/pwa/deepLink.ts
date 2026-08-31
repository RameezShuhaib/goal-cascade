/**
 * Deep links. The app has no router (R-nav: five fixed tabs, screen and overlay are state, the URL is synced
 * one way), so a link is not a route — it is an instruction handed to whatever owns the screen state:
 *
 *   `/?tab=goals`               → the Goals tab
 *   `/?tab=goals&goal=<id>`     → a goal detail screen
 *   `/?tab=backlog`             → the Backlog page (which has no tab of its own — R-nav-2)
 *
 * This module is deliberately decoupled from the UI store: it holds a link and hands it over, and knows
 * nothing about how a screen is shown. The consumer (`store.tsx` / a `useUrlSync` hook, the web agent's file)
 * calls `onDeepLink` or `consumePendingDeepLink` when it mounts.
 *
 * A link is held in `sessionStorage` until something consumes it, so a link opened while signed out survives
 * the sign-in round trip — the auth gate runs off `/me`, not the URL, and it will remount the tree underneath
 * whatever was pending.
 */
export type DeepLinkTab = 'tasks' | 'goals' | 'learnings' | 'backlog' | 'plan';
export type DeepLink = { kind: 'tab'; tab: DeepLinkTab } | { kind: 'goal'; goalId: string };

const STORAGE_KEY = 'goal-cascade.deeplink';
const TABS: readonly DeepLinkTab[] = ['tasks', 'goals', 'learnings', 'backlog', 'plan'];

/**
 * Ids come off the URL, so they are attacker-supplied. Constrain the shape here rather than trusting whatever
 * renders them: a link is only worth honouring if it could plausibly name one of our own entities.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Query params the deep-link shapes use; the URL shim strips these after applying a link. */
export const DEEP_LINK_PARAMS = ['tab', 'goal'] as const;

/** Accepts a `?query`, a bare query, a path with a query, or an absolute URL with one. */
export function parseDeepLink(input: string | null | undefined): DeepLink | null {
  if (!input) return null;
  let search = input;
  const q = input.indexOf('?');
  if (q >= 0) search = input.slice(q + 1);
  // No `?` at all: a bare path or absolute URL carries no link, but a bare `tab=goals` does.
  else if (/^[a-z]+:\/\//i.test(input) || input.startsWith('/')) return null;
  const params = new URLSearchParams(search);
  const goal = params.get('goal');
  if (goal && ID_PATTERN.test(goal)) return { kind: 'goal', goalId: goal };
  const tab = params.get('tab');
  if (tab && (TABS as readonly string[]).includes(tab)) return { kind: 'tab', tab: tab as DeepLinkTab };
  return null;
}

type Listener = (link: DeepLink) => void;
const listeners = new Set<Listener>();
let pending: DeepLink | null = readStored();

function readStored(): DeepLink | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    // Round-trip through the parser instead of trusting the stored JSON: `sessionStorage` is same-origin
    // writable, and a stale blob from an older build may not match today's shape.
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<DeepLink>;
    if (v && v.kind === 'goal' && typeof v.goalId === 'string' && ID_PATTERN.test(v.goalId)) return { kind: 'goal', goalId: v.goalId };
    if (v && v.kind === 'tab' && typeof v.tab === 'string' && (TABS as readonly string[]).includes(v.tab)) return { kind: 'tab', tab: v.tab };
    return null;
  } catch {
    return null;
  }
}

function writeStored(link: DeepLink | null) {
  try {
    if (link) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(link));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode: the link just does not survive a reload */
  }
}

/** Hold a link. If a consumer is already listening it is delivered (and cleared) immediately. */
export function setPendingDeepLink(link: DeepLink | null): void {
  pending = link;
  writeStored(link);
  if (link && listeners.size) {
    pending = null;
    writeStored(null);
    for (const l of listeners) l(link);
  }
}

export function peekPendingDeepLink(): DeepLink | null {
  return pending;
}

/** Take the held link (if any) and clear it. */
export function consumePendingDeepLink(): DeepLink | null {
  const link = pending;
  pending = null;
  writeStored(null);
  return link;
}

/**
 * Subscribe to links. A link already held is delivered synchronously on subscribe, then every later one as it
 * arrives. Returns the unsubscribe function.
 */
export function onDeepLink(listener: Listener): () => void {
  listeners.add(listener);
  const held = consumePendingDeepLink();
  if (held) listener(held);
  return () => {
    listeners.delete(listener);
  };
}

/** Boot: read the page URL. Returns the link (also held as pending). */
export function captureDeepLink(location: { search: string }): DeepLink | null {
  const link = parseDeepLink(location.search);
  if (link) setPendingDeepLink(link);
  return link;
}

/** Test hook. */
export function resetDeepLinks(): void {
  pending = null;
  listeners.clear();
  writeStored(null);
}
