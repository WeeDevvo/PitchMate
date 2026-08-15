/**
 * LinkButton — the shared client-side navigation control for the auth screens.
 *
 * Navigation between auth screens (e.g. Log_In ↔ Sign_Up, or "back to reset
 * request") must happen without a full-document reload (Requirement 14.4), and
 * the control must be a real, keyboard-reachable element with a visible focus
 * indicator (Requirements 14.5, 14.4). This mirrors the landing feature's
 * `NavAnchor`/`Cta` pattern:
 *
 *   - It renders a real `<a href>`, so the browser provides native keyboard
 *     operability (Tab to focus, Enter to activate), correct focus semantics,
 *     and an exposed destination for free (Requirements 14.4, 14.5).
 *   - Both pointer clicks and keyboard `Enter` fire the anchor's click event, so
 *     a single handler funnels both activation paths through the same
 *     client-side navigation via react-router's `useNavigate` — no full-document
 *     reload (Requirement 14.4).
 *   - Modified clicks (new tab/window, middle-click) and already-handled events
 *     are left to the browser, preserving expected anchor behaviour.
 *
 * It is presentational: it performs the navigation but owns no auth state.
 *
 * Requirements: 14.4, 14.5
 */
import { useNavigate } from 'react-router-dom'
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react'
import './LinkButton.css'

export interface LinkButtonProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick'> {
  /** The in-app destination path. Rendered as a real `href` and navigated to. */
  to: string
  /** The visible label / accessible name. */
  children: ReactNode
  /**
   * The navigation mechanism. Defaults to client-side routing via react-router.
   * Injectable so tests can drive navigation without a real router transition.
   */
  navigate?: (to: string) => void
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
 * A client-side navigation link rendered as a real, focusable anchor.
 */
export function LinkButton({
  to,
  children,
  navigate,
  className,
  ...anchorProps
}: LinkButtonProps) {
  const routerNavigate = useNavigate()
  const go = navigate ?? ((target: string) => routerNavigate(target))

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!shouldIntercept(event)) {
      return
    }
    // Take over from the browser's default full-document navigation so the
    // switch between auth screens happens client-side (Requirement 14.4).
    event.preventDefault()
    go(to)
  }

  const classes = ['auth-link', className].filter(Boolean).join(' ')

  return (
    <a {...anchorProps} href={to} className={classes} onClick={handleClick}>
      {children}
    </a>
  )
}

export default LinkButton
