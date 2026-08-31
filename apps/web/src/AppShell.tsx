import { useUI } from './context/UIContext';
import { useSkin } from './skin';
import { TabBar } from './components/TabBar';
import { Sheets } from './components/Sheets';
import { TasksScreen } from './screens/TasksScreen';
import { GoalsScreen } from './screens/GoalsScreen';
import { GoalDetailScreen } from './screens/GoalDetailScreen';
import { BacklogScreen } from './screens/BacklogScreen';
import { IdeasScreen, LearningsScreen } from './screens/CaptureScreens';
import { PlanScreen } from './screens/PlanScreen';

/**
 * The signed-in tree. This is what replaced `MockupShell`.
 *
 * There is no router (R-nav-1 fixes five tabs; `lib/useUrlSync.ts` mirrors the screen into the address bar
 * so a copied URL is still a working deep link). The screen and the open sheet are `UIContext` state, and
 * every one of these screens reads its data from `api/queries.ts` — no props carry server data down, and
 * nothing below here holds a copy of it.
 */
export function AppShell() {
  const ui = useUI();
  const S = useSkin();
  return (
    <div
      style={{
        minHeight: '100vh',
        background: S.T.paper,
        color: S.T.ink,
        fontFamily: "'Manrope', sans-serif",
        fontSize: 15,
        lineHeight: 1.45,
      }}
    >
      {ui.screen === 'tasks' && <TasksScreen />}
      {ui.screen === 'goals' && <GoalsScreen />}
      {ui.screen === 'goal' && <GoalDetailScreen />}
      {ui.screen === 'backlog' && <BacklogScreen />}
      {ui.screen === 'ideas' && <IdeasScreen />}
      {ui.screen === 'learnings' && <LearningsScreen />}
      {ui.screen === 'plan' && <PlanScreen />}
      <TabBar />
      <Sheets />
    </div>
  );
}
