import { useStore } from '../store';
import { TopActions } from '../components/TopActions';
import { GoalChipRow } from '../components/GoalModals';
import { card, chipBtn, colors, dangerBtn, eyebrow, h1, input, menuBtn, page, saveBtn, sectionLabel, serif } from '../ui';
import type { Idea, Learning } from '../types';

function groupByGoal<T extends { goalId: string | null }>(s: ReturnType<typeof useStore>, list: T[]) {
  const groups: { title: string; items: T[] }[] = [];
  s.lifeGoals().forEach((lg) => {
    const items = list.filter((x) => x.goalId && s.node(x.goalId) && s.rootOf(s.node(x.goalId)!).id === lg.id);
    if (items.length) groups.push({ title: lg.title, items });
  });
  const un = list.filter((x) => !x.goalId || !s.node(x.goalId));
  if (un.length) groups.push({ title: 'Unsorted', items: un });
  return groups;
}

export function IdeasScreen() {
  const s = useStore();
  const st = s.st;
  const groups = groupByGoal(s, st.parking);
  return (
    <div style={page} data-screen-label="Ideas">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={eyebrow}>Parking lot</div>
          <h1 style={{ ...h1, margin: '2px 0 12px 0' }}>Ideas</h1>
        </div>
        <TopActions />
      </div>
      <div style={{ ...card, padding: 14 }}>
        <input
          value={st.ideaText}
          onChange={(e) => s.set({ ideaText: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && s.saveIdea()}
          placeholder="Park an idea…"
          style={{ ...input, background: colors.cardSoft }}
        />
        <GoalChipRow value={st.ideaGoal} onPick={(id) => s.set({ ideaGoal: id })} />
        <button style={saveBtn(!st.ideaText.trim())} disabled={!st.ideaText.trim()} onClick={() => s.saveIdea()}>
          Park it
        </button>
      </div>
      {st.parking.length === 0 && (
        <div style={{ textAlign: 'center', padding: '44px 24px' }}>
          <div style={{ ...serif, fontSize: 18, color: '#4a4a44' }}>Nothing parked.</div>
          <div style={{ fontSize: 13.5, color: colors.mut, marginTop: 6 }}>When an idea grabs you mid-task, drop it here and get back to work.</div>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 20 }}>
        {groups.map((grp) => (
          <div key={grp.title}>
            <div style={{ ...sectionLabel, marginBottom: 7 }}>{grp.title}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {grp.items.map((it: Idea) => {
                const sel = st.selIdea === it.id;
                const firstActive = s.activeLeaves()[0];
                return (
                  <div key={it.id} style={{ background: '#fff', borderRadius: 12, padding: '12px 14px', border: `1px solid ${sel ? 'oklch(0.75 0.06 125)' : colors.line}` }}>
                    <button onClick={() => s.set({ selIdea: sel ? null : it.id, ideaAttach: false })} style={{ width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: 0, cursor: 'pointer', minHeight: 44 }}>
                      <div style={{ fontSize: 14.5, color: colors.ink }}>{it.text}</div>
                      <div style={{ fontSize: 12, color: colors.mut, marginTop: 3 }}>Parked {it.when}</div>
                    </button>
                    {sel && st.ideaAttach && (
                      <>
                        <div style={{ fontSize: 12, fontWeight: 700, color: colors.mut, marginTop: 8 }}>SEND TO WHICH GOAL'S BACKLOG?</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                          {s.nonLife().map((g) => (
                            <button key={g.id} style={chipBtn(false)} onClick={() => s.ideaToBacklog(it, g.id)}>
                              {g.title}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    {sel && !st.ideaAttach && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                        <button
                          style={menuBtn}
                          onClick={() => {
                            s.set({ parking: st.parking.filter((x) => x.id !== it.id), selIdea: null });
                            s.openTaskCreate(firstActive ? firstActive.id : 'g4', { title: it.text, fromIdea: true });
                          }}
                        >
                          Task this week
                        </button>
                        <button style={menuBtn} onClick={() => s.set({ ideaAttach: true })}>Attach to a goal</button>
                        <button style={dangerBtn} onClick={() => s.set({ parking: st.parking.filter((x) => x.id !== it.id), selIdea: null })}>Delete</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LearningsScreen() {
  const s = useStore();
  const st = s.st;
  const groups = groupByGoal(s, st.learnings);
  return (
    <div style={page} data-screen-label="Learnings">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={eyebrow}>Insights</div>
          <h1 style={{ ...h1, margin: '2px 0 12px 0' }}>Learnings</h1>
        </div>
        <TopActions />
      </div>
      <div style={{ ...card, padding: 14 }}>
        <input
          value={st.learnText}
          onChange={(e) => s.set({ learnText: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && s.saveLearning()}
          placeholder="What did you learn?"
          style={{ ...input, background: colors.cardSoft }}
        />
        <GoalChipRow value={st.learnGoal} onPick={(id) => s.set({ learnGoal: id })} />
        <button style={saveBtn(!st.learnText.trim())} disabled={!st.learnText.trim()} onClick={() => s.saveLearning()}>
          Capture it
        </button>
      </div>
      {st.learnings.length === 0 && (
        <div style={{ textAlign: 'center', padding: '44px 24px' }}>
          <div style={{ ...serif, fontSize: 18, color: '#4a4a44' }}>No learnings yet.</div>
          <div style={{ fontSize: 13.5, color: colors.mut, marginTop: 6 }}>When reality surprises you, write it down — future-you will use it.</div>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 20 }}>
        {groups.map((grp) => (
          <div key={grp.title}>
            <div style={{ ...sectionLabel, marginBottom: 7 }}>{grp.title}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {grp.items.map((it: Learning) => {
                const sel = st.selLearn === it.id;
                return (
                  <div key={it.id} style={{ background: '#fff', borderRadius: 12, padding: '12px 14px', border: `1px solid ${sel ? 'oklch(0.75 0.06 125)' : colors.line}` }}>
                    <button onClick={() => s.set({ selLearn: sel ? null : it.id, learnAttach: false })} style={{ width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: 0, cursor: 'pointer', minHeight: 44 }}>
                      <div style={{ ...serif, fontSize: 14.5, color: colors.ink }}>“{it.text}”</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                        <span style={{ fontSize: 12, color: colors.mut }}>Captured {it.when}</span>
                        {it.applied && (
                          <span style={{ fontSize: 11, fontWeight: 700, color: colors.accent, background: colors.accentSoft, borderRadius: 8, padding: '2px 7px', whiteSpace: 'nowrap' }}>
                            changed the plan
                          </span>
                        )}
                      </div>
                    </button>
                    {sel && st.learnAttach && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                        {[{ id: '', title: 'No goal' }, ...s.lifeGoals()].map((g) => (
                          <button key={g.id || 'none'} style={chipBtn(false)} onClick={() => s.set({ learnings: st.learnings.map((x) => (x.id === it.id ? { ...x, goalId: g.id || null } : x)), selLearn: null, learnAttach: false })}>
                            {g.title}
                          </button>
                        ))}
                      </div>
                    )}
                    {sel && !st.learnAttach && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                        <button style={menuBtn} onClick={() => s.set({ learnAttach: true })}>Attach to a goal</button>
                        <button style={dangerBtn} onClick={() => s.set({ learnings: st.learnings.filter((x) => x.id !== it.id), selLearn: null })}>Discard</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
