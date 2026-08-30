import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import type { DependencyContainer } from 'tsyringe';
import { IEmailSender } from '../../application/ports';
import { ProvisionUserService } from '../../application/services';
import { isValidTimezone } from '../../domain/weeks';
import type { AppEnv } from '../../env';
import { DB } from '../di/tokens';
import { resetPassword as resetPasswordMail, verifyEmail as verifyEmailMail } from '../email/templates';
import type { Db } from '../persistence/db';
import { account, session, user, verification } from '../persistence/schema';
import { D1RateLimitStore } from './d1-rate-limit-store';
import { AUTH_RATE_LIMIT_MAX, AUTH_RATE_LIMIT_RULES, AUTH_RATE_LIMIT_WINDOW_S, authRateLimitEnabled } from './rate-limit';
import {
  SIGNUP_NOT_ALLOWED_CODE,
  SIGNUP_NOT_ALLOWED_MESSAGE,
  isSignupAllowed,
  parseSignupAllowlist,
} from './signup-allowlist';

export const AUTH_BASE_PATH = '/api/auth';
export const RESET_PASSWORD_TOKEN_TTL_S = 60 * 60;

/** Password-reset landing URL on the SPA (same origin): `/?reset=1&token=<token>`. */
export const resetPasswordUrl = (origin: string, token: string) => `${origin}/?reset=1&token=${encodeURIComponent(token)}`;

export function parseTrustedOrigins(env: AppEnv): string[] {
  return (env.TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Self-hosted Better Auth inside the Worker, one instance per request (it needs the D1 binding and the
 * request origin). Ported from the reference codebase; every flow it had is kept — sign-up, sign-in,
 * sign-out, email verification, password reset, D1-backed rate limiting — and two things are changed:
 * user provisioning is single-user (no tenant, no membership, no invites), and sign-up is allowlisted.
 *
 *  - Drizzle adapter (sqlite) over our D1 `user/session/account/verification` tables.
 *  - Email + password. Sign-in is allowed before verification; the mail lands in `email_outbox` because
 *    this Worker has no way to deliver it (see `infrastructure/email/log-email-sender.ts`).
 *  - `baseURL` is derived from the REQUEST ORIGIN, never a `BASE_URL` var, so localhost, `workers.dev`
 *    and versioned preview URLs all work with zero configuration.
 */
export function createAuth(env: AppEnv, container: DependencyContainer, origin: string) {
  const db = container.resolve<Db>(DB);
  const email = container.resolve<IEmailSender>(IEmailSender);
  const provision = container.resolve(ProvisionUserService);

  return betterAuth({
    appName: env.APP_NAME,
    baseURL: origin,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [origin, ...parseTrustedOrigins(env)],
    database: drizzleAdapter(db, { provider: 'sqlite', schema: { user, session, account, verification } }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      // Reset links live for 1 hour (the web copy says "the link works for 1 hour").
      resetPasswordTokenExpiresIn: RESET_PASSWORD_TOKEN_TTL_S,
      // A reset is the recovery path for a lost phone / stolen password: every existing session dies
      // with the old password.
      revokeSessionsOnPasswordReset: true,
      // The mail links straight to the SPA (`/?reset=1&token=…`) rather than Better Auth's
      // `/api/auth/reset-password/:token` redirect, so the outbox link IS the landing URL.
      sendResetPassword: async ({ user: u, token }) => {
        await email.send({
          to: u.email,
          ...resetPasswordMail({
            appName: env.APP_NAME,
            name: u.name,
            url: resetPasswordUrl(origin, token),
            ttlHours: RESET_PASSWORD_TOKEN_TTL_S / 3600,
          }),
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user: u, url }) => {
        await email.send({ to: u.email, ...verifyEmailMail({ appName: env.APP_NAME, name: u.name, url }) });
      },
    },
    databaseHooks: {
      user: {
        create: {
          /**
           * R-auth-1 — the sign-up allowlist, enforced at the LAST point before a row exists.
           *
           * `before` runs inside the same transaction as the insert and can reject, so a refused sign-up
           * leaves the `user` table exactly as it was (`tests/security/signup-allowlist.test.ts` asserts
           * the table is still empty afterwards). Doing this in `after` would create the row and then
           * have to delete it — and an interrupted request would leave an account behind.
           *
           * An unset/empty `SIGNUP_ALLOWLIST` refuses everything (`isSignupAllowed`), which is the safe
           * default: a lost var closes sign-up rather than opening it.
           */
          before: async (u) => {
            if (isSignupAllowed(env, u.email)) return;
            console.warn(
              `[auth] refused sign-up for a non-allowlisted address (allowlist has ${parseSignupAllowlist(env).length} entr${
                parseSignupAllowlist(env).length === 1 ? 'y' : 'ies'
              })`,
            );
            throw new APIError('FORBIDDEN', { code: SIGNUP_NOT_ALLOWED_CODE, message: SIGNUP_NOT_ALLOWED_MESSAGE });
          },
          after: async (u, ctx) => {
            const headers = ctx?.request?.headers ?? ctx?.headers;
            const tz = headers?.get('x-timezone') ?? undefined;
            await provision.onUserCreated(
              { id: u.id, name: u.name, email: u.email, emailVerified: u.emailVerified, image: u.image ?? null },
              { timezone: tz && isValidTimezone(tz) ? tz : undefined },
            );
          },
        },
      },
    },
    // Reset tokens are stored HASHED in `verification.identifier`: read access to D1 — a leaked API
    // token, a backup, a `wrangler d1 execute` — is no longer takeover of the account.
    verification: { storeIdentifier: 'hashed' },
    // Better Auth's memory backend cannot work here (one auth instance per request), so the counters
    // live in D1 — see D1RateLimitStore. `customStorage` overrides `storage` entirely.
    rateLimit: {
      enabled: authRateLimitEnabled(env),
      window: AUTH_RATE_LIMIT_WINDOW_S,
      max: AUTH_RATE_LIMIT_MAX,
      customRules: { ...AUTH_RATE_LIMIT_RULES },
      customStorage: new D1RateLimitStore(db),
    },
    // Cloudflare sets `cf-connecting-ip` at the edge and overwrites any client-supplied value, so it is
    // the one header a caller cannot forge to get a private rate-limit bucket. `x-forwarded-for` is the
    // fallback for local dev.
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'] } },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
