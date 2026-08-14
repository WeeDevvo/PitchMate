/**
 * BenefitSection — renders a single PitchMate benefit.
 *
 * The landing page explains why PitchMate is worth using through a short run of
 * benefit sections below the hero. This component renders exactly *one* of them:
 * a visible heading paired with at least one sentence of supporting description
 * (Requirement 2.1). The page composition root instantiates it once per benefit
 * in the content model — between three and eight times (Requirement 2.2) — in a
 * single top-to-bottom order below the hero (Requirement 2.7). The 3–8 count,
 * the required first-three themes (fair teams 2.3, easy organising 2.4,
 * results/stats/leaderboards 2.5), and the non-technical vocabulary are enforced
 * at the content/composition level, not here.
 *
 * Heading level: the page has exactly one `<h1>` (the hero value proposition),
 * so each benefit heading renders as an `<h2>`. This keeps the heading outline
 * free of skipped levels (Requirement 6.1).
 *
 * The component is deliberately thin and declarative: it reads a `BenefitModel`
 * and renders semantic markup, holding no logic of its own.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7
 */
import type { BenefitModel } from '../content/landingContent'

/** Props for {@link BenefitSection}: the single benefit to render. */
export interface BenefitSectionProps {
  /** The benefit to render — supplies the heading and description text. */
  benefit: BenefitModel
}

/**
 * Render one benefit as a semantic `<section>` containing an `<h2>` heading and
 * a description paragraph. The section is labelled by its heading so assistive
 * technology announces the region with a meaningful name.
 */
export function BenefitSection({ benefit }: BenefitSectionProps) {
  const headingId = `benefit-${benefit.id}-heading`

  return (
    <section className="benefit" aria-labelledby={headingId}>
      <h2 id={headingId} className="benefit__heading">
        {benefit.heading}
      </h2>
      <p className="benefit__description">{benefit.description}</p>
    </section>
  )
}

export default BenefitSection
