import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { TaskView } from '@goal-cascade/shared';
import { AppShell } from '../../src/AppShell';
import { renderApp } from '../render';
import { requests, server } from '../msw/handlers';
import * as F from '../msw/fixtures';

/**
 * The `aria-modal` contract, exercised through the real provider stack.
 *
 * The browser walkthrough (docs/work/09-e2e-browser, finding A) opened every sheet in the deployed app and
 * found the same thing: `role="dialog" aria-modal="true"` declared, and none of what it promises delivered.
 * Escape did nothing, there was no ✕ and no Cancel, `dialog.contains(document.activeElement)` was `false`
 * immediately after opening, and the only way out was clicking an unmarked strip of page above the sheet.
 * `aria-modal` hides everything outside the dialog from assistive tech, so that combination is a trap: a
 * keyboard or screen-reader user could leave a sheet only by submitting it.
 *
 * These tests are named after the behaviours they protect rather than after `Sheet.tsx`, because the
 * property that matters is "a modal you can leave", not "the component has an onKeyDown". They run against
 * `AppShell` with MSW behind it, so they exercise the sheets as they ship.
 */

function withWeek(tasks: TaskView[] = []) {
  server.use(
    http.get('/api/goals', () => HttpResponse.json(F.treeResponse())),
    http.get('/api/tasks', () => HttpResponse.json({ week: F.week(), tasks, plan: [F.planEntry()], serverNow: F.NOW })),
  );
}

/** Open the task-create sheet from the Tasks screen, and hand back its trigger. */
async function openTaskSheet() {
  withWeek();
  const { user } = renderApp(<AppShell />);
  const trigger = await screen.findByRole('button', { name: '+ Task' });
  await user.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: 'New task' });
  return { user, trigger, dialog };
}

describe('Sheets — a modal you can leave', () => {
  it('Escape closes the sheet, and nothing is submitted on the way out', async () => {
    const { user, dialog } = await openTaskSheet();
    expect(dialog).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(requests('POST', '/api/tasks')).toHaveLength(0);
  });

  it('the header carries a visible ✕ that closes it', async () => {
    const { user, dialog } = await openTaskSheet();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('the backdrop is a real element, and clicking it closes without acting (R-nav-15)', async () => {
    const { user } = await openTaskSheet();
    // Not a gap above the sheet: an element, so the click target is discoverable and hit-testable.
    await user.click(screen.getByTestId('sheet-overlay'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(requests('POST', '/api/tasks')).toHaveLength(0);
  });

  it('focus moves into the sheet on open and returns to the trigger on close', async () => {
    const { user, trigger, dialog } = await openTaskSheet();

    // The walkthrough's exact probe: focus used to still be on the `+ Task` button BEHIND the sheet.
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(within(dialog).getByRole('heading', { name: 'New task' }));

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Where the keyboard user was before they opened it — not the top of the document.
    expect(document.activeElement).toBe(trigger);
  });

  it('Tab cycles inside the sheet and never reaches the page behind it', async () => {
    const { user, trigger, dialog } = await openTaskSheet();
    const close = within(dialog).getByRole('button', { name: 'Close' });
    close.focus();

    const seen = new Set<Element>();
    // More presses than the sheet has stops, so it must wrap rather than walk out into the page.
    for (let i = 0; i < 10; i += 1) {
      await user.tab();
      expect(document.activeElement).not.toBe(trigger);
      expect(dialog.contains(document.activeElement), `Tab #${i + 1} left the dialog`).toBe(true);
      seen.add(document.activeElement!);
    }
    expect(seen.has(close), 'Tab never wrapped back round to the top of the sheet').toBe(true);
  });

  it('Shift+Tab from the first control wraps to the last, not out of the dialog', async () => {
    const { user, trigger, dialog } = await openTaskSheet();
    within(dialog).getByRole('button', { name: 'Close' }).focus();

    await user.tab({ shift: true });

    expect(document.activeElement).not.toBe(trigger);
    expect(dialog.contains(document.activeElement)).toBe(true);
    // Backwards out of the ✕ lands on the last stop in the sheet — the wrap, not the page. That stop is
    // the done-condition field, not `Save task`: this app disables a lot of buttons on purpose (an empty
    // title here, an invalid Move target), and a disabled control is not a stop on the way round.
    expect(within(dialog).getByRole('button', { name: 'Save task' })).toBeDisabled();
    expect(document.activeElement).toBe(within(dialog).getByLabelText('Done-condition (optional)'));
  });

  it('the dialog is named by the heading it actually renders', async () => {
    const { dialog } = await openTaskSheet();
    const heading = within(dialog).getByRole('heading', { name: 'New task' });
    // `aria-labelledby` rather than a hand-written `aria-label`: the accessible name cannot drift away from
    // the visible title, because it IS the visible title.
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.getAttribute('aria-labelledby')).toBe(heading.id);
  });

  it('every sheet inherits it — the goal, move and confirm sheets close on Escape too', async () => {
    withWeek([F.task()]);
    const { user } = renderApp(<AppShell />);

    // Goal form, from the Goals tab.
    await user.click(screen.getByRole('button', { name: 'Goals' }));
    await user.click(await screen.findByRole('button', { name: '+ New goal' }));
    expect(await screen.findByRole('dialog', { name: 'New goal' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Task detail, from the Tasks tab, and then the exit confirm nested behind it.
    await user.click(screen.getByRole('button', { name: 'Tasks' }));
    await user.click(await screen.findByText('Book the Tuesday slot'));
    expect(await screen.findByRole('dialog', { name: 'Task detail' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Move to Backlog' }));
    expect(await screen.findByRole('dialog', { name: 'Move to Backlog' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('Sheets — Escape asks before discarding real work, and never traps you', () => {
  it('the task detail sheet confirms once when its form is dirty, then lets go', async () => {
    withWeek([F.task()]);
    const { user } = renderApp(<AppShell />);
    await user.click(await screen.findByText('Book the Tuesday slot'));
    const sheet = await screen.findByRole('dialog', { name: 'Task detail' });

    // The one sheet you can sit in and write paragraphs — losing this silently would be losing real work.
    await user.type(within(sheet).getByLabelText('Description'), 'ask about the 7am slot');
    await user.keyboard('{Escape}');

    expect(screen.getByRole('dialog', { name: 'Task detail' })).toBeInTheDocument();
    expect(within(sheet).getByText('Discard your unsaved edits?')).toBeInTheDocument();

    // Keep editing puts you back where you were, with the draft intact.
    await user.click(within(sheet).getByRole('button', { name: 'Keep editing' }));
    expect(within(sheet).queryByText('Discard your unsaved edits?')).not.toBeInTheDocument();
    expect(within(sheet).getByLabelText('Description')).toHaveValue('ask about the 7am slot');

    // And the escape hatch is never a dead end: ask once, then out. A trap is worse than a lost draft.
    await user.keyboard('{Escape}');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(requests('PATCH', '/api/tasks/')).toHaveLength(0);
  });

  it('an untouched detail sheet closes on the first Escape — the prompt is for typed work only', async () => {
    withWeek([F.task()]);
    const { user } = renderApp(<AppShell />);
    await user.click(await screen.findByText('Book the Tuesday slot'));
    await screen.findByRole('dialog', { name: 'Task detail' });

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('R-nav-14: a sheet whose only field is an optional reason never asks twice', async () => {
    withWeek([F.task()]);
    const { user } = renderApp(<AppShell />);
    await user.click(await screen.findByText('Book the Tuesday slot'));
    await user.click(await screen.findByRole('button', { name: 'Cancel task' }));
    const sheet = await screen.findByRole('dialog', { name: 'Cancel task' });

    // "No mandatory fields. Fast and guilt-free" cuts both ways: a one-line optional reason is not work
    // this product may guard the exit with. Nothing in the flow is ever mandatory, including a confirmation.
    await user.type(within(sheet).getByLabelText('Reason (optional)'), 'overtaken by events');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('Discard your unsaved edits?')).not.toBeInTheDocument();
    expect(requests('POST', '/cancel')).toHaveLength(0);
  });
});
