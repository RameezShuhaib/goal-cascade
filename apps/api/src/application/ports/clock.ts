export interface IClock {
  /** Current instant as a Date. */
  now(): Date;
  /** Current instant as ISO-8601 UTC (`2026-08-29T03:14:07.000Z`). */
  nowIso(): string;
}
/**
 * The interface and its DI token share a name on purpose: TypeScript keeps types and values in separate
 * namespaces, so `@inject(IClock) clock: IClock` works with exactly one import.
 */
export const IClock = Symbol.for('goal-cascade.IClock');
