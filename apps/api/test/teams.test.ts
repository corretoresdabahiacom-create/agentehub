import type {
  ExecutionDetail,
  InviteAccepted,
  InviteCreated,
  InvitePreview,
  LibraryItem,
  MeResponse,
  MemberView,
  MyAgentDetail,
  WorkspaceUsage,
} from '@agenthub/shared';
import { describe, expect, it } from 'vitest';
import { call, db, signup } from './helpers';

type U = Awaited<ReturnType<typeof signup>>;
const ck = (u: U) => u.cookie ?? '';
const json = async <T>(r: Response) => (await r.json()) as T;
const me = async (u: U) => json<MeResponse>(await call('/api/auth/me', { cookie: ck(u) }));
const userId = async (u: U) => (await me(u)).user.id;
const newUser = async () => {
  const u = await signup();
  expect(u.res.status).toBe(201);
  return u;
};
const send = (u: U, method: string, path: string, body?: unknown) =>
  call(path, { cookie: ck(u), method, body });
const code = async (r: Response) => (await json<{ error: { code: string } }>(r)).error.code;
const NOTES = 'Solar energy is growing fast. We need to compare battery costs.';

/** Cria empresa via API real; devolve o workspace "Main". */
async function makeCompany(owner: U, name = 'Acme Corp') {
  const r = await send(owner, 'POST', '/api/organizations', { name });
  expect(r.status).toBe(201);
  const m = (await json<{ memberships: MeResponse['memberships'] }>(r)).memberships.find(
    (x) => x.organizationName === name,
  );
  expect(m).toBeTruthy();
  return { orgId: m!.organizationId, wsId: m!.workspaceId };
}
async function invite(owner: U, wsId: string, body: Record<string, unknown> = {}) {
  const r = await send(owner, 'POST', `/api/workspaces/${wsId}/invites`, body);
  expect(r.status).toBe(201);
  const inv = await json<InviteCreated>(r);
  return { inv, token: inv.path.replace('/invite/', '') };
}
async function join(owner: U, wsId: string, user: U, body: Record<string, unknown> = {}) {
  const { token } = await invite(owner, wsId, body);
  const r = await send(user, 'POST', `/api/invites/${token}/accept`);
  expect(r.status).toBe(201);
}
const members = async (u: U, wsId: string) =>
  (
    await json<{ members: MemberView[] }>(
      await call(`/api/workspaces/${wsId}/members`, { cookie: ck(u) }),
    )
  ).members;
const count = async (sql: string, ...b: unknown[]) =>
  (
    await db()
      .prepare(sql)
      .bind(...b)
      .first<{ n: number }>()
  )?.n ?? 0;

describe('criar empresa e workspaces', () => {
  it('cria organization de empresa com workspace Main e o criador como owner', async () => {
    const u = await newUser();
    const { orgId, wsId } = await makeCompany(u);
    const m = (await me(u)).memberships.find((x) => x.workspaceId === wsId);
    expect(m).toMatchObject({ role: 'owner', organizationKind: 'company', workspaceName: 'Main' });
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM organization_members WHERE organization_id = ? AND role = 'owner'`,
        orgId,
      ),
    ).toBe(1);
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'org.create' AND target_id = ?`,
        orgId,
      ),
    ).toBe(1);
  });
  it('exige login, valida o nome e limita 3 empresas por usuário', async () => {
    expect((await call('/api/organizations', { body: { name: 'X Corp' } })).status).toBe(401);
    const u = await newUser();
    expect((await send(u, 'POST', '/api/organizations', { name: 'x' })).status).toBe(400);
    expect((await send(u, 'POST', '/api/organizations', { name: 'Ok Corp', evil: 1 })).status).toBe(
      400,
    );
    for (const n of ['One Co', 'Two Co', 'Three Co']) await makeCompany(u, n);
    const r = await send(u, 'POST', '/api/organizations', { name: 'Four Co' });
    expect(r.status).toBe(409);
    expect(await code(r)).toBe('company_limit');
  });
  it('workspace extra: só owner/admin da organização; não-membro 404; pessoal 422', async () => {
    const owner = await newUser();
    const member = await newUser();
    const stranger = await newUser();
    const { orgId, wsId } = await makeCompany(owner);
    await join(owner, wsId, member);
    expect(
      (await send(owner, 'POST', `/api/organizations/${orgId}/workspaces`, { name: 'Marketing' }))
        .status,
    ).toBe(201);
    expect((await me(owner)).memberships.map((x) => x.workspaceName).sort()).toEqual([
      'Main',
      'Marketing',
      'Personal',
    ]);
    expect(
      (await send(member, 'POST', `/api/organizations/${orgId}/workspaces`, { name: 'Sneaky' }))
        .status,
    ).toBe(403);
    expect(
      (await send(stranger, 'POST', `/api/organizations/${orgId}/workspaces`, { name: 'Sneaky' }))
        .status,
    ).toBe(404);
    const personalOrg = (await me(owner)).memberships.find(
      (x) => x.organizationKind === 'personal',
    )!.organizationId;
    expect(
      (await send(owner, 'POST', `/api/organizations/${personalOrg}/workspaces`, { name: 'Nope' }))
        .status,
    ).toBe(422);
  });
});

describe('convite por link', () => {
  it('o token só aparece na criação; o banco guarda apenas o hash; a listagem não vaza o link', async () => {
    const owner = await newUser();
    const { wsId } = await makeCompany(owner);
    const { inv, token } = await invite(owner, wsId);
    expect(token).toHaveLength(43);
    const raw = await db()
      .prepare('SELECT token_hash FROM organization_invites WHERE id = ?')
      .bind(inv.id)
      .first<{ token_hash: string }>();
    expect(raw?.token_hash).not.toBe(token);
    expect(raw?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    const list = await call(`/api/workspaces/${wsId}/invites`, { cookie: ck(owner) });
    const text = await list.text();
    expect(text).not.toContain(token);
    expect(JSON.parse(text).invites[0]).toMatchObject({ id: inv.id, active: true, useCount: 0 });
    const audit = await db()
      .prepare(
        `SELECT metadata_json FROM audit_logs WHERE action = 'invite.create' AND target_id = ?`,
      )
      .bind(inv.id)
      .first<{ metadata_json: string }>();
    expect(audit?.metadata_json ?? '').not.toContain(token);
  });

  it('pré-visualiza e aceita: vira membro com o papel do convite; segundo aceite não consome uso', async () => {
    const owner = await newUser();
    const guest = await newUser();
    const { wsId } = await makeCompany(owner, 'Globex');
    const { inv, token } = await invite(owner, wsId, { maxUses: 2 });
    const prev = await json<InvitePreview>(
      await call(`/api/invites/${token}`, { cookie: ck(guest) }),
    );
    expect(prev).toMatchObject({
      organizationName: 'Globex',
      workspaceName: 'Main',
      role: 'member',
      alreadyMember: false,
    });
    const ok = await send(guest, 'POST', `/api/invites/${token}/accept`);
    expect(ok.status).toBe(201);
    expect(await json<InviteAccepted>(ok)).toEqual({ workspaceId: wsId, alreadyMember: false });
    expect(
      (await me(guest)).memberships.some((m) => m.workspaceId === wsId && m.role === 'member'),
    ).toBe(true);
    const again = await send(guest, 'POST', `/api/invites/${token}/accept`);
    expect(again.status).toBe(200);
    expect((await json<InviteAccepted>(again)).alreadyMember).toBe(true);
    const row = await db()
      .prepare('SELECT use_count FROM organization_invites WHERE id = ?')
      .bind(inv.id)
      .first<{ use_count: number }>();
    expect(row?.use_count).toBe(1);
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'invite.accept' AND target_id = ?`,
        inv.id,
      ),
    ).toBe(1);
  });

  it('exige login; token inventado, expirado, revogado e esgotado respondem igual (404 invite_invalid)', async () => {
    const owner = await newUser();
    const guest = await newUser();
    const { wsId } = await makeCompany(owner);
    expect((await call('/api/invites/abc')).status).toBe(401);
    const bogus = await call('/api/invites/' + 'x'.repeat(43), { cookie: ck(guest) });
    expect(bogus.status).toBe(404);
    expect(await code(bogus)).toBe('invite_invalid');

    const expired = await invite(owner, wsId);
    await db()
      .prepare('UPDATE organization_invites SET expires_at = ? WHERE id = ?')
      .bind(Date.now() - 1000, expired.inv.id)
      .run();
    const revoked = await invite(owner, wsId);
    expect(
      (await send(owner, 'DELETE', `/api/workspaces/${wsId}/invites/${revoked.inv.id}`)).status,
    ).toBe(200);
    const spent = await invite(owner, wsId, { maxUses: 1 });
    expect((await send(await newUser(), 'POST', `/api/invites/${spent.token}/accept`)).status).toBe(
      201,
    );
    for (const t of [expired.token, revoked.token, spent.token]) {
      const p = await call(`/api/invites/${t}`, { cookie: ck(guest) });
      expect(p.status).toBe(404);
      expect(await code(p)).toBe('invite_invalid');
      expect((await send(guest, 'POST', `/api/invites/${t}/accept`)).status).toBe(404);
    }
    expect((await me(guest)).memberships.some((m) => m.workspaceId === wsId)).toBe(false);
  });

  it('aceites concorrentes de um link de 1 uso: só um entra', async () => {
    const owner = await newUser();
    const { wsId } = await makeCompany(owner);
    const { token } = await invite(owner, wsId, { maxUses: 1 });
    const [a, b] = [await newUser(), await newUser()];
    const rs = await Promise.all([
      send(a, 'POST', `/api/invites/${token}/accept`),
      send(b, 'POST', `/api/invites/${token}/accept`),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 404]);
    expect((await members(owner, wsId)).length).toBe(2);
  });

  it('papéis: só owner convida admin; admin convida member; member não convida; pessoal 422', async () => {
    const [owner, admin, member] = [await newUser(), await newUser(), await newUser()] as [U, U, U];
    const { wsId } = await makeCompany(owner);
    await join(owner, wsId, admin, { role: 'admin' });
    await join(owner, wsId, member);
    expect(
      (await send(admin, 'POST', `/api/workspaces/${wsId}/invites`, { role: 'admin' })).status,
    ).toBe(403);
    expect(
      (await send(admin, 'POST', `/api/workspaces/${wsId}/invites`, { role: 'member' })).status,
    ).toBe(201);
    expect((await send(member, 'POST', `/api/workspaces/${wsId}/invites`, {})).status).toBe(403);
    expect(
      (await send(owner, 'POST', `/api/workspaces/${wsId}/invites`, { role: 'owner' })).status,
    ).toBe(400);
    expect(
      (await send(owner, 'POST', `/api/workspaces/${wsId}/invites`, { expiresInHours: 9999 }))
        .status,
    ).toBe(400);
    const personal = (await me(owner)).memberships.find(
      (x) => x.organizationKind === 'personal',
    )!.workspaceId;
    const p = await send(owner, 'POST', `/api/workspaces/${personal}/invites`, {});
    expect(p.status).toBe(422);
    expect(await code(p)).toBe('personal_workspace');
    // admin não pode revogar convite de outro workspace
    const other = await makeCompany(await newUser(), 'Other Inc');
    expect((await send(admin, 'DELETE', `/api/workspaces/${other.wsId}/invites/x`)).status).toBe(
      404,
    );
  });
});

describe('membros, papéis e remoção', () => {
  async function team() {
    const [owner, admin, member, outsider] = [
      await newUser(),
      await newUser(),
      await newUser(),
      await newUser(),
    ] as [U, U, U, U];
    const { orgId, wsId } = await makeCompany(owner);
    await join(owner, wsId, admin, { role: 'admin' });
    await join(owner, wsId, member);
    return { owner, admin, member, outsider, orgId, wsId };
  }
  it('lista de membros: admin+ vê; membro 403; estranho 404', async () => {
    const t = await team();
    expect((await members(t.admin, t.wsId)).map((m) => m.role)).toEqual([
      'owner',
      'admin',
      'member',
    ]);
    expect((await call(`/api/workspaces/${t.wsId}/members`, { cookie: ck(t.member) })).status).toBe(
      403,
    );
    expect(
      (await call(`/api/workspaces/${t.wsId}/members`, { cookie: ck(t.outsider) })).status,
    ).toBe(404);
    const raw = JSON.stringify(await members(t.owner, t.wsId));
    expect(raw).not.toMatch(/password|hash|token/i);
  });
  it('só o owner muda papéis; owner é protegido; admin não se promove', async () => {
    const t = await team();
    const memberId = await userId(t.member);
    const adminId = await userId(t.admin);
    const ownerId = await userId(t.owner);
    expect(
      (
        await send(t.owner, 'PATCH', `/api/workspaces/${t.wsId}/members/${memberId}`, {
          role: 'admin',
        })
      ).status,
    ).toBe(200);
    expect((await members(t.owner, t.wsId)).find((m) => m.userId === memberId)?.role).toBe('admin');
    expect(
      (
        await send(t.admin, 'PATCH', `/api/workspaces/${t.wsId}/members/${memberId}`, {
          role: 'member',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await send(t.member, 'PATCH', `/api/workspaces/${t.wsId}/members/${memberId}`, {
          role: 'admin',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await send(t.owner, 'PATCH', `/api/workspaces/${t.wsId}/members/${ownerId}`, {
          role: 'member',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await send(t.owner, 'PATCH', `/api/workspaces/${t.wsId}/members/${adminId}`, {
          role: 'owner',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send(
          t.owner,
          'PATCH',
          `/api/workspaces/${t.wsId}/members/${await userId(t.outsider)}`,
          { role: 'member' },
        )
      ).status,
    ).toBe(404);
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'member.role_change' AND workspace_id = ?`,
        t.wsId,
      ),
    ).toBe(1);
  });
  it('remoção: admin remove member, não admin; owner remove admin; ninguém remove o owner; membro pode sair', async () => {
    const t = await team();
    const [adminId, memberId, ownerId] = [
      await userId(t.admin),
      await userId(t.member),
      await userId(t.owner),
    ];
    expect(
      (await send(t.member, 'DELETE', `/api/workspaces/${t.wsId}/members/${adminId}`)).status,
    ).toBe(403);
    expect(
      (await send(t.admin, 'DELETE', `/api/workspaces/${t.wsId}/members/${ownerId}`)).status,
    ).toBe(409);
    expect(
      (await send(t.admin, 'DELETE', `/api/workspaces/${t.wsId}/members/${memberId}`)).status,
    ).toBe(200);
    expect((await me(t.member)).memberships.some((m) => m.workspaceId === t.wsId)).toBe(false);
    // removido perde o acesso (404) e a organização
    expect((await call(`/api/workspaces/${t.wsId}`, { cookie: ck(t.member) })).status).toBe(404);
    expect(
      await count(
        'SELECT COUNT(*) AS n FROM organization_members WHERE organization_id = ? AND user_id = ?',
        t.orgId,
        memberId,
      ),
    ).toBe(0);
    expect(
      (await send(t.owner, 'DELETE', `/api/workspaces/${t.wsId}/members/${ownerId}`)).status,
    ).toBe(409);
    expect(
      (await send(t.admin, 'DELETE', `/api/workspaces/${t.wsId}/members/${adminId}`)).status,
    ).toBe(200); // sair
    expect((await members(t.owner, t.wsId)).map((m) => m.role)).toEqual(['owner']);
  });
});

describe('isolamento entre workspaces e organizações', () => {
  it('nenhuma rota de equipe revela ou altera um workspace alheio (sempre 404)', async () => {
    const [a, b] = [await newUser(), await newUser()];
    const A = await makeCompany(a, 'Alpha Co');
    const B = await makeCompany(b, 'Beta Co');
    const bId = await userId(b);
    const { inv } = await invite(b, B.wsId);
    const probes: Array<[string, string, unknown?]> = [
      ['GET', `/api/workspaces/${B.wsId}`],
      ['GET', `/api/workspaces/${B.wsId}/members`],
      ['GET', `/api/workspaces/${B.wsId}/invites`],
      ['POST', `/api/workspaces/${B.wsId}/invites`, {}],
      ['DELETE', `/api/workspaces/${B.wsId}/invites/${inv.id}`],
      ['PATCH', `/api/workspaces/${B.wsId}/members/${bId}`, { role: 'member' }],
      ['DELETE', `/api/workspaces/${B.wsId}/members/${bId}`],
      ['PUT', `/api/workspaces/${B.wsId}/members/${bId}/quota`, { executionsPerDay: 1 }],
      ['GET', `/api/workspaces/${B.wsId}/usage`],
      ['GET', `/api/workspaces/${B.wsId}/executions`],
      ['GET', `/api/workspaces/${B.wsId}/library`],
      ['POST', `/api/organizations/${B.orgId}/workspaces`, { name: 'Hack' }],
    ];
    for (const [m, p, body] of probes)
      expect((await send(a, m, p, body)).status, `${m} ${p}`).toBe(404);
    // o convite de B continua ativo e B intacto
    expect((await members(b, B.wsId)).length).toBe(1);
    expect(A.wsId).not.toBe(B.wsId);
  });
  it('execuções de um workspace não aparecem para outro owner de empresa', async () => {
    const [a, b, m] = [await newUser(), await newUser(), await newUser()];
    const A = await makeCompany(a, 'Alpha Co');
    const B = await makeCompany(b, 'Beta Co');
    await join(a, A.wsId, m);
    await send(m, 'POST', '/api/agents/research-assistant/install', { workspaceId: A.wsId });
    const run = await send(m, 'POST', '/api/executions', {
      agentSlug: 'research-assistant',
      workspaceId: A.wsId,
      input: { text: NOTES },
    });
    expect(run.status).toBe(201);
    const d = await json<ExecutionDetail>(run);
    expect((await call(`/api/executions/${d.id}`, { cookie: ck(b) })).status).toBe(404);
    expect((await call(`/api/executions/${d.id}`, { cookie: ck(a) })).status).toBe(200); // owner de A vê
    const histB = await json<{ total: number }>(
      await call(`/api/workspaces/${B.wsId}/executions`, { cookie: ck(b) }),
    );
    expect(histB.total).toBe(0);
  });
});

describe('histórico, uso e cota por membro', () => {
  it('histórico do workspace: admin+ vê as execuções de todos, com filtros; membro 403', async () => {
    const [owner, m1, m2] = [await newUser(), await newUser(), await newUser()] as [U, U, U];
    const { wsId } = await makeCompany(owner);
    await join(owner, wsId, m1);
    await join(owner, wsId, m2);
    for (const u of [m1, m2]) {
      await send(u, 'POST', '/api/agents/research-assistant/install', { workspaceId: wsId });
      expect(
        (
          await send(u, 'POST', '/api/executions', {
            agentSlug: 'research-assistant',
            workspaceId: wsId,
            input: { text: NOTES },
          })
        ).status,
      ).toBe(201);
    }
    const all = await json<{
      total: number;
      executions: Array<{ userId: string; userEmail: string }>;
    }>(await call(`/api/workspaces/${wsId}/executions`, { cookie: ck(owner) }));
    expect(all.total).toBe(2);
    const only = await json<{ total: number }>(
      await call(`/api/workspaces/${wsId}/executions?userId=${await userId(m1)}`, {
        cookie: ck(owner),
      }),
    );
    expect(only.total).toBe(1);
    expect(
      (await call(`/api/workspaces/${wsId}/executions?status=failed`, { cookie: ck(owner) }))
        .status,
    ).toBe(200);
    expect(
      (await call(`/api/workspaces/${wsId}/executions?status=bogus`, { cookie: ck(owner) })).status,
    ).toBe(400);
    expect((await call(`/api/workspaces/${wsId}/executions`, { cookie: ck(m1) })).status).toBe(403);
    // /api/executions continua mostrando só as próprias
    const own = await json<{ total: number }>(await call('/api/executions', { cookie: ck(m1) }));
    expect(own.total).toBe(1);
  });

  it('cota individual: admin define, a execução é recusada com 429 (scope member) sem gravar; remover libera', async () => {
    const [owner, m] = [await newUser(), await newUser()];
    const { wsId } = await makeCompany(owner);
    await join(owner, wsId, m);
    await send(m, 'POST', '/api/agents/research-assistant/install', { workspaceId: wsId });
    const mId = await userId(m);
    const run = () =>
      send(m, 'POST', '/api/executions', {
        agentSlug: 'research-assistant',
        workspaceId: wsId,
        input: { text: NOTES },
      });

    expect(
      (
        await send(m, 'PUT', `/api/workspaces/${wsId}/members/${mId}/quota`, {
          executionsPerDay: 5,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await send(owner, 'PUT', `/api/workspaces/${wsId}/members/${mId}/quota`, {
          executionsPerDay: 99999,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send(owner, 'PUT', `/api/workspaces/${wsId}/members/${mId}/quota`, {
          executionsPerDay: 1,
        })
      ).status,
    ).toBe(200);
    expect((await members(owner, wsId)).find((x) => x.userId === mId)?.quotaPerDay).toBe(1);

    expect((await run()).status).toBe(201);
    const blocked = await run();
    expect(blocked.status).toBe(429);
    expect(
      (await json<{ error: { details: { scope: string } } }>(blocked)).error.details.scope,
    ).toBe('member');
    expect(
      await count(
        'SELECT COUNT(*) AS n FROM agent_executions WHERE user_id = ? AND workspace_id = ?',
        mId,
        wsId,
      ),
    ).toBe(1);

    const usage = await json<WorkspaceUsage>(
      await call(`/api/workspaces/${wsId}/usage`, { cookie: ck(owner) }),
    );
    expect(usage.workspaceUsedToday).toBe(1);
    expect(usage.members.find((x) => x.userId === mId)).toMatchObject({
      usedToday: 1,
      quotaPerDay: 1,
    });
    // membro comum vê só a própria linha
    const mine = await json<WorkspaceUsage>(
      await call(`/api/workspaces/${wsId}/usage`, { cookie: ck(m) }),
    );
    expect(mine.members.map((x) => x.userId)).toEqual([mId]);

    // cota 0 bloqueia; null remove a cota individual
    expect(
      (
        await send(owner, 'PUT', `/api/workspaces/${wsId}/members/${mId}/quota`, {
          executionsPerDay: 0,
        })
      ).status,
    ).toBe(200);
    expect((await run()).status).toBe(429);
    expect(
      (
        await send(owner, 'PUT', `/api/workspaces/${wsId}/members/${mId}/quota`, {
          executionsPerDay: null,
        })
      ).status,
    ).toBe(200);
    expect((await run()).status).toBe(201);
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'member.quota_set' AND workspace_id = ?`,
        wsId,
      ),
    ).toBe(3);
  });
});

describe('biblioteca compartilhada', () => {
  const body = (workspaceId: string) => ({
    workspaceId,
    name: 'Team Digest',
    description: 'Digest for the team',
    objective: 'Summarize',
    instructions: 'Clean and summarize the text.',
    outputFormat: 'markdown',
    tools: [{ key: 'text.clean' }, { key: 'text.summarize', config: { sentences: 2 } }],
    limits: {
      maxInputChars: 5000,
      maxSteps: 6,
      maxDurationMs: 2000,
      maxAttempts: 2,
      requireApproval: false,
    },
  });

  it('owner/admin publica no workspace; todo membro executa sem instalar; fora do workspace é 404', async () => {
    const [owner, admin, member, outsider] = [
      await newUser(),
      await newUser(),
      await newUser(),
      await newUser(),
    ] as [U, U, U, U];
    const { wsId } = await makeCompany(owner);
    await join(owner, wsId, admin, { role: 'admin' });
    await join(owner, wsId, member);
    const created = await json<MyAgentDetail>(
      await send(admin, 'POST', '/api/my/agents', body(wsId)),
    );
    // membro comum não pode compartilhar; pessoal não suporta
    const mine = await json<MyAgentDetail>(
      await send(member, 'POST', '/api/my/agents', body(wsId)),
    );
    const denied = await send(member, 'POST', `/api/my/agents/${mine.id}/publish`, {
      visibility: 'workspace',
    });
    expect(denied.status).toBe(403);
    const personalWs = (await me(admin)).memberships.find(
      (x) => x.organizationKind === 'personal',
    )!.workspaceId;
    const pAgent = await json<MyAgentDetail>(
      await send(admin, 'POST', '/api/my/agents', body(personalWs)),
    );
    const pDenied = await send(admin, 'POST', `/api/my/agents/${pAgent.id}/publish`, {
      visibility: 'workspace',
    });
    expect(pDenied.status).toBe(422);
    expect(await code(pDenied)).toBe('visibility_unavailable');

    const pub = await send(admin, 'POST', `/api/my/agents/${created.id}/publish`, {
      visibility: 'workspace',
    });
    expect(pub.status).toBe(200);
    expect(await json<MyAgentDetail>(pub)).toMatchObject({
      visibility: 'workspace',
      workspaceId: wsId,
      status: 'published',
    });

    const lib = await json<{ items: LibraryItem[] }>(
      await call(`/api/workspaces/${wsId}/library`, { cookie: ck(member) }),
    );
    expect(lib.items).toHaveLength(1);
    expect(lib.items[0]).toMatchObject({
      name: 'Team Digest',
      source: 'workspace',
      requiresApproval: false,
    });
    expect(lib.items[0]?.toolKeys).toEqual(['text.clean', 'text.summarize']);

    const slug = lib.items[0]!.slug;
    const run = await send(member, 'POST', '/api/executions', {
      agentSlug: slug,
      workspaceId: wsId,
      input: { text: NOTES },
    });
    expect(run.status).toBe(201);
    expect((await json<ExecutionDetail>(run)).status).toBe('completed');
    // não está no marketplace nem executa em outro workspace/por estranho
    expect((await call(`/api/agents/${slug}`)).status).toBe(404);
    expect(
      (
        await send(outsider, 'POST', '/api/executions', {
          agentSlug: slug,
          workspaceId: wsId,
          input: { text: NOTES },
        })
      ).status,
    ).toBe(404);
    const otherWs = (await me(member)).memberships.find(
      (x) => x.organizationKind === 'personal',
    )!.workspaceId;
    expect(
      (
        await send(member, 'POST', '/api/executions', {
          agentSlug: slug,
          workspaceId: otherWs,
          input: { text: NOTES },
        })
      ).status,
    ).toBe(404);
    expect((await call(`/api/workspaces/${wsId}/library`, { cookie: ck(outsider) })).status).toBe(
      404,
    );
  });

  it('agente público instalado por owner/admin entra na biblioteca e membros executam sem instalar', async () => {
    const [owner, member] = [await newUser(), await newUser()];
    const { wsId } = await makeCompany(owner);
    await join(owner, wsId, member);
    const slug = 'document-summarizer';
    const run = () =>
      send(member, 'POST', '/api/executions', {
        agentSlug: slug,
        workspaceId: wsId,
        input: { text: NOTES },
      });
    expect((await run()).status).toBe(403); // ninguém instalou ainda
    // instalação por membro comum NÃO compartilha com o workspace
    await send(member, 'POST', `/api/agents/${slug}/install`, { workspaceId: wsId });
    expect(
      (
        await json<{ items: LibraryItem[] }>(
          await call(`/api/workspaces/${wsId}/library`, { cookie: ck(owner) }),
        )
      ).items,
    ).toHaveLength(0);
    await send(member, 'DELETE', `/api/agents/${slug}/install/${wsId}`);
    expect((await run()).status).toBe(403);
    expect(
      (await send(owner, 'POST', `/api/agents/${slug}/install`, { workspaceId: wsId })).status,
    ).toBe(200);
    const lib = await json<{ items: LibraryItem[] }>(
      await call(`/api/workspaces/${wsId}/library`, { cookie: ck(member) }),
    );
    expect(lib.items.map((i) => [i.slug, i.source])).toEqual([[slug, 'shared_install']]);
    expect((await run()).status).toBe(201);
  });

  it('criador removido do workspace perde o controle do agente do workspace; a biblioteca segue com os demais', async () => {
    const [owner, admin] = [await newUser(), await newUser()];
    const { wsId } = await makeCompany(owner);
    await join(owner, wsId, admin, { role: 'admin' });
    const a = await json<MyAgentDetail>(await send(admin, 'POST', '/api/my/agents', body(wsId)));
    expect(
      (await send(admin, 'POST', `/api/my/agents/${a.id}/publish`, { visibility: 'workspace' }))
        .status,
    ).toBe(200);
    expect(
      (await send(owner, 'DELETE', `/api/workspaces/${wsId}/members/${await userId(admin)}`))
        .status,
    ).toBe(200);
    expect((await call(`/api/my/agents/${a.id}`, { cookie: ck(admin) })).status).toBe(404);
    expect(
      (
        await json<{ items: LibraryItem[] }>(
          await call(`/api/workspaces/${wsId}/library`, { cookie: ck(owner) }),
        )
      ).items,
    ).toHaveLength(1);
  });

  it('personal: a biblioteca é vazia e a aprovação de empresa usa owner/admin de verdade', async () => {
    const u = await newUser();
    const ws = (await me(u)).memberships[0]!.workspaceId;
    expect(
      (
        await json<{ items: unknown[] }>(
          await call(`/api/workspaces/${ws}/library`, { cookie: ck(u) }),
        )
      ).items,
    ).toEqual([]);
    const [owner, member] = [await newUser(), await newUser()];
    const { wsId } = await makeCompany(owner);
    await join(owner, wsId, member);
    await send(member, 'POST', '/api/agents/social-media-planner/install', { workspaceId: wsId });
    const d = await json<ExecutionDetail>(
      await send(member, 'POST', '/api/executions', {
        agentSlug: 'social-media-planner',
        workspaceId: wsId,
        input: { topic: 'launch', count: 2 },
      }),
    );
    expect(d.approval).toMatchObject({ method: 'workspace_admin', canDecide: false });
    expect(
      (await send(member, 'POST', `/api/executions/${d.id}/approve`, { confirm: true })).status,
    ).toBe(403);
    const ok = await send(owner, 'POST', `/api/executions/${d.id}/approve`, {});
    expect(ok.status).toBe(200);
    expect((await json<ExecutionDetail>(ok)).status).toBe('completed');
  });
});
