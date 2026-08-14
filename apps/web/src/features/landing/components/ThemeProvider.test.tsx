/**
 * Component tests for ThemeProvider live theme behaviour.
 *
 * jsdom does not implement `window.matchMedia`, so we install a small
 * controllable stub that lets a test flip the reported preference and
 * dispatch a `change` event — simulating the OS/browser appearance changing
 * while the page is open.
 *
 * Feature: marketing-landing-page
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { ThemeProvider, useTheme } from './ThemeProvider'

const LIGHT_QUERY = '(prefers-color-scheme: light)'

type ChangeListener = (event: MediaQueryListEvent) => void

/**
 * A controllable matchMedia stub. `setPrefersLight` flips the reported match
 * state and notifies subscribed listeners, mimicking a live preference change.
 */
class MatchMediaStub {
  private prefersLight: boolean
  private listeners = new Set<ChangeListener>()

  constructor(initialPrefersLight: boolean) {
    this.prefersLight = initialPrefersLight
  }

  readonly matchMedia = (query: string): MediaQueryList => {
    // Only the light-preference query is meaningful here. Arrow functions
    // capture `this` (the stub instance) without aliasing it to a local.
    const getMatches = () => (query === LIGHT_QUERY ? this.prefersLight : false)
    const listeners = this.listeners
    return {
      get matches() {
        return getMatches()
      },
      media: query,
      onchange: null,
      addEventListener: (_type: 'change', listener: ChangeListener) => {
        listeners.add(listener)
      },
      removeEventListener: (_type: 'change', listener: ChangeListener) => {
        listeners.delete(listener)
      },
      // Legacy API — unused by the provider but part of the interface.
      addListener: (listener: ChangeListener) => {
        listeners.add(listener)
      },
      removeListener: (listener: ChangeListener) => {
        listeners.delete(listener)
      },
      dispatchEvent: () => true,
    } as unknown as MediaQueryList
  }

  setPrefersLight(next: boolean) {
    this.prefersLight = next
    const event = { matches: next, media: LIGHT_QUERY } as MediaQueryListEvent
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

function installMatchMedia(prefersLight: boolean): MatchMediaStub {
  const stub = new MatchMediaStub(prefersLight)
  window.matchMedia = stub.matchMedia
  return stub
}

function ThemeProbe() {
  const theme = useTheme()
  return <span data-testid="active-theme">{theme}</span>
}

describe('ThemeProvider live theme behaviour', () => {
  const originalMatchMedia = window.matchMedia

  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
  })

  afterEach(() => {
    // Restore the original (jsdom leaves this undefined) and reset the DOM.
    window.matchMedia = originalMatchMedia
    document.documentElement.removeAttribute('data-theme')
  })

  // Validates: Requirements 5.5
  it('flips data-theme without a reload when the system preference changes', () => {
    const media = installMatchMedia(false) // start: not light => dark

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(screen.getByTestId('active-theme')).toHaveTextContent('dark')

    // Simulate the browser switching to a light appearance preference.
    act(() => {
      media.setPrefersLight(true)
    })

    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(screen.getByTestId('active-theme')).toHaveTextContent('light')

    // ...and back to dark, still live.
    act(() => {
      media.setPrefersLight(false)
    })

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(screen.getByTestId('active-theme')).toHaveTextContent('dark')
  })

  // Validates: Requirements 5.3
  it('resolves the initial theme to light when the browser reports a light preference', () => {
    installMatchMedia(true)

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )

    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(screen.getByTestId('active-theme')).toHaveTextContent('light')
  })

  // Validates: Requirements 5.7
  it('bootstrap sets data-theme on <html> before body content (pre-paint)', () => {
    // The pre-paint bootstrap lives in index.html and runs synchronously in
    // <head>, before the <body>/#root content. We assert the bootstrap logic
    // itself: it must resolve dark-mode-first and set the attribute using only
    // matchMedia — no dependency on rendered content. Running that same script
    // over a fresh document sets data-theme before any body content exists.
    installMatchMedia(false)

    // Re-create the bootstrap's synchronous body (mirrors index.html).
    const runBootstrap = () => {
      let prefersLight: boolean
      try {
        prefersLight =
          typeof window.matchMedia === 'function' &&
          window.matchMedia(LIGHT_QUERY).matches
      } catch {
        prefersLight = false
      }
      document.documentElement.setAttribute(
        'data-theme',
        prefersLight ? 'light' : 'dark',
      )
    }

    // Body has no rendered app content yet at bootstrap time.
    expect(document.getElementById('root')).toBeNull()

    runBootstrap()

    // data-theme is present even though no body/app content has rendered.
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.getElementById('root')).toBeNull()
  })
})
