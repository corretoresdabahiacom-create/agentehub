import { useTranslation } from 'react-i18next';
import { SELECTABLE_LANGUAGES } from '../i18n';
import { useTheme, type ThemeChoice } from '../lib/theme';

const field =
  'rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm text-[var(--text)]';

export function LanguageSelect() {
  const { t, i18n } = useTranslation();
  const current = i18n.language.startsWith('pt') ? 'pt' : 'en';
  return (
    <label className="flex items-center gap-1 text-sm text-[var(--text-muted)]">
      <span className="sr-only">{t('lang.label')}</span>
      <select
        aria-label={t('lang.label')}
        className={field}
        value={current}
        onChange={(e) => void i18n.changeLanguage(e.target.value)}
      >
        {SELECTABLE_LANGUAGES.map((l) => (
          <option key={l} value={l}>
            {t(`lang.${l}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ThemeSelect() {
  const { t } = useTranslation();
  const [theme, setTheme] = useTheme();
  return (
    <label className="flex items-center gap-1 text-sm text-[var(--text-muted)]">
      <span className="sr-only">{t('theme.label')}</span>
      <select
        aria-label={t('theme.label')}
        className={field}
        value={theme}
        onChange={(e) => setTheme(e.target.value as ThemeChoice)}
      >
        {(['system', 'light', 'dark'] as const).map((v) => (
          <option key={v} value={v}>
            {t(`theme.${v}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
