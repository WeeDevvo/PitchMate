/**
 * Public barrel for the App_Shell feature module.
 *
 * Every module of the shell lives under `apps/web/src/features/app-shell/`
 * (Requirement 1.10) and every consumer imports the shell through this single
 * public entry point (Requirement 15.4). The dependency direction runs one way:
 * the application-level router wiring imports this module, this module imports
 * the Auth_Feature through *its* public barrel, and neither the Auth_Feature nor
 * the marketing landing feature imports the shell.
 *
 * The route table (`createShellRoutes`), the injected Destination_Content slots,
 * and the notification, account, and theme surfaces are re-exported here as
 * their tasks land. Only what exists today is exported — nothing is stubbed.
 *
 * Requirements: 1.10, 15.4
 */

// The Destination registry and its route path constants (Requirements 3.1, 3.2).
export {
  SHELL_DESTINATIONS,
  HOME_ROUTE,
  NOTIFICATIONS_ROUTE,
  SETTINGS_ROUTE,
  PROFILE_ROUTE,
  DESTINATION_LABEL_MIN_LENGTH,
  DESTINATION_LABEL_MAX_LENGTH,
  DESTINATION_PATH_MIN_LENGTH,
  DESTINATION_PATH_MAX_LENGTH,
  type DestinationId,
  type DestinationDefinition,
} from './lib/destinations';

// The single pure route resolver behind active-state marking and the `/app`
// not-found outcome (Requirements 3.11, 3.12, 3.13).
export { resolveDestination, type RouteResolution } from './lib/routeResolution';
