import { useState } from 'react';
import type { GoalView } from '@goal-cascade/shared';
import { useUI } from '../context/UIContext';
import { useBacklog, useGoals, usePlan, useSavePlan } from '../api/queries';
import { TopActions } from '../components/TopActions';
import { Empty, FieldError, Loading, LoadError, commandError } from '../components/states';
import { useSkin } from '../skin';
import { ancestorsOf, leaves, lifeGoals, pathOf, rootIdOfGoalId } from '../utils/tree';

/**
 * R-plan-1..12 — the weekly plan: one sentence per non-Life leaf, for the CURRENT week only.
 *
 * The drafts are this screen's own state (R-plan-12: leaving without saving discards them), seeded from
 * the server's `isActive` and `focus`. The save is a whole-week REPLACE in one transaction (R-plan-7): a
 * leaf named with a sentence gets a focus, and every other non-Life leaf's focus for that week is removed.
 *
 * `weekStart` is sent explicitly, from the plan read model rather than from "now" (R-plan-2 / Q-3). That
 * is what makes a save that crossed a Monday boundary fail loudly with `WEEK_NOT_CURRENT` instead of
 * quietly writing into the wrong week.
 */
export function PlanScreen() {
  const S = useSkin();
  const ui = useUI();
  const planQ = usePlan(0);
  const goalsQ = useGoals(0);
  const backlogQ = useBacklog();
  const save = useSavePlan();

  const goals = goalsQ.data?.goals ?? [];
  const items = backlogQ.data?.items ?? [];

  // Drafts, keyed by goal id. `undefined` means "not touched" and falls back to the server's answer.
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<string | null>(null);
  const [flagged, setFlagged] = useState(false);

  const isChecked = (g: GoalView) => checked[g.id] ?? g.isActive;
  const draftOf = (g: GoalView) => drafts[g.id] ?? g.focus;

  const allLeaves = leaves(goals);
  const groups = lifeGoals(goals)
    .map((lg) => ({ id: lg.id, title: lg.title, leaves: allLeaves.filter((l) => rootIdOfGoalId(goals, l.id) === lg.id) }))
    .filter((g) => g.leaves.length)
    .filter((g) => !filter || g.id === filter);

  // R-plan-5 / D-9 — a leaf checked with a blank sentence does NOT stick. The mockup wrote `''` and
  // toasted "Plan saved", so the branch the owner just activated was dormant when they went looking for
  // it. Here the save is blocked and the offending rows say so.
  const incomplete = allLeaves.filter((l) => isChecked(l) && !draftOf(l).trim());

  const commit = () => {
    const week = planQ.data?.week;
    if (!week) return;
    if (incomplete.length) return setFlagged(true);
    const entries = allLeaves.filter((l) => isChecked(l) && draftOf(l).trim()).map((l) => ({ goalId: l.id, sentence: draftOf(l).trim() }));
    save.mutate(
      { weekStart: week.weekStart, entries },
      {
        onSuccess: () => {
          // R-plan-11 / R-plan-2 — the toast, and back to Tasks at week 0. `useSavePlan` has already
          // invalidated tasks, plan and goals, so there is no local state to juggle back into shape.
          setChecked({});
          setDrafts({});
          setFlagged(false);
          ui.selectWeek(0);
          ui.setScreen('tasks');
          ui.showToast('Plan saved');
        },
      },
    );
  };

  const failed = planQ.error ?? goalsQ.error;
  const pending = (planQ.isPending || goalsQ.isPending) && !failed;

  return (
    <div style={S.page} data-screen-label="Weekly planning">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={S.eyebrow}>Edit plan</div>
          <h1 style={{ ...S.h1, marginTop: 2 }}>Weekly planning</h1>
        </div>
        <TopActions />
      </div>
      <div style={{ fontSize: 13.5, color: S.T.mut, margin: '6px 0 12px 0' }}>
        Check the branches that are active this week, one focus sentence each. Unchecked branches go dormant.
      </div>

      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 14 }}>
        <button type="button" style={S.chipBtn(filter === null)} onClick={() => setFilter(null)}>
          All
        </button>
        {lifeGoals(goals).map((g) => (
          <button key={g.id} type="button" style={S.chipBtn(filter === g.id)} onClick={() => setFilter(g.id)}>
            {g.title}
          </button>
        ))}
      </div>

      {pending && <Loading label="Loading this week's plan…" />}
      {failed && <LoadError error={failed} what="the plan" onRetry={() => void planQ.refetch()} />}

      {!pending && !failed && allLeaves.length === 0 && (
        <Empty title="No branches to plan yet." body="A weekly focus lives on a sub-goal with no children of its own." />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {groups.map((grp) => (
          <div key={grp.id}>
            <div style={{ ...S.sectionLabel, marginBottom: 7 }}>{grp.title}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {grp.leaves.map((l) => {
                const on = isChecked(l);
                // R-plan-9 — the pull list: items on this leaf or any of its ancestors (the Life root holds
                // none, R-backlog-2). This is what makes planning pull-based rather than a blank page.
                const chain = new Set([l.id, ...ancestorsOf(goals, l).map((x) => x.id)]);
                const pool = items.filter((b) => chain.has(b.goalId));
                const missing = flagged && on && !draftOf(l).trim();
                return (
                  <div key={l.id} style={{ background: S.T.card, border: `1px solid ${missing ? S.T.redText : S.T.line}`, borderRadius: 12, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
                      <button
                        type="button"
                        aria-label={`${on ? 'Deactivate' : 'Activate'} ${l.title}`}
                        style={S.checkBox(on)}
                        onClick={() => setChecked((c) => ({ ...c, [l.id]: !on }))}
                      >
                        {on ? '✓' : ''}
                      </button>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: S.T.ink }}>{l.title}</div>
                        <div style={{ fontSize: 11.5, color: S.T.mut, marginTop: 1 }}>{pathOf(goals, l).slice(1, -1).join(' › ') || grp.title}</div>
                      </div>
                    </div>
                    {on && (
                      <>
                        <textarea
                          aria-label={`Focus for ${l.title}`}
                          value={draftOf(l)}
                          onChange={(e) => setDrafts((d) => ({ ...d, [l.id]: e.target.value }))}
                          rows={2}
                          placeholder="This week's focus — one sentence"
                          style={{
                            ...S.textarea,
                            marginTop: 10,
                            borderRadius: 10,
                            padding: '10px 12px',
                            fontSize: 15,
                            fontFamily: "'Newsreader', serif",
                            fontStyle: 'italic',
                            background: S.T.cardSoft,
                          }}
                        />
                        {missing && <FieldError>A checked branch needs a focus sentence to stick.</FieldError>}
                        {pool.length > 0 && (
                          <>
                            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: S.T.mut, margin: '10px 0 6px 0' }}>
                              FROM THE BACKLOG
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                              {pool.map((b) => (
                                <button
                                  key={b.id}
                                  type="button"
                                  // R-plan-9 / S-plan-9-2 — bound to THIS leaf, so the conversion is never ambiguous.
                                  onClick={() => ui.openSheet({ kind: 'taskCreate', goalId: l.id, title: b.title, fromBacklogId: b.id })}
                                  style={{
                                    textAlign: 'left',
                                    border: `1px dashed ${S.T.border}`,
                                    borderRadius: 10,
                                    background: S.T.cardSoft,
                                    padding: '9px 12px',
                                    fontSize: 13.5,
                                    color: S.body,
                                    cursor: 'pointer',
                                    minHeight: 40,
                                    fontFamily: 'inherit',
                                  }}
                                >
                                  + {b.title}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <FieldError>{commandError(save.error)}</FieldError>
      {flagged && incomplete.length > 0 && (
        <FieldError>
          {incomplete.length === 1 ? 'One checked branch has no focus sentence yet.' : `${incomplete.length} checked branches have no focus sentence yet.`}
        </FieldError>
      )}
      <button type="button" style={S.saveBtn(save.isPending || !planQ.data)} disabled={save.isPending || !planQ.data} onClick={commit}>
        {save.isPending ? 'Saving…' : 'Save plan'}
      </button>
    </div>
  );
}
