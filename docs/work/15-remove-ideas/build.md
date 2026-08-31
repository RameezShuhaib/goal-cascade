# 15 — Remove the Ideas entity, end to end

**Status: done.** Branch `worktree-agent-a62d0f5a7d52e98a8`. One commit:
`feat: remove the Ideas entity end to end`.

The request, verbatim (CR-6 in `docs/work/14-redesign/CHANGE-REQUEST.md`):

> *"i no more need ideas page so remove all the apis and entity from the system. becuase i can leverage
> backlog to do the same."*

And on the rows already stored — which is exactly what CR-6's open question 3 was asking:

> *"forget about it nor i care about its data as i didnt use it."*

So this is a deletion, not a migration. **No export, no conversion into backlog items, no compatibility
shim.** The table is dropped with its data.

This work is deliberately independent of the lens/Weekly redesign being specified in parallel
(CR-1…CR-5). Nothing here anticipates it — see *Deliberately not done* at the end.

---

## 1. What was deleted, by layer

### Schema and data

| Removed | Where |
|---|---|
| `ideas` table (+ its `ix_ideas_owner` index) | `apps/api/src/infrastructure/persistence/schema.ts`, and the `schema` barrel |
| the rows in it | `apps/api/migrations/0002_drop_ideas.sql` |

**Migration `0002_drop_ideas.sql`** — generated with `drizzle-kit generate --name drop_ideas`, never
hand-written and never by editing an applied migration. Its whole body is:

```sql
DROP TABLE `ideas`;
```

SQLite drops a table's indexes with the table, so `ix_ideas_owner` needs no statement of its own. There
is no foreign key *into* `ideas` from anywhere, and none *out* of it that mattered: `ideas.goal_id` was
an unconstrained tag column by design (Q-5 nulled it rather than cascading), and `ideas.user_id`'s FK
dies with the table. `meta/_journal.json` and `meta/0002_snapshot.json` are the generator's, unedited.

Applied locally and verified:

```
npx wrangler d1 migrations apply goal-cascade-db --local      → 0002_drop_ideas.sql ✅
npx wrangler d1 execute goal-cascade-db --local \
  --command "SELECT name FROM sqlite_master WHERE name LIKE '%idea%';"   → []
```

### Cascade logic

Q-5's goal-deletion cascade used to null **two** kinds of tag. `GoalService.remove` no longer reads
ideas, no longer emits the `idea.untagByGoals` guarded statement, and no longer counts them: `untagged`
narrows from `{ ideas, learnings }` to `{ learnings }`. The learnings half is untouched and still
tested — the behaviour `S-idea-7-1` asserted survives as a plain Q-5 property.

### API

| Removed | File |
|---|---|
| `ideasRoutes` — `GET`/`POST /ideas`, `DELETE /ideas/:id`, `POST /ideas/:id/attach`, `POST /ideas/:id/convert-to-task` | `api/routes/capture.routes.ts` |
| its mount in the route loop | `api/app.ts` |
| `IdeaService` (list/create/remove/attach/convert, `splitCapture`, `toIdeaView`, `requireIdea`, `requireActiveLeaf`) | `application/services/capture.service.ts` |
| `BootstrapService`'s ideas reader and the `ideas` key it returned | same file |
| `IIdeaRepo` port + its DI symbol | `application/ports/repositories.ts` |
| `D1IdeaRepo` | `infrastructure/persistence/d1-capture.repo.ts` |
| both DI registrations (`IIdeaRepo → D1IdeaRepo`, `IdeaService`) and their imports | `infrastructure/di/container.ts`, `di/tokens.ts` |
| `Idea` domain type | `domain/entities.ts` |
| `TaskSource.idea` and its `Created — from an Idea` line | `domain/enums.ts`, `services/activity-log.ts`, `services/backlog.service.ts` |

`capture.service.ts` and `capture.routes.ts` were **narrowed, not deleted** — they serve learnings too.
What stayed, because learnings still need it: `assertLifeGoalTag` (its wording and error message
retargeted at learnings), `LearningService`, `BootstrapService`, `newestFirst`, `buildBacklogItem`,
`buildTaskWrites`, `assertCanHoldBacklog` (still used by backlog create and move).

### Contract (`packages/shared/`)

Removed: `CreateIdeaRequest`, `AttachIdeaRequest`, `ConvertIdeaRequest`, `IdeaResponse`,
`AttachIdeaResponse`, `ConvertIdeaResponse`, `IdeaView`, `IdeasResponse` and all their inferred types;
the four `ENDPOINTS` entries; `'idea'` from `TASK_SOURCES`.

**Error codes: none became unreachable, so none were removed.**

- `NOT_A_LIFE_GOAL` — still raised, by a Learning's tag (R-learning-2). Only its doc comment changed.
- `LIFE_GOAL_NO_BACKLOG` — still raised by backlog create and move; the Idea attach was one of three
  callers, not the only one.
- `BRANCH_NOT_ACTIVE`, `NOT_A_LEAF` — still raised by task create and backlog conversion.

### Read models — two breaking changes, both sides moved together

1. `BootstrapResponse.ideas` — **removed**.
2. `DeleteGoalResponse.untagged` — `{ ideas, learnings }` → `{ learnings }`.

The web client parses every response with the shared schema, so either of these left half-applied would
render the schema-mismatch state rather than failing quietly. Server, contract, client, MSW fixtures and
tests all moved in the same commit.

### MCP

| Removed | |
|---|---|
| 5 tools | `list_ideas`, `capture_idea`, `attach_idea_to_goal`, `convert_idea_to_task`, `delete_idea` |
| 1 resource | `goalcascade://ideas` |
| 1 prompt | `process_ideas` |

Surface: **43 → 38 tools, 11 → 10 resources, 5 → 4 prompts.** `tests/mcp/tools.test.ts` pins all three
counts and was updated to the new ones — the assertion is still exact, not loosened.

Also scrubbed: `get_overview`'s `include` enum and `counts`, `find_goal`'s `only: life` description,
`preview_goal_deletion` / `delete_goal` descriptions and their `would_untag` shape, `create_task`'s
`source` description, `change_password`'s prompt-injection warning ("a goal, task, backlog item, idea or
learning"), `review_the_carry`'s prompt text, the `NOT_A_LIFE_GOAL` entry in the error catalogue, and
the prompts file header (five workflows → four).

**The server instructions block** — the text a connecting agent is briefed with on connect — had a
`BACKLOG, IDEAS, LEARNINGS` paragraph advertising tools that no longer exist. It now reads
`BACKLOG AND LEARNINGS`. It is pinned by a byte-equality test against `MCP-TOOL-SURFACE.md` §5
(`tests/mcp/verbatim.test.ts`), so **both copies were edited identically**; the test was not weakened.

### Web

| Removed | File |
|---|---|
| `IdeasScreen`, `IdeaCard` (park, tag chips, Task this week, Attach to a goal, Delete) | `screens/CaptureScreens.tsx` |
| the Ideas tab | `components/TabBar.tsx` |
| `'ideas'` from `Screen`, `fromIdeaId` from the `taskCreate` sheet | `context/UIContext.tsx` |
| the idea branch of `TaskCreateSheet` and its `useConvertIdea` wiring | `components/BacklogSheets.tsx`, `components/Sheets.tsx` |
| `useIdeas`, `useCreateIdea`, `useDeleteIdea`, `useAttachIdea`, `useConvertIdea`, `dropIdea`, `keys.ideas` and every invalidation naming it | `api/queries.ts`, `lib/queryClient.ts` |
| `ideas()`, `createIdea()`, `deleteIdea()`, `attachIdea()`, `convertIdea()` | `api/http.ts` |
| `'ideas'` from `DeepLinkTab`, `TAB_SCREEN`, and `READ_MODEL_PREFIXES` (the service worker's read-model cache) | `pwa/deepLink.ts`, `lib/useUrlSync.ts`, `sw/handlers.ts` |

Copy that named ideas: the `NOT_A_LIFE_GOAL` sentence (`lib/errorCopy.ts`), the delete-goal confirmation
("Ideas and learnings tagged here move to Unsorted" → "Learnings tagged here…"), the `InactiveBranchSheet`
doc comment, and `TopActions`' cluster comment.

**The tab bar is now `Tasks · Goals · + · Learnings`.** CR-6's eventual target is
`Goals · + · Learnings`, but the **Tasks** tab goes because CR-3 absorbs the Tasks page into the Weekly
lens — that is redesign work, not Ideas removal, so navigation was not restructured.
`CaptureScreens.tsx` keeps its name and now holds only `LearningsScreen`.

### Tests

Deleted outright, never skipped:

- `apps/api/tests/capture/ideas.test.ts` — 11 tests, the whole file.
- the `describe('Ideas')` block in `apps/web/tests/screens/capture.test.tsx` — 7 tests.
- `'happy path: an idea becomes a task, or a backlog item…'` in `tests/mcp/tools.test.ts` — 1 test.

**19 deleted in total. 421 api + 227 web + 28 shared remain, all passing.**

Fixtures and shared seeds were cleaned, not left with dangling references:

- `tests/goals/fixtures.ts` — `seedIdea` and `ideasOf` removed.
- `tests/backlog/fixtures.ts` — `deleteGoalAndUntag` no longer untags ideas.
- `tests/msw/fixtures.ts` — the `idea()` factory, `ideasResponse()`, and `ideas` in `bootstrapResponse()`.
- `tests/msw/handlers.ts` — the five `/api/ideas*` handlers.

Three cases used an Idea as an *arbitrary second entity* rather than testing ideas. They were re-pointed
at Learnings so the coverage survives the entity: the atomicity/rollback cases in
`tests/guarded-batch.test.ts`, and the `expectedChanges: 0` cases in `tests/guarded-batch.test.ts` and
`tests/review/guarded-semantics.test.ts`.

Rewritten in place, because the assertion outlives the entity:

- `tests/goals/delete-cascade.test.ts` — `S-idea-7-1` becomes a Q-5 test over two learnings: the tag
  inside the doomed subtree nulls to Unsorted, the one outside survives, neither row is deleted.
- `tests/capture/learnings.test.ts` — that test's name loses its `S-idea-7-1 (learnings half)` prefix.
- `tests/tasks/activity.test.ts` — the four-source table becomes three.
- `tests/tasks/week-model.test.ts` — a fixture task's `source: 'idea'` becomes `'drawer'`.
- `tests/mcp/tools.test.ts` — the tag/attach-asymmetry test becomes a plain learning-tag test.
- `tests/pwa/deepLink.test.ts` — `?tab=ideas` becomes `?tab=plan`, still proving a non-tab-bar screen parses.

### Docs

**`docs/SPEC.md`** — nothing silently deleted. The §6 ledger is how a reviewer diffs intent, so
**Amendment 2 — the Idea entity is retired** was added with the same structure Amendment 1 uses: what
was retired, amended rules before → after, amended scenarios, and consequences checked and found to hold.
In place:

- §1 `### Idea` — marked `⚠ RETIRED by Amendment 2`; the field table left standing.
- §2 `### Idea` — marked retired; **R-idea-1 … R-idea-8 left unedited**, with a note that nothing
  replaces them.
- §3 `### Idea` — marked retired; the six `S-idea-*` scenarios left in place, with a note that the
  learnings half of S-idea-7-1 survives under Q-5 and is still tested.
- Rules that merely *mentioned* an idea were amended in place and marked `⚠`: R-task-2 (four sources →
  three), R-task-30 (the `Created — from an Idea` row), R-task-34, R-backlog-2, R-backlog-4, R-nav-1
  (five tabs → four), R-nav-11, R-auth-2, R-learning-2, S-task-5-1, S-task-34-5, and
  Q-5 / Q-7 / Q-10 / Q-11 / Q-12.
- §5 `D-22` (the mockup deleted the idea before the task was saved) marked retired; its text kept as a
  record of what the mockup did.

**`docs/BUSINESS-RULES.md`** — the `## Idea (parking lot)` section removed, plus every cross-reference:
the Task section's creation sources and its activity line, the Backlog section's "or an Idea attached to
a goal", and the Navigation section's tab list. This file ships verbatim to AI agents as
`goalcascade://rules/business-rules`, so `api/mcp/business-rules.ts` was **regenerated from the file**
and the byte-equality test passes.

> One real side effect, recorded because it is not mine: that constant had **already drifted** before
> this work. Commit `c369af2` amended `BUSINESS-RULES.md` for the halted planning-ahead work without
> regenerating the TS copy, so `tests/mcp/verbatim.test.ts` was already failing on `main` (1 of the 433
> baseline tests). The only way to satisfy a byte-equality test is to regenerate byte-exactly, so that
> pre-existing failure is fixed here as a consequence, and the shipped business-rules resource now
> carries the Amendment-1 prose the document already had.

**`docs/research/MCP-TOOL-SURFACE.md`** — §2.6 Ideas removed (2.7/2.8 renumbered to 2.6/2.7), the
`goalcascade://ideas` resource row, the `process_ideas` prompt, the tool-count header, the category
table row, safety rail 5, and the scattered idea mentions in `get_overview` / `preview_goal_deletion` /
`delete_goal` / `create_task` / `find_goal` / the error table. §5's instructions block was edited
identically to `instructions.ts`.

**`docs/research/UX-API-TOKEN.md`** — one rationale example named "the Ideas screen"; now "the Learnings
screen".

**`docs/work/14-redesign/CHANGE-REQUEST.md`** — CR-6 marked resolved and shipped, open question 3
answered with the owner's own words, question 4 narrowed to its still-open Tasks half, and the blast-radius
MCP line marked done.

---

## 2. Verification

| Check | Result |
|---|---|
| `npm run typecheck --workspaces --if-present` | clean — api, web (incl. `tsconfig.sw.json`), shared |
| `npm test -w @goal-cascade/api` | **421 passed** (baseline 433 run / 432 passing) |
| `npm test -w @goal-cascade/web` | **227 passed** (baseline 234) |
| `npm test -w @goal-cascade/shared` | **28 passed** (unchanged) |
| `npm run build -w @goal-cascade/web` | ok — `dist/sw.js` emitted, precache manifest 13 entries / 736.60 KiB |
| `wrangler d1 migrations apply goal-cascade-db --local` | `0002_drop_ideas.sql` ✅; `ideas` gone from `sqlite_master` |

**The drop is only ideas tests.** 433 → 421 api = 11 (`capture/ideas.test.ts`) + 1 (the MCP idea
happy-path). 234 → 227 web = the 7 `describe('Ideas')` cases. Nothing else was removed, skipped or
loosened; the one test whose *numbers* changed (`tools.test.ts`: 43/11/5 → 38/10/4) still asserts an
exact surface. Every api test now passes, including the one that was red before this work.

Not deployed. Not merged.

---

## 3. Grep audit — every remaining `idea` / `Idea` hit

`grep -ril "idea"` over the whole repo, excluding `node_modules`, `dist` and `.git`.

**Zero hits in `apps/api/src`, `apps/web/src`, `packages/shared`, `docs/BUSINESS-RULES.md`, or any test
file other than the one comment noted below.**

| File(s) | Hits | Verdict |
|---|---|---|
| `apps/api/migrations/0000_lovely_cammi.sql`, `meta/0000_snapshot.json`, `meta/0001_snapshot.json` | 4 | **Legitimate — history.** An applied migration and its snapshots are immutable; `0002` is what removes the table. Editing them would desync every already-migrated database. |
| `apps/api/migrations/0002_drop_ideas.sql`, `meta/_journal.json` | 2 | **Legitimate — this *is* the removal.** (`meta/0002_snapshot.json` has zero hits: the table is gone from the model.) |
| `apps/api/tests/mcp/tools.test.ts:32` — `// minus the 5 idea tools retired with the Ideas entity.` | 1 | **Legitimate.** My own comment explaining why the pinned tool count dropped from 43 to 38. Removing it would leave an unexplained magic number. |
| `apps/web/scripts/make-icons.mjs:5` — *"the product's whole idea in one glyph"* | 1 | **Legitimate — the English word.** Nothing to do with the entity. |
| `docs/SPEC.md` — §1/§2/§3 `### Idea` blocks, `R-idea-1…8`, the six `S-idea-*`, and §6 Amendment 2 | ~30 | **Legitimate — required.** Retired in the ledger rather than deleted, so a reviewer can diff intent. Every block carries a `⚠ RETIRED by Amendment 2` marker. |
| `docs/SPEC.md` §5 `D-10`, `D-22`, `D-26` | 4 | **Legitimate — history.** §5 records what the *mockup* did and why the spec differs. D-22 is marked retired; D-10 and D-26 cite `IdeasScreen` as one of several mockup bugs and remain true statements about the mockup. |
| `docs/research/MCP-TOOL-SURFACE.md:44` — *"the five Idea tools were retired with the Ideas entity"* | 2 lines | **Legitimate.** The note explaining the 42 → 37 documented tool count. |
| `docs/work/01…13/*.md` — 11 completed work-package logs and `13-planning-ahead/spec-delta.md` | ~65 | **Legitimate — history.** Logs of what was built at the time, in packages that are finished. Rewriting them would falsify the record; nothing in the product or the MCP surface reads them at runtime. |
| `docs/work/14-redesign/CHANGE-REQUEST.md` | ~12 | **Legitimate.** The owner's request itself, plus the resolution note added by this work. |
| `docs/work/14-redesign/UX-PLAN.md:68` — *"altitude is a vertical idea… time is a horizontal idea"* | 2 | **Legitimate — the English word.** |
| `docs/work/14-redesign/UX-PLAN.md:370, :1234` | 2 | **Stale, and deliberately not mine.** Line 370 uses "untagged ideas and learnings" as a vocabulary precedent for `UNSORTED`; line 1234 lists "no migration design for existing Ideas" as an open item, which this work has now answered. That document is being written by the redesign agents right now, and editing it under them would collide. Flagged here so it is not lost. |
| `docs/work/15-remove-ideas/build.md` | this file | **Legitimate.** The record of the removal. |

---

## 4. Deliberately not done — it belongs to the redesign, not to this removal

- **The Tasks tab.** CR-6's eventual tab bar is `Goals · + · Learnings`, but Tasks goes because CR-3
  absorbs the Tasks page into the Weekly lens. Removing it here would be building ahead of an unfinished
  spec. The bar is `Tasks · Goals · + · Learnings` — the minimal clean removal of the Ideas tab.
- **Renaming `CaptureScreens.tsx`** now that it holds a single screen, and likewise `capture.service.ts`
  / `capture.routes.ts` on the API side. Cosmetic, and the redesign passes over these files.
- **`docs/work/14-redesign/UX-PLAN.md`.** Being written by other agents in parallel; its two stale Idea
  references are theirs to clear (see the audit table).
- **Lens navigation, the Weekly horizon, retiring `weekly_focus`, per-horizon periods, the task detail
  page, adopting a router.** None touched.
- **Deleting the `R-idea-*` rules and `S-idea-*` scenarios from `SPEC.md`.** Retired in the §6 ledger
  and left standing in §2/§3, by instruction.
