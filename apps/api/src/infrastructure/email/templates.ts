import type { OutgoingEmail } from '../../application/ports';

/** A rendered message without a recipient — the caller supplies `to`. */
export type EmailBody = Omit<OutgoingEmail, 'to'>;

/**
 * The two transactional messages. Plain, well-formed `text` + a minimal single-column
 * `html` — no images, no external CSS, no tracking — so they render in every client and read as legitimate
 * mail rather than as something a spam filter should eat. `text` stays the canonical version: it is what the
 * e2e outbox sink stores and what the tests parse the link out of — and, in this product, the ONLY
 * place the link ever appears, because nothing here can deliver mail.
 */

export function verifyEmail(opts: { appName: string; name: string | null | undefined; url: string }): EmailBody {
  const greeting = greet(opts.name);
  const text = [
    greeting,
    '',
    `Confirm your email address to finish setting up ${opts.appName}:`,
    '',
    opts.url,
    '',
    'If you did not sign up, you can ignore this message — nothing will happen.',
  ].join('\n');
  return {
    subject: `Verify your ${opts.appName} email`,
    text,
    html: layout({
      appName: opts.appName,
      greeting,
      lead: `Confirm your email address to finish setting up ${opts.appName}.`,
      cta: { label: 'Verify my email', url: opts.url },
      footer: 'If you did not sign up, you can ignore this message — nothing will happen.',
    }),
  };
}

export function resetPassword(opts: {
  appName: string;
  name: string | null | undefined;
  url: string;
  ttlHours: number;
}): EmailBody {
  const greeting = greet(opts.name);
  const validity = `The link works for ${opts.ttlHours === 1 ? '1 hour' : `${opts.ttlHours} hours`} and can be used once.`;
  const text = [
    greeting,
    '',
    `Choose a new ${opts.appName} password by opening this link:`,
    '',
    opts.url,
    '',
    validity,
    'If you did not ask for a reset, ignore this message — your password stays as it is.',
  ].join('\n');
  return {
    subject: `Reset your ${opts.appName} password`,
    text,
    html: layout({
      appName: opts.appName,
      greeting,
      lead: `Choose a new ${opts.appName} password.`,
      cta: { label: 'Set a new password', url: opts.url },
      footer: `${validity} If you did not ask for a reset, ignore this message — your password stays as it is.`,
    }),
  };
}

function greet(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  return trimmed ? `Hi ${trimmed},` : 'Hi,';
}

function layout(o: { appName: string; greeting: string; lead: string; cta: { label: string; url: string }; footer: string }): string {
  const url = escapeHtml(o.cta.url);
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(o.appName)}</title></head>`,
    '<body style="margin:0;padding:24px;background:#f6f6f4;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1c1a;">',
    '<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;">',
    `<p style="margin:0 0 16px;font-size:18px;font-weight:700;">${escapeHtml(o.appName)}</p>`,
    `<p style="margin:0 0 12px;font-size:15px;">${escapeHtml(o.greeting)}</p>`,
    `<p style="margin:0 0 20px;font-size:15px;line-height:1.5;">${escapeHtml(o.lead)}</p>`,
    `<p style="margin:0 0 20px;"><a href="${url}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#1c1c1a;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;">${escapeHtml(o.cta.label)}</a></p>`,
    `<p style="margin:0 0 20px;font-size:13px;line-height:1.5;color:#6b6b66;">Or paste this into your browser:<br><a href="${url}" style="color:#6b6b66;word-break:break-all;">${url}</a></p>`,
    `<p style="margin:0;font-size:13px;line-height:1.5;color:#6b6b66;">${escapeHtml(o.footer)}</p>`,
    '</div></body></html>',
  ].join('');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
