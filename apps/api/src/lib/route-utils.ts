import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { HttpError } from './http';
import { rateLimit } from './rate-limit';

export function authOf(c: Context<AppEnv>) {
  const a = c.var.auth;
  if (!a) throw new HttpError(401, 'unauthenticated', 'Authentication required');
  return a;
}

/** Consome uma unidade do limite ou responde 429 (com Retry-After). */
export async function limitOrThrow(
  db: D1Database,
  key: string,
  limit: number,
  windowSec: number,
  code = 'rate_limited',
  details?: unknown,
): Promise<void> {
  const r = await rateLimit(db, key, limit, windowSec);
  if (!r.allowed) {
    throw new HttpError(429, code, 'Too many requests', details, {
      'Retry-After': String(r.retryAfterSec),
    });
  }
}

export function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return `${base || 'agent'}-${crypto.randomUUID().replace(/-/g, '').slice(0, 6)}`;
}

export function parseObject(text: string | null | undefined): Record<string, unknown> {
  if (!text) return {};
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
