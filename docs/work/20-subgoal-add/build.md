# 20 — Sub-goals from the goal page

The owner, standing on a Yearly goal: *"look if im in a goal page. i would also want to add sub goals in
the same page."* Two rules combined to make that impossible, both on `GoalDetailScreen.tsx`.

1. **`R-nav-25`** gave a goal page exactly one primary action, mapped by horizon: `+ Weekly goal` on
   Monthly, `+ Task` on Weekly, **nothing on Life, Yearly or Quarterly**. The three horizons whose entire
   purpose is to hold sub-goals were the three that could not create one.
2. The **`Sub-goals` section rendered only when `children.length > 0`**, so a goal with none showed no
   section at all — the exact moment the affordance is most needed.

## The rule change

Spec first, code second. `docs/SPEC.md`:

- **`R-goal-48` (new, §2 Goal)** — the `Sub-goals` section renders **unconditionally at every horizon that
  can legally hold children** (Life, Yearly, Quarterly, Monthly), empty or not, with the empty state
  `Nothing under this goal yet.` and an inline `+ Sub-goal` capture. Everything the page knows is
  pre-filled: the parent is this goal; the horizon is the legal set and is **not asked at all** when that
  set has one member; the period follows the horizon. Title only, with `More…` out to the full form
  carrying the typed title across. A Weekly goal gets no section and no affordance.
- **`R-nav-29` (new, §2 Navigation)** — a goal detail page's mapping is now **`+ Task` on a Weekly goal and
  nothing at any other horizon**, *superseding R-nav-25's goal-detail clause*. R-nav-25's **form** — theme
  toggle, account button, at most one primary action — is untouched.
- **Marked `⚠` as modified:** `R-nav-25` (goal-detail mapping only), `R-goal-41` (the child list gains an
  empty state and a create), `R-goal-38`'s Monthly-page clause, `R-task-49`'s and `Q-20`'s repeated
  sentence about the Monthly detail page, and `S-goal-5-1` (whose legal-horizon set A2 had silently
  widened and nobody had re-pointed).
- **Scenarios:** `S-goal-48-1 … S-goal-48-7`, `S-nav-29-1`, in a new `### Amendment 3` block in §3.
- **§6 ledger:** a new `### Amendment 3 — sub-goals from the goal page` with the running totals — 227 → 229
  rules, 256 → 264 scenarios, 3 rules modified (86 across all amendments), **32 retired outright,
  unchanged: A3 retires nothing**.

`docs/BUSINESS-RULES.md`'s **Create** bullet described only the lens path, so it now describes both, in the
owner's voice, and `apps/api/src/api/mcp/business-rules.ts` was regenerated in the same commit —
`tests/mcp/verbatim.test.ts` is green.

**No API change beyond that constant.** No endpoint, schema, field, error code or MCP tool was added: the
write is `POST /goals` with a `parentId`, and `create_goal` already exposes it to agents with the same
defaulting (omit `period_key`, the server derives the current period). A `create_sub_goal` tool would be
the same call under a second name, so it was not added.

## The affordance, and why

**The inline `+ Sub-goal` capture**, the same shape as R-backlog-11's `+ Add` one section below on the
same screen: it opens in place, `Enter` or `Save sub-goal` commits, `Never mind` cancels, and focus
returns to the control that opened it either way. Consistency on one screen beats novelty, and putting the
create inside the section that will hold the result sidesteps R-nav-25's one-primary-action rule instead of
fighting it.

It is named `+ Sub-goal` rather than `+ Add` because the backlog's `+ Add` is on this same page, and two
controls with one accessible name is a control you cannot ask for (D-20 — the same reason `Delete` on this
page already carries an `aria-label`).

**Title only, with `More…`.** Title is a goal's one required field; `why` and `pulse` have defaults, the
parent is known and the period is inferred, so the capture asks for a title and nothing else. `More…`
opens the ordinary create sheet with the same horizon, period and parent — **and the typed title**, which
is why `SheetSpec.goalForm` gained an optional `title`.

**The horizon.** `childHorizons(parent)` filters the shared `HORIZONS` array by rank, so the picker is
*shaped* by the server's rule and never restates it (D-5). One legal horizon → no picker at all (a Monthly
goal can only hold weeks). Several → chips defaulting to the next shorter one, `aria-pressed` on the
selection, inside a labelled `role="group"`.

**The period.** `subGoalPeriodKey()` in `utils/periodKeys.ts`: the **current** period of the child's own
horizon, or the parent's first enclosed period when the parent begins later — a single `>` between two
same-horizon canonical keys, which sort chronologically by construction (R-goal-33). `PERIOD_IN_PAST` is
therefore unreachable from the control without the client owning that rule. The **Weekly** case takes the
Monday the server sent and derives none (D-1), exactly as `+ Weekly goal` did.

## What happened on Monthly

**`+ Weekly goal` was dropped from the Monthly goal's page, not kept as a shortcut.** With the inline
capture on all four horizons that can hold children, the top action became a second route to the same
write, on one horizon of four, a screen-inch above the section it writes into — the clutter `R-nav-27`
exists to refuse. The inline path is strictly shorter (tap, type, `Enter`), and `More…` reaches the
identical sheet the top button opened, pre-filled the same way, so no capability went with it. A goal
detail page now carries **fewer** unconditional controls than before, not more.

`Q-20` is narrowed rather than reversed: its ruling kept `+ Weekly goal` off the Monthly **card**, and the
reconciliation pass left it on the **page** only because a detail page carries one primary action and had
nothing else to put there. R-goal-48 gives that create a better home, so the page now carries none.

The old assertion (`goalDetail.test.tsx`, `R-nav-25 / Q-20`) is **inverted rather than deleted**, following
the file's existing convention for retired scenarios, so the duplicate cannot quietly return.

## Accessibility

Everything is a real `<button>`/`<input>` in document order: chips → title field → `Save sub-goal` /
`Never mind` → `More…`. Focus returns to `+ Sub-goal` on both commit and cancel (asserted). The refusal
renders in an inline `role="alert"` under the field with the typed title intact. **No new colour** — the
empty state and `More…` use `T.mut`, which `tests/screens/contrast.test.ts` already measures at ≥ 4.5:1 on
both surfaces in both themes; the chips reuse `S.chipBtn`, the pulse picker's existing pair.

## Verification

- `npm run typecheck --workspaces` — clean.
- `npm test --workspaces` — **559 api / 296 web / 43 shared** (web +7: six new scenarios plus the inverted
  Monthly one, which replaced a passing test rather than adding to it).
- `npm run build -w @goal-cascade/web` — succeeds, `dist/sw.js` emitted with a 13-entry precache manifest.

## Left out, deliberately

- **No count on the `Sub-goals` header.** `Backlog (2)` has one because it always did; `R-nav-26` refuses a
  new number and the list is its own count.
- **No toast on commit.** The child appears in the list directly above the control, which is a better
  confirmation than a transient one. The refusal still toasts, because that is the one error path
  (`useCommand`) and this control does not get a second.
- **No optimistic insert.** `useCreateGoal` invalidates rather than patches, for the reason its own comment
  gives: a new goal changes its group's membership, its parent's planned-ness line and the lens ordering,
  none of which the create response carries.
- **`QuickAdd` (backlog) was not changed.** It does not return focus after commit. That is a real gap and a
  one-line fix, but it is a different rule's surface and would have widened this diff into
  `R-backlog-11`'s tests; worth a follow-up.
- **No `why` in the quick capture.** `More…` is the answer, and one field is what makes the capture fast.
