/**
 * Component tests for the auth ThemeProvider live theme behaviour.
 *
 * jsdom does not implement `window.matchMedia`, so we install a small
 * controllable stub that lets a test flip the reported preference and
 * dispatch a `change` event — simulating the OS/browser appearance changing
 * while the page is open. This mirrors the landing feature's proven pattern.
 *
 * Feature: web-auth-screens
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

describe('auth ThemeProvider live theme behaviour', () => {
  const originalMatchMedia = window.matchMedia

  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
  })

  afterEach(() => {
    // Restore the original (jsdom leaves this undefined) and reset the DOM.
    window.matchMedia = originalMatchMedia
    document.documentElement.removeAttribute('data-theme')
  })

  // Validates: Requirements 13.3
  it('flips data-theme live without a reload when the system preference changes', () => {
    const media = installMatchMedia(false) // start: not light => dark

    // Capture the live document/root so we can prove the same document is
    // mutated in place (no full-document reload, no remount).
    const documentBeforeChange = document
    const rootBeforeChange = document.documentElement

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

    // The update happened on the very same document/root element — the page
    // was not reloaded and the component tree was not remounted.
    expect(document).toBe(documentBeforeChange)
    expect(document.documentElement).toBe(rootBeforeChange)

    // ...and back to dark, still live on the same document.
    act(() => {
      media.setPrefersLight(false)
    })

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(screen.getByTestId('active-theme')).toHaveTextContent('dark')
    expect(document.documentElement).toBe(rootBeforeChange)
  })
})
