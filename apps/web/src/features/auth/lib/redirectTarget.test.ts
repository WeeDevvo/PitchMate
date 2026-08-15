import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  resolveRedirectTarget,
  type RedirectResolutionConfig,
} from './redirectTarget'

/**
 * Shared fixed configuration for the redirect-resolution property tests.
 *
 * `/app` is the default authenticated route; the auth routes are the paths that
 * must never be used as a post-auth destination. `maxLength` mirrors the
 * production ceiling. Task 3.5 (Property 5) appends to this same file and reuses
 * this config and the safe-path generators below.
 */
const CONFIG: RedirectResolutionConfig = {
  defaultAuthenticatedRoute: '/app',
  authRoutePaths: [
    '/signup',
    '/login',
    '/reset-password',
    '/reset-password/confirm',
    '/verify-email',
  ],
  maxLength: 2048,
}

// --- Generators -------------------------------------------------------------

// Path-safe characters that percent-decode to themselves (no `%`, no
// backslash, no control chars, no `?`/`#` delimiters). A candidate built purely
// from these is unchanged by `decodeURIComponent`, so the raw and decoded forms
// are identical and both pass the same-origin in-app path checks.
const SAFE_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~'.split('')
const safeChar = fc.constantFrom(...SAFE_CHARS)

// A non-empty path segment. Kept non-empty so the assembled path can never
// begin `//` (which would be a protocol-relative, cross-origin value).
const segment = fc
  .array(safeChar, { minLength: 1, maxLength: 12 })
  .map((chars) => chars.join(''))

// A same-origin in-app path portion: a single leading `/` followed by one or
// more `/`-joined non-empty segments (e.g. `/squads/123`).
const pathPortion = fc
  .array(segment, { minLength: 1, maxLength: 5 })
  .map((segs) => `/${segs.join('/')}`)

// An optional `?key=value&...` query string.
const queryPair = fc
  .tuple(segment, segment)
  .map(([key, value]) => `${key}=${value}`)
const queryString = fc
  .array(queryPair, { minLength: 1, maxLength: 3 })
  .map((pairs) => `?${pairs.join('&')}`)
const optionalQuery = fc.option(queryString, { nil: '' })

// An optional `#fragment`.
const fragment = fc
  .array(safeChar, { minLength: 1, maxLength: 10 })
  .map((chars) => `#${chars.join('')}`)
const optionalFragment = fc.option(fragment, { nil: '' })

// A SAFE same-origin in-app path, optionally carrying a query string and/or a
// fragment (e.g. `/squads/123?tab=stats#top`). The final filter drops the rare
// case where the random path portion collides exactly with a configured auth
// route, since those are covered by Property 5, not the round-trip property.
const safeInAppPath = fc
  .tuple(pathPortion, optionalQuery, optionalFragment)
  .map(([path, query, frag]) => `${path}${query}${frag}`)
  .filter(
    (candidate) =>
      !CONFIG.authRoutePaths.includes(candidate.split(/[?#]/, 1)[0]),
  )

// --- Property 4 -------------------------------------------------------------

describe('resolveRedirectTarget', () => {
  // Feature: web-auth-screens, Property 4: Safe redirect targets are preserved unchanged (round-trip)
  // Validates: Requirements 11.1, 15.3
  it('returns any safe same-origin in-app path unchanged', () => {
    fc.assert(
      fc.property(safeInAppPath, (path) => {
        expect(resolveRedirectTarget(path, CONFIG)).toBe(path)
      }),
      { numRuns: 200 },
    )
  })

  // Example-based checks pinning representative safe paths returned unchanged.
  it('preserves representative safe paths unchanged', () => {
    for (const path of [
      '/app',
      '/squads/123',
      '/squads/123?tab=stats#top',
      '/squads/abc/players',
      '/profile?ref=home',
      '/a/b/c#section',
    ]) {
      expect(resolveRedirectTarget(path, CONFIG)).toBe(path)
    }
  })
})

// --- Property 5 generators --------------------------------------------------

// A hostname-like value assembled from safe segments (e.g. `evil.com`). Used to
// synthesise cross-origin destinations for the unsafe categories below.
const host = fc
  .array(segment, { minLength: 1, maxLength: 3 })
  .map((parts) => parts.join('.'))

// Absolute URLs (`http://…`, `https://…`, …). Rejected because they do not
// begin with a single `/`.
const absoluteUrl = fc
  .tuple(fc.constantFrom('http', 'https', 'ftp', 'ws'), host, optionalQuery)
  .map(([scheme, h, query]) => `${scheme}://${h}/path${query}`)

// Arbitrary `scheme:…` values, including the classic `javascript:` XSS vector.
// Rejected because they do not begin with `/`.
const schemeValue = fc
  .tuple(
    fc.constantFrom('javascript', 'data', 'mailto', 'tel', 'file', 'custom'),
    fc.array(safeChar, { minLength: 1, maxLength: 20 }).map((c) => c.join('')),
  )
  .map(([scheme, rest]) => `${scheme}:${rest}`)

// Protocol-relative URLs (`//evil.com`) — cross-origin. Rejected by the `//`
// check.
const protocolRelative = fc
  .tuple(host, fc.option(pathPortion, { nil: '' }))
  .map(([h, path]) => `//${h}${path}`)

// Over-length candidates (> maxLength). A safe-looking path padded past the
// configured ceiling; rejected on length alone.
const overLength = fc
  .integer({ min: CONFIG.maxLength + 1, max: CONFIG.maxLength + 200 })
  .map((len) => `/${'a'.repeat(len - 1)}`)

// Undecodable candidates: malformed percent-encoding that makes
// `decodeURIComponent` throw. All begin with `/` so the failure is provably the
// decode step, not the leading-slash check.
const undecodable = fc.constantFrom(
  '/%',
  '/%E0%A4%A',
  '/%G0',
  '/%%',
  '/path%',
  '/%2',
  '/foo%zz',
)

// Backslash paths (`/\evil.com`). Browsers may normalise `\` to `/`, so these
// are rejected.
const backslashPath = host.map((h) => `/\\${h}`)

// Control characters (NUL, tab, CR, LF, …) embedded in an otherwise safe path.
// Browsers may strip these, changing the destination, so they are rejected.
const controlChar = fc.constantFrom(
  '\u0000',
  '\u0009',
  '\u000A',
  '\u000D',
  '\u001F',
  '\u007F',
)
const controlCharPath = fc
  .tuple(pathPortion, controlChar, pathPortion)
  .map(([a, ctrl, b]) => `${a}${ctrl}${b}`)

// Bare relative paths that do not begin with `/` (e.g. `foo/bar`). Rejected by
// the leading-slash requirement.
const bareRelative = fc
  .array(segment, { minLength: 1, maxLength: 4 })
  .map((segs) => segs.join('/'))

// Percent-encoded protocol-relative values whose RAW form passes the
// same-origin check (single leading `/`, then `%…`) but whose DECODED form is a
// protocol-relative cross-origin URL. `/%2Fevil.com` decodes to `//evil.com`;
// `/%2F%2Fevil.com` decodes to `///evil.com`. These specifically exercise the
// decoded-form check in the implementation.
const encodedProtocolRelative = fc.oneof(
  host.map((h) => `/%2F${h}`),
  host.map((h) => `/%2F%2F${h}`),
)

// Any unsafe *string* candidate.
const unsafeStringCandidate = fc.oneof(
  absoluteUrl,
  schemeValue,
  protocolRelative,
  overLength,
  undecodable,
  backslashPath,
  controlCharPath,
  bareRelative,
  encodedProtocolRelative,
)

// Absent candidates: null, undefined, and the empty string.
const absentCandidate = fc.constantFrom<string | null | undefined>(
  null,
  undefined,
  '',
)

// Any unsafe or absent candidate.
const unsafeOrAbsentCandidate = fc.oneof(
  unsafeStringCandidate,
  absentCandidate,
)

// Candidates that resolve to a configured auth route, optionally carrying a
// query string and/or fragment (e.g. `/login?next=/app#top`). The path portion
// still matches an auth route, so these must fall back.
const authRouteCandidate = fc
  .tuple(
    fc.constantFrom(...CONFIG.authRoutePaths),
    optionalQuery,
    optionalFragment,
  )
  .map(([path, query, frag]) => `${path}${query}${frag}`)

// Truly arbitrary input for the universal safety property: arbitrary strings,
// null/undefined, and every category above.
const anyCandidate = fc.oneof(
  fc.string(),
  fc.constantFrom<string | null | undefined>(null, undefined),
  safeInAppPath,
  unsafeStringCandidate,
  authRouteCandidate,
)

// --- Property 5 -------------------------------------------------------------

// Feature: web-auth-screens, Property 5: Unsafe or absent redirect targets fall back to the default route
// Validates: Requirements 11.2, 11.3, 11.4, 11.5, 15.4
describe('resolveRedirectTarget — unsafe/absent fallback (Property 5)', () => {
  it('falls back to the default route for unsafe or absent candidates', () => {
    fc.assert(
      fc.property(unsafeOrAbsentCandidate, (candidate) => {
        expect(resolveRedirectTarget(candidate, CONFIG)).toBe(
          CONFIG.defaultAuthenticatedRoute,
        )
      }),
      { numRuns: 300 },
    )
  })

  it('falls back for candidates resolving to an authentication route', () => {
    fc.assert(
      fc.property(authRouteCandidate, (candidate) => {
        expect(resolveRedirectTarget(candidate, CONFIG)).toBe(
          CONFIG.defaultAuthenticatedRoute,
        )
      }),
      { numRuns: 300 },
    )
  })

  // Universal safety invariant: for ANY input whatsoever, the output is either a
  // safe same-origin in-app path (leading single `/`, never `//`) or exactly the
  // default route, and is never a cross-origin destination.
  it('only ever returns a safe same-origin in-app path or the default route', () => {
    fc.assert(
      fc.property(anyCandidate, (candidate) => {
        const result = resolveRedirectTarget(candidate, CONFIG)
        expect(typeof result).toBe('string')

        const isDefault = result === CONFIG.defaultAuthenticatedRoute
        const isSafeInAppPath =
          result.startsWith('/') && !result.startsWith('//')

        expect(isDefault || isSafeInAppPath).toBe(true)
        // Never a protocol-relative / cross-origin destination.
        expect(result.startsWith('//')).toBe(false)
      }),
      { numRuns: 300 },
    )
  })

  // Example-based checks pinning representative unsafe inputs to the default
  // route, one per rejection category.
  it('maps representative unsafe inputs to the default route', () => {
    const unsafeExamples: (string | null | undefined)[] = [
      null,
      undefined,
      '',
      'http://evil.com',
      'https://evil.com/app',
      'javascript:alert(1)',
      'data:text/html,<script>',
      'ftp://host/x',
      '//evil.com',
      '/\\evil.com',
      'foo/bar',
      'relative/path',
      '/%',
      '/%E0%A4%A',
      '/%G0',
      '/%2Fevil.com',
      '/%2F%2Fevil.com',
      `/${'a'.repeat(2049)}`,
      '/foo\tbar',
      '/foo\nbar',
    ]
    for (const candidate of unsafeExamples) {
      expect(resolveRedirectTarget(candidate, CONFIG)).toBe(
        CONFIG.defaultAuthenticatedRoute,
      )
    }
  })

  // Each configured auth route (and query/fragment variants) falls back.
  it('maps each authentication route to the default route', () => {
    for (const authPath of CONFIG.authRoutePaths) {
      expect(resolveRedirectTarget(authPath, CONFIG)).toBe(
        CONFIG.defaultAuthenticatedRoute,
      )
      expect(resolveRedirectTarget(`${authPath}?next=/app`, CONFIG)).toBe(
        CONFIG.defaultAuthenticatedRoute,
      )
      expect(resolveRedirectTarget(`${authPath}#frag`, CONFIG)).toBe(
        CONFIG.defaultAuthenticatedRoute,
      )
    }
  })
})
