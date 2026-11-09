/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { requirePlatformAdmin } from '../src/middleware/authz';
import { call, db, signup } from './helpers';

/**
 * R7: nenhuma rota de pagamento/assinatura/comissão existe. Qualquer caminho desse tipo deve
 * responder 404, com e sem sessão, para qualquer método.
 */
const BILLING_PATHS = [
  '/api/billing',
  '/api/billing/portal',
  '/api/checkout',
  '/api/checkout/session',
  '/api/payments',
  '/api/payments/webhook',
  '/api/subscriptions',
  '/api/plans',
  '/api/credits',
  '/api/invoices',
  '/api/stripe/webhook',
  '/api/mercadopago/webhook',
  '/api/webhooks/payments',
  '/billing',
  '/checkout',
];

describe('monetização desligada (R7)', () => {
  it('nenhuma rota de cobrança existe: 404 para todos os métodos, anônimo ou autenticado', async () => {
    const { cookie } = await signup();
    for (const path of BILLING_PATHS) {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
        const body = method === 'GET' || method === 'DELETE' ? undefined : {};
        const anon = await call(path, { method, body });
        const authed = await call(path, { method, body, cookie: cookie ?? '' });
        expect(anon.status, `${method} ${path} (anônimo)`).toBe(404);
        expect(authed.status, `${method} ${path} (autenticado)`).toBe(404);
      }
    }
  });

  it('a flag monetization_enabled existe e está desligada', async () => {
    const row = await db()
      .prepare("SELECT enabled FROM feature_flags WHERE key = 'monetization_enabled'")
      .first<{ enabled: number }>();
    expect(row?.enabled).toBe(0);
  });

  it('o código-fonte não declara rotas de cobrança', async () => {
    const files = import.meta.glob('../src/**/*.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    expect(Object.keys(files).length).toBeGreaterThan(5);
    for (const [file, source] of Object.entries(files)) {
      expect(source, file).not.toMatch(
        /\.(get|post|put|patch|delete|route)\(\s*['"`]\/(billing|checkout|payments?|subscriptions?|stripe|invoices?)/i,
      );
    }
  });
});

describe('requirePlatformAdmin', () => {
  const run = async (platformRole: 'user' | 'admin' | null) => {
    const next = async () => undefined;
    const ctx = { var: { auth: platformRole ? { user: { platformRole } } : null } };
    try {
      await requirePlatformAdmin(ctx as never, next);
      return 'ok';
    } catch (e) {
      return (e as { status: number }).status;
    }
  };
  it('anônimo 401, usuário comum 403, admin passa', async () => {
    expect(await run(null)).toBe(401);
    expect(await run('user')).toBe(403);
    expect(await run('admin')).toBe('ok');
  });
});
