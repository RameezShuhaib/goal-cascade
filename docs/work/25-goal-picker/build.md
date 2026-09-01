# 25 — One searchable goal picker for every goal-selection site

Item **E** of `docs/work/22-ux-fixes/UX-PLAN.md`, built as specified there, and landing as **R-nav-31**
in `docs/SPEC.md` (§2 Navigation & system, Amendment 6; scenarios `S-nav-31-1 … S-nav-31-13`; ledger
entry at the foot of §6).

> *"i need a better way select goal example when i add a backlog in goal everything is listed. lets say
> if i have many the ui is messed up. i have seen similar practices in other pages too."*

He was right about both halves. `GoalModals.tsx:155` listed every legal parent in a `maxHeight: 200`
scroller with no search, no grouping and no ancestry — and the same shape recurred at **seven** sites,
no two alike. Six properties were missing from all of them: no search anywhere in the app, no ancestry
(**two goals with the same title in different Life lines were indistinguishable in every picker**), no
grouping though `LensResponse.groups` was already on the wire, no shared recency, no keyboard model, and
a **silent** truncation at `MAX_PAGE = 200`.

---

## 1. The component's API

`apps/web/src/components/GoalPicker.tsx` — one file, three exports a caller uses.

### `useGoalOptions(mode)` — the reads

```ts
useGoalOptions(mode: PickerMode): {
  options: GoalOption[];                              // the legal goals, in horizon-then-server order
  groups: { id: string | null; title: string }[];     // the Life-goal sections, server order, UNSORTED last
  isPending: boolean;
  truncated: boolean;                                 // any underlying read came back with a `nextCursor`
}
```

`GoalOption` is structural — `{ id, title, why, horizon, period, createdAt, lineId, line }` — rather
than a `GoalView`, because two of the four modes have less than a `GoalView` to offer (the server's
refusal list is `{ id, title }`) and because `line`, the Life-goal title, is a join no wire field
carries.

### `GoalPicker` — the picker rendered in place

```tsx
<GoalPicker
  mode={PickerMode}
  value={string | null}
  onChange={(id: string | null, title?: string) => void}
  empty={ReactNode}          // the sentence when nothing legal exists — every one is an existing string, moved
  extra={{ label: string }}  // a leading non-goal row: `lifeLine`'s `No goal`
  listLabel={string}         // the listbox's accessible name
/>
```

Used where the choice **is** the whole task: `Move goal`, and a backlog row's `Move to another goal`.
`onChange`'s second argument is the chosen row's title, because the toast that follows a choice names it
and the caller no longer keeps a list of its own to look it up in — that absence is the point.

### `useGoalPicker({ … })` — the field, and the takeover

```ts
useGoalPicker({ mode, value, onChange, from, fieldLabel?, empty?, extra?, listLabel? }): {
  control: ReactNode;     // ≤ 8 options → the inline list; > 8 → a one-row field that opens the picker
  panel: ReactNode;       // the full picker, rendered as the sheet's body while `taken`
  headerRight: ReactNode; // `‹ New Monthly goal` while `taken`, else null
  heading: 'Choose a goal';
  taken: boolean;
  options, isPending, truncated;   // the same three facts, for callers that need to count
}
```

A calling sheet is four lines:

```tsx
const picker = useGoalPicker({ mode, value, onChange, from: `New ${horizon} goal` });
<Sheet label={picker.taken ? picker.heading : `New ${horizon} goal`} headerRight={picker.headerRight} onClose={close}>
  {picker.taken ? picker.panel : <>…the form, with {picker.control} where the list used to be…</>}
</Sheet>
```

### What a caller supplies, and what it never supplies

A **mode**. Not a list, not a rendering, not a keyboard model, not an empty state's shape, not a
threshold, not the search. The one thing beyond the mode is copy: the `empty` sentence, and the `from`
label the back control names.

---

## 2. The four modes

Each is a rule **the server already enforces**, used to shape the offer — never a second source of
truth. Where the two could disagree, the server wins and the refusal renders where it always did (D-5).

| Mode | Offers | Rule, and where the server enforces it |
|---|---|---|
| `parent` | every goal of **strictly longer horizon**, at the enclosing period; never the goal itself, never a descendant | R-goal-5 / R-goal-32 / R-goal-18 — `domain/goal-tree.ts:checkCreate` and `checkMove` (`HORIZON_CONFLICT`, `WOULD_CREATE_CYCLE`) |
| `backlogHost` | **Yearly, Quarterly, Monthly** — never Life, never Weekly | R-backlog-1/2/26 — `backlog.service.ts:assertCanHoldBacklog` (`LIFE_GOAL_NO_BACKLOG`, `HORIZON_CONFLICT`) |
| `weeklyTarget` | **Weekly goals in one week**, under the chosen parent; the **server's** candidate list when it sent one | R-goal-39 / R-task-41 / R-task-49 — `task.service.ts` (`NOT_A_WEEKLY_GOAL`) and `backlog.service.ts:resolveConversionTarget` (`AMBIGUOUS_CONVERSION_TARGET`) |
| `lifeLine` | **Life goals only**, plus a leading `No goal` | R-learning-2/3 — `capture.service.ts` (`NOT_A_LIFE_GOAL`) |

Two notes on `parent`:

- **Descendant exclusion is structural, and also stated.** Every descendant of a goal is
  strictly *shorter*-horizon than it, and every option is strictly *longer*, so no descendant at any
  depth can appear. `exclude` additionally names the goal itself and the children the detail read
  already handed us, so the guarantee is readable rather than incidental.
- **`only: 'life'`** is carried through for R-lens-20's `Put under a Life goal…`, which is wired
  (`UIContext` → `Sheets` → `MoveGoalSheet`) and still has **no caller** (UX plan §10.4). It is a
  narrowing of `parent`, not a fifth mode, and the dead path behaves exactly as it did rather than being
  quietly widened.

The rule is applied **twice on purpose**: the reads scope the page, and one predicate then filters what
came back. A widened read can therefore never start silently offering an illegal goal.

---

## 3. Every call site converted

| # | Site | Was | Now |
|---|---|---|---|
| 1 | Create goal / sub-goal — `UNDER` (`GoalModals.tsx`) | flat `pickerRow` list, `maxHeight: 200` | `parent`, via `useGoalPicker` (field + takeover above 8) |
| 2 | Move goal (`GoalModals.tsx`) | flat `pickerRow` list, `maxHeight: 230` | `parent` with `exclude`, the sheet's whole body |
| 3 | `+` drawer — `GOAL` (`BacklogSheets.tsx`) | **wrapping wall of `chipBtn` pills, titles only** — the site the owner named | `backlogHost`, via `useGoalPicker` |
| 4 | `+` drawer — `WHICH WEEKLY GOAL?` (`BacklogSheets.tsx`) | `chipBtn` row | `weeklyTarget`, read gated on the checkbox |
| 5 | Task create / backlog pull — `WHICH WEEKLY GOAL?` (`BacklogSheets.tsx`) | `chipBtn` row | `weeklyTarget`, incl. the server's `AMBIGUOUS_CONVERSION_TARGET` list |
| 6 | Move a backlog item (`BacklogItemCard.tsx`) | inline `chipBtn` row, **no selected state at all** | `backlogHost` with the item's own goal excluded, inline |
| 7 | Learning capture — tag (`CaptureScreens.tsx`) | `chipBtn` row + a `No goal` chip | `lifeLine` with `extra: No goal` |
| 8 | Learning re-tag — `Attach to a goal` (`CaptureScreens.tsx`) | `chipBtn` row + a `No goal` chip | the same `lifeLine` picker |

**Not converted, deliberately:** the two backlog **pull** lists (`PullSheet`, and the goal page's own
pull block) pick a backlog *item*, not a goal (UX plan §12). They already use `S.pickerRow`, so the app
still reads as one list idiom.

`tests/screens/goalPicker.test.tsx` closes this table with a **source census**, in the shape of
`buttonTypes.test.tsx`: every one of the four files imports the picker, and each retired rendering is
named and asserted gone — the 200px and 230px lists, `parents.options.map`, `targets.map`,
`candidates.map`, `choices.map`, `lastUsedGoalId`, `LifeGoalChips`. A behavioural test can only prove the
sites it visits; the census is what proves there is no eighth one left.

---

## 4. What moved to `packages/shared`

`packages/shared/src/search/rank-goals.ts` — `foldForSearch`, `rankGoals`, `isAmbiguous`, `GoalMatch`,
`MATCH_SCORES`, moved out of `apps/api/src/api/mcp/shapes.ts` (which now carries a pointer where they
were, and re-exports nothing, so a second copy cannot grow back behind its name).

- **Why the ranking and not an endpoint.** UX plan §11 Q5 asked both questions and they have different
  answers. Two implementations of *"does this phrase mean that goal"* would disagree on the first
  near-miss — the drift A5 moved the calendar to end — so the ranker is shared. An HTTP goal search
  would be built for a case that has not occurred (no mode reaches 200 without a data pathology), which
  is what R-nav-26 exists to refuse, so it is **deferred**.
- **`find_goal` ranks exactly as it did.** The one added rung — a **Life-line** match at `0.5`, between
  a title substring (`0.75`) and a `why` (`0.35`) — fires only when the caller passes `lineTitleOf`, and
  the MCP surface passes none. `apps/api/tests/mcp/*` is unchanged and green.
- **It became generic** over a structural `Rankable = { title, why, horizon, createdAt }` so the picker
  can rank its own rows (which carry a line the wire has no field for) without inventing a `GoalView`.
  `GoalView` satisfies it, so `tools/goals.ts` changed by one import line.
- **A census guards it**, modelled on `no-second-calendar.test.ts`: nothing outside
  `packages/shared/src/search/` may *declare* `rankGoals`, `isAmbiguous` or `foldForSearch`, and the
  matcher is itself tested against the declaration this change moved and against its call sites.

`apps/web/src/lens/useParentOptions.ts` gained two fields on its return — `pages` (the raw
`LensResponse`s, for the group headers) and `truncated`. Its behaviour is unchanged.

---

## 5. How truncation surfaces

`useLens` has always returned the whole `LensResponse`; every picker threw `nextCursor` away. Now, when
any read backing a mode reports one, the foot of the list reads, verbatim:

```
Showing the first 200. Search to narrow it.
```

`TRUNCATION_NOTICE` is built from the shared `MAX_PAGE`, so the sentence cannot drift from the cap it
describes. It renders **only** when a cursor actually came back — it is a fact, not decoration, and
`S-nav-31-12` asserts both directions. It sits outside the `listbox` element, so it is not an option and
cannot be arrowed onto.

**What the notice does not claim.** Search filters the loaded page, so on a truncated list it narrows
the first 200 rather than reaching past them. That is why the sentence says *"Showing the first 200"*
first: the picker tells the truth at the boundary instead of lying quietly, which is the whole change.
Reaching past the page needs the deferred endpoint.

---

## 6. Behaviour worth knowing

- **The threshold is one number: 8.** At or below it — the owner's likely reality — the picker is an
  inline listbox with no search field and no field to open, which is *simpler* than what shipped. Above
  it, the search field appears, `RECENT` becomes worth rendering, and the list becomes a one-row field.
- **The takeover.** Above the threshold the picker replaces the calling sheet's body; the heading
  becomes `Choose a goal` and `headerRight` becomes `‹ <the sheet you came from>`. **One dialog, one
  focus trap, and the sheet never unmounts**, so typed work survives with no draft hoisted anywhere and
  no change to `Sheet.tsx`. Focus goes to the list on open and back to the field on choose or back.
- **Grouping.** Sections are `RECENT`, then one per Life goal in the server's order with `UNSORTED`
  last; headers are the lens's own `S.sectionLabel` and are suppressed when there is one non-empty group
  (R-lens-19, generalised). A `lifeLine` list is flat — grouping Life goals under themselves is a header
  per row. While the search field is non-empty the whole list is flat and ranked.
- **`RECENT`** is up to three ids, most recent first, shared by all four modes, module-level and
  session-scoped — exactly the lifetime `lastUsedGoalId` had (UX plan §11 Q3 recommends session scope).
  It renders only above the threshold and only with two or more rows to show. It kept R-backlog-14's
  promise: the `+` drawer still opens on the goal you filed under last, validated against the offered
  set first. `tests/setup.ts` resets it between tests, beside the clock, for the same reason.
- **Accessibility.** `role="listbox"` / `role="option"` / `aria-selected`, `role="group"` labelled with
  the Life goal, one tab stop with `aria-activedescendant`, `↑`/`↓`/`Home`/`End`/`Enter`/`Space`, typing
  from the list moves to the field and inserts the character, and the result count is announced in a
  debounced `role="status"`. Every row's accessible name carries `<title> — <line> · <horizon> ·
  <period>` however it is rendered, which is the answer to the owner's actual confusion.
- **Two-stage Escape, with no change to `Sheet`.** `Sheet` listens on `document` in the capture phase
  and stops propagation, so an element handler would never see the key. The picker listens on **`window`**
  in the capture phase — one step earlier — and swallows the first Escape only while its search field is
  non-empty. Escape never selects, at either stage.

## 7. Deliberately not done

- **No server-side goal search.** §5, and UX plan §11 Q5.
- **No widening of any mode's period scope.** `backlogHost` still reads the current period of each
  horizon and `parent` the enclosing one, exactly as before. UX plan §9.6 flags widening as a data-side
  change with its own reads; doing it here would have hidden a behaviour change inside a UI one.
- **`useWeeklyGoalsUnder`'s `parentId ===` match is unchanged**, so a level-skipped Weekly goal still
  reaches the picker only through the server's `AMBIGUOUS_CONVERSION_TARGET` list. Also UX plan §9.6.
- **`lifeGoalsOnly` is carried, not built.** UX plan §10.4.
- **No virtualisation, no combobox library, no fuzzy-search library, no new dependency, no new colour
  token, no new row of chrome.**

## 8. Verification

| | |
|---|---|
| `npm run typecheck --workspaces` | clean |
| `npm test --workspaces` | **558** api · **378** web (was 350) · **112** shared (was 104) |
| `npm run build -w @goal-cascade/web` | `dist/sw.js`, precache 13 entries (806.71 KiB) |

No test was weakened. Ten existing assertions moved from `role="button"` to `role="option"` — the rows
are options in a listbox now, which is what makes the selection announced rather than merely coloured —
and their negative forms were anchored (`/^Be strong at 60/`) so a row naming a goal's *line* cannot
satisfy an assertion about the goal itself.
