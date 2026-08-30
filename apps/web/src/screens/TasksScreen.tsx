import { useStore } from '../store';
import { TaskRow } from '../components/TaskRow';
import { TopActions } from '../components/TopActions';
import { card, chipBtn, colors, eyebrow, linkBtn, page, serif, topBtn } from '../ui';
import { wm } from '../utils/dates';
import { isActive, isLeaf, pathOf, rootOf } from '../utils/tree';

export function TasksScreen() {
  const s = useStore();
  const st = s.st;
  const w = st.viewWeek;

  const tasksIn = (goalId: string) => st.tasks.filter((t) => t.goalId === goalId && s.visibleIn(t, w));
  const sectionGoals = st.goals.filter(
    (g) => g.parentId && isLeaf(st.goals, g) && (tasksIn(g.id).length > 0 || (w === 0 && isActive(st.goals, g))),
  );
  const roots = s.lifeGoals().filter((lg) => sectionGoals.some((g) => rootOf(st.goals, g).id === lg.id));
  const openCount = (rootId: string) =>
    st.tasks.filter((t) => !t.done && s.visibleIn(t, w) && rootOf(st.goals, s.node(t.goalId)!).id === rootId).length;
  const shown = sectionGoals.filter((g) => !st.homeFilter || rootOf(st.goals, g).id === st.homeFilter);
  const weekOptions = [0, -1, -2, -3, -4, -5];

  return (
    <div style={page} data-screen-label="Tasks">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ ...eyebrow, paddingTop: 6 }}>Tasks</div>
        <TopActions>
          {w === 0 && (
            <button style={topBtn} onClick={() => s.set({ view: 'plan', planFilter: '' })}>
              Edit plan
            </button>
          )}
        </TopActions>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
        <button aria-label="Earlier week" onClick={() => s.set({ viewWeek: Math.max(w - 1, -8), wkPickOpen: false })} style={{ minWidth: 40, minHeight: 40, border: 'none', background: 'none', fontSize: 16, color: colors.mut, cursor: 'pointer', padding: 0 }}>
          ‹
        </button>
        <button onClick={() => s.set({ wkPickOpen: !st.wkPickOpen })} style={{ border: 'none', background: 'none', padding: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em', color: colors.ink, cursor: 'pointer', minHeight: 40 }}>
          Week of {wm(w)}
        </button>
        <button aria-label="Later week" disabled={w === 0} onClick={() => s.set({ viewWeek: Math.min(w + 1, 0), wkPickOpen: false })} style={{ minWidth: 40, minHeight: 40, border: 'none', background: 'none', fontSize: 16, padding: 0, ...(w === 0 ? { color: '#d8d8d2', cursor: 'not-allowed' } : { color: colors.mut, cursor: 'pointer' }) }}>
          ›
        </button>
      </div>
      {st.wkPickOpen && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {weekOptions.map((o) => (
            <button key={o} style={chipBtn(w === o)} onClick={() => s.set({ viewWeek: o, wkPickOpen: false, homeFilter: '' })}>
              {o === 0 ? 'This week' : `Week of ${wm(o)}`}
            </button>
          ))}
        </div>
      )}
      {w < 0 && (
        <div style={{ display: 'inline-block', background: '#efefe9', color: colors.mut, borderRadius: 12, padding: '4px 10px', fontSize: 12, fontWeight: 700, marginTop: 8 }}>
          Past week — still editable
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '14px 0' }}>
        <button style={chipBtn(st.homeFilter === '')} onClick={() => s.set({ homeFilter: '' })}>All</button>
        {roots.map((g) => (
          <button key={g.id} style={chipBtn(st.homeFilter === g.id)} onClick={() => s.set({ homeFilter: g.id })}>
            {g.title} · {openCount(g.id)}
          </button>
        ))}
      </div>
      {shown.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          {shown.map((g) => (
            <section key={g.id} style={{ ...card, padding: '16px 16px 8px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: colors.mut, lineHeight: 1.5 }}>
                {pathOf(st.goals, g).join(' › ')}
              </div>
              {w === 0 && g.focus && <div style={{ ...serif, fontSize: 19, color: '#2a2a26', margin: '4px 0 10px 0' }}>{g.focus}</div>}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {tasksIn(g.id).map((t) => (
                  <TaskRow key={t.id} t={t} week={w} />
                ))}
              </div>
              {w === 0 && isActive(st.goals, g) && (
                <button style={{ ...linkBtn, width: '100%', padding: '8px 0' }} onClick={() => s.openTaskCreate(g.id)}>
                  + Task
                </button>
              )}
            </section>
          ))}
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px dashed #d8d8d2', borderRadius: 16, padding: '40px 24px', textAlign: 'center' }}>
          <div style={{ ...serif, fontSize: 20, color: '#4a4a44' }}>
            {w === 0 ? 'A new week, still unplanned.' : 'Nothing happened this week.'}
          </div>
          <div style={{ fontSize: 13.5, color: colors.mut, margin: '8px 0 18px 0' }}>
            {w === 0 ? 'Pick which branches are active this week, then write each focus.' : 'No tasks were live in this week.'}
          </div>
          {w === 0 && (
            <button style={{ minHeight: 46, padding: '0 22px', border: 'none', borderRadius: 23, background: colors.ink, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }} onClick={() => s.set({ view: 'plan', planFilter: '' })}>
              Plan this week
            </button>
          )}
        </div>
      )}
    </div>
  );
}
