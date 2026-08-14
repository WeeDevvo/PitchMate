/**
 * NavigationErrorRegion — an accessible live region for navigation failures.
 *
 * The landing page links out to surfaces owned by other features (sign up, log
 * in, privacy, terms) that may not yet be reachable. When an activated control
 * fails to navigate, the visitor must be kept on the page and told what
 * happened without losing their place. This component is that announcement
 * surface. It presents two failure conditions:
 *
 *   - A call to action (Sign Up / Log In) whose navigation does not complete
 *     within the 3-second budget → a retryable error message; the visitor stays
 *     on the page and the control remains focusable and operable for retry
 *     (Requirement 3.7).
 *   - A footer link (privacy / terms) whose destination cannot be reached → an
 *     indication that the requested content is unavailable; the visitor stays on
 *     the current page and the link remains retryable (Requirement 8.5).
 *
 * Design notes:
 *   - This is a *presentational, controlled* component. It owns no navigation
 *     logic and no focus management. It receives the current message (or `null`
 *     when there is nothing to report) and renders it. The associated control
 *     keeps its own focus — the region never steals it.
 *   - It is a `role="alert"` / `aria-live="assertive"` region, so a newly
 *     appearing message is announced by assistive technology *without* moving
 *     focus, preserving keyboard flow (Requirements 6.3, 6.4).
 *   - The region is always present in the DOM, even when empty, so that a future
 *     message inserted into it is reliably announced. When there is no error it
 *     renders nothing visible and exposes no alert content.
 *
 * Requirements: 3.7, 8.5
 */

/**
 * The kind of navigation failure being surfaced. Callers pass the appropriate
 * kind so the region can convey the right meaning:
 *   - `'navigation'` — a Sign Up / Log In navigation failed or timed out; the
 *     visitor can retry the same control (Requirement 3.7).
 *   - `'unavailable'` — a footer link's destination could not be reached; the
 *     requested content is unavailable (Requirement 8.5).
 */
export type NavigationErrorKind = 'navigation' | 'unavailable'

export interface NavigationErrorRegionProps {
  /**
   * The message to announce, or `null`/`undefined` when there is no error. When
   * empty, the live region renders quietly so future messages can still be
   * announced.
   */
  message?: string | null
  /**
   * The kind of failure, used to tag the message for callers/tests. Defaults to
   * `'navigation'`. Purely descriptive — the copy itself is supplied via
   * `message` so callers control the exact wording.
   */
  kind?: NavigationErrorKind
  /**
   * Optional id so an associated control can reference this region (e.g. via
   * `aria-describedby`) while keeping its own focus.
   */
  id?: string
}

/**
 * A polite-but-assertive live region that announces navigation/link failures.
 *
 * The wrapping element is always rendered with `role="alert"` and
 * `aria-live="assertive"` so it exists in the accessibility tree before any
 * message arrives; screen readers then announce the message the moment it is
 * inserted. Focus is deliberately never moved here (Requirements 6.3, 6.4).
 */
export function NavigationErrorRegion({
  message,
  kind = 'navigation',
  id,
}: NavigationErrorRegionProps) {
  const hasError = typeof message === 'string' && message.trim().length > 0

  return (
    <div
      id={id}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      data-error-kind={hasError ? kind : undefined}
      data-testid="navigation-error-region"
    >
      {hasError ? message : null}
    </div>
  )
}

export default NavigationErrorRegion
