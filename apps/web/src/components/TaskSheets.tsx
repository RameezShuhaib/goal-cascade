import { useStore } from '../store';
import { Sheet } from '../components/Sheet';
import { btn, colors, dangerBtn, fieldLabel, input, menuBtn, saveBtn, smallDarkBtn, textarea } from '../ui';
import { hostOf, pathOf, replanPeriods } from '../utils/tree';

export function TaskDetailSheet() {
  const s = useStore();
  const dt = s.st.tasks.find((t) => t.id === s.st.dtId);
  if (!dt) return null;
  const goal = s.node(dt.goalId);
  const dirty = s.st.dtTitle.trim() !== dt.title || s.st.dtCond.trim() !== dt.cond || s.st.dtDesc.trim() !== dt.desc;
  return (
    <Sheet label="Task detail" onClose={() => s.set({ dtId: null })}>
      <div style={{ width: 36, height: 4, borderRadius: 2, background: colors.border, margin: '0 auto 14px auto' }} />
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: colors.mut }}>
        {goal ? pathOf(s.st.goals, goal).join(' › ') : ''}
      </div>
      {dt.done && <div style={{ fontSize: 12.5, color: colors.faint, marginTop: 2 }}>Done {dt.doneLabel}</div>}
      <div style={{ ...fieldLabel, margin: '12px 0 5px 0' }}>TITLE</div>
      <input value={s.st.dtTitle} onChange={(e) => s.set({ dtTitle: e.target.value })} style={{ ...input, minHeight: 46, fontWeight: 600 }} />
      <div style={{ ...fieldLabel, margin: '14px 0 5px 0' }}>DONE-CONDITION</div>
      <input
        value={s.st.dtCond}
        onChange={(e) => s.set({ dtCond: e.target.value })}
        placeholder="How will you know it's done?"
        style={{ ...input, minHeight: 46, fontSize: 14.5 }}
      />
      <div style={{ ...fieldLabel, margin: '14px 0 5px 0' }}>DESCRIPTION</div>
      <textarea value={s.st.dtDesc} onChange={(e) => s.set({ dtDesc: e.target.value })} rows={2} placeholder="Optional notes…" style={textarea} />
      {dirty && <button style={smallDarkBtn} onClick={() => s.saveTaskDetail()}>Save changes</button>}
      <div style={{ ...fieldLabel, margin: '14px 0 5px 0' }}>LINKS</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {dt.links.map((l, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: colors.paper, borderRadius: 10, padding: '6px 6px 6px 12px' }}>
            <a href={l.url} target="_blank" rel="noreferrer" style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {hostOf(l.url)}
            </a>
            <button aria-label="Remove link" onClick={() => s.removeTaskLink(i)} style={{ minWidth: 36, minHeight: 36, border: 'none', background: 'none', color: '#a0a099', fontSize: 15, cursor: 'pointer' }}>
              ×
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <input
          value={s.st.dtLink}
          onChange={(e) => s.set({ dtLink: e.target.value })}
          placeholder="https://…"
          style={{ flex: 1, minHeight: 44, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '0 12px', fontSize: 13.5, background: '#fff' }}
        />
        <button style={menuBtn} onClick={() => s.addTaskLink()}>Add</button>
      </div>
      {!dt.done && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          <button style={menuBtn} onClick={() => s.openConfirm({ type: 'moveTask', taskId: dt.id })}>Move to Backlog</button>
          <button style={dangerBtn} onClick={() => s.openConfirm({ type: 'cancelTask', taskId: dt.id })}>Cancel task</button>
        </div>
      )}
      <div style={{ ...fieldLabel, margin: '18px 0 8px 0' }}>ACTIVITY</div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {dt.events.map((e, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, padding: '7px 0', borderTop: '1px solid #f6f6f3' }}>
            <div style={{ minWidth: 22, height: 22, borderRadius: '50%', background: colors.lineSoft, color: colors.mut, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {e.i}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, color: '#2a2a26' }}>{e.t}</div>
              <div style={{ fontSize: 11.5, color: colors.faint, marginTop: 1 }}>{e.d}</div>
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

export function ConfirmSheet() {
  const s = useStore();
  const cf = s.st.cfOpen;
  if (!cf) return null;
  const task = cf.taskId ? s.st.tasks.find((t) => t.id === cf.taskId) : undefined;
  const goal = cf.goalId ? s.node(cf.goalId) : undefined;
  const periods = goal ? replanPeriods(goal.horizon) : [];
  const title = cf.type === 'moveTask' ? 'Move to Backlog' : cf.type === 'cancelTask' ? 'Cancel task' : 'Re-plan goal';
  const what = task
    ? `“${task.title}” → ${cf.type === 'moveTask' ? `${s.node(task.goalId)?.title}’s backlog` : 'dropped'}`
    : goal
      ? `“${goal.title}” · ${goal.period} → ${periods[s.st.cfPeriodIdx]}`
      : '';
  return (
    <Sheet label="Confirm" onClose={() => s.set({ cfOpen: null, cfReason: '' })}>
      <div style={{ fontSize: 16, fontWeight: 800 }}>{title}</div>
      <div style={{ fontSize: 14, color: '#4a4a44', margin: '6px 0 14px 0' }}>{what}</div>
      {goal && (
        <>
          <div style={{ ...fieldLabel, marginBottom: 6 }}>NEW TARGET PERIOD</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            {periods.map((label, i) => (
              <button key={label} style={btn(s.st.cfPeriodIdx === i)} onClick={() => s.set({ cfPeriodIdx: i })}>
                {label}
              </button>
            ))}
          </div>
        </>
      )}
      <input value={s.st.cfReason} onChange={(e) => s.set({ cfReason: e.target.value })} placeholder="Why? (optional)" style={input} />
      <div style={{ fontSize: 12.5, color: colors.mut, marginTop: 5 }}>No mandatory fields. Fast and guilt-free.</div>
      <button style={saveBtn(false)} onClick={() => s.confirmAction()}>
        {cf.type === 'moveTask' ? 'Move it' : cf.type === 'cancelTask' ? 'Cancel it' : 'Re-plan it'}
      </button>
    </Sheet>
  );
}

export function InactiveBranchSheet() {
  const s = useStore();
  if (!s.st.ibOpen) return null;
  return (
    <Sheet onClose={() => s.set({ ibOpen: null })}>
      <div style={{ fontSize: 16, fontWeight: 800 }}>This branch isn't active this week</div>
      <div style={{ fontSize: 13.5, color: colors.mut, margin: '4px 0 16px 0' }}>
        "{s.st.ibOpen.title}" can only become a task under an active weekly focus.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button style={{ minHeight: 46, border: 'none', borderRadius: 12, background: colors.ink, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }} onClick={() => s.set({ ibOpen: null, view: 'plan' })}>
          Set a weekly focus
        </button>
        <button style={{ minHeight: 46, border: `1px solid ${colors.border}`, borderRadius: 12, background: '#fff', fontSize: 14, fontWeight: 700, color: colors.ink, cursor: 'pointer' }} onClick={() => s.set({ ibOpen: null })}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}
