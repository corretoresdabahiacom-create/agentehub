# Modelo de dados

Definido em `apps/api/src/db/schema.ts` (Drizzle) e aplicado por `apps/api/migrations/0000_init_schema.sql`. Todas as tabelas do §6.1 do briefing existem desde a Fase 1; só as marcadas ⚙ têm código que as usa agora.

| Grupo          | Tabelas                                                                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Identidade ⚙   | `users`, `user_profiles`, `sessions`                                                                                                            |
| Tenancy ⚙      | `organizations`, `organization_members`, `workspaces`, `workspace_members`, `organization_invites`                                              |
| Catálogo       | `categories`, `agents`, `agent_versions`, `agent_tools`, `agent_tests`, `agent_categories`, `agent_installations`, `agent_reviews`, `favorites` |
| Execução       | `agent_executions`, `execution_steps`, `execution_approvals`, `execution_artifacts`                                                             |
| Operação       | `notifications`, `audit_logs` ⚙, `usage_records`, `usage_quotas`, `rate_limit_counters` ⚙, `referrals`                                          |
| Configuração ⚙ | `feature_flags`, `system_settings`                                                                                                              |

## Políticas

- **Propriedade/escopo de agentes:** CHECK garante `público ⇔ workspace_id IS NULL`; agente privado pertence a exatamente um workspace.
- **Integridade:** chaves estrangeiras e CHECKs de enum no próprio SQL; índices nas colunas de junção e de consulta por tenant.
- **Segredos:** nenhuma coluna guarda senha em claro, token de sessão em claro ou chave de API. Tokens de sessão: apenas SHA-256.
- **Auditoria:** `audit_logs` registra `auth.signup`, `auth.login`, `auth.login_failed`, `auth.logout`. Metadados com chaves de aspecto secreto (`password`, `token`, `secret`, `key`…) lançam erro. Bloqueios (rate limit/anti-bot) **não** são auditados: seria uma escrita sob ataque.
- **Artefatos:** `execution_artifacts` guardará texto no D1 com teto de tamanho (R2 desabilitado; ver `free-tier-limits.md`).
- **Cobrança:** `feature_flags.monetization_enabled = 0`; não há tabela de pagamento.

## Marketplace (Fase 2)

- **Migrações novas:** `0002_marketplace_indexes` (índice `agent_executions(installation_id, status, finished_at)` para a checagem de qualificação de avaliações) e `0003_seed_categories` (taxonomia de categorias: configuração, não demonstração).
- **Catálogo nasce vazio:** nenhuma migração insere `agents`, `agent_versions`, `agent_reviews`, `agent_installations` ou `favorites` (teste automatizado garante). Agentes de demonstração só via `seed-demo` local, com `is_demo = 1`.
- **Instalações:** única por (`agent_id`, `workspace_id`, `user_id`); `status` alterna `active`/`uninstalled`; `installed_version_id` registra a versão vigente na instalação.
- **Avaliações:** única por (`agent_id`, `user_id`); `installation_id` aponta a instalação qualificante; `verified = 1` sempre nesta fase; `status = hidden` é reservado à moderação (Fase 6) e é preservado em edições do autor.
- **Auditoria nova:** `agent.install`, `agent.uninstall`, `agent.review`, `agent.review_delete` (metadado só com a nota). Favoritar **não** é auditado (baixo valor, custo de escrita).
- **Publicador técnico:** o seed local cria o usuário `demo-publisher` (`status = suspended`, hash inválido): não consegue autenticar. Ele existe só para satisfazer a chave estrangeira `agents.creator_user_id`.
