import { useTranslation } from 'react-i18next';
import { useConfig } from '../lib/queries';

/** Painel honesto (R4): mostra o que realmente existe no servidor, sem inventar disponibilidade. */
export function ServiceStatus() {
  const { t } = useTranslation();
  const { data, isError, isPending } = useConfig();
  if (isPending) return null;
  if (isError || !data) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {t('errors.network')}
      </p>
    );
  }
  const rows: Array<[string, string, boolean]> = [
    [
      t('status.turnstile'),
      t(`status.values.${data.turnstile.status}`),
      data.turnstile.status === 'enforced',
    ],
    [t('status.ai'), t('status.values.not_configured'), false],
    [t('status.push'), t('status.values.unavailable'), false],
    [t('status.billing'), t('status.values.off'), false],
  ];
  return (
    <section
      aria-labelledby="status-title"
      className="rounded-lg border border-[var(--border)] p-4"
    >
      <h2 id="status-title" className="font-semibold">
        {t('status.title')}
      </h2>
      <p className="mb-3 text-sm text-[var(--text-muted)]">{t('status.subtitle')}</p>
      <dl className="grid gap-2 text-sm sm:grid-cols-2" data-testid="service-status">
        {rows.map(([k, v, ok]) => (
          <div
            key={k}
            className="flex justify-between gap-2 rounded bg-[var(--surface-muted)] px-3 py-2"
          >
            <dt className="text-[var(--text-muted)]">{k}</dt>
            <dd className={ok ? 'font-medium text-green-700 dark:text-green-400' : 'font-medium'}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
