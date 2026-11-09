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
