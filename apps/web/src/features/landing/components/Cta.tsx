/**
 * Cta / NavAnchor — the shared anchor-based control for the landing page.
 *
 * Every call to action and footer link on the page renders through this one
 * control so that a single code path governs activation, accessibility, and
 * defensive navigation:
 *
 *   - It renders a real `<a href>`, so the browser gives us native keyboard
 *     operability (Tab to focus, Enter to activate), correct focus semantics,
 *     and an exposed destination for free (Requirements 6.3, 6.5).
 *   - Both pointer clicks and keyboard `Enter` fire the anchor's `click` event,
 *     so the single `onClick` handler funnels *both* activation paths through
 *     the same code — keyboard activation performs exactly the same navigation
 *     as pointer activation (Requirement 3.6).
 *   - Activation is intercepted and routed through `navigateWithFallback`, which
 *     performs client-side navigation under a 3-second budget. If the
 *     destination is not reachable in time, the control invokes
 *     `onNavigationError` (so a navigation error region can surface a retryable
 *     message — task 8.3) and leaves the visitor on the page with the control
 *     still focusable and operable for a retry.
 *
 * Modified clicks (new tab/window, middle-click) and already-handled events are
 * left to the browser, preserving expected anchor behaviour.
 *
 * Requirements: 3.6, 6.3, 6.5
 */
import { useNavigate } from 'react-router-dom'
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react'
import {
  navigateWithFallback,
  DEFAULT_NAV_TIMEOUT_MS,
  type NavigationAttempt,
} from '../lib/navigation'
import type { CtaModel } from '../content/landingContent'
import './Cta.css'

/** Called when navigation to `href` does not complete within the budget. */
export type NavigationErrorHandler = (href: string, label: string) => void

/** Props shared by every anchor-based control on the page. */
export interface NavAnchorProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick'> {
  /** The visible label describing the destination (also the accessible name). */
  label: string
  /** The navigation destination. Rendered as a real `href` and used to navigate. */
  href: string
  /**
   * Visual role of the control. Purely presentational here (exposed as a
   * `data-cta-kind` attribute); section components layer their own styling on
   * top. Footer links omit this and render as plain links.
   */
  kind?: CtaModel['kind']
  /** Invoked when navigation fails or exceeds the time budget. */
  onNavigationError?: NavigationErrorHandler
  /** Navigation time budget in milliseconds. Defaults to 3 seconds. */
  timeoutMs?: number
  /**
   * The navigation mechanism. Defaults to client-side routing via
   * `react-router`. Injectable so tests can drive success, failure, and timeout
   * without a real router transition.
   */
  navigationAttempt?: NavigationAttempt
  /** Optional extra content rendered after the label (e.g. an icon). */
  children?: ReactNode
}

/**
 * Decide whether to intercept an anchor activation for client-side navigation.
 *
 * Left-button, unmodified activations (including keyboard `Enter`, which the
 * browser dispatches as a plain left click) are intercepted. Modified clicks
 * are left to the browser so "open in new tab/window" keeps working.
 */
function shouldIntercept(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  )
}

/**
 * The base anchor-based control. Renders a real `<a href>` and funnels
 * activation through the defensive navigation helper.
 */
export function NavAnchor({
  label,
  href,
  kind,
  onNavigationError,
  timeoutMs = DEFAULT_NAV_TIMEOUT_MS,
  navigationAttempt,
  children,
  className,
  ...anchorProps
}: NavAnchorProps) {
  const navigate = useNavigate()

  // Default attempt: client-side navigation. `navigate` may return a promise
  // (data router) or void; normalise both to a promise so the helper can race
  // it against the time budget.
  const attempt: NavigationAttempt =
    navigationAttempt ?? ((target) => Promise.resolve(navigate(target)))

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!shouldIntercept(event)) {
      return
    }
    // Take over from the browser's default full-document navigation so the
    // single funnel below governs both keyboard and pointer activation.
    event.preventDefault()
    void navigateWithFallback(href, timeoutMs, { attempt }).then((result) => {
      if (!result.ok) {
        onNavigationError?.(href, label)
      }
    })
  }

  const classes = ['cta', className].filter(Boolean).join(' ')

  return (
    <a
      {...anchorProps}
      href={href}
      className={classes}
      data-cta-kind={kind}
      onClick={handleClick}
    >
      {label}
      {children}
    </a>
  )
}

/** Props for the {@link Cta} convenience wrapper over a {@link CtaModel}. */
export interface CtaProps
  extends Omit<NavAnchorProps, 'label' | 'href' | 'kind'> {
  /** The call-to-action model providing the label, destination, and role. */
  cta: CtaModel
}

/**
 * Convenience wrapper that renders a {@link CtaModel} through {@link NavAnchor},
 * carrying the model's label, destination, and visual role.
 */
export function Cta({ cta, ...rest }: CtaProps) {
  return <NavAnchor {...rest} label={cta.label} href={cta.href} kind={cta.kind} />
}

export default Cta
