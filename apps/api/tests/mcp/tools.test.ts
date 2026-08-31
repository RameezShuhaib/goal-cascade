import { beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signedInOwner } from '../helpers/app';
import { callTool, mcp, mintToken, ok, refused, rpc } from './helpers';

const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' }); // a Monday

let token: string;
let cookie: string;

/** The fixture every family builds on: Life › Yearly › Monthly, with the Monthly leaf active. */
async function tree() {
  const life = (await ok(t, token, 'create_goal', { title: `Health ${crypto.randomUUID()}`, horizon: 'Life', parent_id: null })).goal;
  const year = (await ok(t, token, 'create_goal', { title: 'Get strong in 2026', horizon: 'Yearly', parent_id: life.id })).goal;
  const month = (await ok(t, token, 'create_goal', { title: 'Sep 2026', horizon: 'Monthly', parent_id: year.id })).goal;
  await ok(t, token, 'set_goal_focus', { goal_id: month.id, sentence: 'Three gym sessions and one long run.' });
  return { life, year, month };
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

    // 42 from the design + `change_password` (the owner explicitly added it by overruling rail 2),
    // minus the 5 idea tools retired with the Ideas entity.
    expect(tools).toHaveLength(38);
    expect(resources.length + templates.length).toBe(10);
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

  it('advertises the instructions block, which is what teaches the model the product', async () => {
    // NOT `initialize` — the 2026-07-28 revision removed it (it answers -32601 Method not found).
    // A stateless server has no handshake; `server/discover` is where a client reads the server's
    // capabilities and its instructions.
    const discover = await rpc(await mcp(t, token, 'server/discover', {}));
    expect(discover.result.supportedVersions).toContain('2026-07-28');
    const instructions: string = discover.result?.instructions ?? '';
    for (const anchor of ['Life › Yearly › Quarterly › Monthly', 'LEAF, ACTIVE, DORMANT', 'THE WEEK', 'CARRYING', 'THE THREE EXITS', 'HOW TO WORK']) {
      expect(instructions, `the instructions block is missing "${anchor}"`).toContain(anchor);
    }
  });

  it('.refine() rules are dropped from the advertised schema, so they are stated in the description', async () => {
    // zod → JSON Schema loses `.refine()`. `WeekStart`'s "must be a Monday" and `Url`'s "http(s) only"
    // are both refinements, so the MODEL can only learn them from the prose. This asserts it can.
    const tools = (await rpc(await mcp(t, token, 'tools/list'))).result.tools as Array<{ name: string; description: string; inputSchema: any }>;
    const save = tools.find((x) => x.name === 'save_weekly_plan')!;
    const weekStart = save.inputSchema.properties.week_start;
    // The advertised schema is `format: date` plus a generic ISO-date pattern. Nothing in it can
    // express "and it must be a Monday" — a Tuesday satisfies the pattern completely.
    expect(new RegExp(weekStart.pattern).test('2026-09-01'), 'the Monday rule IS advertised now').toBe(true);
    // …so the rule survives only in the prose the model actually reads.
    expect(weekStart.description).toMatch(/Monday/);
    expect(save.description).toMatch(/Monday/);
    expect(tools.find((x) => x.name === 'add_task_link')!.description).toMatch(/http/i);
  });
});

describe('goals', () => {
  it('happy path: create, find, read, replan, move', async () => {
    const { life, year, month } = await tree();

    const found = await ok(t, token, 'find_goal', { query: 'Sep 2026' });
    expect(found.matches[0].id).toBe(month.id);
    expect(found.matches[0].path).toContain('Get strong in 2026 › Sep 2026');

    const detail = await ok(t, token, 'get_goal', { goal_id: month.id });
    expect(detail.goal.is_active).toBe(true);
    expect(detail.replan_options.length).toBeGreaterThan(0);

    const replanned = await ok(t, token, 'replan_goal', { goal_id: month.id, period: detail.replan_options[0] });
    expect(replanned.goal.period).toBe(detail.replan_options[0]);
    // R-goal-13 / D-3 — an omitted period is derived from TODAY and the horizon, never from the title.
    // The fixture's goal is *called* "Sep 2026" but the clock says August, so its period is "Aug 2026".
    expect(detail.goal.period).toBe('Aug 2026');
    expect(replanned.previous_period).toBe(detail.goal.period);

    const moved = await ok(t, token, 'move_goal', { goal_id: month.id, new_parent_id: life.id });
    expect(moved.new_path).toBe(`${life.title} › ${month.title}`);
    expect(moved.moved_descendants).toBe(0);
    void year;
  });

  it('HORIZON_CONFLICT tells the agent what to do differently', async () => {
    const { month } = await tree();
    const err = await refused(t, token, 'create_goal', { title: 'Under a Monthly', horizon: 'Monthly', parent_id: month.id }, 'HORIZON_CONFLICT');
    expect(err.retryable, 'a 409 in this product means "do something else", never "retry"').toBe(false);
    expect(err.recovery).toMatch(/Monthly is terminal|shorter/i);
    expect(err.recovery).toMatch(/different parent|shorter horizon/i);
  });

  it('WOULD_CREATE_CYCLE says plainly that a goal cannot move under its own child', async () => {
    const { year, month } = await tree();
    const err = await refused(t, token, 'move_goal', { goal_id: year.id, new_parent_id: month.id }, 'WOULD_CREATE_CYCLE');
    expect(err.retryable).toBe(false);
    expect(err.recovery).toMatch(/own child|descendant/i);
    expect(err.recovery).toMatch(/Never retry/i);
  });

  it('preview_goal_deletion counts a LEAF too, and writes nothing', async () => {
    const { month } = await tree();
    await ok(t, token, 'create_task', { goal_id: month.id, title: 'A task that would be destroyed' });
    await ok(t, token, 'create_backlog_item', { goal_id: month.id, title: 'An item that would be destroyed' });

    const preview = await ok(t, token, 'preview_goal_deletion', { goal_id: month.id });
    // This is the case the API's own guard could never report: a leaf deletes silently.
    expect(preview.requires_cascade).toBe(false);
    expect(preview.would_remove.goals).toBe(1);
    expect(preview.would_remove.tasks).toBe(1);
    expect(preview.would_remove.backlog_items).toBe(1);
    expect(preview.would_remove.task_events).toBeGreaterThan(0);
    expect(preview.would_remove.weekly_focuses).toBe(1);

    // Nothing was written: the goal, its task and its item are all still there.
    expect((await ok(t, token, 'get_goal', { goal_id: month.id })).goal.id).toBe(month.id);
    expect((await ok(t, token, 'list_tasks', { goal_id: month.id })).tasks).toHaveLength(1);
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
    expect(deleted.removed.goals).toBe(3);
    await refused(t, token, 'get_goal', { goal_id: life.id }, 'NOT_FOUND');
  });
});

describe('the weekly plan', () => {
  it('set_goal_focus activates one branch and leaves the others alone', async () => {
    const a = await tree();
    const b = await tree();
    expect((await ok(t, token, 'get_weekly_plan')).entries.map((e: any) => e.goal_id)).toEqual(
      expect.arrayContaining([a.month.id, b.month.id]),
    );

    await ok(t, token, 'set_goal_focus', { goal_id: a.month.id, sentence: 'A new sentence.' });
    const plan = await ok(t, token, 'get_weekly_plan');
    expect(plan.entries.find((e: any) => e.goal_id === a.month.id).sentence).toBe('A new sentence.');
    // The wrapper's whole reason for existing: b is untouched by a write aimed at a.
    expect(plan.entries.find((e: any) => e.goal_id === b.month.id)).toBeTruthy();
  });

  it('clear_goal_focus makes a branch dormant WITHOUT deleting its open tasks', async () => {
    const { month } = await tree();
    await ok(t, token, 'create_task', { goal_id: month.id, title: 'Still mine after the branch sleeps' });

    const cleared = await ok(t, token, 'clear_goal_focus', { goal_id: month.id });
    expect(cleared.cleared).toBe(true);
    expect(cleared.open_tasks_kept, 'R-plan-6 — clearing a focus must not touch tasks').toBe(1);
    expect((await ok(t, token, 'get_goal', { goal_id: month.id })).goal.dormant).toBe(true);
    expect((await ok(t, token, 'list_tasks', { goal_id: month.id })).tasks).toHaveLength(1);
  });

  it('save_weekly_plan replaces the whole week and REPORTS what it deactivated', async () => {
    const a = await tree();
    const b = await tree();
    const week = (await ok(t, token, 'get_weekly_plan')).week.week_start;

    // b is omitted, so it goes dormant. The owner chose no `confirm_deactivations` gate — so the
    // guarantee is that the agent is TOLD, not that it is stopped.
    const saved = await ok(t, token, 'save_weekly_plan', {
      week_start: week,
      entries: [{ goal_id: a.month.id, sentence: 'Only this one.' }],
    });
    expect(saved.deactivated.map((d: any) => d.id)).toContain(b.month.id);
    expect(saved.entries).toHaveLength(1);
    expect((await ok(t, token, 'get_goal', { goal_id: b.month.id })).goal.dormant).toBe(true);
  });

  it('NOT_A_LEAF points the agent at find_goal(only="leaves")', async () => {
    const { year } = await tree();
    const err = await refused(t, token, 'set_goal_focus', { goal_id: year.id, sentence: 'x' }, 'NOT_A_LEAF');
    expect(err.recovery).toMatch(/find_goal/);
    expect(err.recovery).toMatch(/leaves/);
  });

  it('WEEK_NOT_CURRENT tells the agent to re-read for a fresh week_start', async () => {
    const { month } = await tree();
    const err = await refused(
      t,
      token,
      'save_weekly_plan',
      { week_start: '2026-08-24', entries: [{ goal_id: month.id, sentence: 'last week' }] },
      'WEEK_NOT_CURRENT',
    );
    expect(err.recovery).toMatch(/get_weekly_plan/);
    expect(err.retryable).toBe(false);
  });
});

describe('tasks', () => {
  it('happy path: create, edit, link, complete, uncheck', async () => {
    const { month } = await tree();
    const created = (await ok(t, token, 'create_task', { goal_id: month.id, title: 'Book the physio', cond: 'Appointment in the calendar' })).task;
    expect(created.goal_path).toContain('Sep 2026');
    expect(created.status).toBe('open');

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

  it('BRANCH_NOT_ACTIVE forbids the one substitution that would look like success', async () => {
    const { month } = await tree();
    await ok(t, token, 'clear_goal_focus', { goal_id: month.id });
    const err = await refused(t, token, 'create_task', { goal_id: month.id, title: 'nope' }, 'BRANCH_NOT_ACTIVE');
    expect(err.retryable).toBe(false);
    expect(err.recovery).toMatch(/set_goal_focus/);
    // The critical sentence: never quietly route the work somewhere that IS active.
    expect(err.recovery).toMatch(/Never route the task to a DIFFERENT goal/);
  });

  it('TASK_ALREADY_EXITED — and there is no fourth exit to offer instead', async () => {
    const { month } = await tree();
    const task = (await ok(t, token, 'create_task', { goal_id: month.id, title: 'One exit only' })).task;
    await ok(t, token, 'cancel_task', { task_id: task.id });

    const err = await refused(t, token, 'move_task_to_backlog', { task_id: task.id }, 'TASK_ALREADY_EXITED');
    expect(err.recovery).toMatch(/get_task/);

    // R-task-13 / R-nav-14 — defer, snooze and reschedule have no tool at all.
    const names = new Set(((await rpc(await mcp(t, token, 'tools/list'))).result.tools as Array<{ name: string }>).map((x) => x.name));
    for (const absent of ['defer_task', 'snooze_task', 'reschedule_task', 'move_task_to_week']) {
      expect(names.has(absent), `${absent} exists — the product has exactly three exits`).toBe(false);
    }
  });

  it('under_goal_id filters a whole branch; goal_id filters the exact leaf', async () => {
    const { life, month } = await tree();
    await ok(t, token, 'create_task', { goal_id: month.id, title: 'In the branch' });
    expect((await ok(t, token, 'list_tasks', { under_goal_id: life.id })).tasks.length).toBeGreaterThan(0);
    expect((await ok(t, token, 'list_tasks', { goal_id: life.id })).tasks).toHaveLength(0);
  });
});

describe('backlog', () => {
  it('happy path: park, edit, move, convert — and converting consumes the item', async () => {
    const { year, month } = await tree();
    const item = (await ok(t, token, 'create_backlog_item', { goal_id: month.id, title: 'Later work' })).item;
    await ok(t, token, 'update_backlog_item', { item_id: item.id, title: 'Later work, renamed' });
    expect((await ok(t, token, 'move_backlog_item', { item_id: item.id, goal_id: year.id })).new_goal_path).toContain('Get strong in 2026');

    const listed = await ok(t, token, 'list_backlog', { convertible_only: true });
    expect(listed.items.find((i: any) => i.id === item.id).convertible).toBe(true);

    const converted = await ok(t, token, 'convert_backlog_item_to_task', { item_id: item.id });
    expect(converted.task.title).toBe('Later work, renamed');
    expect(converted.item.status).toBe('converted');
    // Consumed, not duplicated: it is gone from every backlog list.
    expect((await ok(t, token, 'list_backlog')).items.find((i: any) => i.id === item.id)).toBeUndefined();
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

  it('AMBIGUOUS_CONVERSION_TARGET refuses to guess and names the candidates', async () => {
    const { life } = await tree();
    // Two active Monthly leaves under one Yearly goal, and an item on the Yearly goal.
    const year = (await ok(t, token, 'create_goal', { title: 'Two branches', horizon: 'Yearly', parent_id: life.id })).goal;
    const m1 = (await ok(t, token, 'create_goal', { title: 'Branch one', horizon: 'Monthly', parent_id: year.id })).goal;
    const m2 = (await ok(t, token, 'create_goal', { title: 'Branch two', horizon: 'Monthly', parent_id: year.id })).goal;
    await ok(t, token, 'set_goal_focus', { goal_id: m1.id, sentence: 'one' });
    await ok(t, token, 'set_goal_focus', { goal_id: m2.id, sentence: 'two' });
    const item = (await ok(t, token, 'create_backlog_item', { goal_id: year.id, title: 'Which branch?' })).item;

    const err = await refused(t, token, 'convert_backlog_item_to_task', { item_id: item.id }, 'AMBIGUOUS_CONVERSION_TARGET');
    expect(err.details.candidates.map((c: any) => c.id).sort()).toEqual([m1.id, m2.id].sort());
    expect(err.recovery).toMatch(/Ask the user/);
    expect(err.recovery).toMatch(/do not pick the first candidate/i);

    // Naming one resolves it.
    expect((await ok(t, token, 'convert_backlog_item_to_task', { item_id: item.id, goal_id: m2.id })).task.goal_id).toBe(m2.id);
  });

  it('LIFE_GOAL_NO_BACKLOG points at a descendant', async () => {
    const { life } = await tree();
    const err = await refused(t, token, 'create_backlog_item', { goal_id: life.id, title: 'nope' }, 'LIFE_GOAL_NO_BACKLOG');
    expect(err.recovery).toMatch(/descendant|can_hold_backlog/);
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
    expect(tagErr.recovery).toMatch(/Life root|null/i);
  });
});

describe('account', () => {
  it('get_account reports the authoritative timezone and this week', async () => {
    const account = await ok(t, token, 'get_account');
    expect(account.preferences.timezone).toBeTruthy();
    expect(account.week.is_current).toBe(true);
    expect(account.week.offset).toBe(0);
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
    await tree();
    const read = async (uri: string) => {
      const body = await rpc(await mcp(t, token, 'resources/read', { uri }));
      expect(body.error, `${uri} failed: ${JSON.stringify(body.error)}`).toBeUndefined();
      return body.result.contents[0].text as string;
    };

    expect(await read('goalcascade://tree/outline')).toContain('Sep 2026');
    expect(JSON.parse(await read('goalcascade://tree')).goals.length).toBeGreaterThan(0);
    expect(JSON.parse(await read('goalcascade://week/current')).plan.length).toBeGreaterThan(0);
    expect(JSON.parse(await read('goalcascade://account')).user.id).toBeTruthy();
    for (const uri of ['goalcascade://backlog', 'goalcascade://learnings']) {
      expect(JSON.parse(await read(uri)), uri).toBeTruthy();
    }

    // The rules resources are the ones an agent reads once and stops asking.
    expect(await read('goalcascade://rules/business-rules')).toContain('Goal Cascade — Business Rules');
    expect(await read('goalcascade://rules/week-model')).toContain('Weeks start on Monday');
    const errors = JSON.parse(await read('goalcascade://rules/errors'));
    expect(errors.BRANCH_NOT_ACTIVE.retryable).toBe(false);
    expect(errors.RATE_LIMITED.retryable).toBe(true);
    expect(errors.HORIZON_CONFLICT.recovery.length).toBeGreaterThan(40);
  });

  it('a past week resolves by its Monday; a future week never does', async () => {
    const body = await rpc(await mcp(t, token, 'resources/read', { uri: 'goalcascade://week/2026-08-24' }));
    expect(JSON.parse(body.result.contents[0].text).week.week_start).toBe('2026-08-24');

    // Per-family surfacing: a resources/read failure is a JSON-RPC error, not an isError result.
    const future = await rpc(await mcp(t, token, 'resources/read', { uri: 'goalcascade://week/2026-09-07' }));
    expect(future.error, 'a future week resolved').toBeTruthy();
  });
});

describe('prompts', () => {
  it('carry the constraints that keep the workflow from going autonomous', async () => {
    const get = async (name: string, args: Record<string, unknown> = {}) =>
      (await rpc(await mcp(t, token, 'prompts/get', { name, arguments: args }))).result.messages[0].content.text as string;

    expect(await get('plan_the_week', { notes: 'busy week' })).toContain('busy week');
    expect(await get('plan_the_week')).toMatch(/Do not create, complete, or cancel any task/);
    // Prompt arguments are STRINGS on the wire — `GetPromptRequest.params.arguments` is
    // `Record<string, string>`, and sending a number is a protocol violation (-32603), not a
    // convenience the server can accept. That is why `weeks` is `z.coerce.number()`: it parses the
    // string the protocol guarantees. Prompts advertise no JSON Schema (only name/description/
    // required), so the coercion is invisible to the model and cannot mislead it.
    expect(await get('review_the_carry', { weeks: '3' })).toMatch(/at least 3 weeks old/);
    expect(await get('review_the_carry')).toMatch(/Never offer to defer, snooze, reschedule/);
    expect(await get('triage_the_backlog', { goal: 'Health' })).toContain('under "Health"');
    expect(await get('goal_health_check')).toMatch(/Never propose deleting a goal/);
  });
});
