import {
  CATALOG_SORTS,
  CATALOG_SCOPES,
  type CatalogScope,
  type CatalogSort,
} from '@agenthub/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { AgentCard } from '../components/AgentCard';
import { categoryName } from '../components/AgentBits';
import { useCatalog, useCategories, useMe } from '../lib/queries';

const field =
  'rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]';

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** O estado da busca vive na URL (compartilhável, botão voltar funciona). */
export default function Marketplace() {
  const { t, i18n } = useTranslation();
  const me = useMe();
  const categories = useCategories();
  const [params, setParams] = useSearchParams();

  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const sort = pick<CatalogSort>(params.get('sort'), CATALOG_SORTS, 'newest');
  const scopeRaw = pick<CatalogScope>(params.get('scope'), CATALOG_SCOPES, 'all');
  const scope = me.data ? scopeRaw : 'all';
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);

  const [text, setText] = useState(q);
  useEffect(() => setText(q), [q]);
  useEffect(() => {
    if (text === q) return;
    const id = setTimeout(() => update({ q: text, page: '' }), 300);
    return () => clearTimeout(id);
  }, [text]);

  function update(next: Record<string, string>) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v === '' || v === 'newest' || v === 'all') p.delete(k);
      else p.set(k, v);
    }
    setParams(p, { replace: true });
  }

  const catalog = useCatalog({
    q: q || undefined,
    category: category || undefined,
    sort,
    scope,
    page,
  });
  const data = catalog.data;
  const filtered = q !== '' || category !== '' || scope !== 'all';
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t('market.title')}</h1>
        <p className="text-sm text-[var(--text-muted)]">{t('market.subtitle')}</p>
      </header>

      <form
        role="search"
        className="flex flex-wrap items-center gap-3"
        onSubmit={(e) => e.preventDefault()}
      >
        <label className="grow sm:max-w-sm">
          <span className="sr-only">{t('market.search')}</span>
          <input
            type="search"
            className={`${field} w-full`}
            placeholder={t('market.searchPlaceholder')}
            maxLength={80}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          {t('market.sortBy')}
          <select
            className={field}
            value={sort}
            onChange={(e) => update({ sort: e.target.value, page: '' })}
          >
            {CATALOG_SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`market.sort.${s}`)}
              </option>
            ))}
          </select>
        </label>
      </form>

      {me.data && (
        <div role="tablist" aria-label={t('market.scopeLabel')} className="flex gap-2">
          {CATALOG_SCOPES.map((s) => (
            <button
              key={s}
              role="tab"
              type="button"
              aria-selected={scope === s}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                scope === s
                  ? 'bg-brand-600 text-white'
                  : 'border border-[var(--border)] text-[var(--text-muted)]'
              }`}
              onClick={() => update({ scope: s, page: '' })}
            >
              {t(`market.scope.${s}`)}
            </button>
          ))}
        </div>
      )}

      {categories.data && (
        <div className="flex flex-wrap gap-2" aria-label={t('market.categories')}>
          <button
            type="button"
            aria-pressed={category === ''}
            className={`rounded-full border px-3 py-1 text-sm ${
              category === ''
                ? 'border-brand-600 bg-brand-50 text-brand-700'
                : 'border-[var(--border)]'
            }`}
            onClick={() => update({ category: '', page: '' })}
          >
            {t('market.allCategories')}
          </button>
          {categories.data.categories.map((c) => (
            <button
              key={c.slug}
              type="button"
              aria-pressed={category === c.slug}
              className={`rounded-full border px-3 py-1 text-sm ${
                category === c.slug
                  ? 'border-brand-600 bg-brand-50 text-brand-700'
                  : 'border-[var(--border)]'
              }`}
              onClick={() => update({ category: c.slug, page: '' })}
            >
              {categoryName(c, i18n.language)} ({c.agentCount})
            </button>
          ))}
        </div>
      )}

      {catalog.isError && (
        <p role="alert" className="text-sm text-red-600">
          {t('errors.network')}
        </p>
      )}

      {data && (
        <p
          className="text-sm text-[var(--text-muted)]"
          aria-live="polite"
          data-testid="result-count"
        >
          {t('market.results', { count: data.total })}
        </p>
      )}

      {data && data.total === 0 && (
        <div
          className="rounded-lg border border-dashed border-[var(--border)] p-8 text-center"
          data-testid="empty-state"
        >
          <p className="font-medium">
            {filtered ? t('market.emptyFiltered') : t('market.emptyCatalog')}
          </p>
          {!filtered && (
            <p className="mt-1 text-sm text-[var(--text-muted)]">{t('market.emptyCatalogHint')}</p>
          )}
          {filtered && (
            <button
              type="button"
              className="mt-3 text-sm text-brand-600 underline"
              onClick={() => setParams({}, { replace: true })}
            >
              {t('market.clearFilters')}
            </button>
          )}
        </div>
      )}

      {data && data.total > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="agent-grid">
          {data.agents.map((a) => (
            <li key={a.slug} className="flex">
              <div className="flex-1">
                <AgentCard agent={a} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {data && pages > 1 && (
        <nav className="flex items-center justify-center gap-3" aria-label={t('market.pagination')}>
          <button
            type="button"
            className={field}
            disabled={page <= 1}
            onClick={() => update({ page: String(page - 1) })}
          >
            {t('market.prev')}
          </button>
          <span className="text-sm">{t('market.pageOf', { page, pages })}</span>
          <button
            type="button"
            className={field}
            disabled={page >= pages}
            onClick={() => update({ page: String(page + 1) })}
          >
            {t('market.next')}
          </button>
        </nav>
      )}
    </div>
  );
}
