import type { ErrorCode, ErrorEnvelope } from '@goal-cascade/shared';
import { ERROR_STATUS } from '@goal-cascade/shared';
import type { ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';
import { DomainError } from '../../domain/errors';
import type { AppBindings } from '../types';

export function errorResponse(code: ErrorCode, message: string, details?: Record<string, unknown>, status?: number): Response {
  const envelope: ErrorEnvelope = { error: { code, message, ...(details ? { details } : {}) } };
  return new Response(JSON.stringify(envelope), {
    status: status ?? ERROR_STATUS[code],
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
  });
}

const HTTP_TO_CODE: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
};

/**
 * ONE envelope, for every failure. `DomainError` → its own code and status; `ZodError` → 422; Hono's
 * `HTTPException` → mapped; anything else → 500 INTERNAL with the detail logged, never returned.
 */
export const errorHandler: ErrorHandler<AppBindings> = (err, c) => {
  if (err instanceof DomainError) {
    if (err.status >= 500) console.error('[error]', err.code, err.message, err.stack);
    return errorResponse(err.code, err.message, err.details, err.status);
  }
  if (err instanceof ZodError) {
    return errorResponse('VALIDATION_FAILED', 'validation failed', { issues: err.issues });
  }
  if (err instanceof HTTPException) {
    // Mapped codes render with the code's canonical status (400 → 422 VALIDATION_FAILED); unmapped keep theirs.
    const code = HTTP_TO_CODE[err.status];
    if (code) return errorResponse(code, err.message || code);
    return errorResponse('INTERNAL', err.message || 'INTERNAL', undefined, err.status as ContentfulStatusCode);
  }
  console.error('[error] unhandled', err);
  void c;
  return errorResponse('INTERNAL', 'internal error');
};

const WORKER_PREFIXES = ['/api/', '/internal/'];

/**
 * Where the SPA and the API meet. `/api/*` and `/internal/*` always answer with the error envelope;
 * anything else is the SPA's territory.
 *
 * In production `assets.run_worker_first` keeps those requests out of the Worker entirely, but when they
 * do arrive (local dev, tests with the binding) we defer to the assets binding, whose
 * `single-page-application` handling serves index.html for unknown paths.
 */
export const notFoundHandler: NotFoundHandler<AppBindings> = (c) => {
  const { pathname } = new URL(c.req.url);
  const isWorkerPath = WORKER_PREFIXES.some((p) => pathname === p.slice(0, -1) || pathname.startsWith(p));
  if (!isWorkerPath && c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
  return errorResponse('NOT_FOUND', 'route not found');
};
