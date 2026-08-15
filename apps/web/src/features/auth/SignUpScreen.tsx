/**
 * SignUpScreen — the Sign_Up_Screen at route `/signup` (Requirement 2).
 *
 * A thin presentational screen composed from the shared auth components. It
 * lets a visitor create an account with an Email_Address and a password, or
 * begin Google sign-in. All the fiddly decisions live elsewhere: email/password
 * validity comes from the pure `lib/` validators, and every backend outcome is
 * shaped and given non-disclosing copy by `lib/errorMapping`. The screen only
 * wires those pieces to the fields and controls.
 *
 * Behavioural contract:
 *
 *   - Presents an Email_Address field, a password field, a submit control, and
 *     the Google_Sign_In_Control (Requirements 2.1, 4.1).
 *   - **Client validation before any backend call (Requirements 2.3, 2.4).**
 *     On submit the email is validated with `validateEmail` and the password
 *     with `validatePassword` *before* `authApi.register` is called. If either
 *     fails, a field-specific validation message is shown, focus moves to the
 *     first offending control (Requirement 14.7), and the backend is not called.
 *   - **Success (Requirement 2.5).** Confirms the account was created and that a
 *     verification message was sent to the entered Email_Address.
 *   - **Already registered (Requirement 2.6).** Invites the person to sign in or
 *     reset the password and retains the entered Email_Address.
 *   - **Backend validation (Requirement 2.7).** Shows the reported validation
 *     problem (controlled copy from the error-mapping layer) and keeps the
 *     person on the screen.
 *   - **In-progress guard (Requirement 2.8).** While the register call is in
 *     flight (up to the facade's 30s timeout) the submit control shows an
 *     in-progress state and is disabled, preventing a second concurrent submit.
 *   - **Timeout / network (Requirement 2.9).** Shows a retryable message,
 *     retains the entered Email_Address, and re-enables submission.
 *
 * The screen owns no session logic and does not navigate: Google sign-in
 * surfaces its established session to the parent via `onGoogleSession`, so app
 * wiring can establish the Session through the Session_Manager and navigate to
 * the resolved Redirect_Target (task 19).
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 4.1, 4.2, 4.3, 14.7
 */
import { useRef, useState, type FormEvent } from 'react'
import { AuthLayout } from './components/AuthLayout'
import { EmailField } from './components/EmailField'
import { PasswordField } from './components/PasswordField'
import { SubmitButton } from './components/SubmitButton'
import { LiveRegion } from './components/LiveRegion'
import { GoogleSignInControl } from './components/GoogleSignInControl'
import {
  validateEmail,
  type EmailValidation,
} from './lib/emailValidation'
import {
  validatePassword,
  PASSWORD_MIN,
  PASSWORD_MAX,
  type PasswordValidation,
} from './lib/passwordPolicy'
import { messageForOutcome } from './lib/errorMapping'
import type {
  AuthApiFacade,
  AuthSessionPayload,
  FailureOutcome,
} from './api/authApi'

/** The screen heading (the single `h1`, rendered by AuthLayout). */
export const SIGN_UP_HEADING = 'Create your account'

// --- Client-side validation copy (UX only; the server result always wins) ---

/** Shown when the Email_Address field is empty at submit (Requirement 2.4). */
export const EMAIL_REQUIRED_MESSAGE = 'Enter your email address.'
/** Shown when the Email_Address exceeds the allowed length (Requirement 2.4). */
export const EMAIL_TOO_LONG_MESSAGE =
  'Email address must be 254 characters or fewer.'
/** Shown when the Email_Address is malformed (Requirement 2.4). */
export const EMAIL_MALFORMED_MESSAGE = 'Enter a valid email address.'
/** Shown when the password is shorter than the policy minimum (Requirement 2.3). */
export const PASSWORD_TOO_SHORT_MESSAGE = `Password must be at least ${PASSWORD_MIN} characters.`
/** Shown when the password is longer than the policy maximum (Requirement 2.3). */
export const PASSWORD_TOO_LONG_MESSAGE = `Password must be ${PASSWORD_MAX} characters or fewer.`

/** Map an email validation failure to its field message. */
function emailErrorMessage(result: Extract<EmailValidation, { ok: false }>): string {
  switch (result.reason) {
    case 'empty':
      return EMAIL_REQUIRED_MESSAGE
    case 'too-long':
      return EMAIL_TOO_LONG_MESSAGE
    case 'malformed':
      return EMAIL_MALFORMED_MESSAGE
  }
}

/** Map a password validation failure to its field message. */
function passwordErrorMessage(
  result: Extract<PasswordValidation, { ok: false }>,
): string {
  return result.reason === 'too-short'
    ? PASSWORD_TOO_SHORT_MESSAGE
    : PASSWORD_TOO_LONG_MESSAGE
}

export interface SignUpScreenProps {
  /**
   * The auth Api_Client facade. `register` creates the account; `signInGoogle`
   * is relayed by the {@link GoogleSignInControl}. No credential/assertion
   * validation happens here — the facade only relays (Requirement 12.3).
   */
  authApi: Pick<AuthApiFacade, 'register' | 'signInGoogle'>
  /**
   * The Google (OIDC) browser-flow seam forwarded to the
   * {@link GoogleSignInControl}. Resolves to a Google_Assertion, or `null` when
   * the flow is cancelled / yields nothing (Requirement 4.4).
   */
  requestGoogleAssertion: () => Promise<string | null>
  /**
   * Called with the established session payload when Google sign-in returns a
   * Session (Requirement 4.3). App wiring establishes it and navigates.
   */
  onGoogleSession: (session: AuthSessionPayload) => void
  /** Optional: notified when Google sign-in fails (Requirements 4.5, 4.8). */
  onGoogleFailure?: (outcome: FailureOutcome) => void
}

/** The kind of message currently shown in the status live region. */
type Status =
  | { readonly kind: 'none' }
  | { readonly kind: 'success'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string }

/**
 * The Sign_Up_Screen. Renders the sign-up form and the Google control, runs
 * client validation before calling the backend, and reports each outcome.
 */
export function SignUpScreen({
  authApi,
  requestGoogleAssertion,
  onGoogleSession,
  onGoogleFailure,
}: SignUpScreenProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'none' })

  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    // Guard against a second concurrent submission (Requirement 2.8). The submit
    // button is also disabled while pending; this is belt-and-braces.
    if (pending) {
      return
    }

    // Client-side validation BEFORE any backend call (Requirements 2.3, 2.4).
    const emailResult = validateEmail(email)
    const passwordResult = validatePassword(password)

    const nextEmailError = emailResult.ok
      ? null
      : emailErrorMessage(emailResult)
    const nextPasswordError = passwordResult.ok
      ? null
      : passwordErrorMessage(passwordResult)

    setEmailError(nextEmailError)
    setPasswordError(nextPasswordError)

    if (!emailResult.ok || !passwordResult.ok) {
      // Focus the first offending control (Requirement 14.7).
      if (!emailResult.ok) {
        emailRef.current?.focus()
      } else {
        passwordRef.current?.focus()
      }
      // Do not call the backend when client validation fails.
      setStatus({ kind: 'none' })
      return
    }

    // Both fields valid — call the backend registration endpoint (Requirement 2.2).
    setStatus({ kind: 'none' })
    setPending(true)
    try {
      const result = await authApi.register({
        email: emailResult.value,
        password,
      })

      if (result.ok) {
        // Requirement 2.5: confirm account creation + verification message.
        setStatus({
          kind: 'success',
          message: messageForOutcome({ kind: 'success' }, 'sign-up'),
        })
        return
      }

      // Requirements 2.6, 2.7, 2.9 (+ generic): shaped, non-disclosing copy.
      // The entered Email_Address is retained in its field on every branch
      // because the field is controlled and never cleared here.
      setStatus({
        kind: 'error',
        message: messageForOutcome(result.outcome, 'sign-up'),
      })
    } finally {
      // Always re-enable submission once the call resolves (Requirement 2.9).
      setPending(false)
    }
  }

  return (
    <AuthLayout heading={SIGN_UP_HEADING}>
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <EmailField
          value={email}
          onValueChange={setEmail}
          error={emailError}
          inputRef={emailRef}
          autoComplete="email"
          required
        />
        <PasswordField
          value={password}
          onValueChange={setPassword}
          error={passwordError}
          inputRef={passwordRef}
          autoComplete="new-password"
          required
        />
        <SubmitButton pending={pending} pendingLabel="Creating your account…">
          Create account
        </SubmitButton>
      </form>

      <LiveRegion
        message={status.kind === 'none' ? null : status.message}
        politeness={status.kind === 'error' ? 'assertive' : 'polite'}
      />

      <GoogleSignInControl
        requestGoogleAssertion={requestGoogleAssertion}
        authApi={authApi}
        onSession={onGoogleSession}
        onFailure={onGoogleFailure}
      />
    </AuthLayout>
  )
}

export default SignUpScreen
