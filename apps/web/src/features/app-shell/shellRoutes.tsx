/**
 * The App_Shell's route table — the one place every shell module is composed.
 *
 * `createShellRoutes` is the shell's whole runtime surface: the application
 * router calls it once, hands it the Authenticated_Api_Client and the
 * Auth_Feature's sign-out navigation, and spreads the result into its own route
 * list (Requirements 11.1, 15.4). Everything else in this feature is reached
 * through what is assembled here.
 *
 * ### The registered routes
 *
 * | Route path | Content | Requirement |
 * | --- | --- | --- |
 * | `/app` (index) | `destinationContent.home`, or the Unavailable_State | 3.1, 3.2, 3.7, 3.8 |
 * | `/app/notifications` | {@link NotificationListView} | 3.9, 5.12 |
 * | `/app/settings` | {@link SettingsDestination} + `destinationContent.settings` | 3.1, 12.4 |
 * | `/app/profile` | `destinationContent.profile`, or the Unavailable_State | 3.7, 3.8 |
 * | `/app/*` | {@link ShellNotFound} | 3.10 |
 *
 * Every path comes from the Destination registry rather than from a literal
 * typed here, so a registered Destination cannot lose its route and no route can
 * exist for something unregistered (Requirements 3.1, 3.2). The Home_Destination
 * is the layout route's own path, so it is registered as the `index` child — one
 * path, one place, exactly once (Requirement 15.6).
 *
 * The layout route means the Shell_Frame is mounted **once** for the whole
 * subtree and a navigation between Destinations swaps only the `<Outlet />`
 * content: the header keeps its DOM node, its disclosure state, and its
 * notification poll loop, and nothing performs a full-document reload
 * (Requirements 1.3, 3.4, 3.6, 4.1).
 *
 * Case and trailing-slash differences are `react-router`'s to absorb — it matches
 * case-insensitively and ignores a trailing separator — and the shell's own
 * active-state marking goes through the same pure resolver, so `/app/settings`,
 * `/app/settings/`, and `/app/Settings` are one screen by both routes
 * (Requirement 3.13).
 *
 * ### The composition, outermost first
 *
 * ```
 * RouteGuard                 admits the subtree only while authenticated (Req 2.1)
 *   ShellThemeProvider       one resolved Theme for every surface (Req 12.5)
 *     SquadScopeProvider     the scope, supplied from outside the frame (Req 7.2)
 *       NotificationCentre   one state machine, one poll loop (Req 4.1)
 *         ShellFrame         skip link, banner header, content region (Req 1.1)
 * ```
 *
 * The order is not arbitrary. The guard is outermost so nothing beneath it —
 * including the poll loop — exists for an unauthenticated visitor
 * (Requirement 2.2). The Squad_Scope sits above the notification centre so the
 * machine sees the scope from the moment it mounts and observes every later
 * change (Requirements 7.3, 7.4). The Theme wraps both so a provider re-resolving
 * the appearance never remounts the state machine.
 *
 * ### What is constructed once, here
 *
 * The Notifications_Api facade is built in this function rather than inside a
 * component, so it is created once per route table and a re-render can never hand
 * the state machine a new facade (Requirement 11.1). No Api_Client is constructed
 * anywhere in the shell: the client arrives already carrying the Auth_Feature's
 * bearer middleware, which is what keeps token renewal, expiry, and persistence
 * entirely the Auth_Feature's concern (Requirements 9.1, 9.2, 15.2).
 *
 * Requirements: 3.1, 3.2, 3.6, 3.7, 3.9, 3.10, 11.1, 15.4
 */
import { useCallback, type ReactElement, type ReactNode } from 'react';
import { Outlet, type RouteObject } from 'react-router-dom';
import type { PitchMateApiClient } from '@pitchmate/api-client';

import { createNotificationsApi } from './api/notificationsApi';
import { AccountMenu } from './components/AccountMenu';
import { Disclosure } from './components/Disclosure';
import { NotificationIndicator } from './components/NotificationIndicator';
import { NotificationListView } from './components/NotificationListView';
import { NotificationPanel } from './components/NotificationPanel';
import { PrimaryNavigation } from './components/PrimaryNavigation';
import { ShellThemeProvider } from './components/ShellThemeProvider';
import type { ShellHeaderSlotProps } from './components/ShellHeader';
import { DestinationUnavailable } from './DestinationUnavailable';
import {
  HOME_ROUTE,
  NOTIFICATIONS_ROUTE,
  PROFILE_ROUTE,
  SETTINGS_ROUTE,
} from './lib/destinations';
import { RouteGuard } from './RouteGuard';
import { SessionEndedNotice } from './SessionEndedNotice';
import { SettingsDestination } from './SettingsDestination';
import { ShellFrame } from './ShellFrame';
import { ShellNotFound } from './ShellNotFound';
import {
  NotificationCentreProvider,
  useNotificationCentreContext,
} from './state/NotificationCentreContext';
import { SquadScopeProvider } from './state/SquadScopeContext';

/**
 * The Destination_Content a hosting application injects.
 *
 * Three of the four Destinations take their body from here (Requirement 3.7).
 * The Notifications_Destination does not appear: the shell supplies its content
 * itself (Requirement 3.9). A later feature fills `home` with the squads list and
 * changes no file under `features/app-shell/` (Requirement 15.4).
 */
export interface ShellDestinationContent {
  /**
   * The Home_Destination's body. Omit to render the Unavailable_State, which is
   * the MVP: the squads list is a later feature (Requirements 3.7, 3.8).
   */
  readonly home?: ReactNode;
  /** The Profile_Destination's body. Omit to render the Unavailable_State. */
  readonly profile?: ReactNode;
  /**
   * Extra Settings sections, rendered *after* the shell's own appearance section
   * so the appearance option group is always reached first (Requirement 12.4).
   */
  readonly settings?: ReactNode;
}

/** What {@link createShellRoutes} needs from the application wiring. */
export interface ShellRoutesOptions {
  /**
   * The Authenticated_Api_Client from the Auth_Feature, already carrying the
   * bearer-attaching middleware. Every notification call is issued through it,
   * and the shell constructs no client of its own (Requirements 9.1, 11.1).
   */
  readonly apiClient: PitchMateApiClient;
  /**
   * The Auth_Feature's sign-out navigation, used by the Sign_Out_Control and by
   * the session-expiry handover. The shell clears no Session and performs no
   * navigation of its own (Requirements 8.9, 9.4, 15.2).
   */
  readonly signOut: () => Promise<void>;
  /** The injected Destination bodies (Requirements 3.7, 15.4). */
  readonly destinationContent?: ShellDestinationContent;
  /**
   * The configured Poll_Interval in seconds. Absent, non-numeric, and
   * non-finite values fold to 60 and the result is clamped to 15..600 by the pure
   * `effectivePollIntervalSeconds` (Requirement 4.6).
   */
  readonly pollIntervalSeconds?: number;
  /**
   * The clock behind every relative time label; defaults to `Date.now`. Injected
   * so a test derives deterministic labels (Requirements 5.5, 5.11).
   */
  readonly now?: () => number;
}

/**
 * The Content_Region's children: the active Destination, or the session-ended
 * notice while a handover is in progress.
 *
 * Requirement 9.7 asks that a handover leave neither the active
 * Destination_Content nor any value it or the Notification_List displayed on
 * screen, and put a neutral indication in its place. Swapping the `<Outlet />`
 * for {@link SessionEndedNotice} is how: the Destination is unmounted rather than
 * hidden, so nothing it rendered survives, and the notice takes no props so there
 * is nothing for it to carry over.
 */
// eslint-disable-next-line react-refresh/only-export-components -- composition glue for the route table, deliberately unexported
function ShellContent(): ReactElement {
  const { handoverInProgress } = useNotificationCentreContext();
  return handoverInProgress ? <SessionEndedNotice /> : <Outlet />;
}

/**
 * The Notification_Indicator and the Notification_Panel it discloses.
 *
 * The panel's control to the Notifications_Destination collapses the surface and
 * moves no focus itself: the navigation it performs changes the Content_Region,
 * and {@link ContentRegion} focuses the arriving Destination's level-one heading
 * (Requirement 13.12) — which is a better landing point than the trigger the
 * person just left.
 *
 * While a session-expiry handover is in progress the surface is held closed, as
 * Requirement 9.7 requires. The indicator itself stays rendered, and renders
 * without the Unread_Badge because the handover resets the displayed count to 0.
 */
// eslint-disable-next-line react-refresh/only-export-components -- composition glue for the route table, deliberately unexported
function ShellNotifications({ disclosure }: ShellHeaderSlotProps): ReactElement {
  const { handoverInProgress } = useNotificationCentreContext();
  const { surfaceId, open, requestOpen, requestClose } = disclosure;

  const handleNavigate = useCallback((): void => {
    requestClose('activate');
  }, [requestClose]);

  return (
    <Disclosure
      id={surfaceId}
      // 9.7: closed for the duration of the handover, whatever the header's
      // disclosure group last recorded.
      open={open && !handoverInProgress}
      onRequestOpen={requestOpen}
      onRequestClose={requestClose}
      trigger={(triggerProps) => <NotificationIndicator {...triggerProps} />}
    >
      <NotificationPanel onNavigate={handleNavigate} />
    </Disclosure>
  );
}

/**
 * The Account_Menu, holding Profile, Settings, and Sign out.
 *
 * `onSignOutComplete` is deliberately not supplied. Requirement 8.13 asks that a
 * completed sign-out leave no scheduled unread-count call behind, and in the
 * assembled shell that follows from the Auth_State: a completed sign-out makes it
 * `unauthenticated`, which stops the poll loop (Requirement 4.9) and takes the
 * Route_Guard's unauthenticated branch, unmounting the machine with the frame.
 * Passing a second cancellation seam here would duplicate a transition the shell
 * already observes.
 *
 * As with the notification panel, the menu is held closed while a session-expiry
 * handover is in progress (Requirement 9.7).
 */
// eslint-disable-next-line react-refresh/only-export-components -- composition glue for the route table, deliberately unexported
function ShellAccount({
  disclosure,
  signOut,
}: ShellHeaderSlotProps & { readonly signOut: () => Promise<void> }): ReactElement {
  const { handoverInProgress } = useNotificationCentreContext();

  return (
    <AccountMenu
      disclosure={
        handoverInProgress ? { ...disclosure, open: false } : disclosure
      }
      signOut={signOut}
    />
  );
}

/**
 * Build the App_Shell's route subtree for the application router.
 *
 * Returns the single `/app` layout route — the Route_Guard, the three providers,
 * and the Shell_Frame — with one child route per registered Destination and the
 * `*` child for a path under `/app` that resolves to none of them. Spread the
 * result into the application router's top-level route list.
 *
 * @example
 *   const router = createBrowserRouter([
 *     { path: '/', element: <LandingPage /> },
 *     ...createWiredAuthRoutes(authOptions).routes,
 *     ...createShellRoutes({ apiClient, signOut }),
 *     { path: '*', element: <AppNotFound /> },
 *   ])
 *
 * Requirements: 3.1, 3.2, 3.6, 3.7, 3.9, 3.10, 11.1, 15.4
 */
export function createShellRoutes({
  apiClient,
  signOut,
  destinationContent = {},
  pollIntervalSeconds,
  now,
}: ShellRoutesOptions): RouteObject[] {
  // 11.1: one facade over the injected client, per route table. Built here rather
  // than in a component, so no render can replace it and restart the poll loop.
  const api = createNotificationsApi(apiClient);

  return [
    {
      path: HOME_ROUTE,
      element: (
        // 2.1, 2.2: nothing below this line exists for an unauthenticated visitor.
        <RouteGuard>
          <ShellThemeProvider>
            <SquadScopeProvider>
              <NotificationCentreProvider
                api={api}
                signOut={signOut}
                pollIntervalSeconds={pollIntervalSeconds}
                now={now}
              >
                <ShellFrame
                  navigation={(props) => <PrimaryNavigation {...props} />}
                  notifications={(props) => <ShellNotifications {...props} />}
                  account={(props) => (
                    <ShellAccount {...props} signOut={signOut} />
                  )}
                >
                  <ShellContent />
                </ShellFrame>
              </NotificationCentreProvider>
            </SquadScopeProvider>
          </ShellThemeProvider>
        </RouteGuard>
      ),
      children: [
        {
          // 3.2: the Home_Destination *is* the layout route's path, so it is the
          // index child rather than a second registration of `/app`.
          index: true,
          element:
            destinationContent.home ?? <DestinationUnavailable destinationId="home" />,
        },
        {
          // 3.9: supplied by the shell, so this Destination needs no injection.
          path: NOTIFICATIONS_ROUTE,
          element: <NotificationListView />,
        },
        {
          // 3.1, 12.4: the shell's own appearance section, then anything injected.
          path: SETTINGS_ROUTE,
          element: (
            <SettingsDestination>{destinationContent.settings}</SettingsDestination>
          ),
        },
        {
          path: PROFILE_ROUTE,
          element:
            destinationContent.profile ?? (
              <DestinationUnavailable destinationId="profile" />
            ),
        },
        {
          // 3.10: a path under `/app` matching no Destination stays inside the
          // frame, and marks no Primary_Navigation control as the current page.
          path: '*',
          element: <ShellNotFound />,
        },
      ],
    },
  ];
}

export default createShellRoutes;
