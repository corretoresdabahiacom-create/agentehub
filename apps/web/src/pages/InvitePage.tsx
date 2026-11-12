import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError, errorKey } from '../lib/api';
import { RUN_ERRORS } from '../lib/errors';
import { useOnline } from '../lib/online';
import { useAcceptInvite, useInvitePreview, useMe } from '../lib/queries';
import { btnPrimary } from '../lib/ui';

export default function InvitePage() {
  const { t, i18n } = useTranslation();
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const online = useOnline();
  const me = useMe();
  const loggedIn = Boolean(me.data);
  const preview = useInvitePreview(loggedIn ? token : '');
  const accept = useAcceptInvite(token);
  const next = encodeURIComponent(`/invite/${token}`);

  if (me.isPending) return <p aria-busy="true">…</p>;
  if (!me.data) {
    return (
      <div className="mx-auto max-w-md space-y-4" data-testid="invite-guest">
        <h1 className="text-2xl font-bold">{t('invite.title')}</h1>
        <p>{t('invite.loginFirst')}</p>
        <div className="flex gap-3">
          <Link className={btnPrimary} to={`/login?next=${next}`}>
            {t('nav.signIn')}
          </Link>
          <Link
            className="rounded-md border border-[var(--border)] px-4 py-2 text-sm font-medium"
            to={`/signup?next=${next}`}
          >
            {t('nav.signUp')}
          </Link>
        </div>
      </div>
    );
  }
  if (preview.isPending) return <p aria-busy="true">…</p>;
  if (preview.isError) {
    const invalid = preview.error instanceof ApiError && preview.error.code === 'invite_invalid';
    return (
      <div className="mx-auto max-w-md space-y-3" data-testid="invite-invalid">
        <h1 className="text-2xl font-bold">{t('invite.title')}</h1>
        <p role="alert">
          {invalid ? t('errors.invite_invalid') : t(errorKey(preview.error, RUN_ERRORS))}
        </p>
      </div>
    );
  }
  const p = preview.data;
  const expires = new Date(p.expiresAt).toLocaleString(i18n.language);
  return (
    <div className="mx-auto max-w-md space-y-4" data-testid="invite-preview">
      <h1 className="text-2xl font-bold">{t('invite.title')}</h1>
      <p>
        {t('invite.body', {
          organization: p.organizationName,
          workspace: p.workspaceName,
          role: t(`dashboard.role.${p.role}`),
        })}
      </p>
      <p className="text-sm text-[var(--text-muted)]">{t('invite.expires', { date: expires })}</p>
      {p.alreadyMember ? <p role="note">{t('invite.already')}</p> : null}
      {accept.isError && (
        <p role="alert" className="text-sm text-red-600">
          {t(errorKey(accept.error, RUN_ERRORS))}
        </p>
      )}
      <button
        type="button"
        className={btnPrimary}
        disabled={!online || accept.isPending}
        onClick={() =>
          accept.mutate(undefined, {
            onSuccess: (r) => void navigate(`/teams/${r.workspaceId}`, { replace: true }),
          })
        }
      >
        {p.alreadyMember ? t('invite.open') : t('invite.accept')}
      </button>
    </div>
  );
}
