import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { MeasureInput, MeasureKind, MeasureView, TaskDetailView } from '@goal-cascade/shared';
import { useUI } from '../context/UIContext';
import { useClearMeasure, useDeleteReading, useRecordReading, useSetMeasure } from '../api/queries';
import { useSkin } from '../skin';
import { instantLabel } from '../utils/dates';
import { ChipRadioGroup } from './ChipRadioGroup';
import { Sparkline, VISUALLY_HIDDEN } from './Sparkline';
import { FieldError, commandError } from './states';
import * as C from './measureCopy';

/**
 * **A task's number** — R-measure-1…9, and the owner's line above all of them:
 *
 * > *"show what you recorded, never compute a verdict."*
 *
 * Everything here is one of three things: the numbers you typed, a neutral bar restating them, or a
 * control for typing another. **No percentage is rendered anywhere, at any size, on any surface**
 * (R-measure-8): `21%` discards the unit — the one word that makes the owner's number theirs — invites
 * `100% = done`, is the natural home for a colour meaning good or bad, and is a number *the app derived*.
 *
 * **Reaching the target renders and announces nothing.** No sentence, no colour change, no icon, no live
 * region. The numbers change, the bar is full, and the product has no comment. That absence is the
 * feature, and it is why there is no string for it in `measureCopy.ts` to be tempted by.
 */

// ---- reading a measure ------------------------------------------------------

/**
 * The bar, and it renders **only when `progress != null`**.
 *
 * ⚠ **The two keys are independent and must not be collapsed** (R-measure-4, amended by A8): the slash is
 * `target !== null` (`measureLine`), the bar is `progress != null`. A no-target gauge has neither; a
 * measure with `target === start` in the data has the numbers and **no bar**, because no division was
 * performed and the client performs none either.
 *
 * `T.ink` on `T.lineSoft`, because ink is the least semantic colour in this palette — green would mean
 * *good*, red *bad*, accent *chosen*. Width is `clamp(progress, 0, 1)`, so `18 / 15 leads` draws a full
 * bar and never `120%` and never a bar past its own end.
 *
 * ⚠ **`aria-hidden`, and deliberately no `role="progressbar"`.** That role's `aria-valuenow` is announced
 * as a percentage by most screen readers, which would make the one forbidden number audible while it is
 * invisible. The numbers one line above are the accessible content; this is decoration for the eye, and
 * it shows no state the text does not.
 */
export function MeasureBar({ progress, height }: { progress: number | null | undefined; height: 2 | 4 }) {
  const S = useSkin();
  if (progress == null) return null;
  const filled = Math.min(1, Math.max(0, progress));
  return (
    <div
      aria-hidden="true"
      data-testid="measure-bar"
      data-fill={String(Math.round(filled * 100))}
      style={{ height, borderRadius: height / 2, background: S.T.lineSoft, marginTop: height === 2 ? 5 : 8, overflow: 'hidden' }}
    >
      <div style={{ height, borderRadius: height / 2, background: S.T.ink, width: `${filled * 100}%` }} />
    </div>
  );
}

/**
 * The numbers, at the two sizes this product renders them: **12.5 px on a row**, **17 px / 700 on the
 * page about this number**.
 *
 * **Never struck through, at any status.** A done task's line goes `T.mut` and nothing else changes: `12 /
 * 15 leads` on a completed task is what happened, and striking it would say the number was cancelled
 * rather than that the task was finished. There is no `missed`, no red, no note and no apology anywhere
 * near it (R-measure-6, both directions).
 */
export function MeasureLine({ m, done = false, size }: { m: MeasureView; done?: boolean; size: 'row' | 'page' }) {
  const S = useSkin();
  const row = size === 'row';
  const style: CSSProperties = row
    ? { fontSize: 12.5, color: done ? S.T.mut : S.body, marginTop: 2 }
    : { fontSize: 17, fontWeight: 700, color: done ? S.T.mut : S.T.ink, marginTop: 4 };
  return (
    <>
      <div style={style} data-testid="measure-line">
        {C.measureLine(m)}
      </div>
      <MeasureBar progress={m.progress} height={row ? 2 : 4} />
    </>
  );
}

// ---- setting a measure ------------------------------------------------------

export interface MeasureDraft {
  kind: MeasureKind;
  start: string;
  target: string;
  unit: string;
}

/** `counter`, starting at nothing: most measurable intentions accumulate, and a counter starts at 0 by construction. */
export const emptyDraft = (): MeasureDraft => ({ kind: 'counter', start: '0', target: '', unit: '' });

export const draftOf = (m: MeasureView): MeasureDraft => ({
  kind: m.kind,
  start: C.num(m.start),
  target: m.target === null ? '' : C.num(m.target),
  unit: m.unit,
});

const parse = (raw: string): number | null => {
  const t = raw.trim();
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) && Math.abs(v) <= 1e9 ? v : null;
};

/**
 * What the block will emit, or why it will not. Everything else is the server's — this is the one refusal
 * the owner can see coming, so it is the one the client states (`MEASURE_TARGET_EQUALS_START` is a
 * backstop, not a message the owner should be reading).
 */
export function validateDraft(d: MeasureDraft): { input: MeasureInput; error: null } | { input: null; error: string | null } {
  const start = parse(d.start);
  if (start === null) return { input: null, error: null };
  const hasTarget = d.target.trim() !== '';
  const target = hasTarget ? parse(d.target) : null;
  if (hasTarget && target === null) return { input: null, error: null };
  if (target !== null && target === start) return { input: null, error: C.START_EQUALS_TARGET };
  return { input: { kind: d.kind, start, target, unit: d.unit.trim().slice(0, 16) }, error: null };
}

/**
 * ⚠ **One component, two hosts** (`33-measurables-ux` §4.11) — the create sheet and the task page render
 * this identically. It owns four values, emits one object, and **does no I/O**: attaching a measure at
 * create time and editing one on the page are the same four fields, and a second copy would be two
 * copies of `Target (optional)` to keep in agreement.
 *
 * There is **no second sheet**. On the task page a `Set a measure` sheet would be a modal covering the
 * numbers it edits; in the create sheet it would be a sheet inside a sheet, which this product has
 * nowhere. One inline block, two hosts, one copy set.
 *
 * ── The fields, and why each default ──────────────────────────────────────────
 * `kind` comes **first**, because it changes what the other three mean; `Target` says *(optional)* in the
 * **label** and not only in the placeholder, because a placeholder is gone the moment you type and is not
 * a label; `Unit` is free text, trimmed, never parsed, never pluralised, never validated against a list.
 * Two muted lines carry the whole of the teaching and the whole of the check — a **kind note** and a
 * **range note** — so four fields never have to be understood from their labels alone.
 *
 * Both notes are live regions: a description that silently rewrites itself under a screen-reader user is
 * a change they cannot see, and the range note is a running restatement of four fields.
 *
 * `inputMode="decimal"` on all three numeric fields and **never `type="number"`**: it grows spinners on
 * desktop, silently discards unparseable input rather than showing it, and `valueAsNumber` is `NaN` for
 * the empty string — three ways to lose a value the owner typed.
 */
export function MeasureFields({
  draft,
  onChange,
  idPrefix,
}: {
  draft: MeasureDraft;
  onChange: (d: MeasureDraft) => void;
  idPrefix: string;
}) {
  const S = useSkin();
  const [startTouched, setStartTouched] = useState(false);
  const { error } = validateDraft(draft);
  const kindNoteId = `${idPrefix}-kind-note`;

  const setKind = (kind: MeasureKind) => {
    // A counter starts at nothing by construction; a gauge starts at wherever you are, which the app does
    // not know. An untouched field follows the kind; a typed one is the owner's and is left alone.
    const start = startTouched ? draft.start : kind === 'counter' ? '0' : '';
    onChange({ ...draft, kind, start });
  };

  const numField = (label: string, value: string, set: (v: string) => void, placeholder?: string) => (
    <label style={{ flex: 1, minWidth: 0, display: 'block' }}>
      <span style={{ ...S.fieldLabel, display: 'block', marginBottom: 4 }}>{label}</span>
      <input
        aria-label={label}
        value={value}
        onChange={(e) => set(e.target.value)}
        {...(placeholder ? { placeholder } : {})}
        inputMode="decimal"
        type="text"
        autoComplete="off"
        style={{ ...S.input, fontSize: 14 }}
      />
    </label>
  );

  return (
    <div data-testid="measure-fields">
      <div style={{ ...S.fieldLabel, marginBottom: 6 }}>{C.KIND_GROUP_LABEL}</div>
      <ChipRadioGroup
        label={C.KIND_GROUP_LABEL}
        idPrefix={`${idPrefix}-kind`}
        describedBy={kindNoteId}
        value={draft.kind}
        onChange={(v) => setKind(v as MeasureKind)}
        options={[
          { value: 'counter', label: C.KIND_LABEL.counter, name: C.KIND_NAME.counter },
          { value: 'gauge', label: C.KIND_LABEL.gauge, name: C.KIND_NAME.gauge },
        ]}
      />
      <div id={kindNoteId} aria-live="polite" style={{ fontSize: 12.5, color: S.T.mut, margin: '6px 0 10px 0' }}>
        {C.KIND_NOTE[draft.kind]}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        {numField(C.START_LABEL, draft.start, (v) => {
          setStartTouched(true);
          onChange({ ...draft, start: v });
        })}
        {numField(C.TARGET_LABEL, draft.target, (v) => onChange({ ...draft, target: v }), C.TARGET_PLACEHOLDER)}
      </div>

      <label style={{ display: 'block', marginTop: 10 }}>
        <span style={{ ...S.fieldLabel, display: 'block', marginBottom: 4 }}>{C.UNIT_LABEL}</span>
        <input
          aria-label={C.UNIT_LABEL}
          value={draft.unit}
          onChange={(e) => onChange({ ...draft, unit: e.target.value })}
          placeholder={C.UNIT_PLACEHOLDER}
          inputMode="text"
          autoCapitalize="off"
          autoComplete="off"
          maxLength={16}
          style={{ ...S.input, fontSize: 14 }}
        />
      </label>

      <div aria-live="polite" style={{ fontSize: 12.5, color: S.T.mut, marginTop: 8 }}>
        <RangeNote draft={draft} />
      </div>
      <FieldError>{error}</FieldError>
    </div>
  );
}

function RangeNote({ draft }: { draft: MeasureDraft }) {
  const start = parse(draft.start);
  if (start === null) return null;
  const target = draft.target.trim() === '' ? null : parse(draft.target);
  if (draft.target.trim() !== '' && target === null) return null;
  return <>{C.rangeNote(start, target, draft.unit.trim())}</>;
}

/**
 * The disclosure a task with no measure carries, everywhere: **one `linkBtn`, `+ Add a number`.** It is a
 * real button element carrying `aria-expanded`, because it is a disclosure and not a navigation.
 */
export function AddMeasureLink({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const S = useSkin();
  return (
    <button type="button" style={S.linkBtn} aria-expanded={expanded} onClick={onToggle}>
      {C.ADD_MEASURE}
    </button>
  );
}

// ---- the task page's block --------------------------------------------------

type Mode = 'idle' | 'edit' | 'removing';

/**
 * The whole measure block on the task page: the numbers, the record control, the sparkline and the
 * readings — **the history's one surface** (R-measure-5). A goal card, a lens row and a backlog row all
 * want a sparkline and none may have one: a screen of sparklines is the report R-nav-26 refuses.
 *
 * It sits between `LINKS` and `WHERE THIS GOES`, **far from the checkbox on purpose**: the checkbox is at
 * the top beside the title, and the two share no control and no row, because a completion control that
 * recites a number invites the reading that the number is the condition (R-measure-6).
 *
 * The `MEASURE` eyebrow renders even in the empty state, on `LINKS`' own precedent: an empty labelled
 * block is how a feature is discovered, and a bare link floating between two labelled blocks is a control
 * with no name.
 */
export function MeasureBlock({ task }: { task: TaskDetailView }) {
  const S = useSkin();
  const ui = useUI();
  const setMeasure = useSetMeasure();
  const clearMeasure = useClearMeasure();
  const [mode, setMode] = useState<Mode>('idle');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<MeasureDraft>(emptyDraft);
  const [announcement, setAnnouncement] = useState('');
  const keepRef = useRef<HTMLButtonElement>(null);
  const m = task.measure;

  useEffect(() => {
    if (mode === 'removing') keepRef.current?.focus();
  }, [mode]);

  const openEdit = () => {
    setDraft(m ? draftOf(m) : emptyDraft());
    setMode('edit');
  };

  const { input } = validateDraft(draft);
  const save = (wasThere: boolean) => {
    if (!input) return;
    setMeasure.mutate(
      { id: task.id, measure: input, version: task.version },
      {
        onSuccess: () => {
          setMode('idle');
          setAdding(false);
          ui.showToast(wasThere ? C.TOAST_MEASURE_UPDATED : C.TOAST_MEASURE_ADDED);
        },
      },
    );
  };

  const cancel = () => {
    setMode('idle');
    setAdding(false);
  };

  const fieldsBlock = (wasThere: boolean) => (
    /*
     * ⚠ **`Escape` cancels the inline edit — the existing `AddSubGoal` idiom**, and it `stopPropagation`s
     * so the task page's own `Escape` (which leaves the page) cannot also fire. One key, one meaning, and
     * the innermost thing you opened is the thing it closes.
     */
    <div
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }}
    >
      <MeasureFields draft={draft} onChange={setDraft} idPrefix={`measure-${task.id}`} />
      <FieldError>{commandError(setMeasure.error)}</FieldError>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
        <button type="button" style={{ ...S.smallDarkBtn, opacity: input ? 1 : 0.5 }} disabled={!input || setMeasure.isPending} onClick={() => save(wasThere)}>
          {C.SAVE_MEASURE}
        </button>
        <button type="button" style={S.linkBtn} onClick={cancel}>
          {C.CANCEL_MEASURE}
        </button>
      </div>
    </div>
  );

  return (
    <div data-testid="measure-block">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0 5px 0' }}>
        <div style={{ ...S.fieldLabel, flex: 1 }}>{C.MEASURE_EYEBROW}</div>
        {m && mode === 'idle' && (
          <>
            <button type="button" style={{ ...S.linkBtn, minHeight: 32 }} onClick={openEdit}>
              {C.EDIT_MEASURE}
            </button>
            <button type="button" style={{ ...S.linkBtn, minHeight: 32 }} onClick={() => setMode('removing')}>
              {C.REMOVE_MEASURE}
            </button>
          </>
        )}
      </div>

      {/*
       * The one polite region for this block: a record and a delete both announce their result here.
       *
       * ⚠ The `data-testid` is what lets R-measure-8 be asserted as an EQUALITY rather than as a
       * blacklist of celebratory words: reaching a target must announce the ordinary sentence and
       * **nothing else**, and no list of forbidden words can prove "nothing else".
       */}
      <div data-testid="measure-announcement" aria-live="polite" style={VISUALLY_HIDDEN}>
        {announcement}
      </div>

      {!m && !adding && <AddMeasureLink expanded={false} onToggle={() => { setDraft(emptyDraft()); setAdding(true); }} />}
      {!m && adding && fieldsBlock(false)}

      {m && mode === 'edit' && fieldsBlock(true)}
      {m && mode === 'removing' && (
        <div style={S.discardBar}>
          <span style={{ flex: 1, minWidth: 140 }}>{C.removeConfirm(task.readings.length)}</span>
          <button
            type="button"
            style={{ ...S.btn(false, true), minHeight: 36 }}
            disabled={clearMeasure.isPending}
            onClick={() =>
              clearMeasure.mutate(
                { id: task.id },
                {
                  onSuccess: () => {
                    setMode('idle');
                    ui.showToast(C.TOAST_MEASURE_REMOVED);
                  },
                },
              )
            }
          >
            {C.REMOVE_MEASURE}
          </button>
          <button type="button" ref={keepRef} style={{ ...S.btn(true), minHeight: 36 }} onClick={() => setMode('idle')}>
            {C.KEEP_MEASURE}
          </button>
        </div>
      )}
      {m && mode === 'idle' && <MeasureLine m={m} done={task.done} size="page" />}

      {/*
       * ⚠ `RECORD` and everything below it stay mounted and usable **while editing and while removing**:
       * the readings are not the shape, and a done task can still be recorded against (R-measure-6).
       */}
      {m && (
        <>
          <RecordControl task={task} m={m} say={setAnnouncement} />
          <Sparkline readings={task.readings} unit={m.unit} />
          <LatestLine task={task} m={m} />
          <ReadingsList task={task} m={m} say={setAnnouncement} />
        </>
      )}
    </div>
  );
}

function LatestLine({ task, m }: { task: TaskDetailView; m: MeasureView }) {
  const S = useSkin();
  const last = task.readings[task.readings.length - 1];
  if (!last) return null;
  return (
    <div style={{ fontSize: 12.5, color: S.T.mut, marginTop: 4, textAlign: 'right' }}>
      {C.latestLine(last.value, m.unit, instantLabel(last.at))}
    </div>
  );
}

/**
 * **One eyebrow, one field and one button**, for both kinds — this is the most repeated interaction in the
 * feature, and two verbs for one act is one verb too many for a thumb in a gym.
 *
 * A **counter** adds: the field is prefixed `+`, posts a `delta`, and is preceded by a `+1` chip that
 * posts `delta: 1` **on one tap with no second stop** — `15 leads daily` is fifteen taps, not fifteen
 * typed numbers. It can also be corrected to where it actually is: `Correct it instead` flips the field
 * to absolute (R-measure-3 accepts an absolute against a counter).
 *
 * A **gauge** sets: the field is pre-filled with `current`, posts a `value`, and `Record` stays enabled
 * when the number is unchanged, because recording the same weight on a new day is data and refusing it
 * would be the app deciding what counts. **A delta against a gauge is never offered**, so
 * `MEASURE_KIND_MISMATCH` is unreachable from this UI and is a server-side backstop only.
 *
 * ⚠ **Focus never moves on a successful record.** Enter submits from the field, so the fast path never
 * leaves it; nothing is programmatically focused, because moving focus to a toast or a value line would
 * cost a keyboard user a trip back for every rep. The result arrives in the block's polite region as the
 * **full new state** — `Recorded 65. Now 65 of 300 leads.` — which is what the eye picks up from the line
 * that just repainted. No navigation and no toast: a toast for a value that repainted three lines above
 * the field is a notification about something you are looking at.
 */
function RecordControl({ task, m, say }: { task: TaskDetailView; m: MeasureView; say: (s: string) => void }) {
  const S = useSkin();
  const record = useRecordReading();
  const [absolute, setAbsolute] = useState(false);
  const [text, setText] = useState(m.kind === 'gauge' ? C.num(m.current) : '');
  const gauge = m.kind === 'gauge';
  const setting = gauge || absolute;
  const currentRef = useRef(m.current);

  // A gauge's field follows `current` whenever the server moves it — a record here, a deletion below.
  useEffect(() => {
    if (gauge && currentRef.current !== m.current) setText(C.num(m.current));
    currentRef.current = m.current;
  }, [gauge, m.current]);

  const parsed = parse(text);
  const send = (body: { value?: number; delta?: number }) =>
    record.mutate(
      { id: task.id, ...body, version: task.version },
      {
        onSuccess: (d) => {
          if (d.task.measure) say(C.recordedAnnouncement(d.task.measure));
          // A counter's field clears; a gauge's takes the new `current` through the effect above.
          if (!gauge) setText('');
        },
      },
    );

  const submit = () => {
    if (parsed === null || record.isPending) return;
    send(setting ? { value: parsed } : { delta: parsed });
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    submit();
  };

  const fieldName = gauge ? C.gaugeFieldName(m.unit) : absolute ? C.absoluteFieldName(m.unit) : C.deltaFieldName(m.unit);

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ ...S.fieldLabel, marginBottom: 6 }}>{C.RECORD_EYEBROW}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {!gauge && !absolute && (
          <button type="button" aria-label={C.plusOneName(m.unit)} style={S.chipBtn(false)} disabled={record.isPending} onClick={() => send({ delta: 1 })}>
            {C.PLUS_ONE}
          </button>
        )}
        <input
          aria-label={fieldName}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          {...(setting ? {} : { placeholder: C.DELTA_PLACEHOLDER })}
          inputMode="decimal"
          type="text"
          autoComplete="off"
          style={{ ...S.input, flex: 1, minWidth: 0, minHeight: 48, fontSize: 14 }}
        />
        <button type="button" style={{ ...S.menuBtn, opacity: parsed === null || record.isPending ? 0.5 : 1 }} disabled={parsed === null || record.isPending} onClick={submit}>
          {C.RECORD}
        </button>
      </div>
      {!gauge && (
        <button
          type="button"
          style={S.linkBtn}
          onClick={() => {
            setAbsolute(!absolute);
            setText('');
          }}
        >
          {absolute ? C.ADD_INSTEAD : C.CORRECT_INSTEAD}
        </button>
      )}
      <FieldError>{commandError(record.error)}</FieldError>
    </div>
  );
}

/** Ten rows before `Show all N` — the sparkline's recent tail at a glance, with the rest one tap below. */
const READINGS_SHOWN = 10;

/**
 * Newest first — the reverse of the wire, which is oldest first (R-measure-5).
 *
 * **Deletion is one tap with no confirm.** The precedent is `Remove link`, a one-tap `×` on this same
 * page at the same size, and the reason is R-measure-5's own: correcting a mistyped `240` **is** deleting
 * it and recording `24`, so a confirm would sit on the *repair* path and tax the honest user to guard
 * against a mis-tap that one more tap already fixes. Removing the whole **measure** is different and does
 * get a confirm, because that destroys history rather than one row of it.
 *
 * **No undo bar** (R-measure-7): a deleted reading leaves no trace anywhere, and an undo bar is a trace in
 * the UI layer holding the value it claims to have removed.
 *
 * Focus moves to the row that took the deleted row's place, or to the `READINGS` eyebrow when the list is
 * now empty — never to `<body>`.
 */
function ReadingsList({ task, m, say }: { task: TaskDetailView; m: MeasureView; say: (s: string) => void }) {
  const S = useSkin();
  const del = useDeleteReading();
  const [expanded, setExpanded] = useState(false);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const eyebrowRef = useRef<HTMLDivElement>(null);

  const newestFirst = [...task.readings].reverse();
  const shown = expanded ? newestFirst : newestFirst.slice(0, READINGS_SHOWN);

  useEffect(() => {
    if (focusIndex === null) return;
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[data-reading-delete]');
    const next = buttons && buttons.length > 0 ? (buttons[Math.min(focusIndex, buttons.length - 1)] ?? null) : null;
    (next ?? eyebrowRef.current)?.focus();
    setFocusIndex(null);
  }, [focusIndex, task.readings.length]);

  return (
    <div style={{ marginTop: 16 }}>
      <div ref={eyebrowRef} tabIndex={-1} style={{ ...S.fieldLabel, marginBottom: 4, outline: 'none' }}>
        {C.READINGS_EYEBROW}
      </div>
      {/* `current` falls back to `start` with nothing recorded, and `0 / 300 leads` above is not nothing. */}
      {newestFirst.length === 0 && <div style={{ fontSize: 13, color: S.T.mut }}>{C.NO_READINGS}</div>}
      <div ref={listRef} style={{ display: 'flex', flexDirection: 'column' }}>
        {shown.map((r, i) => {
          const at = instantLabel(r.at);
          return (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 40, borderTop: `1px solid ${S.T.lineSoft}` }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: S.body }}>{C.readingValue(r.value, m.unit)}</div>
              <div style={{ fontSize: 12.5, color: S.T.mut }}>{at}</div>
              <button
                type="button"
                data-reading-delete=""
                aria-label={C.deleteReadingName(r.value, m.unit, at)}
                disabled={del.isPending}
                onClick={() =>
                  del.mutate(
                    { id: task.id, readingId: r.id },
                    {
                      onSuccess: (d) => {
                        if (d.task.measure) say(C.deletedAnnouncement(d.task.measure));
                        setFocusIndex(i);
                      },
                    },
                  )
                }
                style={{ minWidth: 36, minHeight: 36, border: 'none', background: 'none', color: S.T.mut, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      {newestFirst.length > READINGS_SHOWN && (
        <button type="button" style={S.linkBtn} onClick={() => setExpanded(!expanded)}>
          {expanded ? C.SHOW_FEWER : C.showAll(newestFirst.length)}
        </button>
      )}
      <FieldError>{commandError(del.error)}</FieldError>
    </div>
  );
}
