-- A1 — manual backlog order: `backlog_items.sort_key` (R-backlog-17 … R-backlog-24).
--
-- Statements 1 and 3 are drizzle-kit's (`meta/0004_snapshot.json` is its regenerated snapshot and must
-- never be hand-edited). Statement 2 is hand-written, because drizzle-kit emits schema and this migration
-- also has to give every EXISTING row a position — the column is useless without one.
--
-- ORDER IS THE CONTRACT, and it is not the order drizzle-kit emitted:
--   1. add `sort_key`   — defaulted to '' so the ALTER needs no table rewrite
--   2. backfill         — today's order, made explicit, with room left above the first item
--   3. create the index — AFTER the bulk UPDATE, so it is built once rather than maintained through it
--
-- FORWARD-ONLY, but non-destructive: nothing is dropped, no row is deleted, no id changes, and no order
-- changes. A rollback is `DROP INDEX` + `ALTER TABLE … DROP COLUMN`, and the product would simply fall
-- back to `captured_at` desc — which is exactly what the backfill reproduces.
--
-- IDEMPOTENT. Statement 2's `WHERE sort_key = ''` makes a second run a no-op (wrangler's journal normally
-- prevents one; the guard means it does not have to be the only thing that does).

--> statement-breakpoint
-- 1 ────────────────────────────────────────────────────────────────────────────────────────────────
-- R-backlog-17. TEXT and not INTEGER: the key is opaque, lexicographically ordered and mid-pointed, so
-- an insert between two neighbours writes ONE row instead of renumbering the list.
ALTER TABLE `backlog_items` ADD `sort_key` text DEFAULT '' NOT NULL;--> statement-breakpoint

-- 2 ────────────────────────────────────────────────────────────────────────────────────────────────
-- **The backfill, and why it cannot be skipped.**
--
-- Leaving every row on `''` would tie every key in every goal, and the order would fall through to
-- `captured_at` desc — which happens to be exactly today's arrangement, so it would look fine. It is not:
-- there would be no key space *above* the first item, so R-backlog-18's "a new capture lands on top"
-- could not mint a key without re-keying the whole list on the very first capture after deploy.
--
-- Rank within `(user_id, goal_id)` is computed as a correlated COUNT of the rows that sort BEFORE this
-- one under R-backlog-5's order (`captured_at` desc, `id` desc) — deliberately not `ROW_NUMBER() OVER (…)`
-- and not `UPDATE … FROM`: both need a SQLite newer than the oldest D1 build this has to survive, and a
-- correlated subquery needs nothing. Backlogs are small and this runs once.
--
--   rank 0 (the newest item) → 000001000000
--   rank 1                   → 000002000000
--
-- Twelve fixed digits make lexicographic order equal numeric order (which is the whole scheme —
-- `domain/sort-keys.ts`), the 1,000,000 gap leaves ~20 mid-point splits between any two neighbours before
-- a re-key is needed, and starting AT 1,000,000 rather than 0 leaves a full million of space above the
-- first item so the next capture lands on top with no re-key at all.
--
-- CONVERTED rows are backfilled too. They participate in no order (R-backlog-20), but a converted row
-- with an empty key would collide with every future one, and "every row has a key" is a cheaper invariant
-- to hold than "every row that is still open has a key".
UPDATE `backlog_items`
   SET `sort_key` = printf('%012d',
         (SELECT COUNT(*) FROM `backlog_items` b2
           WHERE b2.`user_id` = `backlog_items`.`user_id`
             AND b2.`goal_id` = `backlog_items`.`goal_id`
             AND (b2.`captured_at` > `backlog_items`.`captured_at`
                  OR (b2.`captured_at` = `backlog_items`.`captured_at` AND b2.`id` > `backlog_items`.`id`))
         ) * 1000000 + 1000000)
 WHERE `sort_key` = '';--> statement-breakpoint

-- 3 ────────────────────────────────────────────────────────────────────────────────────────────────
-- R-backlog-17/21 — the WITHIN-GOAL order, with no filesort. `ix_backlog_owner` stays: it still serves
-- every CROSS-goal list, which keeps `captured_at` desc and gains no manual order (R-backlog-21).
--
-- NOT UNIQUE, on purpose. R-backlog-17 makes the order total with `captured_at` desc / `id` desc as
-- tie-breaks precisely so a collision resolves instead of failing a write; a unique index here would turn
-- two captures in the same millisecond into one lost capture.
CREATE INDEX `ix_backlog_goal_sort` ON `backlog_items` (`user_id`,`goal_id`,`status`,`sort_key`,`id`);
