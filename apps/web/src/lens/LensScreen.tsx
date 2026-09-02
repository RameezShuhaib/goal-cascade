import { useEffect, useMemo, useRef } from 'react';
import { Outlet, useLocation, useNavigate, useOutletContext } from 'react-router';
import {
  currentPeriodKey,
  firstDayOf,
  HORIZONS,
  stepPeriod,
  zoomTo,
  type GoalView,
  type Horizon,
  type LifeGroupView,
  type TaskView,
} from '@goal-cascade/shared';
import { useUI } from '../context/UIContext';
import { useLens, useRepeatWeek } from '../api/queries';
import { useWeekClock } from '../lib/weekClock';
import { useSkin } from '../skin';
import { TopActions } from '../components/TopActions';
import { Empty, LoadError } from '../components/states';
import { LensListSkeleton, useSkeleton } from '../components/Skeleton';
import { rank, validKeyFor } from '../utils/periodKeys';
import { lensOfSegment, lensPath } from '../routes';
import { assertPeriodAgrees } from './assertPeriodAgrees';
import { useCalendarPeriod, type CalendarPeriod } from './useCalendarPeriod';
import { useNeighbourPrefetch } from './useNeighbourPrefetch';
import { LensRow, OffNowRow, WeekElsewhereRow } from './LensRow';
import { LENS_PANEL_ID, LensTabs, lensTabId } from './LensTabs';
import { CarriedCard, LifeCard, MonthlyCard, PlainCard, WeeklyCard, type LifeRef } from './cards';
import {
  CREATE_LABEL,
  emptyCopy,
  horizonEmptyCopy,
  offNowBadge,
  periodTitle,
  weekElsewhereAction,
  weekElsewhereBadge,
} from './copy';

/**
 * **A lens: a FLAT list of every goal at one horizon in one period.** This is what replaced the goals
 * tree, the Tasks screen and the plan screen (R-lens-1, R-rm-5).
 *
 * ── The chrome budget, which is the first-class constraint ─────────────────────
 * R-nav-27, rewritten: **at most three unconditional rows above the first item** — the top-right cluster
 * (R-nav-25), the **lens tab strip** (R-lens-33) and the period row (R-lens-7). The third row is spent
 * knowingly, and it is paid for: the group header it replaces is gone at every horizon (R-lens-3,
 * deleted), and with it one `+ <Horizon> goal` link row per group. On the owner's own account that is a
 * net removal. Everything else stays conditional and mutually exclusive: the off-now row only off-now
 * (R-lens-21) or the week-elsewhere row only when current (R-lens-29). **A fourth unconditional row is
 * refused, not deferred.**
 *
 * ── ⚠ **The two components, and why the split is load-bearing** ────────────────
 * `LensChrome` is a **layout route** wrapping all five lens routes; `LensScreen` is the body inside its
 * `<Outlet/>`. The tab strip is mounted in the chrome, once, and that is not a refactoring preference —
 * two behaviours depend on it (`29-ux-navigation` §2.12):
 *
 *  1. **Focus survives the lens change.** Activating a tab is a route change. A strip inside the per-lens
 *     component would unmount and remount, dropping focus to `<body>`, so a keyboard user would be thrown
 *     to the top of the document every time they changed lens.
 *  2. **`scrollLeft` survives it**, so the strip does not jump back to 0 and re-scroll on every selection.
 *
 * It matters twice over here, because opening a lens with no period segment (`/quarter`) renders the index
 * route and then canonicalises to `/quarter/2026-Q3` — two child matches for one tap. The layout route is
 * mounted across both.
 *
 * ── ⚠ **R-lens-30 — what the client works out for itself, and what it still does not** ─────────────
 * **The calendar is the client's; the data is the server's.** The period's label, its range, whether it
 * is current or past and which period holds the current week are all `(horizon, periodKey, today)` and
 * are computed here, in the same frame as the input that changed them (`useCalendarPeriod`). The counts,
 * `hasWork`, `hasForwardContent` and `hasAnyAtHorizon` are questions about data and still arrive on the
 * wire.
 */

/** Everything the chrome resolved once, handed to the body rather than derived twice. */
export interface LensContext {
  lens: Horizon;
  period: CalendarPeriod;
  data: LensData | undefined;
  error: Error | null;
  pending: boolean;
  refetch: () => void;
  canCreate: boolean;
  weekOffset: number;
  onStep: (n: -1 | 1) => void;
  onZoom: (n: -1 | 1) => void;
}

interface LensData {
  groups: LifeGroupView[];
  items: GoalView[];
  carried: GoalView[];
  tasks: TaskView[];
  /** R-lens-24 — has this horizon ever held a goal, and does the account have Life goals at all? */
  hasAnyAtHorizon: boolean;
  hasLifeGoals: boolean;
  hasForwardContent: boolean;
}

/**
 * Rows 1–3, the conditional row and the live region — mounted once for all five lenses.
 *
 * It resolves the lens from the pathname rather than from a prop, because a layout route sits above the
 * branch that carries the segment. `LensScreen` reads everything back out of the outlet context, so there
 * is one derivation, one `useLens` call and one query key on the screen.
 */
export function LensChrome() {
  const S = useSkin();
  const ui = useUI();
  const navigate = useNavigate();
  const clock = useWeekClock();
  const { pathname } = useLocation();

  const parts = pathname.split('/');
  const lens = lensOfSegment(parts[1]) ?? 'Weekly';
  const urlPeriod = parts[2] ? decodeURIComponent(parts[2]) : undefined;

  /**
   * ⚠ **R-lens-30 / R-lens-14 — the period is resolved BEFORE the read, not after it.**
   *
   * `/month` used to fetch under `['goals','Monthly',null]`, and an effect rewrote the URL to
   * `/month/2026-09` once the answer landed — a new key, a cache miss, a second request and a second
   * `Loading…`. `currentPeriodKey` is the same `periodKeyOf(horizon, today)` the server would have
   * answered with, so the address is right from the first render.
   *
   * A URL segment is attacker-supplied, so `validKeyFor` drops one that is not canonical for this lens
   * and the current period stands in — R-lens-14's "a deep link that has rotted should land you
   * somewhere real", now answered without a round trip.
   */
  const fromUrl = validKeyFor(lens, urlPeriod);
  const period = lens === 'Life' ? null : (fromUrl ?? currentPeriodKey(lens, clock.today));
  const q = useLens(lens, period ?? undefined);
  const data = q.data;
  const local = useCalendarPeriod(lens, period ?? '');

  /**
   * ⚠ **Anti-drift layer 3** — every lens read is compared against the calendar the client just computed.
   * A shared module cannot drift; a shared module plus a service worker holding a client bundle a week
   * older than the Worker can, and only a runtime comparison catches that.
   */
  assertPeriodAgrees(`LensResponse (${lens})`, lens, data?.period, data?.serverNow, clock.tz);

  // R-lens-30 — ±1 once this period has settled, plus one further in the direction of travel.
  useNeighbourPrefetch(lens, period, q.isSuccess);

  // R-nav-28 — the Goals tab returns to the lens you were last in.
  const { rememberLens, setAnchor } = ui;
  useEffect(() => rememberLens(lens), [lens, rememberLens]);

  /**
   * R-lens-18 — the anchor. It is **derived** from the period on screen rather than held, which is what
   * makes zoom lossless with nothing to keep in step: stepping lands on a period whose anchor is its first
   * day (or today, when today is inside it), and zooming lands on the period containing that same anchor,
   * whose derived anchor is the same date again. `Q3 2026 → Monthly → Quarterly` returns to `Q3 2026`.
   *
   * **Life is not a reset.** Life has no period, so it borrows the last one held — going up to Life and
   * back down returns you where you were, instead of silently destroying your position.
   */
  const anchor = lens === 'Life' ? (ui.anchor ?? clock.today) : local.isCurrent ? clock.today : firstDayOf(lens, local.periodKey);
  useEffect(() => {
    if (lens !== 'Life' && anchor) setAnchor(anchor);
  }, [lens, anchor, setAnchor]);

  /**
   * ⚠ **R-lens-30** — the URL is canonicalised **before** the first fetch, not after the read lands, so
   * `/month` becomes `/month/2026-09` with no request in between and a copied link is still absolute.
   * `replace`, so it is not a back-stack entry of its own.
   */
  useEffect(() => {
    if (lens === 'Life' || !period || urlPeriod === period) return;
    navigate(lensPath(lens, period), { replace: true });
  }, [lens, urlPeriod, period, navigate]);

  const step = (n: -1 | 1) => {
    if (lens === 'Life' || !period) return;
    // No clamp in either direction (R-lens-7, R-rm-3).
    navigate(lensPath(lens, stepPeriod(lens, period, n)));
  };

  /**
   * ⚠ **R-lens-9's clamp, and it is the SAME function the tab strip and the create sheet call.**
   *
   * One rule answers "which period does this horizon mean" for the tabs, for `Shift+↑`/`Shift+↓` and for
   * `New goal`'s horizon selector, so the three can never disagree. It used to navigate to `lensPath(to)`
   * with no period at all, which asked for the CURRENT one and quietly threw the anchor away — the one
   * thing R-lens-18 exists to preserve.
   */
  const goToLens = (to: Horizon) => navigate(lensPath(to, to === 'Life' ? null : zoomTo(to, anchor, clock.today)));
  const zoomOneStep = (n: -1 | 1) => {
    const to = HORIZONS[rank(lens) + n];
    if (to) goToLens(to);
  };

  const failed = q.error;
  /**
   * ⚠ **R-nav-30** — `isPending`, and deliberately **not** `isFetching`. A period already in the cache
   * leaves it false, so stepping Sep → Oct with Oct cached is one repaint and nothing else.
   */
  const pending = q.isPending && !failed;
  /**
   * ⚠ **R-lens-30 — both notices are calendar facts, so they settle in the same frame as the label.**
   * `clockKnown` is what keeps the `'UTC'` fallback from ever being *seen*.
   */
  const offNow = lens !== 'Life' && local.clockKnown && !local.isCurrent;
  // R-goal-36 / R-nav-25 — on a past period the create affordances are **absent, not disabled**.
  const canCreate = !local.isPast;
  const weekOffset = lens === 'Weekly' && period ? clock.offsetOf(period) : 0;

  /**
   * R-lens-29 — the period on screen is the current one **and still does not hold the week you are in**.
   * It occupies R-lens-21's row and never adds one: `offNow` is `!isCurrent` and this is only ever set
   * when `isCurrent`, so the `else` is a fact about the data and not a preference about layout.
   */
  const elsewhere = local.isCurrent ? local.currentWeekPeriod : null;

  const ctx: LensContext = {
    lens,
    period: local,
    data,
    error: failed,
    pending,
    refetch: () => void q.refetch(),
    canCreate,
    weekOffset,
    onStep: step,
    onZoom: zoomOneStep,
  };

  return (
    <div style={S.page} data-screen-label={`${lens} lens`}>
      {/* Row 1 — the cluster (R-nav-25): the theme toggle, the account button, one primary action. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', gap: 10 }}>
        <TopActions>
          {/*
           * ⚠ **R-nav-25, amended — one create action, `+ Goal`, the same string at every lens.**
           *
           * It does not name a horizon any more because it no longer commits to one: the sheet carries a
           * five-chip selector that *defaults* to the lens (R-nav-32). The five horizon-named labels and
           * every per-group `+ <Horizon> goal` are retired — the owner's literal complaint.
           *
           * Its presence depends only on R-goal-36 (the past offers no create affordance), and it does
           * not blink: `local.periodKey` is a calendar fact from the first render.
           */}
          {canCreate && (
            <button
              type="button"
              style={S.topBtn}
              onClick={() => ui.openSheet({ kind: 'goalForm', editId: null, horizon: lens, periodKey: local.periodKey, lens })}
            >
              {CREATE_LABEL}
            </button>
          )}
        </TopActions>
      </div>

      {/*
       * ⚠ **Rows 2 and 3, PINNED AS ONE BLOCK.** The owner overturned `29-ux-navigation` §2.7's
       * recommendation and asked for sticky; the plan's own condition applies and is honoured here —
       * **both rows or neither, never the tabs alone**, because a strip that sticks without its period row
       * lets you change lens but not period from the same place, which splits one header into two
       * behaviours depending on scroll position.
       *
       * One `position: sticky` wrapper, so the two can never separate: there is no arrangement of
       * `scrollTop` in which one is pinned and the other is not.
       *
       *  - **The cost is stated, because it is permanent.** 44px of tabs + a 1px hairline + a 46–51px
       *    period row ≈ **91–96px** held forever on a ~700px phone viewport. That is why rows 1 and 3 are
       *    unchanged in height and the strip is 44px exactly — the plan's type scale, not a pixel more.
       *  - **It does not clip or trap the horizontal scroller.** `overflow` stays `visible` here; the
       *    `overflow-x: auto` lives one level down, inside `LensTabs`, where a sticky ancestor cannot
       *    reach it. (An `overflow` other than `visible` on this element would break `position: sticky`
       *    outright, so the two constraints happen to point the same way.)
       *  - **`background: T.paper`** so cards pass cleanly underneath, and the block is full-bleed
       *    (`marginInline: -16` / `paddingInline: 16`) so the tab strip's hairline runs the full width of
       *    the column rather than floating inside the gutter.
       *  - **`zIndex: 10`** — above card content, below the bottom tab bar's 20 and far below `S.overlay`
       *    (42) and `S.sheet` (43), so a sheet is never fought for the top of the stack.
       *  - **`top: var(--safe-top)`**, published by `index.html`, so an installed PWA on a notched phone
       *    pins below the status bar instead of under it. `#root` already pads the same inset, so the
       *    strip above the pinned block is page colour and nothing scrolls through it.
       */}
      <div
        data-testid="lens-sticky-nav"
        style={{
          position: 'sticky',
          top: 'var(--safe-top, 0px)',
          zIndex: 10,
          background: S.T.paper,
          marginLeft: -16,
          marginRight: -16,
          paddingLeft: 16,
          paddingRight: 16,
        }}
      >
        {/* Row 2 — the lens (R-lens-33). Mounted here, so focus and `scrollLeft` survive a lens change. */}
        <LensTabs lens={lens} onChange={goToLens} />
        {/* Row 3 — the period (R-lens-7). The title is text now, not a button (R-lens-17). */}
        <LensRow
          lens={lens}
          period={local}
          /**
           * R-lens-26 — the forward-content dot answers "is there anything ahead", which is a question
           * about DATA and not about the calendar. It therefore lags the header on an uncached period,
           * and that is correct: it appears when the read lands and moves nothing on screen when it does.
           */
          hasForwardContent={data?.hasForwardContent ?? false}
          onStep={step}
        />
      </div>

      {/*
       * The conditional row — and only conditional (R-lens-21, R-nav-27). **Two occupants, never two
       * rows.** It sits BELOW the pinned block deliberately: it is a notice about the period you are on,
       * not a control, and pinning it would be the fourth unconditional row in all but name.
       */}
      {offNow ? (
        <OffNowRow badge={offNowBadge(lens, local.isPast)} onNow={() => navigate(lensPath(lens))} />
      ) : (
        elsewhere && (
          <WeekElsewhereRow
            badge={weekElsewhereBadge(elsewhere.label)}
            actionLabel={weekElsewhereAction(elsewhere.label)}
            // The destination is the SERVER's key, navigated to explicitly — `lensPath(lens)` with no
            // period would ask for the current one and land straight back here (R-lens-14).
            onGo={() => navigate(lensPath(lens, elsewhere.periodKey))}
          />
        )
      )}

      <Announcement
        lens={lens}
        // R-lens-28 — a screen reader hears the span too, because the range line is `aria-hidden` and the
        // title is no longer a button with a name of its own (§7.3).
        label={lens === 'Life' ? 'Life' : periodTitle(local.label, lens === 'Weekly' ? '' : local.weekRange)}
        elsewhere={elsewhere?.label ?? null}
        data={data}
      />

      <Outlet context={ctx} />
    </div>
  );
}

/**
 * The lens body, and the `role="tabpanel"` the strip's `aria-controls` points at.
 *
 * ⚠ **R-nav-30** — everything above this line is already real (R-lens-30): the cluster, the tabs, the
 * period's name, its range and both notices are calendar facts and settle in the same frame as the input.
 * So the only thing left that can be unknown on this screen is the list — which is exactly the scope
 * `LensListSkeleton` draws, and the reason the skeleton adds no row to R-nav-27's budget: it occupies the
 * space the list will.
 *
 * R-lens-25 — **one gesture in the whole design**, and its keyboard equal. A horizontal swipe steps the
 * period, mirroring the chevrons' direction; `←`/`→` do the same and `Shift+↑`/`Shift+↓` change altitude.
 * Every one of them has a visible control one `Tab` away, so the accessibility floor never depends on a
 * shortcut. **Horizontal inside the tab strip is altitude; horizontal on the body is time** — the two are
 * separated by region, and `data-no-swipe` / `data-h-scroll` on the strip make that a mechanism rather
 * than a convention.
 */
export function LensScreen() {
  const { lens, period, data, error, pending, refetch, canCreate, weekOffset, onStep, onZoom } = useOutletContext<LensContext>();
  const skeleton = useSkeleton(pending, error);
  const start = useRef<{ x: number; y: number } | null>(null);
  const isLife = lens === 'Life';

  const typing = (target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    return !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  };

  return (
    <div
      data-testid="lens-body"
      // R-lens-33 / §7.1 — the panel the tablist controls, named by the selected tab.
      role="tabpanel"
      id={LENS_PANEL_ID}
      aria-labelledby={lensTabId(lens)}
      /**
       * `-1`, so it is script-focusable and never a tab stop: the shortcuts fire from focus anywhere in
       * the body (they bubble from whichever control holds it), and this makes the body itself a legal
       * target too. The app's `:focus-visible` ring deliberately skips `[tabindex="-1"]`.
       */
      tabIndex={-1}
      style={{ outline: 'none' }}
      onKeyDown={(e) => {
        if (typing(e.target)) return;
        if (!isLife && e.key === 'ArrowLeft') return onStep(-1);
        if (!isLife && e.key === 'ArrowRight') return onStep(1);
        if (e.shiftKey && e.key === 'ArrowUp') return onZoom(-1);
        if (e.shiftKey && e.key === 'ArrowDown') return onZoom(1);
      }}
      onTouchStart={(e) => {
        const t = e.touches[0];
        start.current = t ? { x: t.clientX, y: t.clientY } : null;
      }}
      onTouchEnd={(e) => {
        const from = start.current;
        const t = e.changedTouches[0];
        start.current = null;
        if (isLife || !from || !t) return;
        const dx = t.clientX - from.x;
        // Horizontal only, and only when it clearly beat the scroll axis. Suppressed inside anything that
        // scrolls horizontally, so the gesture can never fight a scroller — the tab strip included.
        if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(t.clientY - from.y) * 2) return;
        if ((e.target as HTMLElement).closest('[data-h-scroll]')) return;
        onStep(dx > 0 ? -1 : 1);
      }}
    >
      {skeleton && <LensListSkeleton />}
      {error && <LoadError error={error} what="this lens" onRetry={refetch} />}
      {/*
       * ⚠ `!skeleton`, and it is the whole point: a skeleton that vanished the instant the payload arrived
       * would flash for 40ms on a fast-but-not-instant read. A cache hit never sets `pending`, so no
       * skeleton is ever painted and nothing is ever delayed that was already available.
       */}
      {!skeleton && data && <Body lens={lens} data={data} period={period} canCreate={canCreate} weekOffset={weekOffset} />}
    </div>
  );
}

/**
 * §7.3 — one `aria-live="polite"` region, in the chrome, and one rule that keeps it from talking over
 * itself: **a navigation moves focus; the live region carries only what focus will not say.**
 *
 * A lens change is announced by the activated tab's own `Quarterly, selected`, so this adds only the
 * payload. A period change leaves focus on the chevron, which does not re-read, so this carries the whole
 * thing — including the carried band's count, which a sighted user can see and a screen reader otherwise
 * could not.
 *
 * ⚠ **`in N groups` is deleted, because there are no groups**, and with it the rendered-group counting
 * that existed only to stop the announcement describing the payload instead of the screen.
 */
function Announcement({
  lens,
  label,
  elsewhere,
  data,
}: {
  lens: Horizon;
  label: string;
  /** R-lens-29 — the period holding the current week, when it is not this one. */
  elsewhere: string | null;
  data: { items: GoalView[]; carried: GoalView[] } | undefined;
}) {
  if (!data) return null;
  const carried = data.carried.length;
  const text =
    `${label}. ${data.items.length} goal${data.items.length === 1 ? '' : 's'}` +
    (carried > 0 ? `, ${carried} carried` : '') +
    '.' +
    // R-lens-29 — the flag is a visible row a screen reader would otherwise have to go looking for.
    (elsewhere ? ` ${weekElsewhereBadge(elsewhere)}.` : '');
  return (
    <div aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
      {text}
    </div>
  );
}

/**
 * ⚠ **R-lens-5, rewritten — the body is a FLAT list at every horizon, and its order is unchanged.**
 *
 * `Group`, `CollapsibleHeader`'s group caller, `showHeader`, the `rendered` partition, `UNSORTED_NOTE`,
 * `CreateLink`, the per-group `RepeatLastWeek` and every `ui.collapsed` key of the form `<lens>|<groupId>`
 * are deleted. `CollapsibleHeader` itself survives — the carried band still uses it (R-lens-12), and so
 * does its `Weekly|__carried|<week>` collapse key.
 *
 * **The client no longer partitions.** `LensResponse.items` arrives in the total order R-lens-5 now
 * specifies — the item's Life root by `createdAt asc` then `id asc`, then the item by the same, with
 * root-less items last — which is character for character the reading order of the previously grouped
 * screen with its headers removed. So cards from one line stay adjacent, the repeated `under <Life goal>`
 * line reads as a label on a run rather than as noise on every card, and **the same goal is in the same
 * place before and after the change**.
 *
 * ⚠ **R-lens-30** — `period` comes in as the LOCALLY computed view, not out of `data`. The empty-state
 * copy names the period (`Sep 2026 is unwritten.`), and taking that name from the payload meant the
 * sentence could not exist until the payload did. It is a calendar fact; it exists first.
 */
function Body({
  lens,
  data,
  period,
  canCreate,
  weekOffset,
}: {
  lens: Horizon;
  data: LensData;
  period: CalendarPeriod;
  canCreate: boolean;
  weekOffset: number;
}) {
  const S = useSkin();
  const label = lens === 'Life' ? 'Life' : period.label;

  /**
   * R-lens-23 — the Life line each item hangs under, indexed once per render. The client holds no tree
   * and walks no ancestor chain (R-lens-16); this is a `Map` over the payload's own `groups` array, which
   * is what `LifeGroupView` is still on the wire FOR now that it is not a layout primitive (§4.1).
   */
  const lives = useMemo(
    () => new Map(data.groups.filter((g): g is LifeGroupView & { id: string } => g.id !== null).map((g) => [g.id, g.title])),
    [data.groups],
  );
  const lifeOf = (goal: GoalView): LifeRef | null => {
    const title = goal.lifeRootId ? lives.get(goal.lifeRootId) : undefined;
    return goal.lifeRootId && title !== undefined ? { id: goal.lifeRootId, title } : null;
  };

  /**
   * One condition, used twice. The sentence below the band hardcodes **"this week"**, so it must carry the
   * same lens guard the band does.
   */
  const showCarried = lens === 'Weekly' && data.carried.length > 0;

  if (data.items.length === 0 && data.carried.length === 0) {
    /**
     * R-lens-24 — **three empty states, not two.** *"`Q3 2026` is unclaimed"* means *this period is
     * empty*; *"Nothing quarterly yet"* means *you have never used this horizon*. They cannot both be
     * true, and the client cannot tell them apart from a period-scoped payload.
     *
     * The horizon-level state also needs a Life goal to exist: with none, a new goal would have no legal
     * parent to hang off, so a brand-new account gets R-lens-6's cold start instead.
     */
    const horizonLevel = lens !== 'Life' && !data.hasAnyAtHorizon && data.hasLifeGoals;
    const copy = horizonLevel ? horizonEmptyCopy(lens) : emptyCopy(lens, label, lens === 'Life' || period.isCurrent, period.isPast);
    return (
      <div style={{ marginTop: 20 }} data-empty-state={horizonLevel ? 'horizon' : period.isPast ? 'past-period' : 'period'}>
        {/*
         * §3.1 — the empty state's CTA is **kept**: one button on an otherwise empty screen is not
         * clutter. Only its label changed, from `+ <Horizon> goal` to `+ Goal`.
         */}
        <Empty title={copy.title} body={copy.body} action={copy.cta && canCreate ? <CreateButton lens={lens} periodKey={period.periodKey} /> : undefined} />
      </div>
    );
  }

  // The Life lens is the roster: every Life goal, once, with its own numbers on its own card (R-lens-4).
  if (lens === 'Life') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
        {data.items.map((g) => (
          <LifeCard key={g.id} goal={g} openTasks={data.groups.find((grp) => grp.id === g.id)?.openTasks ?? 0} />
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
      {data.items.map((g) => (
        <Item
          key={g.id}
          lens={lens}
          goal={g}
          tasks={data.tasks.filter((t) => t.goalId === g.id)}
          weekOffset={weekOffset}
          canCreate={canCreate}
          life={lifeOf(g)}
        />
      ))}
      {/*
       * R-goal-46, amended — **`Repeat last week`, once, at the foot of the list.** It used to sit at
       * every group foot, per Life line; there is no group foot, so it becomes the honest flat version and
       * copies the previous week's Weekly goals across **every** line. Offered only on the current week or
       * later, unchanged (R-goal-36).
       */}
      {lens === 'Weekly' && canCreate && <RepeatLastWeek weekStart={period.periodKey} />}
      {showCarried && <CarriedBand goals={data.carried} tasks={data.tasks} weekOffset={weekOffset} periodKey={period.periodKey} lifeOf={lifeOf} />}
      {showCarried && data.items.length === 0 && (
        <div style={{ ...S.dashed, padding: '22px 20px', textAlign: 'center', fontSize: 13.5, color: S.T.mut }}>
          {/* §7.2 — the band renders with no plan above it, and the screen has to say so rather than look broken. */}
          Nothing planned for this week — the work below is still carrying.
        </div>
      )}
    </div>
  );
}

function CreateButton({ lens, periodKey }: { lens: Horizon; periodKey: string }) {
  const S = useSkin();
  const ui = useUI();
  return (
    <button
      type="button"
      style={S.topBtn}
      onClick={() => ui.openSheet({ kind: 'goalForm', editId: null, horizon: lens, periodKey, lens })}
    >
      {CREATE_LABEL}
    </button>
  );
}

/**
 * §8.2 — **one collapsible section header.** Its group caller is deleted with grouping; the carried band
 * is the one caller left, and it is why this survives (R-lens-12).
 *
 * `label` is what the eye reads and `name` is what the platform reads; the `▾`/`▸` marker is
 * `aria-hidden` because `aria-expanded` already carries the state, and hearing both is hearing it twice.
 */
function CollapsibleHeader({
  collapsed,
  onToggle,
  name,
  what,
  label,
}: {
  collapsed: boolean;
  onToggle: () => void;
  name: string;
  what: 'band';
  label: string;
}) {
  const S = useSkin();
  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      aria-label={`${name}. ${collapsed ? 'Expand' : 'Collapse'} ${what}.`}
      onClick={onToggle}
      style={{ ...S.sectionLabel, display: 'flex', alignItems: 'center', gap: 7, width: '100%', minHeight: 44, border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
    >
      <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
      <span>{label}</span>
    </button>
  );
}

/**
 * R-goal-46, amended — copies the previous week's Weekly goals into this week as ordinary new goals,
 * **across every Life line**. Deliberately not a recurrence feature: no template, no series id, no
 * materialisation job and no edit-this-one-versus-all-future decision. A repeating intention costs one tap
 * per week.
 *
 * The per-line variant it replaces needed a per-line row, which is a group header by another name. A
 * week's plan is usually repeated as a whole or not at all.
 */
function RepeatLastWeek({ weekStart }: { weekStart: string }) {
  const S = useSkin();
  const ui = useUI();
  const repeat = useRepeatWeek();
  return (
    <div>
      <button
        type="button"
        style={S.linkBtn}
        disabled={repeat.isPending}
        onClick={() =>
          repeat.mutate(
            { weekStart },
            {
              onSuccess: (d) => ui.showToast(d.created.length === 0 ? 'Last week held nothing' : `Repeated ${d.created.length} from last week`),
            },
          )
        }
      >
        Repeat last week
      </button>
    </div>
  );
}

function Item({
  lens,
  goal,
  tasks,
  weekOffset,
  canCreate,
  life,
}: {
  lens: Horizon;
  goal: GoalView;
  tasks: TaskView[];
  weekOffset: number;
  canCreate: boolean;
  /** R-lens-23 — the Life goal this item's chain reaches; `null` is R-lens-20's root-less state. */
  life: LifeRef | null;
}) {
  if (lens === 'Weekly') return <WeeklyCard goal={goal} tasks={tasks} week={weekOffset} canCreate={canCreate} life={life} />;
  if (lens === 'Monthly') return <MonthlyCard goal={goal} canCreate={canCreate} life={life} />;
  return <PlainCard goal={goal} life={life} />;
}

/**
 * R-lens-12 — **the carried band.** Below the week's own goals, one band, **oldest `periodKey` first** (the
 * server's order), each goal labelled with the week it was written for, each showing only its tasks visible
 * in the viewed week.
 *
 * **The band keeps its header and its collapse, and that is not an inconsistency with §4.1.** It is not a
 * Life-goal group — it is a different *kind* of content in the same lens (goals from earlier weeks that
 * still hold open work), and R-lens-12's whole point is that the two are never mixed. Deleting its header
 * would merge them.
 *
 * **Nothing ages out of it, ever.** The escalation is the red chip on the TASK, growing, and it is the
 * only one there is. Collapsible as a whole (Q-21), with **no create stops inside it**.
 */
function CarriedBand({
  goals,
  tasks,
  weekOffset,
  periodKey,
  lifeOf,
}: {
  goals: GoalView[];
  tasks: TaskView[];
  weekOffset: number;
  periodKey: string;
  lifeOf: (goal: GoalView) => LifeRef | null;
}) {
  const S = useSkin();
  const ui = useUI();
  const key = `Weekly|__carried|${periodKey}`;
  const collapsed = !!ui.collapsed[key];
  return (
    <div data-testid="carried-band" style={{ borderTop: `1px solid ${S.T.line}`, paddingTop: 12 }}>
      <CollapsibleHeader
        collapsed={collapsed}
        onToggle={() => ui.toggleCollapsed(key)}
        name={`Carried, ${goals.length} goal${goals.length === 1 ? '' : 's'} from earlier weeks`}
        what="band"
        label="Carried"
      />
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 7 }}>
          {goals.map((g) => (
            <CarriedCard key={g.id} goal={g} tasks={tasks.filter((t) => t.goalId === g.id)} week={weekOffset} life={lifeOf(g)} />
          ))}
        </div>
      )}
    </div>
  );
}
