import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { GoalView } from '@goal-cascade/shared';
import { useUI } from '../context/UIContext';
import { useSkin } from '../skin';
import { Sheet } from '../components/Sheet';
import { UNSORTED_NOTE } from '../lens/copy';
import { goalPath, lensPath } from '../routes';

/**
 * **R-goal-41, amended — the goal page's trail: one line that never wraps, holding at most three
 * segments.**
 *
 * ── The defect ────────────────────────────────────────────────────────────────
 * The trail was a `flexWrap: 'wrap'` row of every ancestor, each rendering its full title at 12.5/700 and
 * sharing row 1 with the top-right cluster under `justifyContent: 'space-between'`. With the owner's own
 * data — *"Set up my AI consultancy and land at least one paying client"* under *"Be financially
 * independent"* — a Quarterly goal's trail is ≈ 100 characters, roughly 660 px of text in about 220 px of
 * line. It wrapped to three lines, and because the wrapping container was the flex sibling of the cluster
 * it pushed the cluster and the whole title block down the page. Five levels deep it was four or five
 * lines of muted grey above the thing you came to read.
 *
 * ── The rule ──────────────────────────────────────────────────────────────────
 *
 * > **Crumbs never wrap. The page title always wraps.** That is the whole of it.
 *
 * `Goals`, an overflow `…`, and the **immediate parent** — the Life root moved out of the trail and onto
 * its own eyebrow line, and the full ancestry with every period label put one tap away in
 * `Where this sits`. By depth (`ancestors.length + 1`):
 *
 * | Depth | Viewing | Trail | Eyebrow |
 * |---|---|---|---|
 * | 1 | a Life goal | `Goals` | — |
 * | 2 | Yearly under Life | `Goals / Be financially independent` | — |
 * | 3 | Quarterly | `Goals / … / Set up my AI consultancy and land a…` | `BE FINANCIALLY INDEPENDENT` |
 * | 4 | Monthly | `Goals / … / Sign the first retainer client` | `BE FINANCIALLY INDEPENDENT` |
 * | 5 | Weekly | `Goals / … / Publish four case studies` | `BE FINANCIALLY INDEPENDENT` |
 *
 * - **`Goals`** is `flex: 0 0 auto` and is never truncated. It is the escape hatch to the lens and the only
 *   segment whose loss would strand you.
 * - **The immediate parent** takes the whole remaining line and **tail**-truncates. It is the way *up one
 *   step*, which is what a breadcrumb is for.
 * - **`…`** renders only when segments were dropped — depth ≥ 3. It is a real button, and it sits in a
 *   segment slot **between two `/` separators**, which is what tells it apart from a truncation ellipsis at
 *   the end of a word.
 * - **The trail container** is `flex: 1 1 auto; min-width: 0; overflow: hidden; flex-wrap: nowrap` and the
 *   cluster is `flex: 0 0 auto`, so **the cluster can never be pushed by a title, at any length**.
 *
 * ── Why not middle truncation, which the owner suggested ──────────────────────
 * Middle-ellipsis is right for **paths and filenames**, where head and tail are both identifying
 * (`/Users/…/report.pdf`). It is wrong for **sentences**, where the head carries the meaning and the tail
 * is a modifier: `Set up my AI c…paying client` is less legible than `Set up my AI consultancy and land
 * a…`, which is a readable clause. So the *titles* tail-truncate and the *trail* is middle-collapsed —
 * the same instinct, applied at the granularity where it is right.
 *
 * ── No measurement ────────────────────────────────────────────────────────────
 * A trail that collapses by measuring itself needs a `ResizeObserver`, a measurement pass and a re-layout
 * on every font load. The depth rule plus flexbox produces the same answer at every width this app renders
 * at — there is one 640 px centred column and no breakpoint — with none of that.
 *
 * ── Net lines ─────────────────────────────────────────────────────────────────
 * Fewer. A deep goal cost three to five wrapped trail lines; this costs one trail line plus, at depth ≥ 3,
 * one eyebrow. Nothing in the lens shell changes, so R-nav-27's two-row budget is untouched.
 */
export function GoalTrail({ ancestors, goal }: { ancestors: GoalView[]; goal: GoalView }) {
  const S = useSkin();
  const ui = useUI();
  const navigate = useNavigate();
  const [showPath, setShowPath] = useState(false);

  const parent = ancestors[ancestors.length - 1];
  /** Segments were dropped iff there is more than one ancestor — depth ≥ 3. */
  const collapsed = ancestors.length > 1;
  const unsorted = isUnsorted(ancestors);

  return (
    <>
      <nav
        aria-label="Breadcrumb"
        style={{ display: 'flex', alignItems: 'center', flexWrap: 'nowrap', gap: 2, flex: '1 1 auto', minWidth: 0, overflow: 'hidden' }}
      >
        <Crumb label="Goals" onClick={() => navigate(lensPath(ui.lastLens))} />
        {collapsed && (
          <>
            <Sep />
            {/*
             * §8.2 C — the accessible name is `Show the full path`, because `…` read aloud is nothing. It
             * is a real tab stop between `Goals` and the parent crumb, which is R-lens-25's standing
             * promise that no affordance is gesture-only and none is hidden behind a measurement.
             */}
            <button
              type="button"
              aria-label="Show the full path"
              aria-haspopup="dialog"
              onClick={() => setShowPath(true)}
              style={{ ...crumbBase(S.T.mut), flex: '0 0 auto' }}
            >
              …
            </button>
          </>
        )}
        {parent && (
          <>
            <Sep />
            {/*
             * §8.2 C / §4.4 — the visible text is ellipsised, so the accessible name carries the
             * **untruncated** title with its period. A crumb is a pointer, not a statement; a truncated
             * pointer still points, and the full string is one tap away in the sheet.
             */}
            <Crumb
              grow
              label={parent.title}
              name={nameOf(parent)}
              onClick={() => navigate(goalPath(parent.id))}
            />
          </>
        )}
      </nav>

      {showPath && <WhereThisSitsSheet ancestors={ancestors} goal={goal} unsorted={unsorted} onClose={() => setShowPath(false)} />}
    </>
  );
}

/** R-lens-20 — `ancestors[0]` is not a Life goal, i.e. a dangling `parentId`. */
const isUnsorted = (ancestors: GoalView[]): boolean => ancestors.length > 0 && ancestors[0]!.horizon !== 'Life';

/**
 * **The eyebrow** — the Life root, promoted out of the trail onto `S.eyebrow`: 12 px, weight 700, `0.08em`
 * tracking, uppercase, `T.mut`. All existing tokens, no new type size, no new colour.
 *
 * It renders **only at depth ≥ 3**, i.e. only when the Life root is not already a crumb on the trail line,
 * so it never duplicates one. It is a **block**, so it wraps freely to a second line — correct for an
 * eyebrow, and exactly what is wrong for a trail.
 *
 * It sits **after** the trail row and before the `<h1>`, matching its visual position, which also puts it
 * in that order in the tab ring (§8.1 C). The accessible name follows `ParentLine`'s existing pattern —
 * `<title>. Open goal.` — because "BE FINANCIALLY INDEPENDENT" read aloud says nothing about being a way
 * there.
 *
 * **Why an eyebrow and not a third crumb.** Dropping the Life line entirely would remove the orientation a
 * lens gives you with its group header and the goal page otherwise lacks; the eyebrow is that information
 * at a lower price than a trail segment, on a line that is allowed to wrap.
 *
 * On an UNSORTED line it renders **nothing** rather than naming a Yearly goal as a Life line; the sheet
 * carries `UNSORTED_NOTE` instead.
 */
export function GoalEyebrow({ ancestors }: { ancestors: GoalView[] }) {
  const S = useSkin();
  const navigate = useNavigate();
  const root = ancestors.length > 1 && ancestors[0]!.horizon === 'Life' ? ancestors[0]! : null;
  if (!root) return null;
  return (
    <button
      type="button"
      data-goal-eyebrow=""
      aria-label={`${root.title}. Open goal.`}
      onClick={() => navigate(goalPath(root.id))}
      style={{
        ...S.eyebrow,
        display: 'block',
        width: '100%',
        textAlign: 'left',
        border: 'none',
        background: 'none',
        padding: '4px 0 0 0',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {root.title}
    </button>
  );
}

const crumbBase = (color: string) => ({
  minHeight: 36,
  border: 'none',
  background: 'none',
  padding: '0 2px',
  fontSize: 12.5,
  fontWeight: 700,
  color,
  cursor: 'pointer',
  fontFamily: 'inherit',
  textAlign: 'left' as const,
});

/**
 * A trail segment. `grow` is the immediate parent: it takes the whole remaining line and tail-truncates;
 * everything else is `flex: 0 0 auto` and is never cut.
 *
 * The three properties that make a single title wider than the screen behave — `min-width: 0`,
 * `white-space: nowrap`, `text-overflow: ellipsis` — have to be on the same box as `overflow: hidden`, and
 * `min-width: 0` has to be there because a flex item's default `min-width: auto` is its content's
 * intrinsic width, which is precisely how a 660 px title pushes a cluster off the row.
 */
function Crumb({ label, name, onClick, grow = false }: { label: string; name?: string; onClick: () => void; grow?: boolean }) {
  const S = useSkin();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={name}
      data-crumb={grow ? 'parent' : 'root'}
      style={{
        ...crumbBase(S.T.mut),
        flex: grow ? '1 1 auto' : '0 0 auto',
        minWidth: 0,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        display: 'block',
      }}
    >
      {label}
    </button>
  );
}

function Sep() {
  const S = useSkin();
  return (
    <span aria-hidden="true" style={{ color: S.T.border, fontSize: 12.5, flex: '0 0 auto' }}>
      /
    </span>
  );
}

/** `YEARLY · 2026`, `LIFE`. R-goal-3 refuses a Life goal that carries a period, so `Life` has one half. */
const horizonLine = (g: GoalView): string => (g.period ? `${g.horizon.toUpperCase()} · ${g.period.toUpperCase()}` : g.horizon.toUpperCase());

/** The untruncated crumb name: the title, and its period when it has one. */
const nameOf = (g: GoalView): string => (g.period ? `${g.title}, ${g.period}` : g.title);

/**
 * **`Where this sits`** — the overflow sheet, and the place R-goal-41's period clause is finally honoured.
 *
 * The rule has always required *"breadcrumbs to the Life root **with each ancestor's own period label**"*,
 * and the screen has never rendered one: `Crumb` printed `a.title` and nothing else. There was never room
 * on the line for four periods, which is the honest reason it went unbuilt for as long as it did. Here
 * there is no width pressure at all, so every ancestor appears root → parent, **untruncated, with its
 * period**, and the current goal at the bottom — marked `aria-current` and not tappable, because a
 * breadcrumb to where you already are is a control that does nothing.
 *
 * It is the existing `Sheet`, so it inherits R-nav-15's whole contract unchanged: focus moves to the
 * heading on open and is trapped, `Escape` and the ✕ and a backdrop tap all close, and focus returns to
 * the `…` button that opened it. **No second modal pattern was invented for this.**
 *
 * Titles **wrap freely** here. This is the one surface where the full name is guaranteed readable, which
 * is the whole reason the trail is allowed to truncate.
 */
function WhereThisSitsSheet({
  ancestors,
  goal,
  unsorted,
  onClose,
}: {
  ancestors: GoalView[];
  goal: GoalView;
  unsorted: boolean;
  onClose: () => void;
}) {
  const S = useSkin();
  const navigate = useNavigate();
  return (
    <Sheet label="Where this sits" onClose={onClose}>
      {/* R-lens-20 — the root-less line. `UNSORTED_NOTE` verbatim, the same sentence the lens uses. */}
      {unsorted && <div style={{ fontSize: 12.5, color: S.T.mut, marginBottom: 10 }}>{UNSORTED_NOTE}</div>}
      <div style={{ ...S.card, overflow: 'hidden' }}>
        {ancestors.map((a) => (
          <button
            key={a.id}
            type="button"
            style={{ ...S.pickerRow('ok'), alignItems: 'flex-start', padding: '10px 12px', whiteSpace: 'normal' }}
            onClick={() => {
              onClose();
              navigate(goalPath(a.id));
            }}
          >
            <Row title={a.title} sub={horizonLine(a)} />
          </button>
        ))}
        <div aria-current="true" style={{ ...S.pickerRow('sel'), alignItems: 'flex-start', padding: '10px 12px', whiteSpace: 'normal', cursor: 'default', borderBottom: 'none' }}>
          <Row title={goal.title} sub={horizonLine(goal)} />
        </div>
      </div>
    </Sheet>
  );
}

function Row({ title, sub }: { title: string; sub: string }) {
  const S = useSkin();
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
      <span style={{ fontSize: 13.5, fontWeight: 700, color: S.T.ink }}>{title}</span>
      <span style={{ ...S.sectionLabel, fontWeight: 700 }}>{sub}</span>
    </span>
  );
}
