# 22 — Instant period and lens switching

The owner: *"changing the horizon or the period shouldn't take time as it doesnt need backend, its the
calander that can be computed in ui."*

They are right, and the code says so plainly. `apps/web/src/lens/LensRow.tsx:39` reads
`const label = isLife ? 'Life' : (period?.label ?? '…')`, so until `GET /goals` lands the header of the
entire screen is a literal `…`. `apps/web/src/lens/copy.ts:30` records why: *"Both halves are the
SERVER's strings (`PeriodView.label` / `.weekRange`) — the client formats no date here, because it holds
no Monday rule to format one with (D-1)."*

Every field on the header is calendar arithmetic over `(horizon, periodKey, today)`. Not one of them
needs the database.

---

## 1. Recommendation

**The period calendar moves into `packages/shared` as `src/calendar/`, and both sides import the one
implementation** — the same argument that already put `isPeriodKeyFor` in `packages/shared/src/common.ts`
"so the client and the server run the **same** predicate", extended to the rest of the module that
predicate was cut out of. The anti-drift mechanism is three layers, and the first is the only one that
prevents drift rather than detecting it: **one module** (there is no second implementation left to
disagree), then **one hand-written boundary fixture table** that the api test and the web test each check
themselves against without either reading the other's code, then **a runtime echo assertion** — the server
keeps sending `PeriodView` on every lens read, the client compares it against the view it computed, and a
mismatch throws in dev and test and logs once and yields to the server in production, which turns a
version-skewed deployment into a reported bug instead of a wrong month. The server stays authoritative for
everything the calendar cannot answer — `hasWork`, `hasForwardContent`, `hasAnyAtHorizon`, every count —
and none of those is on the critical path of a header. Crucially, `label` and `weekRange` are pure
functions of `(horizon, periodKey)` **with no clock at all**, so the title renders correctly before the
timezone, the preferences or the session are known; only `isCurrent`, `isPast` and `currentWeekPeriod`
need `today`, and they are badges, not the title.

This is *not* "move it to the client". `apps/api/src/domain/periods.ts` is unchanged as a body of logic;
it changes address, and its current address becomes a two-line re-export until its importers are updated.

---

## 2. Module and package layout

### 2.1 What moves

| From | To | Exports moving |
|---|---|---|
| `apps/api/src/domain/weeks.ts` (172 lines) | `packages/shared/src/calendar/weeks.ts` | `isValidTimezone`, `dateInTimezone`, `isMonday`, `weekStartOfDate`, `weekStartOf`, `addWeeks`, `weeksBetween`, `offsetOf`, `weekStartFromOffset` — **9 of 11** |
| `apps/api/src/domain/periods.ts` (334 lines) | `packages/shared/src/calendar/periods.ts` | `periodKeyOf`, `labelOf`, `weekRangeOf`, `firstWeekOf`, `lastWeekOf`, `periodKeyOfCurrentWeek`, `isPastPeriod`, `isCurrentPeriod`, `firstDayOf`, `lastDayOf`, `stepPeriod`, `zoomTo`, `weekForMonth`, `firstMondayIn`, `lastMondayIn`, `replanPeriods` — **16 of 17** |

**About 470 lines and 25 functions**, against `packages/shared/src`'s current 1,863 — a 25% growth of the
package. That is the honest cost, and it is worth naming: `packages/shared` today holds Zod schemas,
constants and error codes, plus exactly one behavioural function (`isPeriodKeyFor`).

### 2.2 What stays behind, and why the line is where it is

**`apps/api/src/domain/weeks.ts` keeps `carryWeeks` and `isVisibleInWeek`.** These are the two functions
in that file that are *not* calendar arithmetic: they are read-model policy (R-task-43's signed carry age;
R-task-7/8/32's week visibility). The client already receives their outputs — `TaskView.carryWeeks`,
and a task simply being present in `LensResponse.tasks` — and must never recompute them, because they are
decisions about work, not about dates. The file survives as `carryWeeks` + `isVisibleInWeek` +
`export * from '@goal-cascade/shared'`'s calendar half, so no api import site changes in step 1.

That is the answer to "whether the domain logic belongs there": **the calendar belongs in shared because it
is shared vocabulary — both sides must agree on what `2026-09` *means* — and the policy does not, because
only one side is allowed to have an opinion.** `isPeriodKeyFor` was already on the right side of that line;
these 25 functions are its remainder.

**`apps/api/src/domain/periods.ts` keeps nothing.** Its 17th export, `isPeriodKey`, is deleted: it is a
third copy of a predicate that already exists twice (`common.ts:isPeriodKeyFor`, and `common.ts:isMondayKey`
inside it). Its only caller is `replanPeriods`, in the same file, which switches to `isPeriodKeyFor`.
`common.ts:isMondayKey` is likewise replaced by `calendar/weeks.isMonday`. **Three copies of one predicate
become one, and that alone is a defect removed rather than a refactor.**

### 2.3 New in shared

```
packages/shared/src/calendar/weeks.ts        (moved)
packages/shared/src/calendar/periods.ts      (moved)
packages/shared/src/calendar/period-view.ts  (new, ~25 lines)
```

`period-view.ts` is the seam that makes the two sides literally the same code path:

```ts
export type CalendarPeriodView = Omit<PeriodView, 'hasWork'>;
export function periodViewOf(horizon: Horizon, periodKey: string, today: string): CalendarPeriodView
```

It is `GoalService.periodView` (`apps/api/src/application/services/goal.service.ts:953`) with `hasWork`
lifted out, because `hasWork` is the one field of `PeriodView` that needs the database. The server becomes
`{ ...periodViewOf(horizon, key, today), hasWork }` and the client calls `periodViewOf` directly. There is
no third rendering of `isPast`.

**Import cycles:** `calendar/weeks.ts` imports nothing (it already documents "Zero runtime imports").
`calendar/periods.ts` imports `Horizon` from `common.ts` (a type) and `HORIZONS` (a value);
`common.ts` imports `isMonday` from `calendar/weeks.ts`. `weeks → nothing`, `common → weeks`,
`periods → common` — a DAG. `period-view.ts` imports the `PeriodView` type from `common.ts` and the
functions from `periods.ts`; still a DAG. All three are added to the `index.ts` barrel.

`packages/shared` ships raw TypeScript (`"main": "./src/index.ts"`), bundled by Vite for the web and
Wrangler for the Worker, so there is no build step to add and no `exports` subpath to invent.

### 2.4 What the web deletes

`apps/web/src/utils/periodKeys.ts` is **already a second implementation**, despite its own doc block
insisting it is not. Line for line:

| `apps/web/src/utils/periodKeys.ts` | `apps/api/src/domain/periods.ts` |
|---|---|
| `stepPeriod` (L58–76) | `stepPeriod` (identical, including the `((ord % 4) + 4) % 4` normalisation) |
| `firstDayOf` (L79–88) | `firstDayOf` (identical) |
| `containingKey` (L96–113) | `periodKeyOf` (identical except the Weekly branch, which returns the key rather than calling `weekStartOfDate`) |
| `weekForMonth` (L146–153) | `weekForMonth` + `firstWeekOf` (same answer, reached by walking whole weeks off a server-sent Monday instead of by `weekStartOfDate`) |
| `weeksBetween` (L140) | `weeks.ts:weeksBetween` (identical) |
| `dates.ts:addWeeks` (L27–31) | `weeks.ts:addWeeks` (identical) |

Roughly 85 lines of duplicated arithmetic, kept in step by hand and by two test files that were written
against the same expectations. **The drift the owner's request supposedly risks is a drift the codebase
already carries.** All six collapse to re-exports of the shared functions, and `periodKeys.ts` keeps only
what is genuinely client-side vocabulary: `rank`, `PERIOD_UNIT`, `enclosingKey`, `subGoalPeriodKey`,
`childHorizons`, `validKeyFor`.

`apps/web/src/utils/dates.ts:todayInZone` is also deleted — see §4.

### 2.5 The doc blocks that must change in the same commit

Five files assert, in prose, the invariant this plan reverses. If they are not rewritten with the code, the
next agent restores the duplicate on their authority:

- `apps/web/src/utils/periodKeys.ts:24` — *"There is no `weekStartOfDate` in this client and there must not be one."*
- `apps/web/src/lib/weekClock.ts:16` — the same sentence.
- `apps/web/src/utils/dates.ts:11` — *"there is no `mondayOf(offset)` here"*.
- `apps/web/src/lens/copy.ts:30` — *"the client formats no date here, because it holds no Monday rule"*.
- `docs/work/21-period-ranges/build.md` §"Where the computation lives" — *"A client computation would have had to walk whole weeks off a server-sent Monday — possible, and a second implementation of a date rule."*

The replacement sentence is one line and it is the whole plan: **the client may not hold a *second*
implementation of a date rule; it may import the *only* one.**

---

## 3. Query keys, cache, prefetching

### 3.1 The double fetch that exists today

`LensScreen` reads `params.period`; when the URL is `/month` it is `undefined`, so `useLens(lens, undefined)`
fetches under `keys.lens('Monthly', null)` = `['goals','Monthly',null]`. The read lands, the effect at
`LensScreen.tsx:74` rewrites the URL to `/month/2026-09`, `params.period` becomes defined, the key becomes
`['goals','Monthly','2026-09']` — **a cache miss, a second `GET /goals`, and `q.isPending` true again, so
the screen shows `Loading…` twice.** Every entry through the tab bar (`TabBar.tsx:47` navigates to
`lensPath(ui.lastLens)`, no period), every `Jump to now` (`LensScreen.tsx:155`) and every one-step zoom
(`LensScreen.tsx:87`) does this.

Once the client can name the current period, this disappears: the route resolves the key **before** the
first render that fetches, and `keys.lens(lens, null)` is only ever used for Life, which genuinely has no
period (`LensResponse.period` is `null` there by R-lens-2).

### 3.2 Keys

The existing shape in `apps/web/src/lib/queryClient.ts` is already right and does not change:

```ts
lens:  (lens: string, period: string | null) => ['goals', lens, period] as const,
zoom:  (anchor: string | null)               => ['zoom', anchor] as const,
goalsAll: ['goals'] as const,
```

What changes is the **domain of the second argument**: `period` is `null` only for `lens === 'Life'`.
A non-Life lens read is always issued with an explicit canonical `periodKey`. This is the whole cache win —
one address per period instead of two, and a prefetch that can actually hit.

Add one key for the day-rollover store's dependency, so a tz change re-scopes cleanly:

```ts
// unchanged; noted because `preferences.timezone` is now load-bearing for the client's `today`
preferences: ['me', 'preferences'] as const,
```

### 3.3 Stale and gc times

| Query | `staleTime` | `gcTime` | Why |
|---|---|---|---|
| `['goals', lens, key]`, current or future period | `30_000` (unchanged `READ_MODEL`) | `10 * 60_000` | Unchanged behaviour for the period you are actually working in. |
| `['goals', lens, key]`, **past** period | `5 * 60_000` | `10 * 60_000` | A past period changes only when *you* edit it, and every write path calls `inv(keys.goalsAll)` (`queries.ts:207–232`), which is a prefix invalidation over `['goals']` and therefore already covers every period key. Verified: `applyRefresh` cases `goals` and `all` both do this. |
| `['zoom', anchor]` | `30_000` | default | Counts only; the five labels no longer wait on it (§3.6). |
| `['bootstrap', 0]` | `30_000` | default | Still the source of `week.weekStart`; see §4.3 for why the client stops depending on it for the *current* Monday. |

`gcTime: 10 * 60_000` (up from React Query's 5-minute default) is chosen so that a browse of roughly a
dozen periods stays resident. Each lens payload is bounded — `MAX_PAGE`, and `MAX_WEEKLY_GOALS_PER_WEEK`
caps a Weekly page at 50 goals — so twelve of them is a few hundred kilobytes, not a leak.

`refetchOnWindowFocus: true` stays on globally. It is load-bearing here: it is what repairs a stale
`isPast`/`hasWork` after the PWA has been backgrounded across a day boundary (§4.4).

### 3.4 Prefetching

Swipe navigation makes the next period near-certain, so prefetch **depth 1 in each direction**, and
**depth 1 further in the direction of travel** after a step:

```ts
// apps/web/src/lens/useNeighbourPrefetch.ts (new)
// on q.isSuccess for ['goals', lens, key]:
//   prefetch ['goals', lens, stepPeriod(lens, key, -1)]
//   prefetch ['goals', lens, stepPeriod(lens, key, +1)]
// on step(n): prefetch ['goals', lens, stepPeriod(lens, newKey, n)]   // momentum
```

Rules, each with a reason:

- `queryClient.prefetchQuery({ ..., staleTime: 30_000 })` — matching the read's own stale time, so a
  prefetch of an already-fresh neighbour is a no-op rather than a request.
- **Scheduled in `requestIdleCallback`** (with a `setTimeout(…, 300)` fallback), never in the render pass.
- **Skipped when `navigator.connection?.saveData === true`** and when `effectiveType` is `slow-2g`/`2g`.
- **Never on the Life lens** (no periods) and **never for a period the calendar refuses to represent**
  (§5).
- **Depth 1 only.** The lens read is not cheap — `GoalService.lens` runs `listByLens`, `listInterior`,
  `countOpenVisibleByGoal` and `listVisibleInWeek` in parallel, plus `hasLaterPeriod` and `everAtHorizon`,
  and R-lens-27 exists because this read model has been the performance defect before. Depth 1 triples the
  read load on a step-heavy session; depth 2 quintuples it for a case the momentum prefetch already covers.

### 3.5 What renders while a period's contents load

Three states, and the distinction between the second and the third is the whole "no flash" requirement:

1. **Header** — always immediate. `LensRow` stops taking `period: PeriodView | null` from the query and
   takes the locally computed `CalendarPeriodView`. The `?? '…'` fallback at `LensRow.tsx:39` is deleted,
   not defaulted. Same for `OffNowRow` and `WeekElsewhereRow`: `isPast`, `isCurrent` and
   `currentWeekPeriod` are all calendar facts.
2. **Body, cache hit** — `queryClient.getQueryData(keys.lens(lens, key))` is present (prefetched, or
   visited earlier in the session, or restored from the persisted cache). Render it. React Query does this
   for free once the key is stable: `isPending` is false whenever `data` exists, so a background refetch
   shows the previous *correct* contents rather than a spinner. Requires only that `pending` in
   `LensScreen` is derived as `q.isPending` (already true) and that the key is not being re-created (§3.1).
3. **Body, cache miss** — a **body-only skeleton** with the group/card geometry, in place of the current
   full-screen `<Loading label="Loading…" />`. The chrome above it (both rows, and the create button) is
   already correct and must not unmount.

**`placeholderData: keepPreviousData` is explicitly refused for the lens read.** It would render the
previous period's goals under the new period's header — a screen that says `Oct 2026` over September's
plan. For a list keyed by the thing in the header, keeping previous data is not a smoothing trick, it is a
lie, and it is exactly the class of near-invisible wrongness §6 is about. A skeleton is honest.

### 3.6 The Zoom sheet

`ZoomRowView` is `{ lens, periodKey, label, weekRange, count, isCurrent }`. Five of six fields are
`zoomTo(horizon, anchor, today)` + `labelOf` + `weekRangeOf` + `periodKeyOf` — all now client-side. Only
`count` needs the server. So `ZoomSheet` renders all five rows, named and spanned and marked current, the
instant it opens, and fills the counts in when `['zoom', anchor]` lands; a zero count is already omitted by
the client. The `<Loading label="Loading the lenses…" />` state is deleted. The sheet's own promise —
R-lens-22, *"you see the destination before you commit"* — becomes true immediately rather than after a
round trip.

---

## 4. Timezone and day rollover

### 4.1 The rule that must not change

`apps/api/src/api/middleware/timezone.ts` is unambiguous: when the account has preferences,
`ctx.tz = preferences.timezone` and **`X-Timezone` is ignored** — "an owner travelling in another zone must
still get their home week" (S-auth-5-1). `today = dateInTimezone(ctx.now, ctx.tz)`
(`goal.service.ts:732`). So the client's `today` must be **the stored account timezone applied to the
server's clock**, never the device zone and never the device clock.

### 4.2 One function, one fallback ladder

Today the client has a *second* implementation of `dateInTimezone`:

```ts
// apps/web/src/utils/dates.ts:96 — todayInZone
return at.toLocaleDateString('en-CA', { timeZone: timezone || undefined });
```

versus the server's `Intl.DateTimeFormat('en-US', { year:'numeric', month:'2-digit', day:'2-digit' })
.formatToParts(...)`. These agree on every ICU build anyone is likely to meet, and that is the problem:
they agree by convention, not by construction, and `en-CA`'s pattern is a locale-data fact, not a
guarantee. It is deleted in favour of the shared `dateInTimezone`.

The fallback ladder must mirror the server's exactly:

| Client state | `tz` used | Matches server because |
|---|---|---|
| `usePreferences().data` present | `preferences.timezone` | Same value, same field. |
| Preferences not yet loaded but the persisted query cache has `['me','preferences']` | that value | The persisted cache is keyed per user (`persistKeyFor`), so it is the same account's stored zone. |
| Neither | **`'UTC'`** | `isValidTimezone` fails → server uses `'UTC'`. **Not the device zone** — the current `todayInZone` catch branch falls back to the device zone, which is precisely the traveller disagreement R-auth-5 forbids. |

And the decomposition that makes this a non-event in practice: **the title and the range need no `today`
at all.** `labelOf(horizon, key)` and `weekRangeOf(horizon, key)` are pure functions of the URL. So on the
very first paint of a cold, offline, preference-less open, `/month/2026-09` already renders
`Sep 2026 · Mon 7 Sep – Sun 4 Oct` correctly. Only the badges — `Past month — still editable`,
`This week is in Aug 2026`, and the presence of the create button — wait on `today`, and those are
suppressed (rendered as nothing, never as a wrong guess) until a `tz` is known.

### 4.3 The current Monday

`lib/weekClock.ts` currently sources `currentMonday` from `BootstrapResponse.week.weekStart`. With
`weekStartOfDate` available, `currentMonday = weekStartOfDate(ownerToday)` — derived from the same two
inputs as everything else, with no query dependency, so `subGoalPeriodKey`'s `''`-until-bootstrap
degradation (`periodKeys.ts:129`) goes away and the `+ Weekly goal` affordance stops being inert on a cold
open. `week.weekStart` remains on the wire and becomes an input to the echo assertion (§4.5).

### 4.4 Day rollover in a PWA that has been open for days

A new external store, `apps/web/src/lib/ownerClock.ts`, consumed with `useSyncExternalStore`:

```ts
// state: { tz: string, today: string }
// today = dateInTimezone(nowIso(), tz)     // nowIso() is serverClock's skew-corrected clock
```

It recomputes and, **only if the string changed**, notifies subscribers. Recomputation is triggered by:

1. **A timer armed to the next owner-local midnight.** Computed as
   `Date.parse(`${addDays(today,1)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)` offset against
   `nowMs()` via a binary search on `dateInTimezone` — or, more simply and correctly, a **re-arming
   `setTimeout` capped at 15 minutes** that re-reads `dateInTimezone` each time. The cap is deliberate:
   background timer throttling makes a 14-hour `setTimeout` unreliable, and a 15-minute wake that
   recomputes one string is free.
2. **`visibilitychange` → visible**, and **`focus`**. This is the load-bearing one. An installed PWA that
   has been backgrounded for two days will have had its timers frozen; the first thing that happens when
   the owner looks at it is a visibility change.
3. **`online`**, for the wake-from-airplane-mode case.
4. **`recordServerNow`**, which already runs on every response (`http.ts:440`). If the skew correction
   moves `today`, the store must follow — that is the near-midnight-with-a-drifted-device case.
5. **A `preferences.timezone` change**, subscribed via the `['me','preferences']` query. A traveller who
   updates their home zone gets a new `today` without a reload.

**On a `today` change, the store also invalidates data whose meaning depends on it:**

```ts
qc.invalidateQueries({ queryKey: keys.goalsAll });   // isPast/hasWork/hasForwardContent per period
qc.invalidateQueries({ queryKey: ['bootstrap'] });   // week.offset, carryWeeks are projections
qc.invalidateQueries({ queryKey: keys.tasksAll });   // carryWeeks
qc.invalidateQueries({ queryKey: keys.zoomAll });
```

This is exactly the caveat `BootstrapResponse`'s own doc block already states — *"`week.offset` and
`carryWeeks` are projections against `serverNow`, and a client holding a stale payload must refetch rather
than re-derive them."* The rollover is the moment that sentence comes due.

**What the owner sees when the day rolls over with the tab open.** Nothing moves under them: the URL still
names a period, and a period's *identity* does not change at midnight. What changes is its *status* — the
week they were viewing may become the past week, and a Monthly lens sitting on the current month may pick
up or drop the `This week is in Aug 2026` flag. The header re-renders with the correct badge and the create
button appears or disappears accordingly, which is the honest outcome. Without the store, the client would
keep offering `+ Weekly goal` on a week that became past at midnight and the write would come back
`PERIOD_IN_PAST` — a refusal with no visible cause.

**Crossing a timezone while travelling** changes nothing, by design: the client uses the *stored* zone, so
`today` is the home zone's date, exactly as the server computes it. A traveller in Tokyo at 08:00 whose
account is `Europe/Berlin` sees Berlin's yesterday, and so does the server. That is R-auth-5, and this plan
makes the client agree with it rather than, as `todayInZone`'s catch branch does today, silently fall back
to the device zone.

### 4.5 The echo assertion

`apps/web/src/lens/assertPeriodAgrees.ts` (new, ~30 lines), called wherever a `LensResponse`,
`GoalDetailResponse` or `ZoomResponse` is consumed:

```ts
// compare the server's PeriodView against periodViewOf(lens, key, ownerToday), field by field,
// ignoring hasWork. In DEV/TEST: throw. In PROD: console.warn ONCE per session, and prefer the
// server's value for that render.
```

It costs one object comparison per response and it is the difference between "the two agree because they
share a module" (true until someone ships a client bundle a week older than the server) and "the two are
checked against each other on every read the owner performs". `week.weekStart` from `BootstrapResponse` is
compared against `weekStartOfDate(ownerToday)` the same way, which is the one live check on the timezone
ladder in §4.2 — if the client's `tz` resolution is wrong for any reason, this fires.

---

## 5. Boundaries: which periods are navigable

**There is no product bound in either direction**, and both halves of that are settled rules, not
omissions: R-goal-36 / R-lens-7 removed the forward cap ("any future period is writable at every horizon"),
and R-rm-3 removed the backward clamp along with `WEEK_HISTORY_WEEKS`. `apps/api/src/api/week.ts` documents
both deletions and warns that "a bound in one direction only rebuilds D-24's asymmetry". Neither chevron is
ever disabled. This plan does not reopen that.

**How the client knows past / current / future without asking:** a string comparison against
`periodKeyOf(horizon, ownerToday)`. This is legal precisely because `periodKey` formats are chosen so that
lexicographic order is chronological order — the property `periods.ts`'s own doc block calls
"load-bearing" for three index reads. `isPastPeriod` and `isCurrentPeriod` already exist and move as-is.

**The one bound that does exist is representational, and it needs a guard it does not have.** A period key
is at most 10 characters (`PeriodKey` is `z.string().max(10)`) and a year is `\d{4}`, so the canonical range
is 1000-01-01 … 9999-12-31. `stepPeriod('Yearly', '9999', 1)` returns `'10000'`, which fails
`isPeriodKeyFor`, fails `PeriodKeyParam`, and would be rejected by the server with a 422 — today an
unreachable defect requiring thousands of clicks, but with swipe navigation and an instantly-rendering
header, a fling is exactly how you get there. **`stepPeriod` gains a clamp: a step that would leave the
representable range returns the input unchanged**, so the chevron becomes a no-op at the two ends rather
than producing a key nothing can parse. This is not a product bound (no owner will meet it); it is the
format's own edge, and it belongs in the shared module beside the format.

The forward-content dot (`hasForwardContent`) remains a server fact and lags the header on an uncached
period. That is correct and should be stated in the code: the dot answers "is there anything ahead", which
is a question about data, not about the calendar. It appears when the read lands, and it does not move
anything on screen when it does (it is absolutely positioned inside the chevron, `LensRow.tsx:83`).

---

## 6. Risks

Ordered by how invisible the failure would be.

1. **A period boundary computed differently on the two sides — the near-invisible one.** A client that put
   the week of Mon 31 Aug in September would render `Sep 2026 · Mon 31 Aug – …`, and the goals underneath
   it would be the server's September, which starts on the 7th. Nothing errors. The screen is simply, quietly
   wrong for the first days of seven months a year. **This is the reason for all three anti-drift layers,
   and specifically for the echo assertion:** a shared module cannot drift, but a shared module plus a
   stale client bundle can, and only a runtime comparison catches that. Severity is why the assertion
   *throws* in dev rather than warning.
2. **The `todayInZone` → `dateInTimezone` swap changes the client's "today" silently.** Two different Intl
   calls that agree today. If they ever disagreed — a locale-data difference, an `en-CA` pattern change —
   the effect is an off-by-one day in `isPast`, which strips or restores the create button. Mitigation:
   step 4 lands the swap behind a test that runs *both* implementations over a matrix of zones and instants
   and asserts equality, *then* deletes the old one; the test is deleted with it.
3. **The `'UTC'` fallback replaces a device-zone fallback.** For an owner whose account zone is not UTC and
   whose preferences have not loaded, `today` changes value. This is a *correction* — the device fallback is
   the exact disagreement R-auth-5 forbids — but it is a behaviour change, and near midnight it changes
   which period is `isCurrent`. Mitigated by §4.2's decomposition: no badge renders at all until a `tz` is
   known, so the fallback governs nothing the owner sees.
4. **The `weekStartOfDate` prohibition is reversed.** Five doc blocks say the client must not hold a Monday
   rule. They were right about a *copy* and are wrong about an *import*, but a prohibition that is half
   true is worse than one that is false: the next agent reads `periodKeys.ts:24`, sees `weekStartOfDate`
   imported two lines below, and either restores the duplicate or deletes the comment without
   understanding it. §2.5 makes rewriting all five a required part of the change.
5. **Prefetching triples the load on the most expensive read model.** R-lens-27 exists because this read has
   been the performance defect before, and `GoalService.lens` fires six repository calls. Depth 1,
   idle-scheduled, save-data-aware. If a step-heavy session shows up in the Worker's CPU numbers, the
   momentum-only variant (prefetch in the direction of travel, not both) is the fallback and costs one
   line.
6. **`gcTime: 10 * 60_000` enlarges the persisted cache.** The persisted blob is a single
   `localStorage` string under `goal-cascade.query-cache:<userId>`, and `identityPersister` already swallows
   quota errors ("the cache stays in memory only"). A dozen resident lens payloads is well inside a 5 MB
   budget, but the failure mode is a silent stop to persistence rather than an error, so the step that
   raises `gcTime` should assert the persisted size in a test.
7. **`packages/shared` grows 25% and gains its first substantial body of logic.** It is imported by both the
   Worker and the browser bundle, so 470 lines of pure date arithmetic ships to both. That is the correct
   trade against two copies, but it does mean shared is no longer "schemas and constants", and the package's
   own doc header should say so.
8. **A stale-but-cached past period is shown for up to 5 minutes.** Only reachable if a write happened
   somewhere the invalidation does not cover. Verified that `applyRefresh`'s `goals` and `all` cases both
   invalidate the `['goals']` prefix, which covers every period key; the risk is a *future* write path that
   forgets to declare a refresh.

---

## 7. Test strategy

The deliverable is the mechanism, so the tests are the deliverable's proof. Five layers.

### 7.1 Move-is-a-move (steps 1–2)

`apps/api/tests/domain/weeks.test.ts`, `periods.test.ts` and `period-ranges.test.ts` move to
`packages/shared/tests/` **byte-identical apart from the import path**. Green with no edits is the proof
that nothing changed. The api count drops by exactly the moved tests and the shared count rises by exactly
the same number; the total 578 + 306 + 44 = 928 is invariant across steps 1 and 2, and that arithmetic is
itself the check.

### 7.2 The boundary fixture table — the anti-drift artefact

`packages/shared/tests/fixtures/period-boundaries.ts`: rows of
`{ tz, nowIso, horizon, periodKey, label, weekRange, isCurrent, isPast, currentWeekPeriod }`,
**written by hand from the Monday rule**, never generated from an implementation — the discipline
`docs/work/21-period-ranges/build.md` already used for its `RANGES` table. It is consumed by two tests that
do not import each other:

- `apps/api/tests/lens/period-view-contract.test.ts` — drives `GET /goals?lens=&period=` on a fake clock at
  `nowIso` with `preferences.timezone = tz`, and asserts the wire `PeriodView` matches the row.
- `apps/web/tests/lens/period-view-contract.test.ts` — asserts `periodViewOf(horizon, key, ownerToday)`
  matches the same row, with the owner clock stubbed to the same `nowIso`/`tz`.

If either side drifts from the table, exactly one of the two goes red and names which. Rows required:

| Case | Fixture |
|---|---|
| **Month starting on a Monday** | `Jun 2026` — 1 Jun 2026 is a Monday, so no leading gap: `Mon 1 Jun – Sun 5 Jul` |
| **Five-Monday month** | `Aug 2026` — Mondays 3, 10, 17, 24, 31 |
| **The owner's actual case** | `Sep 2026` on Tue 1 Sep 2026: `Mon 7 Sep – Sun 4 Oct`, `isCurrent`, `currentWeekPeriod = 2026-08` |
| **Year boundary, both years printed** | `Dec 2026` → `Mon 7 Dec 2026 – Sun 3 Jan 2027` |
| **Quarter whose first week belongs to the previous quarter** | `2026-Q4` — 1 Oct 2026 is a Thursday |
| **Quarter/year rollover in `stepPeriod`** | `2026-Q4 → 2027-Q1`, `2026-12 → 2027-01`, and both backwards |
| **53-week year** | 2026 (1 Jan 2026 is a Thursday, so 2026 is a 53-ISO-week year) and 2020. The product keys weeks by Monday and never by ISO week number, so a 53rd week is not a special case in the model — the fixture exists to *prove* that, by pinning `weekRangeOf('Yearly','2026')` and the Monday count it implies. |
| **Zoom in and out across a boundary** | `zoomTo('Weekly', '2026-11-01', today)` → the first Monday *in* November (Mon 2 Nov), never the week of Mon 26 Oct — the correction `periods.ts` documents at length |
| **Life** | `''` everywhere; `stepPeriod('Life', …)` is a no-op |

### 7.3 The property test — what proves boundaries can never disagree

`packages/shared/tests/calendar.property.test.ts`, walking every date from 2015-01-01 to 2040-12-31 (about
9,500 days) across all five horizons. These are the invariants a boundary bug must break:

1. `isPeriodKeyFor(h, periodKeyOf(h, d))` — every derived key is canonical.
2. `firstDayOf(h, k) <= d <= lastDayOf(h, k)` where `k = periodKeyOf(h, d)` — containment.
3. `stepPeriod(h, stepPeriod(h, k, 1), -1) === k` — stepping is invertible.
4. **Partition:** `firstWeekOf(h, stepPeriod(h, k, 1)) === addWeeks(lastWeekOf(h, k), 1)` — consecutive
   periods' week ranges abut with **no gap and no overlap**. This is the single strongest invariant here:
   the `Sep 2026` defect and every one like it is a violation of it.
5. `periodKeyOf(h, firstWeekOf(h, k)) === k` and `periodKeyOf(h, lastWeekOf(h, k)) === k` — the range's
   ends really belong to the period they measure.
6. **Order:** `k1 < k2 ⟺ firstDayOf(h, k1) < firstDayOf(h, k2)` — the lexicographic-is-chronological
   property three index reads depend on.
7. `weekStartOfDate(d)` is always a Monday, and `weekStartOfDate(weekStartOfDate(d)) === weekStartOfDate(d)`.

### 7.4 Timezone and DST

`packages/shared/tests/calendar.timezone.test.ts`, asserting `dateInTimezone` against a hand-written table:

- **A non-UTC zone throughout**, as the task requires: `Europe/Berlin` for the whole fixture set, plus a
  Weekly boundary at 23:30 and 00:30 Berlin time on a Sunday/Monday, checked against a device claiming UTC.
- **Northern DST**: `Europe/Berlin`, 29 Mar 2026 (spring forward) and 25 Oct 2026 (fall back).
- **Southern DST**: `Pacific/Auckland`, so the transition runs the other way in the calendar year.
- **A day with no local midnight**: `America/Santiago`, where the DST shift has historically been at
  24:00 — the case that breaks any implementation constructing a local `Date` at midnight. Ours parses
  `T00:00:00.000Z` and formats through `Intl`, so it is immune; the test pins that it stays immune.
- **Sub-hour and extreme offsets**: `Asia/Kathmandu` (+05:45), `Pacific/Chatham` (+12:45/+13:45),
  `Pacific/Kiritimati` (+14), `Pacific/Niue` (−11) — the two ends of the 26-hour spread, where the client
  and server can be two calendar days apart if either uses the wrong zone.
- **Invalid zone** → `'UTC'`, matching `isValidTimezone`'s contract and the middleware's fallback.

DST is otherwise irrelevant by construction — every arithmetic function parses `T00:00:00.000Z` and every
week is a whole number of days — and one test asserts exactly that: `addWeeks` and `weeksBetween` over a
DST transition give the same answers as over any other week.

### 7.5 Web behaviour

In `apps/web/tests/screens/lenses.test.tsx` and a new `apps/web/tests/lens/instant.test.tsx`:

- **The header renders before any response.** Mount `/month/2026-09` with MSW holding `GET /goals` open;
  assert the title reads `Sep 2026` and the second line `Mon 7 Sep – Sun 4 Oct`, and assert **`…` appears
  nowhere on screen**. That single assertion is the owner's complaint, pinned.
- **One request, not two.** Open `/month` with a request counter; assert exactly one `GET /goals`, and that
  its `period` query parameter is present. This is §3.1's defect, pinned so it cannot return.
- **No loading flash on a cached period.** Step forward, wait for the prefetch, step back; assert the
  skeleton never mounts and the previous cards are continuously in the document.
- **The skeleton, not stale contents.** Step to an uncached period; assert the body shows the skeleton and
  that **no card from the previous period is in the document** — the `keepPreviousData` refusal, pinned.
- **Prefetch happens, and is bounded.** Assert requests for `±1` after settle, and that `±2` is requested
  only in the direction of travel.
- **Day rollover.** Fake timers, `preferences.timezone = 'Europe/Berlin'`, clock at 23:59:50 Berlin on a
  Sunday; advance 20 seconds; assert the Weekly lens's badge flips to `Past week — still editable`, the
  create button disappears, and `['goals']` was invalidated. Repeat with the tab hidden and a
  `visibilitychange` instead of a timer tick, which is the PWA case.
- **The echo assertion fires.** Feed a `LensResponse` whose `PeriodView.isPast` contradicts the calendar;
  assert it throws under test.

### 7.6 A guard against re-duplication

One test in `packages/shared/tests` (or extending `apps/api/tests/review/`) asserting that no file under
`apps/web/src` or `apps/api/src` declares a function named `weekStartOfDate`, `periodKeyOf`, `labelOf`,
`weekRangeOf`, `stepPeriod` or `firstDayOf` — they may only be imported. The current duplication happened
because nothing said no; the same class of guard already exists as `route-surface.test.ts`.

---

## 8. Migration path

Twelve steps. Every one leaves the tree green and is independently revertable; none of them is "and now
the client owns time".

| # | Step | How it is verified |
|---|---|---|
| 1 | Move `weeks.ts` → `packages/shared/src/calendar/weeks.ts`, minus `carryWeeks` / `isVisibleInWeek` which stay. `apps/api/src/domain/weeks.ts` becomes those two plus a re-export. Move its test. | No api import site changes. 928 total tests, redistributed. |
| 2 | Move `periods.ts` → `calendar/periods.ts`. Delete `isPeriodKey` (use `isPeriodKeyFor`); point `common.ts:isMondayKey` at `calendar/weeks.isMonday`. `apps/api/src/domain/periods.ts` becomes a re-export. Move its two tests. | Same. Three copies of the key predicate become one. |
| 3 | Add `calendar/period-view.ts:periodViewOf`; `GoalService.periodView` becomes `{ ...periodViewOf(…), hasWork }`. | Pure refactor: `apps/api/tests/lens/period-range.test.ts` unchanged and green. |
| 4 | Client uses shared `dateInTimezone`. Land it beside `todayInZone` with an equality test over a zone × instant matrix, then delete `todayInZone` and the test together. | Web green; the equality test is the evidence, then it goes. |
| 5 | Add `lib/ownerClock.ts` (`useSyncExternalStore`, the five triggers, the invalidations). `useOwnerToday` reads from it. Nothing else changes yet. | Fake-timer + `visibilitychange` tests; existing screens unaffected. |
| 6 | Add the fixture table (§7.2) and both contract tests, **against the current server behaviour only**. | Both green before any client rendering changes — the baseline the rest of the plan is measured against. |
| 7 | `LensRow` / `OffNowRow` / `WeekElsewhereRow` take the locally computed `CalendarPeriodView`. Delete the `?? '…'`. Rewrite the five doc blocks (§2.5). | The "header before any response" test; every existing accessible-name assertion in `lenses.test.tsx` passes unchanged. |
| 8 | Add `assertPeriodAgrees`, wired to `LensResponse`, `GoalDetailResponse`, `ZoomResponse` and `BootstrapResponse.week`. | A test feeding a doctored payload asserts it throws. |
| 9 | Resolve the period in the route before the first fetch; `keys.lens(lens, null)` becomes Life-only. | The "one request, not two" test. |
| 10 | Body-only skeleton; `gcTime: 10 * 60_000`; the past-period `staleTime`. | The no-flash and no-stale-contents tests; the persisted-size assertion. |
| 11 | `useNeighbourPrefetch`: ±1 on settle, momentum on step, idle-scheduled and save-data-aware. | The prefetch-bounds test. |
| 12 | Zoom sheet renders labels immediately. Delete the six duplicated functions from `utils/periodKeys.ts` and `utils/dates.ts`, re-exporting shared. Add the re-duplication guard (§7.6). | **`apps/web/tests/utils/periodKeys.test.ts` passes unchanged against the shared implementation** — which is the proof, after the fact, that the two implementations had agreed all along, and the last moment at which they could ever be asked. |

Steps 1–3 are a pure code move and could ship alone; 4–6 are infrastructure with no visible effect; 7 is
the step the owner will feel; 8–12 are the cache and the cleanup. If the plan is stopped at step 7 the app
is already instant and still has the echo assertion missing — so 8 should not lag 7 by more than one
commit.
