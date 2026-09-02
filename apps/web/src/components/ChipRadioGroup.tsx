import { useId, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useSkin } from '../skin';

/**
 * **One chip radiogroup, one keyboard model** — `32-week-selection` §7's "extract, do not duplicate"
 * directive, honoured before the second caller landed rather than after.
 *
 * It was written twice-in-waiting: A9 built the goal picker's horizon selector as a roving-tabindex
 * `role="radio"` row, and A11's `When this lands` control asks for exactly the same thing over a
 * different option set. *"A second copy of a keyboard model is how two controls in one sheet come to
 * disagree about `Home`."* There are three callers now — the horizon selector, the create sheet's
 * `When this lands`, and the retarget sheet's — and one model between them.
 *
 * **A `radiogroup`, never a `tablist`.** A tab implies a `tabpanel`; what these control is a list, a
 * form field and a sentence, none of which is one. A radiogroup says what this is: a single-choice
 * narrowing of whatever follows it.
 *
 * The model, in full (WAI-ARIA's radiogroup pattern):
 *
 *  - exactly **one** chip in the tab order (`tabIndex = on ? 0 : -1`);
 *  - `←`/`→` **and** `↑`/`↓` move **and select** — the chips wrap onto a second line inside a vertical
 *    form, so both axes have to work;
 *  - `Home`/`End` reach the ends;
 *  - selecting moves focus to the newly checked chip;
 *  - the selection is announced by `aria-checked`, never merely coloured (R-lens-13).
 *
 * **Never a second focus trap.** These are ordinary tab stops inside whatever dialog already traps.
 *
 * `S.chipBtn` is the product's existing segmented chip: no new colour and no new token, so
 * `tests/screens/contrast.test.ts` has nothing new to check.
 */
export interface ChipOption {
  /** The value written back — a `Horizon`, a `periodKey`, a measure kind. Also the DOM id's suffix. */
  value: string;
  /** What the eye reads. */
  label: string;
  /** What the platform reads. Never the bare label when the label is a glyph, a digit or an abbreviation. */
  name: string;
}

export function ChipRadioGroup({
  label,
  options,
  value,
  onChange,
  idPrefix,
  style,
  describedBy,
}: {
  /** The group's accessible name. */
  label: string;
  options: readonly ChipOption[];
  value: string;
  onChange: (value: string) => void;
  /** Supplied where a caller owns the ids (the goal picker's `${domId}-h-<horizon>`); auto otherwise. */
  idPrefix?: string;
  style?: CSSProperties;
  /** A note that describes the whole group and changes with the selection (the measure's kind note). */
  describedBy?: string;
}) {
  const S = useSkin();
  const auto = useId();
  const prefix = idPrefix ?? auto;
  const idOf = (v: string) => `${prefix}-${v}`;

  const pick = (index: number) => {
    const opt = options[index];
    if (!opt) return;
    onChange(opt.value);
    document.getElementById(idOf(opt.value))?.focus();
  };

  const onKeyDown = (e: ReactKeyboardEvent, index: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    let next = -1;
    if (step !== 0) next = (index + step + options.length) % options.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = options.length - 1;
    if (next < 0) return;
    e.preventDefault();
    pick(next);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      {...(describedBy ? { 'aria-describedby': describedBy } : {})}
      style={{ display: 'flex', gap: 6, flexWrap: 'wrap', ...style }}
    >
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            id={idOf(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.name}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            style={S.chipBtn(on)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
