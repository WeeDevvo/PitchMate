// Feature: web-auth-screens, Task 7.9: refresh failure paths (Requirements 9.3, 9.4)
import { describe, it, expect, vi } from 'vitest'
import {
  createSessionManager,
  type AuthApi,
  type RefreshResult,
  type Session,
  type SessionManagerDeps,
} from './SessionManager'
import { createInMemorySessionStore, type SessionStore } from './SessionStore'

/**
 * Unit (example) tests for the just-in-time refresh failure paths of
 * {@link SessionManager.getAccessTokenForRequest} (task 7.6 logic):
 *
 * - Requirement 9.3 — an `invalid-or-expired` Refresh_Token clears the Session,
 *   moves the manager to 'unauthenticated', routes to Log_In_Screen via
 *   `onUnauthenticated`, and does NOT retry.
 * - Requirement 9.4 — repeated `transport-failure`s are retried up to two more
 *   times (three attempts total); when all fail the Session is RETAINED (still
 *   'authenticated', still persisted) and the caller gets `refresh-failed`.
 *   A recovery within the retry budget rotates and returns the new token.
 *
 * Time is frozen so that a refresh is always required: with `now() === 1_000`,
 * `expiresAtMs === 1_000`, and `renewalMarginMs === 60_000`, the refresh
 * predicate `now >= expiresAtMs - margin` (1_000 >= -59_000) holds, so every
 * `getAccessTokenForRequest()` in these tests takes the refresh path.
 */

/** A held Session whose Access_Token is within the renewal margin (needs refresh). */
const CURRENT_SESSION: Session = {
  accessToken: 'access-current',
  refreshToken: 'refresh-current',
  expiresAtMs: 1_000,
}

/** The rotated Session returned by a successful refresh. */
const ROTATED_SESSION: Session = {
  accessToken: 'access-rotated',
  refreshToken: 'refresh-rotated',
  expiresAtMs: 2_000_000,
}

/**
 * Build deterministic deps over the given store and API, with a frozen clock at
 * 1_000ms and a 60s renewal margin so a refresh is always required.
 */
function depsOver(
  storage: SessionStore,
  api: AuthApi,
  onUnauthenticated: () => void,
): SessionManagerDeps {
  return {
    storage,
    api,
    now: () => 1_000,
    renewalMarginMs: 60_000,
    refreshTimeoutMs: 10_000,
    signOutTimeoutMs: 5_000,
    onUnauthenticated,
  }
}

describe('SessionManager refresh failure paths', () => {
  it('clears the session and routes to Log_In_Screen on invalid-or-expired without retrying (Requirement 9.3)', async () => {
    const store = createInMemorySessionStore()
    const refresh = vi.fn<AuthApi['refresh']>().mockResolvedValue({
      kind: 'invalid-or-expired',
    })
    const signOut = vi.fn<AuthApi['signOut']>()
    const onUnauthenticated = vi.fn()
    const stateListener = vi.fn<(state: 'authenticated' | 'unauthenticated') => void>()

    const manager = createSessionManager(
      depsOver(store, { refresh, signOut }, onUnauthenticated),
    )
    manager.subscribe(stateListener)
    manager.establish(CURRENT_SESSION)

    const result = await manager.getAccessTokenForRequest()

    // Caller sees the refresh failure (Requirement 9.3).
    expect(result).toEqual({ error: 'refresh-failed' })
    // Session torn down: state unauthenticated and persistence cleared.
    expect(manager.getState()).toBe('unauthenticated')
    expect(store.load()).toBeNull()
    // Routed to Log_In_Screen exactly once.
    expect(onUnauthenticated).toHaveBeenCalledTimes(1)
    // Subscribers were notified of the move to 'unauthenticated'.
    expect(stateListener).toHaveBeenLastCalledWith('unauthenticated')
    // No retry: refresh was attempted exactly once (Requirement 9.3).
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith(CURRENT_SESSION.refreshToken)
  })

  it('retries twice more then returns refresh-failed while retaining the session on repeated transport-failure (Requirement 9.4)', async () => {
    const store = createInMemorySessionStore()
    const refresh = vi.fn<AuthApi['refresh']>().mockResolvedValue({
      kind: 'transport-failure',
    })
    const signOut = vi.fn<AuthApi['signOut']>()
    const onUnauthenticated = vi.fn()

    const manager = createSessionManager(
      depsOver(store, { refresh, signOut }, onUnauthenticated),
    )
    manager.establish(CURRENT_SESSION)

    const result = await manager.getAccessTokenForRequest()

    // Caller sees the refresh failure (Requirement 9.4).
    expect(result).toEqual({ error: 'refresh-failed' })
    // Retried up to two additional attempts: three total (Requirement 9.4).
    expect(refresh).toHaveBeenCalledTimes(3)
    // Session RETAINED: still authenticated with the original session persisted.
    expect(manager.getState()).toBe('authenticated')
    expect(store.load()).toEqual({
      accessToken: CURRENT_SESSION.accessToken,
      refreshToken: CURRENT_SESSION.refreshToken,
      expiresAtMs: CURRENT_SESSION.expiresAtMs,
    })
    // Not routed to Log_In_Screen — the session is still usable (Requirement 9.4).
    expect(onUnauthenticated).not.toHaveBeenCalled()
  })

  it('recovers within the retry budget: transport-failure twice then success rotates and returns the new token (complements Requirement 9.4)', async () => {
    const store = createInMemorySessionStore()
    const results: RefreshResult[] = [
      { kind: 'transport-failure' },
      { kind: 'transport-failure' },
      { kind: 'success', session: ROTATED_SESSION },
    ]
    const refresh = vi
      .fn<AuthApi['refresh']>()
      .mockImplementation(() => Promise.resolve(results.shift()!))
    const signOut = vi.fn<AuthApi['signOut']>()
    const onUnauthenticated = vi.fn()

    const manager = createSessionManager(
      depsOver(store, { refresh, signOut }, onUnauthenticated),
    )
    manager.establish(CURRENT_SESSION)

    const result = await manager.getAccessTokenForRequest()

    // Third attempt succeeded: the rotated Access_Token is returned.
    expect(result).toEqual({ token: ROTATED_SESSION.accessToken })
    // Exactly three attempts: two failures then the success.
    expect(refresh).toHaveBeenCalledTimes(3)
    // Rotated tokens are adopted in memory and persisted.
    expect(manager.getState()).toBe('authenticated')
    expect(store.load()).toEqual({
      accessToken: ROTATED_SESSION.accessToken,
      refreshToken: ROTATED_SESSION.refreshToken,
      expiresAtMs: ROTATED_SESSION.expiresAtMs,
    })
    // A recovered refresh never routes to Log_In_Screen.
    expect(onUnauthenticated).not.toHaveBeenCalled()
  })
})
