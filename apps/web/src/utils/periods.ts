import { useEffect } from 'react';
import { usePreferences } from '../api/queries';
import { setOwnerTimezone, useOwnerClock, type OwnerClockState } from '../lib/ownerClock';

/**
 * The owner's calendar day, and nothing else.
 *
 * ── What used to be here, and why it is gone ───────────────────────────────────
 * `defaultPeriod(horizon, today)` pre-filled the create form's free-text `TARGET PERIOD` field. Both
 * halves of that are retired: `period` is **[srv]**, the rendered label of a canonical `periodKey`
 * (R-goal-33), and there is no period field on the create sheet at all any more. The old field is what let
 * you type `Q9 3026`.
 *
 * ⚠ **R-lens-30** — what survives is no longer a one-shot `todayInZone(prefs?.timezone)` read. Today is an
 * external store (`lib/ownerClock`) because the app is an installed PWA that can sit open across a
 * midnight, and a value read once at mount would keep offering `+ Weekly goal` on a week that became past
 * while the tab was in the background. This module is the seam that pushes the STORED timezone into that
 * store — the only place the two meet.
 */

/**
 * Subscribe the owner clock to `preferences.timezone`. Mounted once, high in the tree.
 *
 * `null` while preferences are unknown, which is deliberate and is not the same as `'UTC'`: the store
 * falls back to `'UTC'` for the arithmetic (matching the server middleware) while reporting `tz: null`, so
 * a caller can tell "we do not know yet" from "the owner is in UTC" and suppress a badge rather than guess
 * at one.
 */
export function useOwnerTimezoneSync(): void {
  const prefs = usePreferences();
  const tz = prefs.data?.preferences.timezone ?? null;
  useEffect(() => setOwnerTimezone(tz), [tz]);
}

/** Today as the owner's account sees it: the server's clock in the stored timezone (R-auth-5). */
export function useOwnerToday(): string {
  return useOwnerClock().today;
}

/** Today, plus whether the timezone behind it is actually known yet. */
export function useOwnerClockState(): OwnerClockState {
  return useOwnerClock();
}
