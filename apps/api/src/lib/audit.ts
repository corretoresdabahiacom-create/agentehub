import { auditLogs } from '../db/schema';
import type { Db } from '../db/client';

/**
 * Ações auditadas (Fases 1-2). Bloqueios por rate limit/anti-bot NÃO são auditados de propósito:
 * cada um seria uma escrita sob ataque (orçamento de 100.000 escritas/dia do D1 free).
 */
export type AuditAction =
  | 'auth.signup'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'agent.install'
  | 'agent.uninstall'
  | 'agent.review'
  | 'agent.review_delete'
  | 'agent.create'
  | 'agent.publish'
  | 'agent.archive'
  | 'execution.create'
  | 'execution.retry'
  | 'execution.cancel'
  | 'execution.approve'
  | 'execution.reject'
  | 'execution.expire';

const FORBIDDEN_KEYS = /pass(word)?|secret|token|authorization|cookie|pepper|hash/i;

export interface AuditEntry {
  action: AuditAction;
  actorUserId?: string | null;
  workspaceId?: string | null;
  targetType?: string;
  targetId?: string;
  ipHash?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}

/** Garante que metadados nunca carreguem segredos (defesa em profundidade; lança em desenvolvimento). */
export function sanitizeMetadata(
  metadata: AuditEntry['metadata'],
): Record<string, string | number | boolean | null> | undefined {
  if (!metadata) return undefined;
  for (const key of Object.keys(metadata)) {
    if (FORBIDDEN_KEYS.test(key)) {
      throw new Error(`audit metadata key not allowed: ${key}`);
    }
  }
  return metadata;
}

export function auditStatement(db: Db, entry: AuditEntry) {
  const metadata = sanitizeMetadata(entry.metadata);
  return db.insert(auditLogs).values({
    id: crypto.randomUUID(),
    actorUserId: entry.actorUserId ?? null,
    workspaceId: entry.workspaceId ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    metadataJson: metadata ? JSON.stringify(metadata) : null,
    ipHash: entry.ipHash ?? null,
  });
}

/** Registra um evento. Falha de auditoria é logada, mas não derruba a requisição já concluída. */
export async function audit(db: Db, entry: AuditEntry): Promise<void> {
  try {
    await auditStatement(db, entry);
  } catch (err) {
    console.error('audit_write_failed', entry.action, err instanceof Error ? err.message : 'error');
  }
}
