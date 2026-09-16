/**
 * The Squads_Feature's one loading indication.
 *
 * Four requirements ask for the same thing in four places — the Squads_Home
 * while `ListMySquads` is awaiting a response with nothing held (1.10), the
 * Squads_Home while it is refreshing an accepted collection (1.15), the
 * Squad_Screen while `GetSquad` is awaiting a response (6.9), and the
 * Invite_Landing_Route while `RedeemInvite` is awaiting a response (5.12): a
 * loading indication *with a programmatically determinable busy state*. Every
 * one of those surfaces renders this component, so the busy state is declared
 * once rather than reinvented per screen.
 *
 * ### Why the busy state is on the region and not on a spinner
 *
 * The indication is a text statement carrying `aria-busy="true"`, in a
 * `role="status"` region. `aria-busy` is what makes the wait *determinable* by a
 * program — a test, or assistive technology — rather than merely visible, and
 * `role="status"` announces the statement when it appears without moving
 * keyboard focus, which is the same discipline Requirement 17.3 applies to
 * outcome messages. There is no spinner element and no animation: a decorative
 * node would add nothing a program can read, and an animation would need a
 * reduced-motion escape hatch to say what the sentence already says.
 *
 * ### The label is the caller's, not this component's
 *
 * `lib/messages.ts` declares no loading copy, because what is being awaited
 * differs per surface ("your squads" is not "this squad"). The label is
 * therefore a required prop: the screen states what it is waiting for, and this
 * component owns only the region, the role, and the busy state. Nothing here is
 * derived from a response, so no backend content can reach it (Requirement
 * 17.2).
 *
 * Requirements: 1.10, 1.15, 5.12, 6.9, 17.3
 */
import { type ReactElement } from 'react';

import './LoadingIndication.css';

/**
 * The selector of the loading region, so a screen test finds the indication
 * without confusing it with the failure notice's own `role="status"` region.
 */
export const LOADING_INDICATION_SELECTOR = '[data-squads-loading="true"]';

export interface LoadingIndicationProps {
  /**
   * The visible statement of what is being awaited, supplied by the surface
   * that is waiting — for example "Loading your squads".
   *
   * Required rather than defaulted: a shared default would be a fifth piece of
   * user-facing copy living outside `lib/messages.ts`, and it would say less
   * than the surface can.
   */
  readonly label: string;
  /**
   * Optional id, so a control or region can reference this indication (for
   * example through `aria-describedby`) without focus ever moving to it.
   */
  readonly id?: string;
}

/**
 * Render the loading indication: one statement, announced politely, marked busy.
 *
 * Requirements: 1.10, 1.15, 5.12, 6.9, 17.3
 */
export function LoadingIndication({
  label,
  id,
}: LoadingIndicationProps): ReactElement {
  return (
    <p
      id={id}
      className="squads-loading"
      // 1.10, 1.15, 5.12, 6.9: the busy state, programmatically determinable.
      aria-busy="true"
      // 17.3: announced where it appears, with keyboard focus left alone.
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-squads-loading="true"
    >
      {label}
    </p>
  );
}

export default LoadingIndication;
