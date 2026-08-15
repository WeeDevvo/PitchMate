/**
 * Component tests for the auth AuthContext / useAuth React binding.
 *
 * These verify the thin-context contract (Requirement 8.7): `useAuth` must be
 * used within a provider; the provider seeds initial state from the injected
 * SessionManager and re-renders consumers when the manager notifies subscribers;
 * and `signOut` from the hook delegates to the manager.
 *
 * The manager under test is a REAL SessionManager built with the in-memory
 * SessionStore and a stub AuthApi, so the context is exercised against genuine
 * `getState`/`subscribe`/`establish`/`signOut` behaviour rather than a mock.
 *
 * Feature: web-auth-screens
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { AuthProvider, useAuth } from './AuthContext'
import {
  createSessionManager,
  type AuthApi,
  type RefreshResult,
  type Session,
  type SessionManager,
  type SignOutResult,
} from './SessionManager'
import { createInMemorySessionStore } from './SessionStore'

/** A stub AuthApi that records calls; refresh/sign-out succeed by default. */
function createStubApi(overrides: Partial<AuthApi> = {}): AuthApi {
  return {
    refresh: vi.fn(async (): Promise<RefreshResult> => ({ kind: 'invalid-or-expired' })),
    signOut: vi.fn(async (): Promise<SignOutResult> => ({ kind: 'success' })),
    ...overrides,
  }
}

/** Build a real SessionManager over in-memory storage and a stub API. */
function makeManager(overrides: { api?: AuthApi } = {}): SessionManager {
  return createSessionManager({
    storage: createInMemorySessionStore(),
    api: overrides.api ?? createStubApi(),
    now: () => 1_000_000,
    renewalMarginMs: 60_000,
    refreshTimeoutMs: 10_000,
    signOutTimeoutMs: 5_000,
    onUnauthenticated: () => {},
  })
}

const A_SESSION: Session = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAtMs: 5_000_000,
}

/** A consumer that surfaces state and exposes the hook's triggers to the test. */
function AuthProbe({ onReady }: { onReady?: (value: ReturnType<typeof useAuth>) => void }) {
  const auth = useAuth()
  onReady?.(auth)
  return <span data-testid="auth-state">{auth.state}</span>
}

describe('AuthContext / useAuth', () => {
  // Validates: Requirement 8.7 (thin context contract — misuse fails loudly)
  it('throws when useAuth is used outside an AuthProvider', () => {
    // Silence the expected React error boundary logging for this render.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<AuthProbe />)).toThrow(
      'useAuth must be used within an AuthProvider',
    )
    spy.mockRestore()
  })

  // Validates: Requirement 8.7 (state seeded from the manager)
  it('seeds initial state from the manager (unauthenticated with no session)', () => {
    const manager = makeManager()

    render(
      <AuthProvider manager={manager}>
        <AuthProbe />
      </AuthProvider>,
    )

    expect(screen.getByTestId('auth-state')).toHaveTextContent('unauthenticated')
  })

  // Validates: Requirement 8.7 (state seeded from an already-authenticated manager)
  it('seeds authenticated when the manager already holds a session', () => {
    const manager = makeManager()
    manager.establish(A_SESSION)

    render(
      <AuthProvider manager={manager}>
        <AuthProbe />
      </AuthProvider>,
    )

    expect(screen.getByTestId('auth-state')).toHaveTextContent('authenticated')
  })

  // Validates: Requirement 8.7 (re-renders when the manager notifies subscribers)
  it('re-renders when the manager establishes a session via subscribe', () => {
    const manager = makeManager()

    render(
      <AuthProvider manager={manager}>
        <AuthProbe />
      </AuthProvider>,
    )

    expect(screen.getByTestId('auth-state')).toHaveTextContent('unauthenticated')

    act(() => {
      manager.establish(A_SESSION)
    })

    expect(screen.getByTestId('auth-state')).toHaveTextContent('authenticated')
  })

  // Validates: Requirement 8.7 (establish trigger delegates to the manager)
  it('establish() from the hook delegates to the manager and flips state', () => {
    const manager = makeManager()
    const establishSpy = vi.spyOn(manager, 'establish')
    let hook: ReturnType<typeof useAuth> | undefined

    render(
      <AuthProvider manager={manager}>
        <AuthProbe onReady={(value) => (hook = value)} />
      </AuthProvider>,
    )

    act(() => {
      hook?.establish(A_SESSION)
    })

    expect(establishSpy).toHaveBeenCalledWith(A_SESSION)
    expect(screen.getByTestId('auth-state')).toHaveTextContent('authenticated')
  })

  // Validates: Requirement 8.7 (signOut trigger delegates to the manager)
  it('signOut() from the hook delegates to the manager and ends unauthenticated', async () => {
    const manager = makeManager()
    manager.establish(A_SESSION)
    const signOutSpy = vi.spyOn(manager, 'signOut')
    let hook: ReturnType<typeof useAuth> | undefined

    render(
      <AuthProvider manager={manager}>
        <AuthProbe onReady={(value) => (hook = value)} />
      </AuthProvider>,
    )

    expect(screen.getByTestId('auth-state')).toHaveTextContent('authenticated')

    await act(async () => {
      await hook?.signOut()
    })

    expect(signOutSpy).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('auth-state')).toHaveTextContent('unauthenticated')
  })
})
