// Feature: web-auth-screens, Property 10: Session persistence round-trip
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  createSessionManager,
  type AuthApi,
  type Session,
  type SessionManagerDeps,
} from './SessionManager'
import { createInMemorySessionStore } from './SessionStore'

/**
 * Property 10: Session persistence round-trip.
 *
 * For any valid Session (non-empty access token, non-empty refresh token, and
 * expiry instant), persisting it and then bootstrapping restores an equivalent
 * current Session and reports the authentication state as 'authenticated'.
 *
 * The round-trip is modelled the way a real full-document reload works: manager
 * A establishes the Session against a shared store, then a fresh manager B is
 * created over the SAME store instance and bootstraps from it — B has no shared
 * in-memory state with A, so anything it restores came purely through the
 * persistence seam (Requirement 8.3). Equivalence is asserted via observable
 * behaviour: B.bootstrap() returns 'authenticated', B.getState() is
 * 'authenticated' (Requirement 8.4), and the persisted store's load() carries
 * exactly the original Session fields.
 *
 * Validates: Requirements 8.3, 8.4
 */

/**
 * A stub {@link AuthApi} whose refresh/signOut are never exercised by this
 * property — bootstrap/establish perform no backend calls. If either is called
 * it throws, so an accidental network dependency surfaces as a test failure
 * rather than passing silently.
 */
const throwingApi: AuthApi = {
  refresh() {
    throw new Error('refresh must not be called during persistence round-trip')
  },
  signOut() {
    throw new Error('signOut must not be called during persistence round-trip')
  },
}

/** Build deterministic deps over a given store: frozen clock, no-op navigation. */
function depsOver(storage: SessionManagerDeps['storage']): SessionManagerDeps {
  return {
    storage,
    api: throwingApi,
    now: () => 0,
    renewalMarginMs: 60_000,
    refreshTimeoutMs: 10_000,
    signOutTimeoutMs: 5_000,
    onUnauthenticated: () => {},
  }
}

// A valid Session: both tokens non-empty (minLength 1), finite integer expiry.
const validSession: fc.Arbitrary<Session> = fc.record({
  accessToken: fc.string({ minLength: 1 }),
  refreshToken: fc.string({ minLength: 1 }),
  expiresAtMs: fc.integer(),
})

describe('SessionManager persistence round-trip (Property 10)', () => {
  // Feature: web-auth-screens, Property 10: Session persistence round-trip
  // Validates: Requirements 8.3, 8.4
  it('restores an equivalent authenticated Session after establish → bootstrap over the same store', () => {
    fc.assert(
      fc.property(validSession, (session) => {
        // A shared store instance is the only channel between the two managers,
        // modelling persistence surviving a full-document reload (Req 8.3).
        const store = createInMemorySessionStore()

        // Manager A establishes and persists the Session.
        const managerA = createSessionManager(depsOver(store))
        managerA.establish(session)

        // Manager B is a fresh instance over the SAME store: a full reload.
        const managerB = createSessionManager(depsOver(store))
        const bootstrapState = managerB.bootstrap()

        // Restores as authenticated (Req 8.4) and stays authenticated.
        expect(bootstrapState).toBe('authenticated')
        expect(managerB.getState()).toBe('authenticated')

        // The persisted Session is equivalent to the one that was established.
        expect(store.load()).toEqual({
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          expiresAtMs: session.expiresAtMs,
        })
      }),
      { numRuns: 100 },
    )
  })
})
