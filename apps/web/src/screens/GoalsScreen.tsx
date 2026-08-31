import { Fragment, type ReactElement } from 'react';
import type { GoalView } from '@goal-cascade/shared';
import { useUI } from '../context/UIContext';
import { useGoals } from '../api/queries';
import { TopActions } from '../components/TopActions';
import { Empty, Loading, LoadError } from '../components/states';
import { useSkin } from '../skin';
import { childrenOf, lifeGoals, plural } from '../utils/tree';

/**
 * R-goal-25 — the tree, grouped under each Life root, expand/collapse per node.
 *
 * Every flag on a row is the SERVER's, computed for the current week: `isActive` (a focus row exists this
 * week — D-2), `isLeaf`, `subtreeActive` (one active leaf anywhere below lights the whole ancestor chain,
 * R-goal-11), `backlogCount`, `branches` and `carrying`. The mockup recomputed all of them from a local
 * array and a `focus` string that had no week dimension.
 *
 * Dormancy is muted, not broken (R-goal-10): the same type at a lower contrast, the pulse dot dimmed, and
 * one quiet line saying why. It must read as a decision the owner made.
 */
export function GoalsScreen() {
  const S = useSkin();
  const ui = useUI();
  // The tree is always read for the CURRENT week: `Goals` has no week switcher (R-nav-3 puts it on Tasks).
  const goalsQ = useGoals(0);
  const goals = goalsQ.data?.goals ?? [];
  const lives = lifeGoals(goals);

  return (
    <div style={S.page} data-screen-label="Goals tree">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={S.eyebrow}>Bird&apos;s-eye</div>
          <h1 style={{ ...S.h1, marginTop: 2 }}>Goals</h1>
        </div>
        <TopActions>
          <button type="button" style={S.topBtn} onClick={() => ui.openSheet({ kind: 'goalForm', editId: null, parentId: null })}>
            + New goal
          </button>
        </TopActions>
      </div>

      {goalsQ.isPending && <Loading label="Loading your cascade…" />}
      {goalsQ.error && <LoadError error={goalsQ.error} what="your goals" onRetry={() => void goalsQ.refetch()} />}

      {!goalsQ.isPending && !goalsQ.error && lives.length === 0 && (
        <div style={{ marginTop: 20 }}>
          {/* R-auth-6 — a new account has no tree at all. No seed goals, no fixture ids (D-26). */}
          <Empty
            title="Nothing planted yet."
            body="Start with a Life goal — the thing the rest of the cascade hangs off."
            action={
              <button type="button" style={S.topBtn} onClick={() => ui.openSheet({ kind: 'goalForm', editId: null, parentId: null })}>
                + New goal
              </button>
            }
          />
        </div>
      )}

      {lives.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '14px 0 18px 0' }}>
            {lives.map((g) => (
              <div
                key={g.id}
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: S.T.card,
                  border: `1px solid ${S.T.line}`,
                  borderRadius: 14,
                  padding: '9px 13px',
                }}
              >
                <span style={S.dot(g.pulse, (g.branches?.active ?? 0) === 0)} />
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: S.T.ink }}>{g.title}</div>
                  {/* R-goal-26 / D-16 — `0 of 0 branches` when the line has no leaves. The server counts. */}
                  <div style={{ fontSize: 11.5, color: S.T.mut }}>
                    {`${g.branches?.active ?? 0} of ${g.branches?.total ?? 0} branch${(g.branches?.total ?? 0) === 1 ? '' : 'es'} active`}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {lives.map((g) => (
              <LifeSection key={g.id} life={g} goals={goals} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function LifeSection({ life, goals }: { life: GoalView; goals: GoalView[] }) {
  const S = useSkin();
  const ui = useUI();
  return (
    <section style={{ ...S.card, padding: '6px 0 8px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px 8px 14px' }}>
        <button
          type="button"
          onClick={() => ui.openGoal(life.id)}
          style={{ flex: 1, minHeight: 44, textAlign: 'left', border: 'none', background: 'none', padding: 0, cursor: 'pointer', minWidth: 0, fontFamily: 'inherit' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={S.dot(life.pulse, !life.subtreeActive)} />
            <span style={{ fontSize: 16.5, fontWeight: 800, color: S.T.ink }}>{life.title}</span>
            <span style={S.hChip(false)}>LIFE</span>
          </div>
          {life.why && <div style={{ fontSize: 12.5, color: S.T.mut, marginTop: 1 }}>{life.why}</div>}
          {/*
           * R-goal-24 — the only summary anywhere in this product. `carrying` is the server's, counted over
           * open tasks below this Life goal that originated before the viewed week; the singular/plural copy
           * is the client's (S-goal-24-3). There is no audit page behind it, and there must not be one.
           */}
          {life.carrying && (
            <div style={{ fontSize: 12, color: S.T.faint, marginTop: 3 }}>
              {`${plural(life.carrying.openTasks, 'task')} carrying · oldest ${plural(life.carrying.oldestWeeks, 'week')}`}
            </div>
          )}
        </button>
        <button
          type="button"
          aria-label={`Actions for ${life.title}`}
          onClick={() => ui.setMenuGoalId(ui.menuGoalId === life.id ? null : life.id)}
          style={{ minWidth: 44, minHeight: 44, border: 'none', background: 'none', fontSize: 18, color: S.T.mut, cursor: 'pointer' }}
        >
          ⋯
        </button>
      </div>
      {ui.menuGoalId === life.id && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '0 14px 10px 14px' }}>
          {/* R-goal-21 — a Life goal cannot be moved or re-planned, so neither action is offered. */}
          <button type="button" style={S.menuBtn} onClick={() => ui.openSheet({ kind: 'goalForm', editId: null, parentId: life.id })}>
            + Sub-goal
          </button>
          <button type="button" style={S.menuBtn} onClick={() => ui.openSheet({ kind: 'goalForm', editId: life.id, parentId: null })}>
            Edit
          </button>
          <button type="button" style={S.dangerBtn} onClick={() => ui.openSheet({ kind: 'confirmDeleteGoal', goalId: life.id })}>
            Delete
          </button>
        </div>
      )}
      <div style={{ borderTop: `1px solid ${S.T.lineSoft}`, paddingTop: 4 }}>
        <Rows goals={goals} parentId={life.id} depth={1} />
      </div>
    </section>
  );
}

function Rows({ goals, parentId, depth }: { goals: GoalView[]; parentId: string; depth: number }): ReactElement {
  const S = useSkin();
  const ui = useUI();
  const rows = childrenOf(goals, parentId).flatMap((g) => {
    const kids = childrenOf(goals, g.id);
    const expanded = !ui.collapsed[g.id];
    const muted = !g.subtreeActive;
    return [
      <Fragment key={g.id}>
        <div style={{ display: 'flex', alignItems: 'flex-start', paddingRight: 6, paddingLeft: (depth - 1) * 18 + 6 }}>
          {kids.length > 0 ? (
            <button
              type="button"
              aria-label={expanded ? `Collapse ${g.title}` : `Expand ${g.title}`}
              onClick={() => ui.toggleCollapsed(g.id)}
              style={{ minWidth: 34, minHeight: 44, border: 'none', background: 'none', fontSize: 11, color: S.T.mut, cursor: 'pointer', padding: 0 }}
            >
              {expanded ? '▼' : '▶'}
            </button>
          ) : (
            <div style={{ minWidth: 34, textAlign: 'center', color: S.T.border, fontSize: 9, paddingTop: 18 }}>●</div>
          )}
          <button
            type="button"
            onClick={() => ui.openGoal(g.id)}
            style={{ flex: 1, minHeight: 44, textAlign: 'left', border: 'none', background: 'none', padding: '8px 0', cursor: 'pointer', minWidth: 0, fontFamily: 'inherit' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14.5, fontWeight: 700, color: muted ? S.T.faint : S.T.ink }}>{g.title}</span>
              <span style={S.hChip(g.isActive)}>{g.horizon.toUpperCase()}</span>
              <span style={S.dot(g.pulse, muted)} />
              {g.backlogCount > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: S.T.mut }}>{g.backlogCount} in backlog</span>}
            </div>
            {g.isActive && <div style={{ ...S.serif, fontSize: 15, color: S.quote, marginTop: 2 }}>{g.focus}</div>}
            {g.isLeaf && !g.isActive && (
              <div style={{ fontSize: 11, fontWeight: 700, color: S.T.faint, marginTop: 2, letterSpacing: '0.05em' }}>DORMANT — no focus this week</div>
            )}
          </button>
          <button
            type="button"
            aria-label={`Actions for ${g.title}`}
            onClick={() => ui.setMenuGoalId(ui.menuGoalId === g.id ? null : g.id)}
            style={{ minWidth: 40, minHeight: 44, border: 'none', background: 'none', fontSize: 17, color: S.T.faint, cursor: 'pointer' }}
          >
            ⋯
          </button>
        </div>
        {ui.menuGoalId === g.id && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: `0 14px 10px ${(depth - 1) * 18 + 40}px` }}>
            {/* R-goal-6 / D-6 — Monthly is terminal: the affordance is absent, and the server refuses it too. */}
            {g.horizon !== 'Monthly' && (
              <button type="button" style={S.menuBtn} onClick={() => ui.openSheet({ kind: 'goalForm', editId: null, parentId: g.id })}>
                + Sub-goal
              </button>
            )}
            <button type="button" style={S.menuBtn} onClick={() => ui.openSheet({ kind: 'goalForm', editId: g.id, parentId: null })}>
              Edit
            </button>
            <button type="button" style={S.menuBtn} onClick={() => ui.openSheet({ kind: 'confirmReplan', goalId: g.id })}>
              Re-plan…
            </button>
            <button type="button" style={S.menuBtn} onClick={() => ui.openSheet({ kind: 'moveGoal', goalId: g.id })}>
              Move…
            </button>
            <button type="button" style={S.dangerBtn} onClick={() => ui.openSheet({ kind: 'confirmDeleteGoal', goalId: g.id })}>
              Delete
            </button>
          </div>
        )}
      </Fragment>,
      ...(expanded ? [<Rows key={`${g.id}-kids`} goals={goals} parentId={g.id} depth={depth + 1} />] : []),
    ];
  });
  return <>{rows}</>;
}
