import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { BacklogItemView, GoalView, Horizon } from '@goal-cascade/shared';
import { useUI } from '../context/UIContext';
import { useCreateBacklogItem, useCreateGoal, useGoal } from '../api/queries';
import { useWeekClock, type WeekClock } from '../lib/weekClock';
import { TaskRow } from '../components/TaskRow';
import { BacklogItemCard } from '../components/BacklogItemCard';
import { useReorderList } from '../components/ReorderableList';
import { TopActions } from '../components/TopActions';
import { FieldError, Loading, LoadError, commandError } from '../components/states';
import { useSkin } from '../skin';
import { capturedLabel } from '../utils/dates';
import { childHorizons, subGoalPeriodKey } from '../utils/periodKeys';
import { goalPath, lensPath, BACKLOG_PATH, LEARNINGS_PATH } from '../routes';
import { plannedNess, stalePlanLine } from '../lens/copy';

/**
 * R-goal-41 — one goal, in one request: the goal, its ancestors (root → parent, each with its own period
 * label), its children, its backlog, its learnings — and, on a **Weekly** goal, its tasks and its backlog
 * pull list.
 *
 * ⚠ **A2** — this page is **not week-scoped** (`GET /goals/:id` takes no `?week=`); only the Weekly lens
 * is. `children` is the only source of "has children" (R-goal-37: `isLeaf` left the wire and is not coming
 * back under another name), and there is no weekly-focus block and no dormant block — both are deleted
 * (R-rm-2, R-goal-38: no goal is muted, greyed or labelled `DORMANT` anywhere in the product).
 */
export function GoalDetailScreen() {
  const S = useSkin();
  const ui = useUI();
  const navigate = useNavigate();
  const { goalId = '' } = useParams();
  const clock = useWeekClock();
  const detailQ = useGoal(goalId);
  const [selected, setSelected] = useState<string | null>(null);

  const detail = detailQ.data;
  const goal = detail?.goal;

  if (detailQ.isPending) return <Loading label="Loading this goal…" />;
  if (detailQ.error || !detail || !goal) {
    return (
      <div style={S.page}>
        <LoadError error={detailQ.error} what="this goal" onRetry={() => void detailQ.refetch()} />
      </div>
    );
  }

  const isLife = goal.horizon === 'Life';
  const isWeekly = goal.horizon === 'Weekly';
  const week = clock.offsetOf(isWeekly ? goal.periodKey : clock.currentMonday);

  return (
    <div style={S.page} data-screen-label="Goal detail">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2, minWidth: 0 }}>
          {/* R-goal-41 — breadcrumbs to the Life root, each ancestor with its own period label (R-goal-35). */}
          <Crumb label="Goals" onClick={() => navigate(lensPath(ui.lastLens))} />
          {detail.ancestors.map((a) => (
            <span key={a.id}>
              <span style={{ color: S.T.border, fontSize: 12.5 }}>/</span>
              <Crumb label={a.title} onClick={() => navigate(goalPath(a.id))} />
            </span>
          ))}
        </div>
        {/*
         * ⚠ **A3 (R-nav-29)** — this page's mapping is now **`+ Task` on a Weekly goal and nothing at any
         * other horizon**, superseding R-nav-25's (`+ Weekly goal` on Monthly, `+ Add` on
         * Yearly/Quarterly, none on Life). R-nav-25's FORM is untouched: at most one primary action.
         *
         * `+ Weekly goal` is **dropped, not moved**: R-goal-48's `Sub-goals` section now offers that
         * create on every horizon that can hold children, a screen-inch below, and keeping both would
         * leave one horizon of four with two routes to the same write (R-nav-27). `More…` inside the
         * capture opens the very sheet this button opened, pre-filled the same way, so nothing is lost.
         */}
        <TopActions>
          {isWeekly && (
            <button type="button" style={S.topBtn} onClick={() => ui.openSheet({ kind: 'taskCreate', goalId: goal.id, weekStart: goal.periodKey })}>
              + Task
            </button>
          )}
        </TopActions>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        <h1 style={{ margin: 0, fontSize: 23, fontWeight: 800, letterSpacing: '-0.01em', color: S.T.ink }}>{goal.title}</h1>
        {/* The horizon chip survives HERE and only here: on a detail page the horizon is ambiguous. */}
        <span style={S.hChip()}>
          {goal.horizon.toUpperCase()}
          {goal.period ? ' · ' + goal.period.toUpperCase() : ''}
        </span>
      </div>
      {goal.why && <div style={{ ...S.serif, fontSize: 17, color: S.body, marginTop: 3 }}>{goal.why}</div>}
      {/* R-goal-47 — the planned-ness line renders on the Monthly goal's page as well as on its card. */}
      {goal.weeklyBreakdown && <div style={{ fontSize: 12.5, color: S.T.mut, marginTop: 4 }}>{plannedNess(goal.weeklyBreakdown)}</div>}
      {goal.plannedAgeWeeks !== null && goal.plannedAgeWeeks >= 2 && (
        <div style={{ fontSize: 12.5, color: S.T.mut, marginTop: 4 }}>{stalePlanLine(goal.plannedAgeWeeks)}</div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <button type="button" style={S.menuBtn} onClick={() => ui.openSheet({ kind: 'goalForm', editId: goal.id, horizon: goal.horizon, periodKey: goal.periodKey })}>
          Edit
        </button>
        {/* R-goal-21 / R-goal-40 — neither a Life goal nor a Weekly goal is re-plannable, for opposite reasons. */}
        {!isLife && !isWeekly && (
          <button type="button" style={S.menuBtn} onClick={() => ui.openSheet({ kind: 'confirmReplan', goalId: goal.id })}>
            Re-plan…
          </button>
        )}
        {!isLife && (
          <button type="button" style={S.menuBtn} onClick={() => ui.openSheet({ kind: 'moveGoal', goalId: goal.id })}>
            Move…
          </button>
        )}
        {/* `aria-label`, because a backlog item on this same page also offers `Delete` (D-20) and two
            controls with one accessible name is a control you cannot ask for. The word is unchanged. */}
        <button type="button" aria-label="Delete this goal" style={S.dangerBtn} onClick={() => ui.openSheet({ kind: 'confirmDeleteGoal', goalId: goal.id })}>
          Delete
        </button>
      </div>

      {/*
       * R-goal-48 — the `Sub-goals` section renders **unconditionally at every horizon that can hold
       * children**, empty or not: hiding it when there are none hides the affordance exactly when it is
       * needed. A Weekly goal is terminal (R-goal-31) so it gets no section — unless it somehow HOLDS
       * children, in which case the list still renders (a data problem must surface) with nothing to add
       * another with.
       */}
      {(!isWeekly || detail.children.length > 0) && (
        <>
          <div style={{ ...S.sectionLabel, margin: '20px 0 8px 0' }}>Sub-goals</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {detail.children.map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => navigate(goalPath(ch.id))}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  textAlign: 'left',
                  background: S.T.card,
                  border: `1px solid ${S.T.line}`,
                  borderRadius: 12,
                  padding: '12px 14px',
                  cursor: 'pointer',
                  minHeight: 48,
                  fontFamily: 'inherit',
                }}
              >
                <span style={S.dot(ch.pulse)} />
                <span style={{ flex: 1, fontSize: 14.5, fontWeight: 700, color: S.T.ink, minWidth: 0 }}>{ch.title}</span>
                <span style={S.hChip()}>{ch.period || ch.horizon.toUpperCase()}</span>
              </button>
            ))}
          </div>
          {detail.children.length === 0 && <div style={{ fontSize: 13, color: S.T.mut, padding: '2px 0' }}>Nothing under this goal yet.</div>}
          {!isWeekly && <AddSubGoal parent={goal} clock={clock} />}
        </>
      )}

      {/* R-goal-41 — a Weekly goal's own tasks, with the same row the lens uses. */}
      {isWeekly && (
        <div style={{ ...S.card, padding: '16px 16px 8px 16px', marginTop: 16 }}>
          <div style={S.sectionLabel}>Tasks</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {detail.tasks.map((t) => (
              <TaskRow key={t.id} t={t} week={week} />
            ))}
            {detail.tasks.length === 0 && <div style={{ fontSize: 13, color: S.T.mut, padding: '10px 0' }}>Nothing on this yet.</div>}
          </div>
        </div>
      )}

      {/* R-backlog-28 — `FROM THE BACKLOG` on a Weekly goal: every open item on any ANCESTOR of it. */}
      {isWeekly && detail.pullList.length > 0 && (
        <div style={{ ...S.card, padding: 16, marginTop: 16 }}>
          <div style={{ ...S.sectionLabel, marginBottom: 8 }}>From the backlog</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {detail.pullList.map((b) => (
              <button
                key={b.id}
                type="button"
                style={S.pickerRow('ok')}
                onClick={() => ui.openSheet({ kind: 'taskCreate', goalId: goal.id, weekStart: goal.periodKey, title: b.title, fromBacklogId: b.id })}
              >
                <span aria-hidden="true" style={{ marginRight: 10, color: S.T.accentLink, fontWeight: 800 }}>
                  +
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>{b.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* R-backlog-11/12 — a non-Life, non-Weekly goal shows its OWN items with the three actions and an
          inline `+ Add`; a Life goal shows the READ-ONLY roll-up of every item on any descendant. A Weekly
          goal holds none at all (R-backlog-2) and shows the pull list instead. */}
      {!isWeekly && (
        <div style={{ ...S.card, padding: 16, marginTop: 16 }}>
          <div style={{ ...S.sectionLabel, marginBottom: 8 }}>
            {detail.backlogIsAggregate ? `Backlog across this line (${detail.backlog.length})` : `Backlog (${detail.backlog.length})`}
          </div>
          {detail.backlogIsAggregate ? (
            /*
             * R-backlog-12 / S-backlog-21-1 — the Life-goal roll-up spans several goals, so it is ordered
             * `capturedAt` desc across all of them and **no reorder affordance is rendered here at all**.
             * A manual order across goals is not defined and must not be invented (R-backlog-21), and a
             * handle on a read-only aggregate would promise one.
             */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {detail.backlog.map((b) => (
                <div key={b.id} style={{ background: S.T.cardSoft, border: `1px solid ${S.T.lineSoft}`, borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ fontSize: 14, color: S.T.ink }}>{b.title}</div>
                  {/* R-backlog-12 — each row is labelled with the goal it actually belongs to. */}
                  <div style={{ fontSize: 12, color: S.T.mut, marginTop: 2 }}>
                    {b.goalTitle} · added {capturedLabel(b.capturedAt)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <OwnBacklog items={detail.backlog} goalTitle={goal.title} selected={selected} onSelect={setSelected} />
          )}
          {detail.backlog.length === 0 && (
            <div style={{ fontSize: 13, color: S.T.mut }}>
              {detail.backlogIsAggregate ? 'Nothing deferred anywhere on this line.' : 'Nothing deferred on this goal.'}
            </div>
          )}
          {detail.backlogIsAggregate ? (
            <button type="button" style={{ ...S.linkBtn, padding: '8px 0 0 0' }} onClick={() => navigate(BACKLOG_PATH)}>
              Open Backlog →
            </button>
          ) : (
            <QuickAdd goalId={goal.id} />
          )}
        </div>
      )}

      {/* R-learning-5 — the learnings on this goal's LIFE ROOT, i.e. the whole line, not just this node. */}
      <div style={{ ...S.sectionLabel, margin: '22px 0 8px 0' }}>Learnings</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {detail.learnings.map((l) => (
          <div key={l.id} style={{ ...S.card, borderRadius: 12, padding: '12px 14px' }}>
            <div style={{ ...S.serif, fontSize: 14, color: S.T.ink }}>“{l.text}”</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span style={{ fontSize: 12, color: S.T.mut }}>Captured {capturedLabel(l.capturedAt)}</span>
              {l.applied && (
                <span style={{ fontSize: 11, fontWeight: 700, color: S.T.accent, background: S.T.accentSoft, borderRadius: 8, padding: '2px 7px', whiteSpace: 'nowrap' }}>
                  changed the plan
                </span>
              )}
            </div>
          </div>
        ))}
        {detail.learnings.length === 0 && <div style={{ fontSize: 13.5, color: S.T.mut, padding: '8px 2px' }}>No learnings attached to this branch yet.</div>}
        <button type="button" style={S.linkBtn} onClick={() => navigate(LEARNINGS_PATH)}>
          See all learnings →
        </button>
      </div>
    </div>
  );
}

function Crumb({ label, onClick }: { label: string; onClick: () => void }) {
  const S = useSkin();
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ minHeight: 36, border: 'none', background: 'none', padding: '0 2px', fontSize: 12.5, fontWeight: 700, color: S.T.mut, cursor: 'pointer', fontFamily: 'inherit' }}
    >
      {label}
    </button>
  );
}

/**
 * R-backlog-11 + R-backlog-17 — one goal's OWN items, which is one goal, which is the one scope a manual
 * order exists in (R-backlog-21). Same list component, same command and same announcements as the Backlog
 * page: there is one reorder implementation in this app and this is its second caller.
 */
function OwnBacklog({
  items,
  goalTitle,
  selected,
  onSelect,
}: {
  items: BacklogItemView[];
  goalTitle: string;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const list = useReorderList({ items, goalTitle });
  return (
    <div data-reorder-list={items[0]?.goalId ?? ''} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {list.liveRegion}
      {list.error && <FieldError>{list.error}</FieldError>}
      {list.order.map((b) => (
        <BacklogItemCard
          key={b.id}
          item={b}
          selected={selected === b.id}
          onSelect={onSelect}
          reorder={{ control: list.controlProps(b), menu: list.menuFor(b), grabbed: list.grabbedId === b.id }}
        />
      ))}
    </div>
  );
}

/**
 * R-goal-48 — the inline `+ Sub-goal` capture, deliberately the same shape as R-backlog-11's `+ Add` one
 * section below: it opens in place, `Enter` or `Save sub-goal` commits, `Never mind` cancels, and focus
 * returns to the control that opened it either way. Consistency on one screen beats novelty, and it
 * sidesteps R-nav-25's one-primary-action rule rather than fighting it (R-nav-29).
 *
 * It is named `+ Sub-goal` and not `+ Add` because the backlog's `+ Add` is on this same page, and two
 * controls with one accessible name is a control you cannot ask for (D-20).
 *
 * **Everything the page already knows is pre-filled.** The parent is this goal; the horizon is the legal
 * set and is not asked at all when that set has one member; the period follows the horizon. **The horizon
 * rule itself stays the server's** — this reads the shared `HORIZONS` order to SHAPE the picker and never
 * restates the comparison, and a `HORIZON_CONFLICT` or `PERIOD_IN_PAST` refusal renders under the field
 * (D-5 — a picker is a hint, not an invariant).
 */
function AddSubGoal({ parent, clock }: { parent: GoalView; clock: WeekClock }) {
  const S = useSkin();
  const ui = useUI();
  const create = useCreateGoal();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const toggle = useRef<HTMLButtonElement>(null);

  // R-goal-5 / R-goal-32 — every horizon of strictly higher rank, longest first, so `[0]` is the next
  // shorter one. Non-empty by construction: this component is not rendered on a Weekly goal.
  const legal = childHorizons(parent.horizon);
  const [horizon, setHorizon] = useState<Horizon>(legal[0] ?? 'Weekly');
  const periodKey = subGoalPeriodKey(horizon, parent.horizon, parent.periodKey, clock.today, clock.currentMonday);

  const close = () => {
    setOpen(false);
    toggle.current?.focus();
  };

  const commit = () => {
    const title = text.trim();
    // The key must be real before anything is written: a Weekly child waits for the server's Monday.
    if (!title || !periodKey) return;
    create.mutate(
      { title, why: '', horizon, parentId: parent.id, periodKey, pulse: 'On track' },
      {
        onSuccess: () => {
          setText('');
          close();
        },
      },
    );
  };

  return (
    <div style={{ marginTop: 10 }}>
      {open && (
        <>
          {/* One legal horizon is not a question (R-goal-48): a Monthly goal can only hold weeks. */}
          {legal.length > 1 && (
            <div role="group" aria-label="Sub-goal horizon" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {legal.map((h) => (
                <button key={h} type="button" aria-pressed={horizon === h} style={S.chipBtn(horizon === h)} onClick={() => setHorizon(h)}>
                  {h}
                </button>
              ))}
            </div>
          )}
          <input
            aria-label="Sub-goal title"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
            placeholder={`${horizon} sub-goal…`}
            autoFocus
            style={{ ...S.input, minHeight: 44, borderRadius: 10, fontSize: 14, background: S.T.cardSoft }}
          />
        </>
      )}
      <FieldError>{commandError(create.error)}</FieldError>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <button
          ref={toggle}
          type="button"
          style={{ ...S.linkBtn, padding: '4px 0' }}
          disabled={create.isPending}
          onClick={() => {
            if (open && text.trim()) commit();
            else if (open) close();
            else {
              setOpen(true);
              setText('');
            }
          }}
        >
          {/*
           * Name the child by its horizon when there is only ONE legal choice, so a Monthly goal reads
           * `+ Weekly goal`. R-nav-29 dropped `+ Weekly goal` from TopActions in favour of this control,
           * and a flat `+ Sub-goal` would leave the words "weekly goal" nowhere on the page for what is
           * the most-used write in the product — the owner's whole model is "weekly goals", not
           * "sub-goals". Where several horizons are legal the choice is the picker's, so the generic
           * word is the honest one; naming `legal[0]` there would advertise one option out of four.
           */}
          {open ? (text.trim() ? 'Save sub-goal' : 'Never mind') : legal.length === 1 ? `+ ${legal[0]} goal` : '+ Sub-goal'}
        </button>
        {/* R-goal-48 — the way out to the full form, carrying across what has already been typed. */}
        {open && (
          <button
            type="button"
            style={{ ...S.linkBtn, padding: '4px 0', color: S.T.mut }}
            onClick={() => {
              setOpen(false);
              ui.openSheet({ kind: 'goalForm', editId: null, horizon, periodKey, parentId: parent.id, lifeGoalId: parent.lifeRootId, title: text.trim() });
            }}
          >
            More…
          </button>
        )}
      </div>
    </div>
  );
}

/** R-backlog-11 — the inline `+ Add` quick capture. Enter or `Save item` commits; `Never mind` cancels. */
function QuickAdd({ goalId }: { goalId: string }) {
  const S = useSkin();
  const create = useCreateBacklogItem();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  const commit = () => {
    if (!text.trim()) return;
    create.mutate(
      { goalId, title: text.trim(), description: '', links: [] },
      {
        onSuccess: () => {
          setText('');
          setOpen(false);
        },
      },
    );
  };

  return (
    <>
      {open && (
        <input
          aria-label="Backlog item"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          placeholder="Backlog item…"
          autoFocus
          style={{ ...S.input, minHeight: 44, borderRadius: 10, fontSize: 14, background: S.T.cardSoft, marginTop: 10 }}
        />
      )}
      <FieldError>{commandError(create.error)}</FieldError>
      <button
        type="button"
        style={{ ...S.linkBtn, padding: '8px 0 0 0' }}
        disabled={create.isPending}
        onClick={() => {
          if (open && text.trim()) commit();
          else {
            setOpen(!open);
            setText('');
          }
        }}
      >
        {open ? (text.trim() ? 'Save item' : 'Never mind') : '+ Add'}
      </button>
    </>
  );
}
