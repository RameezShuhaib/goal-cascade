import { WEEK_HISTORY_WEEKS, type GoalView, type TaskView } from '@goal-cascade/shared';
import { useUI } from '../context/UIContext';
import { useGoals, useTasks } from '../api/queries';
import { TaskRow } from '../components/TaskRow';
import { TopActions } from '../components/TopActions';
import { Empty, Loading, LoadError } from '../components/states';
import { useSkin } from '../skin';
import { addWeeks, weekLabel } from '../utils/dates';
import { lifeGoals, pathOf, rootIdOfGoalId } from '../utils/tree';

/**
 * R-nav-3..10 — the week switcher, the goal filter pills, and one section per leaf.
 *
 * Visibility is entirely the server's (R-task-7/8/32): `GET /tasks?week=` answers with exactly the tasks
 * visible in that week — an open task in every week from its origin, a done task only in the week it was
 * completed, an exited task in none. The mockup re-applied `visibleIn` on the client, which is how a
 * client and a server get to disagree about what happened.
 */
export function TasksScreen() {
  const S = useSkin();
  const ui = useUI();
  const w = ui.viewedWeek;
  const tasksQ = useTasks(w);
  const goalsQ = useGoals(w);

  const goals = goalsQ.data?.goals ?? [];
  const tasks = tasksQ.data?.tasks ?? [];
  const week = tasksQ.data?.week ?? goalsQ.data?.week;

  const tasksIn = (goalId: string): TaskView[] => tasks.filter((t) => t.goalId === goalId);

  // R-nav-8 — a leaf gets a section when it has a visible task this week, or (week 0 only) it is active.
  // D-11: dormancy removes the EMPTY section, the focus sentence and `+ Task`; it never hides carried work.
  const sectionGoals = goals.filter((g) => g.parentId !== null && g.isLeaf && (tasksIn(g.id).length > 0 || (w === 0 && g.isActive)));
  const roots = lifeGoals(goals).filter((lg) => sectionGoals.some((g) => rootIdOfGoalId(goals, g.id) === lg.id));
  const openCount = (rootId: string) => tasks.filter((t) => !t.done && rootIdOfGoalId(goals, t.goalId) === rootId).length;
  const shown = sectionGoals.filter((g) => !ui.taskGoalFilter || rootIdOfGoalId(goals, g.id) === ui.taskGoalFilter);

  const failed = tasksQ.error ?? goalsQ.error;
  const pending = (tasksQ.isPending || goalsQ.isPending) && !failed;

  return (
    <div style={S.page} data-screen-label="Tasks">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ ...S.eyebrow, paddingTop: 6 }}>Tasks</div>
        <TopActions>
          {/* R-nav-10 / R-plan-2 — planning edits the current week only, so the affordance exists only there. */}
          {w === 0 && (
            <button type="button" style={S.topBtn} onClick={() => ui.setScreen('plan')}>
              Edit plan
            </button>
          )}
        </TopActions>
      </div>

      <WeekSwitcher weekStart={week?.weekStart} offset={week?.offset ?? w} />

      {w < 0 && (
        <div
          style={{
            display: 'inline-block',
            background: S.T.lineSoft,
            color: S.T.mut,
            borderRadius: 12,
            padding: '4px 10px',
            fontSize: 12,
            fontWeight: 700,
            marginTop: 8,
          }}
        >
          Past week — still editable
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '14px 0' }}>
        <button type="button" style={S.chipBtn(ui.taskGoalFilter === null)} onClick={() => ui.setTaskGoalFilter(null)}>
          All
        </button>
        {roots.map((g) => (
          <button key={g.id} type="button" style={S.chipBtn(ui.taskGoalFilter === g.id)} onClick={() => ui.setTaskGoalFilter(g.id)}>
            {g.title} · {openCount(g.id)}
          </button>
        ))}
      </div>

      {pending && <Loading label="Loading this week…" />}
      {failed && <LoadError error={failed} what="this week" onRetry={() => void tasksQ.refetch()} />}

      {!pending && !failed && shown.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          {shown.map((g) => (
            <Section key={g.id} goal={g} goals={goals} tasks={tasksIn(g.id)} week={w} />
          ))}
        </div>
      )}

      {!pending && !failed && shown.length === 0 && (
        // R-nav-9 — week 0 offers the plan; a past week has no CTA, because there is nothing to do about it.
        <Empty
          title={w === 0 ? 'A new week, still unplanned.' : 'Nothing happened this week.'}
          body={w === 0 ? 'Pick which branches are active this week, then write each focus.' : 'No tasks were live in this week.'}
          action={
            w === 0 ? (
              <button
                type="button"
                style={{
                  minHeight: 46,
                  padding: '0 22px',
                  border: 'none',
                  borderRadius: 23,
                  background: S.T.ink,
                  color: S.onInk,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
                onClick={() => ui.setScreen('plan')}
              >
                Plan this week
              </button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}

function Section({ goal, goals, tasks, week }: { goal: GoalView; goals: GoalView[]; tasks: TaskView[]; week: number }) {
  const S = useSkin();
  const ui = useUI();
  return (
    <section style={{ ...S.card, padding: '16px 16px 8px 16px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: S.T.mut, lineHeight: 1.5 }}>
        {pathOf(goals, goal).join(' › ')}
      </div>
      {week === 0 && goal.focus && <div style={{ ...S.serif, fontSize: 19, color: S.quote, margin: '4px 0 10px 0' }}>{goal.focus}</div>}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {tasks.map((t) => (
          <TaskRow key={t.id} t={t} />
        ))}
      </div>
      {/* R-task-6 — tasks are only ever created into the current week, under an active leaf. */}
      {week === 0 && goal.isActive && (
        <button
          type="button"
          style={{ ...S.linkBtn, width: '100%', padding: '8px 0' }}
          onClick={() => ui.openSheet({ kind: 'taskCreate', goalId: goal.id })}
        >
          + Task
        </button>
      )}
    </section>
  );
}

/**
 * R-nav-3/4 — chevrons and a picker over ONE range (D-24: the mockup's two controls disagreed by three
 * weeks). `WEEK_HISTORY_WEEKS` is the shared bound, so both controls reach exactly the same earliest week.
 *
 * The chip dates are walked off the `weekStart` the server sent for the viewed week, never derived from
 * the device clock (R-auth-5): `week.offset` locates today's Monday, and the rest is date arithmetic.
 */
function WeekSwitcher({ weekStart, offset }: { weekStart: string | undefined; offset: number }) {
  const S = useSkin();
  const ui = useUI();
  const w = ui.viewedWeek;
  const earliest = -(WEEK_HISTORY_WEEKS - 1);
  const currentMonday = weekStart ? addWeeks(weekStart, -offset) : undefined;
  const label = (o: number) => (currentMonday ? `Week of ${weekLabel(addWeeks(currentMonday, o))}` : 'Week of …');
  const picking = ui.sheet?.kind === 'weekPicker';

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
        <button
          type="button"
          aria-label="Earlier week"
          disabled={w <= earliest}
          onClick={() => ui.selectWeek(Math.max(w - 1, earliest))}
          style={{
            minWidth: 40,
            minHeight: 40,
            border: 'none',
            background: 'none',
            fontSize: 16,
            padding: 0,
            ...(w <= earliest ? { color: S.T.disabled, cursor: 'not-allowed' } : { color: S.T.mut, cursor: 'pointer' }),
          }}
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => (picking ? ui.closeSheet() : ui.openSheet({ kind: 'weekPicker' }))}
          style={{
            border: 'none',
            background: 'none',
            padding: 0,
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: '-0.01em',
            color: S.T.ink,
            cursor: 'pointer',
            minHeight: 40,
            fontFamily: 'inherit',
          }}
        >
          {label(w)}
        </button>
        {/* R-nav-3 / S-nav-3-1 — the future is never selectable, by chevron, picker, or request. */}
        <button
          type="button"
          aria-label="Later week"
          disabled={w === 0}
          onClick={() => ui.selectWeek(Math.min(w + 1, 0))}
          style={{
            minWidth: 40,
            minHeight: 40,
            border: 'none',
            background: 'none',
            fontSize: 16,
            padding: 0,
            ...(w === 0 ? { color: S.T.disabled, cursor: 'not-allowed' } : { color: S.T.mut, cursor: 'pointer' }),
          }}
        >
          ›
        </button>
      </div>
      {picking && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {Array.from({ length: WEEK_HISTORY_WEEKS }, (_, i) => -i).map((o) => (
            // R-nav-6 — `selectWeek` also resets the goal filter, in one call, so it cannot be half-done.
            <button key={o} type="button" style={S.chipBtn(w === o)} onClick={() => ui.selectWeek(o)}>
              {o === 0 ? 'This week' : label(o)}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
