import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  isRefreshRequired,
  clampRenewalMargin,
  RENEWAL_MARGIN_DEFAULT_MS,
  RENEWAL_MARGIN_MIN_MS,
  RENEWAL_MARGIN_MAX_MS,
  type RefreshDecisionInput,
} from './accessTokenExpiry'

/**
 * Independent reference oracle for the refresh decision.
 *
 * Deliberately computed with different mechanics than the code under test: it
 * derives the refresh boundary (`expiresAtMs - renewalMarginMs`) and then uses
 * a strict "before the boundary" check, negating it — rather than reusing the
 * `>=` comparison directly — so the property does not merely check
 * `isRefreshRequired` against itself. "refresh required" is the logical
 * complement of "strictly before the boundary".
 */
function refreshOracle(input: RefreshDecisionInput): boolean {
  const boundary = input.expiresAtMs - input.renewalMarginMs
  const strictlyBeforeBoundary = input.nowMs < boundary
  return !strictlyBeforeBoundary
}

/** Independent reference oracle for the margin clamp. */
function clampOracle(marginMs: number): number {
  return Math.min(
    RENEWAL_MARGIN_MAX_MS,
    Math.max(RENEWAL_MARGIN_MIN_MS, marginMs),
  )
}

// --- Generators -------------------------------------------------------------

// A broad integer range covering negatives, zero, and large epoch-like values.
const anyInstant = fc.integer({ min: -8_640_000_000, max: 8_640_000_000 })

// Renewal margins constrained to the accepted band [15_000, 300_000].
const inBandMargin = fc.integer({
  min: RENEWAL_MARGIN_MIN_MS,
  max: RENEWAL_MARGIN_MAX_MS,
})

// 1) Broadly-spread inputs: nowMs and expiresAtMs sampled independently.
const spreadInput: fc.Arbitrary<RefreshDecisionInput> = fc
  .tuple(anyInstant, anyInstant, inBandMargin)
  .map(([expiresAtMs, nowMs, renewalMarginMs]) => ({
    expiresAtMs,
    nowMs,
    renewalMarginMs,
  }))

// 2) Boundary-clustered inputs: nowMs sits within a few ms of the exact
//    boundary (expiresAtMs - renewalMarginMs) to exercise the `>=` edge.
const boundaryInput: fc.Arbitrary<RefreshDecisionInput> = fc
  .tuple(anyInstant, inBandMargin, fc.integer({ min: -3, max: 3 }))
  .map(([expiresAtMs, renewalMarginMs, offset]) => ({
    expiresAtMs,
    nowMs: expiresAtMs - renewalMarginMs + offset,
    renewalMarginMs,
  }))

const refreshInput = fc.oneof(
  { weight: 3, arbitrary: spreadInput },
  { weight: 4, arbitrary: boundaryInput },
)

// Margin candidates: below-min, above-max, and in-range values.
const marginCandidate = fc.oneof(
  { weight: 2, arbitrary: fc.integer({ min: -1_000_000, max: 14_999 }) },
  { weight: 3, arbitrary: inBandMargin },
  { weight: 2, arbitrary: fc.integer({ min: 300_001, max: 10_000_000 }) },
)

// --- Properties -------------------------------------------------------------

describe('isRefreshRequired', () => {
  // Feature: web-auth-screens, Property 6: Access-token refresh decision
  // Validates: Requirements 9.1, 9.6, 15.5
  it('matches the boundary condition nowMs >= expiresAtMs - renewalMarginMs', () => {
    fc.assert(
      fc.property(refreshInput, (input) => {
        const expected = refreshOracle(input)
        const actual = isRefreshRequired(input)

        expect(actual).toBe(expected)
        // Cross-check against the requirement wording directly.
        expect(actual).toBe(
          input.nowMs >= input.expiresAtMs - input.renewalMarginMs,
        )
      }),
      { numRuns: 300 },
    )
  })

  it('uses only the injected nowMs and never the wall clock', () => {
    // Freezing an input and mutating Date.now must not change the decision:
    // a fixed input always yields the same result regardless of real time.
    const nowSpy = () => 9_999_999_999
    const originalDateNow = Date.now
    Date.now = nowSpy
    try {
      const input: RefreshDecisionInput = {
        expiresAtMs: 1_000_000,
        nowMs: 500_000,
        renewalMarginMs: RENEWAL_MARGIN_DEFAULT_MS,
      }
      // nowMs (500_000) < 1_000_000 - 60_000 => no refresh, independent of Date.now.
      expect(isRefreshRequired(input)).toBe(false)
    } finally {
      Date.now = originalDateNow
    }
  })

  it('is exactly true at the boundary, false one ms before, true one ms after', () => {
    const expiresAtMs = 1_700_000_000_000
    const renewalMarginMs = RENEWAL_MARGIN_DEFAULT_MS
    const boundary = expiresAtMs - renewalMarginMs

    expect(
      isRefreshRequired({ expiresAtMs, nowMs: boundary, renewalMarginMs }),
    ).toBe(true)
    expect(
      isRefreshRequired({ expiresAtMs, nowMs: boundary - 1, renewalMarginMs }),
    ).toBe(false)
    expect(
      isRefreshRequired({ expiresAtMs, nowMs: boundary + 1, renewalMarginMs }),
    ).toBe(true)
  })

  it('requires refresh once now is at or past expiry, and not long before', () => {
    const expiresAtMs = 2_000_000
    const renewalMarginMs = RENEWAL_MARGIN_MIN_MS

    // Well past expiry: certainly refresh.
    expect(
      isRefreshRequired({ expiresAtMs, nowMs: expiresAtMs + 1, renewalMarginMs }),
    ).toBe(true)
    // Exactly at expiry: refresh.
    expect(
      isRefreshRequired({ expiresAtMs, nowMs: expiresAtMs, renewalMarginMs }),
    ).toBe(true)
    // Far before the margin window: no refresh.
    expect(
      isRefreshRequired({
        expiresAtMs,
        nowMs: expiresAtMs - renewalMarginMs - 1,
        renewalMarginMs,
      }),
    ).toBe(false)
  })
})

describe('clampRenewalMargin', () => {
  // Feature: web-auth-screens, Property 6: Access-token refresh decision
  // Validates: Requirements 9.1, 9.6, 15.5
  it('always returns a value within [RENEWAL_MARGIN_MIN_MS, RENEWAL_MARGIN_MAX_MS]', () => {
    fc.assert(
      fc.property(marginCandidate, (marginMs) => {
        const actual = clampRenewalMargin(marginMs)

        expect(actual).toBe(clampOracle(marginMs))
        expect(actual).toBeGreaterThanOrEqual(RENEWAL_MARGIN_MIN_MS)
        expect(actual).toBeLessThanOrEqual(RENEWAL_MARGIN_MAX_MS)

        if (marginMs < RENEWAL_MARGIN_MIN_MS) {
          expect(actual).toBe(RENEWAL_MARGIN_MIN_MS)
        } else if (marginMs > RENEWAL_MARGIN_MAX_MS) {
          expect(actual).toBe(RENEWAL_MARGIN_MAX_MS)
        } else {
          expect(actual).toBe(marginMs)
        }
      }),
      { numRuns: 300 },
    )
  })

  it('clamps the exact boundaries and passes the exported constants through', () => {
    expect(clampRenewalMargin(RENEWAL_MARGIN_MIN_MS)).toBe(RENEWAL_MARGIN_MIN_MS)
    expect(clampRenewalMargin(RENEWAL_MARGIN_MAX_MS)).toBe(RENEWAL_MARGIN_MAX_MS)
    expect(clampRenewalMargin(RENEWAL_MARGIN_DEFAULT_MS)).toBe(
      RENEWAL_MARGIN_DEFAULT_MS,
    )

    // Just outside each edge clamps to the edge; just inside is unchanged.
    expect(clampRenewalMargin(RENEWAL_MARGIN_MIN_MS - 1)).toBe(
      RENEWAL_MARGIN_MIN_MS,
    )
    expect(clampRenewalMargin(RENEWAL_MARGIN_MIN_MS + 1)).toBe(
      RENEWAL_MARGIN_MIN_MS + 1,
    )
    expect(clampRenewalMargin(RENEWAL_MARGIN_MAX_MS + 1)).toBe(
      RENEWAL_MARGIN_MAX_MS,
    )
    expect(clampRenewalMargin(RENEWAL_MARGIN_MAX_MS - 1)).toBe(
      RENEWAL_MARGIN_MAX_MS - 1,
    )

    // Extreme out-of-band inputs clamp to the nearest edge.
    expect(clampRenewalMargin(Number.NEGATIVE_INFINITY)).toBe(
      RENEWAL_MARGIN_MIN_MS,
    )
    expect(clampRenewalMargin(Number.POSITIVE_INFINITY)).toBe(
      RENEWAL_MARGIN_MAX_MS,
    )
  })
})
