# 14 — Reconciliation: the spec against the UX plan, and the goal-scale problem

`docs/SPEC.md` (Amendment 2, 211 rules) and `docs/work/14-redesign/UX-PLAN.md` (1294 lines) were written
in parallel and never saw each other. The PM's note — *"UX-PLAN.md had not landed, so no reconciliation
was possible"* — is what this document closes.

**What it does.** §1 reconciles the two documents flow by flow. §2 gives the rules the UX plan implies,
as rule text. §3 is the scale analysis: measured, not estimated. §4 is the two owner questions. §5 is
what neither document covers.

**Rule of decision, applied throughout:** the spec wins on *rules*, the UX plan wins on *flows and
copy*. Where a flow is impossible under a rule, that is a real conflict and §1 resolves it explicitly.

**Amendments made to `docs/SPEC.md` in this pass:** 16 rules added (211 → **227**), 19 existing rules
and 4 open questions modified, 1 rule superseded outright (R-lens-13). §6's Amendment-2 ledger carries
the before/after. `UX-PLAN.md` is not edited; every change it needs is recorded in §1's *UX must change*
column and collected in §1.4.

---

## 1. The conflict table

26 conflicts. **10 needed a real decision** (marked ★); the rest were one document being silent, or
copy drift. "Changed" names the document that moves.

### 1.1 Navigation and the shell

| # | Conflict | Spec says | UX plan says | Resolution | Changed |
|---|---|---|---|---|---|
| ★C-1 | The lens control | **R-lens-13**: a persistent five-way segmented control, `Life · Yearly · Quarterly · Monthly · Weekly`, in the Goals header above the period control | §1.2/§1.4: **no switcher.** The title *is* the altitude; tapping it opens a **Zoom sheet** — the five horizons as a ladder, each row labelled with the exact destination period and its count. §1.4 rejects the segmented control on measurement: 42 characters at 360px, a permanent row that says nothing the title has not said, and it treats an ordered scale as five peers | **UX wins.** The owner's complaint was clutter and the spec's control costs a permanent row on the screen the complaint was about. The sheet also carries strictly more information (destination + count) than a five-label strip can. R-lens-13's real content — one tab stop, `←`/`→` between options, the selection announced not merely coloured — survives inside the sheet | **SPEC** — R-lens-13 superseded by **R-lens-17** |
| ★C-2 | The period picker | **R-lens-7**: the period label is tappable and opens a picker; the picker marks periods that hold items with a dot | §10: **no period picker.** Chevrons only, plus `Jump to now`. A second control over one dimension is how D-24 happened | **UX wins**, and it is forced: under C-1 the title button is already spoken for by the Zoom sheet, so there is no control left to open a picker. R-lens-7's picker clauses become unreachable and are deleted. Its *purpose* is not — see C-2b | **SPEC** — R-lens-7 rewritten |
| C-2b | Consequence of C-2 | R-lens-7's dot is the only thing that makes a goal written three months out discoverable from anywhere but that month | (no answer — the UX plan does not raise it) | With no picker there is no surface for the dot. **New rule R-lens-26**: the forward chevron carries a dot when any later period at this horizon holds an item. One dot, no new control, no row | **SPEC** — new R-lens-26 |
| C-3 | Chevron bounds | R-lens-7: the back chevron is disabled at the account's first period | §6.1/§8.3: both chevrons disabled on Life only; elsewhere always enabled | **UX wins.** "The account's first period" needs a `MIN(period_key)` query on every lens render to disable one control, and a bound that exists in one direction only is D-24's asymmetry rebuilt | **SPEC** — R-lens-7 |
| C-4 | The off-now return control | R-lens-7: `Today` / `This week` | §7.1: `Now ›` in the off-now row; `Jump to now` in the Zoom sheet footer | **UX wins** (copy) | **SPEC** — R-lens-7; new **R-lens-21** for the off-now row |
| C-5 | Period badge copy | R-lens-11: `Planning ahead` / `Past — still editable` | §7.1: `Future month — planning ahead`, `Past quarter — still editable`, per horizon | **UX wins** (copy). The horizon word is what makes the badge true on four lenses instead of one | **SPEC** — R-lens-11 |
| C-6 | Route shapes | R-nav-24 / R-lens-14: `/goals/:lens?period=<periodKey>`, `/goals/:id`, `/tasks/:id` | §1.6: `/life`, `/year/2026`, `/quarter/2026-Q3`, `/month/2026-08`, `/week/2026-08-31`, `/goal/:id`, `/task/:id` | **UX wins.** A URL is user-facing, `/week/:monday` carries the absolute Monday D-1 requires, and every shape still restores lens + period, which is all R-nav-24 asked for | **SPEC** — R-nav-24, R-lens-14 |
| C-7 | Which lens opens on a cold start | R-lens-8 fixes the *period* (the current one) and is silent on the *lens* | §11 Q2: **Weekly** | **UX wins.** The spec had a hole, not a position | **SPEC** — new **R-nav-28** |

### 1.2 Grouping, counts and the lens body

| # | Conflict | Spec says | UX plan says | Resolution | Changed |
|---|---|---|---|---|---|
| ★C-8 | Empty groups | **R-lens-6**: a Life goal with no items in the period still renders its header and count with `Nothing at this horizon for <period>.` — "a hidden group is indistinguishable from a deleted goal". In the Weekly lens this line is **dormancy's only surface** (R-goal-38) | §4.3: **a group with no items in this period is not rendered.** "It is a lens, not a roster" | **UX wins.** A twelve-line account renders twelve headers on the Quarterly lens where two have items — that is the clutter complaint, restated. The spec's worry is answered by the Life lens, which always shows every Life goal. **This costs dormancy its surface**, which is why it is decided together with C-9 | **SPEC** — R-lens-6 |
| ★C-9 | Where dormancy shows | R-goal-38: dormancy's single consumer is R-lens-6's empty-group line in the Weekly lens. R-goal-38 also states that a Monthly goal with no Weekly children gets **no special affordance and no different styling** | §5.1: the Monthly card carries a **planned-ness line** — `Nothing planned yet` / `3 weekly goals` / `3 weekly goals · 1 this week` / `3 weekly goals · nothing this week` — explicitly "the honest successor to dormancy" | **UX wins, and C-8 forces it.** Hiding empty groups deletes the spec's only dormancy surface, so the successor must exist. The Monthly lens is also the right horizon: it is where something can be done about it | **SPEC** — R-goal-38; new **R-goal-47** |
| ★C-10 | Numbers on a card | **R-nav-26**: "The only numbers in the product are R-lens-4's open count, R-goal-24's carrying line, `N in backlog`, and the carry chip. **Any other number is out of scope and must be refused, not deferred.**" | §5.1's line carries two more (`3 weekly goals · 1 this week`) | **Sanctioned, narrowly.** The line is not a report — no bar, no percentage, no colour, not a link (§5.1's three refusals stand) — and it is *replacing* a surface, not adding one. R-nav-26's list gains exactly this entry and nothing else | **SPEC** — R-nav-26, R-goal-47 |
| ★C-11 | What the group count counts | **R-lens-4**: open tasks under that Life goal **visible in the anchoring week** — the selected week in the Weekly lens, the *current* week everywhere else. "The number never changes meaning as you browse" | §4.2 / §11 Q3: open tasks visible in **every week the selected period covers**, so the Monthly lens shows a month's worth | **SPEC wins.** The UX definition is not truthful in either direction. An open task is visible in every week ≥ its origin, so "visible in some week of a past month" counts tasks that are open *now* and originated before it — the count says something about today while sitting on a past month's header. Forward it is worse: every future month shows the same number (all currently open tasks), which R-lens-11 forbids outright — "no count may fire on work whose period has not arrived" | **UX** — §4.2, and §8.2's accessible name becomes `…, 3 open tasks this week.` |
| C-12 | Zero counts | R-lens-4: the count renders `0`; the header is never hidden | §4.2: zero is never rendered, visibly or in the accessible label | **UX wins** (copy). With C-8 the header only exists when the group has items, so a `0` there is chrome | **SPEC** — R-lens-4 |
| C-13 | A single group | (implied by R-lens-4: every group has a header) | §4.1: with exactly one group the header does not render at all | **UX wins.** A header over the only group names the card beneath it | **SPEC** — new **R-lens-19** |
| C-14 | The root-less group | R-lens-3: `Unattached`, last — for a goal whose `parentId` points at nothing, or a cycle | §4.5: `UNSORTED`, last, `These aren't under a Life goal yet.`, with a per-item `Put under a Life goal…` action, no count, never collapsed by default | **UX wins on the label** — `Unsorted` is live product vocabulary (`CaptureScreens.tsx:38`, R-learning-2/3) and survives Ideas' deletion. **The UX plan's premise is wrong** and is corrected: §4.5 says a parentless Yearly/Quarterly/Monthly goal is "representable today", but R-goal-4 and `checkCreate` refuse it. The only way in is a dangling `parentId`, a cycle, or the migration — so the group is a data-integrity surface, not an ordinary state | **SPEC** — R-lens-3; new **R-lens-20**. **UX** — §4.5's premise |
| C-15 | The parent line | (no rule) | §4.4: one muted line, the item's immediate parent, suppressed when that parent is the group's own Life goal; a button to that parent's detail; `T.mut`, never `faint` | **UX wins** — it is strictly less than today's full breadcrumb | **SPEC** — new **R-lens-23** |
| C-16 | Collapse | R-lens-1: a lens is "never expandable or collapsible **per node**" | §4.1: group headers collapse | **No conflict, but it reads as one.** Per-*group* collapse is not per-*node* expansion; R-lens-19 says so explicitly so a builder does not read R-lens-1 as a ban | **SPEC** — new R-lens-19 |
| C-17 | Empty-state count | R-lens-6: two empty states (empty group, empty lens) | §7.2: three — it adds *empty at every period* (`Nothing quarterly yet.` / `A quarter is long enough to change something and short enough to finish.`), because `Q3 2026 is unclaimed` misleads someone who has never used the lens | **UX wins**, and it is a genuinely better state | **SPEC** — new **R-lens-24** |
| C-18 | The Life lens item | R-lens-4: R-goal-24's carrying line (`N tasks carrying · oldest W weeks`) renders on a Life goal's item in the Life lens | §6.1's card shows `3 open · 2 in backlog` and no carrying line | **SPEC wins.** R-goal-24 is the product's one quiet signal and predates the redesign; dropping it is not a decision the UX plan argued for | **UX** — §6.1 |

### 1.3 The zoom model, the Weekly lens, and creation

| # | Conflict | Spec says | UX plan says | Resolution | Changed |
|---|---|---|---|---|---|
| ★C-19 | Monthly → Weekly zoom target | R-lens-9: "the week containing the **1st**"; the resulting Monday "may fall in the previous month … and that is correct" | §3.2: "the **first week whose Monday is in** that month", and §3.2's stated principle — *a week that straddles a month boundary belongs to its Monday's month* | **UX wins.** The spec's version is inconsistent with its own model: R-goal-33 keys a week by its Monday, so zooming into `Nov 2026` under R-lens-9 lands on the week of Mon 26 Oct — a week that every other rule counts as October's. It would also disagree with R-goal-47's planned-ness scope, which is Monday-based, and with R-task-49's target week, which must be the same clamp | **SPEC** — R-lens-9 |
| C-20 | R-lens-9's worked example | "In `Q3 2026` on 31 Aug, zooming to Monthly gives `Sep 2026`, not `Jul 2026`" | §3.2: `Aug 2026` | **UX is right; the spec's only worked example is arithmetically wrong** — 31 Aug is in August. Corrected | **SPEC** — R-lens-9 |
| C-21 | The zoom anchor | R-lens-9 has an anchor but does not say where it lives, when it resets, or what a cold start does | §3.1: a session-held date; today on cold start (server's today, R-auth-5); stepping a period moves it to the first day of the new period unless today is inside it; zooming never moves it | **UX wins** — the spec's anchor is unimplementable as written | **SPEC** — new **R-lens-18** |
| ★C-22 | **The carried band** | **R-lens-12**: a Weekly goal appears in week `W` iff `periodKey = W` **or** it still holds an open task visible in `W`; the second kind renders in a separate band **below** the week's own goals, **oldest first**, each labelled with its own week (`from week of 24 Aug`), each showing only its tasks visible in `W`, and **`+ Task` never renders on it** | §6.5 renders **no carried band at all.** There is no band, no ordering, no `from week of …` label, and no copy for any of it in §7.1. §6.5's own mockup shows a task carrying at age 3 (`3 weeks · since 10 Aug`) *inside a current-week goal card* | **SPEC wins, and the UX plan's Weekly lens is unbuildable as drawn.** Under R-task-40 a task's `originWeekStart` is seeded from its Weekly goal's immutable `periodKey`, so a task with origin 10 Aug cannot sit under a goal whose `periodKey` is 31 Aug. The mockup's own example *is* a carried goal, drawn in the wrong place. Without the band, an open task whose goal's week has passed renders nowhere — silent loss of work, which is the one thing R-task-7 exists to prevent | **UX** — §6.5 must add the band, §7.1 must add its copy, §8.1 must add its focus order |
| C-23 | `+ Task` in the carried band | R-lens-12 / R-task-41: never — adding new work to a past week's goal is back-dating | §6.5: every weekly-goal card carries the `+ Task` / `Pull from backlog` link row | **SPEC wins** (it follows from R-goal-36) | **UX** — §6.5 |
| C-24 | `planned N weeks ago` | R-goal-43: a muted line under a stale Weekly goal's title, in the Weekly lens and on its detail page | §5's card anatomy lists six elements and this is not one of them | **SPEC wins.** §5.1's own rationale (a lens must say when a plan has gone stale) argues for it | **UX** — §5, §7.1 |
| ★C-25 | `Repeat last week` | R-goal-46 is a full rule; Q-22 places it "from the Life group's own header" | The UX plan never mentions it. Its group header is *only* a collapse toggle — "the whole row is the collapse toggle, with no separate chevron button" | **Both change.** Q-22's placement is impossible under §4.1, so the action moves to the **group foot**, beside the per-group `+ Weekly goal` — a row that already exists in §5's body, in the Weekly lens only. Per-line, as Q-22 requires; no new row; the header stays one gesture | **SPEC** — R-goal-46, Q-22. **UX** — §5's group foot gains a second link in the Weekly lens |
| ★C-26 | `+ Weekly goal` on a Monthly goal | Q-20 and R-nav-25 both put it on a Monthly goal's row / detail page | §10: **refused** — "a create button for the horizon below, on every card, is a tree growing back one affordance at a time". `+ Task` covers the case and infers the weekly goal | **Split by surface.** In the **Monthly lens**, UX wins: no `+ Weekly goal` on a card; `+ Task` infers (C-27). On the Monthly goal's **detail page**, the spec wins: R-nav-25's primary action is unchanged, because a detail page is not a lens and carries exactly one primary action already | **SPEC** — Q-20 |
| ★C-27 | Inferring the Weekly goal | R-task-48: when no Weekly goal exists for the target week, the task-create sheet offers an inline `New weekly goal` **field**; the wire takes `goalId` **or** `newWeeklyGoal: {parentId, title}`, one transaction | §6.7.1: the second step is **inferred, never asked** — one candidate is used silently, several show a preselected picker, none creates one implicitly **titled from the Monthly goal**, stated in the sheet before saving and named in the toast afterwards | **UX wins on the flow; the spec's wire contract is unchanged and is what makes the flow possible.** They are the same transaction with a different form: R-task-48's `newWeeklyGoal.title` is pre-filled rather than blank. R-task-48's UI clause is amended and the flow becomes **R-task-49** | **SPEC** — R-task-48; new **R-task-49** |
| C-28 | Task create sources | R-task-41: three — `+ Task` on a Weekly goal, a backlog pull, the `+` drawer | §6.7.1 adds a fourth: `+ Task` (and `Pull from backlog`) on a **Monthly** goal card | **UX wins** — R-task-41 gains a fourth source, which R-task-49 defines | **SPEC** — R-task-41 |
| C-29 | The task page checkbox | R-task-45 lists the page's contents; the checkbox is not among them. R-task-14 says complete is "the checkbox" and does not say there is only one | §6.6: the checkbox comes to the page; completing there returns to the lens with the toast | **UX wins.** Still exactly three exits (R-task-13), one of them with a second home | **SPEC** — new **R-task-50** |
| C-30 | The gesture | (no rule) | §8.4: one horizontal swipe on the lens body steps the period; suppressed on Life and inside horizontal scrollers; `←`/`→` and `Shift+↑`/`Shift+↓` as documented accelerators, never the only route | **UX wins** | **SPEC** — new **R-lens-25** |

*(C-2b, C-9, C-12, C-16, C-20 are consequences of the decision above them and are numbered separately
because each needs its own edit. Twenty-six conflicts, ten of them ★.)*

### 1.4 Everything `UX-PLAN.md` must change

Collected, since this document may not edit it.

| § | Change |
|---|---|
| §4.2 | The group count is **open tasks visible in the anchoring week** — the selected week in the Weekly lens, the current week in every other lens (R-lens-4). Delete the month/quarter/year spanning definition and §11 Q3's recommendation |
| §4.5 | Correct the premise: a non-Life goal with no parent is **refused** by R-goal-4 / `checkCreate`. `UNSORTED` holds goals whose `parentId` dangles, whose chain cycles, or which the migration could not attach |
| §5 | The card anatomy gains `planned N weeks ago` for a stale Weekly goal (R-goal-43), between the parent line and the backlog line |
| §5 (group foot) | In the Weekly lens, the group foot carries `Repeat last week` beside `+ Weekly goal` (R-goal-46) |
| §6.1 | The Life lens card carries R-goal-24's carrying line (`N tasks carrying · oldest W weeks`) when it fires |
| **§6.5** | **Add the carried band.** Below the week's own goals: one band, oldest `periodKey` first, each goal labelled `from week of 24 Aug`, each showing only its tasks visible in the viewed week, **no `+ Task`, no `Pull from backlog`** on any of them, collapsible as a whole (Q-21). The mockup's `3 weeks · since 10 Aug` task belongs in it, not in `Three easy runs and one long run` |
| §7.1 | Add: `from week of 24 Aug` (carried label); `Carried` (band heading); `planned 3 weeks ago`; `Repeat last week`. Change the group-header accessible name from `…3 open tasks in Q3 2026` to `…3 open tasks this week` |
| §7.2 | The past-week empty state must also cover "this week's plan is empty but work is carrying" — the band renders with no plan above it |
| §8.1 | Focus order in the Weekly lens gains the band: after the last own-week group, `Carried` disclosure → each carried goal title → its parent line → its tasks. No create stops inside the band |
| §8.2 | Announce the band on arrival: `4 goals this week, 2 carried.` |

### 1.5 Vocabulary drift

The retired words are `leaf` / `leaves`, `focus` (as an entity), `idea`, `dormant`, `plan` (as a screen
or a mode), `active leaf`, `branch`.

**Result: the user-facing copy is clean.** Every hit in `UX-PLAN.md` is in rationale prose — quoting the
owner, naming what is being deleted, or forbidding the word. §7.1 even carries the guard verbatim:

> `Tasks live on weekly goals.` — never "leaves hold tasks"

Two residues, neither of them copy:

| Where | Residue | Disposition |
|---|---|---|
| §4.5 (line 370) | `UNSORTED` is justified as *"the vocabulary the product already uses for untagged **ideas** and learnings"* | The label survives R-rm-1 because **Learnings** still uses it (`CaptureScreens.tsx:38`, R-learning-2/3). The justification must drop Ideas; the word stays |
| §8.1 (line 1004) | The heading `### 8.1 Focus order per screen` | Not the retired sense — this is DOM focus. Left alone deliberately, recorded here so a later grep-audit does not flag it |

One near-miss worth naming: §5.1 came within a sentence of rebuilding the dead model — *"no only leaf
node can have tasks"* is the owner's own correction, and the UX plan's answer (§5.1's closing paragraph)
is exactly right. It is the strongest single passage in either document on this point.

---

## 2. New rules the UX plan implies

Rule text, ready to paste. All sixteen have been added to `docs/SPEC.md` §2; they are reproduced here so
this document reads standalone.

### Goal

- **R-goal-47 (the planned-ness line — dormancy's one surface)** — A Monthly goal's card, in the Monthly
  lens and on its detail page, carries one muted line stating how it is broken into weeks. The scope is
  *Weekly goals whose parent chain reaches this Monthly goal and whose week's **Monday** falls in the
  viewed month* — the same Monday rule as R-lens-9 and R-task-49, so one answer serves zoom, creation and
  this count.

  | Situation | Copy |
  |---|---|
  | No Weekly goals under it in any week of the viewed month | `Nothing planned yet` |
  | Weekly goals exist; the viewed month does not contain today | `3 weekly goals` |
  | Weekly goals exist; today is in this month and ≥1 falls in the current week | `3 weekly goals · 1 this week` |
  | Weekly goals exist; today is in this month and none falls in the current week | `3 weekly goals · nothing this week` |

  - **This is dormancy's only surface** (R-goal-38, amended): R-lens-6's empty-group line is gone with
    empty groups (R-lens-19). `nothing this week` is `DORMANT — no focus this week` said in plain words,
    one horizon up, where something can be done about it.
  - **Not an escalation.** `nothing this week` is the same `T.mut` grey as `3 weekly goals`. A month
    being unplanned is a fact, not a failure, and the red carry chip stays the only escalation
    (R-task-11, R-lens-11).
  - **Not a report and not a link.** No bar, ring, percentage or ratio (R-nav-26, R-goal-45). Tapping it
    does nothing — zooming into one card's weeks is a filtered subtree, which is the thing being removed.
  - It is the **only** number R-nav-26's list gains in this pass, and it replaces a surface rather than
    adding one.

### Lens

- **R-lens-17 (the lens control is the title)** — There is no persistent lens switcher. The lens row
  carries `‹`, the period title, `›`; the title is a button that opens the **Zoom sheet** (heading
  `Change lens`), a vertical ladder of the five horizons, each row naming the exact period it would land
  on and its count (R-lens-22), the current lens marked `aria-current="true"`, with `Jump to now` in the
  footer when the selected period is not the current one. *Supersedes R-lens-13.*
  - **Altitude is vertical, time is horizontal; the two dimensions never share a widget.**
  - The sheet is the existing `Sheet` (R-nav-15's contract, focus-trapped, `aria-labelledby` its `<h2>`);
    focus returns to the title button on close. Selection is announced, never merely coloured — the one
    requirement R-lens-13 carried that survives it.
  - The Goals tab returns to the lens you were last in (R-nav-28), so daily use never opens the sheet.
- **R-lens-18 (the zoom anchor)** — The lens shell holds one **anchor date** for the session.
  - Cold start: the server's today in the owner's timezone (R-auth-5), never the device clock.
  - Stepping the period with `‹`/`›` moves the anchor to the **first day of the newly selected period**,
    unless today falls inside it, in which case the anchor is today.
  - **Zooming never moves the anchor**, which is what makes zoom lossless and reversible: `Q3 2026` →
    Monthly → Quarterly returns to `Q3 2026`, always.
  - **Life does not reset it.** Life has no period; going up to Life and back down returns you where you
    were. The naive reading — Life clears the period, so coming back means today — makes the one lens
    with no time dimension silently destroy your position.
  - The anchor is not persisted across sessions (R-lens-8).
- **R-lens-19 (group rendering)** — Every lens except Life groups its items under the owning Life goal
  (R-lens-3). The header is one `S.sectionLabel` row: `▾ <LIFE GOAL TITLE> · 3 OPEN`.
  - **The whole row is the collapse toggle**, with a `▾`/`▸` glyph and no separate button. Default
    expanded; collapse is session-scoped and per-lens, never persisted — a collapsed group that survives
    a restart is a hidden goal. This is per-*group* collapse and is not the per-*node* expansion R-lens-1
    forbids.
  - **A group with no items in the selected period is not rendered.** *Supersedes R-lens-6's
    empty-group clause.* A lens is not a roster; the Life lens is where every Life goal is guaranteed
    visible.
  - **When a lens has exactly one group the header does not render at all.** A header over the only
    group names the card beneath it.
  - Collapsing a group in the Weekly lens hides that line's tasks. That is what collapse means, and it
    is session-only.
- **R-lens-20 (`UNSORTED`)** — A goal whose ancestor chain does not reach a Life goal — a dangling
  `parentId`, a cycle (R-lens-3's cycle-safe walk), or a migration that could not attach it — groups
  under **`UNSORTED`**, pinned last, with the line `These aren't under a Life goal yet.` *Renames
  R-lens-3's `Unattached`;* `Unsorted` is live product vocabulary (R-learning-2/3) and survives
  Ideas' deletion.
  - The group carries **no count** and is **never collapsed by default**.
  - Each item gains one extra action, `Put under a Life goal…`, opening the Move sheet with Life goals
    pre-listed.
  - **This state is not reachable through the product**: R-goal-4 and `checkCreate` refuse a parentless
    non-Life goal. It is a data-integrity surface, and it must surface rather than silently drop a row.
- **R-lens-21 (the off-now row)** — When the selected period is not the one containing today, and only
  then, one conditional row renders below the lens row: the badge on the left
  (`Past month — still editable` / `Future quarter — planning ahead`, per horizon — R-lens-11's copy,
  generalised) and a `Now ›` link button on the right. This is the escape hatch unbounded forward
  navigation requires: without it, fourteen months out is fourteen taps home. The current period is
  unbadged and the row does not render.
- **R-lens-22 (the Zoom sheet's counts)** — Each Zoom-sheet row shows the number of goals at that horizon
  in the period that row would land on (Life reads `everything`). A zero count is omitted, not rendered.
  - **This is one read, not five.** It is served by a single grouped query over `ix_goals_lens`
    (§3.6); it must never be five lens reads, and it must never fetch rows to count them.
  - It is a count of **goals**, not of tasks, and it is the only count in the sheet.
- **R-lens-23 (the parent line on an item)** — An item in a lens shows its **immediate parent** as one
  muted line — `under Run a sub-2h half marathon in 2026` — **unless that parent is the group's own Life
  goal**, in which case nothing renders. The line is a button opening that parent's detail page: the only
  way to walk *up* without a tree.
  - It renders on Quarterly, Monthly and Weekly items. A Yearly item's parent is always its group's Life
    goal, so it never renders there; a Life item has no parent.
  - It is `T.mut` at 12.5px and **never** `faint`, which fails AA in both themes.
  - It is at most one name. The full path is the tree wearing a different hat (R-lens-1).
- **R-lens-24 (the third empty state — empty at every period)** — When the account has Life goals but no
  goals at this horizon in **any** period, the lens shows a horizon-level empty state instead of the
  period-level one, because `Q3 2026 is unclaimed` misleads someone who has never used the lens at all:
  *`Nothing quarterly yet.`* / `A quarter is long enough to change something and short enough to finish.`
  / `[+ Quarterly goal]`. *Extends R-lens-6, which had two states and needed three.* The period-level and
  past-period states are unchanged.
- **R-lens-25 (one gesture, and its keyboard equal)** — A horizontal swipe on the lens body steps the
  period, mirroring the chevrons' direction. It is an **accelerator, never a route**: the chevrons are
  always present and never hidden. It is suppressed on the Life lens and inside any horizontally
  scrolling child. There is **no vertical swipe** — vertical is the scroll axis.
  - Keyboard, as documented convenience only: `←`/`→` step the period and `Shift+↑`/`Shift+↓` change
    altitude by one, from anywhere in the lens body. Every one of them has a visible control one `Tab`
    away, so the accessibility floor never depends on them.
- **R-lens-26 (the forward-content marker)** — The forward chevron carries a dot when **any** later period
  at this horizon holds at least one goal, or one task originating in it. *Replaces R-lens-7's picker dot,
  which has no picker to live in (R-lens-17).* Without it a goal written three months out is invisible
  from every screen except that month's, which unbounded forward creation makes far more likely. One dot,
  no new control, no row, no count.
- **R-lens-27 (no read loads the whole goal list)** — Extends R-lens-16 from the wire to the server. **No
  request may call a repository method that returns every goal.** A lens read is one horizon and one
  period (R-lens-16); grouping and the Life-root walk read the **interior tree** — every goal whose
  horizon is not Weekly — which does not grow weekly; a create guard reads one row; a move or delete
  guard reads one subtree. `IGoalRepo.listAll` is deleted rather than left unused, so no later caller
  can reintroduce it (R-rm-* discipline). See §3.

### Task

- **R-task-49 (`+ Task` from a Monthly goal — the Weekly goal is inferred, never asked)** — `+ Task` and
  `Pull from backlog` on a **Monthly goal's card** create a task under a Weekly goal that the server
  resolves. *This is R-task-41's fourth create source.*
  - **The target week** is the same clamp as R-lens-9's Monthly → Weekly zoom: the week containing today
    when the viewed month contains today, otherwise the **first week whose Monday falls in that month**.
    One rule answers "which week does this month mean" for zoom, for this creation and for R-goal-47's
    scope, so the three can never disagree.
  - **Resolution**, over the Weekly goals under this Monthly goal in the target week: exactly one → used,
    with no picker and no extra tap; more than one → a picker with the first preselected; **none** → one
    is created, using R-task-48's `newWeeklyGoal` in the same transaction.
  - **The implicit Weekly goal takes the Monthly goal's title.** `Run 4 times a week in August` reads
    correctly as a weekly goal and is renamable in one tap. `This week` is meaningless in a list grouped
    by Life goal; naming it after the task confuses the step with the intent.
  - **Stated before, named after.** The create sheet says what will happen — `This starts a weekly goal
    "<title>" for the week of <Mon d Mon>. You can rename it after.` — and on save the toast reads
    `Added to week of <Mon d Mon>`, the app moves to the Weekly lens at that week scrolled to the new
    task, and the live region carries `Added to week of Mon 31 Aug, under Run 4 times a week in August.`
    **Nothing is created invisibly**, and the move is R-nav-19's requirement, not a convenience.
  - The Monthly card offers **no** `+ Weekly goal` (Q-20, amended): a create button for the horizon below
    on every card is a tree growing back one affordance at a time. Laying out a week deliberately is the
    Weekly lens's job; the Monthly goal's **detail page** keeps `+ Weekly goal` as its one primary action
    (R-nav-25).
  - This retires the `This branch isn't active this week` dead end entirely: there is no longer a state
    in which a backlog item cannot become work, because the thing it needed to hang off is created for it.
- **R-task-50 (the task page's checkbox)** — The task page (R-task-45) carries the completion checkbox,
  and completing there returns to the lens with the toast. It is **exit 1 given a second home**, not a
  fourth exit (R-task-13 unchanged): a user who opened the page to finish a task must not have to back
  out first. The checkbox is bounded exactly as everywhere else (R-task-44: `originWeek ≤ week ≤
  currentWeek`), so a future task's page renders no checkbox.

### Navigation & system

- **R-nav-27 (two rows of chrome)** — Above the first item of any lens there are **at most two
  unconditional rows**: the top-right cluster (R-nav-25) and the lens row (R-lens-17). Everything else is
  conditional — the off-now row (R-lens-21) only off-now, group headers (R-lens-19) only when there is
  more than one non-empty group. Today's Tasks screen carries four rows and the tree carries three plus
  depth; the budget is what makes the redesign answer *"its too clutered"* before any new capability is
  counted. **A new unconditional row is refused, not deferred** — this is the rule that says no to the
  next control, and it is the reason R-lens-13 was superseded.
- **R-nav-28 (where the app opens)** — A cold start opens the **Weekly lens** at the week containing
  today. Within a session the Goals tab returns to the lens last used, always at the period containing
  today (R-lens-8). The period **never** survives a cold start: an app that opened on a remembered future
  period would quietly lie about now.

---

## 3. The scale problem — measured

### 3.1 The claim, and what is actually true

`apps/api/src/domain/goal-tree.ts:13`:

> *"Every function takes the owner's FULL goal list — at most 500 nodes, at most 4 levels deep (Q-12,
> R-goal-7) — so nothing here needs a query."*

The premise is invalid under A2, and the product is worse than the PM described. Three corrections:

| PM's claim | Verified | Correction |
|---|---|---|
| "`isLeaf` … is called from inside `orderedTree`'s walk: O(n²)" | **False as stated** | `orderedTree` (`goal-tree.ts:146-169`) is **Θ(n log c)** and never calls `isLeaf`. It is the one correctly-indexed walk in the file. The quadratic is `GoalService.toView` (`goal.service.ts:456-486`), which `list()` maps over `orderedTree`'s **output** (`goal.service.ts:81`) |
| "O(n²)" | **Understated** | `toView` is `isLeaf` (O(n)) + `descendantIds` (O(n·s)) + `anyActiveBelow` (O(n·s)) per goal, and Σ s(g) ≈ n·d, so `GET /goals` is **Θ(n²·d)** — 4× worse than quadratic today, 5× after R-goal-32 |
| "~1,000 goals a year" | **~2.5-6× high** | 1,000/yr needs ~19 new Weekly goals every week. A five-line account with one Weekly goal per Monthly goal per week plus a Life-hung weekly practice produces **≈ 395 goals in year one** (measured, §3.2). The conclusion is unchanged; the cliff moves from year 2 to year 4-5 |
| "a 500-goal cap, a 100-children cap" | **Neither exists** | `MAX_GOALS` and `MAX_CHILDREN` are not in the codebase. The numbers appear only in prose (`goal-tree.ts:13`, `entities.ts:32`, `schema.ts:124`, `repositories.ts:48`, `SPEC.md:934`) and are **enforced nowhere**. Depth is the only real bound, enforced structurally by `checkCreate`'s rank comparison. "Raising the cap" is therefore a no-op in code; the whole deliverable is the query strategy plus, for the first time, real enforcement |

### 3.2 Measured

`GET /goals` reproduced exactly (`orderedTree` + `toView`'s three derivations + `branchesOf`), over a
synthetic account of 5 Life lines, one Yearly/4 Quarterly/12 Monthly per year, one Weekly goal per
Monthly goal per week, and a Weekly practice hung directly off each Life goal (legal under R-goal-32).
Counting array-element visits, Node 22 on one modern laptop core; a Worker isolate is slower.

| Account age | n (goals) | Element visits | Wall time |
|---|---|---|---|
| today (no Weekly horizon) | 85 | ~0.01 M | <1 ms |
| 2 months | 140 | 0.16 M | 3 ms |
| **1 year** | **395** | **1.4 M** | **5 ms** |
| 2 years | 785 | 5.4 M | 18 ms |
| 4 years | 1 565 | 21.7 M | 64 ms |
| 10 years | 3 905 | 135 M | 423 ms |
| 20 years | 7 805 | 541 M | 1 892 ms |
| **at the spec's proposed 10 000 cap** | **9 755** | **845 M** | **2 932 ms** |

n doubles, visits quadruple, time triples-to-quadruples. **Quadratic confirmed.** This runs on
`GET /goals`, on `GET /bootstrap`, and again after **every** goal mutation.

**The cheapest possible fix, also measured.** Build one index per request — `Map<id, node>` plus
`Map<parentId, node[]>` — and let every primitive read it instead of scanning:

| n | Today | Indexed | Factor |
|---|---|---|---|
| 395 | 1.4 M / 5 ms | 3 290 / 0.8 ms | 417× |
| 1 565 | 21.7 M / 64 ms | 13 130 / 1.3 ms | 1 653× |
| 9 755 | 845 M / 2 932 ms | 82 010 / 5.3 ms | **10 300× visits, 553× time** |

That change is confined to `goal-tree.ts`'s primitives and their call signatures. No schema, no query,
no rule. **It is not the answer** — §3.3 is — but it is the answer's floor, and it is worth doing first
because it makes every remaining full-tree consumer (the guards, the delete cascade, MCP) linear
instead of quadratic even where the tree is legitimately needed.

### 3.3 Every place the whole goal list is loaded or walked

All goal rows enter through exactly one method: `IGoalRepo.listAll(userId)` —
`apps/api/src/application/ports/repositories.ts:51`, implemented at
`apps/api/src/infrastructure/persistence/d1-goal.repo.ts:18`, `WHERE user_id = ?`, **no limit, no
cursor, no filter**.

| Call site | Route it serves | Loads all n? | Actually needs |
|---|---|---|---|
| `goal.service.ts:436` `snapshot()` | `GET /goals`, `GET /goals/:id`, and every goal mutation's response | yes | one lens page + the interior tree |
| `goal.service.ts:123` `create()` | `POST /goals` | yes | **one row** (the parent) |
| `goal.service.ts:181` `move()` | `POST /goals/:id/move` | yes | one row + one subtree |
| `goal.service.ts:248` `remove()` | `DELETE /goals/:id` (incl. `?dryRun`) | yes | one subtree |
| `goal-tree-guard.ts:44` `assertCanCreate` | `POST /goals` (again, before the service) | yes | **one row** |
| `goal-tree-guard.ts:58` `assertCanMove` | `POST /goals/:id/move` (again) | yes | one subtree |
| `task.service.ts:420` `assertActiveLeaf` | `POST /tasks` | yes | **one row** (`horizon = 'Weekly'` — R-goal-39) |
| `backlog.service.ts:291` `listForGoal` | `GET /backlog?goalId=` | yes | one subtree, Life goals only |
| `backlog.service.ts:493` `resolveConversionTarget` | `POST /backlog/:id/convert` | yes | Weekly goals under one goal for one week |
| `capture.service.ts:227` `requireActiveLeaf` | idea routes | yes | *deleted with Ideas (R-rm-1)* |
| `plan.service.ts:33,71` | `GET/PUT /plan` | yes | *deleted with the plan endpoints (R-rm-3)* |
| `capture.service.ts:372-380` `BootstrapService.get` | `GET /bootstrap` | **twice** (`GoalService.list` + `PlanService.get`) | Life goals + the current week's lens + that week's tasks (R-rm-5) |
| `mcp/shapes.ts:115,159,149` + every tool in `mcp/tools/*` | `POST /mcp` | yes, often twice per call | scoped reads |

**Amplification per request:** `POST /goals` and `POST /goals/:id/move` each run
`SELECT * FROM goals WHERE user_id = ?` **three times** (guard, service, response snapshot);
`GET /bootstrap` runs it twice.

**Three more quadratics outside `goal-tree.ts`:**

| Site | Cost | Trigger |
|---|---|---|
| `mcp/shapes.ts:115-123` `pathOf` / `pathIndex` | Θ(n²·d) — `goals.find` + `ancestors` per goal | every MCP tool call |
| `mcp/shapes.ts:159-168` `outline` | Θ(n²·d) — `ancestors(g)` per goal for depth | `get_overview`, tree resources |
| `mcp/shapes.ts:149` `goalOut` → `isLeaf` | Θ(n²) mapped over all goals | `get_overview` (`tools/goals.ts:68`) |
| `goal.service.ts:260` `ideaRows.filter(i => subtree.includes(i.goalId))` | O(ideas · subtree) — `Array.includes` in a filter | every goal delete and dry-run — *removed with Ideas* |

**And a sharper cliff than CPU.** `goal.service.ts:436-442` builds `goalIds = goals.map(g => g.id)` —
**all n** — and passes it to `tasks.listOpenByGoals` and `backlog.listOpenByGoals`, which become
`inArray(...)` with n placeholders (`d1-task.repo.ts:56`, `d1-backlog.repo.ts:40`). There is **no
chunking anywhere in the repository layer**. The same shape recurs at `goal.service.ts:254-258` (delete
cascade) and `:95-96` (Life-goal backlog roll-up). D1 documents a bound-parameter ceiling per query;
whatever its current value, binding one parameter per goal is a pattern that fails on account size
rather than on request shape, and it must be replaced by a join or by chunking regardless of the number.
**Verify D1's current limit before sizing the chunk.**

**Payload, separately from CPU.** `GET /bootstrap` ships five unbounded collections (`goals`, `tasks`,
`backlog`, `ideas`, `learnings`). `MAX_PAGE = 200` exists at `packages/shared/src/common.ts:152` and is
**referenced nowhere** — no endpoint paginates. The only `.limit()` on a product table in the whole API
is task events (`d1-task.repo.ts:138`).

### 3.4 What each lens actually needs

Four reads, none of which touches the whole list.

| # | Need | Query | Index | Bounded by |
|---|---|---|---|---|
| 1 | **The lens page** (R-lens-16) | `SELECT * FROM goals WHERE user_id=? AND horizon=? AND period_key=? ORDER BY created_at, id LIMIT 201` | `ix_goals_lens` — exact prefix match, no filesort | the page cap |
| 2 | **The interior tree**, for the Life-root walk and the group order | `SELECT id,parent_id,horizon,title,pulse,created_at FROM goals WHERE user_id=? AND horizon <> 'Weekly'` | `ix_goals_lens` (four horizon seeks) | the interior set — see below |
| 3 | **Group counts** (R-lens-4) | `SELECT goal_id, COUNT(*) FROM tasks WHERE user_id=? AND status='open' AND origin_week_start<=? GROUP BY goal_id` | `ix_tasks_open_week` — exists today | open tasks, one row per Weekly goal holding work |
| 4 | **Weekly lens tasks + the carried band** (R-lens-12) | the existing week read (`d1-task.repo.ts:34-49`), then `DISTINCT goal_id` → `SELECT * FROM goals WHERE user_id=? AND id IN (…)` chunked; those with `period_key <> W` are the band, ordered by `period_key` asc | `ix_tasks_open_week` / `ix_tasks_done_week` + PK | open work in that week |

**Resolving each item's owning Life goal — the ancestor walk of arbitrary depth (R-lens-3).** Three
options were considered:

| Option | Cost | Verdict |
|---|---|---|
| Recursive CTE per page, walking up from the page's `parent_id`s | one extra query per lens read, d hops | works, but a second code path for the same fact the group order already needs |
| **Load the interior tree once per request and walk it in memory, O(1) per hop** | one indexed read; **the interior set does not grow weekly** | **recommended** |
| Denormalise `life_root_id` on `goals` | a column, an index, a backfill, and a subtree rewrite on every Move | held in reserve |

The recommended option turns on one measured fact: **the tree above Weekly is small and does not
accumulate with use.** A five-line account gains ~85 interior goals a year (5 × (1 Yearly + 4 Quarterly
+ 12 Monthly)) and 300-1 000 Weekly goals. At ten years the interior set is ~855 rows and the account is
~3 900 goals; at twenty-five years it is ~2 130 against ~9 800. So one indexed read of the interior tree
plus an id-map gives every lens its grouping, its group order, its parent lines (R-lens-23) and its
Life-root resolution for O(1) per hop, and it never carries a Weekly goal it is not rendering.

It also preserves R-lens-3 exactly as written — *"the resolution is a walk, not a stored column, and it
is cycle-safe"* — which the denormalised column would have overturned. **Escalate to `life_root_id`
only if the interior set exceeds ~2 000 rows**, at which point it is a schema change with a clear
trigger rather than a guess.

**Group counts, precisely.** Query 3 returns one row per Weekly goal holding open work; each maps to its
Life root through the interior index in O(d). It is bounded by the account's *open work*, which the
owner controls, not by its history. This is only affordable because R-lens-4 anchors the count to one
week (conflict C-11): the UX plan's period-spanning definition would have needed a per-period scan and
would have been untruthful as well as expensive — a rare case where the cheap answer and the honest one
are the same.

**R-goal-47's planned-ness line** needs one range read per Monthly page:
`WHERE user_id=? AND horizon='Weekly' AND period_key BETWEEN <first Monday> AND <last Monday> AND
parent_id IN (page ids)` — a range scan on `ix_goals_lens`, ~5 weeks wide. It works only because
`period_key` sorts lexicographically, which is R-goal-33's whole reason for existing.

**R-lens-22's Zoom-sheet counts** are one grouped query, not five lens reads:
`SELECT horizon, COUNT(*) FROM goals WHERE user_id=? AND ((horizon='Yearly' AND period_key=?) OR
(horizon='Quarterly' AND period_key=?) OR (horizon='Monthly' AND period_key=?) OR (horizon='Weekly' AND
period_key=?)) GROUP BY horizon`, plus the Life count. Four index seeks. Written as five lens reads it
would be five scans on every sheet open, which is exactly how this class of defect returns.

### 3.5 What legitimately needs more than one row — and how often

**Nothing needs the whole goal list.** Each guard needs less than it takes today:

| Guard | Actually needs | Query | Frequency |
|---|---|---|---|
| `checkCreate` (`goal-tree.ts:196`) | **the parent row only** — it compares two ranks | `findById(userId, parentId)` | once per `POST /goals` |
| `checkMove`'s cycle check (`goal-tree.ts:223-233`) | **the moved goal's subtree**, to prove the target is not in it | `WITH RECURSIVE` down from `goalId` | once per `POST /goals/:id/move` — and **zero rows when the moved goal is Weekly**, which is terminal (R-goal-31) and can have no descendants |
| `checkMove`'s rank check | the moved goal + the target | two `findById` | same |
| The Move sheet's target list (R-goal-19) | goals of longer horizon, minus the moved subtree | the interior tree, already loaded | once per sheet open |
| Delete cascade (R-task-47, Q-5) | **the deleted goal's subtree** | `WITH RECURSIVE` down from `id` | once per delete and per dry-run. Can be genuinely large — deleting a Life goal takes the line — and this is the one place a big set is correct |
| `assertWeeklyGoal` (was `assertActiveLeaf`, `task.service.ts:420`) | **one row**: `horizon = 'Weekly'` (R-goal-39, never leaf-ness — R-goal-37) | `findById` | once per `POST /tasks` |

Both guards run **only on a write**, at most a few times a day per owner. A recursive CTE bounded by one
subtree, a few times a day, is the correct price. A full-table scan three times per create is not.

`descendantIds` survives for the cascade and the cycle check, but must take the per-request index
(§3.2) or a CTE result — never the raw array.

### 3.6 Indexes

| Index | Status | Why |
|---|---|---|
| `CREATE INDEX ix_goals_lens ON goals (user_id, horizon, period_key, created_at, id)` | **new** (already proposed in the delta; confirmed absent) | Serves every lens read as a covering prefix match with the sort keys in place, R-goal-47's range read, R-lens-22's counts, and R-lens-26's "any later period" probe. `period_key` before `created_at` is what makes the ordering free |
| `ix_goals_owner_parent (user_id, parent_id, created_at, id)` | keep | Serves the sibling order and the interior walk's `parent_id` lookups. **It cannot serve `listAll`'s `ORDER BY created_at, id`** — `parent_id` sits between the equality column and the sort keys, so that query filesorts today. That is an argument for deleting `listAll`, not for adding an index to it |
| `ix_tasks_open_week (user_id, status, origin_week_start)` | keep, unchanged | Serves the week read *and* the group counts (query 3). No new task index is needed |
| `ix_tasks_goal (user_id, goal_id, status)` | keep | Per-Weekly-goal task reads |
| `ix_weekly_focus_*`, `ix_ideas_owner` | dropped with their tables (R-rm-1, R-rm-2) | |

No other new index. The redesign's reads are all `(user_id, horizon, period_key)` or already-indexed
task reads.

### 3.7 Caps — what should replace 500 and 100

The old numbers are prose, enforced nowhere. Replacing one prose number with a bigger prose number ships
nothing. Three real caps, and **Weekly goals must not count against the same one**:

| Cap | Was | **Recommended** | Why |
|---|---|---|---|
| Goal depth | 4 | **5** | R-goal-32. Structural, already enforced by `checkCreate` |
| **Interior goals per owner** (horizon ≠ Weekly) | — (part of 500) | **1 000**, enforced on create | This is the set every request holds in memory. It grows ~85/year, so 1 000 is a decade of headroom, and it is the only number that protects the read strategy |
| **Weekly goals per (owner, week)** | — | **50**, enforced on create | A *shape* cap, not a lifetime cap. Fifty intentions in one week is already past what a person can hold; it never trips in ordinary use, and it bounds one lens page |
| **Total goals per owner** | 500 | **none** | A lifetime cap on Weekly goals is a cap on how long you may use the product. It would fire, silently, on the most engaged owner — which is the failure mode this whole exercise exists to remove. Replace it with the two caps above, which bound what actually costs something |
| Children per goal | 100 | **100 non-Weekly children**, plus the per-week cap above | The spec's 1 000 was papering over R-goal-32's real problem: a Weekly goal hung off a Life goal gives that parent one child per week *forever*, so no fixed fan-out number can be right. Scoping the Weekly cap to the week makes the fan-out bounded per period and unbounded across time, which is the truth |
| Open tasks | 200 per leaf per week | **200 per Weekly goal** | Unchanged from the spec |
| Page cap | 200, unused | **200, wired** | `MAX_PAGE` exists and is referenced nowhere. Every lens read, the backlog and the week read take it |

This replaces the spec's `10 000 goals / 1 000 children` (Q-12, amended). Those numbers were chosen to
buy time under the old read strategy; under the new one they measure the wrong thing.

### 3.8 Archival and pruning — not recommended

**Recommendation: none. No archive state, no pruning job, no "clean up old goals" prompt.**

The owner's dislike of clutter is a statement about **screens**, not rows: *"i dont like the tree view
goals, its too clutered."* The redesign already answers it — every read is period-scoped, so a Weekly
goal from 2024 is invisible unless you navigate to its week, which is exactly what you would want if you
did. Archival would add a state to every row, a place to see archived things, a rule for what happens
when you unarchive one into a past period (R-goal-36 forbids the write), and eventually a prompt telling
the owner they have 400 old goals — which is the nag the product refuses (R-nav-26, R-goal-44).

Rows are cheap once reads are scoped: at twenty-five years of heavy use the account is under 10 000 rows,
which is a rounding error in D1 and, under §3.4's reads, is never loaded.

**One place row count does become user-visible**, and it needs copy rather than pruning: the delete
cascade confirmation (R-task-47, Q-5) now counts Weekly goals and their tasks, so deleting a Life goal
can read *"this removes 312 weekly goals and 840 tasks"*. That is truthful and should stay a summary —
it must never become a list.

### 3.9 Migration note

The delta's `0002_*` migration is correct as far as it goes. Three additions:

| # | Change | Cost |
|---|---|---|
| 1 | `ix_goals_lens` — as the delta already specifies. **Confirmed absent today**; it is the one index the new access pattern requires | one `CREATE INDEX`; instant on any realistic account |
| 2 | **Delete `IGoalRepo.listAll` outright**, replacing it with `listByLens`, `listInterior`, `listByIds`, `subtreeIds` (recursive CTE), `countByLens`. Not "leave it unused" — an unused whole-table read is one refactor away from being a used one, and R-rm-* discipline exists for exactly this | ~13 call sites, all of which are being rewritten anyway |
| 3 | **Chunk or join away every `inArray(goalIds)` built from the full goal list** (`goal.service.ts:436-442`, `:254-258`, `:95-96`). None of them survives the read rewrite in its current form; the delete cascade's version must chunk, because a subtree is legitimately large | contained in the same rewrite |

No other schema change. `period_key`'s backfill, the two `DROP TABLE`s and the journal/snapshot
regeneration are unchanged from the delta. **The order matters:** the index and the scoped reads must
land in the same change as the Weekly horizon, because the first Weekly goal an owner writes starts the
accumulation and there is no signal when the product crosses from fast to slow.

### 3.10 Sequencing, and what each step costs

| Step | Change | Cost | Buys |
|---|---|---|---|
| 1 | Per-request index in `goal-tree.ts`'s primitives | one file + call signatures | 550× on every remaining full-tree path, including the guards and MCP. Do it first; everything after is safer with it in place |
| 2 | `ix_goals_lens` + the four scoped reads of §3.4 | one migration, one repo, `GoalService.lens()` | the lens reads become index seeks; `Θ(n²·d)` disappears from every read path |
| 3 | Guards read one row / one subtree (§3.5) | `goal-tree-guard.ts`, `goal.service.ts`, `task.service.ts` | `POST /goals` drops from three whole-table scans to one row read |
| 4 | Delete `listAll`; wire `MAX_PAGE`; chunk the `inArray`s | repo + ports | the pattern cannot come back |
| 5 | Enforce the three caps of §3.7 | validation + two counts on create | the first numbers in the product that are actually enforced |

---

## 4. The two owner questions

### Q-A — Every existing task is illegal the moment R-goal-39 lands. What do we do, and what will the minted goals be called?

Today every task's `goal_id` points at a non-Life leaf. Under R-goal-39 only a `Weekly` goal may hold a
task, and a childless Monthly goal — which is what those leaves are — is precisely the case R-goal-37
warns is a leaf and must never hold work. So on the morning the migration runs, every task in the
account is pointing at an illegal parent.

| Option | What happens | Consequence |
|---|---|---|
| **A. `[recommended]` Mint one Weekly goal per `(goal_id, origin_week_start)` and re-point** | Every task keeps its week, its carry age, its activity and its place in the Weekly lens. Old weeks render with their work under a named intention | ~1 new goal per goal-week that ever held work. On a year-old account that is tens to low hundreds of rows, created once, visible in past weeks — where they are the truth about what was worked on |
| B. Re-point only **open** tasks; leave done and exited ones on their old parent | Fewer rows | Every query that touches history has to special-case a task whose parent is not Weekly, forever. The illegal state becomes permanent and load-bearing |
| C. Delete or orphan the tasks | Nothing to migrate | Destroys the owner's history. Not a real option; listed so it is on the record |

**Recommended: A.** It is the only option that leaves one shape in the database.

**What they are titled — the owner will see these, in past weeks, forever:**

1. **The `weekly_focus` sentence for that `(goal, week)` when one exists.** This is the only place in the
   whole migration where a focus row is read, and it does not contradict the decision to drop the table
   (Q-19): the sentence is read to keep *work* legal, not to reconstruct a plan. The owner wrote that
   sentence about that week's work; it is the truest available title and it is in their own words.
2. **The parent goal's own title when there is no focus row.** `Build an aerobic base` becomes a Weekly
   goal titled `Build an aerobic base` for the week its tasks were live in. Slightly redundant, always
   recognisable, and renamable.

**What they must not be titled**, and why it is worth saying: not `Week of 24 Aug` (the lens already says
that, and in a list grouped by Life goal it names nothing), not `Migrated` or `Imported` (a machine word
in the owner's own plan), not the first task's title (that confuses a step with the intent behind it).

**Two things that follow.** These goals are written into **past weeks**, which R-goal-36 forbids the
*product* from doing — the rule exists so that planning cannot rewrite history, and re-homing work that
already happened is not planning. **No route, service or MCP tool may ever perform this write.** And the
migration must report the counts: goals minted, of which titled from a focus sentence, of which from the
parent's title.

### Q-B — Does *"a Weekly goal is never re-parented"* also forbid the manual Move action?

The owner's ruling was *"never re-parented or moved forward"*. The spec reads that as one statement about
the **week**: `periodKey` is immutable (R-goal-40) and Move stays available. The PM kept Move.

| Option | What it means | Consequence |
|---|---|---|
| **A. `[recommended]` Keep Move (the spec's reading)** | A Weekly goal's week is frozen; which *intention* it served can be corrected — "this belonged under the other monthly goal" | Weekly behaves like every other horizon. Nothing else in A2 depends on it |
| B. Forbid Move on Weekly too | R-goal-40 gains a clause; `checkMove` refuses `LIFE_GOAL_IMMUTABLE`-style on Weekly | **Weekly becomes the only horizon in the product that cannot be corrected after the fact.** A goal created under the wrong parent — which R-task-49's inference makes *more* likely, since it picks the parent for you — is wrong forever, and the only repair is delete-and-retype, which loses the tasks with it (R-task-47) |

**Recommended: A, keep Move.** But the reading only holds if Move genuinely changes no week, so
**what breaks if Move is allowed to cross weeks must be said explicitly**, because it is not obvious:

1. **Nothing breaks in the data, and that is the danger.** `tasks.origin_week_start` is the task's own
   stored, immutable field (R-task-40) — it is *not* re-read from the parent. So re-parenting a Weekly
   goal to a different week moves the goal and leaves every task's week exactly where it was. No error,
   no cascade, no test failure.
2. **What breaks is the Weekly lens.** The goal now claims a week its tasks were never live in. It
   renders in the new week's *plan* band (`periodKey = W`) while its tasks are visible in the old week
   — so the same goal appears in two weeks with different work under it, and the carried band (R-lens-12)
   can no longer tell "written this week" from "carrying", because the goal's `periodKey` no longer means
   what R-lens-12 reads it to mean.
3. **And it re-opens D-2**, the defect that made focus per-week in the first place: a past week's lens
   would change what it says happened, with no write to any task and no record anywhere that it changed.
   That is the single failure this redesign inherited a rule against.

So the boundary is precise and worth writing into the rule as a sentence rather than leaving as an
inference: **Move may change a Weekly goal's parent; it may never change its `periodKey`, and no
operation other than creation may write one.** R-goal-40 already says the second half; the first half is
what makes Option A safe.

**If the owner meant Move as well**, R-goal-40 loses one clause, `checkMove` gains a Weekly refusal, and
nothing else in A2 changes.

---

## 5. Found in neither document

| # | Gap | Disposition |
|---|---|---|
| 1 | **`MAX_PAGE = 200` is dead.** It exists in `packages/shared/src/common.ts:152` and is referenced nowhere; no endpoint in the product paginates. R-lens-16 says lens reads are "paginated (Q-12's page cap)" against a constant nothing reads | §3.7. Wire it, or R-lens-16 is aspirational |
| 2 | **`MAX_GOALS` / `MAX_CHILDREN` never existed.** Both documents discuss raising caps that are prose in five files and code in none | §3.7. The delta's open question 7 ("do the new caps hold?") has a hidden premise: there are no caps to hold |
| 3 | **The `inArray(all n goal ids)` pattern** (`goal.service.ts:436-442`) is a bind-parameter cliff, not a CPU one, and no repository method chunks | §3.3, §3.9. Verify D1's current ceiling before sizing |
| 4 | **`GET /bootstrap` ships five unbounded collections.** R-rm-5 fixes `goals`; `tasks`, `backlog` and `learnings` keep no bound, and open tasks carry forward forever by design (R-task-42) | The Weekly lens's payload grows with *open work*, which is correct and owner-controlled — but it should page |
| 5 | **`goal-tree.ts:13`, `entities.ts:32`, `schema.ts:124` and `repositories.ts:48` all repeat the false premise** ("500 nodes, 4 levels, so nothing here needs a query"). A comment that states an invalidated invariant is worse than no comment | Must be rewritten in the same change, all four |
| 6 | **The Zoom sheet's five counts are a new read nobody specified.** Written naively they are five whole-table scans on every sheet open | R-lens-22 + §3.4's single grouped query |
| 7 | **Neither document says what the Weekly lens does when this week is empty but work is carrying.** The empty state (`A new week, still unplanned.`) and the carried band both want the screen | §1.4: the band renders, and the empty state applies only to the plan section above it |
| 8 | **`Repeat last week` had no surface in any design** — a fully specified rule (R-goal-46) with nowhere to be tapped | C-25: the group foot, Weekly lens only |
| 9 | **R-lens-9's only worked example is arithmetically wrong** (31 Aug → `Sep 2026`). It is the sentence a builder would copy | C-20, corrected |
| 10 | **The `+` drawer's `Add to this week instead`** (R-backlog-27) resolves a Weekly goal for the current week and parks the item in the backlog when there is none — but R-task-48 and R-task-49 now create one instead. Two adjacent flows answer the same situation differently | Left as-is deliberately: the drawer is a two-second capture with no room to state a create (R-task-49's "nothing may be created invisibly"), so parking is right *there*. Recorded so it reads as a decision rather than an oversight |
| 11 | **`focusableLeaves`, `subtreeActive` and `moveTargetReason` have no production caller** — tests only — and all three are quadratic | All three are deleted by R-rm-2 anyway. Worth naming so the deletion is not mistaken for a behaviour change |

---

## 6. What changed in `docs/SPEC.md`

**Added (16):** `R-goal-47`; `R-lens-17 … R-lens-27` (11); `R-task-49`, `R-task-50`; `R-nav-27`,
`R-nav-28`. Total rules 211 → **227**.

**Superseded (1):** `R-lens-13` (the five-way switcher) → `R-lens-17`.

**Modified (19):** `R-goal-38`, `R-goal-43`, `R-goal-46`, `R-lens-1`, `R-lens-3`, `R-lens-4`, `R-lens-6`,
`R-lens-7`, `R-lens-8`, `R-lens-9`, `R-lens-11`, `R-lens-14`, `R-lens-16`, `R-nav-24`, `R-nav-25`,
`R-nav-26`, `R-task-41`, `R-task-45`, `R-task-48`.

**Open questions amended (4):** `Q-12` (the caps and the read strategy, rewritten against the measured
numbers), `Q-20` (`+ Weekly goal` on a Monthly row → its detail page only), `Q-21` (the carried band's
collapse becomes R-lens-19's vocabulary), `Q-22` (`Repeat last week`'s placement).

**Unchanged and load-bearing:** `R-lens-12` (the carried band) and `R-task-40` (the task's own stored
week) are the two rules the UX plan most needs to absorb, and neither moves.

§6's Amendment-2 ledger carries all of the above under **"Reconciliation pass"**.
