/**
 * The App_Shell's fixed user-facing strings — one string per user-facing
 * outcome, declared once.
 *
 * `GENERIC_NOTIFICATION_FAILURE` is the single Generic_Notification_Failure
 * message: every failing notification call — a non-disclosing not-found, a
 * transport failure, a lapsed Notification_Call_Timeout, a parse failure,
 * squad-scoped or account-wide — is presented with exactly this text, so the
 * shell reveals nothing about whether a record or a squad exists
 * (Requirements 7.7, 11.10). It therefore carries no status code, no header
 * value, and no response body value.
 *
 * This module is React-free and DOM-free like every module under `lib/`
 * (Requirements 14.16, 15.5): it declares constants and touches nothing.
 *
 * Requirements: 1.6, 3.8, 3.10, 5.7, 5.8, 5.9, 5.12, 6.4, 6.8, 6.9, 7.7, 9.7,
 * 11.10, 12.4, 15.1
 */

// Type-only, and from the shell's own `lib/` re-export of the shared theme
// module — so this module keeps declaring constants and importing no runtime
// behaviour (Requirements 14.16, 15.5, 15.7).
import type { AppearancePreference } from './theme';

/**
 * The accessible name of the Compact_Layout Primary_Navigation disclosure
 * control (Req 1.6, 1.11).
 *
 * Deliberately not "Navigation": the control sits *inside* the navigation
 * landmark, which the Shell_Header already names "Primary", so an assistive
 * technology announces "Primary navigation, Menu button, collapsed" rather than
 * saying "navigation" twice. It is also distinct from the Account_Menu's fixed
 * name "Account menu", so the two controls are never confused by name alone.
 */
export const PRIMARY_NAVIGATION_TOGGLE = 'Menu';

/** The one message shown for any failing notification call (Req 7.7, 11.10). */
export const GENERIC_NOTIFICATION_FAILURE =
  'We could not load your notifications just now. Please try again.';

/** Shown in place of the Notification_List when there is nothing to read. */
export const NO_NOTIFICATIONS = 'You have no notifications.';

/**
 * The loading indication shown inside the Notification_Panel while a list call
 * awaits a response (Requirement 5.8).
 *
 * Text rather than a bare spinner, so the state is conveyed without relying on
 * motion or colour, and so a screen reader announces something when the panel's
 * status region updates.
 */
export const NOTIFICATIONS_LOADING = 'Loading your notifications…';

/**
 * The visible label of the retry control shown beside a failed list call's
 * message (Requirement 5.9).
 *
 * Short because it sits directly after {@link GENERIC_NOTIFICATION_FAILURE},
 * which already asks the person to try again — the control names the action, the
 * message explains it.
 */
export const NOTIFICATION_RETRY_LABEL = 'Try again';

/**
 * The visible label of the Notification_Panel's control that navigates to the
 * Notifications_Destination (Requirement 5.12).
 *
 * It says "all" because the panel shows only the leading 10 records of the
 * ordered Notification_List, so the destination is where the rest are.
 */
export const NOTIFICATION_PANEL_SEE_ALL = 'See all notifications';

/** The visible label of the Mark_All_Read_Control (Requirements 6.4, 6.9). */
export const MARK_ALL_READ_LABEL = 'Mark all as read';

/**
 * The label the Mark_All_Read_Control carries while its call awaits a response
 * (Requirement 6.8).
 *
 * Replacing the label rather than adding a colour or a spinner beside it means
 * the progress reaches the control's accessible name, so it is announced as well
 * as seen and it is never carried by colour alone.
 */
export const MARK_ALL_READ_IN_PROGRESS = 'Marking all as read…';

/**
 * The word carried inside an unread Notification_Record's control so the unread
 * state reaches the accessible name (Requirements 5.6, 13.8).
 *
 * The visible cue is the filled dot `styles/shell.css` paints from
 * `data-unread='true'` — a shape as well as a colour. This is the same state as a
 * word, so a person who perceives no colour and a person using a screen reader
 * each get the state from something other than the colour. Neither carrier is on
 * its own.
 */
export const UNREAD_STATE_LABEL = 'Unread';

/**
 * The accessible name — and the visible label — of the control that opens and
 * closes the Account_Menu (Requirement 8.1).
 *
 * Fixed text naming the account menu, and *only* that: no account name, no email
 * address, no initials, nothing read from the Session (Requirements 8.1, 8.4).
 * The shell has no backend account read model to fetch such a value from, so a
 * session-derived name would have to be invented.
 *
 * It is rendered as the control's visible text rather than supplied as an
 * `aria-label`, which makes the visible label and the accessible name the same
 * string by construction (WCAG 2.5.3) and leaves nothing for a speech-input user
 * to guess. It is distinct from {@link PRIMARY_NAVIGATION_TOGGLE}, so the header's
 * two disclosure controls are never confused by name alone.
 */
export const ACCOUNT_MENU_LABEL = 'Account menu';

/**
 * The visible label of the Sign_Out_Control — 1 to 24 characters, like every
 * Account_Menu control's label (Requirement 8.2).
 */
export const SIGN_OUT_LABEL = 'Sign out';

/**
 * The Sign_Out_Control's in-progress indication (Requirement 8.10).
 *
 * Words, not a spinner: the progress is then heard as well as seen, and is never
 * carried by colour or motion alone (Requirement 13.8). It is rendered *beside*
 * {@link SIGN_OUT_LABEL} rather than in place of it, so the control's visible
 * label — the one a speech-input user says — does not change underneath a
 * sign-out that is merely slow.
 */
export const SIGN_OUT_IN_PROGRESS = 'Signing out…';

/** Shown when the Sign_Out_Control's delegated sign-out does not complete (Req 8.13). */
export const SIGN_OUT_FAILED =
  'We could not complete your sign-out. Please try again.';

/** The level-one heading of the session-ended notice (Req 9.7). */
export const SESSION_ENDED_HEADING = 'Your session has ended';

/**
 * The body of the session-ended notice (Req 9.7).
 *
 * Neutral by design: an ended session is a handover to sign-in, not a failure, so
 * this says what is happening and nothing about anything going wrong. The
 * Auth_Feature performs the navigation that follows.
 */
export const SESSION_ENDED_BODY = 'Taking you to sign in.';

/** The body of the Unavailable_State for a Destination with no content supplied (Req 3.8). */
export const UNAVAILABLE_BODY = 'This part of PitchMate is not ready yet.';

/**
 * The level-one heading of the `/app` not-found indication (Req 3.10).
 *
 * A requested path under `/app` that matches no registered Destination is a
 * wrong address, not a fault: the wording states the outcome and carries no error
 * framing, and the surface that renders it marks no Primary_Navigation control as
 * the current page.
 */
export const SHELL_NOT_FOUND_HEADING = 'Page not found';

/** The body of the `/app` not-found indication (Req 3.10). */
export const SHELL_NOT_FOUND_BODY =
  'That address is not part of PitchMate. It may have changed.';

/**
 * The visible label of the control that navigates to the Home_Destination from
 * the Unavailable_State and from the `/app` not-found indication
 * (Requirements 3.8, 3.10).
 *
 * It names the destination it reaches, so the label matches the
 * Home_Destination's Primary_Navigation control. The two are held together by a
 * test that reads the registered label through `destinationLabel('home')` and
 * asserts this string carries it — which keeps this module a table of constants
 * that imports no runtime behaviour while still making drift a failing test
 * rather than a silent mismatch.
 */
export const HOME_CONTROL_LABEL = 'Go to Squads';

/**
 * The accessible name of the Appearance_Preference_Control's option group
 * (Req 12.4).
 *
 * It names appearance as the group's subject, which is what lets the current
 * value be understood without relying on colour or on visual position.
 */
export const APPEARANCE_GROUP_LABEL = 'Appearance';

/**
 * The visible text label of each Appearance_Preference option — one per stored
 * value, each 1 to 24 characters inclusive (Req 12.4).
 *
 * `system` reads as "Match my device" rather than "System" because the value's
 * meaning to a person is *follow the browser*, not *a mode called system*.
 */
export const APPEARANCE_OPTION_LABELS: Record<AppearancePreference, string> = {
  system: 'Match my device',
  dark: 'Dark',
  light: 'Light',
};
