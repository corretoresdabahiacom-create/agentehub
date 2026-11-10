import type { AgentSummary } from '@agenthub/shared';
import { Heart } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { DemoBadge, categoryName } from './AgentBits';
import { Rating } from './Stars';

export function AgentCard({ agent }: { agent: AgentSummary }) {
  const { t, i18n } = useTranslation();
  return (
    <article
      className="flex flex-col gap-2 rounded-lg border border-[var(--border)] p-4"
      data-testid="agent-card"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold">
          <Link
            to={`/agents/${agent.slug}`}
            className="hover:underline focus:underline"
            data-testid="agent-link"
          >
            {agent.name}
          </Link>
        </h3>
        {agent.favorited && (
          <Heart
            size={16}
            className="shrink-0 fill-rose-500 text-rose-500"
            aria-label={t('market.favorited')}
            role="img"
          />
        )}
      </div>
      {agent.isDemo && <DemoBadge />}
      <p className="line-clamp-3 text-sm text-[var(--text-muted)]">{agent.description}</p>
      {agent.categories.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label={t('market.categories')}>
          {agent.categories.map((c) => (
            <li
              key={c.slug}
              className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs text-[var(--text-muted)]"
            >
              {categoryName(c, i18n.language)}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto flex items-center justify-between pt-2">
        <Rating avg={agent.ratingAvg} count={agent.ratingCount} />
        <span className="text-xs text-[var(--text-muted)]">
          {t('market.installs', { count: agent.installCount })}
        </span>
      </div>
    </article>
  );
}
