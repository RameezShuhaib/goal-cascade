import { useState } from 'react';
import type { BacklogItemView } from '@goal-cascade/shared';
import { useUI } from '../context/UIContext';
import { useBacklog, useGoals } from '../api/queries';
import { TopActions } from '../components/TopActions';
import { BacklogItemCard } from '../components/BacklogItemCard';
import { Empty, Loading, LoadError } from '../components/states';
import { useSkin } from '../skin';
import { lifeGoals, nonLifeGoals, rootIdOfGoalId } from '../utils/tree';

/**
 * R-backlog-13 — the full backlog page: grouped by `<Life goal> › <owning goal>`, newest first.
 *
 * The order is the SERVER's (`capturedAt` desc, `id` desc — Q-7/D-17). The mockup relied on array
 * insertion order and stored display strings like `'Today'` and `'25 Aug'`, which no refetch could sort;
 * here the row renders `capturedAt` and never stores what it renders.
 *
 * R-nav-2 — this page has no tab. It is reached from the `+` drawer or a Life goal's detail screen.
 */
export function BacklogScreen() {
  const S = useSkin();
  const ui = useUI();
  const backlogQ = useBacklog();
  const goalsQ = useGoals(0);
  const [selected, setSelected] = useState<string | null>(null);

  const goals = goalsQ.data?.goals ?? [];
  const items = backlogQ.data?.items ?? [];

  const groups: { key: string; title: string; items: BacklogItemView[] }[] = [];
  for (const life of lifeGoals(goals)) {
    for (const g of nonLifeGoals(goals)) {
      if (rootIdOfGoalId(goals, g.id) !== life.id) continue;
      const mine = items.filter((b) => b.goalId === g.id);
      if (mine.length) groups.push({ key: g.id, title: `${life.title} › ${g.title}`, items: mine });
    }
  }
  // D-27 — an item whose goal is missing from this payload must still be reachable, not silently dropped.
  const grouped = new Set(groups.flatMap((grp) => grp.items.map((b) => b.id)));
  const orphans = items.filter((b) => !grouped.has(b.id));
  if (orphans.length) groups.push({ key: '__orphans', title: 'Elsewhere', items: orphans });

  const failed = backlogQ.error ?? goalsQ.error;
  const pending = (backlogQ.isPending || goalsQ.isPending) && !failed;

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
          <div key={grp.key}>
            <div style={{ ...S.sectionLabel, marginBottom: 7 }}>{grp.title}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {grp.items.map((b) => (
                <BacklogItemCard key={b.id} item={b} goals={goals} selected={selected === b.id} onSelect={setSelected} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
