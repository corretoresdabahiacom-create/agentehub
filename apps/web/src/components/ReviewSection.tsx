import { REVIEW_BODY_MAX, REVIEW_QUALIFYING_DAYS, type AgentDetail } from '@agenthub/shared';
import { BadgeCheck } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { errorKey } from '../lib/api';
import { useOnline } from '../lib/online';
import { useDeleteReview, useMe, useReviews, useSaveReview } from '../lib/queries';
import { ACTION_ERRORS } from './InstallPanel';
import { Rating, Stars } from './Stars';

export function ReviewSection({ agent }: { agent: AgentDetail }) {
  const { t, i18n } = useTranslation();
  const me = useMe();
  const online = useOnline();
  const reviews = useReviews(agent.slug);
  const save = useSaveReview(agent.slug);
  const remove = useDeleteReview(agent.slug);
  const mine = agent.viewer?.myReview ?? null;
  const [rating, setRating] = useState(mine?.rating ?? 0);
  const [body, setBody] = useState(mine?.body ?? '');
  useEffect(() => {
    setRating(mine?.rating ?? 0);
    setBody(mine?.body ?? '');
  }, [mine?.rating, mine?.body]);

  const fmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });
  const error = save.error ?? remove.error;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (rating >= 1) save.mutate({ rating, body: body.trim() || undefined });
  }

  return (
    <section className="space-y-4" aria-labelledby="rev-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="rev-title" className="text-lg font-semibold">
          {t('market.reviews')}
        </h2>
        <Rating avg={agent.ratingAvg} count={agent.ratingCount} />
      </div>

      {!me.data && (
        <p className="text-sm text-[var(--text-muted)]">
          <Link to="/login" className="text-brand-600 underline">
            {t('nav.signIn')}
          </Link>{' '}
          {t('market.signInToReview')}
        </p>
      )}

      {me.data && agent.viewer && !agent.viewer.canReview && (
        <p
          className="rounded-md bg-[var(--surface-muted)] p-3 text-sm"
          data-testid="review-ineligible"
        >
          {t(`market.ineligible.${agent.viewer.reviewIneligibleReason ?? 'not_installed'}`, {
            days: REVIEW_QUALIFYING_DAYS,
          })}
        </p>
      )}

      {me.data && agent.viewer?.canReview && (
        <form
          onSubmit={submit}
          className="space-y-3 rounded-lg border border-[var(--border)] p-4"
          data-testid="review-form"
        >
          <fieldset>
            <legend className="mb-1 text-sm font-medium">{t('market.yourRating')}</legend>
            <div className="flex gap-3">
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className="flex items-center gap-1 text-sm">
                  <input
                    type="radio"
                    name="rating"
                    value={n}
                    checked={rating === n}
                    onChange={() => setRating(n)}
                  />
                  {n}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t('market.yourComment')}</span>
            <textarea
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
              rows={3}
              maxLength={REVIEW_BODY_MAX}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!online || rating < 1 || save.isPending}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {mine ? t('market.updateReview') : t('market.submitReview')}
            </button>
            {mine && (
              <button
                type="button"
                disabled={!online || remove.isPending}
                className="rounded-md border border-[var(--border)] px-4 py-2 text-sm"
                onClick={() => remove.mutate(undefined)}
              >
                {t('market.deleteReview')}
              </button>
            )}
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600" data-testid="action-error">
          {t(errorKey(error, ACTION_ERRORS))}
        </p>
      )}

      {reviews.data && reviews.data.reviews.length === 0 && (
        <p className="text-sm text-[var(--text-muted)]">{t('market.noReviews')}</p>
      )}
      <ul className="space-y-3" data-testid="review-list">
        {reviews.data?.reviews.map((r) => (
          <li
            key={r.id}
            className="rounded-lg border border-[var(--border)] p-3"
            data-testid="review-item"
          >
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span role="img" aria-label={t('market.starsOf', { n: r.rating })}>
                <Stars value={r.rating} />
              </span>
              {r.verified && (
                <span
                  className="inline-flex items-center gap-1 rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-900"
                  data-testid="verified-badge"
                  title={t('market.verifiedHint', { days: REVIEW_QUALIFYING_DAYS })}
                >
                  <BadgeCheck size={12} aria-hidden="true" />
                  {t('market.verified')}
                </span>
              )}
              {r.mine && (
                <span className="text-xs text-[var(--text-muted)]">{t('market.yours')}</span>
              )}
              <span className="ml-auto text-xs text-[var(--text-muted)]">
                {fmt.format(new Date(r.createdAt))}
              </span>
            </div>
            {/* Texto puro: React escapa; nunca HTML. */}
            {r.body && <p className="mt-2 whitespace-pre-wrap text-sm">{r.body}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
