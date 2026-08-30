import { useStore } from '../store';
import { TaskRow } from '../components/TaskRow';
import { card, colors, dangerBtn, dot, hChip, linkBtn, menuBtn, page, sectionLabel, serif } from '../ui';
import { isActive, isLeaf, subtreeActive } from '../utils/tree';

export function GoalDetailScreen() {
  const s = useStore();
  const st = s.st;
  const lg = s.node(st.lineId) ?? s.lifeGoals()[0];
  if (!lg) return null;
  const kids = s.children(lg.id);
  const isLife = !lg.parentId;
  const backlogHere = st.backlog.filter((b) => b.goalId === lg.id);
  const aggBacklog = st.backlog.filter((b) => s.descendants(lg.id).includes(b.goalId));
  const learnings = st.learnings.filter((l) => l.goalId && s.node(l.goalId) && s.rootOf(s.node(l.goalId)!).id === s.rootOf(lg).id);
  const tasks = st.tasks.filter((t) => t.goalId === lg.id && s.visibleIn(t, 0));

  return (
    <div style={page} data-screen-label="Goal detail">
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2, marginBottom: 6 }}>
        <button style={{ minHeight: 36, border: 'none', background: 'none', padding: '0 2px', fontSize: 12.5, fontWeight: 700, color: colors.mut, cursor: 'pointer' }} onClick={() => s.set({ view: 'goals' })}>
          Goals
        </button>
        {s.ancestors(lg).map((a) => (
          <span key={a.id}>
            <span style={{ color: '#cfcfc8', fontSize: 12.5 }}>/</span>
            <button style={{ minHeight: 36, border: 'none', background: 'none', padding: '0 2px', fontSize: 12.5, fontWeight: 700, color: colors.mut, cursor: 'pointer' }} onClick={() => s.set({ view: 'line', lineId: a.id })}>
              {a.title}
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 23, fontWeight: 800, letterSpacing: '-0.01em' }}>{lg.title}</h1>
        <span style={hChip(isActive(st.goals, lg))}>
          {lg.horizon.toUpperCase()}
          {lg.period ? ' · ' + lg.period.toUpperCase() : ''}
        </span>
      </div>
      {lg.why && <div style={{ ...serif, fontSize: 17, color: '#4a4a44', marginTop: 3 }}>{lg.why}</div>}

      {kids.length > 0 && (
        <>
          <div style={{ ...sectionLabel, margin: '20px 0 8px 0' }}>Sub-goals</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {kids.map((ch) => {
              const leaf = isLeaf(st.goals, ch);
              const act = isActive(st.goals, ch);
              return (
                <button key={ch.id} onClick={() => s.set({ view: 'line', lineId: ch.id })} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', background: '#fff', border: `1px solid ${colors.line}`, borderRadius: 12, padding: '12px 14px', cursor: 'pointer', minHeight: 48 }}>
                  <span style={dot(ch.pulse, !subtreeActive(st.goals, ch))} />
                  <span style={{ flex: 1, fontSize: 14.5, fontWeight: 700, color: colors.ink, minWidth: 0 }}>{ch.title}</span>
                  <span style={hChip(act)}>{ch.horizon.toUpperCase()}</span>
                  {leaf && <span style={{ fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', color: act ? colors.accent : colors.faint }}>{act ? 'active' : 'dormant'}</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
      {lg.horizon !== 'Monthly' && (
        <button style={linkBtn} onClick={() => s.openGoalModal({ parentId: lg.id })}>+ Add sub-goal</button>
      )}

      {isActive(st.goals, lg) && (
        <div style={{ ...card, padding: '16px 16px 8px 16px', marginTop: 16 }}>
          <div style={sectionLabel}>Weekly focus</div>
          <div style={{ ...serif, fontSize: 19, color: '#2a2a26', margin: '4px 0 10px 0' }}>{lg.focus}</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {tasks.map((t) => (
              <TaskRow key={t.id} t={t} week={0} />
            ))}
          </div>
          <button style={{ ...linkBtn, width: '100%', padding: '8px 0' }} onClick={() => s.openTaskCreate(lg.id)}>+ Task</button>
        </div>
      )}
      {isLeaf(st.goals, lg) && !!lg.parentId && !isActive(st.goals, lg) && (
        <div style={{ background: '#fff', border: '1px dashed #d8d8d2', borderRadius: 16, padding: 18, marginTop: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: '#a0a099', letterSpacing: '0.04em' }}>DORMANT</div>
          <div style={{ fontSize: 13.5, color: colors.mut, marginTop: 4 }}>No weekly focus this week. Activate it in weekly planning.</div>
        </div>
      )}

      {!isLife && (
        <div style={{ ...card, padding: 16, marginTop: 16 }}>
          <div style={{ ...sectionLabel, marginBottom: 8 }}>Backlog ({backlogHere.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {backlogHere.map((b) => (
              <div key={b.id} style={{ background: colors.cardSoft, borderRadius: 10, padding: '10px 12px', border: `1px solid ${st.selBacklog === b.id ? 'oklch(0.75 0.06 125)' : colors.lineSoft}` }}>
                <button onClick={() => s.set({ selBacklog: st.selBacklog === b.id ? null : b.id, blMoving: false })} style={{ width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: 0, cursor: 'pointer', minHeight: 40 }}>
                  <div style={{ fontSize: 14, color: colors.ink }}>{b.title}</div>
                  <div style={{ fontSize: 12, color: colors.mut, marginTop: 2 }}>Added {b.when}</div>
                </button>
                {st.selBacklog === b.id && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                    <button style={menuBtn} onClick={() => s.pullToWeek(b)}>Add to this week</button>
                    <button style={dangerBtn} onClick={() => s.deleteBacklogItem(b.id)}>Delete</button>
                  </div>
                )}
              </div>
            ))}
            {backlogHere.length === 0 && <div style={{ fontSize: 13, color: colors.mut }}>Nothing deferred on this goal.</div>}
          </div>
          {st.lineBlAdding && (
            <input
              value={st.lineBlText}
              onChange={(e) => s.set({ lineBlText: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && st.lineBlText.trim()) {
                  s.addBacklogItem(lg.id, st.lineBlText);
                  s.set({ lineBlText: '', lineBlAdding: false });
                }
              }}
              placeholder="Backlog item…"
              autoFocus
              style={{ width: '100%', minHeight: 44, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '0 12px', fontSize: 14, background: colors.cardSoft, marginTop: 10 }}
            />
          )}
          <button
            style={{ ...linkBtn, padding: '8px 0 0 0' }}
            onClick={() => {
              if (st.lineBlAdding && st.lineBlText.trim()) {
                s.addBacklogItem(lg.id, st.lineBlText);
                s.set({ lineBlText: '', lineBlAdding: false });
              } else {
                s.set({ lineBlAdding: !st.lineBlAdding, lineBlText: '' });
              }
            }}
          >
            {st.lineBlAdding ? (st.lineBlText.trim() ? 'Save item' : 'Never mind') : '+ Add'}
          </button>
        </div>
      )}
      {isLife && (
        <div style={{ ...card, padding: 16, marginTop: 16 }}>
          <div style={{ ...sectionLabel, marginBottom: 8 }}>Backlog across this line ({aggBacklog.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {aggBacklog.map((b) => (
              <div key={b.id} style={{ background: colors.cardSoft, border: `1px solid ${colors.lineSoft}`, borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 14, color: colors.ink }}>{b.title}</div>
                <div style={{ fontSize: 12, color: colors.mut, marginTop: 2 }}>
                  {s.node(b.goalId)?.title} · added {b.when}
                </div>
              </div>
            ))}
            {aggBacklog.length === 0 && <div style={{ fontSize: 13, color: colors.mut }}>Nothing deferred anywhere on this line.</div>}
          </div>
          <button style={{ ...linkBtn, padding: '8px 0 0 0' }} onClick={() => s.set({ view: 'backlog' })}>Open Backlog →</button>
        </div>
      )}

      <div style={{ ...sectionLabel, margin: '22px 0 8px 0' }}>Learnings</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {learnings.map((l) => (
          <div key={l.id} style={{ ...card, borderRadius: 12, padding: '12px 14px' }}>
            <div style={{ ...serif, fontSize: 14 }}>“{l.text}”</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span style={{ fontSize: 12, color: colors.mut }}>Captured {l.when}</span>
              {l.applied && (
                <span style={{ fontSize: 11, fontWeight: 700, color: colors.accent, background: colors.accentSoft, borderRadius: 8, padding: '2px 7px', whiteSpace: 'nowrap' }}>
                  changed the plan
                </span>
              )}
            </div>
          </div>
        ))}
        {learnings.length === 0 && <div style={{ fontSize: 13.5, color: colors.mut, padding: '8px 2px' }}>No learnings attached to this branch yet.</div>}
        <button style={linkBtn} onClick={() => s.set({ view: 'learn' })}>See all learnings →</button>
      </div>
    </div>
  );
}
