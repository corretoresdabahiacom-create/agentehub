import { describe, expect, it } from 'vitest';
import { db } from './helpers';

const run = (sql: string, ...params: unknown[]) =>
  db()
    .prepare(sql)
    .bind(...params)
    .run();
const uuid = () => crypto.randomUUID();

async function makeUser(): Promise<string> {
  const id = uuid();
  await run(
    'INSERT INTO users (id, email, password_hash) VALUES (?1, ?2, ?3)',
    id,
    `${id}@x.test`,
    'h',
  );
  return id;
}

async function makeWorkspace(userId: string): Promise<string> {
  const org = uuid();
  const ws = uuid();
  await run(
    'INSERT INTO organizations (id, name, slug, owner_user_id) VALUES (?1,?2,?3,?4)',
    org,
    'o',
    org,
    userId,
  );
  await run(
    'INSERT INTO workspaces (id, organization_id, name, slug) VALUES (?1,?2,?3,?4)',
    ws,
    org,
    'w',
    'w',
  );
  return ws;
}

describe('integridade do schema (migrações reais)', () => {
  it('seed: monetization_enabled existe e está DESLIGADA (R7)', async () => {
    const row = await db()
      .prepare("SELECT enabled FROM feature_flags WHERE key = 'monetization_enabled'")
      .first<{ enabled: number }>();
    expect(row?.enabled).toBe(0);
  });

  it('seed: configurações de marca existem (editáveis no painel admin)', async () => {
    const row = await db()
      .prepare("SELECT value_json FROM system_settings WHERE key = 'brand.name'")
      .first<{ value_json: string }>();
    expect(JSON.parse(row?.value_json ?? 'null')).toBe('AI AgentHub');
  });

  it('feature_flags só aceita 0 ou 1', async () => {
    await expect(run("INSERT INTO feature_flags (key, enabled) VALUES ('x', 2)")).rejects.toThrow();
  });

  it('e-mail deve ser minúsculo', async () => {
    await expect(
      run(
        'INSERT INTO users (id, email, password_hash) VALUES (?1, ?2, ?3)',
        uuid(),
        'Maiuscula@X.test',
        'h',
      ),
    ).rejects.toThrow();
  });

  it('e-mail é único', async () => {
    const id = uuid();
    const email = `${id}@x.test`;
    await run('INSERT INTO users (id, email, password_hash) VALUES (?1, ?2, ?3)', id, email, 'h');
    await expect(
      run('INSERT INTO users (id, email, password_hash) VALUES (?1, ?2, ?3)', uuid(), email, 'h'),
    ).rejects.toThrow();
  });

  it('papéis e estados inválidos são rejeitados pelo banco', async () => {
    const u = await makeUser();
    const ws = await makeWorkspace(u);
    await expect(
      run(
        'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?1,?2,?3)',
        ws,
        u,
        'superuser',
      ),
    ).rejects.toThrow();
    await expect(run("UPDATE users SET status = 'banido' WHERE id = ?1", u)).rejects.toThrow();
  });

  it('chaves estrangeiras são aplicadas', async () => {
    await expect(run('INSERT INTO user_profiles (user_id) VALUES (?1)', uuid())).rejects.toThrow();
  });

  it('agente público não pode ter workspace; privado/workspace precisa ter', async () => {
    const u = await makeUser();
    const ws = await makeWorkspace(u);
    const insert = (visibility: string, workspaceId: string | null) =>
      run(
        'INSERT INTO agents (id, workspace_id, creator_user_id, slug, name, visibility) VALUES (?1,?2,?3,?4,?5,?6)',
        uuid(),
        workspaceId,
        u,
        uuid(),
        'a',
        visibility,
      );
    await expect(insert('public', ws)).rejects.toThrow();
    await expect(insert('private', null)).rejects.toThrow();
    await expect(insert('workspace', null)).rejects.toThrow();
    await insert('public', null);
    await insert('private', ws);
  });

  it('avaliação exige nota de 1 a 5', async () => {
    const u = await makeUser();
    const ws = await makeWorkspace(u);
    const agent = uuid();
    await run(
      'INSERT INTO agents (id, workspace_id, creator_user_id, slug, name, visibility) VALUES (?1,?2,?3,?4,?5,?6)',
      agent,
      ws,
      u,
      uuid(),
      'a',
      'private',
    );
    const inst = uuid();
    await run(
      'INSERT INTO agent_installations (id, agent_id, workspace_id, user_id) VALUES (?1,?2,?3,?4)',
      inst,
      agent,
      ws,
      u,
    );
    const review = (rating: number) =>
      run(
        'INSERT INTO agent_reviews (id, agent_id, user_id, installation_id, rating) VALUES (?1,?2,?3,?4,?5)',
        uuid(),
        agent,
        u,
        inst,
        rating,
      );
    await expect(review(0)).rejects.toThrow();
    await expect(review(6)).rejects.toThrow();
    await review(5);
  });

  it('execução só aceita os 6 estados da máquina de estados', async () => {
    const u = await makeUser();
    const ws = await makeWorkspace(u);
    const agent = uuid();
    await run(
      'INSERT INTO agents (id, workspace_id, creator_user_id, slug, name, visibility) VALUES (?1,?2,?3,?4,?5,?6)',
      agent,
      ws,
      u,
      uuid(),
      'a',
      'private',
    );
    const version = uuid();
    await run(
      'INSERT INTO agent_versions (id, agent_id, version, created_by) VALUES (?1,?2,1,?3)',
      version,
      agent,
      u,
    );
    const exec = (status: string) =>
      run(
        'INSERT INTO agent_executions (id, agent_id, agent_version_id, workspace_id, user_id, status) VALUES (?1,?2,?3,?4,?5,?6)',
        uuid(),
        agent,
        version,
        ws,
        u,
        status,
      );
    await expect(exec('queued')).rejects.toThrow();
    for (const s of [
      'pending',
      'running',
      'awaiting_approval',
      'completed',
      'failed',
      'canceled',
    ]) {
      await exec(s);
    }
  });

  it('convite não pode ser usado além de max_uses', async () => {
    const u = await makeUser();
    const ws = await makeWorkspace(u);
    const org = (
      await db()
        .prepare('SELECT organization_id AS o FROM workspaces WHERE id = ?1')
        .bind(ws)
        .first<{ o: string }>()
    )?.o;
    await expect(
      run(
        'INSERT INTO organization_invites (id, organization_id, token_hash, created_by, expires_at, max_uses, use_count) VALUES (?1,?2,?3,?4,?5,1,2)',
        uuid(),
        org,
        uuid(),
        u,
        Date.now() + 1000,
      ),
    ).rejects.toThrow();
  });
});
