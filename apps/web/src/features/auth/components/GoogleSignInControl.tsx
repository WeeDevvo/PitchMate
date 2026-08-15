/**
 * GoogleSignInControl — the "continue with Google" control shared by the
 * Sign_Up_Screen and the Log_In_Screen (Requirement 4.1).
 *
 * The control runs the Google (OIDC) browser flow to obtain a Google_Assertion
 * and, when one is produced, relays it to the backend Google sign-in endpoint
 * through the Api_Client facade's `signInGoogle` (Requirement 4.2). It is
 * deliberately thin and presentational: it owns the in-progress state and the
 * retry-after-failure copy, but it never establishes a Session or navigates —
 * it surfaces the established session payload to its parent via `onSession`, so
 * the screen can establish the Session through the Session_Manager and navigate
 * to the resolved Redirect_Target (Requirement 4.3).
 *
 * The Google flow is injected as a seam (`requestGoogleAssertion`) rather than
 * reaching for a global Google SDK, so the control is fully testable without a
 * real Google client and cancellation is modelled as a `null` assertion.
 *
 * Contract highlights:
 *
 *   - **Relay, never trust (Requirement 4.6).** The assertion is passed
 *     verbatim to `signInGoogle` and held only in a local `const` for the
 *     duration of that single call. It is never inspected, decoded for an
 *     authentication decision, logged, or persisted anywhere — not in React
 *     state, not in a ref.
 *   - **In-progress + single activation (Requirement 4.7).** While a Google
 *     sign-in is awaiting the backend, the control shows a visible in-progress
 *     label, sets `aria-busy`, and is `disabled`; a re-entrancy guard blocks any
 *     additional activation until the in-flight attempt resolves.
 *   - **Stay on-screen and retryable (Requirements 4.4, 4.5, 4.8).** A cancelled
 *     / no-assertion flow, a backend rejection, and a timeout/network failure
 *     each keep the person on the current screen, show a non-disclosing message,
 *     and restore the control to an available state so it can be retried.
 *
 * It is a native `<button type="button">`, so it is keyboard-reachable and
 * operable with a visible focus ring (Requirements 14.4, 14.5).
 *
 * Requirements: 4.1, 4.2, 4.6, 4.7
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  AuthApiFacade,
  AuthSessionPayload,
  FailureOutcome,
} from '../api/authApi'
import { messageForOutcome } from '../lib/errorMapping'
import { LiveRegion } from './LiveRegion'
import './GoogleSignInControl.css'

/**
 * The non-disclosing copy shown when the Google browser flow is cancelled or
 * otherwise yields no Google_Assertion (Requirement 4.4). Kept local because it
 * is not a backend outcome — no backend call was made — so it is not part of the
 * {@link messageForOutcome} outcome set.
 */
export const GOOGLE_SIGN_IN_INCOMPLETE_MESSAGE =
  'Google sign-in did not complete. Please try again.'

/** The idle label shown on the control when no sign-in is in progress. */
export const GOOGLE_SIGN_IN_DEFAULT_LABEL = 'Continue with Google'

export interface GoogleSignInControlProps {
  /**
   * The seam that runs the Google (OIDC) browser flow and resolves to a
   * Google_Assertion. It MUST resolve to `null` (or an empty string) when the
   * flow is cancelled or produces no assertion (Requirement 4.4). Injected so
   * the control is testable without a real Google SDK.
   */
  requestGoogleAssertion: () => Promise<string | null>
  /**
   * The auth Api_Client facade. Only {@link AuthApiFacade.signInGoogle} is
   * used; the assertion is relayed to it verbatim (Requirements 4.2, 4.6).
   */
  authApi: Pick<AuthApiFacade, 'signInGoogle'>
  /**
   * Called with the established session payload when the backend Google sign-in
   * returns a Session. The parent screen establishes the Session through the
   * Session_Manager and navigates to the Redirect_Target (Requirement 4.3).
   */
  onSession: (session: AuthSessionPayload) => void
  /**
   * Optional. Called with the shaped {@link FailureOutcome} when the backend
   * rejects the assertion or the sign-in call times out / fails to reach the
   * backend (Requirements 4.5, 4.8). The control already shows a non-disclosing
   * message for these; this callback lets a screen react further if it wants to.
   */
  onFailure?: (outcome: FailureOutcome) => void
  /** The idle label. Defaults to {@link GOOGLE_SIGN_IN_DEFAULT_LABEL}. */
  children?: ReactNode
  /** The label shown while a sign-in is in progress. Defaults to a generic one. */
  pendingLabel?: ReactNode
  /** Optional extra class names for the control. */
  className?: string
}

/**
 * A "continue with Google" button that runs the injected Google flow, relays a
 * resulting assertion to the backend, shows an in-progress state while the call
 * is in flight, and stays retryable on every non-success outcome.
 */
export function GoogleSignInControl({
  requestGoogleAssertion,
  authApi,
  onSession,
  onFailure,
  children = GOOGLE_SIGN_IN_DEFAULT_LABEL,
  pendingLabel = 'Signing in with Google…',
  className,
}: GoogleSignInControlProps) {
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // Re-entrancy guard: blocks a second activation while a sign-in is in flight,
  // independent of the rendered `disabled` attribute (Requirement 4.7).
  const inFlightRef = useRef(false)
  // Avoid state updates after unmount for an activation that resolves late.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const handleActivate = useCallback(async () => {
    // Block any additional activation until the in-flight call resolves (4.7).
    if (inFlightRef.current) {
      return
    }
    inFlightRef.current = true
    if (mountedRef.current) {
      setPending(true)
      setMessage(null)
    }

    try {
      // Run the Google browser flow. A cancelled flow (or one that throws)
      // yields no assertion — stay on-screen, show incomplete copy, retryable.
      let assertion: string | null
      try {
        assertion = await requestGoogleAssertion()
      } catch {
        assertion = null
      }

      if (typeof assertion !== 'string' || assertion.length === 0) {
        // Requirement 4.4: cancelled / no assertion.
        if (mountedRef.current) {
          setMessage(GOOGLE_SIGN_IN_INCOMPLETE_MESSAGE)
        }
        return
      }

      // Requirement 4.2 / 4.6: relay the assertion verbatim to the backend and
      // hold it no longer than this single call — it is never stored or decoded.
      const result = await authApi.signInGoogle(assertion)

      if (result.ok) {
        // Requirement 4.3: surface the session so the screen can establish it
        // and navigate. Clear any prior message.
        if (mountedRef.current) {
          setMessage(null)
        }
        onSession(result.session)
        return
      }

      // Requirements 4.5 / 4.8: backend rejection or timeout/network failure —
      // stay on-screen, show non-disclosing copy, remain retryable.
      if (mountedRef.current) {
        setMessage(messageForOutcome(result.outcome, 'google'))
      }
      onFailure?.(result.outcome)
    } finally {
      inFlightRef.current = false
      if (mountedRef.current) {
        setPending(false)
      }
    }
  }, [requestGoogleAssertion, authApi, onSession, onFailure])

  const classes = ['auth-google', className].filter(Boolean).join(' ')

  return (
    <div className="auth-google__wrap">
      <button
        type="button"
        className={classes}
        onClick={handleActivate}
        disabled={pending}
        aria-busy={pending || undefined}
      >
        {pending ? pendingLabel : children}
      </button>
      <LiveRegion message={message} politeness="assertive" />
    </div>
  )
}

export default GoogleSignInControl
