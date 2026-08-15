/**
 * Accessibility tests for the Sign_Up_Screen (task 13.3).
 *
 * These assert `jest-axe` reports no accessibility violations on the fully
 * rendered Sign_Up_Screen in BOTH the dark and light themes (Requirement 14.8).
 *
 * jsdom does not implement `window.matchMedia` (so `ThemeProvider` would resolve
 * the dark-first default) and does not compute colour/contrast (so axe's
 * contrast check is reported as incomplete, not a violation) — contrast
 * thresholds are covered separately by the theme-token tests (task 1.4). We
 * install a small `matchMedia` stub, mirroring the landing feature's a11y test,
 * to force light vs dark, and wrap the screen in the auth `ThemeProvider` so the
 * resolved theme is applied to `<html>` via `data-theme`.
 *
 * The screen composes `GoogleSignInControl`, which uses no router, so no router
 * wrapper is required.
 *
 * Feature: web-auth-screens
 * Validates: Requirements 14.8
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { axe } from 'jest-axe'
import { ThemeProvider } from './components/ThemeProvider'
import { SignUpScreen } from './SignUpScreen'
import type { AuthAckResult, AuthSessionResult } from './api/authApi'

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
  register: vi.fn(async (): Promise<AuthAckResult> => ({ ok: true })),
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
    <ThemeProvider>
      <SignUpScreen
        authApi={authApi}
        requestGoogleAssertion={vi.fn(async () => null)}
        onGoogleSession={vi.fn()}
      />
    </ThemeProvider>,
  )
}

describe('SignUpScreen accessibility', () => {
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
