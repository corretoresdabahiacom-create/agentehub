import { TEAM_LIMITS } from '@agenthub/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { errorKey } from '../lib/api';
import { RUN_ERRORS } from '../lib/errors';
import { useOnline } from '../lib/online';
import { useCreateCompany, useCreateWorkspace, useMe } from '../lib/queries';
import { btnPrimary, card, field } from '../lib/ui';

function NameForm(p: {
  label: string;
  action: string;
  pending: boolean;
  error: unknown;
  onSubmit: (name: string) => void;
  testId: string;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const [name, setName] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    p.onSubmit(name.trim());
    setName('');
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2" data-testid={p.testId}>
      <label className="block flex-1 text-sm">
        <span className="mb-1 block font-medium">{p.label}</span>
        <input
          className={field}
          value={name}
          minLength={2}
          maxLength={60}
          required
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <button
        type="submit"
        className={btnPrimary}
        disabled={!online || p.pending || name.trim().length < 2}
      >
        {p.action}
      </button>
      {p.error ? (
        <p role="alert" className="w-full text-sm text-red-600">
          {t(errorKey(p.error, RUN_ERRORS))}
        </p>
      ) : null}
    </form>
  );
}

function OrgWorkspaceForm({ orgId }: { orgId: string }) {
  const { t } = useTranslation();
  const create = useCreateWorkspace(orgId);
  return (
    <NameForm
      testId="new-workspace-form"
      label={t('teams.newWorkspaceName')}
      action={t('teams.newWorkspaceAction')}
      pending={create.isPending}
      error={create.error}
      onSubmit={(n) => create.mutate(n)}
    />
  );
}

export default function TeamsPage() {
  const { t } = useTranslation();
  const me = useMe();
  const createCompany = useCreateCompany();
  if (!me.data) return null;
  const companies = me.data.memberships.filter((m) => m.organizationKind === 'company');
  const orgs = new Map<string, { name: string; role: string; items: typeof companies }>();
  for (const m of companies) {
    const o = orgs.get(m.organizationId) ?? { name: m.organizationName, role: m.role, items: [] };
    o.items.push(m);
    if (m.role === 'owner' || (m.role === 'admin' && o.role === 'member')) o.role = m.role;
    orgs.set(m.organizationId, o);
  }
  const ownedCount = companies.filter((m) => m.role === 'owner').length;
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold">{t('teams.title')}</h1>
        <p className="text-[var(--text-muted)]">{t('teams.subtitle')}</p>
      </header>

      {orgs.size === 0 ? (
        <p className="text-[var(--text-muted)]" data-testid="no-companies">
          {t('teams.none')}
        </p>
      ) : (
        <ul className="space-y-4" data-testid="companies">
          {[...orgs.entries()].map(([orgId, o]) => (
            <li key={orgId} className={`${card} space-y-3`}>
              <h2 className="font-semibold">{o.name}</h2>
              <ul className="space-y-1">
                {o.items.map((m) => (
                  <li
                    key={m.workspaceId}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <Link className="text-brand-600 underline" to={`/teams/${m.workspaceId}`}>
                      {m.workspaceName}
                    </Link>
                    <span className="text-[var(--text-muted)]">
                      {t(`dashboard.role.${m.role}`)}
                    </span>
                  </li>
                ))}
              </ul>
              {(o.role === 'owner' || o.role === 'admin') && <OrgWorkspaceForm orgId={orgId} />}
            </li>
          ))}
        </ul>
      )}

      <section className={`${card} space-y-2`} aria-labelledby="new-company">
        <h2 id="new-company" className="font-semibold">
          {t('teams.newCompany')}
        </h2>
        <p className="text-sm text-[var(--text-muted)]">
          {t('teams.limitsNote', {
            companies: TEAM_LIMITS.companiesPerUser,
            workspaces: TEAM_LIMITS.workspacesPerOrganization,
            members: TEAM_LIMITS.membersPerWorkspace,
          })}
        </p>
        <NameForm
          testId="new-company-form"
          label={t('teams.newCompanyName')}
          action={t('teams.newCompanyAction')}
          pending={createCompany.isPending}
          error={createCompany.error}
          onSubmit={(n) => createCompany.mutate(n)}
        />
        {ownedCount >= TEAM_LIMITS.companiesPerUser && (
          <p className="text-xs text-[var(--text-muted)]">{t('teams.companyLimitHint')}</p>
        )}
      </section>
    </div>
  );
}
