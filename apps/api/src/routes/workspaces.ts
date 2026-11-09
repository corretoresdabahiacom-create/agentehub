import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../db/client';
import { userProfiles, users, workspaceMembers } from '../db/schema';
import type { AppEnv } from '../env';
import { loadMemberships } from '../lib/memberships';
import { requireAuth, requireRole, resolveWorkspace } from '../middleware/authz';

export const workspacesRoutes = new Hono<AppEnv>();

workspacesRoutes.use('*', requireAuth);

/** Workspaces do usuário autenticado. */
workspacesRoutes.get('/', async (c) => {
  const auth = c.var.auth;
  if (!auth) throw new Error('unreachable');
  const memberships = await loadMemberships(getDb(c.env.DB), auth.user.id);
  return c.json({ workspaces: memberships });
});

/** Detalhe de um workspace: qualquer membro. Não-membro recebe 404. */
workspacesRoutes.get('/:workspaceId', resolveWorkspace(), (c) => {
  return c.json({ workspace: c.var.workspace });
});

/** Membros de um workspace: somente owner/admin. */
workspacesRoutes.get(
  '/:workspaceId/members',
  resolveWorkspace(),
  requireRole('admin'),
  async (c) => {
    const db = getDb(c.env.DB);
    const rows = await db
      .select({
        userId: users.id,
        email: users.email,
        displayName: userProfiles.displayName,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .where(eq(workspaceMembers.workspaceId, c.var.workspace.id));
    return c.json({ members: rows });
  },
);
