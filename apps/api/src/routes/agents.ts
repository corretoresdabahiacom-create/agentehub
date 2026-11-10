import {
  catalogQuerySchema,
  installSchema,
  REVIEW_QUALIFYING_DAYS,
  reviewSchema,
  type AgentDetail,
  type AgentSummary,
  type CatalogResponse,
  type CategoryInfo,
  type CategoryWithCount,
  type ReviewIneligibleReason,
  type ReviewsResponse,
} from '@agenthub/shared';
import { Hono, type Context } from 'hono';
import { getDb } from '../db/client';
import type { AppEnv } from '../env';
import { audit } from '../lib/audit';
import { HttpError, parseJson } from '../lib/http';
import { rateLimit } from '../lib/rate-limit';
import { requireAuth } from '../middleware/authz';

/**
 * Marketplace (Fase 2). Somente agentes PÚBLICOS e PUBLICADOS (com versão vigente) aparecem aqui;
 * agentes privados/de workspace são tratados nas Fases 3-4 e respondem 404 neste módulo.
 * Todo SQL usa parâmetros ligados; fragmentos dinâmicos vêm de tabelas fixas (sem texto do usuário).
 */
export const agentsRoutes = new Hono<AppEnv>();
export const categoriesRoutes = new Hono<AppEnv>();

const VISIBLE = `a.visibility = 'public' AND a.status = 'published' AND a.current_version_id IS NOT NULL`;
const ORDER: Record<string, string> = {
  newest: 'a.created_at DESC, a.id',
  name: 'a.name COLLATE NOCASE ASC, a.id',
  rating: 'rating_avg IS NULL, rating_avg DESC, rating_count DESC, a.id',
  popular: 'install_count DESC, a.created_at DESC, a.id',
};
const DAY_MS = 24 * 3600 * 1000;

// Escritas do marketplace por usuário: limite generoso para uso humano, barreira contra script.
const WRITES_PER_USER = { limit: 60, windowSec: 600 };

const like = (q: string) => `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

function auth(c: Context<AppEnv>) {
  const a = c.var.auth;
  if (!a) throw new HttpError(401, 'unauthenticated', 'Authentication required');
  return a;
}

async function limitWrites(c: Context<AppEnv>, userId: string) {
  const r = await rateLimit(
    c.env.DB,
    `mkt:write:${userId}`,
    WRITES_PER_USER.limit,
    WRITES_PER_USER.windowSec,
  );
  if (!r.allowed) {
    throw new HttpError(429, 'rate_limited', 'Too many requests', undefined, {
      'Retry-After': String(r.retryAfterSec),
    });
  }
}

interface AgentRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  is_demo: number;
  created_at: number;
  rating_avg: number | null;
  rating_count: number;
  install_count: number;
}

const SUMMARY_COLUMNS = `a.id, a.slug, a.name, a.description, a.is_demo, a.created_at,
  (SELECT ROUND(AVG(r.rating), 2) FROM agent_reviews r WHERE r.agent_id = a.id AND r.status = 'visible') AS rating_avg,
  (SELECT COUNT(*) FROM agent_reviews r WHERE r.agent_id = a.id AND r.status = 'visible') AS rating_count,
  (SELECT COUNT(*) FROM agent_installations i WHERE i.agent_id = a.id AND i.status = 'active') AS install_count`;

async function toSummaries(
  db: D1Database,
  rows: AgentRow[],
  userId: string | null,
): Promise<AgentSummary[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => '?').join(',');

  const cats = await db
    .prepare(
      `SELECT ac.agent_id, c.slug, c.name_en, c.name_pt, c.name_es
       FROM agent_categories ac JOIN categories c ON c.id = ac.category_id
       WHERE ac.agent_id IN (${marks}) ORDER BY c.sort_order`,
    )
    .bind(...ids)
    .all<{
      agent_id: string;
      slug: string;
      name_en: string;
      name_pt: string;
      name_es: string | null;
    }>();
  const byAgent = new Map<string, CategoryInfo[]>();
  for (const c of cats.results) {
    const list = byAgent.get(c.agent_id) ?? [];
    list.push({ slug: c.slug, nameEn: c.name_en, namePt: c.name_pt, nameEs: c.name_es });
    byAgent.set(c.agent_id, list);
  }

  let favs = new Set<string>();
  const installs = new Map<string, string[]>();
  if (userId) {
    const f = await db
      .prepare(`SELECT agent_id FROM favorites WHERE user_id = ? AND agent_id IN (${marks})`)
      .bind(userId, ...ids)
      .all<{ agent_id: string }>();
    favs = new Set(f.results.map((x) => x.agent_id));
    const i = await db
      .prepare(
        `SELECT agent_id, workspace_id FROM agent_installations
         WHERE user_id = ? AND status = 'active' AND agent_id IN (${marks})`,
      )
      .bind(userId, ...ids)
      .all<{ agent_id: string; workspace_id: string }>();
    for (const x of i.results) {
      installs.set(x.agent_id, [...(installs.get(x.agent_id) ?? []), x.workspace_id]);
    }
  }

  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    description: r.description,
    isDemo: r.is_demo === 1,
    categories: byAgent.get(r.id) ?? [],
    ratingAvg: r.rating_count > 0 ? r.rating_avg : null,
    ratingCount: r.rating_count,
    installCount: r.install_count,
    createdAt: r.created_at,
    ...(userId
      ? { favorited: favs.has(r.id), installedWorkspaceIds: installs.get(r.id) ?? [] }
      : {}),
  }));
}

async function findAgent(db: D1Database, slug: string) {
  const row = await db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS}, a.current_version_id FROM agents a WHERE a.slug = ? AND ${VISIBLE}`,
    )
    .bind(slug)
    .first<AgentRow & { current_version_id: string }>();
  if (!row) throw new HttpError(404, 'not_found');
  return row;
}

/** Elegibilidade para avaliar: instalação do usuário + execução concluída nos últimos 90 dias. */
export async function reviewEligibility(
  db: D1Database,
  userId: string,
  agentId: string,
  nowMs = Date.now(),
): Promise<
  { eligible: true; installationId: string } | { eligible: false; reason: ReviewIneligibleReason }
> {
  const since = nowMs - REVIEW_QUALIFYING_DAYS * DAY_MS;
  const ok = await db
    .prepare(
      `SELECT i.id FROM agent_installations i
       JOIN agent_executions e ON e.installation_id = i.id
       WHERE i.agent_id = ?1 AND i.user_id = ?2
         AND e.user_id = ?2 AND e.status = 'completed' AND e.finished_at >= ?3
       ORDER BY e.finished_at DESC LIMIT 1`,
    )
    .bind(agentId, userId, since)
    .first<{ id: string }>();
  if (ok) return { eligible: true, installationId: ok.id };
  const anyInstall = await db
    .prepare('SELECT 1 AS x FROM agent_installations WHERE agent_id = ?1 AND user_id = ?2 LIMIT 1')
    .bind(agentId, userId)
    .first();
  return {
    eligible: false,
    reason: anyInstall ? 'no_recent_completed_execution' : 'not_installed',
  };
}

// ------------------------------------------------------------------ categorias

categoriesRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT c.slug, c.name_en, c.name_pt, c.name_es,
       (SELECT COUNT(*) FROM agent_categories ac JOIN agents a ON a.id = ac.agent_id
         WHERE ac.category_id = c.id AND ${VISIBLE}) AS agent_count
     FROM categories c ORDER BY c.sort_order`,
  ).all<{
    slug: string;
    name_en: string;
    name_pt: string;
    name_es: string | null;
    agent_count: number;
  }>();
  const categories: CategoryWithCount[] = results.map((r) => ({
    slug: r.slug,
    nameEn: r.name_en,
    namePt: r.name_pt,
    nameEs: r.name_es,
    agentCount: r.agent_count,
  }));
  return c.json({ categories });
});

// ------------------------------------------------------------------- catálogo

agentsRoutes.get('/', async (c) => {
  const parsed = catalogQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code }));
    throw new HttpError(400, 'validation_error', 'Invalid query', issues);
  }
  const q = parsed.data;
  const userId = c.var.auth?.user.id ?? null;
  if (q.scope !== 'all' && !userId) {
    throw new HttpError(401, 'unauthenticated', 'Authentication required');
  }

  const where: string[] = [VISIBLE];
  const binds: (string | number)[] = [];
  if (q.q) {
    where.push(`(a.name LIKE ? ESCAPE '\\' OR a.description LIKE ? ESCAPE '\\')`);
    binds.push(like(q.q), like(q.q));
  }
  if (q.category) {
    where.push(
      `EXISTS (SELECT 1 FROM agent_categories ac JOIN categories c ON c.id = ac.category_id
               WHERE ac.agent_id = a.id AND c.slug = ?)`,
    );
    binds.push(q.category);
  }
  if (q.scope === 'favorites') {
    where.push('EXISTS (SELECT 1 FROM favorites f WHERE f.agent_id = a.id AND f.user_id = ?)');
    binds.push(userId as string);
  } else if (q.scope === 'installed') {
    where.push(
      `EXISTS (SELECT 1 FROM agent_installations i WHERE i.agent_id = a.id AND i.user_id = ? AND i.status = 'active')`,
    );
    binds.push(userId as string);
  }
  const whereSql = where.join(' AND ');
  const order = ORDER[q.sort] ?? (ORDER['newest'] as string);

  const [rows, count] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT ${SUMMARY_COLUMNS} FROM agents a WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ).bind(...binds, q.pageSize, (q.page - 1) * q.pageSize),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM agents a WHERE ${whereSql}`).bind(...binds),
  ]);
  const body: CatalogResponse = {
    agents: await toSummaries(c.env.DB, (rows as D1Result<AgentRow>).results, userId),
    total: ((count as D1Result<{ n: number }>).results[0]?.n ?? 0) as number,
    page: q.page,
    pageSize: q.pageSize,
  };
  return c.json(body);
});

agentsRoutes.get('/:slug', async (c) => {
  const db = c.env.DB;
  const userId = c.var.auth?.user.id ?? null;
  const row = await findAgent(db, c.req.param('slug'));
  const [summary] = await toSummaries(db, [row], userId);
  if (!summary) throw new HttpError(404, 'not_found');

  const version = await db
    .prepare('SELECT id, version, objective, output_format FROM agent_versions WHERE id = ?')
    .bind(row.current_version_id)
    .first<{ id: string; version: number; objective: string; output_format: string }>();
  if (!version) throw new HttpError(404, 'not_found');
  const tools = await db
    .prepare('SELECT tool_key FROM agent_tools WHERE agent_version_id = ? ORDER BY tool_key')
    .bind(version.id)
    .all<{ tool_key: string }>();

  const detail: AgentDetail = {
    ...summary,
    objective: version.objective,
    outputFormat: version.output_format,
    tools: tools.results.map((t) => t.tool_key),
    version: version.version,
  };
  if (userId) {
    const elig = await reviewEligibility(db, userId, row.id);
    const mine = await db
      .prepare(
        'SELECT rating, body, verified FROM agent_reviews WHERE agent_id = ? AND user_id = ?',
      )
      .bind(row.id, userId)
      .first<{ rating: number; body: string | null; verified: number }>();
    detail.viewer = {
      canReview: elig.eligible,
      reviewIneligibleReason: elig.eligible ? null : elig.reason,
      myReview: mine
        ? { rating: mine.rating, body: mine.body, verified: mine.verified === 1 }
        : null,
    };
  }
  return c.json(detail);
});

agentsRoutes.get('/:slug/reviews', async (c) => {
  const db = c.env.DB;
  const userId = c.var.auth?.user.id ?? null;
  const row = await findAgent(db, c.req.param('slug'));
  const page = Math.min(1000, Math.max(1, Number.parseInt(c.req.query('page') ?? '1', 10) || 1));
  const pageSize = 10;
  const { results } = await db
    .prepare(
      `SELECT id, user_id, rating, body, verified, created_at FROM agent_reviews
       WHERE agent_id = ? AND status = 'visible' ORDER BY created_at DESC, id LIMIT ? OFFSET ?`,
    )
    .bind(row.id, pageSize, (page - 1) * pageSize)
    .all<{
      id: string;
      user_id: string;
      rating: number;
      body: string | null;
      verified: number;
      created_at: number;
    }>();
  const body: ReviewsResponse = {
    reviews: results.map((r) => ({
      id: r.id,
      rating: r.rating,
      body: r.body,
      verified: r.verified === 1,
      createdAt: r.created_at,
      mine: userId !== null && r.user_id === userId,
    })),
    ratingAvg: row.rating_count > 0 ? row.rating_avg : null,
    ratingCount: row.rating_count,
    page,
    pageSize,
  };
  return c.json(body);
});

// ------------------------------------------------------- ações autenticadas

agentsRoutes.post('/:slug/install', requireAuth, async (c) => {
  const a = auth(c);
  const { workspaceId } = await parseJson(c, installSchema);
  const db = c.env.DB;
  const agent = await findAgent(db, c.req.param('slug'));
  // Só instala em workspace do qual o usuário é membro (404 caso contrário, sem revelar nada).
  const member = await db
    .prepare('SELECT 1 AS x FROM workspace_members WHERE user_id = ? AND workspace_id = ?')
    .bind(a.user.id, workspaceId)
    .first();
  if (!member) throw new HttpError(404, 'not_found');
  await limitWrites(c, a.user.id);

  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO agent_installations (id, agent_id, workspace_id, user_id, installed_version_id, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?6)
       ON CONFLICT (agent_id, workspace_id, user_id)
       DO UPDATE SET status = 'active', installed_version_id = ?5, updated_at = ?6`,
    )
    .bind(crypto.randomUUID(), agent.id, workspaceId, a.user.id, agent.current_version_id, now)
    .run();
  await audit(getDb(db), {
    action: 'agent.install',
    actorUserId: a.user.id,
    workspaceId,
    targetType: 'agent',
    targetId: agent.id,
  });
  return c.json({ installed: true, workspaceId });
});

agentsRoutes.delete('/:slug/install/:workspaceId', requireAuth, async (c) => {
  const a = auth(c);
  const db = c.env.DB;
  const agent = await findAgent(db, c.req.param('slug'));
  await limitWrites(c, a.user.id);
  // Escopo pelo usuário da sessão: ninguém desinstala a instalação de outro.
  const res = await db
    .prepare(
      `UPDATE agent_installations SET status = 'uninstalled', updated_at = ?1
       WHERE agent_id = ?2 AND workspace_id = ?3 AND user_id = ?4 AND status = 'active'`,
    )
    .bind(Date.now(), agent.id, c.req.param('workspaceId'), a.user.id)
    .run();
  if (res.meta.changes === 0) throw new HttpError(404, 'not_found');
  await audit(getDb(db), {
    action: 'agent.uninstall',
    actorUserId: a.user.id,
    workspaceId: c.req.param('workspaceId'),
    targetType: 'agent',
    targetId: agent.id,
  });
  return c.json({ installed: false });
});

agentsRoutes.put('/:slug/favorite', requireAuth, async (c) => {
  const a = auth(c);
  const agent = await findAgent(c.env.DB, c.req.param('slug'));
  await limitWrites(c, a.user.id);
  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO favorites (user_id, agent_id, created_at) VALUES (?, ?, ?)',
  )
    .bind(a.user.id, agent.id, Date.now())
    .run();
  return c.json({ favorited: true });
});

agentsRoutes.delete('/:slug/favorite', requireAuth, async (c) => {
  const a = auth(c);
  const agent = await findAgent(c.env.DB, c.req.param('slug'));
  await limitWrites(c, a.user.id);
  await c.env.DB.prepare('DELETE FROM favorites WHERE user_id = ? AND agent_id = ?')
    .bind(a.user.id, agent.id)
    .run();
  return c.json({ favorited: false });
});

agentsRoutes.put('/:slug/review', requireAuth, async (c) => {
  const a = auth(c);
  const input = await parseJson(c, reviewSchema);
  const db = c.env.DB;
  const agent = await findAgent(db, c.req.param('slug'));
  const elig = await reviewEligibility(db, a.user.id, agent.id);
  if (!elig.eligible) {
    throw new HttpError(403, 'review_not_qualified', 'Only verified users can review this agent', {
      reason: elig.reason,
    });
  }
  await limitWrites(c, a.user.id);
  const now = Date.now();
  // O status (visível/oculto, definido por moderação) NÃO é alterado ao editar a própria avaliação.
  await db
    .prepare(
      `INSERT INTO agent_reviews (id, agent_id, user_id, installation_id, rating, body, verified, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 'visible', ?7, ?7)
       ON CONFLICT (agent_id, user_id)
       DO UPDATE SET rating = ?5, body = ?6, installation_id = ?4, verified = 1, updated_at = ?7`,
    )
    .bind(
      crypto.randomUUID(),
      agent.id,
      a.user.id,
      elig.installationId,
      input.rating,
      input.body ?? null,
      now,
    )
    .run();
  await audit(getDb(db), {
    action: 'agent.review',
    actorUserId: a.user.id,
    targetType: 'agent',
    targetId: agent.id,
    metadata: { rating: input.rating },
  });
  return c.json({ rating: input.rating, body: input.body ?? null, verified: true });
});

agentsRoutes.delete('/:slug/review', requireAuth, async (c) => {
  const a = auth(c);
  const db = c.env.DB;
  const agent = await findAgent(db, c.req.param('slug'));
  await limitWrites(c, a.user.id);
  const res = await db
    .prepare('DELETE FROM agent_reviews WHERE agent_id = ? AND user_id = ?')
    .bind(agent.id, a.user.id)
    .run();
  if (res.meta.changes === 0) throw new HttpError(404, 'not_found');
  await audit(getDb(db), {
    action: 'agent.review_delete',
    actorUserId: a.user.id,
    targetType: 'agent',
    targetId: agent.id,
  });
  return c.json({ deleted: true });
});
