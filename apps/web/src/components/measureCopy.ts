import type { MeasureKind, MeasureView } from '@goal-cascade/shared';
import { plural } from '../utils/tree';

/**
 * Every string the measure renders, in one place — `33-measurables-ux` §3.4/§3.5/§3.6, verbatim.
 *
 * Two rules govern the whole file and are worth stating before the strings:
 *
 * **`show what you recorded, never compute a verdict.`** — the owner's own line. Nothing here says
 * *ahead*, *behind*, *on track*, *done*, *missed* or a percentage, and **there is no string for
 * reaching a target**, because reaching a target renders and announces nothing (R-measure-8). That
 * absence is a decision; a later agent adding `You've hit your target!` would be adding the first
 * opinion this product has ever had about the owner's numbers.
 *
 * **The visible line keeps `/`; the spoken one says `of`.** Screen readers read `/` inconsistently —
 * *slash*, *per*, or silence — so every live-region string here spells `of`, and the static row does
 * not: a static string can be re-read and paused on, an announcement cannot.
 */

/**
 * A measure's number, as a person wrote it: at most two decimals, trailing zeros stripped.
 *
 * ⚠ **No thousands separator, no `Intl.NumberFormat`, no locale.** A separator is a second spelling of a
 * number, and `1,000` versus `1.000` is exactly the A10 trap (`Sep` / `Sept` on one screen) one data type
 * over. The owner types `78.5` and reads `78.5`, on every surface, in every browser.
 */
export function num(v: number): string {
  if (!Number.isFinite(v)) return '';
  return String(Math.round(v * 100) / 100);
}

const withUnit = (v: number, unit: string): string => `${num(v)}${unit ? ` ${unit}` : ''}`;

/**
 * ⚠ **R-measure-4 — the slash is keyed on `target !== null`, and on NOTHING else.**
 *
 * The bar is keyed on `progress != null` (see `MeasureBar`), and the two must never be collapsed into
 * one key. A no-target gauge has neither: it reads `24 reps`, with no slash, no percentage and no bar,
 * and nothing on screen mentions a missing target. A measure whose `progress` is absent because
 * `target === start` in the data has **the slash and no bar** — `62 / 62 leads` — because the numbers are
 * what was stored and no division was performed. Writing `progress != null` here renders that task as
 * `62 leads`, which is a lie about its data.
 */
export const measureLine = (m: MeasureView): string =>
  m.target !== null ? `${num(m.current)} / ${withUnit(m.target, m.unit)}` : withUnit(m.current, m.unit);

// ---- setting a measure (§3.4) ----------------------------------------------

export const ADD_MEASURE = '+ Add a number';
export const MEASURE_EYEBROW = 'MEASURE';
export const KIND_GROUP_LABEL = "How you'll record it";
export const KIND_LABEL: Record<MeasureKind, string> = { counter: 'Counter', gauge: 'Gauge' };
export const KIND_NAME: Record<MeasureKind, string> = {
  counter: 'Counter — you add to it',
  gauge: 'Gauge — you set it',
};
export const KIND_NOTE: Record<MeasureKind, string> = {
  counter: 'You add to it. Each entry is a change: +3.',
  gauge: 'You set it. Each entry replaces the last: 78.5.',
};
export const START_LABEL = 'Start';
export const TARGET_LABEL = 'Target (optional)';
export const TARGET_PLACEHOLDER = 'Optional';
export const UNIT_LABEL = 'Unit';
export const UNIT_PLACEHOLDER = 'leads, kg, reps';

/** `0 → 300 leads.` · `0 → 300.` · `From 18 reps. No target.` · `From 18. No target.` */
export function rangeNote(start: number, target: number | null, unit: string): string {
  if (target === null) return `From ${withUnit(start, unit)}. No target.`;
  return `${num(start)} → ${withUnit(target, unit)}.`;
}

export const START_EQUALS_TARGET = "Start and target can't be the same number.";
export const SAVE_MEASURE = 'Save measure';
export const CANCEL_MEASURE = 'Never mind';
export const EDIT_MEASURE = 'Edit';
export const REMOVE_MEASURE = 'Remove';
export const KEEP_MEASURE = 'Keep';

/** R-measure-1 — the confirm names the count, because removing a measure takes every reading with it. */
export const removeConfirm = (readings: number): string =>
  readings > 0 ? `Remove the measure? This deletes ${plural(readings, 'recorded value')}.` : 'Remove the measure?';

export const TOAST_MEASURE_REMOVED = 'Measure removed';
export const TOAST_MEASURE_ADDED = 'Measure added';
export const TOAST_MEASURE_UPDATED = 'Measure updated';

// ---- updating a measure (§3.5) ---------------------------------------------

export const RECORD_EYEBROW = 'RECORD';
export const RECORD = 'Record';
export const PLUS_ONE = '+1';
/**
 * ⚠ **`Add 1 to leads`, and NOT `33-measurables-ux` §3.5's `Add 1 lead`** — the owner's overrule, and the
 * standing rule wins.
 *
 * `+1` alone is a glyph and a digit, so the accessible name has to name what is being added — but
 * `Add 1 lead` from the unit `leads` requires **singularising the owner's own word**, and
 * `docs/BUSINESS-RULES.md` is explicit that *"the unit is a word, never parsed and never converted"*.
 * Stripping a trailing `s` **is** parsing: it is English-only, and it is a coin flip across real units —
 * `status → statu`, `press → pres`, `mins`, `lbs`, `kg`, and anything the owner types in another
 * language. **A label that mangles the owner's own word is worse than a label that omits it.**
 *
 * Nothing is lost by interpolating the unit whole: it already appears verbatim in the value line
 * immediately beside the chip (`62 / 300 leads`), so the name adds the verb and the direction and nothing
 * else. **No code anywhere transforms a unit string** — every function in this file interpolates it as
 * given, and `measures.test.tsx` pins the rule with `status`, the case that proves it.
 */
export const plusOneName = (unit: string): string => (unit ? `Add 1 to ${unit}` : 'Add 1');
export const DELTA_PLACEHOLDER = '+';
export const deltaFieldName = (unit: string): string => (unit ? `How many ${unit} to add` : 'How much to add');
export const gaugeFieldName = (unit: string): string => (unit ? `New value in ${unit}` : 'New value');
export const CORRECT_INSTEAD = 'Correct it instead';
export const ADD_INSTEAD = 'Add to it instead';
export const absoluteFieldName = (unit: string): string => (unit ? `Set to, in ${unit}` : 'Set to');

/**
 * `Recorded 65. Now 65 of 300 leads.` — *what you did*, then *where that leaves the numbers*, which is
 * exactly what the eye picks up from the line that just repainted. With **no target** there is no second
 * clause at all and the unit rides the first: `Recorded 24 reps.` Nothing here is a confirmation
 * (`Saved`, `Done`) — a confirmation says less than the state does.
 */
export function recordedAnnouncement(m: MeasureView): string {
  if (m.target === null) return `Recorded ${withUnit(m.current, m.unit)}.`;
  return `Recorded ${num(m.current)}. Now ${num(m.current)} of ${withUnit(m.target, m.unit)}.`;
}

// ---- the sparkline and the readings (§3.6) ---------------------------------

/**
 * The sparkline's text equivalent **points at the real equivalent rather than reciting it.** Reciting
 * 2 000 numbers into a screen reader is hostile; reciting the most recent ten would give a screen-reader
 * user strictly less than the picture gives a sighted one. The list below is complete, ordered and
 * individually navigable, so the honest equivalent says so.
 */
export const sparklineText = (count: number, unit: string): string =>
  `Sparkline of ${plural(count, 'reading')}${unit ? ` in ${unit}` : ''}, oldest to newest. Every reading is listed below.`;

export const latestLine = (value: number, unit: string, at: string): string => `Latest ${withUnit(value, unit)} · ${at}`;

export const READINGS_EYEBROW = 'READINGS';
export const NO_READINGS = 'Nothing recorded yet.';
export const readingValue = (value: number, unit: string): string => withUnit(value, unit);
export const deleteReadingName = (value: number, unit: string, at: string): string =>
  `Delete reading ${withUnit(value, unit)}, ${at}`;
export const showAll = (n: number): string => `Show all ${n}`;
export const SHOW_FEWER = 'Show fewer';

/** `Reading deleted. Now 57 of 300 leads.` — the same *where that leaves it* clause, one verb over. */
export function deletedAnnouncement(m: MeasureView): string {
  if (m.target === null) return `Reading deleted. Now ${withUnit(m.current, m.unit)}.`;
  return `Reading deleted. Now ${num(m.current)} of ${withUnit(m.target, m.unit)}.`;
}
