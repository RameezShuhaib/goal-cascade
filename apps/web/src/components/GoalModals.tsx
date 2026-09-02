import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { HORIZONS, labelOf, PULSES, zoomTo, type DeleteGoalResponse, type Horizon, type Pulse } from '@goal-cascade/shared';
import { useUI } from '../context/UIContext';
import { useCreateGoal, useDeleteGoal, useGoal, useGoalDeletePreview, useMoveGoal, usePatchGoal, useReplanGoal } from '../api/queries';
import { toApiError } from '../api/errors';
import { useSkin } from '../skin';
import { Sheet } from './Sheet';
import { FieldError, Loading, commandError } from './states';
import { plural } from '../utils/tree';
import { PERIOD_UNIT, rank } from '../utils/periodKeys';
import { GoalPicker, nearestAncestor, useGoalPicker } from './GoalPicker';
import { lensPath } from '../routes';
import { useWeekClock } from '../lib/weekClock';
import { NEW_GOAL_HEADING, noLegalParentNote, parentClearedNote, periodBecauseLens, periodClosestTo } from '../lens/copy';

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
 * R-nav-32 — **the one create action's sheet: `New goal`, at every lens.**
 *
 * The heading no longer names a horizon, because the sheet no longer commits to one. `+ <Horizon> goal`
 * is deleted from the cluster's five-way label, from every group foot and from this heading; what
 * replaces it is a **five-chip HORIZON selector defaulting to the lens you are standing on** — the
 * owner's literal ask (*"where I'll select the lense (defaults to the lense based on my current page) and
 * the goal"*).
 *
 * **The period is still never typed and never picked.** It is a read-only chip, derived by R-lens-9's
 * clamp from R-lens-18's anchor — *the same function the tab strip calls*, so navigation and creation can
 * never disagree about which period a horizon means. That is what kept `Q9 3026` unrepresentable when the
 * period was the lens's, and it keeps it unrepresentable now that the horizon can move.
 *
 * ── What changing the horizon does, in this order (§3.5) ──────────────────────
 *  1. the period chip **re-clamps** — `zoomTo(H′, anchor, today)`;
 *  2. the parent picker **re-scopes** to `{ kind: 'parent', horizon: H′, periodKey: <the new period> }`,
 *     which is the existing horizon-scoped picker called with a different mode. Nothing about it changes;
 *  3. the chosen parent is kept **iff it is still legal** at `H′` (strictly longer horizon, R-goal-5 /
 *     R-goal-32) and **cleared with a stated reason otherwise** — never silently, and announced, because
 *     it is a change the user did not make;
 *  4. `Save goal` re-evaluates.
 *
 * `Life` is the one branch: no period chip, no `UNDER`, and neither `parentId` nor `periodKey` on the
 * request (R-goal-3).
 *
 * **The clamp can never produce a past period from a lens that is not itself past**, so `PERIOD_IN_PAST`
 * is unreachable from this sheet by construction rather than by a guard: the anchor is `today` when the
 * period on screen contains today and the period's first day otherwise, so mapping it to any other
 * horizon lands on a period containing that same date — and the create button is already absent on a past
 * period (R-goal-36).
 *
 * ⚠ **The selector renders only when the sheet came from a lens** (`lens` present) **and only on create.**
 * A goal's horizon is immutable — re-parenting is Move, re-scheduling is Re-plan — and the goal page's
 * `+ Sub-goal` asks a different question, *what hangs off this one*, where the horizon is already the
 * legal one below its parent (R-goal-48).
 *
 * ⚠ **R-nav-31** — `UNDER` is the one goal picker in `parent` mode: grouped by Life goal, every row
 * carrying its line and its period, searchable above eight options, and above eight it **takes over this
 * sheet** rather than opening a second one over it.
 */
export function GoalFormSheet({
  editId,
  horizon: openedAt,
  periodKey: openedPeriodKey,
  lens,
  lifeGoalId,
  parentId,
  title,
}: {
  editId: string | null;
  /** The horizon the sheet OPENED at — the lens for a lens create, the legal child horizon for a sub-goal. */
  horizon: Horizon;
  periodKey: string;
  /** R-nav-32 — the lens this was opened from, when it was opened from one. */
  lens?: Horizon;
  lifeGoalId?: string | null;
  parentId?: string | null;
  /** R-goal-48 — a title typed into the inline `+ Sub-goal` capture before `More…` was used. */
  title?: string;
}) {
  const S = useSkin();
  const ui = useUI();
  const navigate = useNavigate();
  const clock = useWeekClock();
  const editQ = useGoal(editId);
  const create = useCreateGoal();
  const patch = usePatchGoal();
  const editing = editQ.data?.goal;
  const [draft, setDraft] = useState<{ title: string; why: string; pulse: Pulse } | null>(null);
  const [chosenParent, setChosenParent] = useState<string | null>(parentId ?? null);

  /**
   * The horizon selector's state, and the anchor it clamps against.
   *
   * `ui.anchor` is R-lens-18's derived anchor, written by the lens on every render; on the Life lens
   * (which has no period of its own) it is the last one held, falling back to today. So the chip's period
   * is the one the tab strip would take you to at that horizon — by construction, not by coincidence.
   */
  const showSelector = !editId && lens !== undefined;
  const [horizon, setHorizon] = useState<Horizon>(openedAt);
  const anchor = ui.anchor ?? clock.today;
  const movedAway = showSelector && horizon !== openedAt;
  const periodKey = horizon === 'Life' ? '' : movedAway ? zoomTo(horizon, anchor, clock.today) : openedPeriodKey;

  const isLife = horizon === 'Life';
  const needsParent = !editId && !isLife;

  /**
   * §3.5 step 3 — **a parent that stopped being legal is cleared, visibly and with a sentence.**
   *
   * The alternative considered and refused was walking silently up to the nearest legal ancestor: magic
   * that changes a field you set, for a saving of one tap. The note clears itself the moment a new parent
   * is chosen, and it is announced (see the `aria-live` region below).
   */
  const [cleared, setCleared] = useState<string | null>(null);
  /** The horizon of every option the picker has offered, so a cleared parent can say what it WAS. */
  const parentHorizons = useRef(new Map<string, Horizon>());

  const picker = useGoalPicker({
    mode: { kind: 'parent', horizon, periodKey, lifeGoalId },
    value: chosenParent,
    onChange: (id) => {
      setChosenParent(id);
      setCleared(null);
    },
    from: NEW_GOAL_HEADING,
    listLabel: 'Goals this one can hang off',
  });

  /**
   * ⚠ **A9 — the default parent is the NEAREST legal ancestor, not the first row and not nothing.**
   *
   * `nearestAncestor` answers it properly — the deepest goal whose period contains this one, which for a
   * new Monthly goal in `Sep 2026` is the **Quarterly goal for Q3 2026**. It subsumes the one-option case
   * rather than sitting beside it. Still an effect rather than a fallback, because the row it picks must
   * render as SELECTED and be announced (R-lens-13), not merely be what a `??` chain would have used.
   */
  /*
   * ⚠ **A9 fix** — gated on `!picker.isPending`, because `useParentOptions` reads **one query per legal
   * horizon** and they settle independently. Ungated, this effect fired on whichever horizon resolved
   * FIRST and then never re-ran (`chosenParent === null` stops being true), so a new Monthly goal in
   * `Sep 2026` defaulted to the Yearly goal for 2026 whenever the Yearly read beat the Quarterly one —
   * observed in the browser, invisible to a test whose mocks all resolve in the same tick.
   * `nearestAncestor` was never wrong; it was being asked too early.
   */
  const defaultParent = useMemo(
    () => (needsParent && !picker.isPending ? nearestAncestor(picker.options) : null),
    [needsParent, picker.isPending, picker.options],
  );
  useEffect(() => {
    if (defaultParent && chosenParent === null) setChosenParent(defaultParent.id);
  }, [defaultParent, chosenParent]);
  for (const o of picker.options) parentHorizons.current.set(o.id, o.horizon);

  const changeHorizon = (to: Horizon) => {
    if (to === horizon) return;
    const was = chosenParent ? parentHorizons.current.get(chosenParent) : undefined;
    // R-goal-5 / R-goal-32 — a parent must be STRICTLY longer-horizon. `Life` keeps nothing at all,
    // because a Life goal has no parent and no period (R-goal-3).
    const stillLegal = !!was && to !== 'Life' && rank(was) < rank(to);
    if (chosenParent && !stillLegal) {
      setChosenParent(null);
      setCleared(was && to !== 'Life' ? parentClearedNote(to, was) : null);
    } else {
      setCleared(null);
    }
    setHorizon(to);
  };

  const close = () => ui.closeSheet();
  const fields = draft ?? { title: editing?.title ?? title ?? '', why: editing?.why ?? '', pulse: editing?.pulse ?? 'On track' };
  const set = (p: Partial<typeof fields>) => setDraft({ ...fields, ...p });

  if (editId && !editing) {
    return (
      <Sheet label="Edit goal" onClose={close}>
        <Loading />
      </Sheet>
    );
  }

  const parent = chosenParent ?? defaultParent?.id ?? null;
  /**
   * ⚠ The label is computed, not fetched. It used to come off a lens read for the sheet's own period,
   * which cannot answer for a horizon the selector has moved to; `labelOf` is the same function the
   * header renders from (R-lens-30), so the chip is right on the first frame at every horizon.
   */
  const label = isLife ? '' : labelOf(horizon, periodKey);

  /**
   * §3.6 — **no legal parent at all. Expected unreachable, and built anyway.**
   *
   * Unreachable because a Life goal is a legal parent at every other horizon (R-goal-32), so the moment
   * any Life goal exists every horizon has an option — and with none, the sheet opens on the Life lens at
   * horizon `Life`, which has no `UNDER` at all.
   *
   * With a horizon selector on screen the whole-sheet takeover is **wrong**: the user's escape is to pick
   * a different horizon, not to leave. So it is an inline state inside `UNDER` with `Save goal` disabled
   * — except where there is no selector to escape through (the goal page's `+ Sub-goal`), which keeps the
   * takeover and its one-tap handoff.
   */
  const noParent = needsParent && !picker.isPending && picker.options.length === 0;
  const startWithLife = () => {
    navigate(lensPath('Life'));
    ui.openSheet({ kind: 'goalForm', editId: null, horizon: 'Life', periodKey: '', lens: 'Life' });
  };
  if (noParent && !showSelector) {
    return (
      <Sheet label={NEW_GOAL_HEADING} onClose={close}>
        <div style={{ fontSize: 13.5, color: S.T.mut, margin: '0 0 16px 0' }}>{noLegalParentNote(horizon as Exclude<Horizon, 'Life'>)}</div>
        <button type="button" style={{ ...S.btn(true), width: '100%' }} onClick={startWithLife}>
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
      {
        onSuccess: () => {
          close();
          ui.showToast(isLife ? 'Life goal added' : `Added to ${label}`);
          /**
           * §3.8 — **nothing may be created into a period and then vanish from the screen that created
           * it** (R-nav-19). Creating a Quarterly goal from the Monthly lens and staying put would be a
           * lost write as far as the eye can tell, so the app moves to that lens at that period. When the
           * horizon equals the lens — the default, and the overwhelming case — nothing moves.
           */
          if (lens && horizon !== lens) navigate(lensPath(horizon, isLife ? null : periodKey));
        },
      },
    );
  };

  return (
    <Sheet label={picker.taken ? picker.heading : editing ? 'Edit goal' : NEW_GOAL_HEADING} headerRight={picker.headerRight} onClose={close}>
      {picker.taken ? (
        picker.panel
      ) : (
        <>
        <input aria-label="Goal title" value={fields.title} onChange={(e) => set({ title: e.target.value })} placeholder="Goal title" style={{ ...S.input, marginBottom: 10 }} />
        <input aria-label="Why? (optional)" value={fields.why} onChange={(e) => set({ why: e.target.value })} placeholder="Why? (optional)" style={{ ...S.input, marginBottom: 14 }} />

        {showSelector && <HorizonSelector value={horizon} onChange={changeHorizon} />}

        {!isLife && !editing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ ...S.chipBtn(false), display: 'inline-flex', alignItems: 'center', cursor: 'default' }}>{label}</span>
            {/*
             * The reason, in its two forms. `Because you're looking at Sep 2026.` while the horizon is
             * still the lens; `Closest to Sep 2026, the month on screen.` once the selector has moved away
             * from it, because a period nobody chose has to say where it came from. The **Life lens** has
             * no period on screen to be closest to, so it renders the chip alone rather than inventing a
             * referent — the one case §6.1's two forms do not cover.
             */}
            <span style={{ flex: 1, fontSize: 12.5, color: S.T.mut }}>
              {!movedAway ? periodBecauseLens(label) : lens === 'Life' ? '' : periodClosestTo(labelOf(lens!, openedPeriodKey), lens!)}
            </span>
          </div>
        )}

        {needsParent && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ ...S.fieldLabel, marginBottom: 6 }}>UNDER</div>
            {/*
             * §7.4 — the cleared sentence is `aria-live="polite"`, so a change the user did not make is
             * announced rather than merely repainted. The region is always in the DOM; only its text
             * changes, which is what makes a live region actually fire.
             */}
            <div aria-live="polite">
              {cleared && <div style={{ fontSize: 12.5, color: S.T.mut, marginBottom: 6 }}>{cleared}</div>}
            </div>
            {noParent ? (
              <>
                <div style={{ fontSize: 13.5, color: S.T.mut, marginBottom: 10 }}>{noLegalParentNote(horizon as Exclude<Horizon, 'Life'>)}</div>
                <button type="button" style={{ ...S.btn(true), width: '100%' }} onClick={startWithLife}>
                  Start with a Life goal →
                </button>
              </>
            ) : (
              picker.control
            )}
          </div>
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
        </>
      )}
    </Sheet>
  );
}

/**
 * §3.4 — **five chips, in horizon order, wrapping.**
 *
 * This is the app's existing field-value idiom — literally the control this sheet already renders three
 * fields below for `PULSES` — so there is no new component and no new token. Inside a sheet there is no
 * chrome budget and vertical space is cheap, so wrapping to two lines at 360px is correct and needs no
 * scroller.
 *
 * **A chip is not a tab, and the difference is deliberate**: *a tab is where you are; a chip is what you
 * chose.* Rendering this as a second tab strip would say the sheet navigates, which it does not.
 *
 * `role="radiogroup"` with roving `tabindex` and `←`/`→`/`Home`/`End` — one tab stop, arrows along the
 * axis the list runs, the selection announced by `aria-checked` and never merely coloured (R-lens-13's
 * surviving accessibility clause).
 */
function HorizonSelector({ value, onChange }: { value: Horizon; onChange: (h: Horizon) => void }) {
  const S = useSkin();
  const refs = useRef(new Map<Horizon, HTMLButtonElement | null>());
  const move = (to: Horizon) => {
    onChange(to);
    refs.current.get(to)?.focus();
  };
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ ...S.fieldLabel, marginBottom: 6 }}>HORIZON</div>
      <div
        role="radiogroup"
        aria-label="Horizon"
        style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
        onKeyDown={(e) => {
          const i = HORIZONS.indexOf(value);
          if (e.key === 'ArrowLeft' && i > 0) return move(HORIZONS[i - 1]!);
          if (e.key === 'ArrowRight' && i < HORIZONS.length - 1) return move(HORIZONS[i + 1]!);
          if (e.key === 'Home') return move(HORIZONS[0]!);
          if (e.key === 'End') return move(HORIZONS[HORIZONS.length - 1]!);
        }}
      >
        {HORIZONS.map((h) => (
          <button
            key={h}
            type="button"
            role="radio"
            aria-checked={h === value}
            tabIndex={h === value ? 0 : -1}
            ref={(el) => {
              refs.current.set(h, el);
            }}
            style={S.chipBtn(h === value)}
            onClick={() => onChange(h)}
          >
            {h}
          </button>
        ))}
      </div>
    </div>
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
  const [target, setTarget] = useState<{ id: string; title: string } | null>(null);

  const moving = detailQ.data?.goal;
  const close = () => ui.closeSheet();
  /**
   * ⚠ **R-nav-31** — the picker is this sheet's whole body, so it needs no field and no takeover (§7.6).
   *
   * `exclude` states R-goal-18 rather than relying on it: the goal itself, and the children this read
   * already handed us. Every *other* descendant is unlistable by construction — a descendant is strictly
   * shorter-horizon than the goal, and every option is strictly longer — which is why the client can be
   * complete here without holding a subtree it is not allowed to hold (R-lens-16).
   */
  const exclude = useMemo(
    () => [goalId, ...(detailQ.data?.children ?? []).map((c) => c.id)],
    [goalId, detailQ.data?.children],
  );

  if (!moving) {
    return (
      <Sheet label="Move goal" onClose={close}>
        <Loading />
      </Sheet>
    );
  }

  return (
    <Sheet label={lifeGoalsOnly ? 'Put under a Life goal' : 'Move goal'} onClose={close}>
      <div style={{ fontSize: 13.5, color: S.T.mut, margin: '0 0 12px 0' }}>
        Pick a new parent for &quot;{moving.title}&quot;. Its children move with it.
      </div>
      <GoalPicker
        // R-lens-20 — `Put under a Life goal…` opens this same sheet with the Life goals pre-listed.
        mode={{ kind: 'parent', horizon: moving.horizon, periodKey: moving.periodKey, exclude, ...(lifeGoalsOnly ? { only: 'life' as const } : {}) }}
        value={target?.id ?? null}
        onChange={(id, title) => setTarget(id ? { id, title: title ?? '' } : null)}
        empty="No goal on a longer horizon yet."
        listLabel="Goals this one can move under"
      />
      <FieldError>{commandError(move.error)}</FieldError>
      <button
        type="button"
        style={S.saveBtn(!target || move.isPending)}
        disabled={!target || move.isPending}
        onClick={() =>
          target &&
          move.mutate({ id: moving.id, parentId: target.id, version: moving.version }, { onSuccess: () => { close(); ui.showToast(`Moved under ${target.title || 'it'}`); } })
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
