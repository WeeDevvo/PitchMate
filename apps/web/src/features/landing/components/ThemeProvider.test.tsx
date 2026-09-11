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
import {
  LIGHT_APPEARANCE_QUERY,
  THEME_ATTRIBUTE,
  THEME_BOOTSTRAP_SOURCE,
} from '../../../theme'

const LIGHT_QUERY = LIGHT_APPEARANCE_QUERY

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
    // The pre-paint bootstrap is the shared `THEME_BOOTSTRAP_SOURCE`, injected
    // into <head> as one inline non-module script, so it runs synchronously
    // before the <body>/#root content. Evaluating that same source here — rather
    // than a copy of its logic — is what keeps this assertion honest: it must
    // resolve dark-mode-first from storage and matchMedia alone, with no
    // dependency on rendered content.
    localStorage.clear()
    installMatchMedia(false)

    /** Evaluate the bootstrap exactly as the injected inline script would. */
    const runBootstrap = () => {
      new Function(THEME_BOOTSTRAP_SOURCE)()
    }

    // Body has no rendered app content yet at bootstrap time.
    expect(document.getElementById('root')).toBeNull()

    runBootstrap()

    // data-theme is present even though no body/app content has rendered.
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('dark')
    expect(document.getElementById('root')).toBeNull()

    // ...and an explicit light browser preference is honoured pre-paint too.
    installMatchMedia(true)
    document.documentElement.removeAttribute(THEME_ATTRIBUTE)

    runBootstrap()

    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('light')
    expect(document.getElementById('root')).toBeNull()
  })
})
