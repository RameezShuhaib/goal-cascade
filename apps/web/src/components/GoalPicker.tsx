import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { HORIZONS, MAX_PAGE, rankGoals, type GoalView, type Horizon, type LensResponse } from '@goal-cascade/shared';
import { useLens } from '../api/queries';
import { useParentOptions } from '../lens/useParentOptions';
import { useSkin } from '../skin';
import { ChipRadioGroup } from './ChipRadioGroup';
import { rank } from '../utils/periodKeys';

/**
 * **R-nav-31 — one goal picker.** Every choice of a goal in this product is made here.
 *
 * Before this there were seven, no two alike: two flat `pickerRow` lists capped at 200px, four walls of
 * `chipBtn` pills carrying titles and nothing else, and one inline row with no selected state at all.
 * None had search, none showed which Life line a goal belonged to, and **two Monthly goals with the same
 * title in different lines were indistinguishable in every one of them.** The owner's words:
 * *"i need a better way select goal example when i add a backlog in goal everything is listed. lets say
 * if i have many the ui is messed up. i have seen similar practices in other pages too."*
 *
 * ── What a caller supplies ────────────────────────────────────────────────────
 * **A mode, and nothing else.** Not a list, not a rendering, not a keyboard model. The mode says which
 * goals are legal; everything else about every picker in the app is identical.
 *
 * ── What the mode is, and is not ──────────────────────────────────────────────
 * The four modes are **the server's rules, used to shape the offer** — never a second implementation of
 * them (D-5: a disabled button is a hint, not an invariant). Each one narrows to what the API would
 * accept, so a picker never offers a choice that is about to be refused; when the two ever disagree the
 * **server wins**, and the refusal renders at the form it came from, exactly as it did before.
 *
 * ── What it does not do ───────────────────────────────────────────────────────
 * No virtualisation, no combobox library, no fuzzy-search library: the ranking is `@goal-cascade/shared`'s
 * `rankGoals`, which is `find_goal`'s, so the assistant and the owner order the same words the same way.
 * And **no second sheet** — above the threshold the picker takes over the sheet it was opened from
 * (`useGoalPicker`), because two stacked `aria-modal` dialogs are two focus traps, a bug this project has
 * already fixed once (docs/work/09-e2e-browser, finding A).
 */

// ─────────────────────────────────────────────────────────────────────────────
// The rule a caller supplies
// ─────────────────────────────────────────────────────────────────────────────

export type PickerMode =
  /**
   * Choosing a **parent** — the create form's `UNDER`, and Move goal.
   *
   * R-goal-5 / R-goal-32 — strictly longer horizon, levels skippable. `exclude` carries the goal itself
   * and any of its children the caller happens to hold: R-goal-18 forbids moving a goal under its own
   * descendant, and while the horizon rule already makes a descendant unlistable (every descendant is
   * strictly SHORTER-horizon than the goal, and every option is strictly longer), stating it is what
   * makes the guarantee readable rather than incidental.
   */
  | {
      kind: 'parent';
      horizon: Horizon;
      periodKey: string;
      lifeGoalId?: string | null;
      exclude?: readonly string[];
      /**
       * R-lens-20's `Put under a Life goal…` — the one narrowing of `parent` that is a product rule
       * rather than a horizon comparison. It is still wired end to end (`UIContext` → `Sheets` →
       * `MoveGoalSheet`) and still has **no caller** (§10.4); it is carried through the move rather than
       * quietly widened, because a dead path that changes behaviour is worse than a dead path.
       */
      only?: 'life';
    }
  /**
   * Choosing the goal a **backlog item** hangs off. R-backlog-1/2/26 — Yearly, Quarterly or Monthly:
   * never a Life goal (it holds a read-only roll-up, R-backlog-12) and never a Weekly goal (an item has
   * no week, and a Weekly goal would give it one).
   */
  | { kind: 'backlogHost'; exclude?: readonly string[] }
  /**
   * Choosing the **Weekly goal** a task lands on. R-goal-39 / R-task-41 — the horizon is the whole
   * condition. `candidates`, when present, is the SERVER's own list from a `409
   * AMBIGUOUS_CONVERSION_TARGET` and wins over the client's filter, because it is the authoritative
   * answer to "at or under this goal" — a subtree the client does not hold (R-lens-16).
   */
  | { kind: 'weeklyTarget'; parentId: string; weekStart?: string; candidates?: readonly { id: string; title: string }[] }
  /** Tagging a **Learning**. R-learning-2 — a Life goal or nothing; a non-Life tag is `NOT_A_LIFE_GOAL`. */
  | { kind: 'lifeLine' };

/**
 * One row's worth of goal. Structural rather than `GoalView` because two of the four modes have less than
 * a `GoalView` to offer — the server's refusal list is `{ id, title }` — and because the Life-line title
 * is a join the wire has no field for (`LensResponse.groups`, which no picker used before this one).
 */
export interface GoalOption {
  id: string;
  title: string;
  why: string;
  horizon: Horizon;
  /** The server-rendered period label. `''` on a Life goal, which has no period (R-lens-2). */
  period: string;
  createdAt: string;
  /** R-lens-3 — the Life goal this option groups under; `null` is `UNSORTED` (R-lens-20). */
  lineId: string | null;
  /** That group's title, which is the disambiguator two same-named goals need. */
  line: string;
}

/**
 * §7.5 — **at 8 options a list stops being scannable and needs a search field.**
 *
 * ⚠ **A9 — this number no longer decides the picker's SHAPE, only its search field.** It used to do both
 * jobs, and the second one was wrong inside a form sheet: the owner's `New Monthly goal` sheet had three
 * legal parents, so the threshold chose the inline list, and three two-line rows ate the sheet and pushed
 * `Save goal` below the fold. The shape now follows the **surface** (`useGoalPicker` = a compact row in a
 * sheet, `GoalPicker` = the inline list where the picker IS the whole surface), and the number governs one
 * thing again.
 */
export const PICKER_THRESHOLD = 8;

/**
 * ⚠ **A9 — the horizons a mode may offer, broadest first.**
 *
 * The owner's own proposal, and it is better than retuning a threshold:
 *
 * > *"instead we put everything under with all the goals from all the lense. we can have another option
 * > to select which lense to focus on and based on it i get the goals for that lense."*
 *
 * So the picker scopes by horizon first. This function is the **only** place that decides which horizons
 * exist for a mode, and it answers with exactly the set the mode's own `legal` filter admits — it is the
 * same rule read a second way, not a second rule. A horizon the server would refuse is therefore never
 * offered, which is the one property that must not slip: an empty tab is a dead end, but a tab whose every
 * choice is about to 409 is a lie.
 *
 * `parent` widens or narrows with the subject horizon (R-goal-5 / R-goal-32 — strictly longer, levels
 * skippable), and collapses to `Life` alone under R-lens-20's `only: 'life'`. `backlogHost` is
 * R-backlog-2's three. `weeklyTarget` and `lifeLine` are single-horizon by definition, so they render no
 * selector at all and are byte-identical to what shipped.
 */
export function permittedHorizons(mode: PickerMode): Horizon[] {
  switch (mode.kind) {
    case 'parent':
      return mode.only === 'life' ? ['Life'] : HORIZONS.filter((h) => rank(h) < rank(mode.horizon));
    case 'backlogHost':
      return ['Yearly', 'Quarterly', 'Monthly'];
    case 'weeklyTarget':
      return ['Weekly'];
    case 'lifeLine':
      return ['Life'];
  }
}

/**
 * ⚠ **A9 — the horizon the picker OPENS on: the most specific one, never the broadest.**
 *
 * *"for a new Monthly goal that is Quarterly, not Life."* A broadest-first default is the behaviour the
 * owner actually hit — the Life goal sitting at the top of the list, looking chosen — and it is backwards:
 * the nearer a parent is, the more likely it is the one you meant.
 *
 * Three inputs, in order. The **current choice** wins, so reopening a picker shows you where your goal
 * lives rather than resetting the view under you. Otherwise the most specific horizon that actually **has**
 * something to offer, because opening on an empty tab is a dead end the owner has to escape before they can
 * do anything. Otherwise the most specific permitted horizon, so the answer is total.
 */
export function defaultHorizon(horizons: readonly Horizon[], options: readonly GoalOption[], value: string | null): Horizon {
  const chosen = value ? options.find((o) => o.id === value) : undefined;
  if (chosen && horizons.includes(chosen.horizon)) return chosen.horizon;
  const specificFirst = [...horizons].sort((a, b) => rank(b) - rank(a));
  return specificFirst.find((h) => options.some((o) => o.horizon === h)) ?? specificFirst[0] ?? 'Life';
}


/** R-lens-13's surviving requirement, and §7.7's: what a truncated list says instead of lying quietly. */
export const TRUNCATION_NOTICE = `Showing the first ${MAX_PAGE}. Search to narrow it.`;

// ─────────────────────────────────────────────────────────────────────────────
// The reads, one set per mode
// ─────────────────────────────────────────────────────────────────────────────

const optionOf = (g: GoalView, groups: readonly { id: string | null; title: string }[]): GoalOption => ({
  id: g.id,
  title: g.title,
  why: g.why,
  horizon: g.horizon,
  period: g.period,
  createdAt: g.createdAt,
  lineId: g.lifeRootId,
  // A Life goal IS its own line; anything whose chain does not reach one is `UNSORTED` (R-lens-20).
  line: g.horizon === 'Life' ? g.title : (groups.find((x) => x.id === g.lifeRootId)?.title ?? 'UNSORTED'),
});

/** The union of the reads' group headers, in the server's order (`createdAt` asc, `UNSORTED` last). */
function mergeGroups(pages: readonly (LensResponse | undefined)[]): { id: string | null; title: string }[] {
  const out: { id: string | null; title: string }[] = [];
  const seen = new Set<string | null>();
  for (const page of pages) {
    for (const g of page?.groups ?? []) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      out.push({ id: g.id, title: g.title });
    }
  }
  // R-lens-20 — `UNSORTED` is pinned last however the pages arrived.
  return [...out.filter((g) => g.id !== null), ...out.filter((g) => g.id === null)];
}

/**
 * The options a mode offers, the groups they sit in, and whether the server had more to give.
 *
 * Every read here is an ordinary scoped lens read that the app already makes and React Query already
 * caches; the picker adds no endpoint and no query parameter (S-lens-3-3 is untouched). The hooks are
 * called unconditionally with `enabled` flags, because that is what the rules of hooks require and
 * because a disabled query costs nothing.
 */
export function useGoalOptions(mode: PickerMode): {
  options: GoalOption[];
  groups: { id: string | null; title: string }[];
  isPending: boolean;
  /** ⚠ §7.7 — `nextCursor` was thrown away by every picker in the app. Silence at the cap is the defect. */
  truncated: boolean;
} {
  const isParent = mode.kind === 'parent';
  const isHost = mode.kind === 'backlogHost';
  const isWeekly = mode.kind === 'weeklyTarget';
  const isLife = mode.kind === 'lifeLine';

  const parents = useParentOptions(
    isParent ? mode.horizon : 'Life',
    isParent ? mode.periodKey : '',
    isParent ? mode.lifeGoalId : undefined,
  );
  // R-backlog-2 — the three horizons that may hold a backlog item, each at the period containing today.
  const yearly = useLens('Yearly', undefined, isHost);
  const quarterly = useLens('Quarterly', undefined, isHost);
  const monthly = useLens('Monthly', undefined, isHost);
  // R-task-49 — one week. The server's own candidate list, when it sent one, needs no read at all.
  const weeklyEnabled = isWeekly && !!mode.weekStart && !mode.candidates;
  const weekly = useLens('Weekly', isWeekly ? mode.weekStart : undefined, weeklyEnabled);
  const life = useLens('Life', undefined, isLife);

  const serverCandidates = isWeekly ? mode.candidates : undefined;
  const exclude = isParent || isHost ? mode.exclude : undefined;
  const lifeOnly = isParent && mode.only === 'life';
  const weeklyParent = isWeekly ? mode.parentId : '';
  const subjectHorizon = isParent ? mode.horizon : null;

  const pages = useMemo<(LensResponse | undefined)[]>(() => {
    if (isParent) return parents.pages;
    if (isHost) return [yearly.data, quarterly.data, monthly.data];
    if (isWeekly) return [weekly.data];
    return [life.data];
  }, [isParent, isHost, isWeekly, parents.pages, yearly.data, quarterly.data, monthly.data, weekly.data, life.data]);

  const groups = useMemo(() => mergeGroups(pages), [pages]);

  const options = useMemo<GoalOption[]>(() => {
    if (serverCandidates) {
      /**
       * D-18 / S-backlog-26-3 — the server refused and named the candidates. It knows the subtree; the
       * client does not (R-lens-16). Everything but the id and the title is unknown, and a row that
       * invents a period would be worse than one that says only what it was told.
       */
      return serverCandidates.map((c) => ({
        id: c.id,
        title: c.title,
        why: '',
        horizon: 'Weekly' as Horizon,
        period: '',
        createdAt: '',
        lineId: null,
        line: '',
      }));
    }
    const source: GoalView[] = isParent
      ? parents.options
      : isHost
        ? [...(yearly.data?.items ?? []), ...(quarterly.data?.items ?? []), ...(monthly.data?.items ?? [])]
        : isWeekly
          ? (weekly.data?.items ?? [])
          : (life.data?.items ?? []);

    /**
     * The rule, applied once, to every mode — **after** the reads have already scoped it. That is
     * deliberate belt-and-braces: the reads say which page to look at, and this says what is legal on it,
     * so a widened read can never quietly start offering an illegal goal.
     */
    const legal = source.filter((g) => {
      if (exclude?.includes(g.id)) return false;
      if (isParent) return subjectHorizon !== null && rank(g.horizon) < rank(subjectHorizon) && (!lifeOnly || g.horizon === 'Life');
      if (isHost) return g.horizon !== 'Life' && g.horizon !== 'Weekly';
      if (isWeekly) return g.horizon === 'Weekly' && g.parentId === weeklyParent;
      return g.horizon === 'Life';
    });
    return legal.map((g) => optionOf(g, groups));
  }, [serverCandidates, isParent, isHost, isWeekly, parents.options, yearly.data, quarterly.data, monthly.data, weekly.data, life.data, groups, exclude, subjectHorizon, weeklyParent, lifeOnly]);

  const queries = isHost ? [yearly, quarterly, monthly] : isWeekly ? (weeklyEnabled ? [weekly] : []) : isLife ? [life] : [];
  return {
    options,
    groups,
    isPending: isParent ? parents.isPending : queries.some((q) => q.isPending),
    truncated: isParent ? parents.truncated : queries.some((q) => q.data?.nextCursor != null),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The list
// ─────────────────────────────────────────────────────────────────────────────

/** A leading row that is not a goal — `lifeLine`'s `No goal`, which is a legal tag (R-learning-3). */
export interface ExtraRow {
  label: string;
  detail?: string;
}

/** The disambiguator: inside a group the line is the header, so the row says its horizon and period. */
const inGroupDetail = (o: GoalOption): string =>
  o.period ? `${o.horizon.toUpperCase()} · ${o.period}` : o.horizon.toUpperCase();

/** In `RECENT` and in search results the neighbours come from different lines, so the line is the detail. */
const flatDetail = (o: GoalOption): string => {
  const parts = [o.line && o.line !== o.title ? o.line : null, o.period || o.horizon.toUpperCase()];
  return parts.filter(Boolean).join(' · ');
};

/**
 * The accessible name of a row, which **always** carries the line and the period, however the row is
 * being rendered. That is the answer to the owner's real problem: two goals with the same title in
 * different Life lines are one utterance apart, not indistinguishable.
 */
const optionLabel = (o: GoalOption): string => {
  if (o.horizon === 'Life') return `${o.title} — Life goal`;
  const bits = [o.line && o.line !== o.title ? o.line : null, o.horizon, o.period || null].filter(Boolean);
  return bits.length ? `${o.title} — ${bits.join(' · ')}` : o.title;
};

/** ⚠ **A9** — the third empty state: legal goals exist, none at the horizon you are standing on. */
const scopedEmptyNote = (horizon: Horizon, searchable: boolean): string =>
  `No ${horizon.toLowerCase()} goal to choose here. Pick another horizon above${searchable ? ', or search across all of them' : ''}.`;

/**
 * ⚠ **R-backlog-14, generalised (§7.4).** The drawer's module-level `lastUsedGoalId` becomes one recency
 * list shared by every mode: the goal you filed under last time is the same goal whether you are adding a
 * backlog item or moving one.
 *
 * Session-scoped, exactly as it was — one page load, no storage — and **recency, not frequency**: recency
 * is honest, cheap and self-correcting, while frequency needs counting and rewards last month's habits.
 */
let recent: string[] = [];
const RECENT_ROWS = 3;

export const recentGoalIds = (): readonly string[] => recent;
export const rememberGoal = (id: string | null): void => {
  if (!id) return;
  recent = [id, ...recent.filter((x) => x !== id)].slice(0, RECENT_ROWS);
};
/**
 * ⚠ **A9 — the parent a create form defaults to: the NEAREST legal ancestor.**
 *
 * The owner, creating a Monthly goal in `Sep 2026`, was shown the Life goal *"Be financially independent"*
 * — because there was no default at all. `GoalFormSheet` preselected a parent only when exactly **one** was
 * legal; with three the picker selected nothing, and the roving-focus ring sat on row 0, which is the Life
 * goal (`useParentOptions` concatenates Life, Yearly, Quarterly, Monthly in that order). A picker that
 * *looks* preselected and is not is worse than either honest state.
 *
 * The nearest legal ancestor is **the deepest goal whose period contains the new goal's period**. That is
 * one line here because `useParentOptions` has already done the containment half: each longer horizon is
 * read at `enclosingKey`, the period that encloses this one, so every option's period contains the new
 * goal's by construction and "nearest" reduces to "highest rank". For a new Monthly goal in `Sep 2026`
 * that is the Quarterly goal for `Q3 2026`.
 *
 * Ties are broken by the picker's shared `RECENT` list (R-backlog-14, generalised), then by the server's
 * own order. Two Quarterly goals in the same line and the same quarter is a real account shape, and array
 * order is not a decision (D-18) — but this is a *default* the owner can see and change in one tap, not a
 * silent write, which is exactly the distinction that made D-18 refuse to choose on the server.
 */
export function nearestAncestor(options: readonly GoalOption[], recentIds: readonly string[] = recent): GoalOption | null {
  if (options.length === 0) return null;
  const deepest = options.reduce((max, o) => Math.max(max, rank(o.horizon)), -1);
  const pool = options.filter((o) => rank(o.horizon) === deepest);
  return pool.find((o) => recentIds.includes(o.id)) ?? pool[0] ?? null;
}

/** Test-only reset; a module-level list must not leak from one test into the next. */
export const forgetRecentGoals = (): void => {
  recent = [];
};

type Row = { key: string; id: string | null; label: string; title: string; detail: string };
type Section = { key: string; title: string | null; rows: Row[] };

/**
 * The listbox: a search field over a rule-scoped list, grouped by Life goal, every row carrying its line
 * and its period.
 *
 * **The roles are the point.** R-lens-13's one surviving requirement — *"the selection is ANNOUNCED,
 * never merely coloured"* — was satisfied by the Zoom sheet and by nothing else in the app; every picker
 * conveyed its choice with a background colour. Here it is `role="listbox"` with `role="option"` rows and
 * `aria-selected`, grouped by `role="group"`, a single tab stop with `aria-activedescendant`, and a
 * `role="status"` that says how many rows the typing left.
 */
export function GoalPickerList({
  options,
  groups,
  value,
  onChange,
  empty,
  extra,
  isPending,
  truncated,
  listLabel = 'Goals',
  tall = false,
  focusOnMount = false,
  horizons = [],
}: {
  options: readonly GoalOption[];
  groups: readonly { id: string | null; title: string }[];
  value: string | null;
  onChange: (id: string | null, title?: string) => void;
  /** The sentence for "there is nothing legal to offer" — every one of them is an existing string, moved. */
  empty?: ReactNode;
  extra?: ExtraRow;
  isPending?: boolean;
  truncated?: boolean;
  listLabel?: string;
  tall?: boolean;
  focusOnMount?: boolean;
  /**
   * ⚠ **A9** — the horizons this mode permits (`permittedHorizons`), broadest first. Two or more render the
   * selector and scope the list; one or none renders nothing and the list is every option, which is what
   * keeps `weeklyTarget` and `lifeLine` exactly as they shipped.
   */
  horizons?: readonly Horizon[];
}) {
  const S = useSkin();
  const domId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [announced, setAnnounced] = useState('');
  /** `null` until the reads land: the default depends on which horizons actually have something. */
  const [horizon, setHorizon] = useState<Horizon | null>(null);

  // §7.5 — the field renders only when there are more than 8 options. Searching a list you can see whole
  // is chrome, and this is where the promise not to tax an account with ten goals is kept. ⚠ **A9 — the
  // count is the TOTAL, across every horizon**, because search deliberately crosses them: scoping is a
  // default view, not a cage, and a field that vanished when you narrowed to one horizon would make the
  // one thing that reaches the whole list unreachable.
  const searchable = options.length > PICKER_THRESHOLD;
  const searching = searchable && query.trim() !== '';

  const scoped = horizons.length > 1;
  const shownHorizon = horizon ?? defaultHorizon(horizons, options, value);
  /**
   * ⚠ **A9 — scoping is a DEFAULT VIEW, not a cage.** While the field is empty the list is one horizon;
   * the moment anything is typed it is every option again, ranked. That is the whole reason the horizon
   * control can be a default rather than a filter the owner has to remember they set (R-lens-15's
   * distinction, one layer down).
   */
  const visible = useMemo(
    () => (!scoped || searching ? options : options.filter((o) => o.horizon === shownHorizon)),
    [options, scoped, searching, shownHorizon],
  );

  const sections = useMemo<Section[]>(() => {
    const rowOf = (o: GoalOption, flat: boolean, prefix: string): Row => ({
      key: `${prefix}:${o.id}`,
      id: o.id,
      label: optionLabel(o),
      title: o.title,
      detail: flat ? flatDetail(o) : inGroupDetail(o),
    });
    const head: Section[] = extra ? [{ key: 'extra', title: null, rows: [{ key: 'extra', id: null, label: extra.label, title: extra.label, detail: extra.detail ?? '' }] }] : [];

    if (searching) {
      // §7.5 — a ranked list re-sorted into groups is not ranked, so grouping collapses to one flat list.
      // ⚠ **A9** — ranked across EVERY horizon: `visible` is the unscoped set while a query is live.
      const ranked = rankGoals(visible, query, { lineTitleOf: (o) => o.line });
      return [...head, { key: 'results', title: null, rows: ranked.map((m) => rowOf(m.goal, true, 'r')) }];
    }

    const sortedIds = new Set<string>();
    const out: Section[] = [...head];
    // §7.4 — up to three, most-recently-chosen first, and only when the whole list is too long to scan.
    const recentRows = recent.map((id) => visible.find((o) => o.id === id)).filter((o): o is GoalOption => !!o);
    if (searchable && recentRows.length >= 2) {
      out.push({ key: 'recent', title: 'RECENT', rows: recentRows.slice(0, RECENT_ROWS).map((o) => rowOf(o, true, 'rec')) });
    }

    // A Life-goal list groups under itself, which is a header per row and says nothing: it stays flat.
    const flatMode = visible.length > 0 && visible.every((o) => o.horizon === 'Life');
    if (flatMode) {
      out.push({ key: 'all', title: null, rows: visible.map((o) => rowOf(o, true, 'g')) });
      return out;
    }

    for (const g of groups) {
      const mine = visible.filter((o) => o.lineId === g.id);
      if (mine.length === 0) continue;
      for (const o of mine) sortedIds.add(o.id);
      out.push({ key: `g:${g.id ?? 'unsorted'}`, title: g.title, rows: mine.map((o) => rowOf(o, false, 'g')) });
    }
    // A group the reads did not describe is still rendered: a data problem must surface (R-lens-20).
    const orphans = visible.filter((o) => !sortedIds.has(o.id));
    if (orphans.length) out.push({ key: 'g:rest', title: null, rows: orphans.map((o) => rowOf(o, true, 'g')) });
    return out;
  }, [visible, groups, query, searchable, searching, extra]);

  const rows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  // R-lens-19, generalised — one non-empty group needs no header. One rule, two surfaces.
  const namedSections = sections.filter((s) => s.title !== null);
  const showHeaders = namedSections.length > 1 || (namedSections.length === 1 && namedSections[0]!.key === 'recent');

  const activeRow = rows[Math.min(active, rows.length - 1)];
  const activeDomId = activeRow ? `${domId}-${activeRow.key}` : undefined;

  useEffect(() => {
    setActive((a) => (a >= rows.length ? 0 : a));
  }, [rows.length]);

  useEffect(() => {
    // Once, on the render that put the picker on screen — never on every keystroke.
    if (focusOnMount) (listRef.current ?? inputRef.current)?.focus();
  }, [focusOnMount]);

  // §8.2 — the count, debounced so typing does not chatter. It is the only thing this component says out
  // loud; the selection announces itself through `aria-selected`.
  useEffect(() => {
    const goalRows = rows.filter((r) => r.id !== null).length;
    if (!searching) {
      // ⚠ **A9** — narrowing to a horizon changes what the list holds, so it is announced for the same
      // reason the search count is. `horizon === null` is the untouched default, which announces nothing.
      if (!scoped || horizon === null) {
        setAnnounced('');
        return;
      }
      setAnnounced(`${shownHorizon} — ${goalRows} goal${goalRows === 1 ? '' : 's'}`);
      return;
    }
    const t = setTimeout(() => setAnnounced(goalRows === 0 ? `No goals match “${query}”` : `${goalRows} goal${goalRows === 1 ? '' : 's'}`), 300);
    return () => clearTimeout(t);
  }, [searching, query, rows, scoped, horizon, shownHorizon]);

  const choose = useCallback(
    (row: Row) => {
      rememberGoal(row.id);
      // The title rides along because the toast that follows a choice names it, and the caller has no
      // list of its own to look it up in any more — that absence is the whole point of R-nav-31.
      onChange(row.id, row.title);
    },
    [onChange],
  );

  /**
   * ⚠ **Two-stage Escape, without touching `Sheet`.** `Sheet` listens on `document` in the capture phase
   * and stops propagation, so an element handler here would never see the key. A capture listener on
   * **`window`** runs one step earlier in the same phase, which is exactly enough to let a non-empty
   * search field swallow the first Escape and clear itself — and to let the second one close the sheet,
   * through `Sheet`'s own unchanged contract. Escape never selects anything, at either stage.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || query === '') return;
      const root = rootRef.current;
      if (!root || !(e.target instanceof Node) || !root.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      setQuery('');
      setActive(0);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [query]);

  /**
   * ⚠ **A9 — the horizon selector's keyboard model, which is the radiogroup pattern and not a second one.**
   *
   * A roving tabindex over `role="radio"` chips: exactly one is in the tab order, `←`/`→` (and `↑`/`↓`,
   * because the chips are one row of a vertical form) move **and select**, `Home`/`End` reach the ends.
   * That is R-lens-13's surviving requirement — one tab stop, arrows along the axis, the selection
   * announced rather than merely coloured — applied to the second control this picker now has.
   *
   * It is a `radiogroup` rather than a `tablist` on purpose: a tab implies a `tabpanel`, and the thing it
   * would control is a `listbox`, which cannot be one. A radiogroup says what this actually is — a
   * single-choice narrowing of the list below it — and it needs no `aria-controls` fiction to say it.
   *
   * **Never a second focus trap.** The chips, the search field and the list are three ordinary tab stops
   * inside the one dialog `Sheet` already traps; nothing here traps anything.
   */
  const pickHorizon = (h: Horizon) => {
    setHorizon(h);
    setActive(0);
  };

  const move = (to: number) => {
    if (rows.length === 0) return;
    const next = Math.max(0, Math.min(rows.length - 1, to));
    setActive(next);
    const el = document.getElementById(`${domId}-${rows[next]!.key}`);
    // Optional because jsdom does not implement it, and a keyboard model must not depend on a scroll.
    el?.scrollIntoView?.({ block: 'nearest' });
  };

  const onListKey = (e: ReactKeyboardEvent) => {
    // §8.3 — the axis follows the list, and this list runs down the page.
    if (e.key === 'ArrowDown') return void (e.preventDefault(), move(active + 1));
    if (e.key === 'ArrowUp') return void (e.preventDefault(), move(active - 1));
    if (e.key === 'Home') return void (e.preventDefault(), move(0));
    if (e.key === 'End') return void (e.preventDefault(), move(rows.length - 1));
    if (e.key === 'Enter' || e.key === ' ') {
      if (!activeRow) return;
      e.preventDefault();
      choose(activeRow);
      return;
    }
    // §8.3 — typing from the list moves to the field and inserts the character, so there is ONE search
    // mechanism rather than a separate first-letter jump that would disagree with it.
    if (searchable && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      setQuery((q) => q + e.key);
      setActive(0);
      inputRef.current?.focus();
    }
  };

  /** The account has legal options — just not at the horizon on screen. A3's third empty state. */
  const scopedEmpty = scoped && !searching && options.length > 0 && visible.length === 0;

  const box = {
    border: `1px solid ${S.T.line}`,
    borderRadius: 12,
    maxHeight: tall ? '52vh' : '40vh',
    overflow: 'auto',
    outlineOffset: 2,
  } as const;

  return (
    <div ref={rootRef}>
      {/*
       * ⚠ **A9 — the horizon selector, and why it comes FIRST.**
       *
       * The owner's proposal: choose the lens, then the goals in it. Putting it above the search field and
       * the list makes the reading order the decision order, and makes the list's size a structural fact
       * — one horizon's goals — rather than a number someone tuned.
       *
       * `S.chipBtn` is the product's existing segmented chip; no new colour and no new token, so
       * `tests/screens/contrast.test.ts` has nothing new to check.
       */}
      {scoped && (
        /*
         * ⚠ **A11/A8 — the keyboard model is `ChipRadioGroup`'s now, and this file no longer owns a copy
         * of it** (`32-week-selection` §7's "extract, do not duplicate" directive). A9 wrote it here; A11's
         * `When this lands` control and A8's measure-kind chips ask for the identical thing, and *"a second
         * copy of a keyboard model is how two controls in one sheet come to disagree about `Home`."*
         *
         * Nothing about this control's DOM changes: the same `role="radiogroup"` named `Horizon`, the same
         * ids, the same `aria-label` carrying the count so "this tab is empty" is heard and not only seen.
         */
        <ChipRadioGroup
          label="Horizon"
          idPrefix={`${domId}-h`}
          value={shownHorizon}
          onChange={(h) => pickHorizon(h as Horizon)}
          style={{ marginBottom: 10 }}
          options={horizons.map((h) => {
            const count = options.filter((o) => o.horizon === h).length;
            return { value: h, label: h, name: `${h} — ${count} goal${count === 1 ? '' : 's'}` };
          })}
        />
      )}

      {searchable && (
        <input
          ref={inputRef}
          // The APG combobox pattern, with the list as its own tab stop (§8.1): both controls point at the
          // active option, so it is announced whichever of the two the user is standing on.
          role="combobox"
          // Expanded only while there IS a list: a combobox pointing at an id nothing renders is a
          // broken relationship, and an empty result set is exactly when it would happen.
          aria-expanded={rows.length > 0}
          {...(rows.length > 0 ? { 'aria-controls': `${domId}-list` } : {})}
          aria-autocomplete="list"
          aria-activedescendant={activeDomId}
          aria-label="Search goals"
          placeholder="Search goals"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              listRef.current?.focus();
              move(0);
            }
            if (e.key === 'Enter' && activeRow) {
              e.preventDefault();
              choose(activeRow);
            }
          }}
          style={{ ...S.input, marginBottom: 10 }}
        />
      )}

      {isPending && rows.length === 0 && <div style={{ fontSize: 13, color: S.T.mut, padding: '12px 14px' }}>Loading…</div>}

      {!isPending && rows.length === 0 && (
        <div style={{ fontSize: 13.5, color: S.T.mut, padding: searching || scopedEmpty ? '12px 2px' : '12px 14px' }}>
          {/*
           * Three empty states, not one. ⚠ **A9 adds the middle one**: the account HAS legal goals, just
           * none at the horizon on screen, and `empty`'s sentence ("nothing to file this under yet") would
           * be a flat lie there. It names the way out rather than only the absence.
           */}
          {searching ? `No goals match “${query}”.` : scopedEmpty ? scopedEmptyNote(shownHorizon, searchable) : empty}
        </div>
      )}

      {rows.length > 0 && (
        <div
          ref={listRef}
          id={`${domId}-list`}
          role="listbox"
          tabIndex={0}
          aria-label={listLabel}
          aria-activedescendant={activeDomId}
          onKeyDown={onListKey}
          style={box}
        >
          {sections.map((section) => (
            <div key={section.key} {...(section.title ? { role: 'group', 'aria-label': section.title } : {})}>
              {section.title && showHeaders && (
                <div aria-hidden="true" style={{ ...S.sectionLabel, padding: '10px 12px 4px 12px', background: S.T.card }}>
                  {section.title}
                </div>
              )}
              {section.rows.map((row) => {
                const selected = row.id === value;
                const isActive = activeRow?.key === row.key;
                return (
                  <div
                    key={row.key}
                    id={`${domId}-${row.key}`}
                    role="option"
                    aria-selected={selected}
                    aria-label={row.label}
                    // A pointer choice must not steal the list's focus on the way to the click.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(row)}
                    style={{
                      ...S.pickerRow(selected ? 'sel' : 'ok'),
                      display: 'block',
                      minHeight: 46,
                      padding: '8px 12px',
                      ...(isActive && !selected ? { background: S.T.lineSoft } : {}),
                      ...(isActive ? { boxShadow: `inset 0 0 0 2px ${S.ring}` } : {}),
                    }}
                  >
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: S.T.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.title}
                    </div>
                    {row.detail && <div style={{ fontSize: 11.5, fontWeight: 700, color: S.T.mut, marginTop: 2 }}>{row.detail}</div>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/*
       * §7.7 — the cap stops being silent. Every picker in this app was capped at `MAX_PAGE` with no
       * indication, which is the one failure worse than a slow list: a picker that quietly omits a goal
       * teaches you the goal is gone.
       */}
      {truncated && (
        <div style={{ fontSize: 12.5, color: S.T.mut, marginTop: 8 }} data-testid="picker-truncated">
          {TRUNCATION_NOTICE}
        </div>
      )}

      <div role="status" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {announced}
      </div>
    </div>
  );
}

/**
 * The mode-driven picker, **rendered in place as the inline list**.
 *
 * ⚠ **A9 — this is now the surface distinction, and it is the whole of the fix to the flooded sheet.**
 * `GoalPicker` is for the places where the picker **is** the whole surface and has the room to be a list:
 * `Move goal`, whose sheet body is nothing else; a backlog row's `Move to another goal`, on a screen; the
 * Learnings tag, on a screen. Anywhere the picker is **one field among several in a form** it is
 * `useGoalPicker` instead, which is a compact row at every option count.
 *
 * Before this the two shared one rule — eight options — and a `New Monthly goal` sheet with three legal
 * parents got the inline list, ate the sheet with three two-line rows, and pushed `Save goal` off screen.
 * A threshold cannot tell those two surfaces apart, because the difference is not how many options there
 * are; it is whether anything else on screen needs the space.
 */
export function GoalPicker(props: {
  mode: PickerMode;
  value: string | null;
  onChange: (id: string | null, title?: string) => void;
  empty?: ReactNode;
  extra?: ExtraRow;
  listLabel?: string;
  tall?: boolean;
  focusOnMount?: boolean;
}) {
  const { mode, ...rest } = props;
  const { options, groups, isPending, truncated } = useGoalOptions(mode);
  const horizons = useMemo(() => permittedHorizons(mode), [mode]);
  return <GoalPickerList options={options} groups={groups} isPending={isPending} truncated={truncated} horizons={horizons} {...rest} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// The field, and the takeover
// ─────────────────────────────────────────────────────────────────────────────

/**
 * §7.6 — **the picker as a FIELD in a form: one row showing the current choice, at every option count.**
 *
 * ⚠ **A9 — the threshold is gone from this decision.** It used to read *"≤ 8 options — the inline list, in
 * the form"*, and the owner found what that costs: his `New Monthly goal` sheet had three legal parents, so
 * it rendered three two-line rows inline, and `Save goal` went below the fold. A form sheet has other
 * fields and a save button; a list of any length is the wrong shape for one field in it. So a field it is,
 * always — one line, the current choice with its line and period, tap to open.
 *
 * The threshold still governs the search field inside the opened picker (`PICKER_THRESHOLD`), which is the
 * one job it was always right about.
 *
 * And the full picker **takes over the sheet it was opened from**: the sheet swaps its own body, its
 * heading becomes `Choose a goal`, and a back control naming where you came from appears beside it. The
 * sheet never unmounts, so typed work survives by construction — no draft to hoist, no second focus trap,
 * no z-index stack, and no change to `Sheet` at all.
 */
export function useGoalPicker({
  mode,
  value,
  onChange,
  from,
  fieldLabel = 'Choose a goal',
  empty,
  extra,
  listLabel,
}: {
  mode: PickerMode;
  value: string | null;
  onChange: (id: string | null, title?: string) => void;
  /** The sheet you came from, named on the back control: `‹ New Monthly goal`. */
  from: string;
  fieldLabel?: string;
  empty?: ReactNode;
  extra?: ExtraRow;
  listLabel?: string;
}): {
  taken: boolean;
  heading: string;
  headerRight: ReactNode;
  panel: ReactNode;
  control: ReactNode;
  options: GoalOption[];
  isPending: boolean;
  truncated: boolean;
} {
  const S = useSkin();
  const { options, groups, isPending, truncated } = useGoalOptions(mode);
  const horizons = useMemo(() => permittedHorizons(mode), [mode]);
  const [taken, setTaken] = useState(false);
  const fieldRef = useRef<HTMLButtonElement>(null);
  const returning = useRef(false);

  const open = taken;

  useEffect(() => {
    if (!open && returning.current) {
      returning.current = false;
      fieldRef.current?.focus();
    }
  }, [open]);

  const close = () => {
    returning.current = true;
    setTaken(false);
  };

  const chosen = options.find((o) => o.id === value) ?? null;

  const list = (
    <GoalPickerList
      options={options}
      groups={groups}
      value={value}
      onChange={(id, title) => {
        onChange(id, title);
        if (open) close();
      }}
      empty={empty}
      extra={extra}
      isPending={isPending}
      truncated={truncated}
      listLabel={listLabel}
      horizons={horizons}
      tall={open}
      focusOnMount={open}
    />
  );

  return {
    options,
    isPending,
    truncated,
    taken: open,
    heading: 'Choose a goal',
    headerRight: open ? (
      <button
        type="button"
        onClick={close}
        style={{ minHeight: 36, border: 'none', background: 'none', fontSize: 13, fontWeight: 700, color: S.T.accentLink, cursor: 'pointer', fontFamily: 'inherit' }}
      >
        ‹ {from}
      </button>
    ) : null,
    panel: list,
    // ⚠ **A9** — no `asField` branch any more: a picker inside a form is a row, at every option count.
    control: (
      <button
        type="button"
        ref={fieldRef}
        onClick={() => setTaken(true)}
        aria-haspopup="listbox"
        /**
         * ⚠ **A9 — the field announces its PURPOSE and its VALUE, in that order.**
         *
         * It used to announce the value alone once something was chosen, which made an unlabelled control
         * out of the one field in the form that now always renders. `Choose a goal: Rebuild the gym habit
         * — Be strong at 60 · Q3 2026` is what a filled field should say, and it keeps the label stable
         * whether or not there is a choice in it.
         */
        aria-label={chosen ? `${fieldLabel}: ${chosen.title} — ${flatDetail(chosen)}` : fieldLabel}
        style={{
          ...S.pickerRow('ok'),
          display: 'flex',
          alignItems: 'center',
          border: `1px solid ${S.T.border}`,
          borderRadius: 12,
          minHeight: 52,
          padding: '8px 12px',
        }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: chosen ? S.T.ink : S.T.mut, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {chosen ? chosen.title : fieldLabel}
          </span>
          {chosen && <span style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: S.T.mut, marginTop: 2 }}>{flatDetail(chosen)}</span>}
        </span>
        <span aria-hidden="true" style={{ color: S.T.mut, marginLeft: 8 }}>
          ›
        </span>
      </button>
    ),
  };
}
