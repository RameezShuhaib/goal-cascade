# 24 — The breadcrumb that never wraps, and the skeleton that never flashes

Items **C** and **B** of `docs/work/22-ux-fixes/UX-PLAN.md`, built on top of item A
(`docs/work/23-instant-periods/build.md`). New rule: **R-nav-30**; **R-goal-41**'s breadcrumb clause
amended (SPEC §2, Amendment 6).

> *"for the contents inside i would want skeleton loader"* … *"there is problem with breadcrumbs if the
> title of the goal is large the is looks messed up. probably add elipsis in middle or pick best practices"*

**558 api / 381 web / 104 shared, all passing.** Typecheck clean across all three workspaces;
`npm run build -w @goal-cascade/web` emits `dist/sw.js` with a 13-entry precache manifest. Nothing under
`apps/api/**` or `packages/shared/**` was touched, and neither were `GoalModals.tsx`, `Sheets.tsx` or
`BacklogSheets.tsx`.

---

## 1. Item A moved the ground under item B, and that is the first finding

The plan for skeletons was written against an app where three things waited on the network: the period's
name, the period's range, and the body. **Item A removed the first two.** `LensRow` no longer renders
`period?.label ?? '…'`; the label, the span, `isCurrent`, `isPast` and the week-elsewhere flag are all
`periodViewOf(horizon, key, today)` and repaint in the same frame as the input. The Zoom sheet renders all
five rows immediately. The create button stopped blinking.

So the honest scope of item B is **narrower than the plan assumed, and better for it**:

| Screen | Waited before A | Waits now |
|---|---|---|
| Lens | header **and** body | the **list**, and nothing else |
| Zoom sheet | everything | only the counts, which R-lens-22 omits when zero — no placeholder needed |
| Goal page | everything | everything but `Goals` and the cluster |
| Task page | everything | everything but the back control and the cluster |

That table is why every skeleton in this change is a **body**, never a page. `GoalPageShell` and the task
page's own header render the known chrome in all three of the grace, skeleton and error states, and the
skeleton fills only the part that is genuinely unknown. It is P3 (*anything the client already knows renders
for real*) applied with A's larger notion of "already knows".

**One consequence worth recording.** UX-PLAN §8.2 B says the lens skeleton is silent *"because the live
region above already says `Loading.`"* — but item A did not add that; `Announcement` still returns `null`
while `data` is undefined. A silent lens skeleton would therefore be a **regression** on today's
`<Loading label="Loading…" />`, which is a `role="status"`. So the lens skeleton carries `Loading…` on its
own status line, which is §3.4's rule (*the strings move onto the skeleton's wrapper, verbatim*) applied to
the third screen as well as the first two. If a future change gives the live region a `Loading.` beat, this
line is the one to delete.

---

## 2. Item C — the trail

### 2.1 The defect, measured

`GoalDetailScreen.tsx:56-64` was a `flexWrap: 'wrap'` row of every ancestor at full length, and the flex
**sibling** of the top-right cluster under `justifyContent: 'space-between'`. With the owner's own data
that is ≈ 100 characters at 12.5/700 — roughly 660 px of text in about 220 px of line — so it wrapped to
three lines *and pushed the cluster and the `<h1>` down the page*. At five levels it was four or five lines
of muted grey above the thing you came to read.

Two facts shaped the fix, and the second is the interesting one. The trail holds **ancestors only** — the
goal's own title is the `<h1>` below it. And **`Crumb` rendered no period label**, though R-goal-41 has
required one since it was written. That clause went unbuilt for as long as it did because *there has never
been room on that line for four periods*, and there still is not.

### 2.2 What was built

```
   Goals / … / Get back under 80kg              ☾ ⌾ + Task     ← one line, never wraps
   BE STRONG AT 60                                              ← S.eyebrow, wraps freely
   Rebuild the gym habit          QUARTERLY · Q3 2026           ← <h1>, wraps to 3 lines
```

`apps/web/src/screens/GoalTrail.tsx` — `GoalTrail` (the `<nav aria-label="Breadcrumb">` and its sheet),
`GoalEyebrow`, and `WhereThisSitsSheet`.

**By depth (`ancestors.length + 1`), and the count never grows:**

| Depth | Trail | `…` | Eyebrow |
|---|---|---|---|
| 1 — a Life goal | `Goals` | — | — |
| 2 — Yearly | `Goals / <the Life root>` | — | — (it is on the line) |
| 3 — Quarterly | `Goals / … / <parent>` | ✓ | the Life root |
| 4 — Monthly | `Goals / … / <parent>` | ✓ | the Life root |
| 5 — Weekly | `Goals / … / <parent>` | ✓ | the Life root |

**Three segments at depths 3, 4 and 5.** That is asserted directly (`getAllByRole('button')` inside the nav
is 3 at each), because "it does not grow with the tree" is the property, not a side effect.

**The five CSS facts that are the actual fix**, each pinned by a test, because a three-segment line still
wraps if the middle segment is allowed to:

- the `<nav>` — `flex: 1 1 auto`, `min-width: 0`, `flex-wrap: nowrap`, `overflow: hidden`
- `Goals` and the `…` — `flex: 0 0 auto`, never truncated
- the parent crumb — `flex: 1 1 auto`, `min-width: 0`, `white-space: nowrap`, `text-overflow: ellipsis`
- the cluster's wrapper — `flex: 0 0 auto`
- the `<h1>` — no `nowrap`, `-webkit-line-clamp: 3`

`min-width: 0` is the one that is easy to omit and fatal to omit: a flex item's default `min-width: auto` is
its content's **intrinsic** width, which is exactly the mechanism by which a 660 px title shoves a 40 px
cluster off the row.

### 2.3 The owner's suggestion, taken at the right granularity

They asked for a **middle ellipsis**, and the answer is *yes for the trail, no for the titles*.

Middle-ellipsis is right for **paths and filenames**, where head and tail are both identifying
(`/Users/…/report.pdf`). It is wrong for **sentences**, where the head carries the meaning and the tail is
a modifier. `Set up my AI c…paying client` is less legible than `Set up my AI consultancy and land a…`,
which is a readable clause. So the *titles* tail-truncate — and the *trail* is middle-collapsed, which is
the owner's own instinct applied where it is correct. Both halves shipped.

### 2.4 `Where this sits`, and the clause that finally got built

The `…` is a real button with the accessible name `Show the full path`; it opens the existing `Sheet`, so
it inherits R-nav-15's whole contract — focus to the heading, trapped, `Escape`/✕/backdrop all close, focus
back to the `…` — **without a second modal pattern being invented for it.**

Inside: every ancestor root → parent, **untruncated, with `HORIZON · PERIOD`**, and the current goal last as
a `<div aria-current="true">` rather than a button, because a breadcrumb to where you already are is a
control that does nothing. Titles wrap freely; this is the one surface where the full name is guaranteed
readable, which is the whole reason the trail is *allowed* to truncate.

On an **UNSORTED** line (`ancestors[0].horizon !== 'Life'`, R-lens-20) the eyebrow is suppressed rather than
naming a Yearly goal as a Life line, and the sheet gains `UNSORTED_NOTE` verbatim above the list.

### 2.5 The two other places a long title broke a line

Both are crumbs in everything but name, and both got the trail's treatment (UX-PLAN §4.5):

- `lens/cards.tsx:ParentLine` — `under <parent title>` was unconstrained and wrapped to three lines *inside
  a card*. One line, tail-truncated. Its `aria-label` already carried the full title **and** its period, so
  nothing is lost.
- `TaskPage`'s context line — `<Life root> · <weekly goal>`, two `linkBtn`s in a wrapping flex. One line,
  no wrap; the weekly goal takes the slack (`flex: 1 1 auto`), the Life root is `flex: 0 1 auto` with a
  96 px floor and gives ground first. R-task-45 requires both tappable and both remain so; both gained an
  explicit `aria-label` carrying the untruncated title.

### 2.6 One existing assertion was rewritten, with a verdict

`goalDetail.test.tsx` — **S-learning-5-1**, which asserted two plain buttons `Be strong at 60` and
`Get back under 80kg`, the shape the wrapping trail rendered.

**Verdict: amended, and it asserts strictly more.** Both ways up still exist — the Life root is now the
eyebrow and the parent is the crumb — and the test now checks each *by accessible name* rather than by
presence: `Get back under 80kg, 2026` (the parent crumb, **with the period clause R-goal-41 has always
required and the screen had never rendered**) and `Be strong at 60. Open goal.` (the eyebrow, following
`ParentLine`'s existing naming pattern). Nothing was removed and nothing was relaxed.

---

## 3. Item B — the skeletons

`apps/web/src/components/Skeleton.tsx`. There was no skeleton component in the codebase; `states.tsx`
argued against one in as many words — *"A skeleton that shimmers would be louder than anything else in this
product."* **That argument is right about shimmer and wrong about skeletons**, and the module says so at
the top, because the next agent will read `states.tsx` first.

### 3.1 The hook is the rule

```ts
useSkeleton(pending: boolean, failed: unknown = null): boolean
```

| Rule | How |
|---|---|
| **R1** identity | React Query's own: a new period is a new key, and `placeholderData` is refused (item A), so the old list is discarded in the same frame as the label. |
| **R2** cache hit | `pending` **must** be `isPending`, never `isFetching`. `isPending` is true only when this key has no data at all. |
| **R3** cold | the only state that reaches the grace timer. |
| **R4** grace, 150 ms | a `setTimeout` that mounts the skeleton; cleared if the data lands first, so a 90 ms read paints nothing. |
| **R5** minimum, 400 ms | `shownAt = Date.now()` at mount; on `pending → false` the hook holds for `400 − elapsed`. |
| **R6** errors supersede | `failed` truthy drops the skeleton in the same render, inside either window. |
| **R7** a refetch never skeletons | falls out of R2: a revalidation, an invalidation and a retry all leave `isPending` false. |
| **R8** never over an empty state | falls out of R2: an empty period is cached content. |
| **R9** one per screen | each screen has exactly one `useSkeleton` call and one early return. |

**The minimum cannot delay content that is already available, and the mechanism is *what arms it*.** It is
armed by the skeleton's **mount**, never by the request. A cache hit never sets `pending`, so no skeleton is
ever painted, so there is nothing to hold open — the hook returns `false` on its first render and never
schedules a timer at all. The only thing 400 ms can ever extend is grey a person has already seen. That is
asserted twice: as a hook (`a hook that was never pending never shows, and never waits`, advanced 1,550 ms)
and through the screens (`stepping to a period already in cache is one repaint`, checked again a full
grace-plus-minimum later, because checking once only proves the skeleton had *gone*).

**The screens gate content on `!skeleton`.** This is R5's point and it is easy to get backwards: a skeleton
that vanished the instant the payload arrived would flash for 40 ms, which is the very defect being fixed.
Once painted it holds the space until its 400 ms are paid, and the content appears when it goes.

### 3.2 Timings, and how they are tested against a clock the suite already pins

Item A's harness fakes **`Date` only** (`toFake: ['Date']`), because faking timers wholesale breaks MSW,
React Query's retries and `userEvent`. So the suite splits the testing the way the code splits:

- the **timing rules** are a state machine, tested as one in `renderHook`, with
  `vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: DEFAULT_NOW })` taken for the
  duration of the test and handed back by `setup.ts`'s `afterEach`. `now:` is the fixtures' instant, so the
  two clocks stay together and item A's layer-3 echo assertion does not fire on the fixture — which is what
  `atInstant` exists to prevent, and this is the same discipline applied to a test that moves *timers*
  rather than the *day*.
- the **product rules** are tested through the real screens over MSW with `delay(400)`, and never assert a
  precise millisecond.

### 3.3 The three skeletons, and what each deliberately omits

- **Lens** — three cards, always. The first card's frame, padding, dot and line metrics are the real first
  card's, so *the top of the list does not jump*; below that, growth is expected and a skeleton that guessed
  twelve cards would be a second lie. No group headers: R-lens-19 suppresses the header when there is one
  group, and how many there are is exactly what is not known.
- **Goal page** — the parent crumb's place, the `<h1>`, the horizon chip's place, one `why` line, two
  generic card rows. **No section labels**: `Sub-goals`, `Backlog` and `From the backlog` each render
  conditionally on the goal's horizon, which is the unknown; printing a heading and taking it away is the
  flicker skeletons exist to prevent.
- **Task page** — title, the two-segment context line, and **nothing below the fold**. The rest of that page
  is a form, and a form made of grey boxes invites a tap into a field that is not there. **No checkbox** —
  `task.completable` is unknown, and a checkbox that appears late beside a title is the one control on this
  page you must not guess at.

P2 is asserted, not asserted-about: `queryAllByRole('button')` inside a skeleton is 0, and the goal page's
`Edit` and `Delete this goal` are checked absent while it is up.

### 3.4 Accessibility — what a screen reader hears

```html
<div role="status" aria-busy="true" data-skeleton="goal">
  <span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Loading this goal…</span>
  <div aria-hidden="true"> …every bar… </div>
</div>
```

**While loading:** one polite announcement of that screen's own sentence — `Loading this goal…`,
`Loading this task…`, `Loading…` — the exact strings the retired `Loading` component used, so a screen
reader hears what it hears today. **When the content arrives:** the busy region unmounts; on the task page
the route change moves focus to the `<h1>` (§8.2, unchanged), and on the lens the existing `aria-live`
region reads the period and its counts.

Everything below the status line is `aria-hidden="true"`, so **no grey block can be announced as content**,
and there is **no focusable node anywhere in a skeleton** — asserted by selector — so the tab order across a
load→loaded transition is *empty, then the real controls*, never *fake, then real* (§8.1 B).

### 3.5 Contrast, handled deliberately rather than by accident

UX-PLAN §3.3 specified `T.lineSoft`. **I measured it and used `T.line` instead**, and the reason is in the
module's doc block:

| Token | light on `paper` | light on `card` | dark on `paper` | dark on `card` |
|---|---|---|---|---|
| `lineSoft` | **1.06** | 1.14 | 1.19 | **1.08** |
| `line` | 1.15 | 1.24 | 1.35 | 1.23 |

`lineSoft` all but disappears on two of the four grounds a bar actually lands on, and a skeleton you cannot
see is not a skeleton. `line` is an existing token — the card border — so **no colour was added**.

A bar **carries no text**, so `tests/screens/contrast.test.ts`'s 4.5:1 rule is not engaged: that rule is
about the legibility of type, and there is no type here. It is also `aria-hidden`, so it is not information
a low-contrast rendering could withhold — everything a skeleton *says* is said by its one visually hidden
status line, which is ordinary `T.mut` on the ground it sits on and is already measured at 4.61:1 / 4.99:1.

### 3.6 Reduced motion

**Nothing added in this change animates.** No shimmer, no pulse, no gradient, no fade, no transition. So
`prefers-reduced-motion` has nothing to honour, which is a stated design outcome rather than an omission —
and, being an outcome, it needs a mechanism:

- a test renders the goal-page skeleton **twice**, once with `matchMedia('(prefers-reduced-motion: reduce)')`
  answering `true` and once `false`, and asserts every node in it has empty `animation`, `animationName` and
  `transition` in both. The app never consults the query, which is the point: there is no branch to get
  wrong, so there is no branch that can be wrong in one direction only.
- a census asserts that `src/components/Skeleton.tsx` and `index.html` contain no `@keyframes`,
  `animation:`, `animationName` or `transition:` in any non-comment line. "We did not add an animation" is
  not self-maintaining; this is.

---

## 4. Tests

**558 api / 381 web / 104 shared.** Web 350 → 381: **+31**, no deletions.

| File | Tests | What |
|---|---|---|
| `apps/web/tests/screens/breadcrumbs.test.tsx` | 14 | depths 1–5; the CSS that is the rule; a 260-character parent title; the `<h1>`'s opposite treatment; `Where this sits` opening, listing every period, trapping focus, closing to the `…`, and navigating; the UNSORTED case; `ParentLine`; the task page's context line. |
| `apps/web/tests/screens/skeletons.test.tsx` | 17 | the grace/minimum/error state machine on pinned timers; a cold lens, goal page and task page with the real chrome underneath; the cache hit that must never flash; a refetch; an empty period; `role="status"` / `aria-busy` / `aria-hidden` / no focusable node; both motion preferences; the no-animation census. |

Two existing tests were touched and neither was weakened:

- `goalDetail.test.tsx` S-learning-5-1 — §2.6 above.
- `instant.test.tsx` — the *comment* saying the body still renders `Loading…` became false, so it was
  corrected; and the assertion `queryByText('Loading…')` after a cached step **gained** a second line,
  `expect(document.querySelector('[data-skeleton]')).toBeNull()`, which is R2 asserted from the prefetch's
  side.

---

## 5. Files

**New:** `apps/web/src/components/Skeleton.tsx`, `apps/web/src/screens/GoalTrail.tsx`, and the two test
files.

**Changed:** `screens/GoalDetailScreen.tsx` (the trail, the eyebrow, the `<h1>` clamp, `GoalPageShell`, the
skeleton), `screens/TaskPage.tsx` (the skeleton, the real back control, the context line),
`lens/LensScreen.tsx` (`Loading` → `LensListSkeleton`, content gated on `!skeleton`), `lens/cards.tsx`
(`ParentLine`), `components/states.tsx` (doc block: what `Loading` is now for), `docs/SPEC.md`.

**Untouched, as instructed:** everything under `apps/api/**` and `packages/shared/**`, and
`components/GoalModals.tsx`, `components/Sheets.tsx`, `components/BacklogSheets.tsx`.

---

## 6. What I did not do, and three things to overrule if you disagree

- **No item D or E.** `Where this sits` renders its `Sheet` from local state inside `GoalTrail` rather than
  through `UIContext.openSheet` / `Sheets.tsx`, specifically to stay out of the goal-picker agent's three
  files. It is the same `Sheet` component with the same contract; if the orchestrator would rather every
  sheet be routed through `UIContext`, that is a five-line move once E lands and it should be made then, not
  now.
- **No `Loading.` beat in the lens live region.** UX-PLAN §8.2 A specifies a two-beat announcement on a cold
  period. That is the lens's live region and item A's territory, and it is not implemented; the lens
  skeleton says `Loading…` on its own status line instead. **Overrule this if you would rather the lens
  skeleton be silent** — but note that silence would be a regression on today's behaviour until §8.2 A is
  built.
- **`T.line`, not `T.lineSoft`.** Deviating from the plan's named token, with the measurements in §3.5.
  Overrule if the plan's token is load-bearing for a reason the measurements do not capture.
- **No skeleton on `BacklogScreen` or the learnings list.** The brief named three surfaces and those are the
  three. `Loading` survives for them and for the in-sheet lists, where §3.4 says it should.
- **No `<h1>` line-clamp fallback for non-WebKit.** `-webkit-line-clamp` is supported in every current
  engine including Firefox and is the only single-property way to clamp; the degradation is a title that
  wraps past three lines, which is the pre-existing behaviour and not a defect.
- **No `ResizeObserver` and no breakpoint.** UX-PLAN §4.6 and §12, unchanged: there is one 640 px column,
  and a trail that grows a segment at 1024 px is a second layout to design, test and keep true.
- **No new dependency, colour token, type size, wire field or modal pattern.**
