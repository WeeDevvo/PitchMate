/**
 * ResetConfirmScreen — the Reset_Confirm_Screen at route
 * `/reset-password/confirm`, where a person arriving from a password-reset link
 * sets a new password using a Password_Reset_Token (Requirement 6).
 *
 * A thin presentational screen composed from the shared auth components,
 * mirroring the {@link SignUpScreen} / {@link LogInScreen} / {@link
 * ResetRequestScreen} structure. The fiddly decisions live elsewhere: the
 * Password_Reset_Token is read from the URL query string by the pure
 * `lib/tokenFromUrl` extractor, the client-side Password_Policy check comes from
 * the pure `lib/passwordPolicy` validator, and every backend outcome is shaped
 * and given non-disclosing copy by `lib/errorMapping`. The screen only wires
 * those pieces to the field and controls.
 *
 * Behavioural contract:
 *
 *   - **Token from the URL (Requirements 1.5, 6.1).** On open the screen reads
 *     the `token` value from the request URL query string via `extractToken`.
 *     When a token is present it presents a new-password field (accepting the
 *     Password_Policy band of 12–128 characters) and a submit control.
 *   - **Missing token (Requirement 6.4).** When opened with no token present,
 *     the screen shows an invalid/incomplete message, does NOT present an
 *     enabled submit control (the submit is disabled), and presents a control
 *     that navigates to the Reset_Request_Screen.
 *   - **Client validation before any backend call (Requirement 6.3).** On
 *     submit the new password is validated with `validatePassword` *before*
 *     `authApi.redeemPasswordReset` is called. If it is shorter than 12 or
 *     longer than 128 characters, a field-specific message identifying the
 *     unmet Password_Policy is shown, focus moves to the password control
 *     (Requirement 14.7), and the backend is NOT called.
 *   - **Redeem (Requirement 6.2).** A password satisfying the Password_Policy is
 *     relayed with the token to the backend password-reset redeem endpoint.
 *   - **Success (Requirement 6.5).** Confirms the password was changed and
 *     presents a control to proceed to the Log_In_Screen.
 *   - **Invalid-or-expired token (Requirement 6.6).** Shows that the reset link
 *     is invalid or expired and presents a control to open the
 *     Reset_Request_Screen.
 *   - **Backend password-strength validation (Requirement 6.7).** Shows the
 *     reported validation problem (controlled copy from the error-mapping
 *     layer), preserves the entered password, and keeps the person on the
 *     screen.
 *   - **Timeout / network (Requirement 6.8).** Shows a retryable message,
 *     preserves the entered password, and re-enables submission (the facade
 *     bounds the redeem call by a 30-second timeout).
 *   - **In-progress guard (Requirement 6.9).** While the redeem call is in
 *     flight the submit control shows an in-progress state and is disabled,
 *     preventing a second concurrent submission.
 *
 * The screen owns no session logic. The controls to the Reset_Request_Screen
 * and the Log_In_Screen use client-side navigation via the shared {@link
 * LinkButton} (Requirement 1.4), so this screen is rendered within a router;
 * the token is read from the router location by default (overridable via the
 * `search` prop for testing).
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 14.7
 */
import { useMemo, useRef, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { AuthLayout } from './components/AuthLayout'
import { PasswordField } from './components/PasswordField'
import { SubmitButton } from './components/SubmitButton'
import { LiveRegion } from './components/LiveRegion'
import { LinkButton } from './components/LinkButton'
import { extractToken } from './lib/tokenFromUrl'
import {
  validatePassword,
  PASSWORD_MIN,
  PASSWORD_MAX,
  type PasswordValidation,
} from './lib/passwordPolicy'
import { messageForOutcome } from './lib/errorMapping'
import type { AuthApiFacade } from './api/authApi'

/** The screen heading (the single `h1`, rendered by AuthLayout). */
export const RESET_CONFIRM_HEADING = 'Choose a new password'

// --- In-app destinations linked from the Reset_Confirm_Screen ---------------

/** Route path of the Reset_Request_Screen (Requirements 6.4, 6.6). */
export const RESET_REQUEST_PATH = '/reset-password'
/** Route path of the Log_In_Screen (Requirement 6.5). */
export const LOG_IN_PATH = '/login'

// --- User-facing copy -------------------------------------------------------

/**
 * Shown when the screen is opened with no Password_Reset_Token in the URL
 * (Requirement 6.4). It states the link is invalid or incomplete without
 * revealing anything further.
 */
export const MISSING_TOKEN_MESSAGE =
  'This password reset link is invalid or incomplete. Please request a new one.'

/** Shown when the new password is shorter than the policy minimum (Requirement 6.3). */
export const PASSWORD_TOO_SHORT_MESSAGE = `Password must be at least ${PASSWORD_MIN} characters.`
/** Shown when the new password is longer than the policy maximum (Requirement 6.3). */
export const PASSWORD_TOO_LONG_MESSAGE = `Password must be ${PASSWORD_MAX} characters or fewer.`

/** Label for the control that opens the Reset_Request_Screen (Requirements 6.4, 6.6). */
export const REQUEST_NEW_LINK_LABEL = 'Request a new reset link'
/** Label for the control that proceeds to the Log_In_Screen (Requirement 6.5). */
export const PROCEED_TO_LOG_IN_LABEL = 'Continue to log in'

/** Map a password validation failure to its field message. */
function passwordErrorMessage(
  result: Extract<PasswordValidation, { ok: false }>,
): string {
  return result.reason === 'too-short'
    ? PASSWORD_TOO_SHORT_MESSAGE
    : PASSWORD_TOO_LONG_MESSAGE
}

export interface ResetConfirmScreenProps {
  /**
   * The auth Api_Client facade. `redeemPasswordReset` relays the
   * Password_Reset_Token and the new password to the backend redeem endpoint;
   * the facade applies the 30-second timeout and shapes every outcome. No auth
   * decision happens here — the facade only relays (Requirement 12.3).
   */
  authApi: Pick<AuthApiFacade, 'redeemPasswordReset'>
  /**
   * The URL query string to read the Password_Reset_Token from. Defaults to the
   * router location's `search` so the token is read from the request URL
   * (Requirements 1.5, 6.1); injectable so tests can supply a search string
   * directly.
   */
  search?: string
}

/** The kind of message currently shown in the status live region. */
type Status =
  | { readonly kind: 'none' }
  | { readonly kind: 'success'; readonly message: string }
  | { readonly kind: 'invalid-or-expired'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string }

/**
 * The Reset_Confirm_Screen. Reads the Password_Reset_Token from the URL, runs
 * the client-side Password_Policy check before calling the backend, and reports
 * each outcome with non-disclosing copy plus the appropriate navigation control.
 */
export function ResetConfirmScreen({
  authApi,
  search,
}: ResetConfirmScreenProps) {
  const location = useLocation()
  // Read the Password_Reset_Token from the supplied search string, or the
  // router location's search when none is supplied (Requirements 1.5, 6.1).
  const searchString = search ?? location.search
  const token = useMemo(() => extractToken(searchString), [searchString])
  const hasToken = token !== null

  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'none' })

  const passwordRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    // Without a token there is nothing to redeem (Requirement 6.4); the submit
    // control is disabled, but guard here too.
    if (token === null) {
      return
    }

    // Guard against a second concurrent submission (Requirement 6.9). The submit
    // button is also disabled while pending; this is belt-and-braces.
    if (pending) {
      return
    }

    // Client-side Password_Policy check BEFORE any backend call (Requirement 6.3).
    const passwordResult = validatePassword(password)
    if (!passwordResult.ok) {
      setPasswordError(passwordErrorMessage(passwordResult))
      // Focus the offending control (Requirement 14.7).
      passwordRef.current?.focus()
      // Do not call the backend when client validation fails, and clear any
      // prior status so a validation error is not confused with a backend one.
      setStatus({ kind: 'none' })
      return
    }

    setPasswordError(null)

    // A policy-satisfying password — relay the token and new password to the
    // backend redeem endpoint (Requirement 6.2). The facade bounds this by a
    // 30-second timeout.
    setStatus({ kind: 'none' })
    setPending(true)
    try {
      const result = await authApi.redeemPasswordReset({
        token,
        newPassword: password,
      })

      if (result.ok) {
        // Requirement 6.5: confirm the change and offer the proceed-to-login
        // control (rendered below the form).
        setStatus({
          kind: 'success',
          message: messageForOutcome({ kind: 'success' }, 'reset-confirm'),
        })
        return
      }

      // Requirement 6.6: an invalid-or-expired token shows its message and a
      // control back to the Reset_Request_Screen (rendered below the form).
      if (result.outcome.kind === 'invalid-or-expired-token') {
        setStatus({
          kind: 'invalid-or-expired',
          message: messageForOutcome(result.outcome, 'reset-confirm'),
        })
        return
      }

      // Requirements 6.7, 6.8 (+ generic): shaped, non-disclosing copy. A
      // backend password-strength validation problem, a timeout/network
      // failure, or an unmapped result keeps the person on the screen. The
      // entered password is preserved because the field is controlled and never
      // cleared here.
      setStatus({
        kind: 'error',
        message: messageForOutcome(result.outcome, 'reset-confirm'),
      })
    } finally {
      // Always re-enable submission once the call resolves (Requirement 6.8).
      setPending(false)
    }
  }

  // The message currently shown: the static missing-token message when no token
  // is present (Requirement 6.4), otherwise the latest backend/status message.
  const shownMessage = hasToken
    ? status.kind === 'none'
      ? null
      : status.message
    : MISSING_TOKEN_MESSAGE

  // A success announcement is polite; every problem announcement is assertive.
  const politeness = status.kind === 'success' ? 'polite' : 'assertive'

  // Present the Reset_Request control when there is no usable token to redeem —
  // either none was supplied (Requirement 6.4) or the backend reported the token
  // invalid or expired (Requirement 6.6).
  const showResetRequestLink =
    !hasToken || status.kind === 'invalid-or-expired'
  // Present the proceed-to-login control only once the password was changed
  // (Requirement 6.5).
  const showProceedToLogIn = status.kind === 'success'

  return (
    <AuthLayout heading={RESET_CONFIRM_HEADING}>
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <PasswordField
          value={password}
          onValueChange={setPassword}
          error={passwordError}
          inputRef={passwordRef}
          autoComplete="new-password"
          required
          // Without a token the field cannot be redeemed; keep it disabled so
          // the form presents no usable entry point (Requirement 6.4).
          disabled={!hasToken}
        />
        <SubmitButton
          pending={pending}
          // No enabled submit control when there is no token (Requirement 6.4).
          disabled={!hasToken}
          pendingLabel="Changing your password…"
        >
          Change password
        </SubmitButton>
      </form>

      <LiveRegion message={shownMessage} politeness={politeness} />

      {(showResetRequestLink || showProceedToLogIn) && (
        <nav className="auth-links" aria-label="Other options">
          {showProceedToLogIn && (
            <LinkButton to={LOG_IN_PATH}>{PROCEED_TO_LOG_IN_LABEL}</LinkButton>
          )}
          {showResetRequestLink && (
            <LinkButton to={RESET_REQUEST_PATH}>
              {REQUEST_NEW_LINK_LABEL}
            </LinkButton>
          )}
        </nav>
      )}
    </AuthLayout>
  )
}

export default ResetConfirmScreen
