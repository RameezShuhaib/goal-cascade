import { describe, expect, it, vi } from 'vitest';
// Vite inlines the file's text, so these read the REAL files — no fs in workerd needed.
import wranglerRaw from '../../wrangler.jsonc?raw';
import containerRaw from '../../src/infrastructure/di/container.ts?raw';
import { IEmailOutboxRepo } from '../../src/application/ports';
import { createEmailSender } from '../../src/infrastructure/di/container';
import { isDeliverableFrom } from '../../src/infrastructure/email/e2e-addresses';
import { createTestApp, env, registrableEmail, uniqueEmail } from '../helpers/app';

/**
 * ── The drift alarm ──────────────────────────────────────────────────────────────────────────────────
 *
 * The owner's sending domain was previously flagged for a critically high bounce rate, caused by this
 * project's own test traffic going to addresses that cannot resolve. A repeat can get the domain banned.
 *
 * Goal Cascade's answer is stronger than the reference codebase's: it does not GUARD the ability to send
 * mail, it does not HAVE it. No `send_email` binding, no provider adapter, no branch that could select
 * one. These tests are cheap and blunt on purpose — each fails the moment a single edit re-opens that
 * door, and each names what to put back. A comment is not a mechanism; this file is.
 */
describe('this Worker is structurally incapable of sending a real email', () => {
  it('wrangler.jsonc declares NO `send_email` binding', () => {
    const stripped = stripComments(wranglerRaw);
    expect(
      /"send_email"\s*:/.test(stripped),
      'a `send_email` binding appeared in wrangler.jsonc — Goal Cascade must have no way to deliver mail',
    ).toBe(false);
  });

  it('wrangler.jsonc declares NO `remote: true` binding', () => {
    // `remote: true` makes `wrangler dev` AND vitest (which loads this file) talk to the live resource.
    expect(stripComments(wranglerRaw), 'no binding may be remote in a dev/test run').not.toMatch(/"remote"\s*:\s*true/);
  });

  it('wrangler.jsonc declares NO cron trigger (this product has no scheduled work)', () => {
    expect(stripComments(wranglerRaw)).not.toMatch(/"crons"\s*:/);
  });

  it('NO email adapter capable of network delivery exists anywhere in the source tree', async () => {
    // The whole `src/` tree, read at build time. A provider adapter would have to live in one of these.
    const modules = import.meta.glob('../../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<
      string,
      string
    >;
    expect(Object.keys(modules).length).toBeGreaterThan(20); // the glob really matched

    const forbidden: Array<[RegExp, string]> = [
      [/resend/i, 'a Resend adapter'],
      [/api\.resend\.com/i, 'a Resend endpoint'],
      [/sendgrid|mailgun|postmark|smtp/i, 'another mail provider'],
      [/EmailMessage/, "Cloudflare's EmailMessage (the send_email binding API)"],
      [/\benv\.EMAIL\b/, 'a use of an EMAIL binding'],
    ];
    for (const [path, source] of Object.entries(modules)) {
      // Comments are stripped first: these files EXPLAIN why there is no Resend/Cloudflare sender, and
      // that documentation must not be what trips the alarm. Only real code counts.
      const code = stripComments(source);
      for (const [pattern, what] of forbidden) {
        expect(pattern.test(code), `${path} contains ${what} — Goal Cascade ships no way to deliver mail`).toBe(false);
      }
    }
  });

  it('`createEmailSender` has no branch that could return a real sender', () => {
    // Belt to the tree scan's braces: the factory is the only place a forward sender could be chosen.
    const code = stripComments(containerRaw);
    expect(code).not.toMatch(/new\s+(Resend|Cloudflare|Smtp)\w*EmailSender/);
    // The `null` positional argument IS the guarantee: `LogEmailSender.forward` can never be set.
    expect(code).toMatch(/new LogEmailSender\([\s\S]*?null,/);
  });

  it('the test environment has no way to reach a mail provider', () => {
    // `AppEnv` has no EMAIL / RESEND_API_KEY member at all — that IS the guarantee. The cast is what
    // lets the test check the runtime environment rather than just the type.
    const runtime = env as unknown as { EMAIL?: unknown; RESEND_API_KEY?: string };
    expect(runtime.EMAIL, 'a `send_email` binding is live under vitest').toBeUndefined();
    expect(runtime.RESEND_API_KEY ?? '', 'RESEND_API_KEY is set under vitest').toBe('');
    expect(isDeliverableFrom(env.EMAIL_FROM), `EMAIL_FROM ${JSON.stringify(env.EMAIL_FROM)} is registrable`).toBe(false);
  });

  it('createEmailSender returns the SINK — `forward` is null, always', () => {
    const sender = createEmailSender(env, createTestApp().container());
    expect(sender.forward, 'a real sender was selected').toBeNull();
    // ...and with a fully "configured-looking" env too: there is no configuration that turns it on.
    const tempting = { ...env, EMAIL_FROM: 'Goal Cascade <hi@rameezshuhaib.com>', RESEND_API_KEY: 're_live_key' } as never;
    expect(createEmailSender(tempting, createTestApp().container()).forward).toBeNull();
  });

  it('behaviourally: a registrable recipient is neither sunk nor put on the wire', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const c = createTestApp().container();
    const to = registrableEmail('drift');

    await createEmailSender(env, c).send({ to, subject: 's', text: 't' });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().map(String).join(' ')).toContain('forwarded=false');
    expect(await c.resolve<IEmailOutboxRepo>(IEmailOutboxRepo).listByTo(to)).toEqual([]);
    vi.restoreAllMocks();
  });

  it('a TEST recipient is sunk to the outbox and still never forwarded', async () => {
    const c = createTestApp().container();
    const to = uniqueEmail('sink');
    await createEmailSender(env, c).send({ to, subject: 'Verify your Goal Cascade email', text: 'https://x/verify' });
    const stored = await c.resolve<IEmailOutboxRepo>(IEmailOutboxRepo).listByTo(to);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.body).toContain('https://x/verify');
  });

  it('outbound HTTP is blocked outright during a test run', () => {
    // `tests/setup/no-real-email.ts`. Even a hand-built sender with a real key could not post.
    expect(() => void fetch('https://api.resend.com/emails', { method: 'POST' })).toThrow(/blocked an outbound request/);
  });
});

/** Strip `//` and block comments so a commented-out binding is not read as a live one — or vice versa. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
