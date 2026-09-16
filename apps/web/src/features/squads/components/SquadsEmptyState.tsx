/**
 * The Squads_Empty_State — what the Squads_Home renders in place of Squad_Cards
 * when the parsed Squad_Summary collection is empty.
 *
 * ### An absence, not a failure
 *
 * An accepted empty collection is a normal answer: the person belongs to no
 * squad yet. So nothing here is announced as a fault — no `role="alert"`, no
 * live region, no `aria-invalid`, no retry control, and no
 * {@link GENERIC_SQUADS_FAILURE} (Requirement 2.1). That distinction is what
 * `useSquadsHome` keeps in its state by holding an accepted empty collection
 * apart from no collection at all; this component is the rendering of the former.
 *
 * ### It takes no props
 *
 * Both statements are fixed copy from `lib/messages.ts` — that the signed-in
 * person belongs to no squad yet, and that a squad can be created or joined with
 * an invite (Requirement 2.4). With no input there is nothing a caller could
 * vary, so the wording cannot drift between call sites, and no squad name, count,
 * or backend text can reach it (Requirement 17.2).
 *
 * ### The two controls are not here
 *
 * The Create_Squad and Join_Squad entry points stay rendered by the Squads_Home
 * in *every* load state, not only this one (Requirement 2.2), so they are the
 * screen's to place. Repeating them inside this component would put two controls
 * on the page for one action and break the "exactly one control per entry point"
 * rule of Requirement 2.3. The second statement therefore explains both routes
 * forward while the screen's own controls perform them.
 *
 * Requirements: 2.1, 2.4
 */
import { type ReactElement } from 'react';

import {
  SQUADS_EMPTY_STATE_NEXT_STEP,
  SQUADS_EMPTY_STATE_NO_SQUADS,
} from '../lib/messages';

// The feature token table, so the statements resolve their type and colour
// custom properties wherever the empty state is rendered. No colour value is
// written in either file (Requirement 18.9).
import '../styles/squadsTokens.css';
import './SquadsEmptyState.css';

/**
 * The selector of the empty state, so a Squads_Home test can assert it is absent
 * while cards, the loading indication, or the failure notice are rendered.
 */
export const SQUADS_EMPTY_STATE_SELECTOR = '[data-squads-empty="true"]';

/**
 * Render the Squads_Empty_State: the two fixed statements, and no error
 * indication of any kind.
 *
 * Requirements: 2.1, 2.4
 */
export function SquadsEmptyState(): ReactElement {
  return (
    <div className="squads-empty" data-squads-empty="true">
      {/* 2.4: where the person stands. */}
      <p className="squads-empty__statement">{SQUADS_EMPTY_STATE_NO_SQUADS}</p>
      {/* 2.4: both routes forward, named in text beside the screen's controls. */}
      <p className="squads-empty__statement">{SQUADS_EMPTY_STATE_NEXT_STEP}</p>
    </div>
  );
}

export default SquadsEmptyState;
