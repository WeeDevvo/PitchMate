/**
 * Component tests for NavigationErrorRegion.
 *
 * The region is a controlled, presentational announcement surface for
 * navigation and footer-link failures. These tests assert the accessibility
 * contract: the live region is always present in the DOM (so future messages
 * are announced), it uses an assertive alert role, it renders the supplied copy
 * for both failure kinds, and it never steals focus from the activated control.
 *
 * Feature: marketing-landing-page
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { NavigationErrorRegion } from './NavigationErrorRegion'

afterEach(() => {
  cleanup()
})

describe('NavigationErrorRegion', () => {
  // Validates: Requirements 3.7, 8.5
  it('renders a quiet, empty live region when there is no error', () => {
    render(<NavigationErrorRegion message={null} />)

    const region = screen.getByTestId('navigation-error-region')
    // The region must exist in the DOM even when empty so a later message is
    // reliably announced by assistive technology.
    expect(region).toBeInTheDocument()
    expect(region).toHaveAttribute('role', 'alert')
    expect(region).toHaveAttribute('aria-live', 'assertive')
    // No visible content and no failure kind while there is nothing to report.
    expect(region).toBeEmptyDOMElement()
    expect(region).not.toHaveAttribute('data-error-kind')
  })

  // Validates: Requirement 3.7
  it('announces a retryable CTA navigation failure message', () => {
    const message = 'We could not open sign up. Please try again.'
    render(<NavigationErrorRegion message={message} kind="navigation" />)

    const region = screen.getByRole('alert')
    expect(region).toHaveTextContent(message)
    expect(region).toHaveAttribute('aria-live', 'assertive')
    expect(region).toHaveAttribute('data-error-kind', 'navigation')
  })

  // Validates: Requirement 8.5
  it('announces an unavailable footer destination', () => {
    const message = 'That page is currently unavailable.'
    render(<NavigationErrorRegion message={message} kind="unavailable" />)

    const region = screen.getByRole('alert')
    expect(region).toHaveTextContent(message)
    expect(region).toHaveAttribute('data-error-kind', 'unavailable')
  })

  // Validates: Requirement 3.7 (defaults to the navigation kind)
  it('defaults to the navigation kind when none is supplied', () => {
    render(<NavigationErrorRegion message="Something went wrong." />)

    expect(screen.getByRole('alert')).toHaveAttribute(
      'data-error-kind',
      'navigation',
    )
  })

  // Validates: Requirements 6.3, 6.4 — the region announces without moving focus.
  it('does not steal focus when a message appears', () => {
    // A focusable control stands in for an activated CTA that must remain the
    // focused, retryable element after the failure is announced.
    render(
      <div>
        <button type="button" data-testid="cta">
          Sign Up
        </button>
        <NavigationErrorRegion message="Navigation failed." />
      </div>,
    )

    const cta = screen.getByTestId('cta')
    cta.focus()
    expect(cta).toHaveFocus()

    // The alert region is present and populated, yet focus stays on the control.
    expect(screen.getByRole('alert')).toHaveTextContent('Navigation failed.')
    expect(cta).toHaveFocus()
  })

  // Validates: Requirements 3.7, 8.5 — whitespace-only messages are treated as empty.
  it('treats a whitespace-only message as no error', () => {
    render(<NavigationErrorRegion message="   " />)

    const region = screen.getByTestId('navigation-error-region')
    expect(region).toBeEmptyDOMElement()
    expect(region).not.toHaveAttribute('data-error-kind')
  })

  // Validates: Requirement 6.4 — the region can be associated with a control via id.
  it('exposes an id so a control can reference it without focus transfer', () => {
    render(<NavigationErrorRegion id="nav-error" message="Failed." />)

    expect(screen.getByRole('alert')).toHaveAttribute('id', 'nav-error')
  })
})
