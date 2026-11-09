/**
 * Schema D1 (SQLite) do AI AgentHub. Fonte da verdade para as migrações em ../../migrations.
 * Convenções (ver docs/data-model.md):
 *  - ids: texto (UUID v4 gerado na aplicação)
 *  - datas: inteiro, milissegundos desde a época (UTC)
 *  - estados: coluna com CHECK explícito
 *  - updated_at é mantido pela aplicação (sem triggers)
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const now = sql`(unixepoch() * 1000)`;
const createdAt = () => integer('created_at').notNull().default(now);
const updatedAt = () => integer('updated_at').notNull().default(now);

/** Gera `col IN ('a','b')` para CHECK. Os valores vêm de constantes do código, nunca de usuário. */
const oneOf = (column: string, values: readonly string[]) =>
  sql.raw(`${column} IN (${values.map((v) => `'${v}'`).join(', ')})`);

export const PLATFORM_ROLE = ['user', 'admin'] as const;
export const USER_STATUS = ['active', 'suspended', 'deleted'] as const;
export const MEMBER_ROLE = ['owner', 'admin', 'member'] as const;
export const ORG_KIND = ['personal', 'company'] as const;
export const VISIBILITY = ['private', 'workspace', 'public'] as const;
export const AGENT_STATUS = ['draft', 'published', 'suspended', 'archived'] as const;
export const VERSION_STATUS = ['draft', 'published', 'deprecated'] as const;
export const INSTALL_STATUS = ['active', 'uninstalled'] as const;
export const REVIEW_STATUS = ['visible', 'hidden'] as const;
export const EXECUTION_STATUS = [
  'pending',
  'running',
  'awaiting_approval',
  'completed',
  'failed',
  'canceled',
] as const;
export const STEP_STATUS = ['pending', 'running', 'completed', 'failed', 'skipped'] as const;
export const APPROVAL_DECISION = ['pending', 'approved', 'rejected'] as const;
export const APPROVAL_METHOD = ['workspace_admin', 'self_second_step'] as const;
export const REFERRAL_STATUS = ['pending', 'converted', 'void'] as const;
export const QUOTA_SCOPE = ['global', 'workspace', 'member'] as const;
export const QUOTA_PERIOD = ['day', 'month'] as const;

// ---------------------------------------------------------------- identidade

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    /** Sempre minúsculo (normalizado na aplicação). */
    email: text('email').notNull(),
    /** `pbkdf2-sha256$<iterações>$<salt b64>$<hash b64>`. Nunca exposto pela API. */
    passwordHash: text('password_hash').notNull(),
    platformRole: text('platform_role', { enum: PLATFORM_ROLE }).notNull().default('user'),
    status: text('status', { enum: USER_STATUS }).notNull().default('active'),
    /** Verificação de e-mail não existe nesta fase (sem serviço de e-mail gratuito confirmado). */
    emailVerifiedAt: integer('email_verified_at'),
    lastLoginAt: integer('last_login_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(t.email),
    check('users_email_lower_ck', sql`${t.email} = lower(${t.email})`),
    check('users_platform_role_ck', oneOf('platform_role', PLATFORM_ROLE)),
    check('users_status_ck', oneOf('status', USER_STATUS)),
  ],
);

export const userProfiles = sqliteTable(
  'user_profiles',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    displayName: text('display_name'),
    locale: text('locale').notNull().default('en'),
    bio: text('bio'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [check('user_profiles_locale_ck', oneOf('locale', ['en', 'pt', 'es']))],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 (hex) do token do cookie. O token em si nunca é armazenado. */
    tokenHash: text('token_hash').notNull(),
    /** Token anterior, válido por uma janela curta após a rotação (requisições concorrentes). */
    prevTokenHash: text('prev_token_hash'),
    prevValidUntil: integer('prev_valid_until'),
    createdAt: createdAt(),
    rotatedAt: integer('rotated_at').notNull().default(now),
    lastSeenAt: integer('last_seen_at').notNull().default(now),
    expiresAt: integer('expires_at').notNull(),
    revokedAt: integer('revoked_at'),
    /** HMAC do IP (não o IP em claro). */
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_uq').on(t.tokenHash),
    index('sessions_prev_token_hash_idx').on(t.prevTokenHash),
    index('sessions_user_idx').on(t.userId),
    index('sessions_expires_idx').on(t.expiresAt),
  ],
);

// ---------------------------------------------------------------- organizações

export const organizations = sqliteTable(
  'organizations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    kind: text('kind', { enum: ORG_KIND }).notNull().default('company'),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('organizations_slug_uq').on(t.slug),
    index('organizations_owner_idx').on(t.ownerUserId),
    check('organizations_kind_ck', oneOf('kind', ORG_KIND)),
  ],
);

export const organizationMembers = sqliteTable(
  'organization_members',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: MEMBER_ROLE }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.userId] }),
    index('organization_members_user_idx').on(t.userId),
    check('organization_members_role_ck', oneOf('role', MEMBER_ROLE)),
  ],
);

export const workspaces = sqliteTable(
  'workspaces',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('workspaces_org_slug_uq').on(t.organizationId, t.slug)],
);

export const workspaceMembers = sqliteTable(
  'workspace_members',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: MEMBER_ROLE }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index('workspace_members_user_idx').on(t.userId),
    check('workspace_members_role_ck', oneOf('role', MEMBER_ROLE)),
  ],
);

/** Convite por LINK (sem e-mail). Só o hash do token é guardado. */
export const organizationInvites = sqliteTable(
  'organization_invites',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    role: text('role', { enum: MEMBER_ROLE }).notNull().default('member'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    expiresAt: integer('expires_at').notNull(),
    maxUses: integer('max_uses').notNull().default(1),
    useCount: integer('use_count').notNull().default(0),
    revokedAt: integer('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('organization_invites_token_uq').on(t.tokenHash),
    index('organization_invites_org_idx').on(t.organizationId),
    check('organization_invites_role_ck', oneOf('role', MEMBER_ROLE)),
    check('organization_invites_uses_ck', sql`${t.useCount} <= ${t.maxUses}`),
  ],
);

// ---------------------------------------------------------------- catálogo

export const categories = sqliteTable(
  'categories',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    nameEn: text('name_en').notNull(),
    namePt: text('name_pt').notNull(),
    nameEs: text('name_es'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('categories_slug_uq').on(t.slug)],
);

export const agents = sqliteTable(
  'agents',
  {
    id: text('id').primaryKey(),
    /** Nulo se público (agente público pertence ao criador). */
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    creatorUserId: text('creator_user_id')
      .notNull()
      .references(() => users.id),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    visibility: text('visibility', { enum: VISIBILITY }).notNull().default('private'),
    status: text('status', { enum: AGENT_STATUS }).notNull().default('draft'),
    /** Versão publicada vigente. Sem FK para evitar ciclo agents <-> agent_versions. */
    currentVersionId: text('current_version_id'),
    /** 1 = conteúdo de demonstração (a UI deve marcar como "demo"). */
    isDemo: integer('is_demo').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('agents_slug_uq').on(t.slug),
    index('agents_workspace_idx').on(t.workspaceId),
    index('agents_creator_idx').on(t.creatorUserId),
    index('agents_catalog_idx').on(t.visibility, t.status),
    check('agents_visibility_ck', oneOf('visibility', VISIBILITY)),
    check('agents_status_ck', oneOf('status', AGENT_STATUS)),
    check(
      'agents_scope_ck',
      sql`(${t.visibility} = 'public' AND ${t.workspaceId} IS NULL) OR (${t.visibility} <> 'public' AND ${t.workspaceId} IS NOT NULL)`,
    ),
    check('agents_demo_ck', sql`${t.isDemo} IN (0, 1)`),
  ],
);

export const agentVersions = sqliteTable(
  'agent_versions',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    objective: text('objective').notNull().default(''),
    instructions: text('instructions').notNull().default(''),
    outputFormat: text('output_format').notNull().default('text'),
    /** JSON: limites de tempo, entrada, passos, tentativas. */
    limitsJson: text('limits_json').notNull().default('{}'),
    changelog: text('changelog'),
    status: text('status', { enum: VERSION_STATUS }).notNull().default('draft'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('agent_versions_agent_version_uq').on(t.agentId, t.version),
    check('agent_versions_status_ck', oneOf('status', VERSION_STATUS)),
  ],
);

export const agentTools = sqliteTable(
  'agent_tools',
  {
    id: text('id').primaryKey(),
    agentVersionId: text('agent_version_id')
      .notNull()
      .references(() => agentVersions.id, { onDelete: 'cascade' }),
    /** Chave da whitelist de ferramentas autorizadas. */
    toolKey: text('tool_key').notNull(),
    configJson: text('config_json').notNull().default('{}'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('agent_tools_version_tool_uq').on(t.agentVersionId, t.toolKey)],
);

export const agentTests = sqliteTable(
  'agent_tests',
  {
    id: text('id').primaryKey(),
    agentVersionId: text('agent_version_id')
      .notNull()
      .references(() => agentVersions.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    inputJson: text('input_json').notNull().default('{}'),
    expectedJson: text('expected_json'),
    lastResult: text('last_result'),
    lastRunAt: integer('last_run_at'),
    createdAt: createdAt(),
  },
  (t) => [index('agent_tests_version_idx').on(t.agentVersionId)],
);

export const agentCategories = sqliteTable(
  'agent_categories',
  {
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.categoryId] }),
    index('agent_categories_category_idx').on(t.categoryId),
  ],
);

export const agentInstallations = sqliteTable(
  'agent_installations',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    installedVersionId: text('installed_version_id').references(() => agentVersions.id),
    status: text('status', { enum: INSTALL_STATUS }).notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('agent_installations_uq').on(t.agentId, t.workspaceId, t.userId),
    index('agent_installations_user_idx').on(t.userId),
    index('agent_installations_workspace_idx').on(t.workspaceId),
    check('agent_installations_status_ck', oneOf('status', INSTALL_STATUS)),
  ],
);

export const agentReviews = sqliteTable(
  'agent_reviews',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    installationId: text('installation_id')
      .notNull()
      .references(() => agentInstallations.id),
    rating: integer('rating').notNull(),
    body: text('body'),
    /** Avaliação "verificada": exige execução concluída nos últimos 90 dias (Fase 2). */
    verified: integer('verified').notNull().default(0),
    status: text('status', { enum: REVIEW_STATUS }).notNull().default('visible'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('agent_reviews_agent_user_uq').on(t.agentId, t.userId),
    index('agent_reviews_agent_idx').on(t.agentId),
    check('agent_reviews_rating_ck', sql`${t.rating} BETWEEN 1 AND 5`),
    check('agent_reviews_verified_ck', sql`${t.verified} IN (0, 1)`),
    check('agent_reviews_status_ck', oneOf('status', REVIEW_STATUS)),
  ],
);

export const favorites = sqliteTable(
  'favorites',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.agentId] }),
    index('favorites_agent_idx').on(t.agentId),
  ],
);

// ---------------------------------------------------------------- execução

export const agentExecutions = sqliteTable(
  'agent_executions',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    agentVersionId: text('agent_version_id')
      .notNull()
      .references(() => agentVersions.id),
    installationId: text('installation_id').references(() => agentInstallations.id),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    status: text('status', { enum: EXECUTION_STATUS }).notNull().default('pending'),
    inputJson: text('input_json').notNull().default('{}'),
    outputJson: text('output_json'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    /** 1 se algum passo exige IA (recusa se IA não estiver configurada). */
    requiresAi: integer('requires_ai').notNull().default(0),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('agent_executions_workspace_idx').on(t.workspaceId, t.createdAt),
    index('agent_executions_user_idx').on(t.userId, t.createdAt),
    index('agent_executions_agent_idx').on(t.agentId),
    index('agent_executions_status_idx').on(t.status),
    check('agent_executions_status_ck', oneOf('status', EXECUTION_STATUS)),
    check('agent_executions_requires_ai_ck', sql`${t.requiresAi} IN (0, 1)`),
  ],
);

export const executionSteps = sqliteTable(
  'execution_steps',
  {
    id: text('id').primaryKey(),
    executionId: text('execution_id')
      .notNull()
      .references(() => agentExecutions.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    name: text('name').notNull(),
    status: text('status', { enum: STEP_STATUS }).notNull().default('pending'),
    inputJson: text('input_json'),
    outputJson: text('output_json'),
    error: text('error'),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('execution_steps_exec_seq_uq').on(t.executionId, t.seq),
    check('execution_steps_status_ck', oneOf('status', STEP_STATUS)),
  ],
);

export const executionApprovals = sqliteTable(
  'execution_approvals',
  {
    id: text('id').primaryKey(),
    executionId: text('execution_id')
      .notNull()
      .references(() => agentExecutions.id, { onDelete: 'cascade' }),
    requestedBy: text('requested_by')
      .notNull()
      .references(() => users.id),
    approverUserId: text('approver_user_id').references(() => users.id),
    decision: text('decision', { enum: APPROVAL_DECISION }).notNull().default('pending'),
    method: text('method', { enum: APPROVAL_METHOD }).notNull(),
    reason: text('reason'),
    decidedAt: integer('decided_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('execution_approvals_exec_idx').on(t.executionId),
    index('execution_approvals_approver_idx').on(t.approverUserId),
    check('execution_approvals_decision_ck', oneOf('decision', APPROVAL_DECISION)),
    check('execution_approvals_method_ck', oneOf('method', APPROVAL_METHOD)),
  ],
);

/** Artefatos como TEXTO no D1 (sem R2: ver docs/free-tier-limits.md). Tamanho limitado pela app. */
export const executionArtifacts = sqliteTable(
  'execution_artifacts',
  {
    id: text('id').primaryKey(),
    executionId: text('execution_id')
      .notNull()
      .references(() => agentExecutions.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    mimeType: text('mime_type').notNull().default('text/plain'),
    contentText: text('content_text').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('execution_artifacts_exec_idx').on(t.executionId)],
);

// ---------------------------------------------------------------- operação

export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    dataJson: text('data_json'),
    readAt: integer('read_at'),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.readAt, t.createdAt)],
);

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    /** JSON sem segredos, senhas, tokens ou conteúdo privado. */
    metadataJson: text('metadata_json'),
    ipHash: text('ip_hash'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_action_idx').on(t.action, t.createdAt),
    index('audit_logs_actor_idx').on(t.actorUserId, t.createdAt),
    index('audit_logs_workspace_idx').on(t.workspaceId, t.createdAt),
  ],
);

export const usageRecords = sqliteTable(
  'usage_records',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    metric: text('metric').notNull(),
    quantity: integer('quantity').notNull().default(1),
    /** Dia UTC (YYYY-MM-DD) para agregação barata. */
    day: text('day').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('usage_records_workspace_idx').on(t.workspaceId, t.metric, t.day),
    index('usage_records_user_idx').on(t.userId, t.metric, t.day),
  ],
);

export const usageQuotas = sqliteTable(
  'usage_quotas',
  {
    id: text('id').primaryKey(),
    scope: text('scope', { enum: QUOTA_SCOPE }).notNull(),
    /** workspace_id ou user_id conforme o escopo; vazio para 'global'. */
    scopeId: text('scope_id').notNull().default(''),
    metric: text('metric').notNull(),
    limitValue: integer('limit_value').notNull(),
    period: text('period', { enum: QUOTA_PERIOD }).notNull().default('day'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('usage_quotas_uq').on(t.scope, t.scopeId, t.metric, t.period),
    check('usage_quotas_scope_ck', oneOf('scope', QUOTA_SCOPE)),
    check('usage_quotas_period_ck', oneOf('period', QUOTA_PERIOD)),
    check('usage_quotas_limit_ck', sql`${t.limitValue} >= 0`),
  ],
);

/** Contadores de janela fixa. Substitui KV (1.000 escritas/dia no free tier). */
export const rateLimitCounters = sqliteTable(
  'rate_limit_counters',
  {
    key: text('key').notNull(),
    windowStart: integer('window_start').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.windowStart] }),
    index('rate_limit_counters_window_idx').on(t.windowStart),
  ],
);

export const referrals = sqliteTable(
  'referrals',
  {
    id: text('id').primaryKey(),
    referrerUserId: text('referrer_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    referredUserId: text('referred_user_id').references(() => users.id, { onDelete: 'set null' }),
    status: text('status', { enum: REFERRAL_STATUS }).notNull().default('pending'),
    convertedAt: integer('converted_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('referrals_code_uq').on(t.code),
    index('referrals_referrer_idx').on(t.referrerUserId),
    check('referrals_status_ck', oneOf('status', REFERRAL_STATUS)),
  ],
);

export const featureFlags = sqliteTable(
  'feature_flags',
  {
    key: text('key').primaryKey(),
    enabled: integer('enabled').notNull().default(0),
    description: text('description'),
    updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: updatedAt(),
  },
  (t) => [check('feature_flags_enabled_ck', sql`${t.enabled} IN (0, 1)`)],
);

export const systemSettings = sqliteTable('system_settings', {
  key: text('key').primaryKey(),
  /** JSON. Marca, nome, cores e textos institucionais (editáveis no painel admin, Fase 6). */
  valueJson: text('value_json').notNull(),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
});
