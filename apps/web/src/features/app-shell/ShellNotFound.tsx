/**
 * The `/app` not-found indication — what a requested path under `/app` shows
 * when it resolves to no registered Destination.
 *
 * Requirement 3.10 keeps the person inside the shell for this outcome: the frame
 * renders as usual, the region carries exactly one level-one heading and a control
 * to the Home_Destination, no Primary_Navigation control is marked as the current
 * page, and no Destination_Content is rendered.
 *
 * ### How "no control marked current" is achieved
 *
 * Not here. {@link resolveDestination} yields the not-found outcome for such a
 * path, and {@link PrimaryNavigation} attaches `aria-current` only to a control
 * whose identifier the resolver returned — so with no identifier returned, no
 * control carries it. This component renders nothing that touches the navigation,
 * which is exactly why the guarantee holds structurally rather than by this
 * component remembering to clear something.
 *
 * ### Not an error state
 *
 * A wrong address is not a fault to report. There is no `role="alert"`, no live
 * region, and no error wording: {@link ContentRegion} already announces the
 * heading on the content change (Requirement 13.12), which is the whole of the
 * announcement this state needs.
 *
 * This is distinct from the application-level not-found for a path outside `/app`
 * (Requirement 15.9), which lands in `src/app/AppNotFound.tsx` and offers the
 * marketing landing route instead.
 *
 * Requirements: 3.10, 13.2
 */
import { type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { HOME_ROUTE } from './lib/destinations';
import {
  HOME_CONTROL_LABEL,
  SHELL_NOT_FOUND_BODY,
  SHELL_NOT_FOUND_HEADING,
} from './lib/messages';

/**
 * Render the not-found indication for an unregistered path under `/app`: one
 * level-one heading, a neutral explanation, and a control to the
 * Home_Destination.
 *
 * Requirements: 3.10, 13.2
 */
export function ShellNotFound(): ReactElement {
  return (
    <div className="shell-boundary">
      {/* 3.10, 13.2: the route's single level-one heading. */}
      <h1>{SHELL_NOT_FOUND_HEADING}</h1>
      <p className="shell-boundary__body">{SHELL_NOT_FOUND_BODY}</p>
      {/* 3.10, 3.4: a way onward, client-side. */}
      <Link className="shell-boundary__home" to={HOME_ROUTE}>
        {HOME_CONTROL_LABEL}
      </Link>
    </div>
  );
}

export default ShellNotFound;
