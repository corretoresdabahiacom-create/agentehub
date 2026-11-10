import { Hono } from 'hono';
import type { AppEnv } from './env';
import { errorBody, HttpError } from './lib/http';
import { csrfProtection } from './middleware/csrf';
import { securityHeaders } from './middleware/security';
import { sessionMiddleware } from './middleware/session';
import { agentsRoutes, categoriesRoutes } from './routes/agents';
import { authRoutes } from './routes/auth';
import { config } from './routes/config';
import { health } from './routes/health';
import { workspacesRoutes } from './routes/workspaces';

const app = new Hono<AppEnv>();

app.use('*', securityHeaders);

const api = new Hono<AppEnv>();
api.use('*', csrfProtection);
api.use('*', sessionMiddleware);
api.route('/health', health);
api.route('/config', config);
api.route('/auth', authRoutes);
api.route('/workspaces', workspacesRoutes);
api.route('/agents', agentsRoutes);
api.route('/categories', categoriesRoutes);
// R7: NÃO existe nenhuma rota de cobrança/checkout/assinatura. Qualquer caminho desse tipo cai
// no 404 abaixo. (test/billing.test.ts garante isso.)

app.route('/api', api);

app.notFound((c) => c.json(errorBody('not_found', 'Not found'), 404));

app.onError((err, c) => {
  if (err instanceof HttpError) {
    if (err.headers) for (const [k, v] of Object.entries(err.headers)) c.header(k, v);
    return c.json(errorBody(err.code, err.message, err.details), err.status);
  }
  // Nunca devolve stack, SQL ou mensagem interna ao cliente.
  console.error('unhandled_error', err instanceof Error ? err.name : 'unknown');
  return c.json(errorBody('internal_error', 'Internal error'), 500);
});

export default app;
