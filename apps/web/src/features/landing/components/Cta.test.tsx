/**
 * Component tests for the shared anchor-based CTA control (Cta / NavAnchor).
 *
 * These cover the guarantees the shared control is responsible for:
 *   - it renders a real `<a href>` exposing its label and destination,
 *   - pointer and keyboard activation funnel through one code path (Req 3.6),
 *   - navigation failure invokes `onNavigationError` while the control stays
 *     focusable and retryable, and the visitor is not sent away (Req 3.7 hook),
 *   - modified clicks (open-in-new-tab) are left to the browser.
 *
 * The navigation mechanism is injected so we can drive success and failure
 * deterministically without a real router transition.
 *
 * Feature: marketing-landing-page
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { Cta, NavAnchor } from './Cta'
import type { NavigationAttempt } from '../lib/navigation'
import type { CtaModel } from '../content/landingContent'

afterEach(() => {
  vi.restoreAllMocks()
})

function renderInRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

const signUp: CtaModel = { kind: 'primary', label: 'Sign Up', href: '/signup' }

describe('NavAnchor / Cta shared control', () => {
  it('renders a real anchor exposing its label and destination', () => {
    renderInRouter(<Cta cta={signUp} />)

    const link = screen.getByRole('link', { name: 'Sign Up' })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '/signup')
    expect(link).toHaveAttribute('data-cta-kind', 'primary')
  })

  // Validates: Requirements 3.6 — pointer activation navigates via the funnel.
  it('funnels a pointer click through the navigation helper', async () => {
    const user = userEvent.setup()
    const attempt: NavigationAttempt = vi.fn(() => Promise.resolve())

    renderInRouter(<Cta cta={signUp} navigationAttempt={attempt} />)

    await user.click(screen.getByRole('link', { name: 'Sign Up' }))

    expect(attempt).toHaveBeenCalledTimes(1)
    expect(attempt).toHaveBeenCalledWith('/signup')
  })

  // Validates: Requirements 3.6, 6.3 — keyboard activation uses the same path.
  it('funnels a keyboard Enter activation through the same navigation helper', async () => {
    const user = userEvent.setup()
    const attempt: NavigationAttempt = vi.fn(() => Promise.resolve())

    renderInRouter(<Cta cta={signUp} navigationAttempt={attempt} />)

    // Tab to the control (keyboard reachability) and activate with Enter.
    await user.tab()
    expect(screen.getByRole('link', { name: 'Sign Up' })).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(attempt).toHaveBeenCalledTimes(1)
    expect(attempt).toHaveBeenCalledWith('/signup')
  })

  it('pointer and keyboard activation drive an identical navigation call', async () => {
    const user = userEvent.setup()
    const pointerAttempt: NavigationAttempt = vi.fn(() => Promise.resolve())
    const keyboardAttempt: NavigationAttempt = vi.fn(() => Promise.resolve())

    const { unmount } = renderInRouter(
      <Cta cta={signUp} navigationAttempt={pointerAttempt} />,
    )
    await user.click(screen.getByRole('link', { name: 'Sign Up' }))
    unmount()

    renderInRouter(<Cta cta={signUp} navigationAttempt={keyboardAttempt} />)
    await user.tab()
    await user.keyboard('{Enter}')

    expect(vi.mocked(pointerAttempt).mock.calls).toEqual(
      vi.mocked(keyboardAttempt).mock.calls,
    )
  })

  // Validates: Requirements 3.7 (hook) — failure notifies without leaving.
  it('invokes onNavigationError and keeps the control focusable when navigation fails', async () => {
    const user = userEvent.setup()
    const attempt: NavigationAttempt = vi.fn(() =>
      Promise.reject(new Error('unreachable')),
    )
    const onNavigationError = vi.fn()

    renderInRouter(
      <Cta
        cta={signUp}
        navigationAttempt={attempt}
        onNavigationError={onNavigationError}
      />,
    )

    const link = screen.getByRole('link', { name: 'Sign Up' })
    await user.click(link)

    expect(onNavigationError).toHaveBeenCalledWith('/signup', 'Sign Up')

    // The control remains present and focusable for a retry.
    link.focus()
    expect(link).toHaveFocus()
  })

  it('reports failure on timeout and stays retryable', async () => {
    vi.useFakeTimers()
    try {
      const onNavigationError = vi.fn()
      // An attempt that never settles — only the budget can decide the outcome.
      const attempt: NavigationAttempt = vi.fn(() => new Promise<void>(() => {}))

      render(
        <MemoryRouter>
          <NavAnchor
            label="Log In"
            href="/login"
            kind="secondary"
            timeoutMs={3000}
            navigationAttempt={attempt}
            onNavigationError={onNavigationError}
          />
        </MemoryRouter>,
      )

      const link = screen.getByRole('link', { name: 'Log In' })
      // Fire the click directly; fake timers make user-event's async awkward.
      link.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
      )

      await vi.advanceTimersByTimeAsync(3000)

      expect(onNavigationError).toHaveBeenCalledWith('/login', 'Log In')
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves modified clicks (open in new tab) to the browser', async () => {
    const user = userEvent.setup()
    const attempt: NavigationAttempt = vi.fn(() => Promise.resolve())

    renderInRouter(<Cta cta={signUp} navigationAttempt={attempt} />)

    const link = screen.getByRole('link', { name: 'Sign Up' })
    await user.keyboard('{Meta>}')
    await user.click(link)
    await user.keyboard('{/Meta}')

    expect(attempt).not.toHaveBeenCalled()
  })
})
