import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { hmacHex } from './crypto';

/** IP do cliente conforme a Cloudflare. Ausente em testes/desenvolvimento local. */
export function clientIp(c: Context<AppEnv>): string | null {
  return c.req.header('cf-connecting-ip') ?? null;
}

/** Valor opaco e estável para IP/e-mail em contadores e logs (nunca o dado em claro). */
export async function anonymize(c: Context<AppEnv>, namespace: string, value: string) {
  const secret = c.env.PASSWORD_PEPPER;
  if (!secret) throw new Error('PASSWORD_PEPPER ausente');
  return (await hmacHex(secret, `${namespace}:${value}`)).slice(0, 32);
}
