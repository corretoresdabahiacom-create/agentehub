# Arquitetura

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
- **Visibilidade:** só entram `visibility = public`, `status = published` e `current_version_id` não nulo. Rascunho, suspenso, arquivado, privado e de workspace respondem 404. Agentes privados aparecem só em Meus agentes (Fase 3); os de workspace chegam na Fase 4.
- **Catálogo:** busca `LIKE` em nome e descrição (com `ESCAPE`, `%` e `_` são texto), filtro por categoria, ordenação (`newest | name | rating | popular`), escopo (`all | favorites | installed`, os dois últimos exigem sessão) e paginação (máx. 24 por página). Média, contagem de avaliações e instalações são calculadas no banco a cada consulta (sem contadores desnormalizados que possam divergir).
- **Instalar:** `agent_installations` por (agente, workspace, usuário), idempotente. Só em workspace do qual o usuário é membro (senão 404). Desinstalar marca `uninstalled` (preserva histórico) e só afeta a instalação do próprio usuário.
- **Avaliar:** exige instalação **e** execução `completed` do próprio usuário, na própria instalação, com `finished_at` nos últimos 90 dias. A resposta 403 traz o motivo (`not_installed` ou `no_recent_completed_execution`). Uma avaliação por usuário e agente (editar atualiza a mesma). Toda avaliação criada é `verified = 1`; a UI mostra o selo “Verificada”. Avaliações `hidden` (moderação, Fase 6) não contam e continuam ocultas depois de o autor editar.
- **Privacidade das avaliações:** a API nunca devolve autor (nem nome, nem e-mail), só `mine`. O nome de exibição padrão deriva do e-mail, então expô-lo vazaria parte dele.
- **Demonstração (R5):** `agents.is_demo = 1` continua fazendo a UI mostrar o selo **DEMO**, mas nenhum dado de demonstração é criado: a migração 0005 cria apenas os 3 agentes **oficiais** (`is_demo = 0`), e o script `seed-demo` foi removido. Sem avaliações, instalações ou números fabricados.
- **Estado na URL:** busca, filtros, ordenação e página vivem na query string do frontend (compartilhável; voltar funciona).

## Agentes e execução (Fase 3)

- **Motor puro em `packages/shared/src/engine`** (sem I/O, testável sem Worker): `machine.ts` (estados `pending → running → awaiting_approval | completed | failed | canceled`, com `RETRY` de `failed` para `pending`), `tools.ts` (whitelist de ferramentas determinísticas), `pipeline.ts` (executa as ferramentas numa **ordem canônica** por estágio, com limites), `validate.ts` (validação antes de publicar).
- **Ferramentas:** `text.clean`, `text.stats`, `text.links`, `text.outline`, `text.keywords`, `text.actions`, `text.summarize`, `social.calendar` (aprovação sempre), `text.template` e `ai.generate` (recusada: sem provedor). Nenhuma faz rede, lê arquivos ou avalia código; templates só substituem marcadores conhecidos.
- **Execução (`apps/api/src/lib/executions.ts`):** cada transição é um `UPDATE … WHERE status = <anterior>` (guarda otimista); passos, estado final, aprovação/artefato e uso são gravados em **um único `db.batch` atômico**. Recusas (IA, tamanho, entrada obrigatória, cotas) acontecem **antes** de gravar a execução.
- **Aprovação (ADR 0003):** exigida por ferramenta `approval: always` ou `limits.requireApproval`. Conta individual: `self_second_step` (o próprio usuário confirma num segundo pedido explícito com `confirm: true`). Empresa: `workspace_admin` (owner/admin do workspace). Um índice único parcial garante **uma só aprovação pendente por execução**; aprovar/rejeitar é um batch com UPDATE guardado por `decision = 'pending'`, então decisões concorrentes têm um único vencedor. O resultado só vira artefato depois da aprovação.
- **Construtor (`/api/my/agents`):** escopado ao criador (404 para alheios). Versão publicada é imutável: editar cria um novo rascunho. Publicar valida (`validation_failed` com a lista de problemas), instala automaticamente e, se público, exige `confirmPublic`.
- **IA (`apps/api/src/ai/provider.ts`):** interface `AIProvider`; `getAiProvider` devolve `null`. `/api/config` e `/api/tools` informam `ai.status = not_configured`.
- **Auditoria:** `agent.create/publish/archive`, `execution.create/retry/cancel/approve/reject/expire`. Cada execução também grava um `usage_records` (`metric = execution`).

## Empresas (Fase 4)

`routes/teams.ts` concentra organizações, workspaces extras, convites, membros, cota, uso, histórico e biblioteca. Frontend: `/teams`, `/teams/:workspaceId`, `/invite/:token` (rota pública que leva a login/cadastro com `?next=`). Execução de agente de workspace dispensa instalação para qualquer membro; agente público exige instalação própria ou instalação compartilhada de owner/admin. Decisão em `docs/adr/0004-empresas-e-convites.md`.
