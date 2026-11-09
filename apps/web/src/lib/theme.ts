import { useCallback, useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
const STORAGE_KEY = 'agenthub.theme'; // preferência de interface; NUNCA credencial.

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* storage indisponível */
  }
  return 'system';
}

function apply(choice: ThemeChoice) {
  const dark =
    choice === 'dark' ||
    (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function initTheme() {
  apply(read());
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (read() === 'system') apply('system');
  });
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(read);
  useEffect(() => apply(choice), [choice]);
  const update = useCallback((next: ThemeChoice) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignora */
    }
    setChoice(next);
  }, []);
  return [choice, update] as const;
}
