/**
 * HeroSection — the above-the-fold introduction to PitchMate.
 *
 * This is the first thing a visitor sees, and it carries the page's core
 * promise in the region that is visible without scrolling (Requirement 1.1):
 *
 *   - The single value proposition is rendered as the page's one and only
 *     `<h1>` (Requirement 1.1; the page-level heading outline in Requirement
 *     6.1 depends on this being the sole level-1 heading — benefit sections use
 *     `<h2>`).
 *   - A short supporting subheadline (1–2 sentences, ≤160 characters, enforced
 *     in the content model) sits beneath the headline to reinforce the promise
 *     (Requirement 1.3).
 *   - Exactly ONE primary call to action lives inside the hero, prompting the
 *     visitor to sign up, and it renders within the initial viewport
 *     (Requirements 1.4, 3.4). It routes through the shared {@link Cta} control
 *     so activation, keyboard operability, and defensive navigation all follow
 *     the single code path used across the page.
 *
 * The hero is a semantic `<section>` so assistive technology and the document
 * outline treat it as a distinct region. Content is injected via props (with a
 * default of the authored `landingContent`) so the section stays presentational
 * and is straightforward to test in isolation.
 *
 * Requirements: 1.1, 1.3, 1.4, 3.4
 */
import { Cta, type NavigationErrorHandler } from './Cta'
import { landingContent, type LandingContent } from '../content/landingContent'

export interface HeroSectionProps {
  /**
   * The authored content to render. Defaults to the real {@link landingContent}
   * so callers get production copy for free; tests can inject a fixture.
   */
  content?: LandingContent
  /**
   * Forwarded to the primary CTA so a navigation failure/timeout can be
   * surfaced by the page's navigation error region while the visitor stays put.
   */
  onNavigationError?: NavigationErrorHandler
}

/**
 * Render the hero: the sole `<h1>` value proposition, its supporting
 * subheadline, and exactly one primary sign-up CTA.
 */
export function HeroSection({
  content = landingContent,
  onNavigationError,
}: HeroSectionProps) {
  const { headline, subheadline, primaryCta } = content.hero

  return (
    <section className="hero" aria-labelledby="hero-heading">
      <h1 id="hero-heading" className="hero__headline">
        {headline}
      </h1>
      <p className="hero__subheadline">{subheadline}</p>
      <Cta cta={primaryCta} className="hero__cta" onNavigationError={onNavigationError} />
    </section>
  )
}

export default HeroSection
