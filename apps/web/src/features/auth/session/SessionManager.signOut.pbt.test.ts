// Feature: web-auth-screens, Property 16: Sign-out always ends unauthenticated
import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'
import {
  createSessionManager,
  type AuthApi,
  type Session,
  type SessionManagerDeps,
  type SignOutResult,
} from './SessionManager'
import { createInMemorySessionStore } from './SessionStore'

/**
 * Property 16: Sign-out always ends unauthenticated.
 *
 * For any outcome of the backend sign-out call — success, failure, or timeout —
 * the Session_Manager clears the stored Session, deletes the persisted Session
 * state, and reports the authentication state as "unauthenticated", so a reload
 * after sign-out cannot restore a usable Session.
 *
 * Modelling notes:
 * - The full range of backend sign-out outcomes is generated as an arbitrary:
 *     - 'success' → `api.signOut` resolves `{ kind: 'success' }`.
 *     - 'failure' → `api.signOut` resolves `{ kind: 'failure' }`.
 *     - 'reject'  → `api.signOut` returns a REJECTED promise (transport error);
 *                   the manager must contain it and still tear down. The
 *                   rejection is attached synchronously inside the manager
 *                   (`.then(finish, finish)`), so it never surfaces as an
 *                   unhandled rejection.
 *     - 'timeout' → `api.signOut` returns a promise that NEVER resolves; the
 *                   manager's `signOutTimeoutMs`-bounded race must fire the
 *                   timer and tear down anyway.
 * - Vitest FAKE TIMERS drive the timeout deterministically. Every run advances
 *   fake time by `signOutTimeoutMs` via `advanceTimersByTimeAsync`, which both
 *   fires the timeout timer (the 'timeout' case) AND flushes the microtask queue
 *   (so the resolved/rejected cases settle too). Real timers are restored in a
 *   `finally` per run, leaving no dangling timers or open handles.
 * - The clock is fixed at `now: () => 0`; sign-out teardown does not consult it.
 *
 * Assertions, for ANY generated outcome, after `establish(session)` then
 * `await signOut()`:
 *   1. `manager.getState()` === 'unauthenticated'.
 *   2. `store.load()` === null — persisted state deleted, so a reload cannot
 *      restore a usable Session.
 *
 * Validates: Requirements 10.2, 10.3
 */

/** The backend sign-out outcomes exercised by the property. */
type SignOutOutcome = 'success' | 'failure' | 'reject' | 'timeout'

/** The sign-out timeout used for every run (≤ 5s per Requirement 10.3). */
const SIGN_OUT_TIMEOUT_MS = 5_000

/**
 * Build an {@link AuthApi} whose `signOut` realises the given backend outcome.
 * `refresh` is unused by this property and resolves as an inconclusive
 * transport failure so it can never accidentally rotate a Session.
 */
function apiForOutcome(outcome: SignOutOutcome): AuthApi {
  return {
    async refresh() {
      return { kind: 'transport-failure' as const }
    },
    signOut(): Promise<SignOutResult> {
      switch (outcome) {
        case 'success':
          return Promise.resolve({ kind: 'success' })
        case 'failure':
          return Promise.resolve({ kind: 'failure' })
        case 'reject':
          return Promise.reject(new Error('transport error'))
        case 'timeout':
          // A promise that never settles: only the timeout timer can end this.
          return new Promise<SignOutResult>(() => {})
      }
    },
  }
}

/** Deterministic deps: fixed clock, no-op navigation, ≤5s sign-out timeout. */
function depsOver(
  storage: SessionManagerDeps['storage'],
  api: AuthApi,
): SessionManagerDeps {
  return {
    storage,
    api,
    now: () => 0,
    renewalMarginMs: 60_000,
    refreshTimeoutMs: 10_000,
    signOutTimeoutMs: SIGN_OUT_TIMEOUT_MS,
    onUnauthenticated: () => {},
  }
}

// A valid Session: both tokens non-empty, finite integer expiry.
const sessionArb: fc.Arbitrary<Session> = fc.record({
  accessToken: fc.string({ minLength: 1 }),
  refreshToken: fc.string({ minLength: 1 }),
  expiresAtMs: fc.integer(),
})

const outcomeArb: fc.Arbitrary<SignOutOutcome> = fc.constantFrom(
  'success',
  'failure',
  'reject',
  'timeout',
)

describe('SessionManager sign-out always ends unauthenticated (Property 16)', () => {
  // Feature: web-auth-screens, Property 16: Sign-out always ends unauthenticated
  // Validates: Requirements 10.2, 10.3
  it('clears session + persisted state and reports unauthenticated for every backend outcome', async () => {
    await fc.assert(
      fc.asyncProperty(outcomeArb, sessionArb, async (outcome, session) => {
        vi.useFakeTimers()
        try {
          const store = createInMemorySessionStore()
          const api = apiForOutcome(outcome)
          const manager = createSessionManager(depsOver(store, api))

          // A Session is established and persisted before sign-out.
          manager.establish(session)
          expect(manager.getState()).toBe('authenticated')
          expect(store.load()).not.toBeNull()

          // Kick off sign-out without awaiting, then advance fake time by the
          // full timeout: this fires the timeout timer (the 'timeout' case) and
          // flushes microtasks (so resolved/rejected cases settle), after which
          // the sign-out promise resolves once teardown has run.
          const signOutPromise = manager.signOut()
          await vi.advanceTimersByTimeAsync(SIGN_OUT_TIMEOUT_MS)
          await signOutPromise

          // Regardless of the backend outcome, teardown is unconditional.
          expect(manager.getState()).toBe('unauthenticated')
          expect(store.load()).toBeNull()
        } finally {
          vi.useRealTimers()
        }
      }),
      { numRuns: 100 },
    )
  })
})
