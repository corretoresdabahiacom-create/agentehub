import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';

/**
 * Cabeçalhos para respostas da API (JSON). O CSP do frontend é definido no arquivo _headers do web.
 * A API não define CORS: o desenho é same-origin (ver docs/architecture.md).
 */
export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  const h = c.res.headers;
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'no-referrer');
  h.set('Cache-Control', 'no-store');
  h.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
};
