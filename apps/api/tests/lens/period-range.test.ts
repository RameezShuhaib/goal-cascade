import type { ZoomResponse } from '@goal-cascade/shared';
import { describe, expect, it } from 'vitest';
import { createTestApp, signedInOwner } from '../helpers/app';
import { createGoal, lens } from '../goals/fixtures';

/**
 * ⚠ **A4 (R-lens-28, R-lens-29)** — the wire half, on **the day the owner hit this**.
 *
 * Tue 1 Sep 2026. The Monthly lens opens on `Sep 2026`, whose weeks begin on the 7th, while the week the
 * owner is living in began Mon 31 Aug and belongs to August. The owner's words were *"why is Sep 2026 this
 * month? look the last Month week hadn't completed yet? is this right or wrong?"* — and it is right: a
 * week is keyed by its Monday everywhere (R-goal-33, RECONCILIATION ★C-19). What was wrong is that
 * nothing on the wire, and therefore nothing on screen, said so.
 *
 * The clock here is deliberately NOT the Monday every other lens suite uses, because a Monday is the one
 * day of the week on which this defect cannot happen.
 */
const t = createTestApp({ now: '2026-09-01T09:00:00.000Z' }); // a Tuesday — the seam

async function line(cookie: string) {
  const life = await createGoal(t, cookie, { title: 'Health', horizon: 'Life' });
  const yearly = await createGoal(t, cookie, { title: 'Strong year', horizon: 'Yearly', parentId: life.id });
  const quarterly = await createGoal(t, cookie, { title: 'Q push', horizon: 'Quarterly', parentId: yearly.id });
  return { life, yearly, quarterly };
}

describe('R-lens-28 — every period-scoped lens carries the weeks it really contains', () => {
  it('the owner’s case: Sep 2026 is Mon 7 Sep – Sun 4 Oct, and it is still the current month', async () => {
    const { cookie } = await signedInOwner(t);
    await line(cookie);

    // No period asked for, so the SERVER answers with the current one (R-lens-14) — and it is `2026-09`.
    // The default is deliberately unchanged: see the `currentWeekPeriod` assertion below for why.
    const month = await lens(t, cookie, { lens: 'Monthly' });
    expect(month.period?.periodKey).toBe('2026-09');
    expect(month.period?.label).toBe('Sep 2026');
    expect(month.period?.isCurrent).toBe(true);
    expect(month.period?.isPast).toBe(false);
    // The label alone reads as 1–30 September. This is what it actually spans.
    expect(month.period?.weekRange).toBe('Mon 7 Sep – Sun 4 Oct');
  });

  it('the quarter and the year carry theirs too — the same seam, three horizons', async () => {
    const { cookie } = await signedInOwner(t);
    await line(cookie);

    expect((await lens(t, cookie, { lens: 'Quarterly' })).period?.weekRange).toBe('Mon 6 Jul – Sun 4 Oct');
    expect((await lens(t, cookie, { lens: 'Yearly' })).period?.weekRange).toBe('Mon 5 Jan 2026 – Sun 3 Jan 2027');
    // A week names its own Monday already, so its range is itself and the lens does not print it.
    expect((await lens(t, cookie, { lens: 'Weekly' })).period?.weekRange).toBe('Mon 31 Aug – Sun 6 Sep');
    // Life has no period at all (R-lens-2), so there is nothing to span.
    expect((await lens(t, cookie, { lens: 'Life' })).period).toBeNull();
  });

  it('R-lens-22 — the Zoom sheet’s rows carry the range, so you see the span before you commit', async () => {
    const { cookie } = await signedInOwner(t);
    await line(cookie);

    const zoom = (await (await t.fetch('/api/goals/zoom', { cookie })).json()) as ZoomResponse;
    const at = (l: string) => zoom.rows.find((r) => r.lens === l);
    expect(at('Monthly')?.weekRange).toBe('Mon 7 Sep – Sun 4 Oct');
    expect(at('Quarterly')?.weekRange).toBe('Mon 6 Jul – Sun 4 Oct');
    expect(at('Yearly')?.weekRange).toBe('Mon 5 Jan 2026 – Sun 3 Jan 2027');
    expect(at('Weekly')?.weekRange).toBe('Mon 31 Aug – Sun 6 Sep');
    // The Life row spans everything, and `everything` has no dates.
    expect(at('Life')?.weekRange).toBe('');
  });
});

describe('R-lens-29 — the wire says where the current week actually is', () => {
  it('Sep 2026 declares that this week is in Aug 2026', async () => {
    const { cookie } = await signedInOwner(t);
    await line(cookie);

    const month = await lens(t, cookie, { lens: 'Monthly' });
    expect(month.period?.currentWeekPeriod).toEqual({ periodKey: '2026-08', label: 'Aug 2026' });
  });

  it('…and the month that DOES hold this week declares nothing — but is `isPast`, which is the whole reason the default did not move', async () => {
    const { cookie } = await signedInOwner(t);
    await line(cookie);

    const august = await lens(t, cookie, { lens: 'Monthly', period: '2026-08' });
    expect(august.period?.currentWeekPeriod).toBeNull();
    expect(august.period?.weekRange).toBe('Mon 3 Aug – Sun 6 Sep');
    // ⚠ This is why R-lens-8 is unchanged. Opening the Monthly lens on the month holding the current
    // week would open it, today, on a period the same payload calls PAST — which strips every create
    // affordance (R-goal-36, R-nav-25) and badges it `Past month — still editable`. An honest label plus
    // one tap beats landing somewhere you cannot plan.
    expect(august.period?.isPast).toBe(true);
    expect(august.period?.isCurrent).toBe(false);
  });

  it('the horizons that agree with themselves say nothing at all', async () => {
    const { cookie } = await signedInOwner(t);
    await line(cookie);

    // Q3 2026 holds the week of Mon 31 Aug, and so does 2026. Only the month is off, today.
    expect((await lens(t, cookie, { lens: 'Quarterly' })).period?.currentWeekPeriod).toBeNull();
    expect((await lens(t, cookie, { lens: 'Yearly' })).period?.currentWeekPeriod).toBeNull();
    // A week always holds its own week, so this field is null on the Weekly lens by construction.
    expect((await lens(t, cookie, { lens: 'Weekly' })).period?.currentWeekPeriod).toBeNull();
  });

  it('it is a statement of fact, not a chrome decision: a far-off period carries it too', async () => {
    const { cookie } = await signedInOwner(t);
    await line(cookie);

    // The server says where the week is on every period it describes. The CLIENT is what decides to show
    // it only on the current one (R-lens-29), where the off-now row does not render — so the two notices
    // share one conditional row and the shell keeps its two unconditional ones (R-nav-27).
    const december = await lens(t, cookie, { lens: 'Monthly', period: '2026-12' });
    expect(december.period?.isCurrent).toBe(false);
    expect(december.period?.currentWeekPeriod).toEqual({ periodKey: '2026-08', label: 'Aug 2026' });
    expect(december.period?.weekRange).toBe('Mon 7 Dec 2026 – Sun 3 Jan 2027');
  });
});
