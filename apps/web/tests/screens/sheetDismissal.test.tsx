import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { AppShell } from '../../src/AppShell';
import { renderApp } from '../render';
import { requests } from '../msw/handlers';

/**
 * The `aria-modal` contract, exercised through the real provider stack.
 *
 * The browser walkthrough (docs/work/09-e2e-browser, finding A) found every sheet declaring
 * `role="dialog" aria-modal="true"` and implementing none of what that promises: Escape did nothing, there
 * was no ✕, focus never entered the dialog, and the only exit was an unmarked strip of page above it.
 * `aria-modal` hides everything OUTSIDE the dialog from assistive tech, so that combination is a trap.
 *
 * ⚠ **A2** — the sheet these tests used to be written against is deleted. Task detail is a **page**
 * (R-task-45), so the "sheet with typed work in it" case now lives on the task page and is asserted in
 * `taskPage.test.tsx`; what remains here is the contract every surviving sheet inherits from `Sheet`, plus
 * the newest one (the Zoom sheet, R-lens-17), which must inherit it unchanged rather than reinvent it.
 */

/** Open the task-create sheet from the Weekly lens, and hand back its trigger. */
async function openTaskSheet() {
  const app = renderApp(<AppShell />, { route: '/week/2026-08-31' });
  const trigger = await screen.findByRole('button', { name: '+ Task' });
  await app.user.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: 'New task' });
  return { ...app, trigger, dialog };
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
    await user.click(screen.getByTestId('sheet-overlay'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(requests('POST', '/api/tasks')).toHaveLength(0);
  });

  it('focus moves into the sheet on open and returns to the trigger on close', async () => {
    const { user, trigger, dialog } = await openTaskSheet();

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
    for (let i = 0; i < 10; i += 1) {
      await user.tab();
      expect(document.activeElement).not.toBe(trigger);
      expect(dialog.contains(document.activeElement), `Tab #${i + 1} left the dialog`).toBe(true);
      seen.add(document.activeElement!);
    }
    expect(seen.has(close), 'Tab never wrapped back round to the top of the sheet').toBe(true);
  });

  it('the dialog is named by the heading it actually renders', async () => {
    const { dialog } = await openTaskSheet();
    const heading = within(dialog).getByRole('heading', { name: 'New task' });
    // `aria-labelledby` rather than a hand-written `aria-label`: the accessible name cannot drift away
    // from the visible title, because it IS the visible title.
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.getAttribute('aria-labelledby')).toBe(heading.id);
  });

  it('the heading takes focus for the screen reader without drawing a ring round itself', async () => {
    const { dialog } = await openTaskSheet();
    const heading = within(dialog).getByRole('heading', { name: 'New task' });
    expect(document.activeElement).toBe(heading);
    expect(heading).toHaveAttribute('tabindex', '-1');
    // At `flex: 1` the app's own `:focus-visible` outline drew a full-width green box across the sheet.
    expect(heading.style.outline).toBe('none');

    const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'index.html'), 'utf8');
    expect(html).toContain(':where(a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])):focus-visible');
  });

  it('every sheet inherits it — the goal form, the drawer and the Zoom sheet close on Escape too', async () => {
    const { user } = renderApp(<AppShell />, { route: '/week/2026-08-31' });

    // `[0]` — the cluster row's create, which DOM order puts ahead of the group feet that share its name.
    await user.click((await screen.findAllByRole('button', { name: '+ Weekly goal' }))[0]!);
    expect(await screen.findByRole('dialog', { name: 'New Weekly goal' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('dialog', { name: 'Add to Backlog' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    /**
     * R-lens-17 — the Zoom sheet is the newest surface in the product and it is the EXISTING `Sheet`, so
     * it inherits the whole contract rather than reinventing half of it. Focus also returns to the lens
     * title, which is what makes the lens change announce itself (§8.2).
     */
    const title = screen.getByRole('button', { name: 'Weekly lens, Week of 31 Aug. Change lens or period.' });
    await user.click(title);
    expect(await screen.findByRole('dialog', { name: 'Change lens' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(title);
  });

  it('R-nav-14: a sheet whose only field is an optional reason never asks twice', async () => {
    const { user } = renderApp(<AppShell />, { route: '/week/2026-08-31' });
    await user.click(await screen.findByText('Tuesday easy 6k'));
    await screen.findByRole('heading', { level: 1, name: 'Book the Tuesday slot' });
    await user.click(screen.getByRole('button', { name: 'Cancel task' }));
    const sheet = await screen.findByRole('dialog', { name: 'Cancel task' });

    // "No mandatory fields. Fast and guilt-free" cuts both ways: a one-line optional reason is not work
    // this product may guard the exit with.
    await user.type(within(sheet).getByLabelText('Reason (optional)'), 'overtaken by events');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('Discard your unsaved edits?')).not.toBeInTheDocument();
    expect(requests('POST', '/cancel')).toHaveLength(0);
  });

  it('a held Escape cannot answer a question it just asked — on the page that asks one', async () => {
    const { user } = renderApp(<AppShell />, { route: '/week/2026-08-31' });
    await user.click(await screen.findByText('Tuesday easy 6k'));
    await screen.findByRole('heading', { level: 1, name: 'Book the Tuesday slot' });
    await user.type(screen.getByLabelText('Description'), 'paragraphs of it');

    // Held down, Escape auto-repeats at roughly 30/s. If a repeat counted as the second press, the strip
    // would appear and be answered inside one keypress and the draft would be gone before the question
    // had been read — the only path from "strip up" to "discarded" the user never chose.
    await user.keyboard('{Escape}');
    for (let i = 0; i < 5; i += 1) fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape', repeat: true });

    expect(screen.getByText('Discard your unsaved edits?')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toHaveValue('paragraphs of it');

    // Still never a dead end: a deliberate second press leaves, exactly as before.
    await user.keyboard('{Escape}');
    expect(await screen.findByText('Three easy runs and one long run')).toBeInTheDocument();
  });
});
