import { useStore } from '../store';
import { Sheet } from '../components/Sheet';
import { checkBox, chipBtn, colors, fieldLabel, input, menuBtn, saveBtn, textarea } from '../ui';
import { hostOf, rootOf } from '../utils/tree';

/** "+" drawer: add to Backlog (optionally straight into the current week). */
export function BacklogDrawer() {
  const s = useStore();
  if (!s.st.bdOpen) return null;
  return (
    <Sheet label="Add to backlog" onClose={() => s.set({ bdOpen: false })}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>Add to Backlog</div>
        <button
          style={{ minHeight: 40, border: 'none', background: 'none', fontSize: 13, fontWeight: 700, color: colors.accentLink, cursor: 'pointer' }}
          onClick={() => s.set({ bdOpen: false, view: 'backlog' })}
        >
          View Backlog →
        </button>
      </div>
      <div style={{ ...fieldLabel, marginBottom: 6 }}>GOAL</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {s.nonLife().map((g) => (
          <button key={g.id} style={chipBtn(s.st.bdGoal === g.id)} onClick={() => s.set({ bdGoal: g.id, blGoal: g.id })}>
            {g.title}
          </button>
        ))}
      </div>
      <input value={s.st.bdTitle} onChange={(e) => s.set({ bdTitle: e.target.value })} placeholder="What needs doing, someday?" style={{ ...input, marginBottom: 12 }} />
      <textarea value={s.st.bdDesc} onChange={(e) => s.set({ bdDesc: e.target.value })} rows={2} placeholder="Description (optional)" style={{ ...textarea, marginBottom: 12 }} />
      <div style={{ ...fieldLabel, marginBottom: 6 }}>LINKS</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 6 }}>
        {s.st.bdLinks.map((l, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: colors.paper, borderRadius: 10, padding: '6px 6px 6px 12px' }}>
            <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hostOf(l.url)}</div>
            <button aria-label="Remove link" onClick={() => s.set({ bdLinks: s.st.bdLinks.filter((_, j) => j !== i) })} style={{ minWidth: 36, minHeight: 36, border: 'none', background: 'none', color: '#a0a099', fontSize: 15, cursor: 'pointer' }}>
              ×
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={s.st.bdLink}
          onChange={(e) => s.set({ bdLink: e.target.value })}
          placeholder="https://…"
          style={{ flex: 1, minHeight: 44, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '0 12px', fontSize: 13.5, background: '#fff' }}
        />
        <button
          style={menuBtn}
          onClick={() => s.st.bdLink.trim() && s.set({ bdLinks: [...s.st.bdLinks, { url: s.st.bdLink.trim() }], bdLink: '' })}
        >
          Add
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginTop: 14 }}>
        <button aria-label="Also add to the current week" style={checkBox(s.st.bdToWeek)} onClick={() => s.set({ bdToWeek: !s.st.bdToWeek })}>
          {s.st.bdToWeek ? '✓' : ''}
        </button>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Also add to the current week</div>
      </div>
      <button style={saveBtn(!s.st.bdTitle.trim())} disabled={!s.st.bdTitle.trim()} onClick={() => s.saveBacklogDrawer()}>
        Save
      </button>
    </Sheet>
  );
}

/** Standard task-create modal (done-condition optional). */
export function TaskCreateModal() {
  const s = useStore();
  if (!s.st.tmOpen) return null;
  const options = s.activeLeaves();
  return (
    <Sheet label="Task create" onClose={() => s.set({ tmOpen: false, tmFromBacklog: null, tmFromIdea: false })}>
      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>New task</div>
      <div style={{ ...fieldLabel, marginBottom: 5 }}>WEEKLY FOCUS</div>
      <select
        value={s.st.tmGoalId}
        onChange={(e) => s.set({ tmGoalId: e.target.value })}
        style={{ width: '100%', minHeight: 48, border: `1px solid ${colors.border}`, borderRadius: 12, padding: '0 10px', fontSize: 14, background: '#fff', marginBottom: 12 }}
      >
        {options.map((g) => (
          <option key={g.id} value={g.id}>
            {rootOf(s.st.goals, g).title} — {g.focus}
          </option>
        ))}
      </select>
      <input value={s.st.tmTitle} onChange={(e) => s.set({ tmTitle: e.target.value })} placeholder="Task title" style={{ ...input, marginBottom: 12 }} />
      <input value={s.st.tmCond} onChange={(e) => s.set({ tmCond: e.target.value })} placeholder="Done-condition (optional)" style={input} />
      <div style={{ fontSize: 12.5, color: colors.mut, marginTop: 5 }}>How will you know it's done?</div>
      <button style={saveBtn(!s.st.tmTitle.trim())} disabled={!s.st.tmTitle.trim()} onClick={() => s.saveNewTask()}>
        Save task
      </button>
    </Sheet>
  );
}
