/**
 * Unit tests for the Reset_Confirm_Screen branches (task 16.2).
 *
 * The screen (task 16.1) reads the Password_Reset_Token from the URL query
 * string, runs the client-side Password_Policy check before calling
 * `authApi.redeemPasswordReset`, and reports each backend outcome with
 * non-disclosing copy plus the appropriate navigation control. These tests
 * cover its required branches:
 *
 *   - missing-token disabled state: with no token the missing-token message is
 *     shown, the submit control is disabled, a control to the
 *     Reset_Request_Screen is present, and the backend is never called
 *     (Requirement 6.4);
 *   - token-present field presence: an enabled new-password field and submit
 *     control (Requirement 6.1);
 *   - validation-blocks-call: a too-short or too-long password shows the policy
 *     message and prevents the backend call (Requirement 6.3);
 *   - success: a policy-satisfying password + a redeem success shows the
 *     confirmation and presents the proceed-to-login control (Requirement 6.5);
 *   - invalid-or-expired: a redeem returning `invalid-or-expired-token` shows
 *     that message and a control back to the Reset_Request_Screen
 *     (Requirement 6.6);
 *   - backend password-strength validation: a redeem returning a `validation`
 *     outcome shows the reported problem and preserves the entered password
 *     (Requirement 6.7);
 *   - timeout/network: a redeem returning `timeout-or-network` shows a retryable
 *     message, preserves the entered password, and re-enables submission
 *     (Requirement 6.8).
 *
 * The screen owns no session logic, so the tests inject a fake `authApi` and
 * supply the token via the `search` prop. It links to the Reset_Request_Screen
 * and Log_In_Screen via the shared `LinkButton` (which uses react-router's
 * `useNavigate`), so the screen is rendered inside a `MemoryRouter`.
 *
 * Feature: web-auth-screens
 * Validates: Requirements 6.1, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import {
  messageForOutcome,
  PASSWORD_POLICY_VALIDATION_MESSAGE,
} from './lib/errorMapping'
import type { AuthAckResult } from './api/authApi'
import {
  ResetConfirmScreen,
  MISSING_TOKEN_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
  PASSWORD_TOO_LONG_MESSAGE,
  REQUEST_NEW_LINK_LABEL,
  PROCEED_TO_LOG_IN_LABEL,
  RESET_REQUEST_PATH,
  LOG_IN_PATH,
} from './ResetConfirmScreen'

/** A search string carrying a present Password_Reset_Token. */
const TOKEN_SEARCH = '?token=abc123'

/** A password that satisfies the Password_Policy band (12–128 characters). */
const VALID_PASSWORD = 'correct horse battery staple'

/** The screen-appropriate success copy from the pure error-mapping layer. */
const SUCCESS_MESSAGE = messageForOutcome({ kind: 'success' }, 'reset-confirm')
/** The screen-appropriate invalid-or-expired copy. */
const INVALID_OR_EXPIRED_MESSAGE = messageForOutcome(
  { kind: 'invalid-or-expired-token' },
  'reset-confirm',
)
/** The screen-appropriate timeout/network copy. */
const TIMEOUT_MESSAGE = messageForOutcome(
  { kind: 'timeout-or-network' },
  'reset-confirm',
)

/** Build a fake auth API with a controllable `redeemPasswordReset` result. */
function fakeApi(result: AuthAckResult = { ok: true }) {
  return {
    redeemPasswordReset: vi.fn(async (): Promise<AuthAckResult> => result),
  }
}

/** Render the screen inside a router, allowing per-test overrides. */
function renderScreen(
  overrides: Partial<Parameters<typeof ResetConfirmScreen>[0]> = {},
) {
  const authApi = overrides.authApi ?? fakeApi()
  const search = overrides.search ?? TOKEN_SEARCH
  render(
    <MemoryRouter>
      <ResetConfirmScreen authApi={authApi} search={search} />
    </MemoryRouter>,
  )
  return { authApi }
}

/**
 * The submit control. Matches both the idle label ("Change password") and the
 * in-progress label ("Changing your password…") so it can be located while a
 * submission is pending.
 */
function submitButton() {
  return screen.getByRole('button', {
    name: /change password|changing your password/i,
  })
}

/** The new-password field. */
function passwordField() {
  return screen.getByLabelText('Password')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ResetConfirmScreen — missing-token disabled state (Req 6.4)', () => {
  it('shows the missing-token message, disables submit, links to reset request, and never calls the backend', async () => {
    const user = userEvent.setup()
    const { authApi } = renderScreen({ search: '' })

    // The invalid/incomplete message is shown.
    expect(screen.getByText(MISSING_TOKEN_MESSAGE)).toBeInTheDocument()

    // No enabled submit control (the submit is disabled).
    expect(submitButton()).toBeDisabled()

    // A control that navigates to the Reset_Request_Screen is present.
    const requestLink = screen.getByRole('link', {
      name: REQUEST_NEW_LINK_LABEL,
    })
    expect(requestLink).toHaveAttribute('href', RESET_REQUEST_PATH)

    // Attempting to submit does not reach the backend.
    await user.click(submitButton())
    expect(authApi.redeemPasswordReset).not.toHaveBeenCalled()
  })
})

describe('ResetConfirmScreen — token present renders the form (Req 6.1)', () => {
  it('presents an enabled new-password field and submit control', () => {
    renderScreen()

    expect(passwordField()).toBeInTheDocument()
    expect(passwordField()).toBeEnabled()
    expect(submitButton()).toBeEnabled()
  })
})

describe('ResetConfirmScreen — validation blocks the backend call (Req 6.3)', () => {
  it('does not call redeemPasswordReset and shows the too-short message for a password below the minimum', async () => {
    const user = userEvent.setup()
    const { authApi } = renderScreen()

    // 11 characters — one below the inclusive minimum of 12.
    await user.type(passwordField(), 'short-pass1')
    await user.click(submitButton())

    expect(authApi.redeemPasswordReset).not.toHaveBeenCalled()
    expect(screen.getByText(PASSWORD_TOO_SHORT_MESSAGE)).toBeInTheDocument()
    // Focus moves to the offending control (Requirement 14.7).
    expect(passwordField()).toHaveFocus()
  })

  it('does not call redeemPasswordReset and shows the too-long message for a password above the maximum', async () => {
    const user = userEvent.setup()
    const { authApi } = renderScreen()

    // 129 characters — one above the inclusive maximum of 128. Pasted rather
    // than typed to keep the test fast.
    const overLong = 'a'.repeat(129)
    passwordField().focus()
    await user.paste(overLong)
    await user.click(submitButton())

    expect(authApi.redeemPasswordReset).not.toHaveBeenCalled()
    expect(screen.getByText(PASSWORD_TOO_LONG_MESSAGE)).toBeInTheDocument()
    expect(passwordField()).toHaveFocus()
  })
})

describe('ResetConfirmScreen — success (Req 6.5)', () => {
  it('calls redeemPasswordReset with the token and new password, then confirms and offers the proceed-to-login control', async () => {
    const user = userEvent.setup()
    const { authApi } = renderScreen({ authApi: fakeApi({ ok: true }) })

    await user.type(passwordField(), VALID_PASSWORD)
    await user.click(submitButton())

    await waitFor(() =>
      expect(authApi.redeemPasswordReset).toHaveBeenCalledTimes(1),
    )
    expect(authApi.redeemPasswordReset).toHaveBeenCalledWith({
      token: 'abc123',
      newPassword: VALID_PASSWORD,
    })

    // The confirmation is shown...
    expect(await screen.findByText(SUCCESS_MESSAGE)).toBeInTheDocument()
    // ...and the proceed-to-login control is presented.
    const loginLink = screen.getByRole('link', { name: PROCEED_TO_LOG_IN_LABEL })
    expect(loginLink).toHaveAttribute('href', LOG_IN_PATH)
    // No reset-request control on the success path.
    expect(
      screen.queryByRole('link', { name: REQUEST_NEW_LINK_LABEL }),
    ).not.toBeInTheDocument()
  })
})

describe('ResetConfirmScreen — invalid-or-expired token (Req 6.6)', () => {
  it('shows the invalid-or-expired message and a control back to the Reset_Request_Screen', async () => {
    const user = userEvent.setup()
    const { authApi } = renderScreen({
      authApi: fakeApi({
        ok: false,
        outcome: { kind: 'invalid-or-expired-token' },
      }),
    })

    await user.type(passwordField(), VALID_PASSWORD)
    await user.click(submitButton())

    await waitFor(() =>
      expect(authApi.redeemPasswordReset).toHaveBeenCalledTimes(1),
    )

    expect(
      await screen.findByText(INVALID_OR_EXPIRED_MESSAGE),
    ).toBeInTheDocument()
    const requestLink = screen.getByRole('link', {
      name: REQUEST_NEW_LINK_LABEL,
    })
    expect(requestLink).toHaveAttribute('href', RESET_REQUEST_PATH)
    // No proceed-to-login control when the token was rejected.
    expect(
      screen.queryByRole('link', { name: PROCEED_TO_LOG_IN_LABEL }),
    ).not.toBeInTheDocument()
  })
})

describe('ResetConfirmScreen — backend password-strength validation (Req 6.7)', () => {
  it('shows the reported validation problem and preserves the entered password', async () => {
    const user = userEvent.setup()
    const { authApi } = renderScreen({
      authApi: fakeApi({
        ok: false,
        outcome: {
          kind: 'validation',
          message: PASSWORD_POLICY_VALIDATION_MESSAGE,
        },
      }),
    })

    await user.type(passwordField(), VALID_PASSWORD)
    await user.click(submitButton())

    await waitFor(() =>
      expect(authApi.redeemPasswordReset).toHaveBeenCalledTimes(1),
    )

    // The reported (controlled) validation problem is shown...
    expect(
      await screen.findByText(PASSWORD_POLICY_VALIDATION_MESSAGE),
    ).toBeInTheDocument()
    // ...and the entered password is preserved in the field.
    expect(passwordField()).toHaveValue(VALID_PASSWORD)
    // The person stays on the screen: no navigation controls appear.
    expect(
      screen.queryByRole('link', { name: PROCEED_TO_LOG_IN_LABEL }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: REQUEST_NEW_LINK_LABEL }),
    ).not.toBeInTheDocument()
  })
})

describe('ResetConfirmScreen — timeout / network (Req 6.8)', () => {
  it('shows a retryable message, preserves the entered password, and re-enables submission', async () => {
    const user = userEvent.setup()
    const { authApi } = renderScreen({
      authApi: fakeApi({
        ok: false,
        outcome: { kind: 'timeout-or-network' },
      }),
    })

    await user.type(passwordField(), VALID_PASSWORD)
    await user.click(submitButton())

    await waitFor(() =>
      expect(authApi.redeemPasswordReset).toHaveBeenCalledTimes(1),
    )

    // The retryable message is shown...
    expect(await screen.findByText(TIMEOUT_MESSAGE)).toBeInTheDocument()
    // ...the entered password is preserved...
    expect(passwordField()).toHaveValue(VALID_PASSWORD)
    // ...and submission is re-enabled for a retry.
    expect(submitButton()).toBeEnabled()
    expect(submitButton()).not.toHaveAttribute('aria-busy')
  })
})
