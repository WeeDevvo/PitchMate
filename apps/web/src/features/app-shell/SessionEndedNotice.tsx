/**
 * The session-ended notice — what the Content_Region carries while a session
 * expiry handover is in progress.
 *
 * When a notification call returns an unauthenticated result, the shell cancels
 * its poll loop, discards the displayed list and count, and hands over to the
 * Auth_Feature's sign-out navigation (Requirements 9.3, 9.4). Requirement 9.7
 * governs what is on screen for the moment in between: neither the active
 * Destination_Content nor any value it or the Notification_List displayed, and in
 * its place a neutral indication that the session has ended and that sign-in is
 * being reached, carrying exactly one level-one heading and no error indication.
 *
 * ### It renders fixed text and nothing else
 *
 * The component takes no props on purpose. With no input there is nothing for it
 * to display that came from the discarded state, so "no stale content remains
 * visible" is a property of the component's shape rather than of a caller
 * remembering to pass nothing through. The frame around it is still rendered, with
 * the Notification_Panel and Account_Menu closed and the Unread_Badge absent —
 * that part of Requirement 9.7 belongs to the notification state machine and the
 * frame, not here.
 *
 * ### Not an error
 *
 * An ended session is a handover, not a failure (design → "Session expiry"). So
 * there is no `role="alert"`, no live region, no `GENERIC_NOTIFICATION_FAILURE`,
 * and no error wording — presenting one would frame the person's own expired
 * session as something having gone wrong. {@link ContentRegion} announces the
 * heading through its own live region when the content changes, which is the
 * whole of the announcement this state needs (Requirement 13.12).
 *
 * There is deliberately **no control to sign-in** either: Requirement 9.4 has the
 * Auth_Feature perform that navigation, and the shell performs none of its own.
 *
 * Requirements: 9.7, 13.2
 */
import { type ReactElement } from 'react';
import { SESSION_ENDED_BODY, SESSION_ENDED_HEADING } from './lib/messages';

/**
 * Render the neutral session-ended indication: one level-one heading and a
 * statement that sign-in is being reached.
 *
 * Requirements: 9.7, 13.2
 */
export function SessionEndedNotice(): ReactElement {
  return (
    <div className="shell-boundary">
      {/* 9.7, 13.2: the route's single level-one heading during the handover. */}
      <h1>{SESSION_ENDED_HEADING}</h1>
      {/* 9.7: what is happening next, stated neutrally. */}
      <p className="shell-boundary__body">{SESSION_ENDED_BODY}</p>
    </div>
  );
}

export default SessionEndedNotice;
