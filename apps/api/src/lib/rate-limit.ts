/**
 * Rate limit de janela fixa em D1 (tabela rate_limit_counters).
 *
 * Por que D1 e não KV: o KV free permite só 1.000 escritas/dia (docs/free-tier-limits.md), o que um
 * contador por requisição esgotaria em minutos. Aqui só endpoints sensíveis consomem escrita, e
 * requisições JÁ bloqueadas não escrevem (o UPDATE só ocorre enquanto count < limite), então um
 * atacante não consegue queimar o orçamento de escritas do D1 por trás de um bloqueio.
 * Limitação conhecida: o próprio teto de 100.000 requisições/dia do Workers free pode ser esgotado
 * por tráfego abusivo; isso não gera cobrança, apenas indisponibilidade (docs/limitations.md).
 */
export interface RateLimitResult {
  allowed: boolean;
  /** Segundos até a janela atual terminar (para o header Retry-After). */
  retryAfterSec: number;
}

export async function rateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowSec: number,
  nowMs = Date.now(),
): Promise<RateLimitResult> {
  const windowMs = windowSec * 1000;
  const windowStart = Math.floor(nowMs / windowMs) * windowMs;
  const retryAfterSec = Math.max(1, Math.ceil((windowStart + windowMs - nowMs) / 1000));

  const row = await db
    .prepare(
      `INSERT INTO rate_limit_counters (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1 WHERE count < ?3
       RETURNING count`,
    )
    .bind(key, windowStart, limit)
    .first<{ count: number }>();

  // Sem linha retornada: o WHERE falhou, ou seja, o limite já foi atingido.
  const allowed = row !== null && row.count <= limit;

  // Limpeza oportunista (~2% das chamadas) de janelas antigas, para a tabela não crescer sem fim.
  if (Math.random() < 0.02) {
    await db
      .prepare('DELETE FROM rate_limit_counters WHERE window_start < ?1')
      .bind(nowMs - 2 * 24 * 3600 * 1000)
      .run();
  }

  return { allowed, retryAfterSec };
}
