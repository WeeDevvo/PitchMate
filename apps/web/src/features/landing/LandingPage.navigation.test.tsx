/**
 * CTA and footer navigation component tests for the composed LandingPage.
 *
 * Tasks 8.2/8.4 covered the shared control and the failure edge cases in
 * isolation. This file (task 12.5) renders the *whole* page the way the `/`
 * route does and asserts the navigation entry points behave correctly end to
 * end:
 *
 *   - Every Sign Up primary CTA navigates to `/signup`, the Log In secondary
 *     CTA to `/login`, and the footer links to `/privacy` and `/terms`
 *     (Requirements 1.5, 3.2, 3.3, 8.3, 8.4).
 *   - Pointer click and keyboard `Enter` are equivalent: activating the same
 *     control either way funnels through the same navigation code path to the
 *     same destination (Requirement 3.6).
 *   - The header exposes a primary CTA (Sign Up) and a distinct secondary CTA
 *     (Log In) (Requirement 3.1 supporting).
 *   - A primary CTA follows the last benefit in DOM order — the closing CTA
 *     sits after the last BenefitSection (Requirement 3.5 supporting).
 *
 * The destinations (`/signup`, `/login`, `/privacy`, `/terms`) are owned by
 * other features and may not be routable, so the shared control funnels every
 * activation through `navigateWithFallback`. We mock that helper so it resolves
 * successfully and records the `href` each activation was funnelled to, rather
 * than asserting a real URL change. `MemoryRouter` satisfies the `useNavigate`
 * dependency inside the shared control.
 *
 * Feature: marketing-landing-page
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

// Mock the navigation helper so activation is observable and never performs a
// real navigation. DEFAULT_NAV_TIMEOUT_MS and the other exports are preserved.
vi.mock('./lib/navigation', async (importActual) => {
  const actual = await importActual<typeof import('./lib/navigation')>()
  return {
    ...actual,
    navigateWithFallback: vi.fn(() => Promise.resolve({ ok: true })),
  }
})

import LandingPage from './LandingPage'
import { landingContent } from './content/landingContent'
import { navigateWithFallback } from './lib/navigation'

const mockNavigate = vi.mocked(navigateWithFallback)

/** Every sign-up call to action starts "Start a squad". */
const START_SQUAD = /^Start a squad/

beforeEach(() => {
  mockNavigate.mockClear()
  mockNavigate.mockResolvedValue({ ok: true })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <LandingPage />
    </MemoryRouter>,
  )
}

/** The `href` the most recent `navigateWithFallback` call was funnelled to. */
function lastNavigatedHref(): string {
  const calls = mockNavigate.mock.calls
  expect(calls.length).toBeGreaterThan(0)
  return calls[calls.length - 1][0]
}

/**
 * Activate `link` by pointer click, then by keyboard `Enter`, and return the
 * destination each path funnelled through the navigation helper. Both paths are
 * expected to hit the helper exactly once.
 */
async function activateBothWays(
  user: ReturnType<typeof userEvent.setup>,
  link: HTMLElement,
): Promise<{ pointerHref: string; keyboardHref: string }> {
  // Pointer click.
  mockNavigate.mockClear()
  await user.click(link)
  expect(mockNavigate).toHaveBeenCalledTimes(1)
  const pointerHref = lastNavigatedHref()

  // Keyboard Enter on the same focused control.
  mockNavigate.mockClear()
  link.focus()
  expect(link).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(mockNavigate).toHaveBeenCalledTimes(1)
  const keyboardHref = lastNavigatedHref()

  return { pointerHref, keyboardHref }
}

describe('LandingPage CTA and footer navigation', () => {
  it('navigates every Start a squad CTA to /signup by pointer and keyboard', async () => {
    const user = userEvent.setup()
    renderPage()

    const signUpLinks = screen.getAllByRole('link', { name: START_SQUAD })
    // Header + hero + closing CTA all offer Start a squad.
    expect(signUpLinks.length).toBeGreaterThanOrEqual(3)

    for (const link of signUpLinks) {
      const { pointerHref, keyboardHref } = await activateBothWays(user, link)
      expect(pointerHref).toBe('/signup')
      expect(keyboardHref).toBe('/signup')
    }
  })

  it('navigates the Log in CTA to /login by pointer and keyboard', async () => {
    const user = userEvent.setup()
    renderPage()

    const logIn = screen.getByRole('link', { name: 'Log in' })
    const { pointerHref, keyboardHref } = await activateBothWays(user, logIn)

    expect(pointerHref).toBe('/login')
    expect(keyboardHref).toBe('/login')
  })

  it('navigates the footer Privacy link to /privacy by pointer and keyboard', async () => {
    const user = userEvent.setup()
    renderPage()

    const privacy = screen.getByRole('link', { name: 'Privacy' })
    const { pointerHref, keyboardHref } = await activateBothWays(user, privacy)

    expect(pointerHref).toBe('/privacy')
    expect(keyboardHref).toBe('/privacy')
  })

  it('navigates the footer Terms link to /terms by pointer and keyboard', async () => {
    const user = userEvent.setup()
    renderPage()

    const terms = screen.getByRole('link', { name: 'Terms' })
    const { pointerHref, keyboardHref } = await activateBothWays(user, terms)

    expect(pointerHref).toBe('/terms')
    expect(keyboardHref).toBe('/terms')
  })

  // Validates: Requirement 3.6 — the two activation paths are equivalent: the
  // same control, activated by pointer or by keyboard, produces the same
  // navigation outcome.
  it('drives an identical navigation outcome for pointer click and keyboard Enter on every control', async () => {
    const user = userEvent.setup()
    renderPage()

    const controls = [
      ...screen.getAllByRole('link', { name: START_SQUAD }),
      screen.getByRole('link', { name: 'Log in' }),
      screen.getByRole('link', { name: 'Privacy' }),
      screen.getByRole('link', { name: 'Terms' }),
    ]

    for (const link of controls) {
      const { pointerHref, keyboardHref } = await activateBothWays(user, link)
      // Same control ⇒ same destination regardless of activation path.
      expect(keyboardHref).toBe(pointerHref)
      // And it matches the control's own href attribute.
      expect(pointerHref).toBe(link.getAttribute('href'))
    }
  })

  // Validates: Requirement 3.1 (supporting) — the header carries a primary
  // Start a squad CTA and a distinct, quieter Log in CTA.
  it('exposes a primary Start a squad CTA and a distinct Log in CTA in the header', () => {
    renderPage()

    const header = screen.getByRole('banner')
    const signUp = within(header).getByRole('link', { name: START_SQUAD })
    const logIn = within(header).getByRole('link', { name: 'Log in' })

    expect(signUp).toHaveAttribute('href', '/signup')
    expect(signUp).toHaveAttribute('data-cta-kind', 'primary')

    expect(logIn).toHaveAttribute('href', '/login')
    expect(logIn).toHaveAttribute('data-cta-kind', 'ghost')

    // The two entry points are distinct controls.
    expect(signUp).not.toBe(logIn)
  })

  // Validates: Requirement 3.5 (supporting) — a primary CTA follows the last
  // benefit in DOM order (the closing CTA sits after the last BenefitSection).
  it('places a primary CTA after the last benefit in DOM order', () => {
    renderPage()

    const lastBenefit = landingContent.benefits[landingContent.benefits.length - 1]
    const lastBenefitHeading = screen.getByRole('heading', {
      level: 2,
      name: lastBenefit.heading,
    })

    const closingRegion = screen.getByTestId('closing-cta')
    const closingCta = within(closingRegion).getByRole('link', { name: START_SQUAD })

    // The closing CTA is the green band's sign-up control...
    expect(closingCta).toHaveAttribute('href', '/signup')
    expect(closingCta).toHaveAttribute('data-cta-kind', 'ink')

    // ...and it appears after the last benefit heading in document order.
    const relation = lastBenefitHeading.compareDocumentPosition(closingCta)
    expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
