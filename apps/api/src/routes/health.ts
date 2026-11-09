import { Hono } from 'hono';
import type { AppEnv } from '../env';

export const health = new Hono<AppEnv>();

/** Liveness simples. Não toca o D1 (cada leitura conta no orçamento diário). */
health.get('/', (c) => c.json({ status: 'ok' }));
