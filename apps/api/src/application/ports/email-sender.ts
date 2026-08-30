/** `html` is optional: adapters that cannot render it (the log sink) fall back to `text`. */
export type OutgoingEmail = { to: string; subject: string; text: string; html?: string };

/**
 * The only outbound-mail port. In Goal Cascade there is exactly ONE implementation —
 * `LogEmailSender` with `forward = null` — because this Worker is deliberately incapable of network
 * delivery (see `infrastructure/email/log-email-sender.ts` and `wrangler.jsonc`).
 */
export interface IEmailSender {
  send(email: OutgoingEmail): Promise<void>;
}
export const IEmailSender = Symbol.for('goal-cascade.IEmailSender');
