/**
 * Unit tests for the Sign_Up_Screen branches (task 13.2).
 *
 * The screen (task 13.1) runs client-side email/password validation before
 * calling `authApi.register`, then reports each backend outcome with the shared
 * components. These tests cover its required branches:
 *
 *   - field presence: email, password, submit, and the Google control
 *     (Requirements 2.1, 4.1);
 *   - validation-blocks-call: an invalid email and an invalid password each
 *     prevent the backend registration call (Requirements 2.3, 2.4);
 *   - success: confirmation that the account was created and a verification
 *     message was sent (Requirement 2.5);
 *   - already-registered: an invite to sign in / reset, with the entered email
 *     retained (Requirement 2.6);
 *   - backend-validation: the reported validation problem is shown and the
 *     person stays on the screen (Requirement 2.7);
 *   - timeout / network: a retryable message, the email retained, and submission
 *     re-enabled (Requirement 2.9);
 *   - focus-on-validation-error: focus moves to the offending control
 *     (Requirement 14.7).
 *
 * The screen owns no session logic, so the tests inject a fake `authApi` and a
 * Google flow seam. `GoogleSignInControl` uses no router, so no router wrapper
 * is needed.
 *
 * Feature: web-auth-screens
 * Validates: Requirements 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.9, 14.7
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GOOGLE_SIGN_IN_DEFAULT_LABEL } from './components/GoogleSignInControl'
import { messageForOutcome } from './lib/errorMapping'
import type {
  AuthAckResult,
  AuthSessionPayload,
  AuthSessionResult,
  FailureOutcome,
} from './api/authApi'
import {
  SignUpScreen,
  EMAIL_MALFORMED_MESSAGE,
  EMAIL_REQUIRED_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
} from './SignUpScreen'

/** A valid Email_Address and password that pass client-side validation. */
const VALID_EMAIL = 'player@pitch-mate.co.uk'
const VALID_PASSWORD = 'a-very-strong-password' // 22 chars, within 12..128

/** A session payload the Google seam can return on the success path. */
const SESSION: AuthSessionPayload = {
  accessToken: 'access-token-abc',
  refreshToken: 'refresh-token-xyz',
  expiresAtMs: 1_900_000_000_000,
}

/** Build a fake auth API with a controllable `register` result. */
function fakeApi(registerResult: AuthAckResult) {
  return {
    register: vi.fn(async (): Promise<AuthAckResult> => registerResult),
    signInGoogle: vi.fn(
      async (): Promise<AuthSessionResult> => ({ ok: true, session: SESSION }),
    ),
  }
}

/** Render the screen with sensible defaults, allowing per-test overrides. */
function renderScreen(
  overrides: Partial<Parameters<typeof SignUpScreen>[0]> = {},
) {
  const authApi = overrides.authApi ?? fakeApi({ ok: true })
  const requestGoogleAssertion =
    overrides.requestGoogleAssertion ?? vi.fn(async () => null)
  const onGoogleSession = overrides.onGoogleSession ?? vi.fn()
  render(
    <SignUpScreen
      authApi={authApi}
      requestGoogleAssertion={requestGoogleAssertion}
      onGoogleSession={onGoogleSession}
      onGoogleFailure={overrides.onGoogleFailure}
    />,
  )
  return { authApi, requestGoogleAssertion, onGoogleSession }
}

/**
 * The submit control (distinct from the Google control). Matches both the idle
 * label ("Create account") and the in-progress label ("Creating your account…")
 * so it can be located while a submission is pending.
 */
function submitButton() {
  return screen.getByRole('button', { name: /creat/i })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SignUpScreen — field presence (Req 2.1, 4.1)', () => {
  it('presents email, password, a submit control, and the Google control', () => {
    renderScreen()

    expect(screen.getByLabelText('Email address')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(submitButton()).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: GOOGLE_SIGN_IN_DEFAULT_LABEL }),
    ).toBeInTheDocument()
  })
})

describe('SignUpScreen — validation blocks the backend call (Req 2.3, 2.4, 14.7)', () => {
  it('does not call register and focuses the email field when the email is invalid', async () => {
    const user = userEvent.setup()
    const { authApi } = renderScreen()

    await user.type(screen.getByLabelText('Email address'), 'not-an-email')
    await user.type(screen.getByLabelText('Password'), VALID_PASSWORD)
    await user.click(submitButton())

    // No backend call, the field-specific message shows, and focus moved to
    // the offending control (Requirement 14.7).
    expect(authApi.register).not.toHaveBeenCalled()
    expect(screen.getByText(EMAIL_MALFORMED_MESSAGE)).toBeInTheDocument()
    expect(screen.getByLabelText('Email address')).toHaveFocus()
  })

  it('reports an empty email and focuses it', async () => {
    const user = userEvent.setup()
    const { authApi } = renderScreen()

    // Leave the email empty; supply a valid password.
    await user.type(screen.getByLabelText('Password'), VALID_PASSWORD)
    await user.click(submitButton())

    expect(authApi.register).not.toHaveBeenCalled()
    expect(screen.getByText(EMAIL_REQUIRED_MESSAGE)).toBeInTheDocument()
    expect(screen.getByLabelText('Email address')).toHaveFocus()
  })

  it('does not call register and focuses the password field when only the password is invalid', async () => {
    const user = userEvent.setup()
    const { authApi } = renderScreen()

    await user.type(screen.getByLabelText('Email address'), VALID_EMAIL)
    await user.type(screen.getByLabelText('Password'), 'short') // < 12 chars
    await user.click(submitButton())

    expect(authApi.register).not.toHaveBeenCalled()
    expect(screen.getByText(PASSWORD_TOO_SHORT_MESSAGE)).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveFocus()
  })
})

describe('SignUpScreen — success (Req 2.2, 2.5)', () => {
  it('calls register with the entered credentials and confirms account creation', async () => {
    const user = userEvent.setup()
    const { authApi } = renderScreen({ authApi: fakeApi({ ok: true }) })

    await user.type(screen.getByLabelText('Email address'), VALID_EMAIL)
    await user.type(screen.getByLabelText('Password'), VALID_PASSWORD)
    await user.click(submitButton())

    await waitFor(() => expect(authApi.register).toHaveBeenCalledTimes(1))
    expect(authApi.register).toHaveBeenCalledWith({
      email: VALID_EMAIL,
      password: VALID_PASSWORD,
    })

    const expected = messageForOutcome({ kind: 'success' }, 'sign-up')
    expect(await screen.findByText(expected)).toBeInTheDocument()
  })
})

describe('SignUpScreen — already registered (Req 2.6)', () => {
  it('invites the person to sign in or reset and retains the entered email', async () => {
    const user = userEvent.setup()
    const outcome: FailureOutcome = { kind: 'email-already-registered' }
    renderScreen({ authApi: fakeApi({ ok: false, outcome }) })

    await user.type(screen.getByLabelText('Email address'), VALID_EMAIL)
    await user.type(screen.getByLabelText('Password'), VALID_PASSWORD)
    await user.click(submitButton())

    const expected = messageForOutcome(outcome, 'sign-up')
    expect(await screen.findByText(expected)).toBeInTheDocument()

    // The entered Email_Address is retained in its field.
    expect(screen.getByLabelText('Email address')).toHaveValue(VALID_EMAIL)
  })
})

describe('SignUpScreen — backend validation (Req 2.7)', () => {
  it('shows the reported validation problem and keeps the person on the screen', async () => {
    const user = userEvent.setup()
    const outcome: FailureOutcome = {
      kind: 'validation',
      message: 'Some of the details entered are not valid. Please review them and try again.',
    }
    renderScreen({ authApi: fakeApi({ ok: false, outcome }) })

    await user.type(screen.getByLabelText('Email address'), VALID_EMAIL)
    await user.type(screen.getByLabelText('Password'), VALID_PASSWORD)
    await user.click(submitButton())

    expect(await screen.findByText(outcome.message)).toBeInTheDocument()
    // Still on the sign-up screen (its heading is present).
    expect(
      screen.getByRole('heading', { level: 1, name: /create your account/i }),
    ).toBeInTheDocument()
  })
})

describe('SignUpScreen — timeout / network (Req 2.9)', () => {
  it('shows a retryable message, retains the email, and re-enables submission', async () => {
    const user = userEvent.setup()
    const outcome: FailureOutcome = { kind: 'timeout-or-network' }
    renderScreen({ authApi: fakeApi({ ok: false, outcome }) })

    await user.type(screen.getByLabelText('Email address'), VALID_EMAIL)
    await user.type(screen.getByLabelText('Password'), VALID_PASSWORD)
    await user.click(submitButton())

    const expected = messageForOutcome(outcome, 'sign-up')
    expect(await screen.findByText(expected)).toBeInTheDocument()

    // Email retained and the submit control is enabled again for a retry.
    expect(screen.getByLabelText('Email address')).toHaveValue(VALID_EMAIL)
    await waitFor(() => expect(submitButton()).toBeEnabled())
    expect(submitButton()).not.toHaveAttribute('aria-busy')
  })
})

describe('SignUpScreen — in-progress guard (Req 2.8)', () => {
  it('disables the submit control while the register call is pending', async () => {
    const user = userEvent.setup()
    let resolve!: (value: AuthAckResult) => void
    const pending = new Promise<AuthAckResult>((res) => {
      resolve = res
    })
    const authApi = {
      register: vi.fn((): Promise<AuthAckResult> => pending),
      signInGoogle: vi.fn(
        async (): Promise<AuthSessionResult> => ({ ok: true, session: SESSION }),
      ),
    }
    renderScreen({ authApi })

    await user.type(screen.getByLabelText('Email address'), VALID_EMAIL)
    await user.type(screen.getByLabelText('Password'), VALID_PASSWORD)
    await user.click(submitButton())

    // While pending the control is disabled and marked busy, blocking a second submit.
    await waitFor(() => expect(submitButton()).toBeDisabled())
    expect(submitButton()).toHaveAttribute('aria-busy', 'true')
    await user.click(submitButton())
    expect(authApi.register).toHaveBeenCalledTimes(1)

    resolve({ ok: true })
    await waitFor(() => expect(submitButton()).toBeEnabled())
  })
})
