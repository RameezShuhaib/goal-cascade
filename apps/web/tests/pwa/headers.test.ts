/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const headersFile = readFileSync(join(WEB, 'public', '_headers'), 'utf8');

/** The `_headers` rule body, comments stripped — Cloudflare ignores `#` lines and so do we. */
const rules = headersFile
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('#'))
  .join('\n');
const csp = /Content-Security-Policy:(.*)/.exec(rules)?.[1]?.trim() ?? '';
const directive = (name: string) => new RegExp(`(?:^|;)\\s*${name}\\s([^;]*)`).exec(csp)?.[1]?.trim();

/**
 * The CSP is a dangerous default in the sense that nothing fails loudly when it is widened — the app keeps
 * working, and only an attacker notices. Each assertion below stands in for a specific way it could be
 * loosened by accident while chasing an unrelated bug.
 */
describe('public/_headers', () => {
  it('is a `/*` rule block that ships a CSP', () => {
    expect(rules).toMatch(/^\/\*$/m);
    expect(csp).not.toBe('');
  });

  it('keeps connect-src at self — the API is same-origin, so nothing should ever reach another host', () => {
    // This is the payoff of the one-Worker design. Widening it is a deliberate decision, not a fix.
    expect(directive('connect-src')).toBe("'self'");
    expect(directive('default-src')).toBe("'self'");
  });

  it('allows no third-party origin anywhere in the policy', () => {
    // Self-hosted fonts are what make this possible; a Google Fonts link in index.html would need
    // `fonts.googleapis.com` and `fonts.gstatic.com` back in here. See the comment in public/_headers.
    expect(csp).not.toMatch(/https?:\/\//);
  });

  it('never allows eval or an inline script', () => {
    const script = directive('script-src') ?? '';
    expect(script).not.toContain('unsafe-eval');
    expect(script).not.toContain('unsafe-inline');
    expect(script).toBe("'self'");
  });

  it('keeps the framing, base-uri and object-src lockdown', () => {
    expect(directive('frame-ancestors')).toBe("'none'");
    expect(directive('base-uri')).toBe("'none'");
    expect(directive('object-src')).toBe("'none'");
    expect(directive('form-action')).toBe("'self'");
  });

  it('ships the non-CSP headers too', () => {
    expect(rules).toMatch(/X-Content-Type-Options: nosniff/);
    expect(rules).toMatch(/X-Frame-Options: DENY/);
    expect(rules).toMatch(/Referrer-Policy: same-origin/);
  });

  it("allows 'unsafe-inline' for styles only, and says so", () => {
    // The mockup styles everything with React `style={{…}}`, which CSP counts as inline styles. Dropping this
    // means moving to classes or a nonce — a real change, not a one-line edit — so it is asserted, not banned.
    expect(directive('style-src')).toBe("'self' 'unsafe-inline'");
    expect(directive('font-src')).toBe("'self'");
    expect(directive('img-src')).toBe("'self' data:");
  });
});
