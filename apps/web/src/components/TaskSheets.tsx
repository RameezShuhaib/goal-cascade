import { useNavigate } from 'react-router';
import { useUI } from '../context/UIContext';
import { useEffect, useState } from 'react';
import { labelOf, taskWeeksInMonth } from '@goal-cascade/shared';
import { useCancelTask, useGoal, useMoveTaskToBacklog, useRetargetTask, useTask } from '../api/queries';
import { useSkin } from '../skin';
import { Sheet } from './Sheet';
import { FieldError, commandError } from './states';
import { lensPath, lensPathForScope } from '../routes';
import { useGoalPicker } from './GoalPicker';
import { ChipRadioGroup } from './ChipRadioGroup';
import { useWeekClock } from '../lib/weekClock';
import { shortDate, weekOfLabel } from '../utils/dates';
import { implicitWeeklyGoalNote, PARK_IT, PARK_IN_A_WEEK, parkedToast, taskDestinationNote, WHEN_THIS_LANDS } from '../lens/copy';

/**
 * R-task-15/16/18 — exits 2 and 3, both with an OPTIONAL reason. "No mandatory fields. Fast and
 * guilt-free" is not decoration: it is the rule (R-nav-14), and the confirm button must never depend on
 * the field.
 *
 * Neither exit deletes anything (D-15 / R-task-32). The task keeps its row with a terminal `status`, its
 * `exitReason` and its final timeline entry; it simply appears in no week and no count from then on —
 * which is the only way the `Moved to Backlog` / `Canceled` entries can exist at all.
 *
 * ⚠ **A2 (R-backlog-29)** — the item no longer lands on the task's own goal. That goal is a **Weekly**
 * goal now, which may hold no backlog items (R-backlog-2): "move to backlog" means *not this week*, so the
 * item must leave the week, and a Weekly goal **is** a week. It lands on the nearest non-Weekly ancestor,
 * normally the Monthly parent — and where the only ancestor is a Life goal there is no legal target, so
 * the exit is refused with `LIFE_GOAL_NO_BACKLOG` and this sheet says so. Cancel stays available.
 *
 * ⚠ **the task page is where these are raised from** (R-task-45): `TaskDetailSheet` is deleted, not moved.
 * Task detail is a route, and no sheet in this product shows it.
 */
export function ConfirmTaskExitSheet({ taskId, exit, week }: { taskId: string; exit: 'backlog' | 'cancel'; week: number }) {
  const S = useSkin();
  const ui = useUI();
  const navigate = useNavigate();
  const taskQ = useTask(taskId, week);
  const task = taskQ.data?.task;
  const goalQ = useGoal(task?.goalId);
  const moveToBacklog = useMoveTaskToBacklog();
  const cancel = useCancelTask();
  const [reason, setReason] = useState('');

  const close = () => ui.closeSheet();
  const busy = moveToBacklog.isPending || cancel.isPending;

  /** Both exits return to the lens on success: the page they were raised from is about a task that left. */
  const done = (message: string) => {
    close();
    ui.showToast(message);
    // ⚠ **A8 (R-task-52)** — back to the lens the task was IN, which for a month task is the Monthly
    // one. `lensPath('Weekly', <a month key>)` produced a path that lens drops.
    navigate(task ? lensPathForScope(task.scope, task.originPeriodKey) : lensPath('Weekly'));
  };

  const confirm = () => {
    if (!task) return;
    const trimmed = reason.trim();
    if (exit === 'backlog') {
      moveToBacklog.mutate(
        // D-12 — `fromPeriodKey` is the week the task was LIVE in, which is the week being viewed.
        { id: task.id, week, ...(trimmed ? { reason: trimmed } : {}), version: task.version },
        { onSuccess: () => done('Moved to Backlog' + (trimmed ? ' — reason noted' : '')) },
      );
    } else {
      cancel.mutate({ id: task.id, ...(trimmed ? { reason: trimmed } : {}), version: task.version }, { onSuccess: () => done('Task canceled') });
    }
  };

  /**
   * R-backlog-29 — the item lands ABOVE the week, on the nearest non-Weekly ancestor. Naming it here is
   * what stops "move to backlog" reading as a no-op wearing an exit's clothes.
   *
   * ⚠ **A8 (R-task-59) — for a MONTH task the walk terminates immediately, on the task's own goal.** The
   * nearest goal that can hold a backlog item is the Monthly goal the task is already on (R-backlog-30),
   * so the ancestor walk would name a *grandparent* while the write landed on the parent — the sheet
   * saying one thing and the server doing another. **Not one string changes**; only which goal it names.
   */
  const lands =
    task?.scope === 'Monthly'
      ? goalQ.data?.goal
      : [...(goalQ.data?.ancestors ?? [])].reverse().find((a) => a.horizon !== 'Weekly' && a.horizon !== 'Life');
  const title = exit === 'backlog' ? 'Move to Backlog' : 'Cancel task';

  return (
    <Sheet label={title} onClose={close}>
      <div style={{ fontSize: 14, color: S.body, margin: '0 0 14px 0' }}>
        {task ? `“${task.title}” → ${exit === 'backlog' ? `${lands?.title ?? 'the backlog'}${lands ? '’s backlog' : ''}` : 'dropped'}` : '…'}
      </div>
      <input aria-label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? (optional)" style={S.input} />
      <div style={{ fontSize: 12.5, color: S.T.mut, marginTop: 5 }}>No mandatory fields. Fast and guilt-free.</div>
      <FieldError>{commandError(moveToBacklog.error) ?? commandError(cancel.error)}</FieldError>
      <button type="button" style={S.saveBtn(busy || !task)} disabled={busy || !task} onClick={confirm}>
        {exit === 'backlog' ? 'Move it' : 'Cancel it'}
      </button>
    </Sheet>
  );
}

/**
 * ⚠ **A8, new (R-task-56) — `Park in a week`.** The ONE new sheet this amendment adds.
 *
 * It asks the identical question `+ Task` from a Monthly goal asks — *which of this month's weeks* — with
 * the identical option list, the identical bound and the identical goal resolution beneath it, so it
 * **renders the same `ChipRadioGroup` and the same `weeklyTarget` picker, not a second copy of either**
 * (`32-week-selection` §5.4, addressed to this build agent by name). Two callers is what earns that
 * control its name: built once for one sheet it is a widget; built for two it is the product's answer to
 * *"which week"*.
 *
 * **The month is NOT an option here.** The task is already in its month, and retargeting to the period it
 * is already in is a no-op (R-task-56).
 *
 * **Parking is not an exit.** The task stays open, keeps its title, its condition, its description, its
 * links, its whole timeline and **every reading** (R-measure-5); only the goal and the period move. It is
 * a logged, reversible write, and the way back is one tap on the task page with no sheet at all — because
 * there is nothing to choose on the way back. That asymmetry is inherent to the operation.
 */
export function RetargetTaskSheet({ taskId }: { taskId: string }) {
  const S = useSkin();
  const ui = useUI();
  const clock = useWeekClock();
  const taskQ = useTask(taskId);
  const task = taskQ.data?.task;
  const retarget = useRetargetTask();

  const weeks = task ? taskWeeksInMonth(task.originPeriodKey, clock.today) : [];
  const [week, setWeek] = useState<string | null>(null);
  const chosen = week ?? weeks[0] ?? null;
  const [picked, setPicked] = useState<string | null>(null);

  /** R-nav-31 — the existing `weeklyTarget` mode, under the task's OWN Monthly goal. No fifth mode. */
  const weeklyPicker = useGoalPicker({
    mode: { kind: 'weeklyTarget', parentId: task?.goalId ?? '', weekStart: chosen ?? undefined },
    value: picked,
    onChange: setPicked,
    from: PARK_IN_A_WEEK,
    listLabel: 'Weekly goals in the target week',
  });
  const choices = weeklyPicker.options;

  useEffect(() => {
    if (picked === null && choices.length > 0) setPicked(choices[0]!.id);
  }, [picked, choices]);

  const close = () => ui.closeSheet();
  const resolved = picked ?? choices[0]?.id ?? null;
  const blocked = !task || !chosen || retarget.isPending;

  const park = () => {
    if (!task || !chosen) return;
    retarget.mutate(
      {
        id: task.id,
        period: chosen,
        ...(resolved ? { goalId: resolved } : { newWeeklyGoal: { parentId: task.goalId, title: task.title } }),
        version: task.version,
      },
      {
        onSuccess: () => {
          close();
          ui.showToast(parkedToast(shortDate(chosen)));
        },
      },
    );
  };

  return (
    <Sheet label={weeklyPicker.taken ? weeklyPicker.heading : PARK_IN_A_WEEK} headerRight={weeklyPicker.headerRight} onClose={close}>
      {weeklyPicker.taken ? (
        weeklyPicker.panel
      ) : (
        <>
          <div style={{ fontSize: 14, color: S.body, margin: '0 0 14px 0' }}>{task ? `“${task.title}”` : '…'}</div>
          <div style={{ ...S.fieldLabel, marginBottom: 6 }}>WHERE THIS GOES</div>
          {weeks.length > 1 && chosen && (
            <ChipRadioGroup
              label={WHEN_THIS_LANDS}
              options={weeks.map((w) => ({ value: w, label: shortDate(w), name: weekOfLabel(w) }))}
              value={chosen}
              onChange={(v) => {
                setWeek(v);
                setPicked(null);
              }}
              style={{ marginBottom: 10 }}
            />
          )}
          {chosen &&
            (choices.length > 0 ? (
              weeklyPicker.control
            ) : (
              /* R-task-48's inline create, which is one of the three flows that still names a WEEK. */
              <div style={{ fontSize: 13, color: S.body, background: S.T.paper, border: `1px solid ${S.T.line}`, borderRadius: 12, padding: '10px 12px' }}>
                {implicitWeeklyGoalNote(task?.title ?? '', shortDate(chosen))}
              </div>
            ))}
          {chosen && (
            <div style={{ fontSize: 12.5, color: S.T.mut, marginTop: 8 }}>
              {taskDestinationNote(shortDate(chosen), labelOf('Monthly', task?.originPeriodKey ?? ''))}
            </div>
          )}
          <FieldError>{commandError(retarget.error)}</FieldError>
          <button type="button" style={S.saveBtn(blocked)} disabled={blocked} onClick={park}>
            {PARK_IT}
          </button>
        </>
      )}
    </Sheet>
  );
}
