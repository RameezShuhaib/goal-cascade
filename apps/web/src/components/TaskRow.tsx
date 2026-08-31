import { useState } from 'react';
import type { TaskView } from '@goal-cascade/shared';
import { useUI } from '../context/UIContext';
import { useCompleteTask, usePatchTask, useUncheckTask } from '../api/queries';
import { useSkin } from '../skin';
import { instantLabel, shortDate, weekLabel } from '../utils/dates';
import { FieldError, commandError } from './states';

/**
 * One task row: the checkbox, the body, the carry label, and the skippable uncheck follow-up.
 *
 * Nothing here is computed. `done`, `carryWeeks` and `originWeekStart` are the server's, for the week this
 * list was built for — the mockup derived the age from `viewedWeek - originWeek` over relative offsets,
 * which is D-1's decay bug in miniature: the same stored row meant something different every Monday.
 */
export function TaskRow({ t }: { t: TaskView }) {
  const S = useSkin();
  const ui = useUI();
  const complete = useCompleteTask();
  const uncheck = useUncheckTask();

  // R-task-10/11/12 — no label at age 0 or on a done task; gray at 1; the red chip at 2+, which is the
  // only escalation in this product. No popup, no nag, no flag.
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
      // interactive, and a week before origin or in the future is refused with `WEEK_OUT_OF_RANGE`.
      complete.mutate({ id: t.id, week: ui.viewedWeek, version: t.version });
    }
  };

  const busy = complete.isPending || uncheck.isPending;
  const promptOpen = ui.sheet?.kind === 'uncheck' && ui.sheet.taskId === t.id;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0', borderTop: `1px solid ${S.T.lineSoft}` }}>
        <button
          type="button"
          aria-label={t.done ? `Uncheck ${t.title}` : `Complete ${t.title}`}
          disabled={busy}
          style={{ ...S.checkBox(t.done), opacity: busy ? 0.5 : 1 }}
          onClick={toggle}
        >
          {t.done ? '✓' : ''}
        </button>
        <button
          type="button"
          onClick={() => ui.openSheet({ kind: 'taskDetail', taskId: t.id })}
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
 * is a `PATCH /tasks/:id` — which is what logs the one `Done-condition edited` entry, server-side, with
 * both values truncated per R-task-27. The mockup built that string in the browser.
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
