import { useMemo, useState } from 'react';
import type { BacklogItemView } from '@goal-cascade/shared';
import { useUI } from '../context/UIContext';
import { useBacklog } from '../api/queries';
import { TopActions } from '../components/TopActions';
import { BacklogItemCard } from '../components/BacklogItemCard';
import { useReorderList } from '../components/ReorderableList';
import { Empty, FieldError, Loading, LoadError } from '../components/states';
import { useSkin } from '../skin';

/**
 * R-backlog-13 — the full backlog page: grouped by `<Life goal> › <owning goal>`.
 *
 * ⚠ **A2 — the grouping is EXACT now, and the `Elsewhere` bucket is gone.** It existed because a
 * `BacklogItemView` carried a `goalId` and no title, so the page guessed the branch path from the current
 * period's lens reads and bucketed every miss — an item on last quarter's goal, an item on a goal three
 * months out — under a heading that named a client limitation rather than anything about the owner's
 * plan. The server resolves `goalTitle` and `lifeGoalTitle` now, from the interior tree it already reads
 * (R-lens-27), so every item lands under its own goal and the four extra lens reads this page used to
 * make are deleted with the guess.
 *
 * **Two orders, both the server's, and neither of them re-computed here** (R-backlog-21):
 *  - the GROUPS are newest-first — group order is its newest item's `capturedAt`, which is what falls out
 *    of taking the goals in first-appearance order of the payload;
 *  - **within** a group it is that goal's manual order (R-backlog-17), which is the arrangement the
 *    server sent and the arrangement `useReorderList` rearranges.
 *
 * R-nav-2 — this page has no tab. It is reached from the `+` drawer or a goal's detail page.
 */
export function BacklogScreen() {
  const S = useSkin();
  const ui = useUI();
  const backlogQ = useBacklog();
  const [selected, setSelected] = useState<string | null>(null);

  const items = useMemo(() => backlogQ.data?.items ?? [], [backlogQ.data]);

  /**
   * Group by owning goal, in first-appearance order. The server has already flattened its two ordering
   * rules into one total order, so this walks the array once and re-sorts nothing.
   */
  const groups = useMemo(() => {
    const out: { goalId: string; title: string; items: BacklogItemView[] }[] = [];
    const at = new Map<string, number>();
    for (const item of items) {
      const existing = at.get(item.goalId);
      if (existing !== undefined) {
        out[existing]!.items.push(item);
        continue;
      }
      at.set(item.goalId, out.length);
      // `lifeGoalTitle` is null only when the chain does not reach a Life goal — R-lens-20's UNSORTED
      // condition, a data-integrity surface. The row is still named by its own goal, never bucketed.
      out.push({
        goalId: item.goalId,
        title: item.lifeGoalTitle ? `${item.lifeGoalTitle} › ${item.goalTitle}` : item.goalTitle,
        items: [item],
      });
    }
    return out;
  }, [items]);

  const failed = backlogQ.error;
  const pending = backlogQ.isPending && !failed;

  return (
    <div style={S.page} data-screen-label="Backlog">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={S.eyebrow}>Deferred work</div>
          <h1 style={{ ...S.h1, marginTop: 2 }}>Backlog</h1>
        </div>
        <TopActions>
          <button type="button" style={S.topBtn} onClick={() => ui.openSheet({ kind: 'backlogDrawer' })}>
            + Add
          </button>
        </TopActions>
      </div>

      {pending && <Loading label="Loading the backlog…" />}
      {failed && <LoadError error={failed} what="the backlog" onRetry={() => void backlogQ.refetch()} />}

      {!pending && !failed && items.length === 0 && (
        <div style={{ marginTop: 20 }}>
          <Empty title="Nothing in the backlog." body="Future work lives here until you pull it into a week." />
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 20 }}>
        {groups.map((grp) => (
          <BacklogGroup key={grp.goalId} title={grp.title} items={grp.items} selected={selected} onSelect={setSelected} />
        ))}
      </div>
    </div>
  );
}

/**
 * One goal's group — and therefore one re-orderable list (R-backlog-21: a manual order exists within a
 * goal and nowhere else, so each group owns its own grab state and its own live region).
 */
function BacklogGroup({
  title,
  items,
  selected,
  onSelect,
}: {
  title: string;
  items: BacklogItemView[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const S = useSkin();
  const list = useReorderList({ items, goalTitle: title });

  return (
    <div data-reorder-list={items[0]?.goalId ?? ''}>
      <div style={{ ...S.sectionLabel, marginBottom: 7 }}>{title}</div>
      {/* R-backlog-23 — one live region per list, assertive for the duration of a grab. */}
      {list.liveRegion}
      {/* Q-14 / R-nav-13 — a refused reorder is a lost write, and a toast alone is insufficient. */}
      {list.error && <FieldError>{list.error}</FieldError>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.order.map((b) => (
          <BacklogItemCard
            key={b.id}
            item={b}
            selected={selected === b.id}
            onSelect={onSelect}
            reorder={{ control: list.controlProps(b), menu: list.menuFor(b), grabbed: list.grabbedId === b.id }}
          />
        ))}
      </div>
    </div>
  );
}
