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
 * Requirements: 3.8, 7.7, 9.7, 11.10, 15.1
 */

/** The one message shown for any failing notification call (Req 7.7, 11.10). */
export const GENERIC_NOTIFICATION_FAILURE =
  'We could not load your notifications just now. Please try again.';

/** Shown in place of the Notification_List when there is nothing to read. */
export const NO_NOTIFICATIONS = 'You have no notifications.';

/** Shown when the Sign_Out_Control's delegated sign-out does not complete (Req 8.13). */
export const SIGN_OUT_FAILED =
  'We could not complete your sign-out. Please try again.';

/** The level-one heading of the session-ended notice (Req 9.7). */
export const SESSION_ENDED_HEADING = 'Your session has ended';

/** The body of the Unavailable_State for a Destination with no content supplied (Req 3.8). */
export const UNAVAILABLE_BODY = 'This part of PitchMate is not ready yet.';
