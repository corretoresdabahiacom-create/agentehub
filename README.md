# AI AgentHub

Plataforma multi-tenant (organização → workspace → membros) para descobrir, instalar, configurar, executar e compartilhar agentes orientados a tarefas, com permissões, histórico, ferramentas autorizadas e aprovação humana. Custo de operação: **R$ 0** (somente free tiers, sem cartão).

> **Estado: Fase 2 concluída (marketplace).** Existem cadastro, login, sessões, autorização por papéis, layout, i18n EN/PT, PWA instalável, catálogo com busca/filtros/ordenação, página do agente, instalar/favoritar e avaliações verificadas. **Não existem** execução de agentes, construtor, IA, push nem cobrança. O catálogo de produção nasce **vazio**: só aparece o que for publicado de verdade. A interface diz isso explicitamente (R4/R5).

## Estrutura

```
apps/api         Cloudflare Worker (Hono + D1 + Drizzle)
apps/web         React + TypeScript + Vite + Tailwind (PWA)
packages/shared  Tipos, papéis e schemas Zod compartilhados
docs/            Arquitetura, modelo de dados, segurança, limites, limitações
scripts/         setup-dev (gera .dev.vars local) e gerador de ícones
```

## Requisitos

- Node 22+
- **npm 11+** para `npm install` (o npm 10.9 tem um bug de resolução com vitest 4). Com o lockfile versionado, `npm ci` funciona também no npm 10.
- Google Chrome instalado (os testes E2E usam `channel: 'chrome'`).

## Começando

```bash
npm ci                      # ou: npx -y npm@11 install
npm run setup:dev           # cria apps/api/.dev.vars (aleatório, ignorado pelo git)
npm run db:migrate:local    # aplica as migrações no D1 local
npm run db:seed-demo:local -w @agenthub/api   # (opcional) 3 agentes de DEMONSTRAÇÃO, só local, marcados como demo
npm run dev:api             # Worker em http://localhost:8787
npm run dev:web             # app em http://localhost:5173 (proxy /api → :8787)
```

Em desenvolvimento a verificação anti-bot fica desligada (`TURNSTILE_MODE=disabled_dev`, só vale com `ENVIRONMENT=development`). Em produção sem Turnstile configurado, cadastro e login **recusam** (fail-closed).

## Verificações

```bash
npm run typecheck && npm run lint && npx prettier --check .
npm test                    # unitários/integração (API em workerd + D1 real, web, shared)
npm run test:e2e            # Playwright: stack real (Worker + build do web)
```

## Documentação

- [Arquitetura](docs/architecture.md) · [Modelo de dados](docs/data-model.md) · [Segurança](docs/security.md)
- [Limites do free tier](docs/free-tier-limits.md) · [Limitações conhecidas](docs/limitations.md)
- [Variáveis de ambiente](docs/env-vars.md) · [Monetização](docs/monetization.md) · [Dependências](docs/dependencies.md)
- Decisões (ADR): [0001 rate limit e senhas](docs/adr/0001-rate-limit-e-senhas.md) · [0002 PBKDF2 e deploy](docs/adr/0002-pbkdf2-e-deploy.md)
