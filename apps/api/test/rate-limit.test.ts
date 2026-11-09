import { describe, expect, it } from 'vitest';
import { rateLimit } from '../src/lib/rate-limit';
import { db } from './helpers';

const key = () => `test:${crypto.randomUUID()}`;
const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);

async function countOf(k: string): Promise<number> {
  const row = await db()
    .prepare('SELECT COALESCE(SUM(count), 0) AS c FROM rate_limit_counters WHERE key = ?1')
    .bind(k)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

describe('rateLimit (janela fixa em D1)', () => {
  it('permite até o limite e bloqueia depois', async () => {
    const k = key();
    const results = [];
    for (let i = 0; i < 5; i++) results.push((await rateLimit(db(), k, 3, 60, NOW)).allowed);
    expect(results).toEqual([true, true, true, false, false]);
  });

  it('requisições bloqueadas NÃO escrevem (não queimam o orçamento de escritas do D1)', async () => {
    const k = key();
    for (let i = 0; i < 10; i++) await rateLimit(db(), k, 2, 60, NOW);
    expect(await countOf(k)).toBe(2);
  });

  it('janelas diferentes têm contadores independentes', async () => {
    const k = key();
    expect((await rateLimit(db(), k, 1, 60, NOW)).allowed).toBe(true);
    expect((await rateLimit(db(), k, 1, 60, NOW)).allowed).toBe(false);
    expect((await rateLimit(db(), k, 1, 60, NOW + 61_000)).allowed).toBe(true);
  });

  it('chaves diferentes não interferem', async () => {
    const a = key();
    const b = key();
    expect((await rateLimit(db(), a, 1, 60, NOW)).allowed).toBe(true);
    expect((await rateLimit(db(), b, 1, 60, NOW)).allowed).toBe(true);
  });

  it('informa Retry-After coerente com o fim da janela', async () => {
    const k = key();
    const r = await rateLimit(db(), k, 1, 60, NOW + 20_000); // 20s dentro da janela de 60s
    expect(r.retryAfterSec).toBe(40);
  });
});
