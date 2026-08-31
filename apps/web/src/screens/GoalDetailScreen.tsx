import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useUI } from '../context/UIContext';
import { useCreateBacklogItem, useGoal } from '../api/queries';
import { useWeekClock } from '../lib/weekClock';
import { TaskRow } from '../components/TaskRow';
import { BacklogItemCard } from '../components/BacklogItemCard';
import { TopActions } from '../components/TopActions';
import { FieldError, Loading, LoadError, commandError } from '../components/states';
import { useSkin } from '../skin';
import { capturedLabel } from '../utils/dates';
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
         * R-nav-25 — one primary action per page, and the mapping is the horizon's: `+ Weekly goal` on a
         * Monthly goal (Q-20 — a detail page is not a lens, so this is where laying out a week from above
         * still lives), `+ Task` on a Weekly goal, `+ Add` on Yearly/Quarterly, none on Life.
         */}
        <TopActions>
          {goal.horizon === 'Monthly' && (
            <button
              type="button"
              style={S.topBtn}
              onClick={() =>
                ui.openSheet({
                  kind: 'goalForm',
                  editId: null,
                  horizon: 'Weekly',
                  periodKey: clock.currentMonday ?? '',
                  parentId: goal.id,
                  lifeGoalId: goal.lifeRootId,
                })
              }
            >
              + Weekly goal
            </button>
          )}
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
        <span style={S.hChip(false)}>
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

      {detail.children.length > 0 && (
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
                <span style={S.dot(ch.pulse, false)} />
                <span style={{ flex: 1, fontSize: 14.5, fontWeight: 700, color: S.T.ink, minWidth: 0 }}>{ch.title}</span>
                <span style={S.hChip(false)}>{ch.period || ch.horizon.toUpperCase()}</span>
              </button>
            ))}
          </div>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {detail.backlog.map((b) =>
              detail.backlogIsAggregate ? (
                <div key={b.id} style={{ background: S.T.cardSoft, border: `1px solid ${S.T.lineSoft}`, borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ fontSize: 14, color: S.T.ink }}>{b.title}</div>
                  <div style={{ fontSize: 12, color: S.T.mut, marginTop: 2 }}>added {capturedLabel(b.capturedAt)}</div>
                </div>
              ) : (
                <BacklogItemCard key={b.id} item={b} selected={selected === b.id} onSelect={setSelected} />
              ),
            )}
            {detail.backlog.length === 0 && (
              <div style={{ fontSize: 13, color: S.T.mut }}>
                {detail.backlogIsAggregate ? 'Nothing deferred anywhere on this line.' : 'Nothing deferred on this goal.'}
              </div>
            )}
          </div>
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
