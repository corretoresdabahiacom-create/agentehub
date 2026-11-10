# Dependências e justificativas (R10)

Todas open source, sem custo, sem cartão. Itens fora do §5.1/§5.2 do briefing trazem justificativa.

| Pacote                                                   | Uso                                     | Fora do briefing?                                                                                   |
| -------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| hono, drizzle-orm, drizzle-kit, wrangler                 | API, ORM/migrações, CLI Cloudflare      | não                                                                                                 |
| zod                                                      | Validação compartilhada API/web         | não                                                                                                 |
| nanoid                                                   | IDs                                     | **sim** — IDs curtos e seguros (`crypto` nativo por baixo); alternativa seria `crypto.randomUUID()` |
| react, react-dom, react-router, @tanstack/react-query    | UI, rotas, estado de servidor           | não                                                                                                 |
| i18next, react-i18next                                   | i18n EN/PT/ES                           | não                                                                                                 |
| tailwindcss, @tailwindcss/vite                           | Estilos                                 | não                                                                                                 |
| lucide-react                                             | Ícones                                  | **sim** — ícones acessíveis, tree-shaken (2 ícones usados)                                          |
| clsx                                                     | Composição de classes                   | **sim** — utilitário mínimo                                                                         |
| vite, @vitejs/plugin-react, vite-plugin-pwa              | Build e PWA (manifest + service worker) | não (PWA §9)                                                                                        |
| vitest, @cloudflare/vitest-plugin                        | Testes no runtime real (workerd + D1)   | não                                                                                                 |
| @playwright/test                                         | E2E (Chrome do sistema)                 | não                                                                                                 |
| eslint, typescript-eslint, prettier, globals, typescript | Qualidade                               | não                                                                                                 |

Auditoria: `npm audit --omit=dev` ⇒ 0 vulnerabilidades. Dev: 11 moderadas (ver `security.md`).

Fase 2: nenhuma dependência nova. `msw` (instalado na Fase 1 e não usado) foi removido.
`@types/node` (devDependency na raiz): tipos de Node para configs, scripts e Playwright (antes vinham transitivamente via `msw`).
