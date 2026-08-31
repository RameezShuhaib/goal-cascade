import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { HORIZONS, type GoalView, type Horizon, type LifeGroupView, type TaskView } from '@goal-cascade/shared';
import { useUI } from '../context/UIContext';
import { useLens, useRepeatWeek } from '../api/queries';
import { useWeekClock } from '../lib/weekClock';
import { useSkin } from '../skin';
import { TopActions } from '../components/TopActions';
import { Empty, Loading, LoadError } from '../components/states';
import { firstDayOf, PERIOD_UNIT, rank, stepPeriod, validKeyFor } from '../utils/periodKeys';
import { lensPath } from '../routes';
import { LensRow, OffNowRow } from './LensRow';
import { CarriedCard, LifeCard, MonthlyCard, PlainCard, WeeklyCard } from './cards';
import { createLabel, emptyCopy, offNowBadge, UNSORTED_NOTE } from './copy';

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
 * ── What the client is not allowed to work out for itself ──────────────────────
 * The period, whether it is current or past, its label, and the counts all arrive on the wire (R-goal-34,
 * R-lens-4). When the URL names no period the read is sent without one and the SERVER answers with the
 * current one (R-lens-14); this screen then rewrites the address bar to the canonical key, so `/month`
 * becomes `/month/2026-08` and a copied link is absolute.
 */
export function LensScreen({ lens }: { lens: Horizon }) {
  const S = useSkin();
  const ui = useUI();
  const navigate = useNavigate();
  const params = useParams();
  const clock = useWeekClock();

  const period = validKeyFor(lens, params.period);
  const q = useLens(lens, period);
  const data = q.data;
  const view = data?.period ?? null;

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
  const anchor = lens === 'Life' ? (ui.anchor ?? clock.today) : view ? (view.isCurrent ? clock.today : firstDayOf(lens, view.periodKey)) : null;
  useEffect(() => {
    if (lens !== 'Life' && anchor) setAnchor(anchor);
  }, [lens, anchor, setAnchor]);

  // The URL is rewritten to the canonical key once the read lands — never before, because the client does
  // not know which period "now" is. `replace`, so it is not a back-stack entry of its own.
  useEffect(() => {
    if (!view || params.period === view.periodKey) return;
    navigate(lensPath(lens, view.periodKey), { replace: true });
  }, [lens, params.period, view, navigate]);

  const step = (n: -1 | 1) => {
    if (lens === 'Life' || !view) return;
    // No clamp in either direction (R-lens-7, R-rm-3). The `Math.min(0, …)` that used to live on the week
    // control is deleted, not relaxed: it would silently pin every forward step to the current week.
    navigate(lensPath(lens, stepPeriod(lens, view.periodKey, n)));
  };
  const zoomOneStep = (n: -1 | 1) => {
    const to = HORIZONS[rank(lens) + n];
    if (to) navigate(lensPath(to));
  };

  const failed = q.error;
  const pending = q.isPending && !failed;
  const offNow = !!view && !view.isCurrent;
  // R-goal-36 / R-nav-25 — on a past period the create affordances are **absent, not disabled**. A
  // disabled create button invites "why?" on every past screen; absence plus the badge says the true
  // thing — the past is readable, and planning does not reach back into it.
  const canCreate = !view?.isPast;
  const weekOffset = lens === 'Weekly' && view ? clock.offsetOf(view.periodKey) : 0;

  return (
    <div style={S.page} data-screen-label={`${lens} lens`}>
      {/* Row 1 — the cluster (R-nav-25): the theme toggle, the account button, one primary action. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', gap: 10 }}>
        <TopActions>
          {canCreate && view !== undefined && (
            <button
              type="button"
              style={S.topBtn}
              onClick={() => ui.openSheet({ kind: 'goalForm', editId: null, horizon: lens, periodKey: view?.periodKey ?? '' })}
            >
              {createLabel(lens)}
            </button>
          )}
        </TopActions>
      </div>

      {/* Row 2 — the lens. The title IS the altitude control (R-lens-17). */}
      <LensRow
        lens={lens}
        period={view}
        hasForwardContent={data?.hasForwardContent ?? false}
        onStep={step}
        onZoom={() => ui.openSheet({ kind: 'zoom' })}
      />

      {/* Row 3 — conditional, and only conditional (R-lens-21, R-nav-27). */}
      {offNow && view && <OffNowRow badge={offNowBadge(lens, view.isPast)} onNow={() => navigate(lensPath(lens))} />}

      <Announcement lens={lens} label={view?.label ?? 'Life'} data={data} />

      {pending && <Loading label="Loading…" />}
      {failed && <LoadError error={failed} what="this lens" onRetry={() => void q.refetch()} />}

      {data && (
        <LensBody lens={lens} onStep={step} onZoom={zoomOneStep}>
          <Body lens={lens} data={data} canCreate={canCreate} weekOffset={weekOffset} />
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
function Announcement({ lens, label, data }: { lens: Horizon; label: string; data: { groups: LifeGroupView[]; items: GoalView[]; carried: GoalView[] } | undefined }) {
  if (!data) return null;
  const groups = data.groups.length;
  const carried = data.carried.length;
  const text =
    `${label}. ${data.items.length} goal${data.items.length === 1 ? '' : 's'}` +
    (lens === 'Life' ? '' : ` in ${groups} group${groups === 1 ? '' : 's'}`) +
    (carried > 0 ? `, ${carried} carried` : '') +
    '.';
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
  period: { periodKey: string; label: string; isCurrent: boolean; isPast: boolean } | null;
}

function Body({ lens, data, canCreate, weekOffset }: { lens: Horizon; data: LensData; canCreate: boolean; weekOffset: number }) {
  const S = useSkin();
  const label = data.period?.label ?? 'Life';

  /**
   * R-lens-19 — a group with **no items in the selected period is not rendered**. A lens is not a roster:
   * a twelve-line account would otherwise draw twelve headers on a lens where two have items, which is the
   * clutter complaint restated. (The Life lens is where every Life goal is guaranteed visible.)
   */
  const rendered = useMemo(
    () => data.groups.map((g) => ({ group: g, items: data.items.filter((i) => i.lifeRootId === g.id) })).filter((x) => x.items.length > 0),
    [data.groups, data.items],
  );

  if (data.items.length === 0 && data.carried.length === 0) {
    const copy = emptyCopy(lens, label, data.period?.isCurrent ?? true, data.period?.isPast ?? false);
    return (
      <div style={{ marginTop: 20 }}>
        <Empty title={copy.title} body={copy.body} action={copy.cta && canCreate ? <CreateButton lens={lens} periodKey={data.period?.periodKey ?? ''} /> : undefined} />
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
          periodKey={data.period?.periodKey ?? ''}
          canCreate={canCreate}
          // R-lens-19 — with exactly one group the header does not render at all. There is nothing to
          // disambiguate, and a header over the only group names the card beneath it.
          showHeader={rendered.length > 1}
        />
      ))}
      {lens === 'Weekly' && data.carried.length > 0 && (
        <CarriedBand goals={data.carried} tasks={data.tasks} weekOffset={weekOffset} periodKey={data.period?.periodKey ?? ''} />
      )}
      {data.items.length === 0 && (
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
  showHeader,
}: {
  lens: Horizon;
  group: LifeGroupView;
  items: GoalView[];
  tasks: TaskView[];
  weekOffset: number;
  periodKey: string;
  canCreate: boolean;
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
        <button
          type="button"
          aria-expanded={!collapsed}
          // §8.2 — the visible label is short; the accessible name spells the count's scope out in full,
          // so the screen stays quiet and the screen reader stays precise. R-lens-4 anchors the count to
          // one week, so the words are "this week" at every horizon.
          aria-label={`${group.title}${count > 0 ? `, ${count} open task${count === 1 ? '' : 's'} this week` : ''}. ${collapsed ? 'Expand' : 'Collapse'} group.`}
          onClick={() => ui.toggleCollapsed(key)}
          style={{ ...S.sectionLabel, display: 'flex', alignItems: 'center', gap: 7, width: '100%', minHeight: 44, border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
        >
          <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
          {/* R-lens-4 — a ZERO count is never rendered, in the label or in the accessible name. */}
          <span>{count > 0 ? `${group.title} · ${count} open` : group.title}</span>
        </button>
      )}
      {showHeader && group.id === null && !collapsed && (
        <div style={{ fontSize: 12.5, color: S.T.mut, margin: '2px 0 6px 0' }}>{UNSORTED_NOTE}</div>
      )}
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: showHeader ? 7 : 0 }}>
          {items.map((g) => (
            <Item key={g.id} lens={lens} goal={g} tasks={tasks.filter((t) => t.goalId === g.id)} weekOffset={weekOffset} canCreate={canCreate} />
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

function Item({ lens, goal, tasks, weekOffset, canCreate }: { lens: Horizon; goal: GoalView; tasks: TaskView[]; weekOffset: number; canCreate: boolean }) {
  if (lens === 'Weekly') return <WeeklyCard goal={goal} tasks={tasks} week={weekOffset} canCreate={canCreate} />;
  if (lens === 'Monthly') return <MonthlyCard goal={goal} canCreate={canCreate} />;
  return <PlainCard goal={goal} />;
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
function CarriedBand({ goals, tasks, weekOffset, periodKey }: { goals: GoalView[]; tasks: TaskView[]; weekOffset: number; periodKey: string }) {
  const S = useSkin();
  const ui = useUI();
  const key = `Weekly|__carried|${periodKey}`;
  const collapsed = !!ui.collapsed[key];
  return (
    <div data-testid="carried-band" style={{ borderTop: `1px solid ${S.T.line}`, paddingTop: 12 }}>
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={() => ui.toggleCollapsed(key)}
        style={{ ...S.sectionLabel, display: 'flex', alignItems: 'center', gap: 7, width: '100%', minHeight: 44, border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
      >
        <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
        <span>Carried</span>
      </button>
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 7 }}>
          {goals.map((g) => (
            <CarriedCard key={g.id} goal={g} tasks={tasks.filter((t) => t.goalId === g.id)} week={weekOffset} />
          ))}
        </div>
      )}
    </div>
  );
}

export { PERIOD_UNIT };
