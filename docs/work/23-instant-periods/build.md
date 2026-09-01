# 23 — Client-side period identity, instant lens navigation, and the chevron

Items **A** and **F** of `docs/work/22-ux-fixes/UX-PLAN.md`, built to the architecture in
`docs/work/22-instant-periods/PLAN.md`. New rule: **R-lens-30** (SPEC §2, Amendment 5).

> *"changing the horizon or the period shouldn't take time as it doesnt need backend, its the calander
> that can be computed in ui… also the down arrow is missaligned for changing the lense"*

Three causes, all confirmed and all removed:

| Where | What it did |
|---|---|
| `lens/LensRow.tsx:39` | `period?.label ?? '…'` — the header of the entire screen was a literal ellipsis until `GET /goals` landed. |
| `lens/copy.ts:30` | *"Both halves are the SERVER's strings … the client formats no date here"* — the design that made it so. |
| `lens/LensScreen.tsx:74-77` | An effect rewrote `/month` → `/month/2026-09` **after** the response landed, changing the query key and firing a **second** `GET /goals`. Opening a lens cost two round trips and two loading flashes. |

---

## 1. The finding that reframed the whole change

The prohibition being reversed was **half true, and half true is worse than false**.

`apps/web/src/utils/periodKeys.ts` opened with a doc block arguing at length that it was *"not a second
implementation of a date rule"* and that *"there is no `weekStartOfDate` in this client and there must not
be one"*. Line for line, it already was one:

| `apps/web/src/utils/periodKeys.ts` | `apps/api/src/domain/periods.ts` |
|---|---|
| `stepPeriod` | identical, including the `((ord % 4) + 4) % 4` normalisation |
| `firstDayOf` | identical |
| `containingKey` | `periodKeyOf`, with the Weekly branch inlined |
| `weekForMonth` | `weekForMonth` + `firstWeekOf` — same answer, reached by walking whole weeks off a server-sent Monday |
| `weeksBetween` | `weeks.ts:weeksBetween`, identical |
| `dates.ts:addWeeks` | `weeks.ts:addWeeks`, identical |

Roughly 85 lines of duplicated arithmetic, kept in step by hand and by two test files written against the
same expectations. **The drift D-1 warns about already existed**, invisibly, protected by a comment.

So the rule is restated as the one it was reaching for:

> **The client may not hold a *second* implementation of a date rule; it may import the *only* one.**

What R-auth-5 forbids is deriving a day from the **device clock**. `today` is the stored account timezone
applied to the **server's** clock — the same two inputs the server itself uses.

---

## 2. Module layout

### 2.1 What moved

| From | To | Lines |
|---|---|---|
| `apps/api/src/domain/weeks.ts` | `packages/shared/src/calendar/weeks.ts` | 119 (9 of its 11 exports) |
| `apps/api/src/domain/periods.ts` | `packages/shared/src/calendar/periods.ts` | 355 (16 of its 17 exports) |
| — | `packages/shared/src/calendar/period-view.ts` (new) | 60 |

**About 470 lines and 25 functions moved into `packages/shared`**, which is a ~25 % growth of a package
that previously held Zod schemas, constants, error codes and exactly one behavioural function
(`isPeriodKeyFor`). That is the honest cost, and the package's own barrel says so.

The moves are `git mv`, so the diff reads as a move: `periods.ts` is `+44 / −23` and `weeks.ts` is
`+12 / −65` against their old paths, and every one of those lines is a doc block or the split described
below — **not one line of arithmetic changed**.

### 2.2 What stayed behind, and where the line is

`apps/api/src/domain/weeks.ts` survives as **83 lines holding exactly two functions**: `carryWeeks`
(R-task-43's signed carry age) and `isVisibleInWeek` (R-task-7/8/32's week visibility).

They are not calendar arithmetic. They are **read-model policy about work**, and the client already
receives their outputs (`TaskView.carryWeeks`, and a task simply being present in `LensResponse.tasks`)
and must never recompute them. That is the whole line:

> **The calendar is shared vocabulary — both sides must agree on what `2026-09` means. The policy is not
> — only one side is allowed to have an opinion.**

`isPeriodKeyFor` was already on the right side of that line; these 25 functions are its remainder.

### 2.3 Three copies of one predicate became one

- `domain/periods.ts:isPeriodKey` — **deleted**, not moved. Its only caller was `replanPeriods` in the
  same file.
- `common.ts:isMondayKey` — **deleted**, replaced by `calendar/weeks.isMonday`.
- `common.ts:isPeriodKeyFor` — the survivor, and now the only spelling.

That alone is a defect removed rather than a refactor.

### 2.4 The dependency graph

`weeks → nothing` · `common → weeks` · `periods → common` · `period-view → periods`. A DAG.
`packages/shared` ships raw TypeScript (`"main": "./src/index.ts"`), so there was no build step to add and
no `exports` subpath to invent.

### 2.5 The seam: `periodViewOf`

```ts
export type CalendarPeriodView = Omit<PeriodView, 'hasWork'>;
export function periodViewOf(horizon: Horizon, periodKey: string, today: string): CalendarPeriodView;
```

`GoalService.periodView` became `{ ...periodViewOf(horizon, key, today), hasWork }` — a pure refactor,
with `apps/api/tests/lens/period-range.test.ts` unchanged and green. The client calls `periodViewOf`
directly. **There is no third rendering of `isPast` anywhere in the repo.**

`hasWork` is the one field that needs a database, so it is the one field left on the server side of the
seam. `hasForwardContent`, `hasAnyAtHorizon` and every count remain the server's for the same reason, and
none of them is on the critical path of a header.

### 2.6 The decomposition that makes the header instant

**`label` and `weekRange` are pure functions of `(horizon, periodKey)` with no clock at all.** So on the
first paint of a cold, offline, preference-less open, `/month/2026-09` already renders
`Sep 2026 · Mon 7 Sep – Sun 4 Oct` — before the session, the timezone or the network are known.

Only `isCurrent`, `isPast` and `currentWeekPeriod` consult `today`. Those are **badges, not the title**,
and `useCalendarPeriod` renders them as **nothing, never as a wrong guess**, until the owner's timezone is
known. That is what makes the `'UTC'` fallback (§4) govern nothing the owner ever sees.

`packages/shared/tests/calendar.timezone.test.ts` asserts the independence directly: `label` and
`weekRange` are identical for every fixture row whatever day you ask on.

---

## 3. The three anti-drift layers, and how each is proven

The deliverable is the mechanism, so each layer's proof is named beside it.

### Layer 1 — one module. *Prevents* drift.

There is no second implementation left to disagree. **Proven by a census**, because "one module" is not
self-maintaining and the duplicate this change deleted existed for as long as it did *because nothing said
no*:

`packages/shared/tests/no-second-calendar.test.ts` walks every `.ts`/`.tsx` under `apps/web/src`,
`apps/api/src` and `packages/shared/src`, and asserts that **no file outside
`packages/shared/src/calendar/` declares** any of 21 names — `weekStartOfDate`, `periodKeyOf`, `labelOf`,
`weekRangeOf`, `stepPeriod`, `firstDayOf`, `lastDayOf`, `firstWeekOf`, `lastWeekOf`, `zoomTo`,
`dateInTimezone`, `addWeeks`, `weeksBetween`, `periodViewOf` and their siblings. They may be **imported**
anywhere; they may be **declared** in one place.

It is the same class of guard as `apps/api/tests/route-surface.test.ts`. It lives in `packages/shared`
because it is about the relationship between all three packages, and a guard living inside the thing it
guards is one delete away from going quiet.

**It fired on its first run** and found the sixth duplicate — `apps/web/src/utils/dates.ts:addWeeks` —
which the plan had named and which I had missed. A second test in the same file proves the matcher would
actually fire, by running it against the exact declaration shapes this change deleted, and proves it does
*not* fire on an import, a call, or a call alone on a line.

### Layer 2 — a hand-written boundary fixture table. *Detects* drift in CI.

`packages/shared/tests/fixtures/period-boundaries.ts`, ~20 rows of
`{ tz, nowIso, today, horizon, periodKey, label, weekRange, isCurrent, isPast, currentWeekPeriod }`, plus
`STEP_CASES` and `ZOOM_CASES`.

**Every string was worked out from the Monday rule by hand. Nothing was generated from an implementation,
and the file says in its header that a red row may not be fixed by pasting in what the code now returns.**
A fixture copied out of the thing it tests asserts only that the code equals itself.

Consumed by **two tests that do not import each other's code**:

- `apps/api/tests/lens/period-view-contract.test.ts` — drives `GET /goals?lens=&period=` over the **real
  router**, on a `FakeClock` at the row's `nowIso`, with the account's stored timezone set to the row's
  `tz`, and asserts the **wire** `PeriodView`. It asserts the wire and not `periodViewOf`'s return value,
  because the wire is what the client compares itself against.
- `apps/web/tests/lens/period-view-contract.test.ts` — asserts `periodViewOf(horizon, key, ownerToday)`,
  the exact call the header renders from, with `ownerToday` resolved from the row's `nowIso` and `tz`
  through `dateInTimezone`.

If either side drifts from the table, exactly one of the two goes red and names which.

Rows, all required by the task: a month starting on a Monday (`Jun 2026`), a five-Monday month
(`Aug 2026`), December→January with both years printed, a quarter whose first Monday is in the previous
quarter (`2026-Q4`), both 53-ISO-week years (2026 and 2020), the owner's own case (`Sep 2026` on
Tue 1 Sep), both Northern DST transitions, a Southern one (`Pacific/Auckland`), a sub-hour offset
(`Asia/Kathmandu`), both ends of the 26-hour spread (`Pacific/Kiritimati`, `Pacific/Niue`), a
Sunday/Monday boundary in `Europe/Berlin` checked against a device claiming UTC, and Life. **The whole set
runs in a non-UTC zone (`Europe/Berlin`) except where the case is about the zone.**

`packages/shared/tests/calendar.property.test.ts` walks **every date from 2015-01-01 to 2040-12-31** across
all five horizons and asserts seven invariants, of which the fourth is the one the task names and the one
a boundary bug must break:

```
firstWeekOf(h, stepPeriod(h, k, 1)) === addWeeks(lastWeekOf(h, k), 1)
```

Consecutive periods' week ranges **abut with no gap and no overlap**. The `Sep 2026` class of defect — a
client putting the week of Mon 31 Aug in September while the server puts it in August — is exactly a
violation of it. The other six: canonicality, containment, invertibility of stepping, the range's ends
belonging to their own period, lexicographic-is-chronological (which three index reads depend on), and
`weekStartOfDate` being total and idempotent.

### Layer 3 — a runtime echo assertion. *Detects* drift in the field.

`apps/web/src/lens/assertPeriodAgrees.ts`. On every read that carries one, the server's `PeriodView` is
compared field by field against the view the client computed, ignoring `hasWork`.

- **Dev and test: it throws**, naming the field.
- **Production: it warns once per session and defers to the server** for that render — the owner's screen
  stays correct and the disagreement becomes a reported bug instead of a wrong month. Once, not per
  response, because a mismatch is a property of the deployment and not of the request.

**This is the layer a shared module cannot provide.** A shared module cannot drift; a shared module plus an
installed PWA holding a client bundle a week older than the Worker can, and nothing in a monorepo notices.
Severity is why it throws rather than warns in dev: a client that put Mon 31 Aug in September would render
`Sep 2026 · Mon 31 Aug – …` over the server's September, and **nothing would error** — the screen would
simply be quietly wrong for the first days of seven months a year.

**Wired at the query seam, not at call sites**, so every consumer is covered without any of them knowing:
`useLens` (`LensResponse.period`), `useGoal` (`GoalDetailResponse.replanOptions`, and `useGoal` has seven
call sites), `useZoom` (`ZoomResponse.rows`, clock-free — a `ZoomRowView` carries only key, label and
span), and `useBootstrap`, where `assertCurrentMondayAgrees` compares `week.weekStart` against the locally
derived Monday. **That last one is the single live check on the timezone ladder**: if the client's `tz`
resolution were wrong for any reason, every week boundary in the product would be a day out and nothing
else in the app would notice.

#### Which day the comparison is made on — the subtlety that made it usable

**The day the SERVER computed the payload for**, from that response's own `serverNow` in the owner's zone
— *not* the client's current `today`.

This separates two things that would otherwise look identical:

- **Staleness** — a cached payload that was *right when it was made*. At a midnight rollover the client's
  `isPast` moves and the cached response's does not. That is not drift; it is the invalidation not having
  landed yet, a race the design expects and repairs.
- **Version skew** — a payload that was *wrong when it was made*, and is wrong on its own day too.

Comparing against the client's now would fire on every rollover, and an assertion that cries wolf is an
assertion someone deletes. I found this the hard way: the first version threw during the day-rollover
test, on a payload that was entirely correct.

**Proof:** `apps/web/tests/lens/instant.test.tsx` asserts it throws on a wrong `weekRange`, `isPast`,
`label` and `currentWeekPeriod`; is silent on a payload correct for its own instant and **does** throw when
that same payload is presented with an instant that contradicts it; skips the three clock-dependent fields
while the timezone is unknown while still checking the three clock-free ones; and says nothing about Life.

**It also earned its keep immediately.** On its first run it caught that `apps/web/tests/msw/fixtures.ts`
hand-stubbed `PeriodView` from two lookup tables and ignored `?period=` at every horizon but Weekly — so
`/month/2026-11` came back describing `2026-08` with an empty `weekRange`, a payload the real server could
never produce. MSW is a stand-in for the Worker, so the fixture now computes it the way the Worker does:
`{ ...periodViewOf(h, key, today()), hasWork }`. That is not a relaxation of "never generate a fixture from
the implementation" — the table that pins *correctness* is layer 2's, and it is hand-written.

---

## 4. Timezone and day rollover

### 4.1 One `dateInTimezone`, and a fallback ladder that ends at UTC

The client held a second implementation: `utils/dates.ts:todayInZone`, formatting with
`toLocaleDateString('en-CA', { timeZone })` against the server's
`Intl.DateTimeFormat('en-US', { year, month, day }).formatToParts`. They agree on every ICU build anyone is
likely to meet, **and that was the problem**: they agreed by convention, not by construction, and `en-CA`'s
`YYYY-MM-DD` pattern is a locale-data fact.

Per the plan's risk 2, the swap landed **behind an equality test over a zone × instant matrix** —
`apps/web/tests/utils/todayInZone-equivalence.test.ts`, 11 zones × 12 instants including both DST
directions, a leap day and both ends of the offset spread. It is documented as temporary and is deleted
with the next change that touches it.

| Client state | `tz` used | Matches the server because |
|---|---|---|
| `preferences.timezone` known | that value | Same value, same field. |
| Restored from the persisted cache | that value | The blob is keyed per user (`persistKeyFor`). |
| Neither | **`'UTC'`** | `isValidTimezone` fails → the server's middleware uses `'UTC'`. |

**Not the device zone.** `todayInZone`'s catch branch fell back to it, which is precisely the traveller
disagreement R-auth-5 forbids: an owner whose account is `Europe/Berlin`, in Tokyo, would have got Tokyo's
date while the server computed Berlin's. This is a **correction**, and it governs nothing the owner sees,
because of §2.6's decomposition.

`tz` is reported as `null` while unknown, which is deliberately **not** the same as `'UTC'`: a caller can
tell "we do not know yet" from "the owner is in UTC" and suppress a badge rather than guess.

### 4.2 The owner clock

`apps/web/src/lib/ownerClock.ts`, an external store read through `useSyncExternalStore`. It holds one
string, recomputes it, and **notifies only when it actually changed**. Five triggers:

1. **A re-arming `setTimeout` capped at 15 minutes.** Deliberately capped rather than armed to the next
   owner-local midnight: background timer throttling makes a 14-hour timeout unreliable, and a 15-minute
   wake that recomputes one string is free.
2. **`visibilitychange` → visible.** The load-bearing one. An installed PWA backgrounded for two days has
   had its timers frozen; the first thing that happens when the owner looks at it is a visibility change.
3. **`focus`**, for the desktop tab.
4. **`recordServerNow`**, which runs on every response — the near-midnight-with-a-drifted-device case.
   `serverClock` gained one observer slot for it, replacing the `subscribeServerClock` listener *set* that
   walked an empty collection on every response for its whole life because nothing ever subscribed.
5. **`online`**, for the wake from airplane mode.

On a change it invalidates `['goals']`, `['bootstrap']`, `['tasks']` and `['zoom']` — exactly the caveat
`BootstrapResponse`'s own doc block already stated (*"`week.offset` and `carryWeeks` are projections
against `serverNow`"*). Midnight is when that sentence comes due.

**What the owner sees: nothing moves under them.** The URL still names a period, and a period's *identity*
does not change at midnight — its *status* does. Without this the client would keep offering
`+ Weekly goal` on a week that became past, and the write would come back `PERIOD_IN_PAST` with no visible
cause. Tested with both a `visibilitychange` after a backgrounded jump (the PWA case) and a
`recordServerNow` that moves the day backwards across a Berlin midnight.

### 4.3 The current Monday no longer waits for bootstrap

`lib/weekClock.ts` sourced `currentMonday` from `BootstrapResponse.week.weekStart` and was `null` until it
landed, which left `+ Weekly goal` **inert on a cold open** (`periodKeys.ts:129` returned `''`).
`currentMonday = weekStartOfDate(ownerToday)` is the same Monday from the same rule with no query
dependency. `week.weekStart` stays on the wire and became layer 3's timezone check.

---

## 5. What `apps/web/src/utils/periodKeys.ts` lost

**114 lines deleted, 36 added; 172 → 93 lines.** Deleted outright:

| Deleted | Now |
|---|---|
| `stepPeriod` (L58–76) | imported from `@goal-cascade/shared` |
| `firstDayOf` (L79–88) | imported |
| `containingKey` (L96–113) | `periodKeyOf` |
| `weeksBetween` (L140) | imported |
| `weekForMonth`'s body (L146–165) | `firstMondayIn`; the three-argument signature is kept for its two call sites |
| the doc block asserting *"there is no `weekStartOfDate` in this client and there must not be one"* | replaced by the rule it was reaching for |
| `subGoalPeriodKey`'s `currentMonday` parameter and its `''`-until-bootstrap degradation | `periodKeyOf('Weekly', today)` |

And from `apps/web/src/utils/dates.ts`: **`todayInZone`** (the second `dateInTimezone`) and **`addWeeks`**
(the sixth duplicate, found by layer 1's census).

Kept, because it is genuinely client vocabulary rather than calendar: `rank`, `PERIOD_UNIT`,
`enclosingKey`, `subGoalPeriodKey`, `childHorizons`, `validKeyFor`.

**The proof, after the fact.** `apps/web/tests/utils/periodKeys.test.ts` passes with **every assertion
unchanged** and only its import line moved — which is the evidence that the two implementations had agreed
all along, and the last moment at which they could ever be asked.

### The five doc blocks rewritten in this commit

Per PLAN §2.5, because a prohibition that is half true is worse than one that is false — the next agent
reads it, sees `weekStartOfDate` imported two lines below, and either restores the duplicate or deletes the
comment without understanding it:

`utils/periodKeys.ts` · `lib/weekClock.ts` · `utils/dates.ts` · `lens/copy.ts` ·
`docs/work/21-period-ranges/build.md` (marked **SUPERSEDED**, with the distinction spelled out).

---

## 6. One request, one render

`LensScreen` resolves the period **before the first render that fetches**:

```ts
const period = lens === 'Life' ? null : (validKeyFor(lens, params.period) ?? currentPeriodKey(lens, clock.today));
```

`keys.lens(lens, null)` is now **Life-only**. The URL rewrite effect still runs — a copied link must be
absolute — but it fires only when the segment was absent or non-canonical, and `period` is already the key
the read used, so it never changes the query key.

Cache, per PLAN §3.3: `gcTime: 10 * 60_000` on a lens read (a dozen periods stay resident; each payload is
bounded by `MAX_PAGE` and `MAX_WEEKLY_GOALS_PER_WEEK`), and `staleTime: 5 * 60_000` for a **past** period —
which is not a bet that nothing changed but the observation that everything which could change it already
invalidates the `['goals']` prefix.

`useNeighbourPrefetch`: **depth 1** each way on settle, plus one further **in the direction of travel**
after a step. Idle-scheduled via `requestIdleCallback`; skipped on `saveData` and on `slow-2g`/`2g`; never
on Life; and never for a key `stepPeriod` returned unchanged at the format's edge. Depth 1 and not 2
because `GoalService.lens` fires six repository calls and R-lens-27 exists because this read has been the
performance defect before.

**`placeholderData: keepPreviousData` is refused**, per the plan: it would render September's goals under
an October header. A stale list under a fresh label is a lie, not a smoothing trick.

`ZoomSheet` now renders all five rows — horizon, destination label, span, current marker — the instant it
opens, from `zoomTo` + `labelOf` + `weekRangeOf`. Only the counts wait, and R-lens-22 already omits a zero
count, so a late number needs no placeholder. `Loading the lenses…` is deleted.

**The create button stopped blinking.** It was gated on `data !== undefined` because `view` was `null` both
while pending and, legitimately, on Life — two states only the query could tell apart. The calendar answers
both, so the gate is now R-goal-36 alone and the screen's one primary action no longer disappears and
reappears on every step.

---

## 7. The chevron (item F)

`lens/LensRow.tsx`. Four defects, of which the first two are the misalignment the owner reported:

1. **A different font from every glyph beside it.** `▾` is **U+25BE**, and neither Manrope `@font-face`
   block's `unicode-range` contains it — the nearest are `U+2000-206F` and the singletons `U+2191`/`U+2193`.
   It fell through to the platform default sans (SF Pro on iOS, Roboto on Android) while the label beside it
   was Manrope, and the two typefaces disagree about a small triangle's baseline offset and side bearings by
   an amount that **changes with the device**. The step chevrons are unaffected: `‹` and `›` are U+2039 and
   U+203A, inside `U+2000-206F`.
2. **Baseline-aligned against text half again its size** — 13 px inside a 21 px block. Inline boxes align on
   the baseline, so its optical centre sat 4–5 px above it while the label's sat 7–8 px above it.
3. **It inherited `letterSpacing: '-0.01em'`**, applied after the literal space.
4. **It was inside the truncating span.** On a long label (`Week of Mon 4 Jan 2027`) the ellipsis ate it —
   the one affordance saying *this title is a control* vanished precisely when the title was long.

The fix, exactly as UX-PLAN §5.2 specifies — the title line becomes a **flex row, not a text run**:

```
button  flex:1  minWidth:0  textAlign:left
├─ span  display:flex  alignItems:center  gap:6
│  ├─ span  flex:1 1 auto  minWidth:0  nowrap  ellipsis   ← 21/800, letterSpacing -0.01em
│  └─ svg   flex:0 0 auto  8×5  fill:currentColor  color:T.mut  display:block  aria-hidden
└─ span  the range line, unchanged
```

`alignItems: 'center'` is the alignment fix and it is one property. `flex: 0 0 auto` is the disappearance
fix. `gap: 6` replaces the literal space so tracking cannot reach it. The inline `<svg>` removes the
`unicode-range` lottery entirely: one shape, identical on every platform, **no font dependency, no asset,
no library — it is markup**. It stays `aria-hidden`; the button's own name already ends
`Change lens or period.`

**Nothing else about the row changes**: same colour token, same size, same two lines, same two chrome rows,
same accessible name. Pinned by a test that asserts the marker is an `<svg>`, is `flex: 0 0 auto`, is a
**sibling** of the label rather than a descendant, sits in a container whose `alignItems` is `center`, and
that `▾` appears nowhere on screen.

---

## 8. Tests

**Floor met and exceeded: 558 api / 350 web / 104 shared, all passing.** Typecheck clean across all three
workspaces; `npm run build -w @goal-cascade/web` emits `dist/sw.js` with a 13-entry precache manifest.

| | Before | After |
|---|---|---|
| api | 578 | 558 |
| web | 306 | 350 |
| shared | 44 | 104 |
| **total** | **928** | **1012** |

The api count moved because **42 tests moved** to `packages/shared` with the modules they test — the
`carryWeeks` / `isVisibleInWeek` half of `weeks.test.ts` stayed behind as
`apps/api/tests/domain/weeks.test.ts`, since those two functions did — and **22 were added** by the
contract test. `578 − 42 + 22 = 558`, and `44 + 42 = 86` on the shared side.

**That arithmetic is itself a check** (PLAN §7.1): after steps 1–3, which are a pure code move, the total
was invariant at `536 + 86 + 306 = 928`. The three moved test files were byte-identical apart from their
import path and one rename (`isPeriodKey` → `isPeriodKeyFor`, the predicate this change deleted), so
"green with no edits" is the proof that nothing changed. **Nothing was deleted.**

New:

- `packages/shared/tests/fixtures/period-boundaries.ts` — the hand-written table (layer 2).
- `packages/shared/tests/calendar.property.test.ts` — 9,500 days × 5 horizons, 7 invariants.
- `packages/shared/tests/calendar.timezone.test.ts` — DST both hemispheres, sub-hour and extreme offsets,
  a day with no local midnight (`America/Santiago`), the UTC fallback, and the clock-independence of
  `label`/`weekRange`.
- `packages/shared/tests/no-second-calendar.test.ts` — the re-duplication census (layer 1).
- `apps/api/tests/lens/period-view-contract.test.ts` — the table, over the real router.
- `apps/web/tests/lens/period-view-contract.test.ts` — the table, over `periodViewOf`.
- `apps/web/tests/lens/instant.test.tsx` — the header with the network stubbed out, one-request-per-open,
  the echo assertion, the day rollover, the chevron, and the prefetch bounds.
- `apps/web/tests/utils/todayInZone-equivalence.test.ts` — temporary, per risk 2.

### The test harness gained a pinned clock

`apps/web/tests/setup.ts` now fakes **`Date` only** (`toFake: ['Date']`, `shouldAdvanceTime: true`) at the
fixtures' own instant. Faking timers wholesale would break MSW, React Query's retries and `userEvent`'s
scheduling; what needs pinning is the calendar, not the event loop.

This was necessary rather than convenient. Until now the client's "today" reached two places, so the suite
could run against the wall clock — **a test asserting `Aug 2026` was a latent flake that would have started
failing on 1 September, and nobody had met it yet.** `handlers.atInstant(iso)` moves the device clock and
the fixtures' `serverNow` **together**, because moving one makes the two disagree and layer 3 then fires on
the fixture rather than on a defect.

### Two tests were rewritten, each with a verdict

Both encoded rules R-lens-30 supersedes. Neither was weakened; both assert strictly more.

- **`routes.test.tsx` — "the fallback read carries NO period"** (R-goal-34's client-side half, the rule
  that moved). The bug it avoided was a client that *made a period up from its own device clock*. A client
  that computes one from the owner's stored zone through the same module the Worker calls is not making
  anything up, and layer 3 checks it on that very response. Rewritten to assert `/month` still lands on the
  current month, still rewrites the address bar, **and issues exactly one request carrying the period** —
  which pins the defect the change removed.
- **`lenses.test.tsx` — "the create button waits for the read"** (R-nav-25 as implemented). The defect it
  guarded — `periodKey: ''` on a non-Life lens — is now unreachable by construction rather than by a guard,
  because the key comes from the URL and not the payload. Inverted: with the read held open forever the
  button is present **and opens on the right period**, which is a stronger statement than "it is absent".

One expectation changed for a reason worth recording: an empty-state sentence read
`Nothing was set for 2026-Q1.` — the raw **key**, which R-nav-24 forbids on screen. It said that because
the fixture's hand-written `LABELS` table had no entry and echoed the key back. It now reads
`Nothing was set for Q1 2026.`

---

## 9. What I did not do, and one thing to overrule if you disagree

- **No skeletons.** UX-PLAN item B is a parallel agent's. `LensScreen` still renders
  `<Loading label="Loading…" />` for a cold body, so PLAN step 10's body-only skeleton is deliberately
  unbuilt. The `…`-is-never-a-label test is therefore scoped to the **title control** rather than the whole
  document, and says so.
- **No items C, D or E.** Nothing outside `packages/shared/src/calendar/`, `apps/api/src/domain/`,
  `apps/web/src/lens/` and `apps/web/src/utils/period*` was touched except the four shared seams the change
  required: `AppShell` (two hooks mounted once), `api/queries.ts` (the echo wiring and the cache times),
  `lib/serverClock.ts` (one observer slot) and the test harness.
- **`carryWeeks` and `isVisibleInWeek` stayed server-side**, as instructed.
- **To overrule if you disagree:** the pinned test clock is the one change with reach beyond this feature.
  It makes every web test deterministic in time, which is right, but it means a future test that wants a
  different instant must use `atInstant` rather than `vi.setSystemTime` alone — otherwise the two clocks
  disagree and layer 3 throws. That is the assertion working, and it is a confusing way to find out; the
  helper's doc block says so, and `tests/setup.ts` resets both after every test.
