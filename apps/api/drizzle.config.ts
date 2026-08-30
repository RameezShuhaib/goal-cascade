import { defineConfig } from 'drizzle-kit';

// Migration GENERATION only (`npm run db:generate`). Applying is done by wrangler
// (`db:migrate:local` / `db:migrate:remote`), which reads `migrations/*.sql`. There is deliberately no
// D1 credential here: nothing in this repo can point drizzle-kit at the live database.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/infrastructure/persistence/schema.ts',
  out: './migrations',
  strict: true,
  verbose: true,
});
