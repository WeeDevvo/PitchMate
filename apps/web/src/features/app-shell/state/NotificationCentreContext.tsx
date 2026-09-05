/**
 * The React context that publishes **one** notification state machine to the
 * whole Shell_Frame.
 *
 * Requirement 4.1 asks for exactly one unread-count call per mount of the frame
 * and none in consequence of a re-render, and Requirement 4.7 for exactly one
 * count call and one list call per opening of the Notification_Panel. Both are
 * statements about the *number of machines*, not just about the machine's logic:
 * if the Notification_Indicator, the Notification_Panel, and the
 * Notifications_Destination each called {@link useNotificationCentre}
 * themselves, there would be three poll loops, three counts, and three lists.
 *
 * So the hook runs **once**, here, and every surface reads it through
 * {@link useNotificationCentreContext}. The provider is composed inside the
 * shell's own route tree — beneath the `Route_Guard` (so it only ever runs for an
 * authenticated session) and beneath the {@link SquadScopeProvider} (so the
 * machine sees the Squad_Scope from the moment it mounts and observes every later
 * change to it) — which is why it is not exported from the feature barrel. A
 * Destination_Content supplies a Squad_Scope through the Squad_Scope seams and
 * reads notifications, if it ever needs to, through this context.
 *
 * ### What the provider reads from where
 *
 * | Value | Source | Why |
 * | --- | --- | --- |
 * | Squad_Scope | {@link useSquadScope} | Supplied from outside the frame only (Req 7.2) |
 * | Auth_State | the Auth_Feature's `useAuth` | Stops the poll loop when the session ends (Req 4.9) |
 * | Notifications_Api, sign-out, Poll_Interval, clock | props | Injected at `createShellRoutes` time (Req 11.1, 9.4) |
 *
 * The Auth_State is read on every render rather than captured, mirroring the
 * `Route_Guard`'s discipline (Requirement 2.4): the poll loop must stop within
 * 500 milliseconds of a session ending, and a retained copy of the state cannot
 * deliver that.
 *
 * ### Why the clock lives here
 *
 * `now` is not part of the state machine — no scheduling decision reads it, since
 * the poll loop is driven by `setTimeout` — but the Notification_Row needs an
 * injected current instant to derive its relative time label deterministically
 * (Requirements 5.5, 5.11). The rows already consume this context, so the clock
 * travels with the records rather than through a second provider. It defaults to
 * `Date.now`, and a test supplies a fixed instant instead.
 *
 * Requirements: 4.1, 4.7, 4.9, 5.5, 5.11, 7.2, 7.3, 9.4, 11.1
 */

import {
  createContext,
  useContext,
  useMemo,
  type ReactElement,
  type ReactNode,
} from 'react';

import { useAuth } from '../../auth';
import type { NotificationsApi } from '../api/notificationsApi';
import { useSquadScope } from './SquadScopeContext';
import {
  useNotificationCentre,
  type NotificationCentre,
} from './useNotificationCentre';

/**
 * The notification surface every shell component reads, plus the injected clock
 * the Notification_Rows derive their relative time labels from.
 */
export interface NotificationCentreContextValue extends NotificationCentre {
  /** The injected current instant in epoch milliseconds (Requirements 5.5, 5.11). */
  readonly now: () => number;
}

/**
 * `undefined` when no provider is above the caller.
 *
 * Unlike the Squad_Scope — where "no scope" is a specified, safe state
 * (Requirement 7.1) — there is no safe meaning for "no notification centre": a
 * surface would render a count of nothing and mark nothing read, with nothing to
 * explain it. That is a wiring mistake, so {@link useNotificationCentreContext}
 * throws, following the Auth_Feature's `useAuth` convention.
 */
const NotificationCentreContext = createContext<
  NotificationCentreContextValue | undefined
>(undefined);

/**
 * Read the one notification state machine.
 *
 * @throws Error where the caller sits outside a
 *   {@link NotificationCentreProvider}.
 *
 * Requirements: 4.1, 4.7
 */
// eslint-disable-next-line react-refresh/only-export-components -- provider + its context hook are intentionally co-located
export function useNotificationCentreContext(): NotificationCentreContextValue {
  const value = useContext(NotificationCentreContext);
  if (value === undefined) {
    throw new Error(
      'useNotificationCentreContext must be used within a NotificationCentreProvider',
    );
  }
  return value;
}

export interface NotificationCentreProviderProps {
  /**
   * The Notifications_Api facade over the Authenticated_Api_Client — the shell's
   * only transport seam (Requirements 11.1, 11.3). Construct it once, above the
   * shell, so a re-render does not hand the machine a new facade.
   */
  readonly api: NotificationsApi;
  /**
   * The Auth_Feature's sign-out navigation, invoked once by the session-expiry
   * handover (Requirements 9.4, 9.5).
   */
  readonly signOut: () => void | Promise<void>;
  /** The configured Poll_Interval in seconds, clamped to 15..600 (Req 4.6). */
  readonly pollIntervalSeconds?: number;
  /** The clock behind relative time labels; defaults to `Date.now` (Req 5.5, 5.11). */
  readonly now?: () => number;
  readonly children?: ReactNode;
}

/** The default clock, hoisted so the context value's identity is stable. */
const systemClock = (): number => Date.now();

/**
 * Run the notification state machine once and publish it.
 *
 * Renders no element of its own — only the context provider around `children` —
 * so it contributes nothing to the frame's landmarks or heading structure
 * (Requirements 1.5, 1.9).
 *
 * Requirements: 4.1, 4.7, 4.9, 5.5, 5.11, 7.2, 7.3, 9.4, 11.1
 */
export function NotificationCentreProvider({
  api,
  signOut,
  pollIntervalSeconds,
  now = systemClock,
  children,
}: NotificationCentreProviderProps): ReactElement {
  // 7.2: the scope arrives from a route parameter or hosting content, never from
  // a control the frame renders.
  const squadScope = useSquadScope();
  // 4.9: read every render, never retained, so an ended session stops the loop.
  const { state: authState } = useAuth();

  const centre = useNotificationCentre({
    api,
    signOut,
    squadScope,
    authState,
    pollIntervalSeconds,
  });

  const value = useMemo<NotificationCentreContextValue>(
    () => ({ ...centre, now }),
    [centre, now],
  );

  return (
    <NotificationCentreContext.Provider value={value}>
      {children}
    </NotificationCentreContext.Provider>
  );
}

export default NotificationCentreProvider;
