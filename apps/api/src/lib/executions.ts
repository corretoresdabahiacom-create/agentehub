import {
  agentLimitsSchema,
  OUTPUT_FORMATS,
  PLATFORM_LIMITS,
  runPipeline,
  transition,
  type AgentLimits,
  type ExecutionInput,
  type OutputFormat,
} from '@agenthub/shared';
import { HttpError, utcDay } from './http';
import { parseObject } from './route-utils';

export interface RunnableVersion {
  id: string;
  outputFormat: OutputFormat;
  limits: AgentLimits;
  tools: Array<{ key: string; config: Record<string, unknown> }>;
}

/** Carrega uma versão publicada pronta para executar. Limites inválidos => nulo (agente quebrado). */
export async function loadRunnableVersion(
  db: D1Database,
  versionId: string,
): Promise<RunnableVersion | null> {
  const v = await db
    .prepare('SELECT id, output_format, limits_json FROM agent_versions WHERE id = ?')
    .bind(versionId)
    .first<{ id: string; output_format: string; limits_json: string }>();
  if (!v) return null;
  const limits = agentLimitsSchema.safeParse(parseObject(v.limits_json));
  if (!limits.success) return null;
  const { results } = await db
    .prepare(
      'SELECT tool_key, config_json FROM agent_tools WHERE agent_version_id = ? ORDER BY tool_key',
    )
    .bind(versionId)
    .all<{ tool_key: string; config_json: string }>();
  const fmt = (OUTPUT_FORMATS as readonly string[]).includes(v.output_format)
    ? (v.output_format as OutputFormat)
    : 'text';
  return {
    id: v.id,
    outputFormat: fmt,
    limits: limits.data,
    tools: results.map((t) => ({ key: t.tool_key, config: parseObject(t.config_json) })),
  };
}

export type ApprovalMethod = 'workspace_admin' | 'self_second_step';
/** Conta individual: o próprio usuário confirma num 2º passo. Empresa: owner/admin do workspace. */
export const approvalMethodFor = (orgKind: string): ApprovalMethod =>
  orgKind === 'personal' ? 'self_second_step' : 'workspace_admin';

export const approvalExpiry = (createdAt: number): number =>
  createdAt + PLATFORM_LIMITS.approvalTtlHours * 3_600_000;

const EXT: Record<OutputFormat, string> = { text: 'txt', markdown: 'md', json: 'json' };
const byteLength = (s: string) => new TextEncoder().encode(s).length;

export interface RunParams {
  executionId: string;
  version: RunnableVersion;
  input: ExecutionInput;
  userId: string;
  workspaceId: string;
  orgKind: string;
}

/**
 * Executa uma execução que está em `pending`: pending -> running -> (completed | awaiting_approval | failed).
 * Cada transição é um UPDATE guardado pelo estado anterior; o resultado inteiro (passos, estado final,
 * aprovação/artefato e uso) é gravado em UM batch atômico do D1.
 */
export async function runExecution(
  db: D1Database,
  p: RunParams,
): Promise<'completed' | 'awaiting_approval' | 'failed'> {
  const startedAt = Date.now();
  const running = transition('pending', 'START');
  const started = await db
    .prepare(
      `UPDATE agent_executions SET status = ?1, attempts = attempts + 1, started_at = ?2, finished_at = NULL,
         error = NULL, updated_at = ?2 WHERE id = ?3 AND status = 'pending'`,
    )
    .bind(running, startedAt, p.executionId)
    .run();
  if (started.meta.changes !== 1) throw new HttpError(409, 'invalid_state');

  const result = runPipeline({
    tools: p.version.tools,
    input: p.input,
    limits: p.version.limits,
    outputFormat: p.version.outputFormat,
  });
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [
    db.prepare('DELETE FROM execution_steps WHERE execution_id = ?').bind(p.executionId),
  ];
  for (const s of result.steps) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO execution_steps (id, execution_id, seq, name, status, output_json, error, started_at, finished_at, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
        )
        .bind(
          crypto.randomUUID(),
          p.executionId,
          s.seq,
          s.name,
          s.status,
          s.preview === null ? null : JSON.stringify({ preview: s.preview }),
          s.error,
          s.startedAt,
          s.finishedAt,
          now,
        ),
    );
  }

  // Em todos os ramos o primeiro statement após os passos é o UPDATE de estado guardado.
  const stateIdx = stmts.length;
  let outcome: 'completed' | 'awaiting_approval' | 'failed';
  if (result.status === 'failed') {
    outcome = 'failed';
    const next = transition('running', 'FAIL');
    const error = result.detail ? `${result.error}:${result.detail}`.slice(0, 200) : result.error;
    stmts.push(
      db
        .prepare(
          `UPDATE agent_executions SET status = ?1, error = ?2, finished_at = ?3, updated_at = ?3
           WHERE id = ?4 AND status = 'running'`,
        )
        .bind(next, error, now, p.executionId),
    );
  } else if (result.status === 'awaiting_approval') {
    outcome = 'awaiting_approval';
    const next = transition('running', 'REQUEST_APPROVAL');
    stmts.push(
      db
        .prepare(
          `UPDATE agent_executions SET status = ?1, output_json = ?2, updated_at = ?3
           WHERE id = ?4 AND status = 'running'`,
        )
        .bind(next, JSON.stringify(result.output), now, p.executionId),
      db
        .prepare(
          `INSERT INTO execution_approvals (id, execution_id, requested_by, decision, method, created_at)
           VALUES (?1, ?2, ?3, 'pending', ?4, ?5)`,
        )
        .bind(crypto.randomUUID(), p.executionId, p.userId, approvalMethodFor(p.orgKind), now),
    );
  } else {
    outcome = 'completed';
    const next = transition('running', 'COMPLETE');
    stmts.push(
      db
        .prepare(
          `UPDATE agent_executions SET status = ?1, output_json = ?2, finished_at = ?3, updated_at = ?3
           WHERE id = ?4 AND status = 'running'`,
        )
        .bind(next, JSON.stringify(result.output), now, p.executionId),
      artifactInsert(db, p.executionId, result.output, p.version.outputFormat, now),
    );
  }
  stmts.push(
    db
      .prepare(
        `INSERT INTO usage_records (id, workspace_id, user_id, metric, quantity, day, created_at)
         VALUES (?1, ?2, ?3, 'execution', 1, ?4, ?5)`,
      )
      .bind(crypto.randomUUID(), p.workspaceId, p.userId, utcDay(now), now),
  );
  const res = await db.batch(stmts);
  if (res[stateIdx]?.meta.changes !== 1) throw new HttpError(409, 'invalid_state');
  return outcome;
}

export function artifactInsert(
  db: D1Database,
  executionId: string,
  output: { content: string; mimeType: string },
  format: OutputFormat,
  now: number,
  requireCompletedAt?: number,
): D1PreparedStatement {
  // Só insere se a execução realmente está concluída (guarda para o fluxo de aprovação).
  return db
    .prepare(
      `INSERT INTO execution_artifacts (id, execution_id, name, mime_type, content_text, size_bytes, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
       WHERE EXISTS (SELECT 1 FROM agent_executions WHERE id = ?2 AND status = 'completed' AND finished_at = ?8)`,
    )
    .bind(
      crypto.randomUUID(),
      executionId,
      `result.${EXT[format]}`,
      output.mimeType,
      output.content,
      byteLength(output.content),
      now,
      requireCompletedAt ?? now,
    );
}
