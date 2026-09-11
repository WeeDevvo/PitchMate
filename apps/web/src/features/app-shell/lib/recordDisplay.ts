/**
 * The App_Shell's single pure Notification_Record display derivation.
 *
 * A Notification_Record reaches the shell exactly as the backend supplied it:
 * `title` of 1 to 200 characters and `body` of 0 to 2000, both retained
 * untruncated by the parser because truncation is a display concern applied after
 * parsing (Requirement 10.2). This module is that display concern, and it is the
 * only place it lives — `NotificationRow` renders what it returns and decides
 * nothing about text itself.
 *
 * What it decides (Requirements 5.5, 5.10, 5.13):
 *
 *  - **Truncation.** The displayed title is at most {@link TITLE_DISPLAY_MAX_LENGTH}
 *    characters and the displayed body at most {@link BODY_DISPLAY_MAX_LENGTH},
 *    each accompanied by a flag that is `true` exactly when that value was
 *    shortened.
 *  - **Blank title.** A title that is empty or consists only of whitespace is
 *    replaced by a label naming the record's Notification_Type, so a row is never
 *    an unreadable blank strip.
 *  - **Blank body.** A body that is empty or consists only of whitespace is
 *    omitted — `null`, one unambiguous representation of *render no body*, so a
 *    component never has to read an empty string as either "no body" or "a body
 *    of nothing".
 *  - **Unrecognised type.** A Notification_Type outside the eight catalogued
 *    kinds yields {@link NEUTRAL_NOTIFICATION_TYPE_LABEL} and
 *    `typeIsRecognised: false`, with the supplied title and body otherwise
 *    unchanged, so a notification type this web app has not been taught about is
 *    displayed rather than discarded.
 *
 * What it deliberately does **not** decide: the relative time label, which
 * `lib/relativeTime.ts` derives from the creation instant and an injected current
 * instant, and the unread cue, which the row renders from `readState` as a filled
 * dot *plus* the word "Unread" in its accessible name so that colour is never the
 * only signal (Requirements 5.6, 13.8). Neither depends on any value here, which
 * is why a blank title, a truncated body, and an unrecognised type all still
 * carry a time label and an unread cue (Requirement 5.13).
 *
 * **The truncation indication is carried by the flag, not baked into the text.**
 * `title` and `body` hold a plain prefix of the supplied value, and
 * `titleTruncated` / `bodyTruncated` tell the row to render the visible
 * indication — an ellipsis and a `title` attribute — beside it. Appending an
 * ellipsis to the string here would spend part of the 120- and 500-character
 * budget on punctuation and would leave a component unable to render the
 * indication any other way, and the interface Requirement 5.5 is satisfied
 * against carries the two flags precisely so the presentation of the indication
 * stays with the presentation layer.
 *
 * Truncation counts UTF-16 code units, the same unit the parser's length bounds
 * are expressed in, with one refinement: a cut that would fall between the two
 * halves of a surrogate pair moves back one unit instead, so the displayed text
 * never ends in a lone surrogate that renders as a replacement character. The
 * displayed value is therefore always a prefix of the supplied value and always
 * within the limit — occasionally one unit shorter.
 *
 * The function is **total**: every input yields a complete RecordDisplay with a
 * non-empty `title`, a non-empty `typeLabel`, and no exception raised — including
 * for a value that is not a Notification_Record at all, whose absent or
 * wrong-typed fields read as a blank title, an omitted body, and the neutral type
 * label. No input produces an error indication, because there is no failure
 * outcome here to indicate (Requirement 5.13).
 *
 * The fixed strings live here rather than in `lib/messages.ts`, which holds one
 * standalone message per user-facing outcome. These are labels naming a
 * Notification_Type — one arm of this function's output, read against
 * Requirements 5.10 and 5.13 beside the code that selects them.
 *
 * This module is React-free and DOM-free like every module under `lib/`, and
 * imports only the record model from `lib/notificationParsing.ts` — in particular
 * not `@pitchmate/api-client` (Requirements 14.16, 15.5).
 *
 * Requirements: 5.5, 5.6, 5.10, 5.13
 */

import type {
  CataloguedNotificationType,
  NotificationRecord,
  NotificationType,
} from './notificationParsing';

/**
 * The greatest number of characters of a supplied title that is displayed
 * (Requirement 5.5). A supplied title may be up to 200 characters, so a title
 * beyond this is shortened and flagged.
 */
export const TITLE_DISPLAY_MAX_LENGTH = 120;

/**
 * The greatest number of characters of a supplied body that is displayed
 * (Requirement 5.5). A supplied body may be up to 2000 characters, so a body
 * beyond this is shortened and flagged.
 */
export const BODY_DISPLAY_MAX_LENGTH = 500;

/**
 * A user-facing label naming each of the eight catalogued Notification_Types,
 * used as the type indication on a row and as the stand-in for a title that is
 * empty or whitespace-only (Requirement 5.13).
 */
export const NOTIFICATION_TYPE_LABELS: Readonly<
  Record<CataloguedNotificationType, string>
> = {
  'member-joined': 'Member joined',
  'promoted-to-admin': 'Promoted to admin',
  'removed-from-squad': 'Removed from squad',
  'ownership-transferred': 'Ownership transferred',
  'match-drafted': 'Match drafted',
  'match-confirmed': 'Match confirmed',
  'teams-rolled': 'Teams rolled',
  'result-posted': 'Result posted',
};

/**
 * The neutral type indication for a Notification_Type outside the eight
 * catalogued kinds (Requirement 5.10). It names no kind and discloses no integer
 * code, so a backend type this web app has not been taught about reads as a
 * notification rather than as something broken.
 */
export const NEUTRAL_NOTIFICATION_TYPE_LABEL = 'Notification';

/** The display values of one Notification_Record (Requirements 5.5, 5.10, 5.13). */
export interface RecordDisplay {
  /**
   * The title to display: the supplied title truncated to at most
   * {@link TITLE_DISPLAY_MAX_LENGTH} characters, or {@link typeLabel} where the
   * supplied title is empty or whitespace-only. Never an empty string.
   */
  readonly title: string;
  /** Whether {@link title} is a shortened form of the supplied title. */
  readonly titleTruncated: boolean;
  /**
   * The body to display: the supplied body truncated to at most
   * {@link BODY_DISPLAY_MAX_LENGTH} characters, or `null` where the supplied body
   * is empty or whitespace-only and no body is displayed at all.
   */
  readonly body: string | null;
  /** Whether {@link body} is a shortened form of the supplied body. */
  readonly bodyTruncated: boolean;
  /**
   * The label naming the record's Notification_Type, or
   * {@link NEUTRAL_NOTIFICATION_TYPE_LABEL} for a type outside the eight
   * catalogued kinds. Never an empty string.
   */
  readonly typeLabel: string;
  /** Whether the record's Notification_Type is one of the eight catalogued kinds. */
  readonly typeIsRecognised: boolean;
}

/** One value's truncation outcome: the text to display, and whether it was cut. */
interface Truncation {
  readonly text: string;
  readonly truncated: boolean;
}

/**
 * Derive the display values of one Notification_Record.
 *
 * Total over every input and free of exceptions: a value that is not a
 * Notification_Record yields the same shape, with a blank title falling back to
 * the neutral type label and an absent body omitted.
 *
 * @param record the parsed Notification_Record to display, with `title` and
 *   `body` at their supplied lengths
 * @returns the title and body to display with their truncation flags, and the
 *   record's type label with whether that type is catalogued
 *
 * Requirements: 5.5, 5.10, 5.13
 */
export function recordDisplay(record: NotificationRecord): RecordDisplay {
  // Totality: a value that is not an object supplies no field, so every value
  // below falls back rather than raising on a property read.
  const source: Partial<NotificationRecord> =
    typeof record === 'object' && record !== null ? record : {};

  const suppliedTitle = typeof source.title === 'string' ? source.title : '';
  const suppliedBody = typeof source.body === 'string' ? source.body : '';

  // 5.10: an unrecognised type takes the neutral indication and leaves the
  // supplied title and body untouched.
  const typeIsRecognised = isCataloguedType(source.type);
  const typeLabel = notificationTypeLabel(source.type);

  // 5.13: an empty or whitespace-only title is replaced by the label naming the
  // record's Notification_Type. Nothing of the supplied title is being shortened
  // in that case, so the truncation flag stays down; the label is far inside the
  // limit, and truncating it too is what makes the length bound hold for every
  // input rather than only for the ones a label was not substituted into.
  const title = isBlank(suppliedTitle)
    ? truncateDisplay(typeLabel, TITLE_DISPLAY_MAX_LENGTH)
    : truncateDisplay(suppliedTitle, TITLE_DISPLAY_MAX_LENGTH);

  // 5.13: an empty or whitespace-only body is omitted rather than rendered as a
  // blank line under the title.
  const body = isBlank(suppliedBody)
    ? null
    : truncateDisplay(suppliedBody, BODY_DISPLAY_MAX_LENGTH);

  return {
    title: title.text,
    titleTruncated: title.truncated,
    body: body === null ? null : body.text,
    bodyTruncated: body !== null && body.truncated,
    typeLabel,
    typeIsRecognised,
  };
}

/**
 * Whether a supplied value carries no readable text — absent, empty, or made up
 * entirely of whitespace (Requirement 5.13). `trim` is what decides, so a title
 * of non-breaking spaces or ideographic spaces counts as blank just as a run of
 * ASCII spaces does.
 */
function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

/**
 * Whether a supplied `type` value is one of the eight catalogued kinds
 * (Requirement 5.10).
 *
 * A marker naming a kind this module holds no label for is treated as
 * unrecognised, so the two arms of the returned display can never disagree about
 * whether the type was catalogued.
 */
function isCataloguedType(type: NotificationType | undefined): boolean {
  return (
    typeof type === 'object' &&
    type !== null &&
    type.kind === 'catalogued' &&
    typeof NOTIFICATION_TYPE_LABELS[type.value] === 'string'
  );
}

/**
 * The label naming a supplied `type` value: the catalogued label for one of the
 * eight kinds, and {@link NEUTRAL_NOTIFICATION_TYPE_LABEL} for an unrecognised
 * marker, an absent value, or a value that is not a Notification_Type at all
 * (Requirements 5.10, 5.13). Always a non-empty string.
 */
function notificationTypeLabel(type: NotificationType | undefined): string {
  if (isCataloguedType(type)) {
    return NOTIFICATION_TYPE_LABELS[
      (type as { readonly value: CataloguedNotificationType }).value
    ];
  }

  return NEUTRAL_NOTIFICATION_TYPE_LABEL;
}

/**
 * Truncate a value to at most `maxLength` characters, reporting whether anything
 * was cut (Requirement 5.5).
 *
 * The result is always a prefix of the supplied value and never longer than the
 * limit. Where the cut would land between the two halves of a surrogate pair it
 * moves back one code unit, so the displayed text does not end in a lone
 * surrogate — which is why the result is occasionally one unit shorter than the
 * limit.
 *
 * The visible truncation indication is the caller's to render, from the returned
 * flag; no ellipsis is appended here.
 */
function truncateDisplay(value: string, maxLength: number): Truncation {
  if (value.length <= maxLength) {
    return { text: value, truncated: false };
  }

  const lastUnit = value.charCodeAt(maxLength - 1);
  const splitsSurrogatePair = lastUnit >= 0xd800 && lastUnit <= 0xdbff;
  const end = splitsSurrogatePair ? maxLength - 1 : maxLength;

  return { text: value.slice(0, end), truncated: true };
}
