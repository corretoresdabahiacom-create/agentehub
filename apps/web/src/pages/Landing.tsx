import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ServiceStatus } from '../components/ServiceStatus';

export default function Landing() {
  const { t } = useTranslation();
  const items = [1, 2, 3] as const;
  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h1 className="text-3xl font-bold sm:text-4xl">{t('landing.title')}</h1>
        <p className="max-w-2xl text-[var(--text-muted)]">{t('landing.subtitle')}</p>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/signup"
            className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700"
          >
            {t('landing.cta')}
          </Link>
          <Link
            to="/login"
            className="rounded-md border border-[var(--border)] px-4 py-2 font-medium"
          >
            {t('landing.ctaSecondary')}
          </Link>
        </div>
        <p className="text-sm text-[var(--text-muted)]">{t('landing.statusNote')}</p>
      </section>
      <section aria-labelledby="how">
        <h2 id="how" className="mb-4 text-xl font-semibold">
          {t('landing.principles')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {items.map((n) => (
            <article key={n} className="rounded-lg border border-[var(--border)] p-4">
              <h3 className="font-semibold">{t(`landing.p${n}Title`)}</h3>
              <p className="mt-1 text-sm text-[var(--text-muted)]">{t(`landing.p${n}Body`)}</p>
            </article>
          ))}
        </div>
      </section>
      <ServiceStatus />
    </div>
  );
}
