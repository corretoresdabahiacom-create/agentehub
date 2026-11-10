import { execFileSync } from 'node:child_process';
import path from 'node:path';

const API_DIR = path.resolve(import.meta.dirname, '../../api');

const q = (v: string) => `'${v.replaceAll("'", "''")}'`;

/** Executa SQL no D1 local do E2E (o mesmo que o `wrangler dev` do teste usa). */
export function sql(command: string): void {
  execFileSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      'agenthub',
      '--local',
      '--persist-to',
      '.wrangler/e2e-state',
      '--command',
      command,
    ],
    { cwd: API_DIR, stdio: 'pipe' },
  );
}

/**
 * Fixture: cria uma execução CONCLUÍDA para a instalação do usuário. A execução real de agentes só
 * existe na Fase 3; aqui o teste fabrica a linha no banco local descartável do E2E.
 */
export function completeExecution(email: string, agentSlug: string, finishedDaysAgo = 1): void {
  const finishedAt = Date.now() - finishedDaysAgo * 24 * 3600 * 1000;
  sql(
    `INSERT INTO agent_executions (id, agent_id, agent_version_id, installation_id, workspace_id, user_id, status, finished_at)
     SELECT ${q(crypto.randomUUID())}, i.agent_id, a.current_version_id, i.id, i.workspace_id, i.user_id, 'completed', ${finishedAt}
     FROM agent_installations i
     JOIN agents a ON a.id = i.agent_id
     JOIN users u ON u.id = i.user_id
     WHERE u.email = ${q(email)} AND a.slug = ${q(agentSlug)}`,
  );
}
