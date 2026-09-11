/**
 * The Unavailable_State — what a registered Destination shows while no
 * Destination_Content has been supplied for it.
 *
 * Requirement 3.7 makes the Home, Settings, and Profile bodies injected, so the
 * MVP ships with Home and Profile empty. Requirement 3.8 is explicit that this
 * absence is **not an error**: the frame stays exactly as it is, the
 * destination's Primary_Navigation control stays marked as the current page
 * (which it does by itself — the route still resolves to this Destination, so
 * {@link PrimaryNavigation} marks it), and the region carries an explanation plus
 * a way onward. Nothing here is a failure state, so nothing here is announced as
 * one: no `role="alert"`, no live region, no error wording.
 *
 * ### The heading is read, not written
 *
 * Requirement 3.8 asks for exactly one level-one heading "carrying that
 * Destination's visible label", so the text comes from
 * {@link destinationLabel} rather than from a string typed here. A person who
 * activates the Profile control and lands on this state sees the same word on the
 * control and on the heading, and {@link ContentRegion} announces that word on
 * the content change (Requirement 13.12). A restated literal could drift from the
 * registry; a read cannot.
 *
 * The frame renders no level-one heading (Requirements 1.9, 13.2), so this one is
 * the route's only one.
 *
 * ### The control to Home
 *
 * A router `Link`, so activating it swaps the Content_Region's children while the
 * Shell_Header keeps its DOM node and its poll loop — no full-document reload
 * (Requirements 1.3, 3.4). The target is {@link HOME_ROUTE} from the registry, so
 * the control cannot point at a path the shell does not register.
 *
 * Requirements: 3.7, 3.8, 13.2
 */
import { type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { HOME_ROUTE, destinationLabel, type DestinationId } from './lib/destinations';
import { HOME_CONTROL_LABEL, UNAVAILABLE_BODY } from './lib/messages';

export interface DestinationUnavailableProps {
  /**
   * The registered Destination whose content is absent. Its registered label
   * becomes the level-one heading (Requirement 3.8).
   */
  readonly destinationId: DestinationId;
}

/**
 * Render the Unavailable_State for a registered Destination with no content
 * supplied: its label as the one level-one heading, a neutral explanation, and a
 * control to the Home_Destination.
 *
 * Requirements: 3.8, 13.2
 */
export function DestinationUnavailable({
  destinationId,
}: DestinationUnavailableProps): ReactElement {
  return (
    <div className="shell-boundary" data-destination={destinationId}>
      {/* 3.8, 13.2: the route's single level-one heading, carrying the
          Destination's registered visible label. */}
      <h1>{destinationLabel(destinationId)}</h1>
      {/* 3.8: an explanation, not an error indication. */}
      <p className="shell-boundary__body">{UNAVAILABLE_BODY}</p>
      {/* 3.8, 3.4: a way onward, client-side. */}
      <Link className="shell-boundary__home" to={HOME_ROUTE}>
        {HOME_CONTROL_LABEL}
      </Link>
    </div>
  );
}

export default DestinationUnavailable;
