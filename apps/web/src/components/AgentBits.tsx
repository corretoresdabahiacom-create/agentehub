import type { CategoryInfo } from '@agenthub/shared';
import { useTranslation } from 'react-i18next';

export function categoryName(c: CategoryInfo, lang: string): string {
  if (lang.startsWith('pt')) return c.namePt;
  if (lang.startsWith('es') && c.nameEs) return c.nameEs;
  return c.nameEn;
}

/** Selo obrigatório para conteúdo de demonstração (R5). */
export function DemoBadge() {
  const { t } = useTranslation();
  return (
    <span
      data-testid="demo-badge"
      className="w-fit rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-900"
    >
      {t('market.demo')}
    </span>
  );
}
