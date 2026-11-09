import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import es from './es.json';
import pt from './pt.json';

/**
 * Idiomas oferecidos na interface. Espanhol tem estrutura pronta (es.json, com fallback para en),
 * mas só aparece no seletor quando houver traduções (hoje: vazio, por decisão do briefing).
 */
export const SELECTABLE_LANGUAGES = ['en', 'pt'] as const;
export type SelectableLanguage = (typeof SELECTABLE_LANGUAGES)[number];

const STORAGE_KEY = 'agenthub.lang'; // preferência de interface; NUNCA credencial.

function detect(): SelectableLanguage {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'pt') return saved;
  } catch {
    /* storage indisponível: segue para o idioma do navegador */
  }
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('pt')
    ? 'pt'
    : 'en';
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, pt: { translation: pt }, es: { translation: es } },
  lng: detect(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React já escapa
});

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    /* ignora */
  }
});
document.documentElement.lang = i18n.language;

export default i18n;
