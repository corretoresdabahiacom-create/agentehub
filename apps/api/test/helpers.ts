import { env as workerEnv } from 'cloudflare:workers';
import app from '../src/index';
import type { Bindings } from '../src/env';
import { SESSION_COOKIE } from '../src/middleware/session';

const base = workerEnv as unknown as Bindings;

/** Ambiente "produção-like": Turnstile obrigatório (chaves geradas pelo vitest.config). */
export const enforcedEnv = (): Bindings => ({ ...base });

/** Ambiente de desenvolvimento com anti-bot desligado explicitamente (único modo permitido). */
export const devEnv = (): Bindings => ({
  ...base,
  ENVIRONMENT: 'development',
  TURNSTILE_MODE: 'disabled_dev',
});

export const db = (): D1Database => base.DB;

let counter = 0;
/** IP único por chamada: isola contadores de rate limit entre testes. */
export const uniqueIp = () =>
  `10.${(counter >> 16) & 255}.${(counter >> 8) & 255}.${counter++ & 255}`;
export const uniqueEmail = () => `user-${crypto.randomUUID()}@example.test`;
export const STRONG_PASSWORD = 'correct horse battery staple 42';

export interface CallOptions {
  method?: string;
  body?: unknown;
  cookie?: string;
  ip?: string;
  headers?: Record<string, string>;
  env?: Bindings;
  /** `false` omite o Origin (para testar CSRF). */
  origin?: string | false;
}

export async function call(path: string, opts: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
  if (opts.body !== undefined && !headers['content-type'])
    headers['content-type'] = 'application/json';
  if (opts.origin !== false) headers['origin'] = opts.origin ?? 'http://localhost';
  if (opts.cookie) headers['cookie'] = opts.cookie;
  headers['cf-connecting-ip'] = opts.ip ?? uniqueIp();
  const body =
    opts.body === undefined
      ? undefined
      : typeof opts.body === 'string'
        ? opts.body
        : JSON.stringify(opts.body);
  return app.request(path, { method, headers, body }, opts.env ?? devEnv());
}

/** Todos os Set-Cookie da resposta. */
export function setCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}

/** Extrai `nome=valor` do cookie de sessão a partir dos Set-Cookie (ou null). */
export function sessionCookieOf(res: Response): string | null {
  const raw = setCookies(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return raw ? (raw.split(';')[0] ?? null) : null;
}

export function rawSessionSetCookie(res: Response): string | undefined {
  return setCookies(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
}

export async function signup(over: { email?: string; password?: string; ip?: string } = {}) {
  const email = over.email ?? uniqueEmail();
  const ip = over.ip ?? uniqueIp();
  const res = await call('/api/auth/signup', {
    body: { email, password: over.password ?? STRONG_PASSWORD, displayName: 'Tester' },
    ip,
  });
  return { res, email, ip, cookie: sessionCookieOf(res) };
}
