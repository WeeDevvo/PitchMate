/**
 * The App_Shell's single pure Unread_Badge formatter and Notification_Indicator
 * namer.
 *
 * The Unread_Count reaches the Notification_Indicator as a number, and two
 * separate things have to report it: the Unread_Badge a sighted person sees, and
 * the Notification_Indicator's accessible name a screen-reader user hears.
 * Requirement 4.10 asks for the badge text to come from a pure function so the
 * formatting is testable without a browser, and Requirement 4.5 asks for the
 * accessible name to report the *same* count independently of the badge's visual
 * position. Declaring both here, over one shared reading of the count, is what
 * keeps them from drifting — Property 15 asserts they always agree.
 *
 * The three bands (Requirements 4.2, 4.3, 4.4, 14.8):
 *
 * | Unread_Count      | Badge text     | Name reports the count as        |
 * | ----------------- | -------------- | -------------------------------- |
 * | 0                 | none (`null`)  | no notifications are unread      |
 * | 1–99 inclusive    | `1` … `99`     | that same decimal representation |
 * | 100 or above      | `99+`          | `99+`                            |
 *
 * `null` is the one representation of *render no badge* (Requirement 4.4), so a
 * component never has to decide whether an empty string means "no badge" or "a
 * badge with nothing in it". A count of 0 is not an absence of information — the
 * name still states that nothing is unread, because "Notifications" alone would
 * leave a screen-reader user unable to tell a quiet inbox from an unreported one.
 * That also covers the state before the first accepted unread-count value, which
 * the notification centre holds at 0 (Requirement 4.12).
 *
 * A Squad_Scope changes the name but never the badge text. While a Squad_Scope is
 * active the count covers one squad rather than every squad of the signed-in
 * account, and Requirement 7.6 asks for that coverage to be conveyed to
 * assistive technology; the badge is a number in a corner with no room to say so,
 * which is precisely why the name carries it.
 *
 * Both functions are **total**: every numeric input yields one badge outcome and
 * one non-empty name, and raises no exception. In production the count has
 * already passed `parseNonNegativeInteger`, so it is an integer from 0 to
 * 2,147,483,647 — the folding of a value outside that (a negative, a fraction, a
 * non-finite number) onto the nearest sensible band is structural rather than
 * defensive, so that no input can produce a badge reading `-1`, `5.5`, or `NaN`.
 *
 * The fixed strings live here rather than in `lib/messages.ts`. That module holds
 * one *standalone* message per user-facing outcome — a failure notice, an empty
 * state, a heading — each rendered verbatim. These strings are fragments
 * assembled with the count, meaningless on their own, so keeping them beside the
 * assembling functions keeps each declared exactly once at the place that can be
 * read against Requirements 4.5 and 7.6.
 *
 * This module is React-free and DOM-free like every module under `lib/`, and
 * imports nothing at all — in particular not `@pitchmate/api-client`
 * (Requirements 14.16, 15.5).
 *
 * Requirements: 4.2, 4.3, 4.4, 4.5, 7.6, 14.8
 */

/**
 * The lowest Unread_Count that renders an Unread_Badge (Requirement 4.4). A count
 * below this renders no badge.
 */
export const BADGE_MIN_COUNT = 1;

/**
 * The highest Unread_Count the Unread_Badge shows as a decimal representation
 * (Requirement 4.2). A count above this shows {@link BADGE_OVERFLOW_TEXT}.
 */
export const BADGE_MAX_EXACT_COUNT = 99;

/**
 * The Unread_Badge text for an Unread_Count of 100 or above (Requirement 4.3).
 * The same text is what the Notification_Indicator's accessible name reports for
 * that band, so the two never disagree about a large count.
 */
export const BADGE_OVERFLOW_TEXT = '99+';

/**
 * The term naming notifications as the Notification_Indicator's subject
 * (Requirement 4.5). Every accessible name this module builds opens with it, so
 * the control announces what it is before it announces how many.
 */
export const NOTIFICATIONS_SUBJECT = 'Notifications';

/** How the accessible name reports an Unread_Count of 0 (Requirement 4.5). */
const NO_UNREAD_PHRASE = 'no unread notifications';

/** How the accessible name reports a count of 1 or above, after the count. */
const UNREAD_PHRASE = 'unread';

/**
 * The phrase appended while a Squad_Scope is active, conveying that the count
 * covers a single squad rather than every squad of the signed-in account
 * (Requirement 7.6).
 */
const SQUAD_SCOPED_PHRASE = 'in this squad';

/**
 * Read a supplied Unread_Count as the whole number of unread Notification_Records
 * both the badge and the name report.
 *
 * One reading serves both functions, which is what makes them agree by
 * construction rather than by two matching sets of comparisons.
 *
 * Total over every numeric input: a non-finite number and a value below 0 read as
 * 0, and a fraction reads as the whole count it has passed, so `0.5` is not yet
 * one unread record and `5.5` is five. Neither case arises from an accepted
 * unread-count response, which carries an integer from 0 to 2,147,483,647.
 */
function displayedUnreadCount(count: number): number {
  // `NaN`, `Infinity`, and `-Infinity` are no count at all; reading them as 0
  // before the band comparisons matters because `NaN` compares false against
  // every bound and would otherwise fall through to the overflow band.
  if (!Number.isFinite(count)) {
    return 0;
  }

  // A negative count is no unread record. This also normalises `-0` to `0`.
  if (count < BADGE_MIN_COUNT) {
    return 0;
  }

  // 4.2: the badge shows a *decimal representation* of the count, so the value
  // reaching the bands is a whole number and can never render as `5.5`.
  return Math.trunc(count);
}

/**
 * Derive the Unread_Badge text from the Unread_Count.
 *
 * Total over every numeric input and free of exceptions.
 *
 * @param count the Unread_Count to display — 0 before the first accepted
 *   unread-count value (Requirement 4.12)
 * @returns the decimal representation for a count of
 *   {@link BADGE_MIN_COUNT}..{@link BADGE_MAX_EXACT_COUNT} inclusive,
 *   {@link BADGE_OVERFLOW_TEXT} for a count above that, and `null` where the
 *   Notification_Indicator renders no Unread_Badge at all
 *
 * Requirements: 4.2, 4.3, 4.4, 14.8
 */
export function unreadBadgeText(count: number): string | null {
  const displayed = displayedUnreadCount(count);

  // 4.4: a count of 0 renders the Notification_Indicator without the
  // Unread_Badge. `null` says that, rather than an empty badge.
  if (displayed < BADGE_MIN_COUNT) {
    return null;
  }

  // 4.3: 100 or above shows the fixed overflow text, so the badge stays one
  // small, stable shape however large the count grows — 2,147,483,647 included.
  if (displayed > BADGE_MAX_EXACT_COUNT) {
    return BADGE_OVERFLOW_TEXT;
  }

  // 4.2: 1 to 99 inclusive shows the decimal representation, so 1 renders as `1`.
  return String(displayed);
}

/**
 * Build the Notification_Indicator's accessible name.
 *
 * The name opens with {@link NOTIFICATIONS_SUBJECT} and then reports the same
 * count the Unread_Badge shows, so the count is perceivable without relying on
 * the badge's visual position (Requirement 4.5). While a Squad_Scope is active it
 * also states that the count covers a single squad (Requirement 7.6).
 *
 * Total over every numeric input: the result is always a non-empty string and no
 * input raises an exception.
 *
 * @param count the Unread_Count to report, read exactly as {@link unreadBadgeText}
 *   reads it
 * @param scoped whether a Squad_Scope is active, in which case the count covers
 *   that one squad rather than every squad of the signed-in account
 * @returns the accessible name, naming notifications as its subject and reporting
 *   the count as its decimal representation for 1 to 99, as
 *   {@link BADGE_OVERFLOW_TEXT} for 100 or above, and as a statement that no
 *   notifications are unread for 0
 *
 * Requirements: 4.5, 7.6, 14.8
 */
export function notificationIndicatorLabel(
  count: number,
  scoped: boolean,
): string {
  const badge = unreadBadgeText(count);

  // 4.5: with no badge the name still reports the count — as a statement that
  // nothing is unread, so a quiet inbox is distinguishable from an unreported one.
  const report =
    badge === null ? NO_UNREAD_PHRASE : `${badge} ${UNREAD_PHRASE}`;

  // 7.6: a squad-scoped count says so, in the name rather than on the badge,
  // because a badge showing `3` cannot convey which squad the 3 belongs to.
  const coverage = scoped ? ` ${SQUAD_SCOPED_PHRASE}` : '';

  return `${NOTIFICATIONS_SUBJECT}, ${report}${coverage}`;
}
