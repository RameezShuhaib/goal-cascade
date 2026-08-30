import { AppProvider, useStore } from './store';
import { TabBar } from './components/TabBar';
import { Toast } from './components/Toast';
import { ConfirmSheet, InactiveBranchSheet, TaskDetailSheet } from './components/TaskSheets';
import { BacklogDrawer, TaskCreateModal } from './components/BacklogSheets';
import { GoalModal, MoveGoalModal } from './components/GoalModals';
import { TasksScreen } from './screens/TasksScreen';
import { GoalsScreen } from './screens/GoalsScreen';
import { GoalDetailScreen } from './screens/GoalDetailScreen';
import { BacklogScreen } from './screens/BacklogScreen';
import { IdeasScreen, LearningsScreen } from './screens/CaptureScreens';
import { PlanScreen } from './screens/PlanScreen';
import { colors } from './ui';

function Shell() {
  const s = useStore();
  const v = s.st.view;
  return (
    <div style={{ minHeight: '100vh', background: colors.paper, color: colors.ink, fontFamily: "'Manrope', sans-serif", fontSize: 15, lineHeight: 1.45 }}>
      {v === 'home' && <TasksScreen />}
      {v === 'goals' && <GoalsScreen />}
      {v === 'line' && <GoalDetailScreen />}
      {v === 'backlog' && <BacklogScreen />}
      {v === 'ideas' && <IdeasScreen />}
      {v === 'learn' && <LearningsScreen />}
      {v === 'plan' && <PlanScreen />}
      <TabBar />
      <Toast />
      <TaskDetailSheet />
      <BacklogDrawer />
      <TaskCreateModal />
      <ConfirmSheet />
      <InactiveBranchSheet />
      <GoalModal />
      <MoveGoalModal />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
