import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, errorKey } from './api';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(
    async () => new Response(body === null ? null : JSON.stringify(body), { status }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('me() returns null on 401 (anonymous), not an error', async () => {
    mockFetch(401, { error: { code: 'unauthenticated', message: 'x' } });
    await expect(api.me()).resolves.toBeNull();
  });

  it('me() rethrows other failures', async () => {
    mockFetch(500, { error: { code: 'boom', message: 'x' } });
    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
  });

  it('login sends JSON with same-origin credentials and no auth header', async () => {
    const fn = mockFetch(200, { user: {}, memberships: [] });
    await api.login({ email: 'a@b.co', password: 'secret-secret' });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/login');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(Object.keys(init.headers as object)).not.toContain('authorization');
  });

  it('maps API error codes and network failures', async () => {
    mockFetch(401, { error: { code: 'invalid_credentials', message: 'x' } });
    const err = await api.login({ email: 'a@b.co', password: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('invalid_credentials');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    );
    const net = await api.config().catch((e: unknown) => e);
    expect((net as ApiError).code).toBe('network');
  });

  it('errorKey falls back to generic for unknown codes', () => {
    expect(errorKey(new ApiError(400, 'weird', ''), ['rate_limited'])).toBe('errors.generic');
    expect(errorKey(new ApiError(429, 'rate_limited', ''), ['rate_limited'])).toBe(
      'errors.rate_limited',
    );
    expect(errorKey(new Error('x'), ['rate_limited'])).toBe('errors.generic');
  });
});
