/**
 * The `/app` not-found indication — what a requested path under `/app` shows
 * when it resolves to no registered Destination.
 *
 * Requirement 3.10 keeps the person inside the shell for this outcome: the frame
 * renders as usual, the region carries exactly one level-one heading and a control
 * to the Home_Destination, and no Destination_Content is rendered.
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
import { EmptyState } from '../../ui';
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
    // The design system's not-found state, the same page every screen shows.
    <EmptyState
      className="shell-boundary"
      icon="search"
      // 3.10, 13.2: the route's single level-one heading.
      headingLevel={1}
      title={SHELL_NOT_FOUND_HEADING}
      bodyProps={{ className: 'shell-boundary__body' }}
      action={
        // 3.10, 3.4: a way onward, client-side.
        <Link className="shell-boundary__home" to={HOME_ROUTE}>
          {HOME_CONTROL_LABEL}
        </Link>
      }
    >
      {SHELL_NOT_FOUND_BODY}
    </EmptyState>
  );
}

export default ShellNotFound;
