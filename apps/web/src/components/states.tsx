import type { ReactNode } from 'react';
import { useSkin } from '../skin';
import { presentError } from '../lib/errorCopy';
import { toApiError } from '../api/errors';

/**
 * Loading, empty and failed — the three states the mockup never had, because an in-memory array is never
 * any of them. A real network is all three, several times a day.
 *
 * They are deliberately quiet and in the existing visual language: the same dashed frame the mockup's
 * empty states use, the same muted type.
 *
 * ⚠ **This file used to end its doc block with *"A skeleton that shimmers would be louder than anything
 * else in this product"*, and that sentence is right about **shimmer** and wrong about **skeletons**
 * (R-nav-30).** `components/Skeleton.tsx` is the loading state of every full screen now — static blocks,
 * no motion of any kind, so the objection this file raised is answered rather than overruled. What
 * survives here is the *accessible* half: `role="status"` and the exact strings, which moved onto the
 * skeleton's wrapper verbatim.
 */

/**
 * A list still waiting on its first read, **inside a sheet**, where a skeleton would be more chrome than
 * the list it replaces.
 *
 * ⚠ **R-nav-30 — retired from every full screen.** `LensScreen`, `GoalDetailScreen`, `TaskPage` and
 * `ZoomSheet` each rendered this; the first three now render a skeleton and the fourth does not load at
 * all (R-lens-30). One line, no spinner, no layout shift worth the name.
 */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  const S = useSkin();
  return (
    <div role="status" style={{ padding: '40px 10px', textAlign: 'center', fontSize: 13.5, color: S.T.mut }}>
      {label}
    </div>
  );
}

/** The mockup's empty state, generalised: a serif line, a muted explanation, and at most one action. */
export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  const S = useSkin();
  return (
    <div style={{ ...S.dashed, padding: '40px 24px', textAlign: 'center' }}>
      <div style={{ ...S.serif, fontSize: 20, color: S.body }}>{title}</div>
      {body && <div style={{ fontSize: 13.5, color: S.T.mut, margin: '8px 0 18px 0' }}>{body}</div>}
      {action}
    </div>
  );
}

/**
 * A read that failed. Inline rather than a toast: a toast is a transient confirmation (R-nav-13) and is
 * never the right home for "this screen has no data and here is why".
 */
export function LoadError({ error, onRetry, what = 'this' }: { error: unknown; onRetry?: () => void; what?: string }) {
  const S = useSkin();
  const message = presentError(toApiError(error)).message ?? `Couldn't load ${what}.`;
  return (
    <div style={{ ...S.dashed, padding: '28px 24px', textAlign: 'center' }} role="alert">
      <div style={{ fontSize: 13.5, color: S.body }}>{message}</div>
      {onRetry && (
        <button type="button" style={{ ...S.menuBtn, marginTop: 12 }} onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * A refusal the SCREEN explains, next to the control that caused it. Every silent `return` in the mockup
 * (a blank title, a horizon clash, a missing parent) is one of these now — the server answers with a
 * machine-readable code and this is where it becomes a sentence (Q-10).
 */
export function FieldError({ children }: { children: ReactNode }) {
  const S = useSkin();
  if (!children) return null;
  return (
    <div role="alert" style={{ fontSize: 12.5, fontWeight: 600, color: S.T.redText, marginTop: 6 }}>
      {children}
    </div>
  );
}

/** The message a command's refusal should show inline, or `null` while nothing has failed. */
export function commandError(error: unknown): string | null {
  if (!error) return null;
  const err = toApiError(error);
  return presentError(err).message ?? null;
}
