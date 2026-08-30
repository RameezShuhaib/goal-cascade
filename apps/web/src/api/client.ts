/**
 * ★ API layer — every function here is a stub.
 * Replace the bodies with real HTTP calls; keep the signatures.
 * Reads return mock data; writes echo the payload and log to the console.
 */
import type { BacklogItem, Goal, Idea, Learning, Task } from '../types';
import { mockBacklog, mockGoals, mockIdeas, mockLearnings, mockTasks } from '../data/mock';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export interface AllData {
  goals: Goal[];
  tasks: Task[];
  backlog: BacklogItem[];
  ideas: Idea[];
  learnings: Learning[];
}

export async function fetchAll(): Promise<AllData> {
  // TODO: replace with parallel real fetches.
  return {
    goals: clone(mockGoals),
    tasks: clone(mockTasks),
    backlog: clone(mockBacklog),
    ideas: clone(mockIdeas),
    learnings: clone(mockLearnings),
  };
}

export async function fetchGoals(): Promise<Goal[]> {
  return clone(mockGoals); // TODO
}
export async function fetchTasks(): Promise<Task[]> {
  return clone(mockTasks); // TODO
}
export async function fetchBacklog(): Promise<BacklogItem[]> {
  return clone(mockBacklog); // TODO
}
export async function fetchIdeas(): Promise<Idea[]> {
  return clone(mockIdeas); // TODO
}
export async function fetchLearnings(): Promise<Learning[]> {
  return clone(mockLearnings); // TODO
}

/**
 * Generic write stub. The store calls this fire-and-forget after each local
 * mutation; wire it to your real endpoints (and add error handling/rollback).
 */
export async function persist<T>(kind: string, payload: T): Promise<T> {
  // TODO: POST/PUT/DELETE to your API.
  console.debug('[api stub] persist', kind, payload);
  return payload;
}
