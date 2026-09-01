# 22 — UX plan: the instant header, skeletons, breadcrumbs, gestures and one goal picker

Seven problems the owner hit using the redesigned app, designed as fixes. This amends
`docs/work/14-redesign/UX-PLAN.md`; it does not replace it. **The two-row chrome budget (R-nav-27)
holds, and nothing here spends a row of it** — the one place a line is added is the goal detail
page, where it replaces three wrapped ones (§4.4).

> *"why is the ui goal navigation shows ... in lense loading... text in the content. also the down
> arrow is missaligned for changing the lense. look i need these fixed in ui, 1. changing the horizon
> or the period shouldn't take time as it doesnt need backend, its the calander that can be computed
> in ui. 2. for the contents inside i would want skeleton loader 3. there is problem with breadcrumbs
> if the title of the goal is large the is looks messed up. probably add elipsis in middle or pick
> best practices 4. also i prefer having ability to scroll horizontally for changing timeframe and
> similarly scroll vertically to change the horizon. along side with existing bottom drawer to select
> 5. i need a better way select goal example when i add a backlog in goal everything is listed. lets
> say if i have many the ui is messed up. i have seen similar practices in other pages too."*

**Scope.** A parallel agent owns the client-side period model and the data flow. This document owns
what the user sees at each moment, what moves, and what it says. Everything it needs from that agent
is collected in one place — §9 — and nothing here designs an API, a cache or a query.

**One thing to know before reading.** The app today contains **no animation at all**: `grep` for
`transition`, `animation`, `@keyframes` and `prefers-reduced-motion` across `apps/web/src` and
`apps/web/index.html` returns nothing. Every design below preserves that, deliberately and for a
stated reason. The consequence is that `prefers-reduced-motion` has nothing to honour in this
document, which is an outcome rather than an oversight (§8.5).

---

## 1. Priority order

| # | Item | Why here |
|---|---|---|
| 1 | **A — the instant header** | The complaint stated twice ("shouldn't take time", "shows `…` in lens loading"), on the control touched most: every period step, every day, several times a session. Everything else is a refinement of a screen you look at; this is the screen answering you. |
| 2 | **F — the chevron** | Five lines in the same component A rewrites, visible on every lens, and the owner named it. It ships with A because it *is* A's file. |
| 3 | **C — breadcrumbs** | A layout that breaks on the owner's real data, on a page reached from every card in the app. Cheap, total, and it fails today with two goals — not two hundred. |
| 4 | **B — skeletons** | Deliberately *after* A. With A shipped, most navigation never reaches a loading state at all, so B's real subject is cold opens and the goal and task pages. Building skeletons first means building them for moments A deletes. |
| 5 | **E — one goal picker** | The largest piece of work here and the one the owner says recurs, but it fires on capture, not on every screen — and it is the item that most needs a decision from him before it is built (§11 Q4, Q5). |
| 6 | **D — gestures** | Last, and on purpose. It is an accelerator for two routes that already exist and are already good; it is the only item in this document that can make the app **worse** than not doing it; and its value depends entirely on A — a swipe that steps a period which then takes 300 ms to repaint is a swipe that feels broken. |

---

## 2. A — the instant header

### 2.1 The defect, from the source

`lens/LensRow.tsx:39` — `const label = isLife ? 'Life' : (period?.label ?? '…')`. The literal `…` is
the app's period name while `GET /goals?lens=&period=` is in flight. `lens/copy.ts:30` states the
design it follows: *"Both halves are the SERVER's strings (`PeriodView.label` / `.weekRange`) — the
client formats no date here."*

So a period step is a network round trip for calendar arithmetic. `2026-09 → 2026-10` is already
computed on the client — `utils/periodKeys.ts:stepPeriod` — and then the client waits for the server
to tell it what `2026-10` is *called*.

There is a second, quieter symptom of the same cause: `LensScreen.tsx:128` gates the `+ Monthly goal`
button on `data !== undefined`, so the one primary action on the screen **disappears and reappears on
every single step**. And `TopActions.tsx:94` renders `{user?.email ?? '…'}` — the same literal, in
the Account sheet. Neither is in the owner's report; both are the same defect.

### 2.2 The rule

> **R-lens-30 (new) — the lens header never waits.** The period's label, its range, whether it is
> current or past, and which period holds the current week are rendered from local period arithmetic
> and repaint **in the same frame as the input that changed them**. No lens header may render a
> placeholder where a period name goes. **`…` is never a label.**

This does **not** reopen D-1 (*"there is no `weekStartOfDate` in this client and there must not be
one"*). The client is not being given a Monday rule; it walks whole weeks from the Monday the server
already sent in `BootstrapResponse.week.weekStart`, which is exactly what
`utils/periodKeys.ts:weekForMonth` already does today, with the reason written above it. What moves
client-side is *formatting and comparison*, not the derivation of a week boundary. §9 states the
contract.

### 2.3 The moment, frame by frame

The owner is on `/month/2026-09` and presses `›`.

**Frame 0 — everything below repaints at once, from local arithmetic. No network is consulted.**

| What | Sep 2026 | → Oct 2026 |
|---|---|---|
| Title | `Sep 2026` | `Oct 2026` |
| Range line | `Mon 7 Sep – Sun 4 Oct` | `Mon 5 Oct – Sun 1 Nov` |
| URL | `/month/2026-09` | `/month/2026-10` |
| Conditional row | *(nothing — current period)* | `Future month — planning ahead`  ·  `Now ›` |
| Primary action | `+ Monthly goal` | `+ Monthly goal` — **unchanged, and it must not blink** |
| Chevron names | `Earlier month` / `Later month` | unchanged |
| Forward-content dot | present | see §9.4 |
| Window scroll | wherever it was | **top** |

**What persists, and this is the load-bearing half:**

- **Focus does not move.** It stays on `›`, so the fifth press is the same as the first. A design that
  moved focus on a step would make repeated stepping impossible with a keyboard.
- **Collapsed group state** (`ui.collapsed`, keyed `${lens}|${groupId}`) is per-lens, not per-period,
  and is untouched.
- **The two chrome rows are the same two rows.** Nothing is added, nothing is removed, nothing
  reflows. The conditional third row (R-lens-21 / R-lens-29) may appear or vanish, which it already
  does today; the difference is that it now does so in the same frame as the label rather than 300 ms
  later, so the header settles once instead of twice.

**Why the scroll goes to top.** The header is not sticky; the page scrolls as one column
(`S.page`). If the owner is 400 px down a September list and swipes to October, a header he cannot
see has changed. The content beneath him is the wrong month's, or gone. So a period or horizon change
scrolls the window to `0` — instantly, with no smooth-scroll, because there is no animation in this
app and a 300 ms scroll animation would reintroduce exactly the latency A exists to remove. The
scroll happens **with the content swap, never before it** (§3.2, R4).

**Frame 0 → the content area.** Three cases, and §3.2 is their full statement:

1. Oct 2026 is already in cache → its content renders in this same frame. **Nothing loads, nothing
   flashes, and the whole interaction is one repaint.** This is the case the owner named.
2. Oct 2026 is in cache but stale → the cached content renders now and is quietly replaced when the
   revalidation lands. No skeleton, no dim, no marker.
3. Oct 2026 is cold → the content area renders **nothing** for 150 ms, then the lens skeleton (§3).

**What never happens:** September's goals are never shown under an October header. The moment the
period changes, the previous period's items are gone. A stale list under a fresh label is a lie, and
it is a worse failure than a skeleton.

### 2.4 The mockup

```
   ‹        Oct 2026  ▾        ›
            Mon 5 Oct – Sun 1 Nov

   ( Future month — planning ahead )                        Now ›

   ┌─────────────────────────────────────────┐
   │  ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬                     │      ← skeleton, only in case 3,
   │  ▬▬▬▬▬▬▬▬▬▬▬                            │        and only after 150 ms
   └─────────────────────────────────────────┘
```

### 2.5 Horizon changes

Identical, from all three routes (the Zoom sheet, `Shift+↑`/`Shift+↓`, and D's vertical swipe). The
target period is derived locally from R-lens-18's anchor, which the client already holds and already
computes with (`enclosingKey`, `containingKey`). So Monthly → Quarterly repaints the header to
`Q4 2026` / `Mon 5 Oct – Sun 3 Jan 2027` in the same frame, and only the body waits.

**One consequence worth naming: the Zoom sheet loses its loading state entirely.** Today it renders
`Loading the lenses…` while `GET /goals/zoom` is in flight (`ZoomSheet.tsx:39`). With local period
math, all five rows' labels **and** their ranges are known the instant the sheet opens. Only the
counts need the network — and R-lens-22 already omits a zero count rather than rendering it, so a
count that arrives 200 ms late needs no placeholder at all. The sheet opens complete and quietly
gains up to five numbers. Delete `Loading the lenses…`.

### 2.6 Alternatives rejected

- **Keep the server's strings; show the previous label until the new one lands.** The header would
  then say `Sep 2026` while the URL says `2026-10`, which is the same lie as case 3's stale content,
  in the one place the whole screen is named from.
- **Show the period *key* while loading** (`2026-10`). R-nav-24 is explicit: the URL carries the key
  and the screen shows the label. A key on screen is a leaked identifier.
- **A skeleton bar where the title goes.** A 21/800 grey bar between two chevrons is louder than the
  `…` it replaces, and it is a placeholder for a fact the client already knows. Skeletons stand in
  for what is unknown (§3.1); the period name is not unknown.
- **Optimistically render the previous period's content dimmed.** Dimming is a state, the product has
  four escalations and R-lens-11 refuses a fifth, and a dimmed wrong month is still a wrong month.

---

## 3. B — skeleton loading

### 3.1 The three principles

**There is no rule about loading anywhere in `SPEC.md`** — no skeleton, spinner, latency, prefetch or
optimistic-UI rule exists, in any family. The nearest existing positions are three: **Q-14**
(*"Optimistic UI with rollback … a toast alone is insufficient for a lost write"*), **Q-15** (*"v1 is
online-only with a read cache"*), and **R-nav-27**, whose budget applies here directly — **a loading
state may not become a third unconditional row**. So §3.2 is greenfield, and R-nav-30 is where it
lands.

`components/states.tsx` currently argues against skeletons in as many words: *"A skeleton that
shimmers would be louder than anything else in this product."* That argument is right about
**shimmer** and wrong about **skeletons**, and this design agrees with both halves.

> **P1 — no motion, ever.** No shimmer, no pulse, no gradient sweep, no fade-in. The skeleton is
> static grey blocks on the card the content will occupy. This keeps the app's zero-animation
> property (§8.5) and makes `prefers-reduced-motion` a non-issue rather than a second design.
>
> **P2 — a skeleton stands in for content, never for a control.** A grey lozenge shaped like a button
> is an affordance that does nothing, and someone will tap it. So `+ Task`, `Edit`, `Move…`,
> `Delete`, the checkbox and every form field render **when their data lands and not before**. Their
> absence is honest; a fake is not.
>
> **P3 — anything the client already knows renders for real.** This is A's principle applied to the
> body. The task page's back control (`‹ Week of Mon 31 Aug`) is computed from `location.state.from`
> and is correct before the task read starts, so it renders for real. The goal page's `Goals` crumb
> is a constant. The top-right cluster needs no data. Only the unknown is grey.

### 3.2 When a skeleton is right — the ruleset

The unit of the decision is the **content identity**: `(screen, lens, period)` on a lens,
`(screen, goalId)` on a goal page, `(screen, taskId, week)` on a task page.

| # | Rule |
|---|---|
| **R1** | **Identity rule.** Content stays on screen only while the header still describes it. When the identity changes, the previous content is discarded in the same frame. Never Sep's goals under Oct's label. |
| **R2** | **Cache-hit rule.** If the new identity has data in cache, it renders at once — **no skeleton, no dim, no marker — even when it is stale and being revalidated.** Sep → Oct with Oct cached is one repaint and nothing else. *(This is the owner's own example and it must never flash.)* |
| **R3** | **Cold rule.** If the new identity has no data at all, the content area shows that screen's skeleton. |
| **R4** | **Grace rule.** The skeleton does not mount for the first **150 ms**. Inside that window the content area is empty. If the data lands at 90 ms, no skeleton is ever painted and the user sees one repaint. |
| **R5** | **Minimum duration.** Once mounted, a skeleton stays **at least 400 ms**, even if the data landed at 160 ms. The shortest visible skeleton is therefore 400 ms — long enough to be read as a state rather than a flicker. Worst case for a fast-but-not-instant read: 150 + 400 = **550 ms**. |
| **R6** | **Errors supersede.** A read that fails during the grace or minimum window replaces the skeleton with `LoadError` immediately. The minimum duration never delays bad news. |
| **R7** | **A refetch never skeletons.** Window-focus revalidation, a mutation invalidation, a retry — none of these may replace visible content with grey, at any latency. Only a cold identity does. |
| **R8** | **A skeleton never replaces an empty state.** Once a period is known to be empty, its empty state (R-lens-6 / R-lens-24) is cached content under R2 and returns instantly. |
| **R9** | **One skeleton per screen, never nested.** A screen is either skeletonised or it is not. A goal page does not show a real title with a skeleton sub-goal list; it shows one skeleton until the one read lands. |

150 ms is the conventional boundary below which a change reads as instantaneous; 400 ms is the point
past which the eye has fixated the new element and removing it reads as a flicker. Both are named in
§11 Q1 with these values recommended.

### 3.3 The three skeletons

Every one of them is built from **the same components the real content uses**, with a grey bar where
a text run goes. That is not a style preference — it is the only way the promise "nothing jumps" can
be kept, because the height then matches by construction rather than by a magic number.

**The bar.** `background: S.T.lineSoft`, `borderRadius: 6`, height matching the line it stands in for
(13 for a 15.5/700 title, 11 for a 12.5 muted line, 17 for a 21/800 heading). `lineSoft` is
`#f0f0eb` on light, and it is the token the notice-row pill already uses. **It carries no text, so
`contrast.test.ts` is not engaged** — and the whole skeleton subtree is `aria-hidden="true"`, so it
is not information either.

#### Lens list — `LensListSkeleton`

Three `CardShell`s, same `S.card`, same `padding: '14px 16px'`, same internal gaps as `PlainCard`:

```
   ┌───────────────────────────────────────────┐
   │  ●  ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬               │   ● = 8px circle, the pulse dot's place
   │     ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬                       │
   └───────────────────────────────────────────┘
   ┌───────────────────────────────────────────┐
   │  ●  ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬                       │
   │     ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬                │
   └───────────────────────────────────────────┘
   ┌───────────────────────────────────────────┐
   │  ●  ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬                  │
   └───────────────────────────────────────────┘
```

Title bars at 62 %, 48 % and 71 % of the line; the second line present on two of the three. The
variation is so it does not read as a machine pattern, and the third card's missing second line is so
the block does not read as a fixed grid.

**Three cards, always, and no group headers.** An honest promise: *the top of the list does not
jump* — the first card's frame, position, padding and line metrics are the real first card's, so the
eye's anchor is fixed. Below that, growth is expected and unavoidable; a skeleton cannot know it is
standing in for twelve cards, and guessing produces a second lie. Group headers are omitted for the
same reason: R-lens-19 suppresses the header when there is one group, and we do not yet know how many
there are.

#### Goal page — `GoalPageSkeleton`

```
   Goals  /  ▬▬▬▬▬▬▬▬▬▬▬▬                       ☾  ⌾
   ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬     ▬▬▬▬▬
   ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
   ┌───────────────────────────────────────────┐
   │  ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬                      │
   └───────────────────────────────────────────┘
   ┌───────────────────────────────────────────┐
   │  ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬               │
   └───────────────────────────────────────────┘
```

- `Goals` renders for real (P3), the theme and account buttons render for real, the primary action
  does not render at all (P2).
- Title bar at 17 px height, then the horizon-chip's place at `hChip()`'s size, then one `why` bar.
- **No section labels.** `SUB-GOALS`, `BACKLOG` and `FROM THE BACKLOG` each render conditionally on
  the goal's horizon, which is the very thing not yet known. Printing a heading and taking it away is
  the flicker skeletons exist to prevent. Two generic rows stand in for whatever the first section
  turns out to be.

#### Task page — `TaskPageSkeleton`

```
   ‹ Week of Mon 31 Aug                          ☾  ⌾

   ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
   ▬▬▬▬▬▬▬▬▬▬▬▬▬▬  ·  ▬▬▬▬▬▬▬▬▬▬
```

- The back control is **real** whenever the page was reached from a lens — `backLabel` is derived from
  `location.state.from` and needs no read (P3). Opened cold by URL it is a bar of the same width.
- No checkbox (P2 — `task.completable` is unknown, and a checkbox that appears late beside a title is
  the one control on this page you must not guess at).
- Title bar, then the two-segment context line's places.
- **Nothing below the fold.** The rest of the task page is a form; a form made of grey boxes invites a
  tap into a field that is not there.

### 3.4 What `Loading` becomes

`components/states.tsx`'s `Loading` — the text row that renders `Loading…` — is **retired from every
full screen**: the lens (`LensScreen.tsx:177`), the goal page (`GoalDetailScreen.tsx:39`), the task
page (`TaskPage.tsx:105`) and the Zoom sheet (`ZoomSheet.tsx:39`, which per §2.5 stops loading at
all). The component survives only for **lists shorter than a screen inside a sheet**, where a
skeleton would be more chrome than the list it replaces.

Its accessible role does not go away: the `role="status"` and the strings `Loading this goal…` /
`Loading this task…` move onto the skeleton's wrapper, verbatim, so a screen reader hears exactly
what it hears today (§8.2).

### 3.5 Alternatives rejected

- **A shimmer or pulse.** `states.tsx` already made this argument and it is correct. It would also be
  the first animation in the product and the first `prefers-reduced-motion` branch.
- **A skeleton sized to the last-seen list length.** Removes the jump in the common case and adds a
  new lie in the uncommon one (twelve grey cards, then two real ones). It also needs per-period state
  the app does not otherwise keep.
- **A spinner.** Says "something is happening" and nothing about what. The app has none anywhere.
- **A progress bar at the top of the page.** A third unconditional row on the screen whose complaint
  was clutter (R-nav-27), and it says even less than a spinner.
- **Skeleton controls.** See P2.
- **No grace window (skeleton immediately).** Produces exactly the flash the owner is complaining
  about, one layer down.

---

## 4. C — breadcrumbs with long titles

### 4.1 The defect, from the source

`GoalDetailScreen.tsx:56-64` — the trail is a `flexWrap: 'wrap'` row of `Crumb` buttons, each
rendering `a.title` in full at 12.5/700, sharing row 1 with the top-right cluster under
`justifyContent: 'space-between'`.

With the owner's own data — `"Set up my AI consultancy and land at least one paying client"` nested
under `"Be financially independent"` — a Quarterly goal's trail is:

```
   Goals / Be financially independent / Set up my AI      ☾ ⌾ + Task
   consultancy and land at least one paying client
```

≈ 100 characters at 12.5/700 is roughly 660 px of text in about 220 px of line. It wraps to three
lines, and because the wrapping container is the flex sibling of the cluster, it pushes the cluster
and the title block down the page. At five levels deep it is four or five lines of muted grey above
the thing you came to read.

Two facts shape the fix. **The trail holds the ancestors only** — the goal's own title is the `<h1>`
below it. And **`Crumb` renders no period label**, which R-goal-41 requires ("breadcrumbs to the Life
root **with each ancestor's own period label**"); that clause is unimplemented today.

### 4.2 The decision

> **One line that never wraps, holding at most three segments — `Goals`, an overflow `…`, and the
> immediate parent — with the Life line moved out of the trail and onto its own eyebrow.**

Rendered by depth (`ancestors.length`):

| Depth | Goal being viewed | Trail | Eyebrow |
|---|---|---|---|
| 1 | a Life goal | `Goals` | — |
| 2 | Yearly under Life | `Goals / Be financially independent` | — |
| 3 | Quarterly | `Goals / … / Set up my AI consultancy and land a…` | `BE FINANCIALLY INDEPENDENT` |
| 4 | Monthly | `Goals / … / Sign the first retainer client` | `BE FINANCIALLY INDEPENDENT` |
| 5 | Weekly | `Goals / … / Publish four case studies` | `BE FINANCIALLY INDEPENDENT` |

- **`Goals`** is `flex: 0 0 auto` and is never truncated. It is the escape hatch to the lens and the
  only segment whose loss would strand you.
- **The immediate parent** is `flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis`. It takes the whole remaining line and tail-truncates. It is the way *up
  one step*, which is what a breadcrumb is for.
- **`…`** renders only when segments were dropped — i.e. at depth ≥ 3. It is a real button
  (`aria-label="Show the full path"`) that opens a `Sheet` (§4.3). It occupies a segment slot between
  two `/` separators, which is what tells it apart from a truncation ellipsis at the end of a word.
- **The trail container** is `flex: 1 1 auto; min-width: 0; overflow: hidden; flex-wrap: nowrap`; the
  cluster is `flex: 0 0 auto`. **The cluster can never be pushed by a title, at any length.**
- **The eyebrow** is `S.eyebrow` — an existing token, 12 px, weight 700, `0.08em` tracking, uppercase,
  `T.mut` — carrying the **Life root's** title, as a button to that goal. It renders only at depth ≥ 3,
  i.e. only when the Life root is not already on the trail line, so it never duplicates it. It is a
  block, so it wraps freely to a second line; that is correct for an eyebrow and wrong for a trail.

**Net lines on the goal page: fewer.** Today a deep goal costs three to five wrapped trail lines.
This costs one trail line plus, at depth ≥ 3, one eyebrow line. Nothing in the lens shell changes, so
R-nav-27's budget is untouched.

### 4.3 The overflow sheet — `Where this sits`

The existing `Sheet`, so it inherits R-nav-15's whole contract unchanged. Every ancestor, root →
parent, untruncated, **with its period** — which is where R-goal-41's period clause is finally
honoured — and the current goal itself at the bottom, marked and not tappable.

```
   ┌───────────────────────────────────────────┐
   │  Where this sits                       ✕  │
   │  ┌─────────────────────────────────────┐  │
   │  │ Be financially independent          │  │
   │  │ LIFE                                │  │
   │  ├─────────────────────────────────────┤  │
   │  │ Set up my AI consultancy and land   │  │
   │  │ at least one paying client          │  │
   │  │ YEARLY · 2026                       │  │
   │  ├─────────────────────────────────────┤  │
   │  │ Sign the first retainer client      │  │
   │  │ QUARTERLY · Q3 2026                 │  │
   │  ├─────────────────────────────────────┤  │
   │  │ Publish four case studies           │  │
   │  │ MONTHLY · Aug 2026        ← you are │  │
   │  └─────────────────────────────────────┘  │
   └───────────────────────────────────────────┘
```

Rows are `S.pickerRow('ok')` (`'sel'` for the current goal), titles **wrap freely** — there is no
width pressure inside a sheet, and this is the one surface where the full name is guaranteed
readable. The current goal's row is a `<div aria-current="true">`, not a button.

**The UNSORTED case** (`ancestors[0].horizon !== 'Life'` — a dangling `parentId`, R-lens-20): the
eyebrow is suppressed rather than naming a Yearly goal as a Life line, and the sheet gains one muted
line above the list, `These aren't under a Life goal yet.` — `UNSORTED_NOTE`, verbatim and reused.

### 4.4 The single title that alone exceeds the width

Two cases, and they get opposite answers.

- **A crumb.** Tail-truncates with `…` at whatever width the line leaves it. Its `aria-label` carries
  the untruncated title, and the full string is one tap away in the sheet. A crumb is a pointer, not
  a statement; a truncated pointer still points.
- **The page's own `<h1>`.** **It wraps, freely, up to three lines, then clamps.** A page title is
  the answer to "what am I looking at" and truncating it is the defect, not the fix. Beyond three
  lines it clamps with an ellipsis and the full text is in the Edit sheet, which is where you would
  go to read or change it anyway.

> **Crumbs never wrap. The page title always wraps.** That is the whole rule.

### 4.5 The two other places a long title breaks a line

- **`cards.tsx:ParentLine`** — `under <parent title>`, 12.5 px, currently unconstrained, so it wraps
  to three lines inside a card. Clamp to one line with `text-overflow: ellipsis`; the existing
  `aria-label` (`under <title>, <period>. Open goal.`) already carries the full name.
- **`TaskPage.tsx:204-218`** — the context line `<Life root> · <weekly goal>`, two `linkBtn`s in a
  wrapping flex. Same treatment as the trail: one line, no wrap, the weekly goal takes the remaining
  width and tail-truncates, the Life root is `flex: 0 1 auto` with a 96 px minimum and truncates
  first. R-task-45 requires both segments tappable, and both remain so.

### 4.6 Wide screen

**No separate rule and no breakpoint.** The page is a 640 px centred column (`S.page`), so a wide
viewport gives the same line about 500 px instead of 220 px, and the same flex rules simply produce a
fuller parent name. The segment *count* does not change with width: a trail that grows a segment at
1024 px is a second layout to design, test and keep true, and there is no desktop layout in this
product yet (recorded as not-done in `14-redesign` §10 and still true).

### 4.7 Alternatives rejected

- **Middle truncation of each title** (`Set up my AI c…paying client`), which the owner suggested.
  Middle-ellipsis is right for **paths and filenames**, where head and tail are both identifying
  (`/Users/…/report.pdf`). It is wrong for **sentences**, where the head carries the meaning and the
  tail is a modifier: `Set up my AI c…paying client` is less legible than `Set up my AI consultancy
  and land a…`, which is a readable clause. Rejected for titles; the *trail* is middle-collapsed,
  which is the same instinct applied at the right granularity.
- **Show only the immediate parent.** Drops the Life line entirely, which is the orientation the lens
  gives you with a group header and the goal page otherwise lacks. The eyebrow is that information at
  a lower price than a trail segment.
- **Wrap.** What it does today.
- **Horizontal scroll.** Hides ancestry with no affordance that it is hidden, needs a scrollbar on
  desktop, and puts a horizontal-drag region on a page — which, after §6, is a gesture idiom this app
  now uses for something else. The `…` sheet is the same information with a discoverable control, a
  keyboard route and room for the period labels.
- **A collapsing trail that measures itself in JavaScript.** Correct, and it needs a `ResizeObserver`,
  a measurement pass and a re-layout on every font load. The depth-based rule above produces the same
  answer at every width this app actually renders at, in flexbox, with no measurement.

---

## 5. F — the misaligned chevron

Taken out of order because it is A's own component and five lines long.

### 5.1 Diagnosis, from `lens/LensRow.tsx:116-128`

```
<span style={{ display:'block', fontSize:21, fontWeight:800, letterSpacing:'-0.01em',
               whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
  {label} <span aria-hidden="true" style={{ fontSize:13, color:S.T.mut }}>▾</span>
</span>
```

Four causes, of which the first two produce the misalignment the owner sees:

1. **It is in a different font from every glyph beside it.** The character is `▾` — **U+25BE**. The
   two Manrope `@font-face` blocks in `apps/web/index.html` declare `unicode-range` sets that do not
   contain U+25BE: the nearest are `U+2000-206F` and the two singletons `U+2191`, `U+2193`. So the
   marker falls through to the platform default sans — SF Pro on iOS, Roboto on Android — while the
   label beside it is Manrope. The two typefaces disagree about where a small triangle sits relative
   to the baseline and about its side bearings, so the mark is off-centre by an amount that changes
   with the device.
   *The two step chevrons are not affected:* `‹` and `›` are **U+2039** and **U+203A**, which are
   inside `U+2000-206F` and therefore render in Manrope. The row today draws two Manrope glyphs and
   one foreign one.

2. **It is baseline-aligned against text more than half again its size.** 13 px inside a 21 px block.
   Inline boxes align on the baseline, so the marker's optical centre sits roughly 4–5 px above the
   baseline while the label's sits 7–8 px above it. The marker reads as sunk — which is exactly
   "the down arrow is missaligned".

3. **It inherits `letterSpacing: '-0.01em'`,** applied after the literal space, so the gap between the
   name and the mark is a space *minus* tracking — tighter than the eye expects beside a mark meant to
   read as a separate control.

4. **It is inside the truncating span.** `whiteSpace: nowrap` + `overflow: hidden` + `textOverflow:
   ellipsis` means that on a long label — `Week of Mon 4 Jan 2027` — **the ellipsis eats the
   chevron**. The one affordance saying "this title is a control" vanishes precisely when the title
   is long. Not alignment, but the same three lines and a worse defect.

### 5.2 The fix

Make the title line a **flex row, not a text run**:

```
button  flex:1  minWidth:0  textAlign:left
├─ div   display:flex  alignItems:center  gap:6
│  ├─ span  flex:1 1 auto  minWidth:0  nowrap  ellipsis   ← 21/800, letterSpacing -0.01em
│  └─ svg   flex:0 0 auto  8×5  fill:currentColor  color:T.mut  display:block  aria-hidden
└─ span  the range line, unchanged
```

- **`alignItems: 'center'`** puts the marker on the label's optical centre instead of its baseline.
  That is the alignment fix, and it is one property.
- **`flex: 0 0 auto`** means the marker survives any title length. That is the disappearance fix.
- **`gap: 6`** replaces the literal space, so tracking cannot reach it.
- **An inline `<svg>` triangle replaces `▾`.** 8 wide, 5 tall, `fill: currentColor`, `display: block`
  so it carries no line-height box of its own. This removes the `unicode-range` lottery entirely: one
  shape, identical on every platform, no font dependency, no asset, no library — it is markup. It
  stays `aria-hidden="true"`; the button's own `aria-label` already ends `Change lens or period.`

**Nothing else about the row changes.** Same colour token, same size, same two lines, same two chrome
rows, same accessible name.

### 5.3 The finding behind the finding

`▾` is not the only glyph outside Manrope's subsets. So are `▸` (U+25B8, the collapse markers in
`LensScreen.tsx:450`), `✓` (U+2713, the checkbox), `✕` (U+2715, the sheet close), `⌾` (U+233E, the
account button), `☀`/`☾`, and — in the Account sheet's own shortcut table — `←` and `→` (U+2190,
U+2192), sitting one row above `↑` and `↓` (U+2191, U+2193) which *are* in Manrope. **The app's icon
vocabulary is fallback-font glyphs throughout.**

Recommendation, deliberately narrow: convert to SVG only the marks that sit **inline with text at a
different size**, because that is where the mismatch is visible. Today that is exactly two —
`LensRow`'s `▾` (the reported defect) and `CollapsibleHeader`'s `▾`/`▸`. The standalone icons inside
40 px circular buttons are optically centred by their own flex container and are not affected.
Recorded, not swept up.

And one more literal `…` of the kind the owner named: `TopActions.tsx:94`,
`{user?.email ?? '…'}` in the Account sheet. Render nothing, or an 11 px bar.

---

## 6. D — gestures

The riskiest item in this document, and the reason it is sixth.

### 6.1 What exists, and what must change

`LensScreen.tsx:247-294` already ships a horizontal swipe on the lens body (R-lens-25): threshold
60 px, dominance 2×, suppressed on Life and inside `[data-h-scroll]`. The owner likes it and wants
its vertical counterpart.

> **R-lens-25 must change.** Its text reads: *"**There is no vertical swipe.** Vertical is the scroll
> axis, and a gesture that competes with scrolling on a phone is a gesture that fires when you did not
> mean it."* That sentence is still true of the design it was written about. The amendment does not
> soften it — it satisfies it, by putting the vertical gesture somewhere that **is not the scroll
> axis** (§6.2). If that scoping is not built, the old rule stands and the vertical gesture is
> refused.

### 6.2 Where each gesture is live — the whole disambiguation

Two zones, each with an explicit `touch-action` declaration. `touch-action` is the platform's own
mechanism for this and it is why no gesture library is needed: it tells the browser which axes it
owns *before* a gesture starts, so nothing is ever stolen mid-scroll.

| Zone | What it is | `touch-action` | Live gestures |
|---|---|---|---|
| **The lens row** | Row 2 of the shell — the `‹`, the title, the `›` and the whitespace beside them. About 64 px tall, full width. **It does not scroll**: it is the top of the page and there is nothing above it. | `none` | horizontal **and** vertical |
| **The lens body** | Everything below the chrome — the cards, the groups, the carried band. **This is the scrolling region.** | `pan-y` | horizontal **only** — exactly what ships today |

**Why this is the answer to "a design that hijacks scrolling would be worse than no gesture at all".**

The vertical gesture is live **only in a band that never scrolled in the first place.** With
`touch-action: none` on that band, the browser does not start a scroll there, so there is no scroll
to steal, no `preventDefault` inside a passive listener, no scroll-then-cancel jank, and no heuristic
about intent. The disambiguation is structural, not statistical.

On the body, `touch-action: pan-y` states the division exactly: **the browser owns vertical, we own
horizontal.** A vertical drag on the list scrolls the list, always, with no interpretation and no
threshold — which is the property today's code achieves by convention and this achieves by
declaration.

**The band is small; the travel is not.** A vertical swipe wants 40–60 px of movement, which a 64 px
band cannot contain. It does not have to: a touch that *begins* in the band is captured (Pointer
Events' `setPointerCapture`) and continues to be tracked wherever the finger goes. The band only has
to be big enough to start in.

**A tap in the band must still be a tap.** Movement under 10 px and under 500 ms is a click and the
button fires normally. Once travel crosses the commit threshold, a flag suppresses the click that
would otherwise follow — about eight lines, no library.

**Android pull-to-refresh** is an overscroll gesture, and `touch-action: none` on the band suppresses
it there. Belt and braces: `overscroll-behavior-y: contain` on `html` in `index.html`, one
declaration, which also stops the installed PWA rubber-banding into a refresh on a downward flick.

### 6.3 The other two conflicts

- **iOS back-swipe.** A system edge gesture originating in roughly the leftmost 20 pt; `touch-action`
  does not and should not defeat it. The mitigation is a **dead zone: a horizontal gesture whose
  start X is within 20 px of either screen edge is ignored by us and left to the system.** Losing
  20 px of a 360 px screen costs nothing, and a period step that fights the back gesture would be
  unrecoverable.
- **The reorderable backlog list.** No conflict exists today: `ReorderableList` starts its drag from a
  dedicated always-visible control (`onPointerDown` on the per-row reorder button), the drag axis is
  vertical, and the list lives on the Backlog page and the goal page — **not on a lens**. To keep it
  that way as those surfaces evolve, generalise today's `[data-h-scroll]` opt-out marker to
  **`[data-no-swipe]`**: a region that owns its own pointer gestures, whether or not it scrolls,
  marks itself and the lens gesture never fires inside it. The reorder list, any horizontal scroller,
  every `<input>`/`<textarea>` (text-selection drag) and any open `Sheet` are inside it.
- **Multi-touch.** A gesture with more than one active pointer is abandoned, so pinch-zoom and a resting
  palm never step a period.

### 6.4 Direction semantics

**Horizontal — unchanged from what ships, and that matters more than getting it "right" a second
time.** Content follows the finger along a timeline laid out left = earlier, right = later:

| Finger | Result | Agrees with |
|---|---|---|
| right-to-left (`dx < 0`) | **later** period | `›` on the right |
| left-to-right (`dx > 0`) | **earlier** period | `‹` on the left |

**Vertical — swipe down zooms out, swipe up zooms in.** The reasoning is that all three routes must
agree, and two of them already exist:

- The **Zoom sheet** lists the ladder top-to-bottom `Life · Yearly · Quarterly · Monthly · Weekly`, so
  *up the list* is *longer horizon*.
- The **keyboard** is `Shift+↑` = zoom out, `Shift+↓` = zoom in (`LensScreen.tsx:271-272`).
- Content follows the finger, so **dragging down pulls in what sits above** — which is the longer
  horizon in both the sheet and the keys.

So: **swipe down = out, toward Life; swipe up = in, toward Weekly.** Down ↔ `Shift+↑` ↔ the row above
in the sheet. Three routes, one mental model.

### 6.5 Thresholds

| | Lens row band | Lens body |
|---|---|---|
| Commit travel | **64 px** on the dominant axis | **64 px** |
| Dominance | dominant axis > 1.5 × the other | dominant axis > 2 × the other |
| Time bound | **600 ms** | 600 ms |
| Edge dead zone (horizontal) | 20 px from either edge | 20 px |
| Pointer types | `touch`, `pen` | `touch`, `pen` |

Dominance is 1.5× in the band because neither axis belongs to the browser there, and 2× on the body
because vertical does. The 600 ms bound is what stops "I rested my thumb and it moved a month" — a
drag slower than that is a hesitation, not a swipe.

### 6.6 Snap, not animate

**Nothing animates.** No follow-the-finger transform, no slide-in, no spring settle. On threshold
crossing the header repaints per §2 and the content area does what §3 says. Three reasons:

1. A follow-the-finger transition would **add** latency to the one thing the owner said should not
   take time. With A shipped the repaint is already immediate; an animation makes it slower on
   purpose.
2. Sliding a neighbouring period in requires **having** that period's content, which is a speculative
   prefetch and a second data path (§9.5) — and rendering the wrong content while the finger is down
   is §3's R1 violated for the duration of a drag.
3. It would be the **first animation in the product**, and therefore the first
   `prefers-reduced-motion` branch, the first thing to get wrong on a mid-range phone, and the
   precedent every later feature cites. `14-redesign` §10 already refused a zoom transition on these
   grounds; nothing here reopens it.

**A gesture that falls under threshold does nothing, and nothing moved during it.** That is honest —
there was no rubber-band to snap back — and it is exactly today's behaviour, which has not been
complained about.

**No haptics.** `navigator.vibrate` is unsupported in iOS Safari and therefore in an installed PWA
there; a confirmation that fires on one of the owner's devices and not the other is worse than none.

### 6.7 Boundaries

| Situation | What happens | Why |
|---|---|---|
| Horizontal swipe on **Life** | Nothing, silently. | Life has no periods. Both chevrons are already rendered **disabled and visible** (R-lens-17), and `#lens-life-no-periods` already says `Life has no periods` for screen readers. A gesture doing nothing on a screen whose equivalent controls are visibly disabled is self-explaining. |
| Vertical swipe **down on Life** | Nothing, silently. | Already at the top of the ladder. |
| Vertical swipe **up on Weekly** | Nothing, silently. | Already at the bottom. |
| Horizontal at any period edge | **There are no period edges.** | R-lens-7 / R-goal-36 — unbounded in both directions, forwards and backwards. |
| Vertical **in** from Life | Lands on the target horizon at the period containing R-lens-18's anchor. | Life is not a reset: it borrows the last anchor held (`ui.anchor ?? clock.today`), which is exactly what `zoomOneStep` does today. |

The two silent vertical boundaries have no visibly-disabled control to explain them, unlike the
horizontal case. Their explanation is one tap away: the Zoom sheet shows the whole ladder with
`aria-current` on the row you are on, so "why did nothing happen" is answerable by the control the
gesture is an accelerator for. Adding an on-screen boundary hint would be a fifth escalation
(R-lens-11) for a non-event.

### 6.8 Every gesture's non-gesture equal

**No gesture is ever the only route to anything, and the Zoom sheet stays exactly as it is.**

| Gesture | Equivalents, all always present |
|---|---|
| horizontal swipe | the `‹` / `›` chevrons — never hidden, disabled rather than removed on Life (R-lens-17); `←` / `→` from anywhere in the lens body; `Now ›` and the sheet's `Jump to now` for the return |
| vertical swipe | **the Zoom sheet** — tap the title; this is the primary route and the gesture is the accelerator, not the reverse; `Shift+↑` / `Shift+↓` |

**Discovery.** No coach mark, no hint arrow, no first-run overlay — those are the modals the redesign
removed. The one documentation surface is the Account sheet's existing `Shortcuts` block
(`TopActions.tsx:67-85`), which gains a second table:

```
   GESTURES
   Swipe across                    Earlier or later period
   Swipe up or down on the title   Zoom in or out a lens
```

Words, not arrow glyphs — partly for clarity and partly because §5.3 has just established that half
the arrow glyphs in that component are already rendering in a fallback font.

### 6.9 Wide screen

**There is no gesture on a wide screen, deliberately.**

- The gesture is bound to `pointerType === 'touch' | 'pen'`. A **mouse drag on a page means text
  selection**, and stepping a month because someone dragged across a card would be indefensible.
- A trackpad's two-finger horizontal swipe arrives as `wheel` events, not pointer events. **We do not
  bind `wheel`** — a period change on horizontal wheel would fire on every incidental trackpad
  gesture, which is precisely R-lens-25's "fires when you did not mean it".

So on desktop the chevrons and the keyboard are the whole story, which is what they are today. A
touchscreen laptop gets the touch behaviour, correctly, because it sends touch pointers.

### 6.10 Alternatives rejected

- **Vertical swipe live over the whole lens body, disambiguated by direction and threshold.** This is
  the obvious design and it is the one R-lens-25 already refused. On iOS a `touchmove` on a scrolling
  page is consumed by the scroller; you cannot reliably distinguish a flick-to-scroll from a
  flick-to-zoom, and getting it wrong steals a scroll — the failure the owner would hate most.
- **Vertical gesture at the scroll extremes (overscroll / rubber-band).** "Pull past the top to zoom
  out." It collides with pull-to-refresh, it is unavailable anywhere but the top and bottom of the
  list, and it makes the gesture's availability depend on scroll position, which is unlearnable.
- **A gesture library** (`@use-gesture`, Hammer, Framer). **Argued explicitly, since the brief asks.**
  The hard parts a gesture library exists to solve are multi-pointer arbitration, inertia, nested
  recognisers and cross-browser pointer normalisation. This design has none of them: two zones, one
  axis each in the body, a travel threshold, a dominance ratio, a time bound and an edge dead zone —
  roughly forty lines over `pointerdown` / `pointermove` / `pointerup` with `setPointerCapture`, plus
  two `touch-action` declarations that do the actual disambiguation. A library would also bring its
  own default of animating the drag, which §6.6 refuses. `Sheet.tsx` already declines a focus-trap
  library and `ReorderableList.tsx` already declines a drag-and-drop library, each with the same
  argument. **No dependency.**
- **Swipe up = zoom out** (the "the list scrolls up as you go out" reading). Contradicts `Shift+↑` and
  contradicts the Zoom sheet's ladder. Two of three routes already exist and agree; the gesture joins
  them.
- **Animating the swipe.** §6.6.
- **Haptics.** §6.6.

---

## 7. E — one goal picker

### 7.1 What is there today

Eleven places pick something from a list. Seven of them pick a **goal**, and no two are alike:

| # | Site | Source | Rendering today |
|---|---|---|---|
| 1 | Create goal — `UNDER` | `GoalModals.tsx:152-165` | flat `pickerRow` list, `maxHeight: 200` |
| 2 | Move goal | `GoalModals.tsx:219-232` | flat `pickerRow` list, `maxHeight: 230` |
| 3 | `+` drawer — `GOAL` | `BacklogSheets.tsx:115-129` | **a wrapping wall of `chipBtn` pills, titles only** |
| 4 | `+` drawer — `WHICH WEEKLY GOAL?` | `BacklogSheets.tsx:194-210` | `chipBtn` row |
| 5 | Task create — `WHICH WEEKLY GOAL?` | `BacklogSheets.tsx:352-363` | `chipBtn` row |
| 7 | Move a backlog item | `BacklogItemCard.tsx:78-104` | inline `chipBtn` row, **no selected state at all** |
| 10 | Learning → Life goal | `CaptureScreens.tsx:44-58, 190-215` | `chipBtn` row + a `No goal` chip |

*(Sites 6 and 8 pick a backlog **item**, not a goal; site 9 picks a **horizon**; site 11 picks a
**period**. Out of scope, though 6 and 8 adopt the same row shape so the app has one list idiom.)*

Site 3 is the one the owner named — *"when i add a backlog in goal everything is listed"* — and he is
right that it recurs: sites 3, 4, 5, 7 and 10 are the same flat wall in five places.

**Six properties are missing from all seven:**

1. **No search anywhere.** There is not one text input, `<select>`, combobox or filter-as-you-type in
   the entire web app.
2. **No ancestry.** Sites 1 and 2 render `<title> + HORIZON`; the rest render the title alone. **Two
   Monthly goals with the same name in different Life lines are indistinguishable in every picker in
   the app** — even though `GoalView` carries `lifeRootId` and a rendered `period`, and every lens
   read returns `groups: LifeGroupView[]` with the Life titles in it.
3. **No grouping.** `LifeGroupView` is on the wire and no picker uses it.
4. **No recency**, except a single module-level `lastUsedGoalId` in the drawer (R-backlog-14).
5. **No keyboard model.** Every row is a plain `<button>`; selection is conveyed by background colour
   alone. R-lens-13's one surviving requirement — *"the selection is ANNOUNCED, never merely
   coloured"* — is satisfied by the Zoom sheet and by nothing else.
6. **Truncation is silent.** `useLens` never sends a cursor and always discards `nextCursor`
   (`queries.ts:107-118`), so every picker is capped at the server's `MAX_PAGE` of 200 with no
   indication that anything was dropped.

### 7.2 The design, in two lines

> **One `Sheet`-or-inline component holding a search field over a rule-scoped list, grouped by Life
> goal, every row carrying the goal's line and its period so two similar titles are never
> confusable.**
>
> **The context supplies the rule and nothing else** — which horizons are legal, which periods are
> read, and the empty-state sentence. Everything else about every picker in the app is identical.

> **R-nav-31 (new) — one goal picker.** Every choice of a goal in this product is made in one
> component. A surface that needs a goal chosen supplies a mode; it does not supply a list, a
> rendering or a keyboard model.

### 7.3 The four modes

| Mode | Sites | Lists | Rule |
|---|---|---|---|
| `parent` | 1, 2 | every goal of **strictly longer horizon** than the subject; never the subject itself, never its descendants | R-goal-5, R-goal-32 |
| `backlogHost` | 3, 7 | **Yearly, Quarterly and Monthly only** — never a Life goal, never a Weekly goal | R-backlog-2, R-backlog-26 |
| `weeklyTarget` | 4, 5 | Weekly goals **in one week**, at or under a chosen parent | R-task-41, R-task-49 |
| `lifeLine` | 10 | Life goals only, plus a leading `No goal` row | R-learning-5 |

**Which contexts must filter by rule, and what is wrong today:**

| Context | Legal | Status |
|---|---|---|
| New sub-goal / create goal — parent | strictly longer horizon | correct — but also silently scoped to the *enclosing* period only, so a legal parent in another period is unlistable |
| Move goal — new parent | strictly longer horizon, not itself, not a descendant | horizon ✓, self ✓; **descendants are not excluded client-side** (the server refuses, so it is a hint gap, not a hole) |
| Add a backlog item | Yearly / Quarterly / Monthly | ✓ — but only the **current** period of each, so next quarter's goal cannot be filed under |
| Move a backlog item | as above, minus its current goal | ✓, same period defect |
| Task target | Weekly goals in the target week under the chosen parent | ✓ — but `useWeeklyGoalsUnder` matches `parentId ===` only, so a **level-skipped** Weekly goal (legal under R-goal-32) is never offered |
| Learning attach | Life goals only | ✓ |

The picker's period scope is stated once, for every mode: **the current period at each legal horizon,
plus the period you are currently looking at** (R-lens-18's anchor). Filing from the October lens
offers October's goals. That is one extra scoped read at most, it uses machinery that already exists,
and it follows attention rather than guessing. The three deeper defects above are named for the data
owner in §9.6 rather than designed around here.

### 7.4 The shape

```
   ┌───────────────────────────────────────────┐
   │  Choose a goal                         ✕  │
   │  ┌─────────────────────────────────────┐  │
   │  │ Search goals                        │  │
   │  └─────────────────────────────────────┘  │
   │                                           │
   │  RECENT                                   │
   │  ┌─────────────────────────────────────┐  │
   │  │ Publish four case studies           │  │
   │  │ Be financially independent · Aug 26 │  │
   │  ├─────────────────────────────────────┤  │
   │  │ Three easy runs and one long run    │  │
   │  │ Be genuinely fit at 50 · Aug 2026   │  │
   │  └─────────────────────────────────────┘  │
   │                                           │
   │  BE FINANCIALLY INDEPENDENT               │
   │  ┌─────────────────────────────────────┐  │
   │  │ Set up my AI consultancy and land…  │  │
   │  │ YEARLY · 2026                       │  │
   │  ├─────────────────────────────────────┤  │
   │  │ Sign the first retainer client      │  │
   │  │ QUARTERLY · Q3 2026                 │  │
   │  ├─────────────────────────────────────┤  │
   │  │ Publish four case studies           │  │
   │  │ MONTHLY · Aug 2026                  │  │
   │  └─────────────────────────────────────┘  │
   │                                           │
   │  BE GENUINELY FIT AT 50                   │
   │  ┌─────────────────────────────────────┐  │
   │  │ Run a sub-2h half marathon in 2026  │  │
   │  │ YEARLY · 2026                       │  │
   │  └─────────────────────────────────────┘  │
   └───────────────────────────────────────────┘
```

**Row anatomy** — `S.pickerRow`, two lines, `alignItems: flex-start`:

- **Line 1** — the title, 13.5/600, one line, tail-ellipsis.
- **Line 2** — the disambiguator, 11.5/700 in `T.mut`:
  - *inside a Life-goal group*, where the line is already the header: `<HORIZON> · <period>`;
  - *in `RECENT` and in search results*, where adjacent rows come from different lines:
    `<Life line title> · <period>`.

That is the answer to "showing ancestry so two similarly-named goals are distinguishable": **the Life
line plus the period**, which together are unique in practice. **It needs no new wire field.**
`GoalView` already carries `lifeRootId` and the server-rendered `period`; `LifeGroupView.title` comes
from `LensResponse.groups`, which every lens read already returns and which no picker uses today.

**Grouping and order:**

- Sections: `RECENT`, then one section per Life goal, in the server's `groups` order (the Life goals'
  own `createdAt asc`), with `UNSORTED` last (R-lens-20).
- Headers are `S.sectionLabel` — **the same header the lens uses**, so the picker looks like the
  screen it was opened from.
- **Headers are suppressed when there is exactly one non-empty group.** One rule, two surfaces
  (R-lens-19, generalised).
- Within a group: horizon order (Life → Yearly → Quarterly → Monthly → Weekly), then the server's
  order. That reads the plan top-down, which is how a person thinks about *under what*.

**`RECENT`:** up to 3, most-recently-chosen first, one list shared by every mode — the goal you filed
under last time is the same goal whether you are adding a backlog item or moving one. It renders only
when it would hold **two or more** rows *and* the full list is longer than 8, because below that the
whole list is on screen and `RECENT` would just duplicate rows you can already see. **Recency, not
frequency**: recency is honest, cheap and self-correcting; frequency needs counting and rewards last
month's habits. Held in `UIContext` beside `collapsed` and `anchor`, i.e. **session-scoped**, which
keeps every "what the app remembers" in one place and adds no storage (§11 Q3 offers the
alternative). This generalises R-backlog-14, whose `lastUsedGoalId` it replaces.

### 7.5 Search

- One `<input style={S.input}>`, `aria-label="Search goals"`, placeholder `Search goals`.
- It **filters the already-loaded option set** — no new read fires while typing.
- Matching is case- and diacritic-insensitive on the **title** and on the **Life line title**, ranked
  exactly as the MCP `find_goal` tool already ranks: exact title `1.0`, prefix `0.9`, substring
  `0.75`, `why` substring `0.35`, ties broken by horizon then `createdAt`
  (`apps/api/src/api/mcp/shapes.ts:rankGoals`). **This is the one place I would move existing server
  code into `packages/shared` — a reuse, not a dependency** — so that the assistant and the human get
  the same order for the same words.
- **When the field is non-empty, grouping collapses** to one flat ranked list with the Life line on
  line 2. A ranked list re-sorted into groups is not ranked.
- **The field is never autofocused.** `Sheet` focuses its heading on open, deliberately, *"so a phone
  keyboard does not spring up"*; that reasoning is stronger here than anywhere, because a keyboard
  covering two thirds of a list you were about to scan is worse than one extra tap. It is the second
  tab stop.
- **The field renders only when there are more than 8 options.** Searching a list you can see whole is
  chrome.
- **This does not reopen R-lens-15, R-rm-4 or `14-redesign` §10.** R-lens-15's wording is precise and
  it is worth quoting, because it is the rule this could be read as breaking: *"There are no
  goal-filter pills, no `All` chip, no horizon filter, no pulse filter and no **search-as-filter in
  any lens**."* Every clause is about **a lens** — a screen — and about **persistent filter state a
  user has to remember they set. This picker is not a lens and its search is not state**: it lives
  inside a modal, it resets to empty on every open, and it cannot outlive the choice it was typed
  for. `S-lens-3-3`'s enforceable half — *"no lens read accepts a `goalId` filter parameter"* — is
  also untouched, because the picker adds no parameter to any lens read. That distinction is the whole
  argument and it belongs in R-nav-31's text, not only here.

### 7.6 Inline, field, or sheet

Sites 1 and 3 render their picker **inside a sheet already**, so a picker that is always a sheet
would need a sheet stack — two `aria-modal` dialogs, two focus traps. This design needs none.

**One threshold governs both presentations:**

> **At 8 options a picker stops being a list and starts being a field.**

- **≤ 8 options — the inline list.** A bordered box, `maxHeight: 40vh`, the grouped listbox, no search
  field. This is what the small case gets, and it is *simpler than what ships today*: the same rows,
  minus the chip wall. **The design must not tax the owner's likely reality of ten goals, and this is
  where that promise is kept.**
- **> 8 options — the field.** One row showing the current choice, opening the full picker:

```
   UNDER
   ┌─────────────────────────────────────────┐
   │ Sign the first retainer client          │
   │ Be financially independent · Q3 2026  › │
   └─────────────────────────────────────────┘
```

  With nothing chosen it reads `Choose a goal` in `T.mut`.

**How the full picker opens without stacking sheets: it takes over the sheet it was opened from.**
The create-goal sheet swaps its own body for the picker, its heading becomes `Choose a goal`, and a
back control appears where the heading's left edge was — naming where you came from, exactly as the
task page's back control does:

```
   ┌───────────────────────────────────────────┐
   │  ‹ New Monthly goal                    ✕  │
   │  ┌─────────────────────────────────────┐  │
   │  │ Search goals                        │  │
   │  └─────────────────────────────────────┘  │
   │  …                                        │
```

On choosing or going back, the original body returns with the choice applied and focus lands on the
field. **The sheet never unmounts, so typed work is preserved by construction** — no draft state to
hoist, no `unsaved` prompt, no second focus trap, no z-index stack, and no change to `Sheet` at all.

When the picker is *the whole task* — Move goal, Move a backlog item — it is simply the sheet's only
body, with heading `Move goal` / `Move to another goal` and no back control.

### 7.7 Behaviour at 10, 100 and 1,000

- **10.** No search field, no `RECENT`, one or two groups, headers suppressed at one group. A plain
  list of ten two-line rows — which is what site 1 renders today, minus the confusion. Nothing about
  this design is visible at this size except that the rows now say which line they belong to.
- **100.** The search field appears; `RECENT` appears; groups earn their keep and a person scans four
  headers instead of a hundred rows. **No new read**: 100 options are already in memory, being at most
  four scoped lens reads that are already cached.
- **1,000.** This is where honesty matters more than a mechanism.
  - **No mode of this picker reaches 1,000 without a data pathology.** `parent` and `backlogHost` list
    only **interior** goals — Life, Yearly, Quarterly, Monthly — and R-lens-27 already argues that the
    interior set grows with *the plan*, not with use: roughly one Yearly, four Quarterly and twelve
    Monthly goals per line per year. Ten Life lines for fifteen years is under 600. `weeklyTarget` is
    scoped to **one week**, which bounds it at a handful.
  - **What must not happen is a silent truncation**, which is what happens today: every read is capped
    at `MAX_PAGE = 200` and `nextCursor` is thrown away. So when any underlying read reports a
    `nextCursor`, the picker says so, at the foot of the list:
    `Showing the first 200. Search to narrow it.`
  - For that sentence to be true, **search has to reach past the page**, which needs a server-side
    goal search. That is not mine to design; §9.6 states the requirement and §11 Q5 recommends
    promoting MCP's `find_goal` ranking to an authenticated HTTP read. **Until it exists the picker is
    still correct at every size this product actually reaches** — it just tells the truth at the
    boundary instead of lying quietly.
  - **No virtualisation.** It is a dependency or a hand-rolled windowing layer, it breaks the roving
    tabindex, and 200 rows in a `40vh` scroller is not a performance problem on any phone this app
    targets.

### 7.8 Alternatives rejected

- **Keep the chip wall and make it scroll horizontally.** A horizontal scroller of forty pills hides
  most of the options behind a gesture, has no keyboard story, and — after §6 — puts a
  horizontal-drag region inside a sheet, next to a horizontal-drag gesture that means something else.
- **A `<select>` / native picker.** Cannot render two lines, cannot group by anything but `optgroup`
  with no styling, and looks like nothing else in this app.
- **A tree picker.** The tree is the thing the redesign removed (R-lens-1). Grouping by Life goal is
  the flat form of the same information and it is what every other surface already uses.
- **A separate picker per site, kept in sync by convention.** That is the current state, and it is why
  site 1 narrows by Life line while site 2 does not, why site 7 has no selected state, and why
  `lifeGoalsOnly` is fully wired through three files and called by nobody.
- **Autofocus the search field.** §7.5.
- **Frequency ("most used") ordering.** §7.4.
- **Making the picker a route.** R-lens-14: overlays are not routes; a picker is a two-second
  interaction whose URL nobody wants.

---

## 8. Accessibility

The floor from `docs/work/10-a11y-fixes`: focus traps, keyboard parity, 4.5:1 enforced by
`tests/screens/contrast.test.ts`. Nothing here lowers it and nothing here adds a colour.

### 8.1 Focus

| Item | Focus behaviour |
|---|---|
| **A** | **Focus never moves on a period or horizon step.** It stays on whatever caused it — the chevron, the body, nowhere. This is what makes repeated stepping possible; a design that moved focus would break the fifth press. |
| **B** | A skeleton takes no focus and contains no focusable node — it is `aria-hidden="true"` in its entirety, so tab order across a load→loaded transition is *empty, then the real controls*, never *fake, then real*. |
| **C** | Trail order: `Goals` → `…` (when present) → the parent crumb → the cluster. The eyebrow sits **after** the trail and before the `<h1>`, matching its visual position. Opening `Where this sits` traps focus in the sheet and returns it to the `…` button on close (`Sheet`'s existing contract). |
| **D** | A swipe **moves no focus at all**, by design. It leaves focus wherever it was, which has consequences for announcements (§8.2). |
| **E** | Sheet order: heading (`-1`, focused on open) → `‹ Back` when present → `✕` → search field → **the list as one stop** → the form's remaining fields when inline. Choosing returns focus to the field that opened the picker. |
| **F** | None — the marker is `aria-hidden` and is not a stop. |

### 8.2 Announcements

- **A.** The existing single `aria-live="polite"` region, under the rule `14-redesign` §8.2 already
  set: *a navigation moves focus; the live region carries only what focus will not say.* Since a step
  moves no focus, it carries everything — and now it carries it in two beats only when there is
  actually a wait:
  - **Content available in the same frame:** one utterance —
    `Oct 2026, Mon 5 Oct – Sun 1 Nov. 12 goals in 3 groups.`
  - **Content cold:** the period immediately, the payload when it lands —
    `Oct 2026, Mon 5 Oct – Sun 1 Nov. Loading.` … then `12 goals in 3 groups.`
    The period is not repeated in the second utterance; it was just said.
  - A **lens** change still announces via the title button's own accessible name when focus returns to
    it from the sheet, unchanged.
- **B.** The skeleton is silent. The wrapper carries `role="status"` with the strings the retired
  `Loading` component already used, **verbatim**: `Loading this goal…`, `Loading this task…`. On the
  lens the live region above already says `Loading.`, so the skeleton adds nothing and does not
  double-speak.
- **C.** Every crumb's `aria-label` is the **untruncated** title (with its period), because the visible
  text is ellipsised. The `…` button is `Show the full path`. The eyebrow is
  `<Life goal title>. Open goal.` — the pattern `ParentLine` already uses.
- **D.** A swipe produces exactly the announcement a chevron press produces, because it produces
  exactly the same navigation. Since it moves no focus, the live region carries the whole payload —
  which is the case §8.2's rule was written for.
- **E.** The list is `role="listbox"` with `role="option"` rows and `aria-selected`, grouped by
  `role="group"` + `aria-label`. That satisfies **R-lens-13's one surviving requirement — *"the
  selection is ANNOUNCED, never merely coloured"* — which no picker in the app satisfies today.** A
  search that changes the result set announces the count in a `role="status"`, debounced 300 ms so
  typing does not chatter: `12 goals`, `1 goal`, `No goals match "fintech"`.
- **F.** None.

### 8.3 Keyboard equivalents

| Action | Keyboard |
|---|---|
| Step a period | `Tab` to `‹`/`›`, `Enter`/`Space`; or `←`/`→` from the lens body |
| Change horizon | `Tab` to the title, `Enter` → the Zoom sheet; or `Shift+↑`/`Shift+↓` |
| Return to now | `Tab` to `Now ›`; or the sheet's `Jump to now` |
| See the full ancestry | `Tab` to `…`, `Enter` → `Where this sits` |
| Open a picker | `Tab` to the field, `Enter` |
| Move within a picker | `↑`/`↓` between rows (headers skipped), `Home`/`End` to the ends, `Enter`/`Space` chooses |
| Search within a picker | `Tab` to the field; or **type from the list** — the character moves focus to the field and is inserted, so there is one search mechanism, not a separate first-letter jump |
| Leave a picker's search | `Escape` clears a non-empty field; `Escape` on an empty field closes the sheet. Two-stage `Escape`, the shape `Sheet` already uses for unsaved work |
| Reach the picker's options from search | `↓` |

Every one of these has a visible control one `Tab` away. **No gesture is a route and no shortcut is
a floor** — R-lens-25's standing promise, unchanged.

**On the picker's arrow keys.** R-lens-13's surviving accessibility clause asks for *"a single tab
stop with `←`/`→` between options (the roving-tabindex pattern R-backlog-22 already requires)"*. The
single tab stop and the roving tabindex are kept exactly; the **axis follows the list**. The Zoom
sheet's ladder is a five-row column and the picker is a scrolling column, so both take `↑`/`↓` —
which is also what R-backlog-22's own reorder list uses for its vertical list. One pattern, and the
keys point the way the list runs.

### 8.4 Contrast

Nothing here introduces a colour. Skeleton bars are `T.lineSoft` — the token the notice pill already
uses — and they **carry no text**, so `contrast.test.ts`'s 4.5:1 rule is not engaged; they are also
`aria-hidden`, so they are not information either. The eyebrow, the crumbs and the picker's second
line are all `T.mut`, which the test already measures at 4.61:1 on `paper` and 4.99:1 on `card`.

### 8.5 Reduced motion

**Nothing in this document animates.** No shimmer, no pulse, no slide, no follow-the-finger, no
scroll animation, no transition. The app has no animation today and it has none after this. Therefore
`prefers-reduced-motion` has nothing to honour — which is a stated design outcome, not an omission,
and it is the reason three separate decisions above (§3.1 P1, §6.6, §2.3's instant scroll) came out
the way they did.

If any of those is ever reversed, the reversal owns a `prefers-reduced-motion` branch and a second
design, and this paragraph is the place to record that it did.

---

## 9. What this design needs from the period-model and data-flow agent

Stated as requirements, not designs.

1. **A synchronous local period view.** Given `(horizon, periodKey)`, return
   `{ label, weekRange, isCurrent, isPast, currentWeekPeriod }` **without awaiting anything**, from
   `BootstrapResponse.week.weekStart` plus the owner's today. No render in §2 may await it. It walks
   whole weeks from a server-sent Monday; it does not derive one (D-1 intact).

1b. **R-lens-9's zoom mapping, locally too** — otherwise §2.5 is half-built and a horizon change still
   waits. All three of its clauses are already local arithmetic over the anchor the client holds:
   *zoom out* → the period containing the anchor (`containingKey`); *zoom in* → the period containing
   **today** when the current period contains today, else the **first** sub-period (`firstDayOf` +
   `containingKey`); *zoom into Weekly* → the week containing today when today is in that period, else
   the first week whose **Monday** falls in it — which is exactly what `weekForMonth` already computes
   from the server's Monday. Nothing new is derived; the mapping is moved, not invented.
2. **Byte-identical labels.** The local `label` and `weekRange` must match the server's exactly, with
   a test comparing them across a span of periods per horizon. The case that will drift is the
   year-straddling range — `Mon 7 Dec 2026 – Sun 3 Jan 2027` — where the server prints both years and
   September prints none.
3. **A synchronous cache predicate.** "Do I already have data for `(lens, period)`?", answerable in the
   same frame as the input, so §3.2's R2 and R3 are decided before the first paint rather than after
   it.
4. **The forward-content dot must not blink.** `hasForwardContent` arrives with the lens read, so it
   cannot be instant. **It may arrive late; it may never disappear and return.** A marker that blinks
   on every step is worse than one that is 200 ms behind. If that cannot be guaranteed, hold the
   previous value until the new one lands.
5. **Prefetching is your call, and it changes how much of §3 the owner ever sees.** Prefetching one
   period in the last-stepped direction is a single scoped lens read — permitted by R-lens-27, which
   forbids reads returning *every* goal, not scoped ones — and it would make §3.2's R2 the common case
   and skeletons nearly vanish while stepping. Recommended, not required.
6. **Three data facts §7 needs, all of them pre-existing defects:**
   - The `backlogHost` and `parent` modes read only the *current* (or *enclosing*) period, so a legal
     goal in another period is unlistable. §7.3 scopes the picker to "current plus the period you are
     looking at"; anything broader is yours.
   - `useWeeklyGoalsUnder` matches `parentId ===` only, so a level-skipped Weekly goal (legal under
     R-goal-32) is never offered as a task target.
   - `nextCursor` is discarded by every picker. §7.7 needs to *know* it was truncated in order to say
     so. A goal-search read (§11 Q5) is what would let search reach past it.

---

## 10. Rules

### 10.1 New

- **R-lens-30 (the lens header never waits)** — §2.2. The period's label, range, currency and the
  week-elsewhere fact are local and repaint in the same frame as the input. No lens header renders a
  placeholder for a period name; `…` is never a label.
- **R-nav-30 (loading is a skeleton, and only when the identity is cold)** — §3.2's nine rules in
  full: identity, cache-hit, cold, a 150 ms grace, a 400 ms minimum, errors superseding, refetches
  never skeletonising, empty states never skeletonised, one skeleton per screen. Plus §3.1's three
  principles: no motion, never a control, and what is known renders for real.
- **R-nav-31 (one goal picker)** — §7.2. Every goal choice in the product is made in one component;
  the context supplies the rule and nothing else. Includes the transient-search carve-out in §7.5,
  which is the clause that keeps R-rm-4 / R-lens-15 intact.

### 10.2 Changed, and each must be changed deliberately

- **R-lens-25 (one gesture, and its keyboard equal)** — becomes **two** gestures in **two named
  zones**. Its clause *"There is no vertical swipe"* is replaced by §6.2's zoning, which satisfies
  the reason the clause existed rather than overruling it. **If the zoning is not built as specified,
  the old clause stands and the vertical gesture is refused.** The `[data-h-scroll]` opt-out
  generalises to `[data-no-swipe]`.
- **R-goal-41 (the goal detail page)** — the breadcrumb clause is amended: the trail is one line of at
  most `Goals`, `…` and the immediate parent; the Life root moves to an eyebrow; and **the ancestors'
  period labels — which the rule requires and the screen has never rendered — move into the
  `Where this sits` sheet**, where they fit.
- **R-lens-28 / `lens/copy.ts:30`** — *"Both halves are the SERVER's strings"* is no longer true: the
  client formats both. The wire fields stay (the MCP surface and the Zoom sheet still need them) and
  the server stays the reference the client's formatter is tested against. This is the parallel
  agent's rule to move; it is named here because it is this document's copy contract.

### 10.3 Generalised

- **R-lens-19** (suppress the group header when there is one group) → the picker.
- **R-lens-13's surviving requirement** (selection announced, not merely coloured) → **every** picker.
  Today only the Zoom sheet satisfies it.
- **R-backlog-14** (the drawer remembers the last goal, this page load) → the picker's `RECENT`,
  session-scoped, shared across all modes.
- **R-lens-23** unchanged in substance; the parent line clamps to one line (§4.5).

### 10.4 Flagged, not designed

- `lifeGoalsOnly` on the move-goal sheet is wired through `UIContext.tsx:70` → `Sheets.tsx:50` →
  `GoalModals.tsx:217` and **has no caller anywhere**. R-lens-20's `Put under a Life goal…`
  affordance does not exist in the UI. The picker is where it belongs; building it is not in scope.
- The move-goal picker does not exclude the moved goal's own descendants. The server refuses, so it
  is a hint gap rather than a hole — but a picker that offers an illegal option and then refuses it is
  the thing D-5 tolerates and R-goal-19 spent two states trying to avoid.

---

## 11. Copy, verbatim

Sentence case, no exclamation marks, no second-person imperative where a statement will do.

### 11.1 Retired

| Where | Was |
|---|---|
| `LensRow.tsx:39` | `…` as a period label |
| `LensScreen.tsx:177` | `Loading…` |
| `ZoomSheet.tsx:39` | `Loading the lenses…` |
| `GoalDetailScreen.tsx:39` | `Loading this goal…` *(the string survives — as the skeleton's `role="status"`)* |
| `TaskPage.tsx:105` | `Loading this task…` *(same)* |
| `TopActions.tsx:94` | `…` as a placeholder for the account email |

### 11.2 New

| Surface | Copy |
|---|---|
| Skeleton status, goal page | `Loading this goal…` *(unchanged string, new home)* |
| Skeleton status, task page | `Loading this task…` *(unchanged string, new home)* |
| Breadcrumb overflow control | `…` — accessible name `Show the full path` |
| Breadcrumb sheet heading | `Where this sits` |
| Breadcrumb sheet, unsorted note | `These aren't under a Life goal yet.` *(`UNSORTED_NOTE`, reused verbatim)* |
| Breadcrumb sheet, current row | the goal's own title, `aria-current="true"`, not a button |
| Account sheet, gestures block heading | `GESTURES` |
| Account sheet, gesture row 1 | `Swipe across` — `Earlier or later period` |
| Account sheet, gesture row 2 | `Swipe up or down on the title` — `Zoom in or out a lens` |
| Picker sheet heading, generic | `Choose a goal` |
| Picker sheet heading, move a goal | `Move goal` *(unchanged)* |
| Picker sheet heading, move a backlog item | `Move to another goal` *(unchanged)* |
| Picker back control, from a form | `‹ New Monthly goal` — names the sheet you came from, per horizon |
| Picker search field | placeholder and accessible name `Search goals` |
| Picker `RECENT` header | `RECENT` |
| Picker group headers | the Life goal's title, uppercase *(the lens's own `S.sectionLabel`)* |
| Picker row, line 2, inside a group | `YEARLY · 2026` · `QUARTERLY · Q3 2026` · `MONTHLY · Aug 2026` |
| Picker row, line 2, in `RECENT` or search | `Be financially independent · Aug 2026` |
| Picker field, nothing chosen | `Choose a goal` |
| Picker truncation notice | `Showing the first 200. Search to narrow it.` |
| Picker search, no results | `No goals match “fintech”.` |
| Picker announcement, result count | `12 goals` · `1 goal` · `No goals match “fintech”` |
| Picker empty, `parent` | `Nothing to hang this on yet — a monthly goal needs a Life, Yearly or Quarterly goal above it.` *(unchanged)* |
| Picker empty, `parent`, move | `No goal on a longer horizon yet.` *(unchanged)* |
| Picker empty, `backlogHost` | `Nothing to file this under yet — a backlog item needs a Yearly, Quarterly or Monthly goal.` *(unchanged)* |
| Picker empty, `backlogHost`, move | `No other goal can hold it.` *(unchanged)* |
| Picker empty, `lifeLine` | *(the `No goal` row alone, unchanged)* |

**Every empty-state sentence in the picker is an existing one, moved.** Four surfaces already said the
right thing in their own words and there was no reason to rewrite any of them.

### 11.3 Unchanged and load-bearing

`Life` · `Sep 2026` · `Mon 7 Sep – Sun 4 Oct` · `Earlier month` / `Later month` · `Change lens` ·
`Jump to now` · `Now ›` · `Go there ›` · `Past month — still editable` ·
`Future month — planning ahead` · `This week is in Aug 2026` · `Life has no periods` ·
`Monthly lens, Sep 2026 · Mon 7 Sep – Sun 4 Oct. Change lens or period.`

---

## 12. What I deliberately did not do

- **No shimmer, pulse, gradient or fade on any skeleton.** §3.1 P1.
- **No spinner, anywhere.** There is none in the app today.
- **No progress bar at the top of the page.** A third unconditional row (R-nav-27) that says less than
  a spinner.
- **No skeleton for controls.** §3.1 P2. A grey button-shaped block is an affordance that lies.
- **No skeleton sized from history.** Removes one jump and adds a new lie.
- **No follow-the-finger swipe, no page transition, no zoom animation.** §6.6, and `14-redesign` §10
  refused the same thing for the same reasons.
- **No gesture hint, coach mark, tooltip or first-run overlay.** The Account sheet documents them;
  everything they do has a visible control.
- **No haptics.** Unsupported on iOS Safari; a half-working confirmation is worse than none.
- **No pull-to-refresh.** §6.10.
- **No wheel-bound period change on desktop.** §6.9.
- **No mouse-drag gesture.** A mouse drag on a page means selection.
- **No new dependency of any kind** — no gesture library (argued explicitly in §6.10), no drag
  library, no virtualiser, no fuzzy-search library, no focus-trap library. `Sheet.tsx` and
  `ReorderableList.tsx` each already declined one with the same argument.
- **No middle truncation of goal titles.** §4.7 — right for paths, wrong for sentences.
- **No horizontally scrolling breadcrumb.** §4.7.
- **No JavaScript measurement of the breadcrumb.** The depth rule plus flexbox produces the same
  answer without a `ResizeObserver` or a re-layout on font load.
- **No breakpoint anywhere.** Every design in this document is one layout that degrades upward into
  the 640 px column. There is still no desktop layout, and mixing one into this work would make both
  harder to judge — the same call `14-redesign` §10 made and the same one it is still right to make.
- **No new colour token, no new type size, no new visual idiom.** Skeleton bars are `lineSoft`; the
  eyebrow is `S.eyebrow`; picker rows are `S.pickerRow`; picker headers are `S.sectionLabel`; every
  sheet is `Sheet`. The 4.5:1 test cannot be threatened by a document that adds no colour.
- **No new row of chrome.** The lens shell is the same two rows it was. The goal page gains an eyebrow
  and loses two to four wrapped breadcrumb lines — a net reduction.
- **No filter state that survives a screen.** §7.5's search resets on every open, which is what keeps
  it from being the thing R-rm-4 and R-lens-15 deleted.
- **No virtualised list.** §7.7.
- **No sheet stack.** §7.6 — the picker takes over the sheet it was opened from.
- **No picker for backlog *items*** (the pull lists, sites 6 and 8). They pick an item, not a goal.
  They adopt the same row shape so the app has one list idiom, and nothing else about them changes.
- **No new escalation.** The red carry chip is still the only one (R-task-11, R-lens-11). A boundary
  swipe is silent, a stale read is silent, and a truncated list says one calm sentence.
- **No fix for `lifeGoalsOnly` or the descendant exclusion.** Both are flagged in §10.4 and neither is
  in this brief.

---

## 13. Open questions

1. **Skeleton timings.** 150 ms before a skeleton may mount; 400 ms minimum once it does; 550 ms worst
   case.
   `[recommended]` **Those numbers.** 150 ms is the boundary below which a change reads as
   instantaneous, so nothing faster than that ever paints grey; 400 ms is past the point the eye has
   fixated the skeleton, so removing it cannot read as a flicker. They are two constants in one place
   and are cheap to retune once the app is on a real connection.

2. **The picker's one threshold.** Above 8 options the search field appears, `RECENT` appears, and the
   inline list becomes a field.
   `[recommended]` **8.** Roughly one phone screenful of two-line rows inside a sheet, and one number
   to remember instead of three.

3. **`RECENT` lifetime.** Session-scoped in `UIContext`, or persisted across cold starts?
   `[recommended]` **Session.** It keeps every "what the app remembers" in one place beside `anchor`
   and `collapsed`, adds no storage, and does not have to be argued against R-lens-8's *"where you
   were last Tuesday is not where you want to start"*. If a week of use shows the same goal being
   re-found every morning, persisting it is a one-line change.

4. **May the `+` drawer file a backlog item under a goal in a period other than the current one?**
   Today it cannot: it reads the current period of each of three horizons. A backlog item has no
   period of its own, so there is no rule against it — only a read that was never widened.
   `[recommended]` **Yes — the current period, plus the period you are looking at.** One extra scoped
   read at most, and it follows where the owner's attention already is rather than guessing.

5. **A server-side goal search.** MCP's `find_goal` already does exactly this — ranked, filtered by
   `only: 'any' | 'weekly' | 'can_hold_backlog' | 'life'`, and reachable only at `POST /mcp`.
   `[recommended]` **Promote its ranking to `packages/shared` now** so the picker's client-side
   ordering and the assistant's are the same function, and **defer the HTTP read** until the truncation
   line in §7.7 actually fires for the owner. The picker is correct without it at every size this
   product realistically reaches; shipping an endpoint for a case that has not occurred is the kind of
   work R-nav-26 exists to refuse.

6. **Vertical swipe direction.** Down = zoom out toward Life, up = zoom in toward Weekly.
   `[recommended]` **As stated.** It is the only direction that agrees with both routes that already
   exist — the Zoom sheet's ladder and `Shift+↑`/`Shift+↓` — and the alternative would require
   changing one of them.

7. **Should the gesture band include row 1, the top-right cluster?** It would make the band ~110 px
   instead of ~64 px and easier to hit.
   `[recommended]` **No.** Row 1 holds three tap targets, one of which is `+ Monthly goal`. A drag
   that begins on a create button and steps a month is exactly the surprise R-lens-25 was written
   against. The band stays the lens row, and pointer capture already means the band's height does not
   limit the travel.

8. **Does a period step still push a history entry?** It does today (`navigate()` without `replace`),
   so browser-back walks back through the periods. With a swipe, twenty steps is twenty entries.
   `[recommended]` **Keep it.** Back-as-undo is worth more than a short history, and `replace` would
   make the back button leave the app from the screen the owner spends most of his time on — which is
   a worse failure than a long history nobody inspects.

9. **The breadcrumb's `…` overflow control and a truncated crumb's `…` look alike.**
   `[recommended]` **Accept it.** The separators disambiguate them — the control sits in a segment
   slot between two `/`, a truncation sits at the end of a word run — and their accessible names are
   completely different. A second glyph for the control would be a new mark in a product whose icon
   vocabulary §5.3 has just shown is already inconsistent.
