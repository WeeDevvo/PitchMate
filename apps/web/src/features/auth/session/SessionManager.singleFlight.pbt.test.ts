// Feature: web-auth-screens, Property 15: Concurrent refreshes are single-flight
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  createSessionManager,
  type AuthApi,
  type RefreshResult,
  type Session,
  type SessionManagerDeps,
} from './SessionManager'
import { createInMemorySessionStore } from './SessionStore'

/**
 * Property 15: Concurrent refreshes are single-flight.
 *
 * For any number of simultaneous authenticated requests that all require a
 * renewed Access_Token, the Session_Manager performs at most one refresh call
 * and applies its result to every waiting request.
 *
 * Modelling notes:
 * - We drive N simultaneous callers (2..20) through `getAccessTokenForRequest()`.
 *   To make them genuinely concurrent we exploit the manager's synchronous
 *   entry: each call runs synchronously up to the first `await` on
 *   `AuthApi.refresh`, so firing all N calls in a tight loop (without awaiting)
 *   lets the first caller latch the in-flight refresh before any other caller
 *   can start a second one. Every later caller joins the SAME pending promise.
 * - The fake `AuthApi.refresh` INCREMENTS a call counter and returns a promise
 *   the test controls (a manual deferred). It stays pending until we've launched
 *   all N callers, guaranteeing overlap; only then do we resolve it, and only
 *   then do we await the collected caller promises.
 * - The clock and expiry are arranged so `isRefreshRequired` is TRUE for the
 *   established Session (`now` is past `expiresAtMs`), forcing every caller down
 *   the refresh path (Requirement 9.1's negative branch is excluded on purpose).
 *
 * Assertions:
 *   1. The fake `refresh` call counter is exactly 1 — at most one refresh call
 *      for all N concurrent callers (Requirement 9.5).
 *   2. All N callers resolve to the SAME successful outcome: `{ token }` carrying
 *      the rotated Access_Token, i.e. the one result is applied to every waiter.
 *   3. (Latch reset) After the single-flight settles a subsequent expired
 *      request can start a fresh refresh — the counter advances to 2 — proving
 *      the latch is not permanently held.
 *
 * Validates: Requirements 9.5
 */

/** A manual deferred: a pending promise plus its resolver, for controlled overlap. */
interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

/**
 * A controllable {@link AuthApi} whose `refresh` counts its invocations and
 * returns a fresh, externally-resolvable promise each time. `signOut` is unused
 * by this property and resolves trivially.
 */
function createControllableApi(): {
  api: AuthApi
  callCount: () => number
  pending: Array<Deferred<RefreshResult>>
} {
  const pending: Array<Deferred<RefreshResult>> = []
  let calls = 0
  const api: AuthApi = {
    refresh(): Promise<RefreshResult> {
      calls += 1
      const deferred = createDeferred<RefreshResult>()
      pending.push(deferred)
      return deferred.promise
    },
    async signOut() {
      return { kind: 'success' as const }
    },
  }
  return { api, callCount: () => calls, pending }
}

/** Build deterministic deps: fixed clock at `nowMs`, no-op navigation. */
function depsOver(
  storage: SessionManagerDeps['storage'],
  api: AuthApi,
  nowMs: number,
): SessionManagerDeps {
  return {
    storage,
    api,
    now: () => nowMs,
    renewalMarginMs: 60_000,
    refreshTimeoutMs: 10_000,
    signOutTimeoutMs: 5_000,
    onUnauthenticated: () => {},
  }
}

// A valid Session: both tokens non-empty, finite integer expiry.
const sessionArb: fc.Arbitrary<Session> = fc.record({
  accessToken: fc.string({ minLength: 1 }),
  refreshToken: fc.string({ minLength: 1 }),
  expiresAtMs: fc.integer(),
})

describe('SessionManager single-flight refresh (Property 15)', () => {
  // Feature: web-auth-screens, Property 15: Concurrent refreshes are single-flight
  // Validates: Requirements 9.5
  it('performs at most one refresh for N concurrent callers and applies its result to all', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 20 }),
        sessionArb,
        sessionArb,
        async (callerCount, initialSession, rotatedSession) => {
          const store = createInMemorySessionStore()
          const { api, callCount, pending } = createControllableApi()

          // Freeze the clock past the initial Session's expiry (accounting for
          // the renewal margin) so isRefreshRequired is TRUE for every caller.
          const nowMs = initialSession.expiresAtMs + 60_000
          const manager = createSessionManager(depsOver(store, api, nowMs))

          manager.establish(initialSession)
          expect(manager.getState()).toBe('authenticated')

          // Fire all N callers WITHOUT awaiting: the first latches the in-flight
          // refresh; the rest must join it rather than start their own.
          const callers: Array<
            Promise<
              | { token: string }
              | { error: 'refresh-failed' }
              | { error: 'unauthenticated' }
            >
          > = []
          for (let i = 0; i < callerCount; i += 1) {
            callers.push(manager.getAccessTokenForRequest())
          }

          // Exactly one backend refresh was started for all N concurrent callers.
          expect(callCount()).toBe(1)
          expect(pending).toHaveLength(1)

          // Resolve the single in-flight refresh with the rotated Session, then
          // let every joined caller observe the shared outcome.
          pending[0].resolve({ kind: 'success', session: rotatedSession })
          const results = await Promise.all(callers)

          // Still exactly one refresh call after settling.
          expect(callCount()).toBe(1)

          // Every caller received the SAME successful outcome: the rotated token.
          for (const result of results) {
            expect(result).toEqual({ token: rotatedSession.accessToken })
          }

          // The rotation was applied: the rotated Session is now current/persisted.
          expect(manager.getState()).toBe('authenticated')
          expect(store.load()).toEqual({
            accessToken: rotatedSession.accessToken,
            refreshToken: rotatedSession.refreshToken,
            expiresAtMs: rotatedSession.expiresAtMs,
          })

          // Latch reset: a subsequent expired request can start a fresh refresh.
          // The rotated Session is expired relative to the frozen clock only if
          // its expiry is at/under the initial one; force a definite refresh by
          // establishing an unambiguously-expired Session first.
          manager.establish({
            accessToken: 'post-settle-access',
            refreshToken: 'post-settle-refresh',
            expiresAtMs: nowMs - 120_000,
          })
          const followUp = manager.getAccessTokenForRequest()
          expect(callCount()).toBe(2)
          expect(pending).toHaveLength(2)
          pending[1].resolve({ kind: 'success', session: rotatedSession })
          expect(await followUp).toEqual({ token: rotatedSession.accessToken })
        },
      ),
      { numRuns: 100 },
    )
  })
})
