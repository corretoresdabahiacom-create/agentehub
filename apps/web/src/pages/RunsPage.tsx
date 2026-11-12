import { EXECUTION_STATUSES, type ExecutionStatusName } from '@agenthub/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useApprovals, useExecutions } from '../lib/queries';
import { btnOutline, card, field } from '../lib/ui';
import { StatusBadge } from './RunPage';

export default function RunsPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ExecutionStatusName | ''>('');
  const [page, setPage] = useState(1);
  const list = useExecutions(status || undefined, page);
  const approvals = useApprovals();
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">{t('runs.title')}</h1>

      <section aria-labelledby="pend-title" className={card}>
        <h2 id="pend-title" className="mb-2 font-semibold">
          {t('runs.pendingTitle')}
        </h2>
        {approvals.data && approvals.data.approvals.length > 0 ? (
          <ul className="space-y-2" data-testid="pending-approvals">
            {approvals.data.approvals.map((a) => (
              <li
                key={a.executionId}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span>
                  {a.agentName} · {a.workspaceName}
                </span>
                <Link className="text-brand-600 underline" to={`/runs/${a.executionId}`}>
                  {t('runs.review')}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">{t('runs.noPending')}</p>
        )}
      </section>

      <section aria-labelledby="hist-title" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="hist-title" className="font-semibold">
            {t('runs.history')}
          </h2>
          <label className="text-sm">
            <span className="mr-2 text-[var(--text-muted)]">{t('runs.filter')}</span>
            <select
              className={`${field} w-auto`}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as ExecutionStatusName | '');
                setPage(1);
              }}
            >
              <option value="">{t('runs.allStatuses')}</option>
              {EXECUTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`runs.status.${s}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {list.isPending ? (
          <p aria-busy="true">…</p>
        ) : list.data && list.data.executions.length > 0 ? (
          <ul className="space-y-2" data-testid="run-list">
            {list.data.executions.map((e) => (
              <li
                key={e.id}
                className={`${card} flex flex-wrap items-center justify-between gap-2`}
              >
                <Link className="font-medium text-brand-600 underline" to={`/runs/${e.id}`}>
                  {e.agentName}
                </Link>
                <span className="flex items-center gap-3 text-sm text-[var(--text-muted)]">
                  <StatusBadge status={e.status} />
                  {new Date(e.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[var(--text-muted)]" data-testid="runs-empty">
            {t('runs.empty')}
          </p>
        )}
        {pages > 1 && (
          <div className="flex items-center gap-3 text-sm">
            <button className={btnOutline} disabled={page <= 1} onClick={() => setPage(page - 1)}>
              {t('market.prev')}
            </button>
            <span>{t('market.pageOf', { page, pages })}</span>
            <button
              className={btnOutline}
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
            >
              {t('market.next')}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
