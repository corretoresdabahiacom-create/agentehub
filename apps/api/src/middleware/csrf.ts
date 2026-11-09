import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';
import { HttpError } from '../lib/http';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Defesa CSRF em camadas (decisão: SameSite + verificação de Origin, sem token duplo):
 *  1. O cookie de sessão é SameSite=Lax (não é enviado em POST cross-site).
 *  2. Toda requisição com efeito colateral exige `Origin` igual à origem da própria API ou a uma
 *     origem em APP_ORIGINS. Se não houver Origin, exige Sec-Fetch-Site same-origin/none.
 *  3. O corpo precisa ser application/json (formulários cross-site não conseguem enviar isso sem
 *     preflight, e a API não responde a preflight).
 * Aplica-se também a login/cadastro (evita "login CSRF").
 */
export const csrfProtection: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();

  const allowed = new Set<string>([new URL(c.req.url).origin]);
  for (const origin of c.env.APP_ORIGINS.split(',')) {
    const trimmed = origin.trim();
    if (trimmed) allowed.add(trimmed);
  }

  const origin = c.req.header('origin');
  if (origin) {
    if (!allowed.has(origin)) throw new HttpError(403, 'csrf_origin_mismatch');
    return next();
  }

  const fetchSite = c.req.header('sec-fetch-site');
  if (fetchSite === 'same-origin' || fetchSite === 'none') return next();
  throw new HttpError(403, 'csrf_origin_missing');
};
