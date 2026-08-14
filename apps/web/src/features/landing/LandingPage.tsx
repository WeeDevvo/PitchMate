/**
 * LandingPage — the composition root for the marketing landing page (`/`).
 *
 * This component owns no business logic and no copy of its own. Its single
 * responsibility is to compose the feature's pieces in reading order behind the
 * page's semantic landmarks, so the visual reading order and the keyboard focus
 * order line up (Requirements 2.7, 6.4):
 *
 *   <ThemeProvider>            — applies/tracks the dark-first theme (task 7)
 *     <PageHead>               — discovery + social-sharing metadata (task 9)
 *     <NavigationErrorRegion>  — accessible live region for nav failures
 *     <header> NavigationHeader — brand + Sign Up / Log In entry points
 *     <main>
 *       HeroSection            — the single <h1> value proposition + primary CTA
 *       BenefitSection × 3–8   — one per benefit, in content-model order
 *       ClosingCta             — a final primary CTA after the last benefit
 *     <footer> SiteFooter      — brand + privacy / terms links
 *
 * The benefit sections are rendered straight from `landingContent.benefits`
 * (already constrained to 3–8 entries and validated for order/vocabulary in the
 * content model and its tests), guaranteeing they sit below the hero in a single
 * top-to-bottom order with none above it (Requirement 2.7).
 *
 * Navigation is defensive: the sign up, log in, privacy, and terms surfaces are
 * owned by other features and may not yet be reachable. Every CTA and footer
 * link routes through the shared control's `navigateWithFallback` budget; on
 * failure it calls back here, and we surface a retryable message through the
 * single page-level `NavigationErrorRegion` without moving focus or unmounting
 * the control (Requirements 3.7, 8.5). CTA failures read as a retry prompt;
 * footer-link failures read as "unavailable".
 *
 * Requirements: 2.7, 6.4
 */
import { useState } from 'react'
import ThemeProvider from './components/ThemeProvider'
import PageHead from './components/PageHead'
import NavigationHeader from './components/NavigationHeader'
import HeroSection from './components/HeroSection'
import BenefitSection from './components/BenefitSection'
import ClosingCta from './components/ClosingCta'
import SiteFooter from './components/SiteFooter'
import NavigationErrorRegion, {
  type NavigationErrorKind,
} from './components/NavigationErrorRegion'
import type { NavigationErrorHandler } from './components/Cta'
import { landingContent, type LandingContent } from './content/landingContent'
import './styles/theme.css'
import './styles/landing.css'

/** A navigation failure to surface in the page-level live region. */
interface NavError {
  message: string
  kind: NavigationErrorKind
}

export interface LandingPageProps {
  /**
   * The content model to render. Defaults to the authored {@link landingContent}
   * so the `/` route gets production copy for free; tests can inject a fixture.
   */
  content?: LandingContent
}

/**
 * Compose the full marketing landing page. Mounted at `/` (see `main.tsx`).
 */
export function LandingPage({ content = landingContent }: LandingPageProps) {
  const [navError, setNavError] = useState<NavError | null>(null)

  // A Sign Up / Log In CTA failed or timed out (Requirement 3.7): keep the
  // visitor here and prompt a retry on the same control.
  const handleCtaError: NavigationErrorHandler = (_href, label) => {
    setNavError({
      kind: 'navigation',
      message: `Sorry, we couldn't open ${label} just now. Please try again.`,
    })
  }

  // A footer link's destination could not be reached (Requirement 8.5):
  // indicate the requested content is unavailable; the link stays retryable.
  const handleFooterError: NavigationErrorHandler = (_href, label) => {
    setNavError({
      kind: 'unavailable',
      message: `Sorry, ${label} is unavailable right now. Please try again later.`,
    })
  }

  return (
    <ThemeProvider>
      <PageHead />
      <NavigationErrorRegion
        id="landing-nav-error"
        message={navError?.message}
        kind={navError?.kind}
      />
      <NavigationHeader content={content} onNavigationError={handleCtaError} />
      <main className="landing-main">
        <HeroSection content={content} onNavigationError={handleCtaError} />
        {content.benefits.map((benefit) => (
          <BenefitSection key={benefit.id} benefit={benefit} />
        ))}
        <ClosingCta content={content} onNavigationError={handleCtaError} />
      </main>
      <SiteFooter content={content} onNavigationError={handleFooterError} />
    </ThemeProvider>
  )
}

export default LandingPage
