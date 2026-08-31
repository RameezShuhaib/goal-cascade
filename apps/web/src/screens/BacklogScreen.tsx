import { useMemo, useState } from 'react';
import type { BacklogItemView } from '@goal-cascade/shared';
import { useUI } from '../context/UIContext';
import { useBacklog, useLens } from '../api/queries';
import { TopActions } from '../components/TopActions';
import { BacklogItemCard } from '../components/BacklogItemCard';
import { Empty, Loading, LoadError } from '../components/states';
import { useSkin } from '../skin';

/**
 * R-backlog-13 — the full backlog page: grouped by `<Life goal> › <owning goal>`, newest first.
 *
 * The ORDER is the server's (`capturedAt` desc, `id` desc — Q-7/D-17) and nothing here re-sorts.
 *
 * ⚠ **A2** — the grouping is now best-effort, and the reason is a real limit rather than a shortcut. A
 * `BacklogItemView` carries `goalId` and no title, and the client holds no tree to look one up in
 * (R-lens-16). Three scoped lens reads — this year's, this quarter's and this month's goals, which is
 * where backlog items overwhelmingly sit — plus the Life lens give most items a header; anything they do
 * not cover falls into **`Elsewhere`** rather than being dropped, which is the position `orderedTree`
 * already took for a broken chain (D-27). Recorded in `docs/work/17-lens-web/build.md`: the honest fix is
 * an owning-goal label on the wire, not more reads from here.
 *
 * R-nav-2 — this page has no tab. It is reached from the `+` drawer or a goal's detail page.
 */
export function BacklogScreen() {
  const S = useSkin();
  const ui = useUI();
  const backlogQ = useBacklog();
  const [selected, setSelected] = useState<string | null>(null);

  const life = useLens('Life');
  const yearly = useLens('Yearly');
  const quarterly = useLens('Quarterly');
  const monthly = useLens('Monthly');

  const labels = useMemo(() => {
    const lifeTitles = new Map((life.data?.items ?? []).map((g) => [g.id, g.title]));
    const out = new Map<string, string>();
    for (const g of [...(yearly.data?.items ?? []), ...(quarterly.data?.items ?? []), ...(monthly.data?.items ?? [])]) {
      const root = g.lifeRootId ? lifeTitles.get(g.lifeRootId) : undefined;
      out.set(g.id, root ? `${root} › ${g.title}` : g.title);
    }
    return out;
  }, [life.data, yearly.data, quarterly.data, monthly.data]);

  const items = backlogQ.data?.items ?? [];
  const groups: { key: string; title: string; items: BacklogItemView[] }[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const title = labels.get(item.goalId);
    if (!title) continue;
    if (!seen.has(item.goalId)) {
      seen.add(item.goalId);
      groups.push({ key: item.goalId, title, items: items.filter((b) => b.goalId === item.goalId) });
    }
  }
  const orphans = items.filter((b) => !labels.has(b.goalId));
  if (orphans.length) groups.push({ key: '__elsewhere', title: 'Elsewhere', items: orphans });

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
          <div key={grp.key}>
            <div style={{ ...S.sectionLabel, marginBottom: 7 }}>{grp.title}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {grp.items.map((b) => (
                <BacklogItemCard key={b.id} item={b} selected={selected === b.id} onSelect={setSelected} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
