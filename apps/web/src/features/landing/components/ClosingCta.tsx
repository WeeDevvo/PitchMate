/**
 * ClosingCta — the final call-to-action band.
 *
 * After a visitor has read the value proposition and scrolled through the
 * benefits, steps and stats, this green band gives them one more, prominent
 * opportunity to act. The page composition (`LandingPage`) places it *after the
 * last Benefit_Section*, so a visitor who has read to the bottom finds a
 * Primary_CTA waiting without scrolling back up (Requirement 3.5).
 *
 * Design notes:
 *   - It is a semantic `<section>` labelled by its `<h2>`, so it is exposed as a
 *     distinct region to assistive technology.
 *   - The band is accent-fill, so its call to action is the design system's
 *     `ink` button (a green button would vanish on it). It still renders
 *     through the shared {@link Cta} control, so activation, keyboard
 *     operability and defensive navigation follow the same single code path as
 *     every other CTA on the page.
 *
 * Requirements: 3.5
 */
import { Cta, type CtaProps } from './Cta'
import { landingContent, type LandingContent } from '../content/landingContent'

/** Props for {@link ClosingCta}. */
export interface ClosingCtaProps extends Omit<CtaProps, 'cta' | 'content'> {
  /**
   * The landing content model supplying the closing heading and CTA. Defaults
   * to the real authored `landingContent`; injectable for testing.
   */
  content?: LandingContent
}

/**
 * The closing call-to-action band rendered after the last section. Renders
 * `content.closing.cta` through the shared {@link Cta} control.
 */
export function ClosingCta({ content = landingContent, ...ctaProps }: ClosingCtaProps) {
  return (
    <section className="closing" aria-labelledby="closing-heading" data-testid="closing-cta">
      <h2 id="closing-heading" className="landing-display closing__heading">
        {content.closing.heading}
      </h2>
      <Cta cta={content.closing.cta} size="lg" {...ctaProps} />
    </section>
  )
}

export default ClosingCta
