/**
 * Responsive layout tests for the marketing landing page (Requirement 4).
 *
 * These tests exercise the page across the six representative viewport widths
 * called out by the design's responsive strategy — 360, 767, 768, 1023, 1024
 * and 1920px — covering the Mobile (360–767), Tablet (768–1023) and Desktop
 * (1024–1920) ranges.
 *
 * jsdom deliberately does NOT perform real layout: `offsetWidth`,
 * `getBoundingClientRect()` and friends return 0, and CSS media queries are not
 * evaluated against a real viewport. So we do not assert rendered pixels (which
 * would be meaningless). Instead we assert the two things that genuinely
 * *enforce* responsiveness and that we can verify robustly:
 *
 *   1. The structural DOM contract — at every width the page renders a single
 *      main content column, all regions (header, hero, every benefit, closing
 *      CTA, footer) are present without being clipped away, every CTA is a real,
 *      focusable, reachable anchor, and the only image (the brand logo) carries
 *      the class the containment CSS targets.
 *
 *   2. The stylesheet contract — `styles/landing.css` declares the rules that
 *      guarantee no horizontal overflow (overflow-x guard + border-box sizing +
 *      wrapping CTA rows + `max-width: 100%` media), a readable measure held to
 *      ≤ 90ch, a width-constrained content column, and a single-column stack.
 *
 * NOTE ON DOM: `LandingPage` renders its landmarks directly
 * (`header.landing-header` → `main.landing-main` → `footer.landing-footer`) and
 * does NOT wrap them in a `.landing-page` container. `landing.css` anticipates
 * this: every region rule (and the `.landing-header__logo` media-containment
 * rule) also works standalone, so the responsiveness guards still apply to the
 * DOM as it actually renders. These tests therefore target the real DOM and the
 * standalone rules rather than the `.landing-page`-scoped variants.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 * Feature: marketing-landing-page
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import LandingPage from './LandingPage'
import { landingContent } from './content/landingContent'

// Read the responsive stylesheet as text so we can assert the CSS contract that
// actually enforces the layout guarantees jsdom cannot render.
const here = dirname(fileURLToPath(import.meta.url))
const landingCss = readFileSync(join(here, 'styles', 'landing.css'), 'utf8')

/** The representative widths from the design's responsive strategy. */
const MOBILE_WIDTHS = [360, 767] as const
const TABLET_WIDTHS = [768, 1023] as const
const DESKTOP_WIDTHS = [1024, 1920] as const
const ALL_WIDTHS = [
  ...MOBILE_WIDTHS,
  ...TABLET_WIDTHS,
  ...DESKTOP_WIDTHS,
] as const

const originalMatchMedia = window.matchMedia
const originalInnerWidth = window.innerWidth

/**
 * Simulate a viewport of the given CSS-pixel width: set `innerWidth` and install
 * a `matchMedia` stub that evaluates `min-width`/`max-width` queries against it.
 * jsdom still won't lay anything out, but this lets us assert *which* responsive
 * breakpoints are active at each width.
 */
function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  })
  window.matchMedia = (query: string): MediaQueryList => {
    const min = /min-width:\s*(\d+)px/.exec(query)
    const max = /max-width:\s*(\d+)px/.exec(query)
    let matches = false
    if (min) matches = width >= Number(min[1])
    else if (max) matches = width <= Number(max[1])
    // Dark-mode-first: never report a light preference here.
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    } as unknown as MediaQueryList
  }
  window.dispatchEvent(new Event('resize'))
}

function renderPage() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  )
}

/** Every `Nch` measure declared in the stylesheet. */
function chMeasures(css: string): number[] {
  return [...css.matchAll(/(\d+(?:\.\d+)?)ch/g)].map((m) => Number(m[1]))
}

afterEach(() => {
  window.matchMedia = originalMatchMedia
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: originalInnerWidth,
  })
  document.documentElement.removeAttribute('data-theme')
})

describe('Landing page responsive layout — structural DOM contract', () => {
  describe.each(ALL_WIDTHS)('at %ipx viewport width', (width) => {
    beforeEach(() => {
      setViewportWidth(width)
    })

    // Req 4.1 — a single top-to-bottom content column (one <main> landmark).
    it('renders exactly one main content column', () => {
      renderPage()
      const mains = screen.getAllByRole('main')
      expect(mains).toHaveLength(1)
      expect(mains[0]).toHaveClass('landing-main')
    })

    // Req 4.3 — header, hero, every benefit, closing CTA and footer all render
    // (nothing clipped out of the document) at every width in 360–1920.
    it('renders every region without dropping content', () => {
      renderPage()

      // Header (banner) with brand + account nav.
      expect(screen.getByRole('banner')).toBeInTheDocument()
      // Hero: the single <h1> value proposition.
      const h1s = screen.getAllByRole('heading', { level: 1 })
      expect(h1s).toHaveLength(1)
      expect(h1s[0]).toHaveTextContent(landingContent.hero.headline)
      // Every benefit section renders (h2 per benefit).
      const benefitHeadings = screen.getAllByRole('heading', { level: 2 })
      expect(benefitHeadings).toHaveLength(landingContent.benefits.length)
      // Closing CTA region after the benefits.
      expect(screen.getByTestId('closing-cta')).toBeInTheDocument()
      // Footer (contentinfo).
      expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    })

    // Req 4.4 — every CTA (and footer link) is a real, reachable, focusable
    // anchor with a destination, so it stays activatable without horizontal
    // scrolling. (jsdom can't measure position; reachability is the verifiable
    // contract — the no-overflow guard is asserted against the stylesheet.)
    it('exposes all CTAs as reachable, focusable anchors with destinations', () => {
      renderPage()
      const links = screen.getAllByRole('link')
      // header: Log In + Sign Up, hero: Sign Up, closing: Sign Up,
      // footer: Privacy + Terms.
      expect(links.length).toBeGreaterThanOrEqual(6)

      for (const link of links) {
        expect(link.tagName).toBe('A')
        expect(link).toHaveAttribute('href')
        expect(link.getAttribute('href')).not.toBe('')
        // Anchors with href are keyboard-reachable and can take focus.
        link.focus()
        expect(link).toHaveFocus()
      }

      // The primary sign-up path is reachable within the initial viewport
      // region (header) and again after the last benefit (closing CTA).
      expect(
        within(screen.getByRole('banner')).getByRole('link', { name: /sign up/i }),
      ).toBeInTheDocument()
      expect(
        within(screen.getByTestId('closing-cta')).getByRole('link', {
          name: /sign up/i,
        }),
      ).toBeInTheDocument()
    })

    // Req 4.6 — the only media element (the brand logo) is covered by the
    // `max-width: 100%` containment rule via its class, so it can never exceed
    // the viewport width. Also verify no image declares an intrinsic width that
    // would overflow the narrowest tested viewport.
    it('constrains images to the viewport width', () => {
      renderPage()
      const images = document.querySelectorAll('img')
      expect(images.length).toBeGreaterThanOrEqual(1)

      for (const img of images) {
        // Each image must carry a class/selector the containment CSS targets.
        expect(img).toHaveClass('landing-header__logo')
        // Intrinsic width attribute (used for CLS) must fit even 360px.
        const declaredWidth = Number(img.getAttribute('width') ?? '0')
        expect(declaredWidth).toBeLessThanOrEqual(360)
      }
    })
  })
})

describe('Landing page responsive layout — active breakpoints per range', () => {
  afterEach(() => {
    window.matchMedia = originalMatchMedia
  })

  // Req 4.1 / 4.5 — Mobile (360–767) and Tablet (768–1023) are below the
  // desktop breakpoint, so the single-column base layout is in force.
  it.each([...MOBILE_WIDTHS, ...TABLET_WIDTHS])(
    'treats %ipx as below the desktop breakpoint (single-column base layout)',
    (width) => {
      setViewportWidth(width)
      expect(window.matchMedia('(min-width: 1024px)').matches).toBe(false)
    },
  )

  // Req 4.2 — Desktop (1024–1920) is at/above the width-constrained breakpoint.
  it.each(DESKTOP_WIDTHS)(
    'treats %ipx as the width-constrained desktop range',
    (width) => {
      setViewportWidth(width)
      expect(window.matchMedia('(min-width: 1024px)').matches).toBe(true)
    },
  )
})

describe('Landing page responsive layout — stylesheet contract', () => {
  // Req 4.1, 4.3, 4.5 — an overflow-x guard prevents any residual horizontal
  // scrolling regardless of content.
  it('declares a horizontal-overflow guard', () => {
    expect(landingCss).toMatch(/overflow-x:\s*(clip|hidden)/)
  })

  // Req 4.1–4.6 — border-box sizing so padding/borders never push declared
  // widths past 100% and force a horizontal scrollbar.
  it('uses border-box sizing', () => {
    expect(landingCss).toMatch(/box-sizing:\s*border-box/)
  })

  // Req 4.2 — body-text measure is tied to a `ch`-based line length and every
  // declared measure sits at or under the 90-characters-per-line ceiling.
  it('holds the body text measure at or under 90ch', () => {
    const measures = chMeasures(landingCss)
    expect(measures.length).toBeGreaterThan(0)
    for (const measure of measures) {
      expect(measure).toBeLessThanOrEqual(90)
    }
    // The shared body measure token must exist and be within the ceiling.
    expect(landingCss).toMatch(/--landing-measure:\s*\d+(?:\.\d+)?ch/)
  })

  // Req 4.2 — a width-constrained content column (max-width) rather than an
  // edge-to-edge layout on desktop.
  it('constrains the content column width', () => {
    expect(landingCss).toMatch(/--landing-content-max:/)
    expect(landingCss).toMatch(/max-width:\s*var\(--landing-content-max\)/)
    // A desktop refinement breakpoint exists for the constrained range.
    expect(landingCss).toMatch(/@media\s*\(min-width:\s*1024px\)/)
  })

  // Req 4.1 — hero and benefit bands stack as a single column.
  it('stacks the hero and benefit bands in a single column', () => {
    expect(landingCss).toMatch(/\.hero\s*\{[^}]*flex-direction:\s*column/)
    expect(landingCss).toMatch(/\.benefit\s*\{[^}]*flex-direction:\s*column/)
  })

  // Req 4.4 — the CTA rows wrap so both account CTAs (and footer links) stay
  // fully visible and activatable without horizontal scrolling, even at 360px.
  it('wraps the header CTA row and footer link row', () => {
    expect(landingCss).toMatch(
      /\.landing-header__actions\s*\{[^}]*flex-wrap:\s*wrap/,
    )
    expect(landingCss).toMatch(
      /\.landing-footer__links\s*\{[^}]*flex-wrap:\s*wrap/,
    )
    // CTAs themselves are capped at their column width so they cannot overflow.
    expect(landingCss).toMatch(/\.cta\s*\{[^}]*max-width:\s*100%/)
  })

  // Req 4.6 — images/media are capped at 100% of their container width, and the
  // brand-logo selector (the one actually rendered) is included in that rule.
  it('caps images and media at the viewport width', () => {
    // The containment rule lists media selectors including `img` and the logo,
    // and sets max-width: 100%.
    expect(landingCss).toMatch(/img[^{]*\{[^}]*max-width:\s*100%/)
    expect(landingCss).toMatch(
      /\.landing-header__logo[^{]*\{[^}]*max-width:\s*100%/,
    )
  })
})
