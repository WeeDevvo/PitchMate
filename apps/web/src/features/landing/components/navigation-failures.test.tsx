/**
 * Edge-case / integration tests for navigation failures on the landing page.
 *
 * Tasks 8.2 and 8.3 cover the shared CTA control (`NavAnchor`/`Cta`) and the
 * `NavigationErrorRegion` in isolation. This file (task 8.4) wires them
 * together the way `LandingPage` will: a small harness composes a `NavAnchor`
 * with a `NavigationErrorRegion` and manages the error-message state through
 * `onNavigationError`, mirroring the real composition. The tests then drive the
 * two runtime failure modes this surface can hit and assert the visitor is
 * never left at a dead end:
 *
 *   - Navigation timeout (Requirement 3.7): the navigation attempt exceeds the
 *     3-second budget. The error region is shown, the visitor stays on `/`
 *     (client-side navigation never happens), and the activated control remains
 *     focusable and retryable.
 *   - Footer unavailable (Requirement 8.5): an unreachable footer destination
 *     (e.g. /privacy) rejects. The visitor stays on the current page and an
 *     "unavailable" indication is surfaced.
 *
 * The navigation mechanism is injected (`navigationAttempt`) so we can drive a
 * hang (timeout) and a rejection (unreachable) deterministically without a real
 * router transition. `MemoryRouter` with `initialEntries={['/']}` plus a
 * location probe lets us assert the visitor never leaves `/`.
 *
 * Feature: marketing-landing-page
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactElement } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { NavAnchor } from './Cta'
import {
  NavigationErrorRegion,
  type NavigationErrorKind,
} from './NavigationErrorRegion'
import type { NavigationAttempt } from '../lib/navigation'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Surfaces the router's current path so tests can assert the visitor stays put. */
function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

interface HarnessProps {
  label: string
  href: string
  kind?: 'primary' | 'secondary'
  /** The failure kind the error region should convey. */
  errorKind: NavigationErrorKind
  /** The message rendered when navigation fails. */
  errorMessage: string
  navigationAttempt: NavigationAttempt
  timeoutMs?: number
}

/**
 * Composes the shared CTA control with the navigation error region and manages
 * the error message via `onNavigationError` — the same wiring `LandingPage`
 * will use. On failure the control stays mounted (focusable, retryable) and the
 * region announces the supplied copy.
 */
function NavigationHarness({
  label,
  href,
  kind,
  errorKind,
  errorMessage,
  navigationAttempt,
  timeoutMs,
}: HarnessProps) {
  const [message, setMessage] = useState<string | null>(null)

  return (
    <>
      <LocationProbe />
      <NavAnchor
        label={label}
        href={href}
        kind={kind}
        timeoutMs={timeoutMs}
        navigationAttempt={navigationAttempt}
        onNavigationError={() => setMessage(errorMessage)}
      />
      <NavigationErrorRegion message={message} kind={errorKind} />
    </>
  )
}

function renderAtRoot(ui: ReactElement) {
  return render(<MemoryRouter initialEntries={['/']}>{ui}</MemoryRouter>)
}

/** Dispatch a plain left-click the way a pointer or keyboard Enter would. */
function activate(element: HTMLElement) {
  element.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
  )
}

describe('navigation failure edge cases (CTA + error region wired together)', () => {
  // Validates: Requirement 3.7 — a CTA whose navigation exceeds the 3-second
  // budget shows a retryable error, keeps the visitor on `/`, and leaves the
  // control focusable.
  it('surfaces a retryable error and stays on the page when a CTA navigation times out', async () => {
    vi.useFakeTimers()

    // An attempt that never settles — only the 3s budget can decide the outcome.
    const attempt: NavigationAttempt = vi.fn(() => new Promise<void>(() => {}))

    renderAtRoot(
      <NavigationHarness
        label="Sign Up"
        href="/signup"
        kind="primary"
        errorKind="navigation"
        errorMessage="We could not open sign up. Please try again."
        navigationAttempt={attempt}
        timeoutMs={3000}
      />,
    )

    const link = screen.getByRole('link', { name: 'Sign Up' })

    // Before activation there is no error and we are on the landing page.
    expect(screen.getByTestId('navigation-error-region')).toBeEmptyDOMElement()
    expect(screen.getByTestId('location').textContent).toBe('/')

    activate(link)

    // Just before the budget expires: still no error announced.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2999)
    })
    expect(screen.getByTestId('navigation-error-region')).toBeEmptyDOMElement()

    // Cross the 3-second boundary — the timeout now decides the outcome.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    // The error region is shown as a navigation failure...
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('We could not open sign up. Please try again.')
    expect(alert).toHaveAttribute('data-error-kind', 'navigation')

    // ...the visitor stayed on `/` (client-side navigation never happened)...
    expect(attempt).toHaveBeenCalledWith('/signup')
    expect(screen.getByTestId('location').textContent).toBe('/')

    // ...and the control remains focusable and retryable.
    link.focus()
    expect(link).toHaveFocus()

    // Retry: activating again re-runs the same funnel and, on another timeout,
    // still keeps the visitor on the page.
    activate(link)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(attempt).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('location').textContent).toBe('/')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'We could not open sign up. Please try again.',
    )
  })

  // Validates: Requirement 8.5 — an unreachable footer destination keeps the
  // visitor on the current page and shows an "unavailable" indication.
  it('shows an unavailable indication and stays on the page when a footer link is unreachable', async () => {
    const user = userEvent.setup()

    // The footer destination (privacy) is not reachable — the attempt rejects.
    const attempt: NavigationAttempt = vi.fn(() =>
      Promise.reject(new Error('unreachable')),
    )

    renderAtRoot(
      <NavigationHarness
        label="Privacy Policy"
        href="/privacy"
        errorKind="unavailable"
        errorMessage="Privacy Policy is currently unavailable."
        navigationAttempt={attempt}
      />,
    )

    const link = screen.getByRole('link', { name: 'Privacy Policy' })
    await user.click(link)

    // The region conveys the destination is unavailable...
    await waitFor(() => {
      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent('Privacy Policy is currently unavailable.')
      expect(alert).toHaveAttribute('data-error-kind', 'unavailable')
    })

    // ...the visitor stayed on the current page...
    expect(attempt).toHaveBeenCalledWith('/privacy')
    expect(screen.getByTestId('location').textContent).toBe('/')

    // ...and the link remains focusable and retryable.
    link.focus()
    expect(link).toHaveFocus()

    await user.click(link)
    await waitFor(() => {
      expect(attempt).toHaveBeenCalledTimes(2)
    })
    expect(screen.getByTestId('location').textContent).toBe('/')
    expect(screen.getByRole('alert')).toHaveAttribute(
      'data-error-kind',
      'unavailable',
    )
  })
})
