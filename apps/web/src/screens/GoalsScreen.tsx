import { Fragment } from 'react';
import { useStore } from '../store';
import { TopActions } from '../components/TopActions';
import { card, colors, dot, eyebrow, h1, hChip, menuBtn, page, serif, topBtn } from '../ui';
import type { Goal } from '../types';
import { isActive, isLeaf, rootOf, subtreeActive } from '../utils/tree';

export function GoalsScreen() {
  const s = useStore();
  const st = s.st;
  const lifeGoals = s.lifeGoals();

  const renderRows = (parentId: string, depth: number): JSX.Element[] =>
    s.children(parentId).flatMap((g) => {
      const kids = s.children(g.id);
      const expanded = !st.collapsed[g.id];
      const active = isActive(st.goals, g);
      const leaf = kids.length === 0;
      const muted = !subtreeActive(st.goals, g);
      const nBl = st.backlog.filter((b) => b.goalId === g.id).length;
      const row = (
        <Fragment key={g.id}>
          <div style={{ display: 'flex', alignItems: 'flex-start', paddingRight: 6, paddingLeft: (depth - 1) * 18 + 6 }}>
            {kids.length > 0 ? (
              <button aria-label="Expand" onClick={() => s.set({ collapsed: { ...st.collapsed, [g.id]: expanded } })} style={{ minWidth: 34, minHeight: 44, border: 'none', background: 'none', fontSize: 11, color: colors.mut, cursor: 'pointer', padding: 0 }}>
                {expanded ? '▼' : '▶'}
              </button>
            ) : (
              <div style={{ minWidth: 34, textAlign: 'center', color: '#d8d8d2', fontSize: 9, paddingTop: 18 }}>●</div>
            )}
            <button onClick={() => s.set({ view: 'line', lineId: g.id, menuId: null, selBacklog: null })} style={{ flex: 1, minHeight: 44, textAlign: 'left', border: 'none', background: 'none', padding: '8px 0', cursor: 'pointer', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14.5, fontWeight: 700, color: muted ? '#a0a099' : colors.ink }}>{g.title}</span>
                <span style={hChip(active)}>{g.horizon.toUpperCase()}</span>
                <span style={dot(g.pulse, muted)} />
                {nBl > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: colors.mut }}>{nBl} in backlog</span>}
              </div>
              {active && <div style={{ ...serif, fontSize: 15, color: '#2a2a26', marginTop: 2 }}>{g.focus}</div>}
              {leaf && !active && (
                <div style={{ fontSize: 11, fontWeight: 700, color: colors.faint, marginTop: 2, letterSpacing: '0.05em' }}>DORMANT — no focus this week</div>
              )}
            </button>
            <button aria-label="Actions" onClick={() => s.set({ menuId: st.menuId === g.id ? null : g.id })} style={{ minWidth: 40, minHeight: 44, border: 'none', background: 'none', fontSize: 17, color: '#a0a099', cursor: 'pointer' }}>
              ⋯
            </button>
          </div>
          {st.menuId === g.id && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: `0 14px 10px ${(depth - 1) * 18 + 40}px` }}>
              {g.horizon !== 'Monthly' && <button style={menuBtn} onClick={() => s.openGoalModal({ parentId: g.id })}>+ Sub-goal</button>}
              <button style={menuBtn} onClick={() => s.openGoalModal({ editId: g.id })}>Edit</button>
              <button style={menuBtn} onClick={() => s.openConfirm({ type: 'replan', goalId: g.id })}>Re-plan…</button>
              <button style={menuBtn} onClick={() => s.set({ mvOpen: true, mvId: g.id, mvParentId: null, mvSearch: '', menuId: null })}>Move…</button>
            </div>
          )}
        </Fragment>
      );
      return [row, ...(expanded ? renderRows(g.id, depth + 1) : [])];
    });

  const carryLine = (g: Goal) => {
    const carrying = st.tasks.filter((t) => !t.done && t.originWeek < 0 && rootOf(st.goals, s.node(t.goalId)!).id === g.id);
    if (!carrying.length) return null;
    const oldest = Math.max(...carrying.map((t) => -t.originWeek));
    return `${carrying.length} task${carrying.length > 1 ? 's' : ''} carrying · oldest ${oldest} week${oldest > 1 ? 's' : ''}`;
  };

  return (
    <div style={page} data-screen-label="Goals tree">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={eyebrow}>Bird's-eye</div>
          <h1 style={{ ...h1, marginTop: 2 }}>Goals</h1>
        </div>
        <TopActions>
          <button style={topBtn} onClick={() => s.openGoalModal({})}>+ New goal</button>
        </TopActions>
      </div>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '14px 0 18px 0' }}>
        {lifeGoals.map((g) => {
          const under = s.leaves().filter((l) => rootOf(st.goals, l).id === g.id);
          const act = under.filter((l) => isActive(st.goals, l)).length;
          return (
            <div key={g.id} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: `1px solid ${colors.line}`, borderRadius: 14, padding: '9px 13px' }}>
              <span style={dot(g.pulse, act === 0)} />
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 800 }}>{g.title}</div>
                <div style={{ fontSize: 11.5, color: colors.mut }}>
                  {act} of {Math.max(under.length, 1)} branch{under.length === 1 ? '' : 'es'} active
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {lifeGoals.map((g) => (
          <section key={g.id} style={{ ...card, padding: '6px 0 8px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px 8px 14px' }}>
              <button onClick={() => s.set({ view: 'line', lineId: g.id, menuId: null })} style={{ flex: 1, minHeight: 44, textAlign: 'left', border: 'none', background: 'none', padding: 0, cursor: 'pointer', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={dot(g.pulse, !subtreeActive(st.goals, g))} />
                  <span style={{ fontSize: 16.5, fontWeight: 800, color: colors.ink }}>{g.title}</span>
                  <span style={hChip(false)}>LIFE</span>
                </div>
                {g.why && <div style={{ fontSize: 12.5, color: colors.mut, marginTop: 1 }}>{g.why}</div>}
                {carryLine(g) && <div style={{ fontSize: 12, color: colors.faint, marginTop: 3 }}>{carryLine(g)}</div>}
              </button>
              <button aria-label="Actions" onClick={() => s.set({ menuId: st.menuId === g.id ? null : g.id })} style={{ minWidth: 44, minHeight: 44, border: 'none', background: 'none', fontSize: 18, color: colors.mut, cursor: 'pointer' }}>
                ⋯
              </button>
            </div>
            {st.menuId === g.id && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '0 14px 10px 14px' }}>
                <button style={menuBtn} onClick={() => s.openGoalModal({ parentId: g.id })}>+ Sub-goal</button>
                <button style={menuBtn} onClick={() => s.openGoalModal({ editId: g.id })}>Edit</button>
              </div>
            )}
            <div style={{ borderTop: `1px solid ${colors.lineSoft}`, paddingTop: 4 }}>{renderRows(g.id, 1)}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
