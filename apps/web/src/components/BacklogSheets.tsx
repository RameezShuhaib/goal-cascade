import { useState } from 'react';
import type { GoalView } from '@goal-cascade/shared';
import { useUI } from '../context/UIContext';
import { useBacklog, useCreateBacklogItem, useCreateTask, useConvertBacklogItem, useGoals } from '../api/queries';
import { toApiError } from '../api/errors';
import { useSkin } from '../skin';
import { Sheet } from './Sheet';
import { FieldError, commandError } from './states';
import { activeLeavesUnder, hostOf, node, nonLifeGoals, rootOf } from '../utils/tree';

/**
 * The `+` drawer and the task-create sheet — the two places work enters this app.
 *
 * Neither mints an id. Q-8 makes every id a server-side ULID and the request schemas are `.strict()`, so
 * a client-supplied `id` is a validation failure rather than something quietly ignored. The mockup used
 * `'t' + Date.now()`, which collides within a millisecond and is guessable; anything it keyed on that id
 * was keyed on a fiction until a refetch replaced it.
 */

/**
 * R-backlog-14 — the drawer's goal defaults to the last one used. It is remembered for this page load
 * only, and validated against the tree before it is used: D-10's whole point is that the mockup shipped
 * `blGoal = 'g3'`, a fixture id that against a real account belongs to nothing (or to something else).
 */
let lastUsedGoalId: string | null = null;

export function BacklogDrawer({ goalId: initialGoalId }: { goalId?: string }) {
  const S = useSkin();
  const ui = useUI();
  const goalsQ = useGoals(0);
  const createItem = useCreateBacklogItem();
  const createTask = useCreateTask();

  const goals = goalsQ.data?.goals ?? [];
  const targets = nonLifeGoals(goals);
  const remembered = lastUsedGoalId && targets.some((g) => g.id === lastUsedGoalId) ? lastUsedGoalId : null;
  const [goalId, setGoalId] = useState<string | null>(
    (initialGoalId && targets.some((g) => g.id === initialGoalId) ? initialGoalId : null) ?? remembered ?? targets[0]?.id ?? null,
  );
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [linkDraft, setLinkDraft] = useState('');
  const [links, setLinks] = useState<string[]>([]);
  const [toWeek, setToWeek] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);

  const candidates = goalId ? activeLeavesUnder(goals, goalId) : [];
  const chosenFocus = candidates.length === 1 ? candidates[0]!.id : focusId && candidates.some((c) => c.id === focusId) ? focusId : null;
  const close = () => ui.closeSheet();

  const pickGoal = (id: string) => {
    setGoalId(id);
    setFocusId(null);
    lastUsedGoalId = id;
  };

  /**
   * R-backlog-15 / D-21 — exactly ONE entity, ever. With an active leaf under the chosen goal the box
   * creates a task and no backlog item; with none it creates a backlog item and says why. The mockup's
   * label promised "also", which would have been a data bug for the first person who went looking in the
   * backlog for something that was never put there.
   */
  const save = () => {
    if (!goalId || !title.trim()) return;
    if (toWeek && chosenFocus) {
      createTask.mutate(
        { goalId: chosenFocus, title: title.trim(), cond: '', description: description.trim(), links, source: 'drawer' },
        {
          onSuccess: () => {
            close();
            ui.showToast('Added to this week');
          },
        },
      );
      return;
    }
    createItem.mutate(
      { goalId, title: title.trim(), description: description.trim(), links },
      {
        onSuccess: () => {
          close();
          ui.showToast(toWeek ? 'Branch isn’t active this week — parked in Backlog' : 'Added to Backlog');
        },
      },
    );
  };

  const busy = createItem.isPending || createTask.isPending;
  const blocked = !goalId || !title.trim() || busy || (toWeek && candidates.length > 1 && !chosenFocus);

  return (
    <Sheet
      label="Add to Backlog"
      onClose={close}
      headerRight={
        <button
          type="button"
          style={{ minHeight: 36, border: 'none', background: 'none', fontSize: 13, fontWeight: 700, color: S.T.accentLink, cursor: 'pointer', fontFamily: 'inherit' }}
          onClick={() => {
            close();
            ui.setScreen('backlog');
          }}
        >
          View Backlog →
        </button>
      }
    >
      <div style={{ ...S.fieldLabel, marginBottom: 6 }}>GOAL</div>
      {targets.length === 0 ? (
        // R-auth-6 / D-10 — a brand-new account has an empty tree. There is no fallback goal to invent.
        <div style={{ fontSize: 13.5, color: S.T.mut, marginBottom: 14 }}>
          Nothing to file this under yet — a backlog item needs a Yearly, Quarterly or Monthly goal.
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {/* R-backlog-2 — non-Life goals only. A Life goal is refused with `LIFE_GOAL_NO_BACKLOG`. */}
          {targets.map((g) => (
            <button key={g.id} type="button" style={S.chipBtn(goalId === g.id)} onClick={() => pickGoal(g.id)}>
              {g.title}
            </button>
          ))}
        </div>
      )}

      <input
        aria-label="What needs doing, someday?"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What needs doing, someday?"
        style={{ ...S.input, marginBottom: 12 }}
      />
      <textarea
        aria-label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        placeholder="Description (optional)"
        style={{ ...S.textarea, marginBottom: 12 }}
      />

      <div style={{ ...S.fieldLabel, marginBottom: 6 }}>LINKS</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 6 }}>
        {links.map((url, i) => (
          <div key={url + i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: S.T.paper, borderRadius: 10, padding: '6px 6px 6px 12px' }}>
            <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: S.T.ink }}>
              {hostOf(url)}
            </div>
            <button
              type="button"
              aria-label={`Remove link ${hostOf(url)}`}
              onClick={() => setLinks(links.filter((_, j) => j !== i))}
              style={{ minWidth: 36, minHeight: 36, border: 'none', background: 'none', color: S.T.faint, fontSize: 15, cursor: 'pointer' }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          aria-label="Link URL"
          value={linkDraft}
          onChange={(e) => setLinkDraft(e.target.value)}
          placeholder="https://…"
          style={{ ...S.input, flex: 1, minHeight: 44, borderRadius: 10, fontSize: 13.5 }}
        />
        <button
          type="button"
          style={S.menuBtn}
          onClick={() => {
            if (!linkDraft.trim()) return;
            setLinks([...links, linkDraft.trim()]);
            setLinkDraft('');
          }}
        >
          Add
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginTop: 14 }}>
        <button type="button" aria-label="Add to this week instead" style={S.checkBox(toWeek)} onClick={() => setToWeek(!toWeek)}>
          {toWeek ? '✓' : ''}
        </button>
        {/* D-21 — the copy says what actually happens: one entity, in the week or in the backlog. */}
        <div style={{ fontSize: 14, fontWeight: 600, color: S.T.ink }}>Add to this week instead</div>
      </div>

      {toWeek && candidates.length === 0 && (
        <div style={{ fontSize: 12.5, color: S.T.mut, marginTop: 8 }}>This branch isn&apos;t active this week — it will be parked in the Backlog.</div>
      )}
      {toWeek && candidates.length > 1 && (
        <>
          <div style={{ ...S.fieldLabel, margin: '12px 0 6px 0' }}>WHICH WEEKLY FOCUS?</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {candidates.map((c) => (
              <button key={c.id} type="button" style={S.chipBtn(chosenFocus === c.id)} onClick={() => setFocusId(c.id)}>
                {c.title}
              </button>
            ))}
          </div>
        </>
      )}

      <FieldError>{commandError(createItem.error) ?? commandError(createTask.error)}</FieldError>
      <button type="button" style={S.saveBtn(blocked)} disabled={blocked} onClick={save}>
        Save
      </button>
    </Sheet>
  );
}

/**
 * R-task-3/4 — the standard task-create sheet, used by all three creation sources (R-task-2). The
 * done-condition is optional, and stays optional.
 *
 * Which COMMAND runs depends on where the sheet was opened from, and the difference matters:
 *  - a plain `+ Task` → `POST /tasks`
 *  - a backlog pull → `POST /backlog/:id/convert-to-task`, ONE atomic operation that marks the item
 *    converted and creates the task. The mockup created a task and filtered the item out of a local array
 *    without ever telling the API — so a real server never learned the item was consumed, and a second
 *    attempt made a duplicate task from a vanished item (D-19).
 */
export function TaskCreateSheet({
  goalId: initialGoalId,
  title: initialTitle,
  fromBacklogId,
}: {
  goalId: string;
  title?: string;
  fromBacklogId?: string;
}) {
  const S = useSkin();
  const ui = useUI();
  const goalsQ = useGoals(0);
  const backlogQ = useBacklog();
  const createTask = useCreateTask();
  const convertItem = useConvertBacklogItem();

  const goals = goalsQ.data?.goals ?? [];
  const [goalId, setGoalId] = useState(initialGoalId);
  const [title, setTitle] = useState(initialTitle ?? '');
  const [cond, setCond] = useState('');
  const [refused, setRefused] = useState<string | null>(null);
  /** D-18 / S-backlog-7-2 — the server's own candidate list, when it refuses an ambiguous conversion. */
  const [serverCandidates, setServerCandidates] = useState<{ id: string; title: string }[] | null>(null);

  const item = fromBacklogId ? (backlogQ.data?.items ?? []).find((b) => b.id === fromBacklogId) : undefined;

  // R-task-4 — the target selector lists only ACTIVE leaves. A backlog pull is narrowed further to the
  // leaves at or under the item's own goal (R-backlog-7); everything else offers every active leaf.
  const options: GoalView[] = serverCandidates
    ? goals.filter((g) => serverCandidates.some((c) => c.id === g.id))
    : item
      ? activeLeavesUnder(goals, item.goalId)
      : goals.filter((g) => g.isLeaf && g.isActive && g.parentId !== null);

  const close = () => ui.closeSheet();
  const busy = createTask.isPending || convertItem.isPending;

  const onError = (e: unknown) => {
    const err = toApiError(e);
    // R-backlog-8 — no active leaf under the item's goal after all (another tab cleared the focus).
    if (err.code === 'BRANCH_NOT_ACTIVE') {
      ui.openSheet({ kind: 'inactiveBranch', itemId: fromBacklogId ?? '', title: title || (initialTitle ?? '') });
      return;
    }
    // R-backlog-6 / D-19 — someone converted it from another tab, or this is a retry of a request that
    // already committed. No second task exists, and the first is untouched.
    if (err.code === 'ALREADY_CONVERTED') {
      setRefused('That one is already this week — nothing new was created.');
      return;
    }
    /*
     * The ambiguous-target refusal. R-backlog-7 / D-18: an item on a Quarterly goal with two active leaves
     * beneath it has no correct silent answer, so the user picks.
     *
     * `409 AMBIGUOUS_CONVERSION_TARGET` — its own code precisely so the client branches on the code and
     * renders a chooser rather than a field error. `details.candidates` is the server's own list of
     * `{ id, title }`, and the picker below lists exactly it.
     */
    if (err.code === 'AMBIGUOUS_CONVERSION_TARGET') {
      const candidates = err.details?.candidates;
      setServerCandidates(Array.isArray(candidates) ? (candidates as { id: string; title: string }[]) : []);
      setGoalId('');
      setRefused('More than one focus could take this. Which one?');
      return;
    }
    setRefused(null);
  };

  const save = () => {
    if (!title.trim()) return;
    setRefused(null);
    const done = () => close();
    if (fromBacklogId) {
      convertItem.mutate({ id: fromBacklogId, ...(goalId ? { goalId } : {}), title: title.trim(), cond: cond.trim() }, { onSuccess: done, onError });
      return;
    }
    createTask.mutate({ goalId, title: title.trim(), cond: cond.trim(), description: '', links: [], source: 'planning' }, { onSuccess: done, onError });
  };

  // R-task-4 / D-10 — with nothing active, creation is blocked and the owner is routed to planning. There
  // is no fallback goal, and there never was one to fall back to.
  const noTarget = options.length === 0 && !goalId;
  const blocked = busy || !title.trim() || !goalId;

  return (
    <Sheet label="New task" onClose={close}>
      {noTarget ? (
        <>
          <div style={{ fontSize: 13.5, color: S.T.mut, marginBottom: 14 }}>
            No branch is active this week, so there is no weekly focus to hang a task on.
          </div>
          <button
            type="button"
            style={{ ...S.btn(true), width: '100%' }}
            onClick={() => {
              close();
              ui.setScreen('plan');
            }}
          >
            Set a weekly focus
          </button>
        </>
      ) : (
        <>
          <div style={{ ...S.fieldLabel, marginBottom: 5 }}>WEEKLY FOCUS</div>
          <select
            aria-label="Weekly focus"
            value={goalId}
            onChange={(e) => setGoalId(e.target.value)}
            style={{ ...S.input, minHeight: 48, padding: '0 10px', fontSize: 14, marginBottom: 12 }}
          >
            {/* An empty value means the choice has not been made — with two candidates, nobody may guess. */}
            {!goalId && <option value="">Choose a focus…</option>}
            {options.map((g) => (
              <option key={g.id} value={g.id}>
                {rootOf(goals, g).title} — {g.focus || g.title}
              </option>
            ))}
          </select>
          <input aria-label="Task title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" style={{ ...S.input, marginBottom: 12 }} />
          <input aria-label="Done-condition (optional)" value={cond} onChange={(e) => setCond(e.target.value)} placeholder="Done-condition (optional)" style={S.input} />
          <div style={{ fontSize: 12.5, color: S.T.mut, marginTop: 5 }}>How will you know it&apos;s done?</div>
          <FieldError>{refused ?? commandError(createTask.error) ?? commandError(convertItem.error)}</FieldError>
          <button type="button" style={S.saveBtn(blocked)} disabled={blocked} onClick={save}>
            Save task
          </button>
        </>
      )}
    </Sheet>
  );
}

/** Used by the drawer's chip row; exported so the goal form can reuse the same lookup. */
export const goalTitle = (goals: GoalView[], id: string | null): string => node(goals, id)?.title ?? '';
