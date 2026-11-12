import type { AgentDetail } from '@agenthub/shared';
import { Heart } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { errorKey } from '../lib/api';
import { useOnline } from '../lib/online';
import { useFavorite, useInstall, useMe, useUninstall } from '../lib/queries';

export const ACTION_ERRORS = [
  'unauthenticated',
  'not_found',
  'rate_limited',
  'review_not_qualified',
  'validation_error',
  'csrf_origin_mismatch',
  'csrf_origin_missing',
  'network',
] as const;

const btn =
  'rounded-md px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50';

export function InstallPanel({ agent }: { agent: AgentDetail }) {
  const { t } = useTranslation();
  const online = useOnline();
  const me = useMe();
  const install = useInstall(agent.slug);
  const uninstall = useUninstall(agent.slug);
  const favorite = useFavorite(agent.slug);
  const memberships = me.data?.memberships ?? [];
  const [workspaceId, setWorkspaceId] = useState('');
  const selected = workspaceId || memberships[0]?.workspaceId || '';
  const installed = new Set(agent.installedWorkspaceIds ?? []);
  const isInstalled = installed.has(selected);
  const busy = install.isPending || uninstall.isPending || favorite.isPending;
  const error = install.error ?? uninstall.error ?? favorite.error;

  if (!me.data) {
    return (
      <section
        className="rounded-lg border border-[var(--border)] p-4"
        aria-labelledby="inst-title"
      >
        <h2 id="inst-title" className="mb-1 font-semibold">
          {t('market.install')}
        </h2>
        <p className="text-sm text-[var(--text-muted)]">
          <Link to="/login" className="text-brand-600 underline">
            {t('nav.signIn')}
          </Link>{' '}
          {t('market.signInToInstall')}
        </p>
      </section>
    );
  }

  return (
    <section
      className="space-y-3 rounded-lg border border-[var(--border)] p-4"
      aria-labelledby="inst-title"
    >
      <h2 id="inst-title" className="font-semibold">
        {t('market.install')}
      </h2>
      {memberships.length > 1 && (
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--text-muted)]">{t('market.workspace')}</span>
          <select
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            value={selected}
            onChange={(e) => setWorkspaceId(e.target.value)}
          >
            {memberships.map((m) => (
              <option key={m.workspaceId} value={m.workspaceId}>
                {m.workspaceName} — {m.organizationName}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {isInstalled ? (
          <button
            type="button"
            className={`${btn} border border-[var(--border)]`}
            disabled={!online || busy}
            onClick={() => uninstall.mutate(selected)}
          >
            {t('market.uninstall')}
          </button>
        ) : (
          <button
            type="button"
            className={`${btn} bg-brand-600 text-white hover:bg-brand-700`}
            disabled={!online || busy || !selected}
            onClick={() => install.mutate(selected)}
          >
            {t('market.installAction')}
          </button>
        )}
        <button
          type="button"
          aria-pressed={agent.favorited === true}
          className={`${btn} inline-flex items-center gap-2 border border-[var(--border)]`}
          disabled={!online || busy}
          onClick={() => favorite.mutate(!agent.favorited)}
        >
          <Heart size={16} className={agent.favorited ? 'fill-rose-500 text-rose-500' : ''} />
          {agent.favorited ? t('market.unfavorite') : t('market.favorite')}
        </button>
      </div>
      {isInstalled && (
        <p className="text-sm text-green-700 dark:text-green-400" data-testid="installed-note">
          {t('market.installedNote')}
        </p>
      )}
      {!online && <p className="text-sm text-amber-700">{t('auth.offlineBlocked')}</p>}
      {error && (
        <p role="alert" className="text-sm text-red-600" data-testid="action-error">
          {t(errorKey(error, ACTION_ERRORS))}
        </p>
      )}
    </section>
  );
}
