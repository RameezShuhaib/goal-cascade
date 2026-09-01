# 27 — a horizon-scoped picker, named task destinations, and the month clamp

Spec authority: `docs/SPEC.md` §2 (`R-nav-31`, `R-task-49`, `R-lens-9`, `R-goal-47`), §3
(`S-nav-31-14 … 17`, `S-goal-5-2`, `S-task-49-1/2`, `S-lens-9-7`), §6 **Amendment 9**.
`docs/BUSINESS-RULES.md` changed in one sentence and `apps/api/src/api/mcp/business-rules.ts` was
regenerated **in this commit**; `apps/api/tests/mcp/verbatim.test.ts` is what proves it.

Four defects the owner hit in real use. **Amendment 8's body — month-level tasks and measurables — is
deliberately not built here.** A8 is a later, larger pass; three of these four are live today and one of
them lost the owner three tasks.

---

## 1. The picker floods a form sheet — the surface decides the shape, and the list is scoped by horizon

**What was wrong.** `R-nav-31`'s one threshold governed the search field *and* the presentation: at ≤ 8
options an inline grouped list, above 8 a collapsed row. On a screen that is fine. Inside a form sheet it
is wrong, and the owner's `New Monthly goal` sheet is the proof — three legal parents, three two-line rows,
`Save goal` below the fold. **A count cannot see the rest of the surface**, which is the thing the decision
actually turns on.

**What is built.** Two changes, and the second is the owner's own design.

**(a) The surface decides the shape.** `useGoalPicker` — the picker as one field among several in a form —
is a compact row at **every** option count. `GoalPicker` — the picker as the whole surface (`Move goal`, a
backlog row's `Move to another goal`, the Learnings tag) — is the inline list at every option count.
Nothing is being crowded out there, so nothing needs collapsing. `PICKER_THRESHOLD` survives governing
exactly one thing: whether the opened picker carries a search field.

**(b) The list is scoped by horizon first.** The owner:

> *"instead we put everything under with all the goals from all the lense. we can have another option to
> select which lense to focus on and based on it i get the goals for that lense."*

A `role="radiogroup"` of chips above the list; the list is that horizon's goals. Four properties, each a
requirement rather than a nicety:

- **Only horizons the mode permits.** `permittedHorizons(mode)` is the mode's own `legal` filter read a
  second way, not a second rule: `parent` → strictly longer horizons (`Life` alone under `only: 'life'`),
  `backlogHost` → Yearly/Quarterly/Monthly, `weeklyTarget`/`lifeLine` → one horizon and therefore **no
  selector at all**. A chip can never offer what the server would refuse (D-5).
- **The default is the most specific legal horizon that has something** — Quarterly for a new Monthly goal,
  not Life — or the current choice's own horizon when there is one, so reopening a picker shows you where
  your goal lives. Opening on an empty tab is a dead end; opening on the broadest is backwards, because the
  nearer a parent is the likelier it is the one you meant.
- **Search still crosses every horizon.** While the query is non-empty the scope is dropped and the ranker
  sees every option. The search threshold counts the **total**, not the scoped set, so narrowing can never
  remove the one control that reaches across the narrowing. **Scoping is a default view, not a cage** —
  which is also why it does not reopen `R-lens-15`: it holds no state past the choice it was opened for,
  and adds no parameter to any lens read.
- **A third empty state.** `No <horizon> goal to choose here. Pick another horizon above, or search across
  all of them.` — distinct from "this account has nothing legal at all", which would be a flat lie.

**Accessibility.** The chips are a radiogroup with a roving tabindex: one tab stop, `←`/`→`/`↑`/`↓` move
**and** select, `Home`/`End` reach the ends, each chip's accessible name carries its count, and a
`role="status"` announces the narrowed count. Deliberately **not** a `tablist`: a tab implies a `tabpanel`,
and the thing it controls is a `listbox`, which cannot be one. It adds a tab stop inside the dialog `Sheet`
already traps and **never a second focus trap** — the takeover contract is untouched.

The field also gained an accessible name carrying its **purpose and its value**
(`Choose a goal: Rebuild the gym habit — Be strong at 60 · Q3 2026`). It previously announced the value
alone once filled, which left the one always-rendered field in the form unlabelled.

---

## 2. The default parent — the nearest legal ancestor

**How it was chosen, verified before changing it.** There was no default. `GoalFormSheet` preselected only
when `picker.options.length === 1`; with three legal parents `chosenParent` stayed `null`, and the picker's
roving-focus ring sat on row 0 with `background: T.lineSoft` and a 2px inset ring. Row 0 is a **Life goal**,
because `useParentOptions` concatenates Life, Yearly, Quarterly, Monthly in that order. So the sheet
*looked* preselected on *Be financially independent* and was not — which is the worst of the three possible
states, worse than either an honest blank or a real default.

**What is built.** `nearestAncestor(options)` — the deepest goal whose period contains the new goal's
period. That is one line, because `useParentOptions` has already done the containment half: each longer
horizon is read at `enclosingKey`, the period that encloses this one, so every option's period contains the
new goal's **by construction** and "nearest" reduces to "highest horizon rank". For a new Monthly goal in
`Sep 2026` that is the Quarterly goal for `Q3 2026`. Ties go to the picker's shared `RECENT` list
(R-backlog-14, generalised), then to the server's order — a *default the owner can see and change in one
tap*, which is exactly the distinction that makes this compatible with D-18's refusal to let array order
decide anything on the server. It subsumes the one-option case rather than sitting beside it.

---

## 3. `+ Task` on a Monthly goal — the destination is named at every candidate count

**What was wrong.** `TaskCreateSheet` rendered the weekly-goal picker only at `choices.length > 1`. At
exactly one the path was, in its own comment, *"used silently"*. The owner added three tasks from a Monthly
goal, was never told which weekly goal or which week they landed in, and could not find them afterwards.

**What is built.** One block, `WHERE THIS GOES`, with the same two facts at every count:

| Candidates | What the sheet says |
|---|---|
| **one** | the weekly goal as a **filled** choice in the picker's compact row, and the week line. Zero extra taps, as before — but the answer is on screen. |
| **several** | the same row, first preselected, one tap to change. |
| **none** | `This starts a weekly goal "<title>" for the week of <d Mon>. You can rename it after.` — kept verbatim — and the week line beside it. |

The week line is `Lands in the week of 7 Sep · Sep 2026.` The **month** is there because a week and a month
can honestly differ at a seam (a week belongs to its Monday's month), and because a task landing in a month
other than the one on screen is exactly how the three went missing. After §4's clamp fix the month named is
the month you are looking at, so it reads as a statement of fact rather than a warning.

The preselect effect moved from `choices.length > 1` to `> 0` so the single candidate renders as
`aria-selected` and is **announced** rather than merely resolved (R-lens-13).

---

## 4. The target-week clamp — and the option chosen

**What was wrong**, verified against the source rather than the docs:

```
weekForMonth('2026-09', today = '2026-09-02')  =  2026-08-31
periodKeyOf('Monthly', '2026-08-31')           =  2026-08
```

Its first branch asks whether today's **calendar month** equals the viewed month. Every other rule in this
product asks which month a **week's Monday** belongs to (R-goal-33, R-lens-28). The two disagree for the one
to six days between a month starting and its first Monday — every year, silently — and the disagreement is
**correct for a zoom and wrong for a create**. Three live consequences: a Weekly goal minted under a
September parent in an August week; R-goal-47's September line still reading `Nothing planned yet`
immediately after the owner planned something; and a navigation into August from a create started in
September.

### The choice, and why

The honest options were: **default to the month's first week**, or **keep the current week and say plainly
that it belongs to the previous month**. Chosen: **the month's first week.**

Both are honest; only one is useful. A task is created to be *seen* in the lens that created it. A week the
viewed month's own lens will never show is not a destination, it is a leak — and naming it would preserve
all three consequences above while merely narrating them. The disclosure and the fix are not alternatives
anyway: §3 names the week and its month in every case, so the owner is told either way; the question is only
whether they are told something useful or something they have to work around.

The rule as built is one predicate, not a special case:

```ts
export function taskWeekForMonth(monthKey: string, today: string): string {
  const thisWeek = weekStartOfDate(today);
  return periodKeyOf('Monthly', thisWeek) === monthKey ? thisWeek : firstMondayIn(monthKey);
}
```

The week you are living in **when that week belongs to this month**, otherwise the month's first week. The
answer is inside `monthKey` by construction, which is the property that was missing. It also never prefers a
past week over the current one: the month holding the current week keeps it, so the first-week fallback fires
only for a month the current week is not in, and **R-goal-36 is never engaged** — nothing is back-dated. On
2 Sep 2026 the September lens answers Mon 7 Sep and the August lens still answers Mon 31 Aug, which is the
week the owner is standing in.

### The rename, and what did not change

The spec pass recommended `zoomWeekForMonth`; it still fits, and with a second rule beside it the rename
becomes load-bearing rather than cosmetic. So `weekForMonth` splits in two, both in
`packages/shared/src/calendar/periods.ts`:

- **`zoomWeekForMonth`** — R-lens-9's Monthly → Weekly zoom. **Body unchanged.** Landing on the week you are
  living in is right for a zoom even when it belongs to last month; R-lens-29's `This week is in Aug 2026`
  line already names the seam.
- **`taskWeekForMonth`** — R-task-49's target week, above. Its only caller is `MonthlyCard`'s `+ Task` /
  `Pull from backlog` row.

**R-goal-47's planned-ness scope is untouched** — it is a `BETWEEN firstMondayIn … lastMondayIn` range scan
and never reached the today-branch at all. R-goal-47's *claim* that "one answer serves all three and they can
never disagree" is withdrawn in the spec, because it was false: what the three share is the **Monday rule**,
which is genuinely one rule; what they were wrongly sharing was one *function*.

**One deletion.** `apps/web/src/utils/periodKeys.ts`'s `weekForMonth` wrapper is gone, not renamed. It was
the last of R-lens-30's six duplicated calendar functions, and it survived that pass only because its
signature (`monthKey, currentMonday, todayMonthKey`) looked like client vocabulary. It was not: it decided
which week a month means. Both new names join `packages/shared/tests/no-second-calendar.test.ts`'s `OWNED`
census, so neither can grow a client copy again. When A8 deletes R-task-49's caller it deletes
`taskWeekForMonth` with it; until then the rule is right.

---

## 5. Files

| File | Change |
|---|---|
| `packages/shared/src/calendar/periods.ts` | `weekForMonth` → `zoomWeekForMonth` (unchanged body); new `taskWeekForMonth`; `zoomTo`'s call updated. |
| `packages/shared/tests/no-second-calendar.test.ts` | both names added to `OWNED`. |
| `packages/shared/tests/periods.test.ts` | the seam asserted for both rules, plus the "always inside the month asked for" property. |
| `apps/web/src/utils/periodKeys.ts` | `weekForMonth` **deleted**; a note pointing at the two shared rules. |
| `apps/web/src/lens/cards.tsx` | `MonthlyCard` calls `taskWeekForMonth(goal.periodKey, clock.today)`. |
| `apps/web/src/components/GoalPicker.tsx` | `permittedHorizons`, `defaultHorizon`, `nearestAncestor`; the horizon radiogroup and its keyboard model; the scoped list and the third empty state; `useGoalPicker` is a field at every count; the field's accessible name. |
| `apps/web/src/components/GoalModals.tsx` | the default parent is the nearest legal ancestor. |
| `apps/web/src/components/BacklogSheets.tsx` | `WHERE THIS GOES` at every candidate count; `monthLabelOfWeek`. |
| `apps/web/src/lens/copy.ts` | `taskDestinationNote`. |
| `docs/SPEC.md` | R-nav-31, R-task-49, R-lens-9, R-goal-47 amended; 8 scenarios; §6 Amendment 9. |
| `docs/BUSINESS-RULES.md` + `apps/api/src/api/mcp/business-rules.ts` | one sentence, and the constant regenerated **in the same commit**. |

## 6. Verification

`npm run typecheck --workspaces --if-present` — clean.
`npm test --workspaces --if-present` — **558 api / 419 web / 113 shared**, all passing (floor 558 / 409 / 112).
`npm run build -w @goal-cascade/web` — clean, `dist/sw.js` emitted with its precache manifest.

No test was weakened. Twelve web tests were **rewritten against the changed rules**, and each rewrite asserts
more than the test it replaced — most pointedly `"with exactly ONE weekly goal it is used silently"`, whose
entire subject was the defect.

## 7. For the orchestrator

**`BacklogDrawer` has the same single-candidate silence, and was left alone.** `Add to this week instead`
renders its `WHICH WEEKLY GOAL?` picker at `candidates.length > 1` and resolves a lone candidate without
naming it — structurally the same defect as §3, one sheet over. It is much less severe: the checkbox itself
says *this week*, so the **week** is never in doubt and only the weekly goal goes unnamed. It was left out
because the brief named `TaskCreateSheet`, and widening the change would have pulled a fifth flow's tests
into an already large diff. It is a five-line change if wanted.
