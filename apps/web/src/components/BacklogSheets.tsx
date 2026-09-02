import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { labelOf, periodKeyOf, taskWeeksInMonth, type Horizon } from '@goal-cascade/shared';
import { useUI } from '../context/UIContext';
import { useBacklog, useCreateBacklogItem, useConvertBacklogItem, useCreateTask, useGoal } from '../api/queries';
import { toApiError } from '../api/errors';
import { useWeekClock } from '../lib/weekClock';
import { useSkin } from '../skin';
import { Sheet } from './Sheet';
import { FieldError, Loading, commandError } from './states';
import { recentGoalIds, useGoalPicker } from './GoalPicker';
import { hostOf } from '../utils/tree';
import { shortDate, weekOfLabel } from '../utils/dates';
import { lensPath, BACKLOG_PATH } from '../routes';
import { AddMeasureLink, emptyDraft, MeasureFields, validateDraft, type MeasureDraft } from './Measure';
import { ChipRadioGroup, type ChipOption } from './ChipRadioGroup';
import { VISUALLY_HIDDEN } from './Sparkline';
import {
  addedToMonthToast,
  implicitWeeklyGoalNote,
  landsUnder,
  monthChipName,
  monthDestinationNote,
  taskDestinationNote,
  WHEN_THIS_LANDS,
} from '../lens/copy';

/**
 * The `+` drawer, the task-create sheet, and the backlog pull — the places work enters this app.
 *
 * Neither mints an id. Q-8 makes every id a server-side ULID and the request schemas are `.strict()`.
 */

/**
 * R-backlog-27 — the `+` drawer. Unchanged except in its target resolution: with `Add to this week
 * instead` ticked, a **task only** is created under the Weekly goal at or under the chosen goal for the
 * current week; with no such goal, a **backlog item** is created instead and the toast explains.
 *
 * D-21 — exactly ONE entity, ever. The mockup's label promised "also", which would have been a data bug
 * for the first person who went looking in the backlog for something that was never put there.
 *
 * The goal picker lists Yearly/Quarterly/Monthly goals only — never Life, and now never **Weekly**
 * (R-backlog-2): the whole point of a backlog item is that it has no week, and a Weekly goal would give
 * it one.
 *
 * ⚠ **R-nav-31** — the wrapping wall of `chipBtn` pills, titles only, is gone. This is the site the owner
 * named, and it is now the one picker in `backlogHost` mode.
 */
export function BacklogDrawer({ goalId: initialGoalId }: { goalId?: string }) {
  const S = useSkin();
  const ui = useUI();
  const navigate = useNavigate();
  const clock = useWeekClock();
  const createItem = useCreateBacklogItem();
  const createTask = useCreateTask();

  const [goalId, setGoalId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [linkDraft, setLinkDraft] = useState('');
  const [links, setLinks] = useState<string[]>([]);
  const [toWeek, setToWeek] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);

  const goalPicker = useGoalPicker({
    mode: { kind: 'backlogHost' },
    value: goalId,
    onChange: (id) => {
      setGoalId(id);
      setChosen(null);
    },
    from: 'Add to Backlog',
    empty: 'Nothing to file this under yet — a backlog item needs a Yearly, Quarterly or Monthly goal.',
    listLabel: 'Goals that can hold a backlog item',
  });
  const targets = goalPicker.options;

  /**
   * ⚠ **R-backlog-14, generalised.** The drawer still opens on the goal you filed under last, this page
   * load only, validated first — but the memory is now the picker's `RECENT` list, shared with every
   * other mode, rather than this file's own private one-goal variable. The default lands when the
   * options do, because a default naming a goal the account no longer has is worse than no default.
   */
  useEffect(() => {
    if (goalId !== null || targets.length === 0) return;
    const seed =
      (initialGoalId && targets.some((g) => g.id === initialGoalId) ? initialGoalId : null) ??
      recentGoalIds().find((id) => targets.some((g) => g.id === id)) ??
      null;
    if (seed) setGoalId(seed);
  }, [goalId, initialGoalId, targets]);

  const chosenGoal = targets.find((g) => g.id === goalId) ?? null;
  /**
   * R-task-49 — the Weekly goals under the chosen goal, in the current week. `weekStart` is `undefined`
   * until the box is ticked, which is what keeps the read from firing for a drawer nobody has asked to
   * put work in this week.
   */
  const weeklyPicker = useGoalPicker({
    mode: {
      kind: 'weeklyTarget',
      parentId: goalId ?? '',
      weekStart: toWeek && goalId ? (clock.currentMonday ?? undefined) : undefined,
    },
    value: chosen,
    onChange: setChosen,
    from: 'Add to Backlog',
    listLabel: 'Weekly goals in this week',
  });
  const candidates = weeklyPicker.options;
  /*
   * ⚠ **A9** — write the sole candidate into STATE, not just into `target`. Deriving it silently left the
   * compact row reading `Choose a goal` while the save went somewhere specific, which is the same
   * unnamed-destination defect one layer down: the block was visible and still said nothing. Written to
   * state, the row renders the goal's own title and is announced (R-lens-13), and it stays changeable.
   */
  useEffect(() => {
    if (toWeek && chosen === null && candidates.length === 1) setChosen(candidates[0]!.id);
  }, [toWeek, chosen, candidates]);
  const target = candidates.length === 1 ? candidates[0]!.id : chosen && candidates.some((c) => c.id === chosen) ? chosen : null;
  const close = () => ui.closeSheet();

  const save = () => {
    if (!goalId || !title.trim()) return;
    if (toWeek && target) {
      createTask.mutate(
        { goalId: target, title: title.trim(), cond: '', description: description.trim(), links, source: 'drawer' },
        { onSuccess: () => { close(); ui.showToast('Added to this week'); } },
      );
      return;
    }
    createItem.mutate(
      { goalId, title: title.trim(), description: description.trim(), links },
      {
        onSuccess: () => {
          close();
          ui.showToast(toWeek ? 'No weekly goal this week — parked in Backlog' : 'Added to Backlog');
        },
      },
    );
  };

  const busy = createItem.isPending || createTask.isPending;
  const blocked = !goalId || !title.trim() || busy || (toWeek && candidates.length > 1 && !target);

  const taken = goalPicker.taken || weeklyPicker.taken;

  return (
    <Sheet
      label={taken ? goalPicker.heading : 'Add to Backlog'}
      onClose={close}
      headerRight={
        taken ? (
          (goalPicker.headerRight ?? weeklyPicker.headerRight)
        ) : (
          <button
            type="button"
            style={{ minHeight: 36, border: 'none', background: 'none', fontSize: 13, fontWeight: 700, color: S.T.accentLink, cursor: 'pointer', fontFamily: 'inherit' }}
            onClick={() => {
              close();
              navigate(BACKLOG_PATH);
            }}
          >
            View Backlog →
          </button>
        )
      }
    >
      {taken ? (
        goalPicker.taken ? (
          goalPicker.panel
        ) : (
          weeklyPicker.panel
        )
      ) : (
        <>
        <div style={{ ...S.fieldLabel, marginBottom: 6 }}>GOAL</div>
        {/* R-auth-6 / D-10 — a brand-new account has nothing, and the picker's own empty state says so. */}
        <div style={{ marginBottom: 14 }}>{goalPicker.control}</div>

        <input
          aria-label="What needs doing, someday?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing, someday?"
          style={{ ...S.input, marginBottom: 12 }}
        />
        <textarea
          aria-label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Description (optional)"
          style={{ ...S.textarea, marginBottom: 12 }}
        />

        <div style={{ ...S.fieldLabel, marginBottom: 6 }}>LINKS</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 6 }}>
          {links.map((url, i) => (
            <div key={url + i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: S.T.paper, borderRadius: 10, padding: '6px 6px 6px 12px' }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: S.T.ink }}>
                {hostOf(url)}
              </div>
              <button
                type="button"
                aria-label={`Remove link ${hostOf(url)}`}
                onClick={() => setLinks(links.filter((_, j) => j !== i))}
                style={{ minWidth: 36, minHeight: 36, border: 'none', background: 'none', color: S.T.mut, fontSize: 15, cursor: 'pointer' }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            aria-label="Link URL"
            value={linkDraft}
            onChange={(e) => setLinkDraft(e.target.value)}
            placeholder="https://…"
            style={{ ...S.input, flex: 1, minHeight: 44, borderRadius: 10, fontSize: 13.5 }}
          />
          <button
            type="button"
            aria-label="Add link"
            style={S.menuBtn}
            onClick={() => {
              if (!linkDraft.trim()) return;
              setLinks([...links, linkDraft.trim()]);
              setLinkDraft('');
            }}
          >
            Add
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginTop: 14 }}>
          <button type="button" aria-label="Add to this week instead" style={S.checkBox(toWeek)} onClick={() => setToWeek(!toWeek)}>
            {toWeek ? '✓' : ''}
          </button>
          <div style={{ fontSize: 14, fontWeight: 600, color: S.T.ink }}>Add to this week instead</div>
        </div>

        {toWeek && candidates.length === 0 && (
          <div style={{ fontSize: 12.5, color: S.T.mut, marginTop: 8 }}>
            No weekly goal under {chosenGoal?.title ?? 'this goal'} this week — it will be parked in the Backlog.
          </div>
        )}
        {/*
          * ⚠ **A9** — `>= 1`, not `> 1`. A single candidate used to render NOTHING and be used silently,
          * which is the same defect the task sheet just fixed: the owner added three tasks from a Monthly
          * goal, was never told which Weekly goal took them, and could not find them afterwards. One
          * candidate is a destination, not an absence of choice, so it renders as a filled row that can
          * still be changed. The zero case keeps its own note above.
          */}
        {toWeek && candidates.length >= 1 && (
          <>
            <div style={{ ...S.fieldLabel, margin: '12px 0 6px 0' }}>WHICH WEEKLY GOAL?</div>
            {weeklyPicker.control}
          </>
        )}

        <FieldError>{commandError(createItem.error) ?? commandError(createTask.error)}</FieldError>
        <button type="button" style={S.saveBtn(blocked)} disabled={blocked} onClick={save}>
          Save
        </button>
        </>
      )}
    </Sheet>
  );
}

/**
 * ⚠ **A9** — the month a target week belongs to, named the way the Monthly lens names it.
 *
 * Both halves are `@goal-cascade/shared`'s, called in the order the server calls them: a week belongs to
 * its **Monday's** month (R-goal-33), and the label is rendered from the key (`Sep 2026`). No second
 * calendar and no second spelling — the sheet says exactly what the lens says.
 */
const monthLabelOfWeek = (weekStart: string): string => labelOf('Monthly', periodKeyOf('Monthly', weekStart));

/**
 * R-task-3/48/49 — the task-create sheet, used by every creation source (R-task-41).
 *
 * ── The one-step create, which is the whole of R-task-48 ───────────────────────
 * Tasks live on weekly goals (R-goal-39), so adding a task from a **Monthly** card is structurally two
 * creates. Made literal that is the worst flow in the product — a form to fill in before you are allowed
 * to fill in the form you wanted — so **the second step is inferred, never asked** (R-task-49):
 *
 *   | Weekly goals under this monthly goal, in the target week | What happens                          |
 *   |---|---|
 *   | exactly one | it is used — no picker, no extra field, no extra tap |
 *   | more than one | a picker, first preselected — one tap to change, zero to accept |
 *   | none | one is **created**, in the same transaction, and the sheet says so before you save |
 *
 * **Nothing is created invisibly.** The sheet states what will happen; the toast names the week; the live
 * region names the goal that was made. And on save the app **moves to the Weekly lens at that week**,
 * because staying put would leave the task and its new goal invisible from the screen that made them,
 * which reads as a lost write (R-nav-19's reason, R-task-41).
 *
 * A backlog pull takes the identical path — item → task → the same resolution — which is what retires the
 * `This branch isn't active this week` dead end entirely: there is no longer a state in which a backlog
 * item cannot become work.
 */
export function TaskCreateSheet({
  goalId: initialGoalId,
  newWeekly,
  monthGoal,
  monthKey,
  weekStart,
  title: initialTitle,
  fromBacklogId,
}: {
  goalId?: string;
  newWeekly?: { parentId: string; title: string };
  /** ⚠ **A8** — the Monthly goal that was tapped. Its month is the default destination. */
  monthGoal?: { id: string; title: string };
  /** ⚠ **A11** — a SEED for `When this lands`, read once at mount and never again. */
  monthKey?: string;
  weekStart?: string;
  title?: string;
  fromBacklogId?: string;
}) {
  const S = useSkin();
  const ui = useUI();
  const navigate = useNavigate();
  const clock = useWeekClock();
  const createTask = useCreateTask();
  const convertItem = useConvertBacklogItem();
  const backlogQ = useBacklog();

  /**
   * ⚠ **A11 (`32-week-selection` §4.5) — the chosen period is STATE, and the prop is a seed.**
   *
   * *"The `weekStart` prop is a seed and is never read after mount"* is the whole of the zero-candidate
   * correctness fix: `implicitWeeklyGoalNote`, `taskDestinationNote`, `monthLabelOfWeek`, the toast and
   * the post-save navigation all read the **chosen** period from here. A build that leaves one of them
   * reading the prop reproduces the bug in a smaller place.
   */
  const [period, setPeriod] = useState<string>(monthKey ?? weekStart ?? clock.currentMonday);
  /** Whether the owner has moved the control — the status announces a CONSEQUENCE, not the initial state. */
  const [moved, setMoved] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [title, setTitle] = useState(initialTitle ?? '');
  const [cond, setCond] = useState('');
  const [refused, setRefused] = useState<string | null>(null);
  /** Q-E — a measure may be attached AT CREATE, in one command. Collapsed until asked for. */
  const [measuring, setMeasuring] = useState(false);
  const [draft, setDraft] = useState<MeasureDraft>(emptyDraft);
  /** D-18 / S-backlog-26-3 — the server's own candidate list, when it refuses an ambiguous conversion. */
  const [serverCandidates, setServerCandidates] = useState<{ id: string; title: string }[] | null>(null);

  /**
   * ⚠ **A8/A11 — the month is the FIRST option and the DEFAULT** (the owner's ruling on
   * `32-week-selection` §9.2). `R-task-57`'s *"nothing is inferred"* only holds if the zero-decision path
   * is the zero-inference one: one row, on the goal you tapped, in the month you are looking at. A week
   * is then something the owner explicitly asked for, and **a control the owner drives is not an
   * inference**.
   *
   * The option list is `[the month, then the month's own weeks that are not before the current one]`.
   * Bounded by the month, because a week outside it is a week the lens that created the work will never
   * show — which is the leak A9's clamp closed. Past weeks are **omitted, never disabled** (R-goal-36,
   * D-5): a picker must not offer what the server would refuse, and there is nothing to explain because
   * nothing on screen implies the missing weeks were ever there.
   */
  const options: ChipOption[] = monthKey
    ? [
        { value: monthKey, label: labelOf('Monthly', monthKey), name: monthChipName(labelOf('Monthly', monthKey)) },
        ...taskWeeksInMonth(monthKey, clock.today).map((w) => ({ value: w, label: shortDate(w), name: weekOfLabel(w) })),
      ]
    : [];
  const isMonth = !!monthKey && period === monthKey;
  /** The Monthly goal a week narrowing hangs its resolved (or minted) Weekly goal under. */
  const parent = monthGoal ?? newWeekly;
  const parentId = monthGoal?.id ?? newWeekly?.parentId ?? '';
  const parentTitle = monthGoal?.title ?? newWeekly?.title ?? '';

  /**
   * ⚠ **R-nav-31** — the same picker as everywhere else, in `weeklyTarget` mode, whose `weekStart` now
   * comes from state rather than from a prop. **The rule gains no fifth mode: a week is not a goal.**
   */
  const weeklyPicker = useGoalPicker({
    mode: {
      kind: 'weeklyTarget',
      parentId,
      weekStart: parent && !isMonth ? period : undefined,
      ...(serverCandidates ? { candidates: serverCandidates } : {}),
    },
    value: picked,
    onChange: setPicked,
    from: 'New task',
    listLabel: 'Weekly goals in the target week',
  });

  const item = fromBacklogId ? (backlogQ.data?.items ?? []).find((b) => b.id === fromBacklogId) : undefined;
  const choices = weeklyPicker.options;

  /**
   * ⚠ **A9 — the first candidate is preselected at EVERY count, including one.** A single candidate is a
   * destination, not an absence of choice; writing it into STATE rather than leaving it as a `??` fallback
   * is what makes the row render as SELECTED and be announced (R-lens-13).
   */
  useEffect(() => {
    if (!initialGoalId && !isMonth && picked === null && choices.length > 0) setPicked(choices[0]!.id);
  }, [initialGoalId, isMonth, picked, choices]);
  const resolved = initialGoalId ?? picked ?? choices[0]?.id ?? null;
  const willCreateGoal = !initialGoalId && !isMonth && !!parent && choices.length === 0;
  /** A9 — the destination block renders whenever this sheet resolves one, at every candidate count. */
  const resolvesDestination = !initialGoalId && (!!parent || !!serverCandidates);

  const close = () => ui.closeSheet();
  const busy = createTask.isPending || convertItem.isPending;
  const measure = measuring ? validateDraft(draft).input : null;
  const measureBlocked = measuring && !measure;
  const blocked = busy || !title.trim() || measureBlocked || (!isMonth && !resolved && !willCreateGoal);

  /**
   * ⚠ **Where the work landed, and what the owner is owed for it.**
   *
   * A week: the toast names the week and the app **moves to the Weekly lens at that week**, because
   * staying put would leave the task invisible from the screen that made it (R-task-41, R-nav-19).
   * A month: the task lands on the very card that was tapped — in the Monthly card's own list, or in the
   * Weekly lens's month band — so **nothing moves**, which is R-task-57's rule satisfied by construction
   * rather than by a branch. The toast still names the destination, because a write that does not say
   * where it went is the unnamed-destination defect A9 closed.
   */
  const landed = (createdGoalTitle: string | null, landedWeek: string | undefined) => {
    close();
    if (landedWeek) {
      ui.showToast(`Added to week of ${shortDate(landedWeek)}`, {
        detail: createdGoalTitle ? `Added to week of ${shortDate(landedWeek)}, under ${createdGoalTitle}.` : undefined,
      });
      navigate(lensPath('Weekly', landedWeek));
    } else if (isMonth && monthKey) {
      ui.showToast(addedToMonthToast(labelOf('Monthly', monthKey)));
    } else {
      ui.showToast('Task added');
    }
  };

  const onError = (e: unknown) => {
    const err = toApiError(e);
    if (err.code === 'ALREADY_CONVERTED') {
      setRefused('That one is already this week — nothing new was created.');
      return;
    }
    /**
     * `409 AMBIGUOUS_CONVERSION_TARGET` — an item on a Quarterly goal with two Weekly goals beneath it has
     * no correct silent answer, so the owner picks. The server refuses to choose because that id decides
     * which week the task belongs to for the rest of its life, and array order is not a decision (D-18).
     */
    if (err.code === 'AMBIGUOUS_CONVERSION_TARGET') {
      const list = err.details?.candidates;
      setServerCandidates(Array.isArray(list) ? (list as { id: string; title: string }[]) : []);
      setPicked(null);
      setRefused('More than one weekly goal could take this. Which one?');
      return;
    }
    setRefused(null);
  };

  const save = () => {
    if (!title.trim()) return;
    setRefused(null);
    /**
     * ⚠ **The month path creates exactly ONE row.** `newWeeklyGoal` can never fire as a side effect of
     * accepting the default — it is sent only after the owner named a week (R-rm-6, the defect A8 deletes).
     */
    const goalPart = isMonth
      ? { goalId: monthGoal!.id }
      : resolved
        ? { goalId: resolved }
        : { newWeeklyGoal: { parentId, title: parentTitle } };
    if (fromBacklogId) {
      convertItem.mutate(
        {
          id: fromBacklogId,
          // R-backlog-31 — a month key lands the item on the goal it is ALREADY on: no resolution, no
          // candidate list, no ambiguity and no implicitly created goal.
          ...(isMonth ? {} : goalPart),
          ...(monthKey ? { period } : { week: clock.offsetOf(weekStart) }),
          title: title.trim(),
          cond: cond.trim(),
        },
        { onSuccess: (d) => landed(d.goal?.title ?? null, isMonth ? undefined : (d.goal?.periodKey ?? period)), onError },
      );
      return;
    }
    createTask.mutate(
      {
        ...goalPart,
        // ⚠ The BAND'S own month, or the week the owner named. Never a clamp and never a substitution.
        ...(monthKey ? { period } : {}),
        title: title.trim(),
        cond: cond.trim(),
        description: '',
        links: [],
        source: fromBacklogId ? 'backlog' : 'goal',
        ...(measure ? { measure } : {}),
      },
      {
        onSuccess: (d) =>
          landed(d.goal?.title ?? null, isMonth ? undefined : (d.goal?.periodKey ?? (initialGoalId ? undefined : (monthKey ? period : weekStart)))),
        onError,
      },
    );
  };

  /** Every sentence in the block is a pure function of the CHOSEN period, from this change onward. */
  const destinationNote = isMonth && monthKey ? monthDestinationNote(labelOf('Monthly', monthKey)) : taskDestinationNote(shortDate(period), monthLabelOfWeek(period));
  const createNote = implicitWeeklyGoalNote(parentTitle, shortDate(period));
  const status = !moved
    ? ''
    : isMonth
      ? destinationNote
      : choices.length === 0
        ? // It already names the week; pairing it with the destination line would say the date three times.
          createNote
        : landsUnder(destinationNote, choices.find((c) => c.id === (picked ?? choices[0]!.id))?.title ?? '');

  return (
    <Sheet label={weeklyPicker.taken ? weeklyPicker.heading : 'New task'} headerRight={weeklyPicker.headerRight} onClose={close}>
      {weeklyPicker.taken ? (
        weeklyPicker.panel
      ) : (
        <>
        <input
          aria-label="What needs doing?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
          style={{ ...S.input, marginBottom: 12 }}
        />
        <input
          aria-label="How will you know it's done?"
          value={cond}
          onChange={(e) => setCond(e.target.value)}
          placeholder="How will you know it's done?"
          style={S.input}
        />

        {/*
         * ⚠ **A8 (Q-E) — a measure, attached in the same command.** One `linkBtn` collapsed, the same
         * `MeasureFields` block expanded in place — **no second sheet, no takeover, no new modal pattern**
         * (a sheet inside a sheet is a shape this product has nowhere). A task with no measure renders
         * exactly as it did before: one line, and nothing else.
         *
         * It sits between the done-condition and `WHERE THIS GOES` — the task's own properties before the
         * task's destination, which is the order the sheet already reads in.
         */}
        <div style={{ marginTop: 6 }}>
          {/* A real disclosure: `aria-expanded` reflects the block, and the same control closes it again. */}
          <AddMeasureLink expanded={measuring} onToggle={() => setMeasuring(!measuring)} />
          {measuring && <MeasureFields draft={draft} onChange={setDraft} idPrefix="new-task-measure" />}
        </div>

        {/*
          * ⚠ **A9/A11 — WHERE THIS GOES: the period FIRST, then the goal it scopes, then the sentence.**
          * Reading order is decision order.
          */}
        {resolvesDestination && (
          <div style={{ marginTop: 14 }}>
            <div style={{ ...S.fieldLabel, marginBottom: 6 }}>WHERE THIS GOES</div>
            {/*
             * The chips render only with two or more options, which from A8 is always true for a Monthly
             * origin (the month is a second option by construction). A single-valued selector renders
             * nothing — `permittedHorizons`' own rule, one control over.
             */}
            {options.length > 1 && (
              <ChipRadioGroup
                label={WHEN_THIS_LANDS}
                options={options}
                value={period}
                onChange={(v) => {
                  // Changing the week clears the picked Weekly goal; the preselect effect fills it from
                  // the new week's candidates. A goal from the old week is never carried across — that
                  // pair is illegal, and `weeklyTarget`'s contract is "the goals inside this ONE week".
                  setPeriod(v);
                  setPicked(null);
                  setMoved(true);
                }}
                style={{ marginBottom: 10 }}
              />
            )}
            {/* With no week there is nothing to resolve: no goal row, no created goal, no picker. */}
            {!isMonth &&
              (choices.length > 0 ? (
                weeklyPicker.control
              ) : (
                /* Stated before it happens. Nothing may be created invisibly (R-task-49). */
                <div style={{ fontSize: 13, color: S.body, background: S.T.paper, border: `1px solid ${S.T.line}`, borderRadius: 12, padding: '10px 12px' }}>
                  {parent ? createNote : 'A weekly goal will be created for this task.'}
                </div>
              ))}
            <div style={{ fontSize: 12.5, color: S.T.mut, marginTop: 8 }}>{destinationNote}</div>
            {/* R-lens-13 — `aria-checked` announces the SELECTION; this announces the CONSEQUENCE. */}
            <div role="status" style={VISUALLY_HIDDEN}>
              {status}
            </div>
          </div>
        )}
        {item && <div style={{ fontSize: 12.5, color: S.T.mut, marginTop: 8 }}>From the backlog: {item.title}</div>}

        <FieldError>{refused ?? commandError(createTask.error) ?? commandError(convertItem.error)}</FieldError>
        <button type="button" style={S.saveBtn(blocked)} disabled={blocked} onClick={save}>
          Save task
        </button>
        </>
      )}
    </Sheet>
  );
}

/**
 * R-backlog-28 — `Pull from the backlog`, the one surviving half of the plan screen.
 *
 * From a **Weekly** goal it lists every open item on any ancestor of it (the server's `pullList`, which
 * excludes the Life root — a Life goal holds no items). From a **Monthly** goal it lists that goal's own
 * items, and the conversion then takes R-task-49's path: the Weekly goal is resolved or created for it.
 *
 * Tapping an item opens the create sheet pre-filled and bound to the target — the existing pull, moved out
 * of the dead plan screen unchanged (R-backlog-8: converted, never duplicated).
 */
export function PullSheet({ goalId, horizon, monthKey }: { goalId: string; horizon: Horizon; monthKey?: string }) {
  const S = useSkin();
  const ui = useUI();
  const detailQ = useGoal(goalId);
  const ownQ = useBacklog(horizon === 'Weekly' ? undefined : goalId);
  const close = () => ui.closeSheet();

  const items = horizon === 'Weekly' ? (detailQ.data?.pullList ?? []) : (ownQ.data?.items ?? []);
  const pending = horizon === 'Weekly' ? detailQ.isPending : ownQ.isPending;
  const goal = detailQ.data?.goal;

  return (
    <Sheet label="Pull from the backlog" onClose={close}>
      {pending && <Loading />}
      {!pending && items.length === 0 && (
        <div style={{ fontSize: 13.5, color: S.T.mut }}>
          Nothing in the backlog for this line yet.
          <div style={{ marginTop: 4 }}>Items you defer from a week land here.</div>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {items.map((b) => (
          <button
            key={b.id}
            type="button"
            style={S.pickerRow('ok')}
            onClick={() =>
              ui.openSheet({
                kind: 'taskCreate',
                /*
                 * ⚠ **A8/A11** — a Monthly origin inherits the create sheet's `When this lands` control by
                 * construction, which is the correct outcome: `Pull from backlog` and `+ Task` sit in one
                 * row on the same card, and an item that could only ever become work in the month's first
                 * week had the identical defect `+ Task` had.
                 */
                ...(horizon === 'Weekly'
                  ? { goalId, weekStart: goal?.periodKey }
                  : { monthGoal: { id: goalId, title: goal?.title ?? '' }, monthKey }),
                title: b.title,
                fromBacklogId: b.id,
              })
            }
          >
            <span aria-hidden="true" style={{ marginRight: 10, color: S.T.accentLink, fontWeight: 800 }}>
              +
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>{b.title}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
