/**
 * Accessibility tests for the Reset_Confirm_Screen (task 16.3).
 *
 * These assert `jest-axe` reports no accessibility violations on the fully
 * rendered Reset_Confirm_Screen in BOTH the dark and light themes
 * (Requirement 14.8).
 *
 * jsdom does not implement `window.matchMedia` (so `ThemeProvider` would resolve
 * the dark-first default) and does not compute colour/contrast (so axe's
 * contrast check is reported as incomplete, not a violation) — contrast
 * thresholds are covered separately by the theme-token tests (task 1.4). We
 * install a small `matchMedia` stub, mirroring the Reset_Request_Screen a11y
 * test, to force light vs dark, and wrap the screen in the auth `ThemeProvider`
 * so the resolved theme is applied to `<html>` via `data-theme`.
 *
 * The screen composes `LinkButton` (Reset_Request / Log_In links) and uses
 * react-router's `useLocation`, so the screen is wrapped in a `MemoryRouter`.
 * A Password_Reset_Token is supplied via the `search` prop so the screen
 * renders its full new-password form (Requirements 1.5, 6.1); a second pair of
 * checks covers the missing-token state (Requirement 6.4).
 *
 * Feature: web-auth-screens
 * Validates: Requirements 14.8
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { axe } from 'jest-axe'
import { ThemeProvider } from './components/ThemeProvider'
import { ResetConfirmScreen } from './ResetConfirmScreen'
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

/** A no-op auth API — the a11y test never submits. */
const authApi = {
  redeemPasswordReset: vi.fn(async (): Promise<AuthAckResult> => ({ ok: true })),
}

/** A valid-looking Password_Reset_Token so the full form is presented. */
const TOKEN_SEARCH = '?token=abc123'

function renderScreen(search: string) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <ResetConfirmScreen authApi={authApi} search={search} />
      </ThemeProvider>
    </MemoryRouter>,
  )
}

describe('ResetConfirmScreen accessibility', () => {
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

    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})
