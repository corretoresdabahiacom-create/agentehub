import type { PublicConfigResponse } from '@agenthub/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../db/client';
import { featureFlags } from '../db/schema';
import type { AppEnv } from '../env';
import { turnstileState } from '../lib/turnstile';

export const config = new Hono<AppEnv>();

/**
 * Estado real dos serviços para a UI (R4). Nada aqui é segredo: a site key do Turnstile é pública.
 * IA, push e cobrança são declarados como indisponíveis/desligados porque realmente não existem.
 */
config.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const [flag] = await db
    .select({ enabled: featureFlags.enabled })
    .from(featureFlags)
    .where(eq(featureFlags.key, 'signup_open'))
    .limit(1);

  const state = turnstileState(c.env);
  const body: PublicConfigResponse = {
    turnstile: {
      status: state,
      siteKey: state === 'enforced' ? c.env.TURNSTILE_SITE_KEY : null,
    },
    ai: { status: 'not_configured' },
    push: { status: 'unavailable' },
    monetization: { enabled: false },
    signupOpen: c.env.SIGNUP_OPEN === 'true' && flag?.enabled === 1,
  };
  return c.json(body);
});
