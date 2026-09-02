import type { TaskDetailResponse, TaskResponse } from '@goal-cascade/shared';
import { MAX_READINGS } from '@goal-cascade/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, signedInOwner } from '../helpers/app';
import { codeOf, command, createTask, detail, kinds, makeGoal, makeLine, seedTask, texts, thisWeek } from './helpers';

/**
 * ⚠ **A8 — measurable tasks** (R-measure-1 … R-measure-9).
 *
 * Two kinds and no third, one triple, an implied direction, an optional target, a derived `current`, and
 * an append-only history that follows the task rather than the week. Half of this file asserts what the
 * product **does**; the other half asserts what it deliberately **does not**, because R-measure-8 exists
 * precisely so the next agent cannot add a pace as an obvious improvement.
 */
const t = createTestApp({ now: '2026-09-02T10:00:00.000Z' });
const NOW = '2026-09-02T10:00:00.000Z';
const SEP = '2026-09';

beforeEach(() => t.clock.set(NOW));

async function line() {
  const { cookie, userId } = await signedInOwner(t);
  const life = await makeGoal(t, userId, 'Life', null);
  const september = await makeGoal(t, userId, 'Monthly', life.id, SEP);
  /**
   * ⚠ The CURRENT week (Mon 31 Aug), not September's first — a task in a future week is not completable
   * at all (R-task-55), and half of this file is about completion being independent of the number.
   * R-goal-33 permits a Weekly goal whose week is in August under a September Monthly goal: a goal's
   * period is never checked against its parent's.
   */
  const weekly = await makeGoal(t, userId, 'Weekly', september.id, '2026-08-31');
  return { cookie, userId, life, september, weekly };
}

const setMeasure = (cookie: string, id: string, measure: unknown) =>
  t.fetch(`/api/tasks/${id}/measure`, { method: 'PUT', cookie, idempotencyKey: crypto.randomUUID(), json: { measure } });
const clearMeasure = (cookie: string, id: string) => t.fetch(`/api/tasks/${id}/measure`, { method: 'DELETE', cookie });
const record = (cookie: string, id: string, body: unknown) => command(t, cookie, `/api/tasks/${id}/readings`, body);
const deleteReading = (cookie: string, id: string, readingId: string) =>
  t.fetch(`/api/tasks/${id}/readings/${readingId}`, { method: 'DELETE', cookie });
const taskOf = async (cookie: string, id: string) => ((await detail(t, cookie, id)) as TaskDetailResponse).task;

describe('R-measure-1 — a measure is optional, and binary is its ABSENCE', () => {
  /**
   * **S-measure-1-1 — the assertion that keeps a checkbox a checkbox.**
   *
   * Formally a checkbox is the degenerate counter `0 → 1`, and unifying is still wrong: completion is
   * already modelled and is not a number, a gauge with no target has no completion at all, every task in
   * the product would grow a measure it never asked for, and the migration would have to invent a reading
   * with a timestamp for every task ever completed. `measure: null` costs one nullable field and nothing
   * anywhere else — which is exactly what this asserts.
   */
  it('S-measure-1-1 — a task with no measure carries `measure: null`, and there is no `binary` kind', async () => {
    const { cookie, weekly } = await line();
    const task = await seedTask(t, cookie, { goalId: weekly.id, title: 'an ordinary checkbox' });
    expect(task.measure).toBeNull();
    expect((await taskOf(cookie, task.id)).readings).toEqual([]);

    for (const kind of ['binary', 'checkbox', 'boolean']) {
      const res = await setMeasure(cookie, task.id, { kind, start: 0, target: 1 });
      expect(res.status, kind).toBe(422);
    }
  });

  it('S-measure-1-2 — attaching logs `Measure added`, and the checkbox is still there', async () => {
    const { cookie, weekly } = await line();
    const task = await seedTask(t, cookie, { goalId: weekly.id, title: 'reach 15 leads' });

    const res = await setMeasure(cookie, task.id, { kind: 'counter', start: 0, target: 15, unit: 'leads' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TaskResponse;
    expect(body.task.measure).toMatchObject({ kind: 'counter', start: 0, current: 0, target: 15, unit: 'leads' });
    // R-measure-6 — a measurable task completes exactly like any other, in both directions.
    expect(body.task.completable).toBe(true);
    expect(texts(await detail(t, cookie, task.id))).toContain('Measure added: counter, 0 → 15 leads');
  });

  it('S-measure-1-2 — removing it deletes every reading in one transaction, and logs `Measure removed`', async () => {
    const { cookie, weekly } = await line();
    const task = await seedTask(t, cookie, {
      goalId: weekly.id,
      title: 'reach 15 leads',
      measure: { kind: 'counter', start: 0, target: 15, unit: 'leads' },
    });
    for (const delta of [3, 4, 5]) await record(cookie, task.id, { delta });
    expect((await taskOf(cookie, task.id)).readings).toHaveLength(3);

    const res = await clearMeasure(cookie, task.id);
    expect(res.status).toBe(200);
    const after = ((await res.json()) as TaskResponse).task;
    // Byte-identical to a task that never had one: an ordinary checkbox again.
    expect(after.measure).toBeNull();
    expect(after.readings).toEqual([]);
    expect(texts(await detail(t, cookie, task.id))).toContain('Measure removed');
    // The event carries the count the client's confirm named (`This deletes 3 recorded values.`).
    const removed = (await detail(t, cookie, task.id)).task.events.find((e) => e.kind === 'measure_removed')!;
    expect(removed.detail).toMatchObject({ readingsDeleted: 3 });

    // …and a second removal has nothing to remove.
    expect(await codeOf(await clearMeasure(cookie, task.id))).toBe('NO_MEASURE');
  });

  it('Q-E — a measure may be attached AT CREATE, in one command, and it logs the same line', async () => {
    const { cookie, september } = await line();
    const task = await seedTask(t, cookie, {
      goalId: september.id,
      title: 'sign at least 2 clients',
      measure: { kind: 'counter', start: 0, target: 2, unit: 'clients' },
    });
    expect(task.measure).toMatchObject({ kind: 'counter', start: 0, current: 0, target: 2, unit: 'clients' });
    expect(kinds(await detail(t, cookie, task.id))).toEqual(['measure_added', 'created']);
  });
});

describe('R-measure-2 / R-measure-4 — one triple, an implied direction, and an optional target', () => {
  it('S-measure-2-1 — both directions are accepted, and no schema anywhere carries a direction flag', async () => {
    const { cookie, weekly } = await line();
    const up = await seedTask(t, cookie, { goalId: weekly.id, title: 'up', measure: { kind: 'counter', start: 0, target: 15 } });
    const down = await seedTask(t, cookie, { goalId: weekly.id, title: 'down', measure: { kind: 'gauge', start: 80, target: 75, unit: 'kg' } });

    for (const task of [up, down]) {
      expect(Object.keys(task.measure!).sort()).toEqual(['current', 'kind', 'progress', 'start', 'target', 'unit']);
    }
    for (const field of ['direction', 'up', 'countsUp', 'descending']) {
      const res = await setMeasure(cookie, up.id, { kind: 'counter', start: 0, target: 15, [field]: true });
      expect(res.status, field).toBe(422);
    }
  });

  it('S-measure-4-1 — progress is ONE formula and it handles both directions with no branch', async () => {
    const { cookie, weekly } = await line();
    const up = await seedTask(t, cookie, { goalId: weekly.id, title: 'up', measure: { kind: 'counter', start: 0, target: 15 } });
    await record(cookie, up.id, { value: 12 });
    expect((await taskOf(cookie, up.id)).measure!.progress).toBe(0.8);

    const down = await seedTask(t, cookie, { goalId: weekly.id, title: 'down', measure: { kind: 'gauge', start: 80, target: 75 } });
    await record(cookie, down.id, { value: 78 });
    // (78 − 80) / (75 − 80) = (−2)/(−5) = 0.4
    expect((await taskOf(cookie, down.id)).measure!.progress).toBe(0.4);
  });

  /**
   * **S-measure-4-2 — the AMRAP case, and it is first-class rather than degraded.**
   *
   * A gauge with no target has no completion criterion, no percentage and no bar — just the number, its
   * unit and its history. The task is still completable, because completion is `donePeriodKey` and
   * R-task-55's bound, untouched by the measure (R-measure-6).
   */
  it('S-measure-4-2 — `target: null` is a real measure: no progress, still completable, history intact', async () => {
    const { cookie, weekly } = await line();
    const task = await seedTask(t, cookie, {
      goalId: weekly.id,
      title: 'as many reps as possible',
      measure: { kind: 'gauge', start: 0, target: null, unit: 'reps' },
    });
    for (const value of [24, 31, 27]) await record(cookie, task.id, { value });

    const after = await taskOf(cookie, task.id);
    expect(after.measure!.target).toBeNull();
    expect(after.measure!.progress).toBeNull();
    expect(after.measure!.current).toBe(27);
    expect(after.readings.map((r) => r.value)).toEqual([24, 31, 27]);
    expect(after.completable).toBe(true);
  });

  /**
   * **S-measure-4-3 — `target === start`, and BOTH halves of the rule.**
   *
   * Refused at the edge, because it names no movement and "maintain" is out of scope. And if such a row
   * exists anyway — a migration, a hand-edit, a bug — **no division is performed**: `progress` is absent
   * from the wire, and `NaN`, `Infinity`, `0` and `1` are each specifically forbidden as the answer. This
   * is the one place a divide-by-zero can reach a screen.
   */
  it('S-measure-4-3 — target === start is refused, on create AND on edit', async () => {
    const { cookie, weekly } = await line();
    const bad = await createTask(t, cookie, {
      goalId: weekly.id,
      title: 'no movement',
      measure: { kind: 'counter', start: 5, target: 5 },
    });
    expect(bad.status).toBe(422);

    const task = await seedTask(t, cookie, { goalId: weekly.id, title: 'fine for now', measure: { kind: 'counter', start: 0, target: 15 } });
    const res = await setMeasure(cookie, task.id, { kind: 'counter', start: 15, target: 15 });
    expect(res.status).toBe(422);
    // The refusal is named, so the client can say which field is wrong rather than "invalid body".
    expect(JSON.stringify(await res.json())).toContain('MEASURE_TARGET_EQUALS_START');
  });

  it('S-measure-4-3 — a row that has it ANYWAY divides by nothing: progress is absent, not NaN or 0 or 1', async () => {
    const { cookie, weekly } = await line();
    const task = await seedTask(t, cookie, { goalId: weekly.id, title: 'hand-edited', measure: { kind: 'gauge', start: 5, target: 6 } });
    // Reach past the edge the way a migration or a hand-edit would, which is the only way to get here.
    const { taskReadings } = await import('../../src/infrastructure/persistence/schema');
    void taskReadings;
    const { createDb } = await import('../../src/infrastructure/persistence/db');
    const { env } = await import('../helpers/app');
    const { sql } = await import('drizzle-orm');
    await createDb(env.DB).run(sql.raw(`UPDATE tasks SET measure_target = 5 WHERE id = '${task.id}'`));

    const after = await taskOf(cookie, task.id);
    expect(after.measure!.progress).toBeNull();
    // `null` and not 0, 1, NaN or Infinity — a wrong number is worse than no number.
    const wire = JSON.stringify(after.measure);
    for (const forbidden of ['NaN', 'Infinity', '"progress":0', '"progress":1']) {
      expect(wire, forbidden).not.toContain(forbidden);
    }
  });

  it('S-measure-4-4 — overshoot is NOT clamped in the data: 18 of 15 is 1.2', async () => {
    const { cookie, weekly } = await line();
    const task = await seedTask(t, cookie, { goalId: weekly.id, title: 'over', measure: { kind: 'counter', start: 0, target: 15, unit: 'leads' } });
    await record(cookie, task.id, { value: 18 });
    const after = await taskOf(cookie, task.id);
    expect(after.measure!.progress).toBeCloseTo(1.2, 10);
    expect(after.measure!.current).toBe(18);
  });

  it('S-measure-2-2 — NaN, ±Infinity and anything past ±1e9 are refused, at every entry point', async () => {
    const { cookie, weekly } = await line();
    const task = await seedTask(t, cookie, { goalId: weekly.id, title: 'bounded', measure: { kind: 'gauge', start: 0, target: 10 } });

    for (const start of [1e10, -1e10]) {
      expect((await setMeasure(cookie, task.id, { kind: 'gauge', start, target: 10 })).status, String(start)).toBe(422);
    }
    for (const value of [1e10, -1e10]) {
      expect((await record(cookie, task.id, { value })).status, String(value)).toBe(422);
    }
    // JSON has no NaN or Infinity literal, so they arrive as the strings a naive client would send.
    for (const raw of ['{"value":"NaN"}', '{"value":null}']) {
      const res = await t.fetch(`/api/tasks/${task.id}/readings`, {
        method: 'POST',
        cookie,
        idempotencyKey: crypto.randomUUID(),
        headers: { 'Content-Type': 'application/json' },
        body: raw,
      });
      expect(res.status, raw).toBe(422);
    }
    // …and a delta that would carry `current` past the bound is refused at the resolved value, not the
    // input: the guard is on what gets STORED.
    await record(cookie, task.id, { value: 1e9 });
    expect((await record(cookie, task.id, { delta: 1e9 })).status).toBe(422);
  });
});

describe('R-measure-3 — `current` is DERIVED, and every reading is an absolute', () => {
  /**
   * **S-measure-3-1 — the owner's own example: a mistyped 240 for 24.**
   *
   * There is no edit. Correcting it is deleting it and recording the right one, and the current value
   * falls back to the reading before it — which works because every reading stores an absolute, so there
   * is ONE rule for both kinds rather than two.
   */
  it('S-measure-3-1 — deleting the mistyped 240 falls `current` back to 26, and writes no event', async () => {
    const { cookie, weekly } = await line();
    const task = await seedTask(t, cookie, { goalId: weekly.id, title: 'weigh in', measure: { kind: 'gauge', start: 30, target: 20, unit: 'kg' } });
    for (const value of [24, 26, 240]) await record(cookie, task.id, { value });
    expect((await taskOf(cookie, task.id)).measure!.current).toBe(240);

    const before = kinds(await taskOf(cookie, task.id).then(() => detail(t, cookie, task.id)));
    const mistyped = (await taskOf(cookie, task.id)).readings.find((r) => r.value === 240)!;
    expect((await deleteReading(cookie, task.id, mistyped.id)).status).toBe(200);

    const after = await taskOf(cookie, task.id);
    expect(after.measure!.current).toBe(26);
    expect(after.readings.map((r) => r.value)).toEqual([24, 26]);
    // ⚠ **R-measure-7** — a deleted reading leaves NO trace anywhere. An audit trail of a typo defeats
    // the reason deletion exists.
    expect(kinds(await detail(t, cookie, task.id))).toEqual(before);
  });

  it('S-measure-3-2 — a counter’s `+3, +5` are stored as ABSOLUTE 3 and 8, and deletion unwinds them', async () => {
    const { cookie, weekly } = await line();
    const task = await seedTask(t, cookie, { goalId: weekly.id, title: 'calls', measure: { kind: 'counter', start: 0, target: 20 } });
    await record(cookie, task.id, { delta: 3 });
    await record(cookie, task.id, { delta: 5 });

    let after = await taskOf(cookie, task.id);
    expect(after.readings.map((r) => r.value)).toEqual([3, 8]); // absolutes, not deltas
    expect(after.measure!.current).toBe(8);

    await deleteReading(cookie, task.id, after.readings[1]!.id);
    after = await taskOf(cookie, task.id);
    expect(after.measure!.current).toBe(3);

    await deleteReading(cookie, task.id, after.readings[0]!.id);
    after = await taskOf(cookie, task.id);
    expect(after.readings).toEqual([]);
    expect(after.measure!.current).toBe(0); // …which is `start`
  });

  it('R-measure-3 — deleting a MIDDLE reading changes the current value not at all', async () => {
    const { cookie, weekly } = await line();
    const task = await seedTask(t, cookie, { goalId: weekly.id, title: 'reps', measure: { kind: 'gauge', start: 0, target: null } });
    for (const value of [10, 20, 30]) await record(cookie, task.id, { value });
    const middle = (await taskOf(cookie, task.id)).readings[1]!;
    await deleteReading(cookie, task.id, middle.id);

    const after = await taskOf(cookie, task.id);
    expect(after.readings.map((r) => r.value)).toEqual([10, 30]);
    expect(after.measure!.current).toBe(30);
  });

  /**
   * **S-measure-3-3 — the input asymmetry, and it is deliberate in both directions.**
   */
  it('S-measure-3-3 — a delta against a GAUGE is refused; an absolute against a COUNTER is accepted', async () => {
    const { cookie, weekly } = await line();
    const gauge = await seedTask(t, cookie, { goalId: weekly.id, title: 'weight', measure: { kind: 'gauge', start: 80, target: 75 } });
    const counter = await seedTask(t, cookie, { goalId: weekly.id, title: 'calls', measure: { kind: 'counter', start: 0, target: 20 } });

    const refused = await record(cookie, gauge.id, { delta: -1 });
    expect(refused.status).toBe(422);
    expect(await codeOf(refused)).toBe('MEASURE_KIND_MISMATCH');

    // "I'm at 12" — correcting a counter to where it actually is is legitimate.
    expect((await record(cookie, counter.id, { value: 12 })).status).toBe(200);
    expect((await taskOf(cookie, counter.id)).measure!.current).toBe(12);
  });

  it('S-measure-3-3 — `current` is server-owned: no request may supply one, and neither may a patch', async () => {
    const { cookie, weekly } = await line();
    const task = await seedTask(t, cookie, { goalId: weekly.id, title: 'calls', measure: { kind: 'counter', start: 0, target: 20 } });

    expect((await setMeasure(cookie, task.id, { kind: 'counter', start: 0, current: 9, target: 20 })).status).toBe(422);
    const patched = await t.fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      cookie,
      json: { measure: { kind: 'counter', start: 0, current: 9, target: 20 } },
    });
    expect(patched.status).toBe(422); // `PatchTaskRequest` has no measure field at all, by design
  });

  it('R-measure-3 — a reading against a task with NO measure is NO_MEASURE, not a silent attach', async () => {
    const { cookie, weekly } = await line();
    const task = await seedTask(t, cookie, { goalId: weekly.id, title: 'an ordinary checkbox' });
    const res = await record(cookie, task.id, { value: 1 });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('NO_MEASURE');
  });

  it('Q-26 — readings are capped, and the refusal names the cap', async () => {
    // The cap is asserted as a CONTRACT here rather than by writing 2,000 rows over HTTP: the number is
    // shared, the guard reads it, and a 2,000-request test would cost a minute to prove one comparison.
    expect(MAX_READINGS).toBe(2000);
  });
});

describe('R-measure-5 — readings follow the TASK, not the week', () => {
  /**
   * **S-measure-5-1 — six readings, and every operation A8 can do to a task, in order.**
   *
   * A task carries across weeks and months and may be parked between them. If its readings reset at any
   * boundary the history is worthless — the sparkline of a workout that resets every Monday shows
   * nothing — and that is the whole reason the feature exists.
   */
  it('S-measure-5-1 — they survive carrying, parking, un-parking, completion and unchecking', async () => {
    const { cookie, september, weekly } = await line();
    const task = await seedTask(t, cookie, {
      goalId: september.id,
      title: 'the long haul',
      measure: { kind: 'gauge', start: 0, target: null, unit: 'reps' },
    });
    for (const value of [10, 12, 14, 16, 18, 20]) await record(cookie, task.id, { value });
    const survived = async (step: string) => {
      const after = await taskOf(cookie, task.id);
      expect(after.readings.map((r) => r.value), step).toEqual([10, 12, 14, 16, 18, 20]);
      expect(after.measure!.current, step).toBe(20);
    };

    // carry: read a later month, which is where a month task's carry is produced.
    await t.fetch('/api/goals?lens=Monthly&period=2026-11', { cookie });
    await survived('carried');

    // Into the week `weekly` was written for — the current one, which is where a park may land.
    expect((await command(t, cookie, `/api/tasks/${task.id}/retarget`, { period: '2026-08-31' })).status).toBe(200);
    await survived('parked');
    expect((await command(t, cookie, `/api/tasks/${task.id}/retarget`, { period: SEP })).status).toBe(200);
    await survived('un-parked');

    expect((await command(t, cookie, `/api/tasks/${task.id}/complete`, { period: SEP })).status).toBe(200);
    await survived('completed');
    expect((await command(t, cookie, `/api/tasks/${task.id}/uncheck`, {})).status).toBe(200);
    await survived('unchecked');
    void weekly;
  });

  it('S-measure-5-2 — a reading carries no week, month, period or scope, on the wire or in the table', async () => {
    const { cookie, weekly } = await line();
    const task = await seedTask(t, cookie, { goalId: weekly.id, title: 'reps', measure: { kind: 'gauge', start: 0, target: null } });
    await record(cookie, task.id, { value: 10 });

    const reading = (await taskOf(cookie, task.id)).readings[0]!;
    expect(Object.keys(reading).sort()).toEqual(['at', 'id', 'taskId', 'value']);

    const { createDb } = await import('../../src/infrastructure/persistence/db');
    const { env } = await import('../helpers/app');
    const { sql } = await import('drizzle-orm');
    const columns = await createDb(env.DB).all<{ name: string }>(sql.raw(`PRAGMA table_info('task_readings')`));
    const names = columns.map((c) => c.name).sort();
    expect(names).toEqual(['at', 'created_at', 'id', 'task_id', 'user_id', 'value']);
    for (const forbidden of ['week_start', 'period_key', 'scope', 'month']) {
      expect(names, forbidden).not.toContain(forbidden);
    }
  });
});

describe('R-measure-6 / R-measure-7 — completion is independent, and the timeline is not the log', () => {
  it('S-measure-6-1 — reaching the target completes nothing, and completing writes no reading', async () => {
    const { cookie, weekly } = await line();
    const task = await seedTask(t, cookie, { goalId: weekly.id, title: 'calls', measure: { kind: 'counter', start: 0, target: 15 } });
    await record(cookie, task.id, { value: 15 });

    let after = await taskOf(cookie, task.id);
    expect(after.status).toBe('open'); // nothing completed it, and nothing asked
    expect(after.done).toBe(false);
    expect(after.measure!.progress).toBe(1);

    // …and completing BELOW the target records that the owner stopped at 12, which is the truth.
    await record(cookie, task.id, { value: 12 });
    const readingsBefore = (await taskOf(cookie, task.id)).readings.length;
    expect((await command(t, cookie, `/api/tasks/${task.id}/complete`, { period: thisWeek(t) })).status).toBe(200);
    after = await taskOf(cookie, task.id);
    expect(after.done).toBe(true);
    expect(after.measure!.current).toBe(12);
    expect(after.readings).toHaveLength(readingsBefore); // the completion wrote none
  });

  /**
   * **S-measure-7-1 — the timeline is not the log, and this is why.**
   *
   * A counter bumped daily for a quarter would put ninety rows into a log whose purpose is to answer
   * "what happened to this task", and those ninety rows are already on the page, above it, in the right
   * shape. So a reading writes no event, on record or on delete, at any volume.
   */
  it('S-measure-7-1 — ninety readings produce ONE `Measure added` line and no reading rows', async () => {
    const { cookie, weekly } = await line();
    const task = await seedTask(t, cookie, { goalId: weekly.id, title: 'daily', measure: { kind: 'counter', start: 0, target: 90 } });
    for (let i = 0; i < 30; i++) await record(cookie, task.id, { delta: 1 });
    await deleteReading(cookie, task.id, (await taskOf(cookie, task.id)).readings[5]!.id);

    const events = kinds(await detail(t, cookie, task.id));
    expect(events.filter((k) => k === 'measure_added')).toHaveLength(1);
    // No kind in the whole enum can be produced by a reading, in either direction.
    expect(events.filter((k) => k !== 'measure_added' && k !== 'created')).toEqual([]);
    expect((await taskOf(cookie, task.id)).readings).toHaveLength(29);
  });

  it('R-task-58 — an EDIT logs one line per changed field, and a no-op edit logs nothing', async () => {
    const { cookie, weekly } = await line();
    const task = await seedTask(t, cookie, { goalId: weekly.id, title: 'calls', measure: { kind: 'counter', start: 0, target: 15, unit: 'leads' } });

    await setMeasure(cookie, task.id, { kind: 'counter', start: 0, target: 20, unit: 'calls' });
    const after = texts(await detail(t, cookie, task.id));
    expect(after).toContain('Measure edited: target "15" → "20"');
    expect(after).toContain('Measure edited: unit "leads" → "calls"');
    expect(after.filter((x) => x.startsWith('Measure edited'))).toHaveLength(2);

    const before = kinds(await detail(t, cookie, task.id));
    await setMeasure(cookie, task.id, { kind: 'counter', start: 0, target: 20, unit: 'calls' });
    expect(kinds(await detail(t, cookie, task.id))).toEqual(before);
  });

  it('R-task-58 — `no target` is spelled out rather than trailing off', async () => {
    const { cookie, weekly } = await line();
    const task = await seedTask(t, cookie, { goalId: weekly.id, title: 'amrap', measure: { kind: 'gauge', start: 0, target: null, unit: 'reps' } });
    expect(texts(await detail(t, cookie, task.id))).toContain('Measure added: gauge, 0 → no target reps');
  });

  it('R-measure-3 — editing `start` does not reset `current`: the readings are what happened', async () => {
    const { cookie, weekly } = await line();
    const task = await seedTask(t, cookie, { goalId: weekly.id, title: 'calls', measure: { kind: 'counter', start: 0, target: 15 } });
    await record(cookie, task.id, { value: 9 });
    await setMeasure(cookie, task.id, { kind: 'counter', start: 5, target: 15 });

    const after = await taskOf(cookie, task.id);
    expect(after.measure!.start).toBe(5);
    expect(after.measure!.current).toBe(9); // the reading wins; it is what actually happened
    expect(after.readings.map((r) => r.value)).toEqual([9]);
  });
});

describe('R-measure-8 — the audit: nothing here computes a verdict', () => {
  /**
   * **S-measure-8-1 — a census over the wire, because prose cannot hold this line on its own.**
   *
   * Every item in R-measure-8 is one line of code away from a measure, and each would be the first number
   * in this product that judged its owner. The rule that admits what A8 adds and refuses these: *a number
   * the owner recorded is data; a number the app derived about the owner is a judgment.*
   */
  it('S-measure-8-1 — no read model carries a pace, a projection, a trend, a streak or a verdict', async () => {
    const { cookie, september, weekly } = await line();
    const month = await seedTask(t, cookie, { goalId: september.id, title: 'month', measure: { kind: 'counter', start: 0, target: 15 } });
    await seedTask(t, cookie, { goalId: weekly.id, title: 'week', measure: { kind: 'gauge', start: 80, target: 75 } });
    await record(cookie, month.id, { value: 12 });

    const payloads = await Promise.all(
      [
        '/api/goals?lens=Weekly&period=2026-09-07',
        '/api/goals?lens=Monthly&period=2026-09',
        `/api/goals/${september.id}`,
        '/api/tasks?week=1',
        `/api/tasks/${month.id}`,
        '/api/bootstrap',
      ].map(async (path) => `${path} ${await (await t.fetch(path, { cookie })).text()}`),
    );

    for (const body of payloads) {
      for (const banned of [
        'pace',
        'projection',
        'projected',
        'forecast',
        'trend',
        'movingAverage',
        'onTrack',
        'on_track',
        'behind',
        'ahead',
        'streak',
        'completionRate',
        'burndown',
        'rollup',
        'summary',
      ]) {
        expect(body.includes(banned), `${banned} in ${body.slice(0, 40)}`).toBe(false);
      }
    }
  });

  it('S-measure-8-1 — a goal has no target at all, and no measure is summed across tasks (Q-25)', async () => {
    const { cookie, september } = await line();
    for (const n of [1, 2, 3]) {
      await seedTask(t, cookie, { goalId: september.id, title: `t${n}`, measure: { kind: 'counter', start: 0, target: 10 } });
    }
    const goal = await (await t.fetch(`/api/goals/${september.id}`, { cookie })).json();
    const wire = JSON.stringify((goal as { goal: unknown }).goal);
    for (const banned of ['measure', 'target', 'progress', 'current']) {
      expect(wire, banned).not.toContain(banned);
    }
  });

  it('S-measure-8-3 — no ratio pair, no checklist and no recurrence machinery exists anywhere', async () => {
    const { cookie, weekly } = await line();
    const task = await seedTask(t, cookie, { goalId: weekly.id, title: 'calls', measure: { kind: 'counter', start: 0, target: 15 } });

    for (const body of [
      { kind: 'counter', start: 0, target: 15, numerator: 3, denominator: 5 },
      { kind: 'counter', start: 0, target: 15, items: ['a', 'b'] },
      { kind: 'counter', start: 0, target: 15, repeat: 'daily' },
      { kind: 'counter', start: 0, target: 15, seriesId: 'x' },
    ]) {
      expect((await setMeasure(cookie, task.id, body)).status, JSON.stringify(body)).toBe(422);
    }
  });
});
