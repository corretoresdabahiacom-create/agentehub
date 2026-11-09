import { defineConfig } from 'drizzle-kit';

// O drizzle-kit só GERA o SQL versionado em ./migrations. Quem aplica é o wrangler (D1).
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './migrations',
});
