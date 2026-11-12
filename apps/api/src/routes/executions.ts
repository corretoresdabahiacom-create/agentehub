import {
  approveSchema,
  createExecutionSchema,
  DEFAULT_LIMITS,
  executionInputSchema,
  executionListQuerySchema,
  getTool,
  inputsFor,
  PLATFORM_LIMITS,
  rejectSchema,
  transition,
  TOOL_META,
  InvalidTransitionError,
  type ApprovalView,
  type ExecutionDetail,
  type ExecutionEvent,
  type ExecutionInput,
  type ExecutionListResponse,
  type ExecutionStatusName,
  type PendingApprovalItem,
  type ToolsResponse,
} from '@agenthub/shared';
import { Hono, type Context } from 'hono';
import { aiStatus, getAiProvider } from '../ai/provider';
import { getDb } from '../db/client';
import type { AppEnv } from '../env';
import { audit, type AuditAction } from '../lib/audit';
import {
  approvalExpiry,
  artifactInsert,
  loadRunnableVersion,
  runExecution,
  type RunnableVersion,
} from '../lib/executions';
import { HttpError, parseJson } from '../lib/http';
import { authOf, limitOrThrow, parseObject } from '../lib/route-utils';
import { requireAuth } from '../middleware/authz';

export const toolsRoutes = new Hono<AppEnv>();
export const executionsRoutes = new Hono<AppEnv>();
export const approvalsRoutes = new Hono<AppEnv>();

toolsRoutes.get('/', (c) => {
  const body: ToolsResponse = {
    tools: TOOL_META,
    limits: PLATFORM_LIMITS,
    defaults: DEFAULT_LIMITS,
    ai: { status: aiStatus(c.env) },
  };
  return c.json(body);
});

const STALE_MS = 120_000;
const PAGE_SIZE = 20;

// ------------------------------------------------------------------ utilidades

interface ExecRow {
  id: string;
  agent_id: string;
  agent_version_id: string;
  installation_id: string | null;
  workspace_id: string;
  user_id: string;
  status: ExecutionStatusName;
  input_json: string;
  output_json: string | null;
  error: string | null;
  attempts: number;
  created_at: number;
  finished_at: number | null;
  updated_at: number;
  agent_slug: string;
  agent_name: string;
  agent_status: string;
  org_kind: string;
  viewer_role: string | null;
}

/** Execução visível a quem pediu ou, em workspace de empresa, a owner/admin. Senão 404. */
async function loadExec(db: D1Database, id: string, viewerId: string): Promise<ExecRow> {
  const row = await db
    .prepare(
      `SELECT e.id, e.agent_id, e.agent_version_id, e.installation_id, e.workspace_id, e.user_id, e.status,
              e.input_json, e.output_json, e.error, e.attempts, e.created_at, e.finished_at, e.updated_at,
              a.slug AS agent_slug, a.name AS agent_name, a.status AS agent_status, o.kind AS org_kind,
              (SELECT m.role FROM workspace_members m WHERE m.workspace_id = e.workspace_id AND m.user_id = ?2) AS viewer_role
       FROM agent_executions e
       JOIN agents a ON a.id = e.agent_id
       JOIN workspaces w ON w.id = e.workspace_id
       JOIN organizations o ON o.id = w.organization_id
       WHERE e.id = ?1`,
    )
    .bind(id, viewerId)
    .first<ExecRow>();
  if (!row) throw new HttpError(404, 'not_found');
  const isAdmin =
    row.org_kind === 'company' && (row.viewer_role === 'owner' || row.viewer_role === 'admin');
  if (row.user_id !== viewerId && !isAdmin) throw new HttpError(404, 'not_found');
  return row;
}

interface ApprovalRow {
  id: string;
  decision: 'pending' | 'approved' | 'rejected';
  method: 'workspace_admin' | 'self_second_step';
  reason: string | null;
  created_at: number;
  decided_at: number | null;
}
const latestApproval = (db: D1Database, executionId: string) =>
  db
    .prepare(
      `SELECT id, decision, method, reason, created_at, decided_at FROM execution_approvals
       WHERE execution_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .bind(executionId)
    .first<ApprovalRow>();

const canDecide = (e: ExecRow, ap: ApprovalRow, viewerId: string, now: number) =>
  ap.decision === 'pending' &&
  now < approvalExpiry(ap.created_at) &&
  (ap.method === 'self_second_step'
    ? e.user_id === viewerId
    : e.viewer_role === 'owner' || e.viewer_role === 'admin');

function mapTransition(status: ExecutionStatusName, event: ExecutionEvent): ExecutionStatusName {
  try {
    return transition(status, event);
  } catch (err) {
    if (err instanceof InvalidTransitionError)
      throw new HttpError(409, 'invalid_state', 'Invalid state');
    throw err;
  }
}

/** Execuções "penduradas" (queda do Worker no meio da execução) viram falha/cancelamento no acesso. */
async function recoverStale(db: D1Database, e: ExecRow): Promise<ExecRow> {
  const now = Date.now();
  if ((e.status !== 'running' && e.status !== 'pending') || now - e.updated_at < STALE_MS) return e;
  const next = mapTransition(e.status, e.status === 'running' ? 'FAIL' : 'CANCEL');
  const res = await db
    .prepare(
      `UPDATE agent_executions SET status = ?1, error = 'interrupted', finished_at = ?2, updated_at = ?2
       WHERE id = ?3 AND status = ?4 AND updated_at = ?5`,
    )

    .bind(next, now, e.id, e.status, e.updated_at)
    .run();
  return res.meta.changes === 1
    ? { ...e, status: next, error: 'interrupted', finished_at: now, updated_at: now }
    : e;
}

/** Expiração aplicada no acesso (sem cron): aprovação pendente vencida cancela a execução. */
async function expireIfStale(db: D1Database, e: ExecRow, ap: ApprovalRow | null): Promise<boolean> {
  const now = Date.now();
  if (
    e.status !== 'awaiting_approval' ||
    !ap ||
    ap.decision !== 'pending' ||
    now < approvalExpiry(ap.created_at)
  ) {
    return false;
  }
  mapTransition('awaiting_approval', 'CANCEL');
  const res = await db.batch([
    db
      .prepare(
        `UPDATE execution_approvals SET decision = 'rejected', reason = 'expired', decided_at = ?1 WHERE id = ?2 AND decision = 'pending'`,
      )
      .bind(now, ap.id),
    db
      .prepare(
        `UPDATE agent_executions SET status = 'canceled', finished_at = ?1, updated_at = ?1
         WHERE id = ?2 AND status = 'awaiting_approval' AND EXISTS (SELECT 1 FROM execution_approvals WHERE id = ?3 AND reason = 'expired')`,
      )
      .bind(now, e.id, ap.id),
  ]);
  if (res[1]?.meta.changes === 1) {
    await audit(getDb(db), {
      action: 'execution.expire',
      workspaceId: e.workspace_id,
      targetType: 'execution',
      targetId: e.id,
    });
  }
  return true;
}

async function buildDetail(db: D1Database, e: ExecRow, viewerId: string): Promise<ExecutionDetail> {
  const now = Date.now();
  const [stepsRes, ap, artRes, version] = await Promise.all([
    db
      .prepare(
        'SELECT seq, name, status, error, output_json FROM execution_steps WHERE execution_id = ? ORDER BY seq',
      )
      .bind(e.id)
      .all<{
        seq: number;
        name: string;
        status: string;
        error: string | null;
        output_json: string | null;
      }>(),
    latestApproval(db, e.id),
    db
      .prepare(
        'SELECT id, name, mime_type, size_bytes FROM execution_artifacts WHERE execution_id = ? ORDER BY created_at',
      )
      .bind(e.id)
      .all<{ id: string; name: string; mime_type: string; size_bytes: number }>(),
    loadRunnableVersion(db, e.agent_version_id),
  ]);
  let output: ExecutionDetail['output'] = null;
  if (e.output_json && (e.status === 'completed' || e.status === 'awaiting_approval')) {
    const o = parseObject(e.output_json);
    if (typeof o['content'] === 'string' && typeof o['mimeType'] === 'string') {
      output = { content: o['content'], mimeType: o['mimeType'] };
    }
  }
  const approval: ApprovalView | null = ap
    ? {
        id: ap.id,
        decision: ap.decision,
        method: ap.method,
        reason: ap.reason,
        createdAt: ap.created_at,
        decidedAt: ap.decided_at,
        expiresAt: approvalExpiry(ap.created_at),
        canDecide: canDecide(e, ap, viewerId, now),
      }
    : null;
  return {
    id: e.id,
    agentSlug: e.agent_slug,
    agentName: e.agent_name,
    workspaceId: e.workspace_id,
    status: e.status,
    createdAt: e.created_at,
    finishedAt: e.finished_at,
    input: parseObject(e.input_json) as ExecutionInput,
    output,
    error: e.error,
    attempts: e.attempts,
    maxAttempts: version?.limits.maxAttempts ?? 1,
    steps: stepsRes.results.map((s) => ({
      seq: s.seq,
      name: s.name,
      status: s.status,
      error: s.error,
      preview:
        typeof parseObject(s.output_json)['preview'] === 'string'
          ? (parseObject(s.output_json)['preview'] as string)
          : null,
    })),
    approval,
    artifacts: artRes.results.map((a) => ({
      id: a.id,
      name: a.name,
      mimeType: a.mime_type,
      sizeBytes: a.size_bytes,
    })),
    mine: e.user_id === viewerId,
  };
}

/** Prevalida (sem custo): IA, tamanho, entradas obrigatórias. Recusa antes de gravar qualquer coisa. */
function preflight(c: Context<AppEnv>, version: RunnableVersion, input: ExecutionInput) {
  if (version.tools.some((t) => getTool(t.key)?.requiresAi) && !getAiProvider(c.env)) {
    throw new HttpError(
      422,
      'ai_not_configured',
      'This agent needs AI and no AI provider is configured',
    );
  }
  if ((input.text ?? '').length > version.limits.maxInputChars) {
    throw new HttpError(422, 'limit_input', 'Input is too long for this agent', {
      max: version.limits.maxInputChars,
    });
  }
  const missing = inputsFor(version.tools.map((t) => t.key)).required.filter((k) => {
    const v = input[k];
    return v === undefined || (typeof v === 'string' && v.trim() === '');
  });
  if (missing.length > 0)
    throw new HttpError(422, 'missing_input', 'Missing required input', { fields: missing });
}

async function consumeQuotas(db: D1Database, userId: string, workspaceId: string) {
  const day = 86_400;
  await limitOrThrow(
    db,
    'exec:global',
    PLATFORM_LIMITS.executionsGlobalPerDay,
    day,
    'quota_exceeded',
    { scope: 'global' },
  );
  await limitOrThrow(
    db,
    `exec:ws:${workspaceId}`,
    PLATFORM_LIMITS.executionsPerWorkspacePerDay,
    day,
    'quota_exceeded',
    { scope: 'workspace' },
  );
  // Cota individual definida por owner/admin para este membro neste workspace (Fase 4).
  const member = await db
    .prepare(
      `SELECT limit_value FROM usage_quotas WHERE scope = 'member' AND scope_id = ? AND metric = 'executions' AND period = 'day'`,
    )
    .bind(`${workspaceId}:${userId}`)
    .first<{ limit_value: number }>();
  if (member) {
    await limitOrThrow(
      db,
      `exec:member:${workspaceId}:${userId}`,
      member.limit_value,
      day,
      'quota_exceeded',
      { scope: 'member' },
    );
  }
  await limitOrThrow(
    db,
    `exec:user:${userId}`,
    PLATFORM_LIMITS.executionsPerUserPerDay,
    day,
    'quota_exceeded',
    { scope: 'user' },
  );
}

// ------------------------------------------------------------------- criar

executionsRoutes.use('*', requireAuth);
approvalsRoutes.use('*', requireAuth);

executionsRoutes.post('/', async (c) => {
  const a = authOf(c);
  const body = await parseJson(c, createExecutionSchema);
  const db = c.env.DB;
  const ws = await db
    .prepare(
      `SELECT w.id, o.kind FROM workspace_members m
       JOIN workspaces w ON w.id = m.workspace_id JOIN organizations o ON o.id = w.organization_id
       WHERE m.user_id = ? AND m.workspace_id = ?`,
    )
    .bind(a.user.id, body.workspaceId)
    .first<{ id: string; kind: string }>();
  if (!ws) throw new HttpError(404, 'not_found');

  const agent = await db
    .prepare(
      `SELECT id, slug, visibility, current_version_id, workspace_id, creator_user_id FROM agents
       WHERE slug = ? AND status = 'published' AND current_version_id IS NOT NULL`,
    )
    .bind(body.agentSlug)
    .first<{
      id: string;
      slug: string;
      visibility: string;
      current_version_id: string;
      workspace_id: string | null;
      creator_user_id: string;
    }>();
  let installationId: string | null = null;
  if (!agent) throw new HttpError(404, 'not_found');
  if (agent.visibility === 'public') {
    // Instalação do próprio usuário OU compartilhada: instalada por owner/admin numa empresa.
    const mine = await db
      .prepare(
        `SELECT id FROM agent_installations WHERE agent_id = ? AND workspace_id = ? AND user_id = ? AND status = 'active'`,
      )
      .bind(agent.id, ws.id, a.user.id)
      .first<{ id: string }>();
    const shared =
      mine ??
      (ws.kind === 'company'
        ? await db
            .prepare(
              `SELECT i.id FROM agent_installations i
               JOIN workspace_members m ON m.workspace_id = i.workspace_id AND m.user_id = i.user_id AND m.role IN ('owner','admin')
               WHERE i.agent_id = ? AND i.workspace_id = ? AND i.status = 'active' LIMIT 1`,
            )
            .bind(agent.id, ws.id)
            .first<{ id: string }>()
        : null);
    if (!shared)
      throw new HttpError(403, 'not_installed', 'Install the agent in this workspace first');
    installationId = mine?.id ?? null;
  } else if (agent.visibility === 'workspace' && agent.workspace_id === ws.id) {
    // Biblioteca do workspace: qualquer membro executa, sem instalar.
    installationId = null;
  } else if (
    agent.visibility === 'private' &&
    agent.creator_user_id === a.user.id &&
    agent.workspace_id === ws.id
  ) {
    const inst = await db
      .prepare(
        `SELECT id FROM agent_installations WHERE agent_id = ? AND workspace_id = ? AND user_id = ? AND status = 'active'`,
      )
      .bind(agent.id, ws.id, a.user.id)
      .first<{ id: string }>();
    installationId = inst?.id ?? null;
  } else {
    throw new HttpError(404, 'not_found');
  }

  const version = await loadRunnableVersion(db, agent.current_version_id);
  if (!version) throw new HttpError(409, 'agent_misconfigured', 'Agent is misconfigured');
  preflight(c, version, body.input);
  await consumeQuotas(db, a.user.id, ws.id);

  const id = crypto.randomUUID();
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO agent_executions (id, agent_id, agent_version_id, installation_id, workspace_id, user_id, status, input_json, attempts, requires_ai, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, 0, 0, ?8, ?8)`,
    )
    .bind(
      id,
      agent.id,
      version.id,
      installationId,
      ws.id,
      a.user.id,
      JSON.stringify(body.input),
      now,
    )
    .run();
  await audit(getDb(db), {
    action: 'execution.create',
    actorUserId: a.user.id,
    workspaceId: ws.id,
    targetType: 'execution',
    targetId: id,
    metadata: { agent: agent.slug },
  });
  await runExecution(db, {
    executionId: id,
    version,
    input: body.input,
    userId: a.user.id,
    workspaceId: ws.id,
    orgKind: ws.kind,
  });
  return c.json(await buildDetail(db, await loadExec(db, id, a.user.id), a.user.id), 201);
});

// ------------------------------------------------------------------ listar

executionsRoutes.get('/', async (c) => {
  const a = authOf(c);
  const q = executionListQuerySchema.safeParse(c.req.query());
  if (!q.success) throw new HttpError(400, 'validation_error', 'Invalid query');
  const where = ['e.user_id = ?'];
  const binds: Array<string | number> = [a.user.id];
  if (q.data.workspaceId) {
    where.push('e.workspace_id = ?');
    binds.push(q.data.workspaceId);
  }
  if (q.data.status) {
    where.push('e.status = ?');
    binds.push(q.data.status);
  }
  const w = where.join(' AND ');
  const [rows, count] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT e.id, e.workspace_id, e.status, e.created_at, e.finished_at, a.slug, a.name FROM agent_executions e
         JOIN agents a ON a.id = e.agent_id WHERE ${w} ORDER BY e.created_at DESC, e.id LIMIT ? OFFSET ?`,
    ).bind(...binds, PAGE_SIZE, (q.data.page - 1) * PAGE_SIZE),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM agent_executions e WHERE ${w}`).bind(...binds),
  ]);
  const body: ExecutionListResponse = {
    executions: (
      rows as D1Result<{
        id: string;
        workspace_id: string;
        status: ExecutionStatusName;
        created_at: number;
        finished_at: number | null;
        slug: string;
        name: string;
      }>
    ).results.map((r) => ({
      id: r.id,
      agentSlug: r.slug,
      agentName: r.name,
      workspaceId: r.workspace_id,
      status: r.status,
      createdAt: r.created_at,
      finishedAt: r.finished_at,
    })),
    page: q.data.page,
    pageSize: PAGE_SIZE,
    total: ((count as D1Result<{ n: number }>).results[0]?.n ?? 0) as number,
  };
  return c.json(body);
});

approvalsRoutes.get('/', async (c) => {
  const a = authOf(c);
  const cutoff = Date.now() - PLATFORM_LIMITS.approvalTtlHours * 3_600_000;
  const { results } = await c.env.DB.prepare(
    `SELECT ap.execution_id, a.name AS agent_name, e.workspace_id, w.name AS workspace_name, ap.method, ap.created_at
     FROM execution_approvals ap
     JOIN agent_executions e ON e.id = ap.execution_id AND e.status = 'awaiting_approval'
     JOIN agents a ON a.id = e.agent_id
     JOIN workspaces w ON w.id = e.workspace_id
     JOIN organizations o ON o.id = w.organization_id
     WHERE ap.decision = 'pending' AND ap.created_at > ?1 AND (
       (ap.method = 'self_second_step' AND e.user_id = ?2) OR
       (ap.method = 'workspace_admin' AND o.kind = 'company' AND EXISTS (
          SELECT 1 FROM workspace_members m WHERE m.workspace_id = e.workspace_id AND m.user_id = ?2 AND m.role IN ('owner','admin'))))
     ORDER BY ap.created_at DESC LIMIT 50`,
  )
    .bind(cutoff, a.user.id)
    .all<{
      execution_id: string;
      agent_name: string;
      workspace_id: string;
      workspace_name: string;
      method: PendingApprovalItem['method'];
      created_at: number;
    }>();
  const approvals: PendingApprovalItem[] = results.map((r) => ({
    executionId: r.execution_id,
    agentName: r.agent_name,
    workspaceId: r.workspace_id,
    workspaceName: r.workspace_name,
    method: r.method,
    createdAt: r.created_at,
    expiresAt: approvalExpiry(r.created_at),
  }));
  return c.json({ approvals });
});

// ------------------------------------------------------------------ detalhe

executionsRoutes.get('/:id', async (c) => {
  const a = authOf(c);
  const db = c.env.DB;
  let e = await loadExec(db, c.req.param('id'), a.user.id);
  e = await recoverStale(db, e);
  if (await expireIfStale(db, e, await latestApproval(db, e.id)))
    e = await loadExec(db, e.id, a.user.id);
  return c.json(await buildDetail(db, e, a.user.id));
});

executionsRoutes.get('/:id/artifacts/:artifactId', async (c) => {
  const a = authOf(c);
  const e = await loadExec(c.env.DB, c.req.param('id'), a.user.id);
  const art = await c.env.DB.prepare(
    'SELECT name, mime_type, content_text FROM execution_artifacts WHERE id = ? AND execution_id = ?',
  )
    .bind(c.req.param('artifactId'), e.id)
    .first<{ name: string; mime_type: string; content_text: string }>();
  if (!art || e.status !== 'completed') throw new HttpError(404, 'not_found');
  return new Response(art.content_text, {
    headers: {
      'content-type': `${art.mime_type}; charset=utf-8`,
      'content-disposition': `attachment; filename="${art.name.replace(/[^\w.-]/g, '_')}"`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
      'content-security-policy': "sandbox; default-src 'none'",
    },
  });
});

// ------------------------------------------------------------------ aprovação

async function decide(c: Context<AppEnv>, decision: 'approved' | 'rejected') {
  const a = authOf(c);
  const db = c.env.DB;
  const parsed =
    decision === 'approved' ? await parseJson(c, approveSchema) : await parseJson(c, rejectSchema);
  let e = await loadExec(db, c.req.param('id') ?? '', a.user.id);
  const ap = await latestApproval(db, e.id);
  if (await expireIfStale(db, e, ap))
    throw new HttpError(409, 'approval_expired', 'The approval request expired');
  if (e.status !== 'awaiting_approval' || !ap || ap.decision !== 'pending') {
    throw new HttpError(409, 'not_awaiting_approval', 'Nothing to decide');
  }
  if (ap.method === 'self_second_step') {
    if (e.user_id !== a.user.id)
      throw new HttpError(403, 'forbidden', 'Only the requester can confirm');
    if (decision === 'approved' && (parsed as { confirm?: boolean }).confirm !== true) {
      throw new HttpError(422, 'confirmation_required', 'Explicit confirmation is required');
    }
  } else if (e.viewer_role !== 'owner' && e.viewer_role !== 'admin') {
    throw new HttpError(403, 'forbidden', 'Only an owner or admin can decide');
  }
  await limitOrThrow(db, `exec:decide:${a.user.id}`, 60, 600);

  const now = Date.now();
  const event: ExecutionEvent = decision === 'approved' ? 'APPROVE' : 'REJECT';
  const next = mapTransition('awaiting_approval', event);
  const reason = decision === 'rejected' ? ((parsed as { reason?: string }).reason ?? null) : null;
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE execution_approvals SET decision = ?1, approver_user_id = ?2, reason = ?3, decided_at = ?4
         WHERE id = ?5 AND decision = 'pending'`,
      )
      .bind(decision, a.user.id, reason, now, ap.id),
    db
      .prepare(
        `UPDATE agent_executions SET status = ?1, finished_at = ?2, updated_at = ?2
         WHERE id = ?3 AND status = 'awaiting_approval'
           AND EXISTS (SELECT 1 FROM execution_approvals WHERE id = ?4 AND decision = ?5 AND approver_user_id = ?6 AND decided_at = ?2)`,
      )
      .bind(next, now, e.id, ap.id, decision, a.user.id),
  ];
  if (decision === 'approved') {
    const out = parseObject(e.output_json);
    if (typeof out['content'] !== 'string' || typeof out['mimeType'] !== 'string') {
      throw new HttpError(409, 'invalid_state');
    }
    const version = await loadRunnableVersion(db, e.agent_version_id);
    stmts.push(
      artifactInsert(
        db,
        e.id,
        { content: out['content'], mimeType: out['mimeType'] },
        version?.outputFormat ?? 'text',
        now,
        now,
      ),
    );
  }
  const res = await db.batch(stmts);
  if (res[0]?.meta.changes !== 1 || res[1]?.meta.changes !== 1) {
    throw new HttpError(409, 'conflict', 'Already decided');
  }
  await audit(getDb(db), {
    action: (decision === 'approved' ? 'execution.approve' : 'execution.reject') as AuditAction,
    actorUserId: a.user.id,
    workspaceId: e.workspace_id,
    targetType: 'execution',
    targetId: e.id,
    metadata: { method: ap.method },
  });
  e = await loadExec(db, e.id, a.user.id);
  return c.json(await buildDetail(db, e, a.user.id));
}

executionsRoutes.post('/:id/approve', (c) => decide(c, 'approved'));
executionsRoutes.post('/:id/reject', (c) => decide(c, 'rejected'));

executionsRoutes.post('/:id/cancel', async (c) => {
  const a = authOf(c);
  const db = c.env.DB;
  const e = await loadExec(db, c.req.param('id'), a.user.id);
  if (e.user_id !== a.user.id)
    throw new HttpError(403, 'forbidden', 'Only the requester can cancel');
  const ap = await latestApproval(db, e.id);
  if (await expireIfStale(db, e, ap))
    throw new HttpError(409, 'approval_expired', 'The approval request expired');
  const next = mapTransition(e.status, 'CANCEL');
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  if (e.status === 'awaiting_approval' && ap?.decision === 'pending') {
    stmts.push(
      db
        .prepare(
          `UPDATE execution_approvals SET decision = 'rejected', approver_user_id = ?1, reason = 'canceled_by_requester', decided_at = ?2 WHERE id = ?3 AND decision = 'pending'`,
        )
        .bind(a.user.id, now, ap.id),
    );
  }
  stmts.push(
    db
      .prepare(
        `UPDATE agent_executions SET status = ?1, finished_at = ?2, updated_at = ?2 WHERE id = ?3 AND status = ?4`,
      )
      .bind(next, now, e.id, e.status),
  );
  const res = await db.batch(stmts);
  if (res[res.length - 1]?.meta.changes !== 1)
    throw new HttpError(409, 'conflict', 'State changed');
  await audit(getDb(db), {
    action: 'execution.cancel',
    actorUserId: a.user.id,
    workspaceId: e.workspace_id,
    targetType: 'execution',
    targetId: e.id,
  });
  return c.json(await buildDetail(db, await loadExec(db, e.id, a.user.id), a.user.id));
});

executionsRoutes.post('/:id/retry', async (c) => {
  const a = authOf(c);
  const db = c.env.DB;
  let e = await loadExec(db, c.req.param('id'), a.user.id);
  if (e.user_id !== a.user.id)
    throw new HttpError(403, 'forbidden', 'Only the requester can retry');
  e = await recoverStale(db, e);
  const next = mapTransition(e.status, 'RETRY');
  if (e.agent_status !== 'published')
    throw new HttpError(409, 'agent_unavailable', 'The agent is no longer available');
  const version = await loadRunnableVersion(db, e.agent_version_id);
  if (!version) throw new HttpError(409, 'agent_misconfigured', 'Agent is misconfigured');
  if (e.attempts >= version.limits.maxAttempts) {
    throw new HttpError(409, 'attempts_exhausted', 'No attempts left', {
      max: version.limits.maxAttempts,
    });
  }
  const input = executionInputSchema.parse(parseObject(e.input_json));
  preflight(c, version, input);
  await consumeQuotas(db, a.user.id, e.workspace_id);
  const res = await db
    .prepare(
      `UPDATE agent_executions SET status = ?1, updated_at = ?2 WHERE id = ?3 AND status = 'failed'`,
    )
    .bind(next, Date.now(), e.id)
    .run();
  if (res.meta.changes !== 1) throw new HttpError(409, 'conflict', 'State changed');
  await audit(getDb(db), {
    action: 'execution.retry',
    actorUserId: a.user.id,
    workspaceId: e.workspace_id,
    targetType: 'execution',
    targetId: e.id,
  });
  await runExecution(db, {
    executionId: e.id,
    version,
    input,
    userId: a.user.id,
    workspaceId: e.workspace_id,
    orgKind: e.org_kind,
  });
  return c.json(await buildDetail(db, await loadExec(db, e.id, a.user.id), a.user.id));
});
