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

describe('marketplace api client', () => {
  it('toQuery omite valores vazios e codifica o texto', async () => {
    const { toQuery } = await import('./api');
    expect(toQuery({ q: '', category: undefined, sort: 'name', page: 2 })).toBe(
      '?sort=name&page=2',
    );
    expect(toQuery({})).toBe('');
    expect(toQuery({ q: 'a&b=c d' })).toBe('?q=a%26b%3Dc+d');
  });

  it('catalog chama /api/agents com a query; install/favorite usam o método correto', async () => {
    const fn = mockFetch(200, { agents: [], total: 0, page: 1, pageSize: 12 });
    await api.catalog({ q: 'x', sort: 'rating' });
    expect((fn.mock.calls[0] as unknown as [string])[0]).toBe('/api/agents?q=x&sort=rating');

    const f2 = mockFetch(200, { favorited: true });
    await api.favorite('my-agent', true);
    await api.favorite('my-agent', false);
    expect((f2.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe('PUT');
    expect((f2.mock.calls[1] as unknown as [string, RequestInit])[1].method).toBe('DELETE');

    const f3 = mockFetch(200, { installed: false });
    await api.uninstall('my agent', 'ws/1');
    expect((f3.mock.calls[0] as unknown as [string])[0]).toBe(
      '/api/agents/my%20agent/install/ws%2F1',
    );
  });

  it('ApiError carrega details (motivo de review_not_qualified)', async () => {
    mockFetch(403, {
      error: { code: 'review_not_qualified', message: 'x', details: { reason: 'not_installed' } },
    });
    const err = await api.saveReview('a', { rating: 5 }).catch((e: unknown) => e);
    expect((err as ApiError).code).toBe('review_not_qualified');
    expect((err as ApiError).details).toEqual({ reason: 'not_installed' });
  });
});
