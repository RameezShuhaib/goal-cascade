import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { AppShell } from '../../src/AppShell';
import { renderApp } from '../render';
import { apiError, bodyOf, lastRequest, requests, server } from '../msw/handlers';
import * as F from '../msw/fixtures';

/**
 * The task page (R-task-45, CR-5) — a full screen with its own URL, not a drawer.
 *
 * `TaskDetailSheet` is deleted, not moved: task detail is a route, and no sheet in this product shows it
 * (S-rm-5-1). The three ways back are equivalent, and all of them land where you came from.
 */

const withWeek = () => server.use(http.get('/api/goals', () => HttpResponse.json(F.weeklyLens())));

/** Open the page the way a person does: from a task row in the Weekly lens. */
async function openFromLens() {
  withWeek();
  const app = renderApp(<AppShell />, { route: '/week/2026-08-31' });
  await app.user.click(await screen.findByText('Tuesday easy 6k'));
  await screen.findByRole('heading', { level: 1, name: 'Book the Tuesday slot' });
  return app;
}

describe('The task page — a route, not a sheet (S-task-45-1)', () => {
  it('a task row navigates to a page, and nothing about it is a dialog', async () => {
    await openFromLens();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
    // R-nav-25 — the page carries the top-right cluster, which goal detail used to omit.
    expect(screen.getByRole('button', { name: 'Toggle dark mode' })).toBeInTheDocument();
  });

  it('§8.2: arriving moves focus to the page title, without drawing a ring round it', async () => {
    await openFromLens();
    const h1 = screen.getByRole('heading', { level: 1, name: 'Book the Tuesday slot' });
    expect(document.activeElement).toBe(h1);
    expect(h1).toHaveAttribute('tabindex', '-1');
    expect(h1.style.outline).toBe('none');
  });

  it('R-task-45: the back control NAMES where you came from, and three ways all lead there', async () => {
    const { user } = await openFromLens();
        /**
     * ⚠ R-nav-24 — this asserted `Week of Mon 31 Aug`, the server's canonical period label with a
     * weekday spliced into it. R-nav-24 gives the server the human form (`PeriodView.label`), and the
     * lens one tap away reads `Week of 31 Aug`: the same week, named two ways, one navigation apart.
     * The weekday form is the CARRY label (`since Mon 24 Aug`) and stays exactly where it was.
     */
    const back = screen.getByRole('button', { name: '‹ Week of 31 Aug' });
    await user.click(back);
    expect(await screen.findByText('Three easy runs and one long run')).toBeInTheDocument();

    // …and Escape does the same thing.
    await user.click(await screen.findByText('Tuesday easy 6k'));
    await screen.findByRole('heading', { level: 1, name: 'Book the Tuesday slot' });
    await user.keyboard('{Escape}');
    expect(await screen.findByText('Three easy runs and one long run')).toBeInTheDocument();
  });

  it('S-task-45-2: opened COLD by URL, back lands on the week the task is actually visible in', async () => {
    withWeek();
    server.use(
      http.get('/api/tasks/:id', () =>
        HttpResponse.json(F.taskResponse({ id: F.ulid(21), goalId: F.WC, title: 'Find a route with no traffic lights', originPeriodKey: F.THREE_WEEKS_AGO, carryAge: 3 })),
      ),
    );
    const { user } = renderApp(<AppShell />, { route: `/task/${F.ulid(21)}` });
    await screen.findByRole('heading', { level: 1, name: 'Find a route with no traffic lights' });

    // Never the current week: landing somewhere the task is not visible would read as a broken link.
    await user.click(screen.getByRole('button', { name: '‹ Week of 10 Aug' }));
    /**
     * R-lens-14 — arriving here settles through TWO reads, not one: the lens loads `2026-08-10`, then
     * rewrites the address bar to the server's own canonical period key (`replace`) and loads THAT. The
     * body is unmounted and remounted in between.
     *
     * ⚠ The assertion is `waitFor(getBy…)` rather than `expect(await findBy…)` for that exact reason, and
     * it is a strengthening rather than a relaxation: `findBy` resolves with the element it saw on one
     * tick, and the second read can detach that element before the matcher runs — which fails as
     * "could not be found in the document" on a screen that is about to be perfectly correct. This
     * retries the whole assertion instead of trusting one snapshot of it. (It went red intermittently at
     * HEAD too; it is not a new race.)
     */
    await waitFor(() => expect(screen.getByText('Three easy runs and one long run')).toBeInTheDocument());
  });

  it('R-task-45: the context line is the ancestry the task lost by leaving the tree, in one line', async () => {
    await openFromLens();
    // Both segments are tappable: the Life goal to its page, the weekly goal back to its week.
    expect(await screen.findByRole('button', { name: 'Be strong at 60' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Three easy runs and one long run' })).toBeInTheDocument();
  });
});

describe('The task page — exit 1 given a second home (R-task-50)', () => {
  it('the checkbox is on the page, and completing there returns to the lens with the toast', async () => {
    const { user } = await openFromLens();
    await user.click(screen.getByRole('button', { name: 'Complete Book the Tuesday slot' }));

    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/complete'))).toMatchObject({ period: F.THIS_MONDAY }));
    // The reason the page was opened is now finished, so it hands you back to the week.
    expect(await screen.findByRole('status')).toHaveTextContent('Done');
    expect(await screen.findByText('Three easy runs and one long run')).toBeInTheDocument();
  });

  it('R-task-13: it is still exactly three exits — the page adds a home, not a fourth way out', async () => {
    await openFromLens();
    expect(screen.getByRole('button', { name: 'Complete Book the Tuesday slot' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move to Backlog' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel task' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /defer|snooze|reschedul/i })).not.toBeInTheDocument();
  });

  it('R-task-44: a task whose week has not arrived renders no checkbox on its page either', async () => {
    withWeek();
    server.use(http.get('/api/tasks/:id', () => HttpResponse.json(F.taskResponse({ completable: false, carryAge: -1, originPeriodKey: F.NEXT_MONDAY }))));
    renderApp(<AppShell />, { route: `/task/${F.ulid(20)}` });
    await screen.findByRole('heading', { level: 1, name: 'Book the Tuesday slot' });

    expect(screen.queryByRole('button', { name: /^Complete /})).not.toBeInTheDocument();
    // ⚠ the signed age again: nothing renders below 1, and nothing reads "-1 weeks".
    expect(screen.queryByText(/since |weeks ·/)).not.toBeInTheDocument();
  });

  it('S-task-17-1: a done task offers neither of the other two exits, but stays editable', async () => {
    withWeek();
    server.use(http.get('/api/tasks/:id', () => HttpResponse.json(F.taskResponse({ status: 'done', done: true, donePeriodKey: F.THIS_MONDAY, doneAt: F.NOW }))));
    renderApp(<AppShell />, { route: `/task/${F.ulid(20)}` });
    await screen.findByRole('heading', { level: 1, name: 'Book the Tuesday slot' });

    expect(screen.queryByRole('button', { name: 'Move to Backlog' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel task' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toBeEnabled();
  });

  it('S-task-15-1 / R-backlog-29: Move to Backlog names the goal ABOVE the week, and keeps the record', async () => {
    withWeek();
    const { user } = renderApp(<AppShell />, { route: `/task/${F.ulid(20)}` });
    await screen.findByRole('heading', { level: 1, name: 'Book the Tuesday slot' });
    await user.click(screen.getByRole('button', { name: 'Move to Backlog' }));

    const sheet = await screen.findByRole('dialog', { name: 'Move to Backlog' });
    // The item lands on the nearest non-Weekly ancestor: "move to backlog" means NOT THIS WEEK, and a
    // Weekly goal IS a week, so landing it there would be a no-op wearing an exit's clothes.
    expect(within(sheet).getByText(/Lift three times a week’s backlog/)).toBeInTheDocument();

    await user.type(within(sheet).getByLabelText('Reason (optional)'), 'not this month after all');
    await user.click(within(sheet).getByRole('button', { name: 'Move it' }));

    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/move-to-backlog'))).toMatchObject({ period: F.THIS_MONDAY, reason: 'not this month after all' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Moved to Backlog — reason noted');
    // D-15 — nothing was deleted: the task keeps its row so the timeline entry has a home.
    expect(requests('DELETE', '/api/tasks')).toHaveLength(0);
  });

  it('S-backlog-29-2: with no legal target the exit is refused and says so; Cancel stays available', async () => {
    withWeek();
    server.use(http.post('/api/tasks/:id/move-to-backlog', () => apiError('LIFE_GOAL_NO_BACKLOG')));
    const { user } = renderApp(<AppShell />, { route: `/task/${F.ulid(20)}` });
    await screen.findByRole('heading', { level: 1, name: 'Book the Tuesday slot' });
    await user.click(screen.getByRole('button', { name: 'Move to Backlog' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Move to Backlog' })).getByRole('button', { name: 'Move it' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Backlog items live on a Yearly, Quarterly or Monthly goal');
  });
});

describe('The task page — editing, and the draft it must not lose', () => {
  it('S-task-23-1: only changed fields are sent, and the timeline is rendered as the server wrote it', async () => {
    withWeek();
    server.use(
      http.get('/api/tasks/:id', () =>
        HttpResponse.json(
          F.taskResponse({
            events: [
              { id: F.ulid(31), kind: 'renamed', at: F.NOW, text: 'Renamed: “Book a slot” → “Book the Tuesday slot”', glyph: '✎', detail: null },
              { id: F.ulid(30), kind: 'created', at: F.NOW, text: 'Created — added to a goal', glyph: '＋', detail: null },
            ],
          }),
        ),
      ),
    );
    const { user } = renderApp(<AppShell />, { route: `/task/${F.ulid(20)}` });
    await screen.findByRole('heading', { level: 1, name: 'Book the Tuesday slot' });

    expect(screen.getByText('Renamed: “Book a slot” → “Book the Tuesday slot”')).toBeInTheDocument();
    // S-task-46-1 — `Created — weekly planning` is retired: there is no planning screen (R-task-46).
    expect(screen.getByText('Created — added to a goal')).toBeInTheDocument();
    expect(screen.queryByText(/weekly planning|from an Idea/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Description'), 'ask about the 7am slot');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(async () => {
      const body = await bodyOf(lastRequest('PATCH', '/api/tasks/'));
      expect(body).toMatchObject({ description: 'ask about the 7am slot' });
      expect(body).not.toHaveProperty('title');
      expect(body).not.toHaveProperty('cond');
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Task updated');
  });

  it('R-task-45: leaving with unsaved edits raises the same strip a sheet does — and is never a dead end', async () => {
    const { user } = await openFromLens();
    await user.type(screen.getByLabelText('Description'), 'ask about the 7am slot');

    await user.keyboard('{Escape}');
    expect(screen.getByText('Discard your unsaved edits?')).toBeInTheDocument();
    // Still on the page, and the draft is intact.
    expect(screen.getByLabelText('Description')).toHaveValue('ask about the 7am slot');

    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByText('Discard your unsaved edits?')).not.toBeInTheDocument();

    // Ask once, then out. A trap is worse than a lost draft.
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(await screen.findByText('Three easy runs and one long run')).toBeInTheDocument();
    expect(requests('PATCH', '/api/tasks/')).toHaveLength(0);
  });

  it('R-task-24 / D-13: a link is added by URL and removed by ID, and a bad URL is stated at the field', async () => {
    withWeek();
    server.use(
      http.get('/api/tasks/:id', () => HttpResponse.json(F.taskResponse({ links: [{ id: F.ulid(70), url: 'https://www.github.com/acme/pr/1', createdAt: F.NOW }] }))),
      http.post('/api/tasks/:id/links', () => apiError('VALIDATION_FAILED', 'invalid', { issues: [{ message: 'link must be http(s)' }] })),
    );
    const { user } = renderApp(<AppShell />, { route: `/task/${F.ulid(20)}` });
    await screen.findByRole('heading', { level: 1, name: 'Book the Tuesday slot' });

    expect(screen.getByText('github.com')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Link URL'), 'not-a-url');
    await user.click(screen.getByRole('button', { name: 'Add link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('link must be http(s)');

    await user.click(screen.getByRole('button', { name: 'Remove link github.com' }));
    await waitFor(() => expect(lastRequest('DELETE', '/links/')?.url).toContain(F.ulid(70)));
  });
});

/**
 * ⚠ **A8 — the task page opened COLD on a month task.**
 *
 * A month task's `originPeriodKey` is a month key, and this page uses it for two things: the label on the
 * back control and its destination. A8 fixed the label (`Aug 2026` rather than `Week of NaN Aug`) and
 * left the destination `lensPath('Weekly', …)` → `/week/2026-08`, which `validKeyFor` drops as
 * non-canonical for the Weekly lens — so the control **named one place and went to another**. That is
 * worse than the state before, where both halves were visibly broken and neither could be trusted.
 *
 * Reachable today: a month task exists the moment one is created over MCP or HTTP, and `/task/:id` is a
 * real address (R-task-45) that a pasted link or a reload arrives at with no `location.state`.
 */
describe('A8 — a MONTH task on its own page (R-task-45, R-task-52)', () => {
  const monthTask = () =>
    F.taskDetail({
      id: F.ulid(21),
      goalId: F.M,
      title: 'Sign two clients',
      scope: 'Monthly',
      originPeriodKey: '2026-08',
      carryUnit: 'months',
      carryAge: 0,
      completable: true,
    });

  const openCold = async () => {
    server.use(http.get('/api/tasks/:id', () => HttpResponse.json(F.taskResponse(monthTask()))));
    const app = renderApp(<AppShell />, { route: `/task/${F.ulid(21)}` });
    await screen.findByRole('heading', { level: 1, name: 'Sign two clients' });
    return app;
  };

  it('R-task-52 — the back control names its MONTH and goes to the Monthly lens at that month', async () => {
    /**
     * The lens the tap lands on is asserted by what it RENDERS, because `MemoryRouter` leaves
     * `window.location` alone — and rendering is the property anyway: `/week/2026-08` is not a week, so
     * the Weekly lens dropped the key and fell back to the current week, which is a link that lied.
     * Reading the Monthly lens's own heading is the only way to tell the two apart.
     */
    const monthly = new Promise<string>((resolve) => {
      server.use(
        http.get('/api/goals', ({ request }) => {
          const url = new URL(request.url);
          if (url.searchParams.get('lens') === 'Monthly') resolve(url.searchParams.get('period') ?? '');
          return HttpResponse.json(F.lens({ lens: 'Monthly', period: F.period({ horizon: 'Monthly', periodKey: '2026-08' }) }));
        }),
      );
    });

    const app = await openCold();
    await app.user.click(screen.getByRole('button', { name: /Aug 2026/ }));
    expect(await monthly).toBe('2026-08');
  });

  /**
   * ⚠ **The checkbox on this page posts a period, and it must be one of the TASK'S scope.**
   *
   * `useCompleteTask` resolves its `week` offset to a Monday, so completing a month task from here sent
   * `period: '2026-08-31'` and the server refused it with `WEEK_OUT_OF_RANGE` — the scope check doing
   * exactly its job (`assertPeriodFor`). The page renders the checkbox because the wire says
   * `completable: true`, which it correctly is; only the payload was wrong.
   */
  it('R-task-55 — completing a month task posts its MONTH, not a Monday', async () => {
    server.use(http.get('/api/goals', () => HttpResponse.json(F.lens({ lens: 'Monthly' }))));
    const app = await openCold();
    await app.user.click(screen.getByRole('button', { name: 'Complete Sign two clients' }));

    const body = await waitFor(async () => (await bodyOf(lastRequest('POST', '/complete'))) as { period: string });
    // A MONTH key, at the task's own scope. The Monday this page used to send is refused by the
    // server's scope check with `WEEK_OUT_OF_RANGE`, which is that check doing exactly its job.
    expect(body.period).toBe('2026-08');
    expect(body.period).not.toBe(F.THIS_MONDAY);
  });
});
