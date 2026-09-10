/**
 * The Notification_Panel — the surface the Notification_Indicator discloses.
 *
 * It is the *contents* of a disclosure, not a disclosure of its own.
 * {@link Disclosure} owns opening and closing, Escape with focus returned to the
 * indicator, and the outside-pointer close that leaves focus where the pointer
 * put it (Requirements 5.2, 5.3, 5.14), and it unmounts the surface while closed.
 * Two consequences shape this component:
 *
 *  - **Mounting is opening.** The panel exists only while open, so the one thing
 *    that must happen on opening — exactly one unread-count call and exactly one
 *    list call (Requirement 4.7) — is a mount effect here, latched so it happens
 *    once per opening however many times React runs the effect.
 *  - **Focusing inward is this component's job.** `Disclosure` deliberately moves
 *    no focus into a surface, because only this one requires it. The panel
 *    therefore focuses its own first focusable control on opening, or itself when
 *    it has none (Requirement 5.1).
 *
 * ### It reads the state machine and issues nothing
 *
 * Every displayed value and every action comes from the one notification centre
 * through {@link useNotificationCentreContext}. The panel holds no notification
 * state of its own and touches no transport: ordering and the caps
 * (Requirements 5.4, 5.12), failure retention with the fixed message
 * (Requirements 5.9, 11.10), the optimistic mark-read, the pessimistic
 * mark-all-read, and the single-call retry all live in
 * `state/useNotificationCentre.ts`. What is decided *here* is presentation:
 *
 * | Behaviour | Decided by |
 * | --- | --- |
 * | Which records to show | `centre.panelRecords` — the leading 10 (Req 5.12) |
 * | Whether to say "no notifications" | `listPhase === 'loaded'` with none (Req 5.7) |
 * | When the loading indication appears | this component's 300 ms timer (Req 5.8) |
 * | Whether the failure message shows | `centre.failureMessage` (Req 5.9) |
 * | Whether Mark_All_Read is disabled | `centre.markAllReadDisabled` (Req 6.9) |
 *
 * ### The 300 ms loading indication (Requirement 5.8)
 *
 * A list call that answers quickly should not flash a spinner, so the indication
 * appears no later than 300 milliseconds after the call is issued rather than
 * immediately. The timer starts when the list phase becomes `loading` and is
 * cleared when it leaves it, so the indication stops when the call resolves —
 * and when the Notification_Call_Timeout lapses, because the Notifications_Api
 * settles that as a failure and the phase leaves `loading` with it.
 *
 * A retained failure message from an earlier call is rendered *alongside* the
 * indication rather than replaced by it, which is exactly what Requirement 5.8
 * asks for: the reducer keeps `failureMessage` through a `list-requested`, so the
 * panel simply renders both regions independently.
 *
 * ### The retry control (Requirement 5.9)
 *
 * `centre.retryList()` issues exactly one list call per activation and ignores an
 * activation while a call awaits a response, so the control is marked
 * `aria-disabled` during that wait rather than `disabled`: a genuinely disabled
 * control would drop the keyboard focus of the person who just activated it, and
 * the prevention Requirement 5.9 asks for is already absolute in the state
 * machine. Nothing here retries automatically — there is no effect that calls
 * `retryList`.
 *
 * ### Marking read
 *
 * Each row's activation handler is `centre.markRead`, passed straight through: a
 * row that is already read, or one whose call is in flight, is the machine's
 * business (Requirements 6.3, 6.7). The Mark_All_Read_Control is `disabled`
 * exactly when the displayed count is 0 and every displayed record is read
 * (Requirement 6.9), and while its call awaits a response it swaps its label for
 * the progress text and reports `aria-busy` (Requirement 6.8) — progress as
 * words, so it is never carried by colour or motion alone.
 *
 * No effect, no handler, and no attribute here marks anything read in consequence
 * of a record being rendered, hovered, scrolled into view, or focused
 * (Requirement 6.12).
 *
 * Requirements: 4.7, 5.1, 5.7, 5.8, 5.9, 5.12, 6.4, 6.8, 6.9, 6.11, 6.12
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { Link } from 'react-router-dom';

import { NOTIFICATIONS_ROUTE, destinationLabel } from '../lib/destinations';
import {
  MARK_ALL_READ_IN_PROGRESS,
  MARK_ALL_READ_LABEL,
  NOTIFICATIONS_LOADING,
  NOTIFICATION_PANEL_SEE_ALL,
  NOTIFICATION_RETRY_LABEL,
  NO_NOTIFICATIONS,
} from '../lib/messages';
import { useNotificationCentreContext } from '../state/NotificationCentreContext';
import { NotificationRow } from './NotificationRow';

/**
 * How long after a list call is issued the loading indication appears
 * (Requirement 5.8: "no later than 300 milliseconds").
 *
 * Exported so a test drives the boundary with `vi.useFakeTimers()` rather than
 * restating the number.
 */
export const LOADING_INDICATION_DELAY_MS = 300;

/**
 * The controls that can take keyboard focus, in document order, for the
 * focus-inward step of Requirement 5.1.
 *
 * `[tabindex="-1"]` is excluded, which also excludes the panel root itself — it
 * carries `tabIndex={-1}` solely so it can be the fallback focus target when the
 * panel holds no focusable control. A `disabled` control is excluded because it
 * cannot hold focus; an `aria-disabled` one is not, because it can.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export interface NotificationPanelProps {
  /**
   * Called when the control that navigates to the Notifications_Destination is
   * activated, so the caller can collapse the surface it sits in.
   *
   * Optional, because closing is the caller's concern: the panel does not own its
   * own open state (see {@link Disclosure}). The navigation happens either way —
   * the `Link` is not conditional on this handler.
   */
  readonly onNavigate?: () => void;
}

/**
 * Render the Notification_Panel.
 *
 * Requirements: 4.7, 5.1, 5.7, 5.8, 5.9, 5.12, 6.4, 6.8, 6.9, 6.11, 6.12
 */
export function NotificationPanel({
  onNavigate,
}: NotificationPanelProps = {}): ReactElement {
  const {
    panelRecords,
    listPhase,
    failureMessage,
    markAllPending,
    markAllReadDisabled,
    notifyPanelOpened,
    retryList,
    markRead,
    markAllRead,
    now,
  } = useNotificationCentreContext();

  const panelRef = useRef<HTMLDivElement | null>(null);
  const headingId = useId();

  // 4.7: exactly one unread-count call and one list call per opening. The latch
  // holds because the surface is unmounted while closed, so a fresh opening is a
  // fresh component instance with a fresh latch — while a re-render, and React's
  // development-mode double effect, issue nothing further.
  const openedRef = useRef(false);
  useEffect(() => {
    if (openedRef.current) {
      return;
    }
    openedRef.current = true;
    notifyPanelOpened();
  }, [notifyPanelOpened]);

  // 5.1: move focus to the first focusable control inside the panel, or to the
  // panel itself when it holds none. Mount-only on purpose: refocusing when the
  // records arrive would pull focus out from under whoever moved it in between.
  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) {
      return;
    }
    const first = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (first ?? panel).focus();
  }, []);

  // 5.8: the indication appears 300 ms into the wait, not at the start of it, and
  // stops the moment the phase leaves `loading` — whether the call returned,
  // failed, or reached the Notification_Call_Timeout.
  const loading = listPhase === 'loading';
  const [loadingVisible, setLoadingVisible] = useState(false);
  useEffect(() => {
    if (!loading) {
      return;
    }
    const timer = setTimeout(() => {
      setLoadingVisible(true);
    }, LOADING_INDICATION_DELAY_MS);

    // The wait is over: either the call settled and the phase left `loading`, or
    // the panel closed. Withdrawing the indication here rather than in the effect
    // body keeps every state update in this component asynchronous with respect to
    // rendering — a synchronous one would re-render the panel a second time on
    // every commit that is not a wait.
    return () => {
      clearTimeout(timer);
      setLoadingVisible(false);
    };
  }, [loading]);

  const handleMarkAllRead = useCallback((): void => {
    // 6.8: the machine ignores a second concurrent activation; stating it here as
    // well keeps the `aria-disabled` the control reports truthful.
    if (markAllPending) {
      return;
    }
    markAllRead();
  }, [markAllPending, markAllRead]);

  const handleRetry = useCallback((): void => {
    // 5.9: one call per activation, and none while a call awaits a response.
    if (loading) {
      return;
    }
    retryList();
  }, [loading, retryList]);

  // 5.7: said only for a list call that *returned* zero records. A failed call
  // leaves the phase short of `loaded`, so a failure is never reported as "you
  // have no notifications".
  const empty = listPhase === 'loaded' && panelRecords.length === 0;

  // 5.5, 5.11: one reading of the injected clock for every row, so each row's
  // relative time label is derived from the same instant.
  const nowMs = now();

  return (
    <div
      ref={panelRef}
      className="shell-notification-panel"
      // A named group rather than a landmark: the frame's landmark set is the
      // banner, the navigation, and the main region, and this surface is inside
      // the banner (Requirement 1.5). `tabIndex` makes it the fallback focus
      // target of Requirement 5.1.
      role="group"
      aria-labelledby={headingId}
      tabIndex={-1}
      data-list-phase={listPhase}
    >
      <div className="shell-notification-panel__header">
        {/*
         * Level two, not one: the single `h1` of a shell route belongs to the
         * active Destination_Content (Requirements 1.9, 13.2).
         */}
        <h2 id={headingId} className="shell-notification-panel__heading">
          {destinationLabel('notifications')}
        </h2>

        <button
          type="button"
          className="shell-notification-panel__mark-all"
          // 6.9: disabled exactly while the count is 0 and every displayed record
          // is read, so unread records outside the displayed list stay markable.
          disabled={markAllReadDisabled}
          // 6.8: progress reported programmatically, and a second activation
          // prevented without taking focus off the control mid-operation.
          aria-disabled={markAllPending ? true : undefined}
          aria-busy={markAllPending ? true : undefined}
          data-pending={markAllPending ? 'true' : 'false'}
          onClick={handleMarkAllRead}
        >
          {/* 6.8: the progress indication is the label, so it is heard as well as
              seen and never carried by colour or motion alone. */}
          {markAllPending ? MARK_ALL_READ_IN_PROGRESS : MARK_ALL_READ_LABEL}
        </button>
      </div>

      {/*
       * 5.8, 5.9: the retained failure message and the loading indication are
       * independent regions, so a message from an earlier call stays visible
       * alongside the indication until the awaited call resolves.
       */}
      {failureMessage === null ? null : (
        <div className="shell-notification-panel__failure">
          <p
            className="shell-notification-panel__failure-message"
            // Announced without moving focus. The retry control sits outside the
            // live region, so its label is not read out as part of the message.
            role="status"
            data-shell-notification-failure="true"
          >
            {failureMessage}
          </p>
          <button
            type="button"
            className="shell-notification-panel__retry"
            aria-disabled={loading ? true : undefined}
            onClick={handleRetry}
          >
            {NOTIFICATION_RETRY_LABEL}
          </button>
        </div>
      )}

      {loadingVisible ? (
        <p
          className="shell-notification-panel__loading"
          role="status"
          data-shell-notification-loading="true"
        >
          {NOTIFICATIONS_LOADING}
        </p>
      ) : null}

      {/* 5.7: a plain statement, with no error indication of any kind. */}
      {empty ? (
        <p className="shell-notification-panel__empty">{NO_NOTIFICATIONS}</p>
      ) : null}

      {/*
       * 5.12: the leading 10 records of the ordered Notification_List. The
       * ordering and both caps are the state machine's, applied before the panel
       * ever sees them.
       */}
      {panelRecords.length === 0 ? null : (
        <ul className="shell-notification-panel__list">
          {panelRecords.map((record) => (
            <li key={record.notificationId} className="shell-notification-panel__item">
              {/* 6.11, 6.12: one keyboard-operable control per record, and the
                  only thing that marks it read is a person activating it. */}
              <NotificationRow record={record} nowMs={nowMs} onActivate={markRead} />
            </li>
          ))}
        </ul>
      )}

      {/* 5.12: the control to the Notifications_Destination, always present —
          the panel previews 10 records and this is where the rest are. */}
      <Link
        to={NOTIFICATIONS_ROUTE}
        className="shell-notification-panel__see-all"
        onClick={onNavigate}
      >
        {NOTIFICATION_PANEL_SEE_ALL}
      </Link>
    </div>
  );
}

export default NotificationPanel;
