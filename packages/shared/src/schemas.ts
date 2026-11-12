import { z } from 'zod';

export const SUPPORTED_LOCALES = ['en', 'pt', 'es'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Limites de senha. PBKDF2 não impõe teto, mas limitamos o tamanho para evitar abuso de CPU. */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `password_too_short`)
  .max(PASSWORD_MAX, `password_too_long`);

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(80).optional(),
  locale: z.enum(SUPPORTED_LOCALES).default(DEFAULT_LOCALE),
  turnstileToken: z.string().max(2048).optional(),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  // No login não validamos o mínimo: apenas impomos o teto.
  password: z.string().min(1).max(PASSWORD_MAX),
  turnstileToken: z.string().max(2048).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Resposta pública de `GET /api/auth/me`. Nunca inclui hash, tokens ou segredos. */
export interface MeResponse {
  user: {
    id: string;
    email: string;
    displayName: string | null;
    locale: Locale;
    platformRole: 'user' | 'admin';
  };
  memberships: Array<{
    organizationId: string;
    organizationName: string;
    workspaceId: string;
    workspaceName: string;
    role: 'owner' | 'admin' | 'member';
  }>;
}

/** Estado real dos serviços, para a UI nunca mostrar como operacional algo não configurado (R4). */
export interface PublicConfigResponse {
  turnstile: { status: 'enforced' | 'disabled_dev' | 'not_configured'; siteKey: string | null };
  ai: { status: 'configured' | 'not_configured' };
  push: { status: 'unavailable' };
  monetization: { enabled: false };
  signupOpen: boolean;
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}
