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

/**
 * Convenience constructors for the most common codes.
 *
 * ⚠ `validationFailed` is deleted. `VALIDATION_FAILED` is the most-thrown code in the API and not one of
 * its ~30 throw sites used the helper — they all pass `details` and construct `DomainError` directly,
 * which reads no worse. A convenience nobody reached for was not convenient.
 */
export const notFound = (what = 'resource') => new DomainError('NOT_FOUND', `${what} not found`);
export const forbidden = (message = 'forbidden') => new DomainError('FORBIDDEN', message);

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
 * Renders as 501 NOT_IMPLEMENTED.
 *
 * ⚠ **Nothing in `src` constructs this any more, and that is the finished state, not a gap.** It was
 * thrown by the handler stubs the foundation shipped — every route registered, origin-checked,
 * session-gated and schema-validated before its service existed — and every one of those stubs is now
 * implemented. `tests/error-handler.test.ts` asserts exactly that: no endpoint answers 501.
 *
 * **What it is now is the fixture that proves the 501 envelope renders**, which is the only way to test a
 * status no route emits. It is kept for that and for nothing else; `NOT_IMPLEMENTED` stays in
 * `ERROR_STATUS` on separate grounds — it is contract surface the client's status table needs.
 */
export class NotImplementedError extends DomainError {
  constructor(what: string) {
    super('NOT_IMPLEMENTED', `${what} is not implemented yet`);
    this.name = 'NotImplementedError';
  }
}
