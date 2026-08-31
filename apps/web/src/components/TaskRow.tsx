import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { TaskView } from '@goal-cascade/shared';
import { useUI } from '../context/UIContext';
import { useCompleteTask, usePatchTask, useUncheckTask } from '../api/queries';
import { useSkin } from '../skin';
import { instantLabel, shortDate, weekLabel } from '../utils/dates';
import { taskPath } from '../routes';
import { FieldError, commandError } from './states';

/**
 * One task row: the checkbox, the body, the carry label, and the skippable uncheck follow-up.
 *
 * Nothing here is computed. `done`, `completable`, `carryWeeks` and `originWeekStart` are the server's,
 * for the week this list was built for.
 *
 * ⚠ **A2 (R-task-43) — `carryWeeks` is SIGNED, and this is the wire break that produces no type error.**
 * `weeksBetween(origin, min(viewed, current))` goes NEGATIVE for work that is not due yet, so the guard
 * below is `>= 1` and not `!== 0`, and the chip's threshold is `>= 2`:
 *
 *   `<= 0` → nothing · `= 1` → the gray `since Mon 24 Aug` · `>= 2` → the red `N weeks · since 10 Aug` chip
 *
 * **The red chip is the only escalation in this product and it must never fire on work that is not late**
 * (R-lens-11, S-lens-11-2). A comparison written as `Math.abs(age)`, a `!== 0`, or anything that sums
 * these values across tasks is silently wrong now; `tests/screens/weeklyLens.test.tsx` asserts the
 * negative case directly, because nothing that renders changed and only an assertion can hold it.
 */
export function TaskRow({ t, week }: { t: TaskView; week: number }) {
  const S = useSkin();
  const ui = useUI();
  const navigate = useNavigate();
  // R-task-45 — the page names where you came from, so the lens+period travels with the navigation.
  const from = useLocation().pathname;
  const complete = useCompleteTask();
  const uncheck = useUncheckTask();

  const age = t.carryWeeks;
  const showCarry = !t.done && age >= 1;
  const sev = age >= 2 ? 'chip' : 'gray';

  const toggle = () => {
    if (t.done) {
      // R-task-19 — the task is open again immediately, keeping its original origin, and logs `Unchecked`.
      uncheck.mutate(
        { id: t.id, version: t.version },
        // R-task-21 — only then does the skippable prompt appear.
        { onSuccess: () => ui.openSheet({ kind: 'uncheck', taskId: t.id }) },
      );
    } else {
      // R-task-14 — the completion belongs to the week being VIEWED, not to "now": past weeks stay fully
      // interactive. R-task-44's future bound is the server's, and `completable` is how the row knows.
      complete.mutate({ id: t.id, week, version: t.version });
    }
  };

  const busy = complete.isPending || uncheck.isPending;
  const promptOpen = ui.sheet?.kind === 'uncheck' && ui.sheet.taskId === t.id;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0', borderTop: `1px solid ${S.T.lineSoft}` }}>
        {/*
         * R-task-44 / R-task-35 — a task under a Weekly goal whose week has not arrived renders NO
         * completion checkbox: no week satisfies `originWeek <= week <= currentWeek`. `completable` is on
         * the wire precisely so the client does not re-derive that date rule.
         *
         * The checkbox precedes the title so "tick it" is always the first stop on a row — the fast path
         * for a keyboard user is Tab, Space, Tab, Space down the week (§8.1).
         */}
        {t.completable ? (
          <button
            type="button"
            aria-label={t.done ? `Uncheck ${t.title}` : `Complete ${t.title}`}
            disabled={busy}
            style={{ ...S.checkBox(t.done), opacity: busy ? 0.5 : 1 }}
            onClick={toggle}
          >
            {t.done ? '✓' : ''}
          </button>
        ) : (
          <span aria-hidden="true" style={{ width: 26, minWidth: 26 }} />
        )}
        <button
          type="button"
          // CR-5 / R-task-45 — a task page, with its own URL. Not a drawer, anywhere in the product.
          onClick={() => navigate(taskPath(t.id), { state: { from } })}
          style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, ...(t.done ? { color: S.T.faint, textDecoration: 'line-through' } : { color: S.T.ink }) }}>
            {t.title}
          </div>
          {t.cond && <div style={{ fontSize: 12.5, color: S.T.mut, marginTop: 2 }}>Done when: {t.cond}</div>}
          {t.done && t.doneAt && <div style={{ fontSize: 12, color: S.T.faint, marginTop: 2 }}>Done {instantLabel(t.doneAt)}</div>}
          {showCarry && (
            <div style={{ marginTop: 4 }}>
              <span style={S.carryLabel(sev)}>
                {sev === 'chip' ? `${age} weeks · since ${shortDate(t.originWeekStart)}` : `since ${weekLabel(t.originWeekStart)}`}
              </span>
            </div>
          )}
        </button>
      </div>
      {promptOpen && <UncheckPrompt task={t} />}
    </div>
  );
}

/**
 * R-task-21 — the inline "Update the done-condition?" prompt, pre-filled with the current condition.
 *
 * It is genuinely skippable: `Skip` writes nothing, and `Save` with an unchanged or whitespace-only value
 * writes nothing either (S-task-21-1, S-task-21-3). The uncheck itself already happened, so a real change
 * is a `PATCH /tasks/:id` — which is what logs the one `Done-condition edited` entry, server-side.
 */
function UncheckPrompt({ task }: { task: TaskView }) {
  const S = useSkin();
  const ui = useUI();
  const patch = usePatchTask();
  const [cond, setCond] = useState(task.cond);
  const close = () => ui.closeSheet();

  const save = () => {
    const next = cond.trim();
    if (!next || next === task.cond) return close();
    patch.mutate({ id: task.id, patch: { cond: next, version: task.version } }, { onSuccess: close });
  };

  return (
    <div style={{ background: S.T.cardSoft, border: `1px solid ${S.T.line}`, borderRadius: 12, padding: 12, margin: '0 0 10px 38px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 7, color: S.T.ink }}>Update the done-condition?</div>
      <input
        aria-label="Done-condition"
        value={cond}
        onChange={(e) => setCond(e.target.value)}
        style={{ ...S.input, minHeight: 44, borderRadius: 10, fontSize: 14 }}
      />
      <FieldError>{commandError(patch.error)}</FieldError>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" style={{ ...S.smallDarkBtn, marginTop: 0 }} disabled={patch.isPending} onClick={save}>
          Save
        </button>
        <button type="button" style={S.menuBtn} onClick={close}>
          Skip
        </button>
      </div>
    </div>
  );
}
