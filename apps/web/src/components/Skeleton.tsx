import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useSkin } from '../skin';

/**
 * **R-nav-30 — loading is a skeleton, and only when the identity is cold.**
 *
 * `states.tsx` argued against skeletons in as many words: *"A skeleton that shimmers would be louder than
 * anything else in this product."* That argument is right about **shimmer** and wrong about **skeletons**,
 * and this module agrees with both halves.
 *
 * ── The three principles (UX-PLAN §3.1) ───────────────────────────────────────
 *
 * **P1 — no motion, ever.** No shimmer, no pulse, no gradient sweep, no fade-in. Static blocks on the card
 * the content will occupy. This keeps the app's zero-animation property, so `prefers-reduced-motion` has
 * nothing to honour here rather than needing a second design. **Nothing in this file may declare
 * `animation`, `transition` or `@keyframes`**, and `tests/screens/skeletons.test.tsx` asserts it of the
 * rendered DOM rather than trusting this sentence.
 *
 * **P2 — a skeleton stands in for content, never for a control.** A grey lozenge shaped like a button is
 * an affordance that does nothing, and someone will tap it. `+ Task`, `Edit`, `Move…`, `Delete`, the
 * checkbox and every form field render when their data lands and not before. Their absence is honest; a
 * fake is not. **No skeleton in this file contains a focusable node**, which is also what makes the tab
 * order across a load→loaded transition *empty, then the real controls* rather than *fake, then real*.
 *
 * **P3 — anything the client already knows renders for real.** The `Goals` crumb is a constant; the task
 * page's back control is computed from `location.state.from`; the top-right cluster needs no data. Those
 * are rendered by the screens themselves, above this — which is why every skeleton here is a **body**, not
 * a page.
 *
 * ── Colour, deliberately ──────────────────────────────────────────────────────
 *
 * Bars are **`T.line`** — the existing card-border token, no new colour. UX-PLAN §3.3 specified
 * `T.lineSoft`; measured against the four grounds a bar actually lands on, that token all but disappears on
 * two of them — `#f0f0eb` on light `paper` `#f6f6f3` is **1.06:1**, and `#2a2a26` on dark `card` `#242420`
 * is **1.08:1** — and a skeleton you cannot see is not a skeleton. `T.line` reads on all four:
 * **1.15** (light paper), **1.24** (light card), **1.35** (dark paper), **1.23** (dark card).
 *
 * A bar **carries no text**, so `tests/screens/contrast.test.ts`'s 4.5:1 rule is not engaged — that rule is
 * about legibility of type, and there is no type here. It is `aria-hidden` too, so it is not information
 * that a low-contrast rendering could withhold: everything a skeleton *says* is said by the one visually
 * hidden `role="status"` line, which is ordinary `T.mut` text on the ground it sits on.
 */

/**
 * **R4 — the grace window.** A skeleton does not mount for the first 150 ms; inside that window the content
 * area is empty. If the data lands at 90 ms nothing grey is ever painted and the user sees one repaint.
 * 150 ms is the conventional boundary below which a change reads as instantaneous.
 */
export const SKELETON_GRACE_MS = 150;

/**
 * **R5 — the minimum duration.** Once mounted a skeleton stays at least 400 ms, even if the data landed at
 * 160 ms: past ~400 ms the eye has fixated the new element, so removing it reads as a state ending rather
 * than as a flicker. Worst case for a fast-but-not-instant read is 150 + 400 = 550 ms.
 *
 * ⚠ **The minimum can never delay content that is already available.** It is armed by the *mount*, not by
 * the request: a cache hit never sets `pending`, so no skeleton mounts, so there is nothing to hold open.
 * The only thing this can ever extend is grey that a person has already seen.
 */
export const SKELETON_MIN_MS = 400;

/**
 * Whether the skeleton is on screen, given a query's **cold** flag.
 *
 * `pending` must be React Query's `isPending` and **never** `isFetching` — that distinction is the whole of
 * R2 and R7. `isPending` is true only when this exact query key has no data at all; a cache hit, a
 * background revalidation, a window-focus refetch, a mutation invalidation and a retry all leave it false,
 * so none of them can replace visible content with grey. R1 is React Query's own: a new identity is a new
 * key, and without `placeholderData` the previous period's list is discarded in the same frame.
 *
 * `failed` supersedes both windows (R6). A read that fails during the grace or the minimum drops the
 * skeleton immediately so `LoadError` can take the space — the minimum duration never delays bad news.
 */
export function useSkeleton(pending: boolean, failed: unknown = null): boolean {
  const [shown, setShown] = useState(false);
  /** `Date.now()` at the moment the skeleton was painted; `0` while none is. */
  const shownAt = useRef(0);

  useEffect(() => {
    if (failed) {
      if (shown) {
        shownAt.current = 0;
        setShown(false);
      }
      return;
    }

    if (pending) {
      if (shown) return; // already up; the minimum is measured from `shownAt`.
      const grace = setTimeout(() => {
        shownAt.current = Date.now();
        setShown(true);
      }, SKELETON_GRACE_MS);
      return () => clearTimeout(grace);
    }

    // The data is here. If nothing grey was ever painted this is a plain repaint — the cache-hit case, and
    // the fast-read case that never got past the grace window.
    if (!shown) return;
    const remaining = SKELETON_MIN_MS - (Date.now() - shownAt.current);
    if (remaining <= 0) {
      shownAt.current = 0;
      setShown(false);
      return;
    }
    const hold = setTimeout(() => {
      shownAt.current = 0;
      setShown(false);
    }, remaining);
    return () => clearTimeout(hold);
  }, [pending, failed, shown]);

  return shown;
}

/**
 * The wrapper every skeleton body is inside.
 *
 * **What a screen reader hears while loading:** one polite announcement of `label` — the string the retired
 * `Loading` component used on that screen, verbatim (`Loading this goal…`, `Loading this task…`,
 * `Loading…`), and nothing else. **When the content arrives:** the skeleton unmounts and the real screen
 * renders; on the task page the route change moves focus to the `<h1>`, and on the lens the existing
 * `aria-live` region reads the period and its counts.
 *
 * The bars themselves are `aria-hidden="true"` in their entirety, so the skeleton is never announced *as
 * content* — a screen reader cannot mistake a grey block for a goal title, and there is nothing in it to
 * tab to. `aria-busy` marks the region as still filling.
 */
export function SkeletonFrame({ label, kind, children }: { label: string; kind: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" data-skeleton={kind}>
      <span style={HIDDEN}>{label}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

/** The app's existing visually-hidden recipe (`Toast`, `ReorderableList`, the lens live region). */
const HIDDEN: CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' };

/**
 * One text run's place: a bar of `width` sitting in the line box of a `size`px run.
 *
 * The bar is ~0.85× the type size (13 for 15.5/700, 11 for 12.5, 17 for 21/800 — UX-PLAN §3.3) and the row
 * it sits in carries the run's own `fontSize`, so the line's height comes from the same place the real
 * line's does rather than from a magic number.
 */
function Bar({ size, width, mt = 0 }: { size: number; width: string; mt?: number }) {
  const S = useSkin();
  return (
    <div style={{ fontSize: size, display: 'flex', alignItems: 'center', marginTop: mt }}>
      <span style={{ display: 'block', width, height: Math.round(size * 0.85), borderRadius: 6, background: S.T.line }} />
      {/* A zero-width space, so the row's height is the FONT's line box and not the bar's — which is what
          makes "nothing jumps" a construction rather than a coincidence. */}
      <span style={{ width: 0, overflow: 'hidden' }}>{'\u200b'}</span>
    </div>
  );
}

/** The pulse dot's place. Same 8px circle `S.dot` renders, in the token a skeleton may use. */
function Dot() {
  const S = useSkin();
  return <span style={{ display: 'inline-block', width: 8, height: 8, minWidth: 8, borderRadius: '50%', background: S.T.line }} />;
}

/**
 * **The lens list.** Three cards, always, and no group headers.
 *
 * The honest promise is *the top of the list does not jump*: the first card's frame, position, padding and
 * line metrics are the real first card's, so the eye's anchor is fixed. Below that, growth is expected —
 * a skeleton cannot know it is standing in for twelve cards, and guessing produces a second lie. Group
 * headers are omitted for the same reason (R-lens-19 suppresses the header when there is one group, and we
 * do not yet know how many there are).
 *
 * The widths vary (62 %, 48 %, 71 %) and the third card has no second line, so the block does not read as a
 * machine pattern or as a fixed grid.
 */
export function LensListSkeleton() {
  const S = useSkin();
  const cards: Array<[string, string | null]> = [
    ['62%', '41%'],
    ['48%', '68%'],
    ['71%', null],
  ];
  return (
    <SkeletonFrame kind="lens" label="Loading…">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
        {cards.map(([title, second], i) => (
          <div key={i} style={{ ...S.card, padding: '14px 16px' }} data-testid="lens-card-skeleton">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <Dot />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Bar size={15.5} width={title} />
              </div>
            </div>
            {second && (
              <div style={{ paddingLeft: 16 }}>
                <Bar size={12.5} width={second} mt={3} />
              </div>
            )}
          </div>
        ))}
      </div>
    </SkeletonFrame>
  );
}

/**
 * **The goal page.** The trail's parent crumb, the title, the horizon chip's place and one `why` line, then
 * two generic card rows.
 *
 * **No section labels.** `Sub-goals`, `Backlog` and `From the backlog` each render conditionally on the
 * goal's horizon, which is the very thing not yet known (R-goal-48, R-backlog-2/11/12/28). Printing a
 * heading and taking it away is the flicker skeletons exist to prevent, so two generic rows stand in for
 * whatever the first section turns out to be.
 *
 * `Goals` and the top-right cluster are **not** here: `GoalDetailScreen` renders them for real, above this,
 * because it knows them before the read starts (P3).
 */
export function GoalPageSkeleton() {
  const S = useSkin();
  return (
    <SkeletonFrame kind="goal" label="Loading this goal…">
      {/* The trail's second segment — `Goals /` is real and rendered by the screen. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 36 }}>
        <Bar size={12.5} width="46%" />
      </div>
      {/* The `<h1>` at 23/800, and the horizon chip's place beside it. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Bar size={23} width="78%" />
        </div>
        <span style={{ ...S.hChip(), background: S.T.line, color: 'transparent', width: 62 }} />
      </div>
      {/* The `why` line, 17px serif. */}
      <Bar size={17} width="58%" mt={3} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 20 }}>
        {['52%', '69%'].map((w) => (
          <div key={w} style={{ ...S.card, borderRadius: 12, padding: '12px 14px', minHeight: 48, display: 'flex', alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Bar size={14.5} width={w} />
            </div>
          </div>
        ))}
      </div>
    </SkeletonFrame>
  );
}

/**
 * **The task page.** The title, then the two-segment context line's places, and nothing below the fold.
 *
 * The rest of the task page is a form, and a form made of grey boxes invites a tap into a field that is not
 * there (P2). There is **no checkbox**: `task.completable` is unknown (R-task-44/50), and a checkbox that
 * appears late beside a title is the one control on this page you must not guess at.
 *
 * The back control is real whenever the page was reached from a lens — `backLabel` comes from
 * `location.state.from` and needs no read — and `TaskPage` renders it above this.
 */
export function TaskPageSkeleton() {
  return (
    <SkeletonFrame kind="task" label="Loading this task…">
      <div style={{ marginTop: 8 }}>
        <Bar size={21} width="74%" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <div style={{ width: '34%' }}>
            <Bar size={12.5} width="100%" />
          </div>
          <div style={{ width: '30%' }}>
            <Bar size={12.5} width="100%" />
          </div>
        </div>
      </div>
    </SkeletonFrame>
  );
}
