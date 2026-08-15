/**
 * VerifyEmailScreen — the Verify_Email_Screen at route `/verify-email`, where a
 * person arriving from an email-verification link has their Email_Verification_Token
 * redeemed and the outcome reported (Requirement 7).
 *
 * A thin presentational screen composed from the shared auth components,
 * mirroring the {@link ResetConfirmScreen} (token-from-URL) and {@link
 * LogInScreen} (session-aware) structure. Every fiddly decision lives elsewhere:
 * the Email_Verification_Token is read from the URL query string by the pure
 * `lib/tokenFromUrl` extractor, every backend outcome is shaped and given
 * non-disclosing copy by `lib/errorMapping`, and the session-gated resend keys
 * off the shared `useAuth` state from the session module. The screen only wires
 * those pieces to its controls.
 *
 * Behavioural contract:
 *
 *   - **Token from the URL → redeem (Requirements 1.5, 7.1).** On open the
 *     screen reads the `token` value from the request URL query string via
 *     `extractToken`; when present it calls `authApi.redeemEmailVerification`
 *     with that token.
 *   - **In-progress guard (Requirement 7.2).** While the redeem call is in
 *     flight a visible in-progress indicator is shown and every control that
 *     triggers a new verification request is disabled.
 *   - **Success (Requirement 7.3).** Confirms the Email_Address is verified and
 *     presents a control to proceed to the Log_In_Screen or, WHERE a Session is
 *     already established, to the Redirect_Target.
 *   - **Invalid / expired / already-used token (Requirement 7.4).** Shows that
 *     the verification link is no longer valid, keeps the person on the screen,
 *     and presents a control to request a new verification message.
 *   - **Session-gated resend (Requirements 7.5, 7.6).** WHERE a Session is
 *     established the request-new-verification control calls
 *     `authApi.requestEmailVerification`; otherwise it directs the person to the
 *     Log_In_Screen (the backend request endpoint requires an authenticated
 *     caller), rendered as a client-side navigation link.
 *   - **Missing token (Requirement 7.7).** When opened with no token present,
 *     shows an invalid/incomplete message and presents a control to request a
 *     new verification message.
 *   - **Timeout / network (Requirement 7.8).** When the redeem does not return
 *     within its 10-second budget or fails to reach the backend, shows a
 *     retryable message, preserves the Email_Verification_Token, and presents a
 *     control to retry the verification (re-running the redeem with the
 *     preserved token).
 *
 * The screen owns no session logic: it reads the coarse auth `state` from the
 * shared {@link useAuth} context and delegates every backend call to the
 * injected `authApi`. Its navigation controls use client-side navigation via
 * the shared {@link LinkButton} (Requirement 1.4), so this screen is rendered
 * within a router and an {@link AuthProvider}; the token is read from the router
 * location by default (overridable via the `search` prop for testing).
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AuthLayout } from './components/AuthLayout'
import { LiveRegion } from './components/LiveRegion'
import { LinkButton } from './components/LinkButton'
import { useAuth } from './session/AuthContext'
import { extractToken } from './lib/tokenFromUrl'
import { messageForOutcome } from './lib/errorMapping'
import type { AuthApiFacade } from './api/authApi'
// Reuse the shared submit-control styling for the screen's action buttons
// (retry / send-new-verification), so they match the auth theme tokens.
import './components/SubmitButton.css'

/** The screen heading (the single `h1`, rendered by AuthLayout). */
export const VERIFY_EMAIL_HEADING = 'Verify your email'

// --- In-app destinations linked from the Verify_Email_Screen ----------------

/** Route path of the Log_In_Screen (Requirements 7.3, 7.6). */
export const LOG_IN_PATH = '/login'
/**
 * The default in-app authenticated destination used for the success control
 * WHERE a Session is already established and no explicit Redirect_Target is
 * supplied (Requirement 7.3). App wiring (task 19) resolves and passes the real
 * Redirect_Target via the `redirectTarget` prop; this is the safe fallback.
 */
export const DEFAULT_AUTHENTICATED_PATH = '/'

// --- User-facing copy -------------------------------------------------------

/** The visible in-progress indicator shown while the redeem is awaited (Requirement 7.2). */
export const VERIFYING_MESSAGE = 'Verifying your email address…'

/**
 * Shown when the screen is opened with no Email_Verification_Token in the URL
 * (Requirement 7.7). It states the link is invalid or incomplete without
 * revealing anything further.
 */
export const MISSING_TOKEN_MESSAGE =
  'This verification link is invalid or incomplete. Request a new verification email to continue.'

/** Shown after a successful authenticated resend (Requirement 7.5). */
export const RESEND_SUCCESS_MESSAGE =
  "We've sent a new verification email. Please check your inbox."

// --- Control labels ---------------------------------------------------------

/** Label for the authenticated request-new-verification control (Requirement 7.5). */
export const SEND_NEW_VERIFICATION_LABEL = 'Send a new verification email'
/** Label for the unauthenticated request-new-verification control (Requirement 7.6). */
export const LOG_IN_TO_VERIFY_LABEL = 'Log in to request a new verification email'
/** Label for the retry control on the timeout/network branch (Requirement 7.8). */
export const RETRY_LABEL = 'Try again'
/** Label for the success control when no Session is established (Requirement 7.3). */
export const CONTINUE_TO_LOG_IN_LABEL = 'Continue to log in'
/** Label for the success control WHERE a Session is established (Requirement 7.3). */
export const CONTINUE_TO_APP_LABEL = 'Continue to PitchMate'

export interface VerifyEmailScreenProps {
  /**
   * The auth Api_Client facade. `redeemEmailVerification` relays the
   * Email_Verification_Token to the backend redeem endpoint (bounded by the
   * facade's 10-second timeout); `requestEmailVerification` resends a new
   * verification message for the authenticated caller. No auth decision happens
   * here — the facade only relays (Requirement 12.3).
   */
  authApi: Pick<
    AuthApiFacade,
    'redeemEmailVerification' | 'requestEmailVerification'
  >
  /**
   * The URL query string to read the Email_Verification_Token from. Defaults to
   * the router location's `search` so the token is read from the request URL
   * (Requirements 1.5, 7.1); injectable so tests can supply a search string
   * directly.
   */
  search?: string
  /**
   * The resolved same-origin Redirect_Target to proceed to on success WHERE a
   * Session is already established (Requirement 7.3). Defaults to
   * {@link DEFAULT_AUTHENTICATED_PATH}; app wiring (task 19) supplies the
   * resolved target.
   */
  redirectTarget?: string
}

/** The redeem status; only meaningful when a token is present. */
type RedeemStatus =
  | { readonly kind: 'verifying' }
  | { readonly kind: 'success'; readonly message: string }
  | { readonly kind: 'invalid'; readonly message: string }
  | { readonly kind: 'retryable'; readonly message: string }

/** A message produced by an authenticated resend attempt. */
interface ResendMessage {
  readonly text: string
  readonly assertive: boolean
}

/**
 * The Verify_Email_Screen. Redeems the Email_Verification_Token read from the
 * URL, reports each outcome with non-disclosing copy, and offers a session-gated
 * request-new-verification control plus a retry on transient failure.
 */
export function VerifyEmailScreen({
  authApi,
  search,
  redirectTarget = DEFAULT_AUTHENTICATED_PATH,
}: VerifyEmailScreenProps) {
  const location = useLocation()
  const { state } = useAuth()
  const isAuthenticated = state === 'authenticated'

  // Read the Email_Verification_Token from the supplied search string, or the
  // router location's search when none is supplied (Requirements 1.5, 7.1).
  const searchString = search ?? location.search
  const token = useMemo(() => extractToken(searchString), [searchString])
  const hasToken = token !== null

  const [status, setStatus] = useState<RedeemStatus>({ kind: 'verifying' })
  const [resendPending, setResendPending] = useState(false)
  const [resendMessage, setResendMessage] = useState<ResendMessage | null>(null)

  // Guard so the automatic on-open redeem fires once; the retry control invokes
  // the redeem explicitly (Requirement 7.8), independent of this latch.
  const startedRef = useRef(false)

  /**
   * Redeem the Email_Verification_Token and map the outcome (Requirements 7.1,
   * 7.3, 7.4, 7.8). The token is preserved across attempts because it is derived
   * from the (stable) search string, so a retry re-runs against the same token.
   */
  const runRedeem = useCallback(async () => {
    if (token === null) {
      return
    }
    setResendMessage(null)
    setStatus({ kind: 'verifying' })

    const result = await authApi.redeemEmailVerification(token)

    if (result.ok) {
      // Requirement 7.3: confirm verification and offer the proceed control.
      setStatus({
        kind: 'success',
        message: messageForOutcome({ kind: 'success' }, 'verify-email'),
      })
      return
    }

    // Requirement 7.4: an invalid/expired/already-used token keeps the person
    // on the screen with a request-new-verification control.
    if (result.outcome.kind === 'invalid-or-expired-token') {
      setStatus({
        kind: 'invalid',
        message: messageForOutcome(result.outcome, 'verify-email'),
      })
      return
    }

    // Requirement 7.8 (+ any other non-definitive failure): a retryable message
    // with a control to retry. The token is preserved for the retry.
    setStatus({
      kind: 'retryable',
      message: messageForOutcome(result.outcome, 'verify-email'),
    })
  }, [authApi, token])

  // Requirement 7.1: on open with a token present, redeem it once.
  useEffect(() => {
    if (token === null || startedRef.current) {
      return
    }
    startedRef.current = true
    void runRedeem()
  }, [token, runRedeem])

  /**
   * The session-gated request-new-verification action (Requirements 7.5, 7.6).
   * Only the authenticated case reaches here as an action: WHERE a Session is
   * established, resend via the backend; the unauthenticated case is rendered
   * instead as a navigation link to the Log_In_Screen (see below).
   */
  const handleRequestNewVerification = useCallback(async () => {
    if (resendPending) {
      return
    }
    setResendPending(true)
    try {
      const result = await authApi.requestEmailVerification()
      setResendMessage(
        result.ok
          ? { text: RESEND_SUCCESS_MESSAGE, assertive: false }
          : {
              text: messageForOutcome(result.outcome, 'verify-email'),
              assertive: true,
            },
      )
    } finally {
      setResendPending(false)
    }
  }, [authApi, resendPending])

  const verifying = hasToken && status.kind === 'verifying'
  const succeeded = hasToken && status.kind === 'success'
  const retryable = hasToken && status.kind === 'retryable'

  // Controls that trigger a new verification request are disabled while a
  // redeem or a resend is in flight (Requirement 7.2).
  const newVerificationPending = verifying || resendPending

  // The message currently shown: a resend acknowledgement takes precedence
  // (it is the most recent action), then the missing-token/in-progress/status
  // messages.
  let shownMessage: string | null
  let politeness: 'polite' | 'assertive'
  if (resendMessage !== null) {
    shownMessage = resendMessage.text
    politeness = resendMessage.assertive ? 'assertive' : 'polite'
  } else if (!hasToken) {
    shownMessage = MISSING_TOKEN_MESSAGE
    politeness = 'assertive'
  } else if (status.kind === 'verifying') {
    shownMessage = VERIFYING_MESSAGE
    politeness = 'polite'
  } else {
    shownMessage = status.message
    politeness = status.kind === 'success' ? 'polite' : 'assertive'
  }

  // The success control proceeds to the Redirect_Target WHERE a Session is
  // established, else to the Log_In_Screen (Requirement 7.3).
  const successTarget = isAuthenticated ? redirectTarget : LOG_IN_PATH
  const successLabel = isAuthenticated
    ? CONTINUE_TO_APP_LABEL
    : CONTINUE_TO_LOG_IN_LABEL

  // The request-new-verification control is offered in every non-success state
  // (missing token, verifying, invalid, retryable), so a person always has a
  // way to obtain a fresh verification message (Requirements 7.4, 7.7).
  const showRequestNew = !succeeded

  return (
    <AuthLayout heading={VERIFY_EMAIL_HEADING}>
      <LiveRegion message={shownMessage} politeness={politeness} />

      <div className="auth-actions">
        {/* Requirement 7.8: retry the verification, preserving the token. */}
        {retryable && (
          <button
            type="button"
            className="auth-submit"
            onClick={() => {
              void runRedeem()
            }}
          >
            {RETRY_LABEL}
          </button>
        )}

        {/* Requirement 7.3: proceed to Log_In or, with a Session, the Redirect_Target. */}
        {succeeded && (
          <LinkButton to={successTarget}>{successLabel}</LinkButton>
        )}

        {/* Requirements 7.4, 7.5, 7.6, 7.7: session-gated request-new-verification. */}
        {showRequestNew &&
          (isAuthenticated ? (
            // Requirement 7.5: authenticated → resend via the backend. Disabled
            // while a redeem or resend is in flight (Requirement 7.2).
            <button
              type="button"
              className="auth-submit"
              disabled={newVerificationPending}
              aria-busy={newVerificationPending || undefined}
              onClick={() => {
                void handleRequestNewVerification()
              }}
            >
              {SEND_NEW_VERIFICATION_LABEL}
            </button>
          ) : (
            // Requirement 7.6: unauthenticated → direct to the Log_In_Screen,
            // because the backend resend endpoint requires an authenticated
            // caller. A client-side navigation link (Requirement 1.4).
            <LinkButton to={LOG_IN_PATH}>{LOG_IN_TO_VERIFY_LABEL}</LinkButton>
          ))}
      </div>
    </AuthLayout>
  )
}

export default VerifyEmailScreen
