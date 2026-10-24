/**
 * The Player_Stats_Screen's one loading indication.
 *
 * Requirement 2.2 asks for a loading indication *with a programmatically
 * determinable busy state* while a `GetPlayerProfile` call awaits a response and
 * no Player_Profile is held, and Requirement 2.3 asks for a busy state beside a
 * held profile while it is being re-read. Both render this, so the busy state is
 * declared once rather than twice with a chance of disagreeing.
 *
 * ### Why the busy state is on the statement and not on a spinner
 *
 * The indication is a text statement carrying `aria-busy="true"` inside a
 * `role="status"` region. `aria-busy` is what makes the wait *determinable by a
 * program* — a test, or assistive technology — rather than merely visible, and
 * `role="status"` announces the statement when it appears without moving
 * keyboard focus, which is the same discipline Requirement 4.6 applies to the
 * two outcome presentations. There is no spinner element and no animation: a
 * decorative node adds nothing a program can read, and an animation would need a
 * reduced-motion escape hatch to say what the sentence already says.
 *
 * ### It takes no copy, and that is deliberate
 *
 * The label is {@link PROFILE_LOADING_LABEL} from `lib/messages.ts` rather than a
 * prop. The Squads_Feature's equivalent takes one because four of its surfaces
 * wait for four different things; this feature has one subject and one call, so a
 * prop would only be a seam through which a caller could put a squad name, a
 * membership identity, or a status code into the one place on the screen that is
 * guaranteed to be announced. With no prop there is nothing to pass
 * (Requirements 3.7, 4.2).
 *
 * Requirements: 2.2, 2.3
 */
import { type ReactElement } from 'react';

import { PROFILE_LOADING_LABEL } from '../lib/messages';
import '../styles/playerStatsTokens.css';
import './surfaces.css';

/**
 * The selector of the loading region, so a test finds the indication without
 * confusing it with the failure notice's or the not-found treatment's own
 * `role="status"` region.
 */
export const LOADING_INDICATION_SELECTOR = '[data-player-stats-loading="true"]';

export interface LoadingIndicationProps {
  /**
   * Optional id, so a region or a control can reference this indication — for
   * instance through `aria-describedby` — without focus ever moving to it.
   */
  readonly id?: string;
  /**
   * The busy statement, when the surface loading is not the player profile —
   * the squad leaderboard passes its own. Defaults to the profile's.
   */
  readonly label?: string;
}

/**
 * Render the loading indication: one fixed statement, announced politely, marked
 * busy.
 *
 * Requirements: 2.2, 2.3
 */
export function LoadingIndication({
  id,
  label = PROFILE_LOADING_LABEL,
}: LoadingIndicationProps = {}): ReactElement {
  return (
    <p
      id={id}
      className="player-stats-loading"
      // 2.2, 2.3: the busy state, programmatically determinable.
      aria-busy="true"
      // Announced where it appears, with keyboard focus left alone.
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-player-stats-loading="true"
    >
      {label}
    </p>
  );
}

export default LoadingIndication;
