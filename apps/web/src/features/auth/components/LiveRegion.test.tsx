/**
 * Unit tests for the shared LiveRegion announcement surface.
 *
 * These cover the live-region message exposure contract (Requirement 14.6):
 *   - the region is present in the DOM even when empty, so a later message is
 *     reliably announced,
 *   - it carries the correct `aria-live`/role for its politeness,
 *   - it exposes message content to assistive technology,
 *   - it never moves focus.
 *
 * Feature: web-auth-screens
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LiveRegion } from './LiveRegion'

describe('LiveRegion message exposure', () => {
  // Validates: Requirements 14.6 — always present, even when empty.
  it('renders the region in the DOM with polite defaults when there is no message', () => {
    render(<LiveRegion message={null} />)

    const region = screen.getByRole('status')
    expect(region).toBeInTheDocument()
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toHaveAttribute('aria-atomic', 'true')
    expect(region).toBeEmptyDOMElement()
  })

  // Validates: Requirements 14.6 — polite messages are exposed via role=status.
  it('exposes a polite message to assistive tech via role=status', () => {
    render(<LiveRegion message="Check your inbox to continue." />)

    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toHaveTextContent('Check your inbox to continue.')
  })

  // Validates: Requirements 14.6 — assertive messages use role=alert.
  it('exposes an assertive message via role=alert with aria-live=assertive', () => {
    render(
      <LiveRegion
        message="We could not sign you in."
        politeness="assertive"
      />,
    )

    const region = screen.getByRole('alert')
    expect(region).toHaveAttribute('aria-live', 'assertive')
    expect(region).toHaveTextContent('We could not sign you in.')
  })

  // Validates: Requirements 14.6 — announcing a message must not steal focus.
  it('does not move focus when a message is present', () => {
    // Focus lives on an unrelated element before the region renders.
    render(
      <>
        <button type="button">Somewhere else</button>
        <LiveRegion message="A backend error occurred." politeness="assertive" />
      </>,
    )

    const other = screen.getByRole('button', { name: 'Somewhere else' })
    other.focus()
    expect(other).toHaveFocus()

    const region = screen.getByRole('alert')
    // The region is not a focusable control and focus stays put.
    expect(region).not.toHaveAttribute('tabindex')
    expect(other).toHaveFocus()
    expect(region).not.toHaveFocus()
  })

  it('honours a supplied id so a control can reference it', () => {
    render(<LiveRegion id="signup-status" message="Working…" />)

    expect(screen.getByRole('status')).toHaveAttribute('id', 'signup-status')
  })
})
