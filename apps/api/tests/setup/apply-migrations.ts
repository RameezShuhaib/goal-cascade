import 'reflect-metadata';
import { applyD1Migrations, env } from 'cloudflare:test';

// Setup files run outside per-test-file storage isolation and may run multiple times;
// applyD1Migrations only applies migrations that have not been applied yet.
const e = env as unknown as { DB: D1Database; TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };
await applyD1Migrations(e.DB, e.TEST_MIGRATIONS);
