import { loginSchema, signupSchema, type MeResponse } from '@agenthub/shared';
import { eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { customAlphabet } from 'nanoid';
import { getDb } from '../db/client';
import {
  featureFlags,
  organizationMembers,
  organizations,
  sessions,
  userProfiles,
  users,
  workspaceMembers,
  workspaces,
} from '../db/schema';
import type { AppEnv } from '../env';
import { audit, auditStatement } from '../lib/audit';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from '../lib/crypto';
import { HttpError, parseJson } from '../lib/http';
import { loadMemberships } from '../lib/memberships';
import { rateLimit } from '../lib/rate-limit';
import { anonymize, clientIp } from '../lib/request';
import { turnstileState, verifyTurnstile } from '../lib/turnstile';
import { requireAuth } from '../middleware/authz';
import { clearSessionCookie, newSessionStatement, setSessionCookie } from '../middleware/session';

export const authRoutes = new Hono<AppEnv>();

const slugId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 10);

// Limites por janela. Valores conservadores; globais vêm de variáveis (caps do free tier).
const SIGNUP_PER_IP = { limit: 5, windowSec: 3600 };
const LOGIN_PER_IP = { limit: 20, windowSec: 600 };
const LOGIN_PER_EMAIL = { limit: 10, windowSec: 600 };
const DAY_SEC = 86400;

function requirePepper(c: Context<AppEnv>): string {
  const pepper = c.env.PASSWORD_PEPPER;
  // Falha fechada: sem pepper não há como criar nem verificar senhas com segurança.
  if (!pepper) throw new HttpError(503, 'auth_unavailable', 'Authentication is not configured');
  return pepper;
}

async function enforce(
  c: Context<AppEnv>,
  key: string,
  limit: number,
  windowSec: number,
  code = 'rate_limited',
) {
  const result = await rateLimit(c.env.DB, key, limit, windowSec);
  if (!result.allowed) {
    throw new HttpError(429, code, 'Too many requests', undefined, {
      'Retry-After': String(result.retryAfterSec),
    });
  }
}

async function checkAntiBot(c: Context<AppEnv>, token: string | undefined) {
  if (turnstileState(c.env) === 'not_configured') {
    throw new HttpError(503, 'antibot_unavailable', 'Anti-bot verification is not configured');
  }
  const result = await verifyTurnstile(c.env, token, clientIp(c));
  if (!result.ok) {
    if (result.reason === 'unavailable') {
      throw new HttpError(503, 'antibot_unavailable', 'Anti-bot verification is unavailable');
    }
    throw new HttpError(400, 'antibot_failed', 'Anti-bot verification failed');
  }
}

function numberVar(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current; depth++) {
    const message = current instanceof Error ? current.message : String(current);
    if (message.includes('UNIQUE constraint failed')) return true;
    current = current instanceof Error ? (current as Error & { cause?: unknown }).cause : null;
  }
  return false;
}

// ------------------------------------------------------------------ cadastro

authRoutes.post('/signup', async (c) => {
  const pepper = requirePepper(c);
  const db = getDb(c.env.DB);
  const input = await parseJson(c, signupSchema);

  const [flag] = await db
    .select({ enabled: featureFlags.enabled })
    .from(featureFlags)
    .where(eq(featureFlags.key, 'signup_open'))
    .limit(1);
  if (c.env.SIGNUP_OPEN !== 'true' || flag?.enabled !== 1) {
    throw new HttpError(503, 'signup_closed', 'Sign-up is currently closed');
  }

  const ip = clientIp(c);
  const ipHash = ip ? await anonymize(c, 'ip', ip) : null;

  // Ordem deliberada: barato (limites) -> externo (Turnstile) -> caro (PBKDF2).
  await enforce(
    c,
    `signup:ip:${ipHash ?? 'unknown'}`,
    SIGNUP_PER_IP.limit,
    SIGNUP_PER_IP.windowSec,
  );
  await enforce(
    c,
    'global:signup',
    numberVar(c.env.GLOBAL_SIGNUPS_PER_DAY, 1000),
    DAY_SEC,
    'capacity_reached',
  );
  await checkAntiBot(c, input.turnstileToken);

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1);
  if (existing) throw new HttpError(409, 'email_taken', 'Email already registered');

  const passwordHash = await hashPassword(input.password, pepper);

  const userId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const displayName = input.displayName ?? input.email.split('@')[0] ?? 'user';
  const session = await newSessionStatement(db, userId, {
    ipHash,
    userAgent: c.req.header('user-agent') ?? null,
  });

  try {
    // Uma única transação (batch do D1): ou cria tudo, ou nada.
    await db.batch([
      db.insert(users).values({ id: userId, email: input.email, passwordHash }),
      db.insert(userProfiles).values({ userId, displayName, locale: input.locale }),
      db.insert(organizations).values({
        id: organizationId,
        name: displayName,
        slug: `u-${slugId()}`,
        kind: 'personal',
        ownerUserId: userId,
      }),
      db.insert(organizationMembers).values({ organizationId, userId, role: 'owner' }),
      db.insert(workspaces).values({
        id: workspaceId,
        organizationId,
        name: 'Personal',
        slug: 'personal',
      }),
      db.insert(workspaceMembers).values({ workspaceId, userId, role: 'owner' }),
      session.statement,
      auditStatement(db, {
        action: 'auth.signup',
        actorUserId: userId,
        workspaceId,
        ipHash,
        metadata: { locale: input.locale },
      }),
    ]);
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, 'email_taken', 'Email already registered');
    throw err;
  }

  setSessionCookie(c, session.token, session.expiresAt);
  const body: MeResponse = {
    user: {
      id: userId,
      email: input.email,
      displayName,
      locale: input.locale,
      platformRole: 'user',
    },
    memberships: await loadMemberships(db, userId),
  };
  return c.json(body, 201);
});

// --------------------------------------------------------------------- login

authRoutes.post('/login', async (c) => {
  const pepper = requirePepper(c);
  const db = getDb(c.env.DB);
  const input = await parseJson(c, loginSchema);

  const ip = clientIp(c);
  const ipHash = ip ? await anonymize(c, 'ip', ip) : null;
  const emailKey = await anonymize(c, 'email', input.email);

  await enforce(c, `login:ip:${ipHash ?? 'unknown'}`, LOGIN_PER_IP.limit, LOGIN_PER_IP.windowSec);
  await enforce(c, `login:email:${emailKey}`, LOGIN_PER_EMAIL.limit, LOGIN_PER_EMAIL.windowSec);
  await enforce(
    c,
    'global:login',
    numberVar(c.env.GLOBAL_LOGINS_PER_DAY, 5000),
    DAY_SEC,
    'capacity_reached',
  );
  await checkAntiBot(c, input.turnstileToken);

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      passwordHash: users.passwordHash,
      status: users.status,
      platformRole: users.platformRole,
      displayName: userProfiles.displayName,
      locale: userProfiles.locale,
    })
    .from(users)
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(eq(users.email, input.email))
    .limit(1);

  // Sempre executa um PBKDF2, existindo a conta ou não, para não revelar contas pelo tempo.
  const valid = await verifyPassword(
    input.password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    pepper,
  );

  if (!user || !valid || user.status !== 'active') {
    // Resposta idêntica para e-mail inexistente, senha errada e conta suspensa.
    await audit(db, {
      action: 'auth.login_failed',
      actorUserId: user?.id ?? null,
      ipHash,
    });
    throw new HttpError(401, 'invalid_credentials', 'Invalid email or password');
  }

  const session = await newSessionStatement(db, user.id, {
    ipHash,
    userAgent: c.req.header('user-agent') ?? null,
  });
  await db.batch([
    session.statement,
    db
      .update(users)
      .set({ lastLoginAt: Date.now(), updatedAt: Date.now() })
      .where(eq(users.id, user.id)),
    auditStatement(db, { action: 'auth.login', actorUserId: user.id, ipHash }),
  ]);

  setSessionCookie(c, session.token, session.expiresAt);
  const locale = (user.locale as 'en' | 'pt' | 'es' | null) ?? 'en';
  const body: MeResponse = {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName ?? null,
      locale,
      platformRole: user.platformRole,
    },
    memberships: await loadMemberships(db, user.id),
  };
  return c.json(body);
});

// -------------------------------------------------------------------- logout

authRoutes.post('/logout', async (c) => {
  const auth = c.var.auth;
  if (auth) {
    const db = getDb(c.env.DB);
    const ip = clientIp(c);
    await db.batch([
      db.update(sessions).set({ revokedAt: Date.now() }).where(eq(sessions.id, auth.sessionId)),
      auditStatement(db, {
        action: 'auth.logout',
        actorUserId: auth.user.id,
        ipHash: ip ? await anonymize(c, 'ip', ip) : null,
      }),
    ]);
  }
  clearSessionCookie(c);
  return c.body(null, 204);
});

// ------------------------------------------------------------------------ me

authRoutes.get('/me', requireAuth, async (c) => {
  const auth = c.var.auth;
  if (!auth) throw new Error('unreachable');
  const body: MeResponse = {
    user: auth.user,
    memberships: await loadMemberships(getDb(c.env.DB), auth.user.id),
  };
  return c.json(body);
});
