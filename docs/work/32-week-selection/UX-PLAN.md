# 32 — UX plan: choosing which week a task lands in

Spec authority: `docs/SPEC.md` §2 (`R-task-41`, `R-task-48`, `R-task-49`, `R-task-56`, `R-task-57`,
`R-nav-27`, `R-nav-31`, `R-lens-13`, `R-goal-36`), §6 **Amendment 8** and **Amendment 9**.
Prior art this extends rather than replaces: `docs/work/27-picker-and-clamp/build.md` §3–§4 (the
`WHERE THIS GOES` block and the `taskWeekForMonth` clamp), `docs/work/22-ux-fixes/UX-PLAN.md` §7 (the one
goal picker), `docs/work/29-ux-navigation/UX-PLAN.md` §3.4 (chips as the sheet's field-value idiom).

The owner, on the task-create sheet reached from a Monthly goal's `+ Task`:

> *"but still i am not able to add task to an existing monthly goal with selecting a week from the UI"*

Verified. There is **no week control anywhere in that sheet.** `weeklyTarget` takes a fixed `weekStart`
and offers the Weekly goals inside that one week; the week itself comes from `taskWeekForMonth`, which A9
made *correct* (always inside the month) without making it *changeable*. The `WHERE THIS GOES` block names
the week — `Lands in the week of 5 Oct · Oct 2026.` — directly above a row that changes the **goal**. The
one fact the block states is the one fact the sheet will not let you edit.

---

## 1. The decision

**One control: a `role="radiogroup"` of `S.chipBtn` chips at the top of the existing `WHERE THIS GOES`
block, whose value is a `periodKey` and whose options are the Monthly goal's own weeks — today just the
weeks, and from Amendment 8 the month itself as a leading option.** It is chips and not a second compact
picker row, because the option set is four to six short, fixed, ungroupable, unsearchable labels: the goal
picker's whole apparatus — search, Life-line grouping, `RECENT`, truncation — would render empty, and a
takeover would cost two taps and hide the range it exists to show. **The week is the independent variable
and the goal is derived from it**: changing the week clears the picked Weekly goal and re-preselects from
the new week's candidates, and changing the goal never changes the week — one direction only, so there is
no cycle to arbitrate. **The offered weeks are exactly the Mondays belonging to that month that are not
before the current week** (`R-goal-33`'s Monday rule, `R-goal-36`'s no-back-dating), which makes the
existing `taskWeekForMonth` default *the first offered option* rather than a separate rule, and makes the
month bound the thing that keeps A9's leak fixed. **Every sentence in the block is a pure function of the
chosen period from this change onward** — the sheet's `weekStart` prop becomes a seed and is never read
again — which is what keeps `This starts a weekly goal … for the week of 5 Oct` true after the owner moves
to 19 Oct. `+ Task` from a **Weekly** goal, the `+` drawer's `Add to this week instead`, and the server's
`AMBIGUOUS_CONVERSION_TARGET` refusal render **no control at all**, each for a different and stated reason.

---

## 2. The states, at 360 px

Running example, matching the owner's own screenshot. Today is **Wed 2 Sep 2026**. The Monthly goal is
*Rebuild the gym habit*, `Oct 2026`, in the Life line *Be strong at 60*. October 2026's Mondays are
**5, 12, 19, 26 Oct**; October is a future month, so all four are offered.

Content width inside `S.sheetInner` at 360 px is **320 px**. `S.chipBtn` is `minHeight: 38`, `padding: 0
13px`, 12.5 px / 700. `5 Oct` ≈ 58 px, `12 Oct` ≈ 66 px; four week chips plus three 6 px gaps ≈ **274 px —
one line.** A five-Monday month (`Mar 2026`: 2, 9, 16, 23, 30) is ≈ 338 px and wraps to two. Wrapping is
correct and needs no scroller, for the reason `29-ux-navigation` §3.4 already gives: *inside a sheet there
is no chrome budget and vertical space is cheap.*

### 2.1 State A — opened from a Monthly goal, default week, one candidate

```
┌────────────────────────────────────────────┐
│  New task                               ✕  │
│  ┌──────────────────────────────────────┐  │
│  │ What needs doing?                    │  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │ How will you know it's done?         │  │
│  └──────────────────────────────────────┘  │
│                                            │
│  WHERE THIS GOES                           │
│  (5 Oct)( 12 Oct )( 19 Oct )( 26 Oct )     │  ← 5 Oct filled; one line
│  ┌──────────────────────────────────────┐  │
│  │ Three sessions a week              › │  │  ← the existing picker row
│  │ Be strong at 60 · Week of 5 Oct      │  │
│  └──────────────────────────────────────┘  │
│  Lands in the week of 5 Oct · Oct 2026.    │
│                                            │
│  [             Save task              ]    │
└────────────────────────────────────────────┘
```

Everything below the chip row is byte-identical to what ships today. The chips are the whole addition:
**one row, inside an existing block, under an existing eyebrow.**

### 2.2 State B — the week changed to 19 Oct

One tap on `19 Oct`. The picked goal is cleared, the new week's candidates load, the first is preselected
and announced, and both sentences re-render from the new week.

```
│  WHERE THIS GOES                           │
│  ( 5 Oct )( 12 Oct )(19 Oct)( 26 Oct )     │  ← 19 Oct filled
│  ┌──────────────────────────────────────┐  │
│  │ Deload week                        › │  │  ← re-preselected, not kept
│  │ Be strong at 60 · Week of 19 Oct     │  │
│  └──────────────────────────────────────┘  │
│  Lands in the week of 19 Oct · Oct 2026.   │
```

Announced (`role="status"`, polite): `Lands in the week of 19 Oct · Oct 2026. Under Deload week.`

The goal row is **replaced, not cleared**, so it gets no `Cleared — …` sentence: `parentClearedNote`'s
copy exists for a field that became empty, and this one never does while the week has a candidate.

### 2.3 State C — zero candidates in the chosen week

`26 Oct` has no Weekly goal under *Rebuild the gym habit*. The picker row is replaced by the create note,
exactly as today — and the note now names **26 Oct**, which is the defect this plan closes.

```
│  WHERE THIS GOES                           │
│  ( 5 Oct )( 12 Oct )( 19 Oct )(26 Oct)     │
│  ┌──────────────────────────────────────┐  │
│  │ This starts a weekly goal "Rebuild   │  │
│  │ the gym habit" for the week of       │  │
│  │ 26 Oct. You can rename it after.     │  │
│  └──────────────────────────────────────┘  │
│  Lands in the week of 26 Oct · Oct 2026.   │
```

Announced: the create note alone — it already names the week, so pairing it with the destination line
would say `26 Oct` three times in one utterance.

### 2.4 State D — the current month, with past weeks behind us

Today **Wed 16 Sep 2026**; the current Monday is 14 Sep. `Sep 2026`'s Mondays are 7, 14, 21, 28; the 7th
is behind the current week and **is not offered at all** — not rendered, not disabled.

```
│  WHERE THIS GOES                           │
│  (14 Sep)( 21 Sep )( 28 Sep )              │
```

The default is still the first offered chip, and the first offered chip is still exactly
`taskWeekForMonth('2026-09', '2026-09-16')` = 14 Sep. One rule, read two ways.

### 2.5 State E — a Weekly-goal origin: no control

`+ Task` on a Weekly goal card, on a Weekly goal's page, and a backlog pull from a Weekly goal all pass
`goalId`, so the sheet already resolves nothing and renders no `WHERE THIS GOES` block. **That does not
change.** The week is the goal's own `periodKey`; there is no second week it could mean.

```
┌────────────────────────────────────────────┐
│  New task                               ✕  │
│  ┌──────────────────────────────────────┐  │
│  │ What needs doing?                    │  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │ How will you know it's done?         │  │
│  └──────────────────────────────────────┘  │
│                                            │
│  [             Save task              ]    │
└────────────────────────────────────────────┘
```

### 2.6 State F — exactly one option

Today Wed 30 Sep 2026; the current Monday is 28 Sep, the last in the month. `Sep 2026` offers one week.

```
│  WHERE THIS GOES                           │
│  ┌──────────────────────────────────────┐  │
│  │ Three sessions a week              › │  │
│  │ Be strong at 60 · Week of 28 Sep     │  │
│  └──────────────────────────────────────┘  │
│  Lands in the week of 28 Sep · Sep 2026.   │
```

**The chip row does not render below two options.** A9's ruling was that a destination must be *named*,
never that it must be *offered*, and the destination line names it. This is `permittedHorizons`' own rule
one control over — a single-valued selector renders nothing — and `R-lens-19`'s, generalised again. It is
the only state in which the control is absent from a Monthly origin, it is reachable for at most six days
a year, and **from Amendment 8 it is unreachable**, because the month is always a second option.

### 2.7 State G — the server refused: no control

`409 AMBIGUOUS_CONVERSION_TARGET` on a backlog conversion. The server named a candidate list it computed
for one named week, over a subtree the client is not allowed to hold (`R-lens-16`).

```
│  WHERE THIS GOES                           │
│  ┌──────────────────────────────────────┐  │
│  │ Choose a goal                      › │  │
│  └──────────────────────────────────────┘  │
│  Lands in the week of 5 Oct · Oct 2026.    │
│  More than one weekly goal could take      │
│  this. Which one?                          │
```

**No chips.** Changing the week would invalidate the list on screen, and re-deriving it client-side would
silently drop the level-skipped Weekly goals that are the whole reason the server answered. The refusal is
about the week it was asked about; asking about another week is a new question, and the way to ask it is
to close and start again from the goal.

### 2.8 State H — Amendment 8's `no week` option

Once a Monthly goal holds tasks directly (`R-task-51`), the option list grows **one leading option, the
month itself**, and the default moves to it. Nothing else about the control changes.

```
│  WHERE THIS GOES                           │
│  (Oct 2026)( 5 Oct )( 12 Oct )             │  ← Oct 2026 filled; wraps
│  ( 19 Oct )( 26 Oct )                      │
│  Lands in Oct 2026 — no particular week.   │
│                                            │
│  [             Save task              ]    │
└────────────────────────────────────────────┘
```

No goal row: with no week there is nothing to resolve, and `R-task-57` is explicit that the task goes on
the goal you tapped with no picker and no created goal. Tapping any week chip returns the sheet to states
A–C exactly as drawn, and that path is `R-backlog-31`'s `Add to this week` applied to a fresh task instead
of a backlog item — machinery `R-task-48` already survives A8 to serve.

**Why this needs no rework.** The control's value is a `periodKey` from day one — `2026-10-26` or
`2026-10` — and its option list is *the month, then the month's weeks*. That is `R-task-52`'s model
exactly: one field, two scopes, the key's format is the discriminator. Today the month element is simply
absent from the list. A8 adds an element and moves the default; it renames nothing, restructures nothing,
and adds no second control.

---

## 3. Copy, verbatim

### 3.1 New

| Where | String |
|---|---|
| The radiogroup's accessible name | `When this lands` |
| A week chip, visible | `5 Oct` — `shortDate(weekStart)` |
| A week chip, accessible name | `Week of 5 Oct` — `weekOfLabel(weekStart)` |
| The month chip, visible (**A8**) | `Oct 2026` — `labelOf('Monthly', monthKey)` |
| The month chip, accessible name (**A8**) | `Oct 2026 — the whole month, no particular week` |
| The destination line, month chosen (**A8**) | `Lands in Oct 2026 — no particular week.` |
| The status, after a week change with a goal | `<taskDestinationNote> Under <goal title>.` |

That is **one new sentence fragment** (` Under <title>.`) plus two A8-only strings. Everything else is an
existing string or an existing formatter.

- **`When this lands`, not `Which week`.** The name must stay true after A8 puts a month in the list, and
  a control renamed between amendments is a control screen-reader users learn twice. It also matches the
  block's verb: the note already says `Lands in …`.
- **Zero new date spellings.** `5 Oct` is `shortDate` — the exact string this sheet's own note and its own
  toast (`Added to week of 5 Oct`) already use for this exact concept. `Week of 5 Oct` is `weekOfLabel`, the
  product's period label for a week. `Oct 2026` is `labelOf`. A10 is the standing warning here: one month,
  two spellings, one tap apart, is a defect this repo has already shipped and fixed. **The build agent must
  not invent `Mon 5` or `W1`.**
- **A week chip carries no count.** A9's horizon chips say `Weekly — 3 goals` because that list is already
  in hand; labelling four week chips would cost four extra scoped lens reads on every sheet open, to
  pre-answer a question the row directly beneath answers for the week you actually chose.

### 3.2 Unchanged and load-bearing

- `taskDestinationNote(week, month)` → `Lands in the week of 5 Oct · Oct 2026.` — **kept exactly**, and it
  is now the block's summary line rather than its only statement of the week. It keeps naming the month,
  which the chips deliberately do not repeat four times.
- `implicitWeeklyGoalNote(title, week)` → `This starts a weekly goal "<title>" for the week of <d Mon>.
  You can rename it after.` — **kept exactly**, re-rendered from the chosen week.
- `Add to this week instead` (the `+` drawer) — **kept exactly, and not qualified.** See §5.3.

### 3.3 Retired

Nothing.

---

## 4. Structure, and the rules the build follows literally

### 4.1 What renders, in order, inside `WHERE THIS GOES`

1. The chip radiogroup — **only when there are two or more options**.
2. The goal row (`weeklyPicker.control`) **or** the create note — the existing branch on
   `choices.length > 0`, unchanged; **neither, when the month is chosen** (A8).
3. `taskDestinationNote(...)` — **or** `Lands in <month> — no particular week.` when the month is chosen.
4. A visually hidden `role="status"`.

**The week comes first because it scopes what follows.** Reading order is decision order — A9's own
argument for putting the horizon selector above the goal list, one control up.

### 4.2 The option list

```
options(monthKey, today) =
  [ monthKey ]                                    // Amendment 8 only
  ++ mondays whose month is monthKey
       filtered to  monday >= weekStartOfDate(today)
```

- **Bounded by the month, and open-ended nowhere.** The sheet was opened from a goal that lives in one
  month; a week outside it is a different month's business, reachable by one chevron on the Monthly lens.
  An open-ended list is a date picker with the serial numbers filed off (§6.1), and it would re-open
  exactly the leak A9's clamp closed: work put into a week the lens that created it will never show.
- **A week belongs to its Monday's month** (`R-goal-33`), so `Sep 2026` is Mon 7, 14, 21 and 28 Sep and
  **not** the week containing 1 Sep. The weeks of a month partition it; there is no spill and no seam
  option to decide about. This is `firstWeekOf`/`lastWeekOf`'s range, not a new one.
- **Past weeks never appear** (`R-goal-36`, `R-task-41`). Omitted, not disabled: `pickerRow` lost its
  `'dis'` state for this reason, `chipBtn` never had one, and D-5's ruling is that a picker must not offer
  what the server would refuse. There is nothing to explain, because nothing on screen implies the missing
  weeks were ever available.
- **The list is never empty.** `+ Task` does not render on a past month at all (`R-goal-36`,
  `R-task-57`), and any current-or-future month's last Monday is `>=` the current Monday.

### 4.3 The default

**The first option, always.** Two consequences the build must preserve:

- Today, the first option is the first offered week, which is *by construction*
  `taskWeekForMonth(monthKey, today)`: the current week when that week's month is this month, otherwise
  the month's first week. A9's clamp does not go away — it stops being a cage and becomes the head of a
  list.
- From A8, the first option is the month, so `+ Task` on a Monthly goal creates a month task and infers
  nothing (`R-task-57`). A week is then an **explicit narrowing**, which is the only reading under which
  A8's "nothing is inferred" and this control are the same design.

**Directive.** Add one shared function, `taskWeeksInMonth(monthKey, today): string[]`, to
`packages/shared/src/calendar/periods.ts`, and define `taskWeekForMonth(monthKey, today)` as
`taskWeeksInMonth(monthKey, today)[0]` — proven by a test, not by a comment, so the two can never be two
rules. Add it to `no-second-calendar.test.ts`'s `OWNED` census. A8 deletes `taskWeekForMonth` and keeps
`taskWeeksInMonth`.

### 4.4 How the week and the goal relate

- **Changing the week** sets `picked = null`. The existing preselect effect (`choices.length > 0`, A9)
  then fills it from the new week's candidates, or the create note takes over at zero. A goal from the
  old week is **never carried across** — that pair is illegal, and `weeklyTarget`'s whole contract is
  "Weekly goals inside this one week".
- **Changing the goal never changes the week.** Every candidate is inside the chosen week by construction,
  so the reverse implication does not exist to honour. The one place a goal *does* determine a week is
  State G, and that is precisely where the control is not rendered.
- The mode object is unchanged: `{ kind: 'weeklyTarget', parentId, weekStart }` with `weekStart` now
  coming from state rather than from a prop. **`R-nav-31` gains no fifth mode.**

### 4.5 The prop change that makes A8 free

`MonthlyCard` stops computing a target week. `LinkRow` and `PullSheet` pass the **month**:

```
ui.openSheet({ kind: 'taskCreate', newWeekly: { parentId, title }, monthKey: goal.periodKey })
```

`TaskCreateSheet` seeds its own week state from `taskWeeksInMonth(monthKey, today)[0]` and owns it from
then on. The Weekly origin keeps `{ goalId, weekStart: goal.periodKey }` untouched.

**The `weekStart` prop is a seed and is never read after mount.** That single sentence is the whole of the
zero-candidate correctness fix: `implicitWeeklyGoalNote`, `taskDestinationNote`, `monthLabelOfWeek`, the
conversion's `week` offset, the toast and the post-save navigation all read the **chosen** period. A build
that leaves one of them reading the prop reproduces the bug in a smaller place.

### 4.6 After the save

**Navigate to the lens of the period the work landed in.** Today that is the Weekly lens at the chosen
week — the existing behaviour, unchanged, and `R-task-41`'s reason for it is unchanged too: a task created
from the Monthly lens into the week of 19 Oct is not on the card you tapped, so staying put reads as a lost
write. Under A8 the month case lands the task on that very card, so the same predicate is a no-op and
`R-task-57`'s "the lens does not move" is satisfied by the same line of code rather than by a branch.

### 4.7 The chrome ledger

Spent: **one 38 px row of existing `S.chipBtn` chips, wrapping to at most two lines, inside the existing
`WHERE THIS GOES` block.** Not spent: no new eyebrow, no new sheet, no new modal, no new takeover, no new
token, no new colour, no new component in the picker family beyond the extracted chip group (§7), nothing
for `tests/screens/contrast.test.ts` to newly check.

`R-nav-27` is untouched in letter — nothing here renders on a lens — and honoured in spirit. The fold, at
360 × 640 (`S.sheet` `maxHeight: 88vh` = 563 px): header 46 + title 60 + condition 48 + block 160 + save 64
+ padding 50 ≈ **428 px**, or ≈ 472 px with the chips wrapped. `Save task` stays above the fold with no
scroll, which is the property `27-picker-and-clamp` §1 was written to protect.

---

## 5. The other entry points

| Entry point | Control? | Why |
|---|---|---|
| `+ Task` on a **Monthly** card | **yes** | The gap. One month, four or five weeks, none of them reachable. |
| `Pull from backlog` on a **Monthly** card | **yes** | The same sheet resolving the same destination. A backlog item that can only ever become work in the month's first week has the identical defect. |
| `+ Task` on a **Weekly** card or page | **no** | §5.1 |
| `Pull from backlog` on a **Weekly** goal | **no** | Same: `goalId` + the goal's own `periodKey`. |
| The `+` drawer's `Add to this week instead` | **no** | §5.3 |
| Server `AMBIGUOUS_CONVERSION_TARGET` | **no** | §2.7 |
| **A8** `Park in a week` (`R-task-56`) | **yes — the same component** | §5.4 |

### 5.1 A Weekly origin shows nothing

The week is not underdetermined there; it *is* the goal. Rendering a one-option control to say so is the
mistake `permittedHorizons` already refuses for a single-horizon mode, and the sheet says nothing because
there is nothing it could say that the goal you tapped has not said. Adding a chip row here would also
quietly imply the week is editable, which would be false: moving a task between weeks is `Park`
(`R-task-56`), a logged write on an existing task, not a field on a create form.

### 5.2 A backlog pull from a Monthly goal gets it, and it is the same sheet

`PullSheet` already opens `TaskCreateSheet` with `newWeekly` for a Monthly origin. It therefore inherits
the control by construction with no second decision, which is the correct outcome: `Pull from backlog` and
`+ Task` sit in one row, with one meaning each, on the same card (`cards.tsx`'s `LinkRow`).

### 5.3 The `+` drawer does not get it, and the label is not qualified

`Add to this week instead` is a checkbox, and **the checkbox is the week.** A week chooser beneath a
control that says *this week* is a contradiction on screen, and the fix would be to rename the checkbox —
which turns a two-second capture into a planning surface, the exact thing `R-backlog-27` and
`R-backlog-31`'s closing bullet keep it from becoming. The drawer already offers the honest alternative to
*this week*: leave the box unticked and the work becomes a backlog item, which is the product's object for
*no period at all* (`R-backlog-30`). Somebody who wants the week of the 19th wants the goal's card, not
the capture drawer.

This holds under A8 too. The drawer is not given an `Add to this month` twin; `R-backlog-31` puts that
promotion on the item, where the goal is already known.

### 5.4 Park (`R-task-56`) is the second caller, and that is why this is a component

Parking a month task asks the identical question — *which of this month's weeks* — with the identical
option list, the identical bound and the identical goal resolution beneath it. **The A8 build agent must
render this component, not a second one.** Two callers is also what earns the component its name: a
control built once for one sheet is a widget; built for two it is the product's answer to "which week".
The `no week` option is absent when parking (the task is already in the month; retargeting to the period
it is already in is a no-op, `R-task-56`).

---

## 6. What I rejected

### 6.1 A date picker or a calendar — rejected, explicitly

There is no date picker anywhere in this product and there must not be one. The question is not *"which
day"*; it is *"which of these four weeks"* — a closed set of four to six items, each of which is a period
key the product already names. A calendar answers a question nobody asked, at roughly 300 px of new
surface, with its own grid keyboard model (two-dimensional arrows, page-per-month, a today marker), its own
localisation surface, and a strong invitation to pick 8 October — a Thursday, which is not a week and
which the model has no field for. It would also be the first control in the app that can express a period
outside the one on screen, which reopens A9's leak by construction. **Rejected on every axis: it is more
surface, more code, more keyboard model, and a worse fit for the actual question.**

### 6.2 A second compact picker row that takes over the sheet — rejected

The obvious symmetric move, and the brief asks whether it is right. It is not. `useGoalPicker`'s row-plus-
takeover exists because a goal list is unbounded, needs search above eight, needs Life-line grouping to
disambiguate same-named goals, and needs `RECENT` and a truncation notice. **A week list has none of those
properties and would render every one of those affordances empty.** It costs a tap to open and a tap to
choose where chips cost one, and it hides the neighbouring weeks — which is the actual content, since
"the week after next" is a comparison and not a name. It would also need a second, week-shaped listbox
component, which is a new pattern in the picker family for a control that fits on one line.

### 6.3 Widening `weeklyTarget` to the whole month and letting the goal imply the week — rejected

The tempting zero-control answer: offer every Weekly goal in the month, grouped by week, and let the
choice set the week. Three fatal objections. **(a) It cannot express the owner's case.** Planning into the
third week of a month is exactly the case where no Weekly goal exists yet, so the week would have no row to
choose and would stay unreachable — the gap survives the fix. **(b) It makes the mode's name a lie.**
`weeklyTarget`'s `weekStart` *is* its definition; a mode called "the Weekly goals in this week" that
returns five weeks' worth is a rule with two meanings. **(c) It has nowhere to put A8's month**, which is
not a goal and cannot be a row in a goal picker without `R-nav-31` acquiring a non-goal.

### 6.4 A week stepper — `‹ Week of 12 Oct ›` — rejected

One line, and it looks cheap. It shows one option at a time, so choosing the last week of the month is
three taps and a re-read; it has no bound the eye can see, so it either steps past the month silently or
dead-ends at a chevron that does nothing; and it has no natural place for A8's month. The chips show the
whole month in the same 38 px.

### 6.5 Disabling past weeks instead of omitting them — rejected

D-5: a disabled button is a hint, not an invariant, and this product deletes disabled states rather than
collecting them (`pickerRow`'s `'dis'`, `hChip`'s `active`, `dot`'s `dim`). A greyed `7 Sep` would also
have to be explained, which is a second line of chrome to apologise for an option that was never real.

### 6.6 A second eyebrow — `WHICH WEEK` — rejected

`WHERE THIS GOES` is the block's name and it already covers both facts. Three eyebrows in a two-field
sheet is the density `27-picker-and-clamp` §1 was written against. The radiogroup carries its own
accessible name; sighted users get the answer from the chips' own content and the sentence beneath them.

### 6.7 A count on each chip — rejected

See §3.1. Four extra scoped lens reads per sheet open, to label a chip.

### 6.8 Putting the week on the card instead of in the sheet — rejected

A per-week `+ Task` on the Monthly card, or a week row above it, is a fourth unconditional row's worth of
lens chrome (`R-nav-27` refuses a fourth row, it does not defer it), it multiplies the card's affordances
by five, and it puts a *destination* control on a *list*. The destination belongs in the sheet that states
the destination.

---

## 7. Accessibility

**The floor, and it is a floor.** Nothing here is new pattern work: it is A9's horizon radiogroup, one
control over.

- **Roles.** `role="radiogroup"` with `aria-label="When this lands"`; each chip `role="radio"` with
  `aria-checked` and an explicit `aria-label` (§3.1). **Not a `tablist`** — a tab implies a `tabpanel`,
  and what this controls is a form field and a sentence, neither of which is one. A radiogroup says what
  this is: a single-choice narrowing of what follows it.
- **Roving tabindex.** Exactly one chip in the tab order (`tabIndex = on ? 0 : -1`). `←`/`→` and `↑`/`↓`
  move **and** select — the chips are one wrapped row inside a vertical form, so both axes must work.
  `Home`/`End` reach the ends. Selecting moves focus to the newly checked chip.
- **Directive: extract, do not duplicate.** `GoalPicker`'s `pickHorizon`/`onHorizonKey` pair and its chip
  markup become one `ChipRadioGroup`, used by the horizon selector and by this control. A second copy of a
  keyboard model is how two controls in one sheet come to disagree about `Home`. One component, one model,
  one set of tests.
- **The selection is announced, never merely coloured** (`R-lens-13`). `aria-checked` does that job. The
  `role="status"` does the *other* job — announcing the **consequence**, since the goal row beneath changes
  under the user without their touching it. Exactly the split `GoalPickerList` already makes between
  `aria-selected` and its count status.
- **No second focus trap.** The chips are one more ordinary tab stop inside the single dialog `Sheet`
  already traps. The goal row's takeover contract is untouched, and Escape's two-stage behaviour is
  untouched.
- **Focus order:** title → done-condition → the chip row (one stop) → the goal row → `Save task`. The week
  precedes the goal it scopes.
- **Target size.** 38 px tall, ≥ 58 px wide, 6 px gaps — the shipped `S.chipBtn`, comfortably past WCAG
  2.2 §2.5.8 AA, and identical to the chips the owner already taps in the create sheet and the picker.
- **Contrast.** `S.chipBtn(true)` is `T.accent` on `onInk`; `S.chipBtn(false)` is `T.card` with `body`.
  Both are existing, already-tested pairs. **No new colour, no new token.**
- **No animation**, at any state change, including the row that appears and disappears in §2.3.

---

## 8. Rules that must change

### 8.1 `R-task-49` — the target week becomes a default, not a clamp

Replace the second bullet's amended clause (the A9 paragraph beginning *"AMENDED BY A9 — it is NOT the
same clamp…"* keeps its whole argument) with the following, appended to it:

> ⚠ **AMENDED BY A11 — the target week is a DEFAULT the owner can change, not a fixed answer.** The sheet
> offers **the weeks of the Monthly goal's own month that are not earlier than the current week**, as a
> radiogroup of chips inside `WHERE THIS GOES`, and `taskWeekForMonth` is the **first** of them rather than
> the only one. The offer is bounded by the month for the same reason the clamp is: a week outside it is a
> week the lens that created the work will never show. Past weeks are **not offered at all** (`R-goal-36`,
> `R-task-41`), never offered-and-disabled. Changing the week clears the picked Weekly goal and
> re-preselects from the new week's candidates; changing the goal never changes the week. **Every sentence
> in the block — the destination note and the implicit-weekly-goal note — is a function of the chosen week,
> not of the week the sheet opened on.**

### 8.2 `R-task-41` — source (d)

> (d) **`+ Task` or `Pull from backlog` on a Monthly goal's card**, where the **week is chosen from that
> month's own weeks** (defaulting to `taskWeekForMonth`) and the Weekly goal is then resolved or created
> for it (`R-task-49`).

### 8.3 `R-task-57` (A8) — the month is the default, a week is an explicit choice

The rule's first sub-bullet currently reads *"Nothing is inferred and nothing is created invisibly … There
is no target-week clamp, no resolution table, no picker, no implicitly created Weekly goal and no sentence
explaining what is about to happen, because nothing else happens."* **Replace with:**

> - **Nothing is inferred, and nothing is created invisibly.** `+ Task` on a Monthly goal **defaults to
>   one row — the task — on the goal you tapped, in the month you are looking at.** There is no target-week
>   clamp, no resolution table and no inference: the month is the first option of the sheet's `When this
>   lands` control (`R-task-49`, as amended), stated on screen and chosen by default.
> - **A week is available there, and it is a choice rather than an inference.** Selecting one of the
>   month's weeks in that same control takes `R-backlog-31`'s `Add to this week` path for a fresh task:
>   the Weekly goal is resolved under the Monthly goal, ambiguity is refused with
>   `AMBIGUOUS_CONVERSION_TARGET`, and none takes `R-task-48`'s inline `newWeeklyGoal` in one transaction.
>   The sheet states which weekly goal and which week before `Save task` is reachable. **A control the
>   owner drives is not an inference**, and refusing to offer the week would mean an owner who knows the
>   week has to create a month task and then park it — two writes and a timeline entry for one decision.

Its second sub-bullet, *"The lens does not move"*, is replaced by:

> - **The lens moves to the period the work landed in, which for the month case is the lens you are already
>   on.** One predicate, not a branch: a month task appears on the card you tapped, so nothing moves; a task
>   put into the week of 19 Oct would otherwise vanish from the screen that created it, which is
>   `R-task-41`'s rule and `R-nav-19`'s reason.

Its closing sentence, *"The sheet is the same sheet. Its only difference at month scope is the absence of
everything R-task-49 added to it"*, is replaced by:

> The sheet is the same sheet, and at month scope its `WHERE THIS GOES` block is the control plus one
> sentence: `Lands in Oct 2026 — no particular week.`

### 8.4 `R-task-48` — three flows name a week, not two

The A8 narrowing reads *"the inline `newWeeklyGoal` survives for the two flows that still name a WEEK
(Park — `R-task-56`, and a backlog conversion targeting a week — `R-backlog-31`) and for nothing else."*
Replace `two` with `three`, and add `+ Task on a Monthly goal with a week chosen (R-task-57)` to the list.

### 8.5 `R-task-56` — Park renders the same control

Append to *"Parking into a week"*:

> The week itself is chosen with the same `When this lands` control the create sheet renders
> (`R-task-49`), over the same option list — the task's own month's weeks, none earlier than the current
> one — **and not a second week chooser**.

### 8.6 `docs/BUSINESS-RULES.md` — one sentence

Task, bullet 1, currently: *"On a monthly goal there is nothing to create first: the task goes on the goal
you tapped, in the month you are looking at, and the screen does not move."* Replace with:

> On a monthly goal there is nothing to create first: the task goes on the goal you tapped, in the month
> you are looking at, and the screen does not move — or you name one of that month's weeks instead, and it
> becomes a week task there.

**`apps/api/src/api/mcp/business-rules.ts` must be regenerated in the same commit**;
`apps/api/tests/mcp/verbatim.test.ts` is what catches a build that forgets.

### 8.7 Untouched, and why each is untouched

- **`R-nav-31` (one goal picker)** — untouched, and **not** given a fifth mode. A week is not a goal;
  `weeklyTarget` keeps its exact contract and merely receives its `weekStart` from state. The rule's scope
  is unchanged, which is worth stating because a `weekTarget` mode is the obvious wrong move.
- **`R-nav-27` (three rows of chrome)** — untouched. Nothing here renders on a lens.
- **`R-lens-13`** — honoured: `aria-checked` announces the selection, the status announces the consequence.
- **`R-lens-9` / `zoomWeekForMonth`** — untouched. The zoom asks a different question and keeps its own
  answer under its own name; A9's split is what makes this change safe.
- **`R-goal-36`** — honoured by omission, not by a disabled state.
- **`R-backlog-27` / `R-backlog-31`'s closing bullet** — untouched, and quoted at §5.3 as the reason the
  `+` drawer gets nothing.

---

## 9. Open questions

1. **Should a week outside the goal's month ever be reachable from this sheet?**
   **[recommended: no.]** The month bound is what keeps A9's fix; another month is one chevron away on the
   Monthly lens, and post-A8 a month task can be parked into any week its month holds. If the owner hits
   this in real use, the answer is a `Later…` option that changes the month — not an unbounded list.
2. **From A8, should the default be the month or the month's first week?**
   **[recommended: the month.]** `R-task-57`'s "nothing is inferred" only holds if the zero-decision path
   is the zero-inference one. A week is then something the owner asked for.
3. **Should the sheet still navigate to the Weekly lens when a week is chosen?**
   **[recommended: yes — navigate to the lens of the chosen period**, which makes the month case a no-op
   rather than an exception.]
4. **Should a week chip say how many Weekly goals it holds?**
   **[recommended: no** — four extra lens reads per open, to pre-answer what the row beneath answers.]
5. **Should the control render with exactly one option?**
   **[recommended: no** (§2.6) — the destination line names it, and the state disappears at A8.]
6. **Does Park (`R-task-56`) render this component?**
   **[recommended: yes**, and the A8 build agent should be told so before it writes a second one.]
