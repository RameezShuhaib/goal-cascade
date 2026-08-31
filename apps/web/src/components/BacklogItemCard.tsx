import { useState } from 'react';
import type { BacklogItemView, GoalView } from '@goal-cascade/shared';
import { useUI } from '../context/UIContext';
import { useDeleteBacklogItem, useMoveBacklogItem } from '../api/queries';
import { useSkin } from '../skin';
import { capturedLabel, weekLabel } from '../utils/dates';
import { activeLeavesUnder, node, nonLifeGoals, plural } from '../utils/tree';

/**
 * One backlog row, and the three actions R-backlog-10/11 give it: `Add to this week`, `Move to another
 * goal`, `Delete`.
 *
 * D-20 — the same three on every screen. In the mockup the goal-detail block offered two and the Backlog
 * page offered three, so what you could do to an item depended on where you found it.
 *
 * R-backlog-3 — no checkbox, no done-condition, no due date, no status. This shape is deliberately poorer
 * than a task, and it should look it.
 */
export function BacklogItemCard({
  item,
  goals,
  selected,
  onSelect,
  showGoalLabel = false,
}: {
  item: BacklogItemView;
  goals: GoalView[];
  selected: boolean;
  onSelect: (id: string | null) => void;
  showGoalLabel?: boolean;
}) {
  const S = useSkin();
  const ui = useUI();
  const move = useMoveBacklogItem();
  const remove = useDeleteBacklogItem();
  const [moving, setMoving] = useState(false);

  /**
   * R-backlog-6/7/8 — the only way backlog becomes work.
   *
   * The candidate leaves are filtered from the server's own `isActive` / `isLeaf` flags, never recomputed:
   * with none, R-backlog-8's sheet answers instead of a modal; with exactly one it is used; with two or
   * more the create sheet asks, because D-18 forbids anyone — client or server — picking silently. The
   * server re-checks all of it (S-backlog-8-3) and refuses `BRANCH_NOT_ACTIVE` or answers with
   * `details.candidates`, which the sheet also handles.
   */
  const addToWeek = () => {
    const candidates = activeLeavesUnder(goals, item.goalId);
    onSelect(null);
    if (candidates.length === 0) {
      ui.openSheet({ kind: 'inactiveBranch', itemId: item.id, title: item.title });
      return;
    }
    ui.openSheet({
      kind: 'taskCreate',
      goalId: candidates.length === 1 ? candidates[0]!.id : '',
      title: item.title,
      fromBacklogId: item.id,
    });
  };

  const owner = node(goals, item.goalId);

  return (
    <div
      style={{
        background: S.T.card,
        borderRadius: 12,
        padding: '12px 14px',
        border: `1px solid ${selected ? S.ring : S.T.line}`,
      }}
    >
      <button
        type="button"
        onClick={() => {
          setMoving(false);
          onSelect(selected ? null : item.id);
        }}
        style={{ width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: 0, cursor: 'pointer', minHeight: 44, fontFamily: 'inherit' }}
      >
        <div style={{ fontSize: 14.5, color: S.T.ink }}>{item.title}</div>
        <div style={{ fontSize: 12, color: S.T.mut, marginTop: 3 }}>
          {showGoalLabel && owner ? `${owner.title} · added ${capturedLabel(item.capturedAt)}` : `Added ${capturedLabel(item.capturedAt)}`}
        </div>
        {item.description && <div style={{ fontSize: 13, color: S.body, marginTop: 4 }}>{item.description}</div>}
        {item.links.length > 0 && (
          <div style={{ fontSize: 12, fontWeight: 700, color: S.T.accentLink, marginTop: 3 }}>{plural(item.links.length, 'link')}</div>
        )}
        {/* R-task-15 / D-12 — the week the task was LIVE in, an absolute Monday, not "this week". */}
        {item.fromWeekStart && <div style={{ fontSize: 11.5, color: S.T.faint, marginTop: 2 }}>from week of {weekLabel(item.fromWeekStart)}</div>}
      </button>

      {selected && moving && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {/* R-backlog-2 — never a Life goal. A Life target is refused with `LIFE_GOAL_NO_BACKLOG` anyway. */}
          {nonLifeGoals(goals)
            .filter((g) => g.id !== item.goalId)
            .map((g) => (
              <button
                key={g.id}
                type="button"
                style={S.chipBtn(false)}
                disabled={move.isPending}
                onClick={() =>
                  move.mutate(
                    { id: item.id, goalId: g.id, version: item.version },
                    {
                      onSuccess: () => {
                        setMoving(false);
                        onSelect(null);
                        ui.showToast(`Moved to ${g.title}`);
                      },
                    },
                  )
                }
              >
                {g.title}
              </button>
            ))}
        </div>
      )}

      {selected && !moving && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <button type="button" style={S.menuBtn} onClick={addToWeek}>
            Add to this week
          </button>
          <button type="button" style={S.menuBtn} onClick={() => setMoving(true)}>
            Move to another goal
          </button>
          <button
            type="button"
            style={S.dangerBtn}
            disabled={remove.isPending}
            onClick={() => remove.mutate({ id: item.id }, { onSuccess: () => onSelect(null) })}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
