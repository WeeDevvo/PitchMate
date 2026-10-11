/**
 * The Not_Found_Treatment — the feature's one non-disclosing presentation.
 *
 * `GetPlayerProfile` answers a byte-for-byte identical, code-free `404` for five
 * quite different situations: a squad that does not exist, a membership that does
 * not exist, a membership belonging to another squad, a caller who is not an
 * active member of the squad, and a missing, malformed, or expired access token.
 * It declares **no `401`**, deliberately, so that declaring one would not hand a
 * caller a tell. A route whose identities are not well-formed identifiers is a
 * sixth situation, for which no call is issued at all. All six render this, and
 * Requirements 3.1, 3.2, and 3.3 ask that no rendered difference distinguish any
 * of them.
 *
 * ### The only input is the route's own squad identity
 *
 * The component takes a `squadId` and nothing else — no cause, no reason code, no
 * membership identity, no display name, no part of a rejected response. So
 * "the content does not vary with cause" is a property of the component's shape
 * rather than of every call site remembering to pass the same thing
 * (Requirements 3.1, 3.2, 3.7).
 *
 * The one input is not a cause and cannot become one: it is the squad segment of
 * the path the person is already standing on, used solely to build the way back
 * out, and it reaches no visible text and no accessible name. Requirement 3.5
 * asks for a control navigating to the Squad_Path of *the route's* squad
 * identity, which is why the identity has to arrive at all.
 *
 * ### It carries the route's level-one heading
 *
 * On a successful load the screen's `h1` is the parsed Player_Display_Name
 * (Requirement 5.1). There is no name here, so this surface contributes the
 * single `h1` instead — {@link NOT_FOUND_TREATMENT_HEADING}, a fixed phrase
 * naming neither the squad identity nor the membership identity nor any display
 * name (Requirement 3.6). That keeps the heading outline well-formed in this
 * condition (Requirement 16.1) without an identity reaching the screen.
 *
 * ### Announced, but not as an error
 *
 * A player who cannot be reached is an outcome, not a fault. The statement sits
 * in a `role="status"` live region, so its appearance is announced without focus
 * moving (Requirement 4.6), and not in a `role="alert"`, which would interrupt.
 * There is no {@link GENERIC_PROFILE_FAILURE} here either: a failed call renders
 * the `FailureNotice` and this treatment stays absent, and a not-found renders
 * this treatment and the notice stays absent (Requirement 4.3). There is also no
 * retry control, because there is nothing transient to re-attempt.
 *
 * ### The path is built, never written
 *
 * The control's target comes from the Squads_Feature barrel's `squadPath`
 * builder, which is the same function the player list's rows and the route
 * registration are built from, so this control cannot drift from where the
 * Squad_Screen is registered. No path literal appears in this feature
 * (Requirement 1.7).
 *
 * Requirements: 1.6, 3.1, 3.2, 3.5, 3.6, 3.7, 4.6, 16.1
 */
import { type ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { squadPath } from '../../squads';
import {
  BACK_TO_SQUAD_LABEL,
  NOT_FOUND_TREATMENT_HEADING,
  NOT_FOUND_TREATMENT_STATEMENT,
} from '../lib/messages';
import '../styles/playerStatsTokens.css';
import './surfaces.css';

/** The selector of the treatment, so a test can assert its whole subtree. */
export const NOT_FOUND_TREATMENT_SELECTOR = '[data-player-stats-not-found="true"]';

export interface NotFoundTreatmentProps {
  /**
   * The squad identity the route carries, used solely to build the control back
   * to the squad (Requirements 1.6, 3.5).
   *
   * Taken from the route's own `squadId` parameter and from nothing else, so it
   * is a fact about where the person is rather than about what the backend said.
   * It is **not** validated here: this treatment is rendered for a malformed
   * route as well as for a concealed absence, and `squadPath` is a constructor
   * rather than a validator. A missing segment should arrive as the empty
   * string, which builds a path with an empty segment that no dynamic-segment
   * pattern matches — a control that resolves nowhere rather than one that
   * resolves to the wrong squad.
   */
  readonly squadId: string;
}

/**
 * Render the Not_Found_Treatment: one level-one heading, the fixed statement in a
 * live region, and the control back to the squad.
 *
 * Requirements: 3.1, 3.5, 3.6, 4.6
 */
export function NotFoundTreatment({ squadId }: NotFoundTreatmentProps): ReactElement {
  return (
    <div className="player-stats-not-found" data-player-stats-not-found="true">
      {/* 3.6, 16.1: the route's single level-one heading, naming no squad, no
          player, and no identity. */}
      <h1 className="player-stats-not-found__heading">
        {NOT_FOUND_TREATMENT_HEADING}
      </h1>

      {/* 3.1, 3.2, 3.5: both possibilities in one fixed sentence, so none of the
          concealed causes is disclosed. */}
      {/* 4.6: announced where it appears, with keyboard focus left alone. */}
      <p
        className="player-stats-not-found__statement"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {NOT_FOUND_TREATMENT_STATEMENT}
      </p>

      {/* 1.6, 3.5: the way back, client-side, to the squad the route names —
          built by the squads barrel's own path builder. */}
      <Link className="player-stats-squad-link" to={squadPath(squadId)}>
        {BACK_TO_SQUAD_LABEL}
      </Link>
    </div>
  );
}

export default NotFoundTreatment;
