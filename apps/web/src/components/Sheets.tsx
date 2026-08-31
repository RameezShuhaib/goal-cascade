import { useUI } from '../context/UIContext';
import { BacklogDrawer, TaskCreateSheet } from './BacklogSheets';
import { DeleteGoalSheet, GoalFormSheet, MoveGoalSheet, ReplanGoalSheet } from './GoalModals';
import { ConfirmTaskExitSheet, InactiveBranchSheet, TaskDetailSheet } from './TaskSheets';

/**
 * One place decides which overlay is showing, from `UIContext`'s discriminated `Sheet` union.
 *
 * The mockup had `dtId`, `tmOpen`, `cfOpen`, `ibOpen`, `bdOpen`, `gmOpen` and `mvOpen` as seven
 * independent fields, which could — and did — all be true at once. A union cannot express that.
 *
 * Two members render nowhere here on purpose. `uncheck` is the inline "Update the done-condition?" prompt
 * under its task row (R-task-21 — it is not a modal), and `weekPicker` is the chip row under the week
 * switcher. Both still live in the union, so there is still exactly one answer to "what is open?".
 */
export function Sheets() {
  const { sheet } = useUI();
  if (!sheet) return null;
  switch (sheet.kind) {
    case 'taskDetail':
      return <TaskDetailSheet taskId={sheet.taskId} />;
    case 'taskCreate':
      return (
        <TaskCreateSheet goalId={sheet.goalId} title={sheet.title} fromBacklogId={sheet.fromBacklogId} />
      );
    case 'backlogDrawer':
      return <BacklogDrawer goalId={sheet.goalId} />;
    case 'confirmTaskExit':
      return <ConfirmTaskExitSheet taskId={sheet.taskId} exit={sheet.exit} />;
    case 'confirmReplan':
      return <ReplanGoalSheet goalId={sheet.goalId} />;
    case 'confirmDeleteGoal':
      return <DeleteGoalSheet goalId={sheet.goalId} />;
    case 'inactiveBranch':
      return <InactiveBranchSheet title={sheet.title} />;
    case 'goalForm':
      return <GoalFormSheet editId={sheet.editId} parentId={sheet.parentId} />;
    case 'moveGoal':
      return <MoveGoalSheet goalId={sheet.goalId} />;
    case 'uncheck':
    case 'weekPicker':
      return null;
  }
}
