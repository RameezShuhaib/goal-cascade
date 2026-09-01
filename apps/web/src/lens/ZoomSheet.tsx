import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { HORIZONS, labelOf, weekRangeOf, zoomTo, type Horizon } from '@goal-cascade/shared';
import { useUI } from '../context/UIContext';
import { useZoom } from '../api/queries';
import { useWeekClock } from '../lib/weekClock';
import { useSkin } from '../skin';
import { Sheet } from '../components/Sheet';
import { LoadError } from '../components/states';
import { lensPath } from '../routes';

/**
 * R-lens-17 / R-lens-22 — **the Zoom sheet**: the five altitudes as a vertical ladder, each row labelled
 * with *the exact period it would land you on* and how many goals are there.
 *
 * Why one tap pays for itself: the sheet tells you where you would land **before you go**, which a
 * persistent five-way switcher cannot — it has room for five labels and nothing else. That is what stops
 * the zoom model feeling arbitrary. The frequent acts (open the app, step a period) cost nothing extra:
 * the Goals tab remembers your lens (R-nav-28), so daily use never opens this at all.
 *
 * It is the existing `Sheet`, so it inherits R-nav-15's whole contract unchanged — focus-trapped, named by
 * its own `<h2>`, Escape and the backdrop close, and focus returns to the lens title on close.
 *
 * ⚠ **R-lens-30 — the sheet has no loading state at all any more.**
 *
 * `ZoomRowView` is `{ lens, periodKey, label, weekRange, count, isCurrent }`, and **five of the six are
 * `zoomTo` + `labelOf` + `weekRangeOf` over the anchor the client already holds.** Only `count` needs the
 * server. So all five rows render named, spanned and marked current the instant the sheet opens, and the
 * counts fill in when `['zoom', anchor]` lands — and R-lens-22 already omits a zero count rather than
 * rendering it, so a number that arrives 200 ms late needs no placeholder. `Loading the lenses…` is
 * deleted. **The sheet's own promise — you see the destination before you commit — becomes true
 * immediately rather than after a round trip.**
 *
 * **One read, not five** (R-lens-22): `GET /goals/zoom?anchor=` is still a single grouped query.
 */
export function ZoomSheet({ lens, anchor, offNow }: { lens: Horizon; anchor: string | null; offNow: boolean }) {
  const S = useSkin();
  const ui = useUI();
  const navigate = useNavigate();
  const clock = useWeekClock();
  const zoom = useZoom(anchor);
  const close = () => ui.closeSheet();

  const go = (to: Horizon, periodKey: string | null) => {
    close();
    navigate(lensPath(to, periodKey));
  };

  /**
   * The ladder, locally. `anchor ?? today` is exactly what the server does with an absent anchor
   * (`GoalService.zoom`), so the two agree by construction rather than by coincidence — and the counts,
   * when they land, are matched onto these rows by `lens`, which is the one field neither side derives.
   */
  const at = anchor ?? clock.today;
  const rows = useMemo(
    () =>
      HORIZONS.map((horizon) => {
        const periodKey = zoomTo(horizon, at, clock.today);
        return {
          lens: horizon,
          periodKey,
          // The Life row spans everything, and `everything` is what the server calls it.
          label: horizon === 'Life' ? 'everything' : labelOf(horizon, periodKey),
          weekRange: weekRangeOf(horizon, periodKey),
        };
      }),
    [at, clock.today],
  );
  const counts = useMemo(() => new Map((zoom.data?.rows ?? []).map((r) => [r.lens, r.count])), [zoom.data]);

  return (
    <Sheet label="Change lens" onClose={close}>
      {zoom.error && <LoadError error={zoom.error} what="the lenses" onRetry={() => void zoom.refetch()} />}
      <div style={{ border: `1px solid ${S.T.line}`, borderRadius: 12, overflow: 'hidden' }}>
        {rows.map((row) => {
          const current = row.lens === lens;
          const count = counts.get(row.lens) ?? 0;
          return (
            <button
              key={row.lens}
              type="button"
              // R-lens-13's one surviving requirement: the selection is ANNOUNCED, never merely coloured.
              aria-current={current ? 'true' : undefined}
              style={{
                ...S.pickerRow(current ? 'sel' : 'ok'),
                gap: 10,
                ...(current ? { boxShadow: `inset 3px 0 0 ${S.T.accent}` } : {}),
              }}
              onClick={() => go(row.lens, row.lens === 'Life' ? null : row.periodKey)}
            >
              <span style={{ minWidth: 84, fontWeight: 800 }}>{row.lens}</span>
              {/*
               * R-lens-28 — the destination's **name over its span**. The sheet's whole argument over a
               * five-way strip is that you see where you would land before you commit (R-lens-17), and
               * `Sep 2026` is not where you would land — `Mon 7 Sep – Sun 4 Oct` is. There is no chrome
               * budget inside a sheet, so this is the one place the two can sit unabbreviated.
               */}
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                <span style={{ display: 'block', color: S.T.mut, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.label}</span>
                {row.weekRange && (
                  <span style={{ display: 'block', color: S.T.mut, fontWeight: 500, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {row.weekRange}
                  </span>
                )}
              </span>
              {/* A zero count is omitted, not rendered — which is also why a late count needs no placeholder. */}
              {count > 0 && <span style={{ fontWeight: 800, color: S.T.ink }}>{count}</span>}
            </button>
          );
        })}
      </div>
      {/*
       * Only when the selected period is not the current one. `Jump to now` navigates to the lens with NO
       * period segment; the route then resolves it to the current period locally (R-lens-30) rather than
       * asking the server which one that is.
       */}
      {offNow && (
        <button type="button" style={{ ...S.linkBtn, marginTop: 10 }} onClick={() => go(lens, null)}>
          Jump to now
        </button>
      )}
    </Sheet>
  );
}
