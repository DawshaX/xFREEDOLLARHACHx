import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  detectLang, dirOf, isLang, LANGS, saveLang, translate,
  type LangCode, type TKey,
} from "@/lib/i18n";

interface LanguageContextValue {
  lang: LangCode;
  dir: "ltr" | "rtl";
  setLang: (code: LangCode) => void;
  /** Translate a shell string. Unknown keys return the key itself. */
  t: (key: TKey) => string;
  languages: typeof LANGS;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<LangCode>(() => detectLang());
  const dir = dirOf(lang);

  // The document itself follows the language: RTL is not a CSS afterthought.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const setLang = useCallback((code: LangCode) => {
    if (!isLang(code)) return;
    setLangState(code);
    saveLang(code);
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({
      lang,
      dir,
      setLang,
      t: (key: TKey) => translate(lang, key),
      languages: LANGS,
    }),
    [lang, dir, setLang],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/**
 * Access the active language. Components rendered outside the provider (tests,
 * storybook) get Arabic + a direct fallback instead of a crash.
 */
export function useI18n(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (ctx) return ctx;
  return {
    lang: "ar",
    dir: "rtl",
    setLang: () => {},
    t: (key: TKey) => translate("ar", key),
    languages: LANGS,
  };
}
