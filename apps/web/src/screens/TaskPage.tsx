import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useUI } from '../context/UIContext';
import { useAddTaskLink, useCompleteTask, useGoal, usePatchTask, useRemoveTaskLink, useTask, useUncheckTask } from '../api/queries';
import { useWeekClock } from '../lib/weekClock';
import { useSkin } from '../skin';
import { TopActions } from '../components/TopActions';
import { FieldError, Loading, LoadError, commandError } from '../components/states';
import { instantLabel, shortDate, weekLabel } from '../utils/dates';
import { goalPath, lensPath } from '../routes';
import { hostOf } from '../utils/tree';

/**
 * R-task-45 / CR-5 — **the task page.** A full screen with its own URL, not a drawer.
 *
 * The walkthrough's own finding is what put the checkbox here (R-task-50): *"a user who opened the detail
 * to finish a task has to back out first."* It is **exit 1 given a second home**, not a fourth exit —
 * R-task-13's "exactly three" is unchanged — and completing here returns to the lens with the toast,
 * because the reason the page was opened is now finished.
 *
 * **Getting back**: three ways, all equivalent and all landing in the same place — the control top-left,
 * which *names where you came from* rather than saying "Back"; browser/Android back; and `Escape`.
 *
 * Opened **cold by URL** it falls back to the Weekly lens at the task's own `originWeek`, never at the
 * current week: landing somewhere the task is not visible would read as a broken link (R-task-45).
 */
export function TaskPage() {
  const S = useSkin();
  const ui = useUI();
  const navigate = useNavigate();
  const location = useLocation();
  const { taskId = '' } = useParams();
  const clock = useWeekClock();

  const from = typeof (location.state as { from?: unknown } | null)?.from === 'string' ? (location.state as { from: string }).from : null;
  const fromWeek = mondayInPath(from);
  const week = clock.offsetOf(fromWeek);

  const taskQ = useTask(taskId, week);
  const task = taskQ.data?.task;
  // R-task-45's context line needs the Weekly goal's title and its Life root; `GET /goals/:id` carries
  // both (`goal`, `ancestors`) in one request — the ancestry a task lost by leaving the tree, in one line.
  const goalQ = useGoal(task?.goalId);

  const patch = usePatchTask();
  const complete = useCompleteTask();
  const uncheck = useUncheckTask();
  const addLink = useAddTaskLink();
  const removeLink = useRemoveTaskLink();

  const [draft, setDraft] = useState<{ title: string; cond: string; description: string } | null>(null);
  const [link, setLink] = useState('');
  const [confirming, setConfirming] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

  // §8.2 — the route change moves focus to the page's `<h1>`, so the title is announced without a live
  // region. `tabindex="-1"` with `outline: none`, the precedent `S.sheetTitle` already sets.
  useEffect(() => {
    if (task) headingRef.current?.focus();
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const backTo = from ?? lensPath('Weekly', task?.originWeekStart);
  const backLabel = task ? `Week of ${weekLabel(fromWeek ?? task.originWeekStart)}` : 'Back';

  const fields = draft ?? { title: task?.title ?? '', cond: task?.cond ?? '', description: task?.description ?? '' };
  const dirty =
    !!task &&
    (fields.title.trim() !== task.title || fields.cond.trim() !== task.cond || fields.description.trim() !== task.description);

  /**
   * A page you can navigate away from is the same hazard as a sheet you can dismiss, so it raises the
   * same strip (`Discard your unsaved edits?` / `[Discard] [Keep editing]`) — and, like the sheet, it is
   * never a dead end: ask once, then out. A trap is worse than a lost draft.
   */
  const leave = useCallback(() => navigate(backTo), [navigate, backTo]);
  const requestLeave = useCallback(() => {
    if (dirty && !confirming) {
      setConfirming(true);
      return;
    }
    leave();
  }, [dirty, confirming, leave]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Held down, Escape auto-repeats; a repeat may raise the strip but may never be the press that
      // discards — the same guard `Sheet` carries, for the same reason.
      if (e.repeat && confirming) return;
      e.preventDefault();
      requestLeave();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [confirming, requestLeave]);

  useEffect(() => {
    if (confirming) keepRef.current?.focus();
  }, [confirming]);

  if (taskQ.isPending) return <Loading label="Loading this task…" />;
  if (taskQ.error || !task) {
    return (
      <div style={S.page}>
        <LoadError error={taskQ.error} what="this task" onRetry={() => void taskQ.refetch()} />
      </div>
    );
  }

  const set = (p: Partial<typeof fields>) => setDraft({ ...fields, ...p });
  const lifeRoot = goalQ.data?.ancestors[0];
  const weeklyGoal = goalQ.data?.goal;
  const age = task.carryWeeks;

  const save = () => {
    // R-task-23 — send only what changed; a blank title falls back to the existing one and logs nothing.
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

  const toggle = () => {
    if (task.done) {
      uncheck.mutate({ id: task.id, version: task.version });
      return;
    }
    // R-task-50 — completing here returns to the lens with the toast, because the reason the page was
    // opened is now done.
    complete.mutate(
      { id: task.id, week, version: task.version },
      {
        onSuccess: () => {
          ui.showToast('Done');
          leave();
        },
      },
    );
  };

  return (
    <div style={S.page} data-screen-label="Task page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <button
          type="button"
          onClick={requestLeave}
          style={{ minHeight: 44, border: 'none', background: 'none', padding: '0 2px', fontSize: 13.5, fontWeight: 700, color: S.T.mut, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          ‹ {backLabel}
        </button>
        {/* R-nav-25 — the task page carries the cluster, which goal detail used to omit. */}
        <TopActions />
      </div>

      {confirming && (
        <div style={S.discardBar}>
          <span style={{ flex: 1, minWidth: 140 }}>Discard your unsaved edits?</span>
          <button type="button" style={{ ...S.btn(false), minHeight: 36 }} onClick={leave}>
            Discard
          </button>
          <button type="button" ref={keepRef} style={{ ...S.btn(true), minHeight: 36 }} onClick={() => setConfirming(false)}>
            Keep editing
          </button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginTop: 8 }}>
        {/* R-task-44/R-task-50 — no checkbox on a task whose week has not arrived; the bound is the same one. */}
        {task.completable && (
          <button
            type="button"
            aria-label={task.done ? `Uncheck ${task.title}` : `Complete ${task.title}`}
            disabled={complete.isPending || uncheck.isPending}
            style={S.checkBox(task.done)}
            onClick={toggle}
          >
            {task.done ? '✓' : ''}
          </button>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 ref={headingRef} tabIndex={-1} style={{ margin: 0, fontSize: 21, fontWeight: 800, letterSpacing: '-0.01em', color: S.T.ink, outline: 'none' }}>
            {task.title}
          </h1>
          {/* R-task-45 — the context line: the Life goal and the Weekly goal, both tappable. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginTop: 2 }}>
            {lifeRoot && (
              <button type="button" style={{ ...S.linkBtn, minHeight: 32, color: S.T.mut, fontWeight: 600, fontSize: 12.5 }} onClick={() => navigate(goalPath(lifeRoot.id))}>
                {lifeRoot.title}
              </button>
            )}
            {lifeRoot && weeklyGoal && <span style={{ color: S.T.mut, fontSize: 12.5 }}>·</span>}
            {weeklyGoal && (
              <button
                type="button"
                style={{ ...S.linkBtn, minHeight: 32, color: S.T.mut, fontWeight: 600, fontSize: 12.5 }}
                onClick={() => navigate(lensPath('Weekly', weeklyGoal.periodKey))}
              >
                {weeklyGoal.title}
              </button>
            )}
          </div>
          {/* R-task-43 — signed. `<= 0` is work that is not due yet and renders nothing at all. */}
          {!task.done && age >= 1 && (
            <div style={{ marginTop: 4 }}>
              <span style={S.carryLabel(age >= 2 ? 'chip' : 'gray')}>
                {age >= 2 ? `${age} weeks · since ${shortDate(task.originWeekStart)}` : `since ${weekLabel(task.originWeekStart)}`}
              </span>
            </div>
          )}
          {task.done && task.doneAt && <div style={{ fontSize: 12.5, color: S.T.faint, marginTop: 2 }}>Done {instantLabel(task.doneAt)}</div>}
        </div>
      </div>

      <div style={{ ...S.fieldLabel, margin: '18px 0 5px 0' }}>TITLE</div>
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

      <div style={{ ...S.fieldLabel, margin: '18px 0 5px 0' }}>LINKS</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {task.links.map((l) => (
          <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: S.T.card, borderRadius: 10, padding: '6px 6px 6px 12px' }}>
            <a
              href={l.url}
              target="_blank"
              rel="noreferrer"
              style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: S.T.accentLink }}
            >
              {hostOf(l.url)}
            </a>
            {/* D-13 — by link ID, never by list index. */}
            <button
              type="button"
              aria-label={`Remove link ${hostOf(l.url)}`}
              onClick={() => removeLink.mutate({ id: task.id, linkId: l.id })}
              style={{ minWidth: 36, minHeight: 36, border: 'none', background: 'none', color: S.T.mut, fontSize: 15, cursor: 'pointer' }}
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
        {/* `aria-label`, because the tab bar's `+` is already named `Add` (R-nav-23) and two controls
            with one accessible name is a control you cannot ask for. The visible word is unchanged. */}
        <button
          type="button"
          aria-label="Add link"
          style={S.menuBtn}
          disabled={addLink.isPending}
          onClick={() => addLink.mutate({ id: task.id, url: link.trim() }, { onSuccess: () => setLink('') })}
        >
          Add
        </button>
      </div>
      <FieldError>{commandError(addLink.error) ?? commandError(removeLink.error)}</FieldError>

      {/* R-task-17 — the other two exits are withdrawn once the task is done or has already left. */}
      {task.status === 'open' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          <button type="button" style={S.menuBtn} onClick={() => ui.openSheet({ kind: 'confirmTaskExit', taskId: task.id, exit: 'backlog', week })}>
            Move to Backlog
          </button>
          <button type="button" style={S.dangerBtn} onClick={() => ui.openSheet({ kind: 'confirmTaskExit', taskId: task.id, exit: 'cancel', week })}>
            Cancel task
          </button>
        </div>
      )}

      {/* R-task-20..28 — read-only, newest first. `text` and `glyph` are the server's, rendered when the
          event was APPENDED, so a line reads the same forever even if the copy changes later. */}
      <div style={{ ...S.fieldLabel, margin: '22px 0 8px 0' }}>ACTIVITY</div>
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
              <div style={{ fontSize: 11.5, color: S.T.mut, marginTop: 1 }}>{instantLabel(e.at)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** `/week/2026-08-31` → `2026-08-31`. The absolute Monday the page was opened from (D-1), or null. */
function mondayInPath(path: string | null): string | null {
  const m = path ? /^\/week\/(\d{4}-\d{2}-\d{2})$/.exec(path) : null;
  return m ? m[1]! : null;
}
