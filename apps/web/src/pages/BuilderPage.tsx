import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useMyAgents } from '../lib/queries';
import { btnPrimary, card } from '../lib/ui';

export default function BuilderPage() {
  const { t } = useTranslation();
  const q = useMyAgents();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('builder.title')}</h1>
        <Link to="/builder/new" className={btnPrimary} data-testid="new-agent">
          {t('builder.new')}
        </Link>
      </div>
      <p className="text-sm text-[var(--text-muted)]">{t('builder.subtitle')}</p>
      {q.isPending ? (
        <p aria-busy="true">…</p>
      ) : q.data && q.data.agents.length > 0 ? (
        <ul className="space-y-2" data-testid="my-agents">
          {q.data.agents.map((a) => (
            <li key={a.id} className={`${card} flex flex-wrap items-center justify-between gap-2`}>
              <div>
                <Link className="font-medium text-brand-600 underline" to={`/builder/${a.id}`}>
                  {a.name}
                </Link>
                <p className="text-xs text-[var(--text-muted)]">
                  v{a.version} · {t(`builder.versionStatus.${a.versionStatus}`)}
                </p>
              </div>
              <span className="text-sm text-[var(--text-muted)]">
                {t(`builder.status.${a.status}`)} · {t(`builder.visibility.${a.visibility}`)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[var(--text-muted)]" data-testid="builder-empty">
          {t('builder.empty')}
        </p>
      )}
    </div>
  );
}
