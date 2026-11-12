import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PASSWORD_MAX, PASSWORD_MIN } from '@agenthub/shared';
import { useCallback, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import { safeNext } from '../lib/next';
import { api, errorKey } from '../lib/api';
import { useOnline } from '../lib/online';
import { keys, useConfig } from '../lib/queries';
import { TurnstileWidget } from './TurnstileWidget';

const KNOWN = [
  'invalid_credentials',
  'email_taken',
  'validation_error',
  'rate_limited',
  'capacity_reached',
  'antibot_failed',
  'antibot_unavailable',
  'auth_unavailable',
  'signup_closed',
  'csrf_origin_mismatch',
  'csrf_origin_missing',
  'network',
] as const;

const input =
  'w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--text)] focus:outline-2 focus:outline-brand-500';

export function AuthForm({ mode }: { mode: 'signup' | 'login' }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { search } = useLocation();
  const next = safeNext(search);
  const qc = useQueryClient();
  const online = useOnline();
  const config = useConfig();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [show, setShow] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const onToken = useCallback((v: string | null) => setToken(v), []);

  const mutation = useMutation({
    mutationFn: () => {
      const turnstileToken = token ?? undefined;
      return mode === 'signup'
        ? api.signup({
            email,
            password,
            displayName: displayName.trim() || undefined,
            locale: i18n.language.startsWith('pt') ? 'pt' : 'en',
            turnstileToken,
          })
        : api.login({ email, password, turnstileToken });
    },
    onSuccess: (me) => {
      qc.setQueryData(keys.me, me);
      void navigate(next ?? '/app', { replace: true });
    },
  });

  const cfg = config.data;
  const turnstile = cfg?.turnstile;
  const blockedByConfig =
    !cfg || turnstile?.status === 'not_configured' || (mode === 'signup' && !cfg.signupOpen);
  const needsToken = turnstile?.status === 'enforced';
  const canSubmit =
    online && !blockedByConfig && (!needsToken || token !== null) && !mutation.isPending;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (canSubmit) mutation.mutate();
  };

  const title = mode === 'signup' ? t('auth.signUpTitle') : t('auth.signInTitle');
  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-6 text-2xl font-bold">{title}</h1>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {mode === 'signup' && (
          <div>
            <label htmlFor="name" className="mb-1 block text-sm font-medium">
              {t('auth.name')}
            </label>
            <input
              id="name"
              className={input}
              autoComplete="name"
              maxLength={80}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
        )}
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium">
            {t('auth.email')}
          </label>
          <input
            id="email"
            type="email"
            required
            className={input}
            autoComplete="email"
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium">
            {t('auth.password')}
          </label>
          <div className="flex gap-2">
            <input
              id="password"
              type={show ? 'text' : 'password'}
              required
              className={input}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              minLength={mode === 'signup' ? PASSWORD_MIN : undefined}
              maxLength={PASSWORD_MAX}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="shrink-0 rounded-md border border-[var(--border)] px-3 text-sm"
              onClick={() => setShow((v) => !v)}
            >
              {show ? t('auth.hidePassword') : t('auth.showPassword')}
            </button>
          </div>
          {mode === 'signup' && (
            <p className="mt-1 text-xs text-[var(--text-muted)]">{t('auth.passwordHint')}</p>
          )}
        </div>

        {turnstile?.status === 'enforced' && turnstile.siteKey && (
          <TurnstileWidget siteKey={turnstile.siteKey} onToken={onToken} />
        )}
        {turnstile?.status === 'disabled_dev' && (
          <p className="text-xs text-amber-700 dark:text-amber-400">{t('auth.antibotDev')}</p>
        )}
        {turnstile?.status === 'not_configured' && (
          <p role="alert" className="text-sm text-red-600">
            {t('auth.antibotMissing')}
          </p>
        )}
        {mode === 'signup' && cfg && !cfg.signupOpen && (
          <p role="alert" className="text-sm text-red-600">
            {t('auth.signupClosed')}
          </p>
        )}
        {!online && (
          <p role="alert" className="text-sm text-amber-700">
            {t('auth.offlineBlocked')}
          </p>
        )}
        {mutation.isError && (
          <p role="alert" data-testid="form-error" className="text-sm text-red-600">
            {t(errorKey(mutation.error, KNOWN))}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mutation.isPending
            ? t('auth.working')
            : mode === 'signup'
              ? t('auth.submitSignUp')
              : t('auth.submitSignIn')}
        </button>
      </form>
      <p className="mt-4 text-sm text-[var(--text-muted)]">
        {mode === 'signup' ? t('auth.haveAccount') : t('auth.noAccount')}{' '}
        <Link
          className="font-medium text-brand-600 underline dark:text-brand-500"
          to={`${mode === 'signup' ? '/login' : '/signup'}${next ? `?next=${encodeURIComponent(next)}` : ''}`}
        >
          {mode === 'signup' ? t('nav.signIn') : t('nav.signUp')}
        </Link>
      </p>
    </div>
  );
}
