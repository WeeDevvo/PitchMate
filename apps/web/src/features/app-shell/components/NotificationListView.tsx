/**
 * The Notifications_Destination's content — the whole ordered Notification_List.
 *
 * This is the second Destination_Content the App_Shell supplies itself (the other
 * being the Settings_Destination), so `/app/notifications` is reachable without a
 * later feature injecting anything (Requirement 3.9). Where the
 * Notification_Panel previews the leading 10 records beside a control that leads
 * here, this surface shows **every** record of the ordered Notification_List up to
 * the Notification_List_Cap of 200 (Requirements 5.4, 5.12).
 *
 * ### The list it displays is the machine's, already ordered and already capped
 *
 * `state/useNotificationCentre.ts` applies `orderNotifications` on the way in, so
 * `records` is the ordered Notification_List — creation instant descending, ties
 * broken by identity descending, truncated to 200 — and this component renders it
 * whole rather than re-deriving either the order or the cap. That is the same
 * division the panel follows with `panelRecords`: one place decides what the list
 * *is*, and each surface decides how much of it to show. Rendering `records` in
 * full is therefore exactly "every record up to the cap", and the two surfaces
 * cannot disagree about which notification is newest.
 *
 * ### The heading
 *
 * The frame renders no level-one heading (Requirements 1.9, 13.2), so this content
 * contributes the single `h1` of the `/app/notifications` route — which is the
 * element {@link ContentRegion} finds and announces when the Content_Region
 * changes (Requirement 13.12). Its text is the label registered for the
 * Notifications_Destination rather than a literal, so the heading and that
 * Destination's Primary_Navigation control cannot drift apart.
 *
 * ### One list call on arriving, and never a second
 *
 * The state machine issues a list call when the Notification_Panel opens
 * (Requirement 4.7) and when the Squad_Scope changes; mounting the frame issues
 * only an unread-count call (Requirement 4.1). A person who reaches this
 * Destination directly — by entering the web address, or by a Primary_Navigation
 * control without ever opening the panel — would therefore have no list to
 * display, so this surface asks for one **once per mount, and only while nothing
 * has been loaded for the active Squad_Scope** (`listPhase === 'idle'`).
 *
 * It asks through the machine's own single-list-call action, so the guarantees
 * around it are unchanged: exactly one call per request, none while a call awaits
 * a response, and — because the request is latched in a ref — nothing reissued by
 * a re-render, by records arriving, or by a call failing. Nothing here retries
 * itself (Requirement 11.11); a failed load leaves the fixed message displayed and
 * the panel's retry control is what issues a further call.
 *
 * ### What it says when there is nothing to show
 *
 * A list call that *returned* zero records is reported as a plain statement with
 * no error indication (Requirement 5.7). A *failed* call is not: the phase never
 * reaches `loaded`, so the empty statement stays absent and the
 * Generic_Notification_Failure message is displayed instead, which keeps "your
 * list is empty" from being said about a call that never answered. The message is
 * the one fixed string for every failing notification call, carrying nothing about
 * the response (Requirements 7.7, 11.10).
 *
 * Requirements: 3.9, 5.4, 5.7, 5.12, 6.11, 13.2
 */
import { useEffect, useRef, type ReactElement } from 'react';

import { destinationLabel } from '../lib/destinations';
import { NO_NOTIFICATIONS } from '../lib/messages';
import { useNotificationCentreContext } from '../state/NotificationCentreContext';
import { NotificationRow } from './NotificationRow';

/**
 * Render the Notifications_Destination: one level-one heading, then the ordered
 * Notification_List in full.
 *
 * Requirements: 3.9, 5.4, 5.7, 5.12, 6.11, 13.2
 */
export function NotificationListView(): ReactElement {
  const { records, listPhase, failureMessage, retryList, markRead, now } =
    useNotificationCentreContext();

  // One list call per mount, and only where nothing has been loaded yet. The
  // latch is set on the first run whatever the phase, so a list that arrived
  // through the panel or a Squad_Scope change is displayed rather than refetched,
  // and a failed call is not reissued while this surface stays mounted.
  const requestedRef = useRef(false);
  useEffect(() => {
    if (requestedRef.current) {
      return;
    }
    requestedRef.current = true;
    if (listPhase === 'idle') {
      retryList();
    }
  }, [listPhase, retryList]);

  // 5.5, 5.11: one reading of the injected clock for every row, so each row's
  // relative time label is derived from the same instant.
  const nowMs = now();

  // 5.7: said only for a call that *returned* zero records — a failed call leaves
  // the phase short of `loaded`, so a failure is never reported as an empty list.
  const empty = listPhase === 'loaded' && records.length === 0;

  return (
    <div className="shell-notification-list">
      {/* 13.2: the route's single level-one heading, contributed by the content. */}
      <h1>{destinationLabel('notifications')}</h1>

      {/* 7.7, 11.10: the one fixed message, carrying nothing about the response. */}
      {failureMessage === null ? null : (
        <p
          className="shell-notification-list__failure-message"
          // Announced without moving focus, and marked with its own attribute so
          // it is never confused with the panel's message in a full-frame test.
          role="status"
          data-shell-notification-list-failure="true"
        >
          {failureMessage}
        </p>
      )}

      {/* 5.7: a plain statement, with no error indication of any kind. */}
      {empty ? (
        <p className="shell-notification-list__empty">{NO_NOTIFICATIONS}</p>
      ) : null}

      {/*
       * 5.4, 5.12: every record of the ordered Notification_List, up to the
       * Notification_List_Cap of 200. Both the ordering and the cap were applied
       * by the state machine before this surface saw them.
       */}
      {records.length === 0 ? null : (
        <ul className="shell-notification-list__list">
          {records.map((record) => (
            <li key={record.notificationId} className="shell-notification-list__item">
              {/* 6.11, 6.12: one keyboard-operable control per record, and the
                  only thing that marks it read is a person activating it. */}
              <NotificationRow record={record} nowMs={nowMs} onActivate={markRead} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default NotificationListView;
