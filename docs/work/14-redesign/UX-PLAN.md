# 14 — UX plan: lens navigation and the task page

The design for `CHANGE-REQUEST.md`, all six CRs, with the owner's decisions settled. This is the
UX contract: navigation model, screen structure, final copy, focus order. It designs no API, no
data model and no router internals.

**One owner correction is folded in**, arriving after the first draft: *"no only leaf node can have
tasks. that is only weekly goals and not monthly."* Weekly is the terminal horizon and the only one
that holds tasks. §5.1 states the rule and what it costs the Monthly lens; §6.4 and §6.7.1 are the
screens it changed.

**Written in parallel with the spec pass.** `docs/SPEC.md` had no lens rules when this was written,
so every citation below points at a rule that exists **today** and that this design either keeps
verbatim or knowingly generalises. §9 lists, explicitly, the flows this design needs that **no
rule covers yet** — those are the spec pass's inbox, not silent assumptions.

---

## 1. The core navigation decision

### 1.1 The complaint, taken literally

> *"i dont like the tree view goals, its too clutered."*

Clutter is measurable here, so it was measured. The unit is **rows of chrome above the first real
item** — the stuff you scroll past before you see a goal.

| Screen | Today | Rows |
|---|---|---|
| Tasks | eyebrow + `Edit plan` · week switcher · `Past week — still editable` · goal filter pills | **4** |
| Goals | eyebrow + `Goals` + `+ New goal` · the Life-goal summary strip · then a tree you must expand | **3 + depth** |

A naive reading of this change request makes that *worse*: a five-way lens switcher (1 row) plus a
period stepper (1 row) plus Life-goal group headers (1 row per group) is five rows before the first
item, on a screen that already lost the argument at four.

So the design has a **budget**, and it is the first-class constraint:

> **Two rows of chrome. One for the app cluster, one for the lens. Nothing else is unconditional.**

The result is 2 rows where Tasks has 4 and the tree has 3-plus-depth. This design does not merely
avoid adding clutter — it removes half of what the owner complained about, and it does so before
any of the new capability is counted.

### 1.2 The decision: **the title is the altitude**

There is no lens switcher, because the lens does not need a control of its own. The five horizons
name five period shapes, and the period **already** names its own horizon:

| Lens | Title reads | You know the lens because… |
|---|---|---|
| Life | `Life` | it is the only lens with no period |
| Yearly | `2026` | a bare year is a year |
| Quarterly | `Q3 2026` | `Q` |
| Monthly | `Aug 2026` | a month name |
| Weekly | `Week of Mon 31 Aug` | it says so |

The single header row is:

```
   ‹        Q3 2026  ▾        ›
```

- **`‹` / `›` step the period.** Same control the Tasks screen has today (R-nav-3/R-nav-16), same
  place, same 40px targets — except `›` is no longer disabled, because there is no forward cap.
- **The title is a button.** Tapping it opens the **Zoom sheet** — the five altitudes as a vertical
  ladder, each row labelled with *the exact period it would land you on* and how many goals are
  there. Altitude is a vertical idea, so it gets a vertical list; time is a horizontal idea, so it
  gets left/right chevrons. The two dimensions never share a widget and never compete for width.
- **Horizontal swipe on the list body** is the same as the chevrons, for the thumb. It is never the
  only route (§7.4).

That is the whole navigation. **One control per dimension, and no second path that can disagree
with the first** — which also retires the entire class of bug D-24 (the mockup's week picker and
chevron clamp reaching different weeks) by construction rather than by a shared constant.

### 1.3 Why the Zoom sheet is not "one tap too many"

Zooming is the *primary* model but not the *frequent* act. The frequent acts are: open the app and
do today's work (Weekly), and step a period back or forward (chevrons, zero taps of overhead).
Changing altitude is deliberate and exploratory — the owner's own sentence is *"when i zoom i see
quaterly"*, which is a thing you decide to do, not a thing you do forty times a day.

Two things make the one tap pay for itself:

1. **The Goals tab remembers your lens.** Tapping `Goals` returns you to the lens you were last in,
   at the period containing today. Daily use never opens the sheet at all.
2. **The sheet tells you where you would land before you go.** Every row carries its destination
   period and its count. A persistent five-way switcher cannot show that — it has room for five
   labels and nothing else — so the sheet is not just cheaper chrome, it carries strictly more
   information than the control it replaces. This is what stops the zoom model feeling arbitrary
   (§3).

### 1.4 Alternatives rejected

**A five-way segmented control, pinned under the header.**
Rejected on the complaint itself. It is a permanent row that says nothing new once you have read
the title — five labels of which four are always wrong — and `Life · Yearly · Quarterly · Monthly ·
Weekly` is 42 characters; at 360px it needs 7px type or truncation to `Life · Yea… · Qua… · Mon… ·
Wee…`. It also treats an ordered scale as five peers, which is exactly the wrong mental model. It
would have to sit *above* the period stepper, restoring the four-row header this design deletes.

**A persistent vertical altitude rail (5 dots, right edge).**
The right metaphor, the wrong ergonomics. Five dots on a phone edge are 8px targets under a 44px
minimum, they read as a scrollbar, and labelling them costs the width the rail was meant to save.
Unlabelled, it is a control you have to learn. Rejected on accessibility before taste.

**One tab per lens.**
Owner's decision 4 forbids it, and it is wrong anyway: five tabs plus `+` plus Learnings is seven,
and it flattens a scale into a peer set a second time.

**Keeping the tree, with better collapse.**
This is the thing the owner asked to remove. Recorded only so it is on the list.

**A single scrolling page with all five lenses stacked as accordions.**
Tempting — no navigation at all — but every lens except Life is period-scoped, so five accordions
need five period steppers. Five rows of chrome. It is the clutter complaint with extra steps.

**Pinch-to-zoom between lenses.**
The metaphor is exact and the affordance is invisible. It would have had to ship alongside a
non-gesture equivalent anyway (§7.4), so it would be pure addition. Kept in the back pocket as a
future accelerator; not in this design.

### 1.5 What else the two-row budget bought

Three deletions that the budget forced and that improve the product independently:

- **The goal filter pills are gone** (owner's decision 5) — one row saved, and their counts move to
  the group headers where they mean more (§4.2).
- **The `Tasks` eyebrow and the `Goals` H1 are gone.** The title *is* the page identity. Nothing in
  the app now labels a screen twice.
- **The `Edit plan` button and the whole Plan screen are gone.** Weekly goals are ordinary goals
  created where you already are (§6.5). Planning stops being a mode.

### 1.6 The tab bar and the routes

Tabs, exactly (owner's decision 4, amending R-nav-1):

```
        Goals              +              Learnings
```

`Goals` is the lens shell — all five lenses live behind it, and it stays lit on a goal detail
screen and on the task page (extending R-nav-2). `+` remains the circular Add-to-Backlog drawer,
unchanged. Backlog keeps no tab and is still reached from the drawer's `View Backlog →` and a Life
goal's `Open Backlog →` (R-nav-2, R-backlog-11).

Routes (URL shapes only — the router's implementation is out of scope):

| Route | Screen |
|---|---|
| `/` | redirect to the remembered lens at the period containing today; first ever run → `/week` |
| `/life` | Life lens |
| `/year/2026` | Yearly lens |
| `/quarter/2026-Q3` | Quarterly lens |
| `/month/2026-08` | Monthly lens |
| `/week/2026-08-31` | Weekly lens (the Monday, absolute — never an offset; D-1) |
| `/task/:taskId` | the task page (§6.6) |
| `/goal/:goalId` | goal detail (existing screen, unchanged) |
| `/backlog`, `/learnings` | existing screens |

Periods are machine-formatted in the URL (`2026-Q3`) and human-formatted on screen (`Q3 2026`).
`/week/:monday` carries the absolute Monday because a relative offset in a URL means something
different on Tuesday — the same decay bug D-1 exists to prevent.

---

## 2. The shell

Every lens renders the same three-part shell. Only the middle changes.

```
┌─────────────────────────────────────────┐
│                              ☾   + Goal │  cluster row — R-nav-11
│  ‹          Q3 2026  ▾           ›      │  lens row
│  Future quarter — planning ahead  Now › │  off-now row — conditional only
├─────────────────────────────────────────┤
│                                         │
│  … groups …                             │
│                                         │
├─────────────────────────────────────────┤
│        Goals         +        Learnings │
└─────────────────────────────────────────┘
```

- **Cluster row** — theme toggle plus at most one primary action, unchanged from R-nav-11. The
  primary action is the lens's create button and names the horizon: `+ Life goal`, `+ Yearly goal`,
  `+ Quarterly goal`, `+ Monthly goal`, `+ Weekly goal`. On a past period it is **absent** (§6.7).
- **Lens row** — §1.2. Title is `nowrap`, 21px/800, `flex: 1`, centred; drops to 18px under 360px
  viewport width. No string it can hold is long enough to truncate.
- **Off-now row** — renders **only** when the selected period is not the one containing today. It
  carries the badge (R-nav-17's copy, generalised per horizon) on the left and a `Now ›` link
  button on the right. This is the escape hatch that unbounded forward navigation requires: without
  it, fourteen months out is fourteen taps home.

---

## 3. The zoom model

### 3.1 The rule, in one sentence

**Zooming preserves an anchor date and clamps it into the destination period; where the anchor is
not inside the destination's parent period, the destination is the earliest period that is.**

The anchor is a single date held for the session:

- On cold start the anchor is **today** (the server's today in the owner's timezone, R-auth-5 —
  never the device clock).
- Stepping the period with `‹` / `›` moves the anchor to the **first day of the newly selected
  period**, unless today falls inside it, in which case the anchor is today.
- Zooming does **not** move the anchor. That is what makes zoom lossless.

### 3.2 The table

Every transition, with a worked example. Today is **Mon 31 Aug 2026**; the anchor starts at today.

| From | To | Rule | You are at | You land on |
|---|---|---|---|---|
| Life | Yearly | year containing the anchor | Life | `2026` |
| Life | Quarterly | quarter containing the anchor | Life | `Q3 2026` |
| Life | Monthly | month containing the anchor | Life | `Aug 2026` |
| Life | Weekly | week containing the anchor | Life | `Week of Mon 31 Aug` |
| Yearly | Quarterly | quarter containing the anchor if the anchor is in that year, else **Q1** of it | `2027` | `Q1 2027` |
| Yearly | Monthly | month containing the anchor if in that year, else **January** of it | `2026` | `Aug 2026` |
| Yearly | Weekly | week containing the anchor if in that year, else the **first week whose Monday is in** it | `2027` | `Week of Mon 4 Jan 2027` |
| Quarterly | Monthly | month containing the anchor if in that quarter, else the **first month** of it | `Q4 2026` | `Oct 2026` |
| Quarterly | Weekly | as Monthly, then Monthly→Weekly | `Q3 2026` | `Week of Mon 31 Aug` |
| Monthly | Weekly | week containing the anchor if its Monday is in that month, else the **first week whose Monday is in** it | `Nov 2026` | `Week of Mon 2 Nov` |
| Weekly | Monthly | the month containing that week's **Monday** | `Week of Mon 31 Aug` | `Aug 2026` |
| Monthly | Quarterly | the quarter containing that month | `Aug 2026` | `Q3 2026` |
| Quarterly | Yearly | the year containing that quarter | `Q3 2026` | `2026` |
| Yearly | Life | Life has no period. **The anchor survives untouched.** | `2027` | `Life` |
| Life | *(back down)* | the anchor is still where you left it | `Life` (arrived from `Q1 2027`) | `Q1 2027` |
| any | any (skipping levels) | the same rules, cascaded through the intervening horizons | `Q1 2027` → Weekly | `Week of Mon 4 Jan 2027` |

**A week that straddles a month boundary belongs to its Monday's month.** Stated because otherwise
it is arbitrary, and because the whole product already names a week by its Monday.

### 3.3 The two questions the brief asks, answered

> *If I am looking at Q3 and zoom to Monthly, which month do I land on?*

August — because today is in Q3, so the anchor is inside the destination's parent and the month
containing it wins. Look at Q4 first and you land on **October**, the first month of the quarter,
not on "next month" and not on August. The rule reads the same both times: *the nearest thing to
your anchor that is actually inside where you were looking.*

> *If I zoom from a Monthly lens to Weekly, do I see that month's weeks?*

You land on **one** of that month's weeks and you can step through the rest with `›`. You do not
get a list of the month's weeks, because a lens is a flat list of goals at one horizon in **one**
period — that is the model, and a Weekly lens showing five weeks at once would be a subtree by
another name.

### 3.4 Why this cannot feel arbitrary

Three properties, deliberately:

1. **Zoom is reversible.** `Q3 2026` → Monthly → Quarterly returns to `Q3 2026`, always. Any rule
   where it did not would be a rule where zooming loses your place.
2. **Life is not a reset.** Going up to Life and back down returns you where you were. Life is the
   only lens with no period, and the naive design — "Life clears the period, so coming back means
   today" — would make the one lens with no time dimension silently destroy your position.
3. **You see the destination before you commit.** The Zoom sheet labels every row with the exact
   period the rule computes. The rules above are the *implementation* of that promise; the promise
   itself is that you never have to know them.

### 3.5 The Zoom sheet

Uses the existing `Sheet` component (dismissible, focus-trapped, `aria-labelledby` its `<h2>` —
`docs/work/10-a11y-fixes/build.md` §1). Heading `Change lens`.

```
┌─────────────────────────────────────────┐
│  Change lens                          ✕ │
│  ─────────────────────────────────────  │
│    Life           everything         3  │
│    Yearly         2026               2  │
│  ▸ Quarterly      Q3 2026            4  │  ← accent-ring row, aria-current="true"
│    Monthly        Aug 2026           5  │
│    Weekly         Week of Mon 31 Aug 6  │
│  ─────────────────────────────────────  │
│  Jump to now                            │  ← only when the period is not today's
└─────────────────────────────────────────┘
```

Rows reuse `S.pickerRow` (46px, existing vocabulary). Counts are goals at that horizon in that
period, omitted when zero — the app already omits zero counts. No period picker: the chevrons are
the only period control, and adding a second one is how D-24 happened.

---

## 4. Grouping by Life goal

### 4.1 The header

One line. It reuses `S.sectionLabel` — the 11.5px uppercase `T.mut` style the app already uses for
`FROM THE BACKLOG`, `SUB-GOALS` and `ACTIVITY`. **No new visual idiom, no new token, no card.**

```
▾  BE GENUINELY FIT AT 50 · 3 OPEN
```

- **The whole row is the collapse toggle**, with a `▾` / `▸` glyph and no separate chevron button.
  Expand/collapse per node is existing vocabulary (R-goal-25); this is the same gesture one level
  up. Default expanded. Collapse is session-scoped and per-lens — never persisted, because a
  collapsed group that survives a restart is a hidden goal.
- **When the lens has exactly one group, the header does not render at all.** There is nothing to
  disambiguate, and a header over the only group is pure chrome. This is the anti-clutter rule
  doing real work: a single-Life-goal account never sees a group header anywhere in the product.

### 4.2 The count

Owner's decision 5: the open-task counts survive here. One definition, used everywhere:

> **The count is the number of open tasks under this Life goal that are visible in the weeks the
> selected period covers.** In the Life lens, which has no period, it is the current week.

- Weekly lens → identical to today's pill count (R-nav-7, "open tasks visible in the viewed week").
- Monthly `Aug 2026` → open tasks across every week whose Monday is in August. Genuinely useful:
  *"this line has 7 open tasks this month."*
- Quarterly / Yearly → the same, over the wider span.
- **Zero is never rendered**, header or accessible label. A line with no open work reads
  `BE GENUINELY FIT AT 50` and nothing else.
- Visible label is short (`· 3 open`); the accessible name spells the scope out in full (§7.3), so
  the screen stays quiet and the screen reader stays precise.

### 4.3 Many groups

- **Order is stable and boring**: the order the Life goals hold in the Life lens (their own order in
  the account). Never by count — a list that reorders itself when you tick a checkbox is a list you
  cannot build muscle memory for.
- **No cap, no pagination, no "show more".** Collapse is the pressure valve, and it is one tap on a
  row you were already reading.
- **A group with no items in this period is not rendered.** The Quarterly lens on Q3 shows only the
  lines that have quarterly goals in Q3. It is a lens, not a roster.

### 4.4 Ancestry on an item

A Quarterly goal's Yearly parent is invisible under grouping. **It matters, and one muted line
fixes it — which is still strictly less than today.** Today's Tasks screen prints the *entire* path
on every section (`Be genuinely fit at 50 › Run a sub-2h half marathon › Build an aerobic base`).
This design prints at most one name.

> **Rule: show the item's immediate parent, as one muted line, unless that parent is the group's own
> Life goal.**

- Life lens — no parent, nothing renders.
- Yearly lens — the parent *is* the group's Life goal in the ordinary case, so nothing renders. A
  Yearly goal parented elsewhere is impossible (Life is the only longer horizon).
- Quarterly / Monthly / Weekly — one line: `under Run a sub-2h half marathon in 2026`. Where a
  Monthly goal hangs directly off the Life goal (which the tree permits), the line is suppressed by
  the same rule.
- The line is `T.mut`, 12.5px, and it is a **button**: tapping it opens that parent's goal detail.
  That is free ancestry navigation without a tree — you can always walk *up* one step from where
  you are, you just cannot walk *down* into a subtree, which is the thing that was cluttered.
- Deliberately **not** on the `faint` tier. `faint` fails AA in both themes and is documented as
  such (`docs/work/10-a11y-fixes/build.md` §2); nothing newly load-bearing may land on it.

### 4.5 An item with no Life ancestor

Representable today: `parentId` is optional, so a Yearly, Quarterly or Monthly goal can exist with
no root. It gets the last group in every lens, pinned to the bottom:

```
▾  UNSORTED
   These aren't under a Life goal yet.
```

`UNSORTED` is the vocabulary the product already uses for untagged ideas and learnings, so it
carries no new meaning. Each item in this group gains one extra action, `Put under a Life goal…`,
which opens the existing Move sheet with the Life goals pre-listed. The group is never collapsed by
default and never carries a count. **No rule covers this today** — flagged in §9.

---

## 5. The lens body

Between the shell and the groups there is nothing else. Each lens body is:

```
[group header]
  [item card]
  [item card]
  + <Horizon> goal          ← per-group create, §6.7
[group header]
  …
```

Item cards are the existing `S.card` at 16px radius. A goal card at any horizon carries, in order:

1. pulse dot (`S.dot`, dimmed — R-goal-15)
2. title, 15.5px/700
3. `why`, one line, `T.mut`, when present
4. the parent line (§4.4), when it renders
5. **the planned-ness line** — Monthly lens only (§5.1)
6. `N in backlog` when the goal holds backlog items (R-goal-25's existing row content)

No horizon chip. Every item in a lens is at the same horizon, and the title says which one — a
`QUARTERLY` badge repeated down a quarterly list is the definition of noise. The chip survives on
goal detail, where it is genuinely ambiguous.

### 5.1 Where the work is: **tasks live on weekly goals**

Owner's correction, verbatim: *"no only leaf node can have tasks. that is only weekly goals and not
monthly"*. Weekly is the terminal horizon and it is the **only** horizon that holds tasks — a
Monthly goal with no children still holds none.

Two consequences run through the rest of this document:

**The Weekly lens is perfectly regular.** Every row in it is a Weekly goal; every task sits inside
one. There is no mixed case, no loose task, no "some cards own work and others don't". §6.5's
layout is one shape repeated.

**The Monthly lens needs a signal it would not otherwise need.** If work only ever lives at the
week, a Monthly goal is a container whose entire purpose is the weekly goals beneath it — and a
Monthly lens showing only titles would leave the owner unable to tell a planned month from an empty
one. So a Monthly goal card carries one muted line, in the existing vocabulary of `2 in backlog`:

| Situation | The line reads |
|---|---|
| No weekly goals under it, in any week of the viewed month | `Nothing planned yet` |
| Weekly goals exist; the viewed month does not contain today | `3 weekly goals` |
| Weekly goals exist; today is in this month, and one or more falls in the current week | `3 weekly goals · 1 this week` |
| Weekly goals exist; today is in this month, and none falls in the current week | `3 weekly goals · nothing this week` |

The scope is *weekly goals under this Monthly goal whose week's Monday falls in the viewed month* —
the same "which weeks does this month mean" rule the zoom table uses (§3.2), so one rule answers
both questions.

Three things it is deliberately **not**:

- **Not a progress bar, not a percentage, not a chart.** The product has no reports and gains none
  here (R-nav-14). One line of muted text at `T.mut`, no fill, no colour.
- **Not an escalation.** `nothing this week` is the same muted grey as `3 weekly goals`. The red
  carry chip remains the only escalation in the product (R-task-11), and a month being unplanned is
  a fact, not a failure.
- **Not a link.** Tapping it does not zoom into that monthly goal's weeks, because zooming into one
  line is a filtered subtree and the subtree is the thing being removed (§10). The line is text; the
  card's `+ Task` is the action.

`nothing this week` is also the honest successor to dormancy. `DORMANT — no focus this week`
(R-goal-10) was derived from `weekly_focus`, which CR-4 deletes; the state it described — *this line
has nothing going on right now* — is real and still worth saying, so it is said in plain words at
the one horizon where it is actionable, and it keeps R-goal-10's requirement that it read as
intentional rather than broken.

**Never say "leaves hold tasks" to the user.** Under the new tree a Monthly goal with no children is
structurally a leaf and holds no tasks anyway, so the word would mislead. The user-facing sentence,
everywhere it is needed, is **"Tasks live on weekly goals."**

---

## 6. Screen by screen

Mockups are at phone width in the app's language: cream ground, cards, small-caps section labels,
serif italic for empty-state headlines.

### 6.1 Life lens — `/life`

```
┌─────────────────────────────────────────┐
│                          ☾  + Life goal │
│  ‹          Life  ▾            ›        │   ← both chevrons DISABLED
├─────────────────────────────────────────┤
│  ┌───────────────────────────────────┐  │
│  │ ● Be genuinely fit at 50          │  │
│  │   So I can keep up with my kids   │  │
│  │   3 open · 2 in backlog           │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │ ● Learn to sail                   │  │
│  └───────────────────────────────────┘  │
├─────────────────────────────────────────┤
│        Goals         +        Learnings │
└─────────────────────────────────────────┘
```

The one lens with **no groups** — each Life goal *is* a group of one, so the header would name the
card beneath it. The count and backlog line move onto the card. Both chevrons render disabled
rather than hidden, so the control does not change shape between lenses and the thumb lands in the
same place every time.

Tapping a card opens goal detail. It does **not** zoom into that line: a filtered subtree is the
tree coming back through a side door.

### 6.2 Yearly lens — `/year/2026`

```
┌─────────────────────────────────────────┐
│                        ☾  + Yearly goal │
│  ‹           2026  ▾           ›        │
├─────────────────────────────────────────┤
│  ▾ BE GENUINELY FIT AT 50 · 3 OPEN      │
│  ┌───────────────────────────────────┐  │
│  │ ● Run a sub-2h half marathon      │  │
│  └───────────────────────────────────┘  │
│    + Yearly goal                        │
│                                         │
│  ▾ LEARN TO SAIL                        │
│  ┌───────────────────────────────────┐  │
│  │ ● Get a Day Skipper ticket        │  │
│  └───────────────────────────────────┘  │
│    + Yearly goal                        │
└─────────────────────────────────────────┘
```

No parent lines: a Yearly goal's parent is always the group's own Life goal (§4.4).

### 6.3 Quarterly lens — `/quarter/2026-Q3`

```
┌─────────────────────────────────────────┐
│                     ☾  + Quarterly goal │
│  ‹         Q3 2026  ▾          ›        │
├─────────────────────────────────────────┤
│  ▾ BE GENUINELY FIT AT 50 · 3 OPEN      │
│  ┌───────────────────────────────────┐  │
│  │ ● Build an aerobic base           │  │
│  │   under Run a sub-2h half marathon│  │
│  │   2 in backlog                    │  │
│  └───────────────────────────────────┘  │
│    + Quarterly goal                     │
└─────────────────────────────────────────┘
```

### 6.4 Monthly lens — `/month/2026-08`

The last horizon above the work. Cards carry the planned-ness line (§5.1) and a link row, because
the Monthly lens is where you decide whether a month is actually laid out — and, if it is not, do
something about it without leaving.

```
┌─────────────────────────────────────────┐
│                       ☾  + Monthly goal │
│  ‹         Aug 2026  ▾         ›        │
├─────────────────────────────────────────┤
│  ▾ BE GENUINELY FIT AT 50 · 3 OPEN      │
│  ┌───────────────────────────────────┐  │
│  │ ● Run 4 times a week in August    │  │
│  │   under Build an aerobic base     │  │
│  │   3 weekly goals · 1 this week    │  │  ← the signal, T.mut
│  │  ───────────────────────────────  │  │
│  │  + Task        Pull from backlog  │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │ ● Sleep 7h a night in August      │  │
│  │   Nothing planned yet             │  │  ← empty monthly goal
│  │  ───────────────────────────────  │  │
│  │  + Task        Pull from backlog  │  │
│  └───────────────────────────────────┘  │
│    + Monthly goal                       │
└─────────────────────────────────────────┘
```

The link row is the same one the Weekly lens's cards carry (§6.5), in the same place, with the same
two labels — so `+ Task` means one thing in the whole product regardless of which lens you found it
in. What differs is invisible: from a weekly goal it attaches to that goal; from a monthly goal it
resolves the weekly goal first (§6.7.1).

The **off-now row** matters most here, because the Monthly lens is where forward navigation gets
used:

```
┌─────────────────────────────────────────┐
│                       ☾  + Monthly goal │
│  ‹         Nov 2026  ▾         ›        │
│  Future month — planning ahead    Now › │
├─────────────────────────────────────────┤
│  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┐  │
│  │        Nov 2026 is empty.          │  │  ← serif italic
│  │  Nothing planned this far out yet  │  │
│  │  — that's expected. Set something  │  │
│  │  now, or come back later.          │  │
│  │        [ + Monthly goal ]          │  │
│  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘  │
└─────────────────────────────────────────┘
```

### 6.5 Weekly lens — `/week/2026-08-31`

The densest screen in the product, and now its home. It absorbs the entire Tasks screen (CR-3) and
the entire Plan screen. Weekly goals *are* goals, so there is no planning mode: you add one where
you are looking, exactly as at every other horizon.

Because tasks live only on weekly goals (§5.1), this lens is one shape repeated: **group header →
weekly-goal card → its tasks → its link row**. Nothing else appears in it, at any depth, ever.

```
┌─────────────────────────────────────────┐
│                        ☾  + Weekly goal │
│  ‹   Week of Mon 31 Aug  ▾     ›        │
├─────────────────────────────────────────┤
│  ▾ BE GENUINELY FIT AT 50 · 2 OPEN      │
│  ┌───────────────────────────────────┐  │
│  │ ● Three easy runs and one long run│  │
│  │   under Run 4 times a week in Aug │  │
│  │  ───────────────────────────────  │  │
│  │  ☐ Tuesday easy 6k                │  │
│  │      Done when: 6k at easy pace   │  │
│  │      since Mon 24 Aug             │  │  ← gray, age 1 (R-task-10)
│  │  ☐ Sort out the long-run route    │  │
│  │      ┌───────────────────────┐    │  │
│  │      │ 3 weeks · since 10 Aug│    │  │  ← red chip, age 2+ (R-task-11)
│  │      └───────────────────────┘    │  │
│  │  ☑ Sunday long run 12k            │  │
│  │      Done Sun 30 Aug              │  │
│  │  ───────────────────────────────  │  │
│  │  + Task        Pull from backlog  │  │
│  └───────────────────────────────────┘  │
│    + Weekly goal                        │
│                                         │
│  ▾ LEARN TO SAIL                        │
│  ┌───────────────────────────────────┐  │
│  │ ● Read the collision regs         │  │
│  │  ───────────────────────────────  │  │
│  │  + Task        Pull from backlog  │  │
│  └───────────────────────────────────┘  │
│    + Weekly goal                        │
└─────────────────────────────────────────┘
```

Everything preserved from the Tasks screen, and where it went:

| Tasks screen today | In the Weekly lens |
|---|---|
| week switcher (R-nav-16) | the lens row's chevrons — same control, forward cap removed |
| `Past week — still editable` (R-nav-17) | the off-now row, verbatim |
| `Future week — planning ahead` (R-nav-17) | the off-now row, verbatim |
| goal filter pills + counts (R-nav-7) | **deleted**; counts on the group headers (§4.2) |
| the full breadcrumb path on each section | one parent line (§4.4) |
| the focus sentence, serif italic | **is** the weekly goal's title — the entity is gone (CR-4) |
| `+ Task` under an active leaf (R-task-6) | `+ Task` on the weekly-goal card |
| `Edit plan` → Plan screen | **deleted**; `+ Weekly goal` per group |
| `FROM THE BACKLOG` list inside planning | `Pull from backlog` on the weekly-goal card |
| checkbox complete / uncheck (R-task-14, R-task-19) | unchanged, on the row |
| the inline `Update the done-condition?` prompt (R-task-21) | unchanged, inline under the row |
| carry labels (R-task-10/11) | unchanged |
| the three exits (R-task-15/16/18) | complete on the row; the other two on the task page (§6.6) |

Density decisions, each one an argument against a row:

- **Tasks nest inside their weekly goal's card**, under a hairline. One card per weekly goal, not
  one card per task — a screen of separate task cards at 16px radius is a screen of borders.
- **`+ Task` and `Pull from backlog` share one link row** at the card's foot, `S.linkBtn`, 44px.
  Two affordances, one row. `Pull from backlog` opens a sheet (heading `Pull from the backlog`)
  listing the eligible items from this weekly goal's ancestors, each a `+` row that opens the
  task-create sheet pre-filled — the existing pull, moved out of the dead Plan screen unchanged
  (R-backlog-8: converted, never duplicated).
- **A past week renders no `+ Task`, no `Pull from backlog`, no `+ Weekly goal`** (R-nav-22's
  existing shape). Its tasks stay fully interactive, including the checkbox (R-task-14) — history
  is readable and truthful, and completing something you actually did is not rewriting it.
- **A future week renders no completion checkbox** (R-task-35, unchanged) and no carry label:
  carry age is negative before a task is due, and the red chip is the only escalation in the
  product. It must never fire on work that is not yet late.
- **Dormancy has no meaning *in this lens* any more.** It was derived from "has a weekly focus this
  week"; with Weekly a real horizon, a line either has a weekly goal this week or it does not, and
  that is simply whether it appears here. The `DORMANT — no focus this week` label and its detail
  panel retire with the entity. The state it named is still worth saying — one horizon up, where
  something can be done about it, as `3 weekly goals · nothing this week` (§5.1). Flagged in §9.

### 6.6 The task page — `/task/:taskId`

A full screen, not a sheet (CR-5).

```
┌─────────────────────────────────────────┐
│  ‹ Week of Mon 31 Aug            ☾      │
├─────────────────────────────────────────┤
│  ☐  Tuesday easy 6k                     │
│     Be genuinely fit at 50 ·            │
│     Three easy runs and one long run    │
│     since Mon 24 Aug                    │
│                                         │
│  TITLE                                  │
│  [ Tuesday easy 6k                    ] │
│  DONE-CONDITION                         │
│  [ How will you know it's done?       ] │
│  DESCRIPTION                            │
│  [ Optional notes…                    ] │
│                                         │
│  LINKS                                  │
│   strava.com                        ×   │
│  [ https://…              ] [ Add ]     │
│                                         │
│  [ Move to Backlog ]  [ Cancel task ]   │
│                                         │
│  ACTIVITY                               │
│  ✎  Renamed: "Tuesday easy 5k" →        │
│     "Tuesday easy 6k"        Mon 31 Aug │
│  ＋ Created — weekly planning Mon 31 Aug │
├─────────────────────────────────────────┤
│        Goals         +        Learnings │
└─────────────────────────────────────────┘
```

- **Getting back**: three ways, all equivalent. (1) The `‹ Week of Mon 31 Aug` control top-left,
  which *names where you came from* rather than saying "Back". (2) Android/browser back. (3)
  `Escape`. All three return to the lens at the same period, scrolled to the task's row, with focus
  restored to that row — the same restore contract `Sheet` already honours on close.
- **The checkbox comes to the page.** The walkthrough's own finding: *"a user who opened the detail
  to finish a task has to back out first."* It is exit 1 (R-task-14), given a second home; there
  are still exactly three exits. Completing here returns you to the lens with the toast, because
  the reason you opened the page is now done.
- **Context line under the title**: `<Life goal> · <weekly goal>`, `T.mut`, both segments tappable
  (Life goal → goal detail; weekly goal → the lens, scrolled to it). This is where the ancestry a
  task lost by leaving the tree comes back, in one line.
- **Save**: `Save changes` appears only when the form is dirty, exactly as the sheet does today. On
  a page there is no `unsaved` discard prompt to build — leaving with unsaved edits shows the same
  strip the sheet uses (`Discard your unsaved edits?` / `[Discard] [Keep editing]`), raised by
  `Escape` and by the back control, because a page you can navigate away from is the same hazard as
  a sheet you can dismiss.
- **Exits** unchanged: `Move to Backlog` and `Cancel task`, both lightweight confirm sheets with an
  optional reason and *"No mandatory fields. Fast and guilt-free."* (R-task-15/16/18), both
  withdrawn once the task is done or gone (R-task-17). Both return to the lens on success.
- **Activity** unchanged (R-task-20 through R-task-28), read-only, newest first.
- The page carries the top-right cluster (R-nav-11) — which goal detail today does not, a
  walkthrough nit fixed by construction.

### 6.7 Creation

**Where it lives.** Two entry points per lens, and they answer different questions:

| Entry point | Question it answers | Pre-fills |
|---|---|---|
| Cluster row `+ <Horizon> goal` | "I want to add something to this period" | horizon, period |
| Per-group `+ <Horizon> goal`, at the foot of each group | "I want to add something to *this line* in this period" | horizon, period, **and the parent** |

The per-group one is the good one and it is why grouping earns its keep: in a period-scoped lens,
sitting inside a group, **every field of the create form except the title is already known.**

**What the sheet looks like** (heading names the horizon, so the horizon picker is gone entirely):

```
┌─────────────────────────────────────────┐
│  New Quarterly goal                   ✕ │
│  [ Goal title                         ] │
│  [ Why? (optional)                    ] │
│                                         │
│  Q3 2026   ·  Because you're looking at │
│               Q3 2026.                  │
│                                         │
│  UNDER                                  │
│   ▸ Run a sub-2h half marathon in 2026  │  ← preselected; sole option
│     Be genuinely fit at 50        LIFE  │
│                                         │
│  [           Save goal                ] │
└─────────────────────────────────────────┘
```

- **The period is a read-only chip with its reason next to it.** Not an editable text field (which
  is what the form has today, and which lets you type `Q9 3026`). If you want a different period,
  you navigate there — that is the whole point of the lens.
- **The parent picker lists only legal parents in the enclosing period**: for a Quarterly goal in
  Q3 2026 under the *Be genuinely fit at 50* line, that is that line's Yearly goals for 2026 plus
  the Life goal itself. **When there is exactly one, it is preselected and the picker collapses to
  a single confirming row.** Opened from the cluster row instead, the picker lists every line's
  legal parents, grouped by Life goal like everything else.
- **Weekly** is the same shape: `New Weekly goal`, period chip `Week of Mon 31 Aug`, parent picker
  = the Monthly goals in the month containing that week, plus their ancestors where the tree
  permits (the horizon rule is the spec pass's, not this document's).
- **`+ Task`** on a weekly-goal card opens the existing task-create sheet, pre-filled with the goal
  and the week. Unchanged. From a *monthly* goal card it is a different flow — §6.7.1.
- **Creating a goal into a period you are not looking at is impossible**, so R-nav-19's "moves you
  to the target week" case cannot arise from a lens's goal create. It still applies to the `+`
  drawer's *"Also add to the current week"*, and to `+ Task` from the Monthly lens (§6.7.1).
- **Past periods have no create affordance at all** — no cluster button, no per-group button, no
  empty-state CTA. CR-2: *"History must not be rewritten by planning."* Recommended, not settled:
  open question 1.

**The hardest creation empty state** — the one the walkthrough called the best-written in the app,
given its equivalent here. Opening `+ Quarterly goal` when the account has nothing to hang it on:

```
┌─────────────────────────────────────────┐
│  New Quarterly goal                   ✕ │
│                                         │
│   Nothing to hang this on yet — a       │
│   quarterly goal needs a Life or        │
│   Yearly goal above it.                 │
│                                         │
│  [      Start with a Life goal →      ] │
└─────────────────────────────────────────┘
```

`Start with a Life goal →` zooms to the Life lens **and opens `New Life goal`**, so the loop
closes in one tap. (The walkthrough's flow-9 nit was precisely a handoff that dropped the user's
intent; this one does not.)

### 6.7.1 `+ Task` from a Monthly goal — the two-step, made one

Tasks live on weekly goals (§5.1), so adding a task from the Monthly lens is structurally two
creates: a weekly goal, then a task on it. Made literal, that is the worst flow in the product — a
form to fill in before you are allowed to fill in the form you wanted. It is also exactly the shape
of the walkthrough's flow-9 nit, where *"Set a weekly focus"* sent the user off to a planning screen
and forgot why.

**So the second step is inferred, never asked.** `+ Task` on a Monthly goal card resolves the weekly
goal itself, from the state it can already see:

| Weekly goals under this monthly goal, in the target week | What happens |
|---|---|
| **exactly one** | it is used. No picker, no extra field, no extra tap. |
| **more than one** | the sheet shows a picker, first one preselected. One tap to change, zero to accept. |
| **none** | one is **created implicitly**, and the sheet says so before you save. |

**The target week** is the same clamp the zoom model uses for Monthly → Weekly (§3.2): the week
containing today when the viewed month contains today, otherwise the first week whose Monday falls
in that month. One rule answers *"which week does this month mean"* for both zoom and creation, so
the two can never disagree.

**The implicit weekly goal takes the monthly goal's title.** A weekly goal is this week's version of
the monthly one, so `Run 4 times a week in August` reads correctly as a weekly goal and can be
renamed in one tap. Naming it `This week` would be meaningless in a list grouped by Life goal;
naming it after the task confuses one step with the intent behind it.

**It is stated before it happens and named after it happens.** Nothing may be created invisibly:

```
┌─────────────────────────────────────────┐
│  New task                             ✕ │
│  [ What needs doing?                  ] │
│  [ How will you know it's done?       ] │
│                                         │
│  This starts a weekly goal              │
│  "Run 4 times a week in August" for     │
│  the week of Mon 31 Aug. You can        │
│  rename it after.                       │
│                                         │
│  [           Save task                ] │
└─────────────────────────────────────────┘
```

On save: toast `Added to week of Mon 31 Aug`, and **the app moves to the Weekly lens at that week,
scrolled to the new task**, focus on its row.

**The trade-off, stated.** Moving you costs the Monthly lens you were reading; adding three tasks to
three monthly goals in a row means three trips back. Staying put costs more: the task and its new
weekly goal would be invisible from the screen that created them, which is a lost write as far as
the user can tell, and is precisely the failure R-nav-19 exists to prevent. Visibility wins over
the extra trip, and the extra trip is one tap of `‹`-free navigation — the Zoom sheet's Monthly row
is one tap and lands you back on the same month, because the anchor is preserved (§3.4). Recorded
as open question 7 anyway, since it is the one place this design spends a tap the old flow did not.

**Where a *weekly* goal is what you actually want**, create it from the Weekly lens, where it is the
lens's own primary action. The Monthly lens deliberately offers no `+ Weekly goal`: a second create
button per card, for the horizon below, is how a lens turns back into a tree.

**`Pull from backlog` on a monthly goal card takes the identical path** — item → task → the same
weekly-goal resolution. This retires the *"This branch isn't active this week"* dead end entirely
(walkthrough flow 9): there is no longer a state in which a backlog item cannot become work,
because the thing it needed to hang off is now created for it.

---

## 7. Copy, verbatim

Final text. Sentence case, no exclamation marks, no second person imperative where a statement will
do — the voice the walkthrough described as *"consistent and unusually calm"*.

### 7.1 Chrome

| Surface | Copy |
|---|---|
| Tabs | `Goals` · `+` (aria-label `Add`) · `Learnings` |
| Lens title, Life | `Life` |
| Lens title, Yearly | `2026` |
| Lens title, Quarterly | `Q3 2026` |
| Lens title, Monthly | `Aug 2026` |
| Lens title, Weekly | `Week of Mon 31 Aug` — **plus the year when the Monday is not in the current year**: `Week of Mon 4 Jan 2027` |
| Chevrons | aria-label `Earlier quarter` / `Later quarter` (and `year` / `month` / `week` per lens) |
| Zoom sheet heading | `Change lens` |
| Zoom sheet rows | `Life` / `Yearly` / `Quarterly` / `Monthly` / `Weekly`, each with its destination period; Life's reads `everything` |
| Zoom sheet footer | `Jump to now` |
| Off-now badge, past | `Past year — still editable` · `Past quarter — still editable` · `Past month — still editable` · `Past week — still editable` |
| Off-now badge, future | `Future year — planning ahead` · `Future quarter — planning ahead` · `Future month — planning ahead` · `Future week — planning ahead` |
| Off-now return link | `Now ›` |
| Cluster create buttons | `+ Life goal` · `+ Yearly goal` · `+ Quarterly goal` · `+ Monthly goal` · `+ Weekly goal` |
| Group header | `<LIFE GOAL TITLE>` , uppercase; with count, `<LIFE GOAL TITLE> · 3 OPEN` |
| Unsorted group | `UNSORTED` / `These aren't under a Life goal yet.` |
| Parent line on an item | `under Run a sub-2h half marathon in 2026` |
| Backlog line on an item | `2 in backlog` |
| Planned-ness line, Monthly lens | `Nothing planned yet` · `3 weekly goals` · `3 weekly goals · 1 this week` · `3 weekly goals · nothing this week` |
| Weekly / Monthly card links | `+ Task` · `Pull from backlog` |
| Pull sheet heading | `Pull from the backlog` |
| Implicit weekly goal, in the create sheet | `This starts a weekly goal "Run 4 times a week in August" for the week of Mon 31 Aug. You can rename it after.` |
| The rule, wherever it must be said | `Tasks live on weekly goals.` — never "leaves hold tasks" |
| Task page back control | `‹ Week of Mon 31 Aug` (names the lens and period you came from) |
| Task page context line | `Be genuinely fit at 50 · Three easy runs and one long run` |

### 7.2 Empty states

Serif italic headline, one muted line, at most one button — the shape the walkthrough singled out.

**Life lens**

| Case | Headline | Body | Action |
|---|---|---|---|
| First run | *Nothing planted yet.* | Start with a Life goal — the thing the rest of the cascade hangs off. | `+ Life goal` |

Kept **verbatim** from today. It is the best line in the app and it did not need improving.

**Yearly lens**

| Case | Headline | Body | Action |
|---|---|---|---|
| Current year, empty | *2026 is still open.* | Nothing set for this year yet. Name the few things that would make it count. | `+ Yearly goal` |
| Future year | *2028 is empty.* | Nothing planned this far out yet — that's expected. | `+ Yearly goal` |
| Past year | *Nothing was set for 2025.* | This year went unplanned. History stays as it was. | — |

**Quarterly lens**

| Case | Headline | Body | Action |
|---|---|---|---|
| Current quarter, empty | *Q3 2026 is unclaimed.* | No quarterly goals here yet — nothing is missing, nothing is planned. | `+ Quarterly goal` |
| Future quarter | *Q1 2027 is empty.* | Nothing planned this far out yet — that's expected. Set something now, or come back later. | `+ Quarterly goal` |
| Past quarter | *Nothing was set for Q1 2026.* | This quarter went unplanned. History stays as it was. | — |

**Monthly lens**

| Case | Headline | Body | Action |
|---|---|---|---|
| Current month, empty | *Aug 2026 is unwritten.* | Nothing planned for this month yet. | `+ Monthly goal` |
| Future month | *Nov 2026 is empty.* | Nothing planned this far out yet — that's expected. Set something now, or come back later. | `+ Monthly goal` |
| Past month | *Nothing was set for May 2026.* | This month went unplanned. History stays as it was. | — |

**Weekly lens**

| Case | Headline | Body | Action |
|---|---|---|---|
| Current week, empty | *A new week, still unplanned.* | Pick what this week is for, then hang the tasks off it. | `+ Weekly goal` |
| Future week | *Not planned yet.* | This week hasn't been laid out. You can plan it now, or leave it. | `+ Weekly goal` |
| Past week | *Nothing happened this week.* | No tasks were live in this week. | — |

Headlines for the current and past week are kept **verbatim** from today (R-nav-9). Only the body of
the current-week line changes, because *"Pick which branches are active this week, then write each
focus"* names an entity that no longer exists.

**The future-period line is doing the load-bearing work here.** *"Nothing planned this far out yet
— that's expected"* says, in one clause, both facts a user needs: the screen is empty, and the
emptiness is the truth rather than a failure. Every future variant says it, and no past or present
variant does — the sentence appears exactly where it is needed and nowhere else.

**A lens empty at every period** (the account has Life goals but nothing at this horizon ever):

| Lens | Headline | Body | Action |
|---|---|---|---|
| Yearly | *Nothing yearly yet.* | A Life goal is the direction; a yearly goal is this year's version of it. | `+ Yearly goal` |
| Quarterly | *Nothing quarterly yet.* | A quarter is long enough to change something and short enough to finish. | `+ Quarterly goal` |
| Monthly | *Nothing monthly yet.* | Months are where a quarter turns into something you can actually do. | `+ Monthly goal` |
| Weekly | *Nothing weekly yet.* | Weekly goals are where tasks hang. Pick a monthly goal and give this week something concrete. | `+ Weekly goal` |

Shown instead of the period-specific state when the horizon is empty account-wide, because *"Q3
2026 is unclaimed"* misleads someone who has never used the Quarterly lens at all.

**Group-level and creation empty states**

| Surface | Copy |
|---|---|
| A weekly goal with no tasks | `Nothing on this yet.` + `+ Task` / `Pull from backlog` (the card's own links; no dashed frame inside a card) |
| A **monthly goal** with no weekly goals beneath it | `Nothing planned yet` + `+ Task` / `Pull from backlog` (§5.1) |
| `Pull from the backlog`, nothing eligible | `Nothing in the backlog for this line yet.` / `Items you defer from a week land here.` |
| Create sheet, no legal parent | `Nothing to hang this on yet — a quarterly goal needs a Life or Yearly goal above it.` + `Start with a Life goal →` |

`Nothing planned yet` on a monthly goal is deliberately three words on the card rather than a dashed
empty frame: it sits inside a card that is itself real content, and the two links beneath it are the
answer. It reads as *this month's version of this goal hasn't been written yet* — the same register
as `A new week, still unplanned.` — and never as an error, because it is grey body text with two
ordinary actions under it, not a warning.

### 7.3 Toasts (transient confirmations only — R-nav-13)

| Event | Toast |
|---|---|
| Goal created in the viewed period | `Added to Q3 2026` (period named per lens; Life → `Life goal added`) |
| Task created from a Monthly goal (§6.7.1) | `Added to week of Mon 31 Aug` |
| Goal saved | `Goal updated` |
| Task created | `Task added` |
| Task saved on the task page | `Task updated` |
| Task completed from the task page | `Done` |
| Backlog pull converted | `Added to this week` |
| Move to Backlog | `Moved to Backlog` (`Moved to Backlog — reason noted` when a reason was given) |
| Cancel task | `Task canceled` |
| Item put under a Life goal from `UNSORTED` | `Moved under Be genuinely fit at 50` |

### 7.4 Warnings

There is one, and it is not new: the red carry chip at two weeks (`3 weeks · since 10 Aug`,
R-task-11). No new escalation is introduced anywhere in this design. In particular there is **no**
warning for navigating far into the future, no "this is a long way out" nudge, and no confirmation
on creating into a distant period — owner's decision 7 removed the cap, and a cap re-introduced as
a scary sentence is the same cap.

---

## 8. Accessibility

The floor: every control is a real `<button>` or `<a>`, keyboard-reachable, in DOM order, at a 44px
minimum target. **Zero new colour tokens are introduced** — the group header, the count, the parent
line and the off-now badge all use `T.mut` (4.61:1 on paper, 4.99:1 on card) which
`tests/screens/contrast.test.ts` already enforces. Nothing new lands on `faint`, which fails AA in
both themes and is documented as a known, deliberate hole.

### 8.1 Focus order per screen

**Any lens** (the shell is identical, so the order is learnable across all five):

```
1  theme toggle
2  + <Horizon> goal            (absent on a past period)
3  ‹  Earlier <period>         (disabled on Life)
4  the lens title              → opens the Zoom sheet
5  ›  Later <period>           (disabled on Life)
6  Now ›                       (only when off-now)
7  group 1 header              → collapse toggle
8    item 1 title              → goal detail
9      item 1 parent line      → parent's goal detail  (when it renders)
10   item 2 title …
11   + <Horizon> goal          (that group's create)
12 group 2 header …
…  the tab bar
```

**Monthly lens** — items 8-11 expand, per monthly-goal card. The planned-ness line is text and takes
no stop:

```
8   monthly goal title         → goal detail
9     parent line              → parent's goal detail
      (planned-ness line — not focusable)
10    + Task
11    Pull from backlog
12  + Monthly goal
```

**Weekly lens** — items 8-11 expand, per weekly-goal card:

```
8   weekly goal title          → goal detail
9     parent line              → parent's goal detail
10    task 1 checkbox          → complete / uncheck
11    task 1 title             → /task/:id
12    (uncheck prompt, when open: Done-condition field → Save → Skip)
13    task 2 checkbox …
14    + Task
15    Pull from backlog
16  + Weekly goal
```

The checkbox precedes its title so that "tick it" is always the first stop on a row — the fast path
for a keyboard user is Tab, Space, Tab, Space down the week.

**Task page:**

```
1  ‹ Week of Mon 31 Aug        (back)
2  theme toggle
3  the checkbox
4  Life goal link
5  weekly goal link
6  Title
7  Done-condition
8  Description
9  Save changes                (only when dirty)
10 each existing link, then its × remove
11 Link URL field, then Add
12 Move to Backlog
13 Cancel task
14 (Activity is not focusable — read-only text, R-task-20)
…  the tab bar
```

**Zoom sheet** — inherits `Sheet`'s contract unchanged: focus moves to the `<h2 tabindex="-1">` on
open, `Tab`/`Shift+Tab` cycle inside and wrap, `Escape` and the backdrop close (R-nav-15), and focus
returns to the lens title on close.

```
h2 Change lens → ✕ → Life → Yearly → Quarterly → Monthly → Weekly → Jump to now → (wrap)
```

### 8.2 Announcements

One `aria-live="polite"` status region in the shell, and one rule that keeps it from talking over
itself:

> **A navigation moves focus; the live region carries only what focus will not say.**

- **Lens change** (via the Zoom sheet): the sheet closes, focus lands on the lens title button whose
  accessible name is `Quarterly lens, Q3 2026. Change lens or period.` — that is the announcement.
  The live region then adds only the payload: `4 goals in 2 groups.`
- **Period change** (via a chevron or a swipe): focus stays on the chevron, which does not re-read.
  The live region carries the whole thing: `Q4 2026. 2 goals in 1 group.` For an empty period it
  carries the empty state's headline instead: `Q1 2027 is empty. Nothing planned this far out yet.`
  — so a screen-reader user gets the same reassurance a sighted user gets, in the same words.
- **`Jump to now`**: `Q3 2026, the current quarter. 4 goals in 2 groups.`
- **Group collapse**: the header carries `aria-expanded`; the platform announces the change. Nothing
  goes to the live region.
- **Group header accessible name** spells the count's scope out, which the visible label does not:
  `Be genuinely fit at 50, 3 open tasks in Q3 2026. Collapse group.`
- **Monthly goal card accessible name**: the planned-ness line is text and is not focusable, so it
  is folded into the card's own name — `Run 4 times a week in August, 3 weekly goals, 1 this week.`
  For an empty one: `Sleep 7h a night in August, nothing planned yet.`
- **Task created from a Monthly goal** (§6.7.1): the navigation to the Weekly lens moves focus to
  the new task's row, and the live region carries `Added to week of Mon 31 Aug, under Run 4 times a
  week in August.` — naming the weekly goal that was created for it, because it was created without
  being asked for.
- **Task page arrival**: the route change moves focus to the page's `<h1>` (the task title,
  `tabindex="-1"`, `outline: none` — the precedent `S.sheetTitle` already sets), so the title is
  announced without a live region.

### 8.3 Disabled and absent controls

- On the Life lens both chevrons are **disabled, not hidden** (`aria-disabled` plus the real
  `disabled` attribute, and `Life has no periods` as the accessible description). A control that
  vanishes moves everything after it in the tab order; a control that greys out does not.
- On a past period the create buttons are **absent, not disabled**. The difference is deliberate:
  a disabled create button invites the question "why?" on every past screen, whereas absence plus
  `Past quarter — still editable` says the true thing — the past is readable, and planning does not
  reach back into it.

### 8.4 The gesture, and its keyboard equivalent

**One gesture in the whole design**: a horizontal swipe on the lens body steps the period —
left-to-right = earlier, right-to-left = later, mirroring the chevrons' direction.

- **The chevrons are always present and never hidden.** The swipe is an accelerator, never a route.
- It is **suppressed inside any horizontally scrolling child**, so it cannot fight a scroller.
- It is suppressed on the Life lens, which has no periods.
- **Keyboard equivalent, exhaustively**: `Tab` to `‹` or `›` and press `Enter`/`Space`. In addition,
  and as a convenience only: with focus anywhere in the lens body, `←` and `→` step the period and
  `Shift+↑` / `Shift+↓` change altitude one step (out / in). These shortcuts are documented in the
  Account sheet and are **never the only way to reach anything** — every one of them has a visible
  control one Tab away.
- There is no vertical swipe. Vertical is the scroll axis, and a gesture that competes with
  scrolling on a phone is a gesture that fires when you did not mean it.

---

## 9. Rules, and the flows that have none

Cited where this design keeps an existing rule verbatim or generalises one knowingly:

| Kept / generalised | Rules |
|---|---|
| Top-right cluster on every page | R-nav-11 (now including the task page, which goal detail failed) |
| Toasts transient, never the only record | R-nav-13 |
| No review wizard, no mandatory reasons, no audit view | R-nav-14 |
| Confirm sheets close on overlay tap | R-nav-15 |
| Period badges (`Past … — still editable`, `Future … — planning ahead`) | R-nav-17, generalised from weeks to all four periods |
| Empty-state shape and the current/past week copy | R-nav-9, R-nav-20 |
| Sections and create affordances withdrawn on a past period | R-nav-22 |
| Carry labels, gray at 1 week, red chip at 2+, none in the future | R-task-10, R-task-11, R-task-35 |
| Complete belongs to the viewed period | R-task-14 |
| Exactly three exits, optional reasons, withdrawn once done | R-task-15, R-task-16, R-task-17, R-task-18 |
| Uncheck + skippable done-condition prompt | R-task-19, R-task-21 |
| Activity read-only, newest first | R-task-20 … R-task-28 |
| Backlog pull converts, never duplicates | R-backlog-8 |
| Backlog reached from the drawer / a Life goal | R-nav-2, R-backlog-11 |
| Expand/collapse as existing vocabulary | R-goal-25 (borrowed for group headers) |
| Period defaults derive from the server's today in the owner's zone | R-goal-13, R-auth-5 |
| A new account has no seed goals | R-auth-6 |
| Dot dimming reads as intentional, not broken | R-goal-10, R-goal-15 |
| Theme is a real token set, per user | R-nav-12 |

**Flows this design needs that no rule covers.** For the spec pass:

1. **The zoom model** (§3) — anchor date, clamping, Life preserving the anchor, cold-start reset.
   No rule exists for any of it.
2. **The Life-goal group header, its count's scope, and its collapse** (§4.1, §4.2). R-nav-7 defines
   a per-week pill count; nothing defines a count over a month, quarter or year.
3. **`UNSORTED` — an item with no Life ancestor** (§4.5). The data model permits it; no rule says
   what to render.
4. **Whether a past period accepts new goals** (§6.7). CR-2 says history must not be rewritten by
   planning, but R-nav-5/R-nav-17 say past weeks are "still editable". This design reads the two as
   *existing items stay interactive, new items cannot be created* — a reading, not a rule. Open
   question 1.
5. **Dormancy's retirement, and its successor** (§5.1, §6.5). R-goal-10, R-goal-11 and the `DORMANT`
   copy are all derived from `weekly_focus`, which CR-4 deletes. `3 weekly goals · nothing this
   week` replaces the *signal*; something must formally retire the *rules*.
6. **Tasks live on weekly goals only** — the owner's correction. R-task-1/R-task-3 speak of an
   "active leaf's weekly focus"; both the entity and the leaf-ness derivation are gone, and a
   Monthly goal with no children is now a structural leaf that must still refuse tasks. This needs
   a rule of its own, not an amendment.
7. **The Monthly planned-ness line** (§5.1) — its four states and their scope. Nothing today counts
   goals at one horizon under a goal at another.
8. **Implicit weekly-goal creation from `+ Task` on a Monthly goal** (§6.7.1) — the target-week
   clamp, the inherited title, the announcement, and the navigation to the Weekly lens afterwards.
   This is the most consequential uncovered flow in the document: it creates an entity the user did
   not ask for. R-task-5's create sources will need a fifth.
9. **The task page's checkbox** (§6.6) — a second home for exit 1. R-task-14 says complete is "the
   checkbox" and does not say there is only one.
10. **Unbounded forward navigation.** R-nav-16's `−7 … +4` window and `WEEK_HISTORY_WEEKS` both
    contradict owner's decision 7. The `Now ›` control and the off-now badge are this design's
    answer to losing the cap; the bound itself is the spec pass's.
11. **URL shapes** (§1.6). No rule covers routing, because the app had no router.

---

## 10. What I deliberately did not do

- **No five-way segmented control, and no persistent lens switcher of any kind.** §1.4. This is the
  single biggest thing not built, and the whole design is the argument for not building it.
- **No period picker.** Chevrons only, plus `Jump to now`. A second control over the same dimension
  is how the picker and the chevrons came to disagree by three weeks (D-24); with an unbounded
  forward range a picker cannot even enumerate its options.
- **No filters.** Not goal pills, not horizon filters, not a search box. Grouping replaces them
  (owner's decision 5), and every filter is a piece of state the user has to remember they set.
- **No breadcrumb path anywhere in a lens.** One parent line, at most (§4.4). The full path is the
  tree wearing a different hat.
- **No zoom-into-a-line.** Tapping a Life goal does not filter the lower lenses to that line. That
  is a subtree, and the subtree is the thing being removed.
- **No month grid, no calendar, no timeline view.** A lens is a list.
- **No progress bar, ring, percentage or chart on a Monthly goal.** The planned-ness signal is four
  words of muted text (§5.1). Anything that fills up is a report, and the product has none
  (R-nav-14) — a monthly goal that is "40% planned" is a number nobody asked a question about.
- **No `+ Weekly goal` on a Monthly goal card.** A create button for the horizon below, on every
  card, is a tree growing back one affordance at a time. `+ Task` covers the case that matters and
  infers the weekly goal (§6.7.1); laying out a week deliberately is the Weekly lens's job.
- **No "which weeks does this month have" list on the Monthly lens.** Answered by zooming, which is
  the navigation this whole design is about.
- **No expand-all / collapse-all control.** One more button on every screen to manage a state the
  user set one row at a time.
- **No drag between lenses or periods.** Re-planning already exists as a sheet (R-goal-22/23) and
  works by keyboard; drag would need a keyboard equivalent built from scratch to reach parity.
- **No new colour token, no new type size, no new component.** The Zoom sheet is `Sheet`; group
  headers are `S.sectionLabel`; item cards are `S.card`; the chevrons and title are the week
  switcher's own markup. The 4.5:1 test cannot be threatened by a design that adds no colour.
- **No animation beyond what exists.** A zoom transition would be the obvious flourish. It is also
  the obvious thing to get wrong on a mid-range phone, and `prefers-reduced-motion` would then need
  a whole second design.
- **No desktop layout.** The walkthrough's first criticism — *"a phone app wearing a desktop
  window"* — is real and untouched here. It is a separate piece of work and mixing it into a
  navigation rewrite would make both harder to judge. Recorded, not fixed.
- **No migration design for existing Ideas.** That is data, and it is the PM's call (CR-6, its open
  question 3).

---

## 11. Open questions

1. **Can a goal be created into a past period?** This design says no — the create affordance is
   absent on any past period, and the past empty states carry no CTA — because CR-2 says history
   must not be rewritten by planning. But R-nav-5 has always said past *weeks* are "still editable",
   and a user who forgot to write down last month's goal may reasonably want to.
   `[recommended]` **No creation into a past period.** Existing items there stay fully interactive,
   including completing a task (R-task-14). One rule, no exceptions per horizon.

2. **Which lens does the app open on?** The tab remembers your last lens within a session; across a
   cold start it needs a default.
   `[recommended]` **Weekly.** It is the app's home for daily work now that it has absorbed Tasks,
   and it is the only lens where the answer to "what do I do now" is on screen. The period always
   resets to the one containing today, at every cold start, in every lens — a remembered future
   period would let the app open on a screen that quietly lies about now.

3. **What exactly does the group-header count count?** This design says *open tasks visible in the
   weeks the selected period covers* (§4.2), so the Monthly lens shows a month's worth.
   `[recommended]` **Keep that.** The alternative — always "open right now" — is one number that
   means the same thing everywhere but tells you nothing about the period you are actually looking
   at, which is the only reason you navigated there.

4. **Does the parent line appear on every item, or only where it disambiguates?** This design shows
   it always (except where the parent is the group's Life goal), for predictability.
   `[recommended]` **Always.** A rule that hides the line when every item in a group shares a parent
   is less cluttered and more clever; it also means two visually different cards for the same kind
   of thing, and the saving is one 12.5px line.

5. **Should the Weekly lens's tasks be reachable when their weekly goal's group is collapsed?**
   Collapsing *Be genuinely fit at 50* in the Weekly lens hides that line's tasks entirely.
   `[recommended]` **Yes, hide them — that is what collapse means.** Collapse is session-only and
   per-lens, so nothing stays hidden across a restart, and there is no state to forget you set.

6. **Should `+ Task` on a Monthly goal create a weekly goal implicitly?** It creates an entity the
   user did not ask for, named after something else, in a week they did not name — which is exactly
   the kind of magic this product otherwise avoids.
   `[recommended]` **Yes, and say so before saving.** The alternative is a mandatory create-a-goal
   step in front of the create-a-task step, which is the friction the owner complained about wearing
   a different hat, and it is the flow the walkthrough already found broken (flow 9's dead end). The
   sheet states what will happen, the toast and the announcement name the goal that was made, and it
   is renamable in one tap — so nothing happens silently and nothing is unrecoverable.

7. **After creating a task from the Monthly lens, do you stay or go?** This design moves you to the
   Weekly lens at the target week, scrolled to the new task (§6.7.1).
   `[recommended]` **Go.** Staying leaves the task and its new weekly goal invisible from the screen
   that made them, which reads as a lost write (the reason R-nav-19 exists). The cost is a trip back
   for anyone adding tasks to several monthly goals in a row; the Zoom sheet's Monthly row returns
   you to the same month in one tap, because the anchor is preserved. Worth revisiting if the owner
   finds themselves batching.

8. **Do the keyboard shortcuts (`←`/`→`, `Shift+↑`/`Shift+↓`) ship at all?** They are an
   accelerator on a device that mostly has no keyboard, and every one of them duplicates a visible
   control.
   `[recommended]` **Ship them, document them in the Account sheet.** They cost nothing, the PWA is
   also used in a desktop browser, and the accessibility floor is met by the visible controls
   regardless — so if they are dropped later, nothing regresses.
