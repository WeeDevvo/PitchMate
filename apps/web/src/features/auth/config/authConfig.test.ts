import { describe, it, expect } from 'vitest'
import {
  createAuthConfig,
  redirectResolutionConfigFromAuthConfig,
  clampSignOutTimeout,
  REDIRECT_TARGET_MAX_LENGTH,
  REFRESH_TIMEOUT_DEFAULT_MS,
  SIGN_OUT_TIMEOUT_MAX_MS,
  CALL_TIMEOUT_DEFAULT_MS,
  DEFAULT_AUTHENTICATED_ROUTE,
  DEFAULT_PUBLIC_POST_SIGN_OUT_ROUTE,
} from './authConfig'
import {
  RENEWAL_MARGIN_DEFAULT_MS,
  RENEWAL_MARGIN_MIN_MS,
  RENEWAL_MARGIN_MAX_MS,
} from '../lib/accessTokenExpiry'
import { AUTH_ROUTE_PATHS } from '../authRoutes'

describe('createAuthConfig', () => {
  it('applies the mandated defaults when no overrides are given', () => {
    const config = createAuthConfig()

    expect(config.defaultAuthenticatedRoute).toBe(DEFAULT_AUTHENTICATED_ROUTE)
    expect(config.publicPostSignOutRoute).toBe(
      DEFAULT_PUBLIC_POST_SIGN_OUT_ROUTE,
    )
    expect(config.authRoutePaths).toEqual(AUTH_ROUTE_PATHS)
    expect(config.renewalMarginMs).toBe(RENEWAL_MARGIN_DEFAULT_MS)
    expect(config.refreshTimeoutMs).toBe(REFRESH_TIMEOUT_DEFAULT_MS)
    expect(config.signOutTimeoutMs).toBe(SIGN_OUT_TIMEOUT_MAX_MS)
    expect(config.callTimeoutMs).toBe(CALL_TIMEOUT_DEFAULT_MS)
    expect(config.googleClientId).toBe('')
  })

  it('passes through provided overrides', () => {
    const config = createAuthConfig({
      defaultAuthenticatedRoute: '/home',
      publicPostSignOutRoute: '/goodbye',
      googleClientId: 'client-123',
      callTimeoutMs: 20_000,
    })

    expect(config.defaultAuthenticatedRoute).toBe('/home')
    expect(config.publicPostSignOutRoute).toBe('/goodbye')
    expect(config.googleClientId).toBe('client-123')
    expect(config.callTimeoutMs).toBe(20_000)
  })

  it('clamps the Renewal_Margin into the 15..300s band (Requirement 9.1)', () => {
    expect(createAuthConfig({ renewalMarginMs: 1_000 }).renewalMarginMs).toBe(
      RENEWAL_MARGIN_MIN_MS,
    )
    expect(
      createAuthConfig({ renewalMarginMs: 10_000_000 }).renewalMarginMs,
    ).toBe(RENEWAL_MARGIN_MAX_MS)
    expect(createAuthConfig({ renewalMarginMs: 90_000 }).renewalMarginMs).toBe(
      90_000,
    )
  })

  it('caps the sign-out timeout at 5s (Requirement 10.3)', () => {
    expect(createAuthConfig({ signOutTimeoutMs: 30_000 }).signOutTimeoutMs).toBe(
      SIGN_OUT_TIMEOUT_MAX_MS,
    )
    expect(createAuthConfig({ signOutTimeoutMs: 2_000 }).signOutTimeoutMs).toBe(
      2_000,
    )
  })
})

describe('clampSignOutTimeout', () => {
  it('caps at the 5s maximum and rejects non-positive/non-finite inputs', () => {
    expect(clampSignOutTimeout(10_000)).toBe(SIGN_OUT_TIMEOUT_MAX_MS)
    expect(clampSignOutTimeout(3_000)).toBe(3_000)
    expect(clampSignOutTimeout(0)).toBe(SIGN_OUT_TIMEOUT_MAX_MS)
    expect(clampSignOutTimeout(-1)).toBe(SIGN_OUT_TIMEOUT_MAX_MS)
    expect(clampSignOutTimeout(Number.NaN)).toBe(SIGN_OUT_TIMEOUT_MAX_MS)
  })
})

describe('redirectResolutionConfigFromAuthConfig', () => {
  it('derives the resolver config from the auth config', () => {
    const config = createAuthConfig({ defaultAuthenticatedRoute: '/dash' })
    const resolution = redirectResolutionConfigFromAuthConfig(config)

    expect(resolution.defaultAuthenticatedRoute).toBe('/dash')
    expect(resolution.authRoutePaths).toBe(config.authRoutePaths)
    expect(resolution.maxLength).toBe(REDIRECT_TARGET_MAX_LENGTH)
  })
})
