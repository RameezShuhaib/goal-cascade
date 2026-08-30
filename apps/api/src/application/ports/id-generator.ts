export interface IIdGenerator {
  /**
   * Monotonic ULID (26 chars, Crockford base32). SPEC Q-8 recommended UUIDv7; the orchestrator ruled for
   * ULID, which is equally sortable and collision-free and is what the reference codebase uses.
   * Clients never mint ids — a client-supplied id is ignored.
   */
  ulid(): string;
}
export const IIdGenerator = Symbol.for('goal-cascade.IIdGenerator');
