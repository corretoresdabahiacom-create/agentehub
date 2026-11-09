import type { WorkspaceRole } from '@agenthub/shared';

/** Bindings e variáveis do Worker. Segredos são opcionais no tipo: a ausência é tratada em runtime. */
export interface Bindings {
  DB: D1Database;
  /** 'production' | 'development' | 'test'. */
  ENVIRONMENT: string;
  /** 'enforce' | 'disabled_dev'. 'disabled_dev' só vale com ENVIRONMENT=development. */
  TURNSTILE_MODE: string;
  /** Chave pública do widget. Pode ser exposta ao frontend. */
  TURNSTILE_SITE_KEY: string;
  /** SEGREDO (wrangler secret / .dev.vars). */
  TURNSTILE_SECRET_KEY?: string;
  /** SEGREDO (wrangler secret / .dev.vars). Obrigatório para cadastro/login. */
  PASSWORD_PEPPER?: string;
  /** Origens extras permitidas para requisições com efeito colateral, separadas por vírgula. */
  APP_ORIGINS: string;
  SIGNUP_OPEN: string;
  GLOBAL_SIGNUPS_PER_DAY: string;
  GLOBAL_LOGINS_PER_DAY: string;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  locale: 'en' | 'pt' | 'es';
  platformRole: 'user' | 'admin';
}

export interface AuthContext {
  user: AuthUser;
  sessionId: string;
}

export interface WorkspaceContext {
  id: string;
  name: string;
  organizationId: string;
  organizationName: string;
  role: WorkspaceRole;
}

export interface Variables {
  auth: AuthContext | null;
  workspace: WorkspaceContext;
}

export type AppEnv = { Bindings: Bindings; Variables: Variables };
