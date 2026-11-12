import {
  agentBodySchema,
  agentLimitsSchema,
  getTool,
  hasErrors,
  publishSchema,
  runPipeline,
  testRunSchema,
  validateAgent,
  type AgentDraft,
  type MyAgentDetail,
  type MyAgentSummary,
  type OutputFormat,
  type TestRunResponse,
  type ValidateResponse,
} from '@agenthub/shared';
import { Hono } from 'hono';
import { getAiProvider } from '../ai/provider';
import { getDb } from '../db/client';
import type { AppEnv } from '../env';
import { audit } from '../lib/audit';
import { HttpError, parseJson } from '../lib/http';
import { authOf, limitOrThrow, parseObject, slugify } from '../lib/route-utils';
import { requireAuth } from '../middleware/authz';

/** Construtor no-code (Fase 3). Tudo é escopado ao criador: agente alheio responde 404. */
export const myAgentsRoutes = new Hono<AppEnv>();
myAgentsRoutes.use('*', requireAuth);

const MAX_AGENTS_PER_USER = 25;
const WRITES = { limit: 60, windowSec: 600 };
const TESTS = { limit: 30, windowSec: 600 };

interface AgentRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  visibility: 'private' | 'workspace' | 'public';
  status: 'draft' | 'published' | 'suspended' | 'archived';
  workspace_id: string | null;
  current_version_id: string | null;
  updated_at: number;
}
interface VersionRow {
  id: string;
  version: number;
  objective: string;
  instructions: string;
  output_format: string;
  limits_json: string;
  status: 'draft' | 'published' | 'deprecated';
}

async function ownedAgent(db: D1Database, userId: string, id: string): Promise<AgentRow> {
  const row = await db
    .prepare(
      `SELECT id, slug, name, description, visibility, status, workspace_id, current_version_id, updated_at
       FROM agents WHERE id = ? AND creator_user_id = ? AND status <> 'archived'`,
    )
    .bind(id, userId)
    .first<AgentRow>();
  if (!row) throw new HttpError(404, 'not_found');
  return row;
}

async function latestVersion(db: D1Database, agentId: string): Promise<VersionRow> {
  const v = await db
    .prepare(
      `SELECT id, version, objective, instructions, output_format, limits_json, status
       FROM agent_versions WHERE agent_id = ? ORDER BY version DESC LIMIT 1`,
    )
    .bind(agentId)
    .first<VersionRow>();
  if (!v) throw new HttpError(404, 'not_found');
  return v;
}

async function toolsOf(db: D1Database, versionId: string) {
  const { results } = await db
    .prepare(
      'SELECT tool_key, config_json FROM agent_tools WHERE agent_version_id = ? ORDER BY tool_key',
    )
    .bind(versionId)
    .all<{ tool_key: string; config_json: string }>();
  return results.map((t) => ({ key: t.tool_key, config: parseObject(t.config_json) }));
}

function summary(a: AgentRow, v: VersionRow): MyAgentSummary {
  return {
    id: a.id,
    slug: a.slug,
    name: a.name,
    description: a.description,
    visibility: a.visibility,
    status: a.status,
    workspaceId: a.workspace_id,
    version: v.version,
    versionStatus: v.status,
    hasPublishedVersion: a.current_version_id !== null,
    updatedAt: a.updated_at,
  };
}

async function detail(db: D1Database, a: AgentRow): Promise<MyAgentDetail> {
  const v = await latestVersion(db, a.id);
  return {
    ...summary(a, v),
    objective: v.objective,
    instructions: v.instructions,
    outputFormat: v.output_format as OutputFormat,
    tools: await toolsOf(db, v.id),
    limits: parseObject(v.limits_json),
  };
}

async function draftOf(db: D1Database, a: AgentRow): Promise<AgentDraft> {
  const v = await latestVersion(db, a.id);
  return {
    name: a.name,
    description: a.description,
    objective: v.objective,
    instructions: v.instructions,
    outputFormat: v.output_format as OutputFormat,
    tools: await toolsOf(db, v.id),
    limits: parseObject(v.limits_json),
  };
}

function toolStatements(
  db: D1Database,
  versionId: string,
  tools: Array<{ key: string; config: Record<string, unknown> }>,
) {
  const keys = new Set<string>();
  const out: D1PreparedStatement[] = [];
  for (const t of tools) {
    if (keys.has(t.key))
      throw new HttpError(422, 'tool_duplicated', 'Duplicated tool', { tool: t.key });
    keys.add(t.key);
    const json = JSON.stringify(t.config);
    if (json.length > 4_500)
      throw new HttpError(422, 'tool_config_too_large', 'Tool config too large');
    out.push(
      db
        .prepare(
          'INSERT INTO agent_tools (id, agent_version_id, tool_key, config_json, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(crypto.randomUUID(), versionId, t.key, json, Date.now()),
    );
  }
  return out;
}

// ---------------------------------------------------------------------- CRUD

myAgentsRoutes.get('/', async (c) => {
  const a = authOf(c);
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.slug, a.name, a.description, a.visibility, a.status, a.workspace_id,
            a.current_version_id, a.updated_at, v.version, v.status AS version_status
     FROM agents a JOIN agent_versions v ON v.agent_id = a.id
       AND v.version = (SELECT MAX(version) FROM agent_versions WHERE agent_id = a.id)
     WHERE a.creator_user_id = ? AND a.status <> 'archived'
     ORDER BY a.updated_at DESC LIMIT 100`,
  )
    .bind(a.user.id)
    .all<AgentRow & { version: number; version_status: VersionRow['status'] }>();
  const agents: MyAgentSummary[] = results.map((r) =>
    summary(r, { ...({} as VersionRow), version: r.version, status: r.version_status }),
  );
  return c.json({ agents });
});

myAgentsRoutes.post('/', async (c) => {
  const a = authOf(c);
  const body = await parseJson(c, agentBodySchema);
  const db = c.env.DB;
  const member = await db
    .prepare('SELECT 1 AS x FROM workspace_members WHERE user_id = ? AND workspace_id = ?')
    .bind(a.user.id, body.workspaceId)
    .first();
  if (!member) throw new HttpError(404, 'not_found');
  await limitOrThrow(db, `agent:write:${a.user.id}`, WRITES.limit, WRITES.windowSec);
  const count = await db
    .prepare(`SELECT COUNT(*) AS n FROM agents WHERE creator_user_id = ? AND status <> 'archived'`)
    .bind(a.user.id)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_AGENTS_PER_USER) {
    throw new HttpError(409, 'agent_limit', 'Agent limit reached', { max: MAX_AGENTS_PER_USER });
  }
  const id = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const now = Date.now();
  const tools = toolStatements(db, versionId, body.tools);
  await db.batch([
    db
      .prepare(
        `INSERT INTO agents (id, workspace_id, creator_user_id, slug, name, description, visibility, status, is_demo, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'private', 'draft', 0, ?7, ?7)`,
      )
      .bind(id, body.workspaceId, a.user.id, slugify(body.name), body.name, body.description, now),
    db
      .prepare(
        `INSERT INTO agent_versions (id, agent_id, version, objective, instructions, output_format, limits_json, status, created_by, created_at)
         VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, 'draft', ?7, ?8)`,
      )
      .bind(
        versionId,
        id,
        body.objective,
        body.instructions,
        body.outputFormat,
        JSON.stringify(body.limits),
        a.user.id,
        now,
      ),
    ...tools,
  ]);
  await audit(getDb(db), {
    action: 'agent.create',
    actorUserId: a.user.id,
    workspaceId: body.workspaceId,
    targetType: 'agent',
    targetId: id,
  });
  return c.json(await detail(db, await ownedAgent(db, a.user.id, id)), 201);
});

myAgentsRoutes.get('/:id', async (c) => {
  const a = authOf(c);
  return c.json(await detail(c.env.DB, await ownedAgent(c.env.DB, a.user.id, c.req.param('id'))));
});

myAgentsRoutes.put('/:id', async (c) => {
  const a = authOf(c);
  const body = await parseJson(c, agentBodySchema.omit({ workspaceId: true }));
  const db = c.env.DB;
  const agent = await ownedAgent(db, a.user.id, c.req.param('id'));
  if (agent.status === 'suspended') throw new HttpError(409, 'agent_suspended');
  await limitOrThrow(db, `agent:write:${a.user.id}`, WRITES.limit, WRITES.windowSec);
  const latest = await latestVersion(db, agent.id);
  const now = Date.now();
  // Versão publicada é imutável: editar cria um novo rascunho; a vigente segue servindo até publicar.
  const versionId = latest.status === 'draft' ? latest.id : crypto.randomUUID();
  const tools = toolStatements(db, versionId, body.tools);
  const stmts: D1PreparedStatement[] = [
    db
      .prepare('UPDATE agents SET name = ?1, description = ?2, updated_at = ?3 WHERE id = ?4')
      .bind(body.name, body.description, now, agent.id),
  ];
  if (latest.status === 'draft') {
    stmts.push(
      db
        .prepare(
          'UPDATE agent_versions SET objective = ?1, instructions = ?2, output_format = ?3, limits_json = ?4 WHERE id = ?5',
        )
        .bind(
          body.objective,
          body.instructions,
          body.outputFormat,
          JSON.stringify(body.limits),
          versionId,
        ),
      db.prepare('DELETE FROM agent_tools WHERE agent_version_id = ?').bind(versionId),
    );
  } else {
    stmts.push(
      db
        .prepare(
          `INSERT INTO agent_versions (id, agent_id, version, objective, instructions, output_format, limits_json, status, created_by, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'draft', ?8, ?9)`,
        )
        .bind(
          versionId,
          agent.id,
          latest.version + 1,
          body.objective,
          body.instructions,
          body.outputFormat,
          JSON.stringify(body.limits),
          a.user.id,
          now,
        ),
    );
  }
  await db.batch([...stmts, ...tools]);
  return c.json(await detail(db, await ownedAgent(db, a.user.id, agent.id)));
});

myAgentsRoutes.post('/:id/archive', async (c) => {
  const a = authOf(c);
  const db = c.env.DB;
  const agent = await ownedAgent(db, a.user.id, c.req.param('id'));
  await limitOrThrow(db, `agent:write:${a.user.id}`, WRITES.limit, WRITES.windowSec);
  await db
    .prepare(`UPDATE agents SET status = 'archived', updated_at = ? WHERE id = ?`)
    .bind(Date.now(), agent.id)
    .run();
  await audit(getDb(db), {
    action: 'agent.archive',
    actorUserId: a.user.id,
    targetType: 'agent',
    targetId: agent.id,
  });
  return c.json({ archived: true });
});

// ----------------------------------------------------- validar / testar / publicar

myAgentsRoutes.post('/:id/validate', async (c) => {
  const a = authOf(c);
  const agent = await ownedAgent(c.env.DB, a.user.id, c.req.param('id'));
  const issues = validateAgent(await draftOf(c.env.DB, agent));
  const body: ValidateResponse = { issues, ok: !hasErrors(issues) };
  return c.json(body);
});

myAgentsRoutes.post('/:id/test-run', async (c) => {
  const a = authOf(c);
  const { input } = await parseJson(c, testRunSchema);
  const db = c.env.DB;
  const agent = await ownedAgent(db, a.user.id, c.req.param('id'));
  const draft = await draftOf(db, agent);
  const issues = validateAgent(draft);
  if (hasErrors(issues))
    throw new HttpError(422, 'validation_failed', 'Agent is invalid', { issues });
  const limits = agentLimitsSchema.parse(draft.limits);
  const tools = draft.tools.map((t) => ({ key: t.key, config: t.config ?? {} }));
  if (tools.some((t) => getTool(t.key)?.requiresAi) && !getAiProvider(c.env)) {
    throw new HttpError(422, 'ai_not_configured', 'AI is not configured');
  }
  await limitOrThrow(db, `agent:test:${a.user.id}`, TESTS.limit, TESTS.windowSec);
  const r = runPipeline({
    tools,
    input,
    limits,
    outputFormat: (draft.outputFormat ?? 'markdown') as OutputFormat,
  });
  const steps = r.steps.map((s) => ({
    seq: s.seq,
    name: s.name,
    status: s.status,
    error: s.error,
  }));
  const body: TestRunResponse =
    r.status === 'failed'
      ? {
          status: 'failed',
          steps,
          output: null,
          error: r.detail ? `${r.error}:${r.detail}` : r.error,
          persisted: false,
        }
      : { status: r.status, steps, output: r.output, error: null, persisted: false };
  return c.json(body);
});

myAgentsRoutes.post('/:id/publish', async (c) => {
  const a = authOf(c);
  const body = await parseJson(c, publishSchema);
  const db = c.env.DB;
  const agent = await ownedAgent(db, a.user.id, c.req.param('id'));
  if (agent.status === 'suspended') throw new HttpError(409, 'agent_suspended');
  if (body.visibility === 'workspace') {
    throw new HttpError(
      422,
      'visibility_unavailable',
      'Workspace sharing arrives with Companies (Phase 4)',
    );
  }
  if (body.visibility === 'public' && body.confirmPublic !== true) {
    throw new HttpError(
      422,
      'confirmation_required',
      'Publishing to the marketplace needs explicit confirmation',
    );
  }
  if (agent.visibility === 'public' && body.visibility !== 'public') {
    throw new HttpError(
      422,
      'visibility_locked',
      'A public agent cannot go back to private; archive it instead',
    );
  }
  const issues = validateAgent(await draftOf(db, agent));
  if (hasErrors(issues))
    throw new HttpError(422, 'validation_failed', 'Agent is invalid', { issues });
  await limitOrThrow(db, `agent:write:${a.user.id}`, WRITES.limit, WRITES.windowSec);

  const latest = await latestVersion(db, agent.id);
  if (latest.status === 'published')
    throw new HttpError(409, 'nothing_to_publish', 'Version already published');
  const now = Date.now();
  const makePublic = body.visibility === 'public';
  const installWorkspace = agent.workspace_id;
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE agent_versions SET status = 'deprecated' WHERE agent_id = ?1 AND status = 'published' AND id <> ?2`,
      )
      .bind(agent.id, latest.id),
    db.prepare(`UPDATE agent_versions SET status = 'published' WHERE id = ?`).bind(latest.id),
    db
      .prepare(
        `UPDATE agents SET status = 'published', current_version_id = ?1, visibility = ?2,
           workspace_id = CASE WHEN ?2 = 'public' THEN NULL ELSE workspace_id END, updated_at = ?3 WHERE id = ?4`,
      )
      .bind(latest.id, makePublic ? 'public' : 'private', now, agent.id),
  ];
  if (installWorkspace) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO agent_installations (id, agent_id, workspace_id, user_id, installed_version_id, status, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?6)
           ON CONFLICT (agent_id, workspace_id, user_id) DO UPDATE SET status = 'active', installed_version_id = ?5, updated_at = ?6`,
        )
        .bind(crypto.randomUUID(), agent.id, installWorkspace, a.user.id, latest.id, now),
    );
  }
  await db.batch(stmts);
  await audit(getDb(db), {
    action: 'agent.publish',
    actorUserId: a.user.id,
    workspaceId: installWorkspace,
    targetType: 'agent',
    targetId: agent.id,
    metadata: { visibility: makePublic ? 'public' : 'private', version: latest.version },
  });
  return c.json(await detail(db, await ownedAgent(db, a.user.id, agent.id)));
});
