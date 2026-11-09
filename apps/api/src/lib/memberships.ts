import type { MeResponse } from '@agenthub/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { organizations, workspaceMembers, workspaces } from '../db/schema';

/** Workspaces (e papel) de um usuário. A consulta parte sempre de workspace_members.user_id. */
export async function loadMemberships(db: Db, userId: string): Promise<MeResponse['memberships']> {
  return db
    .select({
      organizationId: organizations.id,
      organizationName: organizations.name,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .innerJoin(organizations, eq(organizations.id, workspaces.organizationId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(workspaces.createdAt);
}
