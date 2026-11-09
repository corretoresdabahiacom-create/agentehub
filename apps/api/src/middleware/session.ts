import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { getDb, type Db } from '../db/client';
import { sessions, userProfiles, users } from '../db/schema';
import type { AppEnv } from '../env';
import { randomToken, sha256Hex } from '../lib/crypto';

/** `__Host-` exige Secure, Path=/ e proíbe Domain: o cookie fica preso a este host. */
export const SESSION_COOKIE = '__Host-agenthub_session';
export const SESSION_TTL_MS = 14 * 24 * 3600 * 1000;
/** Rotação do token a cada hora de uso (limita a janela de um token roubado). */
export const ROTATE_AFTER_MS = 60 * 60 * 1000;
/** O token anterior segue válido por pouco tempo, para não deslogar requisições concorrentes. */
export const PREV_TOKEN_GRACE_MS = 60 * 1000;

export function setSessionCookie(c: Context<AppEnv>, token: string, expiresAtMs: number) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    expires: new Date(expiresAtMs),
  });
}

export function clearSessionCookie(c: Context<AppEnv>) {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
}

/** Cria a sessão (apenas o hash do token vai ao banco) e devolve o token em claro para o cookie. */
export async function newSessionStatement(
  db: Db,
  userId: string,
  meta: { ipHash: string | null; userAgent: string | null },
) {
  const token = randomToken(32);
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  const statement = db.insert(sessions).values({
    id: crypto.randomUUID(),
    userId,
    tokenHash: await sha256Hex(token),
    expiresAt,
    rotatedAt: now,
    lastSeenAt: now,
    ipHash: meta.ipHash,
    userAgent: meta.userAgent?.slice(0, 256) ?? null,
  });
  return { token, expiresAt, statement };
}

/**
 * Resolve a sessão a partir do cookie e popula c.var.auth (ou null). Não rejeita: quem exige
 * autenticação é `requireAuth`. Faz rotação do token e só escreve no banco quando rotaciona,
 * preservando o orçamento de escritas do D1 free.
 */
export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('auth', null);
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return next();

  const db = getDb(c.env.DB);
  const now = Date.now();
  const hash = await sha256Hex(token);

  const [row] = await db
    .select({
      sessionId: sessions.id,
      tokenHash: sessions.tokenHash,
      rotatedAt: sessions.rotatedAt,
      userId: users.id,
      email: users.email,
      status: users.status,
      platformRole: users.platformRole,
      displayName: userProfiles.displayName,
      locale: userProfiles.locale,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(
      and(
        or(
          eq(sessions.tokenHash, hash),
          and(eq(sessions.prevTokenHash, hash), gt(sessions.prevValidUntil, now)),
        ),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
      ),
    )
    .limit(1);

  if (!row || row.status !== 'active') {
    // Cookie inválido, expirado, revogado ou usuário suspenso: limpa e segue como anônimo.
    clearSessionCookie(c);
    return next();
  }

  c.set('auth', {
    sessionId: row.sessionId,
    user: {
      id: row.userId,
      email: row.email,
      displayName: row.displayName ?? null,
      locale: (row.locale as 'en' | 'pt' | 'es' | null) ?? 'en',
      platformRole: row.platformRole,
    },
  });

  const usedCurrentToken = row.tokenHash === hash;
  if (usedCurrentToken && now - row.rotatedAt > ROTATE_AFTER_MS) {
    const newToken = randomToken(32);
    const newHash = await sha256Hex(newToken);
    // Rotação otimista: só vale se ninguém rotacionou antes (WHERE token_hash = hash atual).
    const result = await db
      .update(sessions)
      .set({
        prevTokenHash: hash,
        prevValidUntil: now + PREV_TOKEN_GRACE_MS,
        tokenHash: newHash,
        rotatedAt: now,
        lastSeenAt: now,
      })
      .where(and(eq(sessions.id, row.sessionId), eq(sessions.tokenHash, hash)))
      .run();
    if (result.meta.changes > 0) {
      setSessionCookie(c, newToken, now + SESSION_TTL_MS);
    }
  }

  return next();
};
