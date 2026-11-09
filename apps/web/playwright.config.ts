import { defineConfig } from '@playwright/test';

// E2E contra o stack real: Worker (wrangler dev, D1 local descartável, migrações reais) +
// build de produção do frontend servido por `vite preview` (mesma origem via proxy /api).
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'chrome', // Chrome do sistema; evita baixar navegador do Playwright
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev:e2e -w @agenthub/api',
      url: 'http://localhost:8787/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run build && npx vite preview --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
