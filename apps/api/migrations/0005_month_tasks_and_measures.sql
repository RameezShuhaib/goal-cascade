-- A8 — tasks at the month, and tasks that carry a number (R-task-51 … R-task-59, R-measure-1 … R-measure-9).
--
-- `meta/0005_snapshot.json` is the matching drizzle snapshot; `npm run db:generate` reports
-- "No schema changes" against it, which is the proof that this file and `schema.ts` agree.
--
-- ORDER IS THE CONTRACT:
--   1. rename the four period columns      — every stored value is a Monday and NONE of them changes
--   2. add `scope`, backfilled by DEFAULT   — no data statement, because there is nothing to guess
--   3. add the five measure columns         — all nullable; NULL kind means "no measure" (R-measure-1)
--   4. re-index tasks on (status, scope, key)
--   5. CREATE TABLE task_readings + its index
--
-- ── THIS MIGRATION TRANSFORMS NO DATA, AND THAT IS THE POINT ─────────────────────────────────────
--
-- 0003 had one `UPDATE … CASE … ELSE ''` whose replay WIPED the `period_key` of every Weekly goal it had
-- just minted — a bug that only exists because a migration read a value and wrote an interpretation of it.
-- **There is not one `UPDATE` or `INSERT` in this file.** Nothing is read, nothing is parsed, nothing is
-- guessed, and no value in the database changes: a rename moves a name, `DEFAULT 'Weekly'` fills a new
-- column with a constant that is true of every existing row (every task that exists hangs off a Weekly
-- goal — R-goal-39, the rule A8 supersedes), and the five measure columns are born NULL, which is exactly
-- "this task is an ordinary checkbox". The replay-wipe class of defect has no surface here.
--
-- FORWARD-ONLY. Reversible up to the column names: nothing is dropped, no row is deleted, no id changes.
--
-- ── REPLAY SAFETY, stated exactly ───────────────────────────────────────────────────────────────
--
-- Statements 4 and 5 carry `IF EXISTS` / `IF NOT EXISTS` and are individually re-runnable.
--
-- Statements 1–3 are `ALTER TABLE … RENAME COLUMN` and `ADD COLUMN`, and **SQLite has no conditional form
-- of either** — there is no `ADD COLUMN IF NOT EXISTS` and no `RENAME COLUMN IF EXISTS` to write. Their
-- replay safety is wrangler's migration journal, which is the mechanism that actually runs in production:
-- `wrangler d1 migrations apply` reads `d1_migrations`, applies only what is unapplied, and a second
-- invocation is a no-op with an identical end state. That is proven twice over —
-- `tests/migration/month-tasks-and-measures.test.ts` runs the replayable statements twice and asserts the
-- end state is unchanged, and the double-apply against a scratch D1 is recorded in
-- `docs/work/31-measurables-api/build.md`.
--
-- SQLite updates every index, trigger and view that references a renamed column, so statement 4's DROPs
-- are dropping indexes that already point at the new names; they are recreated with `scope` in them,
-- which is the change that makes them selective (R-task-52).

--> statement-breakpoint
-- 1 ────────────────────────────────────────────────────────────────────────────────────────────────
-- R-task-52 — one column, two scopes, the key's FORMAT is the discriminator. `2026-09-07` is a week and
-- `2026-09` is a month, exactly as R-goal-33 already requires of every goal. Every existing value is a
-- Monday and stays one; only the name and the format's domain widen.
ALTER TABLE `tasks` RENAME COLUMN `origin_week_start` TO `origin_period_key`;--> statement-breakpoint
ALTER TABLE `tasks` RENAME COLUMN `done_week_start` TO `done_period_key`;--> statement-breakpoint

-- R-task-53 — a month task carries between months and earns the same `Carried to …` line at the month
-- scale, so the lazy producer's uniqueness key widens with it. The two scopes cannot collide: a month key
-- and a Monday are never the same string.
ALTER TABLE `task_events` RENAME COLUMN `week_start` TO `period_key`;--> statement-breakpoint

-- R-task-59 — a month task's Move-to-Backlog records the MONTH it was live in, which renders
-- `from Sep 2026` rather than `from week of …`. It is provenance on a row that has no period of its own
-- (R-backlog-30): nothing filters, sorts, ages or lenses on this column, and A8 does not start.
ALTER TABLE `backlog_items` RENAME COLUMN `from_week_start` TO `from_period_key`;--> statement-breakpoint

-- 2 ────────────────────────────────────────────────────────────────────────────────────────────────
-- R-task-52. **`DEFAULT 'Weekly'` IS the backfill** — SQLite writes it into every existing row as part of
-- the ALTER, and it is true of every one of them without anything being read: before A8 only a Weekly goal
-- could hold a task (R-goal-39). This is the difference between this migration and 0003's: there is no
-- interpretation to replay and therefore nothing a replay could wipe.
ALTER TABLE `tasks` ADD `scope` text DEFAULT 'Weekly' NOT NULL;--> statement-breakpoint

-- 3 ────────────────────────────────────────────────────────────────────────────────────────────────
-- R-measure-1 — five columns, all nullable, ALL-OR-NOTHING: `measure_kind IS NULL` ⇔ all five are null,
-- and that is what "this task is an ordinary checkbox" is written as. There is no `binary` kind and no
-- half-measure. The invariant is an APPLICATION one with one test, because this schema carries no SQL
-- `CHECK` (only `_guard`) — exactly as the Weekly-only rule it replaces did not.
--
-- REAL and not INTEGER: `78.5 kg` is the owner's own example.
-- `measure_current` is DERIVED (R-measure-3) and maintained in the same transaction as every reading
-- write and delete; it is denormalised here so a lens row renders `12 / 15 leads` with no subquery.
ALTER TABLE `tasks` ADD `measure_kind` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `measure_start` real;--> statement-breakpoint
ALTER TABLE `tasks` ADD `measure_current` real;--> statement-breakpoint
ALTER TABLE `tasks` ADD `measure_target` real;--> statement-breakpoint
ALTER TABLE `tasks` ADD `measure_unit` text;--> statement-breakpoint

-- 4 ────────────────────────────────────────────────────────────────────────────────────────────────
-- R-task-52 — **`scope` between `status` and the key is the whole reason the column exists.** A week read
-- and a month read must not scan each other's rows, and no index can key on the length of a string: without
-- it, `origin_period_key <= '2026-09-07'` would sweep every month key from `1000-01` upward on the way.
DROP INDEX IF EXISTS `ix_tasks_open_week`;--> statement-breakpoint
DROP INDEX IF EXISTS `ix_tasks_done_week`;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ix_tasks_open_period` ON `tasks` (`user_id`,`status`,`scope`,`origin_period_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ix_tasks_done_period` ON `tasks` (`user_id`,`status`,`scope`,`done_period_key`);--> statement-breakpoint

-- 5 ────────────────────────────────────────────────────────────────────────────────────────────────
-- R-measure-5 — **NO week, month, period or scope column, ever.** A reading is keyed by `task_id` and by
-- nothing else, so it survives carrying, parking, un-parking, re-parenting, completion and unchecking. A
-- history that reset at any boundary would be worthless, which is the whole reason the feature exists.
--
-- `task_id` carries no FK, matching `task_links` and `task_events`; deletion is by the same Q-5
-- subtree-cascade batch. `(user, task, at, id)` is the sparkline's own order, and the `id` tail is what
-- makes "the latest surviving reading" total when two land in the same millisecond.
CREATE TABLE IF NOT EXISTS `task_readings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`task_id` text NOT NULL,
	`value` real NOT NULL,
	`at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ix_task_readings_task` ON `task_readings` (`user_id`,`task_id`,`at`,`id`);
