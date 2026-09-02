# 34 — Amendment 8, the web half: month tasks, counters, gauges and readings

Design: `docs/work/33-measurables-ux/UX-PLAN.md`, implemented literally. Its prior art, also built here
because 33 depends on it and it had not shipped: `docs/work/32-week-selection/UX-PLAN.md` — the
`When this lands` control, with **the month as the first option and the default** (the owner's ruling on
its §9.2).
Contract consumed, not designed: `docs/work/31-measurables-api/build.md` §2. Nothing on the wire changed.

Green at the end: **655 api / 480 web / 132 shared**, typecheck clean across all three workspaces,
`npm run build -w @goal-cascade/web` emitting `dist/sw.js` with a 13-entry precache manifest. Floors were
655 / 439 / 132. Nothing deployed, nothing merged.

---

## 1. What shipped

| Surface | What it does now |
|---|---|
| Weekly lens | a third section, **the month band**, last, behind its own hairline and `CollapsibleHeader` |
| Monthly lens | each card nests **its own month tasks**, in `WeeklyCard`'s place and shape |
| Every task row | a measure's numbers and a 2 px bar, before the carry label, inside the title button |
| Task page | a `MEASURE` block (set, edit, remove, record, sparkline, readings) and a `WHERE THIS GOES` block (Park / un-park) |
| Task-create sheet | `When this lands` chips, the month default, and `+ Add a number` inline |
| One new sheet | `Park in a week` (`{ kind: 'retarget', taskId }`) — the only new sheet kind in the plan |

### New files

| File | What it is |
|---|---|
| `apps/web/src/components/ChipRadioGroup.tsx` | one chip radiogroup, one keyboard model, **three** callers |
| `apps/web/src/components/measureCopy.ts` | every measure string, §3.4–§3.6 verbatim, plus `num()` |
| `apps/web/src/components/Measure.tsx` | `MeasureLine`, `MeasureBar`, `MeasureFields`, `MeasureBlock`, the record control, the readings list |
| `apps/web/src/components/Sparkline.tsx` | one `<svg>`, one `<path>`, and a list of what it refuses to be |
| `apps/web/tests/screens/monthBand.test.tsx` | the band, the seam, the trap, the Monthly lens's lists — 11 tests |
| `apps/web/tests/screens/measures.test.tsx` | every measure state, the record control, the sparkline, keyboard — 23 tests |
| `apps/web/tests/screens/park.test.tsx` | Park, un-park, the withdrawals, R-task-59's landing goal — 6 tests |

---

## 2. The August trap: how `PERIOD_IN_PAST` is made unreachable, not handled

`MonthBand` (`lens/LensScreen.tsx`) computes one predicate and branches the whole affordance on it:

```
canCreate = !isPastPeriod('Monthly', monthPeriodKey, clock.today)
```

- `true` → each band **card** renders a `LinkRow` holding `+ Task` alone, which opens the create sheet with
  `{ monthGoal: { id, title }, monthKey: monthPeriodKey }`.
- `false` → **no `LinkRow` renders on any band card**, and the band's foot renders
  `Aug 2026 has ended. New work for the month goes in Sep 2026.` with one `Go to Sep 2026` link to the
  Monthly lens at `currentPeriodKey('Monthly', clock.today)`.

**The invariant, stated for audit and asserted by two tests:** the value the create passes is
`monthPeriodKey` — the band's own month, straight off the wire. It is never
`currentPeriodKey('Monthly', today)`, never `taskWeekForMonth`, never clamped, never substituted and never
defaulted. Because the control renders **only** when that month is not past, the value it passes is always
a legal create target, so `PERIOD_IN_PAST` cannot arrive on this path: it is not caught, not mapped and
not copy-written for it. *A build that adds a clamp here has reintroduced A9's leak in a new place.*

At the pinned clock of **2 Sep 2026** — the owner's real case, and `monthBand.test.tsx`'s default — the
band is August's, `isPastPeriod` is true, and `queryByRole('button', { name: '+ Task' })` inside the band
is `null`.

`MonthlyCard` lost `targetWeek` and its `taskWeekForMonth` import in the same change (R-rm-6): the card
computes no week at all any more, so there is no second place for A9's clamp to go stale. `LinkRow` lost
its `weekStart` prop and passes `monthKey`.

---

## 3. Setting and updating a measure

**Setting** is one component, `MeasureFields`, rendered identically by the create sheet and the task page,
behind one `+ Add a number` disclosure with `aria-expanded`. It owns four values, emits one `MeasureInput`
and **does no I/O**. Kind chips first (they change what the other three mean), `Start` / `Target
(optional)` side by side, `Unit` full width, and two live-region notes — the kind note (in the
radiogroup's `aria-describedby`) and the range note. Save is blocked when `start` is unparseable, when a
non-empty `target` is unparseable, when either exceeds `1e9`, or when `start === target` — the one refusal
the owner can see coming, so the one the client states. `Escape` and `Never mind` cancel; the create
sheet's `Save task` carries the measure in the same command (`Q-E`). **No second sheet, on either host.**

**Updating** is `RECORD`, one field, one `Record`. A counter shows a `+1` chip posting `{ delta: 1 }` on
one tap, a `+`-placeholdered field posting `{ delta }`, and `Correct it instead`, which flips the field to
absolute and posts `{ value }`. A gauge's field is pre-filled with `current`, posts `{ value }`, stays
enabled when the number is unchanged, and **is never offered a delta** — so `MEASURE_KIND_MISMATCH` is
unreachable from this UI. Enter submits from the field, **nothing is programmatically focused on success**,
and the block's single visually-hidden polite region takes the full new state:
`Recorded 65. Now 65 of 300 leads.` No navigation, no toast.

All three numeric fields are `type="text"` + `inputMode="decimal"`, never `type="number"`.

---

## 4. The sparkline, in one line

One inline `<svg width="100%" height="40" viewBox="0 0 320 40" preserveAspectRatio="none" aria-hidden>`
holding exactly one `<path>` with `vectorEffect="non-scaling-stroke"`, `stroke={T.mut}`, `L` segments only,
**x = the reading's index**, `y` flat at 20 when `max === min` (no division), hidden entirely below two
readings, followed by a visually-hidden line pointing at the readings list rather than reciting it.

`measures.test.tsx` asserts it holds one `path` and **zero** `line, circle, text, rect, g, defs`, that `d`
matches `M … L … L …` with no `C/Q/S/T/A`, and that its ends are `x = 2` and `x = 318` whatever the
timestamps are.

---

## 5. The no-target gauge, and `progress` absent

Two keys, kept independent, in two different files so they cannot be collapsed by accident:

| | key | lives in |
|---|---|---|
| the `current / target` form | `m.target !== null` | `measureCopy.measureLine` |
| the bar | `m.progress != null` | `Measure.MeasureBar` |

- **no-target gauge** → `24 reps`. No slash, no percentage, no bar, no completion criterion, and nothing on
  screen mentions a target it does not have (asserted by a `queryByText(/target/i)` that must find nothing).
- **`progress` absent** (`target === start` in the data) → `62 / 62 leads` with **no bar**. Keying the
  numbers off `progress` would render it `62 leads`, which is a lie about the data.
- **over target** → a full bar, `clamp(progress, 0, 1)`, never `120%` and never past its own end.
- **done below target** → title struck, the measure line **unstruck** in `T.mut`, bar at 80 %, no red and
  no note.
- `m.progress` is typed `number | null` but read with `!= null`, so an **absent** field renders the same as
  a null one.

**No percentage is rendered anywhere.** One test asserts `document.body.textContent` matches no `\d%` on a
page whose progress is `0.2067`. The bar is `aria-hidden` and carries **no `role="progressbar"`**, because
that role's `aria-valuenow` is announced as a percentage. **Reaching the target renders and announces
nothing** — a test records a reading that hits the target exactly and asserts the numbers and the bar
changed, the ordinary announcement fired, and no second sentence, no completion word and no auto-tick
appeared.

---

## 6. Divergences from the UX plan, and why

1. **Where the band's Monthly goals come from — a second read the plan did not budget for.**
   §4.1 says the band renders `Title` and `LifeLine` per Monthly goal. **The wire does not carry them**:
   `monthTasks` is tasks only, and `items`, `carried`, `groups` and `parents` on a Weekly payload are all
   about *Weekly* goals. So `MonthBand` reads `useLens('Monthly', monthPeriodKey)` — **one** extra request,
   under the exact key the Monthly tab itself uses, so switching to that tab afterwards is free. The
   alternative was one `GET /goals/:id` per goal in the band (N requests for two fields). The band waits
   for that read rather than drawing a title-less card; it is the last section on the screen.
   *If the reviewer prefers it, the honest fix is on the API side: put the band's goals on the payload.*

2. **`Add 1 lead` from the unit `leads` — a singularisation this product's own rules forbid.**
   §3.5's copy table is explicit. It is implemented (a guarded trailing-`s` strip, confined to one
   accessible name), and it is the one call in the plan I think is wrong: `docs/BUSINESS-RULES.md` says
   *"The unit is a word, never parsed and never converted"*, and `status` would be spoken `statu`.
   **Recommend overruling to `Add 1 leads`** — one line in `measureCopy.plusOneName`.

3. **`R-goal-47`'s position: the plan wins over A8's own SPEC note.** §4.4 lists the planned-ness line at
   position 3, *above* the nested list, and §2.3's mockup draws it there; `R-goal-47`'s A8 note says it
   renders *beneath* the task list. Built as the plan draws it, and `R-goal-47` amended to say so and why.

4. **`taskWeekForMonth` is not deleted from `packages/shared`.** `32-week-selection` §4.3 says "A8 deletes
   `taskWeekForMonth`". The **web** no longer imports it (that was the defect the deletion targets), but the
   function is in `no-second-calendar.test.ts`'s census and is what proves `taskWeeksInMonth[0]` and the old
   default agree. Deleting a shared export is an API-side change and is out of this pass's scope.

5. **A create toast the plan does not specify.** The month path lands the task on the card that was tapped
   and therefore **does not navigate** — but a write that names no destination is A9's own defect, so it
   shows `Added to Aug 2026` (`labelOf('Monthly', …)`, no new date spelling), the twin of the existing
   `Added to week of 31 Aug`.

6. **`R-backlog-31`'s `Add to this month` on the Backlog page is not built.** It is an A8 rule, it is not in
   `33-measurables-ux`, and the brief did not name it. `BacklogItemCard`'s `Add to this week` is untouched
   and still works. Flagged for a later pass.

7. **The measure block's polite region is its own.** §F says "the existing polite region"; the task page has
   none (the lens's is on `LensScreen`). One visually-hidden `aria-live="polite"` div lives in
   `MeasureBlock` and carries both the record and the delete announcements — one region on the page, which
   is the property the rule is protecting.

8. **`+ Task` in the band passes `period` explicitly, and completion in the band does too.**
   `TaskRow` gained an optional `period` prop. `weekClock.periodFor('Monthly', …)` answers the **current**
   month by construction, which would tick an August task into September from August's band and drop the row
   off the screen it was ticked on. §4.1 is explicit that the band completes into `monthPeriodKey`; the
   Monthly card passes `goal.periodKey` for the same reason.

---

## 7. Tests: what was added, and the two verdicts

**Added: 41 tests** (439 → 480). Every state the UX plan's mockups draw has one, plus the seven the brief
named by name: the past-month band at the pinned clock of 2 Sep 2026; a month task in a week with no carry
label of any kind; reaching a target rendering and announcing nothing; deleting a reading updating the
sparkline and the current value; the sparkline absent below two readings and carrying a text equivalent
when present; and full keyboard operation of setting and updating a measure.

**Retired: none. Weakened: none. Restated with a verdict: 4**, all in one place and all for one reason —
`R-task-49` is **retired in full by A8**, and `R-task-57` as amended by A11 (plus the owner's ruling on
`32-week-selection` §9.2) makes **the month the default**. The inference each of those tests covers is
therefore no longer the default; it is what happens after the owner names a week.

| Test | Verdict |
|---|---|
| `creation.test.tsx` "with NO weekly goal in the target week, one is created" | R-task-49 retired / R-task-57 amended — the week is now an explicit narrowing. One chip tap added; **every assertion kept**, and the zero-candidate note is now asserted to be *both* rendered and announced. |
| `creation.test.tsx` "A9: with exactly ONE weekly goal it is named as a FILLED choice" | same verdict, same one tap; A9's whole point (one candidate is an ANSWER, not an absence) is unchanged and still asserted. |
| `creation.test.tsx` "with MORE than one, the first is preselected" | same verdict, same one tap. Also switched one `getByRole` to `findByRole`: the chosen week's candidates are a read, and the synchronous query was a latent race that the extra step made visible. |
| `goalPicker.test.tsx` "`weeklyTarget`: Weekly goals in the target week" | same verdict. The mode is reached by naming a week; every assertion about the mode — including that it renders **no** horizon selector — is unchanged. |

One test was **added** to cover the default those four displaced: *"R-task-57: the MONTH is the default, and
it creates one row on the goal you tapped"*, which asserts one row, no `newWeeklyGoal`, and that **the lens
does not move**.

---

## 8. Spec and business rules

`docs/SPEC.md` §2 amended in place, seven rules, each marked `⚠ AMENDED BY A8’S WEB HALF` with the section
of `33-measurables-ux` that ordered it: **`R-lens-31`** (the heading names its month; `+ Task` on the card's
foot, iff the month is not past; the past-month foot; no `Pull from backlog`; no Park on a row; ordinary
cards at full weight), **`R-lens-32`** (`Nothing on this month yet.`), **`R-goal-47`** (`No weeks yet`, and
the line's position settled), **`R-task-56`** (both directions raised from the task page; un-park names its
destination), **`R-task-59`** (the demote's landing goal), **`R-measure-4`** (two independent keys) and
**`R-measure-8`** (no percentage, no `role="progressbar"`, nothing at the target). §6's Amendment 8 ledger
gains **The web half**, tabulating the seven with their reasons.

**`docs/BUSINESS-RULES.md` is unchanged, deliberately.** `33-measurables-ux` §7.8 asks for two sentences
that are **already there** and better written — A8's own *"Below both of those sits **this month**…"* and
*"**Nothing in that month band wears a late label**…"* in the weekly-lens section, and the whole Measure
section — and A11 §8.6's month-default sentence landed with the API half. So
`apps/api/src/api/mcp/business-rules.ts` needed **no** regeneration, and
`apps/api/tests/mcp/verbatim.test.ts` is green as the proof rather than as an alibi.

---

## 9. Chrome, accessibility and the standing constraints

- **No new dependency, no new colour, no new token.** The sparkline is inline SVG; the bar is `T.ink` on
  `T.lineSoft`; every chip is the shipped `S.chipBtn`. `tests/screens/contrast.test.ts` has nothing new to
  check and is unchanged.
- **`R-nav-27` is untouched in letter and in fact.** Everything added to a lens is conditional and renders
  **below** the first item; the sticky block stays 91–96 px and gains nothing.
- **One new sheet kind** (`retarget`), **no fifth `R-nav-31` mode**, no new modal pattern, no row menu, no
  swipe, no long-press, no animation and no `prefers-reduced-motion` branch.
- **`ChipRadioGroup` is extracted, not duplicated** (`32-week-selection` §7's directive): `GoalPicker`'s
  horizon selector now renders it too, so the three controls cannot come to disagree about `Home`. Its DOM
  is byte-compatible with what shipped — same ids, same `aria-label`s — and `goalPicker.test.tsx` proves it.
- Every number field is labelled visibly **and** by `aria-label`, with `inputMode="decimal"`;
  `Unit` is `inputMode="text"` + `autoCapitalize="off"`. The `+1` chip's name spells the unit. Focus lands
  on `Keep` when the remove strip opens, and on the row that replaced a deleted reading (or the `READINGS`
  eyebrow) after a delete — never `<body>`.

## 10. Verified by eye, and verified only by tests

**Only by tests.** No browser pass was run in this stage: `npm run build` was exercised for its output, not
its pixels. The 360 px layout, the band's position on a real screen, the sparkline's line weight at two
widths, and the create sheet's scroll in its open state (§2.9 predicts ≈ 628 px against an 88 vh sheet, so
it *should* scroll) are all unverified by eye and are the E2E pass's first four items.
