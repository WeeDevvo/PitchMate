import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  mapAuthError,
  messageForOutcome,
  GENERIC_AUTH_FAILURE,
  UNIFORM_RESET_ACKNOWLEDGEMENT,
  GENERIC_FALLBACK_MESSAGE,
  GENERIC_VALIDATION_MESSAGE,
  PASSWORD_POLICY_VALIDATION_MESSAGE,
  type AuthOutcome,
  type ScreenContext,
  type BackendAuthError,
} from './errorMapping'

/**
 * Every screen context, used to assert non-disclosure holds regardless of which
 * screen renders the copy.
 */
const ALL_CONTEXTS: readonly ScreenContext[] = [
  'sign-up',
  'log-in',
  'reset-request',
  'reset-confirm',
  'verify-email',
  'google',
]

/**
 * A distinctive sentinel prefix for synthesised "raw backend content". It is
 * deliberately a token that never appears in any copy string this module
 * produces, so asserting the sentinel is absent from a rendered message proves
 * the raw backend content was not surfaced — without false positives from
 * incidental substrings of ordinary English copy.
 */
const SECRET_PREFIX = 'ZZ_BACKEND_SECRET_'

// The exhaustive set of copy strings this module can ever emit, gathered so the
// sentinel-absence guarantee can be sanity-checked against all of them.
const ALL_COPY = [
  GENERIC_AUTH_FAILURE,
  UNIFORM_RESET_ACKNOWLEDGEMENT,
  GENERIC_FALLBACK_MESSAGE,
  GENERIC_VALIDATION_MESSAGE,
  PASSWORD_POLICY_VALIDATION_MESSAGE,
]

// --- Generators -------------------------------------------------------------

// A recognisable "secret" backend content string that must never leak into copy.
const hexChar = fc.constantFrom(...'0123456789abcdef'.split(''))
const secret = fc
  .array(hexChar, { minLength: 6, maxLength: 32 })
  .map((chars) => `${SECRET_PREFIX}${chars.join('')}`)

// Codes/tokens the mapper recognises — excluded from "unmappable" generators so
// random inputs cannot accidentally hit a defined outcome.
const RECOGNISED_TOKENS = new Set<string>([
  'email-already-registered',
  'already-registered',
  'duplicate-email',
  'email-taken',
  'account-exists',
  'conflict',
  'validation',
  'validation-error',
  'validation-failed',
  'invalid-input',
  'invalid-request',
  'bad-request',
  'password-too-weak',
  'weak-password',
  'password-policy',
  'invalid-password',
  'password-too-short',
  'password-too-long',
  'email-not-verified',
  'unverified-email',
  'email-unverified',
  'verification-required',
  'invalid-token',
  'expired-token',
  'token-invalid',
  'token-expired',
  'invalid-or-expired-token',
  'token-used',
  'token-already-used',
  'used-token',
  'invalid-credentials',
  'authentication-failed',
  'auth-failure',
  'unauthorized',
  'bad-credentials',
  'invalid-login',
  'success',
  'ok',
])

// Statuses the mapper classifies — excluded from unmappable status fields.
const MAPPED_STATUSES = new Set<number>([400, 401, 408, 409, 422, 504])

// Transport-signal kinds — excluded from unmappable `kind` fields.
const TRANSPORT_KINDS = new Set<string>(['timeout', 'network', 'transport'])

// An arbitrary token that is definitely not a recognised classification code.
const unknownToken = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((s) => !RECOGNISED_TOKENS.has(s.trim().toLowerCase()))

// An arbitrary status that the mapper does not classify.
const unmappedStatus = fc
  .integer({ min: 100, max: 599 })
  .filter((n) => !MAPPED_STATUSES.has(n))

// An arbitrary `kind` string that is not a transport signal.
const nonTransportKind = fc
  .string({ maxLength: 16 })
  .filter((s) => !TRANSPORT_KINDS.has(s))

/**
 * Build a batch of unmappable candidates that each embed the given secret in a
 * free-text position. None of them carry a recognised code/status/transport
 * signal, so each MUST resolve to `generic`; embedding the secret lets us prove
 * it is never surfaced.
 */
function unmappableWithSecret(secretValue: string): fc.Arbitrary<unknown> {
  return fc.oneof(
    // Raw primitives carrying the secret.
    fc.constant(secretValue),
    fc.constantFrom(null, undefined),
    fc.integer(),
    fc.double({ noNaN: true }),
    fc.boolean(),
    // Arbitrary Error whose message is the secret (plain Error, not TypeError).
    fc.constant(new Error(secretValue)),
    unknownToken.map((msg) => new Error(`${secretValue} ${msg}`)),
    // Objects with unknown code/type but the secret in free-text fields.
    fc
      .record({
        code: unknownToken,
        detail: fc.constant(secretValue),
        message: fc.constant(secretValue),
        error: fc.constant(secretValue),
      })
      .map((r) => r as BackendAuthError),
    // Object with an unmapped status and the secret in detail.
    fc
      .record({
        status: unmappedStatus,
        detail: fc.constant(secretValue),
        kind: nonTransportKind,
      })
      .map((r) => r as BackendAuthError),
    // Object carrying only the secret (no recognised signals at all).
    fc.record({ detail: fc.constant(secretValue) }),
    // Deeply arbitrary bag with the secret buried in an unknown field.
    fc.record({
      reason: fc.constant(secretValue),
      note: unknownToken,
    }),
  )
}

// --- Property 7 -------------------------------------------------------------

// Feature: web-auth-screens, Property 7: Unmappable backend errors resolve to a safe generic message
// Validates: Requirements 12.4, 12.6, 15.8
describe('mapAuthError / messageForOutcome — unmappable fallback (Property 7)', () => {
  it('resolves any unmappable input to generic with copy that never leaks the raw backend content', () => {
    fc.assert(
      fc.property(
        secret.chain((s) =>
          fc.tuple(
            fc.constant(s),
            unmappableWithSecret(s),
            fc.constantFrom(...ALL_CONTEXTS),
          ),
        ),
        ([secretValue, candidate, ctx]) => {
          const outcome = mapAuthError(candidate)

          // Unmappable → the safe generic fallback outcome.
          expect(outcome).toEqual({ kind: 'generic' })

          // The rendered message never contains the raw backend content.
          const message = messageForOutcome(outcome, ctx)
          expect(message).not.toContain(secretValue)
          expect(message.length).toBeGreaterThan(0)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('produces generic copy independent of the (discarded) backend content', () => {
    // The generic message is a fixed constant for every non-reset context.
    for (const ctx of ALL_CONTEXTS) {
      const message = messageForOutcome({ kind: 'generic' }, ctx)
      if (ctx === 'reset-request') {
        expect(message).toBe(UNIFORM_RESET_ACKNOWLEDGEMENT)
      } else {
        expect(message).toBe(GENERIC_FALLBACK_MESSAGE)
      }
    }
  })

  it('never bakes the secret sentinel into any copy string this module emits', () => {
    for (const copy of ALL_COPY) {
      expect(copy.includes(SECRET_PREFIX)).toBe(false)
    }
  })
})

// --- Subtask 4.3: typed error-outcome mapping unit tests --------------------

describe('mapAuthError — typed error branches', () => {
  it('maps already-registered / conflict to email-already-registered (Req 2.6)', () => {
    expect(mapAuthError({ code: 'email-already-registered' })).toEqual({
      kind: 'email-already-registered',
    })
    expect(mapAuthError({ type: 'duplicate-email' })).toEqual({
      kind: 'email-already-registered',
    })
    // Coarse status fallback: 409 Conflict.
    expect(mapAuthError({ status: 409 })).toEqual({
      kind: 'email-already-registered',
    })
  })

  it('maps a backend validation error to validation (Req 2.7, 3.7, 6.7)', () => {
    expect(mapAuthError({ code: 'validation-error' })).toEqual({
      kind: 'validation',
      message: GENERIC_VALIDATION_MESSAGE,
    })
    // Password-strength validation gets tailored (still controlled) copy.
    expect(mapAuthError({ code: 'password-too-weak' })).toEqual({
      kind: 'validation',
      message: PASSWORD_POLICY_VALIDATION_MESSAGE,
    })
    // Coarse status fallback: 422 Unprocessable Entity.
    expect(mapAuthError({ status: 422 })).toEqual({
      kind: 'validation',
      message: GENERIC_VALIDATION_MESSAGE,
    })
  })

  it('maps email-not-verified', () => {
    expect(mapAuthError({ code: 'email-not-verified' })).toEqual({
      kind: 'email-not-verified',
    })
  })

  it('maps invalid-or-expired-token (Req 6.6, 7.4)', () => {
    expect(mapAuthError({ code: 'expired-token' })).toEqual({
      kind: 'invalid-or-expired-token',
    })
    expect(mapAuthError({ code: 'token-already-used' })).toEqual({
      kind: 'invalid-or-expired-token',
    })
  })

  it('maps authentication failure (Req 3.6)', () => {
    expect(mapAuthError({ code: 'invalid-credentials' })).toEqual({
      kind: 'auth-failure',
    })
    expect(mapAuthError({ status: 401 })).toEqual({ kind: 'auth-failure' })
  })

  it('maps timeout / network / transport throws to timeout-or-network', () => {
    expect(mapAuthError({ kind: 'timeout' })).toEqual({
      kind: 'timeout-or-network',
    })
    expect(mapAuthError({ kind: 'network' })).toEqual({
      kind: 'timeout-or-network',
    })
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    expect(mapAuthError(abort)).toEqual({ kind: 'timeout-or-network' })
    expect(mapAuthError(new TypeError('Failed to fetch'))).toEqual({
      kind: 'timeout-or-network',
    })
    // Status-based timeouts.
    expect(mapAuthError({ status: 408 })).toEqual({
      kind: 'timeout-or-network',
    })
    expect(mapAuthError({ status: 504 })).toEqual({
      kind: 'timeout-or-network',
    })
  })

  it('classification prefers the machine code over the status', () => {
    // A recognised code wins even when the status would map elsewhere.
    expect(mapAuthError({ code: 'invalid-credentials', status: 409 })).toEqual({
      kind: 'auth-failure',
    })
  })
})

describe('messageForOutcome — non-disclosure and controlled copy', () => {
  // A recognisable raw backend detail string that must never appear in copy.
  const RAW = 'RAW_BACKEND_DETAIL: user 42 password mismatch at row 7'

  it('never surfaces raw backend text for any typed outcome (Req 12.6, 15.8)', () => {
    const typedErrors: BackendAuthError[] = [
      { code: 'email-already-registered', detail: RAW, message: RAW },
      { code: 'validation-error', detail: RAW, message: RAW },
      { code: 'password-too-weak', detail: RAW, message: RAW },
      { code: 'email-not-verified', detail: RAW, message: RAW },
      { code: 'expired-token', detail: RAW, message: RAW },
      { code: 'invalid-credentials', detail: RAW, message: RAW },
      { kind: 'network', detail: RAW, message: RAW },
    ]

    for (const err of typedErrors) {
      const outcome = mapAuthError(err)
      for (const ctx of ALL_CONTEXTS) {
        const message = messageForOutcome(outcome, ctx)
        expect(message).not.toContain(RAW)
        expect(message).not.toContain('RAW_BACKEND_DETAIL')
      }
    }
  })

  it('shows the Generic_Auth_Failure constant for auth-failure on log-in (Req 3.6)', () => {
    const outcome = mapAuthError({ code: 'invalid-credentials', detail: RAW })
    expect(messageForOutcome(outcome, 'log-in')).toBe(GENERIC_AUTH_FAILURE)
    // It must not reveal which credential was wrong.
    expect(GENERIC_AUTH_FAILURE.toLowerCase()).not.toContain('email')
    expect(GENERIC_AUTH_FAILURE.toLowerCase()).not.toContain('password')
  })

  it('shows the Uniform_Reset_Acknowledgement for every reset-request outcome (Req 5.4, 5.5)', () => {
    const outcomes: AuthOutcome[] = [
      { kind: 'success' },
      { kind: 'email-already-registered' },
      { kind: 'validation', message: GENERIC_VALIDATION_MESSAGE },
      { kind: 'auth-failure' },
      { kind: 'email-not-verified' },
      { kind: 'invalid-or-expired-token' },
      { kind: 'timeout-or-network' },
      { kind: 'generic' },
    ]
    for (const outcome of outcomes) {
      expect(messageForOutcome(outcome, 'reset-request')).toBe(
        UNIFORM_RESET_ACKNOWLEDGEMENT,
      )
    }
  })

  it('returns the controlled validation copy for a validation outcome', () => {
    const generic = mapAuthError({ code: 'validation-error' })
    expect(messageForOutcome(generic, 'sign-up')).toBe(GENERIC_VALIDATION_MESSAGE)

    const password = mapAuthError({ code: 'password-too-weak' })
    expect(messageForOutcome(password, 'reset-confirm')).toBe(
      PASSWORD_POLICY_VALIDATION_MESSAGE,
    )
  })
})
