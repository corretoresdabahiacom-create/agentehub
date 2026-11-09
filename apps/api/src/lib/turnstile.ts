import type { PublicConfigResponse } from '@agenthub/shared';
import type { Bindings } from '../env';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type TurnstileState = PublicConfigResponse['turnstile']['status'];

/**
 * Estado REAL do anti-bot (R4):
 *  - enforced: segredo e site key configurados; verificação obrigatória.
 *  - disabled_dev: desligado explicitamente, e só é aceito com ENVIRONMENT=development.
 *  - not_configured: falta chave. Cadastro/login ficam indisponíveis (falha fechada).
 */
export function turnstileState(env: Bindings): TurnstileState {
  if (env.ENVIRONMENT === 'development' && env.TURNSTILE_MODE === 'disabled_dev') {
    return 'disabled_dev';
  }
  if (env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY && env.TURNSTILE_MODE === 'enforce') {
    return 'enforced';
  }
  return 'not_configured';
}

export type TurnstileResult =
  { ok: true } | { ok: false; reason: 'missing_token' | 'rejected' | 'unavailable' };

export async function verifyTurnstile(
  env: Bindings,
  token: string | undefined,
  ip: string | null,
): Promise<TurnstileResult> {
  if (turnstileState(env) === 'disabled_dev') return { ok: true };
  if (!token) return { ok: false, reason: 'missing_token' };

  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY ?? '', response: token });
  if (ip) body.set('remoteip', ip);

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, reason: 'unavailable' };
    const data = (await res.json()) as { success?: boolean };
    return data.success === true ? { ok: true } : { ok: false, reason: 'rejected' };
  } catch {
    // Falha fechada: se não conseguimos verificar, não liberamos.
    return { ok: false, reason: 'unavailable' };
  }
}
