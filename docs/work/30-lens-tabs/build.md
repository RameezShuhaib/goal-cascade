# 30 — build: lens tabs, flat lists, one create action, sticky nav

Built from `docs/work/29-ux-navigation/UX-PLAN.md`, followed literally, with the owner's one override
(sticky) applied. Spec pass is **Amendment 10** in `docs/SPEC.md` §6.

**Green:** `558 → 562` api · `420 → 427` web · `113` shared. Typecheck clean across all three workspaces.
`npm run build -w @goal-cascade/web` still emits `dist/sw.js` with its precache manifest (13 entries).
Not deployed, not merged.

---

## 1. What was built

### A — the lens is a tab strip (R-lens-33, R-lens-17 rewritten)

`apps/web/src/lens/LensTabs.tsx`, new. Five tabs in horizon order in a full-bleed horizontal scroller
(`marginInline: -16` on the strip, `paddingInline: 16` on the track), `role="tablist"` /
`aria-label="Lens"` / `aria-orientation="horizontal"`, each tab a real `<button>` with `role="tab"`,
`aria-selected` and `aria-controls="lens-panel"`.

- **Active state**: `T.mut` → `T.ink`, plus `boxShadow: inset 0 -2px 0 T.accent` sharing the strip's own
  `borderBottom` baseline. **Weight stays 700 in both states** — 700 → 800 changes the glyph advances,
  which changes the tab's width, which reflows every tab to its right on every selection.
- **No label is ever shortened.** Every tab is `flex: 0 0 auto` + `white-space: nowrap`, with no
  `text-overflow`, no `max-width` and no reduced type size. 13px/700 throughout. `S-lens-33-2` asserts all
  five, individually, at 360px.
- **Scroll**: `overflow-x: auto`, `scrollPaddingInline: 24`, `overscrollBehaviorX: contain`,
  `scrollbar-width: none` plus `[data-lens-tabs]::-webkit-scrollbar { display: none }` in `index.html`.
  Selection calls `scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'instant' })` —
  **no animation, therefore no `prefers-reduced-motion` branch**, exactly as the plan requires. No snap,
  no wrap, no arrows, no fades.
- **Keyboard**: one tab stop (roving `tabindex`), `←`/`→` move focus without activating and stop at both
  ends, `Home`/`End`, `Enter`/`Space` activate. `stopPropagation` on every key the strip owns, so the
  body's `←`/`→` period shortcut can never also fire.
- **Mounted once**, in a **React Router layout route** (`<Route element={<LensChrome />}>` wrapping all
  five lens routes) — so focus and `scrollLeft` survive a lens change. That matters twice: opening a lens
  with no period segment renders the index route and *then* canonicalises to `/quarter/2026-Q3`, so a
  strip inside the child would unmount twice per tap.
- The strip is `data-h-scroll` **and** `data-no-swipe`, so the period swipe cannot fire from inside it
  under either code path (R-lens-25, amended).
- `scrollIntoView` is optional-called (`?.`) because jsdom does not implement it.

### B — one create action (R-nav-32, R-nav-25 amended)

`+ Goal` in the cluster at every lens; `+ <Horizon> goal` deleted from the cluster label, every group foot
(with the group) and every empty-state CTA (relabelled, kept). `createLabel()` → `CREATE_LABEL`.

`GoalFormSheet` gained a `lens?: Horizon` prop, set only by the lens's own create. When present:

- a five-chip `role="radiogroup"` **HORIZON** selector (`S.chipBtn`, roving tabindex, `←`/`→`/`Home`/`End`)
  defaulting to the lens;
- the period chip is `labelOf(horizon, zoomTo(horizon, anchor, today))` — **R-lens-9's clamp, the same
  function the tab strip and `Shift+↑`/`↓` call**, so navigation and creation cannot disagree;
- the picker re-scopes; a parent no longer legal is cleared with `Cleared — a X goal can't sit under a Y
  one.` in an `aria-live="polite"` region;
- `Life` renders no period chip and no `UNDER`;
- on save, if the horizon is not the lens, the app navigates to that lens at that period (§3.8).

The label is computed locally now instead of being read off a lens query — a lens read cannot answer for a
horizon the selector has moved to. That deleted `GoalFormWithLabel` and one query.

### C — flat lists at every horizon (R-lens-3 / R-lens-19 deleted)

`Group`, `CreateLink`, `showHeader`, the `rendered` partition, the per-group `RepeatLastWeek` and every
`ui.collapsed['<lens>|<groupId>']` key are gone. `CollapsibleHeader` **survives** for the carried band,
which keeps its header and its collapse (R-lens-12 — it is a different *kind* of content, not a group).

- **`under <Life goal>` on every card at every horizon except Life**, from `goal.lifeRootId` +
  `LensResponse.groups`. No suppression. The Yearly lens gains a line it never had.
- **Root-less items**: `Not under a Life goal yet`, a button opening the Move sheet in `only: 'life'` mode
  — the caller `25-goal-picker` records that mode has never had.
- **Order**: `GoalService.lens` now sorts the page it just read into R-lens-5's flat total order (Life root
  `createdAt`/`id`, then item `createdAt`/`id`, root-less last) **after** taking `nextCursor`. That is the
  grouped screen's reading order with the headers removed, so muscle memory survives. `S-lens-5-2` asserts
  it with lines created in an interleaving order, so it cannot pass by coincidence.
- **Open-task counts** render on the Life lens's cards (`3 open · 2 in backlog`, unchanged) and nowhere
  else. `S-lens-4-2` asserts the absence at Quarterly, Monthly and Weekly.
- **`Repeat last week`** renders once at the foot of the Weekly list and sends **no** `lifeGoalId`.

### D — card density

`why` removed from `PlainCard`, `MonthlyCard`, `WeeklyCard`; kept on `LifeCard` with a `nowrap` + tail
ellipsis clamp. `BacklogLine` removed from `WeeklyCard` (a Weekly goal cannot hold backlog — R-backlog-2 —
so it was structurally always zero; the §5.1 table and the code now say the same thing).

### Deleted

`apps/web/src/lens/ZoomSheet.tsx` (the file), `useZoom`, `keys.zoom` / `keys.zoomAll` and their three
invalidation sites, `{ kind: 'zoom' }`, `ZoomOnRoute`, `onZoom` on `LensRow`, the `lens-zoom-marker` SVG,
the title's `<button>` wrapper and its `aria-label`, `Jump to now`.

### Server

- `RepeatWeekRequest.lifeGoalId` → optional; `GoalService.repeatWeek` treats absent as *every line*.
  Supplying it is byte-for-byte unchanged, which is what keeps the MCP tool and its tests untouched.
- `GoalService.lens` returns `items` in R-lens-5's flat order (`inLineOrder`, which reads `groupsOf`'s own
  Life-line ranking rather than restating it).

---

## 2. How sticky was implemented, and what it costs

One `position: sticky` container in `LensChrome`, holding **both** rows:

```
<div data-testid="lens-sticky-nav"
     style={{ position: 'sticky', top: 'var(--safe-top, 0px)', zIndex: 10,
              background: T.paper, marginInline: -16, paddingInline: 16 }}>
  <LensTabs … />      ← row 2
  <LensRow  … />      ← row 3
</div>
```

**One container, not two `position: sticky` siblings.** The plan's warning is that it must be both rows or
neither; two independently sticky elements with different `top` values satisfy that only by arithmetic
that nobody maintains. One element makes it structural: there is no scroll position in which one row is
pinned and the other is not.

- **It does not clip or trap the horizontal scroller.** `overflow` stays `visible` on the sticky element
  and the `overflow-x: auto` lives one level down, inside `LensTabs`. The two constraints happen to point
  the same way — an `overflow` other than `visible` here would break `position: sticky` outright.
- **No seam and no z-index fight.** `background: T.paper` (the page ground) so cards pass cleanly
  underneath; `zIndex: 10` sits above card content, below the bottom tab bar's `20`, and far below
  `S.overlay` (42) and `S.sheet` (43), so a `Sheet` is never fought for the top of the stack. The strip's
  own `borderBottom: 1px solid T.line` runs full-bleed and is the only rule in the block; nothing new is
  drawn under the period row.
- **`top: var(--safe-top, 0px)`**, a new custom property published by `index.html` alongside the existing
  `--safe-bottom`, so an installed PWA on a notched phone pins below the status bar rather than under it.
  `#root` already pads the same inset, so nothing scrolls through the strip above the pinned block.
- **The conditional row (`This week is in Aug 2026 · Go there ›`) is deliberately NOT pinned.** It is a
  notice about the period you are on, not a control; pinning it would be R-nav-27's fourth unconditional
  row in all but name. It is preserved unchanged and still works.

**Vertical cost, stated because it is permanent:**

| | Life / Weekly | Yearly / Quarterly / Monthly |
|---|---|---|
| tab strip (`minHeight: 44`) | 44 | 44 |
| hairline | 1 | 1 |
| period row (`marginTop: 2` + a 44px min-height row) | ~46 | ~51 (the 12.5px range line makes the content taller than the 44px floor) |
| **pinned total** | **~91 px** | **~96 px** |

On a ~700px phone viewport that is **13–14 %** of the screen, held for the whole scroll, and it lands
hardest on the Weekly lens — which is the one genuinely long screen in the product and also the one where
Life/Weekly's cheaper 91px applies. That is why rows 1 and 3 are unchanged in height and the strip is 44px
exactly: the plan's type scale, not a pixel more.

---

## 3. Every rule superseded, with its verdict

| Rule | Verdict | What replaces it |
|---|---|---|
| **R-lens-3** (grouping by Life goal) | **Deleted** — the owner reversed their own instruction (*"in each lense … it will be catogrised by life goals"* → *"lets not categorise based on life in any horizon"*). | R-lens-23's line on the card, R-lens-4's move to the Life lens, R-lens-5's unchanged order. `lifeRootId` / `groups` stay on the wire. |
| **R-lens-19** (group rendering, collapse, suppression) | **Deleted** with R-lens-3. | Nothing — there is nothing to render, collapse or suppress. The carried band's collapse is untouched. |
| **R-lens-22** (the Zoom sheet's counts) | **Deleted.** Five ambient numbers in a permanent strip is a report (R-nav-26). | Nothing. `GET /goals/zoom` loses its only caller — **flagged, not removed**. |
| **R-lens-4** (the group header's count) | **Rewritten.** | The Life lens's own card, once per line, zero never rendered. |
| **R-lens-5** (order) | **Rewritten.** | A flat total order, now load-bearing **on the wire**: the client stopped partitioning. |
| **R-lens-17** (the title is the lens control) | **Rewritten** on the owner's evidence after daily use. | A tab strip; the title is text. |
| **R-lens-20** (`UNSORTED`) | **Rewritten.** | A line on the card, with the Move sheet behind it. |
| **R-lens-23** (the parent line) | **Rewritten.** Both halves broke without groups. | The **Life goal**, at every horizon, no suppression. |
| **R-lens-13** (the lens switcher) | **Clarified, not overturned.** Its bottom-tab-bar refusal stands verbatim; its accessibility clause binds R-lens-33 in full. | — |
| **R-lens-25** (one gesture) | **Amended.** | The strip is `data-h-scroll` **and** `data-no-swipe`. |
| **R-nav-25** (the cluster) | **Amended.** | `+ Goal`, one string at every lens. |
| **R-nav-26** (permitted numbers) | **Amended.** | Loses R-lens-22's counts, gains nothing. |
| **R-nav-27** (two rows of chrome) | **Rewritten.** | **Three** unconditional rows, itemised, and they are **sticky**. A fourth is still refused. |
| **R-goal-46** (`Repeat last week`) | **Amended.** | Once at the list foot, across every line; `lifeGoalId` optional. |
| **R-lens-33**, **R-nav-32** | **New.** | The strip; the one create action. |

### Tests retired, each with a per-test verdict

Every retirement below cites the `R-*` id whose reversal superseded it. **No test was weakened** — where a
property survived its surface, it is asserted at the new surface, usually more strictly.

| Retired / rewritten test | `R-*` | Verdict |
|---|---|---|
| `S-lens-4-1: the group header carries the open count` | R-lens-4 rewritten, R-lens-3 deleted | No header to carry it. Replaced by `the open count renders on the Life lens card, and on NO other lens`, which asserts the absence at three horizons as well as the presence at one. |
| `R-lens-19: with exactly one group the header does not render` · `a group with no items is not rendered` · `a group collapses, and it is one row that does it` (3 tests) | R-lens-19 deleted | All three are properties of a thing that no longer exists. Replaced by one test asserting **no group header renders at any of the five horizons**. |
| `R-lens-20: … surfaces under UNSORTED, last` | R-lens-20 rewritten | No `UNSORTED` group and no group note. Replaced by a test that asserts the line, its accessible name, that the item still sorts **last**, and that the line opens the Move sheet — an assertion the old test could not make, because the state had no action. |
| `Lenses — the Zoom sheet` (3 tests) | R-lens-17 rewritten, R-lens-22 deleted | The sheet is gone. `S-lens-9-3` (choosing a lens lands at the server's period) is **kept at the tab**; the ladder's five rows are retired with R-lens-22; `Jump to now` is retired as a **duplicate** of the off-now row's `Now ›`, which renders in the same condition and is already covered in the same file. A new test asserts the sheet cannot be opened and `ZoomSheet.tsx` is absent from the source tree. |
| `R-lens-22: the Zoom sheet shows every row's span` | R-lens-22 deleted | Retired. The span itself is still asserted, on the lens row, three tests above. |
| `the zoom marker is an SVG outside the truncating span` | R-lens-17 rewritten | The marker existed to say *this title is a control*, and it is not one. `UX-PLAN §5 (item F)`'s four defects are unreachable rather than fixed. Its one durable clause — **`▾` appears nowhere** — is kept and widened to the whole document. |
| `and the Zoom sheet is an overlay too, not a route` | R-lens-17 rewritten | No subject. Replaced by the stronger statement: changing lens **is** a route change, is one tap, opens no dialog, and is in the history. |
| `every sheet inherits it — … and the Zoom sheet close on Escape too` (third clause) | R-lens-17 rewritten | The clause's real property — focus returns to the control that opened the sheet — is re-asserted on `+ Goal`, the control this screen still has. |
| `S-lens-23-2: nothing renders when the parent is the group's own Life goal` | R-lens-23 rewritten | The suppression is deleted: with it a flat Yearly list would carry no ancestry at all. **Inverted**: the Yearly lens now *gains* the line, and that is what is asserted. |
| `carries Repeat last week beside + Weekly goal, per Life line` | R-goal-46 amended, R-lens-3 deleted | No group foot. Replaced by a test asserting it renders **exactly once** and that `lifeGoalId` is **not sent** (not `null`, not `''` — absent). |
| `the per-group create knows the line as well as the period` | R-nav-25 amended, R-nav-32 new | No per-group create. Replaced by the same write, reached through the one create action, asserting that the *line* is still supplied — by A9's nearest legal ancestor and the picker's grouping. |
| `the current period draws exactly two rows above the first item` | R-nav-27 rewritten | Two → three. Rewritten to assert all three by name, that there are exactly five tabs, and that **no** `+ <horizon> goal` renders at any horizon. |
| `the heading names the horizon` | R-nav-32 new | The heading stopped naming one when the sheet stopped committing to one. Rewritten to assert `New goal`, the five-chip selector, and its default. |
| `§6.7: with nothing to hang it on, the sheet closes the loop in one tap` | R-nav-32 new | The whole-sheet takeover is wrong with a selector on screen. Rewritten as the inline state, still asserting the one-tap handoff. |

Net: **+7 web tests**, **+4 api tests**, none weakened.

---

## 4. Where I diverged from the UX plan, and why

1. **A cleared parent is re-defaulted, not left blank.** §3.5 step 3 says the picker *"returns to its
   unselected state"*. It does not: A9's nearest-legal-ancestor default re-applies at the new horizon.
   Leaving it blank would reintroduce the exact defect A9 was written to fix — *nothing selected, with the
   roving ring sitting on a Life goal, looking chosen*, which A9 calls "the worst of the three states".
   **The plan's own principle is honoured in full**: the `aria-live` sentence names what was cleared and
   why, and the row beside it names what is chosen now. Nothing changes underneath in silence. Asserted,
   with the divergence recorded in the test.
2. **The period-reason sentence has no third form for the Life lens.** §6.1 gives two forms: *"Because
   you're looking at Sep 2026."* and *"Closest to Sep 2026, the month on screen."* Neither fits creating a
   Quarterly goal **from the Life lens**, which has no period on screen to be closest to. Rather than
   invent a referent, the chip renders alone there. Following the plan's stated principle — never name a
   period nobody chose without saying where it came from — over inventing a sentence it did not write.
3. **`UNSORTED_NOTE` (`"These aren't under a Life goal yet."`) is kept, not deleted.** §6.2 retires it as a
   *group note*, and it has no lens caller any more. It is still said by the goal page's trail sheet, a
   different surface asking a different question, so the constant stays in `lens/copy.ts` with its one
   honest caller rather than being copied into that file.
4. **`N in backlog` is removed from `WeeklyCard`, which §5.1's table implies and §5.2 does not list.** It
   was structurally always zero (R-backlog-2: a Weekly goal cannot hold a backlog item), so this is a
   no-op that makes the table and the code agree.
5. **`Shift+↑`/`Shift+↓` now carry the anchor.** They navigated to `lensPath(to)` with **no period**, which
   asked for the *current* one and quietly discarded R-lens-18's anchor. The plan says the tabs use
   R-lens-9's clamp "so the two can never disagree"; making the keyboard zoom disagree instead would have
   been a third answer. Fixed in passing, with no behaviour change at the default instant.

### Nothing in the plan was found to be wrong

Two things I checked hardest and found sound: the width ledger (§2.2 — 13px/700 with `0 14px` padding does
put the track at ~390px), and the claim that deleting `why` from four lenses makes a Monthly card *shorter*
rather than merely level (it does: the header above the run also goes).

---

## 5. Flagged for the server, not built here

- **`GET /goals/zoom` and `GoalService.zoom` have no caller.** `useZoom` and its query key are deleted; the
  route, the service method, the `ZoomResponse` schema, its MSW handler and its fixture are **left
  standing** so this pass changes no route surface. They should be removed, not left serving nobody.
- `HttpApiClient.zoom` is likewise dead client-side and kept beside the endpoint it names, for the same
  reason and for the same one pass.

## 6. Verification

```
npm run typecheck --workspaces --if-present   clean
npm test --workspaces --if-present            562 api · 427 web · 113 shared, all passing
npm run build -w @goal-cascade/web            dist/sw.js, precache 13 entries (816.83 KiB)
```

`docs/BUSINESS-RULES.md` changed (the Lenses section, the Weekly-lens `Repeat last week` sentence, and the
two Nav bullets) and `apps/api/src/api/mcp/business-rules.ts` was regenerated **in this commit** —
`apps/api/tests/mcp/verbatim.test.ts` is what proves the pairing held.
