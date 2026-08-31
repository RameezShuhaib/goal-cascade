import { useState } from 'react';
import { HORIZONS, PULSES, type DeleteGoalResponse, type GoalView, type Horizon, type Pulse } from '@goal-cascade/shared';
import { useUI } from '../context/UIContext';
import {
  useCreateGoal,
  useDeleteGoal,
  useGoal,
  useGoalDeletePreview,
  useGoals,
  useMoveGoal,
  usePatchGoal,
  useReplanGoal,
} from '../api/queries';
import { toApiError } from '../api/errors';
import { useSkin } from '../skin';
import { Sheet } from './Sheet';
import { FieldError, commandError } from './states';
import { ancestorsOf, descendantIds, flatTree, node, plural, rank } from '../utils/tree';
import { defaultPeriod, useOwnerToday } from '../utils/periods';

/**
 * The four goal sheets: create/edit, move, re-plan, delete.
 *
 * Every guard here is an AFFORDANCE, not the rule. The server re-validates all of it (D-5: "a disabled
 * button is a hint, not an invariant"), and each sheet renders the refusal it can get back — which is the
 * behaviour the mockup had no equivalent for, because every one of these paths was a silent `return`.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Create / edit
// ─────────────────────────────────────────────────────────────────────────────

export function GoalFormSheet({ editId, parentId }: { editId: string | null; parentId: string | null }) {
  const S = useSkin();
  const ui = useUI();
  const goalsQ = useGoals(0);
  const today = useOwnerToday();
  const create = useCreateGoal();
  const patch = usePatchGoal();

  const goals = goalsQ.data?.goals ?? [];
  const editing = node(goals, editId);
  const parent = node(goals, parentId);

  // R-goal-5 — a child's horizon must be strictly shorter than its parent's, so the chips below this rank
  // are locked. D-6: a Monthly parent leaves no legal rank at all, which is why the sheet refuses to open
  // a form rather than clamping to Monthly and letting the owner create an illegal goal.
  const minRank = parent ? rank(parent.horizon) + 1 : 0;
  const [horizon, setHorizon] = useState<Horizon>(editing?.horizon ?? HORIZONS[Math.min(minRank, 3)]!);
  const [title, setTitle] = useState(editing?.title ?? '');
  const [why, setWhy] = useState(editing?.why ?? '');
  const [pulse, setPulse] = useState<Pulse>(editing?.pulse ?? 'On track');
  const [period, setPeriod] = useState(editing?.period ?? defaultPeriod(horizon, today));
  const [chosenParent, setChosenParent] = useState<string | null>(parentId);
  const [search, setSearch] = useState('');

  const close = () => ui.closeSheet();

  if (!editing && parent && parent.horizon === 'Monthly') {
    return (
      <Sheet label="Monthly goals cannot have sub-goals" onClose={close}>
        <div style={{ fontSize: 13.5, color: S.T.mut, margin: '0 0 14px 0' }}>
          Monthly is the shortest horizon in the cascade — work under it is a task, not another goal.
        </div>
        <button type="button" style={{ ...S.btn(true), width: '100%' }} onClick={close}>
          Got it
        </button>
      </Sheet>
    );
  }

  // R-goal-14 — editing may change title, why, period and pulse ONLY. Horizon and parent are refused by
  // the request schema's `.strict()`, so the chips are locked and the parent picker is not rendered.
  const needsParent = !editing && horizon !== 'Life';
  const parents = flatTree(goals, search).filter((r) => rank(r.g.horizon) < rank(horizon));
  const blocked = !title.trim() || (needsParent && !chosenParent) || create.isPending || patch.isPending;

  const save = () => {
    if (editing) {
      patch.mutate(
        { id: editing.id, patch: { title: title.trim(), why: why.trim(), period, pulse, version: editing.version } },
        { onSuccess: close },
      );
      return;
    }
    create.mutate(
      {
        title: title.trim(),
        why: why.trim(),
        horizon,
        // R-goal-3 — a Life goal has no parent and no target period.
        parentId: horizon === 'Life' ? null : chosenParent,
        period: horizon === 'Life' ? '' : period,
        pulse,
      },
      { onSuccess: close },
    );
  };

  return (
    <Sheet label={editing ? 'Edit goal' : parent ? 'New sub-goal' : 'New goal'} onClose={close}>
      <input aria-label="Goal title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Goal title" style={{ ...S.input, marginBottom: 10 }} />
      <input aria-label="Why? One line (optional)" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why? One line (optional)" style={{ ...S.input, marginBottom: 14 }} />

      <div style={{ ...S.fieldLabel, marginBottom: 6 }}>HORIZON</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {HORIZONS.map((h) => {
          const locked = !!editing || rank(h) < minRank;
          const on = horizon === h;
          return (
            <button
              key={h}
              type="button"
              disabled={locked && !on}
              onClick={() => {
                if (locked) return;
                setHorizon(h);
                setPeriod(defaultPeriod(h, today));
                if (rank(h) === 0) setChosenParent(null);
              }}
              style={{
                minHeight: 40,
                padding: '0 13px',
                borderRadius: 20,
                fontSize: 12.5,
                fontWeight: 700,
                fontFamily: 'inherit',
                ...(on
                  ? { border: 'none', background: S.T.ink, color: S.onInk, cursor: 'pointer' }
                  : locked
                    ? { border: `1px solid ${S.T.lineSoft}`, background: S.T.paper, color: S.T.disabled, cursor: 'not-allowed' }
                    : { border: `1px solid ${S.T.border}`, background: S.T.card, color: S.body, cursor: 'pointer' }),
              }}
            >
              {h}
            </button>
          );
        })}
      </div>

      {needsParent && (
        <>
          <div style={{ ...S.fieldLabel, marginBottom: 6 }}>PARENT GOAL</div>
          <input aria-label="Search goals" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search goals…" style={{ ...S.input, minHeight: 44, fontSize: 14, marginBottom: 8 }} />
          <div style={{ border: `1px solid ${S.T.line}`, borderRadius: 12, maxHeight: 200, overflow: 'auto', marginBottom: 14 }}>
            {/* R-goal-5 — only goals with a strictly LONGER horizon are offered. */}
            {parents.map((r) => (
              <button key={r.g.id} type="button" style={S.pickerRow(chosenParent === r.g.id ? 'sel' : 'ok')} onClick={() => setChosenParent(r.g.id)}>
                <span style={{ display: 'inline-block', width: r.depth * 16 }} />
                {r.g.title}
                <span style={{ fontSize: 10.5, fontWeight: 800, color: S.T.faint, marginLeft: 7 }}>{r.g.horizon.toUpperCase()}</span>
              </button>
            ))}
            {parents.length === 0 && <div style={{ fontSize: 13, color: S.T.mut, padding: '12px 14px' }}>No goal on a longer horizon yet.</div>}
          </div>
        </>
      )}

      {horizon !== 'Life' && (
        <>
          <div style={{ ...S.fieldLabel, marginBottom: 6 }}>TARGET PERIOD</div>
          {/* R-goal-13 / D-3 — pre-filled from TODAY, not from a frozen literal. */}
          <input aria-label="Target period" value={period} onChange={(e) => setPeriod(e.target.value)} style={S.input} />
        </>
      )}

      <div style={{ ...S.fieldLabel, margin: '14px 0 6px 0' }}>PULSE</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {PULSES.map((p) => (
          <button key={p} type="button" style={S.chipBtn(pulse === p)} onClick={() => setPulse(p)}>
            {p}
          </button>
        ))}
      </div>

      {/*
       * Every refusal the server can answer with, said out loud. In the mockup a blank title and a
       * non-Life goal with no parent were both `return` — the sheet just did nothing — and a horizon clash
       * or a leaf that still carries open tasks had no representation at all (Q-10, R-goal-28 / D-8).
       */}
      <FieldError>{commandError(create.error) ?? commandError(patch.error)}</FieldError>
      <button type="button" style={S.saveBtn(blocked)} disabled={blocked} onClick={save}>
        {editing ? 'Save changes' : 'Create goal'}
      </button>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Move
// ─────────────────────────────────────────────────────────────────────────────

/**
 * R-goal-16..20 — re-parent. Children move with the goal, and only `parentId` changes.
 *
 * R-goal-19 — invalid targets are listed DISABLED with exactly one of two reasons, and the descendant
 * check wins over the horizon check. D-7: the goal itself is shown disabled with `its own descendant`
 * rather than filtered out, because a row that silently vanishes reads as a bug.
 *
 * The disabled rows are the affordance; the refusal is the mechanism. `WOULD_CREATE_CYCLE` and
 * `HORIZON_CONFLICT` come back as codes and are rendered from `err.code`, never guessed.
 */
export function MoveGoalSheet({ goalId }: { goalId: string }) {
  const S = useSkin();
  const ui = useUI();
  const goalsQ = useGoals(0);
  const move = useMoveGoal();
  const [target, setTarget] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const goals = goalsQ.data?.goals ?? [];
  const moving = node(goals, goalId);
  const close = () => ui.closeSheet();
  if (!moving) return null;

  const banned = new Set([moving.id, ...descendantIds(goals, moving.id)]);
  const rows = flatTree(goals, search).map((r) => ({
    ...r,
    reason: banned.has(r.g.id) ? 'its own descendant' : rank(r.g.horizon) >= rank(moving.horizon) ? 'horizon conflict' : '',
  }));
  const picked = node(goals, target);
  const preview = picked ? `${moving.title} will move under ${[...ancestorsOf(goals, picked), picked].map((x) => x.title).join(' › ')}` : '';

  return (
    <Sheet label="Move goal" onClose={close}>
      <div style={{ fontSize: 13.5, color: S.T.mut, margin: '0 0 12px 0' }}>
        Pick a new parent for &quot;{moving.title}&quot;. Its children move with it.
      </div>
      <input aria-label="Search goals" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search goals…" style={{ ...S.input, minHeight: 44, fontSize: 14, marginBottom: 8 }} />
      <div style={{ border: `1px solid ${S.T.line}`, borderRadius: 12, maxHeight: 230, overflow: 'auto' }}>
        {rows.map((r) => (
          <button
            key={r.g.id}
            type="button"
            disabled={!!r.reason}
            onClick={() => !r.reason && setTarget(r.g.id)}
            style={S.pickerRow(r.reason ? 'dis' : target === r.g.id ? 'sel' : 'ok')}
          >
            <span style={{ display: 'inline-block', width: r.depth * 16 }} />
            {r.g.title}
            <span style={{ fontSize: 10.5, fontWeight: 800, color: S.T.faint, marginLeft: 7 }}>{r.g.horizon.toUpperCase()}</span>
            {r.reason && <span style={{ fontSize: 11, color: S.warn, marginLeft: 7 }}>{r.reason}</span>}
          </button>
        ))}
      </div>
      {/* R-goal-20 — the preview, before confirming. */}
      {preview && (
        <div style={{ background: S.T.accentSoft, color: S.T.accent, borderRadius: 12, padding: '11px 14px', fontSize: 13.5, fontWeight: 600, marginTop: 12 }}>
          {preview}
        </div>
      )}
      <FieldError>{commandError(move.error)}</FieldError>
      <button
        type="button"
        style={S.saveBtn(!target || move.isPending)}
        disabled={!target || move.isPending}
        onClick={() => target && move.mutate({ id: moving.id, parentId: target, version: moving.version }, { onSuccess: close })}
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
 * R-goal-22/23 — a contextual next period plus an OPTIONAL one-line reason. This replaced the old push
 * flow, and R-nav-14 removed that flow's mandatory reason for good; nothing here may become required.
 *
 * D-3 — the options are the SERVER's: `GoalDetailResponse.replanOptions`, derived once from the owner's
 * calendar day and strictly after the period the goal is already in, so re-plan can never offer it. The
 * client does not re-derive them — two implementations of a date rule drift on the first period boundary.
 * A refusal still carries `details.options`, the same list, which replaces what is on screen.
 */
export function ReplanGoalSheet({ goalId }: { goalId: string }) {
  const S = useSkin();
  const ui = useUI();
  const goalsQ = useGoals(0);
  const detailQ = useGoal(goalId, 0);
  const replan = useReplanGoal();
  const [index, setIndex] = useState(0);
  const [reason, setReason] = useState('');
  const [serverOptions, setServerOptions] = useState<string[] | null>(null);

  const goals = goalsQ.data?.goals ?? [];
  const goal = node(goals, goalId);
  const close = () => ui.closeSheet();
  if (!goal) return null;

  // R-goal-21 — not reachable from the menu, and refused server-side with `LIFE_GOAL_IMMUTABLE` anyway.
  if (goal.parentId === null) {
    return (
      <Sheet label="A Life goal has no target period" onClose={close}>
        <div style={{ fontSize: 13.5, color: S.T.mut, margin: '0 0 14px 0' }}>Life goals are not re-planned; the branches under them are.</div>
        <button type="button" style={{ ...S.btn(true), width: '100%' }} onClick={close}>
          Got it
        </button>
      </Sheet>
    );
  }

  const options = serverOptions ?? detailQ.data?.replanOptions ?? [];
  const chosen = options[Math.min(index, options.length - 1)];

  return (
    <Sheet label="Re-plan goal" onClose={close}>
      <div style={{ fontSize: 14, color: S.body, margin: '0 0 14px 0' }}>
        “{goal.title}” · {goal.period || '—'} → {chosen ?? '—'}
      </div>
      <div style={{ ...S.fieldLabel, marginBottom: 6 }}>NEW TARGET PERIOD</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {options.map((label, i) => (
          <button key={label} type="button" style={S.btn(index === i)} onClick={() => setIndex(i)}>
            {label}
          </button>
        ))}
        {options.length === 0 && (
          <div style={{ fontSize: 13, color: S.T.mut }}>{detailQ.isPending ? 'Loading periods…' : 'No later period to move to.'}</div>
        )}
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
            { id: goal.id, period: chosen, ...(reason.trim() ? { reason: reason.trim() } : {}), version: goal.version },
            {
              onSuccess: () => {
                close();
                ui.showToast(`Re-planned to ${chosen}`);
              },
              onError: (e) => {
                const opts = toApiError(e).details?.options;
                if (Array.isArray(opts) && opts.every((o) => typeof o === 'string')) {
                  setServerOptions(opts as string[]);
                  setIndex(0);
                }
              },
            },
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
 * The dry run answers with a whole `DeleteGoalResponse`, and `removed.goals` counts the goal ITSELF —
 * so the sub-goal count is one less. The other two numbers Q-5 names are already there under their own
 * names; `weeklyFocuses`, `taskEvents` and `untagged` are real but are not what the sentence promises.
 */
const countsOf = (r: DeleteGoalResponse): DeleteCounts => ({
  subGoals: Math.max(0, r.removed.goals - 1),
  tasks: r.removed.tasks,
  backlogItems: r.removed.backlogItems,
});

/** True when a delete would destroy anything at all — the whole test for "does this need confirming?". */
const destroysSomething = (c: DeleteCounts): boolean => c.subGoals + c.tasks + c.backlogItems > 0;

/**
 * Q-5 — delete, and the acknowledgement it needs.
 *
 * **The bug this shape exists to close.** The API's `GOAL_HAS_CHILDREN` guard fires only when a goal has
 * descendant GOALS, so the old flow asked for an acknowledgement in exactly the case where the refusal
 * happened to arrive. A Monthly leaf is childless by that test — and a Monthly leaf is where all the work
 * lives. Forty open tasks, their whole activity history and the goal's backlog went on the first tap, with
 * nothing said. Q-5 does not say "confirm a subtree delete"; it says deletion is confirmed with the counts
 * named. So the counts are asked for FIRST, for every goal, and the button is not offered until they land.
 *
 * `DELETE /goals/:id?dryRun=true` is what makes that possible: the same route, the same authorisation, no
 * write. Nothing is derived from a client-side subtree walk — the tree in the cache does not know how many
 * tasks hang off a leaf, and a confirmation that guesses is worse than one that waits.
 *
 * The `GOAL_HAS_CHILDREN` refusal is still handled, unchanged, as the fallback: if the preview fails for
 * any reason the sheet says only what it can stand behind, and the first tap is refused with the counts
 * exactly as before. That path is why `GOAL_HAS_CHILDREN` stays `quiet` in `useCommand`.
 *
 * There is no soft delete and no trash. Ideas and Learnings tagged into the subtree are un-tagged to
 * Unsorted rather than deleted with it (S-idea-7-1).
 */
export function DeleteGoalSheet({ goalId }: { goalId: string }) {
  const S = useSkin();
  const ui = useUI();
  const goalsQ = useGoals(0);
  const previewQ = useGoalDeletePreview(goalId);
  const remove = useDeleteGoal();
  /** Counts recovered from a `GOAL_HAS_CHILDREN` refusal — the fallback when the dry run is unavailable. */
  const [refused, setRefused] = useState<DeleteCounts | null>(null);

  const goals = goalsQ.data?.goals ?? [];
  const goal = node(goals, goalId);
  const close = () => ui.closeSheet();
  if (!goal) return null;

  const counts = refused ?? (previewQ.data ? countsOf(previewQ.data) : null);
  const destroys = counts ? destroysSomething(counts) : false;
  /** Still asking. The delete button is not offered yet — that wait IS the fix. */
  const checking = !counts && previewQ.isPending;

  const finish = () => {
    close();
    // The detail screen was showing something that no longer exists (D-27).
    if (ui.screen === 'goal' && ui.goalId === goal.id) ui.setScreen('goals');
    ui.showToast('Goal deleted');
  };

  const attempt = () =>
    remove.mutate(
      // `cascade` is the explicit acknowledgement, and it is sent whenever anything would go with the goal
      // — not only when a sub-goal would. The server needs it only for sub-goals; sending it for a leaf
      // full of tasks costs nothing and keeps "what the button said" and "what was authorised" the same.
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
      {/*
       * `role="status"` because the sentence is replaced under the reader once the counts arrive, and the
       * replacement is the whole point. Polite, not an alert: this is a warning, not an alarm, and the app
       * does not raise its voice.
       */}
      <div role="status" style={{ fontSize: 13.5, color: counts && destroys ? S.body : S.T.mut, margin: '0 0 14px 0' }}>
        {checking
          ? 'Checking what this would remove…'
          : counts && destroys
            ? `This removes ${plural(counts.subGoals, 'sub-goal')}, ${plural(counts.tasks, 'task')} and ${plural(
                counts.backlogItems,
                'backlog item',
              )}. Ideas and learnings tagged here move to Unsorted. There is no undo.`
            : counts
              ? 'This goal holds nothing else. There is no trash and no undo.'
              : 'There is no trash and no undo.'}
      </div>
      <FieldError>{counts ? null : commandError(remove.error)}</FieldError>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          type="button"
          style={{ ...S.btn(true, true), width: '100%', minHeight: 46 }}
          disabled={remove.isPending || checking}
          onClick={attempt}
        >
          {destroys ? 'Delete everything' : 'Delete'}
        </button>
        <button type="button" style={{ ...S.btn(false), width: '100%', minHeight: 46 }} onClick={close}>
          Keep it
        </button>
      </div>
    </Sheet>
  );
}

/** Exported for the goal picker rows elsewhere. */
export type { GoalView };
