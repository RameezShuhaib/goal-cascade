import { ERROR_STATUS } from '@goal-cascade/shared';
import { beforeAll, describe, expect, it } from 'vitest';
// Vite inlines the file's text at build time, so this reads the REAL document.
import toolSurfaceMd from '../../../../docs/research/MCP-TOOL-SURFACE.md?raw';
import { createTestApp, signedInOwner } from '../helpers/app';
import { mcp, mintToken, rpc } from './helpers';

/**
 * **`docs/research/MCP-TOOL-SURFACE.md`, guarded as a whole.**
 *
 * Its §5 is byte-pinned by `verbatim.test.ts`, because `SERVER_INSTRUCTIONS` is a literal copy of that
 * one fenced block. **That pin was the only thing guarding the file, and it read as far more coverage
 * than it had**: §§1–4 and 6–8 went on specifying `set_goal_focus`, `save_weekly_plan`, `NOT_A_LEAF` and
 * `find_goal(only="leaves")` for a whole release while the pin stayed green, and `prompts.ts` cited §4
 * as its source of truth the entire time.
 *
 * **Widening the byte-pin to the whole file would be wrong, and this is the alternative.** Nothing in
 * `src` is a byte-copy of the rest of the document — §5 is the only section that is reproduced anywhere
 * — so there is no second string to compare against. Pinning the prose to itself would assert only that
 * the file had not changed, which is not the property that matters and would fail on every legitimate
 * edit. The property that matters is that **the document does not specify things the server does not
 * have**, and that is checkable directly, over every block of the file:
 *
 *  1. Every tool the document gives a heading to is a tool the live server advertises.
 *  2. Every `goalcascade://` URI it presents in the resource table is registered.
 *  3. Every error code it teaches a recovery for exists in `ERROR_STATUS`.
 *  4. Every retired name appears **only** in a block that marks it as retired.
 *
 * (4) is what makes the other three hold going forward: the document is allowed to name a deleted thing
 * — a reader who remembers `set_goal_focus` should find out what happened to it — but only in the past
 * tense. A fresh sentence specifying one as current fails here.
 */

const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });
let token: string;

beforeAll(async () => {
  token = await mintToken(t, (await signedInOwner(t)).cookie);
});

/** Tool headings look like `#### \`create_goal\` \`[MUTATING]\``. */
const documentedTools = (): string[] => [
  ...new Set(
    [...toolSurfaceMd.matchAll(/^#### (`[a-z_]+`(?: \/ `[a-z_]+`)*) `\[(?:READ-ONLY|MUTATING)\]`/gm)]
      .flatMap((m) => [...m[1]!.matchAll(/`([a-z_]+)`/g)].map((n) => n[1]!)),
  ),
];

describe('MCP-TOOL-SURFACE.md specifies the surface that actually exists', () => {
  it('every tool it gives a heading to is advertised by the server', async () => {
    const live = new Set(
      ((await rpc(await mcp(t, token, 'tools/list'))).result.tools as Array<{ name: string }>).map((x) => x.name),
    );
    const documented = documentedTools();

    // A sanity floor: if the heading regex stops matching, this test would otherwise pass vacuously.
    expect(documented.length, 'no tool headings parsed — did the document restructure?').toBeGreaterThan(25);
    for (const name of documented) {
      expect(live.has(name), `§2 documents \`${name}\`, which the server does not advertise`).toBe(true);
    }
  });

  it('every resource URI in the §3 table is registered', async () => {
    const resources = (await rpc(await mcp(t, token, 'resources/list'))).result.resources as Array<{ uri: string }>;
    const templates = (await rpc(await mcp(t, token, 'resources/templates/list'))).result
      .resourceTemplates as Array<{ uriTemplate: string }>;
    const live = new Set([...resources.map((r) => r.uri), ...templates.map((r) => r.uriTemplate)]);

    // Only the table rows. Prose elsewhere names the two deleted tree resources, on purpose.
    const table = toolSurfaceMd.split('## 3. Resources')[1]!.split('## 4. Prompts')[0]!;
    const documented = [...new Set([...table.matchAll(/^\| `(goalcascade:\/\/[^`]+)`/gm)].map((m) => m[1]!))];

    expect(documented.length, 'no resource rows parsed — did §3 restructure?').toBeGreaterThan(7);
    for (const uri of documented) {
      expect(live.has(uri), `§3 documents \`${uri}\`, which is not registered`).toBe(true);
    }
  });

  it('every error code it teaches a recovery for exists in ERROR_STATUS', () => {
    const section = toolSurfaceMd.split('## 6. Error surface')[1]!.split('## 7. Safety rails')[0]!;
    // The recovery tables list one code per row, first cell. The final table is the DELETED codes, and
    // it is excluded by construction — it is introduced by this heading and runs to the end of §6.
    const live = section.split('Four codes this document used to teach are deleted')[0]!;
    const codes = [...new Set([...live.matchAll(/^\| `([A-Z_]+)`/gm)].map((m) => m[1]!))];

    expect(codes.length, 'no error rows parsed — did §6 restructure?').toBeGreaterThan(12);
    for (const code of codes) {
      expect(Object.hasOwn(ERROR_STATUS, code), `§6 teaches \`${code}\`, which is not an ErrorCode`).toBe(true);
    }
  });

  /**
   * The names A2 deleted. Each may appear only where the block also marks it as gone — that is what lets
   * the document keep a tombstone for a reader who remembers the old surface, without letting a new
   * sentence quietly specify one as current again.
   */
  it('every retired name appears only in a block that marks it retired', () => {
    const retired = [
      'set_goal_focus',
      'clear_goal_focus',
      'save_weekly_plan',
      'get_weekly_plan',
      'list_goals',
      'confirm_deactivations',
      'dormant_leaves',
      'active_leaves',
      'weekly_focuses',
      'week_history_weeks',
      'NOT_A_LEAF',
      'BRANCH_NOT_ACTIVE',
      'WEEK_NOT_CURRENT',
      'GOAL_HAS_OPEN_TASKS',
      'is_leaf',
      'is_active',
      'subtree_active',
      'goalcascade://tree',
    ];
    const marker =
      /deleted|retired|gone|moot|removed|~~|no longer|not built|pre-A2|used to|stopped|dissolved|successor|replaced|r-rm-|dropped|any more|nothing left|on purpose|never/i;

    /**
     * Checked per markdown **block**, not per line: prose wraps, and a tombstone's marker word routinely
     * lands on the next line from the name it buries. A block is what a reader takes in at once — a
     * paragraph, a bullet, a whole table with its header — so a marker anywhere in it is the sentence
     * doing its job. Blank lines separate blocks, which is markdown's own rule.
     */
    const blocks = toolSurfaceMd.split(/\n\s*\n/);
    const offenders: string[] = [];
    for (const block of blocks) {
      if (marker.test(block)) continue;
      for (const name of retired) {
        if (block.includes(name)) offenders.push(`${name} — ${block.trim().slice(0, 140).replace(/\n/g, ' ')}`);
      }
    }

    expect(offenders, `retired names stated as current:\n${offenders.join('\n')}`).toEqual([]);
  });

  /**
   * The provenance `prompts.ts` claims. It said *"reproduced from … §4"* while §4 told the agent to call
   * `set_goal_focus`; §4 is a design summary now and says so, so the citation had to change with it.
   */
  it('§4 names the four prompts the server actually registers', async () => {
    const live = ((await rpc(await mcp(t, token, 'prompts/list'))).result.prompts as Array<{ name: string }>).map(
      (p) => p.name,
    );
    const section = toolSurfaceMd.split('## 4. Prompts')[1]!.split('## 5. Server instructions block')[0]!;
    const documented = [...new Set([...section.matchAll(/^### `([a-z_]+)`/gm)].map((m) => m[1]!))];

    expect(documented.sort()).toEqual([...live].sort());
  });
});
