import type { MiddlewareHandler } from 'hono';
import type { z } from 'zod';
import { DomainError } from '../domain/errors';
import type { AppBindings, AppContext } from './types';

/**
 * Validation is MIDDLEWARE, not something a handler does. Every route names its schema at registration
 * time, so "what does this endpoint accept" is answerable by reading the route table, and a handler can
 * never forget to validate.
 */

function fail(where: string, issues: z.ZodError['issues']): never {
  throw new DomainError('VALIDATION_FAILED', `invalid ${where}`, { issues });
}

/** Validate the JSON body (an empty body counts as `{}`) with a shared Zod schema; read it with `body(c)`. */
export const zJson =
  (schema: z.ZodType): MiddlewareHandler<AppBindings> =>
  async (c, next) => {
    const text = await c.req.text();
    let raw: unknown = {};
    if (text.trim() !== '') {
      try {
        raw = JSON.parse(text);
      } catch {
        throw new DomainError('VALIDATION_FAILED', 'malformed JSON body');
      }
    }
    const r = schema.safeParse(raw);
    if (!r.success) fail('body', r.error.issues);
    c.set('validated', { ...c.get('validated'), body: r.data });
    await next();
  };

/** Validate query params (repeated keys become arrays). */
export const zQuery =
  (schema: z.ZodType): MiddlewareHandler<AppBindings> =>
  async (c, next) => {
    const raw: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(c.req.queries())) raw[k] = v.length === 1 ? v[0]! : v;
    const r = schema.safeParse(raw);
    if (!r.success) fail('query', r.error.issues);
    c.set('validated', { ...c.get('validated'), query: r.data });
    await next();
  };

/** Validate path params. */
export const zParams =
  (schema: z.ZodType): MiddlewareHandler<AppBindings> =>
  async (c, next) => {
    const r = schema.safeParse(c.req.param());
    if (!r.success) fail('params', r.error.issues);
    c.set('validated', { ...c.get('validated'), params: r.data });
    await next();
  };

/**
 * The readers are typed off the same schema the middleware used, so a handler gets full inference from
 * one import and cannot read a shape that was never validated.
 */
export const body = <S extends z.ZodType>(c: AppContext, _schema: S): z.output<S> => c.get('validated').body as z.output<S>;
export const query = <S extends z.ZodType>(c: AppContext, _schema: S): z.output<S> => c.get('validated').query as z.output<S>;
export const params = <S extends z.ZodType>(c: AppContext, _schema: S): z.output<S> => c.get('validated').params as z.output<S>;
