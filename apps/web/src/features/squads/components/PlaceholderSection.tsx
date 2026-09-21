/**
 * A Placeholder_Section of the Squad_Screen — a heading, an injectable content
 * slot, and, while nothing is injected, a statement of what the section will
 * show (Requirements 15.1, 15.2, 15.3, 15.4, 15.6).
 *
 * The Squad_Screen renders two of these, one for matches and one for stats and
 * leaderboards, in the document order Requirement 6.8 fixes. Both are the same
 * component with different copy, so the "heading always, slot replaces only the
 * statement" rule is implemented once and pinned by one property.
 *
 * ### An absence, not a failure
 *
 * Neither section has any functionality in this spec, and that is a normal state
 * of the screen rather than something going wrong (Requirement 15.2). So nothing
 * here is announced as a failure: no `role="alert"`, no live region, no
 * `aria-invalid`, and no error wording — the statements themselves come from
 * {@link MATCHES_PLACEHOLDER_STATEMENT} and
 * {@link STATS_PLACEHOLDER_STATEMENT} in `lib/messages.ts`, which say what will
 * appear and that it is not available yet.
 *
 * ### The slot, and why absence is decided here
 *
 * `content` is a `ReactNode` threaded from `createSquadsShellRoutes({
 * matchesContent, statsContent })`, mirroring the shell's own
 * `ShellDestinationContent` pattern: the later match-lifecycle and player-stats
 * features supply a body without this file or the Squad_Screen changing
 * (Requirement 15.3). When a body is supplied it stands **in place of the
 * statement only** — the level-two heading stays (Requirement 15.4).
 *
 * "Supplied" means *renderable*. React renders nothing at all for `undefined`,
 * `null`, `true`, and `false`, so treating those as a supplied body would leave
 * the section with a heading and an empty space where its explanation belongs.
 * They are therefore the absent case, which is also what makes an optional prop
 * and an explicitly-passed `undefined` behave identically.
 *
 * ### Headings
 *
 * Exactly one level-two heading, and never a level-one one, so the Squad_Screen
 * keeps the single `h1` it renders for the squad name (Requirements 15.1, 15.6).
 * The heading text is supplied by the screen rather than written here, because
 * the screen owns which subject each of its two sections names; the heading also
 * names the surrounding `section`, so assistive technology announces the region
 * by the same words that are on screen.
 *
 * ### It fetches nothing
 *
 * This component issues no call of any kind: the only leaderboard read in the
 * feature is the `GetSquadLeaderboard` the Player_List needs (Requirement 15.5).
 * There is no hook, no effect, and no api dependency here to make one from.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.6
 */
import { useId, type ReactElement, type ReactNode } from 'react';

// The feature token table, so a section rendered outside the App_Shell frame
// still resolves every custom property `PlaceholderSection.css` reads. No colour
// value is written in either file (Requirement 18.9).
import '../styles/squadsTokens.css';
import './PlaceholderSection.css';

export interface PlaceholderSectionProps {
  /**
   * The section's subject, rendered as its one level-two heading and used as the
   * region's accessible name (Requirement 15.1).
   */
  readonly heading: string;

  /**
   * What the section will show and that it is not available yet, rendered while
   * no content is injected (Requirement 15.2).
   */
  readonly emptyStatement: string;

  /**
   * The injected body. Rendered in place of {@link emptyStatement} when it is
   * renderable, which is how a later feature fills the section without touching
   * the Squad_Screen (Requirements 15.3, 15.4).
   */
  readonly content?: ReactNode;
}

/**
 * True when `content` is a body React would actually render.
 *
 * `undefined`, `null`, `true`, and `false` all render nothing, so each of them
 * is an absent slot rather than an empty one.
 */
function isContentSupplied(content: ReactNode): boolean {
  return (
    content !== undefined && content !== null && typeof content !== 'boolean'
  );
}

/**
 * Render one Placeholder_Section: its level-two heading always, then the
 * injected content if any is supplied and the fixed statement otherwise.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.6
 */
export function PlaceholderSection({
  heading,
  emptyStatement,
  content,
}: PlaceholderSectionProps): ReactElement {
  const headingId = useId();

  return (
    <section className="squads-placeholder" aria-labelledby={headingId}>
      {/* 15.1, 15.4, 15.6: the one level-two heading, rendered whether or not a
          body is injected, and never a level-one one. */}
      <h2 className="squads-placeholder__heading" id={headingId}>
        {heading}
      </h2>
      {isContentSupplied(content) ? (
        // 15.3, 15.4: the injected body, standing in for the statement alone.
        content
      ) : (
        // 15.2: an explanation, carrying no error indication of any kind.
        <p className="squads-placeholder__statement">{emptyStatement}</p>
      )}
    </section>
  );
}

export default PlaceholderSection;
