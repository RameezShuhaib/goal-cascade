import type { MiddlewareHandler } from 'hono';
import { DomainError } from '../../domain/errors';
import type { AppBindings } from '../types';

/** `/internal/*` exists only when INTERNAL_SECRET is configured (404 otherwise) and requires `X-Internal-Secret`. */
export const requireInternalSecret: MiddlewareHandler<AppBindings> = async (c, next) => {
  const secret = c.env.INTERNAL_SECRET;
  if (!secret) throw new DomainError('NOT_FOUND', 'route not found');
  const given = c.req.header('X-Internal-Secret') ?? '';
  if (given.length !== secret.length || !timingSafeEqual(given, secret)) throw new DomainError('FORBIDDEN', 'bad internal secret');
  await next();
};

function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
