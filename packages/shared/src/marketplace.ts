import { z } from 'zod';
import type { AgentLimits } from './engine/limits';

export const CATALOG_SORTS = ['newest', 'name', 'rating', 'popular'] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];
export const CATALOG_SCOPES = ['all', 'favorites', 'installed'] as const;
export type CatalogScope = (typeof CATALOG_SCOPES)[number];

export const CATALOG_MAX_PAGE_SIZE = 24;
export const SEARCH_MAX = 80;
export const REVIEW_BODY_MAX = 2000;
/** Janela em que uma execução concluída qualifica o usuário a avaliar (§6, Fase 2). */
export const REVIEW_QUALIFYING_DAYS = 90;

/** Parâmetros de GET /api/agents. Valores inválidos viram erro 400 (nunca são "corrigidos" em silêncio). */
export const catalogQuerySchema = z.object({
  q: z.string().trim().max(SEARCH_MAX).optional(),
  category: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{1,40}$/)
    .optional(),
  sort: z.enum(CATALOG_SORTS).default('newest'),
  scope: z.enum(CATALOG_SCOPES).default('all'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(CATALOG_MAX_PAGE_SIZE).default(12),
});
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

export const installSchema = z.object({ workspaceId: z.string().min(1).max(64) });
export type InstallInput = z.infer<typeof installSchema>;

export const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  body: z
    .string()
    .trim()
    .max(REVIEW_BODY_MAX)
    .optional()
    .transform((v) => (v ? v : undefined)),
});
/** Entrada do cliente (corpo opcional). A saída validada do servidor normaliza `body` vazio. */
export type ReviewInput = z.input<typeof reviewSchema>;

export interface CategoryInfo {
  slug: string;
  nameEn: string;
  namePt: string;
  nameEs: string | null;
}

export interface CategoryWithCount extends CategoryInfo {
  /** Agentes publicados e públicos nesta categoria (valor real do banco). */
  agentCount: number;
}

export interface AgentSummary {
  slug: string;
  name: string;
  description: string;
  /** true = conteúdo de demonstração: a UI SEMPRE marca como "demo". */
  isDemo: boolean;
  categories: CategoryInfo[];
  /** null quando não há avaliações (nunca 0 inventado). */
  ratingAvg: number | null;
  ratingCount: number;
  installCount: number;
  createdAt: number;
  /** Só presentes com sessão. */
  favorited?: boolean;
  installedWorkspaceIds?: string[];
}

export interface CatalogResponse {
  agents: AgentSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export type ReviewIneligibleReason = 'not_installed' | 'no_recent_completed_execution';

export interface AgentDetail extends AgentSummary {
  objective: string;
  outputFormat: string;
  tools: string[];
  /** Limites reais do agente (a UI limita a entrada com eles). */
  limits: AgentLimits;
  /** A execução termina em aprovação humana (ferramenta sensível ou exigência do agente). */
  requiresApproval: boolean;
  /** Algum passo exige IA (hoje nenhuma IA está configurada). */
  requiresAi: boolean;
  version: number;
  /** Só com sessão. */
  viewer?: {
    canReview: boolean;
    reviewIneligibleReason: ReviewIneligibleReason | null;
    myReview: { rating: number; body: string | null; verified: boolean } | null;
  };
}

export interface ReviewItem {
  id: string;
  rating: number;
  body: string | null;
  /** Selo "verificada": o autor tinha instalação e execução concluída nos últimos 90 dias. */
  verified: boolean;
  createdAt: number;
  /** O autor nunca é identificado (privacidade). `mine` indica que é do próprio visitante. */
  mine: boolean;
}

export interface ReviewsResponse {
  reviews: ReviewItem[];
  ratingAvg: number | null;
  ratingCount: number;
  page: number;
  pageSize: number;
}
