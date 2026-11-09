# Arquitetura (Fase 1)

## Visão geral

```
Navegador ──(mesma origem)──▶ Frontend estático (Vite build, PWA)
     │                              │
     └────── /api/* ───────────────▶ Worker (Hono) ──▶ D1 (SQLite)
                                       └─▶ Turnstile siteverify (somente cadastro/login)
```

- **API**: um Worker Hono. Rotas: `/api/health`, `/api/config`, `/api/auth/*`, `/api/workspaces/*`. Qualquer outra rota (inclusive `/api/billing*`) responde 404.
- **Banco**: D1 com migrações Drizzle versionadas em `apps/api/migrations`. Seed idempotente só de configuração (`feature_flags`, `system_settings`), sem dados de demonstração.
- **Web**: SPA React. React Query para estado do servidor; i18next (EN/PT, estrutura ES pronta com fallback para EN); tema por `data-theme` + variáveis CSS.
- **Compartilhado**: papéis, schemas Zod e tipos de resposta em `packages/shared` (uma só fonte de verdade para API e web).

## Desenho same-origin

O cookie de sessão é `SameSite=Lax` e `__Host-`, e a API **não** define CORS. Por isso o navegador só fala com a origem do frontend e `/api` é encaminhado ao Worker (proxy do Vite em dev/E2E).

**Decisão em aberto para o deploy:** manter same-origin em produção exige servir frontend e API sob o mesmo host (Worker com static assets, ou domínio próprio com rota `/api/*` para o Worker). Sem domínio próprio, `*.pages.dev` + `*.workers.dev` seriam origens distintas e o cookie não funcionaria. Isso será decidido na etapa de deploy, com aprovação.

## Autenticação e sessões

- Senha: PBKDF2-SHA256 (100.000 iterações, máximo do Workers), salt por usuário, pré-hash HMAC-SHA256 com _pepper_ (segredo `PASSWORD_PEPPER`), formato `pbkdf2-sha256$iters$salt$hash`, comparação em tempo constante, `needsRehash` para migrar parâmetros no futuro.
- Login para e-mail inexistente executa uma derivação com hash fictício (tempo equalizado).
- Sessão: token aleatório no cookie `__Host-agenthub_session` (`HttpOnly; Secure; SameSite=Lax; Path=/`, sem `Domain`), TTL 14 dias. **Só o SHA-256 do token** é guardado em `sessions`. Rotação após 1 h com 60 s de tolerância (`prev_token_hash`), sem escrita por requisição.
- Anti-bot: Turnstile em cadastro e login (`enforced` | `disabled_dev` | `not_configured`, este último recusa com 503). Falha na verificação também recusa.

## Autorização

Toda consulta parte do usuário da sessão: usuário → organização → workspace. `requireRole(minimo)` usa `roleAtLeast`. Quem não é membro recebe **404** (não revela existência). Papéis: `owner > admin > member`.

## Rate limiting e caps

Contadores de janela fixa na tabela `rate_limit_counters` (D1) com um único upsert `... DO UPDATE SET count = count + 1 WHERE count < limite RETURNING count`: **requisições bloqueadas não escrevem** (um ataque não consome a cota de 100 mil escritas/dia). KV não é usado (1.000 escritas/dia). Caps globais diários de cadastro e login protegem o free tier.

## PWA

Manifest + service worker (vite-plugin-pwa/Workbox): faz cache apenas do shell e de assets versionados; `/api/*` é **sempre rede** (`NetworkOnly`, sem fallback de cache), então nada autenticado fica em cache. Página `offline.html` para navegação sem rede. O banner offline desativa ações que alteram dados.
