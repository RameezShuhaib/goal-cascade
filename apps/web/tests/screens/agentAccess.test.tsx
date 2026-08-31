import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { AppShell } from '../../src/AppShell';
import { renderApp } from '../render';
import { apiError, bodyOf, lastRequest, requests, server } from '../msw/handlers';
import * as F from '../msw/fixtures';

/**
 * Agent access — the one API token, in the Account sheet.
 *
 * The properties worth defending, and the reason each one is here:
 *
 *  - **Show once.** The plaintext arrives on a create and lives in one component's state. Closing the sheet
 *    is what destroys it; reopening shows only `last4`. If it ever survived into the query cache it would
 *    be written to localStorage by the persister, and "hash-only" would be a claim about the server alone.
 *  - **Re-authentication guards minting, not looking.** Reading status is an ordinary GET.
 *  - **The clipboard fails.** Not hypothetically: no secure context, no document focus, a policy. jsdom has
 *    no `navigator.clipboard` at all, which makes the failure path the DEFAULT here rather than a path
 *    nobody exercises — so the fallback is tested by construction, and the happy path is the stubbed one.
 *  - **A screen reader hears both events** — the token appearing, and a copy landing — from a polite live
 *    region, in words, without the secret being read aloud.
 */

const openAccount = async (user: ReturnType<typeof renderApp>['user']) => {
  await user.click(await screen.findByRole('button', { name: 'Account' }));
  return screen.findByRole('dialog', { name: 'Account' });
};

/**
 * jsdom ships no `navigator.clipboard` — but `userEvent.setup()` installs one of its own so that its
 * copy/paste helpers work, so a real browser's clipboard is never what these tests meet. Both of these
 * therefore run AFTER `renderApp`, or `userEvent` wins the race and every copy silently succeeds.
 */
function stubClipboard(writeText: (text: string) => Promise<void>) {
  const clipboard = { writeText: vi.fn(writeText) };
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true, writable: true });
  return clipboard;
}

/** An insecure origin — `navigator.clipboard` is not there at all, which is the commonest refusal. */
function removeClipboard() {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true, writable: true });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

const withToken = () => server.use(http.get('/api/me/agent-token', () => HttpResponse.json(F.agentTokenStatus())));

/** Walk through create with the right password and land on the reveal. */
async function reveal(user: ReturnType<typeof renderApp>['user']) {
  await openAccount(user);
  await user.click(await screen.findByRole('button', { name: 'Create a token' }));
  await user.type(screen.getByLabelText('Password'), 'correct horse battery');
  await user.click(screen.getByRole('button', { name: 'Create token' }));
  return screen.findByDisplayValue(F.PLAINTEXT_TOKEN);
}

describe('Agent access — placement', () => {
  it('is a section inside the Account sheet, above Sign out, and not a third icon in the top-right cluster', async () => {
    const { user } = renderApp(<AppShell />);
    const dialog = await openAccount(user);

    const section = within(dialog).getByRole('region', { name: 'Agent access' });
    const signOut = within(dialog).getByRole('button', { name: 'Sign out' });
    expect(section.compareDocumentPosition(signOut) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // R-nav-11 reserves the top-right cluster for the theme toggle plus one primary action, and the account
    // button already spent this app's one judgement call there. Nothing about agent access is in it.
    expect(screen.queryAllByRole('button', { name: /agent|token/i }).filter((b) => !dialog.contains(b))).toHaveLength(0);
  });

  it('reading whether a token exists sends no password and needs no re-authentication', async () => {
    withToken();
    const { user } = renderApp(<AppShell />);
    await openAccount(user);

    expect(await screen.findByText(/ends in 34kt/)).toBeInTheDocument();
    const status = lastRequest('GET', '/api/me/agent-token');
    expect(status).toBeTruthy();
    expect(requests('POST', '/api/me/agent-token')).toHaveLength(0);
  });

  it('with no token it says so, and offers exactly one way forward', async () => {
    const { user } = renderApp(<AppShell />);
    await openAccount(user);

    expect(await screen.findByText('No token yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create a token' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });

  it('a status read that fails says so and offers a retry, rather than pretending there is no token', async () => {
    server.use(http.get('/api/me/agent-token', () => apiError('INTERNAL', 'boom')));
    const { user } = renderApp(<AppShell />);
    await openAccount(user);

    expect(await screen.findByText(/Couldn’t check whether a token exists/)).toBeInTheDocument();
    server.use(http.get('/api/me/agent-token', () => HttpResponse.json(F.agentTokenStatus())));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/ends in 34kt/)).toBeInTheDocument();
  });
});

describe('Agent access — creating and replacing', () => {
  it('creating asks for the password, sends it through the command wrapper, and shows the token once', async () => {
    const { user } = renderApp(<AppShell />);
    await reveal(user);

    const body = await bodyOf(lastRequest('POST', '/api/me/agent-token'));
    expect(body).toEqual({ password: 'correct horse battery' });
    // The `useCommand` wrapper is what puts the key on it — a form that called the client directly would
    // have none, which is the shape of a bug this codebase has already had once.
    expect(lastRequest('POST', '/api/me/agent-token')?.headers.get('Idempotency-Key')).toBeTruthy();
  });

  it('the MCP URL is this origin plus /mcp — never a hardcoded hostname', async () => {
    const { user } = renderApp(<AppShell />);
    await reveal(user);

    expect(screen.getByLabelText('MCP URL')).toHaveValue(`${window.location.origin}/mcp`);
  });

  it('and the server’s own mcpUrl wins when it names one', async () => {
    server.use(http.get('/api/me/agent-token', () => HttpResponse.json({ token: null, mcpUrl: 'https://goals.example.test/mcp' })));
    const { user } = renderApp(<AppShell />);
    await reveal(user);

    expect(screen.getByLabelText('MCP URL')).toHaveValue('https://goals.example.test/mcp');
  });

  it('shows the MCP URL and the token and nothing else — no ready-to-paste config block', async () => {
    const { user } = renderApp(<AppShell />);
    const tokenField = await reveal(user);

    expect(tokenField).toHaveValue(F.PLAINTEXT_TOKEN);
    expect(screen.getByLabelText('MCP URL')).toBeInTheDocument();
    // The design proposed one and the owner said no. Two values, two copy buttons, nothing to paste around.
    expect(document.querySelector('pre')).toBeNull();
    expect(screen.queryByText(/mcpServers|"command"|npx/)).not.toBeInTheDocument();
  });

  it('SHOW ONCE: closing the Account sheet destroys the plaintext — reopening shows only the last four', async () => {
    // A stateful status, as the real one is: no token until one is made, and only ever `last4` after.
    let exists = false;
    server.use(
      http.get('/api/me/agent-token', () => HttpResponse.json(exists ? F.agentTokenStatus() : { token: null })),
      http.post('/api/me/agent-token', () => {
        exists = true;
        return HttpResponse.json(F.agentTokenCreated(), { status: 201 });
      }),
    );
    const { user } = renderApp(<AppShell />);
    await reveal(user);

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Account' })).not.toBeInTheDocument());
    expect(screen.queryByDisplayValue(F.PLAINTEXT_TOKEN)).not.toBeInTheDocument();

    await openAccount(user);
    expect(await screen.findByText(/ends in 34kt/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue(F.PLAINTEXT_TOKEN)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Token')).not.toBeInTheDocument();
  });

  it('and the plaintext never reaches the query cache, which is persisted to localStorage', async () => {
    const { user, queryClient } = renderApp(<AppShell />);
    await reveal(user);

    expect(JSON.stringify(queryClient.getQueryData(['agentToken']))).not.toContain(F.PLAINTEXT_TOKEN);
    expect(JSON.stringify(queryClient.getQueryCache().getAll().map((q) => q.state.data))).not.toContain(F.PLAINTEXT_TOKEN);
  });

  it('a wrong password is refused next to the field, with no token shown and no toast', async () => {
    server.use(http.post('/api/me/agent-token', () => apiError('FORBIDDEN', 'wrong password')));
    const { user } = renderApp(<AppShell />);
    await openAccount(user);

    await user.click(await screen.findByRole('button', { name: 'Create a token' }));
    await user.type(screen.getByLabelText('Password'), 'not it');
    await user.click(screen.getByRole('button', { name: 'Create token' }));

    expect(await screen.findByText("That password doesn't match.")).toBeInTheDocument();
    expect(screen.queryByLabelText('Token')).not.toBeInTheDocument();
    expect(screen.queryByText("That isn't allowed.")).not.toBeInTheDocument();
  });

  it('replacing says what replacing costs, and still asks for the password', async () => {
    withToken();
    const { user } = renderApp(<AppShell />);
    await openAccount(user);

    await user.click(await screen.findByRole('button', { name: 'Replace token' }));
    expect(screen.getByText(/stops the current token working straight away/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Replace token' }));

    expect(await screen.findByDisplayValue(F.PLAINTEXT_TOKEN)).toBeInTheDocument();
  });

  it('revoking asks once, then sends the idempotent DELETE', async () => {
    withToken();
    const { user } = renderApp(<AppShell />);
    await openAccount(user);

    await user.click(await screen.findByRole('button', { name: 'Revoke' }));
    expect(screen.getByText(/Anything using it stops working/)).toBeInTheDocument();
    // Asking once means the way out is offered beside it.
    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(requests('DELETE', '/api/me/agent-token')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(requests('DELETE', '/api/me/agent-token')).toHaveLength(1));
  });
});

describe('Agent access — copying', () => {
  it('a copy that works confirms on the button and is announced', async () => {
    const { user } = renderApp(<AppShell />);
    await reveal(user);
    const clipboard = stubClipboard(async () => {});

    await user.click(screen.getByRole('button', { name: 'Copy Token' }));
    expect(clipboard.writeText).toHaveBeenCalledWith(F.PLAINTEXT_TOKEN);
    expect(await screen.findByRole('button', { name: 'Token copied' })).toHaveTextContent('Copied');
    expect(screen.getByText('Token copied to the clipboard.')).toBeInTheDocument();
  });

  it('the MCP URL has its own copy affordance, separate from the token’s', async () => {
    const { user } = renderApp(<AppShell />);
    await reveal(user);
    const clipboard = stubClipboard(async () => {});

    await user.click(screen.getByRole('button', { name: 'Copy MCP URL' }));
    expect(clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/mcp`);
    // Confirming one does not confirm the other.
    expect(await screen.findByRole('button', { name: 'MCP URL copied' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Token' })).toBeInTheDocument();
  });

  it('CLIPBOARD REFUSED: the value is selected, the two keys are named, and a reader is told', async () => {
    const { user } = renderApp(<AppShell />);
    const tokenField = await reveal(user);
    // Permission denied — a policy, a document that lost focus, Safari outside the gesture.
    stubClipboard(async () => {
      throw new DOMException('Write permission denied.', 'NotAllowedError');
    });

    await user.click(screen.getByRole('button', { name: 'Copy Token' }));

    expect(await screen.findByText(/press ⌘C, or Ctrl\+C, to copy it/)).toBeInTheDocument();
    // Not merely "we couldn't" — the text is focused and selected, so the two keys are all that is left.
    expect(tokenField).toHaveFocus();
    expect((tokenField as HTMLInputElement).selectionStart).toBe(0);
    expect((tokenField as HTMLInputElement).selectionEnd).toBe(F.PLAINTEXT_TOKEN.length);
    expect(screen.getByText(/Couldn't reach the clipboard\. The token is selected — press Command C/)).toBeInTheDocument();
    // The button does not claim success it did not have.
    expect(screen.getByRole('button', { name: 'Copy Token' })).toHaveTextContent('Copy');
  });

  it('and with no clipboard API at all (an insecure origin) the same fallback carries it', async () => {
    const { user } = renderApp(<AppShell />);
    await reveal(user);
    removeClipboard();

    await user.click(screen.getByRole('button', { name: 'Copy MCP URL' }));
    expect(await screen.findByText(/press ⌘C, or Ctrl\+C, to copy it/)).toBeInTheDocument();
  });
});

describe('Agent access — keyboard and screen reader', () => {
  it('the reveal announces itself, and puts the caret in the token so ⌘C needs no tap', async () => {
    const { user } = renderApp(<AppShell />);
    const tokenField = await reveal(user);

    expect(screen.getByText('Your agent token is ready. It is shown once — copy it now.')).toBeInTheDocument();
    expect(screen.getByText(/This is the only time the token is shown/)).toBeInTheDocument();
    expect(tokenField).toHaveFocus();
  });

  it('the whole flow is reachable by keyboard, inside the Account sheet’s own focus trap', async () => {
    const { user } = renderApp(<AppShell />);
    const dialog = await openAccount(user);

    // Tab from the sheet heading until the create button is reached; the trap keeps every stop inside.
    const create = await screen.findByRole('button', { name: 'Create a token' });
    for (let i = 0; i < 12 && document.activeElement !== create; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    expect(create).toHaveFocus();

    // Enter opens the password form; Enter in the field submits it, without ever touching a mouse.
    await user.keyboard('{Enter}');
    const field = await screen.findByLabelText('Password');
    field.focus();
    await user.keyboard('correct horse battery{Enter}');

    expect(await screen.findByDisplayValue(F.PLAINTEXT_TOKEN)).toBeInTheDocument();
  });

  it('Escape closes the Account sheet, and the token goes with it', async () => {
    const { user } = renderApp(<AppShell />);
    await reveal(user);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Account' })).not.toBeInTheDocument());
    expect(screen.queryByDisplayValue(F.PLAINTEXT_TOKEN)).not.toBeInTheDocument();
  });
});
