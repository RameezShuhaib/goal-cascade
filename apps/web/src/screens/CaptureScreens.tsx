import { useState } from 'react';
import type { GoalView, LearningView } from '@goal-cascade/shared';
import {
  useAttachLearning,
  useCreateLearning,
  useDeleteLearning,
  useLearnings,
  useLens,
  usePatchLearning,
} from '../api/queries';
import { GoalPicker } from '../components/GoalPicker';
import { TopActions } from '../components/TopActions';
import { Empty, FieldError, Loading, LoadError, commandError } from '../components/states';
import { useSkin } from '../skin';
import { capturedLabel } from '../utils/dates';
import { node } from '../utils/tree';

/**
 * Learnings — the capture surface. A learning tags a LIFE goal or nothing (R-learning-2); a non-Life tag
 * is refused with `409 NOT_A_LIFE_GOAL`, so the picker offers Life goals only and the server is the
 * guard behind it.
 */

/**
 * R-learning-2 — grouped by Life goal, then `Unsorted`, newest first (the server's order).
 *
 * ⚠ **A2** — `goals` is now the **Life lens's** items rather than a filtered whole tree: the Life lens is
 * the one unscoped read in the product (R-lens-2) and is bounded by the number of Life goals, so this is
 * the same list by a cheaper route. A Learning tags a Life goal or nothing, so it is also the only list
 * this screen ever needed.
 */
function groupByLife<T extends { goalId: string | null }>(goals: GoalView[], list: T[]) {
  const groups: { key: string; title: string; items: T[] }[] = [];
  for (const lg of goals) {
    const mine = list.filter((x) => x.goalId === lg.id);
    if (mine.length) groups.push({ key: lg.id, title: lg.title, items: mine });
  }
  // A tag pointing at a goal that no longer exists renders under Unsorted rather than disappearing.
  // Q-5's cascade nulls those tags server-side; this covers the window before a refetch.
  const unsorted = list.filter((x) => !x.goalId || !node(goals, x.goalId));
  if (unsorted.length) groups.push({ key: '__unsorted', title: 'Unsorted', items: unsorted });
  return groups;
}

/**
 * R-learning-2 — `No goal` plus one row per Life goal. Nothing else is a valid tag, and the server
 * refuses anything else with `NOT_A_LIFE_GOAL`.
 *
 * ⚠ **R-nav-31** — a wall of `chipBtn` pills became the one goal picker in `lifeLine` mode. A Life-goal
 * list is the one that does not group (every row would be its own header), so it renders flat, with
 * `No goal` leading it exactly as the chip row had it.
 */
function LifeGoalPicker({ value, onPick }: { value: string | null; onPick: (id: string | null) => void }) {
  return (
    <div style={{ marginTop: 10 }}>
      <GoalPicker mode={{ kind: 'lifeLine' }} value={value} onChange={onPick} extra={{ label: 'No goal' }} listLabel="Life goals" />
    </div>
  );
}

function Group<T extends { id: string }>({ title, items, render }: { title: string; items: T[]; render: (x: T) => React.ReactNode }) {
  const S = useSkin();
  return (
    <div>
      <div style={{ ...S.sectionLabel, marginBottom: 7 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{items.map((x) => render(x))}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Learnings
// ─────────────────────────────────────────────────────────────────────────────

export function LearningsScreen() {
  const S = useSkin();
  const learningsQ = useLearnings();
  const goalsQ = useLens('Life');
  const create = useCreateLearning();
  const [text, setText] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const goals = goalsQ.data?.items ?? [];
  const learnings = learningsQ.data?.learnings ?? [];
  const groups = groupByLife(goals, learnings);

  const capture = () => {
    if (!text.trim()) return;
    create.mutate(
      { text: text.trim(), goalId: tag, applied: false },
      {
        onSuccess: () => {
          setText('');
          setTag(null);
        },
      },
    );
  };

  return (
    <div style={S.page} data-screen-label="Learnings">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={S.eyebrow}>Insights</div>
          <h1 style={{ ...S.h1, margin: '2px 0 12px 0' }}>Learnings</h1>
        </div>
        <TopActions />
      </div>

      <div style={{ ...S.card, padding: 14 }}>
        <input
          aria-label="What did you learn?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && capture()}
          placeholder="What did you learn?"
          style={{ ...S.input, background: S.T.cardSoft }}
        />
        <LifeGoalPicker value={tag} onPick={setTag} />
        <FieldError>{commandError(create.error)}</FieldError>
        <button type="button" style={S.saveBtn(!text.trim() || create.isPending)} disabled={!text.trim() || create.isPending} onClick={capture}>
          Capture it
        </button>
      </div>

      {learningsQ.isPending && <Loading label="Loading your learnings…" />}
      {learningsQ.error && <LoadError error={learningsQ.error} what="your learnings" onRetry={() => void learningsQ.refetch()} />}
      {!learningsQ.isPending && !learningsQ.error && learnings.length === 0 && (
        <div style={{ marginTop: 20 }}>
          <Empty title="No learnings yet." body="When reality surprises you, write it down — future-you will use it." />
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 20 }}>
        {groups.map((grp) => (
          <Group
            key={grp.key}
            title={grp.title}
            items={grp.items}
            render={(it) => (
              <LearningCard key={it.id} learning={it} selected={selected === it.id} onSelect={setSelected} />
            )}
          />
        ))}
      </div>
    </div>
  );
}

function LearningCard({
  learning,
  selected,
  onSelect,
}: {
  learning: LearningView;
  selected: boolean;
  onSelect: (id: string | null) => void;
}) {
  const S = useSkin();
  const attach = useAttachLearning();
  const patch = usePatchLearning();
  const remove = useDeleteLearning();
  const [attaching, setAttaching] = useState(false);

  return (
    <div style={{ background: S.T.card, borderRadius: 12, padding: '12px 14px', border: `1px solid ${selected ? S.ring : S.T.line}` }}>
      <button
        type="button"
        onClick={() => {
          setAttaching(false);
          onSelect(selected ? null : learning.id);
        }}
        style={{ width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: 0, cursor: 'pointer', minHeight: 44, fontFamily: 'inherit' }}
      >
        <div style={{ ...S.serif, fontSize: 14.5, color: S.T.ink }}>“{learning.text}”</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <span style={{ fontSize: 12, color: S.T.mut }}>Captured {capturedLabel(learning.capturedAt)}</span>
          {learning.applied && (
            <span
              style={{ fontSize: 11, fontWeight: 700, color: S.T.accent, background: S.T.accentSoft, borderRadius: 8, padding: '2px 7px', whiteSpace: 'nowrap' }}
            >
              changed the plan
            </span>
          )}
        </div>
      </button>

      {/* R-learning-3 / S-learning-3-1 — re-tag to another Life goal, or back to Unsorted with `null`. */}
      {selected && attaching && (
        <LifeGoalPicker
          value={learning.goalId}
          onPick={(id) => attach.mutate({ id: learning.id, goalId: id, version: learning.version }, { onSuccess: () => { setAttaching(false); onSelect(null); } })}
        />
      )}

      {selected && !attaching && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <button type="button" style={S.menuBtn} onClick={() => setAttaching(true)}>
            Attach to a goal
          </button>
          {/*
           * R-learning-4 / D-23 — the badge has to be earnable. The mockup rendered `applied` and had no way
           * to set it, so only the seed data ever carried it. R-learning-3 names two tap actions; this is a
           * third, and it is the only way the ruleset's own product signal can exist.
           */}
          <button
            type="button"
            style={S.menuBtn}
            disabled={patch.isPending}
            onClick={() => patch.mutate({ id: learning.id, patch: { applied: !learning.applied, version: learning.version } })}
          >
            {learning.applied ? 'Didn’t change the plan' : 'Changed the plan'}
          </button>
          <button
            type="button"
            style={S.dangerBtn}
            disabled={remove.isPending}
            onClick={() => remove.mutate({ id: learning.id }, { onSuccess: () => onSelect(null) })}
          >
            Discard
          </button>
        </div>
      )}
    </div>
  );
}
