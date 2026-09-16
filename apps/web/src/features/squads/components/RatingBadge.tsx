/**
 * The Rating_Presentation of one Player_Row: a Display_Rating, a
 * Provisional_Band, or the Rating_Unavailable label.
 *
 * ### One component for all three presentations
 *
 * Requirement 8.5 allows a Player_Row exactly one of the three, and the choice is
 * already made for it — `selectRatingPresentation` in `lib/ratingPresentation.ts`
 * returns a tagged union, so this component receives one value rather than three
 * optional fields and there is no arrangement of props that renders two of them.
 * Keeping all three renderings in one file is what stops them drifting apart: the
 * badge, the label, and the integer share one wrapper, one accessible-name
 * function, and one stylesheet, so a change to how a band looks cannot leave the
 * unavailable label behind.
 *
 * **Nothing here computes a rating.** The value arrives already rounded by
 * `formatDisplayRating`, and this file renders it with `String(value)` — no
 * arithmetic, no `toLocaleString`. That is deliberate rather than lazy: a locale
 * formatter is free to insert a grouping separator or locale-specific digits, and
 * Requirement 8.1 asks for a plain decimal integer on every row whatever the
 * reader's locale. There is no mean skill estimate, no uncertainty value, and no
 * scaling parameter in sight, because the mapping to a friendly number is the
 * backend's (Requirement 8.9).
 *
 * ### Text and shape, never colour alone
 *
 * A Provisional_Band renders a badge shape **together with**
 * {@link PROVISIONAL_BAND_LABEL}, and the Rating_Unavailable presentation renders
 * the same badge shape with {@link RATING_UNAVAILABLE_LABEL} (Requirements 8.4,
 * 8.7, 19.3). Both also sit in an outlined chip, which a Display_Rating does not,
 * so the three are told apart by words and by shape before any hue is involved —
 * the amber of `--squads-provisional-text` only adds emphasis to a statement that
 * survives without it. No colour value is written here or in `RatingBadge.css`;
 * both read the feature token table (Requirement 18.9).
 *
 * The two non-rating labels come straight from `lib/messages.ts` and take no
 * interpolation parameter, so their content is identical on every row that
 * presents them irrespective of that member's Membership_State, Guest_Flag, and
 * Member_Role and irrespective of how many entries the leaderboard carried
 * (Requirements 8.12, 8.13). Those fields are not props of this component, which
 * is the mechanism rather than the intention: a band cannot acquire a tell about
 * why a rating is missing from data it was never handed.
 *
 * ### The accessible name is the whole statement
 *
 * The wrapper is a `role="img"` carrying an `aria-label` built by
 * {@link ratingBadgeAccessibleName}, so a screen reader announces "Dave: rating
 * 1240" or "Dave: No settled rating yet" as one unit and never has to infer which
 * badge belongs to which row from its visual position (Requirement 8.8). A
 * `role="img"` collapses its subtree for name computation, which is exactly what
 * is wanted for a composite of a shape and a word; the alternative — a bare
 * `aria-label` on a `<span>` with no role — is not reliably exposed at all.
 *
 * Requirements: 8.1, 8.4, 8.7, 8.8, 8.12, 8.13, 19.3
 */
import { type ReactElement } from 'react';

import { PROVISIONAL_BAND_LABEL, RATING_UNAVAILABLE_LABEL } from '../lib/messages';
import type { RatingPresentation } from '../lib/ratingPresentation';

// The feature token table, so a badge rendered outside the App_Shell frame still
// resolves every custom property `RatingBadge.css` reads. No colour value is
// written in either file (Requirement 18.9).
import '../styles/squadsTokens.css';
import './RatingBadge.css';

/**
 * The selector of a Rating_Presentation, so a Player_Row or Player_List test
 * finds the badge of a row without depending on its accessible name.
 */
export const RATING_BADGE_SELECTOR = '[data-squads-rating="true"]';

/**
 * The attribute carrying which of the three presentations was rendered, so a test
 * can assert "exactly one presentation per row" without reading copy.
 */
export const RATING_BADGE_KIND_ATTRIBUTE = 'data-rating-kind';

/**
 * The selector of the badge shape, so a test can assert the two non-rating
 * presentations are carried by shape as well as by text (Requirement 8.7).
 */
export const RATING_BADGE_SHAPE_SELECTOR = '[data-squads-rating-badge="true"]';

/**
 * The noun the accessible name uses before a Display_Rating value, so the number
 * is announced as a rating rather than as a bare digit sequence.
 *
 * It lives here rather than in `lib/messages.ts` because it is a fragment of a
 * constructed name rather than a standalone statement — the two labels that *are*
 * statements are imported from there and used verbatim.
 */
const RATING_VALUE_NOUN = 'rating';

/**
 * The statement each presentation makes about a rating, before the player's name
 * is put in front of it.
 *
 * The two non-rating cases return a fixed string containing no digit, no
 * approximation or range indicator, no count of matches played, and no reason,
 * because they *are* the fixed strings from `lib/messages.ts` (Requirements 8.4,
 * 8.13).
 */
function ratingStatementOf(presentation: RatingPresentation): string {
  switch (presentation.kind) {
    // 8.1: the already-rounded integer, rendered as a plain decimal.
    case 'rating':
      return `${RATING_VALUE_NOUN} ${String(presentation.value)}`;
    // 8.4, 8.12: the same words on every band, whatever the member.
    case 'provisional':
      return PROVISIONAL_BAND_LABEL;
    // 8.13: the same words on every row, saying nothing about this player.
    case 'unavailable':
      return RATING_UNAVAILABLE_LABEL;
  }
}

/**
 * The words a presentation renders on screen: the already-rounded integer as a
 * plain decimal, or one of the two fixed labels (Requirements 8.1, 8.4, 8.13).
 *
 * The visible text and the accessible name are built from the same union in the
 * same file, so a row cannot show one thing and announce another.
 */
function visibleRatingTextOf(presentation: RatingPresentation): string {
  switch (presentation.kind) {
    case 'rating':
      return String(presentation.value);
    case 'provisional':
      return PROVISIONAL_BAND_LABEL;
    case 'unavailable':
      return RATING_UNAVAILABLE_LABEL;
  }
}

/**
 * The accessible name of one row's Rating_Presentation: the player's name and
 * then the rating value, or that no settled rating exists yet, or that ratings are
 * unavailable (Requirement 8.8).
 *
 * Pure, total, and free of exceptions — a plain function of the two arguments, so
 * it is assertable without rendering anything.
 *
 * The name is composed as `playerName` verbatim, a colon, and one of the three
 * statements. Verbatim matters twice over: the player's name is always
 * recoverable from the name that was built, and **the only digits a non-rating
 * name can contain are digits of the player's own name** — the statement halves
 * are fixed strings with no digit in them, so no numeric rating value can reach a
 * band or an unavailable label (Requirements 8.4, 8.8, 8.13).
 *
 * A blank player name yields the statement alone rather than a dangling colon.
 * The Response_Parser rejects a blank display name, so this is a guard against a
 * caller rather than a case a squad can reach.
 *
 * @param playerName the name shown on the Player_Row, used as given
 * @param presentation the one presentation that row renders
 * @returns the accessible name for that presentation
 *
 * Requirements: 8.8
 */
// eslint-disable-next-line react-refresh/only-export-components -- the badge and the name it renders are one unit, so the pure function stays beside it
export function ratingBadgeAccessibleName(
  playerName: string,
  presentation: RatingPresentation,
): string {
  const statement = ratingStatementOf(presentation);

  return playerName.trim() === '' ? statement : `${playerName}: ${statement}`;
}

export interface RatingBadgeProps {
  /** The name of the player this presentation belongs to (Requirement 8.8). */
  readonly playerName: string;

  /**
   * The one presentation this row renders, as chosen by
   * `selectRatingPresentation` (Requirement 8.5).
   */
  readonly presentation: RatingPresentation;
}

/**
 * Render one Player_Row's Rating_Presentation: the integer, the badge and band
 * label, or the badge and unavailable label — with the whole thing announced as a
 * single named unit.
 *
 * Requirements: 8.1, 8.4, 8.7, 8.8, 8.12, 8.13, 19.3
 */
export function RatingBadge({
  playerName,
  presentation,
}: RatingBadgeProps): ReactElement {
  const isRating = presentation.kind === 'rating';

  return (
    <span
      className="squads-rating"
      // 8.8: one accessible name stating whose rating this is and what it says.
      role="img"
      aria-label={ratingBadgeAccessibleName(playerName, presentation)}
      data-squads-rating="true"
      data-rating-kind={presentation.kind}
    >
      {/* 8.4, 8.7, 19.3: the shape half of the two non-rating presentations.
          Decorative to assistive technology, because the wrapper's own name
          already states everything this shape signals. */}
      {!isRating && (
        <span
          className="squads-rating__badge"
          data-squads-rating-badge="true"
          aria-hidden="true"
        />
      )}
      {/* 8.1, 8.9: the value the leaderboard carried, rounded upstream, with no
          grouping separator and no locale formatting of any kind — or, for the
          other two, the fixed copy that is identical on every row (8.4, 8.13). */}
      <span className="squads-rating__text">
        {visibleRatingTextOf(presentation)}
      </span>
    </span>
  );
}

export default RatingBadge;
