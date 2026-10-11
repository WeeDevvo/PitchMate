/**
 * The rating section's body: one of the four Rating_Conditions, rendered as text
 * and a shape, with the statement of what the rating is *for* beneath it.
 *
 * The decision is already made before this component is reached —
 * `resolveRatingCondition` in `lib/ratingCondition.ts` returns exactly one of the
 * four conditions (Requirement 7.1) — so the panel receives **one tagged value**
 * rather than a rating block and an appearance count to re-interpret. There is
 * therefore no arrangement of props that renders two conditions, and no second
 * place in the feature that could decide what a rating means.
 *
 * ### The four presentations
 *
 * | Condition | Visible | Requirement |
 * | --- | --- | --- |
 * | `established` | the Display_Rating as an integer, exactly as parsed | 7.2 |
 * | `provisional` | a badge **and** {@link RATING_PROVISIONAL} | 7.3 |
 * | `never-played` | {@link RATING_NEVER_PLAYED} | 7.4 |
 * | `absent` | {@link RATING_ABSENT} | 7.5 |
 *
 * All four also render {@link RATING_SQUAD_SCOPE_STATEMENT}, because the number
 * means nothing without it: a squad-scoped balancing figure read as a global
 * ranking is a worse misunderstanding than no figure at all (Requirement 7.9).
 * The statement is rendered in **every** condition rather than only beside a
 * number, so the screen does not quietly change what it explains depending on
 * how much data a player has.
 *
 * **No arithmetic happens here.** The `established` arm renders its integer
 * through `formatCount`, which is `String` — no rounding, no grouping separator,
 * no locale formatter, and no scaling. The display scale and offset are the
 * backend's concern alone (Requirement 7.8), and no Rating_Internal is named
 * because the condition union carries none to name (Requirement 7.7).
 *
 * ### One union, one switch, two renderings
 *
 * {@link ratingPresentationOf} is the only place the four conditions are turned
 * into words, and it returns **both** the visible text and the statement the
 * accessible name is built from. The visible text and the announced name
 * therefore come from a single exhaustive switch over a single value, so the two
 * cannot disagree and a fifth condition added to the union fails `tsc -b` here
 * rather than rendering nothing. This is the same arrangement the squads
 * feature's `RatingBadge` uses, for the same reason.
 *
 * The wrapper around the badge and the text is a `role="img"` carrying an
 * `aria-label`, so the composite of a shape and a word is announced as one unit
 * naming whose rating it is and which condition holds — "Dave: rating 1240",
 * "Dave: Rating still settling" — rather than leaving a reader to infer the
 * subject from position. A `role="img"` collapses its own subtree for name
 * computation, which is exactly right for a shape-plus-word composite; the
 * squad-scope statement is deliberately a **sibling** of that wrapper rather
 * than inside it, so it is still read as the prose it is.
 *
 * ### Shape, not colour (Requirements 7.3, 16.6)
 *
 * Every condition renders a badge whose **shape** is its own: a filled disc for a
 * settled rating, a dashed ring for one still settling, a hollow square where
 * nothing has been played, and a dotted diamond where no rating was recorded.
 * Requirement 7.3 asks for a badge only for the Provisional_Rating, but giving
 * all four a distinct shape is what makes "conveyed in addition to any colour"
 * structural rather than a matter of which hue a reader can perceive: the four
 * are told apart by words and by shape before colour is involved, and the amber
 * of `--player-stats-provisional-text` only emphasises a statement that survives
 * greyscale, a forced-colours mode, and a screen reader.
 *
 * Every string comes from `lib/messages.ts` and every colour from a custom
 * property declared in `styles/playerStatsTokens.css`, so this component holds
 * no copy and `RatingPanel.css` holds no colour value.
 *
 * Requirements: 7.2, 7.3, 7.4, 7.5, 7.9, 16.6
 */
import { type ReactElement } from 'react';

import { formatCount } from '../lib/numberFormat';
import {
  RATING_ABSENT,
  RATING_NEVER_PLAYED,
  RATING_PROVISIONAL,
  RATING_SQUAD_SCOPE_STATEMENT,
} from '../lib/messages';
import type { RatingCondition } from '../lib/ratingCondition';

// The feature token table, so a panel rendered outside the App_Shell frame still
// resolves every custom property `RatingPanel.css` reads (Requirement 15.2).
import '../styles/playerStatsTokens.css';
import './RatingPanel.css';

/** The selector of the panel, so a test can assert over its whole subtree. */
export const RATING_PANEL_SELECTOR = '[data-player-stats-rating="true"]';

/**
 * The attribute carrying which of the four conditions was rendered, so a test
 * can name the condition it means rather than matching on copy.
 */
export const RATING_PANEL_CONDITION_ATTRIBUTE = 'data-rating-condition';

/**
 * The selector of the named composite — the badge and the text announced as one
 * unit — so a test can read the accessible name without guessing at the tree.
 */
export const RATING_PANEL_PRESENTATION_SELECTOR =
  '[data-player-stats-rating-presentation="true"]';

/**
 * The selector of the badge shape, so a test can assert each condition carries a
 * non-colour cue and that no two conditions carry the same one
 * (Requirements 7.3, 16.6).
 */
export const RATING_PANEL_BADGE_SELECTOR = '[data-player-stats-rating-badge]';

/** The selector of the visible words (or digits) of the presentation. */
export const RATING_PANEL_TEXT_SELECTOR = '[data-player-stats-rating-text="true"]';

/** The selector of the squad-scope statement (Requirement 7.9). */
export const RATING_PANEL_SCOPE_SELECTOR = '[data-player-stats-rating-scope="true"]';

/**
 * The noun the accessible name puts before a Display_Rating, so the number is
 * announced as a rating rather than as a bare digit sequence.
 *
 * It lives here rather than in `lib/messages.ts` because it is a fragment of a
 * constructed name rather than a standalone statement — exactly as the squads
 * feature's `RatingBadge` declares the same fragment beside its own composed
 * name. The three conditions that *are* statements take their words verbatim
 * from `lib/messages.ts` and nothing is appended to them.
 */
const RATING_VALUE_NOUN = 'rating';

/** The separator between the player's name and the statement about them. */
const NAME_SEPARATOR = ': ';

/**
 * What one condition renders: the words a person sees, and the statement a
 * screen reader hears after the player's name.
 *
 * Two fields rather than one, because the `established` condition's visible form
 * is a bare integer — `'1240'` on screen reads fine beside a section heading,
 * while `'Dave: 1240'` announced in isolation does not say what the number is.
 * The other three use one string for both, which is the point of returning them
 * together: there is no path on which the seen and heard forms are derived
 * independently.
 */
interface RatingPresentation {
  /** The words or digits rendered on screen. */
  readonly visibleText: string;

  /** The claim the accessible name makes about the rating. */
  readonly statement: string;
}

/**
 * The one mapping from the Rating_Condition union to words.
 *
 * Exhaustive over the union with no default arm, so a fifth condition is a
 * compile failure here rather than a silently unrendered rating. Pure, total,
 * and free of exceptions.
 *
 * The three non-numeric conditions return a fixed string from `lib/messages.ts`
 * containing **no digit** — no rating value, no approximation or range, and no
 * count of matches — so a provisional rating cannot render as a figure however it
 * is reached (Requirement 7.3), and the three are pairwise distinct with none a
 * substring of another (Requirement 7.6).
 *
 * Requirements: 7.2, 7.3, 7.4, 7.5
 */
function ratingPresentationOf(condition: RatingCondition): RatingPresentation {
  switch (condition.kind) {
    // 7.2, 7.8: the integer exactly as parsed — `formatCount` is `String`, so
    // nothing is rounded, grouped, scaled, or localised.
    case 'established': {
      const visibleText = formatCount(condition.displayRating);

      return {
        visibleText,
        statement: `${RATING_VALUE_NOUN} ${visibleText}`,
      };
    }
    // 7.3: a label stating the condition, paired with a badge in the markup
    // below. The union's provisional arm carries no number, so there is none to
    // render even by accident.
    case 'provisional':
      return { visibleText: RATING_PROVISIONAL, statement: RATING_PROVISIONAL };
    // 7.4: nothing has been played, which is not the same claim as a rating that
    // has not settled.
    case 'never-played':
      return {
        visibleText: RATING_NEVER_PLAYED,
        statement: RATING_NEVER_PLAYED,
      };
    // 7.5: appearances exist, yet the read model carried no rating at all.
    case 'absent':
      return { visibleText: RATING_ABSENT, statement: RATING_ABSENT };
  }
}

/**
 * The accessible name of the rating presentation: whose rating it is, and which
 * condition holds (Requirements 7.3, 7.6, 16.6).
 *
 * Pure, total, and free of exceptions — a plain function of its two arguments,
 * so it is assertable without rendering anything.
 *
 * Composed as the player's name verbatim, a colon, and the condition's own
 * statement. Verbatim matters twice over: the name is always recoverable from the
 * name that was built, and **the only digits a non-established name can carry are
 * the digits of the player's own name**, because the statement halves are fixed
 * strings with no digit in them. That is what makes "a provisional rating never
 * renders as a number" true of the announced name as well as of the visible text.
 *
 * A blank name yields the statement alone rather than a dangling colon. The
 * Response_Parser rejects a blank display name, so this guards a caller rather
 * than a squad.
 *
 * @param playerName the name of the player this rating belongs to, used as given
 * @param condition the one condition this panel renders
 * @returns the accessible name of the badge-and-text composite
 *
 * Requirements: 7.2, 7.3, 7.4, 7.5
 */
// eslint-disable-next-line react-refresh/only-export-components -- the panel and the name it announces are one unit, so the pure function stays beside it
export function ratingPanelAccessibleName(
  playerName: string,
  condition: RatingCondition,
): string {
  const { statement } = ratingPresentationOf(condition);

  return playerName.trim() === ''
    ? statement
    : `${playerName}${NAME_SEPARATOR}${statement}`;
}

export interface RatingPanelProps {
  /**
   * The name of the player whose rating this is, as the identity header renders
   * it. Used only to say whose rating is being announced — never to decide the
   * condition, which is already resolved.
   */
  readonly playerName: string;

  /**
   * The one condition this panel renders, as resolved by
   * `resolveRatingCondition` (Requirement 7.1).
   */
  readonly condition: RatingCondition;
}

/**
 * Render the rating section's body: the badge and the words for the resolved
 * condition, announced as one named unit, above the statement of what the rating
 * is for.
 *
 * Requirements: 7.2, 7.3, 7.4, 7.5, 7.9, 16.6
 */
export function RatingPanel({
  playerName,
  condition,
}: RatingPanelProps): ReactElement {
  const { visibleText } = ratingPresentationOf(condition);

  return (
    <div
      className="player-stats-rating"
      data-player-stats-rating="true"
      data-rating-condition={condition.kind}
    >
      {/* One accessible name for the shape and the words together, so the
          condition is announced once and in full. */}
      <span
        className="player-stats-rating__presentation"
        role="img"
        aria-label={ratingPanelAccessibleName(playerName, condition)}
        data-player-stats-rating-presentation="true"
      >
        {/* 7.3, 16.6: the non-colour cue. Each condition's badge is its own
            shape; decorative to assistive technology, because the wrapper's
            name already states everything the shape signals. */}
        <span
          className={`player-stats-rating__badge player-stats-rating__badge--${condition.kind}`}
          data-player-stats-rating-badge={condition.kind}
          aria-hidden="true"
        />
        {/* 7.2, 7.3, 7.4, 7.5: the integer exactly as parsed, or the fixed
            label for the condition that holds. */}
        <span
          className={`player-stats-rating__text player-stats-rating__text--${condition.kind}`}
          data-player-stats-rating-text="true"
        >
          {visibleText}
        </span>
      </span>

      {/* 7.9: rendered in every condition, so the figure above is never read as
          a cross-squad ranking. */}
      <p
        className="player-stats-rating__scope"
        data-player-stats-rating-scope="true"
      >
        {RATING_SQUAD_SCOPE_STATEMENT}
      </p>
    </div>
  );
}

export default RatingPanel;
