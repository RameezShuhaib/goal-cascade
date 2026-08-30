import type { Goal, Horizon } from '../types';

export const HORIZONS: Horizon[] = ['Life', 'Yearly', 'Quarterly', 'Monthly'];

export function rank(h: Horizon): number {
  return { Life: 0, Yearly: 1, Quarterly: 2, Monthly: 3 }[h];
}

export function node(goals: Goal[], id: string | null): Goal | undefined {
  return goals.find((g) => g.id === id);
}

export function children(goals: Goal[], id: string | null): Goal[] {
  return goals.filter((g) => g.parentId === id);
}

export function isLeaf(goals: Goal[], g: Goal): boolean {
  return children(goals, g.id).length === 0;
}

export function isActive(goals: Goal[], g: Goal): boolean {
  return isLeaf(goals, g) && !!g.focus;
}

export function ancestors(goals: Goal[], g: Goal): Goal[] {
  const out: Goal[] = [];
  let p = g.parentId ? node(goals, g.parentId) : undefined;
  while (p) {
    out.unshift(p);
    p = p.parentId ? node(goals, p.parentId) : undefined;
  }
  return out;
}

export function rootOf(goals: Goal[], g: Goal): Goal {
  const a = ancestors(goals, g);
  return a.length ? a[0] : g;
}

export function descendants(goals: Goal[], id: string): string[] {
  const out: string[] = [];
  children(goals, id).forEach((c) => {
    out.push(c.id);
    out.push(...descendants(goals, c.id));
  });
  return out;
}

export function subtreeActive(goals: Goal[], g: Goal): boolean {
  if (isLeaf(goals, g)) return isActive(goals, g);
  return children(goals, g.id).some((c) => subtreeActive(goals, c));
}

/** Non-life leaves (weekly-focus holders). */
export function leaves(goals: Goal[]): Goal[] {
  return goals.filter((g) => isLeaf(goals, g) && g.parentId);
}

export function pathOf(goals: Goal[], g: Goal): string[] {
  return [...ancestors(goals, g), g].map((x) => x.title);
}

/** The active leaf under (or at) `goalId`, if any. */
export function activeLeafFor(goals: Goal[], goalId: string): Goal | undefined {
  const ids = [goalId, ...descendants(goals, goalId)];
  return goals.find((g) => ids.includes(g.id) && isActive(goals, g));
}

export function defaultPeriod(h: Horizon): string {
  return h === 'Yearly' ? '2026' : h === 'Quarterly' ? 'Q4 2026' : h === 'Monthly' ? 'Sep 2026' : '';
}

export function replanPeriods(h: Horizon): string[] {
  if (h === 'Monthly') return ['Oct 2026', 'Nov 2026'];
  if (h === 'Quarterly') return ['Q4 2026', 'Q1 2027'];
  return ['2027'];
}

export interface FlatRow {
  g: Goal;
  depth: number;
}

export function flatTree(goals: Goal[], search: string): FlatRow[] {
  const rows: FlatRow[] = [];
  const walk = (pid: string | null, depth: number) => {
    children(goals, pid).forEach((g) => {
      rows.push({ g, depth });
      walk(g.id, depth + 1);
    });
  };
  walk(null, 0);
  const q = search.toLowerCase();
  return q ? rows.filter((r) => r.g.title.toLowerCase().includes(q)) : rows;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url.length > 28 ? url.slice(0, 28) + '…' : url;
  }
}

export function trunc(s: string): string {
  const v = s || '(none)';
  return v.length > 24 ? v.slice(0, 24) + '…' : v;
}
