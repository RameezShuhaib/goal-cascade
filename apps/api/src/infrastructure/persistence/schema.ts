import { relations, sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import {
  BACKLOG_STATUSES,
  HORIZONS,
  PULSES,
  TASK_EVENT_KINDS,
  TASK_STATUSES,
  THEMES,
} from '../../domain/enums';

// ─────────────────────────────────────────────────────────────────────────────
// Better Auth tables — the output of `npx auth generate` for the Drizzle sqlite
// adapter, unchanged. We add no columns; per-user app data lives in its own tables.
// ─────────────────────────────────────────────────────────────────────────────
const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).default(false).notNull(),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).default(nowMs).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(nowMs)
    .$onUpdate(() => new Date())
    .notNull(),
});

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).default(nowMs).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_userId_idx').on(t.userId)],
);

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    issuer: text('issuer').notNull(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).default(nowMs).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [uniqueIndex('account_issuer_accountId_uidx').on(t.issuer, t.accountId), index('account_userId_idx').on(t.userId)],
);

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).default(nowMs).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

export const userRelations = relations(user, ({ many }) => ({ sessions: many(session), accounts: many(account) }));
export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));
export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Product tables.
//
// EVERY row carries `user_id` (SPEC's `ownerId`, R-auth-2) and every index leads
// with it, so an owner-scoped read is always an index seek and a query that forgets
// the scope cannot accidentally use a useful index either.
//
// EVERY week is `TEXT` holding the ISO date of that week's MONDAY (SPEC D-1). Never
// an offset: an offset means something different every Monday, with no write. The
// columns are named `*_week_start` so a relative value cannot be slipped in unnoticed.
// ─────────────────────────────────────────────────────────────────────────────

/** R-auth-6 / R-nav-12 — the only row provisioned at sign-up. A new account's tree is EMPTY. */
export const preferences = sqliteTable('preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  theme: text('theme', { enum: THEMES }).notNull().default('system'),
  /** R-auth-5 — authoritative for every week boundary in the product. */
  timezone: text('timezone').notNull().default('UTC'),
  updatedAt: text('updated_at').notNull(),
});

/**
 * R-goal-1 — the goal tree as an ADJACENCY LIST. No materialised path, no closure table.
 *
 * ⚠ **A2 (R-lens-27)** — the old comment here said the tree is "at most 500 nodes and 4 levels deep, so
 * `domain/goal-tree.ts` derives every relationship in memory from one `listAll`". That premise was
 * measured and found false, and `listAll` is now DELETED. Reads are period-scoped (`ix_goals_lens`), the
 * walk that remains reads only the INTERIOR tree, and the guards read one row or one recursive-CTE
 * subtree.
 *
 * `parent_id` has no FK to itself on purpose: D1 applies FKs per statement, and the subtree cascade
 * (Q-5) deletes parents and children in one batched DELETE. Referential integrity is held by the
 * cascade being transactional (`GuardedBatch`), not by the row order inside it.
 */
export const goals = sqliteTable(
  'goals',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    parentId: text('parent_id'),
    /**
     * ⚠ **A2 (R-goal-30)** — five members now. Drizzle's `enum` is TypeScript-only: SQLite stores it as
     * TEXT with no CHECK constraint, so adding `'Weekly'` needs **no DDL** (verified against the
     * generated snapshot). The migration therefore adds a column and an index and drops a table, and
     * touches this column not at all.
     */
    horizon: text('horizon', { enum: HORIZONS }).notNull(),
    title: text('title').notNull(),
    why: text('why').notNull().default(''),
    pulse: text('pulse', { enum: PULSES }).notNull().default('On track'),
    /**
     * ⚠ **A2, new (R-goal-33)** — the canonical period key every lens filters on:
     * `2026` / `2026-Q3` / `2026-09` / a Monday `2026-09-07`, and `''` for a Life goal.
     *
     * It replaces free-text `period` as the identity of a period, because a lens must PARTITION a
     * horizon's goals and free text partitions nothing. Its lexicographic order is chronological, which
     * is what makes R-goal-47's `BETWEEN` range read and R-lens-26's `>` probe index seeks rather than
     * scans.
     */
    periodKey: text('period_key').notNull().default(''),
    /** ⚠ **A2 (R-goal-33)** — now the derived LABEL of `period_key`. `''` for a Life goal. */
    period: text('period').notNull().default(''),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    /** Q-2 — optimistic concurrency. Bumped by every guarded update. */
    version: integer('version').notNull().default(1),
  },
  (t) => [
    // Q-7 — the stable sibling order (`created_at`, then `id`) is served straight off this index. It
    // still serves the interior walk's `parent_id` lookups; it CANNOT serve a lens read, because
    // `parent_id` sits between the equality column and the sort keys.
    index('ix_goals_owner_parent').on(t.userId, t.parentId, t.createdAt, t.id),
    /**
     * ⚠ **A2, new (R-lens-27)** — **the index the whole read strategy turns on.**
     *
     * `(user_id, horizon, period_key, created_at, id)` serves, as an exact-prefix match with the sort
     * keys already in place and no filesort:
     *   - every lens read (R-lens-16) — one seek, `LIMIT 201`;
     *   - the Zoom sheet's five counts (R-lens-22) — four seeks, ONE grouped query, never five reads;
     *   - R-goal-47's planned-ness scope — a `period_key BETWEEN <first Monday> AND <last Monday>` range
     *     scan about five weeks wide;
     *   - R-lens-26's "does any later period hold a goal" — a `period_key > ?` probe, `LIMIT 1`;
     *   - the interior tree read — four horizon seeks;
     *   - the per-week Weekly-goal cap (Q-12) — a `COUNT(*)` on the exact prefix.
     *
     * **`period_key` before `created_at` is what makes the ordering free.** Reordering these columns
     * turns every read above into a scan.
     */
    index('ix_goals_lens').on(t.userId, t.horizon, t.periodKey, t.createdAt, t.id),
  ],
);

/*
 * ⚠ **A2 (R-rm-2)** — the `weekly_focus` table is **DROPPED**, with `ux_weekly_focus_goal_week` and
 * `ix_weekly_focus_week`. A weekly intent is now an ordinary goal with `horizon = 'Weekly'`, and several
 * under one parent is how a week holds several intentions.
 *
 * **Rows are not converted into Weekly goals, and this is the one decision that cannot be undone.**
 * Converting them would manufacture history — goals claiming to have existed in past weeks, which
 * R-lens-10 forbids on principle. Past weeks therefore lose their focus sentences and render their tasks
 * (owner decision, spec-delta §4 Q-2). The single exception is the migration itself, which READS a
 * sentence to TITLE the Weekly goal it must mint to keep an existing task legal — the sentence is read to
 * keep *work* legal, not to reconstruct a plan.
 */

/**
 * ⚠ **A2 (R-task-39)** — a task under a **Weekly goal**, and under nothing else.
 *
 * `status` is what makes D-15 work: Move-to-Backlog and Cancel set a terminal status and keep the row,
 * because the `Moved to Backlog` / `Canceled` timeline entries the ruleset requires — and the optional
 * reason — cannot live on a deleted row. Exited tasks are excluded from every week view and count.
 *
 * Carrying (R-task-7) needs NO column and NO job: an open task is visible in every week whose Monday is
 * >= `origin_week_start`. That single fact is why this product has no cron (Q-17).
 */
export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    goalId: text('goal_id').notNull(),
    title: text('title').notNull(),
    /** R-task-3 — the done-condition is OPTIONAL. `''`, never null. */
    cond: text('cond').notNull().default(''),
    description: text('description').notNull().default(''),
    status: text('status', { enum: TASK_STATUSES }).notNull().default('open'),
    /**
     * ⚠ **A2 (R-task-40)** — the task's OWN week, seeded once from its Weekly parent's `period_key` and
     * immutable for the life of the task. It is never re-derived from the parent: a week that is looked
     * up rather than recorded changes meaning without a write (D-1). No join to `goals` is needed by any
     * week-scoped read, which is why `ix_tasks_open_week` still serves them all.
     */
    originPeriodKey: text('origin_week_start').notNull(),
    /** R-task-14/19 — set on complete, cleared on uncheck. `done` is derived from it, never stored. */
    donePeriodKey: text('done_week_start'),
    /** D-4 — the instant of completion. The "Done Fri 28 Aug" label is rendered from this. */
    doneAt: text('done_at'),
    /** D-15 — the optional reason from the Move/Cancel confirm sheet, retained on the record. */
    exitReason: text('exit_reason'),
    exitedAt: text('exited_at'),
    movedToBacklogItemId: text('moved_to_backlog_item_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    // R-task-7 — the open-task week scan: `status='open' AND origin_week_start <= :week`.
    index('ix_tasks_open_week').on(t.userId, t.status, t.originPeriodKey),
    // R-task-8 — the done-task week lookup: `status='done' AND done_week_start = :week`.
    index('ix_tasks_done_week').on(t.userId, t.status, t.donePeriodKey),
    // R-goal-24 / R-nav-7 — per-goal counts and the carry signal.
    index('ix_tasks_goal').on(t.userId, t.goalId, t.status),
  ],
);

/** R-task-24/25 — insertion-ordered external links. Max 20 per task (Q-12), enforced in the schema. */
export const taskLinks = sqliteTable(
  'task_links',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    taskId: text('task_id').notNull(),
    url: text('url').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('ix_task_links_task').on(t.userId, t.taskId, t.createdAt, t.id)],
);

/**
 * R-task-30/31 — the read-only activity timeline. APPEND-ONLY: never updated, never deleted (except by
 * the Q-5 subtree cascade), and never authored by the client. `text` and `glyph` are rendered by the
 * server at append time so the log reads the same forever even if the copy changes later.
 *
 * `week_start` is set ONLY on a `carried` event, and the unique index below is what makes the LAZY carry
 * producer safe (Q-17, R-task-29): the entry is generated on first read of a week, and a re-read — or
 * two devices reading the same new week at once — inserts nothing, because `(user, task, week)` is
 * already taken. No cron, no per-week write amplification, and no possibility of a duplicate line.
 */
export const taskEvents = sqliteTable(
  'task_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    taskId: text('task_id').notNull(),
    kind: text('kind', { enum: TASK_EVENT_KINDS }).notNull(),
    text: text('text').notNull(),
    glyph: text('glyph').notNull(),
    /** Structured form of the event (old/new values, reason, source) as JSON. */
    detail: text('detail'),
    weekStart: text('week_start'),
    at: text('at').notNull(),
  },
  (t) => [
    // Q-7 — newest first: `at` desc, then insertion sequence (`id`, a ULID) desc.
    index('ix_task_events_task').on(t.userId, t.taskId, t.at, t.id),
    uniqueIndex('ux_task_events_carried')
      .on(t.userId, t.taskId, t.weekStart)
      .where(sql`kind = 'carried'`),
  ],
);

/**
 * R-backlog-1/2 — deferred work on a Yearly/Quarterly/Monthly goal. Never a Life goal, never a week.
 *
 * D-19 — a converted item is MARKED, not deleted, and `converted_to_task_id` is unique: "converted,
 * never duplicated" (R-backlog-6) becomes a constraint the database enforces rather than a property the
 * code hopes for. The mockup's `find`-then-`filter` created a second task from a vanished item and never
 * persisted the removal at all.
 */
export const backlogItems = sqliteTable(
  'backlog_items',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    goalId: text('goal_id').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    /** Q-7 / D-17 — a real timestamp, never a display string like `'Today'`. */
    capturedAt: text('captured_at').notNull(),
    /** D-12 — the Monday of the week the task was LIVE in when it was moved out. */
    fromPeriodKey: text('from_week_start'),
    /**
     * ⚠ **A1, new (R-backlog-17)** — the manual position within this item's OWN goal's list.
     *
     * An **opaque, lexicographically ordered string** and never a position index: an index has to be
     * rewritten across the whole list on every insert and is racy against a concurrent one, whereas a
     * mid-point key lets a reorder write exactly one row. The scheme is fixed-width zero-padded decimal
     * (`domain/sort-keys.ts`), so lexicographic order IS numeric order and SQLite needs no collation of
     * its own.
     *
     * **Deliberately not unique.** R-backlog-17 makes the order total with `sort_key` asc, then
     * `captured_at` desc, then `id` desc, precisely so that two captures landing on the same key in the
     * same millisecond resolve rather than one of them failing to write. A unique index here would turn a
     * tie into a lost capture.
     */
    sortKey: text('sort_key').notNull().default(''),
    status: text('status', { enum: BACKLOG_STATUSES }).notNull().default('open'),
    convertedToTaskId: text('converted_to_task_id'),
    convertedAt: text('converted_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    // R-backlog-5 / R-backlog-21 / Q-7 — the CROSS-GOAL order, which manual ordering does not touch:
    // `captured_at` desc, `id` desc. It serves the Backlog page's group order, the Life-goal aggregate and
    // the pull list, none of which has a manual order to render (two items on different goals have no
    // relative position at all).
    index('ix_backlog_owner').on(t.userId, t.status, t.capturedAt, t.id),
    index('ix_backlog_goal').on(t.userId, t.goalId, t.status),
    /**
     * ⚠ **A1, new (R-backlog-17/21)** — the WITHIN-GOAL order, served with no filesort:
     * `WHERE user_id=? AND goal_id=? AND status='open' ORDER BY sort_key, …`.
     *
     * `sort_key` sits after the two equality columns and the status, which is what makes the ordering
     * free; `id` closes it so the index covers the tie-break's last term. This is the only list in the
     * product with a manual order, and it is the only index that carries one.
     */
    index('ix_backlog_goal_sort').on(t.userId, t.goalId, t.status, t.sortKey, t.id),
    uniqueIndex('ux_backlog_converted_task')
      .on(t.convertedToTaskId)
      .where(sql`converted_to_task_id IS NOT NULL`),
  ],
);

export const backlogLinks = sqliteTable(
  'backlog_links',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    itemId: text('item_id').notNull(),
    url: text('url').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('ix_backlog_links_item').on(t.userId, t.itemId, t.createdAt, t.id)],
);

/** R-learning-4 / D-23 — `applied` is the "changed the plan" badge, set by an explicit user action. */
export const learnings = sqliteTable(
  'learnings',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    goalId: text('goal_id'),
    text: text('text').notNull(),
    applied: integer('applied', { mode: 'boolean' }).notNull().default(false),
    capturedAt: text('captured_at').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  (t) => [index('ix_learnings_owner').on(t.userId, t.capturedAt, t.id), index('ix_learnings_goal').on(t.userId, t.goalId)],
);

// ─────────────────────────────────────────────────────────────────────────────
// Infrastructure tables — ported from the reference codebase unchanged except for
// the single-user scope.
// ─────────────────────────────────────────────────────────────────────────────

/** `scope` is the `user_id`: this product has no tenant, so the owner IS the idempotency scope. */
export const idempotencyKeys = sqliteTable(
  'idempotency_keys',
  {
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    userId: text('user_id').notNull(),
    requestHash: text('request_hash').notNull(),
    statusCode: integer('status_code'),
    responseBody: text('response_body'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] }), index('ix_idem_created').on(t.createdAt)],
);

/**
 * Auth rate limiting. Better Auth's default limiter keeps its counters in memory, which is useless here:
 * the Worker builds a fresh auth instance per request. `D1RateLimitStore` is wired in as
 * `rateLimit.customStorage` and keeps one row per (client ip, auth path); `last_request` is epoch ms.
 */
export const authRateLimits = sqliteTable(
  'auth_rate_limits',
  {
    key: text('key').primaryKey(),
    count: integer('count').notNull(),
    lastRequest: integer('last_request').notNull(),
  },
  (t) => [index('ix_auth_rate_limits_last_request').on(t.lastRequest)],
);

/**
 * The email sink — and, in this product, the ONLY place an outbound message ever goes. This Worker has
 * no `send_email` binding and no network-capable mail adapter (a deliberate decision: see
 * `wrangler.jsonc` and `infrastructure/email/log-email-sender.ts`), so verification and password-reset
 * links land here and are read back through `GET /internal/outbox`.
 *
 * A message is stored ONLY when its recipient matches `E2E_EMAIL_PATTERN`, which is constrained to
 * non-registrable domains — so this table can never hold a real account's links, whoever holds
 * `INTERNAL_SECRET`. With the pattern unset nothing is stored at all.
 */
export const emailOutbox = sqliteTable(
  'email_outbox',
  {
    id: text('id').primaryKey(),
    to: text('to').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('ix_email_outbox_to').on(t.to, t.createdAt)],
);

/**
 * The ONE agent-access token per account — the credential behind `POST /mcp`.
 *
 * **`user_id` is the PRIMARY KEY, not `id`.** That is the design, not a shortcut: "exactly one token,
 * creating replaces it" becomes a constraint the database enforces rather than a property the service
 * hopes for, so there is no state in which two tokens are live and no code path that could produce one.
 * There is deliberately no `name` column and no list endpoint (UX §8: one person connecting one or two
 * agents does not need a revocation list, and a list is a management surface this product has removed).
 *
 * **Only a HASH is stored.** `token_hash` is `sha256Hex(plaintext)` — the same primitive the idempotency
 * middleware uses and the same shape Better Auth's `verification.storeIdentifier: 'hashed'` gives reset
 * tokens. Read access to D1 — a leaked backup, a `wrangler d1 execute`, an export — must not be a live
 * key for an endpoint that bypasses Better Auth entirely. `last4` is the only fragment kept, so the owner
 * can recognise which token their agent holds without the row ever being able to authenticate.
 *
 * The unique index on `token_hash` is what the `/mcp` bearer check seeks on: one indexed lookup resolves
 * the owner, and `userId` is then closed over for the whole request (see `api/mcp/server.ts`).
 */
export const apiTokens = sqliteTable(
  'api_tokens',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** SHA-256 hex of the plaintext. NEVER the plaintext, in any column, at any time. */
    tokenHash: text('token_hash').notNull(),
    /** The last 4 characters of the plaintext — a recognition aid, not a credential fragment. */
    last4: text('last4').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('ux_api_tokens_hash').on(t.tokenHash)],
);

/**
 * Atomic guarded batches. A permanently EMPTY table whose only job is to raise a SQL error:
 * `GuardedBatch` prepends `INSERT INTO _guard(label) SELECT ? WHERE <precondition is false>` to every
 * batch, so a failed precondition trips `CHECK (0)` and D1 rolls back the whole batch — which is the only
 * way to make a zero-row guarded UPDATE take its sibling INSERTs down with it. Never insert into it,
 * never read from it.
 */
export const guard = sqliteTable('_guard', { label: text('label').notNull() }, () => [
  check('_guard_precondition_failed', sql`0`),
]);

export const schema = {
  user,
  session,
  account,
  verification,
  userRelations,
  sessionRelations,
  accountRelations,
  preferences,
  goals,
  tasks,
  taskLinks,
  taskEvents,
  backlogItems,
  backlogLinks,
  learnings,
  idempotencyKeys,
  authRateLimits,
  emailOutbox,
  apiTokens,
  guard,
};
