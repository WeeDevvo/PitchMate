/**
 * ThemeProvider — owns the live colour-scheme behaviour for the auth screens.
 *
 * The pre-paint inline bootstrap in `index.html` sets the initial `data-theme`
 * on `<html>` before first paint. This provider then takes over the *live*
 * behaviour, mirroring the landing feature's proven pattern:
 *   - resolves the initial theme via `resolveTheme` (Requirements 13.1, 13.2),
 *   - subscribes to `matchMedia('(prefers-color-scheme: light)')` changes and
 *     updates the `data-theme` attribute on `<html>` live, without a page
 *     reload (Requirement 13.3),
 *   - exposes the active theme to descendants via React context (`useTheme`).
 *
 * It intentionally mirrors the same media query and dark-mode-first rule used
 * by the bootstrap so the provider never disagrees with the pre-paint result.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  resolveTheme,
  type AppearancePreference,
  type Theme,
} from '../lib/theme'

/** The media query the bootstrap and provider both key off. */
const LIGHT_QUERY = '(prefers-color-scheme: light)'

/**
 * Read the current appearance preference from the browser.
 *
 * Returns `'light'` only when the browser explicitly reports a light
 * preference; otherwise `null` (unresolvable/absent), which `resolveTheme`
 * treats as dark. Guards against environments without `matchMedia`.
 */
function readPreference(): AppearancePreference {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null
  }
  try {
    return window.matchMedia(LIGHT_QUERY).matches ? 'light' : null
  } catch {
    return null
  }
}

const ThemeContext = createContext<Theme | undefined>(undefined)

/**
 * Read the active theme from context.
 *
 * Must be called from within a `ThemeProvider`.
 */
// eslint-disable-next-line react-refresh/only-export-components -- provider + its context hook are intentionally co-located
export function useTheme(): Theme {
  const theme = useContext(ThemeContext)
  if (theme === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return theme
}

export interface ThemeProviderProps {
  children: ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(readPreference()))

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const mediaQuery = window.matchMedia(LIGHT_QUERY)

    const applyFromMatches = (matches: boolean) => {
      setTheme(resolveTheme(matches ? 'light' : null))
    }

    // Re-sync on mount in case the preference changed between the initial
    // render and the effect running.
    applyFromMatches(mediaQuery.matches)

    const handleChange = (event: MediaQueryListEvent) => {
      applyFromMatches(event.matches)
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [])

  // Apply the resolved theme to <html> live, without a reload (Requirement 13.3).
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme)
    }
  }, [theme])

  const value = useMemo(() => theme, [theme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export default ThemeProvider
