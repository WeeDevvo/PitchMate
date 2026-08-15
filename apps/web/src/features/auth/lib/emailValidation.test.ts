import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { validateEmail, EMAIL_MAX_LENGTH } from './emailValidation'

/**
 * Independent reference oracle for the mirrored email policy.
 *
 * This is deliberately implemented with different mechanics than the code under
 * test (it splits on `@` and counts the resulting parts, rather than scanning
 * with `indexOf`) so the property does not merely check `validateEmail` against
 * itself. It encodes the same intended policy and the same failure priority
 * order (empty → too-long → malformed).
 */
type OracleResult =
  | { ok: true; value: string }
  | { ok: false; reason: 'empty' | 'too-long' | 'malformed' }

function oracle(raw: string): OracleResult {
  const value = raw.trim()

  if (value.length === 0) {
    return { ok: false, reason: 'empty' }
  }

  if (value.length > 254) {
    return { ok: false, reason: 'too-long' }
  }

  const parts = value.split('@')
  // Exactly one '@' means exactly two parts after splitting.
  const hasExactlyOneAt = parts.length === 2
  const localPart = hasExactlyOneAt ? parts[0] : ''
  const domain = hasExactlyOneAt ? parts[1] : ''

  const localOk = hasExactlyOneAt && localPart.length > 0
  const domainOk =
    hasExactlyOneAt &&
    domain.length > 0 &&
    domain.split('.').every((label) => label.length > 0)

  if (!localOk || !domainOk) {
    return { ok: false, reason: 'malformed' }
  }

  return { ok: true, value }
}

// --- Generators -------------------------------------------------------------

const ALNUM =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')
const alnumChar = fc.constantFrom(...ALNUM)
const nonEmptyAlnum = fc
  .array(alnumChar, { minLength: 1, maxLength: 12 })
  .map((a) => a.join(''))

// Local-part characters: alphanumerics plus a few common symbols, never '@'.
const localChar = fc.constantFrom(...ALNUM, '.', '+', '-', '_')
const localPart = fc
  .array(localChar, { minLength: 1, maxLength: 20 })
  .map((a) => a.join(''))

// A domain of one-or-more dot-separated, each-non-empty labels.
const domain = fc
  .array(nonEmptyAlnum, { minLength: 1, maxLength: 4 })
  .map((labels) => labels.join('.'))

// 1) Structurally valid emails.
const validEmail = fc
  .tuple(localPart, domain)
  .map(([local, dom]) => `${local}@${dom}`)

// 2) Whitespace-only (and empty) strings.
const wsChar = fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v')
const whitespaceOnly = fc
  .array(wsChar, { minLength: 0, maxLength: 6 })
  .map((a) => a.join(''))

// 3) Zero-'@' strings (random content that never contains '@').
const noAt = fc
  .array(fc.constantFrom(...ALNUM, '.', '-', '_', ' '), {
    minLength: 1,
    maxLength: 24,
  })
  .map((a) => a.join(''))

// 4) Multiple '@' strings.
const multipleAt = fc
  .array(nonEmptyAlnum, { minLength: 3, maxLength: 5 })
  .map((chunks) => chunks.join('@'))

// 5) Empty local part: '@domain'.
const emptyLocal = domain.map((dom) => `@${dom}`)

// 6) Empty domain: 'local@'.
const emptyDomain = localPart.map((local) => `${local}@`)

// 7) Domains with leading / trailing / consecutive dots.
const dodgyDomainEmail = fc
  .tuple(
    localPart,
    domain,
    fc.constantFrom<'leading' | 'trailing' | 'consecutive'>(
      'leading',
      'trailing',
      'consecutive',
    ),
  )
  .map(([local, dom, kind]) => {
    switch (kind) {
      case 'leading':
        return `${local}@.${dom}`
      case 'trailing':
        return `${local}@${dom}.`
      case 'consecutive':
        return `${local}@${dom}..com`
    }
  })

// 8) Over-length candidates (> 254 after trimming). Includes both a
//    no-'@' variant (too-long must win over malformed) and a valid-shaped
//    variant (too-long must win over ok).
const overLength = fc.oneof(
  fc.integer({ min: 255, max: 400 }).map((n) => 'a'.repeat(n)),
  fc
    .integer({ min: 250, max: 400 })
    .map((n) => `${'a'.repeat(n)}@example.com`),
)

// 9) Fully arbitrary strings — hits stray '@' counts, unicode, etc.
const arbitrary = fc.oneof(
  fc.string({ maxLength: 300 }),
  fc.string({ unit: 'grapheme', maxLength: 60 }),
)

// Base candidate space across all categories.
const baseCandidate = fc.oneof(
  { weight: 4, arbitrary: validEmail },
  { weight: 1, arbitrary: whitespaceOnly },
  { weight: 2, arbitrary: noAt },
  { weight: 2, arbitrary: multipleAt },
  { weight: 1, arbitrary: emptyLocal },
  { weight: 1, arbitrary: emptyDomain },
  { weight: 2, arbitrary: dodgyDomainEmail },
  { weight: 2, arbitrary: overLength },
  { weight: 3, arbitrary: arbitrary },
)

// Optionally wrap any candidate with leading/trailing whitespace so the
// trimming behaviour is exercised on every category.
const candidate = fc
  .tuple(
    fc.array(wsChar, { minLength: 0, maxLength: 4 }).map((a) => a.join('')),
    baseCandidate,
    fc.array(wsChar, { minLength: 0, maxLength: 4 }).map((a) => a.join('')),
  )
  .map(([lead, body, trail]) => `${lead}${body}${trail}`)

// --- Property ---------------------------------------------------------------

describe('validateEmail', () => {
  // Feature: web-auth-screens, Property 1: Email validation matches the mirrored policy
  // Validates: Requirements 2.4, 3.3, 5.3, 15.7
  it('matches the mirrored policy for any candidate string', () => {
    fc.assert(
      fc.property(candidate, (raw) => {
        const expected = oracle(raw)
        const actual = validateEmail(raw)

        expect(actual.ok).toBe(expected.ok)

        if (expected.ok && actual.ok) {
          // On success the reported value is the trimmed input.
          expect(actual.value).toBe(expected.value)
          expect(actual.value).toBe(raw.trim())
        } else if (!expected.ok && !actual.ok) {
          // On failure the reason respects the empty → too-long → malformed
          // priority order encoded by the oracle.
          expect(actual.reason).toBe(expected.reason)
        }
      }),
      { numRuns: 300 },
    )
  })

  // A handful of example-based checks pin down the boundaries and the
  // failure-priority ordering that the property covers in aggregate.
  it('treats a trimmed length of exactly EMAIL_MAX_LENGTH as valid, one more as too-long', () => {
    const domainSuffix = '@e.io' // 5 chars
    const localLen = EMAIL_MAX_LENGTH - domainSuffix.length
    const atMax = `${'a'.repeat(localLen)}${domainSuffix}`
    expect(atMax.length).toBe(EMAIL_MAX_LENGTH)
    expect(validateEmail(atMax)).toEqual({ ok: true, value: atMax })

    const overMax = `${'a'.repeat(localLen + 1)}${domainSuffix}`
    expect(validateEmail(overMax)).toEqual({ ok: false, reason: 'too-long' })
  })

  it('reports empty before too-long and malformed for whitespace-only input', () => {
    expect(validateEmail('   \t\n ')).toEqual({ ok: false, reason: 'empty' })
  })

  it('reports too-long before malformed when a long string also has bad shape', () => {
    expect(validateEmail('a'.repeat(300))).toEqual({
      ok: false,
      reason: 'too-long',
    })
  })

  it('reports malformed for common bad shapes', () => {
    for (const bad of [
      'plainaddress',
      'a@@b.com',
      '@domain.com',
      'local@',
      'local@.com',
      'local@com.',
      'local@ex..com',
    ]) {
      expect(validateEmail(bad)).toEqual({ ok: false, reason: 'malformed' })
    }
  })

  it('accepts a well-formed address and returns the trimmed value', () => {
    expect(validateEmail('  user.name+tag@sub.example.com  ')).toEqual({
      ok: true,
      value: 'user.name+tag@sub.example.com',
    })
  })
})
