/**
 * HeroSection — the above-the-fold introduction to PitchMate.
 *
 * This is the first thing a visitor sees, and it carries the page's core
 * promise in the region that is visible without scrolling (Requirement 1.1):
 *
 *   - The single value proposition is rendered as the page's one and only
 *     `<h1>`, its second line in green (Requirement 1.1; the heading outline in
 *     Requirement 6.1 depends on this being the sole level-1 heading).
 *   - A short supporting subheadline (1–2 sentences, ≤160 characters, enforced
 *     in the content model) sits beneath the headline (Requirement 1.3).
 *   - Exactly ONE primary call to action lives inside the hero, prompting the
 *     visitor to start a squad, and it renders within the initial viewport
 *     (Requirements 1.4, 3.4). It routes through the shared {@link Cta}
 *     control. Beside it, a secondary link scrolls to "How it works".
 *   - Opposite the copy sits an example match card: the design system's real
 *     `FairnessMeter`, so the page shows the product rather than describing it.
 *     It is a `figure` with a caption for assistive technology.
 *
 * Requirements: 1.1, 1.3, 1.4, 3.4
 */
import { Cta, type NavigationErrorHandler } from './Cta'
import { landingContent, type LandingContent } from '../content/landingContent'
import { Badge, Card, FairnessMeter, buttonClasses } from '../../../ui'

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
 * subheadline, one primary CTA with a secondary section link, and the example
 * fairness card.
 */
export function HeroSection({
  content = landingContent,
  onNavigationError,
}: HeroSectionProps) {
  const { overline, headline, headlineAccent, subheadline, primaryCta, secondaryLink, footnote, example } =
    content.hero
  // The headline's end goes on its own green line; the h1 still reads as the
  // one sentence.
  const lead = headline.endsWith(headlineAccent) ? headline.slice(0, -headlineAccent.length).trimEnd() : headline
  const accent = lead === headline ? null : headlineAccent

  return (
    <section className="hero" aria-labelledby="hero-heading">
      <span className="hero__stripe" aria-hidden="true" />
      <div className="hero__copy">
        <p className="landing-overline hero__overline">{overline}</p>
        <h1 id="hero-heading" className="hero__headline">
          {lead}
          {accent && (
            <>
              {' '}
              <span className="landing-accent">{accent}</span>
            </>
          )}
        </h1>
        <p className="hero__subheadline">{subheadline}</p>
        <div className="hero__actions">
          <Cta cta={primaryCta} size="lg" className="hero__cta" onNavigationError={onNavigationError} />
          <a href={secondaryLink.href} className={`cta ${buttonClasses({ variant: 'secondary', size: 'lg' })}`}>
            {secondaryLink.label}
          </a>
        </div>
        <p className="hero__footnote">{footnote}</p>
      </div>
      <figure className="hero__visual">
        <Card raised className="hero__card">
          <div className="hero__card-head">
            <span className="landing-overline">{example.when}</span>
            <Badge tone="admin" icon="shuffle">
              {example.state}
            </Badge>
          </div>
          <FairnessMeter
            teamA={example.teamA}
            teamB={example.teamB}
            winA={example.winA}
            draw={example.draw}
            winB={example.winB}
          />
        </Card>
        <figcaption className="pm-sr">
          An example match: {example.teamA} against {example.teamB}, predicted close to 50/50.
        </figcaption>
      </figure>
    </section>
  )
}

export default HeroSection
