/**
 * Property test for the auth Api_Client middleware (task 9.3).
 *
 * Property 13: Authenticated requests carry the current access token.
 * For any established Session, an authenticated Api_Client request carries the
 * current Access_Token as its bearer credential (`Authorization: Bearer
 * <token>`); and when the token source yields no usable token (error
 * outcomes), no credential is attached.
 *
 * This exercises the middleware end-to-end through a real generated
 * `openapi-fetch` client (wired via `createAuthenticatedApiClient`) with an
 * injected recording `fetch`, so the assertion is made on the exact outgoing
 * request the transport would send. The example-based branch coverage lives in
 * `authMiddleware.test.ts`; this file is the dedicated, generator-driven
 * property at >= 100 fast-check iterations.
 *
 * Validates: Requirements 8.2
 */

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'

import {
  AUTHORIZATION_HEADER,
  bearerCredential,
  createAuthenticatedApiClient,
  type BearerTokenSource,
} from './authMiddleware'

// --- Recording transport ----------------------------------------------------

interface RecordedRequest {
  readonly url: string
  readonly method: string
  readonly authorization: string | null
}

/**
 * An injectable `fetch` that records the method, URL, and Authorization header
 * of every outgoing request and returns an empty `204` so the client resolves.
 */
function recordingFetch(): {
  fetch: typeof fetch
  requests: RecordedRequest[]
} {
  const requests: RecordedRequest[] = []
  const impl = (async (input: Request): Promise<Response> => {
    requests.push({
      url: input.url,
      method: input.method,
      authorization: input.headers.get(AUTHORIZATION_HEADER),
    })
    return new Response(null, { status: 204 })
  }) as unknown as typeof fetch

  return { fetch: impl, requests }
}

/** A fixed-outcome {@link BearerTokenSource} that always yields `{ token }`. */
function tokenSource(token: string): BearerTokenSource {
  return {
    getAccessTokenForRequest() {
      return Promise.resolve({ token })
    },
  }
}

// --- Generators -------------------------------------------------------------

// The RFC 6750 `token68` alphabet — the realistic Access_Token character space
// (base64url plus the padding-friendly set). Constrains generation to what an
// Access_Token actually looks like while staying valid in an HTTP header value.
const tokenChars =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~+/'

// A JWT-shaped token: three non-empty base64url-ish segments joined by dots —
// the shape the backend actually issues.
const tokenChar = fc.constantFrom(...tokenChars.split(''))

const segment = (maxLength: number): fc.Arbitrary<string> =>
  fc.string({ unit: tokenChar, minLength: 1, maxLength })

const jwtLikeToken: fc.Arbitrary<string> = fc
  .tuple(segment(40), segment(80), segment(43))
  .map(([header, payload, signature]) => `${header}.${payload}.${signature}`)

// A broader token: any non-empty run of visible ASCII (VCHAR, 0x21..0x7E),
// which is valid verbatim in an HTTP header value and free of the leading /
// trailing whitespace that `Headers` would trim.
const visibleAsciiToken: fc.Arbitrary<string> = fc
  .array(fc.integer({ min: 0x21, max: 0x7e }), { minLength: 1, maxLength: 120 })
  .map((codes) => String.fromCharCode(...codes))

const anyNonEmptyToken = fc.oneof(
  { weight: 3, arbitrary: jwtLikeToken },
  { weight: 2, arbitrary: visibleAsciiToken },
)

// --- Property ---------------------------------------------------------------

describe('createAuthenticatedApiClient — Property 13 (bearer-token attachment)', () => {
  // Feature: web-auth-screens, Property 13: Authenticated requests carry the current access token
  // Validates: Requirements 8.2
  it('carries the exact current access token as the bearer credential, verbatim, without altering the request', async () => {
    await fc.assert(
      fc.asyncProperty(anyNonEmptyToken, async (token) => {
        const { fetch, requests } = recordingFetch()
        const client = createAuthenticatedApiClient(tokenSource(token), {
          baseUrl: 'https://api.test',
          fetch,
        })

        await client.POST('/auth/sign-out', { body: { refreshToken: 'r' } })

        // Exactly one request went out through the client.
        expect(requests).toHaveLength(1)
        const sent = requests[0]

        // The bearer credential is present and carries the exact token,
        // byte-for-byte, behind the `Bearer ` scheme prefix.
        expect(sent?.authorization).toBe(bearerCredential(token))
        expect(sent?.authorization).toBe(`Bearer ${token}`)

        // The token round-trips verbatim: stripping the scheme prefix
        // recovers the original token unchanged.
        expect(sent?.authorization?.slice('Bearer '.length)).toBe(token)

        // The credential attachment leaves the request URL and method
        // untouched.
        expect(sent?.url).toBe('https://api.test/auth/sign-out')
        expect(sent?.method).toBe('POST')
      }),
      { numRuns: 200 },
    )
  })

  // Feature: web-auth-screens, Property 13: Authenticated requests carry the current access token
  // Validates: Requirements 8.2
  it('attaches no credential when the token source yields an error outcome, leaving the request otherwise intact', async () => {
    const errorOutcome = fc.constantFrom(
      { error: 'refresh-failed' } as const,
      { error: 'unauthenticated' } as const,
    )

    await fc.assert(
      fc.asyncProperty(errorOutcome, async (outcome) => {
        const { fetch, requests } = recordingFetch()
        const source: BearerTokenSource = {
          getAccessTokenForRequest() {
            return Promise.resolve(outcome)
          },
        }
        const client = createAuthenticatedApiClient(source, {
          baseUrl: 'https://api.test',
          fetch,
        })

        await client.POST('/auth/sign-out', { body: { refreshToken: 'r' } })

        expect(requests).toHaveLength(1)
        const sent = requests[0]

        // No usable token => no credential attached.
        expect(sent?.authorization).toBeNull()

        // The request still goes out to the same URL and method.
        expect(sent?.url).toBe('https://api.test/auth/sign-out')
        expect(sent?.method).toBe('POST')
      }),
      { numRuns: 100 },
    )
  })
})
