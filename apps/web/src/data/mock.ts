import type { BacklogItem, Goal, Idea, Learning, Task } from '../types';
import { dstr, todayStr, wm } from '../utils/dates';

export const mockGoals: Goal[] = [
  { id: 'g1', parentId: null, horizon: 'Life', title: 'Financial freedom', why: 'Buy back my time.', pulse: 'On track', period: '', focus: '' },
  { id: 'g2', parentId: 'g1', horizon: 'Yearly', title: '€50k invested by December', why: '', pulse: 'On track', period: '2026', focus: '' },
  { id: 'g3', parentId: 'g2', horizon: 'Quarterly', title: 'Savings automated, index maxed', why: '', pulse: 'On track', period: 'Q3 2026', focus: '' },
  { id: 'g4', parentId: 'g3', horizon: 'Monthly', title: 'Move emergency fund, rebalance', why: '', pulse: 'On track', period: 'Sep 2026', focus: 'Move the emergency fund to a higher-yield account' },
  { id: 'g5', parentId: 'g1', horizon: 'Yearly', title: 'Launch AI consultation agency', why: '', pulse: 'On track', period: '2026', focus: '' },
  { id: 'g6', parentId: 'g5', horizon: 'Quarterly', title: 'First paying client', why: '', pulse: 'On track', period: 'Q4 2026', focus: '' },
  { id: 'g7', parentId: 'g6', horizon: 'Monthly', title: 'Landing page + 10 outreach calls', why: '', pulse: 'On track', period: 'Oct 2026', focus: '' },
  { id: 'g8', parentId: null, horizon: 'Life', title: 'Fit body', why: 'Energy for everything else.', pulse: 'At risk', period: '', focus: '' },
  { id: 'g9', parentId: 'g8', horizon: 'Yearly', title: 'Run a half marathon', why: '', pulse: 'At risk', period: '2026', focus: '' },
  { id: 'g10', parentId: 'g9', horizon: 'Quarterly', title: 'Sub-2h base building', why: '', pulse: 'On track', period: 'Q3 2026', focus: '' },
  { id: 'g11', parentId: 'g10', horizon: 'Monthly', title: '3 runs a week, long run Sunday', why: '', pulse: 'At risk', period: 'Sep 2026', focus: 'Three runs, Sunday long run 14 km' },
  { id: 'g12', parentId: null, horizon: 'Life', title: 'Ship the side project', why: 'Prove I can finish things.', pulse: 'On track', period: '', focus: '' },
  { id: 'g13', parentId: 'g12', horizon: 'Yearly', title: '100 paying users', why: '', pulse: 'On track', period: '2026', focus: '' },
  { id: 'g14', parentId: 'g13', horizon: 'Quarterly', title: 'Public beta live', why: '', pulse: 'On track', period: 'Q4 2026', focus: '' },
  { id: 'g15', parentId: 'g14', horizon: 'Monthly', title: 'Onboarding flow done', why: '', pulse: 'On track', period: 'Sep 2026', focus: 'Cut onboarding to three screens and ship it' },
];

export const mockTasks: Task[] = [
  {
    id: 't1', goalId: 'g4', title: 'Open the high-yield account', cond: 'Account approved and login works', desc: '', links: [],
    done: true, doneWeek: 0, doneLabel: dstr(0, 2), originWeek: 0,
    events: [
      { i: '✓', t: 'Completed', d: dstr(0, 2) },
      { i: '＋', t: 'Created — weekly planning', d: wm(0) },
    ],
  },
  {
    id: 't2', goalId: 'g4', title: 'Transfer emergency fund', cond: 'Balance visible AND old account closed', desc: '', links: [],
    done: false, doneWeek: null, doneLabel: '', originWeek: -1,
    events: [
      { i: '✎', t: 'Done-condition edited: “Full balance visible” → “Balance visible AND old account closed”', d: todayStr() },
      { i: '↩', t: 'Unchecked', d: todayStr() },
      { i: '✓', t: 'Completed', d: dstr(-1, 4) },
      { i: '＋', t: 'Created — weekly planning', d: wm(-1) },
    ],
  },
  {
    id: 't3', goalId: 'g11', title: 'Mon / Wed / Sun runs', cond: 'All three logged in the notebook', desc: '', links: [],
    done: false, doneWeek: null, doneLabel: '', originWeek: -2,
    events: [
      { i: '↻', t: 'Carried to week of ' + wm(0), d: wm(0) },
      { i: '↻', t: 'Carried to week of ' + wm(-1), d: wm(-1) },
      { i: '＋', t: 'Created — weekly planning', d: wm(-2) },
    ],
  },
  {
    id: 't4', goalId: 'g11', title: 'Lay out running kit the night before', cond: 'Kit by the door Sun/Tue/Sat night', desc: '', links: [],
    done: true, doneWeek: 0, doneLabel: dstr(0, 1), originWeek: 0,
    events: [
      { i: '✓', t: 'Completed', d: dstr(0, 1) },
      { i: '＋', t: 'Created — weekly planning', d: wm(0) },
    ],
  },
  {
    id: 't5', goalId: 'g15', title: 'Merge the 3-screen onboarding', cond: 'Deployed, old flow deleted',
    desc: 'Ship behind a feature flag first.', links: [{ url: 'https://github.com/acme/onboarding/pull/214' }],
    done: false, doneWeek: null, doneLabel: '', originWeek: 0,
    events: [{ i: '＋', t: 'Created — weekly planning', d: wm(0) }],
  },
  {
    id: 't6', goalId: 'g15', title: 'Tweak landing page colors', cond: 'Looks better', desc: '', links: [],
    done: true, doneWeek: 0, doneLabel: dstr(0, 2), originWeek: 0,
    events: [
      { i: '✓', t: 'Completed', d: dstr(0, 2) },
      { i: '＋', t: 'Created mid-week', d: dstr(0, 2) },
    ],
  },
  {
    id: 't7', goalId: 'g7', title: 'Draft service pricing', cond: 'Three tiers written up', desc: '', links: [],
    done: true, doneWeek: -1, doneLabel: dstr(-1, 4), originWeek: -1,
    events: [
      { i: '✓', t: 'Completed', d: dstr(-1, 4) },
      { i: '＋', t: 'Created — pulled from Backlog', d: wm(-1) },
    ],
  },
];

export const mockBacklog: BacklogItem[] = [
  { id: 'b1', goalId: 'g3', title: 'Rebalance portfolio in October', desc: '', links: [], when: '25 Aug', fromWeek: '' },
  { id: 'b2', goalId: 'g3', title: 'Compare broker fees', desc: '', links: [], when: '18 Aug', fromWeek: '' },
  { id: 'b3', goalId: 'g5', title: 'Register the LLC', desc: '', links: [], when: '21 Jul', fromWeek: '' },
  { id: 'b5', goalId: 'g9', title: 'New shoes around 500 km', desc: '', links: [], when: '9 Jun', fromWeek: '' },
];

export const mockIdeas: Idea[] = [
  { id: 'k3', goalId: null, text: 'Podcast idea: interviews with indie founders', when: 'Today' },
  { id: 'k2', goalId: null, text: 'Standing desk?', when: 'Thu' },
  { id: 'k1', goalId: 'g12', text: 'Rebuild the site in that new framework', when: 'Mon' },
];

export const mockLearnings: Learning[] = [
  { id: 'l1', goalId: 'g8', text: 'Morning runs stick, evening ones don’t.', when: 'Wed', applied: false },
  { id: 'l2', goalId: 'g1', text: 'Index funds beat my stock picks again.', when: 'Fri', applied: false },
  { id: 'l0', goalId: 'g1', text: 'Automating the transfer beats remembering it.', when: 'Last week', applied: true },
];
