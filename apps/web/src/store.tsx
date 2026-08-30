import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api/client';
import type { BacklogItem, ConfirmState, Goal, Horizon, Idea, Learning, Task, View } from './types';
import { todayStr, wm } from './utils/dates';
import * as T from './utils/tree';

export interface AppState {
  view: View;
  homeFilter: string;
  planFilter: string;
  viewWeek: number; // 0 = current, negative = past
  wkPickOpen: boolean;
  dark: boolean;
  lineId: string | null;
  collapsed: Record<string, boolean>;
  menuId: string | null;
  toast: string;
  goals: Goal[];
  tasks: Task[];
  backlog: BacklogItem[];
  parking: Idea[];
  learnings: Learning[];
  // list selections
  selBacklog: string | null;
  blMoving: boolean;
  blGoal: string; // last-used backlog goal
  ideaText: string; ideaGoal: string; selIdea: string | null; ideaAttach: boolean;
  learnText: string; learnGoal: string; selLearn: string | null; learnAttach: boolean;
  lineBlAdding: boolean; lineBlText: string;
  // uncheck follow-up
  uncheckId: string | null; uncheckCond: string;
  // task detail sheet
  dtId: string | null; dtTitle: string; dtCond: string; dtDesc: string; dtLink: string;
  // backlog drawer
  bdOpen: boolean; bdGoal: string; bdTitle: string; bdDesc: string; bdLink: string; bdLinks: { url: string }[]; bdToWeek: boolean;
  // task create modal
  tmOpen: boolean; tmGoalId: string; tmTitle: string; tmCond: string; tmFromBacklog: string | null; tmFromIdea: boolean;
  // confirm sheet (move/cancel/replan)
  cfOpen: ConfirmState | null; cfReason: string; cfPeriodIdx: number;
  // inactive-branch prompt
  ibOpen: { itemId: string; title: string } | null;
  // goal create/edit modal
  gmOpen: boolean; gmEditId: string | null; gmTitle: string; gmWhy: string; gmHorizon: Horizon; gmParentId: string | null; gmMinRank: number; gmPeriod: string; gmSearch: string;
  // move goal modal
  mvOpen: boolean; mvId: string | null; mvParentId: string | null; mvSearch: string;
  // weekly planning drafts
  plChecked: Record<string, boolean>; plDrafts: Record<string, string>;
}

export const initialState: AppState = {
  view: 'home', homeFilter: '', planFilter: '', viewWeek: 0, wkPickOpen: false, dark: false,
  lineId: null, collapsed: {}, menuId: null, toast: '',
  goals: [], tasks: [], backlog: [], parking: [], learnings: [],
  selBacklog: null, blMoving: false, blGoal: 'g3',
  ideaText: '', ideaGoal: '', selIdea: null, ideaAttach: false,
  learnText: '', learnGoal: '', selLearn: null, learnAttach: false,
  lineBlAdding: false, lineBlText: '',
  uncheckId: null, uncheckCond: '',
  dtId: null, dtTitle: '', dtCond: '', dtDesc: '', dtLink: '',
  bdOpen: false, bdGoal: 'g3', bdTitle: '', bdDesc: '', bdLink: '', bdLinks: [], bdToWeek: false,
  tmOpen: false, tmGoalId: 'g4', tmTitle: '', tmCond: '', tmFromBacklog: null, tmFromIdea: false,
  cfOpen: null, cfReason: '', cfPeriodIdx: 0,
  ibOpen: null,
  gmOpen: false, gmEditId: null, gmTitle: '', gmWhy: '', gmHorizon: 'Life', gmParentId: null, gmMinRank: 0, gmPeriod: '', gmSearch: '',
  mvOpen: false, mvId: null, mvParentId: null, mvSearch: '',
  plChecked: {}, plDrafts: {},
};

let toastTimer: number | undefined;

/** All app actions. `st` is the current state snapshot; `set` merges a partial. */
export class Store {
  constructor(
    public st: AppState,
    public set: (p: Partial<AppState>) => void,
  ) {}

  // ---- tree shortcuts bound to current goals ----
  node(id: string | null) { return T.node(this.st.goals, id); }
  children(id: string | null) { return T.children(this.st.goals, id); }
  isLeaf(g: Goal) { return T.isLeaf(this.st.goals, g); }
  isActive(g: Goal) { return T.isActive(this.st.goals, g); }
  ancestors(g: Goal) { return T.ancestors(this.st.goals, g); }
  rootOf(g: Goal) { return T.rootOf(this.st.goals, g); }
  descendants(id: string) { return T.descendants(this.st.goals, id); }
  subtreeActive(g: Goal) { return T.subtreeActive(this.st.goals, g); }
  leaves() { return T.leaves(this.st.goals); }
  pathOf(g: Goal) { return T.pathOf(this.st.goals, g); }
  lifeGoals() { return this.st.goals.filter((g) => !g.parentId); }
  nonLife() { return this.st.goals.filter((g) => g.parentId); }
  activeLeaves() { return this.leaves().filter((g) => this.isActive(g)); }

  visibleIn(t: Task, w: number): boolean {
    return t.done ? t.doneWeek === w : t.originWeek <= w;
  }

  // ---- theme / toast ----
  applyTheme(dark: boolean) {
    // Demo-level dark mode; replace with real theme tokens when integrating.
    document.documentElement.style.filter = dark ? 'invert(1) hue-rotate(180deg)' : '';
  }
  toggleTheme() {
    const dark = !this.st.dark;
    this.set({ dark });
    this.applyTheme(dark);
  }
  showToast(msg: string) {
    this.set({ toast: msg });
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => this.set({ toast: '' }), 2600);
  }

  // ---- tasks ----
  toggleTask(t: Task) {
    const w = this.st.viewWeek;
    if (!t.done) {
      const tasks = this.st.tasks.map((x) =>
        x.id === t.id
          ? { ...x, done: true, doneWeek: w, doneLabel: todayStr(), events: [{ i: '✓', t: 'Completed', d: todayStr() }, ...x.events] }
          : x,
      );
      this.set({ tasks });
      void api.persist('task.complete', { id: t.id, week: w });
    } else {
      const tasks = this.st.tasks.map((x) =>
        x.id === t.id ? { ...x, done: false, doneWeek: null, events: [{ i: '↩', t: 'Unchecked', d: todayStr() }, ...x.events] } : x,
      );
      this.set({ tasks, uncheckId: t.id, uncheckCond: t.cond });
      void api.persist('task.uncheck', { id: t.id });
    }
  }

  saveUncheck() {
    const { tasks, uncheckId, uncheckCond } = this.st;
    const t = tasks.find((x) => x.id === uncheckId);
    if (t && uncheckCond.trim() && uncheckCond.trim() !== t.cond) {
      const ev = { i: '✎', t: `Done-condition edited: “${T.trunc(t.cond)}” → “${T.trunc(uncheckCond.trim())}”`, d: todayStr() };
      this.set({
        tasks: tasks.map((x) => (x.id === t.id ? { ...x, cond: uncheckCond.trim(), events: [ev, ...x.events] } : x)),
        uncheckId: null, uncheckCond: '',
      });
      void api.persist('task.update', { id: t.id, cond: uncheckCond.trim() });
    } else {
      this.set({ uncheckId: null, uncheckCond: '' });
    }
  }

  openTaskDetail(t: Task) {
    this.set({ dtId: t.id, dtTitle: t.title, dtCond: t.cond, dtDesc: t.desc, dtLink: '' });
  }

  saveTaskDetail() {
    const { tasks, dtId, dtTitle, dtCond, dtDesc } = this.st;
    const dt = tasks.find((x) => x.id === dtId);
    if (!dt) return;
    const ev: Task['events'] = [];
    if (dtTitle.trim() && dtTitle.trim() !== dt.title) ev.push({ i: '✎', t: `Renamed: “${T.trunc(dt.title)}” → “${T.trunc(dtTitle.trim())}”`, d: todayStr() });
    if (dtCond.trim() !== dt.cond) ev.push({ i: '✎', t: `Done-condition edited: “${T.trunc(dt.cond)}” → “${T.trunc(dtCond.trim())}”`, d: todayStr() });
    if (dtDesc.trim() !== dt.desc) ev.push({ i: '✎', t: 'Description updated', d: todayStr() });
    this.set({
      tasks: tasks.map((x) =>
        x.id === dt.id ? { ...x, title: dtTitle.trim() || x.title, cond: dtCond.trim(), desc: dtDesc.trim(), events: [...ev, ...x.events] } : x,
      ),
    });
    void api.persist('task.update', { id: dt.id, title: dtTitle.trim(), cond: dtCond.trim(), desc: dtDesc.trim() });
    this.showToast('Task updated');
  }

  addTaskLink() {
    const { tasks, dtId, dtLink } = this.st;
    const dt = tasks.find((x) => x.id === dtId);
    if (!dt || !dtLink.trim()) return;
    this.set({
      tasks: tasks.map((x) =>
        x.id === dt.id
          ? { ...x, links: [...x.links, { url: dtLink.trim() }], events: [{ i: '↗', t: 'Link added: ' + T.hostOf(dtLink.trim()), d: todayStr() }, ...x.events] }
          : x,
      ),
      dtLink: '',
    });
    void api.persist('task.link.add', { id: dt.id, url: dtLink.trim() });
  }

  removeTaskLink(index: number) {
    const { tasks, dtId } = this.st;
    this.set({ tasks: tasks.map((x) => (x.id === dtId ? { ...x, links: x.links.filter((_, j) => j !== index) } : x)) });
    void api.persist('task.link.remove', { id: dtId, index });
  }

  openTaskCreate(goalId: string, prefill?: { title?: string; fromBacklog?: string; fromIdea?: boolean }) {
    this.set({
      tmOpen: true, tmGoalId: goalId, tmTitle: prefill?.title ?? '', tmCond: '',
      tmFromBacklog: prefill?.fromBacklog ?? null, tmFromIdea: prefill?.fromIdea ?? false,
    });
  }

  saveNewTask() {
    const { tmTitle, tmCond, tmGoalId, tmFromBacklog, tmFromIdea, tasks, backlog } = this.st;
    if (!tmTitle.trim()) return;
    const src = tmFromBacklog ? 'Created — pulled from Backlog' : tmFromIdea ? 'Created — from an Idea' : 'Created';
    const srcItem = tmFromBacklog ? backlog.find((b) => b.id === tmFromBacklog) : undefined;
    const task: Task = {
      id: 't' + Date.now(), goalId: tmGoalId, title: tmTitle.trim(), cond: tmCond.trim(),
      desc: srcItem?.desc ?? '', links: srcItem?.links ?? [],
      done: false, doneWeek: null, doneLabel: '', originWeek: 0,
      events: [{ i: '＋', t: src, d: todayStr() }],
    };
    this.set({
      tmOpen: false, tmFromBacklog: null, tmFromIdea: false,
      tasks: [...tasks, task],
      backlog: tmFromBacklog ? backlog.filter((b) => b.id !== tmFromBacklog) : backlog,
    });
    void api.persist('task.create', task);
  }

  // ---- confirm sheet (move to backlog / cancel / re-plan) ----
  openConfirm(cf: ConfirmState) {
    this.set({ cfOpen: cf, cfReason: '', cfPeriodIdx: 0, menuId: null });
  }

  confirmAction() {
    const { cfOpen: cf, cfReason, cfPeriodIdx, tasks, backlog, goals } = this.st;
    if (!cf) return;
    const reason = cfReason.trim();
    if (cf.type === 'moveTask') {
      const t = tasks.find((x) => x.id === cf.taskId);
      if (!t) return;
      const item: BacklogItem = { id: 'b' + Date.now(), goalId: t.goalId, title: t.title, desc: t.desc, links: t.links, when: 'Today', fromWeek: 'week of ' + wm(0) };
      this.set({ tasks: tasks.filter((x) => x.id !== t.id), backlog: [item, ...backlog], cfOpen: null, cfReason: '', dtId: null });
      void api.persist('task.moveToBacklog', { id: t.id, reason });
      this.showToast('Moved to Backlog' + (reason ? ' — reason noted' : ''));
    } else if (cf.type === 'cancelTask') {
      const t = tasks.find((x) => x.id === cf.taskId);
      if (!t) return;
      this.set({ tasks: tasks.filter((x) => x.id !== t.id), cfOpen: null, cfReason: '', dtId: null });
      void api.persist('task.cancel', { id: t.id, reason });
      this.showToast('Task canceled');
    } else {
      const g = this.node(cf.goalId ?? null);
      if (!g) return;
      const to = T.replanPeriods(g.horizon)[cfPeriodIdx];
      this.set({ goals: goals.map((x) => (x.id === g.id ? { ...x, period: to } : x)), cfOpen: null, cfReason: '' });
      void api.persist('goal.replan', { id: g.id, period: to, reason });
      this.showToast('Re-planned to ' + to);
    }
  }

  // ---- backlog ----
  pullToWeek(item: BacklogItem) {
    const leaf = T.activeLeafFor(this.st.goals, item.goalId);
    if (leaf) {
      this.openTaskCreate(leaf.id, { title: item.title, fromBacklog: item.id });
      this.set({ selBacklog: null, ibOpen: null });
    } else {
      this.set({ ibOpen: { itemId: item.id, title: item.title }, selBacklog: null });
    }
  }

  deleteBacklogItem(id: string) {
    this.set({ backlog: this.st.backlog.filter((x) => x.id !== id), selBacklog: null });
    void api.persist('backlog.delete', { id });
  }

  moveBacklogItem(id: string, goalId: string) {
    this.set({ backlog: this.st.backlog.map((y) => (y.id === id ? { ...y, goalId } : y)), selBacklog: null, blMoving: false });
    void api.persist('backlog.move', { id, goalId });
    this.showToast('Moved to ' + (this.node(goalId)?.title ?? 'goal'));
  }

  addBacklogItem(goalId: string, title: string, desc = '', links: { url: string }[] = []) {
    const item: BacklogItem = { id: 'b' + Date.now(), goalId, title: title.trim(), desc, links, when: 'Today', fromWeek: '' };
    this.set({ backlog: [item, ...this.st.backlog] });
    void api.persist('backlog.create', item);
    return item;
  }

  openBacklogDrawer() {
    this.set({ bdOpen: true, bdGoal: this.st.blGoal, bdTitle: '', bdDesc: '', bdLink: '', bdLinks: [], bdToWeek: false });
  }

  saveBacklogDrawer() {
    const { bdTitle, bdDesc, bdLinks, bdGoal, bdToWeek, tasks } = this.st;
    if (!bdTitle.trim()) return;
    const leaf = T.activeLeafFor(this.st.goals, bdGoal);
    if (bdToWeek && leaf) {
      const task: Task = {
        id: 't' + Date.now(), goalId: leaf.id, title: bdTitle.trim(), cond: '', desc: bdDesc.trim(), links: bdLinks,
        done: false, doneWeek: null, doneLabel: '', originWeek: 0,
        events: [{ i: '＋', t: 'Created — added to this week', d: todayStr() }],
      };
      this.set({ bdOpen: false, tasks: [...tasks, task] });
      void api.persist('task.create', task);
      this.showToast('Added to this week');
    } else {
      this.addBacklogItem(bdGoal, bdTitle, bdDesc.trim(), bdLinks);
      this.set({ bdOpen: false });
      this.showToast(bdToWeek ? 'Branch isn’t active this week — parked in Backlog' : 'Added to Backlog');
    }
  }

  // ---- ideas / learnings ----
  saveIdea() {
    const { ideaText, ideaGoal, parking } = this.st;
    if (!ideaText.trim()) return;
    const idea: Idea = { id: 'k' + Date.now(), goalId: ideaGoal || null, text: ideaText.trim(), when: 'Today' };
    this.set({ parking: [idea, ...parking], ideaText: '', ideaGoal: '' });
    void api.persist('idea.create', idea);
  }

  ideaToBacklog(idea: Idea, goalId: string) {
    this.addBacklogItem(goalId, idea.text);
    this.set({ parking: this.st.parking.filter((x) => x.id !== idea.id), selIdea: null, ideaAttach: false });
    void api.persist('idea.delete', { id: idea.id });
    this.showToast('Moved to Backlog under ' + (this.node(goalId)?.title ?? 'goal'));
  }

  saveLearning() {
    const { learnText, learnGoal, learnings } = this.st;
    if (!learnText.trim()) return;
    const l: Learning = { id: 'l' + Date.now(), goalId: learnGoal || null, text: learnText.trim(), when: 'Today', applied: false };
    this.set({ learnings: [l, ...learnings], learnText: '', learnGoal: '' });
    void api.persist('learning.create', l);
  }

  // ---- goals ----
  openGoalModal(opts: { editId?: string; parentId?: string }) {
    if (opts.editId) {
      const g = this.node(opts.editId)!;
      this.set({ gmOpen: true, gmEditId: g.id, gmTitle: g.title, gmWhy: g.why, gmHorizon: g.horizon, gmParentId: g.parentId, gmMinRank: 0, gmPeriod: g.period, gmSearch: '', menuId: null });
    } else {
      const parent = opts.parentId ? this.node(opts.parentId) : undefined;
      const minRank = parent ? T.rank(parent.horizon) + 1 : 0;
      const h = T.HORIZONS[Math.min(minRank, 3)];
      this.set({ gmOpen: true, gmEditId: null, gmTitle: '', gmWhy: '', gmHorizon: h, gmParentId: opts.parentId ?? null, gmMinRank: minRank, gmPeriod: T.defaultPeriod(h), gmSearch: '', menuId: null });
    }
  }

  saveGoal() {
    const { gmTitle, gmWhy, gmPeriod, gmEditId, gmHorizon, gmParentId, goals } = this.st;
    if (!gmTitle.trim()) return;
    if (gmEditId) {
      this.set({ gmOpen: false, goals: goals.map((g) => (g.id === gmEditId ? { ...g, title: gmTitle.trim(), why: gmWhy.trim(), period: gmPeriod } : g)) });
      void api.persist('goal.update', { id: gmEditId, title: gmTitle.trim(), why: gmWhy.trim(), period: gmPeriod });
    } else {
      if (gmHorizon !== 'Life' && !gmParentId) return;
      const goal: Goal = {
        id: 'g' + Date.now(), parentId: gmHorizon === 'Life' ? null : gmParentId, horizon: gmHorizon,
        title: gmTitle.trim(), why: gmWhy.trim(), pulse: 'On track', period: gmPeriod, focus: '',
      };
      this.set({ gmOpen: false, goals: [...goals, goal] });
      void api.persist('goal.create', goal);
    }
  }

  moveGoal() {
    const { mvId, mvParentId, goals } = this.st;
    if (!mvId || !mvParentId) return;
    this.set({ mvOpen: false, goals: goals.map((g) => (g.id === mvId ? { ...g, parentId: mvParentId } : g)) });
    void api.persist('goal.move', { id: mvId, parentId: mvParentId });
  }

  // ---- weekly planning ----
  planChecked(g: Goal): boolean {
    return this.st.plChecked[g.id] !== undefined ? this.st.plChecked[g.id] : this.isActive(g);
  }
  planDraft(g: Goal): string {
    return this.st.plDrafts[g.id] !== undefined ? this.st.plDrafts[g.id] : g.focus;
  }
  savePlan() {
    const goals = this.st.goals.map((g) =>
      this.isLeaf(g) && g.parentId ? { ...g, focus: this.planChecked(g) && this.planDraft(g).trim() ? this.planDraft(g).trim() : '' } : g,
    );
    this.set({ goals, plChecked: {}, plDrafts: {}, view: 'home', viewWeek: 0 });
    void api.persist('plan.save', goals.filter((g) => this.isLeaf(g) && g.parentId).map((g) => ({ id: g.id, focus: g.focus })));
    this.showToast('Plan saved');
  }
}

const Ctx = createContext<Store | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const store = useMemo(
    () => new Store(state, (p) => setState((s) => ({ ...s, ...p }))),
    [state],
  );

  // ★ Bootstrap: hydrate from the API layer (currently mock data).
  useEffect(() => {
    void api.fetchAll().then((d) => {
      setState((s) => ({ ...s, goals: d.goals, tasks: d.tasks, backlog: d.backlog, parking: d.ideas, learnings: d.learnings }));
    });
  }, []);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside AppProvider');
  return s;
}
