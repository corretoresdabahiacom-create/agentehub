import type {
  AgentDetail,
  CatalogResponse,
  CategoryWithCount,
  ReviewsResponse,
} from '@agenthub/shared';
import { describe, expect, it } from 'vitest';
import { call, db, signup } from './helpers';

const DAY = 24 * 3600 * 1000;

// ------------------------------------------------------------------ fixtures
let creatorId: string | null = null;
async function creator(): Promise<string> {
  if (creatorId) return creatorId;
  creatorId = crypto.randomUUID();
  // Publicador de demonstração: hash inválido + suspenso => não consegue logar nunca.
  await db()
    .prepare(
      `INSERT INTO users (id, email, password_hash, status) VALUES (?, ?, 'disabled', 'suspended')`,
    )
    .bind(creatorId, `publisher-${creatorId}@agenthub.invalid`)
    .run();
  return creatorId;
}

interface AgentFixture {
  id: string;
  versionId: string | null;
  slug: string;
  name: string;
}

async function makeAgent(
  over: Partial<{
    name: string;
    description: string;
    visibility: 'public' | 'private' | 'workspace';
    status: 'draft' | 'published' | 'suspended' | 'archived';
    withVersion: boolean;
    isDemo: boolean;
    categories: string[];
    tools: string[];
    createdAt: number;
    workspaceId: string;
  }> = {},
): Promise<AgentFixture> {
  const id = crypto.randomUUID();
  const slug = `agent-${id.slice(0, 12)}`;
  const name = over.name ?? `Agent ${id.slice(0, 8)}`;
  const visibility = over.visibility ?? 'public';
  const versionId = over.withVersion === false ? null : crypto.randomUUID();
  const by = await creator();
  const stmts = [
    db()
      .prepare(
        `INSERT INTO agents (id, workspace_id, creator_user_id, slug, name, description, visibility, status, current_version_id, is_demo, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)`,
      )
      .bind(
        id,
        visibility === 'public' ? null : (over.workspaceId ?? null),
        by,
        slug,
        name,
        over.description ?? 'A test agent',
        visibility,
        over.status ?? 'published',
        versionId,
        over.isDemo ? 1 : 0,
        over.createdAt ?? Date.now(),
      ),
  ];
  if (versionId) {
    stmts.push(
      db()
        .prepare(
          `INSERT INTO agent_versions (id, agent_id, version, objective, output_format, status, created_by)
           VALUES (?, ?, 1, 'Do the thing', 'markdown', 'published', ?)`,
        )
        .bind(versionId, id, by),
    );
    for (const tool of over.tools ?? []) {
      stmts.push(
        db()
          .prepare('INSERT INTO agent_tools (id, agent_version_id, tool_key) VALUES (?, ?, ?)')
          .bind(crypto.randomUUID(), versionId, tool),
      );
    }
  }
  for (const cat of over.categories ?? []) {
    stmts.push(
      db()
        .prepare(
          'INSERT INTO agent_categories (agent_id, category_id) SELECT ?, id FROM categories WHERE slug = ?',
        )
        .bind(id, cat),
    );
  }
  await db().batch(stmts);
  return { id, versionId, slug, name };
}

async function userIdOf(email: string): Promise<string> {
  const row = await db()
    .prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string }>();
  if (!row) throw new Error('usuário não encontrado');
  return row.id;
}

async function workspaceOf(cookie: string): Promise<string> {
  const me = (await (await call('/api/auth/me', { cookie })).json()) as {
    memberships: Array<{ workspaceId: string }>;
  };
  const id = me.memberships[0]?.workspaceId;
  if (!id) throw new Error('sem workspace');
  return id;
}

async function install(cookie: string, slug: string, workspaceId: string) {
  return call(`/api/agents/${slug}/install`, { cookie, body: { workspaceId } });
}

/** Cria uma execução para a instalação (fixture direta: a execução real só existe na Fase 3). */
async function execution(
  agent: AgentFixture,
  userId: string,
  workspaceId: string,
  status: string,
  finishedAt: number | null,
  asUserId = userId,
) {
  const inst = await db()
    .prepare(
      'SELECT id FROM agent_installations WHERE agent_id = ? AND user_id = ? AND workspace_id = ?',
    )
    .bind(agent.id, userId, workspaceId)
    .first<{ id: string }>();
  await db()
    .prepare(
      `INSERT INTO agent_executions (id, agent_id, agent_version_id, installation_id, workspace_id, user_id, status, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      agent.id,
      agent.versionId,
      inst?.id ?? null,
      workspaceId,
      asUserId,
      status,
      finishedAt,
    )
    .run();
}

async function catalog(qs: string, cookie?: string) {
  const res = await call(`/api/agents?${qs}`, cookie ? { cookie } : {});
  return { res, body: (await res.json()) as CatalogResponse };
}

const marker = () => `zz${crypto.randomUUID().slice(0, 10).replace(/-/g, '')}`;

// --------------------------------------------------------------------- testes
describe('catálogo (público, dados reais do D1)', () => {
  it('lista somente agentes públicos, publicados e com versão vigente', async () => {
    const m = marker();
    const ok = await makeAgent({ name: `${m} visible` });
    await makeAgent({ name: `${m} draft`, status: 'draft' });
    await makeAgent({ name: `${m} suspended`, status: 'suspended' });
    await makeAgent({ name: `${m} archived`, status: 'archived' });
    await makeAgent({ name: `${m} noversion`, withVersion: false });
    const u = await signup();
    await makeAgent({
      name: `${m} private`,
      visibility: 'private',
      workspaceId: await workspaceOf(u.cookie ?? ''),
    });

    const { res, body } = await catalog(`q=${m}`);
    expect(res.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.agents.map((a) => a.slug)).toEqual([ok.slug]);
    // Anônimo: sem campos por-usuário.
    expect(body.agents[0]).not.toHaveProperty('favorited');
  });

  it('busca por nome e descrição, sem diferenciar maiúsculas, e trata % e _ como texto', async () => {
    const m = marker();
    await makeAgent({ name: `${m} Report Builder`, description: 'builds weekly reports' });
    await makeAgent({ name: `${m} Other`, description: 'discount of 100% off_peak' });
    // Sem diferenciar maiúsculas/minúsculas (nome em maiúsculas + descrição em minúsculas).
    expect((await catalog(`q=${m.toUpperCase()}+REPORT`)).body.total).toBe(1);
    expect((await catalog(`q=${m}`)).body.total).toBe(2);
    expect((await catalog(`q=WEEKLY+REPORTS`)).body.agents.some((a) => a.name.startsWith(m))).toBe(
      true,
    );
    // % e _ literais: só a descrição com "100% off_peak" casa.
    const pct = await catalog(`q=${encodeURIComponent('100% off_peak')}`);
    expect(pct.body.agents.filter((a) => a.name.startsWith(m)).map((a) => a.name)).toEqual([
      `${m} Other`,
    ]);
    const wild = await catalog(`q=${encodeURIComponent('%')}`);
    expect(wild.body.total).toBeLessThan(1000);
    expect(wild.body.agents.every((a) => (a.name + a.description).includes('%'))).toBe(true);
    // Tentativa de injeção é só texto.
    const inj = await catalog(`q=${encodeURIComponent("'; DROP TABLE agents; --")}`);
    expect(inj.res.status).toBe(200);
    expect((await catalog(`q=${m}`)).body.total).toBe(2);
  });

  it('filtra por categoria e conta categorias com valores reais', async () => {
    const m = marker();
    await makeAgent({ name: `${m} a`, categories: ['research'] });
    await makeAgent({ name: `${m} b`, categories: ['research', 'documents'] });
    await makeAgent({ name: `${m} c`, categories: ['documents'] });
    await makeAgent({ name: `${m} d`, categories: ['documents'], status: 'draft' });

    const research = await catalog(`q=${m}&category=research`);
    expect(research.body.total).toBe(2);
    expect(research.body.agents.every((a) => a.categories.some((c) => c.slug === 'research'))).toBe(
      true,
    );
    expect((await catalog(`q=${m}&category=documents`)).body.total).toBe(2); // rascunho não conta
    expect((await catalog(`q=${m}&category=nope`)).body.total).toBe(0);

    const cats = (await (await call('/api/categories')).json()) as {
      categories: CategoryWithCount[];
    };
    expect(cats.categories.map((c) => c.slug)).toEqual(
      expect.arrayContaining(['research', 'documents', 'social-media', 'productivity', 'data']),
    );
    expect(cats.categories.find((c) => c.slug === 'research')?.agentCount).toBeGreaterThanOrEqual(
      2,
    );
  });

  it('ordena por nome, novidade, avaliação e popularidade', async () => {
    const m = marker();
    const now = Date.now();
    const a = await makeAgent({ name: `${m} Bravo`, createdAt: now - 3000 });
    const b = await makeAgent({ name: `${m} alpha`, createdAt: now - 2000 });
    const c = await makeAgent({ name: `${m} Charlie`, createdAt: now - 1000 });
    const names = async (sort: string) =>
      (await catalog(`q=${m}&sort=${sort}`)).body.agents.map((x) => x.name.replace(`${m} `, ''));
    expect(await names('name')).toEqual(['alpha', 'Bravo', 'Charlie']);
    expect(await names('newest')).toEqual(['Charlie', 'alpha', 'Bravo']);

    // Popularidade: Bravo 2 instalações, alpha 1, Charlie 0.
    const u1 = await signup();
    const u2 = await signup();
    await install(u1.cookie ?? '', a.slug, await workspaceOf(u1.cookie ?? ''));
    await install(u2.cookie ?? '', a.slug, await workspaceOf(u2.cookie ?? ''));
    await install(u1.cookie ?? '', b.slug, await workspaceOf(u1.cookie ?? ''));
    expect(await names('popular')).toEqual(['Bravo', 'alpha', 'Charlie']);

    // Avaliação: Charlie 5, alpha 3, Bravo sem avaliações (vai por último, nunca "0").
    for (const [agent, who, stars] of [
      [c, u1, 5],
      [b, u1, 3],
    ] as const) {
      const ws = await workspaceOf(who.cookie ?? '');
      await install(who.cookie ?? '', agent.slug, ws);
      await execution(agent, await userIdOf(who.email), ws, 'completed', Date.now() - DAY);
      const r = await call(`/api/agents/${agent.slug}/review`, {
        method: 'PUT',
        cookie: who.cookie ?? '',
        body: { rating: stars },
      });
      expect(r.status).toBe(200);
    }
    expect(await names('rating')).toEqual(['Charlie', 'alpha', 'Bravo']);
    const rated = (await catalog(`q=${m}&sort=rating`)).body.agents;
    expect(rated[0]?.ratingAvg).toBe(5);
    expect(rated[2]?.ratingAvg).toBeNull();
    expect(rated[2]?.ratingCount).toBe(0);
  });

  it('pagina com total real e limita o tamanho da página', async () => {
    const m = marker();
    for (let i = 0; i < 5; i++) await makeAgent({ name: `${m} ${i}` });
    const p1 = await catalog(`q=${m}&pageSize=2&page=1&sort=name`);
    const p3 = await catalog(`q=${m}&pageSize=2&page=3&sort=name`);
    expect(p1.body.total).toBe(5);
    expect(p1.body.agents).toHaveLength(2);
    expect(p3.body.agents).toHaveLength(1);
    expect((await catalog(`q=${m}&pageSize=100`)).res.status).toBe(400);
    expect((await catalog(`q=${m}&page=0`)).res.status).toBe(400);
    expect((await catalog(`sort=hax`)).res.status).toBe(400);
    expect((await catalog(`category=${encodeURIComponent('x y')}`)).res.status).toBe(400);
    expect((await catalog(`q=${'a'.repeat(81)}`)).res.status).toBe(400);
  });

  it('escopos favorites/installed exigem sessão e só mostram dados do próprio usuário', async () => {
    const m = marker();
    const a = await makeAgent({ name: `${m} a` });
    await makeAgent({ name: `${m} b` });
    expect((await catalog('scope=favorites')).res.status).toBe(401);
    expect((await catalog('scope=installed')).res.status).toBe(401);

    const u = await signup();
    const other = await signup();
    await call(`/api/agents/${a.slug}/favorite`, { method: 'PUT', cookie: u.cookie ?? '' });
    await install(u.cookie ?? '', a.slug, await workspaceOf(u.cookie ?? ''));
    const mine = await catalog(`q=${m}&scope=favorites`, u.cookie ?? '');
    expect(mine.body.agents.map((x) => x.slug)).toEqual([a.slug]);
    expect((await catalog(`q=${m}&scope=installed`, u.cookie ?? '')).body.total).toBe(1);
    expect((await catalog(`q=${m}&scope=favorites`, other.cookie ?? '')).body.total).toBe(0);
    expect((await catalog(`q=${m}&scope=installed`, other.cookie ?? '')).body.total).toBe(0);
  });
});

describe('página do agente', () => {
  it('mostra dados reais, marca demo e não vaza agentes não publicados', async () => {
    const real = await makeAgent({
      tools: ['text.summarize', 'text.format'],
      categories: ['documents'],
    });
    const demo = await makeAgent({ isDemo: true });
    const r = await call(`/api/agents/${real.slug}`);
    expect(r.status).toBe(200);
    const d = (await r.json()) as AgentDetail;
    expect(d.isDemo).toBe(false);
    expect(d.tools).toEqual(['text.format', 'text.summarize']);
    expect(d.objective).toBe('Do the thing');
    expect(d.version).toBe(1);
    expect(d).not.toHaveProperty('viewer');
    expect(((await (await call(`/api/agents/${demo.slug}`)).json()) as AgentDetail).isDemo).toBe(
      true,
    );

    const draft = await makeAgent({ status: 'draft' });
    const priv = await makeAgent({
      visibility: 'private',
      workspaceId: await workspaceOf((await signup()).cookie ?? ''),
    });
    expect((await call(`/api/agents/${draft.slug}`)).status).toBe(404);
    expect((await call(`/api/agents/${priv.slug}`)).status).toBe(404);
    expect((await call('/api/agents/nao-existe')).status).toBe(404);
  });

  it('o publicador de demonstração nunca consegue autenticar', async () => {
    await creator();
    const email = (
      await db()
        .prepare('SELECT email FROM users WHERE id = ?')
        .bind(creatorId)
        .first<{ email: string }>()
    )?.email;
    const res = await call('/api/auth/login', { body: { email, password: 'disabled' } });
    expect(res.status).toBe(401);
  });
});

describe('instalar e favoritar', () => {
  it('exige sessão, workspace próprio e é idempotente', async () => {
    const agent = await makeAgent();
    expect(
      (await call(`/api/agents/${agent.slug}/install`, { body: { workspaceId: 'x' } })).status,
    ).toBe(401);
    expect((await call(`/api/agents/${agent.slug}/favorite`, { method: 'PUT' })).status).toBe(401);

    const a = await signup();
    const b = await signup();
    const wsA = await workspaceOf(a.cookie ?? '');
    const wsB = await workspaceOf(b.cookie ?? '');

    // ISOLAMENTO: A não instala no workspace de B (404, sem revelar).
    expect((await install(a.cookie ?? '', agent.slug, wsB)).status).toBe(404);
    expect((await install(a.cookie ?? '', agent.slug, crypto.randomUUID())).status).toBe(404);

    expect((await install(a.cookie ?? '', agent.slug, wsA)).status).toBe(200);
    expect((await install(a.cookie ?? '', agent.slug, wsA)).status).toBe(200); // idempotente
    const rows = await db()
      .prepare(
        'SELECT COUNT(*) AS n, MAX(installed_version_id) AS v FROM agent_installations WHERE agent_id = ?',
      )
      .bind(agent.id)
      .first<{ n: number; v: string }>();
    expect(rows?.n).toBe(1);
    expect(rows?.v).toBe(agent.versionId);

    const d = (await (
      await call(`/api/agents/${agent.slug}`, { cookie: a.cookie ?? '' })
    ).json()) as AgentDetail;
    expect(d.installedWorkspaceIds).toEqual([wsA]);
    // B não enxerga a instalação de A.
    const db_ = (await (
      await call(`/api/agents/${agent.slug}`, { cookie: b.cookie ?? '' })
    ).json()) as AgentDetail;
    expect(db_.installedWorkspaceIds).toEqual([]);
    expect(d.installCount).toBe(1);

    // Auditoria da instalação, sem segredos.
    const audit = await db()
      .prepare(
        "SELECT action, workspace_id, target_id FROM audit_logs WHERE action = 'agent.install' AND target_id = ?",
      )
      .bind(agent.id)
      .all<{ workspace_id: string }>();
    expect(audit.results.length).toBeGreaterThanOrEqual(1);
    expect(audit.results[0]?.workspace_id).toBe(wsA);
  });

  it('desinstala só a própria instalação e permite reinstalar', async () => {
    const agent = await makeAgent();
    const a = await signup();
    const b = await signup();
    const wsA = await workspaceOf(a.cookie ?? '');
    await install(a.cookie ?? '', agent.slug, wsA);

    // B tenta desinstalar a instalação de A: 404.
    const hijack = await call(`/api/agents/${agent.slug}/install/${wsA}`, {
      method: 'DELETE',
      cookie: b.cookie ?? '',
    });
    expect(hijack.status).toBe(404);
    const mine = await call(`/api/agents/${agent.slug}/install/${wsA}`, {
      method: 'DELETE',
      cookie: a.cookie ?? '',
    });
    expect(mine.status).toBe(200);
    expect(
      (
        await call(`/api/agents/${agent.slug}/install/${wsA}`, {
          method: 'DELETE',
          cookie: a.cookie ?? '',
        })
      ).status,
    ).toBe(404);
    expect((await install(a.cookie ?? '', agent.slug, wsA)).status).toBe(200);
    const d = (await (
      await call(`/api/agents/${agent.slug}`, { cookie: a.cookie ?? '' })
    ).json()) as AgentDetail;
    expect(d.installedWorkspaceIds).toEqual([wsA]);
  });

  it('não instala nem favorita agentes não publicados', async () => {
    const draft = await makeAgent({ status: 'draft' });
    const u = await signup();
    const ws = await workspaceOf(u.cookie ?? '');
    expect((await install(u.cookie ?? '', draft.slug, ws)).status).toBe(404);
    expect(
      (await call(`/api/agents/${draft.slug}/favorite`, { method: 'PUT', cookie: u.cookie ?? '' }))
        .status,
    ).toBe(404);
  });

  it('favoritar e desfavoritar é idempotente', async () => {
    const agent = await makeAgent();
    const u = await signup();
    for (let i = 0; i < 2; i++) {
      expect(
        (
          await call(`/api/agents/${agent.slug}/favorite`, {
            method: 'PUT',
            cookie: u.cookie ?? '',
          })
        ).status,
      ).toBe(200);
    }
    const d1 = (await (
      await call(`/api/agents/${agent.slug}`, { cookie: u.cookie ?? '' })
    ).json()) as AgentDetail;
    expect(d1.favorited).toBe(true);
    for (let i = 0; i < 2; i++) {
      expect(
        (
          await call(`/api/agents/${agent.slug}/favorite`, {
            method: 'DELETE',
            cookie: u.cookie ?? '',
          })
        ).status,
      ).toBe(200);
    }
    const d2 = (await (
      await call(`/api/agents/${agent.slug}`, { cookie: u.cookie ?? '' })
    ).json()) as AgentDetail;
    expect(d2.favorited).toBe(false);
  });

  it('ações com efeito colateral exigem Origin válido (CSRF)', async () => {
    const agent = await makeAgent();
    const u = await signup();
    const res = await call(`/api/agents/${agent.slug}/favorite`, {
      method: 'PUT',
      cookie: u.cookie ?? '',
      origin: 'https://evil.example',
    });
    expect(res.status).toBe(403);
    const none = await call(`/api/agents/${agent.slug}/favorite`, {
      method: 'PUT',
      cookie: u.cookie ?? '',
      origin: false,
    });
    expect(none.status).toBe(403);
  });

  it('limita escritas por usuário (429 com Retry-After)', async () => {
    const agent = await makeAgent();
    const u = await signup();
    let last: Response | null = null;
    for (let i = 0; i < 62; i++) {
      last = await call(`/api/agents/${agent.slug}/favorite`, {
        method: i % 2 ? 'DELETE' : 'PUT',
        cookie: u.cookie ?? '',
      });
      if (last.status === 429) break;
    }
    expect(last?.status).toBe(429);
    expect(Number(last?.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('avaliações qualificadas', () => {
  async function setup() {
    const agent = await makeAgent();
    const u = await signup();
    const ws = await workspaceOf(u.cookie ?? '');
    const uid = await userIdOf(u.email);
    return { agent, u, ws, uid, cookie: u.cookie ?? '' };
  }
  const review = (cookie: string, slug: string, rating = 4, body?: string) =>
    call(`/api/agents/${slug}/review`, {
      method: 'PUT',
      cookie,
      body: { rating, ...(body ? { body } : {}) },
    });

  it('exige sessão', async () => {
    const { agent } = await setup();
    expect(
      (await call(`/api/agents/${agent.slug}/review`, { method: 'PUT', body: { rating: 5 } }))
        .status,
    ).toBe(401);
  });

  it('recusa sem instalação (not_installed)', async () => {
    const { agent, cookie } = await setup();
    const res = await review(cookie, agent.slug);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; details: { reason: string } } };
    expect(body.error.code).toBe('review_not_qualified');
    expect(body.error.details.reason).toBe('not_installed');
    const d = (await (await call(`/api/agents/${agent.slug}`, { cookie })).json()) as AgentDetail;
    expect(d.viewer?.canReview).toBe(false);
    expect(d.viewer?.reviewIneligibleReason).toBe('not_installed');
  });

  it('recusa instalação sem execução concluída recente', async () => {
    const { agent, cookie, ws, uid } = await setup();
    await install(cookie, agent.slug, ws);
    // Sem execução.
    let res = await review(cookie, agent.slug);
    expect(res.status).toBe(403);
    expect(
      ((await res.json()) as { error: { details: { reason: string } } }).error.details.reason,
    ).toBe('no_recent_completed_execution');
    // Execuções que NÃO qualificam: falha, cancelada, em andamento, concluída há 91 dias.
    await execution(agent, uid, ws, 'failed', Date.now() - DAY);
    await execution(agent, uid, ws, 'canceled', Date.now() - DAY);
    await execution(agent, uid, ws, 'running', null);
    await execution(agent, uid, ws, 'completed', Date.now() - 91 * DAY);
    res = await review(cookie, agent.slug);
    expect(res.status).toBe(403);
  });

  it('recusa execução concluída de OUTRO usuário na mesma instalação', async () => {
    const { agent, cookie, ws, uid } = await setup();
    const other = await signup();
    await install(cookie, agent.slug, ws);
    await execution(agent, uid, ws, 'completed', Date.now() - DAY, await userIdOf(other.email));
    expect((await review(cookie, agent.slug)).status).toBe(403);
  });

  it('aceita com instalação + execução concluída dentro de 90 dias e marca como verificada', async () => {
    const { agent, cookie, ws, uid } = await setup();
    await install(cookie, agent.slug, ws);
    await execution(agent, uid, ws, 'completed', Date.now() - 89 * DAY);
    const d0 = (await (await call(`/api/agents/${agent.slug}`, { cookie })).json()) as AgentDetail;
    expect(d0.viewer?.canReview).toBe(true);

    const res = await review(cookie, agent.slug, 5, '  Works well <b>bold</b>  ');
    expect(res.status).toBe(200);
    const list = (await (
      await call(`/api/agents/${agent.slug}/reviews`, { cookie })
    ).json()) as ReviewsResponse;
    expect(list.ratingCount).toBe(1);
    expect(list.ratingAvg).toBe(5);
    expect(list.reviews[0]).toMatchObject({
      rating: 5,
      verified: true,
      mine: true,
      body: 'Works well <b>bold</b>',
    });
    // Privacidade: nada que identifique o autor.
    expect(JSON.stringify(list)).not.toMatch(/email|user_?id|@example\.test|Tester/i);
    // Anônimo vê a avaliação, mas `mine` é falso.
    const anon = (await (
      await call(`/api/agents/${agent.slug}/reviews`)
    ).json()) as ReviewsResponse;
    expect(anon.reviews[0]?.mine).toBe(false);
    expect(anon.reviews[0]?.verified).toBe(true);
  });

  it('editar atualiza a mesma avaliação (uma por usuário) e valida a nota', async () => {
    const { agent, cookie, ws, uid } = await setup();
    await install(cookie, agent.slug, ws);
    await execution(agent, uid, ws, 'completed', Date.now() - DAY);
    expect((await review(cookie, agent.slug, 2)).status).toBe(200);
    expect((await review(cookie, agent.slug, 4, 'better')).status).toBe(200);
    const list = (await (
      await call(`/api/agents/${agent.slug}/reviews`)
    ).json()) as ReviewsResponse;
    expect(list.ratingCount).toBe(1);
    expect(list.ratingAvg).toBe(4);
    for (const bad of [0, 6, 3.5, '5'] as unknown[]) {
      const r = await call(`/api/agents/${agent.slug}/review`, {
        method: 'PUT',
        cookie,
        body: { rating: bad },
      });
      expect(r.status).toBe(400);
    }
    const long = await call(`/api/agents/${agent.slug}/review`, {
      method: 'PUT',
      cookie,
      body: { rating: 5, body: 'x'.repeat(2001) },
    });
    expect(long.status).toBe(400);
  });

  it('média considera várias pessoas; avaliação oculta por moderação não conta nem reaparece ao editar', async () => {
    const agent = await makeAgent();
    const people = [await signup(), await signup()];
    for (const [i, p] of people.entries()) {
      const ws = await workspaceOf(p.cookie ?? '');
      await install(p.cookie ?? '', agent.slug, ws);
      await execution(agent, await userIdOf(p.email), ws, 'completed', Date.now() - DAY);
      await review(p.cookie ?? '', agent.slug, i === 0 ? 5 : 2);
    }
    let list = (await (await call(`/api/agents/${agent.slug}/reviews`)).json()) as ReviewsResponse;
    expect(list.ratingCount).toBe(2);
    expect(list.ratingAvg).toBe(3.5);

    await db()
      .prepare("UPDATE agent_reviews SET status = 'hidden' WHERE agent_id = ? AND rating = 2")
      .bind(agent.id)
      .run();
    list = (await (await call(`/api/agents/${agent.slug}/reviews`)).json()) as ReviewsResponse;
    expect(list.ratingCount).toBe(1);
    expect(list.ratingAvg).toBe(5);
    await review(people[1]?.cookie ?? '', agent.slug, 1);
    const st = await db()
      .prepare('SELECT status FROM agent_reviews WHERE agent_id = ? AND rating = 1')
      .bind(agent.id)
      .first<{ status: string }>();
    expect(st?.status).toBe('hidden');
  });

  it('autor remove a própria avaliação; ninguém remove a de outro', async () => {
    const { agent, cookie, ws, uid } = await setup();
    const other = await signup();
    await install(cookie, agent.slug, ws);
    await execution(agent, uid, ws, 'completed', Date.now() - DAY);
    await review(cookie, agent.slug, 3);
    expect(
      (
        await call(`/api/agents/${agent.slug}/review`, {
          method: 'DELETE',
          cookie: other.cookie ?? '',
        })
      ).status,
    ).toBe(404);
    expect(
      (await call(`/api/agents/${agent.slug}/review`, { method: 'DELETE', cookie })).status,
    ).toBe(200);
    const list = (await (
      await call(`/api/agents/${agent.slug}/reviews`)
    ).json()) as ReviewsResponse;
    expect(list.ratingCount).toBe(0);
    expect(list.ratingAvg).toBeNull();
  });
});

describe('invariantes do marketplace', () => {
  it('o catálogo nasce vazio: nenhuma migração cria agentes, avaliações ou instalações (R5)', async () => {
    const files = import.meta.glob('../migrations/*.sql', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    for (const [name, sql] of Object.entries(files)) {
      expect(sql, name).not.toMatch(
        /INSERT\s+(OR\s+\w+\s+)?INTO\s+`?(agents|agent_reviews|agent_installations|agent_versions|favorites)`?\b/i,
      );
    }
  });
});
