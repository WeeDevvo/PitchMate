/**
 * Unit tests for the Reset_Request_Screen branches (task 15.3).
 *
 * The screen (task 15.1) runs client-side email validation before calling
 * `authApi.requestPasswordReset`, then renders the single
 * Uniform_Reset_Acknowledgement on every backend outcome. These tests cover its
 * required branches:
 *
 *   - field presence: an Email_Address field and a submit control
 *     (Requirement 5.1);
 *   - validation-blocks-call: an empty/whitespace-only email, an over-254-char
 *     email, and a malformed email each show the field-specific message, move
 *     focus to the Email_Address control, and prevent the backend call
 *     (Requirements 5.3, 14.7);
 *   - happy path: a valid email calls `requestPasswordReset` exactly once with
 *     the trimmed/validated value (Requirement 5.2 supporting);
 *   - in-progress guard + re-enable: while the request is pending the submit
 *     control is disabled and a second concurrent submit is blocked
 *     (Requirement 5.8); once the call resolves submission is re-enabled and the
 *     Uniform_Reset_Acknowledgement is shown (Requirements 5.6).
 *
 * The screen owns no session logic, so the tests inject a fake `authApi`. It
 * links back to the Log_In_Screen via the shared `LinkButton` (which uses
 * react-router's `useNavigate`), so the screen is rendered inside a
 * `MemoryRouter`.
 *
 * Feature: web-auth-screens
 * Validates: Requirements 5.1, 5.3, 5.6, 5.8
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { UNIFORM_RESET_ACKNOWLEDGEMENT } from './lib/errorMapping'
import type { AuthAckResult } from './api/authApi'
import {
  ResetRequestScreen,
  EMAIL_REQUIRED_MESSAGE,
  EMAIL_TOO_LONG_MESSAGE,
  EMAIL_MALFORMED_MESSAGE,
} from './ResetRequestScreen'

/** A valid Email_Address that passes client-side validation. */
const VALID_EMAIL = 'player@pitch-mate.co.uk'

/** Build a fake auth API with a controllable `requestPasswordReset` result. */
function fakeApi(result: AuthAckResult = { ok: true }) {
  return {
    requestPasswordReset: vi.fn(async (): Promise<AuthAckResult> => result),
  }
}

/** Render the screen inside a router, allowing per-test overrides. */
function renderScreen(
  overrides: Partial<Parameters<typeof ResetRequestScreen>[0]> = {},
) {
  const authApi = overrides.authApi ?? fakeApi()
  render(
    <MemoryRouter>
      <ResetRequestScreen authApi={authApi} />
    </MemoryRouter>,
  )
  return { authApi }
}

/**
 * The submit control. Matches both the idle label ("Send reset link") and the
 * in-progress label ("Sending reset link…") so it can be located while a
 * submission is pending.
 */
function submitButton() {
  return screen.getByRole('button', { name: /send reset link|sending reset link/i })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ResetRequestScreen — field presence (Req 5.1)', () => {
  it('presents an Email_Address field and a submit control', () => {
    renderScreen()

    expect(screen.getByLabelText('Email address')).toBeInTheDocument()
    expect(submitButton()).toBeInTheDocument()
  })
})

describe('ResetRequestScreen — validation blocks the backend call (Req 5.3, 14.7)', () => {
  it('does not call requestPasswordReset and focuses the email field when the email is whitespace-only', async () => {
    const user = userEvent.setup()
    const { authApi } = renderScreen()

    // A whitespace-only email is treated as missing (trimmed to empty).
    await user.type(screen.getByLabelText('Email address'), '   ')
    await user.click(submitButton())

    expect(authApi.requestPasswordReset).not.toHaveBeenCalled()
    expect(screen.getByText(EMAIL_REQUIRED_MESSAGE)).toBeInTheDocument()
    // Focus moved to the offending control (Requirement 14.7).
    expect(screen.getByLabelText('Email address')).toHaveFocus()
  })

  it('does not call requestPasswordReset and focuses the email field when the email is over 254 characters', async () => {
    const user = userEvent.setup()
    const { authApi } = renderScreen()

    // A structurally valid but over-length address (> 254 chars). The local
    // part is padded so the trimmed length exceeds the limit.
    const overLongEmail = `${'a'.repeat(250)}@example.com`
    expect(overLongEmail.length).toBeGreaterThan(254)

    await user.type(screen.getByLabelText('Email address'), overLongEmail)
    await user.click(submitButton())

    expect(authApi.requestPasswordReset).not.toHaveBeenCalled()
    expect(screen.getByText(EMAIL_TOO_LONG_MESSAGE)).toBeInTheDocument()
    expect(screen.getByLabelText('Email address')).toHaveFocus()
  })

  it('does not call requestPasswordReset and focuses the email field when the email is malformed', async () => {
    const user = userEvent.setup()
    const { authApi } = renderScreen()

    await user.type(screen.getByLabelText('Email address'), 'not-an-email')
    await user.click(submitButton())

    expect(authApi.requestPasswordReset).not.toHaveBeenCalled()
    expect(screen.getByText(EMAIL_MALFORMED_MESSAGE)).toBeInTheDocument()
    expect(screen.getByLabelText('Email address')).toHaveFocus()
  })
})

describe('ResetRequestScreen — happy path (Req 5.2 supporting)', () => {
  it('calls requestPasswordReset exactly once with the trimmed email and shows the uniform acknowledgement', async () => {
    const user = userEvent.setup()
    const { authApi } = renderScreen()

    // Surrounding whitespace should be trimmed off the submitted value.
    await user.type(screen.getByLabelText('Email address'), `  ${VALID_EMAIL}  `)
    await user.click(submitButton())

    await waitFor(() =>
      expect(authApi.requestPasswordReset).toHaveBeenCalledTimes(1),
    )
    expect(authApi.requestPasswordReset).toHaveBeenCalledWith(VALID_EMAIL)

    // Every outcome renders the single Uniform_Reset_Acknowledgement.
    expect(
      await screen.findByText(UNIFORM_RESET_ACKNOWLEDGEMENT),
    ).toBeInTheDocument()
  })
})

describe('ResetRequestScreen — in-progress guard and re-enable (Req 5.8, 5.6)', () => {
  it('disables the submit control while pending, blocks a second submit, then re-enables and shows the acknowledgement', async () => {
    const user = userEvent.setup()
    let resolve!: (value: AuthAckResult) => void
    const pending = new Promise<AuthAckResult>((res) => {
      resolve = res
    })
    const authApi = {
      requestPasswordReset: vi.fn((): Promise<AuthAckResult> => pending),
    }
    renderScreen({ authApi })

    await user.type(screen.getByLabelText('Email address'), VALID_EMAIL)
    await user.click(submitButton())

    // While pending the control is disabled and marked busy, blocking a second submit.
    await waitFor(() => expect(submitButton()).toBeDisabled())
    expect(submitButton()).toHaveAttribute('aria-busy', 'true')
    await user.click(submitButton())
    expect(authApi.requestPasswordReset).toHaveBeenCalledTimes(1)

    // Once the call resolves, submission is re-enabled (Requirement 5.6)...
    resolve({ ok: true })
    await waitFor(() => expect(submitButton()).toBeEnabled())
    expect(submitButton()).not.toHaveAttribute('aria-busy')

    // ...and the single Uniform_Reset_Acknowledgement is displayed.
    expect(
      await screen.findByText(UNIFORM_RESET_ACKNOWLEDGEMENT),
    ).toBeInTheDocument()
  })
})
