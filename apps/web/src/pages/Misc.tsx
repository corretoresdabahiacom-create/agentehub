import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

export function OfflinePage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">{t('offline.title')}</h1>
      <p className="text-[var(--text-muted)]">{t('offline.body')}</p>
    </div>
  );
}

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">{t('notFound.title')}</h1>
      <Link className="text-brand-600 underline" to="/">
        {t('notFound.back')}
      </Link>
    </div>
  );
}
