import { z } from 'zod';
import { PLATFORM_LIMITS } from './engine/limits';
import type { AgentLimits } from './engine/limits';
import type { ExecutionStatusName } from './executions';

export const TEAM_LIMITS = {
  companiesPerUser: 3,
  workspacesPerOrganization: 5,
  membersPerWorkspace: 50,
  activeInvitesPerWorkspace: 20,
  inviteMaxHours: 168,
  inviteMaxUses: 50,
} as const;

const nameSchema = z.string().trim().min(2).max(60);
export const createOrganizationSchema = z.strictObject({ name: nameSchema });
export const createWorkspaceSchema = z.strictObject({ name: nameSchema });

export const createInviteSchema = z.strictObject({
  /** `owner` nunca é convidável; `admin` só por um owner. */
  role: z.enum(['admin', 'member']).default('member'),
  expiresInHours: z.number().int().min(1).max(TEAM_LIMITS.inviteMaxHours).default(72),
  maxUses: z.number().int().min(1).max(TEAM_LIMITS.inviteMaxUses).default(1),
});
export type CreateInviteInput = z.input<typeof createInviteSchema>;

export const changeRoleSchema = z.strictObject({ role: z.enum(['admin', 'member']) });
export const memberQuotaSchema = z.strictObject({
  /** `null` remove a cota individual (vale só o teto do workspace). */
  executionsPerDay: z.number().int().min(0).max(PLATFORM_LIMITS.executionsPerUserPerDay).nullable(),
});
export const workspaceHistoryQuerySchema = z.object({
  userId: z.string().min(1).max(64).optional(),
  status: z
    .enum(['pending', 'running', 'awaiting_approval', 'completed', 'failed', 'canceled'])
    .optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

export interface MemberView {
  userId: string;
  email: string;
  displayName: string | null;
  role: 'owner' | 'admin' | 'member';
  /** Cota individual por dia (`null`: sem cota individual). */
  quotaPerDay: number | null;
  usedToday: number;
  isYou: boolean;
}
export interface InviteView {
  id: string;
  role: 'admin' | 'member';
  expiresAt: number;
  maxUses: number;
  useCount: number;
  revokedAt: number | null;
  createdAt: number;
  /** ativo = não revogado, não expirado e com usos restantes. */
  active: boolean;
}
export interface InviteCreated extends InviteView {
  /** Caminho do link (`/invite/<token>`). O token só é mostrado AQUI, uma vez. */
  path: string;
}
export interface InvitePreview {
  organizationName: string;
  workspaceName: string;
  role: 'admin' | 'member';
  expiresAt: number;
  alreadyMember: boolean;
}
export interface InviteAccepted {
  workspaceId: string;
  alreadyMember: boolean;
}
export interface LibraryItem {
  slug: string;
  name: string;
  description: string;
  /** `workspace`: criado para o workspace. `shared_install`: do marketplace, instalado por owner/admin. */
  source: 'workspace' | 'shared_install';
  toolKeys: string[];
  limits: AgentLimits;
  requiresApproval: boolean;
  requiresAi: boolean;
}
export interface WorkspaceExecutionItem {
  id: string;
  agentName: string;
  status: ExecutionStatusName;
  userId: string;
  userEmail: string;
  createdAt: number;
  finishedAt: number | null;
}
export interface WorkspaceUsage {
  day: string;
  workspaceUsedToday: number;
  workspaceLimitPerDay: number;
  members: Array<{ userId: string; email: string; usedToday: number; quotaPerDay: number | null }>;
}
