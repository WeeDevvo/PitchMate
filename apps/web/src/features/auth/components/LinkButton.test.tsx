/**
 * Unit tests for the shared LinkButton client-side navigation control.
 *
 * These cover the client-side navigation contract (Requirements 14.4, 14.5):
 *   - it renders a real, keyboard-reachable `<a href>` exposing its label and
 *     destination,
 *   - pointer and keyboard activation both invoke client-side navigation (no
 *     full-document reload) via the injectable `navigate`,
 *   - modified clicks (open in new tab) are left to the browser.
 *
 * Navigation is injected so activation can be driven deterministically without
 * a real router transition, following the landing Cta test approach; a
 * MemoryRouter wraps the control to satisfy react-router's `useNavigate`.
 *
 * Feature: web-auth-screens
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { LinkButton } from './LinkButton'

function renderInRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('LinkButton client-side navigation', () => {
  // Validates: Requirements 14.5 — a real anchor exposing label and destination.
  it('renders a real anchor exposing its label and destination', () => {
    renderInRouter(
      <LinkButton to="/signup" navigate={() => {}}>
        Create an account
      </LinkButton>,
    )

    const link = screen.getByRole('link', { name: 'Create an account' })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '/signup')
  })

  // Validates: Requirements 14.4 — pointer activation navigates client-side.
  it('invokes client-side navigation on a pointer click without a reload', async () => {
    const user = userEvent.setup()
    const navigate = vi.fn()

    renderInRouter(
      <LinkButton to="/login" navigate={navigate}>
        Log in
      </LinkButton>,
    )

    await user.click(screen.getByRole('link', { name: 'Log in' }))

    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('/login')
  })

  // Validates: Requirements 14.4, 14.5 — keyboard activation uses the same path.
  it('invokes client-side navigation on keyboard Enter activation', async () => {
    const user = userEvent.setup()
    const navigate = vi.fn()

    renderInRouter(
      <LinkButton to="/login" navigate={navigate}>
        Log in
      </LinkButton>,
    )

    await user.tab()
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('/login')
  })

  // Validates: Requirements 14.4 — modified clicks stay with the browser.
  it('leaves modified clicks (open in new tab) to the browser', async () => {
    const user = userEvent.setup()
    const navigate = vi.fn()

    renderInRouter(
      <LinkButton to="/signup" navigate={navigate}>
        Create an account
      </LinkButton>,
    )

    const link = screen.getByRole('link', { name: 'Create an account' })
    await user.keyboard('{Meta>}')
    await user.click(link)
    await user.keyboard('{/Meta}')

    expect(navigate).not.toHaveBeenCalled()
  })
})
