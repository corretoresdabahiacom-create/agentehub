import type { LoginInput, MeResponse, PublicConfigResponse, SignupInput } from '@agenthub/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      // Same-origin: o cookie HttpOnly de sessão vai sozinho. Nada de token em JS/localStorage.
      credentials: 'same-origin',
      ...init,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, 'network', 'network');
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'generic', data?.error?.message ?? 'error');
  }
  return data as T;
}

export const api = {
  config: () => request<PublicConfigResponse>('/api/config'),
  me: async (): Promise<MeResponse | null> => {
    try {
      return await request<MeResponse>('/api/auth/me');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    }
  },
  signup: (input: SignupInput) =>
    request<MeResponse>('/api/auth/signup', { method: 'POST', body: JSON.stringify(input) }),
  login: (input: LoginInput) =>
    request<MeResponse>('/api/auth/login', { method: 'POST', body: JSON.stringify(input) }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
};

/** Chave i18n para um erro de API (cai em errors.generic quando o código é desconhecido). */
export function errorKey(err: unknown, known: readonly string[]): string {
  if (err instanceof ApiError && known.includes(err.code)) return `errors.${err.code}`;
  return 'errors.generic';
}
