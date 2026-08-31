# 18 — Finishing the redesign: three wire gaps, and manual backlog ordering

Two pieces of work that share one set of types, done by one owner for that reason.

**Part A** closes the three things `docs/work/17-lens-web/build.md` §6 recorded as *"a field, not a
feature"* — the parent line (R-lens-23), the third empty state (R-lens-24) and the Backlog page's grouping
(R-backlog-13). **Part B** builds the manual per-goal backlog order the API agent deliberately left out
(R-backlog-17 … R-backlog-24), whole: migration, key scheme, relative-move command, MCP tool, and the
keyboard-first front end that R-backlog-22 calls non-negotiable.

**Green:** `api` **549 tests / 44 files** (from 505 / 40), `web` **283 / 25** (from 257 / 24),
`shared` **43 / 1** (unchanged). `typecheck` clean across all three workspaces; `build` emits `dist/sw.js`
with its 13-entry precache manifest. **No new dependency.**

---

## 1. Part A — the three gaps, and the verification that they were gaps

The brief asked each one to be re-checked as a **missing field rather than a client shortcut** before it
was built. All three are. The check and the answer, in each case:

| Gap | Could the client have done it? | Why not |
|---|---|---|
| **R-lens-23** the parent line | **No.** | A lens is one horizon and one period (R-lens-2). A Weekly item's Monthly parent is in a different lens entirely, so it is in neither `items`, `carried` nor `groups` — there is no title in the payload to render. Resolving it meant one `GET /goals/:id` per card, and R-lens-16 / S-lens-16-2 forbid the client holding or walking the interior tree at all. |
| **R-lens-24** the third empty state | **No.** | Nothing on the wire answered *"has this horizon ever held a goal?"*. `hasForwardContent` only looks **forward**, so an account whose quarterly goals are all in the **past** would have been told "Nothing quarterly yet", which is a flat lie. There is no read the client could have made either: the answer spans every period, and every read the client has is period-scoped. |
| **R-backlog-13** the grouping | **No.** | `BacklogItemView` carried a `goalId` and no title. The page guessed the branch path from four lens reads (this year's, this quarter's, this month's, plus Life) and bucketed the misses under `Elsewhere` — a heading that named a client limitation. An item on **last** quarter's goal, or on a goal three months out, was always a miss, and no bounded number of extra lens reads fixes that. |

### 1.1 R-lens-23 — `LensResponse.parents`, a map and not a field per item

```ts
GoalRefView = { id: Ulid, title: string, period: string }
LensResponse.parents: GoalRefView[]      // one entry per DISTINCT parent of items + carried
```

**Why a map and not `item.parent`.** The cap is the argument. A Weekly lens page is bounded by
`MAX_WEEKLY_GOALS_PER_WEEK` — **50 goals in one week** — and those 50 hang off a handful of Monthly goals,
because that is what a month *is*. Denormalising repeats the same title up to fifty times: at the cap that
is roughly **6 kB of mostly duplicate text** against a few hundred bytes for the distinct-parent list. The
map also cannot be *larger* than the denormalised form in the pathological case where every item has its
own parent — it is the same rows minus the repetition — so there is no case in which the choice costs
anything. `tests/lens/parent-and-empty.test.ts` asserts the shape directly: four items on one parent
produce **one** entry.

**The suppression rule is the server's, and it is expressed as an ABSENCE.** R-lens-23 renders nothing when
the parent is the group's own Life goal. Rather than shipping a `suppressed: true` flag, a Life parent is
simply **not put in the map** — so a client that renders every hit it finds implements the rule by doing
nothing. That covers three cases with one sentence and no horizon test on either side: the Yearly lens
(whose items all hang off Life goals), R-goal-32's level-skipped Monthly-under-Life goal, and a dangling
`parentId` (which is also the item that groups under `UNSORTED`).

`period` is carried and used only in the accessible name — `under Lift three times a week, Aug 2026. Open
goal.` The visible line is the title alone, because R-lens-23 says **at most one name**; the period is a
clarification a sighted reader gets from context and a screen-reader user otherwise does not.

**Rendering.** `src/lens/cards.tsx` gained `ParentLine`: `T.mut` at 12.5px, **never** `faint`, a real
`<button>` to that parent's detail page. `PlainCard` was restructured — it used to wrap the whole card in
one button, and a button inside a button is not a control anyone can operate. That restructuring also
fixes the order R-goal-43 pins: **parent line → planned-ness / staleness line → backlog line**, one muted
register, which is what the rule asks for and what the old nesting could not produce.

### 1.2 R-lens-24 — two booleans, and how they avoid a table scan

```ts
LensResponse.hasAnyAtHorizon: boolean   // has this horizon EVER held a goal, in any period?
LensResponse.hasLifeGoals:    boolean   // R-lens-24's precondition
```

**The cost is zero in the common case and one `LIMIT 1` seek in the worst case.** Three steps, in order:

1. **A non-empty page answers `true` with no work at all.** If the lens is rendering goals, the horizon has
   obviously been used.
2. **The four interior horizons are answered from memory.** The lens read already loads the **interior
   tree** once per request (R-lens-27), and by definition that set contains *every* Yearly, Quarterly and
   Monthly goal the account has. `interiorRows.some(g => g.horizon === horizon)` is an array test over rows
   already in hand — **no query**.
3. **Only `Weekly` reaches the database**, and only on an empty page: `hasAnyAtHorizon(userId, 'Weekly')` is
   an exact-prefix `(user_id, horizon)` seek on `ix_goals_lens` with `LIMIT 1`. It never counts and never
   fetches a second row.

`hasLifeGoals` is free by the same route: the interior tree holds every Life goal (R-lens-2). It matters
because R-lens-24 begins *"When the account has Life goals but…"* — without one, `+ Quarterly goal` has no
legal parent to hang off, so a brand-new account must get R-lens-6's cold start instead. That is the half
that is easy to forget and it has its own test.

The copy is UX-PLAN §7.2 verbatim, in `lens/copy.ts#horizonEmptyCopy`. The empty state also carries
`data-empty-state="horizon" | "period" | "past-period"`, so "the three are distinguishable" is checkable
without matching on prose.

### 1.3 R-backlog-13 — the owning-goal labels, and the end of `Elsewhere`

```ts
BacklogItemView.goalTitle: string            // the owning goal's own title
BacklogItemView.lifeGoalTitle: string | null // the head of the branch path; null = chain reaches no Life goal
```

**It costs no read.** A backlog item can only ever hang off a Yearly, Quarterly or Monthly goal
(R-backlog-2), so its owning goal is **always** in the interior set the request already loads, and the Life
root is the same `parentId` walk R-lens-3 does for a lens item (`views.ts#backlogLabelsOf`).

Two structural side-effects worth recording:

- **`toBacklogItemView` was consolidated.** Three copies had grown — `backlog.service.ts`, `goal.service.ts`
  and `task.service.ts` — and these two fields plus `sortKey` would have had to land in all three,
  correctly, three times. There is one now, in `application/services/views.ts`, taking the labels as an
  argument (a projection that reaches for a repository is a projection that will do it once per row).
- **`list_backlog`'s MCP `goal_path` stopped being N detail reads.** It was one `GoalService.detail` per
  distinct goal in the list — each a full detail read with its own interior-tree load — to build a label.
  It reads the two fields off the view now. The output shape is unchanged.

On the client, `BacklogScreen` lost its four lens reads and its `Elsewhere` bucket, and groups by first
appearance in the server's own order. The retired assertion is **inverted, not deleted** (§5).

---

## 2. Part B — the ordering design

### 2.1 The key scheme (`apps/api/src/domain/sort-keys.ts`)

**Twelve zero-padded decimal digits**, gap 1,000,000. `000001000000`, `000002000000`, …

Two properties do all the work:

- **Fixed width means lexicographic order IS numeric order.** SQLite sorts it with no collation and no
  `CAST`, so `ix_backlog_goal_sort (user_id, goal_id, status, sort_key, id)` serves the list in order with
  no filesort. Variable width would sort `9` after `10`, which is the classic version of this bug and is
  asserted against directly in `tests/domain/sort-keys.test.ts`.
- **The space between neighbours is halved, never renumbered.** A reorder writes **one row**. A position
  index would rewrite every row below the insertion point on every move and is racy against a concurrent
  one — which is exactly why R-backlog-19 refuses it.

**Where things land** (R-backlog-18, R-backlog-20):

| Event | Key |
|---|---|
| capture on a goal | `mid(0, currentTop)`, i.e. the **top**; `000001000000` on an empty goal |
| Move-to-Backlog exit (`task.service.ts`) | the same rule — there is one answer to "where does a new item go" and this is not an exception to it |
| move to another goal | a **fresh** key at the top of the destination; the old position is not preserved, because a per-goal order has nothing to preserve it against (R-backlog-21) |
| conversion, delete | **a gap.** No sibling is re-keyed, and a converted row keeps its key where it stops participating in any order |

**Renumbering behaviour.** `between()` answers `null` — never a duplicate key — when two neighbours are
adjacent. That is the caller's cue to `rekey`: the whole goal's list is renumbered onto the default grid
**in the order it is already in**, inside the *same* `GuardedBatch` as the move that needed it, so no order
changes and the client is told nothing. It takes **~20 successive drops into the same gap** to reach it
(asserted). The re-key writes `sort_key` alone — no `version` bump, no `updatedAt` — because it is
invisible, the client never holds a key to go stale, and bumping the version would make another device's
pending title edit lose a race to a write nobody can see.

**No unique index, deliberately.** R-backlog-17 makes the order total with `sortKey` asc → `capturedAt` desc
→ `id` desc *precisely so* two captures in the same millisecond resolve instead of one failing to write. A
unique index would turn a tie into a lost capture. The three-term order is a pure function (`withinGoal`)
and is tested as one.

### 2.2 The migration (`0004_backlog_sort_key.sql`)

Add column → **backfill** → create index, in that order (the index is built once rather than maintained
through a bulk `UPDATE`). Forward-only but non-destructive: nothing is dropped, no row is deleted, no id
changes and **no order changes**.

**The backfill cannot be skipped, and the reason is not obvious.** Leaving every row on `''` produces
*today's exact order*, because the `capturedAt` desc tie-break takes over — so it would look right. It is
not: there would be no key space *above* the first item, so R-backlog-18's "a new capture lands on top"
would re-key the whole list on the very first capture after deploy. Ranking starts **at** 1,000,000 for
that reason.

Rank is a correlated `COUNT(*)` of the rows sorting before this one, deliberately **not**
`ROW_NUMBER() OVER (…)` and not `UPDATE … FROM`: both need a SQLite newer than the oldest D1 build this has
to survive, and a correlated subquery needs nothing. Idempotent via `WHERE sort_key = ''`, which is also
what makes a replay safe against a database that has been live since the migration — an item captured
afterwards has a real key and is left alone (asserted).

`tests/migration/backlog-sort-key.test.ts` rebuilds the pre-migration row state and executes the
migration's **own** statements, read from the `.sql` file and split on the same `--> statement-breakpoint`
marker wrangler uses. Nothing is re-implemented, so a change to the SQL is a change to what it asserts.

### 2.3 The command

`POST /backlog/:id/reorder` — `{ after? | before? | to: 'top'|'bottom' }`, exactly one, plus an optional
`version`. Idempotency-wrapped like every command, which matters more here than most: a reorder is the
write a flaky connection retries, and replaying the original response is what stops a retried "move down
one" from becoming "move down two".

**Never a position index.** An index is a claim about the whole list and is wrong the moment anything else
in it moved — and on a phone, where the other device is the same person's laptop, that is a normal Tuesday.
A neighbour id either still means what it meant or is refused. It is also what lets drag and the keyboard
share one code path: both end up naming the row they landed next to.

**Refused, with the order unchanged** (every one of them before a single write is built): a neighbour on
another goal, a converted neighbour, a neighbour that does not exist, the item naming itself, a converted
item, and a stale `version` (`CONCURRENT_UPDATE`).

**D1 has no interactive transactions**, so the write — the item's new key, and on exhaustion the whole
goal's renumbering with it — goes through `GuardedBatch` as one atomic sequence. The guarded update's own
WHERE clause pins the version, so a lost race rolls the re-key back with it and **no half-renumbered list
can exist**.

**Concurrency.** Two reorders of *different* items each write one row's key, and the order stays total under
`sortKey` / `capturedAt` / `id` whatever the two keys turn out to be — so the worst case is that one of the
owner's two intents lost, never that the list becomes ambiguous or loses a row. That is what
`tests/backlog/ordering.test.ts` asserts: after two racing writes the list is still a permutation of the
same rows and still reads identically twice.

### 2.4 Which lists have a manual order, and which do not

| List | Order | Reorder affordance |
|---|---|---|
| Backlog page, **within** a group | `sortKey` asc, `capturedAt` desc, `id` desc | **yes** |
| Backlog page, the **groups** | newest item's `capturedAt` desc | no — two items on different goals have no relative position |
| Goal detail, a Y/Q/M goal's own block | the goal's manual order | **yes** |
| Goal detail, a **Life** goal's aggregate (R-backlog-12) | `capturedAt` desc across descendants | **no** — S-backlog-21-1, asserted |
| A Weekly goal's pull list (R-backlog-28) | `capturedAt` desc | no — it spans several ancestor goals |

`GET /backlog` flattens the page's **two** rules into one total order server-side (group order by first
appearance, manual order inside each group), so the client groups by first appearance and re-sorts nothing.

---

## 3. Accessibility (`apps/web/src/components/ReorderableList.tsx`)

**The keyboard path is the reference implementation and drag is a second front-end on it** — the inverse of
the usual arrangement, because R-backlog-22 calls drag-only *"a regression on work already completed"*.
Every test in `tests/screens/reorder.test.tsx` drives the feature with arrow keys and **never clicks a
reorder control**.

R-backlog-22's four requirements, and where each one is:

1. **Roving tabindex.** Exactly one reorder control is tabbable; `↑`/`↓` move focus between rows,
   `Home`/`End` to the ends. *Reading note:* the roving group is the **reorder controls**, which is what
   makes the reorder interaction one tab stop; a row's title button remains its own stop, because it is a
   navigation affordance and not part of the reorder list. Removing it would be a regression on something
   R-backlog-22 does not ask for.
2. **A visible, always-rendered `Reorder "<title>"` control**, 44 × 44, never hover-only. Its accessible
   name carries the position (`Reorder "B · induction", position 2 of 3`) — the one number that makes
   "move down" mean something *before* you press anything.
3. **Grab mode.** `Space`/`Enter` picks up; `↑`/`↓` move the row; `Home`/`End` send it to an end;
   `Space`/`Enter` drops and commits; **`Escape` cancels and writes nothing** — the draft is thrown away
   rather than reversed, so there is no path from a cancelled grab to `mutate` at all.
4. **The row menu** — `Move up` / `Move down` / `Move to top` / `Move to bottom`, so the whole feature is
   reachable without ever entering grab mode. **Absent, not disabled** at the ends: a disabled `Move up` on
   the first row invites "why?" on every list.

Focus stays on the moved row's control after a drop, a cancel or a failure, and is never lost to the
document: the control is keyed by item id, so React moves the same element and the browser keeps focus on
it.

**One live region per list** (R-backlog-23): `aria-atomic="true"`, `assertive` **for the duration of a
grab** so successive arrow presses are not swallowed by a polite queue, reverting to `polite` when the grab
ends. The five announcement strings live in one exported object, so a drag and a keypress cannot say
different things. All five are asserted verbatim, including the mode switch in both directions.

**A refused reorder** (S-backlog-19-3) snaps the row back, announces the failure line, and renders a
**non-toast** error beside the list (`FieldError`, `role="alert"`) — Q-14, and R-nav-13's rule that a toast
alone is insufficient for a lost write.

**Contrast.** Zero new colour tokens: the control draws in `body`, the token the app's own menu buttons
already use, on `card` and on the slightly softer `cardSoft` it takes while grabbed. `contrast.test.ts` was
**strengthened**, not left alone — it now recomputes those two ratios in both themes, so "it reuses an
existing token" is a checked fact rather than a claim in a comment.

**Drag, hand-rolled, and why that is safe.** No drag-and-drop library. The three hard parts of one —
collision detection across nested droppables, virtualised lists, cross-container transfer — are all things
this list does not have: it is one flat vertical list within one goal with no cross-list drop target,
because R-backlog-21 says a manual order across goals is not defined and must not be invented. What is left
is comparing a pointer's Y against row midpoints, about twenty lines. A library would also bring its own
keyboard sensor, and this list's keyboard behaviour is specified down to the announcement string, so it
would have to be overridden anyway. Touch needs **no long-press**: `touch-action: none` on a 44px control
is enough, and a long-press requirement would make the touch path strictly worse than the keyboard one
(R-backlog-24). A press that does not move is a click, so touch gets grab mode too.

---

## 4. The MCP surface

- **New tool `reorder_backlog_item`** — `{ item_id, after_item_id? | before_item_id? | to }`, the same
  exactly-one-of refine as the HTTP schema. Its description states outright that there is no position
  number *and never will be*, why (an index is a claim about the whole list), and that reordering a list
  the owner did not ask about is not a tidy-up an agent should perform on its own.
- **Four descriptions updated because their rule changed** — a stale one teaches a connected agent a rule
  that no longer holds:
  - `list_backlog` — "newest first" became the two-order rule, with the explicit warning **not** to present
    the backlog as one ranked sequence, because there is no order across goals;
  - `create_backlog_item` — a new item lands at the **top**, above anything arranged by hand;
  - `move_backlog_item` — the manual position does **not** travel with the item;
  - `update_backlog_item` — it cannot change a position and there is no field for one;
  - `convert_backlog_item_to_task` — conversion leaves a **gap**, nothing is renumbered.
- **The server instructions block** gained four sentences in `BACKLOG AND LEARNINGS`. It is pinned byte for
  byte by `tests/mcp/verbatim.test.ts` against `docs/research/MCP-TOOL-SURFACE.md` §5, so **both copies were
  edited identically** and the test is untouched — it is what proved the edit landed in both.
- The tool census moved 36 → 37 and the cross-account scoping census gained a `reorder_backlog_item` row
  with B's id in **both** slots — the item and the neighbour — because a neighbour lookup that forgot the
  owner scope would itself be a read.

---

## 5. Tests retired, with verdicts

| Retired assertion | Verdict |
|---|---|
| `D-27` — *"an item whose goal is not in any page the client holds falls under `Elsewhere`"* (`web/tests/screens/backlog.test.tsx`) | **R-backlog-13.** The bucket was never a product rule; it was the honest rendering of a **wire gap**, and D-27's actual position — *surface it, never drop it* — is untouched and now better served. **Inverted in place:** an item on a goal in no lens page the client holds must show its own exact branch path, and the word `Elsewhere` must appear nowhere. A second case covers R-lens-20's rootless chain, which renders the goal's own title and still is not bucketed. |

Nothing else was retired. Two tests were **strengthened**:

- `contrast.test.ts` gained the reorder control's two ratios in both themes (above).
- `taskPage.test.tsx` S-task-45-2's final assertion moved from `expect(await findByText(…))` to
  `waitFor(() => expect(getByText(…)))`. **This is a fix, not a relaxation, and the flake pre-dates this
  build** — it reproduces at `HEAD`. Arriving on that screen settles through **two** reads (R-lens-14: the
  lens rewrites the address bar to the server's canonical period key and loads *that*), so the body is
  unmounted and remounted; `findBy` resolves with the element it saw on one tick and the second read can
  detach it before the matcher runs, which fails as *"could not be found in the document"* on a screen that
  is about to be perfectly correct. `waitFor` retries the whole assertion instead of trusting one snapshot
  of it.

---

## 6. What the new tests cover

**API (+44).**

- `tests/domain/sort-keys.test.ts` (11) — the arithmetic as arithmetic: fixed width vs. the `9`/`10` trap,
  strict betweenness at both ends and in the middle, `null` rather than a duplicate key on exhaustion, the
  ~20-split depth, the re-key grid, and the three-term total order under a deliberate key collision.
- `tests/backlog/ordering.test.ts` (17) — S-backlog-17-1, 17-2, 18-1, 19-1, 19-2 (×2), 19-3, 20-1, 20-2,
  21-1; both ends of the list and the "`after` the last item ≡ `bottom`" identity; **two kinds of concurrent
  reorder**; the labels on lists and on command responses; and cross-account scoping against a **second
  real signed-in account**, not a hand-made id.
- `tests/lens/parent-and-empty.test.ts` (11) — the parent line for a parent outside the period, both
  suppression cases, one-entry-per-distinct-parent, the carried band; the three empty-state signals at
  every horizon including the past-period case `hasForwardContent` cannot see; and that neither signal
  leaks another account's use of a horizon.
- `tests/migration/backlog-sort-key.test.ts` (5) — the backfill against real rows, per-goal ranking,
  converted rows, idempotency, and a replay against a database that has been live since the migration.

**Web (+26).**

- `tests/screens/reorder.test.tsx` (15) — the affordances present with **no pointer event having occurred**;
  one tab stop; the four menu items and their absence at the ends; a full keyboard reorder end to end with
  focus checked afterwards; `Home`/`End` at both ends; a middle move naming its predecessor; focus roving
  without writing; **`Escape` writing nothing**; all five announcements verbatim with the assertive/polite
  switch; the refusal path with its non-toast error; `relativeMove` at both ends and out of range; and
  one-list-per-goal.
- `tests/screens/lenses.test.tsx` (+9) — the parent line for a parent outside the period and its
  suppression, the carried band's line, and the **three empty states asserted against each other** (each
  test asserts the other headline is *absent*), plus the cold-start case and all four horizons.
- `tests/screens/backlog.test.tsx` (+1) — the inverted `Elsewhere` assertion and the rootless-chain case.

---

## 7. What remains

- **No desktop layout.** Untouched here, as in build 17: *"a phone app wearing a desktop window"* is the
  walkthrough's first criticism and it is still open. It is a layout pass, not a field.
- **`R-goal-19`'s two disabled Move reasons** are still not rendered, for the reason build 17 §6 gave: under
  the new horizon rules no invalid target can appear in a picker built from legal ones. The server's
  refusals still render. Unchanged, and still worth a decision at some point.
- **Pagination across a group boundary on the Backlog page.** `GET /backlog` pages by `capturedAt` at
  `MAX_PAGE` (200) and *then* arranges the page into groups, so a goal's items could in principle straddle
  a page boundary. This is unchanged in kind from before this build, the client does not use `nextCursor`
  at all, and 200 open backlog items is already past what anyone triages — but if the page ever grows a
  "show more", the cursor needs to be per-group rather than per-account.
- **The re-key path reads the goal's whole open list.** It is bounded by that goal's backlog and only runs
  after ~20 successive drops into one gap, so it has never run outside its own test — but it is the one
  operation here whose cost is not `O(1)`.
- **Bundle:** `dist/assets/index-*.js` is 497 kB raw / **151 kB gzipped**, up ~3 kB gzipped for the
  reorderable list. No new dependency was added, which is where a drag-and-drop library would have cost
  10–40 kB for the part of the problem this list does not have.
