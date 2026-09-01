import 'reflect-metadata';
import { container, type DependencyContainer } from 'tsyringe';
import {
  IApiTokenRepo,
  IAuthRateLimitRepo,
  IBacklogLinkRepo,
  IBacklogRepo,
  IClock,
  IEmailOutboxRepo,
  IEmailSender,
  IGoalRepo,
  IIdGenerator,
  IIdempotencyRepo,
  ILearningRepo,
  IPreferencesRepo,
  ITaskEventRepo,
  ITaskLinkRepo,
  ITaskRepo,
  IUserRepo,
} from '../../application/ports';
import {
  ApiTokenService,
  BacklogService,
  BootstrapService,
  GoalService,
  GoalTreeGuard,
  GuardedBatch,
  LearningService,
  MeService,
  ProvisionUserService,
  TaskService,
} from '../../application/services';
import type { AppEnv } from '../../env';
import { D1RateLimitStore } from '../auth/d1-rate-limit-store';
import { SystemClock } from '../clock';
import { LogEmailSender } from '../email/log-email-sender';
import { UlidGenerator } from '../ids/ulid';
import {
  D1ApiTokenRepo,
  D1BacklogLinkRepo,
  D1BacklogRepo,
  D1EmailOutboxRepo,
  D1GoalRepo,
  D1IdempotencyRepo,
  D1LearningRepo,
  D1PreferencesRepo,
  D1TaskEventRepo,
  D1TaskLinkRepo,
  D1TaskRepo,
  D1UserRepo,
} from '../persistence';
import { createDb, type Db } from '../persistence/db';
import { DB } from './tokens';

/**
 * The ONE seam for fakes. Tests pass this to swap ports (e.g. `c.registerInstance(IClock, new FakeClock(...))`).
 * It runs LAST, so an override always wins. If you find yourself wanting a second seam, this one is in
 * the wrong place.
 */
export type ContainerOverrides = (c: DependencyContainer) => void;

/**
 * One child container per request. A Worker has no long-lived process to hang a container off, and `env`
 * only exists per request, so a child container per request is the natural unit — `registerSingleton`
 * here means "one instance for this request", not one for the process.
 */
export function createRequestContainer(env: AppEnv, overrides?: ContainerOverrides): DependencyContainer {
  const c = container.createChildContainer();

  c.registerInstance(DB, createDb(env.DB));
  c.registerInstance(IClock, new SystemClock());
  c.registerInstance(IIdGenerator, new UlidGenerator());

  // repositories
  c.registerSingleton(IUserRepo, D1UserRepo);
  c.registerSingleton(IPreferencesRepo, D1PreferencesRepo);
  c.registerSingleton(IGoalRepo, D1GoalRepo);
  c.registerSingleton(ITaskRepo, D1TaskRepo);
  c.registerSingleton(ITaskLinkRepo, D1TaskLinkRepo);
  c.registerSingleton(ITaskEventRepo, D1TaskEventRepo);
  c.registerSingleton(IBacklogRepo, D1BacklogRepo);
  c.registerSingleton(IBacklogLinkRepo, D1BacklogLinkRepo);
  c.registerSingleton(ILearningRepo, D1LearningRepo);
  c.registerSingleton(IIdempotencyRepo, D1IdempotencyRepo);
  c.registerSingleton(IEmailOutboxRepo, D1EmailOutboxRepo);
  c.registerSingleton(IApiTokenRepo, D1ApiTokenRepo);
  // The same object is Better Auth's `customStorage` and the purge port.
  c.register(IAuthRateLimitRepo, { useFactory: (dc) => new D1RateLimitStore(dc.resolve<Db>(DB)) });

  // adapters
  c.register(IEmailSender, { useFactory: (dc) => createEmailSender(env, dc) });

  // services
  c.registerSingleton(GuardedBatch);
  c.registerSingleton(ProvisionUserService);
  c.registerSingleton(GoalTreeGuard);
  c.registerSingleton(MeService);
  c.registerSingleton(GoalService);
  c.registerSingleton(TaskService);
  c.registerSingleton(BacklogService);
  c.registerSingleton(LearningService);
  c.registerSingleton(BootstrapService);
  c.registerSingleton(ApiTokenService);

  overrides?.(c);
  return c;
}

/**
 * The email adapter — and there is only one.
 *
 * It returns `LogEmailSender` with `forward = null` UNCONDITIONALLY. This is a deliberate product
 * decision, not an unfinished integration: the owner's sending domain was previously flagged for a
 * critically high bounce rate caused by this project's own test traffic, and a repeat can get the domain
 * banned. Goal Cascade therefore removes the capability instead of guarding it — there is no
 * `send_email` binding in `wrangler.jsonc`, no Resend or Cloudflare adapter anywhere in this tree, and
 * no branch here that could select one.
 *
 * Verification and password-reset links land in `email_outbox` (for `E2E_EMAIL_PATTERN` addresses only)
 * and are read back through `GET /internal/outbox` behind `X-Internal-Secret`.
 *
 * `tests/security/no-real-email.test.ts` fails the build if this function ever gains a branch that can
 * return a network-capable sender, if a mail-provider adapter appears in the source tree, or if
 * `wrangler.jsonc` grows a `send_email` binding. A comment is not a mechanism; those tests are.
 */
export function createEmailSender(env: AppEnv, dc: DependencyContainer): LogEmailSender {
  return new LogEmailSender(
    dc.resolve<IEmailOutboxRepo>(IEmailOutboxRepo),
    dc.resolve<IIdGenerator>(IIdGenerator),
    dc.resolve<IClock>(IClock),
    null,
    env.E2E_EMAIL_PATTERN,
  );
}
