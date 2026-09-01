import { describe, expect, it } from 'vitest';
import { createTestApp, signedInOwner } from '../helpers/app';
import { createGoal, lens } from '../goals/fixtures';
import { PERIOD_BOUNDARIES, STEP_CASES, ZOOM_CASES } from '../../../../packages/shared/tests/fixtures/period-boundaries';
import { stepPeriod, zoomTo } from '@goal-cascade/shared';

/**
 * ⚠ **ANTI-DRIFT LAYER 2, the SERVER's half** (R-lens-30).
 *
 * This file and `apps/web/tests/lens/period-view-contract.test.ts` both check themselves against
 * `packages/shared/tests/fixtures/period-boundaries.ts`, **and neither imports the other's code.** The
 * table's every string was worked out from the Monday rule by hand. If either side ever drifts from it,
 * exactly one of the two goes red and names which — which is the whole point of having a table rather
 * than a snapshot.
 *
 * The server's half is deliberately end-to-end: it drives `GET /goals?lens=&period=` over the real router,
 * on a fake clock at the row's `nowIso`, with the account's stored timezone set to the row's `tz`. It
 * asserts the **wire** shape, not `periodViewOf`'s return value — because what the client compares itself
 * against is the wire.
 *
 * ⚠ **Do not "fix" a failure here by pasting in what the code returned.** A fixture copied out of the
 * thing it tests asserts only that the code equals itself. Re-derive the row on paper first.
 */

const t = createTestApp({ now: '2026-08-31T09:00:00.000Z' });

/** One goal per horizon, so every lens has something to answer about. */
async function line(cookie: string) {
  const life = await createGoal(t, cookie, { title: 'Health', horizon: 'Life' });
  const yearly = await createGoal(t, cookie, { title: 'Strong year', horizon: 'Yearly', parentId: life.id });
  return { life, yearly };
}

describe('R-lens-30 layer 2 — the wire `PeriodView` matches the hand-written boundary table', () => {
  for (const row of PERIOD_BOUNDARIES) {
    // Life carries no `PeriodView` at all (R-lens-2); its row exists to pin the shape on the client side.
    if (row.horizon === 'Life') continue;

    it(row.name, async () => {
      const { cookie } = await signedInOwner(t, { timezone: row.tz });
      await line(cookie);
      t.clock.set(row.nowIso);

      const res = await lens(t, cookie, { lens: row.horizon, period: row.periodKey });
      const view = res.period;
      expect(view, 'the lens must carry a period at a non-Life horizon').not.toBeNull();
      expect(view?.periodKey).toBe(row.periodKey);
      expect(view?.label).toBe(row.label);
      expect(view?.weekRange).toBe(row.weekRange);
      expect(view?.isCurrent).toBe(row.isCurrent);
      expect(view?.isPast).toBe(row.isPast);
      expect(view?.currentWeekPeriod).toEqual(row.currentWeekPeriod);
    });
  }

  /**
   * The other half of "the server owns the current period": with no `period` in the query the server
   * answers with the one containing today (R-lens-14). Every `isCurrent: true` row is also an assertion
   * about that default, so this checks it directly rather than by inference.
   */
  it('with no period asked for, the server answers with the current one', async () => {
    for (const row of PERIOD_BOUNDARIES) {
      if (row.horizon === 'Life' || !row.isCurrent) continue;
      const { cookie } = await signedInOwner(t, { timezone: row.tz });
      t.clock.set(row.nowIso);
      const res = await lens(t, cookie, { lens: row.horizon });
      expect(res.period?.periodKey, row.name).toBe(row.periodKey);
    }
  });
});

/**
 * Stepping and zooming consult no clock and no database, so they are asserted against the module directly
 * on this side too — the value is that the SAME table is what the client checks, and a change to either
 * implementation would now have to change the table to stay green, which is a change a reviewer sees.
 */
describe('R-lens-30 layer 2 — stepping and zooming match the table', () => {
  it('every rollover, in both directions, plus the format’s own representable edge', () => {
    for (const c of STEP_CASES) {
      expect(stepPeriod(c.horizon, c.from, c.n), `${c.horizon} ${c.from} ${c.n > 0 ? '+' : ''}${c.n}`).toBe(c.to);
    }
  });

  it('R-lens-9’s zoom correction: a week belongs to its MONDAY’s month', () => {
    for (const c of ZOOM_CASES) {
      expect(zoomTo(c.target, c.anchor, c.today), `${c.target} @ ${c.anchor}`).toBe(c.to);
    }
  });
});
