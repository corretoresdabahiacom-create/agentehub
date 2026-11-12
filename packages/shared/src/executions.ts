import { z } from 'zod';
import type { AgentLimits } from './engine/limits';
import { OUTPUT_FORMATS } from './engine/pipeline';
import { executionInputSchema, TOOL_META, type ExecutionInput } from './engine/tools';
import type { Issue } from './engine/validate';
import type { PLATFORM_LIMITS } from './engine/limits';

// ------------------------------------------------------------------ construtor

export const toolRefSchema = z.strictObject({
  key: z.string().trim().min(1).max(64),
  config: z.record(z.string(), z.unknown()).default({}),
});

/** Rascunho do construtor. Limites aceitam objeto parcial: a validação aponta o que falta. */
export const agentBodySchema = z.strictObject({
  workspaceId: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(''),
  objective: z.string().trim().max(500).default(''),
  instructions: z.string().trim().max(4000).default(''),
  outputFormat: z.enum(OUTPUT_FORMATS).default('markdown'),
  tools: z.array(toolRefSchema).max(20).default([]),
  limits: z.record(z.string(), z.unknown()).default({}),
});
export type AgentBody = z.input<typeof agentBodySchema>;

export const publishSchema = z.strictObject({
  visibility: z.enum(['private', 'workspace', 'public']).default('private'),
  /** Publicar no marketplace é uma ação visível a terceiros: exige confirmação explícita (R6). */
  confirmPublic: z.boolean().optional(),
});
export type PublishInput = z.input<typeof publishSchema>;

export const testRunSchema = z.strictObject({ input: executionInputSchema });

export interface ToolsResponse {
  tools: typeof TOOL_META;
  limits: typeof PLATFORM_LIMITS;
  defaults: AgentLimits;
  ai: { status: 'configured' | 'not_configured' };
}

export interface MyAgentSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  visibility: 'private' | 'workspace' | 'public';
  status: 'draft' | 'published' | 'suspended' | 'archived';
  workspaceId: string | null;
  /** Número da versão mais recente (rascunho em edição ou publicada). */
  version: number;
  versionStatus: 'draft' | 'published' | 'deprecated';
  hasPublishedVersion: boolean;
  updatedAt: number;
}

export interface MyAgentDetail extends MyAgentSummary {
  objective: string;
  instructions: string;
  outputFormat: (typeof OUTPUT_FORMATS)[number];
  tools: Array<{ key: string; config: Record<string, unknown> }>;
  limits: Record<string, unknown>;
}

export interface ValidateResponse {
  issues: Issue[];
  ok: boolean;
}

export interface TestRunResponse {
  status: 'completed' | 'awaiting_approval' | 'failed';
  steps: Array<{ seq: number; name: string; status: string; error: string | null }>;
  output: { content: string; mimeType: string } | null;
  error: string | null;
  /** Teste não grava execução, não consome cota diária e nunca pede aprovação de verdade. */
  persisted: false;
}

// ------------------------------------------------------------------- execuções

export const createExecutionSchema = z.strictObject({
  agentSlug: z.string().trim().min(1).max(120),
  workspaceId: z.string().min(1).max(64),
  input: executionInputSchema,
});
export type CreateExecutionInput = z.input<typeof createExecutionSchema>;

export const approveSchema = z.strictObject({
  /** Obrigatório na conta individual (segundo passo explícito do próprio usuário). */
  confirm: z.boolean().optional(),
});
export const rejectSchema = z.strictObject({ reason: z.string().trim().max(500).optional() });

export const EXECUTION_STATUSES = [
  'pending',
  'running',
  'awaiting_approval',
  'completed',
  'failed',
  'canceled',
] as const;
export type ExecutionStatusName = (typeof EXECUTION_STATUSES)[number];

export const executionListQuerySchema = z.object({
  workspaceId: z.string().min(1).max(64).optional(),
  status: z.enum(EXECUTION_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

export interface ExecutionSummary {
  id: string;
  agentSlug: string | null;
  agentName: string;
  workspaceId: string;
  status: ExecutionStatusName;
  createdAt: number;
  finishedAt: number | null;
}

export interface ApprovalView {
  id: string;
  decision: 'pending' | 'approved' | 'rejected';
  method: 'workspace_admin' | 'self_second_step';
  reason: string | null;
  createdAt: number;
  decidedAt: number | null;
  expiresAt: number;
  /** O usuário atual pode decidir esta aprovação? */
  canDecide: boolean;
}

export interface ExecutionDetail extends ExecutionSummary {
  input: ExecutionInput;
  /** Prévia do resultado: só existe depois de concluir ou enquanto aguarda aprovação. */
  output: { content: string; mimeType: string } | null;
  error: string | null;
  attempts: number;
  maxAttempts: number;
  steps: Array<{
    seq: number;
    name: string;
    status: string;
    error: string | null;
    preview: string | null;
  }>;
  approval: ApprovalView | null;
  artifacts: Array<{ id: string; name: string; mimeType: string; sizeBytes: number }>;
  mine: boolean;
}

export interface ExecutionListResponse {
  executions: ExecutionSummary[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PendingApprovalItem {
  executionId: string;
  agentName: string;
  workspaceId: string;
  workspaceName: string;
  method: 'workspace_admin' | 'self_second_step';
  createdAt: number;
  expiresAt: number;
}
