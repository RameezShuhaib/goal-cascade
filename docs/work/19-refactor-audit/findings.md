# Refactor audit — after the lens redesign

Read-only audit of the state left by `15-remove-ideas`, `16-lens-api`, `17-lens-web` and
`18-finish-redesign`. **Nothing here was fixed.** Fixing is a separate pass, so the fixes get an
independent check.

The suite is green (549 api / 283 web / 43 shared) and typecheck is clean. That proves the code that
*runs* is correct and says nothing about the code that no longer runs, which is what this looked for.

**Scope.** Only the 294 git-tracked files are live code. `.claude/worktrees/` is gitignored and holds
17 stale full copies of the repo (3.5 GB) containing deleted files such as `plan.routes.ts`; every
search used `git grep` or excluded it. Applied migrations, finished `docs/work/*` logs and SPEC
sections marked retired are immutable history and are **not** flagged. The codebase's deliberate
`⚠ **A2** … DELETED/retired` comment convention is correct history and is **not** flagged; only
prose asserting retired behaviour in the present tense is.

**Counts: 6 must fix · 21 should fix · 11 consider.**

---

## Headline

- **No retired entity is reachable at runtime.** Ideas, `weekly_focus`, the plan endpoints, the
  tree / Tasks / weekly-planning screens, the task drawer and the filter pills are gone from every
  layer checked — source, types, schemas, migrations, DI, MCP tools and resources, query keys,
  service-worker prefixes, error codes, fixtures.
- **No rule is implemented twice, and none is implemented zero times.** 24 superseded/retired rules
  sampled from SPEC §6, both halves verified. All clean.
- **"Leaf" does not survive as a task-ownership test anywhere.** All ~40 `leaf` matches in live
  source sit inside retirement comments. Ownership is `horizon === 'Weekly'`, nothing else.
- **The MCP runtime surface is accurate.** Instructions block, ~40 tool descriptions, four prompts
  and nine resources were read in full; every field they name exists. The stale material is in two
  *documents*: `docs/BUSINESS-RULES.md` (which ships verbatim to agents) and
  `docs/research/MCP-TOOL-SURFACE.md` (which does not ship, but is cited by live source as its
  source of truth).
- Three genuine **runtime bugs** surfaced in the new lens code (M5, M6, S1). They are not entity
  residue, but they are in the code this redesign wrote and they are invisible to typecheck.

---

## Must fix

### M1 — `docs/BUSINESS-RULES.md:26` documents a period picker that was deliberately retired

> Both chevrons and **the picker** reach the same range … A period holding work is marked in **the
> picker**, so a goal set three months out is not invisible until you get there.

`SPEC.md:263` retires it in terms: *"**RETIRED — there is no picker.** The label is the Zoom-sheet
button (R-lens-17), and a second control over the *same* dimension is exactly how D-24 happened."*
The forward-content marker is a **dot on the forward chevron** (R-lens-26), implemented at
`apps/web/src/lens/LensRow.tsx:67`.

This file is served verbatim over MCP at `goalcascade://rules/business-rules`
(`apps/api/src/api/mcp/resources.ts:168`) and is advertised to the agent as *"The product's own rules
document, verbatim. The authoritative prose…"*. A connected agent will tell the owner to open a
control that does not exist.

**Fix.** Replace both "picker" clauses: the two chevrons are the only period control; forward content
is signalled by a dot on the forward chevron. Then regenerate
`apps/api/src/api/mcp/business-rules.ts:14` — `apps/api/tests/mcp/verbatim.test.ts:29` fails until
both sides move together.

### M2 — `docs/BUSINESS-RULES.md:14` documents a horizon picker that no longer exists

> When created as a sub-goal, **the horizon picker** only allows ranks below the parent's … The
> period **defaults to** the current one for that horizon.

`apps/web/src/components/GoalModals.tsx:27-32` states the opposite as implemented fact: *"The heading
names the horizon, so **the horizon picker is gone entirely**. The period is a **read-only chip**…"*
and *"**Creating a goal into a period you are not looking at is impossible**"*. Two claims wrong: no
horizon picker, and the period is not a defaulted field — it is fixed by the lens you stand in. The
*parent* picker half is still accurate (`GoalModals.tsx:37`). Same MCP exposure as M1.

**Fix.** Rewrite to: the heading names the horizon; the period is a read-only chip taken from the
current lens; only the parent is chosen, from legal parents only.

### M3 — `docs/BUSINESS-RULES.md:30` pins badge copy the product does not use

> A future period is badged `Planning ahead` and nothing more.

The badge names its horizon: `Future month — planning ahead` / `Past week — still editable`
(`apps/web/src/lens/copy.ts:19-20`). This was a deliberate reconciliation decision
(`RECONCILIATION.md` C-5: *"the horizon word is what makes the badge true on four lenses instead of
one"*) and `SPEC.md:276` was amended. `BUSINESS-RULES.md` was not. Backticks make it read as literal
copy.

**Fix.** Quote the real per-horizon copy; regenerate as in M1.

**Related (not MCP-shipped, still wrong):** `SPEC.md:961` (`S-lens-11-1`) is R-lens-11's own
acceptance scenario and still asserts the pre-reconciliation copy, contradicting the rule one screen
above it. It is not marked superseded. `SPEC.md:1449`'s §6 ledger row has the same stale copy.

### M4 — `docs/research/MCP-TOOL-SURFACE.md` is still the pre-A2 surface, and live source cites it as authoritative

Only **§5** of that ~1,200-line document was rewritten. Everything else specifies the deleted product:

| Location | Retired thing still specified as current |
|---|---|
| §2, `:97,103,130,163,165` | `is_leaf`, `is_active`, `dormant`, `subtree_active`, `active_leaves`, `find_goal(only="leaves")` |
| §2, `:362-419` | `get_weekly_plan`, `set_goal_focus`, `clear_goal_focus`, `save_weekly_plan`, `dormant_leaves` |
| §2, `:213,336` | `weekly_focuses` in deletion previews |
| §4 prompts, `:887-889,966-970` | *"Write the plan with `set_goal_focus` one branch at a time"*; *"which branches will go dormant"* |
| §6 errors, `:1086,1095,1101` | `BRANCH_NOT_ACTIVE`, `NOT_A_LEAF`, `WEEK_NOT_CURRENT` — all three deleted from `ERROR_STATUS` |
| §7, `:1135` | *"`save_weekly_plan` requires `confirm_deactivations`"* |

The byte-equality test passes because `apps/api/tests/mcp/verbatim.test.ts:20` splits on
`## 5. Server instructions block` and pins **only** the fence inside §5. Every other section is
unpinned and has drifted.

**Live code points at it.** `apps/api/src/api/mcp/prompts.ts:5` says *"The four workflows, reproduced
from `docs/research/MCP-TOOL-SURFACE.md` §4."* — and §4 still tells the agent to call
`set_goal_focus`. The live prompts were correctly rewritten; their stated provenance now points at
the old design. Anyone extending the MCP surface who reads §2 as the contract rebuilds focus
sentences.

**Fix.** Rewrite §§1–4 and 6–8 to the A2 surface, or mark the document superseded and move §5 (the
only pinned part) somewhere the pin still holds. Then correct `prompts.ts:5`.

### M5 — `LensScreen.tsx:95` — a vestigial guard is a tautology, and the create button renders during load

```
apps/web/src/lens/LensScreen.tsx:43   const view = data?.period ?? null;
apps/web/src/lens/LensScreen.tsx:87   const canCreate = !view?.isPast;
apps/web/src/lens/LensScreen.tsx:95   {canCreate && view !== undefined && (
apps/web/src/lens/LensScreen.tsx:99     onClick={() => ui.openSheet({ …, periodKey: view?.periodKey ?? '' })}
```

`?? null` makes `view` a `PeriodView | null` that is **never** `undefined`, so `view !== undefined` is
always true — a leftover from when the value was optional. While the read is pending, `view` is
`null`, `canCreate` is `!undefined` = `true`, and the `+ Monthly goal` button renders and is
clickable with **`periodKey: ''`**. Typecheck cannot catch a comparison that is merely always true.

**Fix.** `{canCreate && data !== undefined && (` — which is what the guard was meant to say.

### M6 — `index.html:123` publishes `--safe-bottom` "for the tab bar" and the tab bar never uses it

```
apps/web/index.html:117-124
   * … the tab bar is `position: fixed` and padding on `#root` would not move it —
   * so it is published as a custom property for the tab bar and any other fixed chrome to consume.
  :root { --safe-bottom: env(safe-area-inset-bottom, 0px); }
```

Three components consume it — `components/Toast.tsx:25`, `components/auth/ui.tsx:33`, and the
assertion at `tests/pwa/manifest.test.ts:69` — and `components/TabBar.tsx:30`, the fixed wrapper the
comment names, does not. Installed on a notched phone the tab bar's 56px buttons sit under the home
indicator.

**Fix.** `paddingBottom: 'var(--safe-bottom, 0px)'` on the fixed wrapper at `TabBar.tsx:30`.

---

## Should fix

### S1 — `LensScreen.tsx:308` drops the `lens === 'Weekly'` guard its neighbour three lines up has

```
:305   {lens === 'Weekly' && data.carried.length > 0 && (
:306     <CarriedBand … />
:308   {data.items.length === 0 && (
:312       Nothing planned for this week — the work below is still carrying.
```

Line 308 is the same condition as 305 (the block is reachable only when `carried.length > 0`, because
`:253` returns early otherwise) but drops the lens guard while hardcoding **"this week"**. It cannot
misfire today only because the server never populates `carried` outside the Weekly lens
(`goal.service.ts:148` sets `weekTasks = []` for non-Weekly; `:163-164` derives `carried` from
`taskGoalIds`). A client-side sentence resting on a server-side invariant.
**Fix.** Hoist `const showCarried = lens === 'Weekly' && data.carried.length > 0` and use it for both.

### S2 — three renderings of "a week", and two of them collide on screen

`routes.ts:7-8` states the rule: *"Periods are machine-formatted in the URL and human-formatted on
screen (`PeriodView.label`)."* Broken for weeks:

- **Server** `apps/api/src/domain/periods.ts:104-107` → **`Week of 31 Aug`** (rendered as the lens
  title at `LensRow.tsx:38`; asserted at `tests/routing/routes.test.tsx:23`)
- **Client** `apps/web/src/utils/dates.ts:33-35` `weekLabel()` → **`Mon 31 Aug`**
- **Client** `apps/web/src/utils/dates.ts:38-40` `shortDate()` → **`31 Aug`**

Loudest at `apps/web/src/screens/TaskPage.tsx:64`:
`` const backLabel = task ? `Week of ${weekLabel(…)}` : 'Back'; `` → **`Week of Mon 31 Aug`**, the
server's canonical label with a weekday spliced in. Navigate from the Weekly lens (`Week of 31 Aug`)
into a task and the back button names the same week differently. Five more sites use the client
formatter for the same concept: `lens/cards.tsx:310`, `components/BacklogSheets.tsx:287-288` and
`:368`, `components/BacklogItemCard.tsx:76`, `components/TaskRow.tsx:97`.
**Fix.** Put `PeriodView.label` on the wire for these, or make `weekLabel` produce the server's exact
shape. Two formatters for one concept must not stay.

### S3 — `GET /api/learnings` is the one list endpoint the page cap never reached

Q-12's surviving half (`SPEC.md:1068`) keeps *"Every list endpoint is paginated with a hard page cap
of 200"* and a 5,000-learnings cap. The scale pass wired `MAX_PAGE` into goals
(`goal.service.ts:136`), tasks (`task.service.ts:114`) and backlog (`backlog.service.ts:327`), each
with the comment *"`MAX_PAGE`, wired. It existed and was referenced nowhere"*, and left learnings
alone: `capture.service.ts:75-78` calls `ILearningRepo.listAll`, an unbounded
`SELECT * FROM learnings WHERE user_id = ?` (`d1-capture.repo.ts:75-83`), and `LearningsResponse`
(`packages/shared/src/read-models.ts:265`) has no `nextCursor`. One response can carry 5,000 rows.
**Fix.** Cap and cursor it like the other three, or record in Q-12 that learnings are exempt.

### S4 — `apps/api/src/api/mcp/resources.ts:90` asserts an invariant that is false

The `goalcascade://life` description claims life goals are *"the **only** unscoped read in the
product, and the one list guaranteed complete."* `goalcascade://learnings` (`:143`) and
`list_learnings` are equally unscoped and complete (see S3). Fix the sentence, or fix S3 and make it
true.

### S5 — `goal.service.ts:1019` reimplements `domain/weeks.addWeeks`

```
/** Local, because `domain/weeks` owns the arithmetic and this file owns no date rules of its own. */
function addWeeksTo(weekStart: string, n: number): string {
```
The comment says the domain owns the arithmetic, then writes the arithmetic. The file already imports
from `domain/weeks` at line 48. One call site (`:551`, `Repeat last week`). Behaviour is equivalent —
both throw `RangeError` on a malformed date — so this is duplication, not a bug.
**Fix.** Import `addWeeks`; delete lines 1018–1022.

### S6 — sixteen dead exports

Each verified with `git grep -w`: exactly one hit, its own declaration.

| File:line | Symbol | Note |
|---|---|---|
| `apps/api/src/domain/errors.ts:25` | `validationFailed` | |
| `apps/api/src/infrastructure/auth/rate-limit.ts:37` | `AUTH_RATE_LIMIT_MAX_WINDOW_MS` | purge cluster, S10 |
| `apps/api/src/infrastructure/auth/signup-allowlist.ts:40` | `SIGNUP_NOT_ALLOWED_STATUS` | siblings `_CODE`/`_MESSAGE` are live |
| `apps/web/src/api/queries.ts:681` | `usePatchBacklogItem` | only backlog hook with no consumer |
| `apps/web/src/api/queries.ts:138` | `useTasks` | test-only; its consumer was the Tasks screen |
| `apps/web/src/lens/copy.ts:124` | `TASKS_LIVE_ON_WEEKLY_GOALS` | see S7 |
| `apps/web/src/lib/landing.ts:32` | `hasLanding` | |
| `apps/web/src/lib/queryClient.ts:51` | `OWNER_KEYS` | |
| `apps/web/src/lib/serverClock.ts:24` | `subscribeServerClock` | cluster with next |
| `apps/web/src/lib/serverClock.ts:31` | `serverSkewMs` | |
| `apps/web/src/pwa/installState.ts:92` | `canPromptInstall` | cluster, S9 |
| `apps/web/src/pwa/installState.ts:97` | `resetInstallPrompt` | |
| `apps/web/src/utils/periodKeys.ts:31` | `longerHorizons` | superseded — `useParentOptions.ts:25,37` inlines its body |
| `apps/web/src/ui.ts:259-267` | `pulseBadge` | consumers were the tree/Tasks rows |
| `apps/web/src/ui.ts:70-72` | `softL` / `softC` / `softInk` | referenced only inside `pulseBadge` |
| `apps/web/src/lens/LensScreen.tsx:10,530` | `PERIOD_UNIT` import + re-export | imported solely to re-export; all four real consumers go to `utils/periodKeys` |

`tsconfig.base.json` does not set `noUnusedLocals`, which is why none of this trips typecheck.
Deleting `usePatchBacklogItem` orphans `ApiClient.patchBacklogItem` (`api/http.ts:319`); **keep** that
method — it mirrors the live `PATCH /backlog/:id` route.

### S7 — the copy that *replaced* "leaves hold tasks" is defined, unused, and hardcoded elsewhere

`apps/web/src/lens/copy.ts:124` declares `TASKS_LIVE_ON_WEEKLY_GOALS = 'Tasks live on weekly goals.'`
under the comment *"The rule, wherever it must be said. Never 'leaves hold tasks' (R-goal-37)."*
Nothing imports it — and the identical literal is hardcoded at `apps/web/src/lib/errorCopy.ts:53`.
The one place the rule *is* said does not use the constant that exists to say it.
**Fix.** Import it in `errorCopy.ts`.

### S8 — orphaned styles and dead style branches

- `apps/web/src/ui.ts:66-67`, `:92` — `warn`, the amber. Its only reference outside `ui.ts` is a
  comment at `components/AgentAccess.tsx:464` saying *not* to use it. Its doc calls it *"the move
  sheet's disabled-reason amber"*, and `GoalModals.tsx:188-192` records that those disabled reasons
  were deleted: *"R-goal-19's two disabled reasons no longer have anything to annotate."*
- `apps/web/src/ui.ts:290-305` — the `'dis'` arm of `pickerRow`. All five call sites pass `'ok'`/`'sel'`
  (`BacklogSheets.tsx:416`, `GoalModals.tsx:155` and `:223`, `ZoomSheet.tsx:52`,
  `GoalDetailScreen.tsx:189`). Same cause. Narrow the parameter to `'ok' | 'sel'`.
- `apps/web/src/ui.ts:270-278` — `dot(p, dim)`. Both callers pass `false` (`lens/cards.tsx:97`,
  `GoalDetailScreen.tsx:158`); `cards.tsx:96` says why: *"Never dimmed: no goal is muted or greyed
  anywhere any more (R-goal-38)."* Drop the parameter.
- `apps/web/src/ui.ts:280-288` — `hChip(active)`. Both callers pass `false`
  (`GoalDetailScreen.tsx:100`, `:160`); the `accentSoft`/`accent` arm is unreachable.

### S9 — the consumer half of `pwa/installState.ts` is dead

`useInstallState` (`:126`) has no caller in source or tests; `docs/work/02-pwa/build.md:155` says it
*"is available if an 'Add to Home Screen' affordance is added"*, and none was. The only production
importer is `pwa/boot.ts:19`, which takes `captureInstallPrompt` alone. Dead with it: `promptInstall`
(`:77`), `canPromptInstall` (`:92`), `resetInstallPrompt` (`:97`), `getSnapshot` (`:113`), `subscribe`
(`:101`), the `InstallState` interface (`:16`). With `subscribe` gone the `notify` loop iterates a
permanently empty set. **Keep** `Platform`, `detectPlatform` (`:30`, used by `tests/setup.ts`) and
`captureInstallPrompt` (`:60`).

### S10 — the ops-sweep seam is registered but unreachable end to end

Three `purgeBefore` methods have no caller: `IIdempotencyRepo` (`repositories.ts:309` /
`d1-idempotency.repo.ts:44`), `IEmailOutboxRepo` (`:317` / `d1-email-outbox.repo.ts:32`),
`IAuthRateLimitRepo` (`:346` / `d1-rate-limit-store.ts:55`). `d1-rate-limit-store.ts:54` documents
this as deliberate (*"this product has no cron, so it exists for an ops/internal sweep"*). But every
part of the seam is dead: the DI binding at `container.ts:89` is never resolved, and
`AUTH_RATE_LIMIT_MAX_WINDOW_MS` — which computes exactly the argument the rate-limit sweep takes —
has no caller either. **Decide once:** keep the seam and add an internal route that exercises it, or
remove all five pieces together. Do not delete piecemeal.

*Not dead, do not touch:* `IAuthRateLimitRepo.consume` has no in-repo call site because Better Auth
dispatches it through `rateLimit.customStorage` (`better-auth.ts:132`).

### S11 — two more dead repo methods

- `IUserRepo.findByEmail` (`repositories.ts:32` / `d1-capture.repo.ts:30`) — no caller.
- `IGoalRepo.listLifeGoals` (`repositories.ts:81` / `d1-goal.repo.ts:103`) — superseded; the Life lens
  uses the generic `listByLens` path (`goal.service.ts:133-135`).

### S12 — dead DI registrations

- `apps/api/src/infrastructure/di/tokens.ts:5-21` — a 15-symbol re-export block nothing imports. Every
  consumer, `container.ts:3-20` included, imports port tokens from `../../application/ports` directly.
  Already out of sync: it omits `IApiTokenRepo`. Delete `:5-21`; **keep** `export { DB }` at `:22`
  (used by `better-auth.ts:9`).
- `apps/api/src/infrastructure/di/tokens.ts:25` + `container.ts:70` — `ENV` is registered and never
  resolved. Three hits total. `AppEnv` is threaded explicitly instead.

*Clean:* all 10 registered services and all 16 injected port tokens are live; no token is registered
for a deleted service.

### S13 — two unused dependencies

- `apps/web/package.json:16` — `@tanstack/query-sync-storage-persister`. Zero source references;
  `lib/queryClient.ts` hand-rolls `identityPersister` against the *types* from
  `@tanstack/react-query-persist-client`. Not a peer of anything installed.
- `apps/api/package.json:30` — `@cloudflare/workers-types`. No import, no `/// <reference>`, absent
  from `apps/api/tsconfig.json`'s `types` array, and the generated `worker-configuration.d.ts` is
  self-contained. An *optional* peer of wrangler.

*Keep despite being unimported:* `@testing-library/dom`, `workbox-build`, `workbox-window` are
non-optional peer dependencies.

### S14 — `NotImplementedError` is scaffolding kept alive only by its own test

`apps/api/src/domain/errors.ts:59-64`, never constructed in `src`. Its docstring (`:52`) says it is
*"Thrown by the handler stubs the foundation ships"* — every stub is implemented, and
`tests/error-handler.test.ts:73` asserts exactly that. The class survives so `error-handler.test.ts`
can prove the 501 envelope renders. **Keep `NOT_IMPLEMENTED: 501` in `ERROR_STATUS`** (contract
surface; the client status table needs it). Either drop the class with its test, or fix the docstring
to say it is a fixture for the envelope.

### S15 — group headers are copy-pasted and have already diverged on accessibility

`LensScreen.tsx:369-386` (`Group`) and `:510-518` (`CarriedBand`) carry byte-identical button styling.
`CarriedBand`'s copy has **no `aria-label`**. `Group`'s comment at `:376-377` gives the reason one is
needed — *"the visible label is short; the accessible name spells the count's scope out in full"* —
and the carried band's visible label is the single word "Carried" with the `▾`/`▸` marked
`aria-hidden`. A screen reader gets "Carried, expanded" with no Expand/Collapse verb.
**Fix.** Extract one `<CollapsibleSectionHeader>` and use it from both.

### S16 — the live-region group count disagrees with the rendered headers

`LensScreen.tsx:144` announces `data.groups.length`; `LensScreen.tsx:242-245` renders only groups with
items (`.filter((x) => x.items.length > 0)`). The server builds `groups` from `[...items, ...carried]`
(`goal.service.ts:184`, `:915`), so on the Weekly lens a Life line present only through carried work
is counted but never given a header. Sighted users see N headers; screen-reader users are told N+1.
**Fix.** Announce `rendered.length`.

### S17 — `CarriedCard` is a near-copy of `WeeklyCard` that has drifted in four undocumented ways

`apps/web/src/lens/cards.tsx` — `WeeklyCard` (`:254-286`) vs `CarriedCard` (`:299-321`):

| | `WeeklyCard` | `CarriedCard` |
|---|---|---|
| `goal.why` | rendered (`:265`) | absent |
| `BacklogLine` | rendered (`:276`) | absent |
| `stalePlanLine` | rendered (`:275`) | absent |
| empty-task line | `Nothing on this yet.` (`:281`) | absent |

`CarriedCard`'s docstring (`:288-298`) justifies exactly one omission — *"It offers no `+ Task` and no
`Pull from backlog`, ever"* — and is silent on the other four. A carried goal is still a goal with a
`why` and a backlog count. Whether they belong there is a product call; right now the divergence is
undocumented, which is how the next person "fixes" it in the wrong direction.
**Fix.** Extract a shared `<GoalCardBody>`, or add one sentence per omission.

### S18 — `faint` carries load-bearing text, against the codebase's own stated rule

`cards.tsx:58-59`: *"`T.mut` at 12.5px and **never** `faint`, which fails AA in both themes and may
not carry anything load-bearing."* Measured with the repo's own `contrastRatio`
(`tests/screens/contrast.test.ts:19-33`): light `faint` `#b5b5ad` is **2.06:1** on `card` / **1.91:1**
on `paper`; dark `#6e6e66` is **3.03:1** / **3.32:1**. It is used for load-bearing text at four sites:
`ui.ts:314` (`carryLabel('gray')` — the "since Mon 24 Aug" carry age at 11.5px, rendered by
`TaskRow.tsx:96` and `TaskPage.tsx:215`), `TaskRow.tsx:89` (completed titles), `TaskRow.tsx:93` and
`TaskPage.tsx:220` ("Done Fri 28 Aug"). `contrast.test.ts` measures only `mut` and `body`, so nothing
enforces it.
**Fix.** Move those to `T.mut`, and extend `contrast.test.ts` to cover every token used for text.

### S19 — `copy.ts`'s stated empty-state invariant is false for one of the five horizons

`copy.ts:32-34`: *"**Every future variant says it and no past or present variant does.**"* referring to
*"Nothing planned this far out yet — that's expected"*. `copy.ts:46-53`: the Weekly future variant says
*"This week hasn't been laid out…"* instead. Four of five horizons honour the invariant; Weekly does
not. Either add the line to the Weekly branch or amend the comment — as written it licenses a future
edit that assumes a property the code lacks.

### S20 — stale comments describing the old model as current

| File:line | Stale text | Reality |
|---|---|---|
| `apps/web/src/api/http.ts:271-272` | *"the Tasks SCREEN is gone; this read is not. **It survives as one of the Weekly lens's inputs**"* | False for this client. The lens's tasks come from `LensResponse.tasks` via `useLens` (`LensScreen.tsx:41,224,296`). `client.tasks(…)`'s only caller is `useTasks`, which has zero production consumers (S6). The read survives for the **MCP** surface, not the lens. |
| `apps/web/src/screens/GoalDetailScreen.tsx:66-68` | *"`+ Add` on Yearly/Quarterly"* | The `TopActions` children at `:70-94` render only the Monthly and Weekly buttons. No Yearly/Quarterly branch exists. |
| `apps/web/src/context/ThemeContext.tsx:18-19` | *"`tests/api/theme.test.ts` asserts that pairing"* | **That file does not exist.** The pairing is asserted in `tests/pwa/manifest.test.ts:21-23`. |
| `apps/api/src/api/mcp/business-rules.ts:10` | *"`tests/mcp/resources.test.ts` asserts this string is byte-identical"* | **That file does not exist.** The assertion is `tests/mcp/verbatim.test.ts:29`. A reader who greps for the named drift alarm finds nothing and may conclude there is none. |
| `apps/api/src/api/mcp/prompts.ts:5` | *"reproduced from `MCP-TOOL-SURFACE.md` §4"* | §4 is pre-A2 (M4). |
| `apps/api/src/api/mcp/resources.ts:70` | *"`goalcascade://tree` and `tree/outline` are **lens** resources now"* | No lens resource is registered; they were replaced by `goalcascade://life` and `goalcascade://week/*`. |
| `apps/api/tests/mcp/verbatim.test.ts:18` | *"the entire briefing … about … **the leaf/active/dormant model**"* | The string it guards says *"There is no 'active', no 'dormant' and no focus sentence in this product"*. |
| `apps/web/src/ui.ts:65` | *"the serif focus sentence"* on `quote` | Focus sentences are deleted. **The token is live** — `TaskPage.tsx:330` colours timeline text with it — so fix the comment, do not delete the token. |
| `apps/web/src/ui.ts:269` | *"`dim` is dormancy, and dormancy must read as intentional"* | Dormancy as a rendered state is gone (`GoalDetailScreen.tsx:24-25`). Delete with the parameter (S8). |
| `apps/web/src/ui.ts:66` | *"The move sheet's disabled-reason amber"* | Those reasons no longer exist. Delete with `warn` (S8). |
| `apps/web/src/pwa/updateToast.ts:9` | *"someone who is mid-sentence writing a weekly focus"* | The weekly-planning screen is deleted. The reasoning holds; the example must change. |
| `apps/web/src/components/auth/ui.tsx:43` | *"a goal's `why` and a weekly focus sentence"* | Only `why` remains. |

### S21 — 3.5 GB of stale agent worktrees in the working tree

`.claude/worktrees/` holds 17 full repo copies at pre-redesign commits. Thirteen contain
`apps/api/src/api/routes/plan.routes.ts`; others contain the Ideas service and the `weekly_focus`
schema. Gitignored, so not a code defect — but it is exactly the "rebuilt by the next person who greps
for it" hazard, because a plain `grep -r` from the repo root finds a complete, coherent implementation
of every deleted feature. **Fix.** Prune them.

---

## Consider

- **C1 — `stepPeriod` / `firstDayOf` duplicated across the API/web boundary.**
  `apps/api/src/domain/periods.ts:158-175` and `apps/web/src/utils/periodKeys.ts:57-73` have
  **byte-identical** bodies; `firstDayOf` differs only by an extra `YEAR_RE` guard. The period regexes
  are triplicated (`periods.ts:36-38`, `periodKeys.ts:35-37`, `packages/shared/src/common.ts:111-113`)
  and `addWeeks` exists twice plus S5's third copy. None has diverged, so nothing is broken — but
  `apps/web/src/utils/periods.ts:15-16` states the principle out loud as the reason `replanPeriods` was
  removed from the client: *"two implementations of a date rule drift on the first boundary (D-3)."*
  The same argument was not followed through here. There is a `packages/shared` for exactly this.
- **C2 — `apps/api/src/domain/periods.ts:99** reads `return YEAR_RE.test(key) ? key : key;` — both
  branches identical, so the regex is evaluated and discarded. Harmless; looks like a lost branch.
- **C3 — `apps/web/src/utils/periods.ts` no longer holds a period utility.** One export,
  `useOwnerToday`, a React clock hook, in a module named for period maths and sitting beside
  `utils/periodKeys.ts` which holds the actual period maths. Fold it into `lib/weekClock.ts`.
- **C4 — `ZoomOnRoute` re-derives what `LensScreen` computed, and drops its fallback.** The Life branch
  of `LensScreen.tsx:58` (`?? clock.today`) is dead — `anchor` is read only inside the effect at `:59`,
  which is guarded by `lens !== 'Life'`. Opening the Zoom sheet from the Life lens on a cold start
  passes `anchor = null`; `useZoom` tolerates it (`queries.ts:124`) and the server picks, so nothing
  breaks — but `LensScreen.tsx:54-56` documents *"Life has no period, so it borrows the last one held"*,
  and the fallback that would make that true lives in the wrong component.
- **C5 — `AppShell` bypasses `routes.ts`.** `AppShell.tsx:54-57` hardcodes `/goal/:goalId`,
  `/task/:taskId`, `/backlog`, `/learnings` while `routes.ts:4` claims *"the URL shapes, in one
  module"*. Worse at `screens/TaskPage.tsx:341-343`, which hardcodes `/^\/week\/…$/` — that `/week/`
  is `LENS_SEGMENT.Weekly`. If the segment changes, this silently returns `null`, the page falls back
  to the task's origin week instead of the week you came from, and nothing catches it.
- **C6 — carry-chip logic written twice**, currently in agreement: `components/TaskRow.tsx:94-100`
  (`sev === 'chip' ? …`) vs `screens/TaskPage.tsx:213-219` (`age >= 2 ? …`). Same strings, same
  thresholds, two spellings. This is the one place R-task-43's signed-`carryWeeks` rule is enforced,
  and it is enforced twice. Extract `<CarryLabel task={t} />`.
- **C7 — `aria-label` on a `role=generic` div.** `cards.tsx:34` puts `aria-label` on a bare `<div>`;
  per ARIA-in-HTML it is not honoured, so the Monthly card's planned-ness line is **not** folded into
  the card's name — while the comment at `:206` says it is. Give the wrapper `role="group"`, or render
  the line inside the title button.
- **C8 — unconsumed test hooks.** `data-empty-state` (`LensScreen.tsx:270`) is read by nothing;
  `docs/work/18-finish-redesign/build.md:86` claims it is what makes the three empty states
  "checkable", but `tests/screens/lenses.test.tsx:396-450` asserts them by copy text instead. It also
  emits three values where `emptyCopy` distinguishes four states. Same for
  `data-testid="lens-card"` (`cards.tsx:34`) and six copies of `data-screen-label`.
- **C9 — `RATE_LIMITED` is documented as unreachable and still ships a recovery to agents.**
  `packages/shared/src/errors.ts:132-139` states plainly that no route emits it. Intentional and
  correctly documented; noted so the next reader does not re-derive it.
- **C10 — `capturedLabel` mixes clocks.** `apps/web/src/utils/dates.ts:56-63` takes the server instant
  via `nowMs()` then compares **device-local** calendar components, while `todayInZone` (`:66-73`)
  eight lines below renders in the owner's **stored** timezone. A traveller sees "Today" resolved one
  way in a backlog row and another way elsewhere. Undocumented divergence rather than a contradicted
  comment. *(Lower confidence — may be deliberate.)*
- **C11 — uncheck behaviour differs between the two surfaces.** `TaskRow.tsx:44-48` opens the R-task-21
  prompt on uncheck; `TaskPage.tsx:134-137` unchecks with no prompt. Plausibly intended (the task page
  has the done-condition field inline), but nothing says so, and R-task-21 is cited only on the row.
- **C12 — SPEC §6 ledger rows that no longer match their amended rules.** Beyond M3's `S-lens-11-1`,
  the reconciliation pass amended rules in place without always updating the §6 row or the matching
  `S-` scenario. Worth one sweep.
- **C13 — depth 5 holds by construction, not by a named guard.** Nothing enforces a depth constant
  (`git grep 'MAX_DEPTH|maxDepth'` is empty); the limit follows from the 5-member `HORIZONS` plus the
  strict-rank-decrease check. Sound but ungreppable.

---

## Verified clean

A negative result is a finding. These were checked and are genuinely tidy.

**Retired entities, fully removed.**

- **Ideas** — `git grep -i idea` over live source returns **zero** hits, in both apps and shared. Every
  remaining match is an applied migration (`0002_drop_ideas.sql`, snapshots), a finished build log, a
  test asserting absence (`tests/mcp/tools.test.ts:80-84`, `bootstrap.test.ts:90`,
  `lenses.test.tsx:130`), or a retirement comment. No table, service, route, MCP tool, query key,
  cache key, nav entry or fixture field.
- **`weekly_focus`** — no entity, table, repo, DI symbol, schema or wire field. Zero live hits for
  `weeklyFocus`, `focusId`, `savePlan`, `SavePlanRequest`, `PlanEntryView`, `PlanScreen`. Survives only
  in migration `0003_weekly_horizon.sql` (which drops it) and the migration test that rebuilds the
  pre-A2 state to prove the drop.
- **The plan endpoints** — no `/plan` in `ENDPOINTS`, no `planRoutes`, no `plan.service.ts`.
  `packages/shared/tests/contract.test.ts:306` asserts the route census carries no `/plan` path;
  `apps/web/tests/pwa/sw.test.ts:45` inverts the old service-worker assertion.
- **Filter pills** — no `taskGoalFilter` / `backlogGoalFilter`, no pill component or state.
- **Deleted screens** — no `TasksScreen`, `PlanScreen`, `InactiveBranchSheet`, recursive tree renderer
  or per-node collapse state. Task detail is a route (`routes.ts:39`), not a sheet.

**Retired vocabulary.** Every `leaf` / `isLeaf` / `isActive` / `dormant` / `subtreeActive` /
`can_hold_focus` match in live source sits inside a retirement comment; the only bare-word matches are
the English verb ("a task **leaves** a week"). Task ownership is
`if (goal.horizon !== 'Weekly') throw NOT_A_WEEKLY_GOAL`
(`apps/api/src/application/services/task.service.ts:499-508`) and is never leaf-ness.

**Error codes.** `NOT_A_LEAF`, `BRANCH_NOT_ACTIVE`, `WEEK_NOT_CURRENT` and `GOAL_HAS_OPEN_TASKS` are
gone from `ERROR_STATUS`; `contract.test.ts:76-79` inverts the assertion so re-introduction fails. Of
26 live codes, 23 have live throw sites; the exceptions are S14 (`NOT_IMPLEMENTED`), C9
(`RATE_LIMITED`) and `SIGNUP_NOT_ALLOWED`, thrown through Better Auth's envelope
(`better-auth.ts:109`) and not dead. `mcp/errors.ts` has no orphaned `RECOVERY` entries.
`lib/errorCopy.ts` covers every user-reachable code; the two it omits are handled elsewhere by design
(`AMBIGUOUS_CONVERSION_TARGET` renders a chooser in `BacklogSheets.tsx`; `INVALID_API_TOKEN` is
MCP-only).

**Rules, both halves.** 24 sampled superseded/retired rules, all CLEAN. The two highest-risk:

- `PLAN_AHEAD_WEEKS` exists nowhere and no constant acts as a forward bound. The old
  `if (offset > 0) throw` chokepoint is gone from `api/week.ts`. `WEEK_HISTORY_WEEKS` survives only
  renamed as `CARRY_BACKFILL_WEEKS` (`activity-log.ts:18`), documented as a write-batch fan-out limit,
  not a product rule. `UIContext.tsx:15-18` records that `selectWeek`'s `Math.min(0, …)` was deleted,
  not relaxed.
- The `.max(0)` swap landed on **both** sides: `WeekOffset` / `WeekOffsetParam`
  (`packages/shared/src/common.ts:70,73`) lost it and `CompleteTaskRequest.week`
  (`packages/shared/src/commands.ts:422`) gained it explicitly, with defence-in-depth at
  `task.service.ts:600-614`. This is the exact shape of a rule that ends up implemented zero times,
  and it did not.

**MCP runtime surface.** The instructions block, all ~40 tool descriptions, the four prompts and the
nine registered resources were read in full and are accurate to the new model. Every field the prompts
name exists: `weekly_breakdown` (`shapes.ts:162`), `planned_age_weeks` (`:160`), `pull_list`
(`tools/goals.ts:234`), `replan_options` (`:237`), `has_forward_content`, `backlog_is_aggregate`,
`completable`, `list_tasks(state="carrying")` (`tools/tasks.ts:35`). `get_goal`'s description says
outright *"there is no `is_leaf` field, on purpose"*. `WEEK_MODEL_MD` (`resources.ts:21-63`) was
correctly rewritten. No `goalcascade://` resource points at a deleted entity.

**`listAll`.** Deleted from `IGoalRepo`; no repository method returns every goal. The surviving
`ILearningRepo.listAll` is a different method and is live (S3/S4).

**Web routing, PWA, service worker.** Every `AppShell` route renders a real component; every
`routes.ts` export has a consumer; no screen is unrouted; `TabBar`'s three entries all resolve and
match BUSINESS-RULES' `Goals · + · Learnings`. `pwa/manifest.ts` has **no `shortcuts` key**, so no dead
shortcut targets. `READ_MODEL_PREFIXES` (`sw/handlers.ts:32`) names only `/api/goals`, `/api/tasks`,
`/api/backlog`, `/api/learnings` — no `/plan`, no `/ideas`. `public/_headers`, `vite.config.ts` and
`index.html` name no dead route. No `.css` files exist; all sixteen palette tokens have a consumer.

**Not dead, despite looking orphaned** — checked specifically: `apps/web/src/utils/tree.ts` (all three
exports used across six files), `apps/web/src/utils/periods.ts` (`useOwnerToday` → `lib/weekClock.ts`),
`Repeat last week` (fully wired and rendered at `LensScreen.tsx:434-454`), the `quote` style token
(`TaskPage.tsx:330`), `useCommand` (~25 call sites), `IAuthRateLimitRepo.consume` (dynamic dispatch),
`detectPlatform` (test-only). No component is unrendered; no source file is orphaned from the import
graph; every relative import in `apps/web/src` resolves.

**API route surface.** Every registered route is implemented — `error-handler.test.ts:73` asserts no
endpoint answers 501. No route exists for a deleted feature. The five lenses share one server path
(`GoalService.lens`) and one client path (`LensScreen` → `LensRow` → `Body` → `Group` → `Item`); there
is no near-duplicate Weekly screen, and per-horizon branching is confined to eight small, mostly
legitimate sites.

---

## Coverage — what this audit did not check

Stated plainly, because an audit that overstates its reach is worse than one with gaps.

- **Nothing was executed.** No test run, no build, no browser. All verdicts rest on reading source and
  on the stated green suite. The contrast figures in S18 were computed from the repo's own helper by
  hand, not by running the test.
- **Rules were sampled, not exhausted.** 24 of §6's 116 superseded/retired rules were checked end to
  end, biased toward runtime behaviour. The remaining ~92 are unchecked; the sample supports "no
  systematic double-implementation", not "none exists anywhere".
- **Unused dependencies were derived by grep**, not by `knip` or `depcheck` — neither is in
  `node_modules`, and adding one was out of scope. Dynamic or config-only usage could hide a false
  positive; S13's two are argued individually.
- **Visual residue was not checked by rendering.** Orphaned styles were found by grepping token and
  class names, which cannot see a rule that is applied but visually dead.
- **Accessibility findings (S15, S16, C7) were reasoned from the DOM, not measured** with a screen
  reader or axe.
- **Generated and vendored files were skipped**: `package-lock.json`, migration snapshot JSON,
  `worker-configuration.d.ts` (gitignored).
- **`docs/research/MCP-ON-WORKERS.md` and `UX-API-TOKEN.md`** were checked only for retired vocabulary
  (zero hits), not read for correctness. `docs/work/14-redesign/UX-PLAN.md` was consulted only where
  RECONCILIATION pointed at it.
- **No history was rewritten or verified** beyond confirming that migrations and build logs are the
  only places retired names survive.

---

## Fixes

Applied by a separate pass, as the header asks. Suite after: **559 api / 289 web / 43 shared** (floor was
549 / 283 / 43), typecheck clean, `npm run build -w @goal-cascade/web` emits `dist/sw.js` with its
13-entry precache manifest.

**26 fixed · 2 rebutted · 1 skipped**, of the 6 must-fix and 21 should-fix. Of the 11 *consider* items,
6 done and 7 skipped, listed at the end.

Every deletion under S6 / S9 / S11 / S12 / S13 was re-verified against dynamic references before it was
made — string keys, DI tokens, `export *` barrels, namespace imports, config files, and tests that read
source as text. **That check overturned two rows**, below.

### Must fix

| # | Verdict | What was done |
|---|---|---|
| M1 | **fixed** | `BUSINESS-RULES.md:26` — the picker clauses are gone: the two chevrons are the whole period control, the label opens the Zoom sheet, and forward content is a dot on the forward chevron (R-lens-26). |
| M2 | **fixed** | `BUSINESS-RULES.md:14` — the heading names the horizon, the period is a read-only chip from the current lens, and only the parent is chosen. Matches `GoalModals.tsx:27-32`. |
| M3 | **fixed** | `BUSINESS-RULES.md:30` — the real per-horizon copy is quoted. **Related, also fixed:** `SPEC.md` `S-lens-11-1` and the §6 `R-nav-5/17` ledger row both still asserted the pre-reconciliation badge; both are now amended in place with a `⚠` marker rather than silently rewritten. |
| — | — | **`apps/api/src/api/mcp/business-rules.ts` regenerated** from the amended document, same escaping, in the same commit. `tests/mcp/verbatim.test.ts` was run to confirm byte-equality before anything else was touched. |
| M4 | **fixed** | `MCP-TOOL-SURFACE.md` §§1–4 and 6–8 rewritten to the A2 surface against a full inventory of the live registry (37 tools, 9 resources, 4 prompts, 26 error codes). §5 is preserved **byte-for-byte** — the file was split around it and reassembled, and the pin re-run. The four plan/focus tools, `only="leaves"`, `list_goals`, `goalcascade://tree*`, `week_history_weeks` and the four deleted error codes are now tombstones with successors rather than specifications. `prompts.ts:5` no longer claims to be *"reproduced from §4"*: §4 is a design summary that says so, and `prompts.ts` is the text. |
| — | — | **The test that should have caught it.** See *"On not widening the pin"* below. |
| M5 | **fixed** | `LensScreen.tsx:95` — the guard is now `data !== undefined`, not `view !== undefined`. Two regression tests in `lenses.test.tsx`: one renders with a never-resolving `/api/goals` and asserts the create button is absent while the lens chrome is up; the other asserts the **Life** lens still offers it after the read, since `view` is legitimately `null` there and `''` is the right key (R-goal-3). Confirmed the first fails against the old guard before keeping the fix. |
| M6 | **fixed** | `TabBar.tsx:30` consumes `var(--safe-bottom, 0px)` on the fixed wrapper, so the bar's background still reaches the screen edge. `tests/pwa/manifest.test.ts` now asserts the consumer, not just the declaration — declaring a property for a named consumer that ignores it is what shipped. |

### Should fix

| # | Verdict | What was done |
|---|---|---|
| S1 | **fixed** | `showCarried = lens === 'Weekly' && data.carried.length > 0`, hoisted and used for both the band and the "this week" sentence below it. |
| S2 | **fixed** | Added `weekOfLabel` — `Week of 31 Aug`, the server's exact `PeriodView.label` shape — and used it for the task page's back button; the five embedded *"week of …"* sites take `shortDate`. `weekLabel`'s weekday form stays where BUSINESS-RULES pins it (`since Mon 24 Aug`) and its doc now forbids it after the words "week of". Six assertions that pinned `Week of Mon …` were corrected, citing **R-nav-24**; `routes.test.tsx` had held both spellings of one week 60 lines apart. |
| S3 | **fixed** | `GET /api/learnings` is capped. `LearningsQuery` (`?limit=`, ≤ `MAX_PAGE`), `LearningsResponse.nextCursor`, `ILearningRepo.listAll(userId, limit?)` with the limit in SQL under the existing order, and the same `limit + 1` probe `BacklogService.list` uses. The MCP tool and resource surface `next_cursor` like their three neighbours. Two API tests: the cap truncates newest-first and sets the cursor, and `?limit=201` is a 422. |
| S4 | **fixed** | `resources.ts:90` now says life goals are *one of the two* unscoped reads and the one an account never outgrows — true after S3, and it names the other. |
| S5 | **fixed** | `addWeeksTo` deleted; `goal.service.ts` imports `addWeeks` from `domain/weeks`, which it already imported from. |
| S6 | **fixed, 14 of 16** | Deleted: `validationFailed`, `SIGNUP_NOT_ALLOWED_STATUS`, `usePatchBacklogItem`, `hasLanding`, `OWNER_KEYS`, `subscribeServerClock`, `serverSkewMs` (with the now-dead notify branch in `recordServerNow`), `canPromptInstall`, `resetInstallPrompt`, `longerHorizons`, `pulseBadge`, `softL`/`softC`/`softInk`, the `PERIOD_UNIT` import-and-re-export in `LensScreen`. `ApiClient.patchBacklogItem` kept, as the finding asks. `AUTH_RATE_LIMIT_MAX_WINDOW_MS` kept — it is S10's cluster and is now wired (below). **Two rows rebutted; see below.** |
| S7 | **fixed** | `errorCopy.ts` imports `TASKS_LIVE_ON_WEEKLY_GOALS` instead of repeating the literal. |
| S8 | **fixed** | `warn` deleted with `pickerRow`'s `'dis'` arm (narrowed to `'ok' \| 'sel'`); `dot` lost `dim`; `hChip` lost `active`. All call sites updated. The `AgentAccess.tsx` comment that referred to `warn` now says why it is gone. |
| S9 | **fixed, with one kept** | Deleted `useInstallState`, `canPromptInstall`, `resetInstallPrompt`, `getSnapshot`, `subscribe`, the subscriber set, `InstallState`, and — contrary to the finding's *"keep `detectPlatform`"* — `detectPlatform` and `Platform` too: `tests/setup.ts` only **mentions** `detectPlatform` in a comment, so their sole reader was the deleted snapshot. **`promptInstall` is kept**, against the finding: it is the only reader of the captured event, and without it `captureInstallPrompt` files the event where nothing can reach it, which is worse than either extreme. |
| S10 | **fixed — decided: keep the seam, prove it, do not route it** | An internal route would be the same defect one level up: an admin endpoint nothing calls, on a single-user deployment with no operator and no cron. Instead `tests/ops-sweep.test.ts` resolves all three ports from the real container and exercises `purgeBefore` against real D1 — including boundary cases that prove the delete is scoped rather than a table wipe — and it is the first caller `AUTH_RATE_LIMIT_MAX_WINDOW_MS` has ever had. The decision is recorded on the method itself. |
| S11 | **fixed** | `IUserRepo.findByEmail` and `IGoalRepo.listLifeGoals` deleted with their D1 implementations. The `listAll` tombstone's replacement table had a `listLifeGoals` row; it now points at `listByLens`. |
| S12 | **fixed** | `tokens.ts`'s 15-symbol re-export deleted (`export { DB }` kept), and `ENV` deleted from both the token module and `container.ts`. |
| S13 | **fixed** | `@tanstack/query-sync-storage-persister` and `@cloudflare/workers-types` removed; `npm install` re-run and the full suite re-verified after. |
| S14 | **fixed** | Docstring rewritten: `NotImplementedError` is the fixture that proves the 501 envelope renders, which is the only way to test a status no route emits. `NOT_IMPLEMENTED` stays in `ERROR_STATUS` on separate, stated grounds. |
| S15 | **fixed** | One `CollapsibleHeader`, used by the group headers and the carried band. The band's missing `aria-label` is fixed by construction — it now reads *"Carried, N goals from earlier weeks. Collapse band."* instead of *"Carried, expanded"*. |
| S16 | **fixed** | The live region announces the **rendered** group count, filtered the same way `Body` filters. |
| S17 | **fixed by documenting** | Whether `why`, the backlog line, the stale-plan line and the empty-task line belong on a carried card is a product call, so the behaviour is unchanged and each omission now carries its reason. One of the four is not a judgement at all: the `Nothing on this yet.` line is **unreachable** there, because a goal is in the carried band only if it holds an open task visible in the week. |
| S18 | **fixed** | `faint` is **deleted**, not demoted. All six uses were text — the audit found four; `AgentAccess.tsx:289` and `auth/ui.tsx:148` are two more — and a token that may not carry text and carries nothing else has no job. All six moved to `T.mut`. `contrast.test.ts` now **derives** the list of text tokens from the palette instead of naming two, so a new one arrives already measured; `disabled` is the one exemption (WCAG 1.4.3) and is asserted to stay quieter than `mut` so "exempt" cannot drift into "used for live text". Mutation-checked: reinstating `faint` fails with the audit's own 1.91:1. |
| S19 | **fixed by amending the comment** | The Weekly copy is right — *"this far out"* is false about a week that is days away — so the invariant was what was wrong. It now states the property that actually holds (no future variant reads as a failure; no past or present variant offers that reassurance) and names Weekly as the deliberate rewording. |
| S20 | **fixed** | All twelve rows. `http.ts` no longer claims the tasks read is a lens input; `GoalDetailScreen` no longer promises a `+ Add` branch that was never written; `ThemeContext` and `business-rules.ts` now name the tests that exist (`tests/pwa/manifest.test.ts`, `tests/mcp/verbatim.test.ts`); `prompts.ts`, `resources.ts:70` and `verbatim.test.ts:18` corrected with M4; `ui.ts`'s `quote` comment fixed **without deleting the live token**; `updateToast.ts` and `auth/ui.tsx` keep their reasoning and lose the retired example. |
| S21 | **skipped** | See below. |

### Rebutted — the finding's evidence was wrong

Both are S6 rows, and both fail the table's own stated criterion (*"exactly one hit, its own declaration"*).

- **`useTasks` (`queries.ts:138`) — not dead by the criterion given.** It has a second hit:
  `tests/api/queries.test.tsx:4,21` imports and renders it, in the test that pins session-gated fetching
  and `['tasks', -1]` cache addressing. Deleting the export means deleting a passing test of real caching
  behaviour, for a route (`GET /tasks`) that is still live and still serves the MCP surface. The
  production consumer is genuinely gone and the row is right about *that* — so the code is left alone and
  the misleading comment above it was fixed instead (S20, row 1), which is where the actual harm was.
- **`TASKS_LIVE_ON_WEEKLY_GOALS` (`copy.ts:124`) — alive as of this pass.** S7 asks for exactly the
  import that makes it live, so it cannot also be deleted as dead. The two rows contradict each other;
  S7 is the correct one and was applied.

### Skipped

- **S21 — 3.5 GB of stale agent worktrees.** Not done, and not a judgement call: **this pass is executing
  inside `.claude/worktrees/`.** Other agents may hold live worktrees there, and deleting another agent's
  working tree is destructive and irreversible. The directory is gitignored, so no commit can fix it
  either. It is an operator action — `git worktree prune` plus `rm -rf` on the stale copies, from the
  shared checkout, when no agent is running. The hazard the finding describes is real and stands.

### Consider — 6 done, 7 skipped

**Done:**

- **C2** — `return YEAR_RE.test(key) ? key : key` is now `return key`, with a note that this function
  renders what it is given rather than validating it. Both branches were identical.
- **C5, the half that is a latent bug** — `TaskPage`'s `/^\/week\/…$/` now builds its pattern from
  `LENS_SEGMENT.Weekly`. A segment rename would have made it return `null` **silently**, sending the back
  button to the task's origin week instead of the week you came from. `AppShell`'s hardcoded paths are
  left alone — that is C5's other half and a router refactor.
- **C6** — one `<CarryLabel>`, used by `TaskRow` and `TaskPage`. This is the only place R-task-43's signed
  age becomes something a person sees, and it was enforced in two spellings.
- **C7** — `CardShell` takes `role="group"` when it has a label. On a bare `<div>` the implicit role is
  `generic` and ARIA-in-HTML does not honour a name on it, so the Monthly card's planned-ness line was not
  in the card's accessible name while a comment said it was.
- **C11** — the two uncheck surfaces differ deliberately; only one said so. `TaskPage` now records that
  R-task-21's prompt is absent because the `cond` field is inline three lines below, and a sheet offering
  an edit you can see behind it is the modal the redesign removed.
- **C12** — done only for the two rows M3 named (`S-lens-11-1`, the `R-nav-5/17` ledger row). The full §6
  sweep is skipped, below.

**Skipped, with the reason:**

- **C1** — shared period maths across the API/web boundary. A `packages/shared` extraction of three
  regex sets and two functions is the structural refactor this pass was told not to undertake under a
  *consider* heading. Nothing has diverged; the argument for doing it is real and it wants its own change.
- **C3** — folding `useOwnerToday` into `lib/weekClock.ts` is a module move with no behavioural content;
  same reason as C1, and lower value.
- **C4** — `ZoomOnRoute`'s missing fallback. The finding says outright that nothing breaks (the server
  picks), and moving the fallback between components is a behavioural change to zoom-anchor lifecycle that
  wants its own test pass.
- **C5, the `AppShell` half** — routing every hardcoded path through `routes.ts` is a refactor of the
  route table; the silently-failing half was fixed instead.
- **C8** — unconsumed test hooks. `docs/work/18-finish-redesign/build.md` claims `data-empty-state` is
  what makes the empty states checkable; removing it means deciding whether to re-point that claim or
  rewrite three tests to use it. Neither is cheap, and nothing is wrong today.
- **C10** — `capturedLabel` mixing the server instant with device-local calendar components. The finding
  flags its own low confidence and says it may be deliberate; picking a clock here changes what "Today"
  means for a travelling user, which is a product decision, not a cleanup.
- **C13** — depth 5 holding by construction. Adding a `MAX_DEPTH` constant that nothing enforces would be
  a second, weaker statement of a rule the 5-member `HORIZONS` plus the strict-rank-decrease check already
  makes unbreakable. Ungreppable is a real cost; a decorative constant is not the fix.

### On not widening the pin — M4's second half

`verbatim.test.ts:20` split on §5 and pinned only the fence inside it, so §§1–4 and 6–8 rotted for a
release while the pin stayed green. The finding is right that this is worse than no pin.

**Widening the byte-pin to the whole file would not have caught it, and would be the wrong instrument.**
§5 is pinnable because `SERVER_INSTRUCTIONS` is a literal copy of it — there is a second string to
compare against. Nothing in `src` is a copy of the rest of the document, so a whole-file pin could only
compare the file to itself: it would assert that the document had not changed, fail on every legitimate
edit, and still say nothing about whether the document is *true*.

So the whole file is guarded by a different instrument, `apps/api/tests/mcp/surface.test.ts`, which
checks the property that actually matters — **the document does not specify things the server does not
have** — over every block of the file:

1. Every tool the document gives a heading to is advertised by the live server.
2. Every `goalcascade://` URI in the §3 table is registered.
3. Every error code §6 teaches a recovery for exists in `ERROR_STATUS`.
4. §4 names exactly the four prompts the server registers.
5. Every retired name — the four plan tools, `list_goals`, `NOT_A_LEAF`, `BRANCH_NOT_ACTIVE`,
   `WEEK_NOT_CURRENT`, `GOAL_HAS_OPEN_TASKS`, `is_leaf`, `active_leaves`, `goalcascade://tree` and the
   rest — appears **only** in a markdown block that also marks it as gone. A tombstone is allowed; a
   fresh sentence specifying one as current is not.

Each check carries a floor assertion (`documented.length > 25`, `codes.length > 12`, …) so a restructured
document fails loudly instead of passing by matching nothing. Verified by mutation: renaming a live tool
heading to `set_goal_focus` fails checks 1 and 5 independently. `verbatim.test.ts` keeps its §5 pin and
now states in the test itself that it covers §5 and only §5, and why.
