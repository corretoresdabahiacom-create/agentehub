import { describe, expect, it } from 'vitest';
import { call, db, signup } from './helpers';

interface Membership {
  workspaceId: string;
  role: string;
}

async function workspaceOf(cookie: string): Promise<string> {
  const me = (await (await call('/api/auth/me', { cookie })).json()) as {
    memberships: Membership[];
  };
  const id = me.memberships[0]?.workspaceId;
  if (!id) throw new Error('usuário sem workspace');
  return id;
}

async function userId(email: string): Promise<string> {
  const row = await db()
    .prepare('SELECT id FROM users WHERE email = ?1')
    .bind(email)
    .first<{ id: string }>();
  if (!row) throw new Error('usuário não encontrado');
  return row.id;
}

describe('autorização e isolamento entre workspaces', () => {
  it('rotas protegidas exigem sessão (401)', async () => {
    expect((await call('/api/workspaces')).status).toBe(401);
    expect((await call(`/api/workspaces/${crypto.randomUUID()}`)).status).toBe(401);
  });

  it('o dono acessa o próprio workspace', async () => {
    const a = await signup();
    const ws = await workspaceOf(a.cookie ?? '');
    const res = await call(`/api/workspaces/${ws}`, { cookie: a.cookie ?? '' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { workspace: { id: string; role: string } };
    expect(body.workspace.id).toBe(ws);
    expect(body.workspace.role).toBe('owner');
  });

  it('ISOLAMENTO: usuário A não vê o workspace de B (404, sem revelar existência)', async () => {
    const a = await signup();
    const b = await signup();
    const wsB = await workspaceOf(b.cookie ?? '');

    const detail = await call(`/api/workspaces/${wsB}`, { cookie: a.cookie ?? '' });
    const members = await call(`/api/workspaces/${wsB}/members`, { cookie: a.cookie ?? '' });
    const inexistente = await call(`/api/workspaces/${crypto.randomUUID()}`, {
      cookie: a.cookie ?? '',
    });

    expect(detail.status).toBe(404);
    expect(members.status).toBe(404);
    // Mesma resposta para "existe mas não é seu" e "não existe": nada vaza.
    expect(await detail.text()).toBe(await inexistente.text());
  });

  it('ISOLAMENTO: a listagem de workspaces mostra apenas os do próprio usuário', async () => {
    const a = await signup();
    const b = await signup();
    const wsA = await workspaceOf(a.cookie ?? '');
    const wsB = await workspaceOf(b.cookie ?? '');
    const list = (await (await call('/api/workspaces', { cookie: a.cookie ?? '' })).json()) as {
      workspaces: Membership[];
    };
    const ids = list.workspaces.map((w) => w.workspaceId);
    expect(ids).toContain(wsA);
    expect(ids).not.toContain(wsB);
  });

  it('papel member NÃO lista membros (403); admin e owner listam', async () => {
    const owner = await signup();
    const guest = await signup();
    const ws = await workspaceOf(owner.cookie ?? '');
    const guestId = await userId(guest.email);

    await db()
      .prepare(
        "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?1, ?2, 'member')",
      )
      .bind(ws, guestId)
      .run();

    // O convidado agora é membro (vê o workspace) mas sem privilégio de administração.
    expect((await call(`/api/workspaces/${ws}`, { cookie: guest.cookie ?? '' })).status).toBe(200);
    expect(
      (await call(`/api/workspaces/${ws}/members`, { cookie: guest.cookie ?? '' })).status,
    ).toBe(403);

    await db()
      .prepare(
        "UPDATE workspace_members SET role = 'admin' WHERE workspace_id = ?1 AND user_id = ?2",
      )
      .bind(ws, guestId)
      .run();
    const asAdmin = await call(`/api/workspaces/${ws}/members`, { cookie: guest.cookie ?? '' });
    expect(asAdmin.status).toBe(200);
    expect(((await asAdmin.json()) as { members: unknown[] }).members).toHaveLength(2);

    expect(
      (await call(`/api/workspaces/${ws}/members`, { cookie: owner.cookie ?? '' })).status,
    ).toBe(200);
  });

  it('remover o membership revoga o acesso imediatamente', async () => {
    const owner = await signup();
    const guest = await signup();
    const ws = await workspaceOf(owner.cookie ?? '');
    const guestId = await userId(guest.email);
    await db()
      .prepare(
        "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?1, ?2, 'member')",
      )
      .bind(ws, guestId)
      .run();
    expect((await call(`/api/workspaces/${ws}`, { cookie: guest.cookie ?? '' })).status).toBe(200);
    await db()
      .prepare('DELETE FROM workspace_members WHERE workspace_id = ?1 AND user_id = ?2')
      .bind(ws, guestId)
      .run();
    expect((await call(`/api/workspaces/${ws}`, { cookie: guest.cookie ?? '' })).status).toBe(404);
  });

  it('o id do workspace na URL não concede acesso por si só (nem com id válido de outra pessoa)', async () => {
    const a = await signup();
    const b = await signup();
    const wsB = await workspaceOf(b.cookie ?? '');
    for (const path of [`/api/workspaces/${wsB}`, `/api/workspaces/${wsB}/members`]) {
      expect((await call(path, { cookie: a.cookie ?? '' })).status).toBe(404);
    }
  });
});
