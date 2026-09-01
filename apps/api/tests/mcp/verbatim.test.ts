import { describe, expect, it } from 'vitest';
// Vite inlines the file's text at build time, so these read the REAL documents.
import businessRulesMd from '../../../../docs/BUSINESS-RULES.md?raw';
import toolSurfaceMd from '../../../../docs/research/MCP-TOOL-SURFACE.md?raw';
import { BUSINESS_RULES_MD } from '../../src/api/mcp/business-rules';
import { SERVER_INSTRUCTIONS } from '../../src/api/mcp/instructions';

/**
 * Two strings in this feature are copies of text that lives somewhere else, and both are load-bearing.
 * A copy with no alarm on it is a copy that drifts, so this file is the alarm.
 */
describe('the two verbatim strings really are verbatim', () => {
  it('the server instructions block matches MCP-TOOL-SURFACE.md §5 exactly', () => {
    /**
     * This is the highest-leverage string in the feature: it is the entire briefing a connecting agent
     * gets about the horizon hierarchy, the five horizons, the week model and the three task exits.
     * The design document is its source of truth, and "close enough" is how the MCP surface and the
     * product start telling users different things.
     *
     * **This pin covers §5 and only §5**, because §5 is the only part of that document reproduced in
     * `src`. The rest of the file is guarded by `surface.test.ts` instead — a pin here would have
     * implied a coverage it never had, which is exactly how §§1–4 and 6–8 rotted while this stayed
     * green.
     */
    const section = toolSurfaceMd.split('## 5. Server instructions block')[1];
    expect(section, 'MCP-TOOL-SURFACE.md §5 not found — did the document restructure?').toBeTruthy();
    const fenced = /```\n([\s\S]*?)\n```/.exec(section!);
    expect(fenced, 'the instructions code fence in §5 not found').toBeTruthy();
    expect(SERVER_INSTRUCTIONS).toBe(fenced![1]);
  });

  it('the business-rules resource matches docs/BUSINESS-RULES.md byte for byte', () => {
    /**
     * Shipped at `goalcascade://rules/business-rules`. It is a TS constant rather than a text import
     * because Vite resolves `?raw` and esbuild (wrangler) does not — see `business-rules.ts`. That
     * trade buys a working build and costs a copy, so the copy gets checked here.
     */
    expect(BUSINESS_RULES_MD).toBe(businessRulesMd);
  });
});
