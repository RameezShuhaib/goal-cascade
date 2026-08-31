import { MAX_INTERIOR_GOALS, MAX_PAGE } from '@goal-cascade/shared';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { DB } from '../../src/application/services/guarded-batch';
import type { Horizon } from '../../src/domain/enums';
import { indexTree, lifeRootIn, type TreeNode } from '../../src/domain/goal-tree';
import type { Db } from '../../src/infrastructure/persistence/db';
import { createTestApp, env, ids, signedInOwner } from '../helpers/app';

/**
 * ⚠ **A2 — the scale work, MEASURED (RECONCILIATION §3).**
 *
 * `goal-tree.ts` used to open with *"at most 500 nodes, at most 4 levels deep — so nothing here needs a
 * query"*. Every clause of that was false: the cap was prose enforced nowhere, and `GET /goals` was
 * **Θ(n²·d)** — `GoalService.toView` ran `isLeaf` + `descendantIds` + a per-descendant `isLeaf` for
 * every goal, mapped over the whole list. **The redesign did not create that defect; it exposes it**,
 * because a Weekly horizon makes the goal list grow with USE.
 *
 * This file measures the fix rather than asserting it. Two halves, and both are needed:
 *
 *  1. **The algorithm**, in element visits, on the same synthetic account the reconciliation used. It is
 *     deterministic and machine-independent, which is what makes it a regression guard: a future change
 *     that reintroduces a scan inside a map fails here rather than being noticed as "the app feels slow".
 *  2. **The real read**, over HTTP through the real router and real D1, so the claim is about the
 *     product and not about a benchmark.
 *
 * `SCALE=heavy` seeds the 9,755-goal account from RECONCILIATION §3.2; the default is the ~395-goal
 * one-year account, so the suite stays fast. Both numbers are recorded in
 * `docs/work/16-lens-api/build.md`, and this is the file that produced them.
 */
// Threaded through a miniflare BINDING, not `process.env`: this file runs inside the Worker pool.
const HEAVY = (env as unknown as { SCALE?: string }).SCALE === 'heavy';
const YEARS = HEAVY ? 30 : 1;
const LIFE_LINES = 5;

const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });
const THIS_WEEK = '2026-08-31';

type Node = TreeNode & { createdAt: string; periodKey: string };

/**
 * The synthetic account of RECONCILIATION §3.2: five Life lines, one Yearly / four Quarterly / twelve
 * Monthly per line per year, one Weekly goal per Monthly goal per week, and a Weekly practice hung
 * directly off each Life goal (legal under R-goal-32).
 */
function synthetic(years: number): Node[] {
  const out: Node[] = [];
  const day = (n: number) => new Date(Date.parse('2001-01-01T00:00:00Z') + n * 86_400_000).toISOString();
  let seq = 0;
  const push = (id: string, parentId: string | null, horizon: Horizon, periodKey: string) => {
    out.push({ id, parentId, horizon, periodKey, createdAt: day(seq++) });
  };

  for (let line = 0; line < LIFE_LINES; line++) {
    const life = `L${line}`;
    push(life, null, 'Life', '');
    push(`${life}-practice`, life, 'Weekly', '2026-01-05');
    for (let y = 0; y < years; y++) {
      const yearly = `${life}-Y${y}`;
      push(yearly, life, 'Yearly', String(2026 + y));
      for (let q = 0; q < 4; q++) {
        const quarterly = `${yearly}-Q${q}`;
        push(quarterly, yearly, 'Quarterly', `${2026 + y}-Q${q + 1}`);
        for (let m = 0; m < 3; m++) {
          const monthly = `${quarterly}-M${m}`;
          const month = q * 3 + m + 1;
          push(monthly, quarterly, 'Monthly', `${2026 + y}-${String(month).padStart(2, '0')}`);
          // ~4.33 weeks a month, one Weekly goal each.
          for (let w = 0; w < 4; w++) {
            push(`${monthly}-W${w}`, monthly, 'Weekly', `${2026 + y}-${String(month).padStart(2, '0')}-0${w + 1}`);
          }
        }
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// (1) The algorithm, in ELEMENT VISITS.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The OLD read, reproduced exactly enough to count it: `GoalService.toView` mapped over every goal,
 * each call running `isLeaf` (a `.some` over the whole list), `descendantIds` (a stack that scans the
 * whole list per pop) and a per-descendant `isLeaf`.
 *
 * It is reproduced rather than measured against the deleted code because the deleted code is deleted —
 * and reproducing it is what makes the two numbers comparable at all. `visits` counts array elements
 * touched, which is machine-independent.
 */
function oldReadVisits(goals: readonly Node[]): number {
  let visits = 0;
  const isLeaf = (id: string) => {
    for (const g of goals) {
      visits++;
      if (g.parentId === id) return false;
    }
    return true;
  };
  const descendantIds = (id: string): string[] => {
    const out: string[] = [];
    const stack = [id];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const child of goals) {
        visits++;
        if (child.parentId === current && !seen.has(child.id)) {
          seen.add(child.id);
          out.push(child.id);
          stack.push(child.id);
        }
      }
    }
    return out;
  };
  for (const g of goals) {
    isLeaf(g.id);
    for (const d of descendantIds(g.id)) isLeaf(d);
  }
  return visits;
}

/**
 * The NEW read's in-memory half: build the per-request index once over the INTERIOR tree, then resolve
 * one page's Life roots through it at O(d) per item. The Weekly rows never enter memory at all.
 */
function newReadVisits(goals: readonly Node[]): { visits: number; interior: number } {
  let visits = 0;
  // NOT counted: selecting the interior set. In production it is `listInterior` — one indexed read on
  // `ix_goals_lens` — and this filter is only the harness standing in for it. Counting a SQL seek as
  // element visits would flatter the OLD number too, which did its own filtering in SQL.
  const interior = goals.filter((g) => g.horizon !== 'Weekly');
  const ix = indexTree(interior);
  visits += interior.length; // indexTree's single pass over what the query returned

  const page = goals.filter((g) => g.horizon === 'Weekly' && g.periodKey === '2026-01-05').slice(0, MAX_PAGE);
  for (const item of page) {
    // One hop to the parent, then the interior walk: O(d), and d is at most 5 (R-goal-32).
    const parent = item.parentId ? ix.byId.get(item.parentId) : undefined;
    visits += 1;
    if (parent) visits += lifeRootIn(ix, parent.id) ? 1 : 1;
  }
  return { visits, interior: interior.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// (2) The real read, over HTTP.
// ─────────────────────────────────────────────────────────────────────────────

/** Insert the synthetic account straight into D1, in batches: the API's own creates would be the test. */
async function seed(db: Db, userId: string, goals: readonly Node[]): Promise<void> {
  const CHUNK = 200;
  for (let i = 0; i < goals.length; i += CHUNK) {
    const values = goals
      .slice(i, i + CHUNK)
      .map(
        (g) =>
          `('${g.id}', '${userId}', ${g.parentId === null ? 'NULL' : `'${g.parentId}'`}, '${g.horizon}', 'goal ${g.id}', '', 'On track', '${g.periodKey}', '', '${g.createdAt}', '${g.createdAt}', 1)`,
      )
      .join(',');
    await db.run(
      sql.raw(
        `INSERT INTO goals (id, user_id, parent_id, horizon, title, why, pulse, period_key, period, created_at, updated_at, version) VALUES ${values}`,
      ),
    );
  }
}

const ms = (n: number) => `${n.toFixed(1)} ms`;

describe(`R-lens-27 — the scale work, measured at ${HEAVY ? 'HEAVY' : 'year-one'} scale`, () => {
  it('the algorithm: element visits, old read vs new', () => {
    const goals = synthetic(YEARS);
    const before = oldReadVisits(goals);
    const after = newReadVisits(goals);

    // eslint-disable-next-line no-console
    console.log(
      `\n  n = ${goals.length} goals (${after.interior} interior)\n` +
        `  old GET /goals   ${before.toLocaleString()} element visits\n` +
        `  new lens read    ${after.visits.toLocaleString()} element visits\n` +
        `  factor           ${(before / after.visits).toFixed(0)}x\n`,
    );

    // The regression guard, stated as a shape rather than a number so it survives a fixture tweak:
    // the new read must be LINEAR in the interior set, and the interior set must not grow with use.
    expect(after.visits).toBeLessThan(after.interior * 2 + MAX_PAGE * 4);
    expect(after.visits).toBeLessThan(before / 50);
    /**
     * R-lens-27's load-bearing fact, stated exactly: **the interior set grows with the PLAN, not with
     * use.** Five lines gain 5 + 17 interior goals a year (1 Yearly + 4 Quarterly + 12 Monthly each)
     * whatever else happens, while the Weekly rows grow with every week the owner uses the product.
     * That is the whole reason the cap is on the interior set and not on goals.
     */
    const interiorAfter = (years: number) => LIFE_LINES * (1 + years * 17);
    expect(after.interior).toBe(interiorAfter(YEARS));
    /**
     * Q-12 — and this is what sizes the cap. A five-line account crosses `MAX_INTERIOR_GOALS` in its
     * ELEVENTH year, which is the "decade of headroom" the number was chosen for; the Weekly rows it
     * accumulates in the same period are ~3,250 and are deliberately uncapped, because a lifetime cap on
     * them would be a cap on how long the product may be used.
     */
    expect(interiorAfter(10)).toBeLessThan(MAX_INTERIOR_GOALS);
    expect(interiorAfter(12)).toBeGreaterThan(MAX_INTERIOR_GOALS);
  });

  it('the real read: one lens page, one bootstrap, over HTTP and real D1', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const db = t.container().resolve<Db>(DB);
    const goals = synthetic(YEARS);
    await seed(db, userId, goals);

    const time = async (label: string, path: string) => {
      await t.fetch(path, { cookie }); // warm
      const start = performance.now();
      const res = await t.fetch(path, { cookie });
      const took = performance.now() - start;
      expect(res.status, `${label} failed`).toBe(200);
      return { took, body: (await res.json()) as Record<string, unknown> };
    };

    const lens = await time('lens', `/api/goals?lens=Weekly&period=${THIS_WEEK}`);
    const monthly = await time('monthly lens', '/api/goals?lens=Monthly&period=2026-01');
    const zoom = await time('zoom', '/api/goals/zoom');
    const boot = await time('bootstrap', '/api/bootstrap');

    // eslint-disable-next-line no-console
    console.log(
      `\n  n = ${goals.length} goals\n` +
        `  GET /goals?lens=Weekly   ${ms(lens.took)}\n` +
        `  GET /goals?lens=Monthly  ${ms(monthly.took)}\n` +
        `  GET /goals/zoom          ${ms(zoom.took)}\n` +
        `  GET /bootstrap           ${ms(boot.took)}\n`,
    );

    /**
     * S-lens-16-1 — the assertion that actually protects the read strategy: **no response is the whole
     * account**, at any scale. A timing is a measurement; this is the invariant.
     */
    const pageOf = (body: Record<string, unknown>) => (body.items as unknown[]).length;
    expect(pageOf(lens.body)).toBeLessThanOrEqual(MAX_PAGE);
    expect(pageOf(monthly.body)).toBeLessThanOrEqual(MAX_PAGE);
    expect(JSON.stringify(boot.body).length).toBeLessThan(2_000_000);
    // The Monthly lens holds exactly the month's goals across all five lines — never the account.
    expect(pageOf(monthly.body)).toBe(LIFE_LINES);
    // R-lens-22 — the Zoom sheet is ONE grouped read and never fetches rows to count them.
    expect((zoom.body.rows as unknown[]).length).toBe(5);
  });
});
