import { beforeAll, describe, expect, it } from 'vitest';
import { DB } from '../../src/application/services/guarded-batch';
import type { Db } from '../../src/infrastructure/persistence/db';
import { backlogItems, goals, learnings, tasks, user } from '../../src/infrastructure/persistence/schema';
import { createTestApp, ids, signedInOwner } from '../helpers/app';
import { callTool, mintToken, ok } from './helpers';

const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });
const NOW = '2026-08-31T10:00:00.000Z';
const WEEK = '2026-08-31';

/**
 * ── The test that matters most ───────────────────────────────────────────────────────────────────
 *
 * Goal Cascade is single-user, so a cross-account leak has no UI to be noticed in and no second owner
 * to complain. The whole defence is that `ctx.userId` is resolved ONCE from the bearer token and closed
 * over by the server factory, so no tool takes a scope and no tool can forget one.
 *
 * That is an argument. This file is the proof: a second user is created DIRECTLY IN THE DATABASE, given
 * a full set of entities, and then user A's token is pointed at every one of B's ids through every tool
 * that takes an id. Every single call must refuse, and refuse as NOT_FOUND — R-auth-3 says another
 * owner's entity is indistinguishable from a non-existent one, so a "forbidden" here would itself be a
 * leak (it would confirm the id exists).
 *
 * The census at the bottom is what keeps this honest as tools are added: it reads the live tool list off
 * the server and fails if any tool declaring an id-shaped input is not covered here.
 */
describe('user A cannot touch ANY of user B entities through the MCP surface', () => {
  let tokenA: string;
  const B = {
    userId: `user-b-${crypto.randomUUID()}`,
    lifeGoal: ids.ulid(),
    monthlyGoal: ids.ulid(),
    weeklyGoal: ids.ulid(),
    task: ids.ulid(),
    item: ids.ulid(),
    learning: ids.ulid(),
  };

  beforeAll(async () => {
    const a = await signedInOwner(t);
    tokenA = await mintToken(t, a.cookie);

    /**
     * User B is inserted straight into D1 rather than signed up through Better Auth, because the
     * allowlist is single-user by design (R-auth-1) and a second real sign-up is not a state this
     * product has. What matters for this test is only that B's ROWS exist and are owned by someone
     * else — which is exactly what a leak would have to reach.
     */
    const db = t.container().resolve<Db>(DB);
    await db.insert(user).values({
      id: B.userId,
      name: 'Someone Else',
      email: `b-${crypto.randomUUID()}@test.goal-cascade.local`,
      emailVerified: true,
      image: null,
    });
    await db.insert(goals).values([
      { id: B.lifeGoal, userId: B.userId, parentId: null, horizon: 'Life', title: "B's life goal", why: '', pulse: 'On track', periodKey: '', period: '', createdAt: NOW, updatedAt: NOW, version: 1 },
      { id: B.monthlyGoal, userId: B.userId, parentId: B.lifeGoal, horizon: 'Monthly', title: "B's month", why: '', pulse: 'On track', periodKey: '2026-08', period: 'Aug 2026', createdAt: NOW, updatedAt: NOW, version: 1 },
      // A2 - a task hangs off a WEEKLY goal (R-goal-39), so B's secret work needs one.
      { id: B.weeklyGoal, userId: B.userId, parentId: B.monthlyGoal, horizon: 'Weekly', title: "B's private week", why: '', pulse: 'On track', periodKey: WEEK, period: 'Week of 31 Aug', createdAt: NOW, updatedAt: NOW, version: 1 },
    ]);
    await db.insert(tasks).values({ id: B.task, userId: B.userId, goalId: B.weeklyGoal, title: "B's secret task", cond: '', description: '', status: 'open', originPeriodKey: WEEK, donePeriodKey: null, doneAt: null, exitReason: null, exitedAt: null, movedToBacklogItemId: null, createdAt: NOW, updatedAt: NOW, version: 1 });
    await db.insert(backlogItems).values({ id: B.item, userId: B.userId, goalId: B.monthlyGoal, title: "B's parked item", description: '', capturedAt: NOW, fromPeriodKey: null, sortKey: '000001000000', status: 'open', convertedToTaskId: null, convertedAt: null, createdAt: NOW, updatedAt: NOW, version: 1 });
    await db.insert(learnings).values({ id: B.learning, userId: B.userId, goalId: B.lifeGoal, text: "B's private learning", applied: false, capturedAt: NOW, createdAt: NOW, updatedAt: NOW });
  });

  /**
   * Every tool that takes an id, with B's id in every id-shaped slot.
   *
   * `[name, args]`. This list IS the coverage claim, and the census test below fails the build if a
   * tool with an id-shaped input is missing from it.
   */
  const attempts = (): Array<[string, Record<string, unknown>]> => [
    // reads
    ['get_goal', { goal_id: B.monthlyGoal }],
    ['preview_goal_deletion', { goal_id: B.monthlyGoal }],
    ['get_task', { task_id: B.task }],
    ['list_backlog', { goal_id: B.monthlyGoal }],
    // goals (write)
    ['create_goal', { title: 'A goal under B', horizon: 'Monthly', parent_id: B.lifeGoal }],
    ['update_goal', { goal_id: B.monthlyGoal, title: 'renamed by A' }],
    ['move_goal', { goal_id: B.monthlyGoal, new_parent_id: B.lifeGoal }],
    ['replan_goal', { goal_id: B.monthlyGoal, period_key: '2026-10' }],
    ['delete_goal', { goal_id: B.monthlyGoal, cascade: true }],
    // A2, new tools that take an id (R-goal-46, R-task-48).
    ['repeat_last_week', { life_goal_id: B.lifeGoal, week_start: WEEK }],
    /*
     * RETIRED - `set_goal_focus`, `clear_goal_focus` and `save_weekly_plan` are deleted with the entity
     * (R-rm-2, R-rm-3). Their scoping coverage is not lost: writing into another owner's week now goes
     * through `create_goal(horizon: 'Weekly')` and `create_task`, both of which are exercised here.
     */
    // tasks
    ['create_task', { goal_id: B.weeklyGoal, title: 'A task on B week' }],
    ['create_task', { new_weekly_goal: { parent_id: B.monthlyGoal, title: 'A week under B' }, title: 'A task' }],
    ['update_task', { task_id: B.task, title: 'renamed by A' }],
    ['complete_task', { task_id: B.task }],
    ['uncheck_task', { task_id: B.task }],
    ['move_task_to_backlog', { task_id: B.task }],
    ['cancel_task', { task_id: B.task }],
    ['add_task_link', { task_id: B.task, url: 'https://example.com/x' }],
    ['remove_task_link', { task_id: B.task, link_id: ids.ulid() }],
    /*
     * ⚠ **A8, new (R-task-56, R-measure-1/3/5)** — six tools, every one of them owner-scoped by the same
     * closed-over `ctx.userId` as the rest. `retarget_task` carries B's id in BOTH slots — the task being
     * parked AND the weekly goal it is being parked onto — because a target lookup that forgot the owner
     * scope would be a read of another account's tree, exactly as `reorder_backlog_item`'s neighbour is.
     */
    ['retarget_task', { task_id: B.task, period: '2026-09-07', goal_id: B.weeklyGoal }],
    ['set_task_measure', { task_id: B.task, measure: { kind: 'counter', start: 0, target: 15 } }],
    ['clear_task_measure', { task_id: B.task }],
    ['record_reading', { task_id: B.task, value: 3 }],
    ['list_readings', { task_id: B.task }],
    ['delete_reading', { task_id: B.task, reading_id: ids.ulid() }],
    // backlog
    ['create_backlog_item', { goal_id: B.monthlyGoal, title: 'A item on B goal' }],
    ['update_backlog_item', { item_id: B.item, title: 'renamed by A' }],
    ['move_backlog_item', { item_id: B.item, goal_id: B.monthlyGoal }],
    // A1, new (R-backlog-19). Both id slots carry B's ids: the item being moved AND the neighbour it is
    // being placed next to, because a neighbour lookup that forgot the owner scope would be a read.
    ['reorder_backlog_item', { item_id: B.item, after_item_id: B.item }],
    ['delete_backlog_item', { item_id: B.item }],
    ['convert_backlog_item_to_task', { item_id: B.item }],
    // learnings
    ['capture_learning', { text: 'tagged to B', goal_id: B.lifeGoal }],
    ['update_learning', { learning_id: B.learning, text: 'rewritten by A' }],
    ['attach_learning_to_goal', { learning_id: B.learning, goal_id: B.lifeGoal }],
    ['discard_learning', { learning_id: B.learning }],
  ];

  it("every id-taking tool refuses B's ids, and refuses them as NOT_FOUND", async () => {
    const leaked: string[] = [];
    const wrongCode: string[] = [];
    for (const [name, args] of attempts()) {
      const r = await callTool(t, tokenA, name, args);
      if (!r.isError) {
        leaked.push(`${name}(${JSON.stringify(args)}) SUCCEEDED against another owner's entity`);
        continue;
      }
      // R-auth-3 — another owner's entity is refused IDENTICALLY to a non-existent one. Anything that
      // says "forbidden" has just confirmed the id exists, which is itself the leak.
      if (r.payload?.code !== 'NOT_FOUND') {
        wrongCode.push(`${name} → ${r.payload?.code} (expected NOT_FOUND): ${r.payload?.message}`);
      }
    }
    expect(leaked, 'CROSS-ACCOUNT WRITE OR READ').toEqual([]);
    expect(wrongCode, "refusals must not distinguish 'someone else owns this' from 'does not exist'").toEqual([]);
  });

  it("B's data never appears in any list, tree, resource or search A can reach", async () => {
    const secrets = ["B's life goal", "B's month", "B's private week", "B's secret task", "B's parked item", "B's private learning", B.userId];

    const payloads = [
      await ok(t, tokenA, 'get_overview'),
      // A2 - `list_goals` and `get_weekly_plan` are gone; `list_lens` is the read that replaced them,
      // and it is exercised at EVERY horizon, because each is its own indexed query (R-lens-16).
      await ok(t, tokenA, 'list_lens', { lens: 'Life' }),
      await ok(t, tokenA, 'list_lens', { lens: 'Monthly' }),
      await ok(t, tokenA, 'list_lens', { lens: 'Weekly' }),
      await ok(t, tokenA, 'get_period'),
      await ok(t, tokenA, 'list_tasks'),
      await ok(t, tokenA, 'list_backlog'),
      await ok(t, tokenA, 'list_learnings'),
      await ok(t, tokenA, 'get_account'),
      // The fuzzy search is the one place a title could match across accounts, so it gets B's own words.
      await ok(t, tokenA, 'find_goal', { query: 'life goal', lens: 'Life' }),
      await ok(t, tokenA, 'find_goal', { query: "B's month", lens: 'Monthly' }),
    ];

    const haystack = JSON.stringify(payloads);
    for (const secret of secrets) {
      expect(haystack.includes(secret), `"${secret}" leaked into a list A can read`).toBe(false);
    }
    // ...and A's account really is empty, so the assertion above is not vacuous for the wrong reason.
    expect((payloads[1] as { items: unknown[] }).items).toEqual([]);
  });

  it("B's rows are untouched afterwards — nothing above half-applied a write", async () => {
    const db = t.container().resolve<Db>(DB);
    const [g, tk, it_, ln] = await Promise.all([
      db.select().from(goals),
      db.select().from(tasks),
      db.select().from(backlogItems),
      db.select().from(learnings),
    ]);
    const mine = <T extends { userId: string }>(rows: T[]) => rows.filter((r) => r.userId === B.userId);

    expect(mine(g).map((r) => r.title).sort()).toEqual(["B's life goal", "B's month", "B's private week"]);
    expect(mine(tk)).toHaveLength(1);
    expect(mine(tk)[0]!.status, "B's task was exited by A").toBe('open');
    expect(mine(tk)[0]!.title).toBe("B's secret task");
    expect(mine(it_)).toHaveLength(1);
    expect(mine(it_)[0]!.status, "B's backlog item was converted by A").toBe('open');
    expect(mine(ln)).toHaveLength(1);
    expect(mine(ln)[0]!.text).toBe("B's private learning");
    // A2 (R-rm-2) - the `weekly_focus` arm is gone with the table. B's weekly INTENTION is a goal now,
    // and it is covered by the goal assertion above.
  });

  it('the census: every tool with an id-shaped input is exercised above', async () => {
    const { rpc, mcp } = await import('./helpers');
    const list = await rpc(await mcp(t, tokenA, 'tools/list'));
    const covered = new Set(attempts().map(([name]) => name));

    const missing: string[] = [];
    for (const tool of list.result.tools as Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }>) {
      const props = Object.keys(tool.inputSchema?.properties ?? {});
      // Anything the surface calls an id, in any position, is an id an attacker could point elsewhere.
      const takesId = props.some((p) => p.endsWith('_id') || p === 'entries');
      if (takesId && !covered.has(tool.name)) missing.push(`${tool.name} (${props.filter((p) => p.endsWith('_id') || p === 'entries').join(', ')})`);
    }
    expect(missing, 'a tool takes an id but is not covered by the scoping test — add it to `attempts()`').toEqual([]);
  });
});
