import {
  agentLimitsSchema,
  changeRoleSchema,
  createInviteSchema,
  createOrganizationSchema,
  createWorkspaceSchema,
  DEFAULT_LIMITS,
  getTool,
  memberQuotaSchema,
  PLATFORM_LIMITS,
  requiresApproval,
  TEAM_LIMITS,
  workspaceHistoryQuerySchema,
  type ExecutionStatusName,
  type InviteAccepted,
  type InviteCreated,
  type InvitePreview,
  type InviteView,
  type LibraryItem,
  type MemberView,
  type WorkspaceExecutionItem,
  type WorkspaceUsage,
} from '@agenthub/shared';
import { Hono } from 'hono';
import { getDb } from '../db/client';
import type { AppEnv } from '../env';
import { audit } from '../lib/audit';
import { randomToken, sha256Hex } from '../lib/crypto';
import { loadRunnableVersion } from '../lib/executions';
import { HttpError, parseJson, utcDay } from '../lib/http';
import { loadMemberships } from '../lib/memberships';
import { authOf, limitOrThrow, slugify } from '../lib/route-utils';
import { requireAuth, requireCompany, requireRole, resolveWorkspace } from '../middleware/authz';

const WRITES = { limit: 60, windowSec: 600 };
const writeLimit = (db: D1Database, userId: string) =>
  limitOrThrow(db, `team:write:${userId}`, WRITES.limit, WRITES.windowSec);

// ============================================================ organizações

export const organizationsRoutes = new Hono<AppEnv>();
organizationsRoutes.use('*', requireAuth);

/** Cria uma EMPRESA (organization + workspace "Main"); quem cria é owner de ambos. */
organizationsRoutes.post('/', async (c) => {
  const a = authOf(c);
  const { name } = await parseJson(c, createOrganizationSchema);
  const db = c.env.DB;
  await writeLimit(db, a.user.id);
  const owned = await db
    .prepare(`SELECT COUNT(*) AS n FROM organizations WHERE owner_user_id = ? AND kind = 'company'`)
    .bind(a.user.id)
    .first<{ n: number }>();
  if ((owned?.n ?? 0) >= TEAM_LIMITS.companiesPerUser) {
    throw new HttpError(409, 'company_limit', 'Company limit reached', {
      max: TEAM_LIMITS.companiesPerUser,
    });
  }
  const orgId = crypto.randomUUID();
  const wsId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO organizations (id, name, slug, kind, owner_user_id) VALUES (?1, ?2, ?3, 'company', ?4)`,
      )
      .bind(orgId, name, slugify(name), a.user.id),
    db
      .prepare(
        `INSERT INTO organization_members (organization_id, user_id, role) VALUES (?1, ?2, 'owner')`,
      )
      .bind(orgId, a.user.id),
    db
      .prepare(
        `INSERT INTO workspaces (id, organization_id, name, slug) VALUES (?1, ?2, 'Main', 'main')`,
      )
      .bind(wsId, orgId),
    db
      .prepare(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?1, ?2, 'owner')`,
      )
      .bind(wsId, a.user.id),
  ]);
  await audit(getDb(db), {
    action: 'org.create',
    actorUserId: a.user.id,
    workspaceId: wsId,
    targetType: 'organization',
    targetId: orgId,
  });
  return c.json({ memberships: await loadMemberships(getDb(db), a.user.id) }, 201);
});

/** Novo workspace numa empresa: só owner/admin da organização. Não-membro => 404. */
organizationsRoutes.post('/:orgId/workspaces', async (c) => {
  const a = authOf(c);
  const { name } = await parseJson(c, createWorkspaceSchema);
  const db = c.env.DB;
  const m = await db
    .prepare(
      `SELECT om.role, o.kind FROM organization_members om JOIN organizations o ON o.id = om.organization_id
       WHERE om.organization_id = ? AND om.user_id = ?`,
    )
    .bind(c.req.param('orgId'), a.user.id)
    .first<{ role: string; kind: string }>();
  if (!m) throw new HttpError(404, 'not_found');
  if (m.kind !== 'company')
    throw new HttpError(422, 'personal_workspace', 'Not available for personal organizations');
  if (m.role !== 'owner' && m.role !== 'admin')
    throw new HttpError(403, 'forbidden', 'Insufficient role');
  await writeLimit(db, a.user.id);
  const count = await db
    .prepare('SELECT COUNT(*) AS n FROM workspaces WHERE organization_id = ?')
    .bind(c.req.param('orgId'))
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= TEAM_LIMITS.workspacesPerOrganization) {
    throw new HttpError(409, 'workspace_limit', 'Workspace limit reached', {
      max: TEAM_LIMITS.workspacesPerOrganization,
    });
  }
  const wsId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(`INSERT INTO workspaces (id, organization_id, name, slug) VALUES (?1, ?2, ?3, ?4)`)
      .bind(wsId, c.req.param('orgId'), name, slugify(name)),
    db
      .prepare(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?1, ?2, 'owner')`,
      )
      .bind(wsId, a.user.id),
  ]);
  await audit(getDb(db), {
    action: 'workspace.create',
    actorUserId: a.user.id,
    workspaceId: wsId,
    targetType: 'workspace',
    targetId: wsId,
  });
  return c.json({ memberships: await loadMemberships(getDb(db), a.user.id) }, 201);
});

// ============================================================ convites (aceitar)

export const invitesRoutes = new Hono<AppEnv>();
invitesRoutes.use('*', requireAuth);

interface InviteRow {
  id: string;
  organization_id: string;
  workspace_id: string | null;
  role: 'owner' | 'admin' | 'member';
  expires_at: number;
  max_uses: number;
  use_count: number;
  revoked_at: number | null;
  org_name: string;
  ws_name: string;
}

async function findInvite(db: D1Database, token: string): Promise<InviteRow> {
  // Token inválido, expirado, revogado ou esgotado respondem igual (404): não vaza qual caso é.
  const row = await db
    .prepare(
      `SELECT i.id, i.organization_id, i.workspace_id, i.role, i.expires_at, i.max_uses, i.use_count, i.revoked_at,
              o.name AS org_name, w.name AS ws_name
       FROM organization_invites i
       JOIN organizations o ON o.id = i.organization_id
       JOIN workspaces w ON w.id = i.workspace_id
       WHERE i.token_hash = ?`,
    )
    .bind(await sha256Hex(token))
    .first<InviteRow>();
  if (
    !row ||
    row.revoked_at !== null ||
    row.expires_at <= Date.now() ||
    row.use_count >= row.max_uses
  ) {
    throw new HttpError(404, 'invite_invalid', 'This invite link is not valid');
  }
  return row;
}

const isMember = async (db: D1Database, workspaceId: string, userId: string) =>
  Boolean(
    await db
      .prepare('SELECT 1 AS x FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
      .bind(workspaceId, userId)
      .first(),
  );

invitesRoutes.get('/:token', async (c) => {
  const a = authOf(c);
  await limitOrThrow(c.env.DB, `invite:${a.user.id}`, 30, 600);
  const inv = await findInvite(c.env.DB, c.req.param('token'));
  const body: InvitePreview = {
    organizationName: inv.org_name,
    workspaceName: inv.ws_name,
    role: inv.role === 'admin' ? 'admin' : 'member',
    expiresAt: inv.expires_at,
    alreadyMember: inv.workspace_id ? await isMember(c.env.DB, inv.workspace_id, a.user.id) : false,
  };
  return c.json(body);
});

invitesRoutes.post('/:token/accept', async (c) => {
  const a = authOf(c);
  const db = c.env.DB;
  await limitOrThrow(db, `invite:${a.user.id}`, 30, 600);
  const inv = await findInvite(db, c.req.param('token'));
  if (!inv.workspace_id)
    throw new HttpError(404, 'invite_invalid', 'This invite link is not valid');
  if (await isMember(db, inv.workspace_id, a.user.id)) {
    const body: InviteAccepted = { workspaceId: inv.workspace_id, alreadyMember: true };
    return c.json(body);
  }
  const members = await db
    .prepare('SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = ?')
    .bind(inv.workspace_id)
    .first<{ n: number }>();
  if ((members?.n ?? 0) >= TEAM_LIMITS.membersPerWorkspace) {
    throw new HttpError(409, 'member_limit', 'This workspace is full', {
      max: TEAM_LIMITS.membersPerWorkspace,
    });
  }
  // Consumo atômico do uso: só um aceite concorrente vence o último uso disponível.
  const used = await db
    .prepare(
      `UPDATE organization_invites SET use_count = use_count + 1
       WHERE id = ?1 AND revoked_at IS NULL AND expires_at > ?2 AND use_count < max_uses`,
    )
    .bind(inv.id, Date.now())
    .run();
  if (used.meta.changes !== 1)
    throw new HttpError(404, 'invite_invalid', 'This invite link is not valid');
  try {
    await db.batch([
      db
        .prepare(
          `INSERT OR IGNORE INTO organization_members (organization_id, user_id, role) VALUES (?1, ?2, 'member')`,
        )
        .bind(inv.organization_id, a.user.id),
      db
        .prepare(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?1, ?2, ?3)`)
        .bind(inv.workspace_id, a.user.id, inv.role),
    ]);
  } catch (err) {
    // Devolve o uso consumido se a inclusão falhou.
    await db
      .prepare(
        'UPDATE organization_invites SET use_count = use_count - 1 WHERE id = ? AND use_count > 0',
      )
      .bind(inv.id)
      .run();
    throw err;
  }
  await audit(getDb(db), {
    action: 'invite.accept',
    actorUserId: a.user.id,
    workspaceId: inv.workspace_id,
    targetType: 'invite',
    targetId: inv.id,
    metadata: { role: inv.role },
  });
  const body: InviteAccepted = { workspaceId: inv.workspace_id, alreadyMember: false };
  return c.json(body, 201);
});

// ============================================================ workspace

export const teamRoutes = new Hono<AppEnv>();
teamRoutes.use('*', requireAuth);
const base = '/:workspaceId';

// ------------------------------------------------------------- convites (gerir)

const inviteView = (r: {
  id: string;
  role: string;
  expires_at: number;
  max_uses: number;
  use_count: number;
  revoked_at: number | null;
  created_at: number;
}): InviteView => ({
  id: r.id,
  role: r.role === 'admin' ? 'admin' : 'member',
  expiresAt: r.expires_at,
  maxUses: r.max_uses,
  useCount: r.use_count,
  revokedAt: r.revoked_at,
  createdAt: r.created_at,
  active: r.revoked_at === null && r.expires_at > Date.now() && r.use_count < r.max_uses,
});

teamRoutes.post(
  `${base}/invites`,
  resolveWorkspace(),
  requireCompany,
  requireRole('admin'),
  async (c) => {
    const a = authOf(c);
    const ws = c.var.workspace;
    const body = await parseJson(c, createInviteSchema);
    if (body.role === 'admin' && ws.role !== 'owner') {
      throw new HttpError(403, 'forbidden', 'Only an owner can invite admins');
    }
    const db = c.env.DB;
    await writeLimit(db, a.user.id);
    const active = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM organization_invites
       WHERE workspace_id = ?1 AND revoked_at IS NULL AND expires_at > ?2 AND use_count < max_uses`,
      )
      .bind(ws.id, Date.now())
      .first<{ n: number }>();
    if ((active?.n ?? 0) >= TEAM_LIMITS.activeInvitesPerWorkspace) {
      throw new HttpError(409, 'invite_limit', 'Too many active invites', {
        max: TEAM_LIMITS.activeInvitesPerWorkspace,
      });
    }
    const token = randomToken(32);
    const id = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + body.expiresInHours * 3_600_000;
    await db
      .prepare(
        `INSERT INTO organization_invites (id, organization_id, workspace_id, token_hash, role, created_by, expires_at, max_uses, use_count, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9)`,
      )
      .bind(
        id,
        ws.organizationId,
        ws.id,
        await sha256Hex(token),
        body.role,
        a.user.id,
        expiresAt,
        body.maxUses,
        now,
      )
      .run();
    await audit(getDb(db), {
      action: 'invite.create',
      actorUserId: a.user.id,
      workspaceId: ws.id,
      targetType: 'invite',
      targetId: id,
      metadata: { role: body.role, maxUses: body.maxUses },
    });
    const out: InviteCreated = {
      ...inviteView({
        id,
        role: body.role,
        expires_at: expiresAt,
        max_uses: body.maxUses,
        use_count: 0,
        revoked_at: null,
        created_at: now,
      }),
      path: `/invite/${token}`,
    };
    return c.json(out, 201);
  },
);

teamRoutes.get(
  `${base}/invites`,
  resolveWorkspace(),
  requireCompany,
  requireRole('admin'),
  async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT id, role, expires_at, max_uses, use_count, revoked_at, created_at FROM organization_invites
     WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
      .bind(c.var.workspace.id)
      .all<Parameters<typeof inviteView>[0]>();
    return c.json({ invites: results.map(inviteView) });
  },
);

teamRoutes.delete(
  `${base}/invites/:inviteId`,
  resolveWorkspace(),
  requireCompany,
  requireRole('admin'),
  async (c) => {
    const a = authOf(c);
    const res = await c.env.DB.prepare(
      `UPDATE organization_invites SET revoked_at = ?1 WHERE id = ?2 AND workspace_id = ?3 AND revoked_at IS NULL`,
    )
      .bind(Date.now(), c.req.param('inviteId'), c.var.workspace.id)
      .run();
    if (res.meta.changes !== 1) throw new HttpError(404, 'not_found');
    await audit(getDb(c.env.DB), {
      action: 'invite.revoke',
      actorUserId: a.user.id,
      workspaceId: c.var.workspace.id,
      targetType: 'invite',
      targetId: c.req.param('inviteId'),
    });
    return c.json({ revoked: true });
  },
);

// ------------------------------------------------------------- membros e papéis

async function usedTodayByUser(db: D1Database, workspaceId: string): Promise<Map<string, number>> {
  const { results } = await db
    .prepare(
      `SELECT user_id, SUM(quantity) AS n FROM usage_records WHERE workspace_id = ? AND metric = 'execution' AND day = ? GROUP BY user_id`,
    )
    .bind(workspaceId, utcDay())
    .all<{ user_id: string; n: number }>();
  return new Map(results.map((r) => [r.user_id, r.n]));
}
const quotaKey = (workspaceId: string, userId: string) => `${workspaceId}:${userId}`;

teamRoutes.get(`${base}/members`, resolveWorkspace(), requireRole('admin'), async (c) => {
  const a = authOf(c);
  const ws = c.var.workspace;
  const [{ results }, quotas, used] = await Promise.all([
    c.env.DB.prepare(
      `SELECT u.id, u.email, p.display_name, m.role FROM workspace_members m
         JOIN users u ON u.id = m.user_id LEFT JOIN user_profiles p ON p.user_id = u.id
         WHERE m.workspace_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.email`,
    )
      .bind(ws.id)
      .all<{ id: string; email: string; display_name: string | null; role: MemberView['role'] }>(),
    c.env.DB.prepare(
      `SELECT scope_id, limit_value FROM usage_quotas WHERE scope = 'member' AND scope_id LIKE ? AND metric = 'executions' AND period = 'day'`,
    )
      .bind(`${ws.id}:%`)
      .all<{ scope_id: string; limit_value: number }>(),
    usedTodayByUser(c.env.DB, ws.id),
  ]);
  const q = new Map(quotas.results.map((r) => [r.scope_id, r.limit_value]));
  const members: MemberView[] = results.map((r) => ({
    userId: r.id,
    email: r.email,
    displayName: r.display_name,
    role: r.role,
    quotaPerDay: q.get(quotaKey(ws.id, r.id)) ?? null,
    usedToday: used.get(r.id) ?? 0,
    isYou: r.id === a.user.id,
  }));
  return c.json({ members });
});

async function targetMember(db: D1Database, workspaceId: string, userId: string) {
  const row = await db
    .prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
    .bind(workspaceId, userId)
    .first<{ role: MemberView['role'] }>();
  if (!row) throw new HttpError(404, 'not_found');
  return row.role;
}

/** Só o owner muda papéis (admin <-> member). Owner não é rebaixado nem criado por aqui. */
teamRoutes.patch(
  `${base}/members/:userId`,
  resolveWorkspace(),
  requireCompany,
  requireRole('owner'),
  async (c) => {
    const a = authOf(c);
    const ws = c.var.workspace;
    const { role } = await parseJson(c, changeRoleSchema);
    const userId = c.req.param('userId');
    const current = await targetMember(c.env.DB, ws.id, userId);
    if (current === 'owner')
      throw new HttpError(409, 'owner_protected', 'The owner role cannot be changed');
    await writeLimit(c.env.DB, a.user.id);
    await c.env.DB.prepare(
      `UPDATE workspace_members SET role = ?1, updated_at = ?2 WHERE workspace_id = ?3 AND user_id = ?4 AND role <> 'owner'`,
    )
      .bind(role, Date.now(), ws.id, userId)
      .run();
    await audit(getDb(c.env.DB), {
      action: 'member.role_change',
      actorUserId: a.user.id,
      workspaceId: ws.id,
      targetType: 'user',
      targetId: userId,
      metadata: { from: current, to: role },
    });
    return c.json({ userId, role });
  },
);

/** Remover: admin remove member; owner remove admin/member; qualquer não-owner pode sair. */
teamRoutes.delete(`${base}/members/:userId`, resolveWorkspace(), requireCompany, async (c) => {
  const a = authOf(c);
  const ws = c.var.workspace;
  const userId = c.req.param('userId');
  const self = userId === a.user.id;
  const target = await targetMember(c.env.DB, ws.id, userId);
  if (target === 'owner')
    throw new HttpError(409, 'owner_protected', 'The owner cannot be removed');
  if (!self) {
    const allowed = ws.role === 'owner' || (ws.role === 'admin' && target === 'member');
    if (!allowed) throw new HttpError(403, 'forbidden', 'Insufficient role');
  }
  await writeLimit(c.env.DB, a.user.id);
  const db = c.env.DB;
  await db.batch([
    db
      .prepare('DELETE FROM workspace_members WHERE workspace_id = ?1 AND user_id = ?2')
      .bind(ws.id, userId),
    db
      .prepare(`DELETE FROM usage_quotas WHERE scope = 'member' AND scope_id = ?`)
      .bind(quotaKey(ws.id, userId)),
    // Sai também da organização se não restar nenhum workspace dela (nunca o owner da organização).
    db
      .prepare(
        `DELETE FROM organization_members WHERE organization_id = ?1 AND user_id = ?2 AND role <> 'owner'
         AND NOT EXISTS (SELECT 1 FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id
                         WHERE w.organization_id = ?1 AND wm.user_id = ?2)`,
      )
      .bind(ws.organizationId, userId),
  ]);
  await audit(getDb(db), {
    action: 'member.remove',
    actorUserId: a.user.id,
    workspaceId: ws.id,
    targetType: 'user',
    targetId: userId,
    metadata: { self },
  });
  return c.json({ removed: true });
});

/** Cota diária individual de execuções (valor `null` remove). */
teamRoutes.put(
  `${base}/members/:userId/quota`,
  resolveWorkspace(),
  requireCompany,
  requireRole('admin'),
  async (c) => {
    const a = authOf(c);
    const ws = c.var.workspace;
    const { executionsPerDay } = await parseJson(c, memberQuotaSchema);
    const userId = c.req.param('userId');
    await targetMember(c.env.DB, ws.id, userId);
    await writeLimit(c.env.DB, a.user.id);
    const key = quotaKey(ws.id, userId);
    if (executionsPerDay === null) {
      await c.env.DB.prepare(
        `DELETE FROM usage_quotas WHERE scope = 'member' AND scope_id = ? AND metric = 'executions'`,
      )
        .bind(key)
        .run();
    } else {
      await c.env.DB.prepare(
        `INSERT INTO usage_quotas (id, scope, scope_id, metric, limit_value, period) VALUES (?1, 'member', ?2, 'executions', ?3, 'day')
         ON CONFLICT (scope, scope_id, metric, period) DO UPDATE SET limit_value = ?3, updated_at = ?4`,
      )
        .bind(crypto.randomUUID(), key, executionsPerDay, Date.now())
        .run();
    }
    await audit(getDb(c.env.DB), {
      action: 'member.quota_set',
      actorUserId: a.user.id,
      workspaceId: ws.id,
      targetType: 'user',
      targetId: userId,
      metadata: { executionsPerDay },
    });
    return c.json({ userId, quotaPerDay: executionsPerDay });
  },
);

// ------------------------------------------------------------- uso, histórico, biblioteca

teamRoutes.get(`${base}/usage`, resolveWorkspace(), requireCompany, async (c) => {
  const a = authOf(c);
  const ws = c.var.workspace;
  const isAdmin = ws.role !== 'member';
  const [used, quotas, rows] = await Promise.all([
    usedTodayByUser(c.env.DB, ws.id),
    c.env.DB.prepare(
      `SELECT scope_id, limit_value FROM usage_quotas WHERE scope = 'member' AND scope_id LIKE ? AND metric = 'executions' AND period = 'day'`,
    )
      .bind(`${ws.id}:%`)
      .all<{ scope_id: string; limit_value: number }>(),
    c.env.DB.prepare(
      'SELECT u.id, u.email FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY u.email',
    )
      .bind(ws.id)
      .all<{ id: string; email: string }>(),
  ]);
  const q = new Map(quotas.results.map((r) => [r.scope_id, r.limit_value]));
  const body: WorkspaceUsage = {
    day: utcDay(),
    workspaceUsedToday: [...used.values()].reduce((x, y) => x + y, 0),
    workspaceLimitPerDay: PLATFORM_LIMITS.executionsPerWorkspacePerDay,
    // Membro comum vê só a própria linha; admin/owner veem todas.
    members: rows.results
      .filter((r) => isAdmin || r.id === a.user.id)
      .map((r) => ({
        userId: r.id,
        email: r.email,
        usedToday: used.get(r.id) ?? 0,
        quotaPerDay: q.get(quotaKey(ws.id, r.id)) ?? null,
      })),
  };
  return c.json(body);
});

teamRoutes.get(
  `${base}/executions`,
  resolveWorkspace(),
  requireCompany,
  requireRole('admin'),
  async (c) => {
    const ws = c.var.workspace;
    const q = workspaceHistoryQuerySchema.safeParse(c.req.query());
    if (!q.success) throw new HttpError(400, 'validation_error', 'Invalid query');
    const where = ['e.workspace_id = ?'];
    const binds: Array<string | number> = [ws.id];
    if (q.data.userId) {
      where.push('e.user_id = ?');
      binds.push(q.data.userId);
    }
    if (q.data.status) {
      where.push('e.status = ?');
      binds.push(q.data.status);
    }
    const w = where.join(' AND ');
    const pageSize = 20;
    const [rows, count] = await c.env.DB.batch([
      c.env.DB.prepare(
        `SELECT e.id, e.status, e.user_id, e.created_at, e.finished_at, a.name, u.email FROM agent_executions e
         JOIN agents a ON a.id = e.agent_id JOIN users u ON u.id = e.user_id
         WHERE ${w} ORDER BY e.created_at DESC, e.id LIMIT ? OFFSET ?`,
      ).bind(...binds, pageSize, (q.data.page - 1) * pageSize),
      c.env.DB.prepare(`SELECT COUNT(*) AS n FROM agent_executions e WHERE ${w}`).bind(...binds),
    ]);
    const executions: WorkspaceExecutionItem[] = (
      rows as D1Result<{
        id: string;
        status: ExecutionStatusName;
        user_id: string;
        created_at: number;
        finished_at: number | null;
        name: string;
        email: string;
      }>
    ).results.map((r) => ({
      id: r.id,
      agentName: r.name,
      status: r.status,
      userId: r.user_id,
      userEmail: r.email,
      createdAt: r.created_at,
      finishedAt: r.finished_at,
    }));
    return c.json({
      executions,
      page: q.data.page,
      pageSize,
      total: (count as D1Result<{ n: number }>).results[0]?.n ?? 0,
    });
  },
);

/** Biblioteca: agentes do workspace + agentes públicos instalados por owner/admin (compartilhados). */
teamRoutes.get(`${base}/library`, resolveWorkspace(), async (c) => {
  const ws = c.var.workspace;
  if (ws.organizationKind !== 'company') return c.json({ items: [] satisfies LibraryItem[] });
  const { results } = await c.env.DB.prepare(
    `SELECT a.slug, a.name, a.description, a.current_version_id AS vid, 'workspace' AS source
         FROM agents a WHERE a.visibility = 'workspace' AND a.workspace_id = ?1 AND a.status = 'published' AND a.current_version_id IS NOT NULL
       UNION
       SELECT a.slug, a.name, a.description, a.current_version_id AS vid, 'shared_install' AS source
         FROM agents a
         JOIN agent_installations i ON i.agent_id = a.id AND i.workspace_id = ?1 AND i.status = 'active'
         JOIN workspace_members m ON m.workspace_id = ?1 AND m.user_id = i.user_id AND m.role IN ('owner', 'admin')
        WHERE a.visibility = 'public' AND a.status = 'published' AND a.current_version_id IS NOT NULL
       ORDER BY name LIMIT 50`,
  )
    .bind(ws.id)
    .all<{
      slug: string;
      name: string;
      description: string;
      vid: string;
      source: LibraryItem['source'];
    }>();
  const items: LibraryItem[] = [];
  for (const r of results) {
    const v = await loadRunnableVersion(c.env.DB, r.vid);
    if (!v) continue;
    const toolKeys = v.tools.map((t) => t.key);
    items.push({
      slug: r.slug,
      name: r.name,
      description: r.description,
      source: r.source,
      toolKeys,
      limits: agentLimitsSchema.safeParse(v.limits).success ? v.limits : DEFAULT_LIMITS,
      requiresApproval: requiresApproval(toolKeys, v.limits),
      requiresAi: toolKeys.some((k) => getTool(k)?.requiresAi),
    });
  }
  return c.json({ items });
});
