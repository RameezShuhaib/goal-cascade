import 'reflect-metadata';
import { createApp } from './api/app';
import type { AppEnv } from './env';

const app = createApp();

/**
 * `fetch` only. There is deliberately no `scheduled` handler and no `triggers.crons` in
 * `wrangler.jsonc`: Goal Cascade has no scheduled work.
 *
 * The thing a cron would obviously be for — carrying open tasks into the new week — needs no job at all,
 * because weeks are stored as absolute Monday dates and an open task is simply visible in every week at
 * or after its origin (SPEC D-1, R-task-7). The one cosmetic side effect, the `Carried to week of …`
 * timeline entry, is produced lazily on first read of a week and made idempotent by a unique index
 * (Q-17). Adding a cron here would mean inventing state the read model already derives.
 */
export default {
  fetch: (request: Request, env: AppEnv, ctx: ExecutionContext) => app.fetch(request, env, ctx),
} satisfies ExportedHandler<AppEnv>;
