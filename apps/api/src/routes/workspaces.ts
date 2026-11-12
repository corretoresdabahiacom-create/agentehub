import { Hono } from 'hono';
import { getDb } from '../db/client';
import type { AppEnv } from '../env';
import { loadMemberships } from '../lib/memberships';
import { requireAuth, resolveWorkspace } from '../middleware/authz';

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
