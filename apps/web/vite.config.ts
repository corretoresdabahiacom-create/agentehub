import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// A API roda como Worker separado (wrangler dev). O navegador só fala com a própria origem do
// frontend; o proxy encaminha /api, mantendo o desenho same-origin (cookie SameSite=Lax funciona).
const apiTarget = process.env.API_ORIGIN ?? 'http://localhost:8787';
const proxy = { '/api': { target: apiTarget } };

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'offline.html', 'offline.css', 'icons/apple-touch-icon.png'],
      manifest: {
        // Valores padrão de build. O nome/cores editáveis pelo admin (Fase 6) valem dentro do app;
        // o manifest estático só muda em novo build (docs/limitations.md).
        name: 'AI AgentHub',
        short_name: 'AgentHub',
        description:
          'Find, configure and run specialist agents — with control over what they can do.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#ffffff',
        theme_color: '#4f46e5',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Cache apenas do shell e dos assets estáticos versionados.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // Nada autenticado em cache público: a API é SEMPRE rede (sem fallback de cache).
        runtimeCaching: [{ urlPattern: /^\/api\//, handler: 'NetworkOnly' }],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { proxy },
  preview: { proxy },
  build: { sourcemap: false },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
