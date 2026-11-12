import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { ApiError, errorKey } from '../lib/api';
import { RUN_ERRORS } from '../lib/errors';
import { useOnline } from '../lib/online';
import { useCancelExecution, useDecide, useExecution, useRetryExecution } from '../lib/queries';
import { btn, btnOutline, btnPrimary, card } from '../lib/ui';

export const STATUS_STYLE: Record<string, string> = {
  completed: 'bg-green-100 text-green-900',
  failed: 'bg-red-100 text-red-900',
  canceled: 'bg-gray-200 text-gray-900',
  awaiting_approval: 'bg-amber-100 text-amber-900',
  running: 'bg-blue-100 text-blue-900',
  pending: 'bg-blue-100 text-blue-900',
};

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <span
      data-testid="run-status"
      className={`w-fit rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${STATUS_STYLE[status] ?? ''}`}
    >
      {t(`runs.status.${status}`)}
    </span>
  );
}

export default function RunPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const online = useOnline();
  const q = useExecution(id);
  const decide = useDecide(id);
  const cancel = useCancelExecution(id);
  const retry = useRetryExecution(id);
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState('');

  if (q.isPending) return <p aria-busy="true">…</p>;
  if (q.error || !q.data) {
    const nf = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-bold">{nf ? t('runs.notFound') : t('errors.generic')}</h1>
        <Link to="/runs" className="text-brand-600 underline">
          {t('runs.back')}
        </Link>
      </div>
    );
  }
  const d = q.data;
  const ap = d.approval;
  const pending = ap?.decision === 'pending';
  const actionError = decide.error ?? cancel.error ?? retry.error;
  const busy = decide.isPending || cancel.isPending || retry.isPending || !online;
  const selfMethod = ap?.method === 'self_second_step';

  return (
    <div className="space-y-6">
      <nav className="text-sm">
        <Link to="/runs" className="text-brand-600 underline">
          {t('runs.back')}
        </Link>
      </nav>
      <header className="space-y-2">
        <h1 className="text-2xl font-bold" data-testid="run-agent">
          {d.agentName}
        </h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--text-muted)]">
          <StatusBadge status={d.status} />
          <time dateTime={new Date(d.createdAt).toISOString()}>
            {new Date(d.createdAt).toLocaleString()}
          </time>
          <span>{t('runs.attempts', { count: d.attempts, max: d.maxAttempts })}</span>
        </div>
      </header>

      {pending && ap && (
        <section
          className={`${card} space-y-3 border-amber-300 bg-amber-50 text-amber-950`}
          data-testid="approval-card"
          aria-labelledby="ap-title"
        >
          <h2 id="ap-title" className="font-semibold">
            {t('runs.approval.title')}
          </h2>
          <p className="text-sm">{t(selfMethod ? 'runs.approval.self' : 'runs.approval.admin')}</p>
          <p className="text-xs">
            {t('runs.approval.expires', { when: new Date(ap.expiresAt).toLocaleString() })}
          </p>
          {ap.canDecide ? (
            <div className="space-y-2">
              {selfMethod && (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={confirm}
                    onChange={(e) => setConfirm(e.target.checked)}
                  />
                  <span>{t('runs.approval.confirmLabel')}</span>
                </label>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={busy || (selfMethod && !confirm)}
                  onClick={() =>
                    decide.mutate({ action: 'approve', body: selfMethod ? { confirm: true } : {} })
                  }
                >
                  {t('runs.approval.approve')}
                </button>
                <input
                  aria-label={t('runs.approval.reason')}
                  className="min-w-40 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  placeholder={t('runs.approval.reason')}
                  value={reason}
                  maxLength={500}
                  onChange={(e) => setReason(e.target.value)}
                />
                <button
                  type="button"
                  className={btnOutline}
                  disabled={busy}
                  onClick={() =>
                    decide.mutate({ action: 'reject', body: reason ? { reason } : {} })
                  }
                >
                  {t('runs.approval.reject')}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm font-medium" data-testid="approval-waiting">
              {t('runs.approval.waiting')}
            </p>
          )}
        </section>
      )}

      {ap && !pending && (
        <p className="text-sm" data-testid="approval-result">
          {t(`runs.approval.result.${ap.decision}`)}
          {ap.reason ? ` — ${ap.reason}` : ''}
        </p>
      )}

      {d.error && (
        <p
          role="alert"
          className="rounded-md bg-red-50 p-3 text-sm text-red-900"
          data-testid="run-failure"
        >
          {t(`runs.error.${d.error.split(':')[0]}`, { defaultValue: t('runs.error.generic') })}
        </p>
      )}

      {d.output && (
        <section aria-labelledby="out-title" className="space-y-2">
          <h2 id="out-title" className="font-semibold">
            {t(d.status === 'completed' ? 'runs.output' : 'runs.preview')}
          </h2>
          {d.status !== 'completed' && (
            <p className="text-sm text-[var(--text-muted)]">{t('runs.previewNote')}</p>
          )}
          {/* Texto puro: nunca interpretado como HTML. */}
          <pre
            className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--surface-muted)] p-3 text-sm"
            data-testid="run-output"
          >
            {d.output.content}
          </pre>
          {d.artifacts.map((a) => (
            <a
              key={a.id}
              className="inline-block text-sm text-brand-600 underline"
              href={`/api/executions/${d.id}/artifacts/${a.id}`}
              download={a.name}
              data-testid="artifact-link"
            >
              {t('runs.download', { name: a.name })}
            </a>
          ))}
        </section>
      )}

      <section aria-labelledby="steps-title">
        <h2 id="steps-title" className="mb-2 font-semibold">
          {t('runs.steps')}
        </h2>
        {d.steps.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">{t('runs.noSteps')}</p>
        ) : (
          <ol className="space-y-1 text-sm" data-testid="run-steps">
            {d.steps.map((s) => (
              <li
                key={s.seq}
                className="flex justify-between gap-2 rounded bg-[var(--surface-muted)] px-3 py-2"
              >
                <span className="font-mono">{s.name}</span>
                <span>{t(`runs.stepStatus.${s.status}`)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        {d.mine && d.status === 'awaiting_approval' && (
          <button
            type="button"
            className={btnOutline}
            disabled={busy}
            onClick={() => cancel.mutate()}
          >
            {t('runs.cancel')}
          </button>
        )}
        {d.mine && d.status === 'failed' && d.attempts < d.maxAttempts && (
          <button
            type="button"
            className={`${btn} border border-[var(--border)]`}
            disabled={busy}
            onClick={() => retry.mutate()}
          >
            {t('runs.retry')}
          </button>
        )}
      </div>
      {actionError && (
        <p role="alert" className="text-sm text-red-600" data-testid="action-error">
          {t(errorKey(actionError, RUN_ERRORS))}
        </p>
      )}
    </div>
  );
}
