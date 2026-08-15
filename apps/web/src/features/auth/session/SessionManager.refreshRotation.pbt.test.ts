// Feature: web-auth-screens, Property 14: Refresh rotates both tokens and discards the superseded refresh token
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
 * Property 14: Refresh rotates both tokens and discards the superseded refresh
 * token.
 *
 * Exact property: "For any Session returned by the refresh endpoint, the
 * Session_Manager replaces the stored Access_Token and Refresh_Token with the
 * returned values and retains no reference to the superseded Refresh_Token."
 *
 * The rotation is observed end-to-end through the Session_Manager's public
 * surface: an initial Session is established, `getAccessTokenForRequest()` is
 * driven under a clock that forces `isRefreshRequired` to be true, and the fake
 * {@link AuthApi} returns a DISTINCT rotated Session. We then assert three
 * facts:
 *   1. the returned token is the rotated Access_Token (Access_Token replaced);
 *   2. the persisted store now holds BOTH the rotated Access_Token and the
 *      rotated Refresh_Token (both replaced — Requirement 9.2);
 *   3. the superseded Refresh_Token is retained NOWHERE — proven by forcing a
 *      second refresh and asserting the backend is called with the ROTATED
 *      refresh token, never again with the original superseded one.
 *
 * Validates: Requirements 9.2
 */

/**
 * A fake {@link AuthApi} that records every refresh token it is called with and
 * returns a scripted rotated Session on the first call, then a second distinct
 * rotated Session on subsequent calls. signOut is never exercised here; if it
 * is called it throws so an accidental dependency surfaces as a failure.
 */
interface RecordingApi extends AuthApi {
  /** The refresh tokens the backend was called with, in order. */
  readonly calls: string[]
}

function createRecordingApi(
  firstRotation: Session,
  secondRotation: Session,
): RecordingApi {
  const calls: string[] = []
  return {
    calls,
    refresh(refreshToken: string): Promise<RefreshResult> {
      calls.push(refreshToken)
      const session = calls.length === 1 ? firstRotation : secondRotation
      return Promise.resolve({ kind: 'success', session })
    },
    signOut() {
      throw new Error('signOut must not be called during refresh rotation')
    },
  }
}

/**
 * Build deterministic deps over a given store and api, with a clock frozen at
 * `nowMs`. The margin is chosen by the caller so `isRefreshRequired` is forced
 * true for the initial Session's expiry.
 */
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

/**
 * Generate three tokens that are pairwise DISTINCT (the initial refresh token,
 * the first rotated refresh token, and the second rotated refresh token) so
 * rotation is observable and the superseded token can never be confused with a
 * rotated one. Distinctness is produced by appending disjoint suffixes.
 */
const distinctTokens: fc.Arbitrary<{
  initialRefresh: string
  firstRefresh: string
  secondRefresh: string
}> = fc
  .record({
    a: fc.string(),
    b: fc.string(),
    c: fc.string(),
  })
  .map(({ a, b, c }) => ({
    initialRefresh: `${a}#initial`,
    firstRefresh: `${b}#first`,
    secondRefresh: `${c}#second`,
  }))

// Access tokens and expiry values; access tokens need only be non-empty.
const rotationInputs = fc.record({
  tokens: distinctTokens,
  initialAccess: fc.string({ minLength: 1 }),
  firstAccess: fc.string({ minLength: 1 }),
  secondAccess: fc.string({ minLength: 1 }),
  // Finite expiry for the rotated sessions (opaque to this property).
  firstExpiresAtMs: fc.integer(),
  secondExpiresAtMs: fc.integer(),
})

describe('SessionManager refresh token rotation (Property 14)', () => {
  // Feature: web-auth-screens, Property 14: Refresh rotates both tokens and discards the superseded refresh token
  // Validates: Requirements 9.2
  it('replaces both stored tokens with the returned values and retains no reference to the superseded refresh token', async () => {
    await fc.assert(
      fc.asyncProperty(rotationInputs, async (inputs) => {
        const {
          tokens,
          initialAccess,
          firstAccess,
          secondAccess,
          firstExpiresAtMs,
          secondExpiresAtMs,
        } = inputs

        // Freeze the clock and set the initial Session's expiry so that
        // isRefreshRequired is TRUE: now >= expiresAtMs - renewalMarginMs.
        // With now = 0 and margin = 60_000, an expiry of 0 satisfies
        // 0 >= 0 - 60_000, forcing a refresh on the first call.
        const nowMs = 0
        const initialSession: Session = {
          accessToken: initialAccess,
          refreshToken: tokens.initialRefresh,
          expiresAtMs: 0,
        }

        // The rotated sessions returned by the backend. Their expiry values are
        // also within the refresh margin at now = 0, so a SECOND call to
        // getAccessTokenForRequest() forces another refresh — letting us prove
        // the backend is re-called with the ROTATED refresh token, never the
        // original superseded one.
        const firstRotation: Session = {
          accessToken: firstAccess,
          refreshToken: tokens.firstRefresh,
          expiresAtMs: Math.min(firstExpiresAtMs, 0),
        }
        const secondRotation: Session = {
          accessToken: secondAccess,
          refreshToken: tokens.secondRefresh,
          expiresAtMs: Math.min(secondExpiresAtMs, 0),
        }

        const store = createInMemorySessionStore()
        const api = createRecordingApi(firstRotation, secondRotation)
        const manager = createSessionManager(depsOver(store, api, nowMs))

        manager.establish(initialSession)

        // First request forces a refresh; the rotated Access_Token is returned.
        const firstResult = await manager.getAccessTokenForRequest()
        expect(firstResult).toEqual({ token: firstRotation.accessToken })

        // The backend was called exactly once, with the ORIGINAL refresh token.
        expect(api.calls).toEqual([tokens.initialRefresh])

        // Both persisted tokens are replaced with the returned values (Req 9.2).
        expect(store.load()).toEqual({
          accessToken: firstRotation.accessToken,
          refreshToken: firstRotation.refreshToken,
          expiresAtMs: firstRotation.expiresAtMs,
        })

        // Second request forces another refresh. The manager must present the
        // ROTATED refresh token; it retains no reference to the superseded one.
        const secondResult = await manager.getAccessTokenForRequest()
        expect(secondResult).toEqual({ token: secondRotation.accessToken })

        // The second backend call used the rotated refresh token, and the
        // superseded original was never presented again.
        expect(api.calls).toEqual([tokens.initialRefresh, tokens.firstRefresh])
        // No call after the first ever presents the superseded original token.
        expect(api.calls.slice(1)).not.toContain(tokens.initialRefresh)

        // Persistence now holds the second rotation's tokens.
        expect(store.load()).toEqual({
          accessToken: secondRotation.accessToken,
          refreshToken: secondRotation.refreshToken,
          expiresAtMs: secondRotation.expiresAtMs,
        })
      }),
      { numRuns: 100 },
    )
  })
})
