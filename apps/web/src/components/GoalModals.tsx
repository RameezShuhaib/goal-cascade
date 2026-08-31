import { useState } from 'react';
import { useNavigate } from 'react-router';
import { PULSES, type DeleteGoalResponse, type Horizon, type Pulse } from '@goal-cascade/shared';
import { useUI } from '../context/UIContext';
import { useCreateGoal, useDeleteGoal, useGoal, useGoalDeletePreview, useMoveGoal, usePatchGoal, useReplanGoal } from '../api/queries';
import { toApiError } from '../api/errors';
import { useSkin } from '../skin';
import { Sheet } from './Sheet';
import { FieldError, Loading, commandError } from './states';
import { plural } from '../utils/tree';
import { PERIOD_UNIT } from '../utils/periodKeys';
import { useParentOptions } from '../lens/useParentOptions';
import { lensPath } from '../routes';

/**
 * The four goal sheets: create/edit, move, re-plan, delete.
 *
 * Every guard here is an AFFORDANCE, not the rule. The server re-validates all of it (D-5: "a disabled
 * button is a hint, not an invariant"), and each sheet renders the refusal it can get back.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Create / edit
// ─────────────────────────────────────────────────────────────────────────────

/**
 * UX §6.7 — **the create sheet, with the horizon and the period already answered.**
 *
 * The heading names the horizon, so the horizon picker is gone entirely. **The period is a read-only chip
 * with its reason beside it** — not the editable text field the form used to have, which is what let you
 * type `Q9 3026` and, under R-goal-33, would put the goal in no lens at all. If you want a different
 * period you navigate there; that is the whole point of a lens.
 *
 * **Creating a goal into a period you are not looking at is impossible**, which is what makes R-nav-19's
 * "moves you to the target week" case unreachable from here.
 *
 * The parent picker lists only legal parents in the enclosing period (R-goal-5, `useParentOptions`), and
 * **when there is exactly one it is preselected** and the picker collapses to a single confirming row.
 */
export function GoalFormSheet({
  editId,
  horizon,
  periodKey,
  periodLabel,
  lifeGoalId,
  parentId,
}: {
  editId: string | null;
  horizon: Horizon;
  periodKey: string;
  periodLabel?: string;
  lifeGoalId?: string | null;
  parentId?: string | null;
}) {
  const S = useSkin();
  const ui = useUI();
  const navigate = useNavigate();
  const editQ = useGoal(editId);
  const create = useCreateGoal();
  const patch = usePatchGoal();
  const parents = useParentOptions(horizon, periodKey, lifeGoalId);

  const editing = editQ.data?.goal;
  const [draft, setDraft] = useState<{ title: string; why: string; pulse: Pulse } | null>(null);
  const [chosenParent, setChosenParent] = useState<string | null>(parentId ?? null);

  const close = () => ui.closeSheet();
  const fields = draft ?? { title: editing?.title ?? '', why: editing?.why ?? '', pulse: editing?.pulse ?? 'On track' };
  const set = (p: Partial<typeof fields>) => setDraft({ ...fields, ...p });

  if (editId && !editing) {
    return (
      <Sheet label="Edit goal" onClose={close}>
        <Loading />
      </Sheet>
    );
  }

  const isLife = horizon === 'Life';
  const only = parents.options.length === 1 ? parents.options[0]! : null;
  const parent = chosenParent ?? only?.id ?? null;
  const needsParent = !editId && !isLife;
  const label = periodLabel ?? periodKey;

  /**
   * The hardest creation empty state — no legal parent at all. `Start with a Life goal →` zooms to the
   * Life lens **and opens `New Life goal`**, so the loop closes in one tap: a handoff that dropped the
   * user's intent is exactly the nit this design exists to avoid.
   */
  if (needsParent && !parents.isPending && parents.options.length === 0) {
    const above = horizon === 'Yearly' ? 'a Life goal' : `a Life or ${horizon === 'Quarterly' ? 'Yearly' : horizon === 'Monthly' ? 'Quarterly' : 'Monthly'} goal`;
    return (
      <Sheet label={`New ${horizon} goal`} onClose={close}>
        <div style={{ fontSize: 13.5, color: S.T.mut, margin: '0 0 16px 0' }}>
          Nothing to hang this on yet — a {horizon.toLowerCase()} goal needs {above} above it.
        </div>
        <button
          type="button"
          style={{ ...S.btn(true), width: '100%' }}
          onClick={() => {
            navigate(lensPath('Life'));
            ui.openSheet({ kind: 'goalForm', editId: null, horizon: 'Life', periodKey: '' });
          }}
        >
          Start with a Life goal →
        </button>
      </Sheet>
    );
  }

  const blocked = !fields.title.trim() || (needsParent && !parent) || create.isPending || patch.isPending;

  const save = () => {
    if (editing) {
      // R-goal-14 — editing changes title, why and pulse. Re-parenting is Move; re-scheduling is Re-plan,
      // and a Weekly goal's period is immutable outright (R-goal-40).
      patch.mutate(
        { id: editing.id, patch: { title: fields.title.trim(), why: fields.why.trim(), pulse: fields.pulse, version: editing.version } },
        { onSuccess: () => { close(); ui.showToast('Goal updated'); } },
      );
      return;
    }
    create.mutate(
      {
        title: fields.title.trim(),
        why: fields.why.trim(),
        horizon,
        // R-goal-3 — a Life goal has no parent and no period; there is no `period` field on any request.
        parentId: isLife ? null : parent,
        ...(isLife ? {} : { periodKey }),
        pulse: fields.pulse,
      },
      { onSuccess: () => { close(); ui.showToast(isLife ? 'Life goal added' : `Added to ${label}`); } },
    );
  };

  return (
    <Sheet label={editing ? 'Edit goal' : `New ${horizon} goal`} onClose={close}>
      <input aria-label="Goal title" value={fields.title} onChange={(e) => set({ title: e.target.value })} placeholder="Goal title" style={{ ...S.input, marginBottom: 10 }} />
      <input aria-label="Why? (optional)" value={fields.why} onChange={(e) => set({ why: e.target.value })} placeholder="Why? (optional)" style={{ ...S.input, marginBottom: 14 }} />

      {!isLife && !editing && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{ ...S.chipBtn(false), display: 'inline-flex', alignItems: 'center', cursor: 'default' }}>{label}</span>
          <span style={{ flex: 1, fontSize: 12.5, color: S.T.mut }}>Because you&apos;re looking at {label}.</span>
        </div>
      )}

      {needsParent && (
        <>
          <div style={{ ...S.fieldLabel, marginBottom: 6 }}>UNDER</div>
          <div style={{ border: `1px solid ${S.T.line}`, borderRadius: 12, maxHeight: 200, overflow: 'auto', marginBottom: 14 }}>
            {parents.isPending && <div style={{ fontSize: 13, color: S.T.mut, padding: '12px 14px' }}>Loading…</div>}
            {parents.options.map((g) => (
              <button key={g.id} type="button" style={S.pickerRow(parent === g.id ? 'sel' : 'ok')} onClick={() => setChosenParent(g.id)}>
                <span style={{ flex: 1, minWidth: 0 }}>{g.title}</span>
                <span style={{ fontSize: 10.5, fontWeight: 800, color: S.T.mut, marginLeft: 7 }}>{g.horizon.toUpperCase()}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div style={{ ...S.fieldLabel, marginBottom: 6 }}>PULSE</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {PULSES.map((p) => (
          <button key={p} type="button" style={S.chipBtn(fields.pulse === p)} onClick={() => set({ pulse: p })}>
            {p}
          </button>
        ))}
      </div>

      <FieldError>{commandError(create.error) ?? commandError(patch.error)}</FieldError>
      <button type="button" style={S.saveBtn(blocked)} disabled={blocked} onClick={save}>
        {editing ? 'Save changes' : 'Save goal'}
      </button>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Move
// ─────────────────────────────────────────────────────────────────────────────

/**
 * R-goal-16/17/18 — re-parent. Children move with the goal, and only `parentId` changes.
 *
 * ⚠ **A2** — the picker lists **legal targets only**, and R-goal-19's two disabled reasons no longer have
 * anything to annotate: a parent must be strictly longer-horizon, and every descendant of the moved goal
 * is strictly shorter, so no descendant and no horizon conflict can appear in the list at all. The
 * refusals are still the mechanism — `WOULD_CREATE_CYCLE` and `HORIZON_CONFLICT` come back as codes and
 * are rendered from the code, never guessed (D-5).
 */
export function MoveGoalSheet({ goalId, lifeGoalsOnly }: { goalId: string; lifeGoalsOnly?: boolean }) {
  const S = useSkin();
  const ui = useUI();
  const detailQ = useGoal(goalId);
  const move = useMoveGoal();
  const [target, setTarget] = useState<string | null>(null);

  const moving = detailQ.data?.goal;
  const close = () => ui.closeSheet();
  const parents = useParentOptions(moving?.horizon ?? 'Weekly', moving?.periodKey ?? '');

  if (!moving) {
    return (
      <Sheet label="Move goal" onClose={close}>
        <Loading />
      </Sheet>
    );
  }

  // R-lens-20 — `Put under a Life goal…` opens this same sheet with the Life goals pre-listed.
  const rows = parents.options.filter((g) => (lifeGoalsOnly ? g.horizon === 'Life' : g.id !== moving.id));

  return (
    <Sheet label={lifeGoalsOnly ? 'Put under a Life goal' : 'Move goal'} onClose={close}>
      <div style={{ fontSize: 13.5, color: S.T.mut, margin: '0 0 12px 0' }}>
        Pick a new parent for &quot;{moving.title}&quot;. Its children move with it.
      </div>
      <div style={{ border: `1px solid ${S.T.line}`, borderRadius: 12, maxHeight: 230, overflow: 'auto' }}>
        {rows.map((g) => (
          <button key={g.id} type="button" onClick={() => setTarget(g.id)} style={S.pickerRow(target === g.id ? 'sel' : 'ok')}>
            <span style={{ flex: 1, minWidth: 0 }}>{g.title}</span>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: S.T.mut, marginLeft: 7 }}>{g.horizon.toUpperCase()}</span>
          </button>
        ))}
        {rows.length === 0 && <div style={{ fontSize: 13, color: S.T.mut, padding: '12px 14px' }}>No goal on a longer horizon yet.</div>}
      </div>
      <FieldError>{commandError(move.error)}</FieldError>
      <button
        type="button"
        style={S.saveBtn(!target || move.isPending)}
        disabled={!target || move.isPending}
        onClick={() =>
          target &&
          move.mutate({ id: moving.id, parentId: target, version: moving.version }, { onSuccess: () => { close(); ui.showToast(`Moved under ${rows.find((r) => r.id === target)?.title ?? 'it'}`); } })
        }
      >
        Move it
      </button>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-plan
// ─────────────────────────────────────────────────────────────────────────────

/**
 * R-goal-40 — a contextual next period plus an OPTIONAL one-line reason; nothing is mandatory.
 *
 * ⚠ **A2** — the options are `PeriodView`s carrying both the canonical `periodKey` (which is what is
 * written) and the rendered `label` (which is what is shown), and they are the SERVER's derivation. A
 * client that re-derived the list from `serverNow` would be a second implementation of one date rule, and
 * two implementations drift on the first boundary (D-3).
 *
 * Neither a **Life** goal (no period at all) nor a **Weekly** goal (a Weekly goal *is* a week; moving it
 * would restate what a past week contained — D-2) is re-plannable, so both answer with an empty list.
 */
export function ReplanGoalSheet({ goalId }: { goalId: string }) {
  const S = useSkin();
  const ui = useUI();
  const detailQ = useGoal(goalId);
  const replan = useReplanGoal();
  const [index, setIndex] = useState(0);
  const [reason, setReason] = useState('');

  const goal = detailQ.data?.goal;
  const close = () => ui.closeSheet();
  if (!goal) {
    return (
      <Sheet label="Re-plan goal" onClose={close}>
        <Loading />
      </Sheet>
    );
  }

  const options = detailQ.data?.replanOptions ?? [];
  const chosen = options[Math.min(index, options.length - 1)];

  if (options.length === 0) {
    const why =
      goal.horizon === 'Life'
        ? 'Life goals are not re-planned; the goals under them are.'
        : goal.horizon === 'Weekly'
          ? 'A weekly goal is a week. Write a new one in the week you mean — moving this would restate what a past week held.'
          : 'No later period to move to.';
    return (
      <Sheet label="Re-plan goal" onClose={close}>
        <div style={{ fontSize: 13.5, color: S.T.mut, margin: '0 0 14px 0' }}>{why}</div>
        <button type="button" style={{ ...S.btn(true), width: '100%' }} onClick={close}>
          Got it
        </button>
      </Sheet>
    );
  }

  return (
    <Sheet label="Re-plan goal" onClose={close}>
      <div style={{ fontSize: 14, color: S.body, margin: '0 0 14px 0' }}>
        “{goal.title}” · {goal.period || '—'} → {chosen?.label ?? '—'}
      </div>
      <div style={{ ...S.fieldLabel, marginBottom: 6 }}>NEW TARGET {PERIOD_UNIT[goal.horizon].toUpperCase()}</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {options.map((p, i) => (
          <button key={p.periodKey} type="button" style={S.btn(index === i)} onClick={() => setIndex(i)}>
            {p.label}
          </button>
        ))}
      </div>
      <input aria-label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? (optional)" style={S.input} />
      <div style={{ fontSize: 12.5, color: S.T.mut, marginTop: 5 }}>No mandatory fields. Fast and guilt-free.</div>
      <FieldError>{commandError(replan.error)}</FieldError>
      <button
        type="button"
        style={S.saveBtn(!chosen || replan.isPending)}
        disabled={!chosen || replan.isPending}
        onClick={() =>
          chosen &&
          replan.mutate(
            { id: goal.id, periodKey: chosen.periodKey, ...(reason.trim() ? { reason: reason.trim() } : {}), version: goal.version },
            { onSuccess: () => { close(); ui.showToast(`Re-planned to ${chosen.label}`); } },
          )
        }
      >
        Re-plan it
      </button>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete
// ─────────────────────────────────────────────────────────────────────────────

/** Q-5's three numbers: `N sub-goals, M tasks, K backlog items`. A view concern, not a wire shape. */
type DeleteCounts = { subGoals: number; tasks: number; backlogItems: number };

/**
 * The dry run answers with a whole `DeleteGoalResponse`, and `removed.goals` counts the goal ITSELF — so
 * the sub-goal count is one less. ⚠ **A2** — `removed.weeklyGoals` is a *subset* of `removed.goals` and is
 * reported separately because it is the number that can be large (R-task-47); it is deliberately not added
 * in, or a Monthly goal's weeks would be counted twice.
 */
const countsOf = (r: DeleteGoalResponse): DeleteCounts => ({
  subGoals: Math.max(0, r.removed.goals - 1),
  tasks: r.removed.tasks,
  backlogItems: r.removed.backlogItems,
});

const destroysSomething = (c: DeleteCounts): boolean => c.subGoals + c.tasks + c.backlogItems > 0;

const REMOVED_NOUNS: ReadonlyArray<readonly [keyof DeleteCounts, string]> = [
  ['subGoals', 'sub-goal'],
  ['tasks', 'task'],
  ['backlogItems', 'backlog item'],
];

/**
 * `2 tasks and 1 backlog item` — the losses, and only the losses. A category at zero is dropped; `plural`
 * still decides each surviving noun's ending, so `1 backlog item` stays singular.
 */
const removalList = (c: DeleteCounts): string => {
  const parts = REMOVED_NOUNS.filter(([k]) => c[k] > 0).map(([k, noun]) => plural(c[k], noun));
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
};

/**
 * Q-5 — delete, and the acknowledgement it needs.
 *
 * `GOAL_HAS_CHILDREN` fires only on descendant GOALS, so the counts are asked for FIRST, for every goal
 * (`?dryRun=true`), and the button is not offered until they land. That matters more after A2, not less:
 * deleting a Monthly goal now takes its Weekly children and all of their tasks (R-task-47).
 */
export function DeleteGoalSheet({ goalId }: { goalId: string }) {
  const S = useSkin();
  const ui = useUI();
  const navigate = useNavigate();
  const detailQ = useGoal(goalId);
  const previewQ = useGoalDeletePreview(goalId);
  const remove = useDeleteGoal();
  const [refused, setRefused] = useState<DeleteCounts | null>(null);

  const goal = detailQ.data?.goal;
  const close = () => ui.closeSheet();
  if (!goal) {
    return (
      <Sheet label="Delete goal" onClose={close}>
        <Loading />
      </Sheet>
    );
  }

  const counts = refused ?? (previewQ.data ? countsOf(previewQ.data) : null);
  const destroys = counts ? destroysSomething(counts) : false;
  /** Still asking. The delete button is not offered yet — that wait IS the fix. */
  const checking = !counts && previewQ.isPending;

  const finish = () => {
    close();
    // The page was showing something that no longer exists (D-27).
    navigate(lensPath(ui.lastLens));
    ui.showToast('Goal deleted');
  };

  const attempt = () =>
    remove.mutate(
      { id: goal.id, ...(destroys ? { cascade: true } : {}) },
      {
        onSuccess: finish,
        onError: (e) => {
          const d = toApiError(e).details;
          if (d && typeof d.subGoals === 'number') {
            setRefused({ subGoals: d.subGoals, tasks: Number(d.tasks ?? 0), backlogItems: Number(d.backlogItems ?? 0) });
          }
        },
      },
    );

  return (
    <Sheet label={`Delete “${goal.title}”?`} onClose={close}>
      <div role="status" style={{ fontSize: 13.5, color: counts && destroys ? S.body : S.T.mut, margin: '0 0 14px 0' }}>
        {checking
          ? 'Checking what this would remove…'
          : counts && destroys
            ? `This removes ${removalList(counts)}. Learnings tagged here move to Unsorted. There is no undo.`
            : counts
              ? 'This goal holds nothing else. There is no trash and no undo.'
              : 'There is no trash and no undo.'}
      </div>
      <FieldError>{counts ? null : commandError(remove.error)}</FieldError>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button type="button" style={{ ...S.btn(true, true), width: '100%', minHeight: 46 }} disabled={remove.isPending || checking} onClick={attempt}>
          {destroys ? 'Delete everything' : 'Delete'}
        </button>
        <button type="button" style={{ ...S.btn(false), width: '100%', minHeight: 46 }} onClick={close}>
          Keep it
        </button>
      </div>
    </Sheet>
  );
}
