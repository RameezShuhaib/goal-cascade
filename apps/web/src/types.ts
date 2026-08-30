export type Horizon = 'Life' | 'Yearly' | 'Quarterly' | 'Monthly';
export type Pulse = 'On track' | 'At risk' | 'Rethink';

export interface Goal {
  id: string;
  parentId: string | null;
  horizon: Horizon;
  title: string;
  why: string;
  pulse: Pulse;
  period: string;
  /** One-sentence weekly focus. Only meaningful on leaf goals; '' = dormant. */
  focus: string;
}

export interface TaskEvent {
  i: string; // small glyph
  t: string; // text
  d: string; // date label
}

export interface ExternalLink {
  url: string;
}

export interface Task {
  id: string;
  goalId: string; // parent leaf goal (weekly focus holder)
  title: string;
  cond: string; // done-condition (optional)
  desc: string;
  links: ExternalLink[];
  done: boolean;
  doneWeek: number | null; // week offset it was completed in
  doneLabel: string; // e.g. "Fri 28 Aug"
  originWeek: number; // week offset it was created in (<= 0)
  events: TaskEvent[]; // newest first
}

export interface BacklogItem {
  id: string;
  goalId: string; // any yearly/quarterly/monthly goal
  title: string;
  desc: string;
  links: ExternalLink[];
  when: string; // captured date label
  fromWeek: string; // '' or e.g. "week of 24 Aug" when moved from a week
}

export interface Idea {
  id: string;
  goalId: string | null; // life goal tag
  text: string;
  when: string;
}

export interface Learning {
  id: string;
  goalId: string | null; // life goal tag
  text: string;
  when: string;
  applied: boolean; // "changed the plan"
}

export type View = 'home' | 'goals' | 'line' | 'backlog' | 'ideas' | 'learn' | 'plan';

export type ConfirmKind = 'moveTask' | 'cancelTask' | 'replan';

export interface ConfirmState {
  type: ConfirmKind;
  taskId?: string;
  goalId?: string;
}
