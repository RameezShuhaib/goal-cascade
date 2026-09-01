# 29 — UX plan: lens tabs, one create action, and flat lists

Four navigation changes the owner asked for after using the redesigned app daily. Three of them
overturn decisions taken in `docs/work/14-redesign/UX-PLAN.md`, one of them overturns an instruction
the owner gave themselves. Every reversal is named, with the sentence being reversed quoted, in §8.

> *"btw i find it difficult navigating. i dont need to click on a dropdown to change the lense as it
> adds friction. instead can we have a tabs in the top where i dont need double clicking to change
> lense and below that i can change the timestamp as normal. and we dont need `+ Monthly goal`
> everywhere as it looks too clutered. instead we can use what we already have top right to add
> monthly goals where I'll select the lense (defaults to the lense based on my current page) and the
> goal. also lets not categorise based on life in any horizon."*

> *"yes but i mean there should be a ux solution there like probably when i start clicking on a tab
> moving towards right the option start scrolling left."*

**This document is the contract.** The build agent follows it literally. Where it says a thing is
deleted, the file is deleted, not left dormant.

---

## 1. The decision

### A — the lens is a tab strip

**The five horizons become a single horizontal row of tabs directly under the top-right cluster,
`Life  Yearly  Quarterly  Monthly  Weekly`, left to right, one tap to change lens, with the period
chevrons on the line below exactly as they are today.** The strip is a **horizontal scroller with the
selected tab kept in view** — it is 390 px wide against a 360 px window, so it scrolls by 30 px when
it has to and does not scroll at all on a 390 px phone, which is the design working rather than the
design compromising. Labels are never shortened, never truncated, never ellipsised: the strip is as
wide as its five words and the viewport moves, not the words. **The Zoom sheet is deleted in full** —
`ZoomSheet.tsx`, `useZoom`, `openSheet({ kind: 'zoom' })` and the `▾` marker on the title all go, and
the lens title stops being a button and becomes text. Its per-lens counts are deleted with it and its
"which period would I land on" promise is kept better than before: the period row one line below
answers it *after* a free, instantly reversible tap instead of *before* a committing one.

### B — one create action

**The top-right primary action becomes `+ Goal` at every lens, and `+ <Horizon> goal` is deleted from
every group foot, from every card and from the cluster's five-way label.** It opens one sheet,
`New goal`, carrying title, why, a five-chip **HORIZON** selector defaulting to the lens you are on, a
read-only period chip, and **UNDER** — the existing horizon-scoped goal picker, unchanged. **Changing
the horizon re-clamps the period through R-lens-9's anchor rule** (the same function the tabs use, so
the two can never disagree) **and re-scopes the parent picker; a parent that is no longer legal is
cleared, visibly and with a sentence, never silently.** Choosing `Life` hides both the period chip and
`UNDER`, because a Life goal has neither (R-goal-3). If the created goal's horizon is not the lens you
are on, the app moves to that lens at that period — nothing is created and then invisible.

### C — no grouping by Life goal, at any horizon

**Every lens is a flat list. Group headers, per-group creates, per-group `Repeat last week` and the
`UNSORTED` group are all deleted.** Orientation moves onto the card: `R-lens-23`'s parent line stops
naming the *immediate* parent and starts naming **the Life goal**, at every horizon, with no
suppression — so the string the group header carried is still on screen, once per card, where the eye
already is. **Order does not change at all**: the flat list is today's grouped list with the headers
removed — Life line by `createdAt asc`, then item by `createdAt asc`, root-less items last — so cards
from one line stay adjacent and muscle memory survives. **The open-task counts move to the Life
lens's cards, where they already render** (`3 open · 2 in backlog`): one number per line, listed once,
never repeated, one tap away — and they are deleted from every other lens.

### D — card density

**The `why` line leaves every working card and stays only on the Life lens**, which pays, line for
line, for the `under <Life goal>` line item C adds — so a Monthly card is no taller than it is today
and every line on it is either orientation or action. Stays: the pulse dot and title, the `under`
line, `N in backlog` where non-zero, the Monthly planned-ness line, `planned N weeks ago` at two
weeks or more, the nested tasks, and the `+ Task` · `Pull from backlog` row. Goes: `why`, the group
header's title and count, the per-group `+ <Horizon> goal`, the `▾` zoom marker. **Nothing on a card
becomes redundant by the header's removal — the header's content moved onto the card, and the card
had to give a line back to take it.** The `why` is the line that had no reader: it is written once,
never changes, repeats down a list of goals that share a motivation, and is one tap away on the goal's
own page.

---

## 2. A — the lens tab strip

### 2.1 The shell, at 360 px

```
┌────────────────────────────────────────────┐ ← 360 px viewport
│                        ☾   ⌾      + Goal   │  row 1 — cluster (R-nav-25)
├────────────────────────────────────────────┤
│  Life  Yearly  Quarterly  Monthly  Weekly▏ │  row 2 — the tab strip, FULL BLEED
│                          ━━━━━━━━          │        ← 2px accent, under the active tab
├────────────────────────────────────────────┤ ← 1px T.line hairline, full width
│  ‹            Sep 2026              ›      │  row 3 — the period (R-lens-7)
│               Mon 7 Sep – Sun 4 Oct        │        ← second line INSIDE row 3, no control
├────────────────────────────────────────────┤
│  ┌──────────────────────────────────────┐  │
│  │ ● Run 4 times a week in September    │  │
│  │   under Be genuinely fit at 50       │  │
│  │   3 weekly goals · 1 this week       │  │
│  │  ──────────────────────────────────  │  │
│  │  + Task            Pull from backlog │  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │ ● Sleep 7h a night in September      │  │
│  │   under Be genuinely fit at 50       │  │
│  │   Nothing planned yet                │  │
│  │  ──────────────────────────────────  │  │
│  │  + Task            Pull from backlog │  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │ ● Publish four case studies          │  │
│  │   under Be financially independent   │  │
│  │   Nothing planned yet                │  │
│  │  ──────────────────────────────────  │  │
│  │  + Task            Pull from backlog │  │
│  └──────────────────────────────────────┘  │
├────────────────────────────────────────────┤
│        Goals         +        Learnings    │
└────────────────────────────────────────────┘
```

`▏` marks the screen edge cutting through `Weekly`. **The ASCII is schematic; §2.2 is authoritative.**

### 2.2 The width ledger, and why the strip is the right pattern

Manrope 13 px / 700, `letterSpacing: 0`, `padding: '0 14px'`, `minHeight: 44`, no gap between tabs,
no border between tabs.

| Tab | text ≈ | + 28 px padding | cumulative right edge |
|---|---|---|---|
| lead padding | — | 16 | 16 |
| `Life` | 23 | 51 | 67 |
| `Yearly` | 39 | 67 | 134 |
| `Quarterly` | 59 | 87 | 221 |
| `Monthly` | 50 | 78 | 299 |
| `Weekly` | 47 | 75 | 374 |
| trail padding | — | 16 | **390** |

| Viewport | Track | Scroll range | At rest (`Life` selected) |
|---|---|---|---|
| 320 px | 390 | 70 px | `Weekly` shows 21 of 75 px — clearly cut |
| **360 px** | 390 | **30 px** | `Weekly` shows 61 of 75 px — cut near its tail |
| 390 px | 390 | 0 | everything fits; **the strip does not scroll** |
| 640 px (`S.page` max) | 390 | 0 | everything fits, left-aligned, 250 px of empty right |

> **The scroll is a capability, not a feature.** On the owner's phone the strip will probably never
> move, because five words fit. It moves on a 320 px device, it moves if the platform substitutes a
> wider fallback face before Manrope loads, and it will move the day a sixth horizon or a longer word
> exists. That is the whole reason to build a scroller instead of a segmented control: **the layout
> has no failure mode.** A segmented control's failure mode is truncation, and truncating four of
> five labels is what `14-redesign` §1.4 correctly refused.

**The rule that survives all arithmetic, and the one the build must hold:**

> **No lens label may be shortened, abbreviated, truncated, ellipsised, wrapped or scaled down. The
> strip is as wide as its content and the window scrolls over it.** `Quarterly` is never `Qtr`,
> `Quart…` or 11 px type.

### 2.3 The active tab

| | Inactive | Active |
|---|---|---|
| colour | `T.mut` (4.61 : 1 on `paper`, AA pass) | `T.ink` (≈ 15 : 1) |
| weight | **700** | **700** |
| indicator | none | `boxShadow: inset 0 -2px 0 ${T.accent}`, flush to the strip's bottom edge |
| ARIA | `aria-selected="false"` | `aria-selected="true"` |

**The weight does not change between states, and that is deliberate.** 700 → 800 changes the glyph
advances, which changes the tab's width, which changes the track's width, which reflows every tab to
its right on every selection. A navigation control whose siblings shift when you use it is a control
you cannot aim at twice. Three signals carry the state instead — colour, the 2 px rule, and
`aria-selected` — which is one more than the accessibility floor asks for.

**The indicator is the bottom-bar idiom, inverted.** `S.navBtn` already marks the selected bottom tab
with `inset 0 3px 0` at its **top** edge — the edge facing its content. This marks the selected lens
tab at its **bottom** edge, for the same reason. No new token, no new component, no new idea.

The strip carries `borderBottom: 1px solid ${T.line}` across its full bleed. The 2 px accent rule sits
inside the active tab and shares that baseline, so it reads as a thickening of the hairline rather
than a second line.

### 2.4 Full bleed, and why

The strip escapes `S.page`'s 16 px gutter — `marginInline: -16` on the strip, `paddingInline: 16` on
the scroll track inside it. Two consequences, both wanted:

1. **A clipped tab is cut by the screen, not by a box.** Cut at the gutter it reads as a layout bug;
   cut at the edge it reads as *there is more over there*, which is the only affordance the pattern
   needs and the reason it needs no gradient mask and no arrow buttons.
2. **The hairline runs the full width**, so it is the boundary between *which lens* and *the lens* —
   not a decoration floating in a column.

At viewports over 640 px the bleed goes to the edge of `S.page`'s 640 px column, not the window. No
media query, no breakpoint.

### 2.5 Both ends, and the scroll behaviour

`overflow-x: auto`, `scrollPaddingInline: 24`, `scrollbar-width: none`, and one rule added to the
existing `<style>` block in `index.html`: `[data-lens-tabs]::-webkit-scrollbar { display: none }`.

| Situation | Behaviour |
|---|---|
| **`Life` selected** (left end) | `scrollLeft: 0`. `Life`'s leading edge sits 16 px from the screen edge. `Weekly` is clipped on the right. |
| **`Weekly` selected** (right end) | `scrollLeft: max`. `Weekly`'s trailing edge sits 16 px from the screen edge. `scrollPaddingInline: 24` leaves ≥ 24 px of `Monthly` showing on the left, so the left end is never a flush wall. |
| **Anything in between** | `tab.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'instant' })`. `nearest` is doing real work: a tab already fully visible **does not move the strip at all**, so tapping `Yearly` from `Life` scrolls nothing. |
| **Past either end** | Nothing. **The strip does not wrap** — an ordered scale has a first and a last, and a carousel would say Weekly and Life are neighbours. |
| **Under the finger** | Yes, freely, at any time, independently of selection. The strip is an ordinary horizontal scroller. |
| **Overscroll** | `overscrollBehaviorX: 'contain'`, so a horizontal flick at either end cannot chain into the page or the browser's back gesture. |

**Scrolling and `prefers-reduced-motion`.** `behavior: 'instant'` — always, unconditionally, on every
platform and every preference. There is **no animation to reduce**, so there is no
`prefers-reduced-motion` branch, and the product's "no animation anywhere" line is not crossed. The
strip's position changes in the same frame as the selection, exactly as R-lens-30 makes the period
label change in the same frame as the input. Momentum from the user's own finger is the browser's
scrolling, not ours, and is the same scrolling the page already does vertically.

**No `scroll-snap`.** Snap points settle with an animation and fight a deliberate drag. Refused.

### 2.6 Mid-scroll and end states, at 360 px

**At rest, `Life` selected — `scrollLeft: 0`:**

```
│  Life  Yearly  Quarterly  Monthly  Weekly▏         Weekly cut at 61/75 px
│  ━━━━                                              track 390, window 360
```

**`Quarterly` selected — the strip has not moved, because `Quarterly` was already fully visible:**

```
│  Life  Yearly  Quarterly  Monthly  Weekly▏         scrollLeft still 0
│                ━━━━━━━━━
```

**`Weekly` selected — `scrollLeft: 30`, the maximum. This is the state the owner described:**

```
│▕fe  Yearly  Quarterly  Monthly  Weekly             `Life` clipped on the left
│                                ━━━━━━              `Weekly` 16 px from the right edge
```

**The same three states at 320 px, where the pattern earns its keep:**

```
│  Life  Yearly  Quarterly  Monthly  W▏              at rest, scrollLeft 0
│▕arterly  Monthly  Weekly                           `Weekly` selected, scrollLeft 70 (max)
```

**At 390 px and above there is one state**, because the track fits:

```
│  Life  Yearly  Quarterly  Monthly  Weekly          no scroll, ever
│                                    ━━━━━━
```

### 2.7 Does the strip survive scrolling the page?

**No. Neither the tab strip nor the period row is sticky; both scroll away with the page.**

- The product has **no sticky chrome** anywhere except the bottom tab bar, which is a platform
  convention rather than a decision this design gets to make twice.
- A sticky strip is worse than an unconditional row: it is an unconditional row that is also
  *permanent*. R-nav-27 budgets rows above the first item; 44 px held forever on a ~700 px phone
  viewport is a different and larger cost, and it lands hardest on the Weekly lens, which is the one
  screen in the product that is genuinely long.
- Sticking the strip **without** the period row would let you change lens but not period from the same
  place, which splits one header into two behaviours depending on scroll position.

**Recorded as open question 1 with `[recommended] not sticky`**, because it is the one call here that
only daily use can settle. If the owner overturns it, the correct form is: **both rows stick
together, as one 92 px block, or neither does.**

### 2.8 The Zoom sheet's fate: **deleted, in full**

Two navigation systems for one job is the clutter being complained about. The sheet does not fold, it
goes.

**Deleted:** `apps/web/src/lens/ZoomSheet.tsx`; the `{ kind: 'zoom' }` sheet in `UIContext` /
`Sheets`; `useZoom` and the `['zoom', anchor]` query key; `onZoom` on `LensRow`; the `▾`
`lens-zoom-marker` SVG; the title's `<button>` wrapper and its `aria-label`; the sheet's `Jump to now`
footer. `GET /goals/zoom` loses its only client caller — **flag for the server: the endpoint and
`GoalService.zoom` are now dead and should be removed, not left serving nobody.**

**What the sheet carried, and where each part went:**

| The sheet carried | Where it is now |
|---|---|
| Change lens | The tab strip, at **zero** taps of overhead instead of two. |
| The exact period each lens would land on, **before** you commit | The period row, 44 px below the tab you just pressed, rendered in the **same frame** (R-lens-30) — after a tap that is free and one tap reversible. A preview is only worth its own surface when the commit is expensive; tabs make the commit free, which deletes the preview's whole justification. |
| A goal count per lens | **Deleted.** Five ambient numbers in a permanent strip is a report (R-nav-26), it is width the strip does not have, and the destination itself answers the question better than a number can now that reaching it costs one tap. |
| `Jump to now`, when off-now | Already duplicated by the off-now row's `Now ›` (R-lens-21), which renders in exactly the same condition. Nothing is lost; a duplicate is removed. |
| `aria-current` on the current lens | `aria-selected` on the current tab, which is stronger: it is on screen continuously rather than only inside a sheet. |

**The zoom *model* is untouched.** R-lens-9's clamp, R-lens-18's derived anchor, `zoomTo`, the
Life-is-not-a-reset property and the reversibility guarantee all stand and are all still exercised —
by the tabs, by `Shift+↑`/`Shift+↓`, and by item B's horizon selector. Only the sheet that displayed
them is gone.

### 2.9 The period row, after the title stops being a button

```
│  ‹            Sep 2026              ›      │
│               Mon 7 Sep – Sun 4 Oct        │
```

- The title is a `<div>`, not a `<button>`. No `▾`, no `aria-label`, no tab stop, no hover, no press
  state. It is 21 px / 800 `T.ink`, `nowrap`, ellipsising, exactly as today.
- The range line is unchanged: second line, 12.5 px `T.mut`, `aria-hidden`, Yearly/Quarterly/Monthly
  only (R-lens-28).
- The chevrons are unchanged: 40 px targets, `aria-label` `Earlier month` / `Later month` per unit,
  **disabled and visible on Life** (R-lens-17), forward-content dot on `›` (R-lens-26).
- On Life the title reads `Life` and there is no range line.

**This is what pays for part of the tab row.** Row 3 loses its only non-chevron control and one tab
stop; the shell's focus order gets shorter, not longer, despite gaining five tabs — see §7.1.

### 2.10 The chrome budget, spent precisely

R-nav-27 today: *"at most two unconditional rows… the top-right cluster and the lens row."*

**This design spends a third row, and here is the ledger, at 360 px, on the owner's own account
(which the screenshot shows has at least two Life lines):**

| Rows above the first card | Today | This design |
|---|---|---|
| cluster row | 1 | 1 |
| **lens tab strip** | — | **+1** |
| period row | 1 | 1 |
| group header (`BE FINANCIALLY INDEPENDENT · 3 OPEN`) | 1 | **−1** |
| **total** | **3** | **3** |

**Also removed, below the first card but inside the list:**

- **one `+ <Horizon> goal` link row per group**, repeated down the page — the owner's literal
  complaint (*"we dont need `+ Monthly goal` everywhere"*). On a three-line account that is three rows
  gone from the Monthly lens.
- **the `why` line on every card at four of five horizons** (§5).
- **a whole navigation surface**, the Zoom sheet, and the tab stop and control that opened it.

**The honest exception:** an account with exactly **one** Life line renders no group header today
(R-lens-19 suppresses it), so that account goes from **two** rows to **three**. I am spending that
row knowingly. It buys the removal of a two-tap modal from the single most frequent navigation act in
the product, and it is the row the owner asked for by name.

**R-nav-27 is rewritten, not quietly broken** (§9). Its replacement keeps its teeth: three
unconditional rows, an itemised list of what they are, and *a fourth is refused, not deferred*.

### 2.11 The gesture, and the strip

- The strip is marked **`data-h-scroll` and `data-no-swipe`** (the first is the marker
  `LensScreen.tsx` checks today; the second is the marker `22-ux-fixes` §6.3 generalises it to). Both
  attributes ship, so the period swipe can never fire from inside the strip under either code path.
- The horizontal period swipe on the **body** is unchanged.
- `22-ux-fixes` §6's unbuilt **vertical swipe on the lens row = zoom** survives this design and gets
  *better*: §6.8 named the Zoom sheet as its always-present non-gesture equal, and that sheet no
  longer exists. **Its non-gesture equal is now the tab strip** — visible, permanent, one tap, no
  modal. When R-lens-25 is amended for that gesture it must cite the strip, not the sheet.
- One metaphor note, stated so nobody "fixes" it later: **horizontal inside the strip is altitude;
  horizontal on the body is time.** That is still one control per dimension — the two are separated by
  region, not by axis, and `data-no-swipe` makes the separation a mechanism rather than a convention.

### 2.12 Where the strip lives in the component tree

> **The strip is mounted in the shell that wraps all five lens routes, not inside `LensScreen`.**

Not a refactoring preference — two behaviours depend on it:

1. **Focus survives the lens change.** Activating a tab is a route change. If the strip is inside the
   per-lens component, React unmounts and remounts it, focus is dropped to `<body>`, and a keyboard
   user is thrown to the top of the document every time they change lens. Mounted once, the tab
   element persists and keeps focus.
2. **`scrollLeft` survives the lens change**, so the strip does not jump back to 0 and re-scroll on
   every selection.

`LensScreen` keeps rows 1 and 3 and the body; the shell owns row 2 and knows only which of the five
routes is active.

---

## 3. B — one create action

### 3.1 What is deleted

| Deleted | Where |
|---|---|
| `+ <Horizon> goal` at each group foot | `LensScreen.tsx` `CreateLink` — dies with grouping (§4) |
| The five-way cluster label `+ Life goal … + Weekly goal` | `copy.ts` `createLabel` |
| `New <Horizon> goal` as a sheet heading | `GoalModals.tsx` |
| `Nothing to hang this on yet — …` + `Start with a Life goal →` **as a whole-sheet takeover** | see §3.6 |

**Kept:** the empty-state CTA button inside an empty lens (one button on an otherwise empty screen is
not clutter), relabelled `+ Goal`; and `+ Sub-goal` on a goal's own detail page (R-goal-48), which is
a different question — *what hangs off this one* — asked where its answer is already known.

### 3.2 The cluster row

```
│                        ☾   ⌾      + Goal   │
```

`+ Goal`, `S.topBtn`, the same string at every lens, absent (not disabled) on a past period
(R-goal-36, unchanged). It is not `+ Monthly goal`, because the button no longer commits to Monthly —
it *defaults* to it, and a label that names a default as if it were a destination is a label that
lies. It is also 46 px instead of 96 px, which is width the cluster row did not have.

### 3.3 The sheet — the common case, 360 px

Horizon defaults to the lens; one legal parent exists, so it is preselected and the picker is one
confirming row (existing behaviour, unchanged).

```
┌────────────────────────────────────────────┐
│  New goal                               ✕  │
│  ┌──────────────────────────────────────┐  │
│  │ Goal title                           │  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │ Why? (optional)                      │  │
│  └──────────────────────────────────────┘  │
│                                            │
│  HORIZON                                   │
│  ( Life )( Yearly )( Quarterly )           │
│  ( Monthly )( Weekly )                     │  ← wraps; Monthly filled
│                                            │
│  [ Sep 2026 ]  Because you're looking at   │
│                Sep 2026.                   │
│                                            │
│  UNDER                                     │
│  ┌──────────────────────────────────────┐  │
│  │ ▸ Build an aerobic base              │  │  ← preselected, sole option
│  │   Be genuinely fit at 50 · Q3 2026   │  │
│  └──────────────────────────────────────┘  │
│                                            │
│  [             Save goal              ]    │
└────────────────────────────────────────────┘
```

### 3.4 The horizon selector

- **Five `S.chipBtn` chips**, `flexWrap: 'wrap'`, in horizon order. This is the app's existing
  field-value idiom — literally the control `GoalFormSheet` already renders for `PULSES` — so no new
  component and no new token. Inside a sheet there is no chrome budget and vertical space is cheap, so
  wrapping to two lines at 360 px is correct and needs no scroller.
- **A chip is not a tab, and the difference is deliberate**: *a tab is where you are; a chip is what
  you chose.* Rendering the sheet's horizon selector as a second tab strip would say the sheet
  navigates, which it does not.
- **Default: the current lens.** On the Life lens, `Life`. Exactly the owner's ask.
- On **edit** (`editId != null`) the selector does not render at all: a goal's horizon is immutable
  (re-parenting is Move, re-scheduling is Re-plan). The sheet's heading stays `Edit goal`.

### 3.5 How horizon and parent relate — the whole rule

Changing the horizon from `H` to `H′` does exactly four things, in this order:

1. **The period chip re-clamps.** The new period is `zoomTo(H′, anchor, today)` — **R-lens-9's clamp,
   the same function the tab strip calls.** One rule answers "which period does this horizon mean" for
   navigation and for creation, so the two can never disagree. `Monthly / Sep 2026` → `Quarterly` gives
   `Q3 2026`; → `Weekly` gives the week whose Monday is in September nearest the anchor. The period is
   **never** typed and **never** picked.
2. **The parent picker re-scopes** to `{ kind: 'parent', horizon: H′, periodKey: <the new period> }`.
   This is the parallel agent's horizon-scoped picker, called with a different mode. **Nothing about
   the picker changes.**
3. **The chosen parent is kept if and only if it is still legal at `H′`** — that is, its horizon is
   strictly longer than `H′` (R-goal-5 / R-goal-32). Otherwise it is **cleared**, the picker returns to
   its unselected state, and a muted line says so under `UNDER`. Nothing changes underneath in silence.
4. **`Save goal` re-evaluates**: disabled while the title is empty, or while `H′ ≠ Life` and no parent
   is chosen.

**Choosing `Life` is the one branch:** the period chip and its sentence do not render, `UNDER` does not
render, and `parentId`/`periodKey` are omitted from the request (R-goal-3).

**An invariant worth stating, because it removes a whole class of error:** the clamp can never produce
a **past** period from a lens that is not itself past. The anchor is `today` when the period on screen
contains today, and the period's first day otherwise (`LensScreen`'s derivation), so mapping it to any
other horizon lands on a period containing that same date. The create button is already absent on a
past period (R-goal-36), so `PERIOD_IN_PAST` is unreachable from this sheet by construction rather
than by a guard.

**A hard requirement on the picker, so a period filter cannot break this:** *Life goals are always
offered in `parent` mode, at every horizon, regardless of the enclosing period.* A Life goal has no
`periodKey` (R-goal-3); a scoping filter that compares `periodKey` must not drop rows that have none.
This is what makes §3.6 unreachable.

### 3.6 The no-legal-parent state

> **It is unreachable, and it must be built anyway, inline, with a test asserting it never renders.**

Unreachable because a Life goal is a legal parent at **every** other horizon (R-goal-32 permits level
skipping all the way to Life), so the moment any Life goal exists, every horizon has at least one
option. And if no Life goal exists, the sheet opens on the Life lens with horizon `Life`, which has no
`UNDER` at all.

What changes: the whole-sheet takeover is **wrong** now, because with a horizon selector on screen the
user's escape is to pick a different horizon rather than to leave. So it becomes an inline state
inside `UNDER`, with `Save goal` disabled:

```
│  UNDER                                     │
│  Nothing to hang a Quarterly goal on yet — │
│  it needs a Life or Yearly goal above it.  │
│  [  Start with a Life goal →  ]            │
```

### 3.7 The other states, at 360 px

**Horizon changed away from the lens — the period re-clamped, the parent cleared:**

```
│  HORIZON                                   │
│  ( Life )( Yearly )( Quarterly )           │  ← Quarterly filled
│  ( Monthly )( Weekly )                     │
│                                            │
│  [ Q3 2026 ]   Closest to Sep 2026, the    │
│                month on screen.            │
│                                            │
│  UNDER                                     │
│  Cleared — a Quarterly goal can't sit      │  ← T.mut, aria-live="polite"
│  under a Monthly one.                      │
│  ┌──────────────────────────────────────┐  │
│  │   Run a sub-2h half marathon in 2026 │  │
│  │   Be genuinely fit at 50 · 2026      │  │
│  ├──────────────────────────────────────┤  │
│  │   Set up my AI consultancy           │  │
│  │   Be financially independent · 2026  │  │
│  └──────────────────────────────────────┘  │
```

**More than 8 legal parents — the picker becomes a field (R-nav-31, unchanged):**

```
│  UNDER                                     │
│  ┌──────────────────────────────────────┐  │
│  │ Build an aerobic base                │  │
│  │ Be genuinely fit at 50 · Q3 2026   › │  │
│  └──────────────────────────────────────┘  │
```

**…and taking over the sheet, unchanged, with `from` set to the new heading:**

```
│  ‹ New goal                             ✕  │
│  ┌──────────────────────────────────────┐  │
│  │ Search goals                         │  │
│  └──────────────────────────────────────┘  │
│  …                                         │
```

**Horizon `Life`:**

```
│  New goal                               ✕  │
│  [ Goal title                          ]   │
│  [ Why? (optional)                     ]   │
│                                            │
│  HORIZON                                   │
│  ( Life )( Yearly )( Quarterly )           │  ← Life filled
│  ( Monthly )( Weekly )                     │
│                                            │
│  [             Save goal              ]    │  ← no period chip, no UNDER
```

### 3.8 After the save

- Toast, unchanged: `Added to Q3 2026`; `Life goal added` for a Life goal.
- **If the created goal's horizon is not the lens on screen, the app navigates to that lens at that
  period.** This is R-nav-19's principle, which the old design made unreachable by making the horizon
  unchangeable: *nothing may be created into a period and then vanish from the screen that created
  it.* Creating a Quarterly goal from the Monthly lens and staying put would be a lost write as far as
  the eye can tell.
- If the horizon equals the lens — the default, and the overwhelming case — nothing moves, exactly as
  today.
- The navigation fires the lens's existing announcement (§7.3). No new live-region machinery.

---

## 4. C — flat lists at every horizon

### 4.1 What is deleted

`Group`, `CollapsibleHeader`'s group caller, `showHeader`, the `rendered` partition, `LifeGroupView`'s
use as a *rendering* unit, `UNSORTED_NOTE`, `CreateLink`, the per-group `RepeatLastWeek`, and every
`ui.collapsed` key of the form `<lens>|<groupId>`. `CollapsibleHeader` itself **survives** — the
carried band still uses it (R-lens-12), and so does its `Weekly|__carried|<week>` collapse key.

`LifeGroupView` stays **on the wire**: the Life lens's cards read `openTasks` from it (§4.4), and the
goal picker groups by it (R-nav-31). It stops being a lens-body layout primitive.

### 4.2 Orientation — the `under` line changes what it names

R-lens-23 today: *the **immediate** parent, unless that parent is the group's own Life goal, in which
case nothing renders.* Both halves break without groups. The suppression has no referent, and a flat
Yearly list would carry **no ancestry at all**, because a Yearly goal's parent is always a Life goal
and is therefore always suppressed today.

> **Replacement rule: every item in every lens except Life renders one muted line naming the Life goal
> its chain reaches. No suppression, no exception, at every horizon.**

```
│  │ ● Build an aerobic base              │
│  │   under Be genuinely fit at 50       │
```

Same shape as today — 12.5 px `T.mut`, `nowrap`, tail-ellipsised, a `<button>` opening that goal's
page. Only the string changes.

**Why the Life goal and not the immediate parent**, stated because it is the trade this item makes:

- It is **exactly the string the group header carried**, so nothing leaves the screen — it moves from
  above a cluster of cards to inside each of them.
- It is **one rule at five horizons**. The immediate parent is a Yearly goal on the Quarterly lens, a
  Quarterly goal on the Monthly lens, a Monthly goal on the Weekly lens, and a Life goal on the Yearly
  lens — four different kinds of fact wearing one word.
- Life-line titles are **short, few and memorised** — five or six strings the owner wrote. They are
  recognised at a glance. Intermediate titles (`Run a sub-2h half marathon in 2026`) are long and
  varied and read as noise when repeated down a list.
- **Ancestry is not lost, it is relocated**: the goal's own page carries the full crumb trail with its
  overflow sheet (`22-ux-fixes` §4, already built). The card is for scanning; the page is for
  ancestry.
- The **Yearly lens gains** the line it does not have today. The Life lens has none, correctly — a
  Life goal is the root.

**Cost, stated:** on the Weekly lens you lose `under Run 4 times a week in August` — the month a week
belongs to. It is one tap away on the weekly goal's page. This is the one thing this design takes and
does not give back, and it is recorded as open question 2.

**The root-less item** (R-lens-20's `UNSORTED`, which no longer has a group to live in):

```
│  │ ● Ship the pricing page              │
│  │   Not under a Life goal yet          │  ← same muted line, opens the Move sheet
```

The line is a button opening the existing Move sheet in `only: 'life'` mode — **which finally gives
that mode the caller `25-goal-picker` records it has never had.** Such items sort last (§4.3),
preserving `UNSORTED`-last without a header.

### 4.3 Order — nothing changes except the headers

> **The flat list is today's grouped list with the headers deleted.**

`items` is ordered by: the item's Life root's `createdAt asc` then `id asc`; then the item's own
`createdAt asc` then `id asc`; with **root-less items last**. That is character for character the
reading order of today's screen, so:

- cards from one line stay **adjacent**, and the repeated `under <Life goal>` line reads as a label on
  a run rather than as noise on every card;
- **muscle memory survives the change** — the same goal is in the same place before and after;
- there is no new sort to specify, test or explain.

**Refused:** order by pulse (a list that reorders when you change a dot is unlearnable); by open count
(same, worse); alphabetical (meaningless across lines); most-recent-first (the plan is not a feed); no
order guarantee at all (the server already has a total order and must keep it).

**Server:** `LensResponse.items` must be returned in that total order. Today R-lens-5 specifies order
*within* a group and the client re-partitions; the client stops partitioning, so the flat order is now
load-bearing on the wire.

### 4.4 The open-task counts

They lived on the group header — `BE GENUINELY FIT AT 50 · 3 OPEN`, R-lens-4, *open tasks under that
Life goal visible in the anchoring week*. The owner previously asked to keep them.

> **They move to the Life lens's cards, where they already render, and are deleted everywhere else.**

```
┌────────────────────────────────────────────┐
│  Life  Yearly  Quarterly  Monthly  Weekly▏ │
│  ━━━━                                      │
│  ‹              Life                 ›     │  ← both chevrons disabled
├────────────────────────────────────────────┤
│  ┌──────────────────────────────────────┐  │
│  │ ● Be genuinely fit at 50             │  │
│  │   So I can keep up with my kids      │  │
│  │   3 open · 2 in backlog              │  │  ← the count, unchanged
│  │   2 tasks carrying · oldest 3 weeks  │  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │ ● Be financially independent         │  │
│  │   1 open                             │  │
│  └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

Why this is the right home rather than a compromise:

- **The count is a fact about a line, not about a goal.** On a flat Monthly list, three cards from one
  line would each print the same number three times. On the Life lens each line appears exactly once.
- **It already renders there.** `LifeCard` prints `3 open · 2 in backlog` today. Zero new surface, zero
  new number, zero new wire field.
- **It is one tap away** from anywhere, and R-lens-4's scope is already *the current week* everywhere
  except the Weekly lens — so the number on a Life card is the number the header showed on four of the
  five lenses.
- The Life lens becomes what it should be: **the roster.** The other four are working lists.

R-lens-4 is rewritten (§9); R-nav-26's list of permitted numbers keeps this one and loses R-lens-22's.

### 4.5 `Repeat last week` loses its home

R-goal-46 places it *"at the group foot in the Weekly lens, and nowhere else"*. There is no group foot.

> **It becomes one link at the foot of the Weekly lens's list, once, copying the previous week's
> Weekly goals across every line.**

```
│  └──────────────────────────────────────┘  │
│                                            │
│  Repeat last week                          │  ← once, at the list foot
```

Copy, toasts and semantics are otherwise R-goal-46 verbatim: ordinary new goals, `pulse` reset, no
tasks copied, nothing linking a copy to its source, offered only on the current week or later, a no-op
with a toast when last week held nothing. Toast: `Repeated 5 from last week` / `Last week held
nothing`, unchanged.

**Server change required:** `repeatWeek`'s `lifeGoalId` becomes optional; absent means every line.
Recorded as open question 3 with `[recommended] whole week`, since per-line copying was Q-22's
explicit shape and this widens it.

### 4.6 The flat Weekly lens, 360 px

The densest screen, flat, with the carried band unchanged below it.

```
┌────────────────────────────────────────────┐
│                        ☾   ⌾      + Goal   │
│  Life  Yearly  Quarterly  Monthly  Weekly  │
│                                    ━━━━━━  │
│  ‹        Week of Mon 31 Aug         ›     │
├────────────────────────────────────────────┤
│  ┌──────────────────────────────────────┐  │
│  │ ● Three easy runs and one long run   │  │
│  │   under Be genuinely fit at 50       │  │
│  │  ──────────────────────────────────  │  │
│  │  ☐ Tuesday easy 6k                   │  │
│  │      since Mon 24 Aug                │  │
│  │  ☐ Sort out the long-run route       │  │
│  │      ┌────────────────────────┐      │  │
│  │      │ 3 weeks · since 10 Aug │      │  │
│  │      └────────────────────────┘      │  │
│  │  ☑ Sunday long run 12k               │  │
│  │  ──────────────────────────────────  │  │
│  │  + Task            Pull from backlog │  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │ ● Read the collision regs            │  │
│  │   under Learn to sail                │  │
│  │  ──────────────────────────────────  │  │
│  │  Nothing on this yet.                │  │
│  │  ──────────────────────────────────  │  │
│  │  + Task            Pull from backlog │  │
│  └──────────────────────────────────────┘  │
│                                            │
│  Repeat last week                          │
│  ──────────────────────────────────────    │
│  ▾ Carried                                 │  ← the band survives, unchanged
│  ┌──────────────────────────────────────┐  │
│  │ ● Draft the retainer proposal        │  │
│  │   from week of 17 Aug                │  │
│  │   under Be financially independent   │  │
│  │  ☐ Send it to Priya                  │  │
│  └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

**The carried band keeps its header and its collapse.** It is not a Life-goal group — it is a
different *kind* of content in the same lens (goals from earlier weeks that still hold open work), and
R-lens-12's whole point is that the two are never mixed. Deleting its header would merge them.

### 4.7 Empty states

Unchanged, every string, at every horizon — R-lens-6 / R-lens-24 / `copy.ts`. Only the CTA's label
changes, from `+ <Horizon> goal` to `+ Goal`. The horizon-level states (`Nothing quarterly yet.`) are
untouched and are now, if anything, more useful: with tabs, the lens you are told is empty is one tap
from the lens that is not.

---

## 5. D — card density

### 5.1 The table, per horizon

| Line | Life | Yearly | Quarterly | Monthly | Weekly | Carried |
|---|---|---|---|---|---|---|
| pulse dot + title | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `why` | ✓ **clamped to one line** | — | — | — | — | — |
| `from week of …` | — | — | — | — | — | ✓ |
| `under <Life goal>` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `N open · N in backlog` | ✓ | — | — | — | — | — |
| `N tasks carrying · oldest N weeks` | ✓ | — | — | — | — | — |
| `N in backlog` | — | ✓ | ✓ | ✓ | — | — |
| planned-ness (R-goal-47) | — | — | — | ✓ | — | — |
| `planned N weeks ago` (≥ 2) | — | — | — | — | ✓ | — |
| nested tasks | — | — | — | — | ✓ | ✓ |
| `+ Task` · `Pull from backlog` | — | — | — | ✓ | ✓ | — |

### 5.2 What goes, and why each one

- **`why`, from all four working lenses.** The single biggest cut and the one that funds §4.2. It is
  written once and never changes; it is a property of the *line*, so it repeats down a run of cards
  from that line; it is unbounded free text that wraps a two-line card into four; and it is one tap
  away on the goal's page. It is the only line on a card that answers no question you have while
  working.
- **On the Life lens `why` stays, and gains a one-line clamp.** There are five or six Life goals, they
  have no ancestry line to compete with, and *why* is the entire reason a Life goal exists. The clamp
  is `nowrap` + tail ellipsis, matching the crumb rule `22-ux-fixes` §4.5 already applies elsewhere.
- **The group header's title** → the `under` line (§4.2).
- **The group header's count** → the Life lens (§4.4).
- **The per-group `+ <Horizon> goal`** → the one create action (§3).
- **The `▾` zoom marker and the title's button wrapper** → the tab strip (§2.9).

### 5.3 What stays, and why each one

- **The planned-ness line** (`3 weekly goals · 1 this week`, `Nothing planned yet`). Four words of
  `T.mut`, R-goal-47, and it is the Monthly lens's only signal of whether a month is laid out. Nothing
  replaces it.
- **`N in backlog`.** Conditional — zero is never rendered — and it renders exactly on the horizons
  that can hold backlog (Yearly, Quarterly, Monthly). It is one of R-nav-26's four permitted numbers.
- **`planned N weeks ago`.** Conditional and rare (≥ 2 weeks, arrived weeks only).
- **`+ Task` · `Pull from backlog`.** One row, two affordances, and A8 makes `+ Task` on a Monthly
  goal a first-class create (R-task-57). Two link buttons sharing a row is not clutter; two link
  buttons on separate rows would be.
- **The pulse dot, the nested tasks, the carried band's card shape.** Untouched.

### 5.4 The arithmetic

A Monthly card, worst case, today: title, `why`, `under`, planned-ness, `N in backlog`, link row =
**5 lines + a row**. Under this design: title, `under`, planned-ness, `N in backlog`, link row =
**4 lines + a row** — and the group header above the run is gone.

**Net effect on the owner's Monthly screen** (3 goals, 2 lines, from the screenshot): one header row
gone, one `+ Monthly goal` link row per group gone, one `why` line per card gone, one `under` line per
card changed rather than added. **Five rows removed, none added, and the lens strip fits in the space
the group header vacated.**

---

## 6. Copy, verbatim

Every string. Sentence case; no exclamation marks; no second-person imperative where a statement will
do.

### 6.1 New

| Surface | Copy |
|---|---|
| Tab strip, accessible name | `Lens` |
| Tab labels | `Life` · `Yearly` · `Quarterly` · `Monthly` · `Weekly` |
| Cluster primary action, every lens | `+ Goal` |
| Empty-state CTA, every lens | `+ Goal` |
| Create sheet heading | `New goal` |
| Create sheet, horizon field label | `HORIZON` |
| Create sheet, period reason — horizon **is** the lens | `Because you're looking at Sep 2026.` *(kept verbatim from today)* |
| Create sheet, period reason — horizon **is not** the lens | `Closest to Sep 2026, the month on screen.` *(unit per lens: `year` · `quarter` · `month` · `week`)* |
| Create sheet, parent cleared by a horizon change | `Cleared — a Quarterly goal can't sit under a Monthly one.` |
| Create sheet, no legal parent (expected unreachable) | `Nothing to hang a Quarterly goal on yet — it needs a Life or Yearly goal above it.` + `Start with a Life goal →` |
| Item with no Life ancestor, on its card | `Not under a Life goal yet` |
| …its accessible name | `Not under a Life goal yet. Put it under one.` |
| Parent line, all horizons except Life | `under Be genuinely fit at 50` |
| …its accessible name | `under Be genuinely fit at 50. Open goal.` |
| Weekly lens, list foot | `Repeat last week` *(unchanged string, new place)* |

### 6.2 Retired

| Retired | Replaced by |
|---|---|
| `Change lens` (Zoom sheet heading) | the tab strip |
| `everything` (the Zoom sheet's Life row) | — |
| `Jump to now` (Zoom sheet footer) | `Now ›`, which already existed (R-lens-21) |
| `+ Life goal` · `+ Yearly goal` · `+ Quarterly goal` · `+ Monthly goal` · `+ Weekly goal` | `+ Goal` |
| `New Quarterly goal` (and its four siblings) | `New goal` |
| `<LIFE GOAL TITLE> · 3 OPEN` (group header) | `3 open` on the Life lens card |
| `UNSORTED` (group header) | — |
| `These aren't under a Life goal yet.` (group note) | `Not under a Life goal yet` (per card) |
| `<lens> lens, Sep 2026 · Mon 7 Sep – Sun 4 Oct. Change lens or period.` (title button name) | the tab's own `aria-selected`, plus the live region |
| `Nothing to hang this on yet — a quarterly goal needs a Life or Yearly goal above it.` | the §6.1 inline form |

### 6.3 Unchanged and load-bearing

Every empty-state headline and body (`copy.ts` `emptyCopy`, `horizonEmptyCopy`); every off-now badge
(`Past month — still editable`, `Future month — planning ahead`); `This week is in Aug 2026` /
`Go there ›`; the planned-ness line's four forms; `planned N weeks ago`; `Nothing on this yet.`;
`Nothing planned for this week — the work below is still carrying.`; `Tasks live on weekly goals.`;
every toast; `Carried`; `from week of …`; `N in backlog`; the picker's `Choose a goal` / `Search
goals`; `Showing the first 200. Search to narrow it.`

### 6.4 The Account sheet's `Keyboard` block

One row is added and one is unchanged:

```
   Keyboard
   ← / →           Earlier / later period
   Shift + ↑ / ↓   Zoom out / in a lens
   ← / → on tabs   Move between lenses; Enter to change
   Escape          Close a sheet, or leave the task page
```

---

## 7. Accessibility

The floor from `docs/work/10-a11y-fixes/build.md`: real `<button>`s, DOM focus order, 44 px targets,
focus traps, 4.5 : 1 enforced by `tests/screens/contrast.test.ts`. **No new colour token is
introduced anywhere in this document.**

### 7.1 A — the tab strip

**Semantics.**

- The strip is `role="tablist"`, `aria-label="Lens"`, `aria-orientation="horizontal"`.
- Each tab is a real `<button type="button">` with `role="tab"`, `aria-selected`, and
  `aria-controls="lens-panel"`.
- The lens body carries `role="tabpanel"`, `id="lens-panel"`, `aria-labelledby="<selected tab's id>"`
  and `tabIndex={-1}` — which `LensBody` already has, for the keyboard shortcuts.
- The routes are unchanged (R-nav-24). A tablist whose panel is swapped by a router is legitimate;
  back and forward still move between lenses, which the Zoom sheet also did.

**Keyboard.**

| Key | Effect |
|---|---|
| `Tab` | one stop for the whole strip (roving `tabindex`: the selected tab is `0`, the rest `-1`) |
| `←` / `→` | move focus and the roving index between tabs. **Does not activate.** Stops at both ends; **does not wrap.** `stopPropagation`, so the body's `←`/`→` period shortcut cannot also fire. |
| `Home` / `End` | focus `Life` / `Weekly` |
| `Enter` / `Space` | activate the focused tab |

**Manual activation, not automatic.** Selection does **not** follow focus. Arrowing from `Life` to
`Weekly` under automatic activation would fire three route changes, three lens reads and three history
entries to reach one destination. `aria-selected` stays on the current lens while focus moves; the
focused-but-unselected tab is `aria-selected="false"` and shows the focus ring only.

**Focus is never dropped.** The strip is mounted in the shell above the router outlet (§2.12), so
activating a tab does not unmount the element holding focus.

**Contrast.** Inactive `T.mut` on `T.paper` = **4.61 : 1** (AA pass at 13 px). Active `T.ink` on
`T.paper` ≈ **15 : 1**. The 2 px `T.accent` indicator is a non-text state marker and is not the only
carrier of state — colour of the label and `aria-selected` both carry it independently. The hairline is
`T.line`, decorative. **Zero new tokens, so `contrast.test.ts` cannot be threatened.**

**Targets.** Every tab is ≥ 44 px tall and ≥ 45 px wide (`Life`, the narrowest, is 51 px at
`padding: '0 14px'`).

**Motion.** None. `behavior: 'instant'`, no snap, no transition, so `prefers-reduced-motion` has
nothing to branch on.

### 7.2 Focus order, any lens

```
1  theme toggle
2  account
3  + Goal                       (absent on a past period)
4  the tab strip                (ONE stop; ← → Home End inside it)
5  ‹  Earlier <period>          (disabled on Life)
6  ›  Later <period>            (disabled on Life)
7  Now ›  /  Go there ›         (only when the conditional row renders)
8    card 1 title               → goal detail
9    card 1 `under …` line      → that goal's page
10   (planned-ness / backlog / staleness lines — text, not focusable)
11   card 1 task checkbox, task 1 title, …     (Weekly only)
12   + Task, Pull from backlog                 (Monthly and Weekly)
13   card 2 title …
…    Repeat last week                          (Weekly, at the list foot)
…    Carried  (band collapse toggle)           (Weekly, when it renders)
…    the tab bar
```

**The lens title is no longer a stop.** So the shell adds one stop (the strip) and removes one (the
title), and the flat list removes one stop per group (the header) plus one per group (the create
link). **Net: the focus order gets shorter on any account with more than one Life line.**

### 7.3 Announcements

One `aria-live="polite"` region in the shell, and the existing rule: *a navigation moves focus; the
live region carries only what focus will not say.*

| Event | Focus says | The live region says |
|---|---|---|
| **Lens change** (tab activated) | the tab's own name and `aria-selected` state — `Quarterly, selected` — announced by the platform | `Q3 2026 · Mon 29 Jun – Sun 27 Sep. 4 goals.` |
| **Period change** (chevron, swipe, `←`/`→`) | nothing — focus stays on the chevron | `Q4 2026 · Mon 28 Sep – Sun 27 Dec. 2 goals.` |
| Either, into an empty period | — | the empty state's headline and body, verbatim, unchanged |
| `Now ›` | — | `Q3 2026, the current quarter. 4 goals.` |
| Goal created into another lens (§3.8) | the route change fires the lens announcement above | — |

**`in N groups` is deleted from every announcement**, because there are no groups. `Announcement`'s
rendered-group counting logic goes with it.

Unchanged: the Monthly card's `role="group"` accessible name still folds the planned-ness line in
(`Run 4 times a week in September, 3 weekly goals, 1 this week.`), since that line is text and takes no
stop.

### 7.4 B — the create sheet

- Inherits `Sheet` whole: focus to the `<h2>` on open, trapped `Tab`, `Escape` and backdrop close,
  focus returned to `+ Goal`.
- The horizon selector is `role="radiogroup"` with `aria-label="Horizon"` and five `role="radio"`
  chips, roving `tabindex`, `←`/`→`/`Home`/`End`, `Space` to select. One tab stop.
- The period chip is plain text inside the group; it is not a control and takes no stop.
- **The parent-cleared sentence is `aria-live="polite"`**, so a change the user did not make is
  announced rather than merely repainted.
- Focus order: `h2 New goal` → `✕` → title → why → horizon group → `UNDER` (the picker's own control,
  which supplies its own keyboard model, R-nav-31) → `Save goal` → wrap.
- The picker's takeover is unchanged, including `‹ New goal` as the back control and focus landing on
  the field on return.

### 7.5 C and D

- **No `aria-expanded` toggles remain in a lens body** except the carried band's, which is unchanged.
- The `under` line stays a real `<button>` with a full accessible name; truncation is visual only, so
  the whole title is still in the accessibility tree.
- Removing `why` costs a screen-reader user nothing that the goal's page does not carry, and removes
  an unbounded string from between a card's title and its ancestry.
- The `Not under a Life goal yet` line is a `<button>` opening the Move sheet — the first time that
  state has had a keyboard-reachable action at all.

---

## 8. What I rejected, and what I overturned

### 8.1 Overturned from `docs/work/14-redesign/UX-PLAN.md`

**§1.2 / §1.4 / §10 — "the title is the altitude", and the refusal of a persistent switcher.**

> *"A five-way segmented control, pinned under the header. Rejected on the complaint itself. It is a
> permanent row that says nothing new once you have read the title — five labels of which four are
> always wrong — and `Life · Yearly · Quarterly · Monthly · Weekly` is 42 characters; at 360px it needs
> 7px type or truncation."*

Overturned on evidence: the owner has used it daily and finds the two-tap sheet high-friction, which
is the only test that matters. Three of the four arguments are answered rather than dismissed:

- **"42 characters"** counted a sentence with ` · ` separators. As tabs there are no separators and no
  spaces: 32 characters, ~358 px of tabs in a 390 px track. §2.2 measures it.
- **"7 px type or truncation"** — neither. The strip scrolls; nothing is scaled and nothing is cut
  except by the screen edge, deliberately.
- **"four of five labels are always wrong"** — a tab is not an assertion, it is a destination. Four of
  five bottom-bar tabs are also "wrong" at any moment.
- **"it treats an ordered scale as five peers"** — the one argument that survives, and it is answered
  by form rather than by absence: the tabs are laid out **in horizon order, left to right**, matching
  the Zoom sheet's own ladder, `Shift+↑`/`Shift+↓`, and `HORIZONS`. An ordered strip is a scale.

**§1.3 — "the Zoom sheet is not one tap too many."** Overturned; it is two taps (open, choose) on the
act the owner performs most and it was two taps in a modal. §2.8 replaces it.

**§4 — grouping by Life goal.** Overturned by the owner's own instruction, reversing the instruction
that created it (*"in each lense we donot need a filter on goals instead it will be catogrised by life
goals"* → *"lets not categorise based on life in any horizon"*). §4 designs the three replacements.

**§6.7 — two entry points per lens, and "the per-group one is the good one and it is why grouping
earns its keep."** Overturned: with grouping gone the per-group create has no group, and the owner
named the repetition as the clutter. The knowledge that entry point supplied — the parent — is now
supplied by preselection when there is one legal parent, and by a searchable, grouped picker when
there are many, which is strictly more capable than a button that guessed.

**§10 — "no five-way segmented control, and no persistent lens switcher of any kind. This is the
single biggest thing not built."** It is now built. It is a **scrolling tab strip**, not a segmented
control: it does not divide the width between five peers, it does not stretch, and it does not
truncate.

### 8.2 Overturned from `docs/SPEC.md`

**R-lens-13's surviving refusal** — *"it is not a tab and must never become one."* Read in full, that
clause is about **the bottom tab bar**: *"five lenses in a five-item tab bar leaves no room for
capture or Learnings, and the tab bar is a top-level destination switcher, not a zoom."* **That
sentence stands verbatim and is not touched**: `Goals · + · Learnings` is unchanged, and the lens
strip is inside the Goals screen. What is overturned is the extension of that argument to any
tab-shaped control anywhere in the product. R-lens-13's *accessibility* clause — one tab stop,
arrow-key movement along the axis the list runs, selection announced rather than merely coloured — is
not overturned; §7.1 is its most literal implementation in the app.

### 8.3 Rejected alternatives for A

- **A five-way segmented control that divides the width.** The thing `14-redesign` refused, and it was
  right to: at 360 px each of five equal cells is 65 px and `Quarterly` needs 87 px. Truncation is its
  only failure mode and truncation is not acceptable.
- **Shorter labels — `Life / Year / Quarter / Month / Week`.** They fit (299 px). Rejected: it invents
  a second vocabulary for the five horizons while `+ Yearly goal`, `New Quarterly goal`, the picker's
  `MONTHLY · Aug 2026` row and every empty state keep the first, and it fixes the width problem by
  making the product speak two languages. The width problem is better solved by a scroller that cannot
  fail.
- **A dropdown / `<select>` for the lens.** The friction being complained about, in a native widget.
- **Two rows of tabs.** Four unconditional rows. Refused on R-nav-27 before taste.
- **Arrow buttons or gradient fades at the strip's ends.** Two more targets, or a colour affordance
  that fails in dark mode; the clipped glyph at the screen edge is the affordance and it costs nothing.
- **`scroll-snap` on the strip.** A settle animation, and it fights a deliberate drag.
- **Smooth scrolling into view.** The first animation in the product and therefore the first
  `prefers-reduced-motion` branch, for a 30 px move.
- **Counts on the tabs.** Five ambient numbers, permanently, in a strip that has no width for them, on
  a product whose rule is that a lens is not a report (R-nav-26).
- **Keeping the Zoom sheet as a secondary route** ("tap the title as well as the tabs"). Two navigation
  systems for one job is the clutter being complained about. Fold or delete; this deletes.
- **A sticky strip.** §2.7, and open question 1.
- **Pinch-to-zoom between lenses.** Still invisible, still needs a non-gesture equal, still not this
  document's.

### 8.4 Rejected alternatives for B, C and D

- **Keeping `+ <Horizon> goal` on the cluster and adding the horizon selector anyway.** A label that
  names a default as if it were a destination.
- **A horizon `<select>` in the sheet.** Renders like nothing else in the app; the chip group already
  exists three fields above it for `PULSES`.
- **Rendering the sheet's horizon selector as a second tab strip.** A tab says *this is where you
  are*; the sheet is not a place.
- **Silently re-parenting when the horizon changes** (e.g. walking up to the nearest legal ancestor).
  Magic that changes a field you set, for a saving of one tap.
- **Keeping the group header and only deleting its count.** The owner asked for no categorisation, not
  for a quieter one.
- **`Life line › immediate parent` as a two-name crumb on every card.** 45 characters at 12.5 px in a
  296 px card is a truncated crumb, and a breadcrumb in a lens is the tree wearing a different hat
  (`14-redesign` §10).
- **Putting the open-task count on every card.** A per-line number printed once per goal in that line.
- **Deleting the open-task counts outright.** The owner asked to keep them; §4.4 keeps them.
- **Sorting the flat list by anything new.** §4.3.
- **Cutting the planned-ness line to buy the `under` line.** It is the Monthly lens's only signal;
  `why` is the line with no reader.
- **Cutting `N in backlog`.** Conditional, rare, actionable where it renders, and one of four
  permitted numbers.

---

## 9. Rules that must change

Ids for new rules are proposals; the spec pass owns numbering.

| Rule | Change | Replacement text |
|---|---|---|
| **R-lens-13** | **Clarified, not overturned.** | Its bottom-tab-bar refusal stands verbatim: five lenses in the three-item destination bar leaves no room for capture or Learnings. It does **not** forbid a lens tab strip inside the Goals screen (R-lens-33). Its accessibility clause — one tab stop, arrow keys along the list's axis, the selection announced and not merely coloured — binds R-lens-33 in full. |
| **R-lens-17** | **Rewritten.** | *(the lens control is a tab strip)* — The lens is chosen from a **horizontal tab strip**, `role="tablist"`, directly below the top-right cluster: the five horizons in horizon order, `Life` first, one tap to change. **The strip scrolls horizontally and keeps the selected tab in view; no label is ever shortened, truncated or scaled.** The period row sits below it and carries `‹`, the period title as **text, not a button**, and `›`. **There is no Zoom sheet.** *Supersedes R-lens-13; retires R-lens-22.* |
| **R-lens-22** | **Deleted.** | The Zoom sheet's per-lens goal counts. There is no sheet and there are no counts. `GET /goals/zoom` has no caller. |
| **R-lens-3** | **Deleted.** | Grouping by Life goal in a lens body. *Owner's reversal: "lets not categorise based on life in any horizon."* `LifeGroupView` remains on the wire for the Life lens's counts (R-lens-4) and for the goal picker (R-nav-31). |
| **R-lens-4** | **Rewritten.** | *(the per-line open-task count, and its one home)* — The count of open tasks under a Life goal, in the current week, renders on **that Life goal's card in the Life lens** and nowhere else in any lens. A zero is never rendered. There is no group header at any horizon. |
| **R-lens-5** | **Rewritten.** | *(order in a lens)* — A lens body is a **flat list**, ordered by the item's Life root (`createdAt asc`, then `id asc`), then by the item (`createdAt asc`, then `id asc`), with **root-less items last**. This is the reading order of the previously grouped screen with its headers removed. `LensResponse.items` arrives in this order; the client does not re-sort and does not partition. |
| **R-lens-19** | **Deleted.** | Group rendering, collapse and suppression. The carried band's collapse (R-lens-12) is unaffected and keeps `CollapsibleHeader`. |
| **R-lens-20** | **Rewritten.** | *(an item with no Life ancestor)* — It renders, on its card, the muted line **`Not under a Life goal yet`**, which is a button opening the Move sheet in `only: 'life'` mode, and it **sorts last** (R-lens-5). There is no `UNSORTED` group and no group note. |
| **R-lens-23** | **Rewritten.** | *(the line on an item)* — Every item in every lens except Life renders **one muted line naming the Life goal its parent chain reaches** — `under Be genuinely fit at 50` — as a button to that goal's page. **No suppression at any horizon.** Full ancestry lives on the goal's own page (R-goal-41 / `22-ux-fixes` §4), never in a lens. |
| **R-lens-25** | **Amended.** | The lens tab strip is marked `data-h-scroll` **and** `data-no-swipe`; the body's period swipe never fires inside it. When the vertical zoom gesture lands, its always-present non-gesture equal is **the tab strip**, not the Zoom sheet. |
| **R-nav-25** | **Amended.** | A lens's one primary action is **`+ Goal`**, the same string at every lens, absent (not disabled) on a past period. The five horizon-named labels are retired. Goal detail and the task page mappings are untouched (R-nav-29). |
| **R-nav-26** | **Amended.** | The permitted-numbers list **loses** R-lens-22's Zoom-sheet counts and **keeps** R-lens-4's open count, now bound to the Life lens alone. No number is added. |
| **R-nav-27** | **Rewritten.** | *(three rows of chrome, and nothing else unconditional)* — Above the first item of any lens there are **at most three unconditional rows**: the top-right cluster (R-nav-25), the **lens tab strip** (R-lens-33) and the period row (R-lens-7). Everything else is conditional and mutually exclusive: the off-now row only off-now (R-lens-21) or the week-elsewhere row only when current (R-lens-29). **There are no group headers at any horizon, and no per-group create.** A fourth unconditional row is refused, not deferred. |
| **R-goal-46** | **Amended.** | `Repeat last week` renders **once, at the foot of the Weekly lens's list**, and copies the previous week's Weekly goals across **every** Life line. `repeatWeek`'s `lifeGoalId` becomes optional; absent means all lines. Everything else — ordinary new goals, `pulse` reset, no tasks copied, nothing linking a copy to its source, current week or later only, the no-op toast — is unchanged. |
| **R-lens-33** `[new]` | | *(the lens tab strip)* — Five tabs, horizon order, `role="tablist"` with a single tab stop, roving `tabindex`, `←`/`→`/`Home`/`End` for focus and `Enter`/`Space` to activate (**manual activation**), `aria-selected` on the current lens, `aria-controls` on the lens body's `role="tabpanel"`. The strip is **full bleed**, `overflow-x: auto`, `scrollPaddingInline: 24`, and scrolls the selected tab into view with **`behavior: 'instant'` — there is no animation, so there is no reduced-motion branch.** It does not wrap at either end. **It is mounted once, in the shell above the five lens routes**, so focus and `scrollLeft` survive a lens change. It is not sticky. **No label may be shortened, truncated, ellipsised, wrapped or scaled.** |
| **R-nav-32** `[new]` | | *(one create action)* — A lens has exactly one create affordance: `+ Goal` in the top-right cluster. Its sheet (`New goal`) carries a five-way **horizon selector defaulting to the current lens**, a **read-only** period chip derived by R-lens-9's clamp from R-lens-18's anchor, and the one goal picker in `parent` mode (R-nav-31). **Changing the horizon re-clamps the period and re-scopes the picker; a parent no longer legal is cleared with a stated reason, never silently.** `Life` renders no period and no parent. If the created goal's horizon is not the lens on screen, the app moves to that lens at that period. |

**Untouched and depended upon:** R-lens-9 (the clamp), R-lens-18 (the anchor), R-lens-7 (the period
control), R-lens-8 / R-nav-28 (where a lens opens), R-lens-10 / R-goal-36 (the past is not written
into), R-lens-11 / R-lens-21 / R-lens-29 (the conditional row and its two occupants), R-lens-12 (the
Weekly lens and the carried band), R-lens-24 (the horizon-level empty state), R-lens-26 (the forward
dot), R-lens-28 / R-lens-30 (the label, its span, and the instant header), R-nav-24 (the routes),
R-nav-29 / R-nav-30 / R-nav-31 (goal-page action, skeletons, the one goal picker), R-goal-47 (the
planned-ness line), R-goal-3 / R-goal-5 / R-goal-32 (Life has no parent or period; strictly decreasing
horizon; levels may be skipped).

**For the server, flagged not designed:** `GET /goals/zoom` and `GoalService.zoom` lose their only
caller; `LensResponse.items` must carry R-lens-5's flat total order; `repeatWeek` must accept an
absent `lifeGoalId`; `parent`-mode picker reads must never drop Life goals through a period filter.

---

## 10. Open questions

1. **Should the tab strip and the period row stick to the top of the viewport when the page scrolls?**
   Nothing in the product is sticky today except the bottom tab bar, and sticking 92 px on a phone is a
   permanent cost paid on every screen to speed up an act performed a few times a session.
   `[recommended]` **Not sticky.** If daily use proves otherwise, the correct form is **both rows
   together as one block, or neither** — a strip that sticks without its period row lets you change
   lens but not period from the same place.

2. **Is `under <Life goal>` the right name, given the Weekly lens loses `under <monthly goal>`?**
   On the Weekly lens the immediate parent is the month the week serves, which is genuinely
   informative, and it is the one fact this design takes and does not give back.
   `[recommended]` **The Life goal, at every horizon, no exceptions.** One rule at five horizons beats
   four different facts wearing one word, and the month is one tap away on the goal's page. If it is
   missed specifically on the Weekly lens, the fix is a *second* line there, not a per-lens rule — and
   a second line is a density regression that should be earned by use, not guessed at now.

3. **`Repeat last week`: whole week, or restore a per-line control somehow?**
   Q-22 required it per Life line; the group foot it lived at no longer exists.
   `[recommended]` **Whole week, once, at the list foot.** It is the honest flat version, it needs one
   optional parameter on an endpoint that already exists, and a week's plan is usually repeated as a
   whole or not at all. A per-line variant would need a per-line row, which is a group header by
   another name.

4. **Should `why` really leave all four working lenses?**
   It is the biggest single density cut in this document and the owner did not ask for it — it is the
   line that pays for the `under` line, so the card is no taller than today.
   `[recommended]` **Yes, and keep it on the Life lens with a one-line clamp.** If it is missed, the
   cheapest restoration is Monthly-only with a one-line clamp — not everywhere, and never unclamped.

5. **Does the create sheet remember the last horizon you chose, instead of defaulting to the lens?**
   `[recommended]` **No. Always the current lens.** That is the owner's literal instruction
   (*"defaults to the lense based on my current page"*), it is stateless, and a remembered horizon
   would silently create a Quarterly goal from the Weekly lens because of something you did yesterday.

6. **Should the strip carry a goal count per tab?**
   It is the one thing the Zoom sheet had that nothing replaces.
   `[recommended]` **No.** Five ambient numbers, permanently, in a strip with no width for them, on a
   product whose rule is that a lens is not a report (R-nav-26). The destination answers the question
   in one free tap.
