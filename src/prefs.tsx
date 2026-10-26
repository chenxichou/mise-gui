import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { translate, type Lang, type Theme } from './i18n'

interface Prefs {
  lang: Lang
  theme: Theme
  setLang: (l: Lang) => void
  setTheme: (t: Theme) => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

const LANG_KEY = 'mise-gui.lang'
const THEME_KEY = 'mise-gui.theme'

const Ctx = createContext<Prefs | null>(null)

function readInitialLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY)
    if (v === 'zh' || v === 'en') return v
  } catch {
    /* storage unavailable */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'zh'
  return nav.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

function readInitialTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (v === 'dark' || v === 'light') return v
  } catch {
    /* storage unavailable */
  }
  return 'dark'
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(readInitialLang)
  const [theme, setTheme] = useState<Theme>(readInitialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
    try {
      localStorage.setItem(THEME_KEY, theme)
      localStorage.setItem(LANG_KEY, lang)
    } catch {
      /* ignore */
    }
    // Keep the native menu language / window background in sync with prefs.
    window.mise?.setLangPref(lang, theme).catch(() => undefined)
  }, [lang, theme])

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars),
    [lang],
  )

  const value = useMemo<Prefs>(() => ({ lang, theme, setLang, setTheme, t }), [lang, theme, t])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePrefs(): Prefs {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('usePrefs must be used within PrefsProvider')
  return ctx
}
