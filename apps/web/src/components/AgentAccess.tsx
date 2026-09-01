import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { MCP_PATH } from '@goal-cascade/shared';
import { useAgentToken, useCreateAgentToken, useRevokeAgentToken } from '../api/queries';
import { toApiError } from '../api/errors';
import { copyFrom, type CopyResult } from '../lib/clipboard';
import { instantLabel } from '../utils/dates';
import { useSkin } from '../skin';
import { commandError, FieldError } from './states';

/**
 * Agent access — the one API token, inside the Account sheet, as a section above Sign out.
 *
 * **Why here and not in the top-right cluster.** R-nav-11 fixes that cluster at the theme toggle plus at
 * most one primary action, and `TopActions` has already spent its judgement call on the account button. A
 * third icon would be a third; a token you set up once and touch twice a year does not earn one. It sits in
 * the sheet that already holds the other two account-level things — verify this address, sign out — in the
 * order you would reach for them.
 *
 * **Why it is a section and not a second sheet.** `Sheet` installs a document-level capture listener for
 * Escape and Tab. Two mounted sheets means two traps and two Escape handlers racing over one keypress, and
 * `aria-modal` on the outer one hides the inner from assistive tech. So the whole flow — status, password,
 * reveal, revoke — happens inside the Account sheet's own trap. One dialog, one way out, and the reveal is
 * reachable by Tab from the button that asked for it.
 *
 * **The rules the shape comes from.** Exactly one token per account. It is stored hashed, so the plaintext
 * exists on this side of the wire for as long as this component is mounted and nowhere else: not in the
 * query cache (which is persisted to localStorage), not in the mutation's own state (`create.reset()` is
 * called the moment the value is lifted into `phase`), and not recoverable by reopening the sheet.
 * Replacing is one tap and does not need the old token. Re-authentication guards creating and replacing —
 * the two operations that mint a credential — and not reading whether one exists.
 *
 * The states, all eleven: checking · status unreadable · none yet · one exists · password (create) ·
 * password (replace) · working · password refused · revealed · copied · clipboard refused.
 */

type Phase =
  | { kind: 'idle' }
  | { kind: 'password'; intent: 'create' | 'replace' }
  | { kind: 'confirmRevoke' }
  /** The plaintext, held here and nowhere else. Leaving this phase is what makes it gone. */
  | { kind: 'revealed'; token: string; mcpUrl: string };

type Field = 'url' | 'token';

const FIELD_NAME: Record<Field, string> = { url: 'MCP URL', token: 'Token' };

/** How long "Copied" stays on the button. Long enough to read, short enough not to look like a state. */
const COPIED_MS = 2400;

const mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/**
 * The one thing a connector form makes you guess at.
 *
 * Claude Code and the CLI send `Authorization: Bearer`. Claude web's connector UI does not offer that
 * name at all — it makes you pick one header out of a fixed list of api-key spellings. The server
 * accepts every one of them and the bearer form, so there is no wrong answer, and this sentence exists
 * only to say so. It deliberately names NO header: recommending one would imply the others are wrong,
 * and would go stale the day that list changes.
 */
function AuthNote() {
  const S = useSkin();
  return (
    // `S.T.mut` is the app's ordinary quiet grey, held above 4.5:1 on both surfaces by
    // `tests/screens/contrast.test.ts`. A note this minor does not need a colour of its own.
    <p style={{ fontSize: 12, color: S.T.mut, margin: '0 0 10px 0', lineHeight: 1.45 }}>
      Send it as a bearer token or in any usual API-key header — whichever your client offers works.
    </p>
  );
}

/**
 * What a refused create/replace should say next to the password field.
 *
 * The API answers a wrong password with `422 VALIDATION_FAILED` and the same flat sentence
 * `change-password` uses, so that the two cannot become a password oracle by differing
 * (`me.routes.ts`) — and 422 is also what the generic "Couldn't save — check the values." is wired to,
 * which is not a sentence about a password. So it is caught here, together with 401 and 403: whichever of
 * the three arrives, the honest sentence is the same one. `NOT_FOUND` is the older-API case and says so
 * plainly instead of blaming the password.
 */
function refusalCopy(error: unknown): string {
  const err = toApiError(error);
  if (err.status === 401 || err.status === 403 || err.code === 'VALIDATION_FAILED') return "That password doesn't match.";
  if (err.code === 'NOT_FOUND') return "This deployment doesn't offer agent access yet.";
  return commandError(err) ?? "Couldn't do that just now — try again.";
}

export function AgentAccess() {
  const S = useSkin();
  const statusQ = useAgentToken();
  const create = useCreateAgentToken();
  const revoke = useRevokeAgentToken();

  const headingId = useId();
  const urlId = useId();
  const tokenId = useId();
  const passwordId = useId();

  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [password, setPassword] = useState('');
  const [copied, setCopied] = useState<{ field: Field; result: CopyResult } | null>(null);
  /**
   * The polite live region. It carries the two things the design requires a screen reader to hear — the
   * token has appeared, and something was copied — as sentences rather than by reading the secret aloud.
   */
  const [announcement, setAnnouncement] = useState('');

  const urlRef = useRef<HTMLInputElement>(null);
  const tokenRef = useRef<HTMLInputElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  // The secret has just appeared: put the caret in it and select it, so ⌘C works without a single tap —
  // and so the keyboard path to the one thing on screen that matters is zero steps long.
  useEffect(() => {
    if (phase.kind !== 'revealed') return;
    const el = tokenRef.current;
    el?.focus({ preventScroll: true });
    el?.setSelectionRange(0, el.value.length);
  }, [phase.kind]);

  const token = statusQ.data?.token ?? null;
  /**
   * The endpoint, in every state. Never a hardcoded hostname: the status read names it — `mcpUrl` is a
   * REQUIRED field of `ApiTokenStatusResponse` and is present whether or not `token` is null, because
   * `me.routes.ts` derives it from the request origin before it looks at whether a token exists. The
   * fallback below is only for the reads that have not landed or have failed; it is this origin plus
   * `/mcp`, which is right in dev, in preview and in production without a build flag.
   */
  const originMcpUrl = statusQ.data?.mcpUrl ?? (typeof window !== 'undefined' ? `${window.location.origin}${MCP_PATH}` : MCP_PATH);

  const leave = () => {
    setPhase({ kind: 'idle' });
    setPassword('');
    setCopied(null);
    clearTimeout(copiedTimer.current);
  };

  const submitPassword = () => {
    if (!password || create.isPending) return;
    create.mutate(
      { password },
      {
        onSuccess: (data) => {
          const mcpUrl = data.mcpUrl ?? originMcpUrl;
          // `token.plaintext`, nested next to the same `createdAt`/`last4` a status read gives — NOT a flat
          // `token` string. This is the only place the secret ever exists on this side of the wire.
          setPhase({ kind: 'revealed', token: data.token.plaintext, mcpUrl });
          setPassword('');
          // Lift the secret out of the mutation and drop the mutation's copy of it in the same tick.
          create.reset();
          setAnnouncement('Your agent token is ready. It is shown once — copy it now.');
        },
      },
    );
  };

  const onCopy = async (field: Field, value: string) => {
    const result = await copyFrom(value, (field === 'url' ? urlRef : tokenRef).current);
    setCopied({ field, result });
    setAnnouncement(
      result === 'copied'
        ? `${FIELD_NAME[field]} copied to the clipboard.`
        : `Couldn't reach the clipboard. The ${FIELD_NAME[field].toLowerCase()} is selected — press Command C, or Control C, to copy it.`,
    );
    clearTimeout(copiedTimer.current);
    // A refusal stays until it is acted on: it is an instruction, not a confirmation.
    if (result === 'copied') copiedTimer.current = setTimeout(() => setCopied(null), COPIED_MS);
  };

  const busy = create.isPending;

  return (
    <section aria-labelledby={headingId} style={{ borderTop: `1px solid ${S.T.lineSoft}`, paddingTop: 14, marginTop: 6 }}>
      <h3 id={headingId} style={{ ...S.sectionLabel, margin: '0 0 6px 0' }}>
        Agent access
      </h3>

      {/* Visually hidden, deliberately: the two announcements are said once and are not a second UI. */}
      <div
        aria-live="polite"
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}
      >
        {announcement}
      </div>

      {phase.kind === 'revealed' ? (
        <Revealed
          token={phase.token}
          mcpUrl={phase.mcpUrl}
          urlId={urlId}
          tokenId={tokenId}
          urlRef={urlRef}
          tokenRef={tokenRef}
          copied={copied}
          onCopy={onCopy}
          onDone={leave}
        />
      ) : (
        <>
          <p style={{ fontSize: 13, color: S.T.mut, margin: '0 0 10px 0', lineHeight: 1.5 }}>
            One token lets an MCP client read and change this cascade. There is only ever one, and it is stored hashed — so it is shown
            once, when it is made.
          </p>

          {/*
           * The MCP URL, in EVERY state — before a token exists, while one exists, and while the password
           * form is up. It is not a secret: it is the same string for everybody on this deployment, the
           * status read carries it whether or not `token` is null (`ApiTokenStatusResponse.mcpUrl` is
           * required, `me.routes.ts` fills it from the request origin either way), and it is available
           * nowhere else in the product. Rendering it only inside the show-once panel made the endpoint
           * show-once too: dismissing the reveal left replacing a working credential as the only way to
           * read a public string back. Only the token itself is shown once.
           */}
          <CopyRow
            id={urlId}
            label="MCP URL"
            value={originMcpUrl}
            fieldRef={urlRef}
            state={copied?.field === 'url' ? copied.result : null}
            onCopy={() => void onCopy('url', originMcpUrl)}
          />

          <AuthNote />

          {statusQ.isPending && (
            <p style={{ fontSize: 13, color: S.T.mut, margin: '0 0 10px 0' }}>Checking…</p>
          )}

          {statusQ.isError && (
            <div style={{ marginBottom: 10 }}>
              <p style={{ fontSize: 13, color: S.body, margin: '0 0 6px 0' }}>Couldn&rsquo;t check whether a token exists.</p>
              <button type="button" style={S.menuBtn} onClick={() => void statusQ.refetch()}>
                Try again
              </button>
            </div>
          )}

          {statusQ.isSuccess && (
            <p style={{ fontSize: 13, color: token ? S.body : S.T.mut, margin: '0 0 10px 0' }}>
              {token ? `Created ${instantLabel(token.createdAt)} · ends in ${token.last4}` : 'No token yet.'}
            </p>
          )}

          {phase.kind === 'confirmRevoke' && (
            <div style={S.discardBar}>
              <span style={{ flex: 1, minWidth: 150 }}>Revoke this token? Anything using it stops working.</span>
              <button
                type="button"
                style={{ ...S.btn(true, true), minHeight: 36 }}
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(undefined, { onSuccess: leave })}
              >
                {revoke.isPending ? 'Revoking…' : 'Revoke'}
              </button>
              <button type="button" style={{ ...S.btn(false), minHeight: 36 }} onClick={leave}>
                Keep it
              </button>
            </div>
          )}

          {phase.kind === 'password' ? (
            <form
              aria-label={phase.intent === 'replace' ? 'Replace the agent token' : 'Create an agent token'}
              onSubmit={(e) => {
                e.preventDefault();
                submitPassword();
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
            >
              {phase.intent === 'replace' && (
                <p style={{ fontSize: 13, color: S.body, margin: '0 0 2px 0', lineHeight: 1.5 }}>
                  Replacing it stops the current token working straight away.
                </p>
              )}
              <label htmlFor={passwordId} style={S.fieldLabel}>
                Password
              </label>
              <input
                id={passwordId}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={S.input}
              />
              <span style={{ fontSize: 12, color: S.T.mut }}>Confirming it&rsquo;s you, before a new credential is made.</span>
              <FieldError>{create.error ? refusalCopy(create.error) : null}</FieldError>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button type="submit" style={{ ...S.btn(true), flex: 1 }} disabled={!password || busy}>
                  {busy
                    ? phase.intent === 'replace'
                      ? 'Replacing…'
                      : 'Creating…'
                    : phase.intent === 'replace'
                      ? 'Replace token'
                      : 'Create token'}
                </button>
                <button type="button" style={S.btn(false)} disabled={busy} onClick={leave}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            phase.kind === 'idle' && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  style={S.menuBtn}
                  disabled={statusQ.isPending}
                  onClick={() => {
                    create.reset();
                    setPhase({ kind: 'password', intent: token ? 'replace' : 'create' });
                  }}
                >
                  {token ? 'Replace token' : 'Create a token'}
                </button>
                {token && (
                  <button type="button" style={S.dangerBtn} onClick={() => setPhase({ kind: 'confirmRevoke' })}>
                    Revoke
                  </button>
                )}
              </div>
            )
          )}
        </>
      )}
    </section>
  );
}

/**
 * The show-once panel: the MCP URL and the token, each with its own copy affordance, and nothing else.
 *
 * No ready-to-paste client config block. It was proposed and the owner said no: a snippet dates the moment
 * a client changes its config format, and the two values it would wrap are the two values below.
 *
 * Both are `readOnly` inputs rather than `<code>` blocks, which is what makes the clipboard fallback real
 * work rather than a message — the text is already in something focusable and selectable, so "we have
 * selected it, press ⌘C" is a complete instruction with nothing left for the reader to do but press it.
 */
function Revealed({
  token,
  mcpUrl,
  urlId,
  tokenId,
  urlRef,
  tokenRef,
  copied,
  onCopy,
  onDone,
}: {
  token: string;
  mcpUrl: string;
  urlId: string;
  tokenId: string;
  urlRef: RefObject<HTMLInputElement>;
  tokenRef: RefObject<HTMLInputElement>;
  copied: { field: Field; result: CopyResult } | null;
  onCopy: (field: Field, value: string) => void | Promise<void>;
  onDone: () => void;
}) {
  const S = useSkin();
  return (
    <div style={{ background: S.T.paper, border: `1px solid ${S.T.border}`, borderRadius: 12, padding: 12 }}>
      {/*
       * Plain text, and NOT a second live region. A `role="status"` node that is inserted together with its
       * own content is announced unreliably — the region has to pre-exist for the change to be noticed —
       * which is why the announcement is made by the region `AgentAccess` mounts with the section, and this
       * sentence only has to be readable. Two regions here would also say the same thing twice.
       */}
      <p style={{ fontSize: 13, color: S.body, margin: '0 0 12px 0', lineHeight: 1.5 }}>
        This is the only time the token is shown. Copy it now — if it gets away, make a new one.
      </p>

      <CopyRow
        id={urlId}
        label="MCP URL"
        value={mcpUrl}
        fieldRef={urlRef}
        state={copied?.field === 'url' ? copied.result : null}
        onCopy={() => void onCopy('url', mcpUrl)}
      />
      <CopyRow
        id={tokenId}
        label="Token"
        value={token}
        fieldRef={tokenRef}
        state={copied?.field === 'token' ? copied.result : null}
        onCopy={() => void onCopy('token', token)}
      />

      {/* Said here too: this is the screen someone is on while they fill in a connector form. */}
      <AuthNote />

      <button type="button" style={{ ...S.btn(true), width: '100%', marginTop: 12 }} onClick={onDone}>
        Done
      </button>
    </div>
  );
}

function CopyRow({
  id,
  label,
  value,
  fieldRef,
  state,
  onCopy,
}: {
  id: string;
  label: string;
  value: string;
  fieldRef: RefObject<HTMLInputElement>;
  state: CopyResult | null;
  onCopy: () => void;
}) {
  const S = useSkin();
  return (
    <div style={{ marginBottom: 12 }}>
      <label htmlFor={id} style={{ ...S.fieldLabel, display: 'block', marginBottom: 4 }}>
        {label}
      </label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <input
          id={id}
          ref={fieldRef}
          readOnly
          value={value}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          onFocus={(e) => e.currentTarget.select()}
          style={{ ...S.input, flex: 1, minWidth: 0, minHeight: 44, fontSize: 12.5, fontFamily: mono }}
        />
        {/*
         * The accessible name says WHICH value, because there are two of these rows and "Copy" twice is
         * two identical names in one dialog. The visible word stays inside the name (WCAG 2.5.3), so
         * "click Copy" still works for speech control.
         */}
        <button
          type="button"
          aria-label={state === 'copied' ? `${label} copied` : `Copy ${label}`}
          style={{ ...S.btn(false), whiteSpace: 'nowrap' }}
          onClick={onCopy}
        >
          {state === 'copied' ? 'Copied' : 'Copy'}
        </button>
      </div>
      {state === 'copied' && (
        /*
         * The VISIBLE half of the confirmation. The button already flips to "Copied", but the browser
         * walkthrough went looking for feedback and found none it could see — a 12px word swapping inside a
         * control the eye has just left is easy to miss, and the only other channel was the visually-hidden
         * live region. So the confirmation also lands in the slot the refusal uses, right under the value it
         * is about, which is what makes it unambiguous WHICH of the two rows was copied. `S.T.mut` is the
         * app's ordinary quiet grey (4.61:1 on `paper`) — a confirmation does not need a new colour.
         */
        <p style={{ fontSize: 12, color: S.T.mut, margin: '5px 0 0 0', lineHeight: 1.45 }}>Copied to the clipboard.</p>
      )}
      {state === 'unavailable' && (
        // `S.body`: this is an instruction that must be read at 12px. It once said "not the amber
        // `S.warn`" — `warn` is deleted, with the disabled move-sheet reasons that were its only consumer.
        <p style={{ fontSize: 12, fontWeight: 600, color: S.body, margin: '5px 0 0 0', lineHeight: 1.45 }}>
          Couldn&rsquo;t reach the clipboard. It&rsquo;s selected above — press ⌘C, or Ctrl+C, to copy it.
        </p>
      )}
    </div>
  );
}
