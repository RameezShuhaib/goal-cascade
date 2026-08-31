import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@goal-cascade/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts') } },
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(__dirname, 'migrations'));
      return {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // This pool LOADS wrangler.jsonc, so every binding declared there is live in the test run.
          // Goal Cascade declares no `send_email` and ships no network-capable mail adapter, so there is
          // nothing to disable here — but `tests/setup/no-real-email.ts` asserts that on every run, and
          // `tests/security/no-real-email.test.ts` fails if either ever reappears.
          bindings: {
            TEST_MIGRATIONS: migrations,
            // `tests/perf/lens-scale.test.ts` seeds a 30-year account when this is `heavy`. It is
            // threaded through a BINDING because the miniflare pool has no `process.env`: the config
            // runs in Node, the test does not.
            SCALE: process.env.SCALE ?? '',
            BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-1234',
            INTERNAL_SECRET: 'test-internal-secret',
            // The whole suite signs up as `<something>@test.goal-cascade.local` (helpers/app.ts `uniqueEmail`).
            E2E_EMAIL_PATTERN: '*@test.goal-cascade.local',
            // Non-registrable on purpose: nothing can ever send from it.
            EMAIL_FROM: 'Goal Cascade <noreply@goal-cascade.local>',
            // EMPTY on purpose: the suite's default environment refuses every sign-up, which is the safe
            // default the allowlist must have. `tests/helpers/app.ts#signUp` widens it to the ONE address
            // it is registering, per request (`app.request(path, init, env)`), so every green test in the
            // suite is also a proof that exact-address matching works.
            SIGNUP_ALLOWLIST: '',
            // Better Auth falls back to a single `127.0.0.1` bucket under test and the D1 counters are
            // shared by every file, so the limiter is off by default here. The rate-limit test turns it
            // back on per request (env is passed to `app.request`) and asserts the real behaviour.
            AUTH_RATE_LIMIT: 'off',
          },
        },
      };
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup/no-real-email.ts', './tests/setup/apply-migrations.ts'],
  },
});
