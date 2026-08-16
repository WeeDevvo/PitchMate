/**
 * The App_Shell's Destination registry — the four navigation targets the shell
 * frame offers, declared once as data.
 *
 * Requirement 3.1 asks for exactly four Destinations, each with a stable
 * identifier unique across the registry, a visible label of 1 to 24 characters,
 * and a distinct route path. Requirement 3.2 fixes the shape of those paths: the
 * Home_Destination sits at the Auth_Feature's Default_Authenticated_Route
 * `/app`, and every other Destination is `/app` followed by exactly one further
 * segment, each path 1 to 128 characters of lowercase ASCII letters, digits,
 * hyphens, and `/` separators — so no shell path can collide with an
 * Auth_Feature route path or with the marketing landing route path `/`.
 *
 * `HOME_ROUTE` carries the *value* of the Auth_Feature's
 * `DEFAULT_AUTHENTICATED_ROUTE` rather than an import of it, so that this module
 * stays a leaf with no dependencies — Requirement 14.16 keeps every `lib/`
 * module free of React, the DOM, and `@pitchmate/api-client`, and the
 * Auth_Feature's public barrel transitively carries all three. The two values
 * are held together by a test that reads `DEFAULT_AUTHENTICATED_ROUTE` from the
 * Auth_Feature's single public entry point and asserts equality, so they cannot
 * drift (Requirement 3.2).
 *
 * The Home_Destination's label is "Squads" because the squads list is the
 * content a later feature will inject there (Requirement 3.7).
 *
 * This module is React-free and DOM-free (Requirements 14.16, 15.5).
 *
 * Requirements: 1.10, 3.1, 3.2, 15.4
 */

/** The stable identifier of a registered Destination (Requirement 3.1). */
export type DestinationId = 'home' | 'notifications' | 'settings' | 'profile';

/** A registered shell navigation target (Requirement 3.1). */
export interface DestinationDefinition {
  /** Stable identifier, unique across the registry. */
  readonly id: DestinationId;
  /** Visible label, 1 to 24 characters inclusive (Requirement 3.1). */
  readonly label: string;
  /** Route path: `/app` or `/app/<segment>` (Requirement 3.2). */
  readonly path: string;
}

/**
 * The Home_Destination route path — the same value as the Auth_Feature's
 * `DEFAULT_AUTHENTICATED_ROUTE` (Requirement 3.2).
 */
export const HOME_ROUTE = '/app';

/** The Notifications_Destination route path (Requirement 3.2). */
export const NOTIFICATIONS_ROUTE = '/app/notifications';

/** The Settings_Destination route path (Requirement 3.2). */
export const SETTINGS_ROUTE = '/app/settings';

/** The Profile_Destination route path (Requirement 3.2). */
export const PROFILE_ROUTE = '/app/profile';

/** The inclusive bounds a Destination label must satisfy (Requirement 3.1). */
export const DESTINATION_LABEL_MIN_LENGTH = 1;
export const DESTINATION_LABEL_MAX_LENGTH = 24;

/** The inclusive bounds a Destination route path must satisfy (Requirement 3.2). */
export const DESTINATION_PATH_MIN_LENGTH = 1;
export const DESTINATION_PATH_MAX_LENGTH = 128;

/**
 * The four registered Destinations, in the document order the
 * Primary_Navigation renders them (Requirements 3.1, 3.3).
 */
export const SHELL_DESTINATIONS: readonly DestinationDefinition[] = [
  { id: 'home', label: 'Squads', path: HOME_ROUTE },
  { id: 'notifications', label: 'Notifications', path: NOTIFICATIONS_ROUTE },
  { id: 'settings', label: 'Settings', path: SETTINGS_ROUTE },
  { id: 'profile', label: 'Profile', path: PROFILE_ROUTE },
];
