/**
 * AuthNotFound — the not-found screen for any unmatched route within the auth
 * feature (Requirement 1.7).
 *
 * When a visitor requests a path under the authentication feature that is not
 * registered to one of the five auth screens, the router falls through to this
 * screen. Mirroring the other auth screens, it is a thin presentational surface
 * composed from the shared {@link AuthLayout} (which renders the single `<h1>`
 * and paints the themed surface, Requirements 13.4, 14.1) and the shared
 * {@link LinkButton} for client-side navigation (Requirement 1.4):
 *
 *   - It renders exactly one level-one heading via {@link AuthLayout}, keeping
 *     the heading outline well-formed with no skipped levels (Requirement 14.1).
 *   - It states, in plain static copy, that the requested page could not be
 *     found — no dynamic status, so the copy is ordinary page content.
 *   - It presents a single control that navigates to the Log_In_Screen
 *     (`/login`) without a full-document reload (Requirements 1.7, 1.4).
 *
 * The screen owns no session logic and no state; it is a static fallback. Its
 * navigation control uses the shared {@link LinkButton}, so it is rendered
 * within a router.
 *
 * Requirements: 1.7, 1.4, 13.4, 14.1
 */
import { AuthLayout } from './components/AuthLayout'
import { LinkButton } from './components/LinkButton'

/** The screen heading (the single `h1`, rendered by AuthLayout). */
export const AUTH_NOT_FOUND_HEADING = 'Page not found'

/** The static not-found explanation shown beneath the heading (Requirement 1.7). */
export const AUTH_NOT_FOUND_MESSAGE =
  "We couldn't find the page you were looking for."

/** Route path of the Log_In_Screen, linked from the not-found control (Requirement 1.7). */
export const LOG_IN_PATH = '/login'

/** Label for the control that navigates to the Log_In_Screen (Requirement 1.7). */
export const BACK_TO_LOG_IN_LABEL = 'Go to log in'

/**
 * The auth not-found screen. Renders the single heading, a static explanation,
 * and a client-side navigation control back to the Log_In_Screen.
 */
export function AuthNotFound() {
  return (
    <AuthLayout heading={AUTH_NOT_FOUND_HEADING}>
      <p className="auth-message">{AUTH_NOT_FOUND_MESSAGE}</p>

      {/* Requirement 1.7: a control that navigates to the Log_In_Screen,
          client-side and without a full-document reload (Requirement 1.4). */}
      <nav className="auth-links" aria-label="Other options">
        <LinkButton to={LOG_IN_PATH}>{BACK_TO_LOG_IN_LABEL}</LinkButton>
      </nav>
    </AuthLayout>
  )
}

export default AuthNotFound
