import { useStore } from '../store';
import type { Task } from '../types';
import { carryLabel, checkBox, colors, menuBtn, smallDarkBtn } from '../ui';
import { wm } from '../utils/dates';

/** One task row (checkbox + body + carry label) with the inline uncheck follow-up. */
export function TaskRow({ t, week }: { t: Task; week: number }) {
  const s = useStore();
  const age = week - t.originWeek;
  const showCarry = !t.done && age >= 1;
  const sev = age >= 2 ? 'chip' : 'gray';
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0', borderTop: `1px solid ${colors.lineSoft}` }}>
        <button aria-label="Toggle done" style={checkBox(t.done)} onClick={() => s.toggleTask(t)}>
          {t.done ? '✓' : ''}
        </button>
        <button
          onClick={() => s.openTaskDetail(t)}
          style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 'none', background: 'none', padding: 0, cursor: 'pointer' }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, ...(t.done ? { color: '#a0a099', textDecoration: 'line-through' } : { color: colors.ink }) }}>
            {t.title}
          </div>
          {t.cond && <div style={{ fontSize: 12.5, color: colors.mut, marginTop: 2 }}>Done when: {t.cond}</div>}
          {t.done && <div style={{ fontSize: 12, color: colors.faint, marginTop: 2 }}>Done {t.doneLabel}</div>}
          {showCarry && (
            <div style={{ marginTop: 4 }}>
              <span style={carryLabel(sev)}>{sev === 'chip' ? `${age} weeks · since ${wm(t.originWeek)}` : `since ${wm(t.originWeek)}`}</span>
            </div>
          )}
        </button>
      </div>
      {s.st.uncheckId === t.id && (
        <div style={{ background: colors.cardSoft, border: `1px solid ${colors.line}`, borderRadius: 12, padding: 12, margin: '0 0 10px 38px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 7 }}>Update the done-condition?</div>
          <input
            value={s.st.uncheckCond}
            onChange={(e) => s.set({ uncheckCond: e.target.value })}
            style={{ width: '100%', minHeight: 44, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '0 12px', fontSize: 14, background: '#fff' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button style={{ ...smallDarkBtn, marginTop: 0 }} onClick={() => s.saveUncheck()}>Save</button>
            <button style={menuBtn} onClick={() => s.set({ uncheckId: null, uncheckCond: '' })}>Skip</button>
          </div>
        </div>
      )}
    </div>
  );
}
