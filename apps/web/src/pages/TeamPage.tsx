import { TEAM_LIMITS, PLATFORM_LIMITS, type CreateInviteInput } from '@agenthub/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { RunForm } from '../components/RunForm';
import { errorKey } from '../lib/api';
import { RUN_ERRORS } from '../lib/errors';
import { useOnline } from '../lib/online';
import {
  useChangeRole,
  useCreateInvite,
  useInvites,
  useLibrary,
  useMe,
  useMembers,
  useRemoveMember,
  useRevokeInvite,
  useSetQuota,
  useUsage,
  useWorkspaceRuns,
} from '../lib/queries';
import { btnOutline, btnPrimary, card, field } from '../lib/ui';

const Err = ({ error }: { error: unknown }) =>
  error ? (
    <p role="alert" className="text-sm text-red-600">
      <ErrText error={error} />
    </p>
  ) : null;
function ErrText({ error }: { error: unknown }) {
  const { t } = useTranslation();
  return <>{t(errorKey(error, RUN_ERRORS))}</>;
}

function Invites({ ws, isOwner }: { ws: string; isOwner: boolean }) {
  const { t, i18n } = useTranslation();
  const online = useOnline();
  const list = useInvites(ws, true);
  const create = useCreateInvite(ws);
  const revoke = useRevokeInvite(ws);
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [hours, setHours] = useState(72);
  const [uses, setUses] = useState(1);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setLink(null);
    const body: CreateInviteInput = { role, expiresInHours: hours, maxUses: uses };
    create.mutate(body, {
      onSuccess: (r) => {
        setLink(`${window.location.origin}${r.path}`); // o token só existe aqui, em memória
        setCopied(false);
      },
    });
  };
  const copy = async () => {
    try {
      if (link) await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section className={`${card} space-y-3`} aria-labelledby="inv-title" data-testid="invites">
      <h2 id="inv-title" className="font-semibold">
        {t('team.invites')}
      </h2>
      <p className="text-sm text-[var(--text-muted)]">{t('team.inviteNote')}</p>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block">{t('team.inviteRole')}</span>
          <select
            className={field}
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
          >
            <option value="member">{t('dashboard.role.member')}</option>
            {isOwner && <option value="admin">{t('dashboard.role.admin')}</option>}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block">{t('team.inviteHours')}</span>
          <input
            className={field}
            type="number"
            min={1}
            max={TEAM_LIMITS.inviteMaxHours}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block">{t('team.inviteUses')}</span>
          <input
            className={field}
            type="number"
            min={1}
            max={TEAM_LIMITS.inviteMaxUses}
            value={uses}
            onChange={(e) => setUses(Number(e.target.value))}
          />
        </label>
        <button type="submit" className={btnPrimary} disabled={!online || create.isPending}>
          {t('team.inviteCreate')}
        </button>
      </form>
      <Err error={create.error} />
      {link && (
        <div
          className="space-y-2 rounded bg-amber-50 p-3 text-amber-900"
          data-testid="invite-link-box"
        >
          <p className="text-sm font-medium">{t('team.inviteShownOnce')}</p>
          <input
            readOnly
            className={field}
            value={link}
            data-testid="invite-link"
            aria-label={t('team.inviteLink')}
          />
          <button type="button" className={btnOutline} onClick={() => void copy()}>
            {copied ? t('team.copied') : t('team.copy')}
          </button>
        </div>
      )}
      <ul className="space-y-1 text-sm" data-testid="invite-list">
        {list.data?.invites.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {t(`dashboard.role.${i.role}`)} ·{' '}
              {t('team.inviteUsage', { used: i.useCount, max: i.maxUses })} ·{' '}
              {i.active
                ? t('team.inviteExpiresAt', {
                    date: new Date(i.expiresAt).toLocaleString(i18n.language),
                  })
                : i.revokedAt
                  ? t('team.inviteRevoked')
                  : t('team.inviteInactive')}
            </span>
            {i.active && (
              <button
                type="button"
                className={btnOutline}
                disabled={!online || revoke.isPending}
                onClick={() => revoke.mutate(i.id)}
              >
                {t('team.revoke')}
              </button>
            )}
          </li>
        ))}
      </ul>
      <Err error={revoke.error} />
    </section>
  );
}

function Members({ ws, isOwner }: { ws: string; isOwner: boolean }) {
  const { t } = useTranslation();
  const online = useOnline();
  const members = useMembers(ws, true);
  const change = useChangeRole(ws);
  const remove = useRemoveMember(ws);
  const quota = useSetQuota(ws);
  const [draft, setDraft] = useState<Record<string, string>>({});
  return (
    <section className={`${card} space-y-3`} aria-labelledby="mem-title" data-testid="members">
      <h2 id="mem-title" className="font-semibold">
        {t('team.members')}
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-[var(--text-muted)]">
              <th className="py-1 pr-3">{t('team.member')}</th>
              <th className="py-1 pr-3">{t('team.role')}</th>
              <th className="py-1 pr-3">{t('team.quota')}</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {members.data?.members.map((m) => {
              const value =
                draft[m.userId] ?? (m.quotaPerDay === null ? '' : String(m.quotaPerDay));
              const canEdit = m.role !== 'owner';
              return (
                <tr
                  key={m.userId}
                  className="border-t border-[var(--border)]"
                  data-testid={`member-${m.email}`}
                >
                  <td className="py-2 pr-3">
                    {m.displayName ?? m.email}
                    <span className="block text-xs text-[var(--text-muted)]">{m.email}</span>
                  </td>
                  <td className="py-2 pr-3">
                    {isOwner && canEdit ? (
                      <select
                        className={field}
                        aria-label={t('team.role')}
                        value={m.role}
                        disabled={!online || change.isPending}
                        onChange={(e) =>
                          change.mutate({
                            userId: m.userId,
                            role: e.target.value as 'admin' | 'member',
                          })
                        }
                      >
                        <option value="member">{t('dashboard.role.member')}</option>
                        <option value="admin">{t('dashboard.role.admin')}</option>
                      </select>
                    ) : (
                      t(`dashboard.role.${m.role}`)
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <span className="flex items-center gap-2">
                      <input
                        className={field}
                        type="number"
                        min={0}
                        max={PLATFORM_LIMITS.executionsPerUserPerDay}
                        placeholder={t('team.noQuota')}
                        aria-label={t('team.quota')}
                        value={value}
                        onChange={(e) => setDraft({ ...draft, [m.userId]: e.target.value })}
                      />
                      <button
                        type="button"
                        className={btnOutline}
                        disabled={!online || quota.isPending}
                        onClick={() =>
                          quota.mutate({
                            userId: m.userId,
                            value: value === '' ? null : Number(value),
                          })
                        }
                      >
                        {t('team.save')}
                      </button>
                    </span>
                    <span className="text-xs text-[var(--text-muted)]">
                      {t('team.usedToday', { count: m.usedToday })}
                    </span>
                  </td>
                  <td className="py-2">
                    {canEdit && !m.isYou && (
                      <button
                        type="button"
                        className={btnOutline}
                        disabled={!online || remove.isPending || (m.role === 'admin' && !isOwner)}
                        onClick={() => remove.mutate(m.userId)}
                      >
                        {t('team.remove')}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Err error={change.error ?? remove.error ?? quota.error} />
    </section>
  );
}

function Library({ ws }: { ws: string }) {
  const { t } = useTranslation();
  const lib = useLibrary(ws);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className={`${card} space-y-3`} aria-labelledby="lib-title" data-testid="library">
      <h2 id="lib-title" className="font-semibold">
        {t('team.library')}
      </h2>
      <p className="text-sm text-[var(--text-muted)]">{t('team.libraryNote')}</p>
      {lib.data?.items.length === 0 && <p className="text-sm">{t('team.libraryEmpty')}</p>}
      <ul className="space-y-3">
        {lib.data?.items.map((i) => (
          <li
            key={i.slug}
            className="space-y-2 rounded border border-[var(--border)] p-3"
            data-testid={`lib-${i.slug}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{i.name}</p>
                <p className="text-sm text-[var(--text-muted)]">
                  {i.description} · {t(`team.source.${i.source}`)}
                </p>
              </div>
              <button
                type="button"
                className={btnOutline}
                onClick={() => setOpen(open === i.slug ? null : i.slug)}
              >
                {open === i.slug ? t('team.close') : t('team.run')}
              </button>
            </div>
            {open === i.slug && (
              <RunForm
                slug={i.slug}
                toolKeys={i.toolKeys}
                maxInputChars={i.limits.maxInputChars}
                requiresApproval={i.requiresApproval}
                requiresAi={i.requiresAi}
                workspaces={[{ id: ws, label: ws }]}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Usage({ ws }: { ws: string }) {
  const { t } = useTranslation();
  const usage = useUsage(ws);
  if (!usage.data) return null;
  return (
    <section className={`${card} space-y-1`} aria-labelledby="use-title" data-testid="usage">
      <h2 id="use-title" className="font-semibold">
        {t('team.usage')}
      </h2>
      <p className="text-sm">
        {t('team.workspaceUsage', {
          used: usage.data.workspaceUsedToday,
          max: usage.data.workspaceLimitPerDay,
        })}
      </p>
      <ul className="text-sm text-[var(--text-muted)]">
        {usage.data.members.map((m) => (
          <li key={m.userId}>
            {m.email}: {m.usedToday}
            {m.quotaPerDay !== null ? ` / ${m.quotaPerDay}` : ''}
          </li>
        ))}
      </ul>
    </section>
  );
}

function History({ ws }: { ws: string }) {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const runs = useWorkspaceRuns(ws, true, undefined, page);
  const d = runs.data;
  return (
    <section className={`${card} space-y-2`} aria-labelledby="hist-title" data-testid="history">
      <h2 id="hist-title" className="font-semibold">
        {t('team.history')}
      </h2>
      {d?.executions.length === 0 && <p className="text-sm">{t('team.historyEmpty')}</p>}
      <ul className="space-y-1 text-sm">
        {d?.executions.map((e) => (
          <li key={e.id} className="flex flex-wrap justify-between gap-2">
            <Link className="text-brand-600 underline" to={`/runs/${e.id}`}>
              {e.agentName}
            </Link>
            <span className="text-[var(--text-muted)]">
              {e.userEmail} · {t(`runs.status.${e.status}`)} ·{' '}
              {new Date(e.createdAt).toLocaleString(i18n.language)}
            </span>
          </li>
        ))}
      </ul>
      {d && d.total > d.pageSize && (
        <div className="flex gap-2">
          <button
            type="button"
            className={btnOutline}
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            {t('team.prev')}
          </button>
          <button
            type="button"
            className={btnOutline}
            disabled={page * d.pageSize >= d.total}
            onClick={() => setPage(page + 1)}
          >
            {t('team.next')}
          </button>
        </div>
      )}
    </section>
  );
}

export default function TeamPage() {
  const { t } = useTranslation();
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();
  const online = useOnline();
  const me = useMe();
  const remove = useRemoveMember(workspaceId);
  const m = me.data?.memberships.find((x) => x.workspaceId === workspaceId);
  if (!me.data) return null;
  if (!m || m.organizationKind !== 'company') {
    return (
      <div className="space-y-3" data-testid="team-not-found">
        <h1 className="text-2xl font-bold">{t('team.notFound')}</h1>
        <Link className="text-brand-600 underline" to="/teams">
          {t('team.back')}
        </Link>
      </div>
    );
  }
  const myId = me.data.user.id;
  const isAdmin = m.role === 'owner' || m.role === 'admin';
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--text-muted)]">
            <Link className="underline" to="/teams">
              {t('teams.title')}
            </Link>{' '}
            / {m.organizationName}
          </p>
          <h1 className="text-2xl font-bold" data-testid="team-title">
            {m.workspaceName}
          </h1>
          <p className="text-sm text-[var(--text-muted)]">
            {t('team.yourRole', { role: t(`dashboard.role.${m.role}`) })}
          </p>
        </div>
        {m.role !== 'owner' && (
          <button
            type="button"
            className={btnOutline}
            disabled={!online || remove.isPending}
            onClick={() => remove.mutate(myId, { onSuccess: () => void navigate('/teams') })}
          >
            {t('team.leave')}
          </button>
        )}
      </header>
      <Err error={remove.error} />
      <Library ws={workspaceId} />
      <Usage ws={workspaceId} />
      {isAdmin && <Members ws={workspaceId} isOwner={m.role === 'owner'} />}
      {isAdmin && <Invites ws={workspaceId} isOwner={m.role === 'owner'} />}
      {isAdmin && <History ws={workspaceId} />}
    </div>
  );
}
