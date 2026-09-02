import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useUI } from '../context/UIContext';
import { useCancelTask, useGoal, useMoveTaskToBacklog, useTask } from '../api/queries';
import { useSkin } from '../skin';
import { Sheet } from './Sheet';
import { FieldError, commandError } from './states';
import { lensPath } from '../routes';

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
    navigate(lensPath('Weekly', task?.originPeriodKey));
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

  // R-backlog-29 — the item lands ABOVE the week, on the nearest non-Weekly ancestor. Naming it here is
  // what stops "move to backlog" reading as a no-op wearing an exit's clothes.
  const lands = [...(goalQ.data?.ancestors ?? [])].reverse().find((a) => a.horizon !== 'Weekly' && a.horizon !== 'Life');
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
