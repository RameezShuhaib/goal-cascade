import { useLocation, useParams } from 'react-router';
import { useUI } from '../context/UIContext';
import { useLens } from '../api/queries';
import { BacklogDrawer, PullSheet, TaskCreateSheet } from './BacklogSheets';
import { DeleteGoalSheet, GoalFormSheet, MoveGoalSheet, ReplanGoalSheet } from './GoalModals';
import { ConfirmTaskExitSheet } from './TaskSheets';
import { ZoomSheet } from '../lens/ZoomSheet';
import { lensOfSegment } from '../routes';
import { validKeyFor } from '../utils/periodKeys';

/**
 * One place decides which overlay is showing, from `UIContext`'s discriminated `Sheet` union.
 *
 * R-lens-14 — **overlays are not routes.** Every member here is a two-second interaction whose URL nobody
 * wants, and reloading the page must not reopen one (S-nav-24-2). What IS addressable lives in
 * `AppShell`'s route table.
 *
 * Two members render nothing here on purpose: `uncheck` is the inline "Update the done-condition?" prompt
 * under its task row (R-task-21 — it is not a modal), and `zoom` needs the current lens, which it reads
 * from the route below. Both stay in the union, so there is still exactly one answer to "what is open?".
 *
 * ⚠ **A2** — `TaskDetailSheet` and `InactiveBranchSheet` are gone: task detail is a page (R-task-45), and
 * the "this branch isn't active this week" dead end has no state left to describe (R-task-49).
 */
export function Sheets() {
  const { sheet } = useUI();
  if (!sheet) return null;
  switch (sheet.kind) {
    case 'taskCreate':
      return (
        <TaskCreateSheet
          goalId={sheet.goalId}
          newWeekly={sheet.newWeekly}
          weekStart={sheet.weekStart}
          title={sheet.title}
          fromBacklogId={sheet.fromBacklogId}
        />
      );
    case 'backlogDrawer':
      return <BacklogDrawer goalId={sheet.goalId} />;
    case 'confirmTaskExit':
      return <ConfirmTaskExitSheet taskId={sheet.taskId} exit={sheet.exit} week={sheet.week} />;
    case 'confirmReplan':
      return <ReplanGoalSheet goalId={sheet.goalId} />;
    case 'confirmDeleteGoal':
      return <DeleteGoalSheet goalId={sheet.goalId} />;
    case 'goalForm':
      return <GoalFormWithLabel />;
    case 'moveGoal':
      return <MoveGoalSheet goalId={sheet.goalId} lifeGoalsOnly={sheet.lifeGoalsOnly} />;
    case 'pull':
      return <PullSheet goalId={sheet.goalId} horizon={sheet.horizon} weekStart={sheet.weekStart} />;
    case 'zoom':
      return <ZoomOnRoute />;
    case 'uncheck':
      return null;
  }
}

/**
 * The create sheet shows the period's **label** (`Q3 2026`), never its key (`2026-Q3`) — the URL carries
 * the key and the screen shows the label (R-nav-24). The label is the server's, off the lens read that is
 * already in the cache, so nothing here formats a period.
 */
function GoalFormWithLabel() {
  const { sheet } = useUI();
  const form = sheet?.kind === 'goalForm' ? sheet : null;
  const lens = useLens(form?.horizon ?? 'Life', form?.periodKey || undefined, !!form && form.horizon !== 'Life');
  if (!form) return null;
  return (
    <GoalFormSheet
      editId={form.editId}
      horizon={form.horizon}
      periodKey={form.periodKey}
      periodLabel={lens.data?.period?.label}
      lifeGoalId={form.lifeGoalId}
      parentId={form.parentId}
      title={form.title}
    />
  );
}

/** R-lens-17 — the Zoom sheet needs the lens it was opened from, which is the route. */
function ZoomOnRoute() {
  const { anchor } = useUI();
  const params = useParams();
  // `useLocation`, never the global `location`: the router owns the current path, and under a
  // `MemoryRouter` (and in any future non-browser host) the global one is not it.
  const segment = useLocation().pathname.split('/')[1];
  const lens = lensOfSegment(segment) ?? 'Weekly';
  const period = validKeyFor(lens, params.period);
  const q = useLens(lens, period);
  return <ZoomSheet lens={lens} anchor={anchor} offNow={q.data?.period ? !q.data.period.isCurrent : false} />;
}
