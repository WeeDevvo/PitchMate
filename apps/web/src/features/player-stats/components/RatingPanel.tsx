/**
 * The rating section's body: one of the four Rating_Conditions, rendered as text
 * and a shape, with the statement of what the rating is *for* beneath it.
 *
 * The decision is already made before this component is reached —
 * `resolveRatingCondition` in `lib/ratingCondition.ts` returns exactly one of the
 * four conditions (Requirement 7.1) — so the panel receives **one tagged value**
 * rather than a rating block and an appearance count to re-interpret.
 *
 * ### The four presentations
 *
 * | Condition | Visible | Requirement |
 * | --- | --- | --- |
 * | `established` | the Display_Rating as an integer, exactly as parsed | 7.2 |
 * | `settling` | the same integer, in the same style, and {@link RATING_SETTLING_NOTE} beneath it | 7.3 |
 * | `never-played` | {@link RATING_NEVER_PLAYED} | 7.4 |
 * | `absent` | {@link RATING_ABSENT} | 7.5 |
 *
 * **A settling rating looks like every other rating** (brand.md). Its number
 * takes the established number's badge, classes and accessible name: no amber,
 * no "~", no label on the figure. What tells a reader it is still settling is
 * words — the settling mark beside the player's name in the identity header, and
 * the plain sentence under the figure here — so the condition does not depend on
 * colour or shape being perceived (Requirement 16.6).
 *
 * All four also render {@link RATING_SQUAD_SCOPE_STATEMENT}, because the number
 * means nothing without it: a squad-scoped balancing figure read as a global
 * ranking is a worse misunderstanding than no figure at all (Requirement 7.9).
 *
 * **No arithmetic happens here.** A number is rendered through `formatCount`,
 * which is `String` — no rounding, no grouping separator, no locale formatter,
 * and no scaling. The display scale and offset are the backend's concern alone
 * (Requirement 7.8), and no Rating_Internal is named because the condition union
 * carries none to name (Requirement 7.7).
 *
 * ### One union, one switch, two renderings
 *
 * {@link ratingPresentationOf} is the only place the four conditions are turned
 * into words, and it returns **both** the visible text and the statement the
 * accessible name is built from, so the two cannot disagree and a fifth
 * condition added to the union fails `tsc -b` here rather than rendering
 * nothing.
 *
 * The wrapper around the badge and the text is a `role="img"` carrying an
 * `aria-label`, so the composite of a shape and a word is announced as one unit
 * naming whose rating it is — "Dave: rating 1240" — rather than leaving a reader
 * to infer the subject from position. The settling sentence and the squad-scope
 * statement are deliberately **siblings** of that wrapper rather than inside it,
 * so they are still read as the prose they are.
 *
 * ### Shape, not colour (Requirement 16.6)
 *
 * The three presentations differ in shape as well as words: a filled disc for a
 * rating (settled or settling), a hollow square where nothing has been played,
 * and a dotted diamond where no rating was recorded.
 *
 * Every string comes from `lib/messages.ts` and every colour from a `--pm-*`
 * token, so this component holds no copy and `RatingPanel.css` holds no colour
 * value.
 *
 * Requirements: 7.2, 7.3, 7.4, 7.5, 7.9, 16.6
 */
import { type ReactElement } from 'react';

import { formatCount } from '../lib/numberFormat';
import {
  RATING_ABSENT,
  RATING_NEVER_PLAYED,
  RATING_SETTLING_NOTE,
  RATING_SQUAD_SCOPE_STATEMENT,
} from '../lib/messages';
import type { RatingCondition } from '../lib/ratingCondition';

import '../styles/playerStatsTokens.css';
import './RatingPanel.css';

/** The selector of the panel, so a test can assert over its whole subtree. */
export const RATING_PANEL_SELECTOR = '[data-player-stats-rating="true"]';

/**
 * The attribute naming which Rating_Condition the panel is rendering — one of
 * `established`, `settling`, `never-played`, `absent`. A test hook, never a
 * styling hook: a settling rating is styled exactly as an established one.
 */
export const RATING_PANEL_CONDITION_ATTRIBUTE = 'data-rating-condition';

/**
 * The selector of the named composite — the badge and the text announced as one
 * unit — so a test can read the accessible name without guessing at the tree.
 */
export const RATING_PANEL_PRESENTATION_SELECTOR =
  '[data-player-stats-rating-presentation="true"]';

/**
 * The selector of the badge shape, so a test can assert each presentation
 * carries a non-colour cue (Requirement 16.6).
 */
export const RATING_PANEL_BADGE_SELECTOR = '[data-player-stats-rating-badge]';

/** The selector of the visible words (or digits) of the presentation. */
export const RATING_PANEL_TEXT_SELECTOR = '[data-player-stats-rating-text="true"]';

/** The selector of the sentence shown only while the rating is settling. */
export const RATING_PANEL_SETTLING_SELECTOR =
  '[data-player-stats-rating-settling="true"]';

/** The selector of the squad-scope statement (Requirement 7.9). */
export const RATING_PANEL_SCOPE_SELECTOR = '[data-player-stats-rating-scope="true"]';

/**
 * The noun the accessible name puts before a Display_Rating, so the number is
 * announced as a rating rather than as a bare digit sequence.
 */
const RATING_VALUE_NOUN = 'rating';

/** The separator between the player's name and the statement about them. */
const NAME_SEPARATOR = ': ';

/** How a condition is drawn. A settling rating is drawn as a rating. */
type RatingLook = 'rating' | 'never-played' | 'absent';

/**
 * What one condition renders: the words a person sees, the statement a screen
 * reader hears after the player's name, and the look it is drawn in.
 */
interface RatingPresentation {
  /** The words or digits rendered on screen. */
  readonly visibleText: string;

  /** The claim the accessible name makes about the rating. */
  readonly statement: string;

  /** The badge shape and text style. */
  readonly look: RatingLook;
}

/** A number, presented the one way a rating number is ever presented. */
function numberPresentation(displayRating: number): RatingPresentation {
  // 7.2, 7.8: the integer exactly as parsed — `formatCount` is `String`, so
  // nothing is rounded, grouped, scaled, or localised.
  const visibleText = formatCount(displayRating);

  return {
    visibleText,
    statement: `${RATING_VALUE_NOUN} ${visibleText}`,
    look: 'rating',
  };
}

/**
 * The one mapping from the Rating_Condition union to words.
 *
 * Exhaustive over the union with no default arm, so a fifth condition is a
 * compile failure here rather than a silently unrendered rating. Pure, total,
 * and free of exceptions. The two numeric conditions share one presentation, so
 * a settling number cannot drift from a settled one.
 *
 * Requirements: 7.2, 7.3, 7.4, 7.5
 */
function ratingPresentationOf(condition: RatingCondition): RatingPresentation {
  switch (condition.kind) {
    case 'established':
    case 'settling':
      return numberPresentation(condition.displayRating);
    case 'never-played':
      return {
        visibleText: RATING_NEVER_PLAYED,
        statement: RATING_NEVER_PLAYED,
        look: 'never-played',
      };
    case 'absent':
      return { visibleText: RATING_ABSENT, statement: RATING_ABSENT, look: 'absent' };
  }
}

/**
 * The accessible name of the rating presentation: whose rating it is, then what
 * is being said about it. An empty or blank player name falls back to the
 * statement alone rather than announcing a dangling separator.
 *
 * Requirements: 7.2, 7.3, 7.4, 7.5, 16.6
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
   * The Player_Display_Name the rating belongs to, used only to build the
   * accessible name. Rendered as React text wherever it appears, never as
   * markup (Requirement 5.5).
   */
  readonly playerName: string;

  /** The resolved Rating_Condition (Requirement 7.1). */
  readonly condition: RatingCondition;
}

/**
 * The rating panel. Stateless and callback-free: it renders the condition it is
 * given and nothing else, so it issues no call and cannot navigate.
 *
 * Requirements: 7.2, 7.3, 7.4, 7.5, 7.9, 16.6
 */
export function RatingPanel({
  playerName,
  condition,
}: RatingPanelProps): ReactElement {
  const { visibleText, look } = ratingPresentationOf(condition);

  return (
    <div
      className="player-stats-rating"
      data-player-stats-rating="true"
      data-rating-condition={condition.kind}
    >
      {/* One accessible name for the shape and the words together, so the
          rating is announced once and in full. */}
      <span
        className="player-stats-rating__presentation"
        role="img"
        aria-label={ratingPanelAccessibleName(playerName, condition)}
        data-player-stats-rating-presentation="true"
      >
        {/* 16.6: the non-colour cue. Decorative to assistive technology,
            because the wrapper's name already states everything it signals. */}
        <span
          className={`player-stats-rating__badge player-stats-rating__badge--${look}`}
          data-player-stats-rating-badge={look}
          aria-hidden="true"
        />
        {/* 7.2, 7.3, 7.4, 7.5: the integer exactly as parsed, or the fixed
            label for the condition that holds. */}
        <span
          className={`player-stats-rating__text player-stats-rating__text--${look}`}
          data-player-stats-rating-text="true"
        >
          {visibleText}
        </span>
      </span>

      {/* 7.3: only while the rating settles, and as plain words under the
          figure — never a mark or a colour on the number itself. */}
      {condition.kind === 'settling' ? (
        <p
          className="player-stats-rating__settling"
          data-player-stats-rating-settling="true"
        >
          {RATING_SETTLING_NOTE}
        </p>
      ) : null}

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
