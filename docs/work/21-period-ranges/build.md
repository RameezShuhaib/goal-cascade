# 21 — Period ranges, and the week that is somewhere else

The owner, on Tue 1 Sep 2026, opened the Monthly lens: *"why is Sep 2026 this month? look the last Month
week hadn't completed yet? is this right or wrong? this is confusing, i think for monthly we need to note
it as a range."*

**It is right, and the model does not change.** A week is keyed by its Monday everywhere (`R-goal-33`), so
the week of Mon 31 Aug belongs to August and `Sep 2026` is the four weeks beginning 7, 14, 21 and 28 Sep.
That was settled deliberately in `RECONCILIATION.md` ★C-19 against an alternative that made one week
belong to two months and put `R-lens-9`'s zoom, `R-goal-47`'s planned-ness scope and `R-task-49`'s target
week in disagreement. Nothing here reopens it.

**The defect is that the label over-promises.** `Sep 2026` reads as 1–30 September; the period is Mon 7 Sep
– Sun 4 Oct. This is the broadcast-calendar / retail 4-4-5 model, and the convention those calendars use is
the fix: publish the range beside the name, never the name alone.

## The label format, and where it renders

    Sep 2026 · Mon 7 Sep – Sun 4 Oct

One string where a line break cannot be carried — the title button's accessible name and the live-region
announcement — and **two lines** where it can. It renders in three places:

| Where | Form |
|---|---|
| The lens row's title button (Yearly, Quarterly, Monthly) | `Sep 2026` at 21/800, `Mon 7 Sep – Sun 4 Oct` beneath it at 12.5/600 in `T.mut`. The second line is `aria-hidden`; the button's own name carries both. |
| That button's accessible name | `Monthly lens, Sep 2026 · Mon 7 Sep – Sun 4 Oct. Change lens or period.` |
| Every Zoom-sheet row | The label over its span, so "you see the destination before you commit" (`R-lens-22`) is true of the whole destination. |

**The years appear only when the two ends disagree about one** — `Mon 7 Dec 2026 – Sun 3 Jan 2027`, where
the title's own `Dec 2026` cannot disambiguate the far end. September's does not print a year at either
end, because both are 2026 and a year printed three times in one header is chrome. A Yearly range always
spans two calendar years, so it always prints both.

**The Weekly lens is left alone, and that is a finding rather than an omission.** `Week of 31 Aug` names a
specific Monday and a week is unambiguously the seven days from it, so the label is already honest; a range
beneath it would restate the title. The Zoom sheet still shows the week's span, because there the four
period rows are being compared and a gap in the ladder would read as a missing answer.

## Where the computation lives

`apps/api/src/domain/periods.ts`, beside the rules it depends on:

- `firstWeekOf(horizon, key)` / `lastWeekOf(horizon, key)` — the first and last Monday whose own period at
  that horizon is `key`. **`firstMondayIn` / `lastMondayIn` are now the Monthly case of these and delegate
  to them**, so the range the header prints and the `BETWEEN` scope `R-goal-47` counts over are the same
  two Mondays by construction. They were a second copy of the step-forward clause; that is how two answers
  come to disagree on one month in seven.
- `weekRangeOf(horizon, key)` — the rendered range. An unrecognised key measures to `''` rather than
  throwing, for `labelOf`'s reason: display text that 500s hides the row it was meant to describe.
- `periodKeyOfCurrentWeek(horizon, today)` — the period holding the week containing today.

**Server-side, not client-side, and the reason is a rule and not a preference.** The range needs the Monday
rule, and `apps/web/src/utils/periodKeys.ts` states outright that *"there is no `weekStartOfDate` in this
client and there must not be one"* (D-1). A client computation would have had to walk whole weeks off a
server-sent Monday — possible, and a second implementation of a date rule. It is also needed by the MCP
surface, so one implementation in the domain serves three consumers instead of three serving one each.

New wire fields, all derived from a `periodKey` that is already stored — **no migration, no new endpoint,
no new error code, no new dependency**:

- `PeriodView.weekRange`, `ZoomRowView.weekRange`
- `PeriodView.currentWeekPeriod` — `{ periodKey, label }` of the period holding the current week, `null`
  when this period holds it. Required and nullable in the schema, so a server that computes the label and
  forgets the range breaks at the boundary rather than shipping an over-promise again.

## How the two-row budget held

`R-nav-27` budgets **rows of chrome above the first item**, and its unit is a row that carries a control.

- **The range is a second LINE inside the existing title button, not a second row.** It carries no control,
  no tap target and no tab stop, and changes nothing in the focus order. Row 1 is still the cluster and
  row 2 is still the lens row; row 2 is about 16px taller.
- **It could not go on the first line.** At 21px, `Sep 2026 · Mon 7 Sep – Sun 4 Oct` is 32 characters and
  ellipsises the range away at 360px between two 40px chevrons — and a half-shown range is a wrong one.
  A smaller weight inline was measured at roughly 340px of content in a 360px viewport before padding,
  which is a fit that fails on the first long quarter.
- **The flag adds no row either.** It occupies `R-lens-21`'s conditional row, which it can never share: the
  off-now row renders only when the period is *not* current, and the flag only when it *is*. The two
  conditions are complements, so the conditional row gained an occupant and the shell gained nothing.
  `LensRow.tsx` now has one `NoticeRow` shape behind both, because they were the same fourteen lines twice
  and had already begun to differ.

## The default period — unchanged, and this is the loud part

**The Monthly lens still opens on the calendar month containing today.** On 1 Sep 2026 that is `Sep 2026`,
the month that does not contain this week. The alternative was considered seriously and rejected:

> Defaulting to the period holding the current *week* would open the Monthly lens, that day, on
> `Aug 2026` — a period the very same payload marks `isPast`, which removes every create affordance
> (`R-goal-36`, `R-nav-25`) and badges it `Past month — still editable`.

Landing somewhere you cannot plan is worse than landing somewhere honestly labelled. Making it *not* past
would mean redefining `isCurrent` / `isPast` week-wise, which is `R-goal-34` and `R-goal-36` — the write
rule — and that is the model, which is not changing. `S-lens-29-5` and
`apps/api/tests/lens/period-range.test.ts` pin both halves: the lens opens on `2026-09` with creates
present, and `2026-08` is `isPast` with none.

So the flag carries the weight, and it had to be good enough to.

## The flag

When the period on screen **is** the current one and still does not hold the week containing today:

    ┌ This week is in Aug 2026 ┐                                    Go there ›

- `This week is in <period>` — a muted `lineSoft` pill, the same register as the badge it replaces. It is
  not an escalation: a period that legitimately begins next week is a fact about the calendar, not a
  problem with the plan (`R-lens-11`), and the red carry chip is still the only escalation in the product.
- `Go there ›` visible, **`Go to Aug 2026` as the accessible name** — the pill one gap away already names
  the month for the eye, and repeating it in the link is chrome; a screen reader hears the button alone, so
  the name spells the destination out. The live region carries the sentence too, because a visible row is
  not something a screen-reader user should have to go looking for.
- **The jump names the period explicitly** — the key the server sent, not `lensPath(lens)` with no period,
  which would ask for the current one and land straight back where it started.
- **Designed for the general case.** It is one rule over `periodKeyOf(horizon, weekStartOfDate(today))`, so
  on Fri 1 Jan 2027 — whose week began Mon 28 Dec — the Yearly, Quarterly and Monthly lenses all flag at
  once. It can never fire on Weekly (a week holds its own week) or Life (no period).
- **The server states the fact; the client decides when to say it.** `currentWeekPeriod` is populated on
  every period that does not hold the current week, including future ones; the "only on the current period"
  clause is the UI's, so no chrome decision lives on the server.

## The agent surface

A connected agent reasoning about "September" met exactly the ambiguity the owner did, so:

- `periodOut` gains `week_range` and `current_week_period`; `get_period`'s rows gain `week_range`.
- `list_lens` and `get_period`'s descriptions now say to read the range before reasoning about dates, and
  what `current_week_period` means when it is present.
- The server-instructions block gains a **WHAT A PERIOD SPANS** paragraph. It is byte-pinned to
  `docs/research/MCP-TOOL-SURFACE.md` §5, so the document was edited and the constant regenerated from it
  in the same commit; `docs/BUSINESS-RULES.md` gained two bullets in the owner's voice and
  `apps/api/src/api/mcp/business-rules.ts` was regenerated the same way. `tests/mcp/verbatim.test.ts` is
  green, and neither pin was weakened.

## Spec

- **`R-lens-28`** (the label is the name *and* the span) and **`R-lens-29`** (the flag, its row, its jump,
  and why `R-lens-8`'s default did not move), in §2's Lens section under a new
  `#### Amendment 4` heading.
- **14 scenarios** — `S-lens-28-1 … 8`, `S-lens-29-1 … 6` — in a new `### Amendment 4` block in §3
  (264 → 278).
- **§6 ledger:** `### Amendment 4 — period ranges, and the week that is somewhere else`, with the four
  questions it settled, the running totals (229 → **231** rules, 3 modified, none retired) and the
  consequences checked.
- **Marked `⚠` as modified:** `R-lens-17` (second line, and the span in the accessible name), `R-lens-21`
  (its row gains a mutually exclusive second occupant), `R-lens-22` (each Zoom row gains a span).

## Tests

New: `apps/api/tests/domain/period-ranges.test.ts` (12) and `apps/api/tests/lens/period-range.test.ts` (7,
on a clock of **Tue 1 Sep 2026** — a Monday is the one day this defect cannot happen), one contract test in
`packages/shared`, and two describe blocks in `apps/web/tests/screens/lenses.test.tsx` (10).

They cover a month whose 1st is a Monday (`Jun 2026`, no leading gap), a five-week month (`Aug 2026`), the
December→January year boundary, a quarter whose straddling first week belongs to the previous quarter
(`Q4 2026`), the flag's exact firing condition, its mutual exclusion with the off-now row, and its jump —
plus the owner's real case end to end: `Sep 2026` on 1 Sep 2026 shows `Mon 7 Sep – Sun 4 Oct` and flags
`This week is in Aug 2026`.

The 18 existing assertions on lens accessible names were updated to the fuller name, and the web fixtures
gained a `RANGES` table computed from the Monday rule by hand rather than from the implementation.

**559 → 578 api · 296 → 306 web · 43 → 44 shared. Typecheck clean. `dist/sw.js` builds with its 13-entry
precache manifest. No test was weakened.**
