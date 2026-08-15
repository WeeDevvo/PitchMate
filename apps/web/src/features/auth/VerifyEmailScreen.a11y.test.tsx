/**
 * Accessibility tests for the Verify_Email_Screen (task 17.3).
 *
 * These assert `jest-axe` reports no accessibility violations on the fully
 * rendered Verify_Email_Screen in BOTH the dark and light themes
 * (Requirement 14.8).
 *
 * jsdom does not implement `window.matchMedia` (so `ThemeProvider` would resolve
 * the dark-first default) and does not compute colour/contrast (so axe's
 * contrast check is reported as incomplete, not a violation) — contrast
 * thresholds are covered separately by the theme-token tests (task 1.4). We
 * install a small `matchMedia` stub, mirroring the Reset_Confirm_Screen a11y
 * test, to force light vs dark, and wrap the screen in the auth `ThemeProvider`
 * so the resolved theme is applied to `<html>` via `data-theme`.
 *
 * The screen composes `LinkButton` and reads the shared auth state, so it is
 * wrapped in a `MemoryRouter` and an `AuthProvider` (over an in-memory
 * `SessionManager`). A verification token is supplied via the `search` prop so
 * the redeem resolves to the success state (Requirements 7.1, 7.3); a second
 * pair of checks covers the missing-token state (Requirement 7.7).
 *
 * Feature: web-auth-screens
 * Validates: Requirements 14.8
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { axe } from 'jest-axe'
import { ThemeProvider } from './components/ThemeProvider'
import { AuthProvider } from './session/AuthContext'
import {
  createSessionManager,
  type AuthApi,
  type RefreshResult,
  type SessionManager,
  type SignOutResult,
} from './session/SessionManager'
import { createInMemorySessionStore } from './session/SessionStore'
import {
  VerifyEmailScreen,
  VERIFY_EMAIL_HEADING,
  MISSING_TOKEN_MESSAGE,
} from './VerifyEmailScreen'
import type { AuthAckResult } from './api/authApi'

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

/** A no-op auth API — the redeem succeeds; the a11y test never resends. */
const authApi = {
  redeemEmailVerification: vi.fn(
    async (): Promise<AuthAckResult> => ({ ok: true }),
  ),
  requestEmailVerification: vi.fn(
    async (): Promise<AuthAckResult> => ({ ok: true }),
  ),
}

/** A stub backend seam for the SessionManager; never exercised by the screen. */
function stubSessionApi(): AuthApi {
  return {
    refresh: vi.fn(
      async (): Promise<RefreshResult> => ({ kind: 'invalid-or-expired' }),
    ),
    signOut: vi.fn(async (): Promise<SignOutResult> => ({ kind: 'success' })),
  }
}

/** An unauthenticated in-memory SessionManager for the provider. */
function makeManager(): SessionManager {
  return createSessionManager({
    storage: createInMemorySessionStore(),
    api: stubSessionApi(),
    now: () => 1_000_000,
    renewalMarginMs: 60_000,
    refreshTimeoutMs: 10_000,
    signOutTimeoutMs: 5_000,
    onUnauthenticated: () => {},
  })
}

/** A verification token so the full success form is presented. */
const TOKEN_SEARCH = '?token=abc123'

function renderScreen(search: string) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <AuthProvider manager={makeManager()}>
          <VerifyEmailScreen authApi={authApi} search={search} />
        </AuthProvider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

describe('VerifyEmailScreen accessibility', () => {
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
  it('has no axe violations with a token in the dark theme', async () => {
    installMatchMedia(false)
    const { container } = renderScreen(TOKEN_SEARCH)

    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark'),
    )
    // Wait for the redeem to settle so the final DOM is assessed.
    await screen.findByRole('heading', { level: 1, name: VERIFY_EMAIL_HEADING })

    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  // Validates: Requirements 14.8
  it('has no axe violations with a token in the light theme', async () => {
    installMatchMedia(true)
    const { container } = renderScreen(TOKEN_SEARCH)

    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-theme')).toBe('light'),
    )
    await screen.findByRole('heading', { level: 1, name: VERIFY_EMAIL_HEADING })

    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  // Validates: Requirements 14.8
  it('has no axe violations in the missing-token state in the dark theme', async () => {
    installMatchMedia(false)
    const { container } = renderScreen('')

    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark'),
    )
    expect(screen.getByText(MISSING_TOKEN_MESSAGE)).toBeInTheDocument()

    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  // Validates: Requirements 14.8
  it('has no axe violations in the missing-token state in the light theme', async () => {
    installMatchMedia(true)
    const { container } = renderScreen('')

    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-theme')).toBe('light'),
    )
    expect(screen.getByText(MISSING_TOKEN_MESSAGE)).toBeInTheDocument()

    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})
