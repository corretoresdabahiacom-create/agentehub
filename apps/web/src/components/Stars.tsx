import { Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Estrelas somente de leitura. Sem avaliações => texto honesto, nunca "0 estrelas". */
export function Rating({ avg, count }: { avg: number | null; count: number }) {
  const { t } = useTranslation();
  if (avg === null || count === 0) {
    return <span className="text-sm text-[var(--text-muted)]">{t('market.noReviews')}</span>;
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-sm"
      role="img"
      aria-label={t('market.ratingLabel', { avg: avg.toFixed(1), count })}
    >
      <Stars value={avg} />
      <span className="text-[var(--text-muted)]">
        {avg.toFixed(1)} ({count})
      </span>
    </span>
  );
}

export function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={14}
          className={n <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-slate-400'}
        />
      ))}
    </span>
  );
}
