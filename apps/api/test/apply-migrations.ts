import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

type Migrations = Parameters<typeof applyD1Migrations>[1];
const testEnv = env as unknown as { DB: D1Database; TEST_MIGRATIONS: Migrations };

// Aplica as migrações REAIS (mesmos arquivos de produção) no D1 local de teste.
await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
