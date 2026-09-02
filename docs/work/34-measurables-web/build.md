# 34 — Amendment 8, the web half: month tasks, counters, gauges and readings

Design: `docs/work/33-measurables-ux/UX-PLAN.md`, implemented literally. Its prior art, also built here
because 33 depends on it and it had not shipped: `docs/work/32-week-selection/UX-PLAN.md` — the
`When this lands` control, with **the month as the first option and the default** (the owner's ruling on
its §9.2).
Contract consumed, not designed: `docs/work/31-measurables-api/build.md` §2. Nothing on the wire changed.

Green at the end: **655 api / 481 web / 132 shared**, typecheck clean across all three workspaces,
`npm run build -w @goal-cascade/web` emitting `dist/sw.js` with a 13-entry precache manifest. Floors were
655 / 439 / 132. Nothing deployed, nothing merged.

⚠ **§13 is a later pass on this same build**: five defects found by review before anything merged, plus six
test-quality gaps in the tests below. Two of the five needed the wire. Green after it: **661 api / 491 web /
132 shared**. Where §1–§12 and §13 disagree, **§13 is what shipped.**

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
| `apps/web/tests/screens/measures.test.tsx` | every measure state, the record control, the sparkline, keyboard, the unit rule — 24 tests |
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

1. **Where the band's Monthly goals come from — a second read the plan did not budget for.** ⚠ **RESOLVED
   IN §13, and the read was not merely expensive — it was WRONG. `LensResponse.monthGoals` landed.**
   §4.1 says the band renders `Title` and `LifeLine` per Monthly goal. **The wire does not carry them**:
   `monthTasks` is tasks only, and `items`, `carried`, `groups` and `parents` on a Weekly payload are all
   about *Weekly* goals. So `MonthBand` reads `useLens('Monthly', monthPeriodKey)` — **one** extra request,
   under the exact key the Monthly tab itself uses, so switching to that tab afterwards is free. The
   alternative was one `GET /goals/:id` per goal in the band (N requests for two fields). The band waits
   for that read rather than drawing a title-less card; it is the last section on the screen.
   **See §11 — it is written up there as its own change.**

2. **`Add 1 lead` from the unit `leads` — ⚠ RAISED, AND OVERRULED BY THE OWNER. The chip's accessible
   name is `Add 1 to leads`, and no code anywhere transforms a unit string.**
   §3.5's copy table asked for `Add 1 lead`, which needs the owner's own word singularised. It was built
   that way, flagged, and overruled in the same pass. The owner's reasoning, kept because it is the rule
   and not a preference: `docs/BUSINESS-RULES.md` says *"The unit is a word, never parsed and never
   converted"*; stripping a trailing `s` **is** parsing; it is English-only; and across real units it is a
   coin flip — `status → statu`, `press → pres`, plus `kg`, `reps`, `lbs`, `mins` and anything typed in
   another language. **A label that mangles the owner's own word is worse than one that omits it**, and
   nothing is lost, because the unit already appears verbatim in the value line immediately beside the chip
   (`62 / 300 leads`). The name carries the verb and the direction instead: `Add 1 to leads`, or `Add 1`
   with no unit.
   The `singular()` helper is **deleted, not disabled** — there is no unit-transforming code left in the
   web to be reached for again — and `measures.test.tsx` pins the rule rather than the label with the case
   that proves it: a measure whose unit is **`status`** must render `Add 1 to status`, and no string
   anywhere on the page may match `/statu(?!s)/`. `status` is chosen because it is the unit a trailing-`s`
   strip gets *wrong* rather than merely awkward.

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

6. **`R-backlog-31`'s `Add to this month` on the Backlog page is not built — a KNOWN GAP, confirmed out of
   scope by the owner. See §12.** It is an A8 rule, it is not designed in `33-measurables-ux`, and the brief
   did not name it. `BacklogItemCard`'s `Add to this week` is untouched and still works.

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

**Added: 42 tests** (439 → 481). Every state the UX plan's mockups draw has one, plus the seven the brief
named by name: the past-month band at the pinned clock of 2 Sep 2026; a month task in a week with no carry
label of any kind; reaching a target rendering and announcing nothing; deleting a reading updating the
sparkline and the current value; the sparkline absent below two readings and carrying a text equivalent
when present; and full keyboard operation of setting and updating a measure. The forty-second was added on
the owner's overrule (§6.2): a unit of `status` must be spoken whole, which pins *the unit is never parsed*
rather than pinning a label.

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

---

## 11. Hand-off: put the band's goals on the wire (API-side, not done here) — ⚠ **DONE IN §13**

*Kept as written because §13's fix is exactly this, and because the cost analysis below is what justified
it. The one thing this section got wrong is stated at the top of §13.1: the extra read was not only a round
trip, it answered with the wrong month's goals.*

**The problem, precisely.** `LensResponse.monthTasks` carries `TaskView`s and nothing else. The band has to
draw one card per Monthly goal — `Title` (title + pulse dot) and `LifeLine` (`under <life goal>`, plus the
Life goal's id so the line is a link) — and **none of that is on a Weekly payload**:

| field on a Weekly `LensResponse` | what it is about | usable by the band? |
|---|---|---|
| `items` | the week's **Weekly** goals | no |
| `carried` | earlier weeks' **Weekly** goals | no |
| `groups` | the Life roots of `items` + `carried` | no — a band goal's line may not be among them |
| `parents` | `parentsOf(interior, rendered)` — the parents of `items` + `carried` | **incidentally often**, never reliably |

`parents` is the near miss worth naming: the band's Monthly goal is *usually* also the parent of one of the
week's Weekly goals, so a build that used it would pass on the fixture account and fail the first time the
owner has a month task on a goal with no weekly plan — which is exactly the case A8 exists to serve.

**What the fix would be.** `GoalService.lens` already holds every one of these values while it builds the
response: `monthTaskRows` gives the goal ids, `byId`/`interior` hold the goals, and `this.toView(g, view)`
is the same projection `items` uses. The smallest honest change is one new field beside the two A8 added:

```ts
/** R-lens-31 — the Monthly goals `monthTasks` hang on, so the band needs no second read. Weekly lens only. */
monthGoals: GoalView[]
```

built from `[...new Set(monthTaskRows.map(t => t.goalId))]` in first-appearance order, projected through
`toView`, with `groupsOf` widened to include them so their Life lines resolve from the same payload. It is
one `listByIds` on ids already in hand, inside a `Promise.all` that already makes five reads.

**What the extra read costs today** (measured against the code as committed, not estimated):

- **One `GET /goals?lens=Monthly&period=<monthPeriodKey>` per Weekly lens view where the band renders.**
  It fires only when `monthTasks.length > 0`; a week with no month tasks makes no extra request at all.
- It is cached under `keys.goals('Monthly', monthPeriodKey)` — **the Monthly tab's own key** — so it is
  shared both ways: opening the Monthly lens afterwards is a cache hit, and arriving from the Monthly lens
  makes the band free.
- **The band's cards therefore arrive one round trip after the rest of the lens.** The band is the last
  section on the screen and below the fold at 360 px, and it waits rather than drawing a title-less card —
  a half-drawn card reads as a bug in a way a section arriving a moment later does not. It is still a
  visible seam on a slow connection and is the honest cost of not changing the contract in this pass.
- The payload is a whole Monthly lens page (`MAX_PAGE` goals, their `weeklyBreakdown` and `backlogCount`)
  to render two fields per card — the clearest argument for moving it onto the Weekly payload.

**Where it lives:** `MonthBand` in `apps/web/src/lens/LensScreen.tsx`, the `useLens('Monthly', …)` call and
the `byId` / `lives` maps built from it. When `monthGoals` lands, that call and both maps are deleted and
the band reads `data.monthGoals` — no other line of the band changes.

---

## 12. Known gap: `R-backlog-31`'s `Add to this month`

**Not built, and confirmed out of scope by the owner.** Written down here because *the owner's backlog is
empty right now, which is exactly how a missing backlog affordance stays invisible.*

`R-backlog-31` gives a backlog item **two** promotions: `Add to this week` (which ships, unchanged) and
`Add to this month`, which lands the item on the Monthly goal it is **already attached to** — no
resolution, no candidate list, no ambiguity, no `NO_WEEKLY_GOAL` and no implicitly created Weekly goal.

**The server half is built and reachable.** `ConvertBacklogItemRequest.period` accepts a month key and takes
that path (`docs/work/31-measurables-api/build.md` §2), and this pass **already wired the client to send
it**: `useConvertBacklogItem` gained a `period` passthrough, and `TaskCreateSheet` posts a month key when the
month chip is chosen — which is the path a Monthly card's `Pull from backlog` takes today.

**What is missing is exactly one surface: the Backlog page's own row action.**
`apps/web/src/components/BacklogItemCard.tsx` offers `Add to this week` and `Move to another goal`, and its
`Add to this week` still opens the create sheet with `newWeekly` + `weekStart: clock.currentMonday` — a
**week**-targeted conversion with no `monthKey`, so it renders no `When this lands` control at all. On an
item attached to a Monthly goal it should offer the month too, which is one more `S.menuBtn` opening the
same sheet with `{ monthGoal: { id: item.goalId, title: item.goalTitle }, monthKey: <that goal's month> }`
and letting the existing chips do the rest.

**Two things it needs that this pass did not resolve, and they are why it is not a one-liner:**

1. **The item's goal's *month* is not on `BacklogItemView`.** It carries `goalId` and `goalTitle` but no
   `periodKey`, and the month is what the chip control is seeded from. Either the view gains it, or the card
   reads `useGoal(item.goalId)` — the same shape of second read §11 is about, on a different surface.
2. **The offer must be withdrawn where the server would refuse it** (D-5): a month key against an item on a
   **Yearly or Quarterly** goal is `NOT_A_TASK_GOAL`, so the button may only render for an item whose goal
   is Monthly — which needs the same fact as (1).

There is **no UX design for it**: `33-measurables-ux` does not cover the Backlog page, so this needs a UX
pass before a build one, not a build agent guessing at a second button on a row.

---

## 13. The fix pass: five defects, six test-quality gaps

Found by code review against this branch **before anything merged**. Nothing here is a new feature; every
item is something §1–§12 built or tested wrongly. Floors held: **661 api / 491 web / 132 shared** (from
655 / 481 / 132), typecheck clean in all three workspaces, `npm run build -w @goal-cascade/web` green.
Nothing deployed, nothing merged.

### 13.1 A carried month task rendered nowhere — and could take the whole band with it

**The defect.** `MonthBand` read `useLens('Monthly', monthPeriodKey)` and indexed *that month's* goals by
id, then dropped every card whose goal it could not find. A **carried** month task's goal keeps its own
earlier `periodKey` (R-task-53) — a task carried out of June and open in August hangs off a **June**
Monthly goal, which is not on August's page — so the row was filtered out silently, and when every task in
the band was carried `cards.length === 0` returned `null`: the heading, the deadline sentence and the
past-month foot all gone, while `showMonthBand` was true. Carrying is the whole reason month tasks exist,
so this broke the feature's main case.

**§11's own proposal, built.** `LensResponse.monthGoals: GoalView[]` — Weekly lens only, one entry per
distinct `goalId` in `monthTasks`, in that array's first-appearance order, resolved out of `interior`,
which already holds **every** Monthly goal the account has (R-lens-27). It costs **no read**: the
`listByIds` §11 budgeted for was not even needed, because the ids were already in memory. `groupsOf` is
widened to cover them so a Life line reached only through the band still resolves its `under …` — which is
a genuine amendment to R-lens-19 and is written up in `SPEC.md` as one: `groups` covers *what the screen
shows*, not what `items` holds. `openTasks` stays 0 there; S-lens-31-3 is untouched.

**The `useLens('Monthly', …)` call and both maps it fed are deleted, not kept as a fallback**, and a test
asserts the Weekly lens makes **zero** `lens=Monthly` requests. A fallback read would be the defect
re-added with a longer path to it.

### 13.2 `Move to Backlog` on a month task was refused every time

`ConfirmTaskExitSheet` took a week **offset** and `useMoveTaskToBacklog` turned it into
`addWeeks(currentMonday, week)` — always a Monday. A Monday against a `scope: 'Monthly'` task is
`WEEK_OUT_OF_RANGE`: the server's scope check doing exactly its job (R-task-52). The sheet was already
reading `task.scope` two lines away, to name the goal the item lands on, so the fact was on the screen
while the write was wrong.

It now sends `clock.periodFor(task.scope, week, task.originPeriodKey)` — **the client's one spelling of
"the period to write a task into"**, whose docblock already named the exit sheet as one of its callers.
`periodFor` gained an optional origin as a **lower bound**: the current month is right for a carried task
and wrong for one written into a month that has not arrived (legal and ordinary — R-goal-36), so the
answer is the later of the two. It is a comparison of two `YYYY-MM` keys, not a date computation — the
property R-goal-33 chose the format for — so no calendar function is declared outside `shared/calendar`.

### 13.3 `Move to <month>`: withdrawn, and here is why there was no third option

The un-park button sent `period: monthlyAncestor.periodKey` unconditionally, so whenever that month was
past the server answered `PERIOD_IN_PAST` — and the MSW handler did not replicate the refusal, so a green
test pinned a write that could not succeed. Worse than untested: it looked like a guard.

**"Retarget to the current month instead" is not an option that exists.** `unpark` derives the destination
from the tree — the Weekly goal's nearest Monthly ancestor — and then *checks* the key the client sent
against that goal's own month, refusing any other with `VALIDATION_FAILED`. There is exactly one legal key
and it is the one that is past. So the two honest behaviours are *send a write the server refuses* or
*take the control away*, and **the control is taken away**: `MonthBand`'s own answer to the identical
shape, `canUnpark = !isPastPeriod('Monthly', ancestor.periodKey, today)`, the error unreachable rather
than handled. D-5 applies unchanged — withdrawn, never disabled, and **no sentence apologising for an
option that was never real**. The `In the week of 31 Aug.` line still renders: where the task lives is a
fact and stays true.

**It is not the rare case.** At the seam the Weekly lens shows the week of Mon 31 Aug while the calendar
month is September, so a task in *this* week under an August Monthly goal meets it on 2 September.

### 13.4 `Park in a week` dead-ended for a carried task — the offer moves, the control stays

`weeks = taskWeeksInMonth(task.originPeriodKey, clock.today)`, and a carried task's **origin** month is
behind, so every week of it was filtered out as past: `weeks` was `[]`, `chosen` was `null`, `blocked` was
permanently true. The sheet opened and could never be finished.

**Decided: offer the weeks of the month the task is IN now** — the same `periodFor` answer §13.2 uses —
rather than withdrawing the control. Parking a long-carried task into a week of the month it has reached
is the most useful thing this sheet does; withdrawing it would leave that task with no way out of the
month but an exit, which is the opposite of what R-task-59 is for. It is also exactly what the server
accepts: `park` bounds the target week by `PERIOD_IN_PAST` and by **nothing else** — it does not require
the week to sit inside the task's origin month — so no option offered can be refused. The destination line
moves with it (`Lands in the week of 14 Sep · Sep 2026.`): naming the origin month would describe a month
the write does not touch.

*The asymmetry with §13.3 is not an inconsistency.* Park has up to four legal targets and needed the right
list; un-park has exactly one legal target and it is illegal. A control is re-aimed when something legal is
left to offer, and withdrawn when nothing is.

### 13.5 A measure attached during a backlog conversion was silently discarded — and it was an API change

The sheet renders `MeasureFields` on both save paths, validates the draft on both, and **gates `Save task`
on that validity** on both (`measureBlocked`) — then the `convertItem` branch dropped the measure on the
floor. A number the owner was required to get right, discarded without a word: A9's own
silent-partial-write defect in a new place.

`ConvertBacklogItemRequest` did **not** accept a measure (it is `.strict()`), so this is an API change and
it is made: `measure: MeasureInput.optional()`, the twin of `CreateTaskRequest.measure`. Hiding the fields
on that path was rejected — it makes the same task reachable with a number through one door and not the
other, for no reason the owner can see.

Server-side it is **explicit only**. `buildTaskWrites`' comment *"a conversion never brings a measure"* was
right about the **item** (which has no number to carry) and was doing duty for a rule about the
**command**; it now says so, and absent still means the five nulls. The task comes back measurable with its
`Measure added` line in the same batch (R-task-58) — which meant `toNewTaskDetailView`'s hardcoded
`measure: null` and single-event array had to go too, or the response would have lied about the row it had
just written.

**`assertMeasure` and `measureColumns` moved from `TaskService` to `domain/measures.ts`.** The docblock
claimed to be *"the whole enforcement point"*, which was true while one service wrote measures and stopped
being true the moment a conversion could. They are module functions now, called by both minting paths, and
`MEASURE_TARGET_EQUALS_START` answers 422 on both.

### 13.6 The six test-quality gaps

| Gap | What it was | What it is now |
|---|---|---|
| **A** | `Pull from backlog` asserted absent only in the **past-month** test, where the whole `LinkRow` is already gone — deleting `pull={false}` kept the suite green | asserted on the off-seam test, on the card that **does** render `+ Task`, where the prop is the only thing suppressing it |
| **B** | *the governing rule of the feature* guarded by a six-word blacklist that `🎉 Nice one`, `Target met` and `Nailed it` all pass | the announcing region's full `textContent` **equals** `recordedAnnouncement(m)` — the copy function is called, not spelled, so the assertion cannot drift from what it pins |
| **C** | an enumerated list of forbidden SVG children, missing `polyline`, `polygon`, `use`, `marker`, `image`, `foreignObject`, `animate`, `tspan` and — pointedly — **`<title>`**, the tooltip `Sparkline.tsx`'s own docblock forbids by name | `svg.querySelectorAll('*')` has length **1**. Not a list; a count |
| **D** | `queryByText('Recorded')` — a whole-string exact match, so it fires only on an element whose entire text is that one word, which no real toast is | `queryByRole('status')` |
| **E** | three tests passed identically against `main`: a no-measure row that never constructs a measure; a "band absent" test whose two conditions were already true; and a "both directions" title asserting one | the plain row is now rendered **beside a measured one on the same screen**; the band test carries its own counter-example (same payload, one task added); the un-park direction is asserted, which is where 13.3 and 13.4 lived |
| **F** | carry suppression tested at `carryAge: 3` only, by matching three strings — missing the age-1 branch, and unable to tell *suppressed* from *spelled differently* | `CarryLabel`'s wrapper carries `data-testid="carry-label"`; asserted **absent in the band and present on the same task in the Monthly lens**, at ages 1 and 3 |

### 13.7 The ledger — what was proven to fail first, and what is a guard

**The rule, applied literally: a test is a regression guard only if it was RUN against the unfixed code and
failed.** Everything else is labelled coverage or a guard, and where a guard's value depends on a
counterfactual, that counterfactual was **run**, not reasoned about.

| Test | Verdict |
|---|---|
| `monthBand` — carried task renders under its own goal's title | **proven to fail first** (its goal was not in the Monthly page's `byId`) |
| `monthBand` — the whole band renders when every task is carried | **proven to fail first** (`MonthBand` returned `null`) |
| `monthBand` — no `lens=Monthly` request | **proven to fail first** (1 request) |
| `month-tasks` (api) — `monthGoals` carries a goal from an earlier month | **proven to fail first** (re-run against `monthGoals: []`) |
| `month-tasks` (api) — a band-only Life root is in `groups` | **proven to fail first** (same run) |
| `month-tasks` (api) — `monthGoals` empty on every other lens | **coverage** — vacuously true before, because the field did not exist |
| `park` — `Move to Backlog` on a month task posts a month key | **proven to fail first** (posted `2026-08-31`) |
| `park` — a week task still posts its week | **coverage** — green before and after; it pins the half that must not move |
| `park` — un-park withdrawn when the ancestor's month is past | **proven to fail first**, re-run after tightening the name regex: `/^Move to /` also matched `Move to Backlog`, so the first red was for the wrong reason and does not count |
| `park` — a carried task's Park offers the current month's weeks | **proven to fail first** (no radiogroup at all: the list was empty) |
| `backlog` — a measure travels on the convert command | **proven to fail first** (no `measure` in the body) |
| `backlog` — no `measure` key when none was attached | **coverage** — green before and after |
| `convert` (api) — the conversion carries a named measure and logs it | **proven to fail first** (re-run with the passthrough removed) |
| `convert` (api) — `target === start` refused on this path | **proven to fail first** (same run) |
| `convert` (api) — no measure named ⇒ an ordinary checkbox | **coverage** |
| **A** — `Pull from backlog` absent where `+ Task` renders | **guard**, green before and after. **Counterfactual RUN**: deleting `pull={false}` turns it red |
| **B** — the announcement equals `recordedAnnouncement(m)` | **guard**, green before and after. **Counterfactual RUN**: appending `' Nailed it.'` to the announcement turns it red — the old blacklist stayed green |
| **C** — the sparkline's `<svg>` has exactly one child | **guard**, green before and after. **Counterfactual RUN**: adding `<title>Readings</title>` turns it red — the old enumeration stayed green |
| **D** — `queryByRole('status')` | **guard**, green before and after. **Counterfactual RUN**: showing a toast on record turns it red — the old `queryByText('Recorded')` stayed green |
| **E** — the plain row beside a measured one | **guard**. It is the assertion `main` cannot pass, which is exactly what the gap was |
| **E** — the band's counter-example in the same test | **guard**. It discriminates against *no band at all*; it does **not** discriminate a gate keyed on `monthGoals`, because `MonthBand` returns `null` for an empty card list either way. Stated rather than claimed — that counterfactual was run and stayed green |
| **E** — both directions withdrawn once the task is not open | **guard** for the un-park half, which was untested |
| **F** — `carry-label` absent in the band, present in the Monthly lens, at ages 1 and 3 | **proven to fail first** (the `data-testid` did not exist). **Counterfactual also RUN**: dropping `suppressCarry` turns it red |

**Counts.** Web 481 → **491** (+10: 4 `monthBand`, 4 `park`, 2 `backlog`; `measures` is net 0 — four tests
strengthened in place, none added, none weakened). API 655 → **661** (+3 `month-tasks`, +3 `convert`).
Shared **132**, unchanged. **Nothing was retired and nothing was weakened.**

### 13.8 Docs

- `docs/SPEC.md` §2: **R-lens-31** (`monthGoals` on the wire, and the R-lens-19 amendment it forces),
  **R-task-55** (the exits name a period at the task's own scope; the "month a task is in now" rule),
  **R-task-56** (Park's option list; un-park's third withdrawal), **R-backlog-31** (the conversion carries a
  named measure, and where the one enforcement point now lives). §6's Amendment 8 ledger gains **The web
  half's fix pass**, tabulating the five with which of them touched the wire.
- ⚠ **`docs/BUSINESS-RULES.md` DID change this time**, in two bullets — Park's week list and its
  one-legal-destination rule, and that the conversion sheet's save carries whatever you set in it — so
  `apps/api/src/api/mcp/business-rules.ts` is **regenerated in the same commit**, and
  `apps/api/tests/mcp/verbatim.test.ts` is green as the proof rather than as an alibi.

### 13.9 Still true from §10, and still not verified by eye

No browser pass was run in this pass either. The month band's cards now arrive **with** the rest of the
lens rather than a round trip later, which removes the seam §11 predicted — that improvement is reasoned
from the deleted request and the passing test, **not seen**. It stays first on the E2E list.
