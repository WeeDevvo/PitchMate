/**
 * ResetRequestScreen — the Reset_Request_Screen where a person requests a
 * password-reset message be sent to an Email_Address (Requirement 5).
 *
 * A thin presentational screen composed from the shared auth components,
 * mirroring the {@link SignUpScreen} / {@link LogInScreen} structure. It lets a
 * person who has forgotten their password enter an Email_Address and request a
 * reset link. As with the other screens the fiddly decisions live elsewhere:
 * client-side email validity comes from the pure `lib/emailValidation`
 * validator, and the single non-disclosing acknowledgement comes from
 * `lib/errorMapping`. The screen only wires those pieces to the field and
 * control.
 *
 * Behavioural contract:
 *
 *   - Presents an Email_Address field and a submit control (Requirement 5.1).
 *   - **Client validation before any backend call (Requirement 5.3).** On
 *     submit the email is validated with `validateEmail`. If it is empty,
 *     whitespace-only, exceeds 254 characters, or does not match the
 *     `local-part@domain` shape, a field-specific validation message is shown,
 *     focus moves to the Email_Address control (Requirement 14.7), and the
 *     backend is NOT called.
 *   - **Uniform acknowledgement on every outcome (Requirements 5.4, 5.5, 5.6,
 *     5.7).** Once the backend call resolves — success, account-absent,
 *     rate-limited, transient failure, or the facade's 10-second timeout — the
 *     screen renders the single {@link UNIFORM_RESET_ACKNOWLEDGEMENT},
 *     identically in every case. The displayed acknowledgement is NEVER branched
 *     by outcome, so the screen reveals nothing about whether an account exists.
 *   - **In-progress guard (Requirement 5.8).** While the request call is in
 *     flight the submit control shows an in-progress state and is disabled,
 *     preventing a second concurrent submission; submission is re-enabled once
 *     the call resolves (Requirements 5.6, 5.7).
 *
 * The screen owns no session logic. The link back to the Log_In_Screen uses
 * client-side navigation via the shared {@link LinkButton} (Requirement 1.4),
 * so this screen is rendered within a router.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 14.7
 */
import { useRef, useState, type FormEvent } from 'react'
import { AuthLayout } from './components/AuthLayout'
import { EmailField } from './components/EmailField'
import { SubmitButton } from './components/SubmitButton'
import { LiveRegion } from './components/LiveRegion'
import { LinkButton } from './components/LinkButton'
import { validateEmail, type EmailValidation } from './lib/emailValidation'
import { UNIFORM_RESET_ACKNOWLEDGEMENT } from './lib/errorMapping'
import type { AuthApiFacade } from './api/authApi'

/** The screen heading (the single `h1`, rendered by AuthLayout). */
export const RESET_REQUEST_HEADING = 'Reset your password'

/** Route path of the Log_In_Screen, linked from the Reset_Request_Screen. */
export const LOG_IN_PATH = '/login'

// --- Client-side validation copy (UX only; the server result always wins) ---

/** Shown when the Email_Address field is empty/whitespace at submit (Requirement 5.3). */
export const EMAIL_REQUIRED_MESSAGE = 'Enter your email address.'
/** Shown when the Email_Address exceeds the allowed length (Requirement 5.3). */
export const EMAIL_TOO_LONG_MESSAGE =
  'Email address must be 254 characters or fewer.'
/** Shown when the Email_Address is malformed (Requirement 5.3). */
export const EMAIL_MALFORMED_MESSAGE = 'Enter a valid email address.'

/** Label for the link back to the Log_In_Screen. */
export const BACK_TO_LOG_IN_LABEL = 'Back to log in'

/** Map an email validation failure to its field message. */
function emailErrorMessage(
  result: Extract<EmailValidation, { ok: false }>,
): string {
  switch (result.reason) {
    case 'empty':
      return EMAIL_REQUIRED_MESSAGE
    case 'too-long':
      return EMAIL_TOO_LONG_MESSAGE
    case 'malformed':
      return EMAIL_MALFORMED_MESSAGE
  }
}

export interface ResetRequestScreenProps {
  /**
   * The auth Api_Client facade. `requestPasswordReset` relays the entered
   * Email_Address to the backend password-reset request endpoint; the facade
   * applies the 10-second timeout and shapes every outcome. No auth decision
   * happens here — the facade only relays (Requirement 12.3).
   */
  authApi: Pick<AuthApiFacade, 'requestPasswordReset'>
}

/** The kind of message currently shown in the status live region. */
type Status =
  | { readonly kind: 'none' }
  | { readonly kind: 'acknowledged'; readonly message: string }

/**
 * The Reset_Request_Screen. Renders the request form and a link back to the
 * Log_In_Screen; runs client validation before calling the backend; and shows
 * the single Uniform_Reset_Acknowledgement on every backend outcome.
 */
export function ResetRequestScreen({ authApi }: ResetRequestScreenProps) {
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'none' })

  const emailRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    // Guard against a second concurrent submission (Requirement 5.8). The submit
    // button is also disabled while pending; this is belt-and-braces.
    if (pending) {
      return
    }

    // Client-side validation BEFORE any backend call (Requirement 5.3).
    const emailResult = validateEmail(email)

    if (!emailResult.ok) {
      setEmailError(emailErrorMessage(emailResult))
      // Focus the offending control (Requirement 14.7).
      emailRef.current?.focus()
      // Do not call the backend when client validation fails, and clear any
      // prior acknowledgement so a validation error is not confused with one.
      setStatus({ kind: 'none' })
      return
    }

    setEmailError(null)

    // A valid Email_Address — call the backend password-reset request endpoint
    // (Requirement 5.2). The facade bounds this by a 10-second timeout.
    setStatus({ kind: 'none' })
    setPending(true)
    try {
      // The result is intentionally not inspected: every outcome — success,
      // account-absent, rate-limited, transient failure, or the 10-second
      // timeout — resolves to the SAME Uniform_Reset_Acknowledgement, so the
      // screen reveals nothing about account existence (Requirements 5.4, 5.5,
      // 5.6, 5.7). The displayed acknowledgement is never branched by outcome.
      await authApi.requestPasswordReset(emailResult.value)
    } finally {
      // Always re-enable submission once the call resolves (Requirements 5.6,
      // 5.7), and show the uniform acknowledgement identically in every case.
      setPending(false)
      setStatus({
        kind: 'acknowledged',
        message: UNIFORM_RESET_ACKNOWLEDGEMENT,
      })
    }
  }

  return (
    <AuthLayout heading={RESET_REQUEST_HEADING}>
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <EmailField
          value={email}
          onValueChange={setEmail}
          error={emailError}
          inputRef={emailRef}
          autoComplete="email"
          required
        />
        <SubmitButton pending={pending} pendingLabel="Sending reset link…">
          Send reset link
        </SubmitButton>
      </form>

      <LiveRegion
        message={status.kind === 'none' ? null : status.message}
        politeness="polite"
      />

      {/* Convenience navigation back to sign-in (client-side, Requirement 1.4). */}
      <nav className="auth-links" aria-label="Other options">
        <LinkButton to={LOG_IN_PATH}>{BACK_TO_LOG_IN_LABEL}</LinkButton>
      </nav>
    </AuthLayout>
  )
}

export default ResetRequestScreen
