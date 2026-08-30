import { env } from 'cloudflare:test';
import { isDeliverableFrom } from '../../src/infrastructure/email/e2e-addresses';

/**
 * ── No test run can ever send a real email ───────────────────────────────────────────────────────────
 *
 * Runs before every test file (`vitest.config.ts` → `test.setupFiles`), inside the same Worker global
 * the tests use. It does not *discourage* real delivery, it removes the ability to attempt it and then
 * fails the run loudly the moment any precondition stops holding:
 *
 *  1. **No mail binding.** `wrangler.jsonc` declares no `send_email`, and this pool loads that file — so
 *     if one is ever added, `env.EMAIL` appears here and this check fires.
 *  2. **A non-registrable `EMAIL_FROM`.** `.local` can never be delegated to a registrant, so no
 *     provider could send from it even if one were wired up.
 *  3. **No provider key.** A `RESEND_API_KEY` (or any other) in `apps/api/.dev.vars` — which vitest
 *     loads — must not exist.
 *  4. **No egress.** Every `fetch` to a host other than loopback throws. This is what makes "zero
 *     outbound provider requests during the suite" a checked fact rather than a claim.
 *
 * The background: the owner's sending domain was previously flagged for a critically high bounce rate
 * caused by test traffic to addresses that cannot resolve. Goal Cascade has no mail adapter at all, so
 * layers 1–3 should be vacuously true — which is exactly why they are asserted rather than assumed.
 * Deleting any part of this file re-opens that door.
 */
const e = env as unknown as { EMAIL?: unknown; EMAIL_FROM?: string; RESEND_API_KEY?: string };

function fail(what: string): never {
  throw new Error(
    `[no-real-email] the vitest environment can send REAL mail: ${what}. Goal Cascade ships NO mail ` +
      'adapter and NO `send_email` binding on purpose (see apps/api/wrangler.jsonc and ' +
      'src/infrastructure/email/log-email-sender.ts). Undo whatever added one before running the suite.',
  );
}

if (e.EMAIL) fail('a `send_email` (EMAIL) binding is present');
if (e.RESEND_API_KEY) fail('`RESEND_API_KEY` is set');
if (isDeliverableFrom(e.EMAIL_FROM)) fail(`\`EMAIL_FROM\` (${JSON.stringify(e.EMAIL_FROM ?? '')}) is on a registrable domain`);

/** Loopback only: miniflare's own plumbing talks to `localhost`; nothing else may leave the process. */
function isLoopback(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return true; // relative — handled inside the Worker, never on the wire
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

const PATCHED = '__goalCascadeNoRealEmailFetch';
const g = globalThis as typeof globalThis & { [PATCHED]?: boolean };
if (!g[PATCHED]) {
  g[PATCHED] = true;
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!isLoopback(url)) {
      // Loud on purpose: a stack trace here names the test that tried to reach the outside world.
      throw new Error(
        `[no-real-email] blocked an outbound request to ${url} during a test run. ` +
          'Tests must mock `fetch`; nothing in the suite may talk to a real provider.',
      );
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
}
