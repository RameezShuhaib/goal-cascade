import { TaskDetailResponse, TaskResponse, TasksResponse } from '@goal-cascade/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, signedInOwner } from '../helpers/app';
import { activate, codeOf, command, createTask, detail, key, kinds, listWeek, makeLine, seedTask, texts } from './helpers';

/**
 * The activity timeline — R-task-22..31, D-13, D-14.
 *
 * Every line in R-task-30's table needs a producer, and the timeline is the one place the product ever
 * says "I noticed". Two mockup bugs are covered here: D-14 (nothing produced the `Carried to week of …`
 * entries at all) and D-13 (link REMOVAL was silent while addition was logged).
 */
const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });

const MON = { aug17: '2026-08-17', aug24: '2026-08-24', aug31: '2026-08-31' } as const;
const at = (weekStart: string) => t.clock.set(`${weekStart}T10:00:00.000Z`);

beforeEach(() => at(MON.aug31));

async function openTask(originWeek: string = MON.aug31, body: Record<string, unknown> = {}) {
  const { cookie, userId } = await signedInOwner(t);
  const { leaf } = await makeLine(t, userId);
  at(originWeek);
  await activate(t, userId, leaf.id, originWeek);
  const task = await seedTask(t, cookie, { goalId: leaf.id, title: 'ship the thing', ...body });
  at(MON.aug31);
  return { cookie, userId, leaf, task };
}

describe('R-task-29 / D-14 / Q-17 — the carry log is produced lazily and cannot duplicate', () => {
  it('S-task-29-1 — an open task with origin −2 has exactly two Carried entries, in week order', async () => {
    const { cookie, task } = await openTask(MON.aug17);

    const d = await detail(t, cookie, task.id);
    const carried = d.task.events.filter((e) => e.kind === 'carried');
    expect(carried.map((e) => e.text)).toEqual(['Carried to week of Mon 31 Aug', 'Carried to week of Mon 24 Aug']);
    expect(carried.every((e) => e.glyph === '↻')).toBe(true);
    // Newest first: the carry into this week sits above the carry into last week, and both sit above
    // `Created`, which happened two weeks earlier.
    expect(kinds(d)).toEqual(['carried', 'carried', 'created']);
  });

  it('S-task-29-1 — re-reading the same week over and over adds nothing (idempotent on task+week)', async () => {
    const { cookie, task } = await openTask(MON.aug17);
    for (let i = 0; i < 4; i++) {
      await listWeek(t, cookie, 0);
      await listWeek(t, cookie, -1);
      await detail(t, cookie, task.id);
    }
    expect(kinds(await detail(t, cookie, task.id)).filter((k) => k === 'carried')).toHaveLength(2);
  });

  it('R-task-29 — a new week crossed adds exactly one more entry, with no user interaction', async () => {
    const { cookie, task } = await openTask(MON.aug24);
    expect(kinds(await detail(t, cookie, task.id)).filter((k) => k === 'carried')).toHaveLength(1);

    t.clock.advanceWeeks(1);
    await listWeek(t, cookie, 0);
    expect(kinds(await detail(t, cookie, task.id)).filter((k) => k === 'carried')).toHaveLength(2);
  });

  it('R-task-12 — a task in its own week, and a DONE task, are never logged as carried', async () => {
    const { cookie, task } = await openTask(MON.aug31);
    await listWeek(t, cookie, 0);
    expect(kinds(await detail(t, cookie, task.id))).toEqual(['created']);

    await command(t, cookie, `/api/tasks/${task.id}/complete`, {});
    t.clock.advanceWeeks(2);
    await listWeek(t, cookie, 0);
    await listWeek(t, cookie, -2);
    expect(kinds(await detail(t, cookie, task.id)).filter((k) => k === 'carried')).toEqual([]);
  });

  it('R-task-32 — an exited task stops carrying, and its log stops growing', async () => {
    const { cookie, task } = await openTask(MON.aug24);
    await command(t, cookie, `/api/tasks/${task.id}/cancel`, {});
    const before = kinds(await detail(t, cookie, task.id)).length;

    t.clock.advanceWeeks(3);
    await listWeek(t, cookie, 0);
    expect(kinds(await detail(t, cookie, task.id))).toHaveLength(before);
  });
});

describe('R-task-2/30 — Created carries its source', () => {
  it('S-task-31-1 — each of the three creation sources logs its own line', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { leaf } = await makeLine(t, userId);
    await activate(t, userId, leaf.id, MON.aug31);

    for (const [source, text] of [
      ['planning', 'Created — weekly planning'],
      ['backlog', 'Created — pulled from Backlog'],
      ['drawer', 'Created — added to this week'],
    ] as const) {
      const task = await seedTask(t, cookie, { goalId: leaf.id, title: `via ${source}`, source });
      const d = await detail(t, cookie, task.id);
      expect(texts(d)).toEqual([text]);
      expect(d.task.events[0]?.glyph).toBe('＋');
      expect(d.task.events[0]?.detail).toEqual({ source });
    }
  });

  it('S-task-3-1 — a task saved with no done-condition is created with cond = "" and no error', async () => {
    const { cookie, task } = await openTask();
    expect(task.cond).toBe('');
  });

  it('S-task-3-2 — a whitespace-only title is refused', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { leaf } = await makeLine(t, userId);
    await activate(t, userId, leaf.id, MON.aug31);
    const res = await createTask(t, cookie, { goalId: leaf.id, title: '   ' });
    expect(res.status).toBe(422);
  });
});

describe('R-task-23/26/27 — editing the task', () => {
  it('S-task-23-1 — one edit changing three fields logs exactly three events, newest first', async () => {
    const { cookie, task } = await openTask(MON.aug31, { cond: 'merged', description: 'old notes' });
    const res = await t.fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      cookie,
      json: { title: 'ship the other thing', cond: 'deployed', description: 'new notes' },
    });
    expect(res.status).toBe(200);

    const d = await detail(t, cookie, task.id);
    expect(kinds(d)).toEqual(['description_updated', 'cond_edited', 'renamed', 'created']);
    expect(texts(d)).toEqual([
      'Description updated',
      'Done-condition edited: "merged" → "deployed"',
      'Renamed: "ship the thing" → "ship the other thing"',
      'Created — weekly planning',
    ]);
    expect(d.task.title).toBe('ship the other thing');
    expect(d.task.version).toBe(2);
  });

  it('S-task-31-1 — a no-op edit writes nothing and logs nothing', async () => {
    const { cookie, task } = await openTask(MON.aug31, { cond: 'merged' });
    const res = await t.fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      cookie,
      json: { title: 'ship the thing', cond: 'merged' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TaskResponse;
    expect(body.task.version).toBe(1);
    expect(kinds(await detail(t, cookie, task.id))).toEqual(['created']);
  });

  it('S-task-27-1 — an empty old value renders as (none) and a long new value is cut to 24 chars', async () => {
    const { cookie, task } = await openTask();
    const long = 'x'.repeat(40);
    await t.fetch(`/api/tasks/${task.id}`, { method: 'PATCH', cookie, json: { cond: long } });
    expect(texts(await detail(t, cookie, task.id))[0]).toBe(`Done-condition edited: "(none)" → "${'x'.repeat(24)}…"`);
  });

  it('S-task-26-1 — a DONE task stays editable; only the exits are withdrawn', async () => {
    const { cookie, task } = await openTask();
    await command(t, cookie, `/api/tasks/${task.id}/complete`, {});
    const res = await t.fetch(`/api/tasks/${task.id}`, { method: 'PATCH', cookie, json: { title: 'renamed while done' } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as TaskResponse).task.title).toBe('renamed while done');
  });

  it('Q-2 — a stale version loses the race cleanly (409), rather than half-applying', async () => {
    const { cookie, task } = await openTask();
    await t.fetch(`/api/tasks/${task.id}`, { method: 'PATCH', cookie, json: { title: 'first' } });
    const stale = await t.fetch(`/api/tasks/${task.id}`, { method: 'PATCH', cookie, json: { title: 'second', version: 1 } });
    expect(stale.status).toBe(409);
    expect(await codeOf(stale)).toBe('CONCURRENT_UPDATE');
    // The event did not commit without its cause.
    expect(kinds(await detail(t, cookie, task.id))).toEqual(['renamed', 'created']);
  });
});

describe('R-task-24/25 / D-13 — links are logged both ways', () => {
  it('S-task-24-1 — a www URL is logged under its bare hostname', async () => {
    const { cookie, task } = await openTask();
    const res = await command(t, cookie, `/api/tasks/${task.id}/links`, { url: 'https://www.github.com/acme/pr/1' });
    expect(res.status).toBe(200);
    const d = await detail(t, cookie, task.id);
    expect(texts(d)[0]).toBe('Link added: github.com');
    expect(d.task.links.map((l) => l.url)).toEqual(['https://www.github.com/acme/pr/1']);
  });

  it('S-task-24-2 — a non-http(s) string is refused by the contract, not stored half-validated', async () => {
    const { cookie, task } = await openTask();
    const res = await command(t, cookie, `/api/tasks/${task.id}/links`, { url: `ftp://example.com/${'a'.repeat(40)}` });
    expect(res.status).toBe(422);
  });

  it('R-task-25 / D-13 — removing a link logs Link removed: <host>', async () => {
    const { cookie, task } = await openTask();
    await command(t, cookie, `/api/tasks/${task.id}/links`, { url: 'https://docs.example.com/spec' });
    const withLink = await detail(t, cookie, task.id);
    const linkId = withLink.task.links[0]!.id;

    const res = await t.fetch(`/api/tasks/${task.id}/links/${linkId}`, { method: 'DELETE', cookie });
    expect(res.status).toBe(200);

    const d = await detail(t, cookie, task.id);
    expect(d.task.links).toEqual([]);
    expect(texts(d)[0]).toBe('Link removed: docs.example.com');
    expect(kinds(d)).toEqual(['link_removed', 'link_added', 'created']);
  });

  it('R-auth-3 — a link id that is not on this task is a plain 404', async () => {
    const { cookie, task } = await openTask();
    const res = await t.fetch(`/api/tasks/${task.id}/links/01JGXBQ8QY0000000000000000`, { method: 'DELETE', cookie });
    expect(res.status).toBe(404);
  });
});

describe('R-task-30/31 — the timeline is server-authored and read-only', () => {
  it('S-task-30-1 — there is no endpoint that creates, edits or deletes a TaskEvent', async () => {
    const { cookie, task } = await openTask();
    for (const [method, path] of [
      ['POST', `/api/tasks/${task.id}/events`],
      ['PATCH', `/api/tasks/${task.id}/events/01JGXBQ8QY0000000000000000`],
      ['DELETE', `/api/tasks/${task.id}/events/01JGXBQ8QY0000000000000000`],
    ] as const) {
      const res = await t.fetch(path, { method, cookie, headers: { 'Idempotency-Key': key() }, json: { text: 'nope' } });
      expect(res.status).toBe(404);
    }
  });

  it('S-task-30-1 — a client cannot smuggle event or status fields through a task write', async () => {
    const { cookie, task } = await openTask();
    for (const json of [{ events: [] }, { status: 'done' }, { originWeekStart: '2026-08-24' }]) {
      const res = await t.fetch(`/api/tasks/${task.id}`, { method: 'PATCH', cookie, json });
      expect(res.status).toBe(422);
    }
  });

  it('R-auth-3 — another owner’s task is a plain 404, in read and in write', async () => {
    const { cookie, task } = await openTask();
    const intruder = await signedInOwner(t);
    expect((await t.fetch(`/api/tasks/${task.id}`, { cookie: intruder.cookie })).status).toBe(404);
    expect((await command(t, intruder.cookie, `/api/tasks/${task.id}/cancel`, {})).status).toBe(404);
  });

  it('the responses match the shared contract exactly', async () => {
    const { cookie, task } = await openTask(MON.aug17, { links: ['https://example.com/a'], cond: 'merged' });
    TasksResponse.parse(await listWeek(t, cookie, 0));
    TaskDetailResponse.parse(await detail(t, cookie, task.id));
    const res = await command(t, cookie, `/api/tasks/${task.id}/complete`, { week: -1 });
    TaskResponse.parse(await res.json());
  });
});
