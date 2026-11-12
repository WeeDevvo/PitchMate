/**
 * BenefitSection — renders a single PitchMate benefit as a card.
 *
 * The landing page explains why PitchMate is worth using through a short run of
 * benefit cards below the hero. This component renders exactly *one* of them:
 * an icon tile, a visible heading and at least one sentence of supporting
 * description (Requirement 2.1). The page composition root instantiates it once
 * per benefit in the content model — between three and eight times
 * (Requirement 2.2) — in a single order below the hero (Requirement 2.7). The
 * 3–8 count, the required first-three themes (fair teams 2.3, easy organising
 * 2.4, results/stats/leaderboards 2.5), and the non-technical vocabulary are
 * enforced at the content/composition level, not here.
 *
 * Heading level: the page has exactly one `<h1>` (the hero value proposition),
 * so each benefit heading renders as an `<h2>`. This keeps the heading outline
 * free of skipped levels (Requirement 6.1).
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7
 */
import type { BenefitModel } from '../content/landingContent'
import { Card, Icon } from '../../../ui'

/** Props for {@link BenefitSection}: the single benefit to render. */
export interface BenefitSectionProps {
  /** The benefit to render — supplies the icon, heading and description. */
  benefit: BenefitModel
}

/**
 * Render one benefit as a card `<section>` containing an `<h2>` heading and a
 * description paragraph. The section is labelled by its heading, and its id is
 * the benefit's, so the header's section links can point at it.
 */
export function BenefitSection({ benefit }: BenefitSectionProps) {
  const headingId = `benefit-${benefit.id}-heading`

  return (
    <Card as="section" id={benefit.id} className="benefit" aria-labelledby={headingId}>
      <span className="benefit__icon" aria-hidden="true">
        <Icon name={benefit.icon} size={28} />
      </span>
      <h2 id={headingId} className="benefit__heading">
        {benefit.heading}
      </h2>
      <p className="benefit__description">{benefit.description}</p>
    </Card>
  )
}

export default BenefitSection
