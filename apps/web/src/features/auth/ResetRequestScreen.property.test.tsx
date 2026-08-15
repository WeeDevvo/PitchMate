/**
 * Property test for the Reset_Request_Screen uniform-acknowledgement guarantee
 * (task 15.2).
 *
 * Property 9: Password-reset request always shows the uniform acknowledgement.
 * For any outcome of the backend password-reset request call — success,
 * account-absent, rate-limited, transient failure, or timeout — the
 * Reset_Request_Screen renders the identical Uniform_Reset_Acknowledgement,
 * revealing no information about account existence (Requirements 5.4, 5.5, 5.6,
 * 5.7).
 *
 * The screen deliberately never inspects the result of `requestPasswordReset`:
 * it shows the single `UNIFORM_RESET_ACKNOWLEDGEMENT` constant from a `finally`
 * block once the call settles. The `AuthApiFacade` contract this screen depends
 * on is that `requestPasswordReset` *always resolves* with a shaped
 * `AuthAckResult` — its `callAck` plumbing catches every transport failure
 * (abort/timeout, network) and every error body and returns a resolved outcome,
 * never a rejection. Every backend behaviour Property 9 enumerates therefore
 * arrives here as a resolved value, and this property drives the mock across
 * that entire space:
 *
 *   - `{ ok: true }` — the success acknowledgement, which is also exactly how
 *     the backend answers the account-absent case (answered uniformly); and
 *   - every shaped `{ ok: false, outcome }` failure — including
 *     `timeout-or-network` (the 10-second timeout and any transient/network
 *     failure), `generic` (an unmapped rate-limited or transient response),
 *     `validation`, `auth-failure`, `email-not-verified`,
 *     `invalid-or-expired-token`, and `email-already-registered`.
 *
 * So success, account-absent, rate-limited, transient failure, and timeout are
 * all represented. A valid Email_Address is submitted every run so validation passes and
 * the backend mock is genuinely invoked, and the announced acknowledgement is
 * asserted to equal the single constant byte-for-byte regardless of which
 * outcome the mock produced. Because the shown text is identical while the
 * backend outcome varies across its whole range, the acknowledgement is proven
 * independent of the outcome — account existence can never leak.
 *
 * `LinkButton` (the "Back to log in" control) calls react-router's
 * `useNavigate`, so the screen is wrapped in a `MemoryRouter`, following the
 * established auth/landing test approach.
 *
 * Feature: web-auth-screens, Property 9: Password-reset request always shows the uniform acknowledgement
 * Validates: Requirements 5.4, 5.5, 5.6, 5.7
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import fc from 'fast-check'

import { ResetRequestScreen } from './ResetRequestScreen'
import { UNIFORM_RESET_ACKNOWLEDGEMENT } from './lib/errorMapping'
import type { AuthAckResult, FailureOutcome } from './api/authApi'

/** A valid, non-empty Email_Address so client-side validation always passes. */
const VALID_EMAIL = 'player@pitch-mate.co.uk'

// --- Generators -------------------------------------------------------------

/**
 * Every shaped failure outcome the facade can return from a valueless call.
 * `validation` carries controlled (non-raw) copy; the rest are tag-only.
 */
const failureOutcome: fc.Arbitrary<FailureOutcome> = fc.oneof(
  fc.constant<FailureOutcome>({ kind: 'email-already-registered' }),
  fc.constant<FailureOutcome>({ kind: 'auth-failure' }),
  fc.constant<FailureOutcome>({ kind: 'email-not-verified' }),
  fc.constant<FailureOutcome>({ kind: 'invalid-or-expired-token' }),
  fc.constant<FailureOutcome>({ kind: 'timeout-or-network' }),
  fc.constant<FailureOutcome>({ kind: 'generic' }),
  fc
    .string({ maxLength: 40 })
    .map<FailureOutcome>((message) => ({ kind: 'validation', message })),
)

/**
 * Every way the facade can resolve `requestPasswordReset`: a success
 * acknowledgement (also how the backend answers the account-absent case) or any
 * shaped failure. This is the whole outcome space the screen ever sees, because
 * the facade never rejects.
 */
const ackResult: fc.Arbitrary<AuthAckResult> = fc.oneof(
  fc.constant<AuthAckResult>({ ok: true }),
  failureOutcome.map<AuthAckResult>((outcome) => ({ ok: false, outcome })),
)

// --- Fake API ---------------------------------------------------------------

/**
 * A fake auth API whose `requestPasswordReset` resolves with the given shaped
 * result, mirroring the real facade's contract (it always resolves, never
 * throws).
 */
function fakeApi(result: AuthAckResult) {
  return {
    requestPasswordReset: vi.fn(async (): Promise<AuthAckResult> => result),
  }
}

/** Render the Reset_Request_Screen inside a router, returning the fake API. */
function renderScreen(result: AuthAckResult) {
  const authApi = fakeApi(result)
  render(
    <MemoryRouter>
      <ResetRequestScreen authApi={authApi} />
    </MemoryRouter>,
  )
  return authApi
}

/** The submit control — matches both its idle and in-progress labels. */
function submitButton() {
  return screen.getByRole('button', {
    name: /send reset link|sending reset link/i,
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ResetRequestScreen — Property 9 (uniform reset acknowledgement)', () => {
  // Feature: web-auth-screens, Property 9: Password-reset request always shows the uniform acknowledgement
  // Validates: Requirements 5.4, 5.5, 5.6, 5.7
  it('shows exactly the Uniform_Reset_Acknowledgement for any backend outcome, independent of the outcome', async () => {
    await fc.assert(
      fc.asyncProperty(ackResult, async (result) => {
        const authApi = renderScreen(result)
        try {
          // Enter a valid Email_Address so client validation passes and the
          // backend mock is genuinely invoked (Requirement 5.3).
          fireEvent.change(screen.getByLabelText('Email address'), {
            target: { value: VALID_EMAIL },
          })
          fireEvent.click(submitButton())

          // The backend was actually consulted (validation did not short-circuit).
          await waitFor(() =>
            expect(authApi.requestPasswordReset).toHaveBeenCalledTimes(1),
          )

          // The announced acknowledgement equals the single constant, verbatim —
          // identical across every success/absent/failure/transient/timeout
          // outcome, so account existence never leaks (Requirements 5.4–5.7).
          await waitFor(() =>
            expect(screen.getByTestId('auth-live-region').textContent).toBe(
              UNIFORM_RESET_ACKNOWLEDGEMENT,
            ),
          )
        } finally {
          cleanup()
        }
      }),
      { numRuns: 150 },
    )
  }, 30_000)
})
