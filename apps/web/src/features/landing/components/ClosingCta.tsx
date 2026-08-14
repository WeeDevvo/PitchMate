/**
 * ClosingCta — the final primary call-to-action region.
 *
 * After a visitor has read the value proposition and scrolled through the
 * benefit sections, this region gives them one more, prominent opportunity to
 * act. The page composition (`LandingPage`) places it *after the last
 * Benefit_Section*, so a visitor who has read to the bottom of the benefits
 * finds a Primary_CTA waiting for them without having to scroll back up
 * (Requirement 3.5).
 *
 * Design notes:
 *   - It is a semantic `<section>` with an accessible name, so it is exposed as
 *     a distinct landmark region to assistive technology.
 *   - A short, non-technical prompt line invites the visitor to act; the
 *     authoritative call-to-action itself comes from
 *     `landingContent.closingCta` (a primary Sign Up CTA) and is rendered
 *     through the shared {@link Cta} control, so activation, keyboard
 *     operability, focus semantics, and defensive navigation follow the exact
 *     same single code path as every other CTA on the page.
 *   - Content is injected via props (defaulting to the real `landingContent`)
 *     for testability, mirroring the sibling section components.
 *   - Any `onNavigationError` handler (and other anchor/CTA props) are forwarded
 *     to the underlying control so a navigation failure surfaces through the
 *     page's navigation error region and the control stays retryable.
 *
 * Requirements: 3.5
 */
import { Cta, type CtaProps } from './Cta'
import { landingContent, type LandingContent } from '../content/landingContent'

/** Props for {@link ClosingCta}. */
export interface ClosingCtaProps extends Omit<CtaProps, 'cta' | 'content'> {
  /**
   * The landing content model supplying the closing primary CTA. Defaults to
   * the real authored `landingContent`; injectable for testing.
   */
  content?: LandingContent
}

/**
 * The closing primary call-to-action region rendered after the last benefit.
 * Renders `content.closingCta` through the shared {@link Cta} control.
 */
export function ClosingCta({ content = landingContent, ...ctaProps }: ClosingCtaProps) {
  return (
    <section aria-label="Get started with PitchMate" data-testid="closing-cta">
      <p>Ready to get your next game sorted with fair teams?</p>
      <Cta cta={content.closingCta} {...ctaProps} />
    </section>
  )
}

export default ClosingCta
