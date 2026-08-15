/**
 * Property test for the Log_In_Screen sign-in non-disclosure guarantee (task 14.2).
 *
 * Property 8: Sign-in failure never discloses which credential was wrong.
 * For any authentication-failure response from the sign-in endpoint, the
 * message shown on the Log_In_Screen equals the single constant
 * Generic_Auth_Failure message and is independent of the response detail, so it
 * never reveals whether the Email_Address or the password was incorrect.
 *
 * The property drives the *full* non-disclosure path, not just a fixed outcome:
 * it generates arbitrary backend authentication-failure envelopes (varying the
 * machine code casing/whitespace, HTTP status, and — crucially — the free-text
 * `detail`/`message`/`error` content a leaky backend might return), shapes each
 * through the real `mapAuthError` exactly as the Api_Client facade would, and
 * feeds the resulting outcome to a mocked `authApi.signIn`. The screen is then
 * rendered, valid non-empty credentials are submitted, and the announced
 * message is asserted to equal the single `GENERIC_AUTH_FAILURE` constant
 * verbatim on every run. Because the shown text is byte-for-byte identical while
 * the generated backend detail varies wildly, the message is proven independent
 * of the response detail — which credential was wrong can never leak.
 *
 * The example-based branch coverage for the screen lives in
 * `LogInScreen.test.tsx` (task 14.3); this file is the dedicated,
 * generator-driven property at >= 100 fast-check iterations.
 *
 * `LinkButton` calls react-router's `useNavigate`, so the screen is wrapped in a
 * `MemoryRouter`, following the established auth/landing test approach.
 *
 * Feature: web-auth-screens, Property 8: Sign-in failure never discloses which credential was wrong
 * Validates: Requirements 3.6
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import fc from 'fast-check'

import { LogInScreen } from './LogInScreen'
import {
  GENERIC_AUTH_FAILURE,
  mapAuthError,
  type BackendAuthError,
} from './lib/errorMapping'
import type {
  AuthSessionPayload,
  AuthSessionResult,
  FailureOutcome,
} from './api/authApi'

/** Valid, non-empty credentials so client-side validation always passes. */
const VALID_EMAIL = 'player@pitch-mate.co.uk'
const VALID_PASSWORD = 'a-very-strong-password'

/** A session payload the (unused) Google seam can return on its success path. */
const SESSION: AuthSessionPayload = {
  accessToken: 'access-token-abc',
  refreshToken: 'refresh-token-xyz',
  expiresAtMs: 1_900_000_000_000,
}

// The machine codes the backend uses for an authentication failure. These
// mirror the AUTH_FAILURE_CODES the pure mapping classifies; any of them (in any
// casing / with surrounding whitespace, which the mapping trims + lowercases)
// resolves to the credential-agnostic `auth-failure` outcome.
const AUTH_FAILURE_CODES = [
  'invalid-credentials',
  'authentication-failed',
  'auth-failure',
  'unauthorized',
  'bad-credentials',
  'invalid-login',
] as const

// --- Generators -------------------------------------------------------------

/** Randomly re-case a token, since classification lowercases before matching. */
const recased = (value: string): fc.Arbitrary<string> =>
  fc
    .array(fc.boolean(), { minLength: value.length, maxLength: value.length })
    .map((flips) =>
      value
        .split('')
        .map((ch, i) => (flips[i] ? ch.toUpperCase() : ch.toLowerCase()))
        .join(''),
    )

/** A recognised auth-failure code, with varied casing and optional padding. */
const authFailureCode: fc.Arbitrary<string> = fc
  .constantFrom(...AUTH_FAILURE_CODES)
  .chain((code) => recased(code))
  .chain((code) =>
    fc
      .tuple(
        fc.stringMatching(/^[ \t]*$/),
        fc.stringMatching(/^[ \t]*$/),
      )
      .map(([lead, trail]) => `${lead}${code}${trail}`),
  )

/**
 * Free-text backend content that a leaky endpoint might return — including the
 * exact credential-revealing phrasings this property guarantees never surface.
 * The mapping reads none of these fields; they exist only to vary the response
 * "detail" and prove the shown message is independent of it.
 */
const leakyText: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(
    'No account exists for that email address',
    'Incorrect password for this user',
    'Email not found',
    'Password does not match',
    'User is locked out',
    '',
  ),
  fc.string({ maxLength: 80 }),
)

/** An optional free-text field: sometimes present, sometimes absent. */
const optionalText: fc.Arbitrary<string | undefined> = fc.option(leakyText, {
  nil: undefined,
})

/**
 * An arbitrary backend authentication-failure envelope. Two shapes are
 * generated, both of which the mapping classifies as `auth-failure`:
 *   - a recognised auth-failure `code` (with any status), or
 *   - no code plus HTTP `401 Unauthorized`.
 * Each carries arbitrary, possibly-leaky `detail`/`message`/`error` content.
 */
const authFailureBackendError: fc.Arbitrary<BackendAuthError> = fc
  .record({
    detail: optionalText,
    message: optionalText,
    error: optionalText,
    variant: fc.oneof(
      fc.record({ code: authFailureCode, status: fc.integer({ min: 100, max: 599 }) }),
      fc.record({ status: fc.constant(401) }),
    ),
  })
  .map(({ detail, message, error, variant }) => ({
    detail,
    message,
    error,
    ...variant,
  }))

// --- Fake API ---------------------------------------------------------------

/** A fake auth API whose `signIn` always fails with the given shaped outcome. */
function fakeApi(outcome: FailureOutcome) {
  return {
    signIn: vi.fn(async (): Promise<AuthSessionResult> => ({ ok: false, outcome })),
    signInGoogle: vi.fn(
      async (): Promise<AuthSessionResult> => ({ ok: true, session: SESSION }),
    ),
  }
}

/** Render the Log_In_Screen inside a router, returning the injected fake API. */
function renderScreen(outcome: FailureOutcome) {
  const authApi = fakeApi(outcome)
  render(
    <MemoryRouter>
      <LogInScreen
        authApi={authApi}
        requestGoogleAssertion={vi.fn(async () => null)}
        onSession={vi.fn()}
      />
    </MemoryRouter>,
  )
  return authApi
}

/** The submit control — matches both its idle and in-progress labels. */
function submitButton() {
  return screen.getByRole('button', { name: /log in|signing you in/i })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('LogInScreen — Property 8 (sign-in non-disclosure)', () => {
  // Feature: web-auth-screens, Property 8: Sign-in failure never discloses which credential was wrong
  // Validates: Requirements 3.6
  it('shows exactly the Generic_Auth_Failure message for any auth-failure response, independent of the response detail', async () => {
    await fc.assert(
      fc.asyncProperty(authFailureBackendError, async (backendError) => {
        // Shape the generated backend envelope exactly as the Api_Client facade
        // would. Every generated shape must classify as the credential-agnostic
        // auth-failure outcome — that is the precondition of this property.
        const outcome = mapAuthError(backendError)
        expect(outcome.kind).toBe('auth-failure')

        const authApi = renderScreen(outcome as FailureOutcome)
        try {
          // Set valid, non-empty credentials directly (fast per-iteration) so
          // client-side validation passes and the backend call is made.
          fireEvent.change(screen.getByLabelText('Email address'), {
            target: { value: VALID_EMAIL },
          })
          fireEvent.change(screen.getByLabelText('Password'), {
            target: { value: VALID_PASSWORD },
          })
          fireEvent.click(submitButton())

          // The backend was actually consulted (validation did not short-circuit).
          await waitFor(() => expect(authApi.signIn).toHaveBeenCalledTimes(1))

          // The announced message equals the single constant, verbatim — never
          // any of the generated (possibly credential-revealing) detail. The
          // screen renders its status region first, ahead of the Google
          // control's own (empty) region, so index 0 is the sign-in status.
          await waitFor(() =>
            expect(
              screen.getAllByTestId('auth-live-region')[0]?.textContent,
            ).toBe(GENERIC_AUTH_FAILURE),
          )
        } finally {
          cleanup()
        }
      }),
      { numRuns: 150 },
    )
  }, 30_000)
})
