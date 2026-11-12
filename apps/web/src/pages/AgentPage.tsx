import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { categoryName, DemoBadge } from '../components/AgentBits';
import { InstallPanel } from '../components/InstallPanel';
import { RunForm } from '../components/RunForm';
import { ReviewSection } from '../components/ReviewSection';
import { Rating } from '../components/Stars';
import { ApiError } from '../lib/api';
import { useAgent, useMe } from '../lib/queries';

export default function AgentPage() {
  const { t, i18n } = useTranslation();
  const { slug = '' } = useParams();
  const { data: agent, error, isPending } = useAgent(slug);
  const me = useMe();

  if (isPending) return <p aria-busy="true">…</p>;
  if (error || !agent) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-bold">
          {notFound ? t('market.notFound') : t('errors.generic')}
        </h1>
        <Link to="/agents" className="text-brand-600 underline">
          {t('market.backToMarket')}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <nav aria-label="breadcrumb" className="text-sm">
        <Link to="/agents" className="text-brand-600 underline">
          {t('market.backToMarket')}
        </Link>
      </nav>

      <header className="space-y-2">
        <h1 className="text-3xl font-bold" data-testid="agent-name">
          {agent.name}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          {agent.isDemo && <DemoBadge />}
          <Rating avg={agent.ratingAvg} count={agent.ratingCount} />
          <span className="text-sm text-[var(--text-muted)]">
            {t('market.installs', { count: agent.installCount })}
          </span>
        </div>
        {agent.categories.length > 0 && (
          <ul className="flex flex-wrap gap-1">
            {agent.categories.map((c) => (
              <li
                key={c.slug}
                className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs"
              >
                {categoryName(c, i18n.language)}
              </li>
            ))}
          </ul>
        )}
      </header>

      {agent.isDemo && (
        <p
          role="note"
          data-testid="demo-banner"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          {t('market.demoBanner')}
        </p>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <p className="whitespace-pre-wrap">{agent.description}</p>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-medium">{t('market.objective')}</dt>
              <dd className="text-[var(--text-muted)]">{agent.objective || '—'}</dd>
            </div>
            <div>
              <dt className="font-medium">{t('market.outputFormat')}</dt>
              <dd className="text-[var(--text-muted)]">{agent.outputFormat}</dd>
            </div>
            <div>
              <dt className="font-medium">{t('market.version')}</dt>
              <dd className="text-[var(--text-muted)]">v{agent.version}</dd>
            </div>
            <div>
              <dt className="font-medium">{t('market.tools')}</dt>
              <dd className="text-[var(--text-muted)]">
                {agent.tools.length > 0 ? agent.tools.join(', ') : t('market.noTools')}
              </dd>
            </div>
          </dl>
        </div>
        <div className="space-y-4">
          <InstallPanel agent={agent} />
          {me.data && !agent.isDemo && (
            <RunForm
              slug={agent.slug}
              toolKeys={agent.tools}
              maxInputChars={agent.limits.maxInputChars}
              requiresApproval={agent.requiresApproval}
              requiresAi={agent.requiresAi}
              installedIn={agent.installedWorkspaceIds ?? []}
              workspaces={me.data.memberships.map((m) => ({
                id: m.workspaceId,
                label: `${m.workspaceName} — ${m.organizationName}`,
              }))}
            />
          )}
        </div>
      </div>

      <ReviewSection agent={agent} />
    </div>
  );
}
