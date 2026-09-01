import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  currentPeriodKey,
  firstDayOf,
  HORIZONS,
  stepPeriod,
  type CalendarPeriodView,
  type GoalRefView,
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
import { Empty, Loading, LoadError } from '../components/states';
import { rank, validKeyFor } from '../utils/periodKeys';
import { lensPath } from '../routes';
import { assertPeriodAgrees } from './assertPeriodAgrees';
import { useCalendarPeriod } from './useCalendarPeriod';
import { useNeighbourPrefetch } from './useNeighbourPrefetch';
import { LensRow, OffNowRow, WeekElsewhereRow } from './LensRow';
import { CarriedCard, LifeCard, MonthlyCard, PlainCard, WeeklyCard } from './cards';
import {
  createLabel,
  emptyCopy,
  horizonEmptyCopy,
  offNowBadge,
  periodTitle,
  UNSORTED_NOTE,
  weekElsewhereAction,
  weekElsewhereBadge,
} from './copy';

/**
 * **A lens: a flat list of every goal at one horizon in one period, grouped by the Life goal each belongs
 * to.** This is what replaced the goals tree, the Tasks screen and the plan screen (R-lens-1, R-rm-5).
 *
 * ── The chrome budget, which is the first-class constraint ─────────────────────
 * R-nav-27: **at most two unconditional rows above the first item** — the top-right cluster and the lens
 * row. Everything else is conditional: the off-now row only off-now (R-lens-21), group headers only when
 * there is more than one non-empty group (R-lens-19). Today's Tasks screen carried four rows and the tree
 * carried three plus depth, so two is not merely "no worse": it removes half of what the owner complained
 * about before any new capability is counted. **A new unconditional row is refused, not deferred.**
 *
 * ── ⚠ **R-lens-30 — what the client works out for itself, and what it still does not** ─────────────
 * **The calendar is the client's; the data is the server's.** The period's label, its range, whether it
 * is current or past and which period holds the current week are all `(horizon, periodKey, today)` and
 * are computed here, in the same frame as the input that changed them (`useCalendarPeriod`). The counts,
 * `hasWork`, `hasForwardContent` and `hasAnyAtHorizon` are questions about data and still arrive on the
 * wire.
 *
 * This deleted two defects at once. The header no longer renders `…` while a read is in flight — and the
 * URL is no longer rewritten *after* the response lands, which used to change the query key mid-flight
 * and fire a **second** `GET /goals`: opening a lens cost two round trips and two loading flashes. The
 * route now resolves `/month` to `/month/2026-09` **before the first render that fetches**, so
 * `keys.lens(lens, null)` is Life-only and one open is one request.
 */
export function LensScreen({ lens }: { lens: Horizon }) {
  const S = useSkin();
  const ui = useUI();
  const navigate = useNavigate();
  const params = useParams();
  const clock = useWeekClock();

  /**
   * ⚠ **R-lens-30 / R-lens-14 — the period is resolved BEFORE the read, not after it.**
   *
   * `/month` used to fetch under `['goals','Monthly',null]`, and an effect rewrote the URL to
   * `/month/2026-09` once the answer landed — a new key, a cache miss, a second request and a second
   * `Loading…`. Every entry through the tab bar, every `Jump to now` and every one-step zoom did that.
   * `currentPeriodKey` is the same `periodKeyOf(horizon, today)` the server would have answered with, so
   * the address is right from the first render.
   *
   * A URL segment is attacker-supplied, so `validKeyFor` drops one that is not canonical for this lens
   * and the current period stands in — R-lens-14's "a deep link that has rotted should land you
   * somewhere real", now answered without a round trip.
   */
  const fromUrl = validKeyFor(lens, params.period);
  const period = lens === 'Life' ? null : (fromUrl ?? currentPeriodKey(lens, clock.today));
  const q = useLens(lens, period ?? undefined);
  const data = q.data;
  const local = useCalendarPeriod(lens, period ?? '');

  /**
   * ⚠ **Anti-drift layer 3** — every lens read is compared against the calendar the client just computed.
   * A shared module cannot drift; a shared module plus a service worker holding a client bundle a week
   * older than the Worker can, and only a runtime comparison catches that. Throws in dev and test, warns
   * once and defers to the server in production.
   */
  assertPeriodAgrees(`LensResponse (${lens})`, lens, data?.period, data?.serverNow, clock.tz);

  // R-lens-30 — ±1 once this period has settled, plus one further in the direction of travel. Depth 1,
  // idle-scheduled and save-data-aware; the reasons are in the hook.
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
   *
   * The effect fires only when the segment is genuinely absent or unusable; `period` is already the key
   * the read used, so this never changes the query key and never triggers a second fetch. That is the
   * whole of §3.1's defect, closed.
   */
  useEffect(() => {
    if (lens === 'Life' || !period || params.period === period) return;
    navigate(lensPath(lens, period), { replace: true });
  }, [lens, params.period, period, navigate]);

  const step = (n: -1 | 1) => {
    if (lens === 'Life' || !period) return;
    // No clamp in either direction (R-lens-7, R-rm-3). The `Math.min(0, …)` that used to live on the week
    // control is deleted, not relaxed: it would silently pin every forward step to the current week. The
    // one guard `stepPeriod` does carry is the FORMAT's representable range, not a product bound.
    navigate(lensPath(lens, stepPeriod(lens, period, n)));
  };
  const zoomOneStep = (n: -1 | 1) => {
    const to = HORIZONS[rank(lens) + n];
    if (to) navigate(lensPath(to));
  };

  const failed = q.error;
  const pending = q.isPending && !failed;
  /**
   * ⚠ **R-lens-30 — both notices are now calendar facts, so they settle in the same frame as the label.**
   *
   * They used to wait on the read, which is why the header settled twice: the name at 0 ms and the badge
   * 300 ms later. `clockKnown` is what keeps the `'UTC'` fallback from ever being *seen*: while the
   * owner's timezone is unknown, `isCurrent` and `isPast` are both false, so neither notice renders and
   * neither is a guess.
   */
  const offNow = lens !== 'Life' && local.clockKnown && !local.isCurrent;
  // R-goal-36 / R-nav-25 — on a past period the create affordances are **absent, not disabled**. A
  // disabled create button invites "why?" on every past screen; absence plus the badge says the true
  // thing — the past is readable, and planning does not reach back into it.
  const canCreate = !local.isPast;
  const weekOffset = lens === 'Weekly' && period ? clock.offsetOf(period) : 0;

  /**
   * R-lens-29 — the period on screen is the current one **and still does not hold the week you are in**.
   *
   * `PeriodView.currentWeekPeriod` is the server's statement of where the current week actually is, and
   * is `null` whenever it is here. This screen adds the one clause the server deliberately does not: it
   * says so only on the CURRENT period, which is exactly where `offNow` is false — so the two notices are
   * mutually exclusive and share R-lens-21's one conditional row rather than adding a second (R-nav-27).
   *
   * ⚠ **Why the lens still opens on the calendar period** (R-lens-8, unchanged). Defaulting the Monthly
   * lens to the month holding the current week would open it, today, on `Aug 2026` — a period the same
   * payload calls `isPast`, which strips every create affordance (R-goal-36, R-nav-25) and badges it
   * `Past month — still editable`. That is a worse landing than an honest label: you would arrive
   * somewhere you cannot plan. The flag carries the weight instead, and the jump is one tap.
   */
  const elsewhere = local.isCurrent ? local.currentWeekPeriod : null;

  return (
    <div style={S.page} data-screen-label={`${lens} lens`}>
      {/* Row 1 — the cluster (R-nav-25): the theme toggle, the account button, one primary action. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', gap: 10 }}>
        <TopActions>
          {/*
           * ⚠ **R-lens-30 — this used to be gated on `data !== undefined`, so the one primary action on
           * the screen DISAPPEARED AND REAPPEARED on every single period step.** The guard existed
           * because `view` came from the read and was `null` both while pending and, legitimately, on
           * the Life lens (R-lens-2) — two states the query was the only way to tell apart.
           *
           * The calendar answers both without it: `local.periodKey` is `''` on Life because Life has no
           * period (R-goal-3 refuses a Life goal that carries one), and it is the real key on every other
           * lens from the first render. So the button's presence now depends only on R-goal-36 — the past
           * offers no create affordance — and it does not blink.
           */}
          {canCreate && (
            <button
              type="button"
              style={S.topBtn}
              onClick={() => ui.openSheet({ kind: 'goalForm', editId: null, horizon: lens, periodKey: local.periodKey })}
            >
              {createLabel(lens)}
            </button>
          )}
        </TopActions>
      </div>

      {/* Row 2 — the lens. The title IS the altitude control (R-lens-17). */}
      <LensRow
        lens={lens}
        period={local}
        /**
         * R-lens-26 — the forward-content dot answers "is there anything ahead", which is a question
         * about DATA and not about the calendar. It therefore lags the header on an uncached period, and
         * that is correct: it appears when the read lands and moves nothing on screen when it does (it is
         * absolutely positioned inside the chevron). UX-PLAN §9.4 asks that it not blink, which it cannot
         * — it only ever goes false → true as a period's own read settles.
         */
        hasForwardContent={data?.hasForwardContent ?? false}
        onStep={step}
        onZoom={() => ui.openSheet({ kind: 'zoom' })}
      />

      {/*
       * Row 3 — conditional, and only conditional (R-lens-21, R-nav-27). **Two occupants, never two
       * rows**: `offNow` is `!isCurrent` and `elsewhere` is only ever set when `isCurrent`, so the
       * `else` is a fact about the data and not a preference about layout.
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
        // R-lens-28 — a screen reader hears the span too, because the range line is `aria-hidden` in the
        // title and a period change leaves focus on the chevron, which re-reads nothing (§8.2).
        label={lens === 'Life' ? 'Life' : periodTitle(local.label, lens === 'Weekly' ? '' : local.weekRange)}
        elsewhere={elsewhere?.label ?? null}
        data={data}
      />

      {pending && <Loading label="Loading…" />}
      {failed && <LoadError error={failed} what="this lens" onRetry={() => void q.refetch()} />}

      {data && (
        <LensBody lens={lens} onStep={step} onZoom={zoomOneStep}>
          <Body lens={lens} data={data} period={local} canCreate={canCreate} weekOffset={weekOffset} />
        </LensBody>
      )}
    </div>
  );
}

/**
 * §8.2 — one `aria-live="polite"` region, and one rule that keeps it from talking over itself:
 * **a navigation moves focus; the live region carries only what focus will not say.**
 *
 * A lens change is announced by the title button's own accessible name when focus returns to it, so this
 * adds only the payload. A period change leaves focus on the chevron, which does not re-read, so this
 * carries the whole thing — including the carried band's count, which a sighted user can see and a screen
 * reader otherwise could not.
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
  data: { groups: LifeGroupView[]; items: GoalView[]; carried: GoalView[] } | undefined;
}) {
  if (!data) return null;
  /**
   * The **rendered** group count, not `data.groups.length`. The server builds `groups` from
   * `[...items, ...carried]`, and `Body` renders only the groups that have items (R-lens-19), so on the
   * Weekly lens a life line present *only* through carried work is in `groups` and never gets a header.
   * Announcing the raw length told a screen-reader user "3 groups" where a sighted user could count two.
   * The announcement has to describe the screen, not the payload.
   */
  const groups = data.groups.filter((g) => data.items.some((i) => i.lifeRootId === g.id)).length;
  const carried = data.carried.length;
  const text =
    `${label}. ${data.items.length} goal${data.items.length === 1 ? '' : 's'}` +
    (lens === 'Life' ? '' : ` in ${groups} group${groups === 1 ? '' : 's'}`) +
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
 * R-lens-25 — **one gesture in the whole design**, and its keyboard equal.
 *
 * A horizontal swipe on the lens body steps the period, mirroring the chevrons' direction. It is an
 * **accelerator, never a route**: the chevrons are always present and never hidden, so nothing is reachable
 * only by gesture. Suppressed on the Life lens, which has no periods. There is **no vertical swipe** —
 * vertical is the scroll axis, and a gesture that competes with scrolling on a phone is a gesture that
 * fires when you did not mean it.
 *
 * `←`/`→` step the period and `Shift+↑`/`Shift+↓` change altitude, as documented conveniences only. Every
 * one of them has a visible control one `Tab` away, so the accessibility floor never depends on a
 * shortcut. They are ignored while a field has focus, or the arrow keys would fight the caret.
 */
function LensBody({ lens, onStep, onZoom, children }: { lens: Horizon; onStep: (n: -1 | 1) => void; onZoom: (n: -1 | 1) => void; children: ReactNode }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const isLife = lens === 'Life';

  const typing = (target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    return !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  };

  return (
    <div
      data-testid="lens-body"
      /**
       * `-1`, so it is script-focusable and never a tab stop: the shortcuts fire from focus anywhere in
       * the body (they bubble from whichever control holds it), and this makes the body itself a legal
       * target too. The app's `:focus-visible` ring deliberately skips `[tabindex="-1"]`, so nothing is
       * drawn around it.
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
        // scrolls horizontally, so the gesture can never fight a scroller.
        if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(t.clientY - from.y) * 2) return;
        if ((e.target as HTMLElement).closest('[data-h-scroll]')) return;
        onStep(dx > 0 ? -1 : 1);
      }}
    >
      {children}
    </div>
  );
}

interface LensData {
  groups: LifeGroupView[];
  items: GoalView[];
  carried: GoalView[];
  tasks: TaskView[];
  /** R-lens-23 — one entry per DISTINCT parent, Life parents already suppressed by the server. */
  parents: GoalRefView[];
  /** R-lens-24 — has this horizon ever held a goal, and does the account have Life goals at all? */
  hasAnyAtHorizon: boolean;
  hasLifeGoals: boolean;
}

/**
 * ⚠ **R-lens-30** — `period` comes in from the caller as the LOCALLY computed view, not out of `data`.
 * The empty-state copy names the period (`Sep 2026 is unwritten.`), and taking that name from the payload
 * meant the sentence could not exist until the payload did. It is a calendar fact; it exists first.
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
  period: CalendarPeriodView;
  canCreate: boolean;
  weekOffset: number;
}) {
  const S = useSkin();
  const label = lens === 'Life' ? 'Life' : period.label;

  /**
   * R-lens-19 — a group with **no items in the selected period is not rendered**. A lens is not a roster:
   * a twelve-line account would otherwise draw twelve headers on a lens where two have items, which is the
   * clutter complaint restated. (The Life lens is where every Life goal is guaranteed visible.)
   */
  const rendered = useMemo(
    () => data.groups.map((g) => ({ group: g, items: data.items.filter((i) => i.lifeRootId === g.id) })).filter((x) => x.items.length > 0),
    [data.groups, data.items],
  );

  /**
   * One condition, used twice. The sentence below the band hardcodes **"this week"**, so it must carry the
   * same lens guard the band does — it read `data.items.length === 0` alone, and only stayed correct
   * because the SERVER never populates `carried` outside the Weekly lens (`goal.service.ts` sends
   * `weekTasks = []` at every other horizon). A client-side sentence resting on a server-side invariant is
   * one refactor away from appearing on the Quarterly lens.
   */
  const showCarried = lens === 'Weekly' && data.carried.length > 0;

  /**
   * R-lens-23 — the parent lines, indexed once per render. The client holds no tree and walks no ancestor
   * chain (R-lens-16); this is a `Map` over the payload's own `parents` array.
   */
  const parents = useMemo(() => new Map(data.parents.map((p) => [p.id, p])), [data.parents]);

  if (data.items.length === 0 && data.carried.length === 0) {
    /**
     * R-lens-24 — **three empty states, not two**, and the difference is what the server just told us.
     *
     * *"`Q3 2026` is unclaimed"* means *this period is empty*; *"Nothing quarterly yet"* means *you have
     * never used this horizon*. They cannot both be true, and the client cannot tell them apart from a
     * period-scoped payload — `hasForwardContent` only looks forward, so an account with last year's
     * quarterly goals would have been told a flat lie.
     *
     * The horizon-level state also needs a Life goal to exist: with none, its `+ Quarterly goal` would
     * have no legal parent to hang off, so a brand-new account gets R-lens-6's cold start instead.
     */
    const horizonLevel = lens !== 'Life' && !data.hasAnyAtHorizon && data.hasLifeGoals;
    const copy = horizonLevel ? horizonEmptyCopy(lens) : emptyCopy(lens, label, lens === 'Life' || period.isCurrent, period.isPast);
    return (
      <div style={{ marginTop: 20 }} data-empty-state={horizonLevel ? 'horizon' : period.isPast ? 'past-period' : 'period'}>
        <Empty title={copy.title} body={copy.body} action={copy.cta && canCreate ? <CreateButton lens={lens} periodKey={period.periodKey} /> : undefined} />
      </div>
    );
  }

  // The Life lens has no groups: each Life goal IS a group of one, so a header would name the card below.
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 16 }}>
      {rendered.map(({ group, items }) => (
        <Group
          key={group.id ?? '__unsorted'}
          lens={lens}
          group={group}
          items={items}
          tasks={data.tasks}
          weekOffset={weekOffset}
          periodKey={period.periodKey}
          canCreate={canCreate}
          parents={parents}
          // R-lens-19 — with exactly one group the header does not render at all. There is nothing to
          // disambiguate, and a header over the only group names the card beneath it.
          showHeader={rendered.length > 1}
        />
      ))}
      {showCarried && (
        <CarriedBand goals={data.carried} tasks={data.tasks} weekOffset={weekOffset} periodKey={period.periodKey} parents={parents} />
      )}
      {showCarried && data.items.length === 0 && (
        <div style={{ ...S.dashed, padding: '22px 20px', textAlign: 'center', fontSize: 13.5, color: S.T.mut }}>
          {/* §7.2 — the band renders with no plan above it, and the screen has to say so rather than look broken. */}
          Nothing planned for this week — the work below is still carrying.
        </div>
      )}
    </div>
  );
}

function CreateButton({ lens, periodKey, lifeGoalId }: { lens: Horizon; periodKey: string; lifeGoalId?: string | null }) {
  const S = useSkin();
  const ui = useUI();
  return (
    <button
      type="button"
      style={S.topBtn}
      onClick={() => ui.openSheet({ kind: 'goalForm', editId: null, horizon: lens, periodKey, lifeGoalId: lifeGoalId ?? null })}
    >
      {createLabel(lens)}
    </button>
  );
}

/**
 * §8.2 — **one collapsible section header, used by both the group headers and the carried band.**
 *
 * These were byte-identical buttons in two places, and they had already drifted: the band's copy carried
 * no `aria-label`, so a screen reader heard "Carried, expanded" with no Expand/Collapse verb, while the
 * group header three hundred lines away explained in a comment exactly why one is needed. Two spellings
 * of one control is how that happens, so there is one now.
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
  what: 'group' | 'band';
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
 * R-lens-19 — one group. The header is a single `S.sectionLabel` row and **the whole row is the collapse
 * toggle**, with a `▾`/`▸` glyph and no separate chevron button: expand/collapse is existing vocabulary,
 * and this is the same gesture one level up. Default expanded, session-scoped and per-lens — a collapsed
 * group that survives a restart is a hidden goal.
 *
 * The group foot is where creation earns grouping its keep: sitting inside a group in a period-scoped
 * lens, **every field of the create form except the title is already known**.
 */
function Group({
  lens,
  group,
  items,
  tasks,
  weekOffset,
  periodKey,
  canCreate,
  parents,
  showHeader,
}: {
  lens: Horizon;
  group: LifeGroupView;
  items: GoalView[];
  tasks: TaskView[];
  weekOffset: number;
  periodKey: string;
  canCreate: boolean;
  parents: ReadonlyMap<string, GoalRefView>;
  showHeader: boolean;
}) {
  const S = useSkin();
  const ui = useUI();
  const key = `${lens}|${group.id ?? '__unsorted'}`;
  // R-lens-20 — `UNSORTED` is never collapsed by default and carries no count.
  const collapsed = !!ui.collapsed[key];
  const count = group.id === null ? 0 : group.openTasks;

  return (
    <div>
      {showHeader && (
        <CollapsibleHeader
          collapsed={collapsed}
          onToggle={() => ui.toggleCollapsed(key)}
          // §8.2 — the visible label is short; the accessible name spells the count's scope out in full,
          // so the screen stays quiet and the screen reader stays precise. R-lens-4 anchors the count to
          // one week, so the words are "this week" at every horizon.
          name={`${group.title}${count > 0 ? `, ${count} open task${count === 1 ? '' : 's'} this week` : ''}`}
          what="group"
          // R-lens-4 — a ZERO count is never rendered, in the label or in the accessible name.
          label={count > 0 ? `${group.title} · ${count} open` : group.title}
        />
      )}
      {showHeader && group.id === null && !collapsed && (
        <div style={{ fontSize: 12.5, color: S.T.mut, margin: '2px 0 6px 0' }}>{UNSORTED_NOTE}</div>
      )}
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: showHeader ? 7 : 0 }}>
          {items.map((g) => (
            <Item
              key={g.id}
              lens={lens}
              goal={g}
              tasks={tasks.filter((t) => t.goalId === g.id)}
              weekOffset={weekOffset}
              canCreate={canCreate}
              parent={g.parentId ? parents.get(g.parentId) : undefined}
            />
          ))}
          {canCreate && (
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <CreateLink lens={lens} periodKey={periodKey} lifeGoalId={group.id} />
              {/* R-goal-46 — `Repeat last week`, per Life line, at the group foot and nowhere else. */}
              {lens === 'Weekly' && group.id && <RepeatLastWeek lifeGoalId={group.id} weekStart={periodKey} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CreateLink({ lens, periodKey, lifeGoalId }: { lens: Horizon; periodKey: string; lifeGoalId: string | null }) {
  const S = useSkin();
  const ui = useUI();
  return (
    <button
      type="button"
      style={S.linkBtn}
      onClick={() => ui.openSheet({ kind: 'goalForm', editId: null, horizon: lens, periodKey, lifeGoalId })}
    >
      {createLabel(lens)}
    </button>
  );
}

/**
 * R-goal-46 — copies the previous week's Weekly goals **for this Life line** into this week as ordinary
 * new goals. Deliberately not a recurrence feature: no template, no series id, no materialisation job and
 * no edit-this-one-versus-all-future decision. A repeating intention costs one tap per week.
 */
function RepeatLastWeek({ lifeGoalId, weekStart }: { lifeGoalId: string; weekStart: string }) {
  const S = useSkin();
  const ui = useUI();
  const repeat = useRepeatWeek();
  return (
    <button
      type="button"
      style={S.linkBtn}
      disabled={repeat.isPending}
      onClick={() =>
        repeat.mutate(
          { lifeGoalId, weekStart },
          {
            onSuccess: (d) => ui.showToast(d.created.length === 0 ? 'Last week held nothing' : `Repeated ${d.created.length} from last week`),
          },
        )
      }
    >
      Repeat last week
    </button>
  );
}

function Item({
  lens,
  goal,
  tasks,
  weekOffset,
  canCreate,
  parent,
}: {
  lens: Horizon;
  goal: GoalView;
  tasks: TaskView[];
  weekOffset: number;
  canCreate: boolean;
  /** R-lens-23 — `undefined` when the server suppressed it, which is the whole of the rule here. */
  parent?: GoalRefView;
}) {
  if (lens === 'Weekly') return <WeeklyCard goal={goal} tasks={tasks} week={weekOffset} canCreate={canCreate} parent={parent} />;
  if (lens === 'Monthly') return <MonthlyCard goal={goal} canCreate={canCreate} parent={parent} />;
  return <PlainCard goal={goal} parent={parent} />;
}

/**
 * R-lens-12 — **the carried band.** Below the week's own goals, one band, **oldest `periodKey` first** (the
 * server's order), each goal labelled with the week it was written for, each showing only its tasks visible
 * in the viewed week.
 *
 * **Nothing ages out of it, ever.** A goal with one task open for ten weeks appears in ten consecutive
 * lenses, and that is correct: the escalation is the red chip on the TASK, growing, and it is the only one
 * there is. An age-out rule would be a second escalation, or a silent disappearance of open work — which is
 * the one thing R-task-7 exists to prevent. Oldest-first is the whole ergonomic answer.
 *
 * Collapsible as a whole (Q-21), and there are **no create stops inside it** (§8.1).
 */
function CarriedBand({
  goals,
  tasks,
  weekOffset,
  periodKey,
  parents,
}: {
  goals: GoalView[];
  tasks: TaskView[];
  weekOffset: number;
  periodKey: string;
  parents: ReadonlyMap<string, GoalRefView>;
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
        // R-lens-12 — the accessible name says what the band holds. The visible word is the single
        // "Carried" and the marker is `aria-hidden`, so without this a screen reader got "Carried,
        // expanded" and no verb at all. That is precisely what the copy-pasted version did.
        name={`Carried, ${goals.length} goal${goals.length === 1 ? '' : 's'} from earlier weeks`}
        what="band"
        label="Carried"
      />
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 7 }}>
          {goals.map((g) => (
            <CarriedCard key={g.id} goal={g} tasks={tasks.filter((t) => t.goalId === g.id)} week={weekOffset} parent={g.parentId ? parents.get(g.parentId) : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}

