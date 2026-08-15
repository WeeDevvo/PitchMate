import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  validatePassword,
  PASSWORD_MIN,
  PASSWORD_MAX,
} from './passwordPolicy'

describe('validatePassword', () => {
  it('accepts a password at the minimum length', () => {
    expect(validatePassword('a'.repeat(PASSWORD_MIN))).toEqual({ ok: true })
  })

  it('accepts a password at the maximum length', () => {
    expect(validatePassword('a'.repeat(PASSWORD_MAX))).toEqual({ ok: true })
  })

  it('rejects an empty password as too-short', () => {
    expect(validatePassword('')).toEqual({ ok: false, reason: 'too-short' })
  })

  it('rejects a password one below the minimum as too-short', () => {
    expect(validatePassword('a'.repeat(PASSWORD_MIN - 1))).toEqual({
      ok: false,
      reason: 'too-short',
    })
  })

  it('rejects a password one above the maximum as too-long', () => {
    expect(validatePassword('a'.repeat(PASSWORD_MAX + 1))).toEqual({
      ok: false,
      reason: 'too-long',
    })
  })

  // Feature: web-auth-screens, Property 2: Password policy is exactly the length band
  it('is satisfied iff length is within [PASSWORD_MIN, PASSWORD_MAX], else reports the correct reason', () => {
    // Generate a target length across the full spectrum: explicit boundary
    // lengths plus random lengths well below the min and well above the max.
    const lengthArb = fc.oneof(
      // Boundary lengths that must be exercised.
      fc.constantFrom(
        0,
        PASSWORD_MIN - 1, // 11
        PASSWORD_MIN, // 12
        PASSWORD_MIN + 1, // 13
        PASSWORD_MAX - 1, // 127
        PASSWORD_MAX, // 128
        PASSWORD_MAX + 1, // 129
      ),
      // Random lengths well below the minimum.
      fc.integer({ min: 0, max: PASSWORD_MIN - 1 }),
      // Random lengths inside the accepted band.
      fc.integer({ min: PASSWORD_MIN, max: PASSWORD_MAX }),
      // Random lengths well above the maximum.
      fc.integer({ min: PASSWORD_MAX + 1, max: PASSWORD_MAX * 8 }),
    )

    // Build a string of exactly the target length from a simple ASCII alphabet
    // so that `password.length` (UTF-16 code units) equals the intended count.
    const passwordArb = lengthArb.chain((length) =>
      fc
        .string({
          unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 '.split('')),
          minLength: length,
          maxLength: length,
        })
        .map((s) => ({ password: s, length })),
    )

    fc.assert(
      fc.property(passwordArb, ({ password, length }) => {
        // Keep the oracle consistent with the actual string length.
        expect(password.length).toBe(length)

        const result = validatePassword(password)
        const withinBand = length >= PASSWORD_MIN && length <= PASSWORD_MAX

        expect(result.ok).toBe(withinBand)

        if (!result.ok) {
          if (length < PASSWORD_MIN) {
            expect(result.reason).toBe('too-short')
          } else {
            expect(result.reason).toBe('too-long')
          }
        }
      }),
      { numRuns: 300 },
    )
  })
})
