import { afterEach, describe, expect, it, vi } from 'vitest';
import { sanitizeMetadata } from '../src/lib/audit';
import { sha256Hex } from '../src/lib/crypto';
import { PREV_TOKEN_GRACE_MS, ROTATE_AFTER_MS, SESSION_COOKIE } from '../src/middleware/session';
import {
  STRONG_PASSWORD,
  call,
  db,
  devEnv,
  enforcedEnv,
  rawSessionSetCookie,
  sessionCookieOf,
  signup,
  uniqueEmail,
  uniqueIp,
} from './helpers';

afterEach(() => vi.restoreAllMocks());

const tokenOf = (cookie: string) => cookie.slice(cookie.indexOf('=') + 1);

describe('cadastro', () => {
  it('cria conta, organization pessoal, workspace e membership owner, e já abre sessão', async () => {
    const { res, email, cookie } = await signup();
    expect(res.status).toBe(201);
    expect(cookie).toBeTruthy();
    const body = (await res.json()) as {
      user: { email: string };
      memberships: Array<{ role: string }>;
    };
    expect(body.user.email).toBe(email);
    expect(body.memberships).toHaveLength(1);
    expect(body.memberships[0]?.role).toBe('owner');
  });

  it('o cookie é HttpOnly, Secure, SameSite=Lax, Path=/, com prefixo __Host- e sem Domain', async () => {
    const { res } = await signup();
    const raw = rawSessionSetCookie(res) ?? '';
    expect(raw.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    expect(SESSION_COOKIE.startsWith('__Host-')).toBe(true);
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/Secure/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).toMatch(/Path=\//i);
    expect(raw).not.toMatch(/Domain=/i);
  });

  it('a resposta nunca contém hash de senha, token ou a própria senha', async () => {
    const { res } = await signup();
    const text = await res.text();
    expect(text).not.toMatch(/password|pbkdf2|token/i);
    expect(text).not.toContain(STRONG_PASSWORD);
  });

  it('o token de sessão NÃO é guardado em claro: só o SHA-256', async () => {
    const { res, email } = await signup();
    const token = tokenOf(sessionCookieOf(res) ?? '');
    const row = await db()
      .prepare(
        'SELECT s.token_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = ?1',
      )
      .bind(email)
      .first<{ token_hash: string }>();
    expect(row?.token_hash).not.toBe(token);
    expect(row?.token_hash).toBe(await sha256Hex(token));
  });

  it('a senha é guardada como hash PBKDF2, nunca em claro', async () => {
    const { email } = await signup();
    const row = await db()
      .prepare('SELECT password_hash FROM users WHERE email = ?1')
      .bind(email)
      .first<{ password_hash: string }>();
    expect(row?.password_hash.startsWith('pbkdf2-sha256$')).toBe(true);
    expect(row?.password_hash).not.toContain(STRONG_PASSWORD);
  });

  it('rejeita e-mail repetido (409), inclusive com maiúsculas', async () => {
    const { email } = await signup();
    const again = await call('/api/auth/signup', {
      body: { email: email.toUpperCase(), password: STRONG_PASSWORD },
    });
    expect(again.status).toBe(409);
  });

  it('valida entrada e não ecoa a senha nos erros', async () => {
    const weak = await call('/api/auth/signup', {
      body: { email: uniqueEmail(), password: 'curta' },
    });
    expect(weak.status).toBe(400);
    expect(await weak.text()).not.toContain('curta');
    const bad = await call('/api/auth/signup', {
      body: { email: 'nao-e-email', password: STRONG_PASSWORD },
    });
    expect(bad.status).toBe(400);
  });

  it('rejeita JSON inválido (400) e corpo gigante (413)', async () => {
    const invalid = await call('/api/auth/signup', { body: '{nao-json' });
    expect(invalid.status).toBe(400);
    const huge = await call('/api/auth/signup', {
      body: JSON.stringify({ email: uniqueEmail(), password: 'x'.repeat(20_000) }),
    });
    expect(huge.status).toBe(413);
  });

  it('limita cadastros por IP (429 com Retry-After)', async () => {
    const ip = uniqueIp();
    const statuses: number[] = [];
    let retryAfter: string | null = null;
    for (let i = 0; i < 7; i++) {
      const r = await call('/api/auth/signup', {
        body: { email: uniqueEmail(), password: STRONG_PASSWORD },
        ip,
      });
      statuses.push(r.status);
      if (r.status === 429) retryAfter = r.headers.get('retry-after');
    }
    expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(statuses.slice(5)).toEqual([429, 429]);
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  it('cap global diário recusa com erro claro (sem estourar o free tier)', async () => {
    const env = { ...devEnv(), GLOBAL_SIGNUPS_PER_DAY: '1' };
    // O contador global é por dia UTC e compartilhado entre testes: zera para ser determinístico.
    await db().prepare("DELETE FROM rate_limit_counters WHERE key = 'global:signup'").run();
    const first = await call('/api/auth/signup', {
      body: { email: uniqueEmail(), password: STRONG_PASSWORD },
      env,
    });
    const second = await call('/api/auth/signup', {
      body: { email: uniqueEmail(), password: STRONG_PASSWORD },
      env,
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(429);
    expect(((await second.json()) as { error: { code: string } }).error.code).toBe(
      'capacity_reached',
    );
    await db().prepare("DELETE FROM rate_limit_counters WHERE key = 'global:signup'").run();
  });

  it('falha fechada se o pepper não estiver configurado', async () => {
    const env = { ...devEnv(), PASSWORD_PEPPER: undefined };
    const res = await call('/api/auth/signup', {
      body: { email: uniqueEmail(), password: STRONG_PASSWORD },
      env,
    });
    expect(res.status).toBe(503);
  });

  it('respeita a flag signup_open', async () => {
    await db().prepare("UPDATE feature_flags SET enabled = 0 WHERE key = 'signup_open'").run();
    try {
      const res = await call('/api/auth/signup', {
        body: { email: uniqueEmail(), password: STRONG_PASSWORD },
      });
      expect(res.status).toBe(503);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('signup_closed');
    } finally {
      await db().prepare("UPDATE feature_flags SET enabled = 1 WHERE key = 'signup_open'").run();
    }
  });
});

describe('login / sessão / logout', () => {
  it('login correto devolve sessão válida e /me responde', async () => {
    const { email } = await signup();
    const login = await call('/api/auth/login', { body: { email, password: STRONG_PASSWORD } });
    expect(login.status).toBe(200);
    const cookie = sessionCookieOf(login);
    expect(cookie).toBeTruthy();
    const me = await call('/api/auth/me', { cookie: cookie ?? '' });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { email: string } }).user.email).toBe(email);
  });

  it('e-mail inexistente e senha errada são indistinguíveis (anti-enumeração)', async () => {
    const { email } = await signup();
    const wrong = await call('/api/auth/login', {
      body: { email, password: 'senha errada mesmo assim' },
    });
    const unknown = await call('/api/auth/login', {
      body: { email: uniqueEmail(), password: 'senha errada mesmo assim' },
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.text()).toBe(await unknown.text());
  });

  it('limita tentativas por e-mail (429) mesmo trocando de IP', async () => {
    const { email } = await signup();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await call('/api/auth/login', {
        body: { email, password: 'errada-errada-errada' },
      });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it('conta suspensa não loga e perde a sessão existente', async () => {
    const { email, cookie } = await signup();
    await db().prepare("UPDATE users SET status = 'suspended' WHERE email = ?1").bind(email).run();
    const login = await call('/api/auth/login', { body: { email, password: STRONG_PASSWORD } });
    expect(login.status).toBe(401);
    const me = await call('/api/auth/me', { cookie: cookie ?? '' });
    expect(me.status).toBe(401);
  });

  it('logout revoga a sessão no servidor (cookie antigo deixa de valer) e limpa o cookie', async () => {
    const { cookie } = await signup();
    const out = await call('/api/auth/logout', { method: 'POST', cookie: cookie ?? '' });
    expect(out.status).toBe(204);
    expect(rawSessionSetCookie(out)).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    const me = await call('/api/auth/me', { cookie: cookie ?? '' });
    expect(me.status).toBe(401);
  });

  it('/me sem sessão ou com cookie forjado é 401', async () => {
    expect((await call('/api/auth/me')).status).toBe(401);
    const forged = await call('/api/auth/me', { cookie: `${SESSION_COOKIE}=${'a'.repeat(43)}` });
    expect(forged.status).toBe(401);
  });

  it('sessão expirada não vale', async () => {
    const { email, cookie } = await signup();
    await db()
      .prepare(
        'UPDATE sessions SET expires_at = ?1 WHERE user_id = (SELECT id FROM users WHERE email = ?2)',
      )
      .bind(Date.now() - 1000, email)
      .run();
    expect((await call('/api/auth/me', { cookie: cookie ?? '' })).status).toBe(401);
  });

  it('rotaciona o token após o intervalo; o antigo vale só durante a janela de tolerância', async () => {
    const { email, cookie: first } = await signup();
    const userId = (
      await db()
        .prepare('SELECT id FROM users WHERE email = ?1')
        .bind(email)
        .first<{ id: string }>()
    )?.id;

    // Sem rotação enquanto a sessão é recente.
    const fresh = await call('/api/auth/me', { cookie: first ?? '' });
    expect(rawSessionSetCookie(fresh)).toBeUndefined();

    // Envelhece a sessão além do intervalo de rotação.
    await db()
      .prepare('UPDATE sessions SET rotated_at = ?1 WHERE user_id = ?2')
      .bind(Date.now() - ROTATE_AFTER_MS - 5000, userId)
      .run();
    const rotated = await call('/api/auth/me', { cookie: first ?? '' });
    expect(rotated.status).toBe(200);
    const second = sessionCookieOf(rotated);
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);

    // Novo token funciona; o antigo ainda funciona dentro da tolerância (requisições concorrentes)...
    expect((await call('/api/auth/me', { cookie: second ?? '' })).status).toBe(200);
    expect((await call('/api/auth/me', { cookie: first ?? '' })).status).toBe(200);

    // ...e deixa de funcionar depois dela.
    await db()
      .prepare('UPDATE sessions SET prev_valid_until = ?1 WHERE user_id = ?2')
      .bind(Date.now() - PREV_TOKEN_GRACE_MS, userId)
      .run();
    expect((await call('/api/auth/me', { cookie: first ?? '' })).status).toBe(401);
    expect((await call('/api/auth/me', { cookie: second ?? '' })).status).toBe(200);
  });

  it('o token antigo não consegue rotacionar de novo (evita corrente de tokens)', async () => {
    const { email, cookie: first } = await signup();
    const userId = (
      await db()
        .prepare('SELECT id FROM users WHERE email = ?1')
        .bind(email)
        .first<{ id: string }>()
    )?.id;
    await db()
      .prepare('UPDATE sessions SET rotated_at = ?1 WHERE user_id = ?2')
      .bind(Date.now() - ROTATE_AFTER_MS - 5000, userId)
      .run();
    await call('/api/auth/me', { cookie: first ?? '' }); // rotaciona
    const again = await call('/api/auth/me', { cookie: first ?? '' }); // token antigo, na tolerância
    expect(again.status).toBe(200);
    expect(rawSessionSetCookie(again)).toBeUndefined();
  });
});

describe('CSRF', () => {
  it('rejeita POST sem Origin e sem Sec-Fetch-Site', async () => {
    const res = await call('/api/auth/login', {
      body: { email: uniqueEmail(), password: 'x' },
      origin: false,
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'csrf_origin_missing',
    );
  });

  it('rejeita Origin de outro site', async () => {
    const res = await call('/api/auth/login', {
      body: { email: uniqueEmail(), password: 'x' },
      origin: 'https://evil.example',
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'csrf_origin_mismatch',
    );
  });

  it('aceita same-origin via Sec-Fetch-Site quando o navegador omite Origin', async () => {
    const res = await call('/api/auth/login', {
      body: { email: uniqueEmail(), password: 'x' },
      origin: false,
      headers: { 'sec-fetch-site': 'same-origin' },
    });
    expect(res.status).toBe(401); // passou pelo CSRF e falhou só nas credenciais
  });

  it('aceita origem extra configurada em APP_ORIGINS', async () => {
    const env = { ...devEnv(), APP_ORIGINS: 'https://app.example.test' };
    const res = await call('/api/auth/login', {
      body: { email: uniqueEmail(), password: 'x' },
      origin: 'https://app.example.test',
      env,
    });
    expect(res.status).toBe(401);
  });

  it('exige application/json', async () => {
    const res = await call('/api/auth/login', {
      body: 'email=a&password=b',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.status).toBe(415);
  });

  it('GET não é afetado', async () => {
    const res = await call('/api/health', { origin: false });
    expect(res.status).toBe(200);
  });
});

describe('Turnstile (anti-bot)', () => {
  const siteverify = (impl: () => Response | Promise<Response>) =>
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => impl());

  it('modo enforce: sem token é recusado', async () => {
    const res = await call('/api/auth/signup', {
      body: { email: uniqueEmail(), password: STRONG_PASSWORD },
      env: enforcedEnv(),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('antibot_failed');
  });

  it('modo enforce: token válido segundo o siteverify libera, enviando segredo e token', async () => {
    const spy = siteverify(() => Response.json({ success: true }));
    const env = enforcedEnv();
    const res = await call('/api/auth/signup', {
      body: { email: uniqueEmail(), password: STRONG_PASSWORD, turnstileToken: 'token-do-widget' },
      env,
    });
    expect(res.status).toBe(201);
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const sent = String((init as RequestInit).body);
    expect(sent).toContain('response=token-do-widget');
    expect(sent).toContain(`secret=${env.TURNSTILE_SECRET_KEY}`);
  });

  it('modo enforce: token recusado pelo siteverify é 400', async () => {
    siteverify(() => Response.json({ success: false }));
    const res = await call('/api/auth/signup', {
      body: { email: uniqueEmail(), password: STRONG_PASSWORD, turnstileToken: 'ruim' },
      env: enforcedEnv(),
    });
    expect(res.status).toBe(400);
  });

  it('se o siteverify estiver fora do ar, falha fechada (503, não libera)', async () => {
    siteverify(() => {
      throw new Error('rede');
    });
    const res = await call('/api/auth/signup', {
      body: { email: uniqueEmail(), password: STRONG_PASSWORD, turnstileToken: 'qualquer' },
      env: enforcedEnv(),
    });
    expect(res.status).toBe(503);
  });

  it('vale também para o login', async () => {
    const res = await call('/api/auth/login', {
      body: { email: uniqueEmail(), password: 'x' },
      env: enforcedEnv(),
    });
    expect(res.status).toBe(400);
  });

  it('sem chaves configuradas: indisponível (503), não "aberto"', async () => {
    const env = { ...enforcedEnv(), TURNSTILE_SECRET_KEY: undefined };
    const res = await call('/api/auth/signup', {
      body: { email: uniqueEmail(), password: STRONG_PASSWORD },
      env,
    });
    expect(res.status).toBe(503);
  });

  it('desligar o anti-bot só funciona em ENVIRONMENT=development (nunca em produção)', async () => {
    const env = {
      ...enforcedEnv(),
      ENVIRONMENT: 'production',
      TURNSTILE_MODE: 'disabled_dev',
      TURNSTILE_SECRET_KEY: undefined,
      TURNSTILE_SITE_KEY: '',
    };
    const res = await call('/api/auth/signup', {
      body: { email: uniqueEmail(), password: STRONG_PASSWORD },
      env,
    });
    expect(res.status).toBe(503);
  });
});

describe('/api/config (estado real dos serviços)', () => {
  it('enforce: expõe só a site key pública, nunca o segredo', async () => {
    const env = enforcedEnv();
    const res = await call('/api/config', { env });
    const text = await res.text();
    const body = JSON.parse(text) as {
      turnstile: { status: string; siteKey: string };
      ai: { status: string };
      push: { status: string };
      monetization: { enabled: boolean };
    };
    expect(body.turnstile.status).toBe('enforced');
    expect(body.turnstile.siteKey).toBe(env.TURNSTILE_SITE_KEY);
    expect(text).not.toContain(env.TURNSTILE_SECRET_KEY ?? 'nunca-presente');
    expect(text).not.toContain(env.PASSWORD_PEPPER ?? 'nunca-presente');
    expect(body.ai.status).toBe('not_configured');
    expect(body.push.status).toBe('unavailable');
    expect(body.monetization.enabled).toBe(false);
  });

  it('desenvolvimento sem anti-bot: declara disabled_dev', async () => {
    const body = (await (await call('/api/config', { env: devEnv() })).json()) as {
      turnstile: { status: string; siteKey: string | null };
    };
    expect(body.turnstile.status).toBe('disabled_dev');
    expect(body.turnstile.siteKey).toBeNull();
  });

  it('sem chaves: declara not_configured', async () => {
    const env = { ...enforcedEnv(), TURNSTILE_SECRET_KEY: undefined };
    const body = (await (await call('/api/config', { env })).json()) as {
      turnstile: { status: string };
    };
    expect(body.turnstile.status).toBe('not_configured');
  });
});

describe('cabeçalhos de segurança e auditoria', () => {
  it('toda resposta leva os cabeçalhos de segurança', async () => {
    const res = await call('/api/health');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('strict-transport-security')).toContain('max-age=');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('rota inexistente devolve 404 em JSON, sem detalhes internos', async () => {
    const res = await call('/api/nao-existe');
    expect(res.status).toBe(404);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('cadastro, login, falha e logout geram trilha de auditoria sem segredos', async () => {
    const { email, cookie } = await signup();
    await call('/api/auth/login', { body: { email, password: 'errada-errada-errada' } });
    await call('/api/auth/login', { body: { email, password: STRONG_PASSWORD } });
    await call('/api/auth/logout', { method: 'POST', cookie: cookie ?? '' });

    const rows = await db()
      .prepare(
        `SELECT a.action, a.metadata_json, a.ip_hash FROM audit_logs a
         JOIN users u ON u.id = a.actor_user_id WHERE u.email = ?1`,
      )
      .bind(email)
      .all<{ action: string; metadata_json: string | null; ip_hash: string | null }>();
    const actions = rows.results.map((r) => r.action);
    for (const expected of ['auth.signup', 'auth.login_failed', 'auth.login', 'auth.logout']) {
      expect(actions).toContain(expected);
    }
    const dump = JSON.stringify(rows.results);
    expect(dump).not.toContain(STRONG_PASSWORD);
    expect(dump).not.toMatch(/pbkdf2/i);
    // O IP é guardado só como HMAC (32 hex), nunca em claro.
    for (const r of rows.results) if (r.ip_hash) expect(r.ip_hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('metadados de auditoria rejeitam chaves que sugerem segredo', () => {
    expect(() => sanitizeMetadata({ password: 'x' })).toThrow();
    expect(() => sanitizeMetadata({ sessionToken: 'x' })).toThrow();
    expect(() => sanitizeMetadata({ locale: 'pt' })).not.toThrow();
  });
});
