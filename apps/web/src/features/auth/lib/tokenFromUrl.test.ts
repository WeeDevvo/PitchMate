import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { extractToken } from './tokenFromUrl'

/**
 * Independent reference oracle for `token` extraction from a search string.
 *
 * This is deliberately implemented with different mechanics than the code under
 * test. `extractToken` delegates to the `URLSearchParams` API; the oracle
 * instead performs the `application/x-www-form-urlencoded` parse by hand —
 * stripping a single leading `?`, splitting on `&`, splitting each pair on the
 * first `=`, mapping `+` to space, and percent-decoding via `decodeURIComponent`
 * (a different API from `URLSearchParams`). It returns the first `token` pair's
 * decoded value, or null when that value is empty, the parameter is absent, or
 * the search string is empty — encoding the same intended contract.
 */
function decodePart(part: string): string {
  // '+' denotes a space in form-urlencoded bodies; then percent-decode.
  return decodeURIComponent(part.replace(/\+/g, ' '))
}

function extractTokenOracle(search: string): string | null {
  let body = search
  // URLSearchParams strips a single leading '?'.
  if (body.startsWith('?')) {
    body = body.slice(1)
  }
  if (body.length === 0) {
    return null
  }

  for (const pair of body.split('&')) {
    if (pair.length === 0) {
      continue
    }
    const eq = pair.indexOf('=')
    const rawName = eq === -1 ? pair : pair.slice(0, eq)
    const rawValue = eq === -1 ? '' : pair.slice(eq + 1)

    // `.get('token')` returns the value of the first matching pair.
    if (decodePart(rawName) === 'token') {
      const value = decodePart(rawValue)
      return value.length === 0 ? null : value
    }
  }

  return null
}

// --- Generators -------------------------------------------------------------

// Grapheme strings avoid lone surrogates, so encodeURIComponent never throws.
const tokenValue = fc.string({ unit: 'grapheme', minLength: 1, maxLength: 20 })
const anyValue = fc.string({ unit: 'grapheme', maxLength: 20 })

// Other parameter keys, none of which is 'token'.
const otherKey = fc.constantFrom(
  'redirect',
  'code',
  'q',
  'id',
  'next',
  'foo',
  'bar',
  'ref',
)

// A non-token parameter; both key and value are percent-encoded so any
// embedded '&', '=', '%', space, or unicode round-trips cleanly.
const otherParam = fc
  .tuple(otherKey, anyValue)
  .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)

// A token parameter carrying an arbitrary non-empty value. Encoding the raw
// value lets the property assert the decoded round-trip: extractToken must
// return exactly the raw value back.
const tokenParam = tokenValue.map((v) => `token=${encodeURIComponent(v)}`)

function assemble(parts: string[], leadingQ: boolean): string {
  return (leadingQ ? '?' : '') + parts.join('&')
}

// 1) A token param with other params before and/or after it, optional '?'.
const presentWithOthers = fc
  .record({
    before: fc.array(otherParam, { maxLength: 3 }),
    token: tokenParam,
    after: fc.array(otherParam, { maxLength: 3 }),
    q: fc.boolean(),
  })
  .map(({ before, token, after, q }) =>
    assemble([...before, token, ...after], q),
  )

// 2) An empty token: 'token=' (empty value) or 'token' (no value at all).
const emptyToken = fc
  .record({
    before: fc.array(otherParam, { maxLength: 3 }),
    form: fc.constantFrom('token=', 'token'),
    after: fc.array(otherParam, { maxLength: 3 }),
    q: fc.boolean(),
  })
  .map(({ before, form, after, q }) => assemble([...before, form, ...after], q))

// 3) No token param at all (possibly an empty search string).
const noToken = fc
  .record({
    others: fc.array(otherParam, { maxLength: 5 }),
    q: fc.boolean(),
  })
  .map(({ others, q }) => assemble(others, q))

// 4) Multiple token params — the first occurrence wins, even when it is empty.
const multipleToken = fc
  .record({
    first: fc.oneof(fc.constant('token='), fc.constant('token'), tokenParam),
    rest: fc.array(fc.oneof(tokenParam, otherParam), {
      minLength: 1,
      maxLength: 3,
    }),
    q: fc.boolean(),
  })
  .map(({ first, rest, q }) => assemble([first, ...rest], q))

// 5) Arbitrary search strings. The alphabet excludes '%' so both the code and
//    the oracle decode identically (invalid percent-escapes are the one place
//    URLSearchParams and decodeURIComponent diverge, and are ruled out here);
//    it includes structural chars and the letters of 'token' so token pairs
//    arise by chance.
const arbitraryChar = fc.constantFrom(
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789&=+?._- tokn'.split(
    '',
  ),
)
const arbitrarySearch = fc
  .array(arbitraryChar, { maxLength: 40 })
  .map((a) => a.join(''))

// Full candidate space across all categories.
const search = fc.oneof(
  { weight: 5, arbitrary: presentWithOthers },
  { weight: 2, arbitrary: emptyToken },
  { weight: 2, arbitrary: noToken },
  { weight: 3, arbitrary: multipleToken },
  { weight: 3, arbitrary: arbitrarySearch },
)

// --- Property ---------------------------------------------------------------

describe('extractToken', () => {
  // Feature: web-auth-screens, Property 3: URL token extraction
  // Validates: Requirements 1.5, 1.6, 6.4, 7.7, 15.1
  it('returns the decoded token when present and non-empty, else null', () => {
    fc.assert(
      fc.property(search, (raw) => {
        const actual = extractToken(raw)

        // Matches the independent form-urlencoded oracle for every input.
        expect(actual).toBe(extractTokenOracle(raw))

        // Whenever a value is returned it is a genuinely non-empty string.
        if (actual !== null) {
          expect(actual.length).toBeGreaterThan(0)
        }
      }),
      { numRuns: 300 },
    )
  })

  // A round-trip property: a non-empty raw value encoded into the query string
  // is always recovered verbatim, exercising percent-decoding directly.
  it('recovers any non-empty raw token value after decoding (round-trip)', () => {
    fc.assert(
      fc.property(tokenValue, (rawValue) => {
        const supplied = `?token=${encodeURIComponent(rawValue)}`
        expect(extractToken(supplied)).toBe(rawValue)
      }),
      { numRuns: 300 },
    )
  })

  // --- Example-based boundary checks ----------------------------------------

  it('percent-decodes the token value', () => {
    expect(extractToken('?token=hello%20world')).toBe('hello world')
    expect(extractToken(`?token=${encodeURIComponent('café✓/?&=')}`)).toBe(
      'café✓/?&=',
    )
  })

  it("decodes '+' in the token value as a space", () => {
    expect(extractToken('token=a+b')).toBe('a b')
  })

  it('tolerates search strings with and without a leading question mark', () => {
    expect(extractToken('token=abc')).toBe('abc')
    expect(extractToken('?token=abc')).toBe('abc')
  })

  it('returns the token when it sits alongside other parameters', () => {
    expect(extractToken('?foo=1&token=abc&bar=2')).toBe('abc')
  })

  it('returns the first token value when the parameter repeats', () => {
    expect(extractToken('token=first&token=second')).toBe('first')
    expect(extractToken('token=&token=second')).toBeNull()
  })

  it('returns null when the token is empty', () => {
    expect(extractToken('?token=')).toBeNull()
    expect(extractToken('token=')).toBeNull()
    expect(extractToken('token')).toBeNull()
  })

  it('returns null when the token parameter is absent', () => {
    expect(extractToken('')).toBeNull()
    expect(extractToken('?')).toBeNull()
    expect(extractToken('?foo=bar&baz=qux')).toBeNull()
  })

  it('reads only the supplied search string, never window.location', () => {
    // Point window.location at a token that must never leak into the result.
    window.history.replaceState(null, '', '/?token=from-window-location')
    expect(window.location.search).toContain('from-window-location')

    try {
      // The returned value derives solely from the argument.
      expect(extractToken('?token=from-argument')).toBe('from-argument')
      // An empty argument yields null even though window.location has a token.
      expect(extractToken('')).toBeNull()
    } finally {
      window.history.replaceState(null, '', '/')
    }
  })
})
