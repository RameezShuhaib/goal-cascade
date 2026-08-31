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
 * one. A comment is not a mechanism; this file is.
 *
 * ── What this file learned the hard way (2026-08-31 review) ──────────────────────────────────────────
 * The first version of this file was a KEYWORD FILTER, and a review defeated it four different ways
 * while it stayed green: rename the class (`OutboundDeliveryAdapter`), split the token
 * (`['re','send'].join('')`), use a file extension the glob missed, or — worst — wrap a live adapter
 * between two string constants `'/*'` and `'*​/'`, because the comment stripper was a regex that did not
 * respect string literals and silently deleted the code before the scan saw it.
 *
 * So the checks are now in two tiers, and the tier that matters cannot be talked around:
 *
 *  A. **CAPABILITY, on RAW text.** No file under `src/` may contain a bare `fetch(`, a socket, a mail
 *     binding API, or a dynamic import. A name-based check asks "does this look like Resend?"; this one
 *     asks "can this reach the network at all?", which is the actual invariant. It runs on the source
 *     exactly as written, with no stripping, so no stripping bug can hide anything from it. A false
 *     positive here is a loud failure with an obvious fix, which is the correct direction to fail.
 *  B. **NAMES, on comment-stripped text.** These files EXPLAIN why there is no Resend adapter, and that
 *     documentation must not trip the alarm — so this tier alone is stripped, by a string-aware
 *     stripper rather than a regex.
 */

/** Every source file under `src/`, read at build time. Any adapter would have to live in one of these. */
const SOURCES = import.meta.glob('../../src/**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** The complete, intended contents of the email layer. A fourth file is a finding by itself. */
const EMAIL_LAYER = ['e2e-addresses.ts', 'log-email-sender.ts', 'templates.ts'];

describe('this Worker is structurally incapable of sending a real email', () => {
  it('the source glob really matched the tree (a typo here would make every scan below vacuous)', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(20);
    // Named anchors, so widening or narrowing the glob cannot silently drop the files that matter.
    for (const anchor of [
      '../../src/infrastructure/email/log-email-sender.ts',
      '../../src/infrastructure/di/container.ts',
      '../../src/worker.ts',
    ]) {
      expect(Object.keys(SOURCES), `${anchor} is not covered by the glob`).toContain(anchor);
    }
  });

  it('wrangler.jsonc declares NO `send_email` binding', () => {
    expect(
      /"send_email"\s*:/.test(stripComments(wranglerRaw)),
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

  // ── Tier A: capability, on raw text ────────────────────────────────────────────────────────────────

  it('TIER A — NO file under `src/` can reach the network at all', () => {
    /**
     * Deliberately name-blind. A renamed provider adapter, a token-split URL, a `.mts` file and a
     * comment-syntax trick all defeat a keyword list; none of them defeats "there is no way to make an
     * outbound request". `.fetch(` on an object is fine and is why the pattern requires a bare call:
     * `app.fetch(...)` (the Worker entrypoint) and `c.env.ASSETS.fetch(...)` (static assets) are the two
     * legitimate uses in this tree and neither is a network client.
     */
    const capabilities: Array<[RegExp, string]> = [
      [/(^|[^.\w$])fetch\s*\(/, 'a bare `fetch(` — an outbound HTTP request'],
      [/\bnew\s+WebSocket\b/, 'a WebSocket client'],
      [/\bcloudflare:sockets\b/, "Cloudflare's raw TCP socket API"],
      [/\bcloudflare:email\b/, "Cloudflare's email API"],
      [/\bEmailMessage\b/, "Cloudflare's EmailMessage (the send_email binding API)"],
      [/(^|[^.\w$])import\s*\(/, 'a dynamic import — code this scan cannot see'],
      [/\bnew\s+Function\b|(^|[^.\w$])eval\s*\(/, 'runtime code construction'],
    ];
    const findings: string[] = [];
    for (const [path, source] of Object.entries(SOURCES)) {
      for (const [pattern, what] of capabilities) {
        // RAW source. No stripping, on purpose: the stripper is the thing that got fooled last time.
        if (pattern.test(source)) findings.push(`${path} contains ${what}`);
      }
    }
    expect(findings, 'Goal Cascade ships no way to reach the network from the Worker').toEqual([]);
  });

  it('TIER A — the email layer contains exactly the files it is supposed to, and no more', () => {
    const actual = Object.keys(SOURCES)
      .filter((p) => p.includes('/src/infrastructure/email/'))
      .map((p) => p.split('/').pop()!)
      .sort();
    expect(actual, 'a file appeared in (or vanished from) src/infrastructure/email/').toEqual(EMAIL_LAYER);
  });

  it('TIER A — `createEmailSender` is a single unconditional construction, with no branch to take', () => {
    /**
     * The old assertion was `toMatch(/new LogEmailSender\([\s\S]*?null,/)`, which is lazy and unanchored:
     * a ternary selecting a live adapter still satisfied it, because SOME later argument was `null,`.
     * This reads the function body instead and refuses any conditional in it — there is nothing to
     * configure, so there is nothing to get wrong.
     */
    const body = createEmailSenderBody(stripComments(containerRaw));
    expect(body, 'createEmailSender not found in container.ts').not.toBe('');
    expect(body, 'createEmailSender constructs something other than the sink').not.toMatch(/new\s+(?!LogEmailSender\b)\w+/);
    expect(body, 'createEmailSender gained a ternary — there must be no configuration that turns delivery on').not.toMatch(
      /\?/,
    );
    expect(body, 'createEmailSender gained a branch').not.toMatch(/\b(if|switch|\|\||\?\?)\b|\|\||\?\?/);
    // The 4th positional argument — `forward` — is the literal `null`, in that position.
    expect(body.replace(/\s+/g, ' ')).toMatch(/new LogEmailSender\( [^;]*?, [^,]*?, [^,]*?, null, /);
  });

  // ── Tier B: names, on comment-stripped text ────────────────────────────────────────────────────────

  it('TIER B — no known mail provider is named anywhere in the source tree', () => {
    const forbidden: Array<[RegExp, string]> = [
      [/resend/i, 'a Resend adapter'],
      [/sendgrid|mailgun|postmark|mailchannels|sparkpost|mandrill|brevo|sendinblue|postal|ses-v2/i, 'another mail provider'],
      [/\bsmtp\b/i, 'an SMTP client'],
      [/nodemailer/i, 'nodemailer'],
      [/\benv\.EMAIL\b/, 'a use of an EMAIL binding'],
    ];
    for (const [path, source] of Object.entries(SOURCES)) {
      const code = stripComments(source);
      for (const [pattern, what] of forbidden) {
        expect(pattern.test(code), `${path} contains ${what} — Goal Cascade ships no way to deliver mail`).toBe(false);
      }
    }
  });

  it('the comment stripper respects string literals (this is how the old one was defeated)', () => {
    // A block-comment regex deletes everything between these two constants; a real stripper does not.
    const src = ["const OPEN = '/*';", 'const live = 1;', "const CLOSE = '*/';"].join('\n');
    expect(stripComments(src), 'code hidden between two comment-delimiter STRINGS').toContain('const live = 1;');
    // …and a TRAILING comment is still a comment (the old one only stripped whole lines).
    expect(stripComments('const a = 1; // mentions resend')).not.toContain('resend');
    // …while an apparent comment inside a string is not one.
    expect(stripComments(`const u = 'https://x/y'; // gone`)).toContain('https://x/y');
  });

  // ── Runtime behaviour ──────────────────────────────────────────────────────────────────────────────

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
    // …and with a fully "configured-looking" env too: there is no configuration that turns it on. The
    // names here are illustrative only — TIER A is what makes this true for a name nobody thought of.
    const tempting = {
      ...env,
      EMAIL_FROM: 'Goal Cascade <hi@rameezshuhaib.com>',
      RESEND_API_KEY: 're_live_key',
      OUTBOUND_MAIL_KEY: 'anything',
      MAIL_PROVIDER_URL: 'https://mail.example.com',
    } as never;
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

/**
 * Strip `//` and block comments — WITHOUT deleting code that merely looks like a delimiter.
 *
 * The previous implementation was `src.replace(/\/\*[\s\S]*?\*\//g, '')`, which does not know what a
 * string literal is: a file declaring `'/*'` and `'*​/'` around a live adapter had that adapter deleted
 * before any scan saw it, and the file passed every check. This is a character walk that tracks whether
 * it is inside `'…'`, `"…"` or a template literal, so a delimiter inside a string stays code.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const c = source[i]!;
    const next = source[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** The body of `createEmailSender`, from its `{` to the matching `}`. */
function createEmailSenderBody(code: string): string {
  const start = code.indexOf('export function createEmailSender');
  if (start < 0) return '';
  const open = code.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}' && --depth === 0) return code.slice(open + 1, i);
  }
  return '';
}
