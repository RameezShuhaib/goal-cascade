import { useState } from 'react';
import { useUI } from '../context/UIContext';
import { useCreateBacklogItem, useGoal, useGoals, useTasks } from '../api/queries';
import { TaskRow } from '../components/TaskRow';
import { BacklogItemCard } from '../components/BacklogItemCard';
import { FieldError, Loading, LoadError, commandError } from '../components/states';
import { useSkin } from '../skin';
import { capturedLabel } from '../utils/dates';
import { node } from '../utils/tree';

/**
 * R-goal-27 — one goal, in one request: the goal, its ancestors (root → parent, for the breadcrumb), its
 * children with per-child active/dormant labels, its backlog, and the learnings on its whole Life line.
 *
 * R-backlog-11/12 — the backlog block is two different things and the SERVER says which: a non-Life goal
 * gets its own items with the three actions and an inline `+ Add`; a Life goal gets a READ-ONLY roll-up of
 * every item on any descendant, labelled by owning goal, with no per-item action at all.
 */
export function GoalDetailScreen() {
  const S = useSkin();
  const ui = useUI();
  const detailQ = useGoal(ui.goalId, 0);
  const goalsQ = useGoals(0);
  const goals = goalsQ.data?.goals ?? [];
  const [selected, setSelected] = useState<string | null>(null);

  const detail = detailQ.data;
  const goal = detail?.goal;
  // Only an active leaf can hold work, so only then is the task list worth a request (R-goal-12).
  const tasksQ = useTasks(0, goal?.isActive ? goal.id : undefined);

  if (!ui.goalId) return null;
  if (detailQ.isPending) return <Loading label="Loading this goal…" />;
  if (detailQ.error || !detail || !goal) {
    return (
      <div style={S.page}>
        <LoadError error={detailQ.error} what="this goal" onRetry={() => void detailQ.refetch()} />
      </div>
    );
  }

  const isLife = goal.parentId === null;
  const tasks = goal.isActive ? (tasksQ.data?.tasks ?? []).filter((t) => t.goalId === goal.id) : [];

  return (
    <div style={S.page} data-screen-label="Goal detail">
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2, marginBottom: 6 }}>
        <Crumb label="Goals" onClick={() => ui.setScreen('goals')} />
        {detail.ancestors.map((a) => (
          <span key={a.id}>
            <span style={{ color: S.T.border, fontSize: 12.5 }}>/</span>
            <Crumb label={a.title} onClick={() => ui.openGoal(a.id)} />
          </span>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 23, fontWeight: 800, letterSpacing: '-0.01em', color: S.T.ink }}>{goal.title}</h1>
        <span style={S.hChip(goal.isActive)}>
          {goal.horizon.toUpperCase()}
          {goal.period ? ' · ' + goal.period.toUpperCase() : ''}
        </span>
      </div>
      {goal.why && <div style={{ ...S.serif, fontSize: 17, color: S.body, marginTop: 3 }}>{goal.why}</div>}

      {detail.children.length > 0 && (
        <>
          <div style={{ ...S.sectionLabel, margin: '20px 0 8px 0' }}>Sub-goals</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {detail.children.map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => ui.openGoal(ch.id)}
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
                <span style={S.dot(ch.pulse, !ch.subtreeActive)} />
                <span style={{ flex: 1, fontSize: 14.5, fontWeight: 700, color: S.T.ink, minWidth: 0 }}>{ch.title}</span>
                <span style={S.hChip(ch.isActive)}>{ch.horizon.toUpperCase()}</span>
                {ch.isLeaf && (
                  <span style={{ fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', color: ch.isActive ? S.T.accent : S.T.faint }}>
                    {ch.isActive ? 'active' : 'dormant'}
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
      {/* R-goal-6 — Monthly is terminal, so the affordance is absent here as well as on the tree row. */}
      {goal.horizon !== 'Monthly' && (
        <button type="button" style={S.linkBtn} onClick={() => ui.openSheet({ kind: 'goalForm', editId: null, parentId: goal.id })}>
          + Add sub-goal
        </button>
      )}

      {goal.isActive && (
        <div style={{ ...S.card, padding: '16px 16px 8px 16px', marginTop: 16 }}>
          <div style={S.sectionLabel}>Weekly focus</div>
          <div style={{ ...S.serif, fontSize: 19, color: S.quote, margin: '4px 0 10px 0' }}>{goal.focus}</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {tasks.map((t) => (
              <TaskRow key={t.id} t={t} />
            ))}
          </div>
          <button
            type="button"
            style={{ ...S.linkBtn, width: '100%', padding: '8px 0' }}
            onClick={() => ui.openSheet({ kind: 'taskCreate', goalId: goal.id })}
          >
            + Task
          </button>
        </div>
      )}
      {/* R-goal-10 — dormant reads as intentional: a stated fact and where to change it, not an error. */}
      {goal.dormant && (
        <div style={{ ...S.dashed, padding: 18, marginTop: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: S.T.faint, letterSpacing: '0.04em' }}>DORMANT</div>
          <div style={{ fontSize: 13.5, color: S.T.mut, marginTop: 4 }}>No weekly focus this week. Activate it in weekly planning.</div>
        </div>
      )}

      {!isLife && (
        <div style={{ ...S.card, padding: 16, marginTop: 16 }}>
          <div style={{ ...S.sectionLabel, marginBottom: 8 }}>Backlog ({detail.backlog.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {detail.backlog.map((b) => (
              <BacklogItemCard key={b.id} item={b} goals={goals} selected={selected === b.id} onSelect={setSelected} />
            ))}
            {detail.backlog.length === 0 && <div style={{ fontSize: 13, color: S.T.mut }}>Nothing deferred on this goal.</div>}
          </div>
          <QuickAdd goalId={goal.id} />
        </div>
      )}

      {isLife && (
        <div style={{ ...S.card, padding: 16, marginTop: 16 }}>
          <div style={{ ...S.sectionLabel, marginBottom: 8 }}>Backlog across this line ({detail.backlog.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {detail.backlog.map((b) => (
              // R-backlog-12 — read-only. No add-to-week, no move, no delete: only `Open Backlog →`.
              <div key={b.id} style={{ background: S.T.cardSoft, border: `1px solid ${S.T.lineSoft}`, borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 14, color: S.T.ink }}>{b.title}</div>
                <div style={{ fontSize: 12, color: S.T.mut, marginTop: 2 }}>
                  {node(goals, b.goalId)?.title ?? 'A sub-goal'} · added {capturedLabel(b.capturedAt)}
                </div>
              </div>
            ))}
            {detail.backlog.length === 0 && <div style={{ fontSize: 13, color: S.T.mut }}>Nothing deferred anywhere on this line.</div>}
          </div>
          <button type="button" style={{ ...S.linkBtn, padding: '8px 0 0 0' }} onClick={() => ui.setScreen('backlog')}>
            Open Backlog →
          </button>
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
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: S.T.accent,
                    background: S.T.accentSoft,
                    borderRadius: 8,
                    padding: '2px 7px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  changed the plan
                </span>
              )}
            </div>
          </div>
        ))}
        {detail.learnings.length === 0 && (
          <div style={{ fontSize: 13.5, color: S.T.mut, padding: '8px 2px' }}>No learnings attached to this branch yet.</div>
        )}
        <button type="button" style={S.linkBtn} onClick={() => ui.setScreen('learnings')}>
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
 * R-backlog-11 — the inline `+ Add` quick capture. Enter or `Save item` commits; `Never mind` cancels.
 *
 * The draft is this component's own state. The mockup kept `lineBlText` in the global store, so every
 * keystroke re-rendered every screen.
 */
function QuickAdd({ goalId }: { goalId: string }) {
  const S = useSkin();
  const create = useCreateBacklogItem();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  const commit = () => {
    // R-backlog-16 — a whitespace-only title is refused; the server answers 422 and the button is disabled.
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
