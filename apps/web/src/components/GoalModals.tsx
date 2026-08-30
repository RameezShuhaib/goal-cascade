import { useStore } from '../store';
import { Sheet } from '../components/Sheet';
import { chipBtn, colors, fieldLabel, input, pickerRow, saveBtn } from '../ui';
import { HORIZONS, ancestors, defaultPeriod, flatTree, rank } from '../utils/tree';

export function GoalModal() {
  const s = useStore();
  if (!s.st.gmOpen) return null;
  const st = s.st;
  const needsParent = st.gmHorizon !== 'Life' && !st.gmEditId;
  const disabled = !st.gmTitle.trim() || (needsParent && !st.gmParentId);
  const parents = flatTree(st.goals, st.gmSearch).filter((r) => rank(r.g.horizon) < rank(st.gmHorizon));
  return (
    <Sheet label="New goal" onClose={() => s.set({ gmOpen: false })}>
      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>
        {st.gmEditId ? 'Edit goal' : st.gmParentId ? 'New sub-goal' : 'New goal'}
      </div>
      <input value={st.gmTitle} onChange={(e) => s.set({ gmTitle: e.target.value })} placeholder="Goal title" style={{ ...input, marginBottom: 10 }} />
      <input value={st.gmWhy} onChange={(e) => s.set({ gmWhy: e.target.value })} placeholder="Why? One line (optional)" style={{ ...input, marginBottom: 14 }} />
      <div style={{ ...fieldLabel, marginBottom: 6 }}>HORIZON</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {HORIZONS.map((h) => {
          const locked = !!st.gmEditId || rank(h) < st.gmMinRank;
          return (
            <button
              key={h}
              disabled={locked && st.gmHorizon !== h}
              onClick={() => !locked && s.set({ gmHorizon: h, gmPeriod: defaultPeriod(h), gmParentId: rank(h) === 0 ? null : st.gmParentId })}
              style={{
                minHeight: 40, padding: '0 13px', borderRadius: 20, fontSize: 12.5, fontWeight: 700,
                ...(st.gmHorizon === h
                  ? { border: 'none', background: colors.ink, color: '#fff', cursor: 'pointer' }
                  : locked
                    ? { border: '1px solid #efefe9', background: colors.paper, color: colors.disabled, cursor: 'not-allowed' }
                    : { border: `1px solid ${colors.border}`, background: '#fff', color: '#4a4a44', cursor: 'pointer' }),
              }}
            >
              {h}
            </button>
          );
        })}
      </div>
      {needsParent && (
        <>
          <div style={{ ...fieldLabel, marginBottom: 6 }}>PARENT GOAL</div>
          <input value={st.gmSearch} onChange={(e) => s.set({ gmSearch: e.target.value })} placeholder="Search goals…" style={{ ...input, minHeight: 44, fontSize: 14, marginBottom: 8 }} />
          <div style={{ border: `1px solid ${colors.line}`, borderRadius: 12, maxHeight: 200, overflow: 'auto', marginBottom: 14 }}>
            {parents.map((r) => (
              <button key={r.g.id} style={pickerRow(st.gmParentId === r.g.id ? 'sel' : 'ok')} onClick={() => s.set({ gmParentId: r.g.id })}>
                <span style={{ display: 'inline-block', width: r.depth * 16 }} />
                {r.g.title}
                <span style={{ fontSize: 10.5, fontWeight: 800, color: '#a0a099', marginLeft: 7 }}>{r.g.horizon.toUpperCase()}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {st.gmHorizon !== 'Life' && (
        <>
          <div style={{ ...fieldLabel, marginBottom: 6 }}>TARGET PERIOD</div>
          <input value={st.gmPeriod} onChange={(e) => s.set({ gmPeriod: e.target.value })} style={input} />
        </>
      )}
      <button style={saveBtn(disabled)} disabled={disabled} onClick={() => s.saveGoal()}>
        {st.gmEditId ? 'Save changes' : 'Create goal'}
      </button>
    </Sheet>
  );
}

export function MoveGoalModal() {
  const s = useStore();
  const st = s.st;
  if (!st.mvOpen || !st.mvId) return null;
  const mvNode = s.node(st.mvId)!;
  const desc = s.descendants(mvNode.id);
  const targets = flatTree(st.goals, st.mvSearch)
    .filter((r) => r.g.id !== mvNode.id)
    .map((r) => {
      const reason = desc.includes(r.g.id) ? 'its own descendant' : rank(r.g.horizon) >= rank(mvNode.horizon) ? 'horizon conflict' : '';
      return { ...r, reason };
    });
  const target = st.mvParentId ? s.node(st.mvParentId) : undefined;
  const preview = target ? `${mvNode.title} will move under ${[...ancestors(st.goals, target), target].map((x) => x.title).join(' › ')}` : '';
  return (
    <Sheet label="Move goal" onClose={() => s.set({ mvOpen: false })}>
      <div style={{ fontSize: 16, fontWeight: 800 }}>Move goal</div>
      <div style={{ fontSize: 13.5, color: colors.mut, margin: '4px 0 12px 0' }}>
        Pick a new parent for "{mvNode.title}". Its children move with it.
      </div>
      <input value={st.mvSearch} onChange={(e) => s.set({ mvSearch: e.target.value })} placeholder="Search goals…" style={{ ...input, minHeight: 44, fontSize: 14, marginBottom: 8 }} />
      <div style={{ border: `1px solid ${colors.line}`, borderRadius: 12, maxHeight: 230, overflow: 'auto' }}>
        {targets.map((r) => (
          <button
            key={r.g.id}
            disabled={!!r.reason}
            onClick={() => !r.reason && s.set({ mvParentId: r.g.id })}
            style={pickerRow(r.reason ? 'dis' : st.mvParentId === r.g.id ? 'sel' : 'ok')}
          >
            <span style={{ display: 'inline-block', width: r.depth * 16 }} />
            {r.g.title}
            <span style={{ fontSize: 10.5, fontWeight: 800, color: '#a0a099', marginLeft: 7 }}>{r.g.horizon.toUpperCase()}</span>
            {r.reason && <span style={{ fontSize: 11, color: 'oklch(0.55 0.1 60)', marginLeft: 7 }}>{r.reason}</span>}
          </button>
        ))}
      </div>
      {preview && (
        <div style={{ background: colors.accentSoft, color: 'oklch(0.38 0.09 125)', borderRadius: 12, padding: '11px 14px', fontSize: 13.5, fontWeight: 600, marginTop: 12 }}>
          {preview}
        </div>
      )}
      <button style={saveBtn(!st.mvParentId)} disabled={!st.mvParentId} onClick={() => s.moveGoal()}>
        Move it
      </button>
    </Sheet>
  );
}

/** Reusable goal-tag chip row (life goals + "No goal"). */
export function GoalChipRow({ value, onPick }: { value: string; onPick: (id: string) => void }) {
  const s = useStore();
  const opts = [{ id: '', title: 'No goal' }, ...s.lifeGoals()];
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
      {opts.map((g) => (
        <button key={g.id || 'none'} style={chipBtn(value === g.id)} onClick={() => onPick(g.id)}>
          {g.title}
        </button>
      ))}
    </div>
  );
}
