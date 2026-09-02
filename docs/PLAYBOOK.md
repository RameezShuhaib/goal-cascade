# How work gets done here

The owner's instruction, verbatim:

> *"Remember you change should go through subagents, build, UX research(if changes needed in fe),
> code quality, e2e."*

Every change goes through subagents. The orchestrator coordinates, merges, deploys and reports —
it does not implement.

## The pipeline

| # | Stage | When | Output |
|---|---|---|---|
| 1 | **UX research** | any change a user can see | `docs/work/NN-*/UX-PLAN.md` |
| 2 | **Build** | always | code + tests + `build.md` |
| 3 | **Code quality** | always | review findings, by a different agent |
| 4 | **E2E** | always | a browser walkthrough of the real scenarios |

**No agent reviews its own work.** Stages 3 and 4 are separate agents from stage 2.

### 1 — UX research
Mandatory before any front-end change, and **its call is final**. The orchestrator does not
substitute its own design. This rule exists because the orchestrator kept sketching solutions
inline and getting them wrong: shortening tab labels instead of a scrolling strip, a `…`
placeholder, a fallback-font chevron, a picker that flooded a sheet.

### 2 — Build
Follows the UX plan literally. Ambiguity in the plan is a question, not a guess.

### 3 — Code quality
A fresh agent reads the diff for correctness, dead code, duplicated rules, retired entities still
reachable, and tests that assert a label rather than a rule.

### 4 — E2E
A browser walkthrough of the numbered scenarios, not a green suite. Every defect the owner has
found in this product survived a fully green test run:

- `period?.label ?? '…'` rendering a literal ellipsis
- `▾` (U+25BE) falling back to a system font beside Manrope
- the goal picker flooding a form sheet at three options
- `+ Task` never naming where the task went
- tasks landing in an August week from the September lens
- the default parent locking onto whichever horizon read resolved first
- `Sep` and `Sept` on one screen, differing by the viewer's ICU version

The last two were found by a browser pass and were invisible to 1,100 passing tests — one because
every mock resolves in the same tick, the other because the calendar census guards arithmetic and
not names.

## Standing rules

- Commit `docs/BUSINESS-RULES.md` and the regenerated `apps/api/src/api/mcp/business-rules.ts`
  **in the same commit**. Split three times; `main` was red each time.
- Agents communicate through committed artifacts, not through the orchestrator's summary.
- A test that would pass before the fix is not a regression test. Prove it fails first.
- Report what was verified by eye and what only has tests behind it. Do not blur them.
