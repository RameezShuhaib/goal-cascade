import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { GoalView, Horizon, TaskView } from '@goal-cascade/shared';
import { useUI } from '../context/UIContext';
import { useSkin } from '../skin';
import { TaskRow } from '../components/TaskRow';
import { goalPath } from '../routes';
import { shortDate } from '../utils/dates';
import { plural } from '../utils/tree';
import { lifeLine, lifeLineName, NOT_UNDER_LIFE, NOT_UNDER_LIFE_NAME, NOTHING_ON_MONTH, plannedNess, stalePlanLine } from './copy';

/** The Life goal an item's chain reaches, or `null` when it reaches none (R-lens-20). */
export interface LifeRef {
  id: string;
  title: string;
}

/**
 * The item cards. Every lens's body is a **flat list** of these — no grouping, at any horizon (R-lens-3,
 * deleted by the owner's own reversal: *"lets not categorise based on life in any horizon"*).
 *
 * **No horizon chip.** Every item in a lens is at the same horizon and the title says which one; a
 * `QUARTERLY` badge repeated down a quarterly list is the definition of noise. The chip survives on the
 * goal detail page, where the horizon is genuinely ambiguous.
 *
 * ── The Life line (R-lens-23, rewritten) ──────────────────────────────────────
 * Every item at every horizon except Life renders **one muted line naming the Life goal its chain
 * reaches**, with no suppression. That is the string the group header carried, moved from above a run of
 * cards to inside each of them, and it is what makes a flat list orientable. `GoalView.lifeRootId` plus
 * `LensResponse.groups` answer it, so the client still walks no ancestor chain and holds no tree
 * (R-lens-16, S-lens-16-2) — the lookup is a `Map.get`.
 *
 * ── Density (`29-ux-navigation` §5) ───────────────────────────────────────────
 * **`why` leaves all four working lenses and stays only on the Life lens, clamped to one line.** It is
 * written once, never changes, repeats down a run of cards that share a motivation, is unbounded free
 * text that wraps a two-line card into four, and is one tap away on the goal's page — the only line on a
 * working card that answers no question you have while working. It pays, line for line, for the `under`
 * line above, so a Monthly card is one line SHORTER than it was.
 */

function CardShell({ children, onOpen, label }: { children: ReactNode; onOpen?: () => void; label?: string }) {
  const S = useSkin();
  return (
    /*
     * `role="group"` is what makes the `aria-label` real. On a bare `<div>` the implicit role is
     * `generic`, and ARIA-in-HTML does not honour an accessible name on it — so the Monthly card's
     * planned-ness line was NOT being folded into the card's name, while the comment further down said
     * it was. A name with no role is a name nothing reads.
     */
    <div style={{ ...S.card, padding: '14px 16px' }} data-testid="lens-card" role={label ? 'group' : undefined} aria-label={label}>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          style={{ width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: 0, cursor: 'pointer', minWidth: 0, fontFamily: 'inherit' }}
        >
          {children}
        </button>
      ) : (
        children
      )}
    </div>
  );
}

/**
 * R-lens-23, rewritten — **the Life line: one muted line, one name, and a way UP.**
 *
 * A button opening that Life goal's detail page, which is the only way to walk up now that there is no
 * tree. You can never walk *down* into a subtree, which is the thing that was cluttered.
 *
 * **Why the Life goal and not the immediate parent.** It is exactly the string the group header carried,
 * so nothing leaves the screen; it is one rule at four horizons rather than four different facts wearing
 * one word (a Yearly goal on the Quarterly lens, a Quarterly goal on the Monthly lens, …); and Life-line
 * titles are short, few and memorised, where intermediate titles are long, varied and read as noise when
 * repeated down a list. Full ancestry is on the goal's own page, with its crumb trail — the card is for
 * scanning, the page is for ancestry.
 *
 * **The root-less case is a state, not a blank** (R-lens-20): `Not under a Life goal yet`, a button
 * opening the Move sheet in `only: 'life'` mode. It is the first time that state has had a
 * keyboard-reachable action at all.
 *
 * `T.mut` at 12.5px. (`faint` is **deleted**: it failed AA in both themes — 2.06:1 on a light card —
 * and every one of its six uses was text, so a token that may not carry text and carried nothing else had
 * no job left. `tests/screens/contrast.test.ts` now measures every text token, so the rule is a
 * mechanism rather than a comment.) It re-uses the `Muted` register the backlog line and the staleness
 * line already sit in, so it adds no colour token and cannot fail `contrast.test.ts`.
 */
function LifeLine({ life, goalId }: { life: LifeRef | null; goalId: string }) {
  const S = useSkin();
  const ui = useUI();
  const navigate = useNavigate();
  const style = {
    border: 'none',
    background: 'none',
    padding: 0,
    minHeight: 22,
    textAlign: 'left',
    fontSize: 12.5,
    color: S.T.mut,
    cursor: 'pointer',
    fontFamily: 'inherit',
    /*
     * ⚠ **Crumbs never wrap** (R-goal-41, amended) — and `under <title>` is a crumb. It was
     * unconstrained, so the owner's own titles wrapped it to three lines *inside a card*, pushing the
     * backlog line down and making a two-line card a four-line one. One line, tail-truncated; the
     * `aria-label` already carries the full name, so nothing is lost to a screen reader and the card it
     * points at is one tap away.
     */
    display: 'block',
    maxWidth: '100%',
    minWidth: 0,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  } as const;
  return (
    <div style={{ marginTop: 3, minWidth: 0 }}>
      {life ? (
        <button type="button" aria-label={lifeLineName(life.title)} onClick={() => navigate(goalPath(life.id))} style={style}>
          {lifeLine(life.title)}
        </button>
      ) : (
        <button
          type="button"
          aria-label={NOT_UNDER_LIFE_NAME}
          onClick={() => ui.openSheet({ kind: 'moveGoal', goalId, lifeGoalsOnly: true })}
          style={style}
        >
          {NOT_UNDER_LIFE}
        </button>
      )}
    </div>
  );
}

function Title({ goal }: { goal: GoalView }) {
  const S = useSkin();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      {/* R-goal-15 — the pulse dot. Never dimmed: no goal is muted or greyed anywhere any more (R-goal-38). */}
      <span style={S.dot(goal.pulse)} />
      <span style={{ fontSize: 15.5, fontWeight: 700, color: S.T.ink, minWidth: 0 }}>{goal.title}</span>
    </div>
  );
}

const Muted = ({ children }: { children: ReactNode }) => {
  const S = useSkin();
  // `T.mut`. `faint` is deleted — it failed AA in both themes and every use of it was load-bearing text.
  return <div style={{ fontSize: 12.5, color: S.T.mut, marginTop: 3 }}>{children}</div>;
};

/** R-goal-25 — `N in backlog`, on any card whose goal holds open items of its own. */
function BacklogLine({ goal }: { goal: GoalView }) {
  return goal.backlogCount > 0 ? <Muted>{goal.backlogCount} in backlog</Muted> : null;
}

/**
 * The Life lens card. The one lens with **no groups** — each Life goal *is* a group of one, so a header
 * would name the card beneath it, and the count and backlog line move onto the card instead.
 *
 * R-goal-24's carrying line renders here and nowhere else in a lens: it is the product's one quiet signal,
 * and two carry numbers in one place would be one too many (R-lens-4).
 */
export function LifeCard({ goal, openTasks }: { goal: GoalView; openTasks: number }) {
  const S = useSkin();
  const navigate = useNavigate();
  const bits = [openTasks > 0 ? `${openTasks} open` : null, goal.backlogCount > 0 ? `${goal.backlogCount} in backlog` : null].filter(Boolean);
  return (
    <CardShell onOpen={() => navigate(goalPath(goal.id))}>
      <Title goal={goal} />
      {/*
       * ⚠ **`why` survives HERE and nowhere else, and it gains a one-line clamp** (§5.2). There are five
       * or six Life goals, they have no ancestry line to compete with, and *why* is the entire reason a
       * Life goal exists. Unbounded it wrapped a two-line card into four; `nowrap` + tail ellipsis is the
       * same clamp `22-ux-fixes` §4.5 already applies to crumbs.
       */}
      {goal.why && (
        <div style={{ fontSize: 12.5, color: S.T.mut, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
          {goal.why}
        </div>
      )}
      {/*
       * R-lens-4, rewritten — **the open-task count's one home.** It used to sit on the group header at
       * every horizon, where a flat Monthly list would print the same per-line number once per card. On
       * the Life lens each line appears exactly once, so the number is stated once, is never repeated,
       * and is one tap away from anywhere. A zero is never rendered.
       */}
      {bits.length > 0 && <Muted>{bits.join(' · ')}</Muted>}
      {goal.carrying && (
        <div style={{ fontSize: 12, color: S.T.mut, marginTop: 3 }}>
          {`${plural(goal.carrying.openTasks, 'task')} carrying · oldest ${plural(goal.carrying.oldestWeeks, 'week')}`}
        </div>
      )}
    </CardShell>
  );
}

/**
 * Yearly and Quarterly: title, the Life line, `N in backlog`. Nothing else belongs on them — `why` left
 * with §5.2 and pays for the line above it.
 *
 * The shell no longer wraps the whole card in one button, because R-lens-23's parent line IS a button and
 * a button inside a button is not a control anyone can operate. The title keeps its own button and the
 * lines below it are siblings — which also puts them in the order R-goal-43 fixes: parent line, then the
 * backlog line, with the staleness line between them on a Weekly card.
 */
export function PlainCard({ goal, life }: { goal: GoalView; life: LifeRef | null }) {
  const navigate = useNavigate();
  return (
    <CardShell>
      <button
        type="button"
        onClick={() => navigate(goalPath(goal.id))}
        style={{ width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: 0, cursor: 'pointer', minWidth: 0, fontFamily: 'inherit' }}
      >
        <Title goal={goal} />
      </button>
      <LifeLine life={life} goalId={goal.id} />
      <BacklogLine goal={goal} />
    </CardShell>
  );
}

/**
 * R-goal-47 — the Monthly card, and **dormancy's one surface**.
 *
 * If work only ever lives at the week, a Monthly goal is a container whose entire purpose is the Weekly
 * goals beneath it, and a lens showing only titles would leave the owner unable to tell a planned month
 * from an empty one. So one muted line says how the month is broken into weeks.
 *
 * Three things it deliberately is **not**: not a progress bar, percentage or chart (R-nav-26 — the product
 * has no reports and gains none here); not an **escalation** (`nothing this week` is the same grey as
 * `3 weekly goals`, because a month being unplanned is a fact and not a failure); and not a **link**,
 * because zooming into one card's weeks is a filtered subtree and the subtree is the thing being removed.
 * The line is text; the card's `+ Task` is the action.
 *
 * The card carries **no `+ Weekly goal`** (R-task-49, Q-20 amended): a create button for the horizon below
 * on every card is a tree growing back one affordance at a time.
 */
export function MonthlyCard({
  goal,
  tasks,
  canCreate,
  life,
}: {
  goal: GoalView;
  /** ⚠ **A8 (R-lens-32)** — the goal's own MONTH tasks, from `LensResponse.tasks` on the Monthly lens. */
  tasks: TaskView[];
  canCreate: boolean;
  life: LifeRef | null;
}) {
  const S = useSkin();
  const navigate = useNavigate();
  const b = goal.weeklyBreakdown;
  /**
   * ⚠ **A8 / A11 (R-rm-6) — `targetWeek` and its `taskWeekForMonth` import are GONE from this card.**
   *
   * A9 gave the card a clamp so `+ Task` from a Monthly goal could resolve a week inside the month it was
   * looking at. A8 removes the question: `+ Task` on a Monthly goal creates a **month task on the goal you
   * tapped**, and a week is an explicit narrowing the owner makes in the sheet's own `When this lands`
   * control, seeded from `monthKey` (`32-week-selection` §4.5). The card computes no week at all, so there
   * is no second place for the clamp to go stale.
   */
  const line = b ? plannedNess(b, tasks.length > 0) : null;
  /** Zero is never rendered and never spoken — the Life card's own precedent for a card's folded counts. */
  const nameBits = [line ? line.replace(/ · /g, ', ').toLowerCase() : null, tasks.length > 0 ? plural(tasks.length, 'task') : null].filter(Boolean);
  return (
    <CardShell label={nameBits.length > 0 ? `${goal.title}, ${nameBits.join(', ')}.` : undefined}>
      <button
        type="button"
        onClick={() => navigate(goalPath(goal.id))}
        style={{ width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: 0, cursor: 'pointer', minWidth: 0, fontFamily: 'inherit' }}
      >
        <Title goal={goal} />
      </button>
      {/* R-lens-23, then R-goal-47's planned-ness line, then the backlog line — one muted register. */}
      <LifeLine life={life} goalId={goal.id} />
      {/* The planned-ness line is text and takes no focus stop; it is folded into the card's name above. */}
      {line && <Muted>{line}</Muted>}
      <BacklogLine goal={goal} />
      {/*
       * ⚠ **A8 (R-lens-32) — the month's tasks, nested under a hairline in exactly the place and shape
       * `WeeklyCard` already puts a week's.** A month task and a week task are the same object drawn the
       * same way, one lens apart: same `TaskRow`, same checkbox, same `Done when:`, same measure — and the
       * **carry chip counted in months**, which is this lens's job and the one thing that stops a month
       * task becoming a silent second backlog (R-task-54, R-backlog-30). It is the card's only structural
       * addition: no new row and no new line, inside the card that already exists.
       *
       * `period={goal.periodKey}` — a completion here names the month **on screen** (R-task-55).
       */}
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 8 }}>
        {tasks.map((t) => (
          <TaskRow key={t.id} t={t} week={0} period={goal.periodKey} />
        ))}
        {tasks.length === 0 && (
          <div style={{ fontSize: 13, color: S.T.mut, paddingTop: 8, borderTop: `1px solid ${S.T.lineSoft}` }}>{NOTHING_ON_MONTH}</div>
        )}
      </div>
      {canCreate && <LinkRow goal={goal} horizon="Monthly" monthKey={goal.periodKey} />}
    </CardShell>
  );
}

/**
 * ⚠ **R-lens-31 — a card in the Weekly lens's MONTH BAND.**
 *
 * **Ordinary cards, ordinary `TaskRow`s, at ordinary size, weight and colour.** Nothing here is tinted,
 * dimmed, indented, shrunk or greyed. This product states a difference in *words* and not in a colour
 * (`nothing this week` is the same grey as `3 weekly goals`; no goal is muted anywhere, R-goal-38), and
 * demoting the month's work into a visual footnote is the opposite of what the owner asked for: the
 * deadline is the end of the month, which is a commitment and not an afterthought. Position, a heading
 * that names the month, and one sentence carry the whole distinction.
 *
 * **The four things it does not render**, each with its reason — stated because an undocumented divergence
 * is how the next person "fixes" it in the wrong direction:
 *
 *  - **`plannedNess`** — that line is about how a month breaks into weeks, and the band exists to say the
 *    deadline is the month rather than any week in it. It would answer a question this band is refusing.
 *  - **`BacklogLine`** — a backlog count is an invitation to pull, and the band offers no pull. Exactly
 *    `CarriedCard`'s reason, at a different card.
 *  - **`Pull from backlog`** — a pull is a planning decision about a goal's own deferred work, and the
 *    goal's lens and page are where that backlog lives. The band is a week's *view* of a month, not a
 *    planning surface for one. (`33-measurables-ux` §8.1, the owner taking the plan's recommendation.)
 *  - **`Nothing on this month yet.`** — **unreachable.** A goal is in the band only because it holds a
 *    month task visible in this month, so its filtered list is never empty.
 *
 * `+ Task` renders **iff the band's month is not past** (`canCreate`), and it sits on the **card's** foot
 * rather than the band's, because the card is the goal: nothing is chosen, nothing is inferred, and no
 * goal picker is needed. A band-foot create would have to ask which Monthly goal, and the only honest way
 * to ask is a fifth `R-nav-31` mode.
 */
export function MonthBandCard({
  goal,
  tasks,
  monthPeriodKey,
  canCreate,
  life,
}: {
  goal: GoalView;
  tasks: TaskView[];
  /** The band's OWN month — never the current one, never a clamp. It is what a create here passes. */
  monthPeriodKey: string;
  canCreate: boolean;
  life: LifeRef | null;
}) {
  const navigate = useNavigate();
  return (
    <CardShell label={`${goal.title}, ${plural(tasks.length, 'task')}.`}>
      <button
        type="button"
        onClick={() => navigate(goalPath(goal.id))}
        style={{ width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: 0, cursor: 'pointer', minWidth: 0, fontFamily: 'inherit' }}
      >
        <Title goal={goal} />
      </button>
      <LifeLine life={life} goalId={goal.id} />
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 8 }}>
        {tasks.map((t) => (
          /* ⚠ `suppressCarry` — the flag is passed HERE so a test can prove it by rendering the band. */
          <TaskRow key={t.id} t={t} week={0} period={monthPeriodKey} suppressCarry />
        ))}
      </div>
      {canCreate && <LinkRow goal={goal} horizon="Monthly" monthKey={monthPeriodKey} pull={false} />}
    </CardShell>
  );
}

/**
 * `+ Task` and `Pull from backlog` share ONE row at the card's foot — two affordances, one row.
 *
 * The same row, in the same place, with the same two labels on a Weekly card and on a Monthly card, so
 * `+ Task` means one thing in the whole product regardless of which lens you found it in. What differs is
 * invisible: from a Weekly goal it attaches to that goal; from a Monthly goal the Weekly goal is resolved
 * or created for you (R-task-49).
 */
function LinkRow({
  goal,
  horizon,
  monthKey,
  pull = true,
}: {
  goal: GoalView;
  horizon: Horizon;
  /**
   * ⚠ **A8/A11 — the MONTH, not a target week** (`32-week-selection` §4.5). The sheet seeds its own
   * `When this lands` control from this key and owns the answer from then on; the card resolves nothing.
   */
  monthKey?: string;
  /** The month band offers no pull — a pull is a planning decision, and the band is a week's view. */
  pull?: boolean;
}) {
  const S = useSkin();
  const ui = useUI();
  return (
    <div style={{ display: 'flex', gap: 16, borderTop: `1px solid ${S.T.lineSoft}`, marginTop: 10, paddingTop: 2 }}>
      <button
        type="button"
        style={{ ...S.linkBtn, flex: 1 }}
        onClick={() =>
          horizon === 'Weekly'
            ? ui.openSheet({ kind: 'taskCreate', goalId: goal.id, weekStart: goal.periodKey })
            : ui.openSheet({ kind: 'taskCreate', monthGoal: { id: goal.id, title: goal.title }, monthKey })
        }
      >
        + Task
      </button>
      {pull && (
        <button type="button" style={{ ...S.linkBtn, flex: 1, textAlign: 'right' }} onClick={() => ui.openSheet({ kind: 'pull', goalId: goal.id, horizon, monthKey })}>
          Pull from backlog
        </button>
      )}
    </div>
  );
}

/**
 * R-lens-12 case 1 — **this week's plan.** One card per Weekly goal, with its tasks nested inside it under
 * a hairline: a screen of separate task cards at 16px radius is a screen of borders.
 *
 * `+ Task` renders only when the week is the current one or later (R-task-41). A past week renders no
 * `+ Task`, no `Pull from backlog` and no `+ Weekly goal` — but its tasks stay **fully interactive**,
 * including the checkbox (R-task-14): history is readable and truthful, and completing something you
 * actually did is not rewriting it.
 */
export function WeeklyCard({ goal, tasks, week, canCreate, life }: { goal: GoalView; tasks: TaskView[]; week: number; canCreate: boolean; life: LifeRef | null }) {
  const S = useSkin();
  const navigate = useNavigate();
  return (
    <CardShell>
      <button
        type="button"
        onClick={() => navigate(goalPath(goal.id))}
        style={{ width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: 0, cursor: 'pointer', minWidth: 0, fontFamily: 'inherit' }}
      >
        <Title goal={goal} />
      </button>
      {/*
       * R-lens-23, rewritten — the LIFE goal, not the month this week belongs to. That month is the one
       * fact this design takes and does not give back; it is one tap away on the weekly goal's own page,
       * and a per-lens exception would be four different facts wearing one word again.
       */}
      <LifeLine life={life} goalId={goal.id} />
      {/*
       * R-goal-43 — `planned N weeks ago`, once the week has ARRIVED and only at `>= 2`. Age 1 is
       * ordinary planning; a week that has not arrived is early, not stale. The threshold is the
       * server's number, rendered here as one muted line — never a chip, never coloured, never blocking.
       * Its place is fixed: BETWEEN the parent line and the backlog line, in the same `T.mut` register.
       */}
      {goal.plannedAgeWeeks !== null && goal.plannedAgeWeeks >= 2 && <Muted>{stalePlanLine(goal.plannedAgeWeeks)}</Muted>}
      {/*
       * ⚠ **No `N in backlog` here** (§5.1). A Weekly goal cannot hold a backlog item at all (R-backlog-2
       * — an item has no week and a weekly goal would give it one), so the line was structurally always
       * zero and rendered nothing. Deleting it makes the table and the code say the same thing.
       */}
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 8 }}>
        {tasks.map((t) => (
          <TaskRow key={t.id} t={t} week={week} />
        ))}
        {tasks.length === 0 && <div style={{ fontSize: 13, color: S.T.mut, paddingTop: 8, borderTop: `1px solid ${S.T.lineSoft}` }}>Nothing on this yet.</div>}
      </div>
      {canCreate && <LinkRow goal={goal} horizon="Weekly" />}
    </CardShell>
  );
}

/**
 * R-lens-12 case 2 — **the carried band's card.**
 *
 * A Weekly goal appears in week `W` if `periodKey = W` **or** it still holds an open task visible in `W`.
 * The second kind renders below the week's own goals, oldest first, labelled with the week it was written
 * for so it is never mistaken for this week's plan.
 *
 * **It offers no `+ Task` and no `Pull from backlog`, ever** (R-lens-12, R-task-41): adding new work to a
 * past week's goal is back-dating. Carried work is finished, moved to the backlog or cancelled where it
 * stands.
 *
 * **The four other things `WeeklyCard` renders and this one does not, each with its reason.** They were
 * undocumented, which is how the next person "fixes" the divergence in the wrong direction:
 *
 *  - **`goal.why`** — the motivation is unchanged since the week it was written, and it is one tap away on
 *    the goal page. This card answers a narrower question: *which week did this come from, and what is
 *    still open*. The `from week of …` line takes that slot, and two muted lines under one title is the
 *    clutter R-nav-27 is about.
 *  - **`BacklogLine`** — the backlog count is an invitation to pull, and this card offers no pull. A number
 *    you cannot act on is a number for its own sake, and BUSINESS-RULES lists the only four numbers in the
 *    product; this would be a fifth.
 *  - **`stalePlanLine`** — `planned N weeks ago` measures a plan against the arrival of its own week
 *    (R-goal-43). A carried goal's week arrived and passed, so the number would only restate the
 *    `from week of …` line directly above it, and restate it as a complaint.
 *  - **the `Nothing on this yet.` empty line** — **unreachable here.** A goal is in the carried band only
 *    because it still holds an open task visible in this week (R-lens-12 case 2), so `tasks` is never
 *    empty. Rendering the line would be writing copy no one can see.
 */
export function CarriedCard({ goal, tasks, week, life }: { goal: GoalView; tasks: TaskView[]; week: number; life: LifeRef | null }) {
  const S = useSkin();
  const navigate = useNavigate();
  return (
    <CardShell>
      <button
        type="button"
        onClick={() => navigate(goalPath(goal.id))}
        style={{ width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: 0, cursor: 'pointer', minWidth: 0, fontFamily: 'inherit' }}
      >
        <Title goal={goal} />
        <Muted>from week of {shortDate(goal.periodKey)}</Muted>
      </button>
      {/* R-lens-23 — a carried goal is still an item in this lens, and it still belongs to a Life line. */}
      <LifeLine life={life} goalId={goal.id} />
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 8 }}>
        {tasks.map((t) => (
          <TaskRow key={t.id} t={t} week={week} />
        ))}
      </div>
    </CardShell>
  );
}
