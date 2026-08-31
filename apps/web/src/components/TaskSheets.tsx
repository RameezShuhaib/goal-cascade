import { useState } from 'react';
import { useUI } from '../context/UIContext';
import {
  useAddTaskLink,
  useCancelTask,
  useGoals,
  useMoveTaskToBacklog,
  usePatchTask,
  useRemoveTaskLink,
  useTask,
} from '../api/queries';
import { useSkin } from '../skin';
import { Sheet, SheetGrip } from './Sheet';
import { FieldError, Loading, LoadError, commandError } from './states';
import { instantLabel } from '../utils/dates';
import { hostOf, node, pathOf } from '../utils/tree';

/**
 * R-task-22 — the task detail sheet: goal path, done date, editable title/cond/description, the links list,
 * the two exits while open, and the read-only activity timeline.
 *
 * The timeline is the server's, whole (R-task-30/31): `text` and `glyph` are rendered when the event is
 * APPENDED, so a line reads the same forever even if the copy changes later. The mockup built those
 * strings in the browser and pushed them onto a local array, which is why its `Moved to Backlog` and
 * `Canceled` entries could never exist — it deleted the row they belonged to (D-15).
 */
export function TaskDetailSheet({ taskId }: { taskId: string }) {
  const S = useSkin();
  const ui = useUI();
  const taskQ = useTask(taskId, ui.viewedWeek);
  const goalsQ = useGoals(ui.viewedWeek);
  const patch = usePatchTask();
  const addLink = useAddTaskLink();
  const removeLink = useRemoveTaskLink();

  const task = taskQ.data?.task;
  const [draft, setDraft] = useState<{ title: string; cond: string; description: string } | null>(null);
  const [link, setLink] = useState('');

  const close = () => ui.closeSheet();

  if (taskQ.isPending || !task) {
    return (
      <Sheet label="Task detail" onClose={close}>
        <SheetGrip />
        {taskQ.error ? <LoadError error={taskQ.error} what="this task" onRetry={() => void taskQ.refetch()} /> : <Loading />}
      </Sheet>
    );
  }

  const fields = draft ?? { title: task.title, cond: task.cond, description: task.description };
  const set = (p: Partial<typeof fields>) => setDraft({ ...fields, ...p });
  const dirty = fields.title.trim() !== task.title || fields.cond.trim() !== task.cond || fields.description.trim() !== task.description;
  const goal = node(goalsQ.data?.goals ?? [], task.goalId);

  const save = () => {
    // R-task-23 — send only what changed; a blank title falls back to the existing one and logs nothing.
    // The three "which field changed" event strings are the server's now: `renamed`, `cond_edited`,
    // `description_updated` are appended by the operation, never composed here.
    const body: { title?: string; cond?: string; description?: string; version?: number } = { version: task.version };
    if (fields.title.trim() && fields.title.trim() !== task.title) body.title = fields.title.trim();
    if (fields.cond.trim() !== task.cond) body.cond = fields.cond.trim();
    if (fields.description.trim() !== task.description) body.description = fields.description.trim();
    patch.mutate(
      { id: task.id, patch: body },
      {
        onSuccess: () => {
          setDraft(null);
          ui.showToast('Task updated');
        },
      },
    );
  };

  return (
    <Sheet label="Task detail" onClose={close}>
      <SheetGrip />
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: S.T.mut }}>
        {goal ? pathOf(goalsQ.data?.goals ?? [], goal).join(' › ') : ''}
      </div>
      {task.done && task.doneAt && <div style={{ fontSize: 12.5, color: S.T.faint, marginTop: 2 }}>Done {instantLabel(task.doneAt)}</div>}

      <div style={{ ...S.fieldLabel, margin: '12px 0 5px 0' }}>TITLE</div>
      <input aria-label="Title" value={fields.title} onChange={(e) => set({ title: e.target.value })} style={{ ...S.input, minHeight: 46, fontWeight: 600 }} />
      <div style={{ ...S.fieldLabel, margin: '14px 0 5px 0' }}>DONE-CONDITION</div>
      <input
        aria-label="Done-condition"
        value={fields.cond}
        onChange={(e) => set({ cond: e.target.value })}
        placeholder="How will you know it's done?"
        style={{ ...S.input, minHeight: 46, fontSize: 14.5 }}
      />
      <div style={{ ...S.fieldLabel, margin: '14px 0 5px 0' }}>DESCRIPTION</div>
      <textarea
        aria-label="Description"
        value={fields.description}
        onChange={(e) => set({ description: e.target.value })}
        rows={2}
        placeholder="Optional notes…"
        style={S.textarea}
      />
      <FieldError>{commandError(patch.error)}</FieldError>
      {dirty && (
        <button type="button" style={S.smallDarkBtn} disabled={patch.isPending} onClick={save}>
          Save changes
        </button>
      )}

      <div style={{ ...S.fieldLabel, margin: '14px 0 5px 0' }}>LINKS</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {task.links.map((l) => (
          <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: S.T.paper, borderRadius: 10, padding: '6px 6px 6px 12px' }}>
            <a
              href={l.url}
              target="_blank"
              rel="noreferrer"
              style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: S.T.accentLink }}
            >
              {hostOf(l.url)}
            </a>
            <button
              type="button"
              aria-label={`Remove link ${hostOf(l.url)}`}
              // D-13 — by link ID. The mockup removed by array index, which deletes the wrong row the moment
              // the list has changed underneath, and logged nothing at all.
              onClick={() => removeLink.mutate({ id: task.id, linkId: l.id })}
              style={{ minWidth: 36, minHeight: 36, border: 'none', background: 'none', color: S.T.faint, fontSize: 15, cursor: 'pointer' }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <input
          aria-label="Link URL"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://…"
          style={{ ...S.input, flex: 1, minHeight: 44, borderRadius: 10, fontSize: 13.5 }}
        />
        <button
          type="button"
          style={S.menuBtn}
          disabled={addLink.isPending}
          // Was a silent `return` on a blank or unparseable URL. Now the shared `Url` schema refuses
          // anything that is not http(s), over 2048 chars, or past `MAX_LINKS` — with a message, at the field.
          onClick={() => addLink.mutate({ id: task.id, url: link.trim() }, { onSuccess: () => setLink('') })}
        >
          Add
        </button>
      </div>
      <FieldError>{commandError(addLink.error) ?? commandError(removeLink.error)}</FieldError>

      {/* R-task-17 — the exits are withdrawn once a task is done or has already left the board. */}
      {task.status === 'open' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          <button type="button" style={S.menuBtn} onClick={() => ui.openSheet({ kind: 'confirmTaskExit', taskId: task.id, exit: 'backlog' })}>
            Move to Backlog
          </button>
          <button type="button" style={S.dangerBtn} onClick={() => ui.openSheet({ kind: 'confirmTaskExit', taskId: task.id, exit: 'cancel' })}>
            Cancel task
          </button>
        </div>
      )}

      <div style={{ ...S.fieldLabel, margin: '18px 0 8px 0' }}>ACTIVITY</div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {task.events.map((e) => (
          <div key={e.id} style={{ display: 'flex', gap: 10, padding: '7px 0', borderTop: `1px solid ${S.T.lineSoft}` }}>
            <div
              style={{
                minWidth: 22,
                height: 22,
                borderRadius: '50%',
                background: S.T.lineSoft,
                color: S.T.mut,
                fontSize: 11,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {e.glyph}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, color: S.quote }}>{e.text}</div>
              <div style={{ fontSize: 11.5, color: S.T.faint, marginTop: 1 }}>{instantLabel(e.at)}</div>
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

/**
 * R-task-15/16/18 — exits 2 and 3, both with an OPTIONAL reason. "No mandatory fields. Fast and
 * guilt-free" is not decoration: it is the rule (R-nav-14 removed the mandatory-reason push flow), and the
 * confirm button must never depend on the field.
 *
 * Neither exit deletes anything (D-15 / R-task-32). The task keeps its row with a terminal `status`, its
 * `exitReason` and its final timeline entry; it simply appears in no week and no count from then on.
 */
export function ConfirmTaskExitSheet({ taskId, exit }: { taskId: string; exit: 'backlog' | 'cancel' }) {
  const S = useSkin();
  const ui = useUI();
  const taskQ = useTask(taskId, ui.viewedWeek);
  const goalsQ = useGoals(ui.viewedWeek);
  const moveToBacklog = useMoveTaskToBacklog();
  const cancel = useCancelTask();
  const [reason, setReason] = useState('');

  const task = taskQ.data?.task;
  const close = () => ui.closeSheet();
  const busy = moveToBacklog.isPending || cancel.isPending;

  const confirm = () => {
    if (!task) return;
    const trimmed = reason.trim();
    if (exit === 'backlog') {
      moveToBacklog.mutate(
        // D-12 — `fromWeekStart` is the week the task was LIVE in, which is the week being viewed, not
        // "this week". The mockup hardcoded the current week and stored it as a display string.
        { id: task.id, week: ui.viewedWeek, ...(trimmed ? { reason: trimmed } : {}), version: task.version },
        {
          onSuccess: () => {
            close();
            ui.showToast('Moved to Backlog' + (trimmed ? ' — reason noted' : ''));
          },
        },
      );
    } else {
      cancel.mutate(
        { id: task.id, ...(trimmed ? { reason: trimmed } : {}), version: task.version },
        {
          onSuccess: () => {
            close();
            ui.showToast('Task canceled');
          },
        },
      );
    }
  };

  const owner = task ? node(goalsQ.data?.goals ?? [], task.goalId) : undefined;
  const title = exit === 'backlog' ? 'Move to Backlog' : 'Cancel task';

  return (
    <Sheet label="Confirm" onClose={close}>
      <div style={{ fontSize: 16, fontWeight: 800, color: S.T.ink }}>{title}</div>
      <div style={{ fontSize: 14, color: S.body, margin: '6px 0 14px 0' }}>
        {task ? `“${task.title}” → ${exit === 'backlog' ? `${owner?.title ?? 'its goal'}’s backlog` : 'dropped'}` : '…'}
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
 * R-backlog-8 — the sheet, not a toast.
 *
 * It is the answer to "Add to this week" on an item whose branch has no weekly focus, and to "Task this
 * week" on an idea when no leaf is active at all (S-idea-4-3). Both offer the same two ways out, and
 * neither touches the item: `BRANCH_NOT_ACTIVE` is `quiet` in `useCommand` precisely so this explains it.
 */
export function InactiveBranchSheet({ title }: { title: string }) {
  const S = useSkin();
  const ui = useUI();
  return (
    <Sheet label="Branch not active" onClose={() => ui.closeSheet()}>
      <div style={{ fontSize: 16, fontWeight: 800, color: S.T.ink }}>This branch isn&apos;t active this week</div>
      <div style={{ fontSize: 13.5, color: S.T.mut, margin: '4px 0 16px 0' }}>
        &quot;{title}&quot; can only become a task under an active weekly focus.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          type="button"
          style={{ minHeight: 46, border: 'none', borderRadius: 12, background: S.T.ink, color: S.onInk, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
          onClick={() => {
            ui.closeSheet();
            ui.setScreen('plan');
          }}
        >
          Set a weekly focus
        </button>
        <button
          type="button"
          style={{ minHeight: 46, border: `1px solid ${S.T.border}`, borderRadius: 12, background: S.T.card, fontSize: 14, fontWeight: 700, color: S.T.ink, cursor: 'pointer', fontFamily: 'inherit' }}
          onClick={() => ui.closeSheet()}
        >
          Cancel
        </button>
      </div>
    </Sheet>
  );
}
