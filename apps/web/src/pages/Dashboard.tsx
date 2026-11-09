import { useTranslation } from 'react-i18next';
import { ServiceStatus } from '../components/ServiceStatus';
import { useMe } from '../lib/queries';

export default function Dashboard() {
  const { t } = useTranslation();
  const me = useMe();
  if (!me.data) return null;
  const { user, memberships } = me.data;
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold" data-testid="welcome">
        {t('dashboard.welcome', { name: user.displayName ?? user.email })}
      </h1>
      <section aria-labelledby="ws">
        <h2 id="ws" className="mb-3 text-lg font-semibold">
          {t('dashboard.workspaces')}
        </h2>
        {memberships.length === 0 ? (
          <p className="text-[var(--text-muted)]">{t('dashboard.noWorkspaces')}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2" data-testid="workspaces">
            {memberships.map((m) => (
              <li key={m.workspaceId} className="rounded-lg border border-[var(--border)] p-4">
                <p className="font-medium">{m.workspaceName}</p>
                <p className="text-sm text-[var(--text-muted)]">
                  {m.organizationName} · {t(`dashboard.role.${m.role}`)}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm text-[var(--text-muted)]">{t('dashboard.emptyAgents')}</p>
      </section>
      <ServiceStatus />
    </div>
  );
}
