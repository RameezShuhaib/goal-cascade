# 33 — UX plan: month-level tasks, and measurable tasks

Spec authority: `docs/SPEC.md` §2 Amendment 8 — `R-task-51 … R-task-59`, `R-measure-1 … R-measure-9`,
`R-lens-31`, `R-lens-32`, `R-backlog-30`, `R-backlog-31` — and §6 Amendment 8.
Contract: `docs/work/26-measurables/spec-delta.md` §2.5 (built and fixed; this document designs against it,
never around it).

Prior art this **extends and does not re-open**:

- `docs/work/32-week-selection/UX-PLAN.md` — the `When this lands` radiogroup inside `WHERE THIS GOES`.
  Decided. Its A8 state (§2.8) puts the **month first and makes it the default**. Built on, not redesigned.
- `docs/work/29-ux-navigation/UX-PLAN.md` §3.4, §5.1, §5.4, §7.3, §9 — chips as the sheet's field-value
  idiom, the per-horizon line table, the card arithmetic, the one live region, R-nav-27's three rows.
- `docs/work/30-lens-tabs/build.md` §2 — the sticky block, **91–96 px**, `zIndex: 10`.

The owner, on month tasks:

> *"i might have some task thats not high proprity but should be prioratised in this month… i can either
> have option to park it inside a week or as an independednt task this month… in my weekly task i can see
> my months task so if i dont do it this week its ok as the deadline is end for the current month"*

The owner, on measurables:

> *"i am doing AMRAP workout now this can be a gauge and i can increase or decrease any time. but i should
> see the how it changes over period of a task."*

And the line that governs every pixel below, which is the owner's own:

> **"show what you recorded, never compute a verdict."**

---

## 1. The decisions

### A. Month tasks in the Monthly lens

A Monthly card gains a **nested task list under a hairline, in exactly the place and shape `WeeklyCard`
already puts one** — after the muted orientation lines, before the `LinkRow` — so a month task and a week
task are the same object drawn the same way, one lens apart. A month task reads as an ordinary `TaskRow`:
checkbox, title, `Done when:`, its measure, and **the carry chip counted in months** (`3 months · since
Aug 2026`), which is the Monthly lens's job and the one thing that stops a month task becoming a silent
second backlog (`R-task-54`, `R-backlog-30`). `R-goal-47`'s planned-ness line stays exactly where it is and
gains **one** new case — `No weeks yet` when the month has no Weekly goals **and** the card now has tasks —
because `Nothing planned yet` above four visible tasks is a sentence the screen contradicts. There is **no
carried band on the Monthly lens** (`R-lens-32`): a month task carries onto the same goal, so it lands in the
ordinary list with its chip. The card costs **no new row and no new line**: the list nests inside the card
that already exists, under the hairline the `LinkRow` already draws.

### B. The month band in the Weekly lens

The band sits **last** — below this week's plan, below the carried band — behind its own hairline and its
own `CollapsibleHeader`, whose visible label is **`This month · Aug 2026`** and never the bare words
`THIS MONTH`, because on 2 Sep the band holds **August** and a heading that will not name its own month is
the seam defect `R-lens-29` already exists to fix. One muted sentence under the heading states the deadline
and the permission in the owner's own terms — `Due by the end of Aug 2026, not by the end of this week.` —
and that sentence, plus the band's position, is the **entire** signal that this is not this week's work.
Its contents are **ordinary cards with ordinary `TaskRow`s at ordinary size, weight and colour**: nothing is
tinted, dimmed, indented, shrunk or greyed, because this product says a difference in words and not in a
colour (`nothing this week` is the same grey as `3 weekly goals`), and demoting the month's work into a
visual footnote is the opposite of what the owner asked for. Every row in the band wears **no carry label of
any kind** — no chip, no grey line, no badge — and the suppression lives **at the call site**, in the band,
never inside `CarryLabel`, so a test can prove it by rendering the band (`R-lens-31`, `S-lens-31-2`).

### C. The August trap

`+ Task` in the band renders **if and only if the band's month is not past**, which is the product's
existing rule (`R-goal-36`, `R-task-41`, `R-task-57`) applied unchanged — the same rule that already
withdraws every create affordance from a past week and from the carried band. On 2 Sep the band is August's,
August is past for planning, so **there is no control in the band that can be tapped to create anything**,
and `PERIOD_IN_PAST` is unreachable rather than handled. In its place the band's foot carries the
`R-lens-29` idiom verbatim in shape: `Aug 2026 has ended. New work for the month goes in Sep 2026.` and one
link, `Go to Sep 2026`, which navigates to the **Monthly lens** at `2026-09` where every card carries its
own `+ Task`. The invariant the build agent must hold, stated so it can be audited: **the band passes its
own `monthPeriodKey` to the sheet and never `currentPeriodKey('Monthly', today)`, and never a clamp** — the
two are equal in every state where the control renders, so there is no branch in which the band creates into
a month other than the one it is showing. `+ Task` sits on **each band card's foot**, not at the band's
foot, so the target goal is the card you tapped — which needs no goal picker, invents no fifth picker mode,
and keeps `+ Task` meaning one thing in the whole product.

### D. Setting a measure

A measure is **progressive everywhere and upfront nowhere**: the create sheet and the task page both render
one `linkBtn`, `+ Add a number`, and tapping it expands the same four-field block **in place** — no second
sheet, no takeover, no new modal pattern (`Q-E` is honoured: a measure can be attached at create time, in
one command). The block is **one chip radiogroup and two input rows**: `( Counter )( Gauge )` on top,
`Start` and `Target` side by side beneath it, `Unit` full width below that — `kind` first because it changes
what the other three mean, `Target` labelled `Target (optional)` and placeholdered `Optional` so the AMRAP
case is reachable by leaving a field alone rather than by finding a switch. Two muted lines under the fields
carry the whole of the teaching and the whole of the check: a **kind note** (`You add to it. Each entry is a
change: +3.`) and a **range note** (`0 → 300 leads.` / `From 18 reps. No target.`), so four fields never
have to be understood from their labels alone. A task with **no measure** renders exactly as it does today,
everywhere — byte-identical row, byte-identical card — and on its page shows one eyebrow and one link and
nothing else. Removing a measure is an inline `S.discardBar` confirm naming the count — `Remove the measure?
This deletes 14 recorded values.` — never a silent destructive tap and never a new sheet kind.

### E. Reading a measure

A **row** shows the numbers and a hairline bar and never a chart: `62 / 300 leads` on one 12.5 px muted line
directly under `Done when:`, and a **2 px neutral bar** beneath it — that is the whole of it, at every list
in the product, and `Q-D` is honoured because a number invisible from the lens is a number the owner asked
for and did not get. The **page** shows the same numbers larger, a 4 px bar, the record control, the
sparkline, and the readings — the history lives on exactly one surface (`R-measure-5`). The slash form is
keyed on **`target !== null`** and the bar is keyed on **`progress != null`**, and the build must never key
one off the other: a gauge with no target reads `24 reps` with no slash, no percentage and no bar, and a
task whose `progress` is **absent** because `target === start` in bad data reads `62 / 62 leads` with no bar
— numbers alone, no division performed, exactly as `R-measure-4` requires. The bar's fill is **`T.ink`** on
a `T.lineSoft` track, because ink is the least semantic colour in this palette — green would mean good, red
bad, accent would mean chosen — and its width is `clamp(progress, 0, 1)`, so `18 / 15 leads` draws a full
bar and never `120%` and never a bar past its own end. **No percentage is ever rendered, anywhere.**

### F. Updating a measure

Both kinds share **one eyebrow, one field and one button** — `RECORD`, an input, and `Record` — because this
is the most repeated interaction in the feature and two verbs for one act is one verb too many for a thumb
in a gym. A **counter** adds: the field is prefixed `+`, posts a `delta`, and is preceded by a single `+1`
chip that posts `delta: 1` **on one tap with no second stop** — the `15 leads daily` case, which is one tap
fifteen times and not fifteen typed numbers. A **gauge** sets: the field is **pre-filled with `current`**,
posts a `value`, and `Record` stays enabled even when the number is unchanged, because recording the same
weight on a new day is data and refusing it would be the app deciding what counts. A counter can also be
corrected to where it actually is — one `linkBtn`, `Correct it instead`, flips the field to absolute and the
label to `Set to` (`R-measure-3` accepts an absolute against a counter); a delta against a **gauge** is not
offered at all, so `MEASURE_KIND_MISMATCH` is unreachable from this UI. Every write announces its result in
the existing polite region and **focus never leaves the field**, so a second bump is immediate:
`Recorded 65. Now 65 of 300 leads.`

### G. The sparkline

It is **one inline `<svg>`, 40 px tall, full width, holding exactly one `<path>`** — no library, no
dependency, no second element — with `viewBox="0 0 320 40"`, `preserveAspectRatio="none"` and
`vectorEffect="non-scaling-stroke"` on the path so the stroke stays 1.5 px at every width. **x is the
reading's index, not its timestamp**, deliberately: time-spacing turns a two-week gap into a flat run that
reads as a plateau, which is the app inventing values between the owner's, and equal spacing says exactly
*these are the readings, in order*. It has **no axis, no gridline, no tick, no label, no target line, no
trend line, no moving average, no projection, no area fill, no gradient, no dot, no tooltip, no hover, no
interactivity, no transition and no animation** — it is `aria-hidden="true"` and `pointer-events: none`, and
it is the **first chart in this product**, so every one of those absences is a rule and not an oversight.
It **does not render below two readings**, because one point has no shape and drawing a flat line through it
would imply a second reading that does not exist. Its text equivalent points at the real equivalent rather
than duplicating it — `Sparkline of 14 readings in reps, oldest to newest. Every reading is listed below.` —
because the readings list beneath it is complete, ordered, keyboard-reachable, and already carries every
number the picture carries.

### H. Completion versus target

The **checkbox never changes** — not its size, not its position, not its colour, not its behaviour —
because of a measure: it does not auto-tick at target, it does not disable below target, it does not gain a
ring, and a no-target gauge's checkbox is a plain task's checkbox in every particular (`R-measure-6`,
both directions). The **measure never renders a completion word**: no `Done`, no `Complete`, no `✓`, no
`100%`, and reaching the target produces **no sentence, no colour change and no event on screen** — the
numbers change and the bar is full, and that is all, because any line the app writes at that moment is the
app having an opinion about the owner's number. On the task page the two live **far apart on purpose**: the
checkbox is at the top beside the title, the measure block is near the bottom between `LINKS` and the exits,
and they share no control and no row. A **completed measurable below its target** renders the title struck
through, `Done Wed 2 Sep`, and the measure line **unstruck in `T.mut`** with its bar at 80 % — no red, no
`missed`, no apology, no note, because `12 / 15` is what happened and the app was not asked what it thought
of it. A **no-target gauge** has no completion criterion and no percentage and is completable anyway, and
its page says nothing at all about a target, including nothing about not having one.

---

## 2. The states, at 360 px

Running clock: **Wed 2 Sep 2026**, the seam. The Weekly lens is at the week of **Mon 31 Aug**, which belongs
to **Aug 2026** by `R-goal-33`'s Monday rule. The current month is **Sep 2026**. A second clock,
**Wed 16 Sep 2026**, is used where the non-seam state must be drawn.

Content width inside `S.page` at 360 px is **328 px**; inside `S.sheetInner` it is **320 px**.
The ASCII is schematic; §4 is authoritative.

### 2.1 The Weekly lens with the month band — the seam (Wed 2 Sep, week of 31 Aug)

```
┌────────────────────────────────────────────┐  ← 360 px viewport
│  ☾   ⌾                            + Goal   │  row 1 — the cluster
├────────────────────────────────────────────┤
│  Life  Yearly  Quarterly  Monthly  Weekly  │  row 2 — the tab strip
│                                    ━━━━━━  │
├────────────────────────────────────────────┤
│  ‹   Week of 31 Aug                     ›  │  row 3 — the period row
│      Mon 31 Aug – Sun 6 Sep                │
├────────────────────────────────────────────┤  ← sticky block ends, ~91 px
│                                            │
│  ┌──────────────────────────────────────┐  │
│  │ ● Three sessions a week              │  │  this week's plan
│  │ under Be strong at 60                │  │
│  │ ──────────────────────────────────── │  │
│  │ ☐ Squat session                      │  │
│  │ ☐ Row 5 km                           │  │
│  │ ──────────────────────────────────── │  │
│  │ + Task            Pull from backlog  │  │
│  └──────────────────────────────────────┘  │
│                                            │
│  ▾ CARRIED                                 │  the carried band, unchanged
│  ┌──────────────────────────────────────┐  │
│  │ ● Deload week                        │  │
│  │ from week of 24 Aug                  │  │
│  │ under Be strong at 60                │  │
│  │ ──────────────────────────────────── │  │
│  │ ☐ Book the physio                    │  │
│  │   since Mon 24 Aug                   │  │
│  └──────────────────────────────────────┘  │
│                                            │
│  ▾ THIS MONTH · AUG 2026                   │  ← the band, LAST
│  Due by the end of Aug 2026, not by the    │  ← T.mut, 12.5px
│  end of this week.                         │
│  ┌──────────────────────────────────────┐  │
│  │ ● Rebuild the gym habit              │  │
│  │ under Be strong at 60                │  │
│  │ ──────────────────────────────────── │  │
│  │ ☐ Book the gym induction             │  │  ← NO carry label, ever
│  │ ☐ Reach 15 leads a day               │  │
│  │   Done when: 300 logged in the CRM   │  │
│  │   62 / 300 leads                     │  │
│  │   ▬▬▬▬▬▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭  │  │  ← 2px, T.ink on T.lineSoft
│  └──────────────────────────────────────┘  │
│  Aug 2026 has ended. New work for the      │  ← the band foot, past-month
│  month goes in Sep 2026.                   │
│  Go to Sep 2026                            │  ← linkBtn → Monthly lens
│                                            │
└────────────────────────────────────────────┘
```

**No `+ Task` renders anywhere in this band, on any card.** That is the trap, closed by omission.

### 2.2 The same band, off the seam (Wed 16 Sep, week of 14 Sep)

```
│  ▾ THIS MONTH · SEP 2026                   │
│  Due by the end of Sep 2026, not by the    │
│  end of this week.                         │
│  ┌──────────────────────────────────────┐  │
│  │ ● Rebuild the gym habit              │  │
│  │ under Be strong at 60                │  │
│  │ ──────────────────────────────────── │  │
│  │ ☐ Book the gym induction             │  │
│  │ ──────────────────────────────────── │  │
│  │ + Task                               │  │  ← on the CARD's foot
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │ ● Ship the pricing page              │  │
│  │ under Build the business             │  │
│  │ ──────────────────────────────────── │  │
│  │ ☑ Draft the copy                     │  │
│  │   Done Mon 14 Sep                    │  │
│  │ ──────────────────────────────────── │  │
│  │ + Task                               │  │
│  └──────────────────────────────────────┘  │
```

Two Monthly goals, two cards — that is `R-lens-31`'s "grouped by their Monthly goal", drawn with the
product's existing grouping primitive rather than a new sub-heading. `Q-G` is honoured: a **done** month
task shows, struck through, for the whole month it was completed in.

**Collapsed:**

```
│  ▸ THIS MONTH · SEP 2026                   │
```

The sentence and the cards both go; the heading is the whole of the collapsed state, exactly as `CARRIED`
already behaves. Key: `Weekly|__month|2026-09`, session-scoped, per-lens (`R-lens-19`, `Q-21`).

### 2.3 The Monthly lens with tasks (Sep 2026)

```
├────────────────────────────────────────────┤  ← sticky block, ~96 px
│  ┌──────────────────────────────────────┐  │
│  │ ● Rebuild the gym habit              │  │
│  │ under Be strong at 60                │  │
│  │ 3 weekly goals · 2 this week         │  │  ← R-goal-47, unchanged
│  │ 4 in backlog                         │  │
│  │ ──────────────────────────────────── │  │
│  │ ☐ Book the gym induction             │  │
│  │   3 months · since Aug 2026          │  │  ← the chip, IN MONTHS
│  │ ☐ Lose 5 kg this month               │  │
│  │   78.5 / 75 kg                       │  │
│  │   ▬▬▬▬▬▬▬▬▬▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭  │  │  ← counting DOWN, 30 %
│  │ ──────────────────────────────────── │  │
│  │ + Task            Pull from backlog  │  │
│  └──────────────────────────────────────┘  │
```

**The red chip renders here and only here** for a month task. `Aug → Sep` is one month, so this task's age
is 1 at the grey threshold and 2+ at the chip; the mockup draws the chip case, which is the one that stops
`R-backlog-30`'s failure mode.

**A Monthly card with tasks and no weeks:**

```
│  │ ● Ship the pricing page              │  │
│  │ under Build the business             │  │
│  │ No weeks yet                         │  │  ← NOT "Nothing planned yet"
│  │ ──────────────────────────────────── │  │
│  │ ☐ Draft the copy                     │  │
```

**A Monthly card with neither:**

```
│  │ ● Ship the pricing page              │  │
│  │ under Build the business             │  │
│  │ Nothing planned yet                  │  │  ← unchanged, verbatim
│  │ ──────────────────────────────────── │  │
│  │ Nothing on this month yet.           │  │
│  │ ──────────────────────────────────── │  │
│  │ + Task            Pull from backlog  │  │
```

### 2.4 A task row: every measure state, at 328 px

**No measure — byte-identical to today, and this is a requirement, not an observation:**

```
│  ☐ Book the gym induction                  │
│    Done when: card in my wallet            │
│      since Mon 24 Aug                      │
```

**Counter with a target:**

```
│  ☐ Reach 15 leads a day                    │
│    Done when: 300 logged in the CRM        │
│    62 / 300 leads                          │
│    ▬▬▬▬▬▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭   │  ← 21 %
```

**Gauge with a target, counting down:**

```
│  ☐ Lose 5 kg this month                    │
│    78.5 / 75 kg                            │
│    ▬▬▬▬▬▬▬▬▬▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭   │  ← (78.5−80)/(75−80) = 30 %
```

**Gauge with NO target — no slash, no percentage, no bar:**

```
│  ☐ AMRAP — max reps                        │
│    24 reps                                 │
```

**`progress` absent (`target === start` in the data) — the numbers alone, no bar, no division:**

```
│  ☐ Hold 62 leads                           │
│    62 / 62 leads                           │
```

**Over target — a full bar, never `120%`, never drawn past its own end:**

```
│  ☐ Reach 15 leads a day                    │
│    18 / 15 leads                           │
│    ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬   │  ← 100 %, and nothing else changes
```

**Completed below its target — no red, no note, no apology:**

```
│  ☑ R̶e̶a̶c̶h̶ ̶1̶5̶ ̶l̶e̶a̶d̶s̶ ̶a̶ ̶d̶a̶y̶                    │
│    Done when: 300 logged in the CRM        │
│    Done Wed 2 Sep                          │
│    12 / 15 leads                           │  ← T.mut, NOT struck through
│    ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▭▭▭▭▭▭▭▭▭▭   │  ← 80 %
```

**Not yet completable (a future month or week) — no checkbox, unchanged:**

```
│     Reach 15 leads a day                   │
│    0 / 300 leads                           │
│    ▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭   │
```

### 2.5 The task page — a counter with a target

Only the region between `LINKS` and `ACTIVITY` is drawn; everything above `LINKS` is unchanged.

```
│  LINKS                                     │
│  ┌──────────────────────┐  ┌─────────┐     │
│  │ https://…            │  │   Add   │     │
│  └──────────────────────┘  └─────────┘     │
│                                            │
│  MEASURE                    Edit  Remove   │
│  62 / 300 leads                            │
│  ▬▬▬▬▬▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭   │  ← 4px, T.ink on T.lineSoft
│                                            │
│  RECORD                                    │
│  ┌────┐ ┌────────────────┐ ┌────────────┐  │
│  │ +1 │ │ +              │ │   Record   │  │
│  └────┘ └────────────────┘ └────────────┘  │
│  Correct it instead                        │  ← linkBtn
│                                            │
│      ╱╲    ╱╲                        ╱     │  ← the sparkline, 40px, one path
│    ╱╱  ╲╱╱  ╲╲    ╱╲╱╲╲    ╱╱╲╲    ╱╱      │
│  ╱╱            ╲╲╱      ╲╲╱      ╲╱        │
│                     Latest 62 leads · Wed 2 Sep │
│                                            │
│  READINGS                                  │
│  62 leads          Wed 2 Sep            ×  │
│  57 leads          Tue 1 Sep            ×  │
│  51 leads          Mon 31 Aug           ×  │
│  48 leads          Sun 30 Aug           ×  │
│  …                                         │
│  Show all 43                               │  ← linkBtn
│                                            │
│  WHERE THIS GOES                           │
│  In the week of 31 Aug.                    │
│  ┌──────────────────────┐                  │
│  │  Move to Sep 2026    │                  │
│  └──────────────────────┘                  │
│                                            │
│  ┌──────────────────┐ ┌─────────────────┐  │
│  │ Move to Backlog  │ │  Cancel task    │  │
│  └──────────────────┘ └─────────────────┘  │
│                                            │
│  ACTIVITY                                  │
```

### 2.6 The task page — a gauge with NO target (the AMRAP case)

```
│  MEASURE                    Edit  Remove   │
│  24 reps                                   │  ← no slash, no percentage
│                                            │  ← NO BAR. Nothing in its place.
│  RECORD                                    │
│  ┌────────────────────────┐ ┌───────────┐  │
│  │ 24                     │ │  Record   │  │  ← pre-filled with `current`
│  └────────────────────────┘ └───────────┘  │
│                                            │  ← no `Correct it instead`
│    ╱╲        ╱╲╲      ╱╲                   │
│  ╱╱  ╲╲    ╱╱   ╲╲  ╱╱  ╲╲      ╱╱╲╲       │  ← it goes up AND down
│        ╲╲╱╱       ╲╱      ╲╲  ╱╱    ╲╲     │
│                    Latest 24 reps · Wed 2 Sep │
│                                            │
│  READINGS                                  │
│  24 reps           Wed 2 Sep            ×  │
│  21 reps           Mon 31 Aug           ×  │
│  26 reps           Fri 28 Aug           ×  │
```

Nothing here says the number went down. Nothing here says it went up. Nothing here says a target is
missing. `R-measure-4`: *a first-class measurable, not a degraded one.*

### 2.7 The task page — a task with no measure

```
│  MEASURE                                   │
│  + Add a number                            │  ← linkBtn, and nothing else
```

### 2.8 The measure block, open for editing (page or sheet — one component)

```
│  MEASURE                                   │
│  How you'll record it                      │
│  (Counter)( Gauge )                        │  ← chip radiogroup; Counter filled
│  You add to it. Each entry is a change: +3.│
│  ┌──────────────────┐┌──────────────────┐  │
│  │ Start            ││ Target (optional)│  │  ← labels above, 12/700 T.mut
│  │ 0                ││ 300              │  │
│  └──────────────────┘└──────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │ Unit                                 │  │
│  │ leads                                │  │
│  └──────────────────────────────────────┘  │
│  0 → 300 leads.                            │  ← the range note
│  ┌──────────────────┐                      │
│  │  Save measure    │                      │
│  └──────────────────┘                      │
```

**With `Gauge` chosen and `Target` left empty — the AMRAP shape:**

```
│  (Counter)(Gauge)                          │  ← Gauge filled
│  You set it. Each entry replaces the last: │
│  78.5.                                     │
│  ┌──────────────────┐┌──────────────────┐  │
│  │ Start            ││ Target (optional)│  │
│  │ 18               ││ Optional         │  │  ← placeholder, not a value
│  └──────────────────┘└──────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │ Unit                                 │  │
│  │ reps                                 │  │
│  └──────────────────────────────────────┘  │
│  From 18 reps. No target.                  │
```

**Refused — start equals target:**

```
│  │ 300              ││ 300              │  │
│  Start and target can't be the same number.│  ← FieldError, T.redText
│  ┌──────────────────┐                      │
│  │  Save measure    │                      │  ← disabled
│  └──────────────────┘                      │
```

**Removing:**

```
│  Remove the measure? This deletes 14       │  ← S.discardBar, existing shape
│  recorded values.                          │
│  [ Remove ]  [ Keep ]                      │  ← focus lands on Keep
```

### 2.9 The create sheet — measure collapsed, then open

```
┌────────────────────────────────────────────┐
│  New task                               ✕  │
│  ┌──────────────────────────────────────┐  │
│  │ What needs doing?                    │  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │ How will you know it's done?         │  │
│  └──────────────────────────────────────┘  │
│  + Add a number                            │  ← ONE line, collapsed
│                                            │
│  WHERE THIS GOES                           │
│  (Sep 2026)( 14 Sep )( 21 Sep )( 28 Sep )  │  ← 32-UX-PLAN §2.8, month DEFAULT
│  Lands in Sep 2026 — no particular week.   │
│                                            │
│  [             Save task              ]    │
└────────────────────────────────────────────┘
```

Opened, the block from §2.8 renders **between the done-condition and `WHERE THIS GOES`** — the task's own
properties before the task's destination, which is the order the sheet already reads in. At 360 × 640
(`S.sheet` `maxHeight: 88vh` = 563 px) the open state is header 46 + title 60 + condition 48 + measure block
~250 + `WHERE THIS GOES` ~110 + save 64 + padding 50 ≈ **628 px**, so the sheet scrolls. That is correct and
expected: a sheet in which the owner has explicitly asked for four more fields is a sheet that has earned a
scroll, and `Save task` was never promised above the fold in a state the owner opted into.

### 2.10 Park — the sheet (`R-task-56`, month → week)

```
┌────────────────────────────────────────────┐
│  Park in a week                         ✕  │
│  “Book the gym induction”                  │
│                                            │
│  WHERE THIS GOES                           │
│  ( 14 Sep )( 21 Sep )( 28 Sep )            │  ← NO month chip when parking
│  ┌──────────────────────────────────────┐  │
│  │ Three sessions a week              › │  │  ← the same weeklyTarget picker
│  │ Be strong at 60 · Week of 14 Sep     │  │
│  └──────────────────────────────────────┘  │
│  Lands in the week of 14 Sep · Sep 2026.   │
│                                            │
│  [              Park it               ]    │
└────────────────────────────────────────────┘
```

Zero candidates in the chosen week takes `implicitWeeklyGoalNote` unchanged, exactly as `32`'s §2.3 draws it
— which is the whole reason `R-task-48` survives A8.

### 2.11 The task page's `WHERE THIS GOES` block, both directions

**A month task:**

```
│  WHERE THIS GOES                           │
│  In Aug 2026 — the whole month, no         │
│  particular week.                          │
│  ┌──────────────────────┐                  │
│  │  Park in a week      │                  │
│  └──────────────────────┘                  │
```

**A week task under a Monthly ancestor:**

```
│  WHERE THIS GOES                           │
│  In the week of 31 Aug.                    │
│  ┌──────────────────────┐                  │
│  │  Move to Sep 2026    │                  │  ← names its destination
│  └──────────────────────┘                  │
```

**A week task with no Monthly ancestor (`HORIZON_CONFLICT`, `R-goal-32` permits it):**

```
│  WHERE THIS GOES                           │
│  In the week of 31 Aug.                    │
```

No button, no explanation, no disabled state — `D-5`: a picker must not offer what the server would refuse,
and an absence with nothing to apologise for gets no sentence.

### 2.12 Demote — `Move to Backlog` on a month task (`R-task-59`)

```
┌────────────────────────────────────────────┐
│  Move to Backlog                        ✕  │
│  “Book the gym induction” → Rebuild the    │
│  gym habit's backlog                       │
│  ┌──────────────────────────────────────┐  │
│  │ Why? (optional)                      │  │
│  └──────────────────────────────────────┘  │
│  No mandatory fields. Fast and guilt-free. │
│  [              Move it               ]    │
└────────────────────────────────────────────┘
```

**Not one string changes.** The only change is which goal `lands` resolves to: for a **month task** it is the
task's **own** goal, because `R-backlog-29`'s walk terminates immediately. And its backlog row afterwards
reads `from Sep 2026` where a week task's reads `from week of 31 Aug`.

---

## 3. Copy, verbatim

### 3.1 The month band

| Where | String |
|---|---|
| Band header, visible | `This month · Aug 2026` — `` `This month · ${labelOf('Monthly', monthPeriodKey)}` `` (rendered uppercase by `S.sectionLabel`) |
| Band header, accessible name (`CollapsibleHeader`'s `name`) | `This month, Aug 2026 — 3 tasks whose deadline is the end of the month` |
| Band note | `Due by the end of Aug 2026, not by the end of this week.` |
| Band foot, past month | `Aug 2026 has ended. New work for the month goes in Sep 2026.` |
| Band foot link, visible | `Go to Sep 2026` — `weekElsewhereAction(label)`, **reused verbatim** |
| Band foot link, accessible name | `Go to Sep 2026 on the Monthly lens` |
| A band card's foot | `+ Task` — **existing string, unchanged** |

The plural in the accessible name is `plural(n, 'task')`, the existing helper. The band never renders with
zero tasks, so there is no empty state and no copy for one.

### 3.2 The Monthly lens

| Where | String |
|---|---|
| `plannedNess`, new case (`weeklyGoals === 0` **and** the card has ≥ 1 task) | `No weeks yet` |
| `plannedNess`, unchanged (`weeklyGoals === 0`, no tasks) | `Nothing planned yet` |
| A Monthly card's empty task list | `Nothing on this month yet.` |

`Nothing on this month yet.` and not `WeeklyCard`'s `Nothing on this yet.`, because a Monthly **goal page**
renders a task list and a backlog list one above the other, and two lists on one screen saying `Nothing on
this yet.` is the one place `R-backlog-30`'s distinction is lost in a word.

### 3.3 Park and demote

| Where | String |
|---|---|
| Task page block eyebrow | `WHERE THIS GOES` — **the create sheet's own string**, reused |
| Page line, month task | `In Aug 2026 — the whole month, no particular week.` |
| Page line, week task | `In the week of 31 Aug.` |
| Page button, month task | `Park in a week` |
| Page button, week task, visible | `Move to Sep 2026` |
| Page button, week task, accessible name | `Move to Sep 2026 — the whole month, no particular week.` |
| Park sheet heading | `Park in a week` |
| Park sheet subject line | `“Book the gym induction”` |
| Park sheet radiogroup name | `When this lands` — **32-UX-PLAN §3.1, unchanged** |
| Park sheet destination note | `Lands in the week of 14 Sep · Sep 2026.` — `taskDestinationNote`, unchanged |
| Park sheet save | `Park it` |
| Toast, parked | `Parked in the week of 14 Sep` |
| Toast, moved to the month | `Moved to Sep 2026` |

`Park in a week` and `Move to the month` are `R-task-56`'s own names for the two directions. The **visible**
un-park label spells the destination instead — `Move to Sep 2026` — because there is no sheet on that path
to state it, and a one-tap write that does not name where it lands is the unnamed-destination defect A9 was
written to close.

### 3.4 Setting a measure

| Where | String |
|---|---|
| Disclosure link, no measure | `+ Add a number` |
| Block eyebrow | `MEASURE` |
| Kind radiogroup, accessible name | `How you'll record it` |
| Kind radiogroup, visible label | `How you'll record it` |
| Kind chip, visible | `Counter` · `Gauge` |
| Kind chip, accessible names | `Counter — you add to it` · `Gauge — you set it` |
| Kind note, counter | `You add to it. Each entry is a change: +3.` |
| Kind note, gauge | `You set it. Each entry replaces the last: 78.5.` |
| Field label / `aria-label` | `Start` |
| Field label / `aria-label` | `Target (optional)` |
| Target placeholder | `Optional` |
| Field label / `aria-label` | `Unit` |
| Unit placeholder | `leads, kg, reps` |
| Range note, target set | `0 → 300 leads.` |
| Range note, target set, no unit | `0 → 300.` |
| Range note, no target | `From 18 reps. No target.` |
| Range note, no target, no unit | `From 18. No target.` |
| Refusal, `start === target` | `Start and target can't be the same number.` |
| Save, page | `Save measure` |
| Edit link | `Edit` |
| Remove link | `Remove` |
| Remove confirm, with readings | `Remove the measure? This deletes 14 recorded values.` |
| Remove confirm, no readings | `Remove the measure?` |
| Remove confirm buttons | `Remove` · `Keep` |
| Toast, removed | `Measure removed` |
| Toast, added | `Measure added` |
| Toast, edited | `Measure updated` |

`14 recorded values` is `plural(n, 'recorded value')`. `R-measure-1` requires the count by name; the
sentence is its own.

### 3.5 Updating a measure

| Where | String |
|---|---|
| Eyebrow | `RECORD` |
| Counter quick chip, visible | `+1` |
| Counter quick chip, accessible name | `Add 1 lead` / `Add 1` when there is no unit |
| Counter field, placeholder | `+` |
| Counter field, `aria-label` | `How many leads to add` / `How much to add` when there is no unit |
| Gauge field, `aria-label` | `New value in kg` / `New value` when there is no unit |
| The button, both kinds | `Record` |
| Counter mode link | `Correct it instead` |
| Counter absolute field, `aria-label` | `Set to, in leads` / `Set to` |
| Counter absolute mode link back | `Add to it instead` |
| Announcement, target set | `Recorded 65. Now 65 of 300 leads.` |
| Announcement, no target | `Recorded 24 reps.` |
| Announcement, no unit, target set | `Recorded 65. Now 65 of 300.` |
| Announcement, `progress` absent | `Recorded 65. Now 65 of 62 leads.` |

`Now 65 of 300 leads` and not `Now 65 / 300 leads`: a slash is a glyph, and a live region reads glyphs
badly and inconsistently across screen readers. The visible line keeps `/`; the spoken one says `of`.

### 3.6 The sparkline and the readings

| Where | String |
|---|---|
| Sparkline text equivalent, with unit | `Sparkline of 14 readings in reps, oldest to newest. Every reading is listed below.` |
| Sparkline text equivalent, no unit | `Sparkline of 14 readings, oldest to newest. Every reading is listed below.` |
| Latest line | `Latest 62 leads · Wed 2 Sep` |
| Latest line, no unit | `Latest 62 · Wed 2 Sep` |
| Readings eyebrow | `READINGS` |
| Readings empty | `Nothing recorded yet.` |
| A reading row | `62 leads` and `Wed 2 Sep` |
| Delete control, accessible name | `Delete reading 62 leads, Wed 2 Sep` |
| Expand link | `Show all 43` |
| Collapse link | `Show fewer` |
| Announcement, deleted, target set | `Reading deleted. Now 57 of 300 leads.` |
| Announcement, deleted, no target | `Reading deleted. Now 21 reps.` |

`Wed 2 Sep` is **`instantLabel`**, the exact formatter the activity timeline on the same page already uses.
**Zero new date spellings.** A10's warning stands: the build agent must not invent `2 Sep 14:20`, `2 days
ago` or `02/09`.

### 3.7 Retired

Nothing. Not one existing string is deleted or reworded by this plan.

---

## 4. Structure, and the rules the build follows literally

### 4.1 The month band

Renders when `lens === 'Weekly'` **and** `data.monthTasks.length > 0`. Nothing else gates it.

Order inside the `Body`, after the carried band and after the *"Nothing planned for this week"* dashed
line, in this order and no other:

1. `borderTop: 1px solid T.line`, `paddingTop: 12` — the band's own rule, identical to `CarriedBand`'s.
2. `CollapsibleHeader` — the existing component, `what="band"`, key `Weekly|__month|${monthPeriodKey}`.
3. The band note (§3.1), 12.5 px `T.mut`, `marginTop: 2`, **rendered only when not collapsed**.
4. One `CardShell` per Monthly goal, `gap: 10`, in `monthTasks` order grouped by `goalId`, first-appearance
   order preserved (the server's).
5. The band foot: `+ Task` on each card (see 4.2), **or** the past-month note and link (see 4.3).

**What a band card renders, and the four things it does not.** It renders `Title`, `LifeLine`, the hairline,
the `TaskRow`s, and its `LinkRow`. It does **not** render:

- **`plannedNess`** — that line is about how a month breaks into weeks, and the band exists to say the
  deadline is the month rather than any week in it. It would answer a question this band is refusing.
- **`BacklogLine`** — a backlog count is an invitation to pull, and the band offers no pull. Exactly
  `CarriedCard`'s reason, at a different card.
- **`Pull from backlog`** — a pull is a planning decision about a goal's own deferred work, and the goal's
  lens and page are where that backlog lives. The band is a week's view of a month, not a planning surface
  for one.
- **`Nothing on this month yet.`** — **unreachable.** A goal is in the band only because it holds a month
  task visible in this month, so its filtered list is never empty. Rendering it would be writing copy nobody
  can see.

**Every `TaskRow` in the band takes `suppressCarry` and the flag is passed at the call site.** Not inside
`CarryLabel`, not derived from `scope`, not derived from the lens. `S-lens-31-2` must be able to prove the
suppression by rendering the band, and a rule enforced inside the component it applies to is a rule that
cannot be asserted from outside it.

**Completion in the band names the month.** `TaskRow`'s completion posts a `period` in the task's own scope
(`spec-delta` §2.6): in the band that is `monthPeriodKey`, in the Weekly card it is the viewed Monday. The
band on 2 Sep therefore completes into **`2026-08`**, which is the task's origin month and satisfies
`originPeriodKey ≤ P ≤ currentPeriod` — `R-task-55`'s seam case, and the reason `CompleteTaskRequest` takes a
canonical key rather than an offset. **The band never sends a week.**

### 4.2 The band's create affordance

```
canCreateInBand = !isPastPeriod('Monthly', monthPeriodKey, clock.today)
```

- `true` → each band card renders a `LinkRow` holding **`+ Task` alone**, left-aligned, `flex: 1`, in the
  same hairline-plus-padding shape every other `LinkRow` uses. It opens the task-create sheet on **that
  card's goal**, in month mode, with the month set to **`monthPeriodKey` — the band's own month**.
- `false` → **no `LinkRow` renders on any band card**, and the band's foot renders §4.3 instead.

**The invariant, stated for audit.** The band passes `monthPeriodKey`. It never passes
`currentPeriodKey('Monthly', today)`. It never clamps, never substitutes, never falls back. Because the
control renders only when `monthPeriodKey` is not past, the value it passes is always a legal create target
— so `PERIOD_IN_PAST` is not caught, not mapped and not copy-written for this path, because it cannot arrive
on it. **A build that adds a clamp here has reintroduced A9's leak in a new place.**

`+ Task` sits on the **card**, not on the band's foot, because the card is the goal. A band-foot `+ Task`
would have to ask which Monthly goal, and the only honest way to ask is the goal picker — which would need
a fifth `R-nav-31` mode listing Monthly goals in one month, the exact move `32-UX-PLAN` §8.7 names as
obviously wrong. One `+ Task`, one meaning, everywhere: *on the goal you tapped*.

### 4.3 The past-month foot

```
│  Aug 2026 has ended. New work for the      │  12.5px T.mut
│  month goes in Sep 2026.                   │
│  Go to Sep 2026                            │  S.linkBtn → lensPath('Monthly', currentMonthKey)
```

`currentMonthKey` is `currentPeriodKey('Monthly', clock.today)` — the client's own calendar arithmetic
through `@goal-cascade/shared`, which is `R-lens-30`'s ruling and not a second Monday rule.

This is `R-lens-29`'s shape one lens over: *name the period that is elsewhere, say what is true, and offer
one tap to it.* It is not an escalation and carries no colour: a month that has ended is a fact about the
calendar, not a problem with the plan.

**It renders only when the band renders**, i.e. only when August still holds visible month tasks. A past
month with nothing open produces no band, no note and no link.

### 4.4 The Monthly card

`MonthlyCard` renders, in this order:

1. `Title`
2. `LifeLine`
3. `plannedNess` — with the new `No weeks yet` case (§3.2)
4. `BacklogLine`
5. **the hairline + the nested `TaskRow` list, or `Nothing on this month yet.`** — new, and the only
   structural addition
6. `LinkRow` (`canCreate` gated, unchanged)

`MonthlyCard` **loses `targetWeek` and its `taskWeekForMonth` import** (`R-rm-6`). `LinkRow` loses its
`weekStart` prop and its `newWeekly` fork; both actions pass `monthKey: goal.periodKey`, and the sheet's
`When this lands` control seeds from it (`32-UX-PLAN` §4.5). Per §5.4 the card's arithmetic:

| | Before | After |
|---|---|---|
| Muted lines | 3 | 3 |
| Nested list | — | **+1 block** |
| Link row | 1 | 1 |

One block added, on the card that A8 exists to give work to, and nothing above it moved.

**The card's `aria-label`** already folds `plannedNess` in. It gains the task count on the same pattern the
Life card sets: `Rebuild the gym habit, 3 weekly goals, 2 this week, 2 tasks.` Zero is never rendered and
never spoken.

### 4.5 The measure on a `TaskRow`

Inside the existing title button, after `Done when:` and after `Done <instant>`, and **before**
`CarryLabel`:

```
measureLine(m):
  m.target !== null  →  `${n(m.current)} / ${n(m.target)}${m.unit ? ' ' + m.unit : ''}`
  m.target === null  →  `${n(m.current)}${m.unit ? ' ' + m.unit : ''}`
```

12.5 px, `T.mut` when the task is done, `S.body` otherwise. **Never struck through**, at any status.

`n(v)`: at most two decimals, trailing zeros stripped (`78.5`, `62`, `0.25`). **No thousands separator, no
`Intl.NumberFormat`, no locale.** A separator is a second spelling of a number, and `1,000` versus `1.000`
is exactly the A10 trap one data type over.

The bar, immediately below, **only when `m.progress != null`**:

```
track:  height 2, borderRadius 1, background T.lineSoft, marginTop 5, aria-hidden
fill:   height 2, borderRadius 1, background T.ink, width `${Math.min(1, Math.max(0, m.progress)) * 100}%`
```

**The two keys are independent and the build must not collapse them.** The slash is
`m.target !== null`; the bar is `m.progress != null`. A no-target gauge has neither. A `target === start`
task has the slash and no bar. Writing `m.progress != null` where the slash is decided produces `24 reps`
correctly and `62 / 62 leads` as bare `62 leads`, which is a lie about the data.

`CarryLabel` stays last on the row, because it is the product's one escalation and the last thing read
should be the only thing that shouts. It takes `carryUnit` and renders `since Aug 2026` at age 1 and
`3 months · since Aug 2026` at age ≥ 2 for a month task; `S.carryLabel` is unchanged in both arms.

### 4.6 The task page's measure block

Between `LINKS` and `WHERE THIS GOES` (§4.7), which sits above the exits.

**No measure:** the `MEASURE` eyebrow and one `+ Add a number` `linkBtn`. The eyebrow renders even though
the block is empty, on `LINKS`' own precedent — an empty labelled block is how a feature is discovered, and
a bare link floating between two labelled blocks is a control with no name.

**With a measure**, in order:

1. `MEASURE` eyebrow, with `Edit` and `Remove` `linkBtn`s right-aligned on the same line.
2. The value line at **17 px / 700 `T.ink`** — `62 / 300 leads`. Larger than the row's 12.5 px, because this
   is the page about this number.
3. The bar, **only when `progress != null`**: height 4, radius 2, same two tokens, `marginTop: 8`.
4. `RECORD` (§4.8).
5. The sparkline (§4.9), when there are ≥ 2 readings.
6. The latest line, right-aligned, 12.5 px `T.mut`.
7. `READINGS` (§4.10).

**Edit** replaces 2–3 with the field block from §2.8 and swaps `Edit`/`Remove` for nothing (the block has
its own `Save measure`; `Escape` and a `Never mind` link cancel — the existing inline-edit idiom from
`AddSubGoal`). `RECORD` and below stay mounted and usable while editing: the readings are not the shape.

**Remove** replaces 2–3 with the `S.discardBar` strip (§2.8), focus to `Keep`. On confirm: `DELETE
/tasks/:id/measure`, toast `Measure removed`, the block returns to the no-measure state.

**Reaching the target renders nothing.** No sentence, no colour, no icon, no state change beyond the numbers
and the already-full bar. This is a decision, not an omission — see §6.5.

### 4.7 The task page's `WHERE THIS GOES` block

Between the measure block and the exits row, separated from the exits by its **own eyebrow and a 16 px
gap** and by nothing else. No border, no card, no colour: the separation that stops Park reading as a fourth
exit is a label and a gap, because a coloured well would be the first "this group is different" surface in
the product and `R-task-56` is explicit that Park **is not an exit**.

```
month task            →  line: `In Aug 2026 — the whole month, no particular week.`
                         button: `Park in a week`   (S.menuBtn)  → opens the retarget sheet
week task, Monthly    →  line: `In the week of 31 Aug.`
  ancestor exists        button: `Move to Sep 2026` (S.menuBtn)  → one tap, no sheet
week task, no Monthly →  line only
  ancestor
```

The Monthly ancestor is read from `useGoal(task.goalId).data.ancestors` — **an existing read this page
already makes** for its context line. `[...ancestors].reverse().find(a => a.horizon === 'Monthly')`; its
`periodKey` is what the button's label names. No wire change, no new field, no `canUnpark` flag.

Both directions are `POST /tasks/:id/retarget`, both logged (`R-task-58`), both reversible. **Un-park takes
no confirm**: it writes a logged, named, reversible event and loses nothing — every reading survives
(`R-measure-5`). Park takes a sheet because a week is a choice and there is nothing to choose on the way
back. That asymmetry is inherent to the operation, not a gap in the design.

Both are **withdrawn** when `task.status !== 'open'`, on `R-task-17`'s existing rule for the exits: a task
that has left a period cannot be moved between periods.

### 4.8 The record control

```
counter, delta mode (default):
  [ +1 ]   [ +__________ ]   [ Record ]
  Correct it instead

counter, absolute mode:
  [ Set to ______________ ]  [ Record ]
  Add to it instead

gauge:
  [ 78.5 _______________ ]   [ Record ]
```

- The `+1` chip is `S.chipBtn(false)`, 38 px, and posts `{ delta: 1 }` on tap. One tap, no field, no second
  stop, because `15 leads daily` is fifteen taps and not fifteen typed numbers.
- The field is `S.input` at `minHeight: 48`, `type="text"`, `inputMode="decimal"`, `autoComplete="off"`.
  **Not `type="number"`**: it grows spinners on desktop, silently discards unparseable input rather than
  showing it, and `valueAsNumber` returns `NaN` for the empty string — three ways to lose a value the owner
  typed. `inputMode="decimal"` gets the numeric keypad on iOS and Android, which is the whole reason
  `type="number"` was tempting.
- `Record` is `S.menuBtn` (40 px) — enabled iff the field parses to a finite number with `|v| ≤ 1e9`, or
  disabled while pending. **A gauge's `Record` is enabled when the pre-filled value is unchanged**, because
  the same weight on a new day is a reading.
- On success: a counter's field clears, a gauge's field takes the new `current`, **focus stays in the
  field**, and the announcement fires (§3.5). No navigation, no toast — a toast for a value that just
  repainted three lines above the field is a notification about something you are looking at.
- On failure: `FieldError` beneath the row, the existing `commandError` mapping. Nothing clears.

**A gauge is never offered a delta**, so `MEASURE_KIND_MISMATCH` is unreachable from this UI and is a
server-side backstop only.

### 4.9 The sparkline — exactly what it is

```
<svg width="100%" height="40" viewBox="0 0 320 40" preserveAspectRatio="none"
     aria-hidden="true" style={{ display: 'block', pointerEvents: 'none', marginTop: 12 }}>
  <path d={d} fill="none" stroke={T.mut} strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
</svg>
```

Geometry, given readings `r[0..n-1]` **oldest first** (the wire's order, `R-measure-5`):

```
n < 2                 →  render nothing at all. No svg, no placeholder, no empty box.
min = Math.min(...v),  max = Math.max(...v)
x(i) = 2 + (i / (n - 1)) * 316
y(v) = max === min ? 20 : 34 - ((v - min) / (max - min)) * 28
d    = `M ${x(0)} ${y(v0)} L ${x(1)} ${y(v1)} L …`
```

- **`L` only. Never `C`, never `Q`, never a smoothing pass.** A curve draws values between two readings that
  were never recorded, which is the app inventing data — the same objection as a trend line, at a smaller
  scale.
- **`preserveAspectRatio="none"` plus `vectorEffect="non-scaling-stroke"`** is the pair that makes this work
  at 328 px on a phone and 608 px on a wide `S.page` with one path and no measurement, no `ResizeObserver`
  and no ref: x is an index and stretching an index axis means nothing, while the stroke stays 1.5 CSS px.
- **`max === min` draws a flat line at y = 20.** No division is performed. This is the same discipline
  `R-measure-4` applies to `target === start`, one axis over.
- **Every reading is plotted.** No downsampling, no bucketing, no "last 30". Choosing which of the owner's
  readings matter is the app deciding, and at `MAX_READINGS = 2000` on a 328 px line SVG is untroubled.
- **`stroke={T.mut}`.** Not accent (which means *chosen*), not green, not red, not a gradient. `T.mut` is
  the product's secondary-information colour and it is what this is.

**It is not**, and each of these must be refused rather than deferred: an axis, a gridline, a tick, a value
label, a zero line, a **target line**, a **trend line**, a moving average, a projection, an area fill, a
gradient, a colour that means good or bad, a point marker, a hover, a tooltip, a crosshair, a legend, a
zoom, a pan, a click target, an animation, a transition, a `prefers-reduced-motion` branch (there is no
motion to reduce), or a chart library. **This is the first chart in this product and the list above is why
it is allowed to be.**

### 4.10 The readings list

Newest first — the reverse of the wire, which is oldest first. Ten rows, then `Show all 43`.

```
row:  flex, minHeight 40, borderTop 1px T.lineSoft
      value  13.5px/600 S.body      `62 leads`
      date   12.5px T.mut, right    `Wed 2 Sep`
      ×      36×36 button, T.mut    aria-label `Delete reading 62 leads, Wed 2 Sep`
```

**Deletion is one tap with no confirm.** The precedent is `Remove link`, a one-tap `×` on this same page,
and the reason is `R-measure-5`'s: correcting a mistyped `240` **is** deleting it and recording `24`, so a
confirm sits on the recovery path rather than the destructive one. Nothing is lost that cannot be
re-recorded, and `R-measure-7` requires that a deleted reading leave no trace anywhere — including no undo
bar, which would be a trace.

After a delete the value line, the bar, the sparkline and the latest line all re-render from the server's
new `current` (`R-measure-3`'s one rule: latest surviving reading, else `start`). The announcement fires.
**Focus moves to the row that took the deleted row's place**, or to the `READINGS` eyebrow when the list is
now empty — never to `<body>`.

Empty: `Nothing recorded yet.` — 13 px `T.mut`. The value line above still reads `0 / 300 leads`, because
`current` falls back to `start` and that is not nothing.

### 4.11 The measure fields — one component, two hosts

`MeasureFields` is rendered by the create sheet and by the task page, identically. It owns four values and
emits one object; it does no I/O.

- `kind` — the chip radiogroup, **default `counter`**. Most measurable intentions accumulate; a gauge is the
  explicit case, and `R-measure-3` says a counter is a gauge you usually bump.
- `start` — `S.input`, `inputMode="decimal"`, **default `0`** for a counter and **empty** for a gauge. A
  counter starts at nothing by construction; a gauge starts at wherever you are, which the app does not
  know.
- `target` — `S.input`, `inputMode="decimal"`, placeholder `Optional`, **empty is `null`** and is a legal,
  first-class save.
- `unit` — `S.input`, free text, trimmed, ≤ 16 graphemes enforced client-side with the same `maxLength` the
  server bounds. Never parsed, never pluralised, never validated against a list.

Save is blocked when: `start` is empty or unparseable; `target` is non-empty and unparseable; either exceeds
`1e9`; or `start === target` (the message in §3.4 renders at that point). Everything else is the server's.

**Editing an existing measure** may change `kind`, `start`, `target` and `unit` — and changes **no
reading**. `current` is derived and is never a field. The timeline logs `Measure edited: target "300" →
"400"` (`R-task-58`), which is the shape half; the values half stays out of it (`R-measure-7`).

### 4.12 The retarget sheet

One new `UIContext` sheet kind, `{ kind: 'retarget', taskId }`. It is the **only** new sheet kind in this
plan; the measure is inline on every surface it appears on.

It renders `ChipRadioGroup` — **the component `32-UX-PLAN` §7 directs the build to extract** — over
`taskWeeksInMonth(task's month, today)`, with **no month option** (retargeting to the period the task is
already in is a no-op, `R-task-56`), beneath it the `weeklyTarget` goal picker or `implicitWeeklyGoalNote`,
and `taskDestinationNote` last. **The A8 build agent renders this component and does not write a second
one.** That directive is `32-UX-PLAN` §5.4's and it is repeated here because this is the caller it was
written for.

### 4.13 The chrome ledger

**Spent, on a lens:**

| Surface | Cost | Conditional? |
|---|---|---|
| Weekly lens, month band | 1 hairline + 1 × 44 px header + 1 × 17 px sentence | yes — `monthTasks.length > 0` |
| Weekly lens, band foot | 1 × 34 px note + 1 × 44 px link | yes — and only in the past-month state |
| Monthly card | 1 hairline + the nested list | yes — the list is the card's content |
| `TaskRow` | 1 × 17 px line + 1 × 2 px bar | yes — `measure !== null` |

**R-nav-27 is untouched in letter and in fact.** It bounds *unconditional rows above the first item*; every
line above is conditional and every one of them renders **below** the first item. The sticky block stays at
**91–96 px** and gains nothing.

**Spent, on a page:** one `MEASURE` block (unconditional on the task page, ~40 px in its empty state), one
`WHERE THIS GOES` block (~70 px, and only above the exits).

**Spent, in a sheet:** one 17 px `+ Add a number` link, collapsed by default.

**Not spent:** no new colour, no new token, no new palette entry, nothing new for
`tests/screens/contrast.test.ts` to check; no new modal pattern; no second picker family member; no fifth
`R-nav-31` mode; no chart library; no dependency of any kind; no animation; no `prefers-reduced-motion`
branch; no fourth unconditional lens row; no percentage anywhere; no new date spelling; **one** new sheet
kind.

---

## 5. Accessibility, per item

### A / B — the Monthly card and the month band

- The band's header is the existing `CollapsibleHeader`: a real `<button>`, `aria-expanded`, 44 px, with the
  `▾`/`▸` marker `aria-hidden` because `aria-expanded` already carries the state. Its `aria-label` is
  `` `${name}. ${collapsed ? 'Expand' : 'Collapse'} band.` `` — unchanged mechanism, new `name` (§3.1).
- The band note is plain text and takes **no focus stop**; it is folded into nothing and read in DOM order
  immediately after the header, which is where it belongs.
- The band's cards are `CardShell` with `role="group"` and an `aria-label` naming the goal and its task
  count, on `MonthlyCard`'s own precedent — `role="group"` and not a bare `<div>`, because ARIA-in-HTML does
  not honour a name on `generic`.
- **The suppressed carry label produces no `aria-hidden` element and no empty node**: it renders nothing at
  all, so a screen reader hears exactly what a sighted user sees, which is nothing. A visually-hidden "not
  late" would be the announcement version of the badge `R-lens-31` forbids.
- The past-month link is a real `<button>`, 44 px, `S.linkBtn`, `aria-label="Go to Sep 2026 on the Monthly
  lens"` — the destination spelled out, `R-lens-29`'s own rule for the same idiom.
- **Nothing in the band is announced on render.** The lens's single polite region (`LensScreen`) already
  announces the period and its counts; adding the band to that utterance would make it longer for a section
  that is below two others.

### C — Park and demote

- Both controls are `S.menuBtn`, 40 px tall with 13 px of padding, in the ordinary tab order between the
  measure block and the exits.
- The un-park button's **visible** label already names its destination, so its `aria-label` adds only the
  clause that a month is not a week: `Move to Sep 2026 — the whole month, no particular week.`
- The retarget sheet reuses `Sheet`'s existing dialog contract: one focus trap, heading focused on open with
  `tabindex="-1"`, `Escape`'s two-stage behaviour untouched. **No second focus trap and no nested dialog.**
- `ChipRadioGroup`: `role="radiogroup"` + `aria-label="When this lands"`, each chip `role="radio"` with
  `aria-checked` and an explicit `aria-label` (`Week of 14 Sep`). Roving tabindex, one stop, `←`/`→` **and**
  `↑`/`↓` move-and-select, `Home`/`End` to the ends. That model is `32-UX-PLAN` §7's, extracted once and
  used twice; a second copy is how two controls in one product come to disagree about `Home`.
- Success on either direction announces through the existing toast's `role="status"`: `Parked in the week of
  14 Sep` / `Moved to Sep 2026`. The page then re-renders with the opposite control, and **focus moves to
  it**, so the reversibility is one keystroke away rather than a hunt.

### D — setting a measure

- `+ Add a number` is a real `<button>` with `aria-expanded` reflecting the block's state, because it is a
  disclosure and not a navigation.
- The kind chips are a `role="radiogroup"` with `aria-label="How you'll record it"` — the same visible
  string sits above them, so a sighted user and a screen-reader user get the identical name.
- **The kind note is inside the radiogroup's `aria-describedby`**, so choosing `Gauge` is heard as
  `Gauge — you set it, radio button, 2 of 2. You set it. Each entry replaces the last: 78.5.` The note
  changes with the selection, so it is also inside a polite region; a description that silently rewrites
  itself under a user is the change `29-UX-PLAN` §3.5 forbids.
- Every number field has a **visible** label above it and the same string as its `aria-label`. `Target
  (optional)` says *optional* in the label rather than only in the placeholder, because a placeholder is
  gone the moment you type and is not a label.
- `inputMode="decimal"` on all three numeric fields. `Unit` is `inputMode="text"` and `autoCapitalize="off"`
  (`kg`, not `Kg`).
- The range note is inside the block's polite region: it is a live restatement of four fields, which is
  exactly what a screen-reader user cannot see re-render.
- The remove strip is `S.discardBar` — the existing shape, already tested — with focus moved to `Keep` on
  open, the same defensive default the task page's discard strip uses.

### E — reading a measure

- The measure line is **text inside the row's existing title button**, so it is part of the row's accessible
  name and no new stop is added. A row reads: `Complete Reach 15 leads a day` (the checkbox), then `Reach 15
  leads a day. Done when: 300 logged in the CRM. 62 / 300 leads. 3 weeks · since 10 Aug.` (the title
  button).
- **`62 / 300 leads` is spoken as written.** Screen readers read `/` inconsistently — *slash*, *per*, or
  silence. That is why every live-region string in §3.5 says `of` instead, and why the static row does not:
  a static string can be re-read and paused on; an announcement cannot.
- The bar is `aria-hidden="true"` and has **no `role="progressbar"`**, deliberately. `progressbar` carries
  `aria-valuenow`/`valuemin`/`valuemax` and is announced as a percentage by most screen readers — which is
  the one number this feature is forbidden to produce (`R-measure-4`, `R-measure-8`). The numbers beside it
  are the accessible content; the bar is decoration for the eye.
- **Colour is never the only carrier**: the bar restates numbers that are already text, one line above it.
  There is no state the bar shows that the text does not.

### F — updating

- The `+1` chip's accessible name spells the unit (`Add 1 lead`), because `+1` alone is a glyph and a digit.
- The field's `aria-label` carries the unit and the direction (`How many leads to add` versus `New value in
  kg`), so the kind is audible without reading the block above.
- **Focus never moves on a successful record.** The result arrives in the polite region; the field is where
  the next value goes. Moving focus to a toast or a value line would cost a keyboard user a trip back for
  every rep.
- The announcement is the **full new state**, not a confirmation: `Recorded 65. Now 65 of 300 leads.` —
  *what you did* and *where that leaves the numbers*, which is exactly what the eye picks up from the line
  that just repainted.
- `Record` is disabled while pending, never hidden, and the disabled state carries no explanatory text: it
  lasts one round trip.

### G — the sparkline

- The `<svg>` is `aria-hidden="true"` and `pointer-events: none`. It is not focusable, not tabbable, and has
  no `role="img"` — because an `img` needs an `alt` that carries the picture's information, and here the
  information is a list of numbers that is already on the page.
- Immediately after it, a **visually-hidden `<p>`** (the `position: absolute; width: 1; clip: rect(0 0 0 0)`
  pattern this codebase already uses): `Sparkline of 14 readings in reps, oldest to newest. Every reading is
  listed below.` It is not a live region — nothing about a static picture needs announcing.
- **The text equivalent points at the readings list rather than reciting the values**, and that is the
  design. Reciting 2 000 numbers into a screen reader is hostile; reciting the *most recent* ten would give
  a screen-reader user strictly less than the picture gives a sighted one. The list below is complete,
  ordered, and individually navigable — so the sparkline genuinely adds no information a screen reader
  cannot already get, and the honest equivalent says so.
- The latest line (`Latest 62 leads · Wed 2 Sep`) is **ordinary text, not hidden**, so the one value the
  picture emphasises is available to everybody in the same place.

### H — completion versus target

- The checkbox's `aria-label` is **unchanged**: `Complete Reach 15 leads a day` / `Uncheck Reach 15 leads a
  day`. It gains no measure, no progress, no `of 300`. A completion control that recites a number invites the
  reading that the number is the condition.
- Nothing in the measure block is announced when `current` crosses `target`. There is no live region on the
  value line and no state to announce; the number changed and the announcement for that already fired
  (§3.5).
- On a **done** task the measure line's colour changes and nothing else does: no strike-through, no
  `aria-hidden`, no removal. The record control is still rendered and still works — completing a task does
  not stop you recording what happened (`R-measure-6`: completion and the measure are independent in both
  directions).

---

## 6. What I rejected

### 6.1 A `THIS MONTH` heading that never names its month — rejected

`R-lens-31` proposes the bare heading. On 2 Sep the band holds August, and a heading reading `THIS MONTH`
above August's work is precisely the labelling defect `R-lens-29` was written to fix one lens over
(`RECONCILIATION ★C-19`: *the lens is right and looks broken*). It also makes the seam unreportable: an
owner who sees `THIS MONTH` and August tasks has no way to tell a bug from the Monday rule. Naming the month
costs nine characters in a header that already fits, and it makes the trap in §4.2 legible before it is
prevented. **Amended, cited at §7.1.**

### 6.2 A band `+ Task` that silently targets the current month — rejected

The tempting fix for §4.2: keep `+ Task` on 2 Sep, and have it create into September. It cannot be right.
Either the new task appears in the band — which would be false, because September's tasks are not in
August's band — or it does not, which is a create that vanishes from the screen that made it: `R-task-41`'s
rule and `R-nav-19`'s reason, and the exact defect A9 spent an amendment closing. Labelling the button
`+ Task in Sep 2026` fixes the honesty and not the vanishing. **The affordance that would need a clamp is
the affordance that must not render.**

### 6.3 A per-row `Park in a week` — rejected

`R-lens-31` puts `Park in a week` on the band's rows. A `TaskRow` has exactly two stops today — the checkbox
and the title — and a third control on **every** row in **every** list, for an operation done a handful of
times a month, is the density `R-nav-27` refuses and the affordance-multiplication `32-UX-PLAN` §6.8 refuses
one control over. It would also need a menu (there is no row menu in this product) or a bare button (a third
target in a 44 px row at 328 px). Park lives on the task page, one tap from the row, where it can state what
it will do and be undone by the control that replaces it. **Amended, cited at §7.2.**

### 6.4 A percentage, anywhere — rejected outright

`21%` is shorter than `62 / 300 leads` and it is the wrong string. It discards the unit — the one word that
makes the owner's number theirs; it invites the two forbidden readings (`100%` means done, `over 100%` means
a bar past its end); it is the natural home for a colour that means good or bad; and it is a number **the
app derived**, which is `R-measure-8`'s own admitting test on the wrong side. The bar is the visual
shorthand and it is unlabelled on purpose. `R-measure-4` names `0%` and `100%` as specifically forbidden
answers in the `progress`-absent case; this plan makes them absent in every case.

### 6.5 A sentence when the target is reached — rejected

The near-miss. Something like *"You've recorded 18 of 15 leads. Tick it when you're done."* would be
factually true, would restate `R-measure-6`, and would land at the moment a user is most likely to expect
an auto-complete. It is still refused. A sentence the app writes about your number, at the moment your
number gets interesting, is the app having an opinion — and it would be the seed of the next one
(*"you're ahead"*, *"you're behind"*). **The absence is the feature**: reaching the target changes the
numbers and fills the bar, and the product says nothing, which is what *"show what you recorded, never
compute a verdict"* means at its sharpest.

### 6.6 A trend line, a moving average, a target line on the sparkline — rejected

A target line looks free — it is one `<line>`, it is data the task already holds, and it would answer *"am I
near it"* at a glance. It is a verdict drawn in a chart: the whole content of "near it" is the app comparing
your number to a goal and rendering the comparison. A trend line and a moving average are worse, because
they render values that were never recorded. `R-measure-8` names all three, and they are refused rather than
deferred so the next agent cannot land any of them as an obvious improvement to a chart that "already
exists".

### 6.7 Time on the sparkline's x axis — rejected

The obvious modelling choice, and wrong here. Readings arrive when the owner records them: a fortnight with
no entries becomes a long flat run that reads as *"it held steady"* — a claim about a period in which
nothing was measured. Equal index spacing makes exactly one claim, and it is true: *these are your readings,
in the order you made them*. It also removes a whole class of degenerate geometry (two readings a minute
apart, then one six months later) with no special case.

### 6.8 A second sheet for the measure — rejected

A `Set a measure` sheet would be tidier in the create flow and it is the wrong shape twice: on the **task
page** it would be a modal covering the numbers it edits, which is the modal the redesign removed
(`TaskPage`'s own note on the uncheck prompt makes this argument); and in the **create sheet** it would be a
sheet inside a sheet, which the product has nowhere and which `R-nav-31`'s takeover contract deliberately
avoids. One inline block, two hosts, one component, one copy set.

### 6.9 A tint, an indent or a smaller type size for the month band — rejected

Every cheap way to say *"this is not this week"* is a way of saying *"this matters less"*, and the owner's
sentence is the opposite: **the deadline is the end of the month**, which is a commitment and not a
footnote. This product also states differences in words rather than colours by standing rule (`nothing this
week` is the same grey as `3 weekly goals`; no goal is muted or greyed anywhere, `R-goal-38`). Position,
a heading that names the month, and one sentence carry the whole distinction — and every row in the band
stays at full size, full weight and full contrast, which is what stops "not this week's work" from becoming
"noise at the bottom".

### 6.10 A row menu, a swipe action, or a long-press — rejected

Park, un-park and delete-a-reading all invited one. This product has no row menu, no swipe gesture and no
long-press anywhere; each would be a new interaction model with its own keyboard equivalent to invent, its
own discoverability problem, and its own accessibility floor to re-establish. `ReorderableList` is the one
place a row has a second control, and it is a visible always-rendered button with a full keyboard model —
the standard this plan would have to meet and does not need to.

### 6.11 A confirm on deleting a reading — rejected

It sits on the wrong path. `R-measure-5` is explicit that correcting a mistyped `240` **is** deleting it and
re-recording `24`, so the delete is the *repair*, and putting a confirm in front of a repair taxes the
honest user to protect against a mis-tap that is itself repaired by one more tap. `Remove link` on the same
page already sets the precedent with the same `×` at the same size. Removing the whole **measure** is
different and does get a confirm, because that one destroys history rather than one row of it.

### 6.12 An undo bar after a delete — rejected

`R-measure-7`: *a deleted reading leaves no trace anywhere, deliberately. An audit trail of a typo defeats
the reason deletion exists.* An undo bar is a trace, in the UI layer, holding the value it claims to have
removed.

### 6.13 A count of month tasks on the Weekly lens's group header or announcement — rejected

`R-lens-31` says it in the rule and it is worth restating as a design refusal: the count answers *"what is on
me this week"*, and a month task is precisely the work this amendment exists to say is **not** on you this
week. Counting it would contradict the no-late-styling rule one row above it, in a number. The lens's polite
announcement is unchanged for the same reason.

### 6.14 Any roll-up of a measure onto a goal, a card, or a Life line — rejected

The most natural "obvious improvement" left after this ships: `Rebuild the gym habit · 62 / 300 leads` on
the Monthly card, or a Life line summing three counters. `R-measure-8` forbids it in full — *nothing
aggregates a measure across tasks, anywhere* — and it would also be a fifth ambient number in a product
whose permitted set is four. **Refused, not deferred.**

---

## 7. Rules that must change

### 7.1 `R-lens-31` — the band's heading names its month, and its create affordance is on the card

The rule's first paragraph currently reads *"…the **month band**, headed `THIS MONTH` and holding the month
tasks of **the month `W` belongs to**, grouped by their Monthly goal."* **Replace `headed THIS MONTH` with:**

> headed **`This month · <the month's label>`** — the words *and* the month's own name, never the words
> alone. On 2 Sep 2026 the band reads `THIS MONTH · AUG 2026`, because a heading that will not name the
> month it is showing makes the Monday rule unreportable at exactly the seam `R-lens-29` exists to explain.

Its `+ Task` bullet currently reads *"**`+ Task` renders at the band's foot** and creates a month task on the
chosen Monthly goal (`R-task-57` a), on the current or a later month. Each of the band's Monthly-goal
sub-headings also offers `Park in a week` on its rows (`R-task-56`)."* **Replace in full with:**

> - **`+ Task` renders on each band card's foot, never at the band's foot**, and creates a month task on
>   **that card's goal** in **the band's own month** (`R-task-57` a). The goal is the card you tapped, so
>   nothing is chosen, nothing is inferred, and no goal picker is needed — a band-foot create would have to
>   ask which Monthly goal, and the only honest way to ask is a fifth `R-nav-31` mode.
> - **It renders if and only if the band's month is not past** (`R-goal-36`, `R-task-41`, `R-task-57`) — the
>   same rule that already withdraws every create affordance from a past week and from the carried band. On
>   2 Sep 2026 the band is August's, so **no card in it renders `+ Task` at all**, and `PERIOD_IN_PAST` is
>   unreachable from this surface rather than handled on it.
> - **In its place, the band's foot names the destination and offers one tap to it**, in `R-lens-29`'s
>   shape: `Aug 2026 has ended. New work for the month goes in Sep 2026.` and `Go to Sep 2026`, which
>   navigates to the Monthly lens at the current month.
> - **The band never substitutes a month.** It passes its own `monthPeriodKey` and never
>   `currentPeriodKey('Monthly', today)`, never a clamp and never a fallback. Because the control renders
>   only when that month is not past, the two are equal wherever it renders — so there is no branch in which
>   the band creates into a month other than the one it is showing.
> - **Park is not offered on a band row.** It is on the task page (`R-task-56`), one tap away, where it can
>   state what it will do. A third control on every row in every list, for an operation done a handful of
>   times a month, is the density `R-nav-27` refuses.

### 7.2 `R-task-56` — where Park and un-park are raised from, and un-park's label

Append to the rule:

> **Both directions are raised from the task page**, from a `WHERE THIS GOES` block that sits above the
> three exits, separated from them by its own eyebrow and a gap and by nothing else — no border, no card,
> no colour, because Park is not an exit and a coloured well would say it was. **Park in a week** opens the
> retarget sheet, which renders the same `When this lands` control the create sheet does (`R-task-49` as
> amended by A11), with **no month option**. **Un-park is one tap with no sheet and no confirm**, and its
> visible label **names its destination** — `Move to Sep 2026`, not `Move to the month` — because there is
> no sheet on that path to state where the work lands. It is withdrawn, not disabled, when the Weekly goal
> has no Monthly ancestor (`HORIZON_CONFLICT`) and when the task is not open (`R-task-17`).

### 7.3 `R-goal-47` — the planned-ness line gains one case

Append:

> ⚠ **Amended by A8.** When a Monthly goal has **no Weekly goals** and its card now renders **at least one
> month task** (`R-lens-32`), the line reads **`No weeks yet`** rather than `Nothing planned yet`. The
> original string is a claim about the month that the tasks directly beneath it contradict; the new one is
> the same fact narrowed to what the line is actually about. With no weeks **and** no tasks the string is
> unchanged, verbatim.

### 7.4 `R-lens-32` — the card's empty task list has its own string

Append:

> The nested list's empty state is **`Nothing on this month yet.`**, and not `WeeklyCard`'s `Nothing on this
> yet.` A Monthly **goal's page** renders a task list and a backlog block one above the other (`R-goal-41`
> as amended), and two adjacent lists both reading `Nothing on this yet.` is the one place `R-backlog-30`'s
> distinction is lost in a word.

### 7.5 `R-measure-4` — the two keys are independent

Append to the optional-target bullet:

> **In the UI these are two independent keys and must never be collapsed into one.** The `current / target`
> form is keyed on **`target !== null`**; the bar is keyed on **`progress != null`**. A no-target gauge has
> neither. A measure with `target === start` in the data has **the numbers and no bar** — `62 / 62 leads` —
> because the numbers are what was stored and no division was performed. Keying the numbers off `progress`
> renders that task as `62 leads`, which is a lie about its data.

### 7.6 `R-measure-8` — three UI-shaped refusals, named so they can be audited

Append to the list:

> - **No percentage is rendered anywhere**, in any surface, at any size. `21%` discards the unit, invites
>   `100% = done`, and is a number the app derived.
> - **The bar carries no `role="progressbar"`.** That role's `aria-valuenow` is announced as a percentage by
>   most screen readers, which would make the forbidden number audible while it is invisible.
> - **Reaching the target renders and announces nothing.** No sentence, no colour change, no icon, no live
>   region. The numbers change and the bar is full; the product has no comment.

### 7.7 `R-task-59` — the demote uses the existing sheet, with one resolution change

Append:

> The exit is the **existing** `Move to Backlog` sheet with **not one string changed**. The only change is
> which goal it names: for a **month task** the landing goal is the task's **own** goal, because
> `R-backlog-29`'s walk terminates immediately — the client's `[...ancestors].reverse().find(a => a.horizon
> !== 'Weekly' && a.horizon !== 'Life')` must therefore be preceded by *"if the task's scope is `Monthly`,
> the landing goal is `task.goalId`"*, or the sheet names a grandparent and the write lands elsewhere.

### 7.8 `docs/BUSINESS-RULES.md`

Two sentences, in the owner's register:

> A monthly task shows up in every week of its month, at the bottom, under the month's own name. It wears no
> late styling there, because it isn't late — the deadline is the end of the month.
>
> A task can carry a number. You either add to it or you set it, it can have a target or not, and every
> value you record is kept and shown as a small line with the values beside it. The app never works out
> whether you're on track.

**`apps/api/src/api/mcp/business-rules.ts` must be regenerated in the same commit**;
`apps/api/tests/mcp/verbatim.test.ts` is what catches a build that forgets.

### 7.9 Untouched, and why each is untouched

- **`R-nav-27` (three unconditional rows)** — untouched. Everything this plan adds to a lens is conditional
  and renders below the first item; the sticky block stays 91–96 px.
- **`R-nav-31` (one goal picker)** — untouched, and given **no fifth mode**. The band's `+ Task` needs no
  picker because the card is the goal; the retarget sheet uses the existing `weeklyTarget` mode.
- **`R-task-48`** — untouched and still load-bearing: the retarget sheet's zero-candidate case is one of the
  three flows that still names a week.
- **`R-task-49` / `R-task-57` as amended by A11** — untouched. The month is the create sheet's default, a
  week is an explicit narrowing, and this plan changes neither.
- **`R-task-13` (exactly three exits)** — untouched. Park is not one, and the layout says so with a label
  and a gap.
- **`R-measure-6`** — honoured in both directions and in the DOM: the checkbox has no measure in its
  accessible name, and the record control is still live on a done task.
- **`R-lens-13`** — honoured: every selection is announced through `aria-checked`, and every consequence
  through a polite region.

---

## 8. Open questions

1. **Should the month band's `+ Task` also offer `Pull from backlog`?**
   **[recommended: no.]** A pull is a planning decision about a goal's own deferred work, and
   `R-backlog-31`'s `Add to this month` already lives on the Monthly lens and the goal's page, where the
   backlog is visible. The band is a week's *view* of a month. If the owner hits this in real use, the fix
   is one more link in the same `LinkRow`, not a new surface.

2. **Should the band render at all on a lens for a week the owner cannot plan into — a past week?**
   **[recommended: yes.]** A past week's own plan and its carried band both still render, fully
   interactive, because history is readable and truthful (`R-task-14`). The month band follows the same
   rule and simply carries no create affordance, which is the state §2.1 draws.

3. **Should a counter's `+1` chip be `+1`, or configurable?**
   **[recommended: `+1`, fixed.]** A configurable step is a fifth field on a block that already has four,
   to save one keystroke on a value the owner can type. `+1` covers `15 leads daily` and `2 calls weekly`;
   anything else is one tap and a number.

4. **Should the readings list show more than ten before `Show all`?**
   **[recommended: ten.]** Ten is the sparkline's recent tail at a glance, and the full list is one tap
   below it. Earned by use, not guessed at now.

5. **Should a gauge's field pre-fill with `current`, or open empty?**
   **[recommended: pre-fill.]** A gauge is adjusted from where it is (`78.5` from `78.9`), and an empty
   field asks the owner to retype a number the app is showing them. The cost — an accidental duplicate
   reading — is one tap to delete and is not a data loss.

6. **Does the sparkline appear anywhere but the task page?**
   **[recommended: no**, and `R-measure-5` already says so. A goal card, a lens row and a backlog row all
   want one and none may have it: a screen of sparklines is the report `R-nav-26` refuses.]

7. **Should `Park in a week` be reachable from the Monthly lens's nested rows as well as the task page?**
   **[recommended: no** — one home for the operation, on the task page, at both scopes. Two homes is two
   places to keep the copy and the bounds in agreement.]

8. **What does the band do when a month task's Monthly goal is re-planned to a later month
   (`R-goal-40`)?**
   **[recommended: nothing** — `Q-F`'s answer, unchanged. The task's period is its own stored field and
   does not follow its parent, so the task stays in the band of its own month and the goal moves on its
   own. Recorded here because it will look like a bug the first time the owner sees the card and the band
   name different months.]
