import { useState } from 'react';
import type { BacklogItemView } from '@goal-cascade/shared';
import { useUI } from '../context/UIContext';
import { useDeleteBacklogItem, useLens, useMoveBacklogItem } from '../api/queries';
import { useWeekClock } from '../lib/weekClock';
import { useSkin } from '../skin';
import { capturedLabel, weekLabel } from '../utils/dates';
import { plural } from '../utils/tree';

/**
 * One backlog row, and the three actions R-backlog-10/11 give it: `Add to this week`, `Move to another
 * goal`, `Delete`. D-20 — the same three on every screen.
 *
 * R-backlog-3 — no checkbox, no done-condition, no due date, no status. This shape is deliberately poorer
 * than a task, and it should look it.
 *
 * ⚠ **A2 (R-backlog-26)** — `Add to this week` no longer resolves an "active leaf" here. The receiving
 * goal is the **Weekly goal at or under this item's goal for the target week**, which is a subtree the
 * client does not hold (R-lens-16) — so it opens the create sheet bound to the item's goal and lets the
 * SERVER resolve: one candidate is used silently, several come back as `AMBIGUOUS_CONVERSION_TARGET` with
 * the list, and none comes back as `NO_WEEKLY_GOAL`, which the sheet answers with R-task-48's inline
 * create rather than sending the owner away. **There is no longer a state in which a backlog item cannot
 * become work.**
 */
export function BacklogItemCard({
  item,
  selected,
  onSelect,
  goalLabel,
}: {
  item: BacklogItemView;
  selected: boolean;
  onSelect: (id: string | null) => void;
  goalLabel?: string;
}) {
  const S = useSkin();
  const ui = useUI();
  const clock = useWeekClock();
  const move = useMoveBacklogItem();
  const remove = useDeleteBacklogItem();
  const [moving, setMoving] = useState(false);

  // R-backlog-2/10 — a move target is a Yearly, Quarterly or Monthly goal: never Life, and never Weekly.
  // Only read when the picker is actually open.
  const yearly = useLens('Yearly', undefined, moving);
  const quarterly = useLens('Quarterly', undefined, moving);
  const monthly = useLens('Monthly', undefined, moving);
  const targets = [...(yearly.data?.items ?? []), ...(quarterly.data?.items ?? []), ...(monthly.data?.items ?? [])].filter((g) => g.id !== item.goalId);

  return (
    <div style={{ background: S.T.card, borderRadius: 12, padding: '12px 14px', border: `1px solid ${selected ? S.ring : S.T.line}` }}>
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
          {goalLabel ? `${goalLabel} · added ${capturedLabel(item.capturedAt)}` : `Added ${capturedLabel(item.capturedAt)}`}
        </div>
        {item.description && <div style={{ fontSize: 13, color: S.body, marginTop: 4 }}>{item.description}</div>}
        {item.links.length > 0 && <div style={{ fontSize: 12, fontWeight: 700, color: S.T.accentLink, marginTop: 3 }}>{plural(item.links.length, 'link')}</div>}
        {/* R-task-15 / D-12 — the week the task was LIVE in, an absolute Monday, not "this week". */}
        {item.fromWeekStart && <div style={{ fontSize: 11.5, color: S.T.mut, marginTop: 2 }}>from week of {weekLabel(item.fromWeekStart)}</div>}
      </button>

      {selected && moving && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {targets.map((g) => (
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
          {targets.length === 0 && <div style={{ fontSize: 13, color: S.T.mut }}>No other goal can hold it.</div>}
        </div>
      )}

      {selected && !moving && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <button
            type="button"
            style={S.menuBtn}
            onClick={() => {
              onSelect(null);
              ui.openSheet({
                kind: 'taskCreate',
                newWeekly: { parentId: item.goalId, title: '' },
                weekStart: clock.currentMonday ?? undefined,
                title: item.title,
                fromBacklogId: item.id,
              });
            }}
          >
            Add to this week
          </button>
          <button type="button" style={S.menuBtn} onClick={() => setMoving(true)}>
            Move to another goal
          </button>
          <button type="button" style={S.dangerBtn} disabled={remove.isPending} onClick={() => remove.mutate({ id: item.id }, { onSuccess: () => onSelect(null) })}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
