import type { IClock, IEmailOutboxRepo, IEmailSender, IIdGenerator, OutgoingEmail } from '../../application/ports';
import { isE2EAddress } from './e2e-addresses';

/**
 * The ONLY email adapter in this product, and the only one there will be.
 *
 * ── Why there is no real sender ──────────────────────────────────────────────────────────────────────
 * The owner's sending domain was previously flagged for a critically high bounce rate caused by the
 * project's own test traffic, and a repeat can get the domain banned. Goal Cascade therefore removes the
 * capability rather than guarding it: `wrangler.jsonc` declares no `send_email` binding, no Resend (or
 * any other HTTP) adapter exists in this tree, and `createEmailSender` constructs this class with
 * `forward = null` unconditionally.
 *
 * That is a deliberate product decision, not an unfinished integration. `tests/security/no-real-email.test.ts`
 * fails the build if a network-capable adapter or a `send_email` binding ever reappears.
 *
 * ── What it does ─────────────────────────────────────────────────────────────────────────────────────
 *  1. **Sink (test identities only).** The message is written to `email_outbox` — where `/internal/outbox`
 *     and the local tests read verification / reset links from — ONLY when the recipient matches
 *     `E2E_EMAIL_PATTERN`, which is constrained to non-registrable domains. With the pattern unset,
 *     nothing is ever stored, so a real account's links are neither persisted nor readable, whoever holds
 *     `INTERNAL_SECRET`.
 *  2. **Log.** `to` + `subject` only — never the body, never the link.
 *  3. **Forward.** Structurally impossible here; the branch is kept so the shape stays comparable to the
 *     reference codebase and so `forward === null` is a property a test can assert in one line.
 */
export class LogEmailSender implements IEmailSender {
  constructor(
    private readonly outbox: IEmailOutboxRepo,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
    /**
     * ALWAYS `null` in Goal Cascade: this instance is structurally incapable of real delivery. Public
     * (readonly) so `tests/security/no-real-email.test.ts` can assert it cheaply.
     */
    readonly forward: IEmailSender | null = null,
    /** `E2E_EMAIL_PATTERN`; unset = never persist a body. */
    private readonly e2ePattern: string | undefined = undefined,
  ) {}

  async send(email: OutgoingEmail): Promise<void> {
    const sunk = isE2EAddress(this.e2ePattern, email.to);
    if (sunk) {
      await this.outbox.insert({
        id: this.ids.ulid(),
        to: email.to,
        subject: email.subject,
        body: email.text,
        createdAt: this.clock.nowIso(),
      });
    }
    // Sink XOR forward — and in this product `forward` is always null, so nothing ever leaves.
    const forwarded = this.forward !== null && !sunk;
    console.log(`[email] to=${email.to} subject=${JSON.stringify(email.subject)} sink=${sunk} forwarded=${forwarded}`);
    if (forwarded && this.forward) {
      try {
        await this.forward.send(email);
      } catch (err) {
        // A delivery failure is logged, not thrown: a provider outage must not turn sign-up into a 500
        // or leak "this address exists" through `request-password-reset`'s timing.
        console.error('[email] delivery failed (message dropped)', err);
      }
    }
  }
}
