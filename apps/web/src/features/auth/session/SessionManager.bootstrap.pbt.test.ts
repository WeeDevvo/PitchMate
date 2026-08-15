// Feature: web-auth-screens, Property 11: Bootstrap rejects incomplete persisted state
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  createSessionManager,
  type AuthApi,
  type SessionManagerDeps,
} from './SessionManager'
import type { PersistedSession, SessionStore } from './SessionStore'

/**
 * Property 11: Bootstrap rejects incomplete persisted state.
 *
 * "For any persisted state that is absent or is missing either the access token
 *  or the refresh token, bootstrap discards any persisted state and reports the
 *  authentication state as 'unauthenticated'."
 *
 * Validates: Requirements 8.5
 *
 * The real {@link SessionStore} already returns `null` from `load()` for every
 * incomplete shape (absent, missing/empty token, missing/non-finite expiry).
 * To exercise `bootstrap` over genuinely-incomplete persisted bytes, this suite
 * uses a hand-written fake `SessionStore` whose `load()` mirrors that contract —
 * it interprets the arbitrary incomplete input and returns `null` — while also
 * spying on `clear()` so we can assert the partial state is discarded (Req 8.5).
 */

// --- Fake SessionStore ------------------------------------------------------

interface SpyStore extends SessionStore {
  /** Number of times {@link SessionStore.clear} has been invoked. */
  readonly clearCount: () => number
}

/**
 * A fake store seeded with an arbitrary raw persisted value. `load()` mirrors
 * the real store's null-on-incomplete contract: any value that is not a
 * complete session (non-empty string tokens plus a finite `expiresAtMs`) loads
 * as `null`. `clear()` is counted so the test can assert state was discarded.
 */
function makeSpyStore(rawPersisted: unknown): SpyStore {
  let clears = 0
  let state = rawPersisted

  const interpret = (value: unknown): PersistedSession | null => {
    if (typeof value !== 'object' || value === null) {
      return null
    }
    const candidate = value as Record<string, unknown>
    const { accessToken, refreshToken, expiresAtMs } = candidate
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      return null
    }
    if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
      return null
    }
    if (typeof expiresAtMs !== 'number' || !Number.isFinite(expiresAtMs)) {
      return null
    }
    return { accessToken, refreshToken, expiresAtMs }
  }

  return {
    load: () => interpret(state),
    save: (session: PersistedSession) => {
      state = session
    },
    clear: () => {
      clears += 1
      state = null
    },
    clearCount: () => clears,
  }
}

/** A stub AuthApi: bootstrap never touches the backend, so these throw if used. */
const STUB_API: AuthApi = {
  refresh: () => {
    throw new Error('refresh must not be called during bootstrap')
  },
  signOut: () => {
    throw new Error('signOut must not be called during bootstrap')
  },
}

function makeDeps(storage: SessionStore): SessionManagerDeps {
  return {
    storage,
    api: STUB_API,
    now: () => 0,
    renewalMarginMs: 60_000,
    refreshTimeoutMs: 10_000,
    signOutTimeoutMs: 5_000,
    onUnauthenticated: () => {},
  }
}

// --- Generators -------------------------------------------------------------

// A non-empty token string.
const nonEmptyString = fc.string({ minLength: 1, maxLength: 32 })
// A finite expiry instant in epoch milliseconds.
const finiteExpiry = fc.integer({ min: 0, max: 4_100_000_000_000 })

/**
 * An arbitrary INCOMPLETE persisted state: any value that a valid session must
 * NOT be. Cases:
 *  - absent (null / undefined)
 *  - non-object primitives
 *  - object missing `accessToken`
 *  - object missing `refreshToken`
 *  - empty-string tokens
 *  - missing / non-finite `expiresAtMs`
 */
const incompletePersistedState: fc.Arbitrary<unknown> = fc.oneof(
  // Absent.
  fc.constant(null),
  fc.constant(undefined),
  // Non-object primitives can never be a session.
  fc.string(),
  fc.integer(),
  fc.boolean(),
  // Missing accessToken.
  fc.record({ refreshToken: nonEmptyString, expiresAtMs: finiteExpiry }),
  // Missing refreshToken.
  fc.record({ accessToken: nonEmptyString, expiresAtMs: finiteExpiry }),
  // Empty accessToken.
  fc.record({
    accessToken: fc.constant(''),
    refreshToken: nonEmptyString,
    expiresAtMs: finiteExpiry,
  }),
  // Empty refreshToken.
  fc.record({
    accessToken: nonEmptyString,
    refreshToken: fc.constant(''),
    expiresAtMs: finiteExpiry,
  }),
  // Missing expiresAtMs.
  fc.record({ accessToken: nonEmptyString, refreshToken: nonEmptyString }),
  // Non-finite / non-numeric expiresAtMs.
  fc.record({
    accessToken: nonEmptyString,
    refreshToken: nonEmptyString,
    expiresAtMs: fc.constantFrom(
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      'not-a-number' as unknown as number,
    ),
  }),
  // Empty object.
  fc.constant({}),
)

// --- Property ---------------------------------------------------------------

describe('SessionManager.bootstrap — Property 11: rejects incomplete persisted state', () => {
  it('returns unauthenticated and discards any partial state for incomplete input', () => {
    fc.assert(
      fc.property(incompletePersistedState, (raw) => {
        const store = makeSpyStore(raw)
        const manager = createSessionManager(makeDeps(store))

        const bootstrapState = manager.bootstrap()

        // Bootstrap reports unauthenticated for any incomplete persisted state.
        expect(bootstrapState).toBe('unauthenticated')
        // The derived state agrees.
        expect(manager.getState()).toBe('unauthenticated')
        // Partial state is discarded (Requirement 8.5).
        expect(store.clearCount()).toBeGreaterThanOrEqual(1)
        // Nothing usable remains to restore.
        expect(store.load()).toBeNull()
      }),
      { numRuns: 200 },
    )
  })
})
