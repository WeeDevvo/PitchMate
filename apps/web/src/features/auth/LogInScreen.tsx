/**
 * LogInScreen — the Log_In_Screen at route `/login` (Requirement 3).
 *
 * A thin presentational screen composed from the shared auth components,
 * mirroring the {@link SignUpScreen} structure. It lets a registered person
 * sign in with an Email_Address and a password, or begin Google sign-in, and it
 * links out to the Sign_Up_Screen and the Reset_Request_Screen. Every fiddly
 * decision lives elsewhere: backend outcomes are shaped and given
 * non-disclosing copy by `lib/errorMapping`, so the screen cannot leak which
 * credential was wrong. The screen only wires those pieces to the fields and
 * controls.
 *
 * Behavioural contract:
 *
 *   - Presents an Email_Address field, a password field, a submit control, the
 *     Google_Sign_In_Control, and links to the Sign_Up_Screen and the
 *     Reset_Request_Screen (Requirements 3.1, 3.9, 4.1).
 *   - **Non-empty client validation before any backend call (Requirements 3.3,
 *     3.4).** On submit, if the Email_Address contains no non-whitespace
 *     character a field-specific "email missing" message is shown; if the
 *     password has zero length a "password missing" message is shown. Either
 *     failure moves focus to the first offending control (Requirement 14.7) and
 *     the backend is not called. Unlike sign-up, no email *format* check gates
 *     the call — the server is the single source of truth for sign-in.
 *   - **Success (Requirement 3.5).** On a returned Session the payload is
 *     surfaced to the parent via `onSession`, which establishes it through the
 *     Session_Manager and navigates to the resolved Redirect_Target (task 19).
 *   - **Generic_Auth_Failure (Requirement 3.6).** On an authentication-failure
 *     result the single Generic_Auth_Failure message is shown (never revealing
 *     whether the Email_Address or the password was wrong), the entered
 *     Email_Address is retained, and the person stays on the screen.
 *   - **Email not verified (Requirement 3.7).** On an email-not-verified result
 *     a message that the Email_Address must be verified is shown alongside a
 *     control to obtain a new verification message (the Verify_Email_Screen,
 *     where an unauthenticated request-new-verification flow lives).
 *   - **In-progress guard (Requirement 3.8).** While the sign-in call is in
 *     flight the submit control shows an in-progress state and is disabled,
 *     preventing a second concurrent submit.
 *
 * The screen owns no session logic and does not navigate on success itself:
 * both email/password sign-in and Google sign-in surface their established
 * Session to the parent via `onSession`, so app wiring establishes the Session
 * through the Session_Manager and navigates to the resolved Redirect_Target
 * (task 19). The Sign_Up / Reset_Request links use client-side navigation via
 * the shared {@link LinkButton} (Requirement 1.4), so this screen is rendered
 * within a router.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 4.1, 4.2, 4.3, 14.7
 */
import { useRef, useState, type FormEvent } from 'react'
import { AuthLayout } from './components/AuthLayout'
import { EmailField } from './components/EmailField'
import { PasswordField } from './components/PasswordField'
import { SubmitButton } from './components/SubmitButton'
import { LiveRegion } from './components/LiveRegion'
import { LinkButton } from './components/LinkButton'
import { GoogleSignInControl } from './components/GoogleSignInControl'
import { messageForOutcome } from './lib/errorMapping'
import type {
  AuthApiFacade,
  AuthSessionPayload,
  FailureOutcome,
} from './api/authApi'

/** The screen heading (the single `h1`, rendered by AuthLayout). */
export const LOG_IN_HEADING = 'Log in to PitchMate'

// --- In-app destinations linked from the Log_In_Screen ----------------------

/** Route path of the Sign_Up_Screen (Requirement 3.9). */
export const SIGN_UP_PATH = '/signup'
/** Route path of the Reset_Request_Screen (Requirement 3.9). */
export const RESET_REQUEST_PATH = '/reset-password'
/**
 * Route path of the Verify_Email_Screen. The email-not-verified branch links
 * here because the backend resend endpoint requires an authenticated caller;
 * the Verify_Email_Screen owns the unauthenticated request-new-verification
 * flow (Requirements 3.7, 7.6, 7.7).
 */
export const VERIFY_EMAIL_PATH = '/verify-email'

// --- Client-side validation copy (UX only; the server result always wins) ---

/** Shown when the Email_Address field is missing at submit (Requirement 3.3). */
export const EMAIL_REQUIRED_MESSAGE = 'Enter your email address.'
/** Shown when the password field is missing at submit (Requirement 3.4). */
export const PASSWORD_REQUIRED_MESSAGE = 'Enter your password.'

/** Label for the control that starts a new verification (Requirement 3.7). */
export const RESEND_VERIFICATION_LABEL = 'Get a new verification email'

export interface LogInScreenProps {
  /**
   * The auth Api_Client facade. `signIn` performs email + password sign-in;
   * `signInGoogle` is relayed by the {@link GoogleSignInControl}. No credential
   * or assertion validation happens here — the facade only relays
   * (Requirement 12.3).
   */
  authApi: Pick<AuthApiFacade, 'signIn' | 'signInGoogle'>
  /**
   * The Google (OIDC) browser-flow seam forwarded to the
   * {@link GoogleSignInControl}. Resolves to a Google_Assertion, or `null` when
   * the flow is cancelled / yields nothing (Requirement 4.4).
   */
  requestGoogleAssertion: () => Promise<string | null>
  /**
   * Called with the established session payload when either email + password
   * sign-in or Google sign-in returns a Session (Requirements 3.5, 4.3). App
   * wiring establishes it through the Session_Manager and navigates to the
   * resolved Redirect_Target (task 19).
   */
  onSession: (session: AuthSessionPayload) => void
  /** Optional: notified when Google sign-in fails (Requirements 4.5, 4.8). */
  onGoogleFailure?: (outcome: FailureOutcome) => void
}

/** The kind of message currently shown in the status live region. */
type Status =
  | { readonly kind: 'none' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'email-not-verified'; readonly message: string }

/**
 * The Log_In_Screen. Renders the sign-in form, the Google control, and the
 * Sign_Up / Reset_Request links; runs non-empty client validation before
 * calling the backend; and reports each outcome with non-disclosing copy.
 */
export function LogInScreen({
  authApi,
  requestGoogleAssertion,
  onSession,
  onGoogleFailure,
}: LogInScreenProps) {
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

    // Guard against a second concurrent submission (Requirement 3.8). The submit
    // button is also disabled while pending; this is belt-and-braces.
    if (pending) {
      return
    }

    // Non-empty client-side validation BEFORE any backend call (Requirements
    // 3.3, 3.4). Sign-in checks presence only — no email *format* gate — so the
    // server remains the single source of truth for a valid credential.
    const trimmedEmail = email.trim()
    const emailMissing = trimmedEmail.length === 0
    const passwordMissing = password.length === 0

    setEmailError(emailMissing ? EMAIL_REQUIRED_MESSAGE : null)
    setPasswordError(passwordMissing ? PASSWORD_REQUIRED_MESSAGE : null)

    if (emailMissing || passwordMissing) {
      // Focus the first offending control (Requirement 14.7).
      if (emailMissing) {
        emailRef.current?.focus()
      } else {
        passwordRef.current?.focus()
      }
      // Do not call the backend when client validation fails.
      setStatus({ kind: 'none' })
      return
    }

    // Both fields present — call the backend sign-in endpoint (Requirement 3.2).
    setStatus({ kind: 'none' })
    setPending(true)
    try {
      const result = await authApi.signIn({
        email: trimmedEmail,
        password,
      })

      if (result.ok) {
        // Requirement 3.5: surface the Session so the parent establishes it and
        // navigates to the resolved Redirect_Target.
        setStatus({ kind: 'none' })
        onSession(result.session)
        return
      }

      // Requirement 3.7: the email-not-verified branch shows its message and a
      // resend control (rendered below the form).
      if (result.outcome.kind === 'email-not-verified') {
        setStatus({
          kind: 'email-not-verified',
          message: messageForOutcome(result.outcome, 'log-in'),
        })
        return
      }

      // Requirements 3.6 (+ timeout/network, generic): shaped, non-disclosing
      // copy. An auth-failure resolves to the single Generic_Auth_Failure
      // message, so which credential was wrong is never revealed. The entered
      // Email_Address is retained because the field is controlled and never
      // cleared here.
      setStatus({
        kind: 'error',
        message: messageForOutcome(result.outcome, 'log-in'),
      })
    } finally {
      // Always re-enable submission once the call resolves.
      setPending(false)
    }
  }

  return (
    <AuthLayout heading={LOG_IN_HEADING}>
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
          autoComplete="current-password"
          required
        />
        <SubmitButton pending={pending} pendingLabel="Signing you in…">
          Log in
        </SubmitButton>
      </form>

      <LiveRegion
        message={status.kind === 'none' ? null : status.message}
        politeness={status.kind === 'error' ? 'assertive' : 'polite'}
      />

      {/* Requirement 3.7: control to obtain a new verification message. */}
      {status.kind === 'email-not-verified' && (
        <LinkButton to={VERIFY_EMAIL_PATH}>
          {RESEND_VERIFICATION_LABEL}
        </LinkButton>
      )}

      <GoogleSignInControl
        requestGoogleAssertion={requestGoogleAssertion}
        authApi={authApi}
        onSession={onSession}
        onFailure={onGoogleFailure}
      />

      {/* Requirement 3.9: links to the Sign_Up_Screen and Reset_Request_Screen. */}
      <nav className="auth-links" aria-label="Other options">
        <LinkButton to={SIGN_UP_PATH}>Create an account</LinkButton>
        <LinkButton to={RESET_REQUEST_PATH}>Forgot your password?</LinkButton>
      </nav>
    </AuthLayout>
  )
}

export default LogInScreen
