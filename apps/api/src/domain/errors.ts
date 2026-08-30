import { ERROR_STATUS, type ErrorCode } from '@goal-cascade/shared';

/**
 * The ONE error path. Throw a `DomainError` anywhere below the API layer; the error handler maps `code`
 * → HTTP status through `ERROR_STATUS` and renders the envelope. Never return `{ ok: false }` results,
 * and never the mockup's silent `return` (SPEC D-5, Q-10: "refusals are validation errors, never silent
 * no-ops").
 */
export class DomainError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message ?? code);
    this.name = 'DomainError';
    this.status = ERROR_STATUS[code];
  }
}

/** Convenience constructors for the most common codes. */
export const notFound = (what = 'resource') => new DomainError('NOT_FOUND', `${what} not found`);
export const forbidden = (message = 'forbidden') => new DomainError('FORBIDDEN', message);
export const validationFailed = (message: string, details?: Record<string, unknown>) =>
  new DomainError('VALIDATION_FAILED', message, details);

/**
 * Raised by `GuardedBatch` when a guarded statement's precondition no longer holds: a concurrent writer
 * won the race (SPEC Q-2/Q-3). Renders as 409 `CONCURRENT_UPDATE`. Pass `code` when the guard maps to a
 * more specific refusal, or catch and re-read to decide.
 */
export class ConcurrencyError extends DomainError {
  constructor(
    readonly label: string,
    readonly expectedChanges: number,
    readonly actualChanges: number,
    code: ErrorCode = 'CONCURRENT_UPDATE',
    details?: Record<string, unknown>,
  ) {
    super(code, 'Something changed on another device — try again', {
      label,
      expectedChanges,
      actualChanges,
      ...details,
    });
    this.name = 'ConcurrencyError';
  }
}

/**
 * Thrown by the handler stubs the foundation ships; renders as 501 NOT_IMPLEMENTED.
 *
 * Every route in `api/routes/` is registered, origin-checked, session-gated, idempotency-wrapped and
 * schema-validated NOW; a feature agent fills in the service behind it, not the route. A 501 from one of
 * these means "the contract is agreed and the plumbing works, the behaviour is not written yet" — it is
 * never a state a shipped client can reach.
 */
export class NotImplementedError extends DomainError {
  constructor(what: string) {
    super('NOT_IMPLEMENTED', `${what} is not implemented yet`);
    this.name = 'NotImplementedError';
  }
}
