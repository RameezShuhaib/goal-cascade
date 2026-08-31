import { useState } from 'react';
import type { GoalView, IdeaView, LearningView } from '@goal-cascade/shared';
import { useUI } from '../context/UIContext';
import {
  useAttachIdea,
  useAttachLearning,
  useCreateIdea,
  useCreateLearning,
  useDeleteIdea,
  useDeleteLearning,
  useGoals,
  useIdeas,
  useLearnings,
  usePatchLearning,
} from '../api/queries';
import { TopActions } from '../components/TopActions';
import { Empty, FieldError, Loading, LoadError, commandError } from '../components/states';
import { useSkin } from '../skin';
import { capturedLabel } from '../utils/dates';
import { lifeGoals, node, nonLifeGoals } from '../utils/tree';

/**
 * Ideas and Learnings — the two capture surfaces. Both tag a LIFE goal or nothing (R-idea-2,
 * R-learning-2); a non-Life tag is refused with `409 NOT_A_LIFE_GOAL`, so the chip row offers Life goals
 * only and the server is the guard behind it.
 */

/** R-idea-7 / R-learning-2 — grouped by Life goal, then `Unsorted`, newest first (the server's order). */
function groupByLife<T extends { goalId: string | null }>(goals: GoalView[], list: T[]) {
  const groups: { key: string; title: string; items: T[] }[] = [];
  for (const lg of lifeGoals(goals)) {
    const mine = list.filter((x) => x.goalId === lg.id);
    if (mine.length) groups.push({ key: lg.id, title: lg.title, items: mine });
  }
  // A tag pointing at a goal that no longer exists renders under Unsorted rather than disappearing
  // (S-idea-7-1). Q-5's cascade nulls those tags server-side; this covers the window before a refetch.
  const unsorted = list.filter((x) => !x.goalId || !node(goals, x.goalId));
  if (unsorted.length) groups.push({ key: '__unsorted', title: 'Unsorted', items: unsorted });
  return groups;
}

/** R-idea-2 — `No goal` plus one chip per Life goal. Nothing else is a valid tag. */
function LifeGoalChips({ goals, value, onPick }: { goals: GoalView[]; value: string | null; onPick: (id: string | null) => void }) {
  const S = useSkin();
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
      <button type="button" style={S.chipBtn(value === null)} onClick={() => onPick(null)}>
        No goal
      </button>
      {lifeGoals(goals).map((g) => (
        <button key={g.id} type="button" style={S.chipBtn(value === g.id)} onClick={() => onPick(g.id)}>
          {g.title}
        </button>
      ))}
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
// Ideas
// ─────────────────────────────────────────────────────────────────────────────

export function IdeasScreen() {
  const S = useSkin();
  const ideasQ = useIdeas();
  const goalsQ = useGoals(0);
  const create = useCreateIdea();
  const [text, setText] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const goals = goalsQ.data?.goals ?? [];
  const ideas = ideasQ.data?.ideas ?? [];
  const groups = groupByLife(goals, ideas);

  const park = () => {
    if (!text.trim()) return;
    create.mutate(
      { text: text.trim(), goalId: tag },
      {
        onSuccess: () => {
          setText('');
          setTag(null);
        },
      },
    );
  };

  return (
    <div style={S.page} data-screen-label="Ideas">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={S.eyebrow}>Parking lot</div>
          <h1 style={{ ...S.h1, margin: '2px 0 12px 0' }}>Ideas</h1>
        </div>
        <TopActions />
      </div>

      <div style={{ ...S.card, padding: 14 }}>
        <input
          aria-label="Park an idea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && park()}
          placeholder="Park an idea…"
          style={{ ...S.input, background: S.T.cardSoft }}
        />
        <LifeGoalChips goals={goals} value={tag} onPick={setTag} />
        <FieldError>{commandError(create.error)}</FieldError>
        <button type="button" style={S.saveBtn(!text.trim() || create.isPending)} disabled={!text.trim() || create.isPending} onClick={park}>
          Park it
        </button>
      </div>

      {ideasQ.isPending && <Loading label="Loading the parking lot…" />}
      {ideasQ.error && <LoadError error={ideasQ.error} what="your ideas" onRetry={() => void ideasQ.refetch()} />}
      {!ideasQ.isPending && !ideasQ.error && ideas.length === 0 && (
        <div style={{ marginTop: 20 }}>
          <Empty title="Nothing parked." body="When an idea grabs you mid-task, drop it here and get back to work." />
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 20 }}>
        {groups.map((grp) => (
          <Group
            key={grp.key}
            title={grp.title}
            items={grp.items}
            render={(it) => (
              <IdeaCard key={it.id} idea={it} goals={goals} selected={selected === it.id} onSelect={setSelected} />
            )}
          />
        ))}
      </div>
    </div>
  );
}

function IdeaCard({
  idea,
  goals,
  selected,
  onSelect,
}: {
  idea: IdeaView;
  goals: GoalView[];
  selected: boolean;
  onSelect: (id: string | null) => void;
}) {
  const S = useSkin();
  const ui = useUI();
  const attach = useAttachIdea();
  const remove = useDeleteIdea();
  const [attaching, setAttaching] = useState(false);

  /**
   * R-idea-4 / D-22 — "Task this week".
   *
   * The idea is NOT removed here. It is consumed by `POST /ideas/:id/convert-to-task`, only on a task that
   * actually got created — the mockup deleted it from the list and then opened the modal, so cancelling
   * lost it forever, in the one feature whose whole promise is "capture it and get back to work".
   *
   * R-task-4 / D-10 — with no active leaf there is no target and no fallback goal (the mockup fell back to
   * the literal seed id `'g4'`). The owner is routed to planning instead.
   */
  const taskThisWeek = () => {
    const active = goals.filter((g) => g.isLeaf && g.isActive && g.parentId !== null);
    onSelect(null);
    if (active.length === 0) {
      ui.openSheet({ kind: 'inactiveBranch', itemId: idea.id, title: idea.text });
      return;
    }
    ui.openSheet({ kind: 'taskCreate', goalId: active[0]!.id, title: idea.text, fromIdeaId: idea.id });
  };

  return (
    <div style={{ background: S.T.card, borderRadius: 12, padding: '12px 14px', border: `1px solid ${selected ? S.ring : S.T.line}` }}>
      <button
        type="button"
        onClick={() => {
          setAttaching(false);
          onSelect(selected ? null : idea.id);
        }}
        style={{ width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: 0, cursor: 'pointer', minHeight: 44, fontFamily: 'inherit' }}
      >
        <div style={{ fontSize: 14.5, color: S.T.ink }}>{idea.text}</div>
        <div style={{ fontSize: 12, color: S.T.mut, marginTop: 3 }}>Parked {capturedLabel(idea.capturedAt)}</div>
      </button>

      {selected && attaching && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: S.T.mut, marginTop: 8 }}>SEND TO WHICH GOAL&apos;S BACKLOG?</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {/* R-idea-5 — a NON-Life goal's backlog. One atomic command: the item appears and the idea is
                consumed together, where the mockup did two writes and persisted neither reliably (D-26). */}
            {nonLifeGoals(goals).map((g) => (
              <button
                key={g.id}
                type="button"
                style={S.chipBtn(false)}
                disabled={attach.isPending}
                onClick={() =>
                  attach.mutate(
                    { id: idea.id, goalId: g.id },
                    {
                      onSuccess: () => {
                        setAttaching(false);
                        onSelect(null);
                        ui.showToast(`Moved to Backlog under ${g.title}`);
                      },
                    },
                  )
                }
              >
                {g.title}
              </button>
            ))}
            {nonLifeGoals(goals).length === 0 && <div style={{ fontSize: 13, color: S.T.mut }}>No sub-goal to file it under yet.</div>}
          </div>
        </>
      )}

      {selected && !attaching && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <button type="button" style={S.menuBtn} onClick={taskThisWeek}>
            Task this week
          </button>
          <button type="button" style={S.menuBtn} onClick={() => setAttaching(true)}>
            Attach to a goal
          </button>
          {/* R-idea-6 — no confirmation, but it IS a server call now; the mockup only spliced an array. */}
          <button type="button" style={S.dangerBtn} disabled={remove.isPending} onClick={() => remove.mutate({ id: idea.id }, { onSuccess: () => onSelect(null) })}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Learnings
// ─────────────────────────────────────────────────────────────────────────────

export function LearningsScreen() {
  const S = useSkin();
  const learningsQ = useLearnings();
  const goalsQ = useGoals(0);
  const create = useCreateLearning();
  const [text, setText] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const goals = goalsQ.data?.goals ?? [];
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
        <LifeGoalChips goals={goals} value={tag} onPick={setTag} />
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
              <LearningCard key={it.id} learning={it} goals={goals} selected={selected === it.id} onSelect={setSelected} />
            )}
          />
        ))}
      </div>
    </div>
  );
}

function LearningCard({
  learning,
  goals,
  selected,
  onSelect,
}: {
  learning: LearningView;
  goals: GoalView[];
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

      {selected && attaching && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {/* R-learning-3 / S-learning-3-1 — re-tag to another Life goal, or back to Unsorted with `null`. */}
          <button
            type="button"
            style={S.chipBtn(learning.goalId === null)}
            onClick={() =>
              attach.mutate({ id: learning.id, goalId: null, version: learning.version }, { onSuccess: () => { setAttaching(false); onSelect(null); } })
            }
          >
            No goal
          </button>
          {lifeGoals(goals).map((g) => (
            <button
              key={g.id}
              type="button"
              style={S.chipBtn(learning.goalId === g.id)}
              onClick={() =>
                attach.mutate({ id: learning.id, goalId: g.id, version: learning.version }, { onSuccess: () => { setAttaching(false); onSelect(null); } })
              }
            >
              {g.title}
            </button>
          ))}
        </div>
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
