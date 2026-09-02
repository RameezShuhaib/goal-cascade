import { useUI } from '../context/UIContext';
import { BacklogDrawer, PullSheet, TaskCreateSheet } from './BacklogSheets';
import { DeleteGoalSheet, GoalFormSheet, MoveGoalSheet, ReplanGoalSheet } from './GoalModals';
import { ConfirmTaskExitSheet } from './TaskSheets';

/**
 * One place decides which overlay is showing, from `UIContext`'s discriminated `Sheet` union.
 *
 * R-lens-14 — **overlays are not routes.** Every member here is a two-second interaction whose URL nobody
 * wants, and reloading the page must not reopen one (S-nav-24-2). What IS addressable lives in
 * `AppShell`'s route table.
 *
 * One member renders nothing here on purpose: `uncheck` is the inline "Update the done-condition?" prompt
 * under its task row (R-task-21 — it is not a modal). It stays in the union, so there is still exactly one
 * answer to "what is open?".
 *
 * ⚠ **`zoom` is gone with the Zoom sheet** (R-lens-17, rewritten). The lens is a tab strip in the shell,
 * which is not an overlay at all.
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
      return (
        <GoalFormSheet
          editId={sheet.editId}
          horizon={sheet.horizon}
          periodKey={sheet.periodKey}
          lens={sheet.lens}
          lifeGoalId={sheet.lifeGoalId}
          parentId={sheet.parentId}
          title={sheet.title}
        />
      );
    case 'moveGoal':
      return <MoveGoalSheet goalId={sheet.goalId} lifeGoalsOnly={sheet.lifeGoalsOnly} />;
    case 'pull':
      return <PullSheet goalId={sheet.goalId} horizon={sheet.horizon} weekStart={sheet.weekStart} />;
    case 'uncheck':
      return null;
  }
}
