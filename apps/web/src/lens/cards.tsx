import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { GoalView, Horizon, TaskView } from '@goal-cascade/shared';
import { useUI } from '../context/UIContext';
import { useWeekClock } from '../lib/weekClock';
import { useSkin } from '../skin';
import { weekForMonth } from '../utils/periodKeys';
import { TaskRow } from '../components/TaskRow';
import { goalPath } from '../routes';
import { weekLabel } from '../utils/dates';
import { plural } from '../utils/tree';
import { plannedNess, stalePlanLine } from './copy';

/**
 * The item cards. Every lens's body is a flat list of these, grouped by Life goal and nothing else.
 *
 * **No horizon chip.** Every item in a lens is at the same horizon and the title says which one; a
 * `QUARTERLY` badge repeated down a quarterly list is the definition of noise. The chip survives on the
 * goal detail page, where the horizon is genuinely ambiguous.
 *
 * ── The one thing the wire cannot answer yet ──────────────────────────────────
 * **R-lens-23's parent line (`under Run a sub-2h half marathon in 2026`) is not rendered**, and it is not
 * an omission by choice. A lens item carries `parentId` but no parent title, and the client must never
 * hold the interior tree or walk an ancestor chain (R-lens-16, S-lens-16-2) — so there is nothing to put
 * in the line. Resolving it per item would be one `GET /goals/:id` per card. Recorded in
 * `docs/work/17-lens-web/build.md`; the fix is a field on `LensResponse`, not a read from here.
 */

function CardShell({ children, onOpen, label }: { children: ReactNode; onOpen?: () => void; label?: string }) {
  const S = useSkin();
  return (
    <div style={{ ...S.card, padding: '14px 16px' }} data-testid="lens-card" aria-label={label}>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          style={{ width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: 0, cursor: 'pointer', minWidth: 0, fontFamily: 'inherit' }}
        >
          {children}
        </button>
      ) : (
        children
      )}
    </div>
  );
}

function Title({ goal }: { goal: GoalView }) {
  const S = useSkin();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      {/* R-goal-15 — the pulse dot. Never dimmed: no goal is muted or greyed anywhere any more (R-goal-38). */}
      <span style={S.dot(goal.pulse, false)} />
      <span style={{ fontSize: 15.5, fontWeight: 700, color: S.T.ink, minWidth: 0 }}>{goal.title}</span>
    </div>
  );
}

const Muted = ({ children }: { children: ReactNode }) => {
  const S = useSkin();
  // `T.mut`, never `faint`: `faint` fails AA in both themes and may carry nothing load-bearing.
  return <div style={{ fontSize: 12.5, color: S.T.mut, marginTop: 3 }}>{children}</div>;
};

/** R-goal-25 — `N in backlog`, on any card whose goal holds open items of its own. */
function BacklogLine({ goal }: { goal: GoalView }) {
  return goal.backlogCount > 0 ? <Muted>{goal.backlogCount} in backlog</Muted> : null;
}

/**
 * The Life lens card. The one lens with **no groups** — each Life goal *is* a group of one, so a header
 * would name the card beneath it, and the count and backlog line move onto the card instead.
 *
 * R-goal-24's carrying line renders here and nowhere else in a lens: it is the product's one quiet signal,
 * and two carry numbers in one place would be one too many (R-lens-4).
 */
export function LifeCard({ goal, openTasks }: { goal: GoalView; openTasks: number }) {
  const S = useSkin();
  const navigate = useNavigate();
  const bits = [openTasks > 0 ? `${openTasks} open` : null, goal.backlogCount > 0 ? `${goal.backlogCount} in backlog` : null].filter(Boolean);
  return (
    <CardShell onOpen={() => navigate(goalPath(goal.id))}>
      <Title goal={goal} />
      {goal.why && <Muted>{goal.why}</Muted>}
      {bits.length > 0 && <Muted>{bits.join(' · ')}</Muted>}
      {goal.carrying && (
        <div style={{ fontSize: 12, color: S.T.mut, marginTop: 3 }}>
          {`${plural(goal.carrying.openTasks, 'task')} carrying · oldest ${plural(goal.carrying.oldestWeeks, 'week')}`}
        </div>
      )}
    </CardShell>
  );
}

/** Yearly and Quarterly: title, `why`, `N in backlog`. Nothing else belongs on them. */
export function PlainCard({ goal }: { goal: GoalView }) {
  const navigate = useNavigate();
  return (
    <CardShell onOpen={() => navigate(goalPath(goal.id))}>
      <Title goal={goal} />
      {goal.why && <Muted>{goal.why}</Muted>}
      <BacklogLine goal={goal} />
    </CardShell>
  );
}

/**
 * R-goal-47 — the Monthly card, and **dormancy's one surface**.
 *
 * If work only ever lives at the week, a Monthly goal is a container whose entire purpose is the Weekly
 * goals beneath it, and a lens showing only titles would leave the owner unable to tell a planned month
 * from an empty one. So one muted line says how the month is broken into weeks.
 *
 * Three things it deliberately is **not**: not a progress bar, percentage or chart (R-nav-26 — the product
 * has no reports and gains none here); not an **escalation** (`nothing this week` is the same grey as
 * `3 weekly goals`, because a month being unplanned is a fact and not a failure); and not a **link**,
 * because zooming into one card's weeks is a filtered subtree and the subtree is the thing being removed.
 * The line is text; the card's `+ Task` is the action.
 *
 * The card carries **no `+ Weekly goal`** (R-task-49, Q-20 amended): a create button for the horizon below
 * on every card is a tree growing back one affordance at a time.
 */
export function MonthlyCard({ goal, canCreate }: { goal: GoalView; canCreate: boolean }) {
  const navigate = useNavigate();
  const clock = useWeekClock();
  const b = goal.weeklyBreakdown;
  /**
   * R-task-49 / R-lens-9 / R-goal-47 — **the one answer to "which week does this month mean"**: the week
   * containing today when the viewed month contains today, otherwise the first week whose MONDAY falls in
   * it. The same clamp serves the Monthly → Weekly zoom, this card's `+ Task`, and the planned-ness line's
   * scope, so the three can never disagree. Both inputs are the server's (`WeekView.weekStart` and the
   * owner's today), so no Monday is derived here.
   */
  const targetWeek = clock.currentMonday ? weekForMonth(goal.periodKey, clock.currentMonday, clock.todayMonthKey) : undefined;
  const line = b ? plannedNess(b) : null;
  return (
    <CardShell label={line ? `${goal.title}, ${line.replace(/ · /g, ', ').toLowerCase()}.` : undefined}>
      <button
        type="button"
        onClick={() => navigate(goalPath(goal.id))}
        style={{ width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: 0, cursor: 'pointer', minWidth: 0, fontFamily: 'inherit' }}
      >
        <Title goal={goal} />
        {goal.why && <Muted>{goal.why}</Muted>}
        {/* The planned-ness line is text and takes no focus stop; it is folded into the card's name above. */}
        {line && <Muted>{line}</Muted>}
        <BacklogLine goal={goal} />
      </button>
      {canCreate && <LinkRow goal={goal} horizon="Monthly" weekStart={targetWeek} />}
    </CardShell>
  );
}

/**
 * `+ Task` and `Pull from backlog` share ONE row at the card's foot — two affordances, one row.
 *
 * The same row, in the same place, with the same two labels on a Weekly card and on a Monthly card, so
 * `+ Task` means one thing in the whole product regardless of which lens you found it in. What differs is
 * invisible: from a Weekly goal it attaches to that goal; from a Monthly goal the Weekly goal is resolved
 * or created for you (R-task-49).
 */
function LinkRow({ goal, horizon, weekStart }: { goal: GoalView; horizon: Horizon; weekStart?: string }) {
  const S = useSkin();
  const ui = useUI();
  return (
    <div style={{ display: 'flex', gap: 16, borderTop: `1px solid ${S.T.lineSoft}`, marginTop: 10, paddingTop: 2 }}>
      <button
        type="button"
        style={{ ...S.linkBtn, flex: 1 }}
        onClick={() =>
          horizon === 'Weekly'
            ? ui.openSheet({ kind: 'taskCreate', goalId: goal.id, weekStart: goal.periodKey })
            : ui.openSheet({ kind: 'taskCreate', newWeekly: { parentId: goal.id, title: goal.title }, weekStart })
        }
      >
        + Task
      </button>
      <button type="button" style={{ ...S.linkBtn, flex: 1, textAlign: 'right' }} onClick={() => ui.openSheet({ kind: 'pull', goalId: goal.id, horizon, weekStart })}>
        Pull from backlog
      </button>
    </div>
  );
}

/**
 * R-lens-12 case 1 — **this week's plan.** One card per Weekly goal, with its tasks nested inside it under
 * a hairline: a screen of separate task cards at 16px radius is a screen of borders.
 *
 * `+ Task` renders only when the week is the current one or later (R-task-41). A past week renders no
 * `+ Task`, no `Pull from backlog` and no `+ Weekly goal` — but its tasks stay **fully interactive**,
 * including the checkbox (R-task-14): history is readable and truthful, and completing something you
 * actually did is not rewriting it.
 */
export function WeeklyCard({ goal, tasks, week, canCreate }: { goal: GoalView; tasks: TaskView[]; week: number; canCreate: boolean }) {
  const S = useSkin();
  const navigate = useNavigate();
  return (
    <CardShell>
      <button
        type="button"
        onClick={() => navigate(goalPath(goal.id))}
        style={{ width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: 0, cursor: 'pointer', minWidth: 0, fontFamily: 'inherit' }}
      >
        <Title goal={goal} />
        {goal.why && <Muted>{goal.why}</Muted>}
        {/*
         * R-goal-43 — `planned N weeks ago`, once the week has ARRIVED and only at `>= 2`. Age 1 is
         * ordinary planning; a week that has not arrived is early, not stale. The threshold is the
         * server's number, rendered here as one muted line — never a chip, never coloured, never blocking.
         */}
        {goal.plannedAgeWeeks !== null && goal.plannedAgeWeeks >= 2 && <Muted>{stalePlanLine(goal.plannedAgeWeeks)}</Muted>}
        <BacklogLine goal={goal} />
      </button>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 8 }}>
        {tasks.map((t) => (
          <TaskRow key={t.id} t={t} week={week} />
        ))}
        {tasks.length === 0 && <div style={{ fontSize: 13, color: S.T.mut, paddingTop: 8, borderTop: `1px solid ${S.T.lineSoft}` }}>Nothing on this yet.</div>}
      </div>
      {canCreate && <LinkRow goal={goal} horizon="Weekly" />}
    </CardShell>
  );
}

/**
 * R-lens-12 case 2 — **the carried band's card.**
 *
 * A Weekly goal appears in week `W` if `periodKey = W` **or** it still holds an open task visible in `W`.
 * The second kind renders below the week's own goals, oldest first, labelled with the week it was written
 * for so it is never mistaken for this week's plan.
 *
 * **It offers no `+ Task` and no `Pull from backlog`, ever** (R-lens-12, R-task-41): adding new work to a
 * past week's goal is back-dating. Carried work is finished, moved to the backlog or cancelled where it
 * stands.
 */
export function CarriedCard({ goal, tasks, week }: { goal: GoalView; tasks: TaskView[]; week: number }) {
  const S = useSkin();
  const navigate = useNavigate();
  return (
    <CardShell>
      <button
        type="button"
        onClick={() => navigate(goalPath(goal.id))}
        style={{ width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: 0, cursor: 'pointer', minWidth: 0, fontFamily: 'inherit' }}
      >
        <Title goal={goal} />
        <Muted>from week of {weekLabel(goal.periodKey)}</Muted>
      </button>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 8 }}>
        {tasks.map((t) => (
          <TaskRow key={t.id} t={t} week={week} />
        ))}
      </div>
    </CardShell>
  );
}
