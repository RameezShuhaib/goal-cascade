import { useNavigate } from 'react-router';
import type { Horizon } from '@goal-cascade/shared';
import { useUI } from '../context/UIContext';
import { useZoom } from '../api/queries';
import { useSkin } from '../skin';
import { Sheet } from '../components/Sheet';
import { Loading, LoadError } from '../components/states';
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
 * **One read, not five** (R-lens-22): `GET /goals/zoom?anchor=` is a single grouped query. A zero count is
 * omitted rather than rendered, which is what the app already does everywhere else.
 */
export function ZoomSheet({ lens, anchor, offNow }: { lens: Horizon; anchor: string | null; offNow: boolean }) {
  const S = useSkin();
  const ui = useUI();
  const navigate = useNavigate();
  const zoom = useZoom(anchor);
  const close = () => ui.closeSheet();

  const go = (to: Horizon, periodKey: string | null) => {
    close();
    navigate(lensPath(to, periodKey));
  };

  return (
    <Sheet label="Change lens" onClose={close}>
      {zoom.isPending && <Loading label="Loading the lenses…" />}
      {zoom.error && <LoadError error={zoom.error} what="the lenses" onRetry={() => void zoom.refetch()} />}
      {zoom.data && (
        <div style={{ border: `1px solid ${S.T.line}`, borderRadius: 12, overflow: 'hidden' }}>
          {zoom.data.rows.map((row) => {
            const current = row.lens === lens;
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
                onClick={() => go(row.lens, row.periodKey)}
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
                {/* A zero count is omitted, not rendered — the app already omits zero counts. */}
                {row.count > 0 && <span style={{ fontWeight: 800, color: S.T.ink }}>{row.count}</span>}
              </button>
            );
          })}
        </div>
      )}
      {/*
       * Only when the selected period is not the current one. `Jump to now` navigates to the lens with NO
       * period segment, so the server answers with the period containing today — the client never derives
       * one (R-goal-34).
       */}
      {offNow && (
        <button type="button" style={{ ...S.linkBtn, marginTop: 10 }} onClick={() => go(lens, null)}>
          Jump to now
        </button>
      )}
    </Sheet>
  );
}
