import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { AppShell } from '../../src/AppShell';
import { renderApp } from '../render';
import { apiError, bodyOf, lastRequest, requests, server } from '../msw/handlers';
import * as F from '../msw/fixtures';

/**
 * Creation — **R-nav-32 and R-task-48/49.**
 *
 * ⚠ **There is ONE entry point now.** The two the file was written against — the cluster row's
 * `+ <Horizon> goal` and the per-group one — are the clutter the owner named: *"we dont need `+ Monthly
 * goal` everywhere as it looks too clutered. instead we can use what we already have top right to add
 * monthly goals where I'll select the lense (defaults to the lense based on my current page) and the
 * goal."* So `+ Goal` sits in the cluster, at every lens, and its sheet carries a horizon selector
 * defaulting to the lens, a read-only period chip and the one goal picker.
 *
 * The knowledge the per-group create supplied — *which line* — is not lost: it is supplied by
 * preselection when there is one legal parent (A9's nearest legal ancestor) and by a searchable, grouped
 * picker when there are many, which is strictly more capable than a button that guessed.
 */

/** The one create action, at any lens. `findByRole`, singular — there is exactly one of it now. */
const openCreate = async (user: ReturnType<typeof renderApp>['user']) => {
  await user.click(await screen.findByRole('button', { name: '+ Goal' }));
  return screen.findByRole('dialog', { name: 'New goal' });
};

describe('Creating a goal (R-nav-32)', () => {
  it('the heading is `New goal`, the horizon defaults to the lens, and the period is a read-only chip', async () => {
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    const sheet = await openCreate(user);

    // ⚠ **The horizon picker is BACK, and it is a chip group, not a heading.** It defaults to the lens.
    const horizons = within(sheet).getByRole('radiogroup', { name: 'Horizon' });
    expect(within(horizons).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Life', 'Yearly', 'Quarterly', 'Monthly', 'Weekly']);
    expect(within(horizons).getByRole('radio', { name: 'Quarterly' })).toHaveAttribute('aria-checked', 'true');
    // R-goal-33 — the period is still not an editable text field. That field is what let you type
    // `Q9 3026`, which under the canonical key would put the goal in NO lens at all.
    expect(within(sheet).queryByLabelText('Target period')).not.toBeInTheDocument();
    expect(within(sheet).getByText("Because you're looking at Q3 2026.")).toBeInTheDocument();
  });

  /**
   * §3.5 — **changing the horizon re-clamps the period through R-lens-9, re-scopes the picker, and
   * clears a parent that is no longer legal with a stated reason.** All four steps, in one test, because
   * they are one interaction.
   */
  it('R-nav-32 (A9): the default parent waits for EVERY horizon read, not whichever lands first', async () => {
    /*
     * Found in a browser, not by this suite. `useParentOptions` issues ONE query per legal horizon and
     * they settle independently; the default-parent effect ran on the first non-empty option list and
     * then could never re-run, so a new Monthly goal in Sep 2026 defaulted to the YEARLY goal for 2026
     * whenever Yearly beat Quarterly. Every mock resolving in the same tick is exactly what hid it, so
     * this test makes Quarterly land LAST — the ordering that actually happened.
     */
    server.use(
      http.get('/api/goals', async ({ request }) => {
        const lens = new URL(request.url).searchParams.get('lens') ?? 'Monthly';
        if (lens === 'Quarterly') await delay(60);
        return HttpResponse.json(F.lensFor(lens as 'Quarterly'));
      }),
    );

    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });
    const sheet = await openCreate(user);

    // The Quarterly goal, not the Yearly one that resolved 60ms earlier.
    await waitFor(() => expect(within(sheet).getByRole('button', { name: /^Choose a goal: Rebuild the gym habit/ })).toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it('R-nav-32: changing the horizon re-clamps the period and clears an illegal parent, out loud', async () => {
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });
    const sheet = await openCreate(user);

    // The nearest legal ancestor for a Monthly goal in Aug 2026 is Q3 2026's Quarterly goal (A9).
    await within(sheet).findByRole('button', { name: /^Choose a goal: Rebuild the gym habit/ });
    expect(within(sheet).getByText("Because you're looking at Aug 2026.")).toBeInTheDocument();

    await user.click(within(sheet).getByRole('radio', { name: 'Quarterly' }));

    // 1 — the period re-clamped by R-lens-9's own function, and says where it came from.
    expect(within(sheet).getByText('Q3 2026')).toBeInTheDocument();
    expect(within(sheet).getByText('Closest to Aug 2026, the month on screen.')).toBeInTheDocument();
    /*
     * 3 — a Quarterly goal cannot sit under a Quarterly one, so the chosen parent is cleared, **out loud**.
     *
     * ⚠ **DIVERGENCE from `29-ux-navigation` §3.5, recorded.** The plan says the picker "returns to its
     * unselected state". It does not: A9's nearest-legal-ancestor default re-applies at the new horizon,
     * because leaving it unselected would reintroduce the exact defect A9 was written to fix — *nothing
     * selected, with the roving ring sitting on a Life goal, looking chosen*. The plan's own principle is
     * honoured in full and is what is asserted: **nothing changes underneath in silence.** The sentence
     * names what was cleared and why, and the row beside it names what is chosen now.
     */
    expect(await within(sheet).findByText("Cleared — a Quarterly goal can't sit under a Quarterly one.")).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /^Choose a goal: Get back under 80kg/ })).toBeInTheDocument();
    // 4 — `Save goal` re-evaluates against the new parent, and needs a title like any other create.
    expect(within(sheet).getByRole('button', { name: 'Save goal' })).toBeDisabled();
    await user.type(within(sheet).getByLabelText('Goal title'), 'Something');
    expect(within(sheet).getByRole('button', { name: 'Save goal' })).toBeEnabled();

    // 2 — the picker re-scoped: a Monthly goal is no longer offered at any horizon.
    await user.click(within(sheet).getByRole('button', { name: /^Choose a goal/ }));
    const picker = await screen.findByRole('dialog', { name: 'Choose a goal' });
    expect(within(picker).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Life', 'Yearly']);
  });

  /** §3.8 — nothing may be created into a period and then vanish from the screen that created it. */
  it('R-nav-32 / R-nav-19: a goal created at another horizon moves the app to that lens and period', async () => {
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });
    const sheet = await openCreate(user);
    await within(sheet).findByRole('button', { name: /^Choose a goal:/ });

    await user.click(within(sheet).getByRole('radio', { name: 'Quarterly' }));
    await user.type(within(sheet).getByLabelText('Goal title'), 'Rebuild the base');
    await user.click(await within(sheet).findByRole('button', { name: /^Choose a goal/ }));
    const picker = await screen.findByRole('dialog', { name: 'Choose a goal' });
    await user.click(within(picker).getByRole('option', { name: /^Get back under 80kg/ }));
    await user.click(within(sheet).getByRole('button', { name: 'Save goal' }));

    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/api/goals'))).toMatchObject({ horizon: 'Quarterly', periodKey: '2026-Q3' }));
    // The lens moved with it: staying on Monthly would read as a lost write.
    expect(await screen.findByRole('tab', { name: 'Quarterly', selected: true })).toBeInTheDocument();
    expect(screen.getByTestId('lens-period')).toHaveTextContent('Q3 2026');
  });

  /** §3.4 — one tab stop, arrows along the axis the chips run, the selection announced not just coloured. */
  it('R-nav-32: the horizon selector is one tab stop, and arrows move and select', async () => {
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    const sheet = await openCreate(user);
    const horizons = within(sheet).getByRole('radiogroup', { name: 'Horizon' });

    expect(within(horizons).getAllByRole('radio').filter((r) => (r as HTMLElement).tabIndex === 0)).toHaveLength(1);
    within(horizons).getByRole('radio', { name: 'Quarterly' }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(within(horizons).getByRole('radio', { name: 'Yearly' })).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{Home}');
    expect(within(horizons).getByRole('radio', { name: 'Life' })).toHaveAttribute('aria-checked', 'true');
    // Life has neither a period nor a parent (R-goal-3), so both fields leave the sheet.
    expect(within(sheet).queryByText('UNDER')).not.toBeInTheDocument();
    expect(within(sheet).queryByText(/Because you're looking at|Closest to/)).not.toBeInTheDocument();
  });

  /**
   * ⚠ **A9 — the two halves of this now sit on two surfaces, and both are asserted.**
   *
   * In the SHEET the picker is one row naming the current choice; the legal parents live in the picker it
   * opens. That is the fix to the owner's flooded sheet, and it is why the option assertions moved one tap
   * in.
   */
  it('S-goal-5-1: the parent picker lists only legal parents in the enclosing period', async () => {
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    const sheet = await openCreate(user);

    // A9 — inside the sheet: a row, never a list. The form's other fields keep their space.
    const field = await within(sheet).findByRole('button', { name: /^Choose a goal/ });
    expect(within(sheet).queryByRole('option')).not.toBeInTheDocument();
    await user.click(field);
    const picker = await screen.findByRole('dialog', { name: 'Choose a goal' });

    // A Quarterly goal's legal parents are the Life goals and the Yearly goals of the enclosing year, and
    // A9 scopes them by horizon: the selector offers exactly those two and opens on the more specific.
    expect(within(picker).getByRole('radio', { name: /^Yearly/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(picker).getByRole('radio', { name: /^Life/ })).toHaveAttribute('aria-checked', 'false');
    expect(within(picker).queryByRole('radio', { name: /^Quarterly/ })).not.toBeInTheDocument();
    expect(within(picker).queryByRole('radio', { name: /^Monthly/ })).not.toBeInTheDocument();

    // ⚠ **R-nav-31** — the rows are `role="option"` in one listbox, and each name carries the Life line
    // and the period, so two same-titled goals in different lines are one utterance apart.
    expect(await within(picker).findByRole('option', { name: 'Get back under 80kg — Be strong at 60 · Yearly · 2026' })).toBeInTheDocument();
    await user.click(within(picker).getByRole('radio', { name: /^Life/ }));
    expect(within(picker).getByRole('option', { name: /^Be strong at 60/ })).toBeInTheDocument();
    // Never a shorter or equal horizon: a Monthly goal cannot parent a Quarterly one (R-goal-5), and A9
    // does not smuggle one in behind a horizon chip — there is no chip for it to hide behind.
    expect(within(picker).queryByRole('option', { name: /Lift three times a week/ })).not.toBeInTheDocument();
  });

  /**
   * ⚠ **A9 — defect 2: the default parent is the NEAREST legal ancestor.**
   *
   * The owner, creating a Monthly goal in `Sep 2026`, saw the Life goal at the top of the list looking
   * chosen. It was not chosen — nothing was, because §6.7 preselected only when exactly one parent was
   * legal, and the roving-focus ring on row 0 (which is a Life goal) did the rest.
   */
  it('A9: a new Monthly goal defaults its parent to the QUARTERLY goal of the enclosing quarter', async () => {
    const { user } = renderApp(<AppShell />, { route: '/month/2026-09' });
    const sheet = await openCreate(user);

    // Q3 2026's `Rebuild the gym habit`, not the Life goal above it and not nothing at all.
    expect(await within(sheet).findByRole('button', { name: /^Choose a goal: Rebuild the gym habit/ })).toBeInTheDocument();

    await user.type(within(sheet).getByLabelText('Goal title'), 'Deadlift twice a week');
    await user.click(within(sheet).getByRole('button', { name: 'Save goal' }));
    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/api/goals'))).toMatchObject({ parentId: F.Q, periodKey: '2026-09' }));
  });

  it('A9: the picker opens ON that horizon, with the default parent already selected in it', async () => {
    const { user } = renderApp(<AppShell />, { route: '/month/2026-09' });
    const sheet = await openCreate(user);
    await user.click(await within(sheet).findByRole('button', { name: /^Choose a goal:/ }));
    const picker = await screen.findByRole('dialog', { name: 'Choose a goal' });

    // The horizon follows the choice, so reopening shows you where your goal lives rather than resetting.
    expect(within(picker).getByRole('radio', { name: /^Quarterly/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(picker).getByRole('option', { name: /^Rebuild the gym habit/ })).toHaveAttribute('aria-selected', 'true');
    // Every legal horizon is offered, and no illegal one is: a Monthly goal cannot parent a Monthly goal.
    expect(within(picker).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Life', 'Yearly', 'Quarterly']);
  });

  /**
   * ⚠ **A9 — the default is the MOST SPECIFIC legal horizon that has something, at every subject horizon.**
   * A Weekly goal may hang off any of the four longer horizons (R-goal-32), and the one it usually hangs
   * off is the nearest.
   */
  it('A9: a new Weekly goal offers all four longer horizons and opens on Monthly', async () => {
    const { user } = renderApp(<AppShell />, { route: '/week/2026-08-31' });
    const sheet = await openCreate(user);
    await user.click(await within(sheet).findByRole('button', { name: /^Choose a goal/ }));
    const picker = await screen.findByRole('dialog', { name: 'Choose a goal' });

    expect(within(picker).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Life', 'Yearly', 'Quarterly', 'Monthly']);
    expect(within(picker).getByRole('radio', { name: /^Monthly/ })).toHaveAttribute('aria-checked', 'true');
    // Scoped, so the Life goal is not on screen until its own horizon is chosen — or until you search.
    expect(within(picker).queryByRole('option', { name: /^Be strong at 60/ })).not.toBeInTheDocument();
    expect(within(picker).getByRole('option', { name: /^Lift three times a week/ })).toBeInTheDocument();
  });

  /**
   * ⚠ **REWRITTEN — was `the per-group create knows the line as well as the period`.**
   *
   * **Verdict: superseded by the owner's own reversal, recorded against `R-nav-25` (amended) and
   * `R-nav-32` (new).** There is no per-group create: *"we dont need `+ Monthly goal` everywhere as it
   * looks too clutered."* What that entry point knew — the LINE — is supplied instead by A9's nearest
   * legal ancestor and by the picker's own grouping, which is what this now asserts. Both are strictly
   * more capable than a button that guessed, and the write it produces is byte for byte the same.
   */
  it('R-nav-32: the one create still knows the period, defaults the line, and writes the canonical key', async () => {
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');
    const sheet = await openCreate(user);

    // A9 — the nearest legal ancestor is already the default, so the line is legible on the row without
    // opening anything: `Rebuild the gym habit` is Q3 2026's Quarterly goal in `Be strong at 60`.
    await user.click(await within(sheet).findByRole('button', { name: /^Choose a goal: Rebuild the gym habit/ }));
    const picker = await screen.findByRole('dialog', { name: 'Choose a goal' });
    expect(within(picker).getByRole('option', { name: /^Rebuild the gym habit/ })).toHaveAttribute('aria-selected', 'true');
    await user.click(within(picker).getByRole('radio', { name: /^Yearly/ }));
    // Both lines are offered now, each row naming its own — which is what replaces the group foot.
    expect(within(picker).getByRole('option', { name: /^Get back under 80kg/ })).toBeInTheDocument();
    expect(within(picker).getByRole('option', { name: /^Launch v1/ })).toBeInTheDocument();

    await user.click(within(picker).getByRole('button', { name: '‹ New goal' }));
    await user.type(within(sheet).getByLabelText('Goal title'), 'Deadlift twice a week');
    await user.click(within(sheet).getByRole('button', { name: 'Save goal' }));

    await waitFor(async () => {
      const body = await bodyOf(lastRequest('POST', '/api/goals'));
      // ⚠ **A2** — `periodKey`, never `period`: the label is server-derived and there is no `period`
      // field on any request schema at all (S-goal-33-3).
      expect(body).toMatchObject({ horizon: 'Monthly', periodKey: '2026-08', parentId: F.Q, title: 'Deadlift twice a week' });
      expect(body).not.toHaveProperty('period');
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Added to Aug 2026');
  });

  it('R-goal-3: a Life goal is created with no parent and no period', async () => {
    const { user } = renderApp(<AppShell />, { route: '/life' });
    const sheet = await openCreate(user);
    // §3.4 — the selector defaults to the lens, so the Life lens opens on `Life`. Exactly the owner's ask.
    expect(within(sheet).getByRole('radio', { name: 'Life' })).toHaveAttribute('aria-checked', 'true');
    expect(within(sheet).queryByText('UNDER')).not.toBeInTheDocument();

    await user.type(within(sheet).getByLabelText('Goal title'), 'Stay curious');
    await user.click(within(sheet).getByRole('button', { name: 'Save goal' }));

    await waitFor(async () => {
      const body = await bodyOf(lastRequest('POST', '/api/goals'));
      expect(body).toMatchObject({ title: 'Stay curious', horizon: 'Life', parentId: null });
      expect(body).not.toHaveProperty('periodKey');
    });
  });

  /**
   * §3.6 — **the no-legal-parent state is expected UNREACHABLE, and is built anyway.**
   *
   * Unreachable because a Life goal is a legal parent at every other horizon (R-goal-32), so the moment
   * any Life goal exists every horizon has one; and with none, the sheet opens on the Life lens at
   * horizon `Life`, which has no `UNDER` at all. It takes an empty account AND a non-Life lens to reach.
   *
   * ⚠ **It is INLINE now, not a whole-sheet takeover.** With a horizon selector on screen the user's
   * escape is to pick a different horizon rather than to leave, so taking the sheet over would remove the
   * cheaper way out.
   */
  it('§3.6: with nothing to hang it on, `UNDER` says so inline and still closes the loop in one tap', async () => {
    server.use(http.get('/api/goals', ({ request }) => HttpResponse.json(F.lens({ lens: (new URL(request.url).searchParams.get('lens') ?? 'Weekly') as 'Life', items: [] }))));
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    const sheet = await openCreate(user);

    expect(await within(sheet).findByText('Nothing to hang a Quarterly goal on yet — it needs a Life or Yearly goal above it.')).toBeInTheDocument();
    // The escape the selector adds: still inside the sheet, and every other field is still there.
    expect(within(sheet).getByRole('radiogroup', { name: 'Horizon' })).toBeInTheDocument();
    expect(within(sheet).getByLabelText('Goal title')).toBeInTheDocument();

    // …and the handoff still must not drop the intent: it goes to Life AND opens the sheet there.
    await user.click(within(sheet).getByRole('button', { name: 'Start with a Life goal →' }));
    expect(await screen.findByRole('dialog', { name: 'New goal' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Life', selected: true })).toBeInTheDocument();
  });

  it('S-goal-29-1 / R-goal-36: a refusal is stated at the form, never swallowed', async () => {
    server.use(http.post('/api/goals', () => apiError('PERIOD_IN_PAST')));
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    const sheet = await openCreate(user);
    // A9 — the nearest legal ancestor is already chosen, so the refusal is reached without a parent tap.
    await within(sheet).findByRole('button', { name: /^Choose a goal: Get back under 80kg/ });
    await user.type(within(sheet).getByLabelText('Goal title'), 'Something');
    await user.click(within(sheet).getByRole('button', { name: 'Save goal' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That period has already passed');
  });
});

/**
 * R-task-57 — **`+ Task` from a Monthly goal.** A month task on the goal you tapped, by default; and a
 * week task under a resolved (or minted) Weekly goal when the owner names one of the month's weeks.
 */
/**
 * ⚠ **A8/A11 — the THREE tests below are restated, not weakened, and here is the verdict for all three.**
 *
 * `R-task-49` is **retired in full by A8** (`R-task-51`, `R-task-57`): a Monthly goal holds the task
 * itself, so there is nothing to infer. `R-task-57` as amended by A11 (`32-week-selection` §8.3, and the
 * owner's own ruling on its §9.2) makes **the month the first option of `When this lands` and the
 * default**, so the zero-decision path is now the zero-inference one: one row, on the goal you tapped, in
 * the month you are looking at.
 *
 * The inference each of these covers is therefore no longer the DEFAULT — it is what happens **after the
 * owner names one of the month's weeks**, which is `R-task-48`'s surviving flow (one of the three that
 * still names a week). So each test gains one tap on the week chip and **keeps every assertion it had**,
 * plus a new one for the default it displaced. Nothing is deleted and nothing is loosened.
 */
describe('Creating a task from a Monthly goal — the month by default, a week by choice (R-task-57/48)', () => {
  /**
   * ⚠ **A8/A11 — the default, which is the state the three tests below then narrow AWAY from.**
   *
   * `+ Task` on a Monthly goal creates **one row** on the goal that was tapped: no picker, no resolution,
   * no implicitly created Weekly goal, and — because the task lands on the very card that was tapped —
   * **the lens does not move** (R-task-57). `newWeeklyGoal` can never fire as a side effect of accepting
   * this default, which is the defect R-rm-6 deletes.
   */
  it('R-task-57: the MONTH is the default, and it creates one row on the goal you tapped', async () => {
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');
    await user.click(screen.getAllByRole('button', { name: '+ Task' })[0]!);
    const sheet = await screen.findByRole('dialog', { name: 'New task' });

    // The month is the FIRST option and it is checked; the week is offered beside it, never instead of it.
    const chips = within(sheet).getByRole('radiogroup', { name: 'When this lands' });
    expect(within(chips).getByRole('radio', { name: 'Aug 2026 — the whole month, no particular week' })).toBeChecked();
    expect(within(sheet).getByText('Lands in Aug 2026 — no particular week.')).toBeInTheDocument();
    // With no week there is nothing to resolve: no goal row, and no sentence about a goal being created.
    expect(within(sheet).queryByRole('button', { name: /^Choose a goal/ })).not.toBeInTheDocument();
    expect(within(sheet).queryByText(/This starts a weekly goal/)).not.toBeInTheDocument();

    await user.type(within(sheet).getByLabelText('What needs doing?'), 'Book the gym induction');
    await user.click(within(sheet).getByRole('button', { name: 'Save task' }));

    await waitFor(async () => {
      const body = await bodyOf(lastRequest('POST', '/api/tasks'));
      expect(body).toMatchObject({ goalId: F.M, period: '2026-08', title: 'Book the gym induction' });
      expect(body).not.toHaveProperty('newWeeklyGoal');
    });
    // R-task-57 — the lens does NOT move: the row is on the card that was tapped.
    expect(screen.getByRole('tab', { name: 'Monthly', selected: true })).toBeInTheDocument();
  });

  it('with NO weekly goal in the target week, one is created — and the sheet says so before you save', async () => {
    server.use(
      http.get('/api/goals', ({ request }) => {
        const lens = new URL(request.url).searchParams.get('lens') ?? 'Weekly';
        // Nothing under the Monthly goal this week, which is the "none" row of R-task-49's table.
        if (lens === 'Weekly') return HttpResponse.json(F.lens({ lens: 'Weekly', period: F.period({ periodKey: F.THIS_MONDAY }), items: [] }));
        return HttpResponse.json(F.lensFor(lens as 'Monthly'));
      }),
    );
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');
    await user.click(screen.getAllByRole('button', { name: '+ Task' })[0]!);

    const sheet = await screen.findByRole('dialog', { name: 'New task' });
    // ⚠ **A11** — the week is now an explicit narrowing. One tap, and everything below is unchanged.
    await user.click(within(sheet).getByRole('radio', { name: 'Week of 31 Aug' }));
    // Nothing may be created invisibly (R-task-48/49's surviving half) — and at zero candidates the note
    // is BOTH rendered and announced, which is why it appears twice: once on screen, once in the sheet's
    // `role="status"`. It already names the week, so it is announced alone rather than paired with the
    // destination line, which would say `31 Aug` three times in one utterance.
    const note = await within(sheet).findAllByText('This starts a weekly goal "Lift three times a week" for the week of 31 Aug. You can rename it after.');
    expect(note).toHaveLength(2);
    // ⚠ **A9** — and the week is named on the ZERO-candidate row too, with the month it belongs to.
    expect(within(sheet).getByText('WHERE THIS GOES')).toBeInTheDocument();
    expect(within(sheet).getByText('Lands in the week of 31 Aug · Aug 2026.')).toBeInTheDocument();

    await user.type(within(sheet).getByLabelText('What needs doing?'), 'Tuesday easy 6k');
    server.use(
      http.post(
        '/api/tasks',
        cmdJson(() =>
          HttpResponse.json(F.createTaskResponse({ title: 'Tuesday easy 6k' }, F.weeklyGoal({ id: F.ulid(55), title: 'Lift three times a week' })), { status: 201 }),
        ),
      ),
    );
    await user.click(within(sheet).getByRole('button', { name: 'Save task' }));

    await waitFor(async () => {
      const body = await bodyOf(lastRequest('POST', '/api/tasks'));
      // R-task-48's wire: exactly one of `goalId` or `newWeeklyGoal`, and NO week field of any kind.
      expect(body).toMatchObject({ newWeeklyGoal: { parentId: F.M, title: 'Lift three times a week' }, period: F.THIS_MONDAY, title: 'Tuesday easy 6k' });
      expect(body).not.toHaveProperty('goalId');
      // ⚠ **A8 (R-task-52)** — `period` is a canonical key and the format is the discriminator. There is
      // still no `week` offset, at either scope.
      expect(body).not.toHaveProperty('week');
    });

    // Named after: the toast names the week, and the live region names the goal that was made for it.
    const toast = await screen.findByRole('status');
    // R-nav-24 — the toast and the lens title three lines below now name the week identically.
    expect(toast).toHaveTextContent('Added to week of 31 Aug');
    expect(toast).toHaveTextContent('under Lift three times a week');
    // R-nav-19 / R-task-41 — and the app MOVES to that week. Staying put would read as a lost write.
    expect(await screen.findByRole('tab', { name: 'Weekly', selected: true })).toBeInTheDocument();
    expect(screen.getByTestId('lens-period')).toHaveTextContent('Week of 31 Aug');
  });

  /**
   * ⚠ **A9 — defect 3, and the worst of the four.**
   *
   * This test used to be called *"with exactly ONE weekly goal it is used silently"*, and it asserted the
   * absence: no picker, no field, nothing said. That absence is the defect. The owner added three tasks
   * from a Monthly goal, was never told which weekly goal or which week they went to, and could not find
   * them again. **One candidate is not a choice; it is still an ANSWER, and the answer was what was owed.**
   */
  it('A9: with exactly ONE weekly goal it is named as a FILLED choice — never used silently', async () => {
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');
    await user.click(screen.getAllByRole('button', { name: '+ Task' })[0]!);

    const sheet = await screen.findByRole('dialog', { name: 'New task' });
    // ⚠ **A11** — the week is chosen, not defaulted to. The rest of this test is unchanged.
    await user.click(within(sheet).getByRole('radio', { name: 'Week of 31 Aug' }));
    await waitFor(() => expect(within(sheet).queryByText(/This starts a weekly goal/)).not.toBeInTheDocument());

    // The destination, before saving: the weekly goal, the week, and the month that week belongs to.
    expect(await within(sheet).findByText('WHERE THIS GOES')).toBeInTheDocument();
    const field = within(sheet).getByRole('button', { name: /^Choose a goal: Three easy runs and one long run/ });
    expect(field).toBeInTheDocument();
    expect(within(sheet).getByText('Lands in the week of 31 Aug · Aug 2026.')).toBeInTheDocument();

    // And a way to change it: the same row opens the same picker, with the one candidate selected in it.
    await user.click(field);
    const picker = await screen.findByRole('dialog', { name: 'Choose a goal' });
    expect(within(picker).getByRole('option', { name: /^Three easy runs and one long run/ })).toHaveAttribute('aria-selected', 'true');
    await user.click(within(picker).getByRole('button', { name: '‹ New task' }));

    await user.type(within(sheet).getByLabelText('What needs doing?'), 'Tuesday easy 6k');
    await user.click(within(sheet).getByRole('button', { name: 'Save task' }));

    await waitFor(async () => {
      const body = await bodyOf(lastRequest('POST', '/api/tasks'));
      expect(body).toMatchObject({ goalId: F.W, period: F.THIS_MONDAY, title: 'Tuesday easy 6k' });
      expect(body).not.toHaveProperty('newWeeklyGoal');
    });
  });

  it('with MORE than one, the first is preselected — one tap to change, zero to accept', async () => {
    server.use(
      http.get('/api/goals', ({ request }) => {
        const lens = new URL(request.url).searchParams.get('lens') ?? 'Weekly';
        if (lens === 'Weekly')
          return HttpResponse.json(
            F.lens({
              lens: 'Weekly',
              period: F.period({ periodKey: F.THIS_MONDAY }),
              items: [F.weeklyGoal(), F.weeklyGoal({ id: F.ulid(56), title: 'Two gym sessions' })],
              groups: [F.group({ id: F.L })],
            }),
          );
        return HttpResponse.json(F.lensFor(lens as 'Monthly'));
      }),
    );
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');
    await user.click(screen.getAllByRole('button', { name: '+ Task' })[0]!);

    const sheet = await screen.findByRole('dialog', { name: 'New task' });
    // ⚠ **A11** — one tap on the week chip; the same block, the same two facts, at every candidate count.
    expect(await within(sheet).findByText('WHERE THIS GOES')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('radio', { name: 'Week of 31 Aug' }));
    // `find`, not `get`: the chosen week's candidates are a read, so the row it fills arrives a tick later.
    expect(await within(sheet).findByRole('button', { name: /^Choose a goal: Three easy runs and one long run/ })).toBeInTheDocument();
    expect(within(sheet).getByText('Lands in the week of 31 Aug · Aug 2026.')).toBeInTheDocument();
    await user.type(within(sheet).getByLabelText('What needs doing?'), 'Tuesday easy 6k');
    await user.click(within(sheet).getByRole('button', { name: 'Save task' }));

    // Accepting the preselection costs zero taps, and it is the FIRST, never an arbitrary one.
    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/api/tasks'))).toMatchObject({ goalId: F.W, period: F.THIS_MONDAY }));
  });

  it('R-task-3: a title and no done-condition is enough, and a blank title cannot be saved', async () => {
    const { user } = renderApp(<AppShell />, { route: '/week/2026-08-31' });
    await user.click(await screen.findByRole('button', { name: '+ Task' }));
    const sheet = await screen.findByRole('dialog', { name: 'New task' });

    expect(within(sheet).getByRole('button', { name: 'Save task' })).toBeDisabled();
    await user.type(within(sheet).getByLabelText('What needs doing?'), 'Tuesday easy 6k');
    await user.click(within(sheet).getByRole('button', { name: 'Save task' }));

    await waitFor(async () => {
      const body = await bodyOf(lastRequest('POST', '/api/tasks'));
      expect(body).toMatchObject({ goalId: F.W, title: 'Tuesday easy 6k', cond: '' });
      // Q-8 — no client-minted id, and A2 adds: no week of any kind (S-task-40-3).
      expect(body).not.toHaveProperty('id');
      expect(body).not.toHaveProperty('week');
      expect(body).not.toHaveProperty('originWeek');
    });
  });

  it('R-task-49: the dead end is gone — there is no "this branch isn\'t active this week" anywhere', async () => {
    server.use(
      http.get('/api/goals', ({ request }) => {
        const lens = new URL(request.url).searchParams.get('lens') ?? 'Weekly';
        if (lens === 'Weekly') return HttpResponse.json(F.lens({ lens: 'Weekly', period: F.period({ periodKey: F.THIS_MONDAY }), items: [] }));
        return HttpResponse.json(F.lensFor(lens as 'Monthly'));
      }),
    );
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');
    await user.click(screen.getAllByRole('button', { name: '+ Task' })[0]!);
    await screen.findByRole('dialog', { name: 'New task' });

    // The state that used to send the owner to a planning screen no longer exists: the thing the work
    // needed to hang off is created for it.
    expect(screen.queryByText(/isn't active this week/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set a weekly focus' })).not.toBeInTheDocument();
    expect(requests('GET', '/api/plan')).toHaveLength(0);
  });
});

/** MSW's `cmd` wrapper, re-declared locally where a test needs to override a command handler. */
function cmdJson(respond: () => Response) {
  return ({ request }: { request: Request }) =>
    request.headers.get('Idempotency-Key') ? respond() : apiError('IDEMPOTENCY_KEY_MISSING');
}
