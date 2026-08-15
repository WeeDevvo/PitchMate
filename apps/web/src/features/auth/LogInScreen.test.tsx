/**
 * Unit tests for the Log_In_Screen branches (task 14.3).
 *
 * The screen (task 14.1) runs non-empty client-side validation before calling
 * `authApi.signIn`, then reports each backend outcome with the shared
 * components and surfaces an established Session to its parent via `onSession`.
 * These tests cover its required branches:
 *
 *   - validation-blocks-call: a missing (whitespace-only) email and a missing
 *     password each prevent the backend sign-in call, show the field-specific
 *     message, and move focus to the first offending control (Requirements 3.3,
 *     3.4, 14.7);
 *   - success → establish+navigate: on a returned Session, `onSession` is
 *     called with the returned session payload — the app-wiring layer
 *     establishes it and navigates (Requirement 3.5);
 *   - email-not-verified: the verification message is shown and the resend
 *     control (a link to `/verify-email`) is present (Requirement 3.7);
 *   - retain-email: after an auth-failure the entered email remains in its
 *     field (Requirement 3.6 retention);
 *   - in-progress guard: while the sign-in call is pending the submit control is
 *     disabled and a second concurrent submit is prevented (Requirement 3.8);
 *   - links present: links to the Sign_Up_Screen (`/signup`) and the
 *     Reset_Request_Screen (`/reset-password`) are rendered (Requirements 3.1,
 *     3.9).
 *
 * The screen owns no session logic, so the tests inject a fake `authApi` and a
 * Google flow seam. It links out via the shared `LinkButton` (which uses
 * react-router's `useNavigate`), so the screen is rendered inside a
 * `MemoryRouter`.
 *
 * Feature: web-auth-screens
 * Validates: Requirements 3.1, 3.3, 3.4, 3.5, 3.7, 3.8, 3.9, 14.7
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { GENERIC_AUTH_FAILURE, messageForOutcome } from './lib/errorMapping'
import type {
  AuthSessionPayload,
  AuthSessionResult,
  FailureOutcome,
} from './api/authApi'
import {
  LogInScreen,
  EMAIL_REQUIRED_MESSAGE,
  PASSWORD_REQUIRED_MESSAGE,
  RESEND_VERIFICATION_LABEL,
  SIGN_UP_PATH,
  RESET_REQUEST_PATH,
  VERIFY_EMAIL_PATH,
} from './LogInScreen'

/** A valid Email_Address and password that pass non-empty client validation. */
const VALID_EMAIL = 'player@pitch-mate.co.uk'
const VALID_PASSWORD = 'a-very-strong-password'

/** The session payload the sign-in success path returns. */
const SESSION: AuthSessionPayload = {
  accessToken: 'access-token-abc',
  refreshToken: 'refresh-token-xyz',
  expiresAtMs: 1_900_000_000_000,
}

/** Build a fake auth API with a controllable `signIn` result. */
function fakeApi(signInResult: AuthSessionResult) {
  return {
    signIn: vi.fn(async (): Promise<AuthSessionResult> => signInResult),
    signInGoogle: vi.fn(
      async (): Promise<AuthSessionResult> => ({ ok: true, session: SESSION }),
    ),
  }
}

/** Render the screen inside a router, allowing per-test overrides. */
function renderScreen(
  overrides: Partial<Parameters<typeof LogInScreen>[0]> = {},
) {
  const authApi = overrides.authApi ?? fakeApi({ ok: true, session: SESSION })
  const requestGoogleAssertion =
    overrides.requestGoogleAssertion ?? vi.fn(async () => null)
  const onSession = overrides.onSession ?? vi.fn()
  render(
    <MemoryRouter>
      <LogInScreen
        authApi={authApi}
        requestGoogleAssertion={requestGoogleAssertion}
        onSession={onSession}
        onGoogleFailure={overrides.onGoogleFailure}
      />
    </MemoryRouter>,
  )
  return { authApi, requestGoogleAssertion, onSession }
}

/**
 * The submit control (distinct from the Google control). Matches both the idle
 * label ("Log in") and the in-progress label ("Signing you in…") so it can be
 * located while a submission is pending.
 */
function submitButton() {
  return screen.getByRole('button', { name: /log in|signing you in/i })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LogInScreen — field & link presence (Req 3.1, 3.9)', () => {
  it('presents email, password, a submit control, the Google control, and the Sign_Up / Reset_Request links', () => {
    renderScreen()

    expect(screen.getByLabelText('Email address')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(submitButton()).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /continue with google/i }),
    ).toBeInTheDocument()

    // Requirement 3.9 / 3.1: links to the Sign_Up_Screen and Reset_Request_Screen.
    const signUpLink = screen.getByRole('link', { name: /create an account/i })
    const resetLink = screen.getByRole('link', { name: /forgot your password/i })
    expect(signUpLink).toHaveAttribute('href', SIGN_UP_PATH)
    expect(resetLink).toHaveAttribute('href', RESET_REQUEST_PATH)
  })
})

describe('LogInScreen — validation blocks the backend call (Req 3.3, 3.4, 14.7)', () => {
  it('does not call signIn and focuses the email field when the email is whitespace-only', async () => {
    const user = userEvent.setup()
    const { authApi } = renderScreen()

    // A whitespace-only email is treated as missing (trimmed to empty).
    await user.type(screen.getByLabelText('Email address'), '   ')
    await user.type(screen.getByLabelText('Password'), VALID_PASSWORD)
    await user.click(submitButton())

    expect(authApi.signIn).not.toHaveBeenCalled()
    expect(screen.getByText(EMAIL_REQUIRED_MESSAGE)).toBeInTheDocument()
    // Focus moved to the first offending control (Requirement 14.7).
    expect(screen.getByLabelText('Email address')).toHaveFocus()
  })

  it('does not call signIn and focuses the password field when the password is empty', async () => {
    const user = userEvent.setup()
    const { authApi } = renderScreen()

    // Valid email, but leave the password empty.
    await user.type(screen.getByLabelText('Email address'), VALID_EMAIL)
    await user.click(submitButton())

    expect(authApi.signIn).not.toHaveBeenCalled()
    expect(screen.getByText(PASSWORD_REQUIRED_MESSAGE)).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveFocus()
  })
})

describe('LogInScreen — success establishes + navigates via the parent (Req 3.5)', () => {
  it('calls signIn with the entered credentials and surfaces the returned session to onSession', async () => {
    const user = userEvent.setup()
    const { authApi, onSession } = renderScreen({
      authApi: fakeApi({ ok: true, session: SESSION }),
    })

    await user.type(screen.getByLabelText('Email address'), VALID_EMAIL)
    await user.type(screen.getByLabelText('Password'), VALID_PASSWORD)
    await user.click(submitButton())

    await waitFor(() => expect(authApi.signIn).toHaveBeenCalledTimes(1))
    expect(authApi.signIn).toHaveBeenCalledWith({
      email: VALID_EMAIL,
      password: VALID_PASSWORD,
    })

    // Requirement 3.5: the returned Session payload is handed to the parent,
    // which establishes it and navigates to the Redirect_Target.
    await waitFor(() => expect(onSession).toHaveBeenCalledTimes(1))
    expect(onSession).toHaveBeenCalledWith(SESSION)
  })
})

describe('LogInScreen — email not verified (Req 3.7)', () => {
  it('shows the verification message and a resend control linking to the Verify_Email_Screen', async () => {
    const user = userEvent.setup()
    const outcome: FailureOutcome = { kind: 'email-not-verified' }
    const { onSession } = renderScreen({
      authApi: fakeApi({ ok: false, outcome }),
    })

    await user.type(screen.getByLabelText('Email address'), VALID_EMAIL)
    await user.type(screen.getByLabelText('Password'), VALID_PASSWORD)
    await user.click(submitButton())

    const expected = messageForOutcome(outcome, 'log-in')
    expect(await screen.findByText(expected)).toBeInTheDocument()

    // The resend control is present and links to the Verify_Email_Screen.
    const resendLink = screen.getByRole('link', {
      name: RESEND_VERIFICATION_LABEL,
    })
    expect(resendLink).toHaveAttribute('href', VERIFY_EMAIL_PATH)

    // No session was established on this branch.
    expect(onSession).not.toHaveBeenCalled()
  })
})

describe('LogInScreen — generic auth failure retains the email (Req 3.6)', () => {
  it('shows the Generic_Auth_Failure message, retains the entered email, and stays on the screen', async () => {
    const user = userEvent.setup()
    const outcome: FailureOutcome = { kind: 'auth-failure' }
    const { onSession } = renderScreen({
      authApi: fakeApi({ ok: false, outcome }),
    })

    await user.type(screen.getByLabelText('Email address'), VALID_EMAIL)
    await user.type(screen.getByLabelText('Password'), VALID_PASSWORD)
    await user.click(submitButton())

    // The single credential-agnostic failure message is shown.
    expect(await screen.findByText(GENERIC_AUTH_FAILURE)).toBeInTheDocument()

    // The entered Email_Address is retained in its field for a retry.
    expect(screen.getByLabelText('Email address')).toHaveValue(VALID_EMAIL)
    expect(onSession).not.toHaveBeenCalled()
  })
})

describe('LogInScreen — in-progress guard (Req 3.8)', () => {
  it('disables the submit control while the sign-in call is pending and blocks a second submit', async () => {
    const user = userEvent.setup()
    let resolve!: (value: AuthSessionResult) => void
    const pending = new Promise<AuthSessionResult>((res) => {
      resolve = res
    })
    const authApi = {
      signIn: vi.fn((): Promise<AuthSessionResult> => pending),
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
    expect(authApi.signIn).toHaveBeenCalledTimes(1)

    // Once the call resolves, submission is re-enabled.
    resolve({ ok: true, session: SESSION })
    await waitFor(() => expect(submitButton()).toBeEnabled())
  })
})
