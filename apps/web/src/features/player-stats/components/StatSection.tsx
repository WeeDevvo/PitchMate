/**
 * One section of the Player_Stats_Screen — a landmark region, its heading, and
 * the section's own content.
 *
 * The screen renders ten of these in a fixed reading order: record, rating,
 * progression, streaks and bibs, the four pairwise sections, and rich stats
 * (the identity header is not one, because it carries the screen's `h1`). All ten
 * are this component with different copy and different bodies, so the two
 * structural rules below are implemented once and asserted once rather than
 * restated ten times with ten chances of going wrong.
 *
 * ### The two rules
 *
 * 1. **A `section` with an accessible name taken from its own heading.** A bare
 *    `section` is not a landmark; one with an accessible name is, and only then
 *    can a person move through the screen by its regions (Requirement 16.3). The
 *    name comes from `aria-labelledby` pointing at the heading rather than from
 *    an `aria-label` duplicating it, so the announced name and the visible words
 *    are the same string and cannot drift apart.
 * 2. **Exactly one level-two heading, and never any other level.** The screen
 *    owes exactly one `h1` in every condition, contributed by the identity header
 *    or by the Not_Found_Treatment (Requirements 5.1, 3.6, 16.1), so a section
 *    heading is always a level two — which is also what keeps the outline free of
 *    a skipped level (Requirement 16.2). The level is fixed here rather than
 *    being a prop: a prop would let one call site produce an `h3` directly under
 *    the `h1`, and `validateHeadingOutline` would then catch it only once a whole
 *    screen rendered.
 *
 * ### What it is not
 *
 * It holds no copy — the heading text is the caller's, because the screen owns
 * which subject each section names and every one of those strings is declared in
 * `lib/messages.ts`. It holds no empty-state wording either: a section with
 * nothing to show renders its own no-data statement as its body, and what that
 * statement says differs per section. And it issues no call and reads no state;
 * it is a wrapper, which is why it can be rendered in isolation by every one of
 * the section tests.
 *
 * Requirements: 16.1, 16.2, 16.3
 */
import { useId, type ReactElement, type ReactNode } from 'react';

import '../styles/playerStatsTokens.css';
import './surfaces.css';

/** The selector of a section, so a test can count or walk the screen's regions. */
export const STAT_SECTION_SELECTOR = '[data-player-stats-section="true"]';

export interface StatSectionProps {
  /**
   * The section's subject, rendered as its one level-two heading and used as the
   * region's accessible name (Requirement 16.3). Supplied by the screen from
   * `lib/messages.ts`.
   */
  readonly heading: string;

  /**
   * The section's content — the panel, the table, the entry list, or the no-data
   * statement that stands in for them.
   */
  readonly children?: ReactNode;
}

/**
 * Render one section: a named landmark region, its single level-two heading, and
 * its content.
 *
 * Requirements: 16.1, 16.2, 16.3
 */
export function StatSection({ heading, children }: StatSectionProps): ReactElement {
  // Generated rather than derived from the heading text: two sections could
  // otherwise collide on a repeated word, and a duplicated id would make
  // `aria-labelledby` resolve to whichever came first.
  const headingId = useId();

  return (
    <section
      className="player-stats-section"
      // 16.3: the region's accessible name, taken from the heading below so the
      // announced name and the visible words are one string.
      aria-labelledby={headingId}
      data-player-stats-section="true"
    >
      {/* 16.1, 16.2: exactly one heading, always a level two. */}
      <h2 className="player-stats-section__heading" id={headingId}>
        {heading}
      </h2>
      {children}
    </section>
  );
}

export default StatSection;
