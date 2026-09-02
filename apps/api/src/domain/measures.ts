import type { MeasureInput, MeasureView } from '@goal-cascade/shared';
import type { Task } from './entities';
import { DomainError } from './errors';

/**
 * **Measure POLICY — R-measure-2, R-measure-3, R-measure-4.**
 *
 * Two functions, and between them they are the whole of what the server decides about a number:
 * whether the five columns add up to a measure, and what — if anything — `progress` is.
 *
 * Everything this file does NOT do is as load-bearing as what it does (R-measure-8). There is no pace,
 * no projection, no forecast, no "at this rate", no trend line, no moving average, no on-track /
 * behind / ahead state in a word, a colour, an icon or an accessible name, no streak, no completion
 * rate, no burndown, no per-period summary, and **no roll-up** — a Monthly goal's target is never
 * computed from the tasks or weeks beneath it, and a measure is never aggregated across two tasks
 * anywhere (S-measure-8-1).
 *
 * The rule that admits the numbers this amendment adds and refuses those: **a number the owner recorded
 * is data; a number the app derived about the owner is a judgment.** `current`, `target`, their ratio and
 * the readings are the owner's own values played back.
 *
 * **This file exists so the next agent cannot reintroduce any of it as an obvious improvement.** Each is
 * one line of code away from a measure and each would be the first number in this product that judged its
 * owner.
 */

/** The five columns, present or absent together. `null` ⇔ `measureKind IS NULL` (R-measure-1). */
export type MeasureColumns = Pick<
  Task,
  'measureKind' | 'measureStart' | 'measureCurrent' | 'measureTarget' | 'measureUnit'
>;

/** The five nulls, as one value — what "no measure" is written as, and the only way to write it. */
export const NO_MEASURE: MeasureColumns = {
  measureKind: null,
  measureStart: null,
  measureCurrent: null,
  measureTarget: null,
  measureUnit: null,
};

/**
 * R-measure-4 — `(current − start) / (target − start)`, or **`null`, with no division performed**.
 *
 * **One formula for both directions, and no branch on which way it runs**: `start 80, target 75,
 * current 78` is `(−2)/(−5) = 0.4`. Direction is implied by the two numbers and there is no flag
 * (R-measure-2).
 *
 * It is `null` in exactly two cases, and neither ever divides:
 *
 *  1. **`target === null`** — the AMRAP case. No progress, no percentage, no completion criterion and no
 *     bar; just the number, its unit and its history. A first-class measurable, not a degraded one.
 *  2. **`target === start`** — refused on the way in by `assertMeasure` below, and if such a row
 *     exists anyway (a migration, a hand-edit, a bug) **no division is performed**: the field is omitted
 *     from the wire and the UI renders the numbers alone. `NaN`, `Infinity`, `0%` and `100%` are each
 *     specifically forbidden as the answer (S-measure-4-3). This is the one place a divide-by-zero can
 *     reach a screen, and a wrong number is worse than no number. **Both halves are load-bearing**: this
 *     function is what holds when the guard is bypassed, which is the only reason it can be.
 *
 * **The raw ratio may exceed 1 and is never clamped here.** 18 leads against a target of 15 is `1.2`; the
 * row reads `18 / 15 leads`, never `120%`, and only the bar's *drawn fill* is clamped, in the client, for
 * drawing (S-measure-4-4).
 */
export function progressOf(start: number, current: number, target: number | null): number | null {
  if (target === null) return null;
  const span = target - start;
  if (span === 0) return null;
  return (current - start) / span;
}

/**
 * The wire projection of a task's five measure columns, or `null` for the vast majority of tasks, which
 * are ordinary checkboxes and render exactly as they did before A8 (R-measure-1, S-measure-1-1).
 *
 * `measureKind` is the discriminator and the only one: a row with a kind and a null `start` is a
 * data-integrity fact rather than an ordinary one, and it is read as `0` here rather than 500ing a lens,
 * for R-lens-20's reason — a read that fails on one malformed row hides the row instead of surfacing it.
 */
export function toMeasureView(task: MeasureColumns): MeasureView | null {
  if (task.measureKind === null) return null;
  const start = task.measureStart ?? 0;
  const current = task.measureCurrent ?? start;
  const target = task.measureTarget;
  return {
    kind: task.measureKind,
    start,
    current,
    target,
    unit: task.measureUnit ?? '',
    progress: progressOf(start, current, target),
  };
}

/**
 * R-measure-1 — the five columns, all-or-nothing. Given no input it is `NO_MEASURE`: the five nulls,
 * which is how "this task is an ordinary checkbox" is written and the only way to write it.
 *
 * ⚠ **It lives here, beside `NO_MEASURE`, because TWO services mint tasks** — `TaskService.create` and
 * the conversion's `buildTaskWrites` (A8's create sheet is one sheet and may attach a measure on either
 * of its paths). A second copy would be a second answer to *what `current` is at creation*, and that
 * answer is not obvious enough to be safely re-derived.
 */
export function measureColumns(m: MeasureInput | undefined): MeasureColumns {
  if (m === undefined) return NO_MEASURE;
  return {
    measureKind: m.kind,
    measureStart: m.start,
    // No readings exist yet, so `current` IS `start` (R-measure-3). It is never client-supplied.
    measureCurrent: m.start,
    measureTarget: m.target,
    measureUnit: m.unit,
  };
}

/**
 * ⚠ **R-measure-4 — THE `target === start` rule, and it reads two numbers.**
 *
 * It names no movement, and "maintain" — the only thing it could mean — is out of scope for this
 * amendment. **This is the whole enforcement point**, deliberately not a Zod refinement on
 * `MeasureInput`: a refinement guards `/api/*` alone, and the MCP tools declare their own schemas, so
 * `set_task_measure` used to write a `5 / 5` measure with no progress and a
 * `Measure added: counter, 5 → 5` line beside it. It also could never carry its own code, because
 * `api/validate.ts` flattens every schema failure to `VALIDATION_FAILED` — which is how the web came to
 * render the constant's NAME to the owner as a toast.
 *
 * ⚠ **A module function rather than a service method, for the reason above.** "The whole enforcement
 * point" was true while one service wrote measures and stopped being true the moment a conversion could
 * carry one. Every path that mints or replaces a measure calls this one function.
 *
 * Refusing it here is only half the rule. The other half is that where such a row exists **anyway** — a
 * migration, a hand-edit, a bug — **no division is performed**: `progressOf` returns `null` and the
 * field is omitted from the wire. `NaN`, `Infinity`, `0%` and `100%` are each specifically forbidden as
 * the answer, because this is the one place a divide-by-zero reaches a screen.
 */
export function assertMeasure(m: MeasureInput): MeasureInput {
  if (m.target !== null && m.target === m.start) {
    throw new DomainError('MEASURE_TARGET_EQUALS_START', 'a target equal to the start names no movement', {
      start: m.start,
      target: m.target,
    });
  }
  return m;
}
