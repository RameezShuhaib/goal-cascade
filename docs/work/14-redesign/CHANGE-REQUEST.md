# Change request — lens navigation, weekly goals, Ideas removal

**Status: OPEN / collecting.** The owner is reviewing the product in use and will add more
items. Nothing here is built. Nothing here is specified yet either — this is the raw capture,
written so that the eventual spec pass and build have a single, faithful source.

**Do not start implementation from this document.** It records intent and the questions that
intent raises; it does not resolve them. `docs/SPEC.md` remains the authority until amended.

---

## Why this is being batched

The owner's words: *"I'll give you change details initially document it only so we can fix all
at once."*

That is the right call here, and not only for convenience. CR-1 and CR-4 between them change the
shape of the goal tree and retire an entity. Landing them one at a time would mean two schema
migrations over the same tables, two passes over the same screens, and a window in which the spec
describes neither the old model nor the new one.

### Work stopped as a result

The in-flight API build (`docs/work/13-planning-ahead/`) was **halted mid-flight** when this
request arrived. It was implementing multiple weekly *focus* sentences against the existing
`weekly_focus` table — including dropping and replacing that table's unique index. CR-4 retires
that entity in favour of Weekly becoming a horizon in the goal tree, so that migration would have
had to be written, applied, and then undone.

Two parts of that halted work survive the redesign intact and should be re-planned into it rather
than rewritten from scratch:

- **Future-period planning** (`PLAN_AHEAD_WEEKS`, relaxing `WeekOffset`'s `≤ 0` cap, keeping past
  periods read-only). CR-2 needs exactly this, and needs it for months and quarters too.
- **Manual backlog ordering** (`sortKey`, a relative-move operation, keyboard parity with drag).
  Untouched by this request.

The spec work in `docs/SPEC.md` §6 (31 superseded rules) and `docs/work/13-planning-ahead/spec-delta.md`
also stands as input, though CR-1 and CR-4 will supersede parts of it in turn.

---

## CR-1 — Replace the goal tree with per-horizon lenses

> *"i dont like the tree view goals, its too clutered. i what to see all items in once lense and
> that makes me sense, example in life view i can see all my life viwes. when when i zoom i see
> quaterly that should include all quaterly items including items from all life views for that
> quater."*

The tree is replaced by a **lens per horizon**. A lens is a flat list of every goal at that
horizon, across the whole account — not a subtree of one branch.

| Lens | Shows |
|---|---|
| Life | every Life goal |
| Yearly | every Yearly goal for the selected year |
| Quarterly | every Quarterly goal for the selected quarter, from **all** Life goals |
| Monthly | every Monthly goal for the selected month, from all Life goals |
| Weekly | every Weekly goal for the selected week, from all Life goals — and their tasks |

"Zooming" between lenses is the primary navigation. The hierarchy still exists in the data
(a Quarterly goal still belongs to a Yearly goal, and so on) — what changes is that it is no
longer the way you *navigate*. Ancestry becomes context shown on an item, not the path you walk
to reach it.

**Grouping, not filtering.** The owner is explicit:

> *"in each lense we donot need a filter on goals instead it will be catogrised by life goals."*

The goal-filter pills come out. Every lens instead groups its items under the Life goal each one
ultimately belongs to. This means every item in every lens needs its owning Life goal resolved —
a walk up the ancestor chain, at any depth.

## CR-2 — A time dimension inside each lens

> *"now another dimention is that peeking into previous or future items for each horizon except
> for the life. example quaterly i can see past ones and future ones (also set items). similarly
> for monthly i can see previous and future."*

Every lens except Life is scoped to one period and can move backwards and forwards through
periods: Yearly by year, Quarterly by quarter, Monthly by month, Weekly by week. Life has no
time dimension — it is the one lens that is simply "all of them".

"**also set items**" is read as: you can *create* items in a future period from within that
period's lens, not merely look at it. This generalises the halted future-week work from weeks to
every horizon.

Two rules from the current design must be carried forward deliberately rather than by accident:

- Past periods stay **readable and truthful**. History must not be rewritten by planning. This is
  the `D-2` defect that made weekly focus per-week in the first place, and it applies to every
  horizon now.
- Future work must never be styled as **late**. Carry age goes negative for a future item, and
  the red carry chip is the only escalation in the product; it firing on work that is not yet due
  would destroy the one signal that means something.

## CR-3 — The Tasks page is absorbed into the Weekly lens

> *"this means i no more need tasks page so all the functionalities i have in week view is here
> like click on task and update it."*

The Weekly lens is where tasks live. Everything the Tasks screen does today — the week switcher,
completing, unchecking, the three exits, carry labels, backlog pulls — happens in the Weekly
lens instead. The Tasks tab is removed.

Consequence to settle: the goal filter pills on the Tasks header carried **open-task counts**.
Under CR-1 they are replaced by Life-goal grouping, so those counts need a new home or an
explicit decision to drop them.

## CR-4 — Weekly focus becomes Weekly goals

> *"this also means i dont need a new entity called focus week we can just call it weekly goals."*

The `weekly_focus` entity is retired. Weekly becomes a **fifth horizon** in the existing sequence:

    Life → Yearly → Quarterly → Monthly → Weekly

A weekly goal is then an ordinary goal node with `horizon = 'Weekly'`, and several of them can sit
under the same parent in the same week because the tree already permits many children. That is how
"multiple weekly focus sentences" is delivered — as a property of the tree rather than a special
case bolted onto one table.

This is the largest change in the request. Everything the current model derives from a focus row
is affected: leaf-ness, active/dormant, the plan endpoints, and the rule that a Monthly goal can
never have children (which must now permit Weekly children).

## CR-5 — Task detail becomes a page, not a drawer

> *"when i click on a task i need a saperate page instead of a drawer."*

The task detail sheet becomes a full screen. Note the app currently has **no router** — screen and
overlay are React state, with the URL synced one-way for deep links. A real page for a task is the
point at which that decision should be revisited, since a task page is a genuinely linkable thing.

## CR-6 — Remove Ideas entirely

> *"i no more need ideas page so remove all the apis and entity from the system. becuase i can
> leverage backlog to do the same."*

Ideas are deleted — the screen, the routes, the service, the repository, the table, the shared
schemas, the MCP tools and resources, and the rules in the spec. Backlog items serve the same
purpose.

The one thing that cannot be decided from the request is **what happens to Ideas that already
exist** in the account. See open questions.

> **Resolved and shipped — see `docs/work/15-remove-ideas/build.md`.** The owner answered question 3:
> *"forget about it nor i care about its data as i didnt use it."* So there is no migration, no export
> and no conversion: the `ideas` table is dropped with its rows
> (`apps/api/migrations/0002_drop_ideas.sql`). CR-6 is done end to end and is independent of the rest of
> this change request; SPEC §6 Amendment 2 is its ledger. The tab bar in that change is
> `Tasks · Goals · + · Learnings` — removing the Tasks tab belongs to CR-1/CR-4, not to CR-6.

---

## Open questions — for the owner, before any spec pass

These are the points where the request admits more than one reading, and guessing would produce
work that has to be redone.

1. **Is Weekly a real horizon in the tree, with a parent?** If a weekly goal is a child of a
   Monthly goal, then a week's goals are always reached through a month, and a Monthly goal must
   start accepting children. If instead weekly goals are a flat per-week list attached to any leaf,
   the tree stays four deep. `[recommended]` A real fifth horizon — it is what makes CR-4's
   "just call it weekly goals" true, and it gets multiplicity for free.

2. **Can a Weekly goal hold tasks directly, and can anything else?** Today only leaves hold work,
   and goals never hold tasks directly — tasks hang off a focus. `[recommended]` Tasks hang off
   Weekly goals, and only Weekly goals.

3. ~~**What happens to existing Ideas?**~~ **ANSWERED — delete them with the table.** Options were:
   silently convert each into a backlog item on its tagged Life goal (untagged ones need a home);
   export them somewhere first; or delete them outright. `[recommended]` Convert. The owner overruled
   the recommendation: *"forget about it nor i care about its data as i didnt use it."* Shipped as a
   plain `DROP TABLE ideas` — no migration, no export.

4. **What are the tabs now?** Tasks and Ideas both go. Today, after CR-6 shipped:
   Tasks · Goals · + · Learnings. A lens switcher has to live somewhere, and it is a five-way control,
   not a tab. **Still open for the Tasks half** — CR-6 removed only the Ideas tab.

5. **Does the Yearly lens get past/future navigation?** The request names Quarterly and Monthly
   explicitly and excludes Life. `[recommended]` Yes — by year, for consistency.

6. **How far forward can items be created?** The halted work chose 4 weeks. That number needs an
   equivalent for months, quarters and years. `[recommended]` One period type ahead is too tight;
   propose a per-horizon cap in the spec pass.

7. **Does a task detail page mean adopting a router?** `[recommended]` Yes, for the task page at
   minimum — this is the case the "no router" decision explicitly reserved for genuinely linkable
   pages.

8. **Do the open-task counts survive?** They were attached to the goal-filter pills being removed.
   `[recommended]` Keep them, on the Life-goal group headers.

---

## Known blast radius (first pass, not exhaustive)

Recorded now so the eventual spec pass starts from something rather than nothing.

- **Data:** new `Weekly` horizon and the rank/nesting rules around it; retire `weekly_focus`;
  drop `ideas`; backlog `sortKey`; period fields for every horizon.
- **Domain:** `goal-tree.ts` rank ordering and the Monthly-is-terminal rule; leaf/active/dormant
  derivation; `weeks.ts` generalised to periods.
- **API:** plan endpoints retired or reshaped; goal endpoints gain per-horizon/period listing;
  every ideas route removed; bootstrap read model reshaped around lenses.
- **Contract:** `Horizon` enum, `WeekOffset`, every plan and idea schema, the error codes for
  ideas.
- **MCP:** the 43-tool surface loses the idea tools (**done** — 38 now), gains lens/period reads, and its server
  instructions block — which teaches connecting agents the horizon hierarchy and the focus
  concept — must be rewritten.
- **Web:** the Goals tree screen, the Tasks screen, the Ideas screen, the tab bar, the task sheet,
  and the plan screen. This is close to a rewrite of the navigation shell.
- **Docs:** `BUSINESS-RULES.md` (just amended for the halted work, and now amended again),
  `SPEC.md` including its §6 ledger, and the MCP resource copy pinned by a byte-equality test.
