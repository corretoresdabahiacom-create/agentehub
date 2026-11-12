import { and, eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { roleAtLeast, type WorkspaceRole } from '@agenthub/shared';
import { getDb } from '../db/client';
import { organizations, workspaceMembers, workspaces } from '../db/schema';
import type { AppEnv } from '../env';
import { HttpError } from '../lib/http';

/** Exige sessão válida. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.var.auth) throw new HttpError(401, 'unauthenticated', 'Authentication required');
  return next();
};

/** Exige papel global de administrador da plataforma (painel admin, Fase 6). */
export const requirePlatformAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = c.var.auth;
  if (!auth) throw new HttpError(401, 'unauthenticated', 'Authentication required');
  if (auth.user.platformRole !== 'admin') throw new HttpError(403, 'forbidden', 'Forbidden');
  return next();
};

/**
 * Resolve user -> workspace_members -> workspace -> organization e popula c.var.workspace.
 * Quem não é membro recebe 404 (e não 403): não revelamos a existência de workspaces alheios.
 * A consulta SEMPRE parte do usuário da sessão, nunca de um id vindo do cliente sozinho.
 */
export function resolveWorkspace(param = 'workspaceId'): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.var.auth;
    if (!auth) throw new HttpError(401, 'unauthenticated', 'Authentication required');

    const workspaceId = c.req.param(param);
    if (!workspaceId) throw new HttpError(404, 'not_found');

    const db = getDb(c.env.DB);
    const [row] = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        organizationId: organizations.id,
        organizationName: organizations.name,
        organizationKind: organizations.kind,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .innerJoin(organizations, eq(organizations.id, workspaces.organizationId))
      .where(
        and(
          eq(workspaceMembers.userId, auth.user.id),
          eq(workspaceMembers.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    if (!row) throw new HttpError(404, 'not_found');
    c.set('workspace', row);
    return next();
  };
}

/** Exige papel mínimo no workspace resolvido por `resolveWorkspace`. */
export function requireRole(minimum: WorkspaceRole): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const ws = c.var.workspace;
    if (!ws)
      throw new HttpError(500, 'internal_error', 'resolveWorkspace must run before requireRole');
    if (!roleAtLeast(ws.role, minimum)) throw new HttpError(403, 'forbidden', 'Insufficient role');
    return next();
  };
}

/** Recursos de equipe (convites, membros, histórico) só existem em organização de empresa. */
export const requireCompany: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.var.workspace?.organizationKind !== 'company') {
    throw new HttpError(422, 'personal_workspace', 'Not available for personal workspaces');
  }
  return next();
};
