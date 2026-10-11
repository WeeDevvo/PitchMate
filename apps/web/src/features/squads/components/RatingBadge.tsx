/**
 * The Rating_Presentation of one Player_Row: a Display_Rating, a
 * Provisional_Band, the Never_Played band, or the Rating_Unavailable label.
 *
 * **A note on the numbering below.** Bare requirement numbers are this feature's
 * own, from `web-squads-screens`. The four-condition rule arrived later, from the
 * `web-player-stats-screen` spec's Requirement 17, and every reference to it is
 * written out in full so the two seventeens cannot be mistaken for each other.
 *
 * ### One component for all four presentations
 *
 * Requirement 8.5 and `web-player-stats-screen` Requirement 17.1 allow a
 * Player_Row exactly one of the four, and the choice is already made for it —
 * `selectRatingPresentation` in `lib/ratingPresentation.ts` returns a tagged
 * union, so this component receives one value rather than four optional fields
 * and there is no arrangement of props that renders two of them. Keeping all four
 * renderings in one file is what stops them drifting apart: the badge, the label,
 * and the integer share one wrapper, one descriptor, and one stylesheet, so a
 * change to how a band looks cannot leave another condition behind.
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
 * Each of the four conditions renders **its own words together with its own badge
 * shape** (`web-player-stats-screen` Requirements 17.3, 17.4; Requirements 8.4,
 * 8.7, 19.3):
 *
 * | Condition | Words | Shape | Colour |
 * | --- | --- | --- | --- |
 * | `rating` | the rounded integer | a filled disc, no chip | `--text` |
 * | `provisional` | {@link PROVISIONAL_BAND_LABEL} | a hollow ring, in a chip | `--squads-provisional-text` |
 * | `never-played` | {@link NEVER_PLAYED_BAND_LABEL} | a hollow square, in a chip | `--muted-text` |
 * | `unavailable` | {@link RATING_UNAVAILABLE_LABEL} | a horizontal bar, in a chip | `--muted-text` |
 *
 * Three things follow, and the third is the point. The **words** differ pairwise
 * and none contains another, which `lib/messages.property.test.ts` holds them to.
 * The **silhouettes** differ — disc, ring, square, bar — and only the
 * Display_Rating sits outside a chip, so a greyscale rendering still tells the
 * four apart. And the **two muted conditions share a colour on purpose**:
 * `never-played` and `unavailable` are distinguished by shape and word alone, so
 * no reader can be depending on hue to separate them. The amber of
 * `--squads-provisional-text` only adds emphasis to a statement that survives
 * without it. No colour value is written here or in `RatingBadge.css`; both read
 * the feature token table, and this change introduces no token — it reuses the
 * declared provisional and muted ones (Requirement 18.9).
 *
 * The three non-rating labels come straight from `lib/messages.ts` and take no
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
 * 1240" or "Dave: No matches played yet" as one unit and never has to infer which
 * badge belongs to which row from its visual position (Requirement 8.8), and the
 * four conditions are as distinguishable to assistive technology as they are to
 * the eye (`web-player-stats-screen` Requirement 17.5). A `role="img"` collapses
 * its subtree for name computation, which is exactly what is wanted for a
 * composite of a shape and a word; the alternative — a bare `aria-label` on a
 * `<span>` with no role — is not reliably exposed at all.
 *
 * **The words and the name come out of one switch.** {@link conditionOf} is the
 * only place in the file that reads `presentation.kind`, and it returns the
 * visible text, the spoken statement, and the shape together, so there is no
 * second switch to forget a case in and no way for a row to show one thing and
 * announce another.
 *
 * Requirements: 8.1, 8.4, 8.7, 8.8, 8.12, 8.13, 19.3, and
 * `web-player-stats-screen` 17.3, 17.4, 17.5
 */
import { type ReactElement } from 'react';

import {
  NEVER_PLAYED_BAND_LABEL,
  PROVISIONAL_BAND_LABEL,
  RATING_UNAVAILABLE_LABEL,
} from '../lib/messages';
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
 * The attribute carrying which of the four presentations was rendered, so a test
 * can assert "exactly one presentation per row" without reading copy.
 */
export const RATING_BADGE_KIND_ATTRIBUTE = 'data-rating-kind';

/**
 * The selector of the badge shape, so a test can assert each presentation is
 * carried by shape as well as by text (Requirement 8.7,
 * `web-player-stats-screen` 17.4).
 */
export const RATING_BADGE_SHAPE_SELECTOR = '[data-squads-rating-badge="true"]';

/**
 * The attribute naming which silhouette the badge took, so a test can assert the
 * four conditions carry four distinct non-colour cues without resolving a
 * stylesheet jsdom does not compute (`web-player-stats-screen` 17.4).
 */
export const RATING_BADGE_SHAPE_ATTRIBUTE = 'data-rating-shape';

/**
 * The noun the accessible name uses before a Display_Rating value, so the number
 * is announced as a rating rather than as a bare digit sequence.
 *
 * It lives here rather than in `lib/messages.ts` because it is a fragment of a
 * constructed name rather than a standalone statement — the three labels that
 * *are* statements are imported from there and used verbatim.
 */
const RATING_VALUE_NOUN = 'rating';

/**
 * The silhouette a condition's badge takes. Four names for four shapes, each
 * drawn from `currentColor` in `RatingBadge.css`, so the cue survives a greyscale
 * rendering and can never disagree with the colour of the word beside it.
 */
export type RatingBadgeShape = 'disc' | 'ring' | 'square' | 'bar';

/**
 * Everything one condition renders: the words on screen, the statement its
 * accessible name makes, and the shape beside them.
 */
interface RatingCondition {
  /** The words a reader sees (Requirements 8.1, 8.4, 8.13). */
  readonly text: string;

  /**
   * The statement the accessible name makes, before the player's name is put in
   * front of it (Requirement 8.8, `web-player-stats-screen` 17.5).
   */
  readonly statement: string;

  /** The non-colour cue (`web-player-stats-screen` 17.4). */
  readonly shape: RatingBadgeShape;
}

/**
 * The one place in this file that reads `presentation.kind`.
 *
 * Returning the visible text, the spoken statement, and the shape **together**
 * is what makes "visible text and accessible name cannot disagree" structural
 * rather than a convention: there is no second switch that could answer
 * differently, and a fifth condition added to the union would fail to compile
 * here rather than render as a blank badge.
 *
 * The three non-rating conditions return a fixed string containing no digit, no
 * approximation or range indicator, and no reason, because they *are* the fixed
 * strings from `lib/messages.ts` (Requirements 8.4, 8.13). Only the
 * `never-played` label mentions matches at all, and the count it stands for is
 * zero, so it states a fact rather than a tally (`web-player-stats-screen` 17.3).
 */
function conditionOf(presentation: RatingPresentation): RatingCondition {
  switch (presentation.kind) {
    // 8.1, 8.9: the already-rounded integer as a plain decimal, with a filled
    // disc — the only condition that has a value, and the only solid shape.
    case 'rating': {
      const rendered = String(presentation.value);

      return {
        text: rendered,
        statement: `${RATING_VALUE_NOUN} ${rendered}`,
        shape: 'disc',
      };
    }
    // 8.4, 8.12, player-stats 17.3: the same words on every band, whatever the
    // member. A hollow ring — an outline not yet filled in.
    case 'provisional':
      return {
        text: PROVISIONAL_BAND_LABEL,
        statement: PROVISIONAL_BAND_LABEL,
        shape: 'ring',
      };
    // player-stats 17.2, 17.3: a player with no completed match reads
    // differently from one whose rating is still settling — different words and
    // a different silhouette, a hollow square.
    case 'never-played':
      return {
        text: NEVER_PLAYED_BAND_LABEL,
        statement: NEVER_PLAYED_BAND_LABEL,
        shape: 'square',
      };
    // 8.13: the same words on every row, saying nothing about this player. A
    // horizontal bar — the shape of a blank where a value would be.
    case 'unavailable':
      return {
        text: RATING_UNAVAILABLE_LABEL,
        statement: RATING_UNAVAILABLE_LABEL,
        shape: 'bar',
      };
  }
}

/**
 * The accessible name of one row's Rating_Presentation: the player's name and
 * then the rating value, or that the rating is still settling, or that no match
 * has been played, or that ratings are unavailable (Requirement 8.8,
 * `web-player-stats-screen` 17.5).
 *
 * Pure, total, and free of exceptions — a plain function of the two arguments, so
 * it is assertable without rendering anything.
 *
 * The name is composed as `playerName` verbatim, a colon, and one of the four
 * statements. Verbatim matters twice over: the player's name is always
 * recoverable from the name that was built, and **the only digits a non-rating
 * name can contain are digits of the player's own name** — the statement halves
 * are fixed strings with no digit in them, so no numeric rating value can reach a
 * band or an unavailable label (Requirements 8.4, 8.8, 8.13).
 *
 * Because the statement comes from {@link conditionOf}, which also supplies the
 * visible words, the name a row announces and the words it shows are two readings
 * of one value.
 *
 * A blank player name yields the statement alone rather than a dangling colon.
 * The Response_Parser rejects a blank display name, so this is a guard against a
 * caller rather than a case a squad can reach.
 *
 * @param playerName the name shown on the Player_Row, used as given
 * @param presentation the one presentation that row renders
 * @returns the accessible name for that presentation
 *
 * Requirements: 8.8, and `web-player-stats-screen` 17.5
 */
// eslint-disable-next-line react-refresh/only-export-components -- the badge and the name it renders are one unit, so the pure function stays beside it
export function ratingBadgeAccessibleName(
  playerName: string,
  presentation: RatingPresentation,
): string {
  const { statement } = conditionOf(presentation);

  return playerName.trim() === '' ? statement : `${playerName}: ${statement}`;
}

export interface RatingBadgeProps {
  /** The name of the player this presentation belongs to (Requirement 8.8). */
  readonly playerName: string;

  /**
   * The one presentation this row renders, as chosen by
   * `selectRatingPresentation` (Requirement 8.5,
   * `web-player-stats-screen` 17.1).
   */
  readonly presentation: RatingPresentation;
}

/**
 * Render one Player_Row's Rating_Presentation — one of four conditions, each as
 * its own shape beside its own words, with the whole thing announced as a single
 * named unit.
 *
 * Requirements: 8.1, 8.4, 8.7, 8.8, 8.12, 8.13, 19.3, and
 * `web-player-stats-screen` 17.3, 17.4, 17.5
 */
export function RatingBadge({
  playerName,
  presentation,
}: RatingBadgeProps): ReactElement {
  // One read of the union, for the words, the name, and the shape alike.
  const { text, shape } = conditionOf(presentation);

  return (
    <span
      className="squads-rating"
      // 8.8, player-stats 17.5: one accessible name stating whose rating this is
      // and which of the four conditions holds.
      role="img"
      aria-label={ratingBadgeAccessibleName(playerName, presentation)}
      data-squads-rating="true"
      data-rating-kind={presentation.kind}
    >
      {/* 8.4, 8.7, 19.3, player-stats 17.4: the shape half of the condition —
          four distinct silhouettes, so the four are told apart with every hue
          discarded. Decorative to assistive technology, because the wrapper's
          own name already states everything this shape signals. */}
      <span
        className="squads-rating__badge"
        data-squads-rating-badge="true"
        data-rating-shape={shape}
        aria-hidden="true"
      />
      {/* 8.1, 8.9: the value the leaderboard carried, rounded upstream, with no
          grouping separator and no locale formatting of any kind — or, for the
          other three, the fixed copy that is identical on every row (8.4, 8.13,
          player-stats 17.3). */}
      <span className="squads-rating__text">{text}</span>
    </span>
  );
}

export default RatingBadge;
