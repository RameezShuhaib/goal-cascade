import { beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signedInOwner } from '../helpers/app';
import { callTool, mcp, mintToken, ok, refused, rpc } from './helpers';

const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' }); // a Monday
const THIS_WEEK = '2026-08-31';

let token: string;
let cookie: string;

/**
 * The fixture every family builds on: Life › Yearly › Monthly › **Weekly**.
 *
 * ⚠ **A2** — the old fixture stopped at Monthly and made it "active" with `set_goal_focus`. That goal is
 * now precisely the one that must NEVER hold a task (R-goal-37), and there is nothing to activate: a
 * week's intention IS a goal (R-goal-31). `week` is the target for everything task-shaped.
 */
async function tree() {
  const life = (await ok(t, token, 'create_goal', { title: `Health ${crypto.randomUUID()}`, horizon: 'Life', parent_id: null })).goal;
  const year = (await ok(t, token, 'create_goal', { title: 'Get strong in 2026', horizon: 'Yearly', parent_id: life.id })).goal;
  const month = (await ok(t, token, 'create_goal', { title: 'Aug 2026', horizon: 'Monthly', parent_id: year.id })).goal;
  const week = (await ok(t, token, 'create_goal', { title: 'Three gym sessions and one long run', horizon: 'Weekly', parent_id: month.id })).goal;
  return { life, year, month, week };
}

beforeAll(async () => {
  cookie = (await signedInOwner(t)).cookie;
  token = await mintToken(t, cookie);
});

describe('the surface an agent connects to', () => {
  it('advertises the tools, resources and prompts the design specifies', async () => {
    const tools = (await rpc(await mcp(t, token, 'tools/list'))).result.tools as Array<{ name: string; description: string; inputSchema: unknown }>;
    const resources = (await rpc(await mcp(t, token, 'resources/list'))).result.resources as Array<{ uri: string }>;
    const templates = (await rpc(await mcp(t, token, 'resources/templates/list'))).result.resourceTemplates as Array<{ uriTemplate: string }>;
    const prompts = (await rpc(await mcp(t, token, 'prompts/list'))).result.prompts as Array<{ name: string }>;

    /**
     * ⚠ **A2** — 38 → 36. **Deleted (7)**: the four plan tools (`get_weekly_plan`, `set_goal_focus`,
     * `clear_goal_focus`, `save_weekly_plan`) with the entity (R-rm-2, R-rm-3), and `list_goals` with
     * the whole-tree read (R-lens-16) — plus `get_period` and `list_lens` replacing what they did.
     * **Added (3)**: `list_lens` (R-lens-16), `get_period` (R-goal-34), `repeat_last_week` (R-goal-46).
     *
     * ⚠ **A1** — 36 → 37. **Added (1)**: `reorder_backlog_item` (R-backlog-19), the relative move behind
     * the manual per-goal backlog order. It is the only tool that writes a position, and there is
     * deliberately no second one that writes an index.
     */
    expect(tools).toHaveLength(37);
    expect(resources.length + templates.length).toBe(9);
    expect(prompts).toHaveLength(4);

    // Every tool must be understandable by the model that has to choose it. A tool with a thin
    // description is a tool that gets misused, and the descriptions are a deliverable here.
    for (const tool of tools) {
      expect(tool.description?.length ?? 0, `${tool.name} has a thin description`).toBeGreaterThan(60);
      expect(tool.inputSchema, `${tool.name} advertises no input schema`).toBeTruthy();
    }
    expect(prompts.map((p) => p.name).sort()).toEqual([
      'goal_health_check',
      'plan_the_week',
      'review_the_carry',
      'triage_the_backlog',
    ]);
  });

  /**
   * ⚠ **A2 (R-rm-1, R-rm-2, R-rm-3)** — **the retired tools are asserted ABSENT, not merely dropped.**
   *
   * A connecting agent that still believed in `set_goal_focus` would keep asking to activate a table
   * that no longer exists, and `list_goals` would promise a whole-tree read the product refuses to
   * serve. An "unused but still present" tool fails R-rm-*'s audit by construction.
   */
  it('S-rm-1-1 / S-rm-2-1 / S-rm-3-1 — every retired tool is gone from the surface', async () => {
    const names = new Set(((await rpc(await mcp(t, token, 'tools/list'))).result.tools as Array<{ name: string }>).map((x) => x.name));
    for (const gone of [
      'get_weekly_plan',
      'set_goal_focus',
      'clear_goal_focus',
      'save_weekly_plan',
      'list_ideas',
      'capture_idea',
      'attach_idea_to_goal',
      'convert_idea_to_task',
      'delete_idea',
      'list_goals',
    ]) {
      expect(names.has(gone), `${gone} still exists`).toBe(false);
    }
    // …and the three that replaced them are there.
    for (const added of ['list_lens', 'get_period', 'repeat_last_week']) {
      expect(names.has(added), `${added} is missing`).toBe(true);
    }
  });

  it('advertises the instructions block, which is what teaches the model the product', async () => {
    // NOT `initialize` — the 2026-07-28 revision removed it (it answers -32601 Method not found).
    // A stateless server has no handshake; `server/discover` is where a client reads the server's
    // capabilities and its instructions.
    const discover = await rpc(await mcp(t, token, 'server/discover', {}));
    expect(discover.result.supportedVersions).toContain('2026-07-28');
    const instructions: string = discover.result?.instructions ?? '';
    for (const anchor of [
      'Life › Yearly › Quarterly › Monthly › Weekly',
      'ONLY WEEKLY GOALS HOLD TASKS',
      'PERIODS',
      'LENSES',
      'THE WEEK',
      'CARRYING',
      'THE THREE EXITS',
      'NO REPORTS',
      'HOW TO WORK',
    ]) {
      expect(instructions, `the instructions block is missing "${anchor}"`).toContain(anchor);
    }
    /**
     * ⚠ **A2** — the block is REWRITTEN, and this half is why. It used to teach four horizons with
     * Monthly terminal, the LEAF / ACTIVE / DORMANT model, and "positive week offsets do not exist".
     * A connecting agent that believed any of those would keep acting on a product that no longer
     * exists — routing work at leaves, asking to set a focus, refusing to plan a future week.
     */
    for (const stale of ['LEAF, ACTIVE, DORMANT', 'exactly four horizons', 'set_goal_focus', 'save_weekly_plan']) {
      expect(instructions, `the instructions block still says "${stale}"`).not.toContain(stale);
    }
    // The trap, stated in the one place every connecting agent reads it.
    expect(instructions).toMatch(/monthly goal that\s+happens to have no weekly children/);
  });

  it('.refine() rules are dropped from the advertised schema, so they are stated in the description', async () => {
    // zod → JSON Schema loses `.refine()`. `WeekStart`'s "must be a Monday" and `Url`'s "http(s) only"
    // are both refinements, so the MODEL can only learn them from the prose. This asserts it can.
    const tools = (await rpc(await mcp(t, token, 'tools/list'))).result.tools as Array<{ name: string; description: string; inputSchema: any }>;
    const repeat = tools.find((x) => x.name === 'repeat_last_week')!;
    const weekStart = repeat.inputSchema.properties.week_start;
    // The advertised schema is `format: date` plus a generic ISO-date pattern. Nothing in it can
    // express "and it must be a Monday" — a Tuesday satisfies the pattern completely.
    expect(new RegExp(weekStart.pattern).test('2026-09-01'), 'the Monday rule IS advertised now').toBe(true);
    // …so the rule survives only in the prose the model actually reads.
    expect(weekStart.description).toMatch(/Monday/);
    expect(tools.find((x) => x.name === 'add_task_link')!.description).toMatch(/http/i);
    // ⚠ **A2** — `periodKey`'s shape is a refinement too, and it is the one an agent would otherwise
    // have to guess at. It is stated on every tool that takes one.
    expect(tools.find((x) => x.name === 'create_goal')!.inputSchema.properties.period_key.description).toMatch(/2026-Q3/);
  });
});

describe('goals', () => {
  it('happy path: create, find, read, replan, move', async () => {
    const { life, year, month } = await tree();

    const found = await ok(t, token, 'find_goal', { query: 'Aug 2026', lens: 'Monthly' });
    expect(found.matches[0].id).toBe(month.id);

    const detail = await ok(t, token, 'get_goal', { goal_id: month.id });
    // ⚠ **A2 (R-goal-37)** — `is_active` is gone; `is_weekly` is the one flag that decides anything.
    expect(detail.goal.is_weekly).toBe(false);
    expect(detail.goal).not.toHaveProperty('is_active');
    expect(detail.replan_options.length).toBeGreaterThan(0);

    const target = detail.replan_options[0];
    const replanned = await ok(t, token, 'replan_goal', { goal_id: month.id, period_key: target.period_key });
    expect(replanned.goal.period_key).toBe(target.period_key);
    // R-goal-33 / D-3 — an omitted period is derived from TODAY and the horizon, never from the title.
    // The fixture's goal is *called* "Aug 2026" and the clock agrees, but the KEY is what decides.
    expect(detail.goal.period_key).toBe('2026-08');
    expect(replanned.previous_period).toBe(detail.goal.period);

    const moved = await ok(t, token, 'move_goal', { goal_id: month.id, new_parent_id: life.id });
    expect(moved.goal.parent_id).toBe(life.id);
    expect(moved.goal.life_root_id).toBe(life.id);
    void year;
  });

  it('S-goal-31-2 / S-goal-32-1 — a Weekly goal under Monthly succeeds, and levels may be skipped', async () => {
    const { life, month } = await tree();
    expect((await ok(t, token, 'create_goal', { title: 'under the month', horizon: 'Weekly', parent_id: month.id })).goal.horizon).toBe('Weekly');
    expect((await ok(t, token, 'create_goal', { title: 'a weekly practice', horizon: 'Weekly', parent_id: life.id })).goal.parent_id).toBe(life.id);
  });

  it('HORIZON_CONFLICT tells the agent what to do differently, and names the RIGHT terminal horizon', async () => {
    const { week } = await tree();
    const err = await refused(t, token, 'create_goal', { title: 'Under a Weekly', horizon: 'Weekly', parent_id: week.id }, 'HORIZON_CONFLICT');
    expect(err.retryable, 'a 409 in this product means "do something else", never "retry"').toBe(false);
    expect(err.recovery).toMatch(/WEEKLY, which is terminal|shorter/i);
    expect(err.recovery).toMatch(/different parent|shorter horizon/i);
    // The recovery must NOT still say Monthly is terminal — it is the rule that reversed.
    expect(err.recovery).not.toMatch(/parent is Monthly, which is terminal/);
    // …and it must say that skipping levels is legal, or the agent "corrects" a tree that is fine.
    expect(err.recovery).toMatch(/skipped/i);
  });

  it('S-goal-36-1 — PERIOD_IN_PAST refuses a back-dated create, and forbids the workaround', async () => {
    const { month } = await tree();
    const err = await refused(
      t,
      token,
      'create_goal',
      { title: 'last week', horizon: 'Weekly', parent_id: month.id, period_key: '2026-08-24' },
      'PERIOD_IN_PAST',
    );
    expect(err.retryable).toBe(false);
    expect(err.recovery).toMatch(/does not rewrite history/i);
    expect(err.recovery).toMatch(/do not try to work around it/i);
  });

  it('S-goal-40-2 — a WEEKLY goal is not re-plannable, and offers no options to construct the call from', async () => {
    const { week } = await tree();
    expect((await ok(t, token, 'get_goal', { goal_id: week.id })).replan_options).toEqual([]);
    const r = await callTool(t, token, 'replan_goal', { goal_id: week.id, period_key: '2026-09-07' });
    expect(r.isError).toBe(true);
    expect(r.payload.code).toBe('VALIDATION_FAILED');
  });

  it('R-lens-22 / get_period — the current period at every horizon, in ONE read', async () => {
    await tree();
    const res = await ok(t, token, 'get_period');
    expect(res.periods.map((p: any) => p.lens)).toEqual(['Life', 'Yearly', 'Quarterly', 'Monthly', 'Weekly']);
    const byLens = Object.fromEntries(res.periods.map((p: any) => [p.lens, p]));
    expect(byLens.Quarterly.period_key).toBe('2026-Q3');
    expect(byLens.Monthly.period_key).toBe('2026-08');
    expect(byLens.Weekly.period_key).toBe(THIS_WEEK);
    expect(byLens.Life.period_key).toBeNull();
    expect(byLens.Weekly.goals).toBeGreaterThan(0);
  });

  it('R-lens-16 — list_lens is one horizon and one period, grouped by Life goal', async () => {
    const { life, week } = await tree();
    const res = await ok(t, token, 'list_lens', { lens: 'Weekly' });
    expect(res.lens).toBe('Weekly');
    expect(res.period.period_key).toBe(THIS_WEEK);
    expect(res.items.map((g: any) => g.id)).toContain(week.id);
    // R-lens-3 — the server resolved the group; the client walks no chain.
    expect(res.items.find((g: any) => g.id === week.id).life_root_id).toBe(life.id);
    expect(res.groups.some((g: any) => g.id === life.id)).toBe(true);
    // R-lens-2 — one horizon only: the Monthly goal is not in the Weekly lens.
    expect(res.items.map((g: any) => g.horizon).every((h: string) => h === 'Weekly')).toBe(true);
  });

  it('WOULD_CREATE_CYCLE says plainly that a goal cannot move under its own child', async () => {
    const { year, month } = await tree();
    const err = await refused(t, token, 'move_goal', { goal_id: year.id, new_parent_id: month.id }, 'WOULD_CREATE_CYCLE');
    expect(err.retryable).toBe(false);
    expect(err.recovery).toMatch(/own child|descendant/i);
    expect(err.recovery).toMatch(/Never retry/i);
  });

  it('preview_goal_deletion counts a CHILDLESS goal too, and writes nothing', async () => {
    const { week } = await tree();
    await ok(t, token, 'create_task', { goal_id: week.id, title: 'A task that would be destroyed' });

    const preview = await ok(t, token, 'preview_goal_deletion', { goal_id: week.id });
    // This is the case the API's own guard could never report: a childless goal deletes silently.
    expect(preview.requires_cascade).toBe(false);
    expect(preview.would_remove.goals).toBe(1);
    expect(preview.would_remove.weekly_goals).toBe(1);
    expect(preview.would_remove.tasks).toBe(1);
    expect(preview.would_remove.task_events).toBeGreaterThan(0);

    // Nothing was written: the goal and its task are both still there.
    expect((await ok(t, token, 'get_goal', { goal_id: week.id })).goal.id).toBe(week.id);
    expect((await ok(t, token, 'get_goal', { goal_id: week.id })).tasks).toHaveLength(1);
  });

  it('GOAL_HAS_CHILDREN is the confirmation step, not an argument the agent forgot', async () => {
    const { life } = await tree();
    const err = await refused(t, token, 'delete_goal', { goal_id: life.id, cascade: false }, 'GOAL_HAS_CHILDREN');
    expect(err.details.subGoals).toBeGreaterThan(0);
    expect(err.recovery).toMatch(/preview_goal_deletion/);
    expect(err.recovery).toMatch(/Do NOT simply repeat/i);
  });

  it('delete_goal cascades, and needs no preview call first (the owner overruled that rail)', async () => {
    const { life } = await tree();
    const deleted = await ok(t, token, 'delete_goal', { goal_id: life.id, cascade: true });
    expect(deleted.deleted).toBe(true);
    expect(deleted.removed.goals).toBe(4);
    expect(deleted.removed.weekly_goals).toBe(1);
    await refused(t, token, 'get_goal', { goal_id: life.id }, 'NOT_FOUND');
  });

  it('R-goal-46 — repeat_last_week copies ONE life line’s weekly goals, with nothing linking them', async () => {
    const { life, month } = await tree();
    // Arrange last week by moving the clock: a past week refuses a create (R-goal-36).
    t.clock.set('2026-08-24T10:00:00.000Z');
    const a = (await ok(t, token, 'create_goal', { title: 'Run four times', horizon: 'Weekly', parent_id: month.id })).goal;
    t.clock.set('2026-08-31T10:00:00.000Z');

    const res = await ok(t, token, 'repeat_last_week', { life_goal_id: life.id, week_start: THIS_WEEK });
    expect(res.count).toBe(1);
    const copy = res.created[0];
    expect(copy.title).toBe(a.title);
    expect(copy.period_key).toBe(THIS_WEEK);
    expect(copy.id).not.toBe(a.id);
    expect(copy.pulse).toBe('On track'); // reset, not inherited
    // Nothing links a copy to its source: there is no series id and no template.
    expect(JSON.stringify(copy)).not.toContain(a.id);
  });
});

describe('tasks', () => {
  it('happy path: create, edit, link, complete, uncheck', async () => {
    const { week } = await tree();
    const created = (await ok(t, token, 'create_task', { goal_id: week.id, title: 'Book the physio', cond: 'Appointment in the calendar' })).task;
    expect(created.goal_path).toContain('Three gym sessions');
    expect(created.status).toBe('open');
    // R-task-40 — the week came from the PARENT, and no request field named one.
    expect(created.origin_week_start).toBe(THIS_WEEK);

    await ok(t, token, 'update_task', { task_id: created.id, title: 'Book the physio properly' });
    const linked = (await ok(t, token, 'add_task_link', { task_id: created.id, url: 'https://example.com/booking' })).task;
    expect(linked.links).toHaveLength(1);
    expect((await ok(t, token, 'remove_task_link', { task_id: created.id, link_id: linked.links[0].id })).task.links).toHaveLength(0);

    const done = (await ok(t, token, 'complete_task', { task_id: created.id })).task;
    expect(done.status).toBe('done');
    const reopened = (await ok(t, token, 'uncheck_task', { task_id: created.id })).task;
    expect(reopened.status).toBe('open');
    // R-task-19/21 — it comes back with the age it really has, not a fresh one.
    expect(reopened.origin_week_start).toBe(created.origin_week_start);

    const detail = (await ok(t, token, 'get_task', { task_id: created.id })).task;
    expect(detail.events.map((e: any) => e.kind)).toEqual(
      expect.arrayContaining(['created', 'renamed', 'link_added', 'link_removed', 'completed', 'unchecked']),
    );
  });

  /**
   * SUPERSEDED — `BRANCH_NOT_ACTIVE` forbade "route the work to a goal that IS active", which was the
   * one substitution the old product refused. R-backlog-26 replaces the code, and **A2 splits that
   * refusal in two**, each with its own forbidden workaround:
   *
   *  - `NOT_A_WEEKLY_GOAL` — never "use a leaf instead". The condition is the HORIZON (R-goal-39).
   *  - `NO_WEEKLY_GOAL` — never "use a different goal that has one". Create the week's goal inline.
   */
  it('S-goal-37-1 — NOT_A_WEEKLY_GOAL names the trap and forbids the substitution', async () => {
    const { month } = await tree();
    // A childless Monthly goal: a leaf by the structural definition, and never a task parent.
    const childless = (await ok(t, token, 'create_goal', { title: 'nothing planned yet', horizon: 'Monthly', parent_id: (await tree()).year.id })).goal;
    const err = await refused(t, token, 'create_task', { goal_id: childless.id, title: 'nope' }, 'NOT_A_WEEKLY_GOAL');
    expect(err.retryable).toBe(false);
    expect(err.recovery).toMatch(/horizon/i);
    expect(err.recovery).toMatch(/monthly goal with no weekly children/i);
    expect(err.recovery).toMatch(/new_weekly_goal/);
    expect(err.recovery).toMatch(/Never route the work to some other goal/);
    void month;
  });

  it('S-task-48-1 — create_task’s inline `new_weekly_goal` makes both rows, and NAMES the one it made', async () => {
    const { month } = await tree();
    const other = (await ok(t, token, 'create_goal', { title: 'no week yet', horizon: 'Monthly', parent_id: (await tree()).year.id })).goal;
    const res = await ok(t, token, 'create_task', {
      new_weekly_goal: { parent_id: other.id, title: 'This week’s version' },
      title: 'the actual work',
    });
    // R-task-49 — nothing may be created invisibly, so the created goal comes back to be spoken aloud.
    expect(res.created_weekly_goal).not.toBeNull();
    expect(res.created_weekly_goal.horizon).toBe('Weekly');
    expect(res.created_weekly_goal.period_key).toBe(THIS_WEEK);
    expect(res.task.goal_id).toBe(res.created_weekly_goal.id);
    expect(res.task.origin_week_start).toBe(THIS_WEEK);
    void month;
  });

  it('S-task-48-3 — both, or neither, of goal_id and new_weekly_goal is refused', async () => {
    const { month, week } = await tree();
    for (const args of [
      { title: 'x' },
      { title: 'x', goal_id: week.id, new_weekly_goal: { parent_id: month.id, title: 'y' } },
    ]) {
      const r = await callTool(t, token, 'create_task', args);
      expect(r.isError, JSON.stringify(args)).toBe(true);
    }
  });

  it('S-task-44-1 — a task under a FUTURE weekly goal cannot be completed, and says so on the row', async () => {
    const { month } = await tree();
    const ahead = (await ok(t, token, 'create_goal', { title: 'next week', horizon: 'Weekly', parent_id: month.id, period_key: '2026-09-07' })).goal;
    const task = (await ok(t, token, 'create_task', { goal_id: ahead.id, title: 'not yet' })).task;
    expect(task.completable).toBe(false);
    // R-task-43 — and its age is NEGATIVE, so the only escalation in the product cannot fire at it.
    const week = await ok(t, token, 'list_tasks', { week_offset: 1 });
    const row = week.tasks.find((x: any) => x.id === task.id);
    expect(row.carry_weeks).toBeLessThan(0);
    expect(row.carry_label).toBe('');

    const err = await refused(t, token, 'complete_task', { task_id: task.id }, 'WEEK_OUT_OF_RANGE');
    expect(err.recovery).toMatch(/has not happened/i);
  });

  it('S-task-41-1 — a task under a PAST weekly goal is refused: there is no back-dating', async () => {
    const { month } = await tree();
    t.clock.set('2026-08-24T10:00:00.000Z');
    const past = (await ok(t, token, 'create_goal', { title: 'last week', horizon: 'Weekly', parent_id: month.id })).goal;
    t.clock.set('2026-08-31T10:00:00.000Z');
    await refused(t, token, 'create_task', { goal_id: past.id, title: 'back-dated' }, 'PERIOD_IN_PAST');
  });

  it('TASK_ALREADY_EXITED — and there is no fourth exit to offer instead', async () => {
    const { week } = await tree();
    const task = (await ok(t, token, 'create_task', { goal_id: week.id, title: 'One exit only' })).task;
    await ok(t, token, 'cancel_task', { task_id: task.id });

    const err = await refused(t, token, 'move_task_to_backlog', { task_id: task.id }, 'TASK_ALREADY_EXITED');
    expect(err.recovery).toMatch(/get_task/);

    // R-task-13 / R-nav-14 — defer, snooze and reschedule have no tool at all.
    const names = new Set(((await rpc(await mcp(t, token, 'tools/list'))).result.tools as Array<{ name: string }>).map((x) => x.name));
    for (const absent of ['defer_task', 'snooze_task', 'reschedule_task', 'move_task_to_week']) {
      expect(names.has(absent), `${absent} exists — the product has exactly three exits`).toBe(false);
    }
  });

  it('S-backlog-29-1 — move_task_to_backlog lands ABOVE the week, and the recovery explains why', async () => {
    const { month, week } = await tree();
    const task = (await ok(t, token, 'create_task', { goal_id: week.id, title: 'not this week after all' })).task;
    const moved = await ok(t, token, 'move_task_to_backlog', { task_id: task.id });
    expect(moved.item.goalId).toBe(month.id);
    expect(moved.item.goalId).not.toBe(week.id);
  });

  it('S-backlog-29-2 — a weekly goal hung off a LIFE goal has nowhere above its week to park work', async () => {
    const { life } = await tree();
    const orphanWeek = (await ok(t, token, 'create_goal', { title: 'a weekly practice', horizon: 'Weekly', parent_id: life.id })).goal;
    const task = (await ok(t, token, 'create_task', { goal_id: orphanWeek.id, title: 'nowhere to park' })).task;
    const err = await refused(t, token, 'move_task_to_backlog', { task_id: task.id }, 'LIFE_GOAL_NO_BACKLOG');
    expect(err.recovery).toMatch(/complete or cancel/i);
    // …and the other two exits genuinely still work.
    expect((await ok(t, token, 'cancel_task', { task_id: task.id })).task.status).toBe('canceled');
  });
});

describe('backlog', () => {
  it('happy path: park, edit, move, convert — and converting consumes the item', async () => {
    const { year, month } = await tree();
    const item = (await ok(t, token, 'create_backlog_item', { goal_id: month.id, title: 'Later work' })).item;
    await ok(t, token, 'update_backlog_item', { item_id: item.id, title: 'Later work, renamed' });
    expect((await ok(t, token, 'move_backlog_item', { item_id: item.id, goal_id: year.id })).new_goal_path).toContain('Get strong in 2026');

    const converted = await ok(t, token, 'convert_backlog_item_to_task', { item_id: item.id });
    expect(converted.task.title).toBe('Later work, renamed');
    expect(converted.item.status).toBe('converted');
    // Consumed, not duplicated: it is gone from every backlog list.
    expect((await ok(t, token, 'list_backlog')).items.find((i: any) => i.id === item.id)).toBeUndefined();
  });

  it('S-backlog-26-4 — a backlog item may never sit on a WEEKLY goal', async () => {
    const { week } = await tree();
    const err = await refused(t, token, 'create_backlog_item', { goal_id: week.id, title: 'nope' }, 'LIFE_GOAL_NO_BACKLOG');
    expect(err.recovery).toMatch(/never a weekly goal|has no week/i);
  });

  it('ALREADY_CONVERTED sends the agent to the task rather than re-creating the work', async () => {
    const { month } = await tree();
    const item = (await ok(t, token, 'create_backlog_item', { goal_id: month.id, title: 'Convert me once' })).item;
    await ok(t, token, 'convert_backlog_item_to_task', { item_id: item.id });

    const err = await refused(t, token, 'convert_backlog_item_to_task', { item_id: item.id }, 'ALREADY_CONVERTED');
    expect(err.retryable).toBe(false);
    expect(err.recovery).toMatch(/convertedToTaskId|get_task/);
    expect(err.recovery).toMatch(/do not re-create/i);
  });

  it('S-backlog-26-3 — AMBIGUOUS_CONVERSION_TARGET refuses to guess and names the candidates', async () => {
    const { life } = await tree();
    // Two Weekly goals for THIS week under one Yearly line, and an item on the Yearly goal.
    const year = (await ok(t, token, 'create_goal', { title: 'Two branches', horizon: 'Yearly', parent_id: life.id })).goal;
    const m1 = (await ok(t, token, 'create_goal', { title: 'Branch one', horizon: 'Monthly', parent_id: year.id })).goal;
    const m2 = (await ok(t, token, 'create_goal', { title: 'Branch two', horizon: 'Monthly', parent_id: year.id })).goal;
    const w1 = (await ok(t, token, 'create_goal', { title: 'one', horizon: 'Weekly', parent_id: m1.id })).goal;
    const w2 = (await ok(t, token, 'create_goal', { title: 'two', horizon: 'Weekly', parent_id: m2.id })).goal;
    const item = (await ok(t, token, 'create_backlog_item', { goal_id: year.id, title: 'Which week?' })).item;

    const err = await refused(t, token, 'convert_backlog_item_to_task', { item_id: item.id }, 'AMBIGUOUS_CONVERSION_TARGET');
    expect(err.details.candidates.map((c: any) => c.id).sort()).toEqual([w1.id, w2.id].sort());
    expect(err.recovery).toMatch(/Ask the user/);
    expect(err.recovery).toMatch(/do not pick the first candidate/i);

    // Naming one resolves it.
    expect((await ok(t, token, 'convert_backlog_item_to_task', { item_id: item.id, goal_id: w2.id })).task.goal_id).toBe(w2.id);
  });

  it('S-backlog-26-2 — NO_WEEKLY_GOAL is not a dead end: the recovery names the inline create', async () => {
    const { life } = await tree();
    const year = (await ok(t, token, 'create_goal', { title: 'no weeks here', horizon: 'Yearly', parent_id: life.id })).goal;
    const month = (await ok(t, token, 'create_goal', { title: 'empty month', horizon: 'Monthly', parent_id: year.id })).goal;
    const item = (await ok(t, token, 'create_backlog_item', { goal_id: month.id, title: 'nothing to hang it on' })).item;

    const err = await refused(t, token, 'convert_backlog_item_to_task', { item_id: item.id }, 'NO_WEEKLY_GOAL');
    expect(err.recovery).toMatch(/new_weekly_goal/);
    expect(err.recovery).toMatch(/do NOT pick a different goal/i);

    // …and taking that path works, atomically.
    const res = await ok(t, token, 'convert_backlog_item_to_task', {
      item_id: item.id,
      new_weekly_goal: { parent_id: month.id, title: 'empty month, this week' },
    });
    expect(res.created_weekly_goal.horizon).toBe('Weekly');
    expect(res.task.goal_id).toBe(res.created_weekly_goal.id);
  });

  it('LIFE_GOAL_NO_BACKLOG points at a descendant', async () => {
    const { life } = await tree();
    const err = await refused(t, token, 'create_backlog_item', { goal_id: life.id, title: 'nope' }, 'LIFE_GOAL_NO_BACKLOG');
    expect(err.recovery).toMatch(/Yearly, Quarterly or Monthly|can_hold_backlog/);
  });
});

describe('learnings', () => {
  it('happy path: learnings are tagged, badged, re-tagged and discarded — never converted', async () => {
    const { life } = await tree();
    const l = (await ok(t, token, 'capture_learning', { text: 'Mornings work better', goal_id: life.id })).learning;
    expect((await ok(t, token, 'update_learning', { learning_id: l.id, applied: true })).learning.applied).toBe(true);
    expect((await ok(t, token, 'attach_learning_to_goal', { learning_id: l.id, goal_id: null })).learning.goalId).toBeNull();
    expect((await ok(t, token, 'discard_learning', { learning_id: l.id })).deleted).toBe(true);

    // R-learning — there is deliberately no tool that turns a learning into work.
    const names = new Set(((await rpc(await mcp(t, token, 'tools/list'))).result.tools as Array<{ name: string }>).map((x) => x.name));
    for (const absent of ['convert_learning_to_task', 'convert_learning_to_backlog_item']) {
      expect(names.has(absent)).toBe(false);
    }
  });

  it("NOT_A_LIFE_GOAL — a learning's tag must be a Life goal, never a sub-goal", async () => {
    const { month } = await tree();
    const tagErr = await refused(t, token, 'capture_learning', { text: 'x', goal_id: month.id }, 'NOT_A_LIFE_GOAL');
    expect(tagErr.recovery).toMatch(/life goal|null/i);
  });
});

describe('account', () => {
  it('get_account reports the authoritative timezone and this week', async () => {
    const account = await ok(t, token, 'get_account');
    expect(account.preferences.timezone).toBeTruthy();
    expect(account.week.is_current).toBe(true);
    expect(account.week.offset).toBe(0);
    /**
     * SUPERSEDED — `week_history_weeks` advertised the week switcher's 8-week window as if it were a
     * data bound. R-rm-3 retires it: there is no bound in either direction (R-lens-7), and telling an
     * agent otherwise would make it refuse reads the API accepts.
     */
    expect(account).not.toHaveProperty('week_history_weeks');
  });

  it('change_password IS exposed, and its description carries the warning that is its only guard', async () => {
    const tools = (await rpc(await mcp(t, token, 'tools/list'))).result.tools as Array<{ name: string; description: string }>;
    const tool = tools.find((x) => x.name === 'change_password');
    expect(tool, 'the owner explicitly asked for this tool — it must be exposed').toBeTruthy();
    // The design recommended omitting it entirely; the owner overruled that. The description is the
    // only mitigation left, so its content is a tested deliverable rather than prose.
    expect(tool!.description).toMatch(/cannot send email|no "forgot password"/i);
    expect(tool!.description).toMatch(/locked out permanently/i);
    expect(tool!.description, 'the prompt-injection warning is missing').toMatch(/data, not instruction/i);
  });

  it('change_password refuses a wrong current password, without saying which half was wrong', async () => {
    const r = await callTool(t, token, 'change_password', { current_password: 'wrong', new_password: 'a-brand-new-password' });
    expect(r.isError).toBe(true);
    expect(r.payload.code).toBe('VALIDATION_FAILED');
    expect(r.payload.message).toBe('the current password is not correct');
  });
});

describe('resources', () => {
  it('serve the account context and the static rules', async () => {
    const { week } = await tree();
    await ok(t, token, 'create_task', { goal_id: week.id, title: 'something in the week' });
    const read = async (uri: string) => {
      const body = await rpc(await mcp(t, token, 'resources/read', { uri }));
      expect(body.error, `${uri} failed: ${JSON.stringify(body.error)}`).toBeUndefined();
      return body.result.contents[0].text as string;
    };

    // ⚠ **A2 (R-lens-16)** — `goalcascade://tree` and `tree/outline` are gone: there is no whole-tree
    // read to expose. `life` is the one unscoped list, and the week snapshot is a LENS.
    expect(JSON.parse(await read('goalcascade://life')).goals.length).toBeGreaterThan(0);
    const current = JSON.parse(await read('goalcascade://week/current'));
    expect(current.this_week.length).toBeGreaterThan(0);
    expect(current.tasks.length).toBeGreaterThan(0);
    expect(current.outline).toContain('Three gym sessions');
    // R-lens-12 — the band an agent most needs, because an open task whose goal's week has passed
    // renders nowhere else.
    expect(current).toHaveProperty('carried');
    expect(current).not.toHaveProperty('plan');
    expect(current).not.toHaveProperty('dormant_leaves');

    expect(JSON.parse(await read('goalcascade://account')).user.id).toBeTruthy();
    for (const uri of ['goalcascade://backlog', 'goalcascade://learnings']) {
      expect(JSON.parse(await read(uri)), uri).toBeTruthy();
    }

    // The rules resources are the ones an agent reads once and stops asking.
    expect(await read('goalcascade://rules/business-rules')).toContain('Goal Cascade — Business Rules');
    const weekModel = await read('goalcascade://rules/week-model');
    expect(weekModel).toContain('Weeks start on Monday');
    // ⚠ **A2** — the resource "most likely to be got wrong" must not still teach the retired bounds.
    expect(weekModel).not.toContain('Positive offsets do not exist');
    expect(weekModel).not.toContain('save_weekly_plan');
    expect(weekModel).toMatch(/Positive\noffsets are \*\*ordinary\*\*/);
    const errors = JSON.parse(await read('goalcascade://rules/errors'));
    expect(errors.NOT_A_WEEKLY_GOAL.retryable).toBe(false);
    expect(errors.PERIOD_IN_PAST.retryable).toBe(false);
    expect(errors.RATE_LIMITED.retryable).toBe(true);
    expect(errors.HORIZON_CONFLICT.recovery.length).toBeGreaterThan(40);
    expect(errors).not.toHaveProperty('BRANCH_NOT_ACTIVE');
  });

  /**
   * SUPERSEDED — "a past week resolves by its Monday; a FUTURE week never does". R-lens-7 supersedes
   * the second half: a future week is ordinary and readable, and its plan renders with no late styling
   * (R-lens-11). What survives is the Monday rule, which is D-1 and is unchanged.
   */
  it('S-lens-7-3 — a week resolves by its Monday, in EITHER direction; a non-Monday never does', async () => {
    for (const monday of ['2026-08-24', '2026-09-07', '2027-01-04']) {
      const body = await rpc(await mcp(t, token, 'resources/read', { uri: `goalcascade://week/${monday}` }));
      expect(body.error, `${monday} did not resolve`).toBeUndefined();
      expect(JSON.parse(body.result.contents[0].text).week.week_start).toBe(monday);
    }
    // Per-family surfacing: a resources/read failure is a JSON-RPC error, not an isError result.
    const tuesday = await rpc(await mcp(t, token, 'resources/read', { uri: 'goalcascade://week/2026-09-01' }));
    expect(tuesday.error, 'a Tuesday resolved as a week').toBeTruthy();
  });
});

describe('prompts', () => {
  it('carry the constraints that keep the workflow from going autonomous', async () => {
    const get = async (name: string, args: Record<string, unknown> = {}) =>
      (await rpc(await mcp(t, token, 'prompts/get', { name, arguments: args }))).result.messages[0].content.text as string;

    expect(await get('plan_the_week', { notes: 'busy week' })).toContain('busy week');
    expect(await get('plan_the_week')).toMatch(/Do not create, complete, or cancel any task/);
    // ⚠ **A2** — `plan_the_week` writes weekly GOALS now; it must not still walk a focus checklist.
    const plan = await get('plan_the_week');
    expect(plan).toMatch(/create_goal\(horizon="Weekly"\)/);
    expect(plan).not.toMatch(/set_goal_focus|save_weekly_plan|focus sentence/);
    // …and it must forbid the tidy-up an agent would otherwise reach for.
    expect(plan).toMatch(/do not delete a\s+weekly goal from a past week/);

    // Prompt arguments are STRINGS on the wire — `GetPromptRequest.params.arguments` is
    // `Record<string, string>`, and sending a number is a protocol violation (-32603), not a
    // convenience the server can accept. That is why `weeks` is `z.coerce.number()`: it parses the
    // string the protocol guarantees.
    expect(await get('review_the_carry', { weeks: '3' })).toMatch(/at least 3 weeks old/);
    expect(await get('review_the_carry')).toMatch(/Never offer to defer, snooze, reschedule/);
    expect(await get('triage_the_backlog', { goal: 'Health' })).toContain('under "Health"');
    expect(await get('goal_health_check')).toMatch(/Never propose deleting a goal/);
  });
});
