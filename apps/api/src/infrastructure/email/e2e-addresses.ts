/**
 * The `email_outbox` sink is what the tests and the remote e2e scripts read verification and
 * password-reset links out of. It is restricted to **test identities**: `E2E_EMAIL_PATTERN` is a
 * comma-separated list of glob patterns matched against the LOWERCASED recipient. Nothing else is ever
 * stored, and `/internal/outbox` refuses any address that does not match.
 *
 * Unset (the safe default) matches nothing, so the endpoint is inert and the outbox stays empty.
 */

/**
 * Special-use / reserved suffixes that can never be delegated to a registrant (RFC 2606 §2-3, RFC 6761,
 * RFC 6762 §3). An address under one of these cannot belong to a real person, whoever controls DNS.
 *
 * THE single source of truth for "this domain cannot receive mail". Do not copy it anywhere else.
 */
export const NON_REGISTRABLE_SUFFIXES = ['.local', '.localhost', '.test', '.invalid', '.example'] as const;

/**
 * RFC 2606 §3 reserves these three *second-level* names for documentation. They are registered to IANA,
 * publish no MX, and no user can ever hold a mailbox under one — so mail addressed there is a guaranteed
 * bounce, exactly like the suffixes above. They are not suffixes, hence the separate list.
 */
export const RESERVED_EXAMPLE_DOMAINS = ['example.com', 'example.net', 'example.org'] as const;

/** True for a domain no registrant can ever hold: the reserved suffixes, or an `example.{com,net,org}`. */
export function isNonRegistrableDomain(domain: string): boolean {
  const d = domain.trim().toLowerCase().replace(/[.>\s]+$/, '');
  if (!d) return true;
  if (NON_REGISTRABLE_SUFFIXES.some((suffix) => d === suffix.slice(1) || d.endsWith(suffix))) return true;
  return RESERVED_EXAMPLE_DOMAINS.some((reserved) => d === reserved || d.endsWith(`.${reserved}`));
}

/** True when `address` cannot possibly reach a mailbox. A malformed address (no `@`) counts as non-deliverable. */
export function isNonRegistrableAddress(address: string): boolean {
  const raw = address.trim().toLowerCase().replace(/^.*<|>.*$/g, '');
  const at = raw.lastIndexOf('@');
  if (at < 0) return true;
  return isNonRegistrableDomain(raw.slice(at + 1));
}

/**
 * Would this `from` address be capable of real delivery?
 *
 * Goal Cascade's `EMAIL_FROM` is `Goal Cascade <noreply@goal-cascade.local>`, so this is ALWAYS false —
 * and `tests/security/no-real-email.test.ts` asserts exactly that. The function exists so the guarantee
 * is a checked fact rather than a comment: if someone ever points `EMAIL_FROM` at a registrable domain,
 * a test fails and names what to put back.
 */
export function isDeliverableFrom(from: string | undefined): boolean {
  if (!from || from.trim() === '') return false;
  return !isNonRegistrableAddress(from);
}

const warned = new Set<string>();

/**
 * A pattern is honoured ONLY when every address it can possibly match sits under a non-registrable
 * suffix. This is the difference between "the var happens to be set correctly" and "the guarantee holds
 * by construction": a bare `*`, `*@gmail.com`, or any other widening — a typo, a copy/paste, a
 * deliberate edit by whoever can change `wrangler.jsonc` — is silently INERT rather than turning
 * `INTERNAL_SECRET` into an account-takeover oracle.
 */
function isNonRegistrable(pattern: string): boolean {
  const at = pattern.lastIndexOf('@');
  if (at < 0) return false;
  const domain = pattern.slice(at + 1);
  return NON_REGISTRABLE_SUFFIXES.some((suffix) => domain.endsWith(suffix));
}

export function parseE2EEmailPatterns(pattern: string | undefined): string[] {
  const raw = (pattern ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const safe = raw.filter(isNonRegistrable);
  for (const p of raw) {
    if (!safe.includes(p) && !warned.has(p)) {
      warned.add(p);
      console.error(
        `[email] E2E_EMAIL_PATTERN entry ${JSON.stringify(p)} is ignored: a test-address pattern must end in one of ` +
          `${NON_REGISTRABLE_SUFFIXES.join(', ')} so it can never match a real account.`,
      );
    }
  }
  return safe;
}

/**
 * `*` matches any run of characters; everything else is literal. No pattern (or no address) → false, and
 * a pattern that could reach a registrable domain is dropped by `parseE2EEmailPatterns` before we get here.
 */
export function isE2EAddress(pattern: string | undefined, address: string): boolean {
  const patterns = parseE2EEmailPatterns(pattern);
  if (patterns.length === 0) return false;
  const target = address.trim().toLowerCase();
  if (!target) return false;
  return patterns.some((p) => globToRegExp(p).test(target));
}

const cache = new Map<string, RegExp>();

function globToRegExp(pattern: string): RegExp {
  let re = cache.get(pattern);
  if (!re) {
    const source = pattern
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    re = new RegExp(`^${source}$`);
    cache.set(pattern, re);
  }
  return re;
}
