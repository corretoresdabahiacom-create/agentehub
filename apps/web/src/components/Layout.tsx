import { Menu, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useOnline } from '../lib/online';
import { useClearSession, useLogout, useMe } from '../lib/queries';
import { LanguageSelect, ThemeSelect } from './Selectors';

export function Layout() {
  const { t } = useTranslation();
  const online = useOnline();
  const me = useMe();
  const logout = useLogout();
  const clearSession = useClearSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const loggingOut = useRef(false);

  // Só limpa a sessão local DEPOIS de sair da rota protegida; limpar antes faria a rota
  // protegida redirecionar para /login por cima da navegação para a home.
  useEffect(() => {
    if (loggingOut.current && pathname === '/') {
      loggingOut.current = false;
      clearSession();
    }
  }, [pathname, clearSession]);
  const user = me.data;

  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-2 text-sm font-medium ${
      isActive
        ? 'bg-brand-50 text-brand-700 dark:bg-[var(--surface-muted)] dark:text-white'
        : 'text-[var(--text-muted)] hover:text-[var(--text)]'
    }`;

  const nav = user ? (
    <>
      <NavLink to="/agents" className={link} onClick={() => setOpen(false)}>
        {t('nav.marketplace')}
      </NavLink>
      <NavLink to="/app" className={link} onClick={() => setOpen(false)}>
        {t('nav.dashboard')}
      </NavLink>
      <button
        type="button"
        className="rounded-md px-3 py-2 text-left text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-50"
        disabled={!online || logout.isPending}
        onClick={() =>
          logout.mutate(undefined, {
            onSettled: () => {
              setOpen(false);
              if (pathname === '/') {
                clearSession(); // já fora da rota protegida
              } else {
                loggingOut.current = true;
                void navigate('/');
              }
            },
          })
        }
      >
        {t('nav.signOut')}
      </button>
    </>
  ) : (
    <>
      <NavLink to="/agents" className={link} onClick={() => setOpen(false)}>
        {t('nav.marketplace')}
      </NavLink>
      <NavLink to="/login" className={link} onClick={() => setOpen(false)}>
        {t('nav.signIn')}
      </NavLink>
      <NavLink
        to="/signup"
        className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
        onClick={() => setOpen(false)}
      >
        {t('nav.signUp')}
      </NavLink>
    </>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-brand-600 focus:px-3 focus:py-2 focus:text-white"
      >
        {t('nav.skip')}
      </a>
      {!online && (
        <div
          role="status"
          data-testid="offline-banner"
          className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900"
        >
          {t('offline.banner')}
        </div>
      )}
      <header className="border-b border-[var(--border)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="text-lg font-semibold text-brand-600 dark:text-brand-500">
            {t('app.name')}
          </Link>
          <nav className="hidden items-center gap-2 md:flex" aria-label="primary">
            {nav}
            <LanguageSelect />
            <ThemeSelect />
          </nav>
          <button
            type="button"
            className="rounded-md p-2 md:hidden"
            aria-label={t('nav.menu')}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        {open && (
          <nav
            className="flex flex-col gap-1 border-t border-[var(--border)] px-4 py-3 md:hidden"
            aria-label="mobile"
          >
            {nav}
            <div className="mt-2 flex gap-3">
              <LanguageSelect />
              <ThemeSelect />
            </div>
          </nav>
        )}
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
