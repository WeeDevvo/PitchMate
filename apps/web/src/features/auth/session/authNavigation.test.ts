import { describe, it, expect, vi } from 'vitest'
import {
  createAuthNavigation,
  createNavigationController,
  type NavigationSeam,
} from './authNavigation'
import { createRedirectTargetStore } from './redirectTargetStore'
import { createSessionManager, type AuthApi } from './SessionManager'
import { createInMemorySessionStore } from './SessionStore'
import { createAuthConfig } from '../config/authConfig'
import type { AuthSessionPayload } from '../api/authApi'

/** A no-op backend API for building a real SessionManager in tests. */
const noopApi: AuthApi = {
  refresh: async () => ({ kind: 'transport-failure' }),
  signOut: async () => ({ kind: 'success' }),
}

function buildSessionManager(api: AuthApi = noopApi) {
  return createSessionManager({
    storage: createInMemorySessionStore(),
    api,
    now: () => 1_000,
    renewalMarginMs: 60_000,
    refreshTimeoutMs: 10_000,
    signOutTimeoutMs: 5_000,
    onUnauthenticated: () => {},
  })
}

/** A navigation spy recording every path navigated to. */
function recordingNavigator(): NavigationSeam & { paths: string[] } {
  const paths: string[] = []
  return {
    paths,
    navigate(path: string) {
      paths.push(path)
    },
  }
}

const PAYLOAD: AuthSessionPayload = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAtMs: 10_000,
}

describe('createNavigationController', () => {
  it('is a no-op until a delegate is installed, then delegates', () => {
    const controller = createNavigationController()
    // No delegate yet: must not throw.
    expect(() => controller.navigate('/x')).not.toThrow()

    const spy = vi.fn()
    controller.setDelegate(spy)
    controller.navigate('/app')
    expect(spy).toHaveBeenCalledWith('/app')
  })

  it('replaces the delegate when set again', () => {
    const controller = createNavigationController()
    const first = vi.fn()
    const second = vi.fn()
    controller.setDelegate(first)
    controller.setDelegate(second)
    controller.navigate('/y')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('/y')
  })
})

describe('createAuthNavigation.onSession', () => {
  it('establishes the session and navigates to the default route when no target captured (Requirement 11.2)', () => {
    const sessionManager = buildSessionManager()
    const navigator = recordingNavigator()
    const config = createAuthConfig({ defaultAuthenticatedRoute: '/app' })
    const navigation = createAuthNavigation({
      sessionManager,
      redirectStore: createRedirectTargetStore(),
      config,
      navigator,
    })

    navigation.onSession(PAYLOAD)

    expect(sessionManager.getState()).toBe('authenticated')
    expect(navigator.paths).toEqual(['/app'])
  })

  it('navigates to a captured safe same-origin target (Requirement 11.1)', () => {
    const sessionManager = buildSessionManager()
    const navigator = recordingNavigator()
    const redirectStore = createRedirectTargetStore()
    redirectStore.capture('/squads/123')
    const navigation = createAuthNavigation({
      sessionManager,
      redirectStore,
      config: createAuthConfig({ defaultAuthenticatedRoute: '/app' }),
      navigator,
    })

    navigation.onSession(PAYLOAD)

    expect(navigator.paths).toEqual(['/squads/123'])
  })

  it('discards an unsafe captured target and falls back to the default route (Requirement 11.3)', () => {
    const sessionManager = buildSessionManager()
    const navigator = recordingNavigator()
    const redirectStore = createRedirectTargetStore()
    redirectStore.capture('https://evil.example.com/steal')
    const navigation = createAuthNavigation({
      sessionManager,
      redirectStore,
      config: createAuthConfig({ defaultAuthenticatedRoute: '/app' }),
      navigator,
    })

    navigation.onSession(PAYLOAD)

    expect(navigator.paths).toEqual(['/app'])
  })

  it('clears the captured target after use so it is not reused (Requirement 11.6)', () => {
    const sessionManager = buildSessionManager()
    const navigator = recordingNavigator()
    const redirectStore = createRedirectTargetStore()
    redirectStore.capture('/squads/123')
    const navigation = createAuthNavigation({
      sessionManager,
      redirectStore,
      config: createAuthConfig({ defaultAuthenticatedRoute: '/app' }),
      navigator,
    })

    navigation.onSession(PAYLOAD)
    // A subsequent authentication with no fresh capture must use the default.
    navigation.onSession(PAYLOAD)

    expect(navigator.paths).toEqual(['/squads/123', '/app'])
    expect(redirectStore.peek()).toBeNull()
  })
})

describe('createAuthNavigation.signOut', () => {
  it('ends unauthenticated and navigates to the public post-sign-out route (Requirements 10.3, 10.4)', async () => {
    const sessionManager = buildSessionManager()
    const navigator = recordingNavigator()
    const navigation = createAuthNavigation({
      sessionManager,
      redirectStore: createRedirectTargetStore(),
      config: createAuthConfig({ publicPostSignOutRoute: '/goodbye' }),
      navigator,
    })

    // Establish first, then sign out.
    navigation.onSession(PAYLOAD)
    navigator.paths.length = 0

    await navigation.signOut()

    expect(sessionManager.getState()).toBe('unauthenticated')
    expect(navigator.paths).toEqual(['/goodbye'])
  })
})

describe('createAuthNavigation.resolveCapturedTarget', () => {
  it('resolves the currently captured target without consuming it', () => {
    const redirectStore = createRedirectTargetStore()
    redirectStore.capture('/squads/9')
    const navigation = createAuthNavigation({
      sessionManager: buildSessionManager(),
      redirectStore,
      config: createAuthConfig({ defaultAuthenticatedRoute: '/app' }),
      navigator: recordingNavigator(),
    })

    expect(navigation.resolveCapturedTarget()).toBe('/squads/9')
    // Not consumed.
    expect(redirectStore.peek()).toBe('/squads/9')
  })

  it('returns the default route when nothing is captured', () => {
    const navigation = createAuthNavigation({
      sessionManager: buildSessionManager(),
      redirectStore: createRedirectTargetStore(),
      config: createAuthConfig({ defaultAuthenticatedRoute: '/app' }),
      navigator: recordingNavigator(),
    })

    expect(navigation.resolveCapturedTarget()).toBe('/app')
  })
})
