import { ERROR_CODES, type ErrorCode } from '@goal-cascade/shared';

/**
 * Codes the client can see. The SPEC §5 codes come from the server envelope; the two extra ones are
 * client-side: `NETWORK` (fetch rejected — offline, DNS, CORS) and `BAD_RESPONSE` (a 2xx whose body
 * failed the shared Zod schema — contract drift, never a user problem).
 */
export type ApiErrorCode = ErrorCode | 'NETWORK' | 'BAD_RESPONSE';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, code: ApiErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

export const isKnownErrorCode = (code: unknown): code is ErrorCode =>
  typeof code === 'string' && (ERROR_CODES as readonly string[]).includes(code);

/**
 * True when the server did NOT commit a response under the request's `Idempotency-Key` (a 5xx deletes the
 * key row; a rejected fetch may never have arrived; `IDEMPOTENCY_IN_PROGRESS` is still executing). Only
 * then is re-sending with the SAME key meaningful — a stored 4xx would just be replayed verbatim.
 */
export const isTransient = (err: ApiError): boolean =>
  err.code === 'NETWORK' || err.code === 'IDEMPOTENCY_IN_PROGRESS' || err.status >= 500;

/** Anything thrown by the client becomes an `ApiError`; foreign errors are treated as network failures. */
export function toApiError(e: unknown): ApiError {
  if (isApiError(e)) return e;
  const message = e instanceof Error ? e.message : String(e);
  return new ApiError(0, 'NETWORK', message);
}

/** First human-readable Zod issue from a `VALIDATION_FAILED` envelope, if the server sent one. */
export function firstIssueMessage(err: ApiError): string | null {
  const issues = err.details?.issues;
  if (!Array.isArray(issues)) return null;
  const first = issues[0] as { message?: unknown } | undefined;
  return first && typeof first.message === 'string' ? first.message : null;
}
