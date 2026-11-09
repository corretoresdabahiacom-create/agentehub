import { describe, expect, it } from 'vitest';
import {
  DUMMY_PASSWORD_HASH,
  PBKDF2_ITERATIONS,
  hashPassword,
  needsRehash,
  randomToken,
  sha256Hex,
  timingSafeEqual,
  verifyPassword,
} from '../src/lib/crypto';

const pepper = crypto.randomUUID() + crypto.randomUUID();

describe('hash de senha (PBKDF2 + pepper)', () => {
  it('verifica a senha correta e rejeita a errada', async () => {
    const stored = await hashPassword('senha-muito-longa-123', pepper);
    expect(await verifyPassword('senha-muito-longa-123', stored, pepper)).toBe(true);
    expect(await verifyPassword('senha-muito-longa-124', stored, pepper)).toBe(false);
  });

  it('usa salt por usuário: mesma senha gera hashes diferentes', async () => {
    const a = await hashPassword('mesma-senha-123456', pepper);
    const b = await hashPassword('mesma-senha-123456', pepper);
    expect(a).not.toBe(b);
  });

  it('o pepper é parte da derivação: outro pepper não verifica', async () => {
    const stored = await hashPassword('senha-muito-longa-123', pepper);
    expect(await verifyPassword('senha-muito-longa-123', stored, pepper + 'x')).toBe(false);
  });

  it('o formato guarda algoritmo e iterações e não contém a senha', async () => {
    const stored = await hashPassword('senha-muito-longa-123', pepper);
    const [scheme, iterations] = stored.split('$');
    expect(scheme).toBe('pbkdf2-sha256');
    expect(Number(iterations)).toBe(PBKDF2_ITERATIONS);
    expect(stored).not.toContain('senha-muito-longa-123');
  });

  it('hash malformado nunca verifica (sem lançar)', async () => {
    for (const bad of ['', 'lixo', 'pbkdf2-sha256$x$y$z', 'md5$1$AA==$AA==']) {
      expect(await verifyPassword('qualquer', bad, pepper)).toBe(false);
    }
  });

  it('exige pepper (falha fechada)', async () => {
    await expect(hashPassword('senha-muito-longa-123', '')).rejects.toThrow();
    await expect(verifyPassword('x', DUMMY_PASSWORD_HASH, '')).rejects.toThrow();
  });

  it('o hash "dummy" é válido e realmente executa PBKDF2 (equaliza o tempo de login)', async () => {
    const started = performance.now();
    const ok = await verifyPassword('qualquer-senha', DUMMY_PASSWORD_HASH, pepper);
    const elapsed = performance.now() - started;
    expect(ok).toBe(false);
    // Se o dummy fosse inválido, retornaria em microssegundos sem derivar.
    expect(elapsed).toBeGreaterThan(0.5);
  });

  it('needsRehash identifica hashes com menos iterações', async () => {
    const stored = await hashPassword('senha-muito-longa-123', pepper);
    expect(needsRehash(stored)).toBe(false);
    expect(needsRehash(stored.replace(`$${PBKDF2_ITERATIONS}$`, '$1000$'))).toBe(true);
    expect(needsRehash('lixo')).toBe(true);
  });

  it('mede o custo de uma derivação (informativo, para o risco dos 10 ms de CPU)', async () => {
    const t0 = performance.now();
    await hashPassword('senha-muito-longa-123', pepper);
    const ms = performance.now() - t0;
    console.warn(
      `[bench] PBKDF2 ${PBKDF2_ITERATIONS} iterações no workerd local: ${ms.toFixed(1)} ms (relógio de parede)`,
    );
    expect(ms).toBeGreaterThan(0);
  });
});

describe('utilitários', () => {
  it('randomToken tem entropia e é URL-safe', () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('sha256Hex é determinístico', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('timingSafeEqual compara conteúdo e tamanho', () => {
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(timingSafeEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });
});
