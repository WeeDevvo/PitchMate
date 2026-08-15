// Feature: web-auth-screens, Task 7.12: sign-out call + concurrency guard (Requirements 10.1, 10.5)
import { describe, it, expect, vi } from 'vitest'
import {
  createSessionManager,
  type AuthApi,
  type Session,
  type SessionManagerDeps,
  type SignOutResult,
} from './SessionManager'
import { createInMemorySessionStore, type SessionStore } from './SessionStore'

/**
 * Unit (example) tests for {@link SessionManager.signOut} (task 7.10 logic):
 *
 * - Requirement 10.1 — when a Session is held, sign-out calls the backend with
 *   the current Refresh_Token so the server can revoke it, then always tears the
 *   local Session down to 'unauthenticated' with persistence cleared.
 * - Requirement 10.5 — a second concurrent sign-out that arrives while one is in
 *   flight joins the SAME in-flight promise instead of starting a second backend
 *   call or a duplicate teardown.
 *
 * The clock is frozen at 0 and margins/timeouts are dummies: sign-out reads no
 * time itself, so these values only satisfy the {@link SessionManagerDeps}
 * shape. `onUnauthenticated` is a spy so we can assert sign-out never routes
 * through it (teardown publishes the state change but does not call it).
 */

/** A held Session with a known Refresh_Token the backend sign-out must receive. */
const CURRENT_SESSION: Session = {
  accessToken: 'access-current',
  refreshToken: 'refresh-current',
  expiresAtMs: 1_000,
}

/** A distinct second Session for the latch-reset test. */
const SECOND_SESSION: Session = {
  accessToken: 'access-second',
  refreshToken: 'refresh-second',
  expiresAtMs: 2_000,
}

/**
 * Build deterministic deps over the given store and API. The clock is frozen at
 * 0 and the numeric tunables are dummies — sign-out consults none of them
 * directly (the timeout is enforced via a timer we never let elapse in the
 * concurrency test because the backend resolves first).
 */
function depsOver(
  storage: SessionStore,
  api: AuthApi,
  onUnauthenticated: () => void,
): SessionManagerDeps {
  return {
    storage,
    api,
    now: () => 0,
    renewalMarginMs: 60_000,
    refreshTimeoutMs: 10_000,
    signOutTimeoutMs: 5_000,
    onUnauthenticated,
  }
}

/** A manually-resolvable promise, so a sign-out can be held in flight. */
function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('SessionManager sign-out backend call and concurrency guard', () => {
  it('calls the backend sign-out with the current refresh token then tears down (Requirement 10.1)', async () => {
    const store = createInMemorySessionStore()
    const signOut = vi
      .fn<AuthApi['signOut']>()
      .mockResolvedValue({ kind: 'success' })
    const refresh = vi.fn<AuthApi['refresh']>()
    const onUnauthenticated = vi.fn()

    const manager = createSessionManager(
      depsOver(store, { refresh, signOut }, onUnauthenticated),
    )
    manager.establish(CURRENT_SESSION)

    await manager.signOut()

    // Backend revoke called exactly once with the current Refresh_Token (Req 10.1).
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(signOut).toHaveBeenCalledWith(CURRENT_SESSION.refreshToken)
    // Local teardown always follows: unauthenticated and persistence cleared.
    expect(manager.getState()).toBe('unauthenticated')
    expect(store.load()).toBeNull()
    // Sign-out publishes the state change but does not route via onUnauthenticated.
    expect(onUnauthenticated).not.toHaveBeenCalled()
  })

  it('blocks a second concurrent activation: the second sign-out joins the first with no second backend call (Requirement 10.5)', async () => {
    const store = createInMemorySessionStore()
    const pending = deferred<SignOutResult>()
    const signOut = vi
      .fn<AuthApi['signOut']>()
      .mockReturnValue(pending.promise)
    const refresh = vi.fn<AuthApi['refresh']>()
    const onUnauthenticated = vi.fn()

    const manager = createSessionManager(
      depsOver(store, { refresh, signOut }, onUnauthenticated),
    )
    manager.establish(CURRENT_SESSION)

    // Two concurrent sign-outs while the backend stays in flight (do NOT await).
    const first = manager.signOut()
    const second = manager.signOut()

    // Concurrency guard: only ONE backend call — the second activation joined
    // the in-flight sign-out rather than starting another (Requirement 10.5).
    // (signOut() is async, so each call returns its own wrapper promise; the
    // single backend call is what proves the join, not reference identity.)
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(signOut).toHaveBeenCalledWith(CURRENT_SESSION.refreshToken)

    // Let the backend answer and both joined sign-outs settle.
    pending.resolve({ kind: 'success' })
    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toBeUndefined()

    // Still exactly one backend call after settling; teardown ran once.
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(manager.getState()).toBe('unauthenticated')
    expect(store.load()).toBeNull()
    expect(onUnauthenticated).not.toHaveBeenCalled()
  })

  it('resets the guard after completion: a fresh session can be signed out again (Requirement 10.5)', async () => {
    const store = createInMemorySessionStore()
    const signOut = vi
      .fn<AuthApi['signOut']>()
      .mockResolvedValue({ kind: 'success' })
    const refresh = vi.fn<AuthApi['refresh']>()
    const onUnauthenticated = vi.fn()

    const manager = createSessionManager(
      depsOver(store, { refresh, signOut }, onUnauthenticated),
    )

    // First session established and signed out.
    manager.establish(CURRENT_SESSION)
    await manager.signOut()

    // A brand-new session is established and signed out again.
    manager.establish(SECOND_SESSION)
    await manager.signOut()

    // The latch reset between sign-outs: two backend calls, each with its own
    // Refresh_Token (Requirement 10.5 — a completed sign-out does not block later ones).
    expect(signOut).toHaveBeenCalledTimes(2)
    expect(signOut).toHaveBeenNthCalledWith(1, CURRENT_SESSION.refreshToken)
    expect(signOut).toHaveBeenNthCalledWith(2, SECOND_SESSION.refreshToken)
    expect(manager.getState()).toBe('unauthenticated')
    expect(store.load()).toBeNull()
  })
})
