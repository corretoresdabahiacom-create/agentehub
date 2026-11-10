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

**Decisão (ADR 0002):** em produção, um único Worker serve a API e os arquivos estáticos (Workers Static Assets), preservando a mesma origem; um domínio próprio pode ser associado depois sem mudar código. `*.pages.dev` + `*.workers.dev` seriam origens distintas e o cookie não funcionaria, por isso Pages não é usado.

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

## Marketplace (Fase 2)

- **Rotas** (`apps/api/src/routes/agents.ts`): `GET /api/agents` (catálogo), `GET /api/agents/:slug`, `GET /api/agents/:slug/reviews`, `GET /api/categories` são **públicas** (sessão opcional enriquece com `favorited`/`installedWorkspaceIds`). `POST/DELETE …/install`, `PUT/DELETE …/favorite`, `PUT/DELETE …/review` exigem sessão e passam pelo CSRF de Origin.
- **Visibilidade:** só entram `visibility = public`, `status = published` e `current_version_id` não nulo. Rascunho, suspenso, arquivado, privado e de workspace respondem 404. Agentes privados/de workspace são tratados nas Fases 3-4.
- **Catálogo:** busca `LIKE` em nome e descrição (com `ESCAPE`, `%` e `_` são texto), filtro por categoria, ordenação (`newest | name | rating | popular`), escopo (`all | favorites | installed`, os dois últimos exigem sessão) e paginação (máx. 24 por página). Média, contagem de avaliações e instalações são calculadas no banco a cada consulta (sem contadores desnormalizados que possam divergir).
- **Instalar:** `agent_installations` por (agente, workspace, usuário), idempotente. Só em workspace do qual o usuário é membro (senão 404). Desinstalar marca `uninstalled` (preserva histórico) e só afeta a instalação do próprio usuário.
- **Avaliar:** exige instalação **e** execução `completed` do próprio usuário, na própria instalação, com `finished_at` nos últimos 90 dias. A resposta 403 traz o motivo (`not_installed` ou `no_recent_completed_execution`). Uma avaliação por usuário e agente (editar atualiza a mesma). Toda avaliação criada é `verified = 1`; a UI mostra o selo “Verificada”. Avaliações `hidden` (moderação, Fase 6) não contam e continuam ocultas depois de o autor editar.
- **Privacidade das avaliações:** a API nunca devolve autor (nem nome, nem e-mail), só `mine`. O nome de exibição padrão deriva do e-mail, então expô-lo vazaria parte dele.
- **Demonstração (R5):** `agents.is_demo = 1` faz a UI mostrar o selo **DEMO** e o aviso de que não pode ser executado. As migrações **não** criam agentes; `npm run db:seed-demo:local -w @agenthub/api` cria 3 agentes de demonstração apenas no D1 **local** (o script recusa `--remote`). Sem avaliações, instalações ou números fabricados.
- **Estado na URL:** busca, filtros, ordenação e página vivem na query string do frontend (compartilhável; voltar funciona).
