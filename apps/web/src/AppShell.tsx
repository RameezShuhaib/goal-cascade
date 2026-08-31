import { Navigate, Route, Routes, useLocation } from 'react-router';
import { HORIZONS } from '@goal-cascade/shared';
import { useUI } from './context/UIContext';
import { useSkin } from './skin';
import { TabBar } from './components/TabBar';
import { Sheets } from './components/Sheets';
import { LensScreen } from './lens/LensScreen';
import { GoalDetailScreen } from './screens/GoalDetailScreen';
import { TaskPage } from './screens/TaskPage';
import { BacklogScreen } from './screens/BacklogScreen';
import { LearningsScreen } from './screens/CaptureScreens';
import { LENS_SEGMENT, lensPath } from './routes';

/**
 * The signed-in tree, and R-nav-24's route table.
 *
 * **There is a router now.** Before A2 the screen and the open overlay were `UIContext` state with the URL
 * mirrored one way afterwards (`lib/useUrlSync.ts`), which is why back, forward and a pasted link all did
 * the wrong thing. CR-5's task page is the case that decision reserved: a task is a genuinely linkable
 * thing, and a sheet cannot be linked to.
 *
 * What is addressable and what is not (R-lens-14):
 *  - **routes** — the five lenses with their periods, a goal page, a **task page**, Backlog, Learnings;
 *  - **overlays** — the `+` drawer, the Zoom sheet, every confirm sheet, every create form. Each is a
 *    two-second interaction whose URL nobody wants, and reloading must not reopen one.
 *
 * The period segment is optional on every lens (`/month` as well as `/month/2026-08`) because the client
 * must never derive the current period (R-goal-34): `/month` means "whichever month the server says
 * contains today", and `LensScreen` rewrites the address bar to the canonical key once the read lands.
 *
 * An unknown path lands on the remembered lens rather than a blank page (R-nav-24, S-nav-24-1).
 */
export function AppShell() {
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
      <Routes>
        <Route path="/" element={<RememberedLens />} />
        {HORIZONS.map((horizon) => (
          <Route key={horizon} path={`/${LENS_SEGMENT[horizon]}`}>
            <Route index element={<LensScreen lens={horizon} />} />
            {horizon !== 'Life' && <Route path=":period" element={<LensScreen lens={horizon} />} />}
          </Route>
        ))}
        <Route path="/goal/:goalId" element={<GoalDetailScreen />} />
        <Route path="/task/:taskId" element={<TaskPage />} />
        <Route path="/backlog" element={<BacklogScreen />} />
        <Route path="/learnings" element={<LearningsScreen />} />
        <Route path="*" element={<RememberedLens />} />
      </Routes>
      <TabBar />
      <Sheets />
    </div>
  );
}

/**
 * `/` and every unknown path. R-nav-28: a cold start opens the **Weekly** lens at the week containing
 * today; within a session the Goals tab returns to the lens last used, always at the current period.
 *
 * `replace`, so `/` never becomes a back-stack entry you can land on twice.
 */
function RememberedLens() {
  const { lastLens } = useUI();
  const { search } = useLocation();
  return <Navigate to={{ pathname: lensPath(lastLens), search }} replace />;
}
