// Feature: web-auth-screens, Property 12: Authentication state reflects the stored session
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
 * Property 12: Authentication state reflects the stored session.
 *
 * For any sequence of establish and clear operations, the Session_Manager
 * reports 'authenticated' exactly while a current Session is stored (with the
 * most recently established Session as current) and 'unauthenticated' exactly
 * while no Session is stored.
 *
 * Modelling notes:
 * - `establish(session)` is the only way to store a Session (Requirement 8.1):
 *   it replaces any prior Session and becomes the current one.
 * - The public contract exposes no `clear()`. The available local teardown path
 *   is `signOut()`, which — in the current core implementation — clears the
 *   in-memory + persisted state and drops the manager to 'unauthenticated'. So
 *   the command sequence is drawn from exactly two operations: `establish` and
 *   `signOut`. `signOut` is async, so it is awaited.
 * - An oracle tracks the expected current Session: `null` initially and after
 *   any signOut, and the most-recently-established Session after an establish.
 *   After each operation `getState()` must equal 'authenticated' iff the oracle
 *   holds a Session, else 'unauthenticated'. After an establish we additionally
 *   assert the persisted store reflects the most-recently-established Session
 *   (Requirement 8.1 — establish replaces the prior session and persists it).
 *
 * Validates: Requirements 8.1, 8.7
 */

/**
 * A stub {@link AuthApi}. `signOut` resolves without contacting a backend so the
 * local-teardown path runs deterministically; `refresh` is never exercised by
 * this property and throws if called, surfacing any accidental dependency.
 */
const stubApi: AuthApi = {
  refresh() {
    throw new Error('refresh must not be called during auth-state tracking')
  },
  async signOut() {
    return { kind: 'success' as const }
  },
}

/** Build deterministic deps over a given store: frozen clock, no-op navigation. */
function depsOver(storage: SessionManagerDeps['storage']): SessionManagerDeps {
  return {
    storage,
    api: stubApi,
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

/** The two operations that move the Session_Manager's stored-session state. */
type Operation =
  | { readonly op: 'establish'; readonly session: Session }
  | { readonly op: 'signOut' }

const operation: fc.Arbitrary<Operation> = fc.oneof(
  validSession.map((session) => ({ op: 'establish' as const, session })),
  fc.constant({ op: 'signOut' as const }),
)

describe('SessionManager auth-state tracking (Property 12)', () => {
  // Feature: web-auth-screens, Property 12: Authentication state reflects the stored session
  // Validates: Requirements 8.1, 8.7
  it("reports 'authenticated' exactly while a Session is stored, tracking the most-recent establish", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(operation, { maxLength: 30 }),
        async (operations) => {
          const store = createInMemorySessionStore()
          const manager = createSessionManager(depsOver(store))

          // A fresh manager holds no Session (Requirement 8.7).
          expect(manager.getState()).toBe('unauthenticated')

          for (const operation of operations) {
            if (operation.op === 'establish') {
              manager.establish(operation.session)

              // Most-recently-established Session is current and persisted, so
              // the state is 'authenticated' exactly while it is held (Req 8.1,
              // 8.7).
              expect(manager.getState()).toBe('authenticated')
              expect(store.load()).toEqual({
                accessToken: operation.session.accessToken,
                refreshToken: operation.session.refreshToken,
                expiresAtMs: operation.session.expiresAtMs,
              })
            } else {
              await manager.signOut()

              // No Session is stored, so the state is 'unauthenticated' (Req 8.7).
              expect(manager.getState()).toBe('unauthenticated')
              expect(store.load()).toBeNull()
            }
          }
        },
      ),
      { numRuns: 100 },
    )
  })
})
