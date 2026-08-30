import { useStore } from '../store';
import { TopActions } from '../components/TopActions';
import { checkBox, chipBtn, colors, eyebrow, h1, page, saveBtn, sectionLabel } from '../ui';

export function PlanScreen() {
  const s = useStore();
  const st = s.st;
  const groups = s
    .lifeGoals()
    .map((lg) => ({
      id: lg.id,
      title: lg.title,
      leaves: s.leaves().filter((l) => s.rootOf(l).id === lg.id),
    }))
    .filter((g) => g.leaves.length)
    .filter((g) => !st.planFilter || g.id === st.planFilter);

  return (
    <div style={page} data-screen-label="Weekly planning">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={eyebrow}>Edit plan</div>
          <h1 style={{ ...h1, marginTop: 2 }}>Weekly planning</h1>
        </div>
        <TopActions />
      </div>
      <div style={{ fontSize: 13.5, color: colors.mut, margin: '6px 0 12px 0' }}>
        Check the branches that are active this week, one focus sentence each. Unchecked branches go dormant.
      </div>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 14 }}>
        <button style={chipBtn(st.planFilter === '')} onClick={() => s.set({ planFilter: '' })}>All</button>
        {s.lifeGoals().map((g) => (
          <button key={g.id} style={chipBtn(st.planFilter === g.id)} onClick={() => s.set({ planFilter: g.id })}>
            {g.title}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {groups.map((grp) => (
          <div key={grp.id}>
            <div style={{ ...sectionLabel, marginBottom: 7 }}>{grp.title}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {grp.leaves.map((l) => {
                const checked = s.planChecked(l);
                const chainIds = [l.id, ...s.ancestors(l).map((x) => x.id)];
                const pool = st.backlog.filter((b) => chainIds.includes(b.goalId));
                return (
                  <div key={l.id} style={{ background: '#fff', border: `1px solid ${colors.line}`, borderRadius: 12, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
                      <button style={checkBox(checked)} onClick={() => s.set({ plChecked: { ...st.plChecked, [l.id]: !checked } })}>
                        {checked ? '✓' : ''}
                      </button>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>{l.title}</div>
                        <div style={{ fontSize: 11.5, color: colors.mut, marginTop: 1 }}>
                          {s.pathOf(l).slice(1, -1).join(' › ') || grp.title}
                        </div>
                      </div>
                    </div>
                    {checked && (
                      <>
                        <textarea
                          value={s.planDraft(l)}
                          onChange={(e) => s.set({ plDrafts: { ...st.plDrafts, [l.id]: e.target.value } })}
                          rows={2}
                          placeholder="This week's focus — one sentence"
                          style={{ width: '100%', marginTop: 10, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '10px 12px', fontSize: 15, fontFamily: "'Newsreader', serif", fontStyle: 'italic', background: colors.cardSoft, resize: 'none' }}
                        />
                        {pool.length > 0 && (
                          <>
                            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: colors.mut, margin: '10px 0 6px 0' }}>FROM THE BACKLOG</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                              {pool.map((b) => (
                                <button
                                  key={b.id}
                                  onClick={() => s.openTaskCreate(l.id, { title: b.title, fromBacklog: b.id })}
                                  style={{ textAlign: 'left', border: '1px dashed #d8d8d2', borderRadius: 10, background: colors.cardSoft, padding: '9px 12px', fontSize: 13.5, color: '#4a4a44', cursor: 'pointer', minHeight: 40 }}
                                >
                                  + {b.title}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <button style={saveBtn(false)} onClick={() => s.savePlan()}>
        Save plan
      </button>
    </div>
  );
}
