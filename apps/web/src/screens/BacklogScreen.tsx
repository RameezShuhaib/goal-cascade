import { useStore } from '../store';
import { TopActions } from '../components/TopActions';
import { chipBtn, colors, dangerBtn, eyebrow, h1, menuBtn, page, sectionLabel, serif, topBtn } from '../ui';

export function BacklogScreen() {
  const s = useStore();
  const st = s.st;
  const groups: { title: string; items: typeof st.backlog }[] = [];
  s.lifeGoals().forEach((lg) => {
    s.nonLife()
      .filter((g) => s.rootOf(g).id === lg.id)
      .forEach((g) => {
        const items = st.backlog.filter((b) => b.goalId === g.id);
        if (items.length) groups.push({ title: `${lg.title} › ${g.title}`, items });
      });
  });

  return (
    <div style={page} data-screen-label="Backlog">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={eyebrow}>Deferred work</div>
          <h1 style={{ ...h1, marginTop: 2 }}>Backlog</h1>
        </div>
        <TopActions>
          <button style={topBtn} onClick={() => s.openBacklogDrawer()}>+ Add</button>
        </TopActions>
      </div>
      {st.backlog.length === 0 && (
        <div style={{ textAlign: 'center', padding: '44px 24px' }}>
          <div style={{ ...serif, fontSize: 18, color: '#4a4a44' }}>Nothing in the backlog.</div>
          <div style={{ fontSize: 13.5, color: colors.mut, marginTop: 6 }}>Future work lives here until you pull it into a week.</div>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 20 }}>
        {groups.map((grp) => (
          <div key={grp.title}>
            <div style={{ ...sectionLabel, marginBottom: 7 }}>{grp.title}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {grp.items.map((b) => {
                const sel = st.selBacklog === b.id;
                return (
                  <div key={b.id} style={{ background: '#fff', borderRadius: 12, padding: '12px 14px', border: `1px solid ${sel ? 'oklch(0.75 0.06 125)' : colors.line}` }}>
                    <button onClick={() => s.set({ selBacklog: sel ? null : b.id, blMoving: false })} style={{ width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: 0, cursor: 'pointer', minHeight: 44 }}>
                      <div style={{ fontSize: 14.5, color: colors.ink }}>{b.title}</div>
                      <div style={{ fontSize: 12, color: colors.mut, marginTop: 3 }}>Added {b.when}</div>
                      {b.desc && <div style={{ fontSize: 13, color: '#4a4a44', marginTop: 4 }}>{b.desc}</div>}
                      {b.links.length > 0 && (
                        <div style={{ fontSize: 12, fontWeight: 700, color: colors.accentLink, marginTop: 3 }}>
                          {b.links.length} link{b.links.length > 1 ? 's' : ''}
                        </div>
                      )}
                      {b.fromWeek && <div style={{ fontSize: 11.5, color: colors.faint, marginTop: 2 }}>from {b.fromWeek}</div>}
                    </button>
                    {sel && st.blMoving && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                        {s.nonLife()
                          .filter((x) => x.id !== b.goalId)
                          .map((x) => (
                            <button key={x.id} style={chipBtn(false)} onClick={() => s.moveBacklogItem(b.id, x.id)}>
                              {x.title}
                            </button>
                          ))}
                      </div>
                    )}
                    {sel && !st.blMoving && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                        <button style={menuBtn} onClick={() => s.pullToWeek(b)}>Add to this week</button>
                        <button style={menuBtn} onClick={() => s.set({ blMoving: true })}>Move to another goal</button>
                        <button style={dangerBtn} onClick={() => s.deleteBacklogItem(b.id)}>Delete</button>
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
