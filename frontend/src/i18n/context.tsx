import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { translations, type Locale, type TranslationKeys } from './translations';

interface I18nContextValue {
  locale: Locale;
  t: TranslationKeys;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * Retrieve the saved locale from localStorage, falling back to 'en'.
 * @returns Saved locale or default
 */
function getSavedLocale(): Locale {
  const saved = localStorage.getItem('locale');
  return saved === 'zh' ? 'zh' : 'en';
}

/**
 * Provider component that supplies i18n context to the component tree.
 * Persists the selected locale in localStorage.
 * @param props - Children to wrap
 * @returns Provider component
 */
export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<Locale>(getSavedLocale);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem('locale', l);
  }, []);

  const value = useMemo(() => ({
    locale,
    t: translations[locale],
    setLocale,
  }), [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

/**
 * Hook to access the i18n context (locale, translations, setter).
 * @returns I18n context value
 */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
