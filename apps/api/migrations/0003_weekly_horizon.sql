-- A2 — the Weekly horizon, canonical periods, and the end of weekly_focus.
--
-- The three DDL statements are drizzle-kit's (0003_snapshot.json is its regenerated snapshot and must
-- never be hand-edited). The DATA statements between them are hand-written, because drizzle-kit emits
-- schema and this migration also has to keep the owner's existing work legal.
--
-- ORDER IS THE CONTRACT here, and it is not the order drizzle-kit emitted:
--   1. add `period_key`            — the column every lens filters on (R-goal-33)
--   2. backfill `period_key`       — parsed from the free-text label, else guessed from `created_at`
--   3. re-render `period`          — it is now [srv], the derived LABEL of `period_key`
--   4. mint one Weekly goal per (goal, origin_week_start)  — reads `weekly_focus`, so it MUST precede 7
--   5. re-point every task at it   — every existing task is illegal until this runs (R-goal-39)
--   6. create `ix_goals_lens`      — after the bulk insert, so it is built once rather than maintained
--   7. drop `weekly_focus`         — last, and destructively
--
-- FORWARD-ONLY. Step 7 drops a table; there is no rollback that restores its rows.
--
-- IDEMPOTENT. Step 4's `NOT EXISTS` and step 5's `EXISTS` guards make a second run a no-op, so the
-- migration is safe to re-apply against a database that has already had it (wrangler's journal normally
-- prevents that; the guards mean it does not have to be the only thing that does).

--> statement-breakpoint
-- 1 ────────────────────────────────────────────────────────────────────────────────────────────────
-- R-goal-33. `horizon` needs no DDL at all: Drizzle's `enum` is TypeScript-only and SQLite stores the
-- column as TEXT with no CHECK, so adding 'Weekly' is a code change, not a schema one.
ALTER TABLE `goals` ADD `period_key` text DEFAULT '' NOT NULL;--> statement-breakpoint

-- 2 ────────────────────────────────────────────────────────────────────────────────────────────────
-- Backfill `period_key` by parsing the existing free-text `period` with the SAME grammar the app itself
-- emitted (`2026`, `Q4 2026`, `Sep 2026`). Anything unparseable or empty falls back to the period
-- CONTAINING the goal's `created_at`.
--
-- The fallback is a GUESS, and it is deliberate: it puts the goal in a lens where its owner will find it,
-- which beats leaving it unreachable (spec-delta §4 Q-1). Two honest caveats:
--   * it reads `created_at` in UTC, because SQL has no access to the owner's timezone — off by at most
--     one day, and only for a goal created within hours of a period boundary whose label was already
--     unparseable;
--   * `period` was owner-typed free text, so a label like `H2` or `before the move` is lost. It was read
--     by nothing, and a lens cannot be built on a value the product cannot compare (R-goal-33).
-- The count of guessed rows is recoverable afterwards — see docs/work/16-lens-api/build.md.
--
-- ⚠ The `Weekly` branch PRESERVES the key rather than re-deriving it, and it is what makes this
-- statement re-runnable. A Weekly key IS a Monday date (R-goal-33) — there is no free-text label to
-- parse — and no goal at that horizon exists before step 4 anyway. Without the branch, a replay would
-- fall through to the `ELSE ''` and WIPE the key of every goal step 4 had just minted, which is exactly
-- the failure `tests/migration/weekly-horizon.test.ts`'s idempotency case caught.
UPDATE `goals` SET `period_key` = CASE `horizon`
    WHEN 'Life' THEN ''
    WHEN 'Weekly' THEN `period_key`
    WHEN 'Yearly' THEN
      CASE WHEN `period` GLOB '[0-9][0-9][0-9][0-9]' THEN `period`
           ELSE substr(`created_at`, 1, 4) END
    WHEN 'Quarterly' THEN
      CASE WHEN `period` GLOB 'Q[1-4] [0-9][0-9][0-9][0-9]'
           THEN substr(`period`, 4, 4) || '-Q' || substr(`period`, 2, 1)
           ELSE substr(`created_at`, 1, 4) || '-Q'
                || CAST((CAST(substr(`created_at`, 6, 2) AS INTEGER) + 2) / 3 AS TEXT) END
    WHEN 'Monthly' THEN
      CASE WHEN `period` GLOB '[A-Z][a-z][a-z] [0-9][0-9][0-9][0-9]'
                AND instr('JanFebMarAprMayJunJulAugSepOctNovDec', substr(`period`, 1, 3)) % 3 = 1
           THEN substr(`period`, 5, 4) || '-'
                || substr('0' || CAST((instr('JanFebMarAprMayJunJulAugSepOctNovDec', substr(`period`, 1, 3)) + 2) / 3 AS TEXT), -2, 2)
           ELSE substr(`created_at`, 1, 7) END
    ELSE '' END;--> statement-breakpoint

-- 3 ────────────────────────────────────────────────────────────────────────────────────────────────
-- R-goal-33 — `period` stops being owner-typed and becomes the rendered label of `period_key`. Rewriting
-- it here is what makes S-goal-33-3 true of the EXISTING rows as well as of new ones: after this, no goal
-- in the account has a `period` that is not the rendering of its own key.
UPDATE `goals` SET `period` = CASE `horizon`
    WHEN 'Life' THEN ''
    WHEN 'Yearly' THEN `period_key`
    WHEN 'Quarterly' THEN 'Q' || substr(`period_key`, 7, 1) || ' ' || substr(`period_key`, 1, 4)
    WHEN 'Monthly' THEN
      substr('JanFebMarAprMayJunJulAugSepOctNovDec', (CAST(substr(`period_key`, 6, 2) AS INTEGER) - 1) * 3 + 1, 3)
      || ' ' || substr(`period_key`, 1, 4)
    WHEN 'Weekly' THEN
      'Week of ' || CAST(CAST(substr(`period_key`, 9, 2) AS INTEGER) AS TEXT) || ' '
      || substr('JanFebMarAprMayJunJulAugSepOctNovDec', (CAST(substr(`period_key`, 6, 2) AS INTEGER) - 1) * 3 + 1, 3)
    ELSE '' END;--> statement-breakpoint

-- 4 ────────────────────────────────────────────────────────────────────────────────────────────────
-- **The migration's one real data problem** (spec-delta §4 Q-3, RECONCILIATION Q-A).
--
-- Under R-goal-39 only a goal with `horizon = 'Weekly'` may hold a task, so on the morning this runs
-- EVERY task in the account points at an illegal parent: today's tasks hang off non-Life leaves, which
-- are exactly the childless Monthly goals R-goal-37 warns must never hold work.
--
-- Option A of three, and the only one that leaves ONE shape in the database: mint one Weekly goal per
-- distinct `(goal_id, origin_week_start)` and re-point. Every task keeps its week, its carry age, its
-- activity and its place in the Weekly lens, and old weeks render their work under a named intention.
-- (B — re-point only open tasks — makes the illegal state permanent and load-bearing; C — delete or
-- orphan them — destroys the owner's history.)
--
-- **The title the owner will see, in past weeks, forever:**
--   1. that `(goal, week)`'s `weekly_focus` sentence when one exists. This is the ONLY place in the whole
--      migration a focus row is read, and it does not contradict dropping the table: the sentence is read
--      to keep *work* legal, not to reconstruct a plan. The owner wrote it about that week's work; it is
--      the truest available title and it is in their own words.
--   2. otherwise the parent goal's own title. Slightly redundant, always recognisable, renamable.
-- NOT `Week of 24 Aug` (the lens already says that), not `Migrated` or `Imported` (a machine word in the
-- owner's own plan), and not the first task's title (that confuses a step with the intent behind it).
--
-- **These goals are written into PAST weeks, which R-goal-36 forbids the PRODUCT from doing** — the rule
-- exists so planning cannot rewrite history, and re-homing work that already happened is not planning.
-- No route, service or MCP tool may ever perform this write. It exists here and nowhere else.
--
-- `created_at` is the week's own Monday rather than "now", so a minted goal sorts into its week's lens
-- where it belongs (Q-7) instead of all of them landing at the migration instant.
--
-- The id is 26 uppercase hex characters. Every one of them is inside Crockford's ULID alphabet
-- (`[0-9A-HJKMNP-TV-Z]`), so these ids satisfy the wire's `Ulid` schema; they are not time-sortable, and
-- nothing in the product requires them to be — ordering is `created_at` then `id` (Q-7).
INSERT INTO `goals` (`id`, `user_id`, `parent_id`, `horizon`, `title`, `why`, `pulse`, `period_key`, `period`, `created_at`, `updated_at`, `version`)
SELECT
  upper(hex(randomblob(13))),
  t.`user_id`,
  t.`goal_id`,
  'Weekly',
  COALESCE(
    NULLIF(TRIM((SELECT wf.`sentence` FROM `weekly_focus` wf
                  WHERE wf.`user_id` = t.`user_id` AND wf.`goal_id` = t.`goal_id`
                    AND wf.`week_start` = t.`origin_week_start`
                  ORDER BY wf.`id` LIMIT 1)), ''),
    g.`title`),
  '',
  'On track',
  t.`origin_week_start`,
  'Week of ' || CAST(CAST(substr(t.`origin_week_start`, 9, 2) AS INTEGER) AS TEXT) || ' '
    || substr('JanFebMarAprMayJunJulAugSepOctNovDec', (CAST(substr(t.`origin_week_start`, 6, 2) AS INTEGER) - 1) * 3 + 1, 3),
  t.`origin_week_start` || 'T00:00:00.000Z',
  t.`origin_week_start` || 'T00:00:00.000Z',
  1
FROM (SELECT DISTINCT `user_id`, `goal_id`, `origin_week_start` FROM `tasks`) t
JOIN `goals` g ON g.`id` = t.`goal_id` AND g.`user_id` = t.`user_id`
WHERE g.`horizon` <> 'Weekly'
  AND NOT EXISTS (
    SELECT 1 FROM `goals` w
     WHERE w.`user_id` = t.`user_id` AND w.`parent_id` = t.`goal_id`
       AND w.`horizon` = 'Weekly' AND w.`period_key` = t.`origin_week_start`);--> statement-breakpoint

-- 5 ────────────────────────────────────────────────────────────────────────────────────────────────
-- Re-point every task at the Weekly goal minted for its own `(goal, origin_week_start)`.
--
-- DONE and EXITED tasks are re-pointed the same way as open ones, deliberately: leaving them on a
-- non-Weekly parent as inert history would make every query that touches the past special-case a task
-- whose parent is not Weekly, forever (option B). One shape in the database.
--
-- `origin_week_start` is NOT touched. It is the task's own stored week (R-task-40) and it is already
-- correct; the goal is being fitted to the task, not the other way round.
--
-- The double `EXISTS` is the idempotency guard: on a second run every task already points at a Weekly
-- goal, so the first predicate is false and no row is updated.
UPDATE `tasks` SET `goal_id` = (
    SELECT w.`id` FROM `goals` w
     WHERE w.`user_id` = `tasks`.`user_id` AND w.`parent_id` = `tasks`.`goal_id`
       AND w.`horizon` = 'Weekly' AND w.`period_key` = `tasks`.`origin_week_start`
     ORDER BY w.`id` LIMIT 1)
WHERE EXISTS (SELECT 1 FROM `goals` g
               WHERE g.`id` = `tasks`.`goal_id` AND g.`user_id` = `tasks`.`user_id`
                 AND g.`horizon` <> 'Weekly')
  AND EXISTS (SELECT 1 FROM `goals` w
               WHERE w.`user_id` = `tasks`.`user_id` AND w.`parent_id` = `tasks`.`goal_id`
                 AND w.`horizon` = 'Weekly' AND w.`period_key` = `tasks`.`origin_week_start`);--> statement-breakpoint

-- 6 ────────────────────────────────────────────────────────────────────────────────────────────────
-- R-lens-27 — the index the whole read strategy turns on. Confirmed absent before this migration.
-- `period_key` before `created_at` is what makes every lens read's ordering free.
CREATE INDEX `ix_goals_lens` ON `goals` (`user_id`,`horizon`,`period_key`,`created_at`,`id`);--> statement-breakpoint

-- 7 ────────────────────────────────────────────────────────────────────────────────────────────────
-- R-rm-2 — deleted outright, taking `ux_weekly_focus_goal_week` and `ix_weekly_focus_week` with it.
-- Rows are NOT converted into Weekly goals: that would manufacture history — goals claiming to have
-- existed in past weeks, which R-lens-10 forbids on principle. Past weeks lose their focus sentences and
-- render their tasks. **This is the one decision in the redesign that cannot be undone.**
DROP TABLE `weekly_focus`;
