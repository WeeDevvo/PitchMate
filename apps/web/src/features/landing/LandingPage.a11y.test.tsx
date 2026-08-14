/**
 * Accessibility tests for the composed marketing landing page (task 12.4).
 *
 * These assert the page-level accessibility guarantees that only emerge once
 * every section is composed together in `LandingPage` (header → hero → benefits
 * → closing CTA → footer), rather than in the per-component tests:
 *
 *   - exactly one `<h1>` and a heading outline with no skipped levels (Req 6.1),
 *     verified both directly and via the pure `computeHeadingOutline` logic;
 *   - every call to action (Sign Up, Log In, closing CTA) and footer link
 *     (privacy, terms) is a real, focusable anchor with an href, so it is
 *     reachable and operable by keyboard alone (Req 6.3);
 *   - keyboard focus order follows the visual reading order — header CTAs, then
 *     the hero CTA, then the closing CTA, then the footer links (Req 6.4);
 *   - focus is never trapped: tabbing advances through every interactive control
 *     and past the last one (Req 6.4);
 *   - the shared control declares a visible `:focus-visible` indicator built on
 *     the `--focus-ring` token (Req 6.5);
 *   - the brand logo is informative with the exact alt text "PitchMate", every
 *     image declares an alt attribute, and any decorative image has empty alt
 *     (Req 6.6, 6.7);
 *   - colour-conveyed information (primary vs secondary CTA) is paired with a
 *     non-colour cue — distinct labels plus shape/weight/border differences in
 *     the stylesheet, not colour alone (Req 6.8);
 *   - `jest-axe` reports no violations on the fully rendered page in BOTH the
 *     dark and light themes (Req 6.2 supporting / overall a11y).
 *
 * jsdom does not implement `window.matchMedia` (so `ThemeProvider` resolves the
 * dark-first default) and does not compute colour/contrast (so axe's contrast
 * check is reported as incomplete, not a violation) — contrast thresholds are
 * covered separately by the theme-token tests (task 6.3). We install a small
 * `matchMedia` stub, mirroring the ThemeProvider test, to force light vs dark.
 *
 * The `LandingPage` renders CTAs through a control that calls `useNavigate`, so
 * the page is wrapped in a `MemoryRouter`.
 *
 * Feature: marketing-landing-page
 * Validates: Requirements 6.1, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor, type RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { axe } from 'jest-axe'
import LandingPage from './LandingPage'
import { computeHeadingOutline, type HeadingNode } from './lib/heading-outline'

const LIGHT_QUERY = '(prefers-color-scheme: light)'

/**
 * Install a static `matchMedia` stub. jsdom omits it entirely, so this both
 * satisfies `ThemeProvider` and lets a test force the reported preference.
 */
function installMatchMedia(prefersLight: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query === LIGHT_QUERY ? prefersLight : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia
}

function renderLandingPage(): RenderResult {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <LandingPage />
    </MemoryRouter>,
  )
}

/** All interactive controls on the page, in DOM (reading) order. */
function interactiveAnchors(container: HTMLElement): HTMLAnchorElement[] {
  return Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href]'))
}

// ---- Stylesheet contracts (read once; they are static build artifacts) ----
const here = dirname(fileURLToPath(import.meta.url))
const ctaCss = readFileSync(join(here, 'components/Cta.css'), 'utf8')
const themeCss = readFileSync(join(here, 'styles/theme.css'), 'utf8')
const landingCss = readFileSync(join(here, 'styles/landing.css'), 'utf8')

describe('LandingPage accessibility', () => {
  const originalMatchMedia = window.matchMedia

  beforeEach(() => {
    installMatchMedia(false) // dark-first default unless a test opts into light
    document.documentElement.removeAttribute('lang')
    document.documentElement.removeAttribute('data-theme')
  })

  afterEach(() => {
    window.matchMedia = originalMatchMedia
    document.documentElement.removeAttribute('lang')
    document.documentElement.removeAttribute('data-theme')
  })

  // Validates: Requirements 6.1
  it('has exactly one h1 and a heading outline with no skipped levels', () => {
    const { container } = renderLandingPage()

    // Exactly one level-1 heading (the hero value proposition).
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)

    // Collect the rendered headings in DOM order and validate the outline with
    // the same pure logic the design specifies (Property 5).
    const headings = Array.from(
      container.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6'),
    )
    const nodes: HeadingNode[] = headings.map((h) => ({
      level: Number(h.tagName[1]),
      text: h.textContent ?? '',
    }))

    const outline = computeHeadingOutline(nodes)
    expect(outline.h1Count).toBe(1)
    expect(outline.skippedAt).toBeNull()
    expect(outline.ok).toBe(true)
  })

  // Validates: Requirements 6.3
  it('renders every CTA and footer link as a focusable, keyboard-operable anchor', async () => {
    const { container } = renderLandingPage()
    const user = userEvent.setup()

    const anchors = interactiveAnchors(container)
    // header: Log In + Sign Up, hero: Sign Up, closing: Sign Up, footer: 2 links
    expect(anchors).toHaveLength(6)

    for (const anchor of anchors) {
      // A real anchor with a non-empty href is inherently keyboard-activatable
      // (Enter fires its click) and exposes its destination to assistive tech.
      expect(anchor.tagName).toBe('A')
      expect(anchor.getAttribute('href')).toBeTruthy()
      // Not removed from the tab sequence.
      expect(anchor.tabIndex).toBeGreaterThanOrEqual(0)
    }

    // Reachable by keyboard alone: tabbing from the document lands on the first
    // control without a pointer.
    await user.tab()
    expect(anchors).toContain(document.activeElement)
  })

  // Validates: Requirements 6.4
  it('presents a keyboard focus order that matches the visual reading order', async () => {
    const { container } = renderLandingPage()
    const user = userEvent.setup()

    const expectedOrder = interactiveAnchors(container)
    // Sanity-check the reading order the DOM encodes: header CTAs, hero CTA,
    // closing CTA, then footer links.
    expect(expectedOrder.map((a) => a.getAttribute('href'))).toEqual([
      '/login',
      '/signup',
      '/signup',
      '/signup',
      '/privacy',
      '/terms',
    ])

    // Tabbing forward visits the controls in exactly that order.
    for (const expected of expectedOrder) {
      await user.tab()
      expect(document.activeElement).toBe(expected)
    }
  })

  // Validates: Requirements 6.4
  it('does not trap keyboard focus on any interactive control', async () => {
    const { container } = renderLandingPage()
    const user = userEvent.setup()

    const anchors = interactiveAnchors(container)

    // Advance through every control; focus must move each time (never stuck).
    const visited: Element[] = []
    for (let i = 0; i < anchors.length; i += 1) {
      await user.tab()
      visited.push(document.activeElement as Element)
    }
    expect(visited).toEqual(anchors)

    // One more Tab escapes the last control — focus is not trapped on it.
    const lastAnchor = anchors[anchors.length - 1]
    await user.tab()
    expect(document.activeElement).not.toBe(lastAnchor)
  })

  // Validates: Requirements 6.5
  it('declares a visible focus indicator via the --focus-ring token', () => {
    // The shared control (rendered by every CTA and link) defines a
    // :focus-visible outline built on the theme --focus-ring token, so focus is
    // shown for keyboard/programmatic focus and is distinct from the unfocused
    // state.
    expect(ctaCss).toMatch(/\.cta:focus-visible\s*\{/)
    expect(ctaCss).toMatch(/outline:/)
    expect(ctaCss).toMatch(/var\(--focus-ring\)/)

    // The focus-ring token is defined for both themes so the indicator exists
    // whichever theme is active (contrast thresholds are asserted in task 6.3).
    expect(themeCss).toMatch(/\[data-theme='dark'\][^}]*--focus-ring/s)
    expect(themeCss).toMatch(/\[data-theme='light'\][^}]*--focus-ring/s)
  })

  // Validates: Requirements 6.6, 6.7
  it('gives the brand logo alt "PitchMate" and declares alt on every image', () => {
    const { container } = renderLandingPage()

    const images = Array.from(container.querySelectorAll<HTMLImageElement>('img'))
    expect(images.length).toBeGreaterThan(0)

    for (const img of images) {
      // Every image must declare an alt attribute: informative images carry a
      // non-empty text alternative; decorative images carry an empty one so
      // assistive technology skips them (Req 6.6, 6.7).
      expect(img.getAttribute('alt')).not.toBeNull()
    }

    // The brand logo is informative with the exact alt text "PitchMate".
    const logo = container.querySelector<HTMLImageElement>('.landing-header__logo')
    expect(logo).not.toBeNull()
    expect(logo?.getAttribute('alt')).toBe('PitchMate')
  })

  // Validates: Requirements 6.8
  it('distinguishes primary and secondary CTAs by more than colour', () => {
    const { container } = renderLandingPage()

    const primary = container.querySelector<HTMLAnchorElement>(
      "a.cta[data-cta-kind='primary']",
    )
    const secondary = container.querySelector<HTMLAnchorElement>(
      "a.cta[data-cta-kind='secondary']",
    )
    expect(primary).not.toBeNull()
    expect(secondary).not.toBeNull()

    // 1) Distinct, self-describing text labels (a non-colour cue in itself).
    expect(primary?.textContent?.trim()).toBe('Sign Up')
    expect(secondary?.textContent?.trim()).toBe('Log In')
    expect(primary?.textContent).not.toBe(secondary?.textContent)

    // 2) Distinct roles exposed as a non-colour attribute hook.
    expect(primary?.getAttribute('data-cta-kind')).toBe('primary')
    expect(secondary?.getAttribute('data-cta-kind')).toBe('secondary')

    // 3) The stylesheet differentiates them by shape/weight/border, not colour
    //    alone: the primary is a filled, bolder button; the secondary carries a
    //    visible border outline.
    expect(landingCss).toMatch(
      /\.cta\[data-cta-kind='primary'\][^}]*font-weight/s,
    )
    expect(landingCss).toMatch(
      /\.cta\[data-cta-kind='secondary'\][^}]*border/s,
    )
  })

  // Validates: Requirements 6.2 (supporting) / overall accessibility
  it('has no axe violations in the dark theme', async () => {
    installMatchMedia(false)
    const { container } = renderLandingPage()

    // Wait for React 19 to hoist the document title and for the language to be
    // applied, so page-level a11y rules can evaluate against final state.
    await waitFor(() => {
      expect(document.head.querySelector('title')?.textContent).toBeTruthy()
      expect(document.documentElement.getAttribute('lang')).toBe('en')
    })

    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  // Validates: Requirements 6.2 (supporting) / overall accessibility
  it('has no axe violations in the light theme', async () => {
    installMatchMedia(true)
    const { container } = renderLandingPage()

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('light')
      expect(document.head.querySelector('title')?.textContent).toBeTruthy()
      expect(document.documentElement.getAttribute('lang')).toBe('en')
    })

    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})
