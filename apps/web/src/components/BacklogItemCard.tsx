import { useState } from 'react';
import type { BacklogItemView } from '@goal-cascade/shared';
import type { ReorderControlProps, ReorderMenu } from './ReorderableList';
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
  reorder,
}: {
  item: BacklogItemView;
  selected: boolean;
  onSelect: (id: string | null) => void;
  goalLabel?: string;
  /**
   * R-backlog-22 — the row's half of the manual order: the always-visible control, and the four menu
   * actions that make grab mode optional. Absent on a list that has no manual order to render — the
   * Life-goal read-only aggregate (R-backlog-12, S-backlog-21-1) and the pull list (R-backlog-28), both
   * of which span several goals and therefore have no order to rearrange (R-backlog-21).
   */
  reorder?: { control: ReorderControlProps; menu: ReorderMenu; grabbed: boolean };
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

  const body = (
    <>
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
          {/*
           * R-backlog-22 (4) — `Move up` / `Move down` / `Move to top` / `Move to bottom`, so the whole
           * feature is reachable **without ever entering grab mode**. They are absent, not disabled, at
           * the ends: a disabled `Move up` on the first row invites "why?" on every list.
           */}
          {reorder?.menu.moveUp && (
            <button type="button" style={S.menuBtn} onClick={reorder.menu.moveUp}>
              Move up
            </button>
          )}
          {reorder?.menu.moveDown && (
            <button type="button" style={S.menuBtn} onClick={reorder.menu.moveDown}>
              Move down
            </button>
          )}
          {reorder?.menu.moveTop && (
            <button type="button" style={S.menuBtn} onClick={reorder.menu.moveTop}>
              Move to top
            </button>
          )}
          {reorder?.menu.moveBottom && (
            <button type="button" style={S.menuBtn} onClick={reorder.menu.moveBottom}>
              Move to bottom
            </button>
          )}
          <button type="button" style={S.dangerBtn} disabled={remove.isPending} onClick={() => remove.mutate({ id: item.id }, { onSuccess: () => onSelect(null) })}>
            Delete
          </button>
        </div>
      )}
    </>
  );

  /**
   * With a manual order, the row is a two-column grid: the always-visible control, then the card body.
   * The control is a SIBLING of the body's button rather than inside it — a button inside a button is not
   * a control anyone can operate, and the reorder handle must be its own focus stop (R-backlog-22).
   */
  return (
    <div
      {...(reorder ? { 'data-reorder-row': item.id } : {})}
      style={{
        background: S.T.card,
        borderRadius: 12,
        padding: '12px 14px',
        border: `1px solid ${reorder?.grabbed ? S.ring : selected ? S.ring : S.T.line}`,
        ...(reorder?.grabbed ? { boxShadow: `0 2px 10px ${S.T.line}` } : {}),
      }}
    >
      {reorder ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          {/* `type` is stated here and not in the props object: a button's type must be readable in the
              source rather than inferred from a spread (`tests/screens/buttonTypes.test.tsx`). */}
          <button type="button" {...reorder.control} />
          <div style={{ flex: 1, minWidth: 0 }}>{body}</div>
        </div>
      ) : (
        body
      )}
    </div>
  );
}
