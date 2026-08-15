/**
 * Accessibility tests for the Log_In_Screen (task 14.4).
 *
 * These assert `jest-axe` reports no accessibility violations on the fully
 * rendered Log_In_Screen in BOTH the dark and light themes (Requirement 14.8).
 *
 * jsdom does not implement `window.matchMedia` (so `ThemeProvider` would resolve
 * the dark-first default) and does not compute colour/contrast (so axe's
 * contrast check is reported as incomplete, not a violation) — contrast
 * thresholds are covered separately by the theme-token tests (task 1.4). We
 * install a small `matchMedia` stub, mirroring the Sign_Up_Screen a11y test, to
 * force light vs dark, and wrap the screen in the auth `ThemeProvider` so the
 * resolved theme is applied to `<html>` via `data-theme`.
 *
 * The screen composes `LinkButton` (Sign_Up / Reset_Request links), which uses
 * react-router's `useNavigate`, so the screen is wrapped in a `MemoryRouter`.
 *
 * Feature: web-auth-screens
 * Validates: Requirements 14.8
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { axe } from 'jest-axe'
import { ThemeProvider } from './components/ThemeProvider'
import { LogInScreen } from './LogInScreen'
import type { AuthSessionResult } from './api/authApi'

const LIGHT_QUERY = '(prefers-color-scheme: light)'

/**
 * Install a static `matchMedia` stub. jsdom omits it entirely, so this both
 * satisfies `ThemeProvider` and lets a test force the reported preference.
 */
function installMatchMedia(prefersLight: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query === LIGHT_QUERY ? prefersLight : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia
}

/** A no-op auth API — the a11y test never submits. */
const authApi = {
  signIn: vi.fn(
    async (): Promise<AuthSessionResult> => ({
      ok: true,
      session: {
        accessToken: 'a',
        refreshToken: 'r',
        expiresAtMs: 1_900_000_000_000,
      },
    }),
  ),
  signInGoogle: vi.fn(
    async (): Promise<AuthSessionResult> => ({
      ok: true,
      session: {
        accessToken: 'a',
        refreshToken: 'r',
        expiresAtMs: 1_900_000_000_000,
      },
    }),
  ),
}

function renderScreen() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <LogInScreen
          authApi={authApi}
          requestGoogleAssertion={vi.fn(async () => null)}
          onSession={vi.fn()}
          onGoogleFailure={vi.fn()}
        />
      </ThemeProvider>
    </MemoryRouter>,
  )
}

describe('LogInScreen accessibility', () => {
  const originalMatchMedia = window.matchMedia

  beforeEach(() => {
    installMatchMedia(false) // dark-first default unless a test opts into light
    document.documentElement.removeAttribute('data-theme')
  })

  afterEach(() => {
    window.matchMedia = originalMatchMedia
    document.documentElement.removeAttribute('data-theme')
    vi.clearAllMocks()
  })

  // Validates: Requirements 14.8
  it('has no axe violations in the dark theme', async () => {
    installMatchMedia(false)
    const { container } = renderScreen()

    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark'),
    )

    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  // Validates: Requirements 14.8
  it('has no axe violations in the light theme', async () => {
    installMatchMedia(true)
    const { container } = renderScreen()

    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-theme')).toBe('light'),
    )

    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})
