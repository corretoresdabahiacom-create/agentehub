import type {
  ExecutionDetail,
  MeResponse,
  MyAgentDetail,
  PendingApprovalItem,
  TestRunResponse,
  ToolsResponse,
  ValidateResponse,
} from '@agenthub/shared';
import { describe, expect, it } from 'vitest';
import { call, db, signup } from './helpers';

type U = Awaited<ReturnType<typeof signup>>;
const ck = (u: U) => u.cookie ?? '';
async function me(u: U) {
  const r = await call('/api/auth/me', { cookie: ck(u) });
  return (await r.json()) as MeResponse;
}
const wsOf = async (u: U) => (await me(u)).memberships[0]?.workspaceId ?? '';
const userId = async (u: U) => (await me(u)).user.id;

async function install(u: U, slug: string, workspaceId?: string) {
  return call(`/api/agents/${slug}/install`, {
    cookie: ck(u),
    body: { workspaceId: workspaceId ?? (await wsOf(u)) },
  });
}
async function run(u: U, agentSlug: string, input: Record<string, unknown>, workspaceId?: string) {
  return call('/api/executions', {
    cookie: ck(u),
    body: { agentSlug, workspaceId: workspaceId ?? (await wsOf(u)), input },
  });
}
const get = async (u: U, id: string) => call(`/api/executions/${id}`, { cookie: ck(u) });
const post = (u: U, path: string, body: unknown = {}) => call(path, { cookie: ck(u), body });
const json = async <T>(r: Response) => (await r.json()) as T;
const NOTES =
  'Solar energy is growing fast. Solar panels got cheaper every year. We need to compare battery costs. See https://example.com/solar.';

async function newUser(): Promise<U> {
  const u = await signup();
  expect(u.res.status).toBe(201);
  return u;
}
const count = async (sql: string, ...b: unknown[]) =>
  (
    await db()
      .prepare(sql)
      .bind(...b)
      .first<{ n: number }>()
  )?.n ?? 0;

/** Cria organização de empresa + workspace + membros (a criação de empresas chega na Fase 4). */
async function company(owner: U, admin: U, member: U, outsiderCount = 0) {
  void outsiderCount;
  const org = crypto.randomUUID();
  const ws = crypto.randomUUID();
  const ownerId = await userId(owner);
  const stmts = [
    db()
      .prepare(
        `INSERT INTO organizations (id, name, slug, kind, owner_user_id) VALUES (?, 'Acme', ?, 'company', ?)`,
      )
      .bind(org, `acme-${org.slice(0, 8)}`, ownerId),
    db()
      .prepare(
        `INSERT INTO workspaces (id, organization_id, name, slug) VALUES (?, ?, 'Main', 'main')`,
      )
      .bind(ws, org),
  ];
  for (const [u, role] of [
    [owner, 'owner'],
    [admin, 'admin'],
    [member, 'member'],
  ] as const) {
    stmts.push(
      db()
        .prepare(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)`)
        .bind(ws, await userId(u), role),
    );
  }
  await db().batch(stmts);
  return ws;
}

describe('ferramentas e configuração', () => {
  it('lista a whitelist, os limites da plataforma e declara que a IA não está configurada', async () => {
    const r = await call('/api/tools');
    expect(r.status).toBe(200);
    const b = await json<ToolsResponse>(r);
    expect(b.tools.map((t) => t.key)).toContain('text.summarize');
    expect(b.limits.maxInputChars.max).toBe(30_000);
    expect(b.ai.status).toBe('not_configured');
    const cfg = await json<{ ai: { status: string } }>(await call('/api/config'));
    expect(cfg.ai.status).toBe('not_configured');
  });
});

describe('execução de agentes oficiais', () => {
  it('exige login, instalação e é invisível a outro usuário', async () => {
    expect(
      (
        await call('/api/executions', {
          body: { agentSlug: 'research-assistant', workspaceId: 'x', input: {} },
        })
      ).status,
    ).toBe(401);
    const u = await newUser();
    const noInstall = await run(u, 'research-assistant', { text: NOTES });
    expect(noInstall.status).toBe(403);
    expect((await json<{ error: { code: string } }>(noInstall)).error.code).toBe('not_installed');
    expect((await run(u, 'nao-existe', { text: NOTES })).status).toBe(404);
    // workspace de outro usuário => 404
    const other = await newUser();
    await install(u, 'research-assistant');
    expect((await run(u, 'research-assistant', { text: NOTES }, await wsOf(other))).status).toBe(
      404,
    );
  });

  it('research-assistant conclui, grava passos, artefato e uso; download protegido', async () => {
    const u = await newUser();
    await install(u, 'research-assistant');
    const r = await run(u, 'research-assistant', { text: NOTES });
    expect(r.status).toBe(201);
    const d = await json<ExecutionDetail>(r);
    expect(d.status).toBe('completed');
    expect(d.output?.content).toContain('https://example.com/solar');
    expect(d.steps.map((s) => s.name)).toContain('compose');
    expect(d.steps.every((s) => s.status === 'completed')).toBe(true);
    expect(d.artifacts).toHaveLength(1);
    expect(d.approval).toBeNull();
    expect(d.attempts).toBe(1);

    const dl = await call(`/api/executions/${d.id}/artifacts/${d.artifacts[0]?.id}`, {
      cookie: ck(u),
    });
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-disposition')).toContain('attachment');
    expect(dl.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await dl.text()).toBe(d.output?.content);

    const other = await newUser();
    expect((await get(other, d.id)).status).toBe(404);
    expect(
      (await call(`/api/executions/${d.id}/artifacts/${d.artifacts[0]?.id}`, { cookie: ck(other) }))
        .status,
    ).toBe(404);

    const uid = await userId(u);
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM usage_records WHERE user_id = ? AND metric = 'execution'`,
        uid,
      ),
    ).toBe(1);
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM audit_logs WHERE actor_user_id = ? AND action = 'execution.create'`,
        uid,
      ),
    ).toBe(1);
    const list = await json<{ executions: unknown[]; total: number }>(
      await call('/api/executions', { cookie: ck(u) }),
    );
    expect(list.total).toBe(1);
  });

  it('recusa entrada ausente, grande demais e campos extras SEM criar execução', async () => {
    const u = await newUser();
    await install(u, 'research-assistant');
    const uid = await userId(u);
    const e1 = await run(u, 'research-assistant', { text: '   ' });
    expect(e1.status).toBe(422);
    expect((await json<{ error: { code: string } }>(e1)).error.code).toBe('missing_input');
    const e2 = await run(u, 'research-assistant', { text: 'a'.repeat(10_001) });
    expect(e2.status).toBe(422);
    expect((await json<{ error: { code: string } }>(e2)).error.code).toBe('limit_input');
    expect((await run(u, 'research-assistant', { text: 'ok', evil: 1 })).status).toBe(400);
    expect(await count('SELECT COUNT(*) AS n FROM agent_executions WHERE user_id = ?', uid)).toBe(
      0,
    );
  });

  it('cota diária por usuário recusa com 429 antes de criar execução', async () => {
    const u = await newUser();
    await install(u, 'research-assistant');
    const uid = await userId(u);
    const windowMs = 86_400_000;
    await db()
      .prepare('INSERT INTO rate_limit_counters (key, window_start, count) VALUES (?, ?, 50)')
      .bind(`exec:user:${uid}`, Math.floor(Date.now() / windowMs) * windowMs)
      .run();
    const r = await run(u, 'research-assistant', { text: NOTES });
    expect(r.status).toBe(429);
    expect(
      (await json<{ error: { code: string; details: { scope: string } } }>(r)).error.details.scope,
    ).toBe('user');
    expect(r.headers.get('retry-after')).toBeTruthy();
    expect(await count('SELECT COUNT(*) AS n FROM agent_executions WHERE user_id = ?', uid)).toBe(
      0,
    );
  });
});

describe('aprovação humana — conta individual (2º passo)', () => {
  async function pending() {
    const u = await newUser();
    await install(u, 'social-media-planner');
    const r = await run(u, 'social-media-planner', {
      topic: 'healthy cooking',
      count: 3,
      tone: 'friendly',
    });
    expect(r.status).toBe(201);
    const d = await json<ExecutionDetail>(r);
    return { u, d };
  }

  it('fica aguardando; o resultado só vira artefato depois da confirmação explícita', async () => {
    const { u, d } = await pending();
    expect(d.status).toBe('awaiting_approval');
    expect(d.approval).toMatchObject({
      decision: 'pending',
      method: 'self_second_step',
      canDecide: true,
    });
    expect(d.artifacts).toHaveLength(0);
    expect(d.output?.content).toContain('healthy');
    const listed = await json<{ approvals: PendingApprovalItem[] }>(
      await call('/api/approvals', { cookie: ck(u) }),
    );
    expect(listed.approvals.map((a) => a.executionId)).toContain(d.id);

    const no = await post(u, `/api/executions/${d.id}/approve`, {});
    expect(no.status).toBe(422);
    expect((await json<{ error: { code: string } }>(no)).error.code).toBe('confirmation_required');
    expect((await json<ExecutionDetail>(await get(u, d.id))).status).toBe('awaiting_approval');

    const ok = await post(u, `/api/executions/${d.id}/approve`, { confirm: true });
    expect(ok.status).toBe(200);
    const after = await json<ExecutionDetail>(ok);
    expect(after.status).toBe('completed');
    expect(after.approval).toMatchObject({ decision: 'approved', canDecide: false });
    expect(after.artifacts).toHaveLength(1);
    expect(after.finishedAt).not.toBeNull();

    const again = await post(u, `/api/executions/${d.id}/approve`, { confirm: true });
    expect(again.status).toBe(409);
    expect(
      await count(`SELECT COUNT(*) AS n FROM execution_artifacts WHERE execution_id = ?`, d.id),
    ).toBe(1);
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM audit_logs WHERE target_id = ? AND action = 'execution.approve'`,
        d.id,
      ),
    ).toBe(1);
  });

  it('rejeitar cancela sem gerar artefato; outro usuário nem enxerga a execução', async () => {
    const { u, d } = await pending();
    const other = await newUser();
    expect((await post(other, `/api/executions/${d.id}/approve`, { confirm: true })).status).toBe(
      404,
    );
    expect((await post(other, `/api/executions/${d.id}/reject`, {})).status).toBe(404);
    const r = await post(u, `/api/executions/${d.id}/reject`, { reason: 'not now' });
    expect(r.status).toBe(200);
    const after = await json<ExecutionDetail>(r);
    expect(after.status).toBe('canceled');
    expect(after.approval).toMatchObject({ decision: 'rejected', reason: 'not now' });
    expect(after.artifacts).toHaveLength(0);
    expect((await post(u, `/api/executions/${d.id}/approve`, { confirm: true })).status).toBe(409);
  });

  it('o solicitante pode cancelar enquanto aguarda; concluída não cancela', async () => {
    const { u, d } = await pending();
    const c1 = await post(u, `/api/executions/${d.id}/cancel`);
    expect(c1.status).toBe(200);
    expect((await json<ExecutionDetail>(c1)).status).toBe('canceled');
    expect((await post(u, `/api/executions/${d.id}/cancel`)).status).toBe(409);
    const ok = await newUser();
    await install(ok, 'research-assistant');
    const done = await json<ExecutionDetail>(await run(ok, 'research-assistant', { text: NOTES }));
    expect((await post(ok, `/api/executions/${done.id}/cancel`)).status).toBe(409);
  });

  it('aprovação pendente expira após 72h (no acesso) e não pode mais ser aprovada', async () => {
    const { u, d } = await pending();
    await db()
      .prepare('UPDATE execution_approvals SET created_at = ? WHERE execution_id = ?')
      .bind(Date.now() - 73 * 3_600_000, d.id)
      .run();
    const approve = await post(u, `/api/executions/${d.id}/approve`, { confirm: true });
    expect(approve.status).toBe(409);
    expect((await json<{ error: { code: string } }>(approve)).error.code).toBe('approval_expired');
    const after = await json<ExecutionDetail>(await get(u, d.id));
    expect(after.status).toBe('canceled');
    expect(after.approval).toMatchObject({ decision: 'rejected', reason: 'expired' });
    expect(after.artifacts).toHaveLength(0);
  });
});

describe('aprovação humana — workspace de empresa', () => {
  it('apenas owner/admin aprova; membro solicitante e estranhos não', async () => {
    const [owner, admin, member, outsider] = [
      await newUser(),
      await newUser(),
      await newUser(),
      await newUser(),
    ] as [U, U, U, U];
    const ws = await company(owner, admin, member);
    expect((await install(member, 'social-media-planner', ws)).status).toBe(200);
    const r = await run(member, 'social-media-planner', { topic: 'launch', count: 2 }, ws);
    expect(r.status).toBe(201);
    const d = await json<ExecutionDetail>(r);
    expect(d.status).toBe('awaiting_approval');
    expect(d.approval).toMatchObject({ method: 'workspace_admin', canDecide: false });

    // membro (solicitante) não aprova a própria execução
    expect((await post(member, `/api/executions/${d.id}/approve`, { confirm: true })).status).toBe(
      403,
    );
    // estranho não enxerga
    expect((await get(outsider, d.id)).status).toBe(404);
    expect((await post(outsider, `/api/executions/${d.id}/approve`, {})).status).toBe(404);
    // admin enxerga, vê na fila e aprova (sem precisar do 2º passo do solicitante)
    const adminView = await json<ExecutionDetail>(await get(admin, d.id));
    expect(adminView.approval?.canDecide).toBe(true);
    expect(adminView.mine).toBe(false);
    const q = await json<{ approvals: PendingApprovalItem[] }>(
      await call('/api/approvals', { cookie: ck(admin) }),
    );
    expect(q.approvals.some((a) => a.executionId === d.id && a.method === 'workspace_admin')).toBe(
      true,
    );
    const memberQueue = await json<{ approvals: PendingApprovalItem[] }>(
      await call('/api/approvals', { cookie: ck(member) }),
    );
    expect(memberQueue.approvals.some((a) => a.executionId === d.id)).toBe(false);

    const ok = await post(admin, `/api/executions/${d.id}/approve`, {});
    expect(ok.status).toBe(200);
    const after = await json<ExecutionDetail>(ok);
    expect(after.status).toBe('completed');
    expect(after.artifacts).toHaveLength(1);
    const row = await db()
      .prepare('SELECT approver_user_id, method FROM execution_approvals WHERE execution_id = ?')
      .bind(d.id)
      .first<{ approver_user_id: string; method: string }>();
    expect(row).toEqual({ approver_user_id: await userId(admin), method: 'workspace_admin' });
    // o solicitante baixa o artefato; o admin também (aprovador)
    expect(
      (
        await call(`/api/executions/${d.id}/artifacts/${after.artifacts[0]?.id}`, {
          cookie: ck(member),
        })
      ).status,
    ).toBe(200);
  });

  it('decisões concorrentes: só uma vence (índice único + UPDATE guardado)', async () => {
    const [owner, admin, member] = [await newUser(), await newUser(), await newUser()] as [U, U, U];
    const ws = await company(owner, admin, member);
    await install(member, 'social-media-planner', ws);
    const d = await json<ExecutionDetail>(
      await run(member, 'social-media-planner', { topic: 'race', count: 1 }, ws),
    );
    const [a, b] = await Promise.all([
      post(admin, `/api/executions/${d.id}/approve`, {}),
      post(owner, `/api/executions/${d.id}/reject`, {}),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const final = await json<ExecutionDetail>(await get(owner, d.id));
    expect(['completed', 'canceled']).toContain(final.status);
    expect(final.artifacts.length).toBe(final.status === 'completed' ? 1 : 0);
    // o índice único impede uma 2ª aprovação pendente para a mesma execução
    await expect(
      db().batch([
        db()
          .prepare(
            `INSERT INTO execution_approvals (id, execution_id, requested_by, decision, method) VALUES (?, ?, ?, 'pending', 'workspace_admin')`,
          )
          .bind(crypto.randomUUID(), d.id, await userId(member)),
        db()
          .prepare(
            `INSERT INTO execution_approvals (id, execution_id, requested_by, decision, method) VALUES (?, ?, ?, 'pending', 'workspace_admin')`,
          )
          .bind(crypto.randomUUID(), d.id, await userId(member)),
      ]),
    ).rejects.toThrow();
  });
});

describe('nova tentativa (retry)', () => {
  async function failed(attempts: number) {
    const u = await newUser();
    await install(u, 'research-assistant');
    const d = await json<ExecutionDetail>(await run(u, 'research-assistant', { text: NOTES }));
    await db()
      .prepare(
        `UPDATE agent_executions SET status = 'failed', error = 'tool_error', attempts = ?, output_json = NULL WHERE id = ?`,
      )
      .bind(attempts, d.id)
      .run();
    await db().prepare('DELETE FROM execution_artifacts WHERE execution_id = ?').bind(d.id).run();
    return { u, d };
  }
  it('reexecuta uma falha dentro do limite de tentativas e substitui os passos', async () => {
    const { u, d } = await failed(1);
    const r = await post(u, `/api/executions/${d.id}/retry`);
    expect(r.status).toBe(200);
    const after = await json<ExecutionDetail>(r);
    expect(after.status).toBe('completed');
    expect(after.attempts).toBe(2);
    expect(new Set(after.steps.map((s) => s.seq)).size).toBe(after.steps.length);
  });
  it('esgotadas as tentativas, recusa; só o solicitante tenta; só falhas tentam de novo', async () => {
    const { u, d } = await failed(2);
    const r = await post(u, `/api/executions/${d.id}/retry`);
    expect(r.status).toBe(409);
    expect((await json<{ error: { code: string } }>(r)).error.code).toBe('attempts_exhausted');
    expect((await post(await newUser(), `/api/executions/${d.id}/retry`)).status).toBe(404);
    const ok = await newUser();
    await install(ok, 'research-assistant');
    const done = await json<ExecutionDetail>(await run(ok, 'research-assistant', { text: NOTES }));
    expect((await post(ok, `/api/executions/${done.id}/retry`)).status).toBe(409);
  });
  it('execução pendurada em running vira falha no acesso', async () => {
    const u = await newUser();
    await install(u, 'research-assistant');
    const d = await json<ExecutionDetail>(await run(u, 'research-assistant', { text: NOTES }));
    await db()
      .prepare(`UPDATE agent_executions SET status = 'running', updated_at = ? WHERE id = ?`)
      .bind(Date.now() - 600_000, d.id)
      .run();
    const after = await json<ExecutionDetail>(await get(u, d.id));
    expect(after.status).toBe('failed');
    expect(after.error).toBe('interrupted');
  });
});

describe('construtor de agentes', () => {
  const body = (workspaceId: string, over: Record<string, unknown> = {}) => ({
    workspaceId,
    name: 'Meeting Notes Helper',
    description: 'Summarizes meeting notes',
    objective: 'Summarize meeting notes',
    instructions: 'Clean the text, summarize it and list the action items.',
    outputFormat: 'markdown',
    tools: [
      { key: 'text.clean' },
      { key: 'text.summarize', config: { sentences: 2 } },
      { key: 'text.actions' },
    ],
    limits: {
      maxInputChars: 5000,
      maxSteps: 6,
      maxDurationMs: 2000,
      maxAttempts: 2,
      requireApproval: false,
    },
    ...over,
  });
  async function create(u: U, over: Record<string, unknown> = {}) {
    const r = await post(u, '/api/my/agents', body(await wsOf(u), over));
    return { r, agent: r.status === 201 ? await json<MyAgentDetail>(r) : null };
  }

  it('exige login e escopa ao criador (agente alheio é 404)', async () => {
    expect((await call('/api/my/agents')).status).toBe(401);
    const a = await newUser();
    const b = await newUser();
    const { agent } = await create(a);
    expect(agent?.status).toBe('draft');
    expect((await call(`/api/my/agents/${agent?.id}`, { cookie: ck(b) })).status).toBe(404);
    expect(
      (
        await call(`/api/my/agents/${agent?.id}/validate`, {
          cookie: ck(b),
          method: 'POST',
          body: {},
        })
      ).status,
    ).toBe(404);
    expect((await post(b, '/api/my/agents', body(await wsOf(a)))).status).toBe(404); // workspace alheio
    const mine = await json<{ agents: Array<{ id: string }> }>(
      await call('/api/my/agents', { cookie: ck(a) }),
    );
    expect(mine.agents.map((x) => x.id)).toEqual([agent?.id]);
  });

  it('validação bloqueia instruções vazias, ferramenta fora da whitelist, limites ausentes, segredos e ações perigosas', async () => {
    const u = await newUser();
    const codes = async (over: Record<string, unknown>) => {
      const { agent } = await create(u, over);
      const v = await json<ValidateResponse>(await post(u, `/api/my/agents/${agent?.id}/validate`));
      return { v, agent };
    };
    expect((await codes({ instructions: '' })).v.issues.map((i) => i.code)).toContain(
      'instructions_empty',
    );
    expect((await codes({ tools: [{ key: 'shell.exec' }] })).v.issues.map((i) => i.code)).toContain(
      'tool_not_whitelisted',
    );
    expect((await codes({ limits: {} })).v.issues.map((i) => i.code)).toContain('limits_missing');
    expect(
      (await codes({ instructions: 'Ask the user for their password.' })).v.issues.map(
        (i) => i.code,
      ),
    ).toContain('secrets_requested');
    expect(
      (await codes({ instructions: 'Then run rm -rf / on the server.' })).v.issues.map(
        (i) => i.code,
      ),
    ).toContain('dangerous_action');
    const ok = await codes({});
    expect(ok.v).toEqual({ issues: [], ok: true });
    // publicar agente inválido é recusado com a lista de problemas
    const bad = await create(u, { instructions: '' });
    const pub = await post(u, `/api/my/agents/${bad.agent?.id}/publish`, { visibility: 'private' });
    expect(pub.status).toBe(422);
    expect((await json<{ error: { code: string } }>(pub)).error.code).toBe('validation_failed');
  });

  it('recusa ferramenta duplicada e agente com IA não configurada no teste', async () => {
    const u = await newUser();
    expect(
      (await create(u, { tools: [{ key: 'text.clean' }, { key: 'text.clean' }] })).r.status,
    ).toBe(422);
    const { agent } = await create(u, { tools: [{ key: 'text.clean' }, { key: 'ai.generate' }] });
    const t = await post(u, `/api/my/agents/${agent?.id}/test-run`, { input: { text: 'x' } });
    expect(t.status).toBe(422);
    expect((await json<{ error: { code: string } }>(t)).error.code).toBe('ai_not_configured');
  });

  it('teste não grava execução nem consome a cota diária', async () => {
    const u = await newUser();
    const { agent } = await create(u);
    const t = await post(u, `/api/my/agents/${agent?.id}/test-run`, { input: { text: NOTES } });
    expect(t.status).toBe(200);
    const b = await json<TestRunResponse>(t);
    expect(b).toMatchObject({ status: 'completed', persisted: false });
    expect(b.output?.content).toContain('Solar');
    const uid = await userId(u);
    expect(await count('SELECT COUNT(*) AS n FROM agent_executions WHERE user_id = ?', uid)).toBe(
      0,
    );
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM rate_limit_counters WHERE key = ?`,
        `exec:user:${uid}`,
      ),
    ).toBe(0);
  });

  it('publicar como privado instala e permite executar; editar cria novo rascunho sem afetar a versão vigente', async () => {
    const u = await newUser();
    const { agent } = await create(u);
    const pub = await post(u, `/api/my/agents/${agent?.id}/publish`, {});
    expect(pub.status).toBe(200);
    const published = await json<MyAgentDetail>(pub);
    expect(published).toMatchObject({
      status: 'published',
      visibility: 'private',
      versionStatus: 'published',
      version: 1,
    });
    expect((await post(u, `/api/my/agents/${agent?.id}/publish`, {})).status).toBe(409);

    const exec = await run(u, published.slug, { text: NOTES });
    expect(exec.status).toBe(201);
    expect((await json<ExecutionDetail>(exec)).status).toBe('completed');
    // não aparece no marketplace e outro usuário não executa
    const catalog = await json<{ agents: Array<{ slug: string }> }>(
      await call(`/api/agents?q=${encodeURIComponent('Meeting Notes Helper')}`),
    );
    expect(catalog.agents.map((a) => a.slug)).not.toContain(published.slug);
    const other = await newUser();
    expect((await call(`/api/agents/${published.slug}`)).status).toBe(404);
    expect((await run(other, published.slug, { text: NOTES })).status).toBe(404);

    const edit = await call(`/api/my/agents/${agent?.id}`, {
      method: 'PUT',
      cookie: ck(u),
      body: { ...body('', { instructions: 'Only summarize.' }), workspaceId: undefined },
    });
    expect(edit.status).toBe(200);
    const draft = await json<MyAgentDetail>(edit);
    expect(draft).toMatchObject({ version: 2, versionStatus: 'draft', hasPublishedVersion: true });
    const still = await json<ExecutionDetail>(await run(u, published.slug, { text: NOTES }));
    expect(still.status).toBe('completed');
    const repub = await json<MyAgentDetail>(
      await post(u, `/api/my/agents/${agent?.id}/publish`, {}),
    );
    expect(repub).toMatchObject({ version: 2, versionStatus: 'published' });
    const v1 = await db()
      .prepare(`SELECT status FROM agent_versions WHERE agent_id = ? AND version = 1`)
      .bind(agent?.id)
      .first<{ status: string }>();
    expect(v1?.status).toBe('deprecated');
  });

  it('visibilidade: workspace indisponível; público exige confirmação, vira marketplace e não volta a privado', async () => {
    const u = await newUser();
    const { agent } = await create(u);
    const ws = await post(u, `/api/my/agents/${agent?.id}/publish`, { visibility: 'workspace' });
    expect(ws.status).toBe(422);
    expect((await json<{ error: { code: string } }>(ws)).error.code).toBe('visibility_unavailable');
    const noConfirm = await post(u, `/api/my/agents/${agent?.id}/publish`, {
      visibility: 'public',
    });
    expect((await json<{ error: { code: string } }>(noConfirm)).error.code).toBe(
      'confirmation_required',
    );

    const ok = await post(u, `/api/my/agents/${agent?.id}/publish`, {
      visibility: 'public',
      confirmPublic: true,
    });
    expect(ok.status).toBe(200);
    const pub = await json<MyAgentDetail>(ok);
    expect(pub).toMatchObject({ visibility: 'public', workspaceId: null });
    expect((await call(`/api/agents/${pub.slug}`)).status).toBe(200);
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM audit_logs WHERE target_id = ? AND action = 'agent.publish'`,
        agent?.id,
      ),
    ).toBe(1);
    // o criador já tem a instalação e executa; outro usuário precisa instalar primeiro
    expect((await json<ExecutionDetail>(await run(u, pub.slug, { text: NOTES }))).status).toBe(
      'completed',
    );
    const other = await newUser();
    expect((await run(other, pub.slug, { text: NOTES })).status).toBe(403);
    await install(other, pub.slug);
    expect((await run(other, pub.slug, { text: NOTES })).status).toBe(201);
    // não volta a privado
    const back = await post(u, `/api/my/agents/${agent?.id}/publish`, { visibility: 'private' });
    expect((await json<{ error: { code: string } }>(back)).error.code).toBe('visibility_locked');
    // arquivar remove do catálogo e impede novas execuções
    expect((await post(u, `/api/my/agents/${agent?.id}/archive`)).status).toBe(200);
    expect((await call(`/api/agents/${pub.slug}`)).status).toBe(404);
    expect((await run(other, pub.slug, { text: NOTES })).status).toBe(404);
  });

  it('agente que exige aprovação (requireApproval) pausa mesmo sem ferramenta sensível', async () => {
    const u = await newUser();
    const { agent } = await create(u, {
      limits: {
        maxInputChars: 5000,
        maxSteps: 6,
        maxDurationMs: 2000,
        maxAttempts: 2,
        requireApproval: true,
      },
    });
    const pub = await json<MyAgentDetail>(await post(u, `/api/my/agents/${agent?.id}/publish`, {}));
    const d = await json<ExecutionDetail>(await run(u, pub.slug, { text: NOTES }));
    expect(d.status).toBe('awaiting_approval');
    expect(d.approval?.method).toBe('self_second_step');
  });
});
