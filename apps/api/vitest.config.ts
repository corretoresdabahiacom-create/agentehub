import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
      // Segredos de teste são GERADOS a cada execução: nada fixo (nem fictício) no repositório.
      const random = () => randomBytes(24).toString('hex');
      return {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ENVIRONMENT: 'test',
            TURNSTILE_MODE: 'enforce',
            TURNSTILE_SITE_KEY: random(),
            TURNSTILE_SECRET_KEY: random(),
            PASSWORD_PEPPER: random(),
            APP_ORIGINS: '',
            SIGNUP_OPEN: 'true',
            // Fixados para o teste ser hermético (um .dev.vars local não pode afrouxar os limites).
            SIGNUP_PER_IP_PER_HOUR: '5',
            LOGIN_PER_IP_PER_10MIN: '20',
            LOGIN_PER_EMAIL_PER_10MIN: '10',
          },
        },
      };
    }),
  ],
  test: {
    setupFiles: ['./test/apply-migrations.ts'],
    testTimeout: 30_000,
  },
});
