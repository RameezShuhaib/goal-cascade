import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { LensResponse, TaskDetailView } from '@goal-cascade/shared';
import { AppShell } from '../../src/AppShell';
import { renderApp } from '../render';
import { bodyOf, cmd, lastRequest, server } from '../msw/handlers';
import * as F from '../msw/fixtures';
import * as C from '../../src/components/measureCopy';

/**
 * ⚠ **A8 (R-measure-1 … R-measure-9) — a task's number.**
 *
 * > *"show what you recorded, never compute a verdict."* — the owner, and the line every assertion in this
 * > file is a consequence of.
 *
 * The refusals are as load-bearing as the renders and are asserted as such: **no percentage anywhere**, no
 * `role="progressbar"`, no completion word, no sentence when the target is reached, no note when a target
 * is missing, and nothing on a sparkline but one path.
 */

const TASK = F.ulid(20);

const withTask = (over: Partial<TaskDetailView>) =>
  server.use(http.get('/api/tasks/:id', () => HttpResponse.json(F.taskResponse(over))));

const withWeek = (over: Partial<LensResponse> = {}) =>
  server.use(
    http.get('/api/goals', ({ request }) => {
      const q = new URL(request.url).searchParams;
      const lens = (q.get('lens') ?? 'Weekly') as Parameters<typeof F.lensFor>[0];
      if (lens !== 'Weekly') return HttpResponse.json(F.lensFor(lens, q.get('period') ?? undefined));
      return HttpResponse.json(F.lens({ lens: 'Weekly', period: F.period({ horizon: 'Weekly', periodKey: F.THIS_MONDAY }), items: [F.weeklyGoal()], groups: [F.group({ id: F.L })], ...over }));
    }),
  );

const rowTask = (over: Parameters<typeof F.task>[0] = {}) => F.task({ id: TASK, goalId: F.W, title: 'Reach 15 leads a day', cond: '300 logged in the CRM', ...over });

const openTaskPage = async () => {
  const r = renderApp(<AppShell />, { route: `/task/${TASK}` });
  await screen.findByRole('heading', { level: 1 });
  return r;
};

// ---- reading a measure on a row ---------------------------------------------

describe('R-measure-4 — every measure state on a row, and the two keys that are never collapsed', () => {
  const rowOf = async (over: Parameters<typeof F.task>[0]) => {
    const t = rowTask(over);
    withWeek({ tasks: [t] });
    renderApp(<AppShell />, { route: '/week/2026-08-31' });
    return (await screen.findByText(t.title)).closest('button') as HTMLElement;
  };

  /**
   * ⚠ **A task with NO measure renders exactly as it did before — byte-identical, and that is a
   * requirement (R-measure-1, S-measure-1-1).**
   *
   * Both rows are in the SAME week, on the same screen, differing in one field. The previous version
   * rendered a measure-less task alone and asserted two absences, which is also what a build with no
   * measure feature at all produces — it could not distinguish *suppressed* from *not implemented*, and
   * it passed unchanged against the commit before this feature existed.
   */
  it('no measure: no line, no bar, nothing added to the row — beside a row that HAS all three', async () => {
    const plain = rowTask({ id: F.ulid(22), title: 'Call the three warm ones' });
    const measured = rowTask({ measure: F.measure({ kind: 'counter', start: 0, current: 62, target: 300, unit: 'leads', progress: 62 / 300 }) });
    withWeek({ tasks: [plain, measured] });
    renderApp(<AppShell />, { route: '/week/2026-08-31' });

    const plainRow = (await screen.findByText(plain.title)).closest('button') as HTMLElement;
    const measuredRow = screen.getByText(measured.title).closest('button') as HTMLElement;

    // The measured row proves the feature is on this screen at all.
    expect(within(measuredRow).getByTestId('measure-line')).toHaveTextContent('62 / 300 leads');
    expect(within(measuredRow).getByTestId('measure-bar')).toBeInTheDocument();

    // The plain row carries the title and the done-condition, and nothing else has been added to it.
    expect(within(plainRow).getByText('Done when: 300 logged in the CRM')).toBeInTheDocument();
    expect(within(plainRow).queryByTestId('measure-line')).not.toBeInTheDocument();
    expect(within(plainRow).queryByTestId('measure-bar')).not.toBeInTheDocument();
    expect(plainRow.textContent).toBe('Call the three warm onesDone when: 300 logged in the CRM');
  });

  it('a counter with a target: `62 / 300 leads` and a bar at the server’s own progress', async () => {
    await rowOf({ measure: F.measure({ kind: 'counter', start: 0, current: 62, target: 300, unit: 'leads', progress: 62 / 300 }) });
    expect(screen.getByTestId('measure-line')).toHaveTextContent('62 / 300 leads');
    expect(screen.getByTestId('measure-bar')).toHaveAttribute('data-fill', '21');
  });

  it('a gauge with a target, counting DOWN: one formula, no direction flag, no branch', async () => {
    await rowOf({ title: 'Lose 5 kg this month', measure: F.measure({ kind: 'gauge', start: 80, current: 78.5, target: 75, unit: 'kg', progress: 0.3 }) });
    // `n(v)`: at most two decimals, trailing zeros stripped, NO thousands separator and no locale.
    expect(screen.getByTestId('measure-line')).toHaveTextContent('78.5 / 75 kg');
    expect(screen.getByTestId('measure-bar')).toHaveAttribute('data-fill', '30');
  });

  /**
   * ⚠ **The AMRAP case — a first-class measurable, not a degraded one** (R-measure-4). No slash, no
   * percentage, no bar, no completion criterion, and **nothing on screen mentions a missing target**.
   */
  it('a gauge with NO target: `24 reps`, and not one word about the target it does not have', async () => {
    await rowOf({ title: 'AMRAP — max reps', measure: F.measure({ kind: 'gauge', start: 18, current: 24, target: null, unit: 'reps', progress: null }) });
    const line = screen.getByTestId('measure-line');
    expect(line).toHaveTextContent('24 reps');
    expect(line.textContent).not.toContain('/');
    expect(screen.queryByTestId('measure-bar')).not.toBeInTheDocument();
    expect(screen.queryByText(/target/i)).not.toBeInTheDocument();
  });

  /**
   * ⚠ **The two keys are independent and the build must never collapse them.** The slash is
   * `target !== null`; the bar is `progress != null`. Keying the numbers off `progress` renders this task
   * as `62 leads`, which is a lie about its data — the target IS 62, and no division was performed.
   */
  it('`progress` absent because target === start: the numbers, and no bar and no division', async () => {
    await rowOf({ title: 'Hold 62 leads', measure: F.measure({ kind: 'counter', start: 62, current: 62, target: 62, unit: 'leads', progress: null }) });
    expect(screen.getByTestId('measure-line')).toHaveTextContent('62 / 62 leads');
    expect(screen.queryByTestId('measure-bar')).not.toBeInTheDocument();
  });

  it('over the target: a FULL bar, never `120%` and never drawn past its own end', async () => {
    await rowOf({ measure: F.measure({ kind: 'counter', start: 0, current: 18, target: 15, unit: 'leads', progress: 1.2 }) });
    expect(screen.getByTestId('measure-line')).toHaveTextContent('18 / 15 leads');
    expect(screen.getByTestId('measure-bar')).toHaveAttribute('data-fill', '100');
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  /**
   * ⚠ **A completed measurable BELOW its target — no red, no `missed`, no note, no apology.** The title is
   * struck through because the task is finished; the measure line is **not**, because `12 / 15` is what
   * happened and the app was not asked what it thought of it.
   */
  it('done below target: the title struck, the numbers unstruck in T.mut, and the bar at 80%', async () => {
    const row = await rowOf({
      status: 'done',
      done: true,
      doneAt: F.NOW,
      donePeriodKey: F.THIS_MONDAY,
      measure: F.measure({ kind: 'counter', start: 0, current: 12, target: 15, unit: 'leads', progress: 0.8 }),
    });
    expect(within(row).getByText('Reach 15 leads a day')).toHaveStyle({ textDecoration: 'line-through' });
    const line = within(row).getByTestId('measure-line');
    expect(line).toHaveTextContent('12 / 15 leads');
    expect(line).not.toHaveStyle({ textDecoration: 'line-through' });
    expect(within(row).getByTestId('measure-bar')).toHaveAttribute('data-fill', '80');
    expect(within(row).queryByText(/missed|behind|short/i)).not.toBeInTheDocument();
  });

  /**
   * ⚠ **R-measure-8, in the DOM.** `role="progressbar"` carries `aria-valuenow` and is announced as a
   * percentage by most screen readers — which would make the one forbidden number audible while it is
   * invisible. The numbers beside the bar are the accessible content.
   */
  it('the bar is aria-hidden, carries no role="progressbar", and no percentage is rendered anywhere', async () => {
    await rowOf({ measure: F.measure({ kind: 'counter', start: 0, current: 62, target: 300, unit: 'leads', progress: 0.2067 }) });
    expect(screen.getByTestId('measure-bar')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d%/);
  });
});

// ---- setting a measure -------------------------------------------------------

describe('R-measure-1 — setting a measure: one inline block, two hosts, no second sheet', () => {
  it('a task with no measure shows the eyebrow and one link, and nothing else', async () => {
    withTask({ id: TASK, measure: null });
    await openTaskPage();
    expect(screen.getByText('MEASURE')).toBeInTheDocument();
    const add = screen.getByRole('button', { name: '+ Add a number' });
    expect(add).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('RECORD')).not.toBeInTheDocument();
    expect(screen.queryByTestId('measure-sparkline')).not.toBeInTheDocument();
  });

  it('the block teaches the kind and states the range, and saves ONE object', async () => {
    withTask({ id: TASK, measure: null });
    const { user } = await openTaskPage();
    await user.click(screen.getByRole('button', { name: '+ Add a number' }));

    const fields = screen.getByTestId('measure-fields');
    // `kind` first, because it changes what the other three mean. Counter is the default.
    expect(within(fields).getByRole('radio', { name: 'Counter — you add to it' })).toBeChecked();
    expect(within(fields).getByText('You add to it. Each entry is a change: +3.')).toBeInTheDocument();
    // A counter starts at nothing by construction; a gauge starts at wherever you are, which the app
    // does not know — so the untouched field follows the kind.
    expect(within(fields).getByLabelText('Start')).toHaveValue('0');

    await user.type(within(fields).getByLabelText('Target (optional)'), '300');
    await user.type(within(fields).getByLabelText('Unit'), 'leads');
    expect(within(fields).getByText('0 → 300 leads.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save measure' }));
    await waitFor(async () => {
      expect(await bodyOf(lastRequest('PUT', '/measure'))).toMatchObject({
        measure: { kind: 'counter', start: 0, target: 300, unit: 'leads' },
      });
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Measure added');
  });

  it('the AMRAP shape: a gauge, a start, no target — and the range note says so in words', async () => {
    withTask({ id: TASK, measure: null });
    const { user } = await openTaskPage();
    await user.click(screen.getByRole('button', { name: '+ Add a number' }));
    const fields = screen.getByTestId('measure-fields');

    await user.click(within(fields).getByRole('radio', { name: 'Gauge — you set it' }));
    expect(within(fields).getByText('You set it. Each entry replaces the last: 78.5.')).toBeInTheDocument();
    // The gauge's start is empty, not zero: the app does not know where you are.
    expect(within(fields).getByLabelText('Start')).toHaveValue('');
    await user.type(within(fields).getByLabelText('Start'), '18');
    await user.type(within(fields).getByLabelText('Unit'), 'reps');
    // `Target (optional)` is left alone — the AMRAP case is reachable by not touching a field.
    expect(within(fields).getByText('From 18 reps. No target.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save measure' }));
    await waitFor(async () => expect(await bodyOf(lastRequest('PUT', '/measure'))).toMatchObject({ measure: { kind: 'gauge', start: 18, target: null, unit: 'reps' } }));
  });

  it('R-measure-4: start === target is refused at the field, and the save is blocked', async () => {
    withTask({ id: TASK, measure: null });
    const { user } = await openTaskPage();
    await user.click(screen.getByRole('button', { name: '+ Add a number' }));
    const fields = screen.getByTestId('measure-fields');
    await user.clear(within(fields).getByLabelText('Start'));
    await user.type(within(fields).getByLabelText('Start'), '300');
    await user.type(within(fields).getByLabelText('Target (optional)'), '300');

    expect(await within(fields).findByText("Start and target can't be the same number.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save measure' })).toBeDisabled();
  });

  /** R-measure-1 — the confirm names the count, because removing a measure takes every reading with it. */
  it('removing names how many recorded values it deletes, and Keep is where focus lands', async () => {
    withTask({
      id: TASK,
      measure: F.measure({ current: 62, target: 300, unit: 'leads', progress: 0.2 }),
      readings: [F.reading({ id: F.ulid(71), value: 57 }), F.reading({ id: F.ulid(72), value: 62 })],
    });
    const { user } = await openTaskPage();
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(screen.getByText('Remove the measure? This deletes 2 recorded values.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep' })).toHaveFocus();
    // ⚠ RECORD and the readings stay mounted and usable while the strip is up: they are not the shape.
    expect(screen.getByText('RECORD')).toBeInTheDocument();
  });
});

// ---- updating a measure ------------------------------------------------------

describe('R-measure-3 — recording: one eyebrow, one field, one button', () => {
  const counter = () =>
    withTask({
      id: TASK,
      measure: F.measure({ kind: 'counter', start: 0, current: 62, target: 300, unit: 'leads', progress: 62 / 300 }),
      readings: [F.reading({ id: F.ulid(71), value: 57 }), F.reading({ id: F.ulid(72), value: 62 })],
    });

  const answersWith = (current: number) =>
    server.use(
      http.post(
        '/api/tasks/:id/readings',
        cmd(() =>
          HttpResponse.json(
            F.taskResponse({
              id: TASK,
              measure: F.measure({ kind: 'counter', start: 0, current, target: 300, unit: 'leads', progress: current / 300 }),
              readings: [F.reading({ id: F.ulid(71), value: 57 }), F.reading({ id: F.ulid(72), value: 62 }), F.reading({ id: F.ulid(73), value: current })],
            }),
          ),
        ),
      ),
    );

  it('the `+1` chip posts a delta of 1 on ONE tap, with no field and no second stop', async () => {
    counter();
    answersWith(63);
    const { user } = await openTaskPage();
    await user.click(screen.getByRole('button', { name: 'Add 1 to leads' }));
    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/readings'))).toEqual({ delta: 1, version: 1 }));
  });

  /**
   * ⚠ **The unit is a word, never parsed and never converted** (`docs/BUSINESS-RULES.md`) — and this is the
   * case that proves the rule rather than the label.
   *
   * `33-measurables-ux` §3.5 asked for `Add 1 lead` from the unit `leads`, which needs the owner's own word
   * singularised. **The owner overruled it**: stripping a trailing `s` is parsing, it is English-only, and
   * across real units it is a coin flip — `status → statu`, `press → pres`, and anything typed in another
   * language. A label that mangles the owner's word is worse than one that omits it, and nothing is lost,
   * because the unit already appears verbatim in the value line beside the chip.
   *
   * `status` is chosen deliberately: it is the unit a trailing-`s` strip gets *wrong* rather than merely
   * awkward, so this fails loudly the moment any code transforms a unit string again.
   */
  it('no code transforms the unit: a unit of `status` is spoken whole, never as `statu`', async () => {
    withTask({
      id: TASK,
      measure: F.measure({ kind: 'counter', start: 0, current: 3, target: 10, unit: 'status', progress: 0.3 }),
      readings: [F.reading({ id: F.ulid(71), value: 3 })],
    });
    await openTaskPage();

    const chip = screen.getByRole('button', { name: 'Add 1 to status' });
    expect(chip).toHaveTextContent('+1');
    // `statu` not followed by an `s` — i.e. the mangled form, anywhere in the accessible name.
    expect(chip.getAttribute('aria-label')).not.toMatch(/statu(?!s)/);
    // And the same rule at every other site that interpolates the unit.
    expect(screen.getByLabelText('How many status to add')).toBeInTheDocument();
    expect(screen.getAllByTestId('measure-line')[0]).toHaveTextContent('3 / 10 status');
    expect(document.body.textContent).not.toMatch(/statu(?!s)/);
  });

  /**
   * ⚠ **Focus never moves on a successful record**, and the result arrives in the block's polite region as
   * the FULL new state — *what you did*, then *where that leaves the numbers*. Enter submits from the
   * field so the fast path never leaves it; moving focus to a toast or a value line would cost a keyboard
   * user a trip back for every rep.
   */
  it('the field posts a delta, keeps focus, clears, and announces the whole new state', async () => {
    counter();
    answersWith(65);
    const { user } = await openTaskPage();
    const field = screen.getByLabelText('How many leads to add');
    await user.click(field);
    await user.keyboard('3{Enter}');

    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/readings'))).toEqual({ delta: 3, version: 1 }));
    await waitFor(() => expect(screen.getByText('Recorded 65. Now 65 of 300 leads.')).toBeInTheDocument());
    expect(field).toHaveFocus();
    expect(field).toHaveValue('');
    /**
     * ⚠ **No toast: a notification about a value that repainted three lines above the field.**
     *
     * Asserted on the ROLE, not on a string. `queryByText('Recorded')` is a whole-string exact match, so
     * it fires only on an element whose entire text is that one word — which no toast this product can
     * render ever is, and every real toast would have slipped past it. `Toast` is the only
     * `role="status"` on this page, so its absence is the assertion.
     */
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  /** R-measure-3 accepts an absolute against a counter — correcting it to where it actually is. */
  it('`Correct it instead` flips the counter to absolute and posts a value, not a delta', async () => {
    counter();
    answersWith(12);
    const { user } = await openTaskPage();
    await user.click(screen.getByRole('button', { name: 'Correct it instead' }));
    await user.type(screen.getByLabelText('Set to, in leads'), '12');
    await user.click(screen.getByRole('button', { name: 'Record' }));

    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/readings'))).toEqual({ value: 12, version: 1 }));
    expect(screen.getByRole('button', { name: 'Add to it instead' })).toBeInTheDocument();
  });

  /**
   * A gauge is **never offered a delta**, so `MEASURE_KIND_MISMATCH` is unreachable from this UI and is a
   * server-side backstop only. Its field is pre-filled with `current`, and `Record` stays enabled when the
   * number is unchanged: recording the same weight on a new day is data, and refusing it would be the app
   * deciding what counts.
   */
  it('a gauge pre-fills with `current`, posts a value, and is offered no delta and no `+1`', async () => {
    withTask({
      id: TASK,
      measure: F.measure({ kind: 'gauge', start: 80, current: 78.5, target: 75, unit: 'kg', progress: 0.3 }),
      readings: [F.reading({ id: F.ulid(71), value: 79 }), F.reading({ id: F.ulid(72), value: 78.5 })],
    });
    const { user } = await openTaskPage();

    const field = screen.getByLabelText('New value in kg');
    expect(field).toHaveValue('78.5');
    expect(screen.queryByRole('button', { name: /^Add 1/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Correct it instead' })).not.toBeInTheDocument();
    // Unchanged, and still recordable.
    expect(screen.getByRole('button', { name: 'Record' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Record' }));
    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/readings'))).toEqual({ value: 78.5, version: 1 }));
  });

  /**
   * ⚠ **R-measure-8 / §6.5 — reaching the target renders and announces NOTHING.** No sentence, no colour
   * change, no icon, no live-region event beyond the record's own. The numbers change, the bar is full,
   * and the product has no comment: a sentence the app writes about your number, at the moment your number
   * gets interesting, is the app having an opinion — and it would be the seed of the next one.
   */
  it('R-measure-8: reaching the target changes the numbers and the bar, and says nothing at all', async () => {
    counter();
    server.use(
      http.post(
        '/api/tasks/:id/readings',
        cmd(() =>
          HttpResponse.json(
            F.taskResponse({
              id: TASK,
              measure: F.measure({ kind: 'counter', start: 0, current: 300, target: 300, unit: 'leads', progress: 1 }),
              readings: [F.reading({ id: F.ulid(71), value: 57 }), F.reading({ id: F.ulid(73), value: 300 })],
            }),
          ),
        ),
      ),
    );
    const { user } = await openTaskPage();
    await user.click(screen.getByRole('button', { name: 'Add 1 to leads' }));

    await waitFor(() => expect(screen.getAllByTestId('measure-line')[0]).toHaveTextContent('300 / 300 leads'));
    expect(screen.getAllByTestId('measure-bar')[0]).toHaveAttribute('data-fill', '100');
    /**
     * ⚠ **THE GOVERNING RULE OF THE FEATURE, asserted as an EQUALITY.**
     *
     * The announcing region's whole text must BE the ordinary sentence — not merely contain it, and not
     * merely avoid six words someone thought of in advance. A blacklist of `complete|done!|reached|target
     * hit|100%|congrat` passes `🎉 Nice one`, `Target met` and `Nailed it`; no list of forbidden words
     * can prove *nothing else was said*. `recordedAnnouncement` is called rather than spelled out, so the
     * assertion is "the region says exactly what a record says" and cannot drift from the copy it pins.
     */
    const announced = C.recordedAnnouncement(
      F.measure({ kind: 'counter', start: 0, current: 300, target: 300, unit: 'leads', progress: 1 }),
    );
    expect(announced).toBe('Recorded 300. Now 300 of 300 leads.');
    await waitFor(() => expect(screen.getByTestId('measure-announcement').textContent).toBe(announced));
    // And nothing celebratory anywhere else on the page either — not a toast, not a badge, not a line.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // R-measure-6 — the checkbox is unchanged in every particular. It does not auto-tick at target.
    expect(screen.getByRole('button', { name: 'Complete Book the Tuesday slot' })).toBeInTheDocument();
  });

  /** Full keyboard operation, end to end: set a measure, then record against it, without a mouse. */
  it('a measure can be set and updated by keyboard alone', async () => {
    withTask({ id: TASK, measure: null });
    const { user } = await openTaskPage();

    const add = screen.getByRole('button', { name: '+ Add a number' });
    add.focus();
    await user.keyboard('{Enter}');
    const fields = await screen.findByTestId('measure-fields');

    // The chips are ONE tab stop, and the arrows move AND select along both axes.
    const counterChip = within(fields).getByRole('radio', { name: 'Counter — you add to it' });
    counterChip.focus();
    await user.keyboard('{ArrowRight}');
    expect(within(fields).getByRole('radio', { name: 'Gauge — you set it' })).toBeChecked();
    expect(within(fields).getByRole('radio', { name: 'Gauge — you set it' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(counterChip).toBeChecked();

    within(fields).getByLabelText('Target (optional)').focus();
    await user.keyboard('300');
    within(fields).getByLabelText('Unit').focus();
    await user.keyboard('leads');
    screen.getByRole('button', { name: 'Save measure' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(async () => expect(await bodyOf(lastRequest('PUT', '/measure'))).toMatchObject({ measure: { kind: 'counter', target: 300, unit: 'leads' } }));
  });
});

// ---- the sparkline and the readings -----------------------------------------

describe('R-measure-5 — the sparkline and the readings, on the task page and only there', () => {
  const withReadings = (values: number[]) =>
    withTask({
      id: TASK,
      measure: F.measure({ kind: 'gauge', start: 18, current: values.at(-1) ?? 18, target: null, unit: 'reps', progress: null }),
      readings: values.map((v, i) => F.reading({ id: F.ulid(70 + i), value: v })),
    });

  it('is absent below two readings — one point has no shape, and a flat line would imply a second', async () => {
    withReadings([24]);
    await openTaskPage();
    expect(screen.queryByTestId('measure-sparkline')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Sparkline of/)).not.toBeInTheDocument();
    // The value line and the readings list are both still there — only the picture is withheld.
    expect(screen.getByText('READINGS')).toBeInTheDocument();
  });

  /**
   * ⚠ **One `<svg>`, one `<path>`, straight segments, x = index.** Not an axis, a gridline, a tick, a
   * label, a target line, a trend line, a projection, a dot, a colour, a hover or an animation — every one
   * of those absences is a rule (R-measure-8), and the target line is the most tempting because it is one
   * `<line>` and data the task already holds. It would be a verdict drawn in a chart.
   */
  it('is one svg holding exactly one straight-segment path, with a text equivalent pointing at the list', async () => {
    withReadings([21, 26, 24]);
    await openTaskPage();

    const svg = screen.getByTestId('measure-sparkline');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('preserveAspectRatio', 'none');
    /**
     * ⚠ **EXACTLY ONE CHILD, counted rather than enumerated.** An enumerated blacklist — `line, circle,
     * text, rect, g, defs` — missed `polyline`, `polygon`, `use`, `marker`, `image`, `foreignObject`,
     * `animate`, `tspan` and, pointedly, **`<title>`**: the standard SVG tooltip, which `Sparkline.tsx`'s
     * own docblock forbids by name and which no list assembled by hand reliably remembers. The rule is
     * "one `<svg>`, one `<path>`, and nothing else", so it is counted.
     */
    expect(svg.querySelectorAll('*')).toHaveLength(1);
    expect(svg.querySelectorAll('path')).toHaveLength(1);
    const d = svg.querySelector('path')!.getAttribute('d')!;
    expect(d).toMatch(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/);
    expect(d).not.toMatch(/[CQSTA]/);
    // x is the INDEX: three readings span the box in two equal steps, whatever their timestamps.
    expect(d.startsWith('M 2 ')).toBe(true);
    expect(d).toContain('L 318 ');
    // The honest equivalent points at the complete, ordered, navigable list rather than reciting it.
    expect(screen.getByText('Sparkline of 3 readings in reps, oldest to newest. Every reading is listed below.')).toBeInTheDocument();
    expect(screen.getByText('Latest 24 reps · Mon 31 Aug')).toBeInTheDocument();
  });

  /**
   * ⚠ **Deletion is one tap with no confirm and no undo bar.** Correcting a mistyped `240` IS deleting it
   * and recording `24` (R-measure-5), so a confirm would sit on the repair path; an undo bar would be a
   * trace of a reading that must leave none (R-measure-7).
   */
  it('deleting a reading updates the sparkline, the current value and the list, and announces the result', async () => {
    withReadings([21, 26, 240]);
    server.use(
      http.delete('/api/tasks/:id/readings/:readingId', () =>
        HttpResponse.json(
          F.taskResponse({
            id: TASK,
            measure: F.measure({ kind: 'gauge', start: 18, current: 26, target: null, unit: 'reps', progress: null }),
            readings: [F.reading({ id: F.ulid(70), value: 21 }), F.reading({ id: F.ulid(71), value: 26 })],
          }),
        ),
      ),
    );
    const { user } = await openTaskPage();

    expect(screen.getAllByTestId('measure-line')[0]).toHaveTextContent('240 reps');
    const before = screen.getByTestId('measure-sparkline').querySelector('path')!.getAttribute('d');

    await user.click(screen.getByRole('button', { name: 'Delete reading 240 reps, Mon 31 Aug' }));

    await waitFor(() => expect(screen.getAllByTestId('measure-line')[0]).toHaveTextContent('26 reps'));
    expect(screen.getByTestId('measure-sparkline').querySelector('path')!.getAttribute('d')).not.toBe(before);
    expect(screen.getByText('Sparkline of 2 readings in reps, oldest to newest. Every reading is listed below.')).toBeInTheDocument();
    expect(screen.getByText('Reading deleted. Now 26 reps.')).toBeInTheDocument();
    expect(screen.queryByText('Undo')).not.toBeInTheDocument();
  });

  it('with nothing recorded the list says so, and the value line still reads from `start`', async () => {
    withTask({ id: TASK, measure: F.measure({ kind: 'counter', start: 0, current: 0, target: 300, unit: 'leads', progress: 0 }), readings: [] });
    await openTaskPage();
    expect(screen.getByText('Nothing recorded yet.')).toBeInTheDocument();
    expect(screen.getAllByTestId('measure-line')[0]).toHaveTextContent('0 / 300 leads');
  });
});
