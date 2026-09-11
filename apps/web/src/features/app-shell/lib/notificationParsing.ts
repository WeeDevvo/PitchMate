/**
 * The App_Shell's single pure notification list parser, its record model, and the
 * matching printer.
 *
 * The committed OpenAPI document describes `GET /notifications` as `200 OK` with
 * **no response schema**, so the generated client hands the shell an `unknown`
 * body. Requirement 10.1 therefore asks for exactly one pure parser — React-free
 * and DOM-free — that turns that unknown value into either a parsed outcome
 * carrying zero or more Notification_Records or a parse-failure outcome, with no
 * Notification_Record ever derived by asserting a type onto an unvalidated value.
 *
 * The two outcomes divide as follows:
 *
 *  - A top level that is anything other than an array — absent, `null`, an
 *    object, a string, a number, a boolean — is a **parse-failure**, because an
 *    unschematised top-level shape must reach the Generic_Notification_Failure
 *    path rather than render a partial list (Requirement 10.10).
 *  - An array is **always** a parsed outcome (Requirement 10.11). Each element
 *    that is not a valid candidate is dropped, the rest keep their supplied
 *    relative order, and only the first 200 elements — the Notification_List_Cap
 *    — are considered at all (Requirements 10.3, 10.11). One malformed row can
 *    therefore never hide the rows around it.
 *
 * `title` and `body` are retained **untruncated** at their supplied lengths. The
 * truncation to 120 and 500 characters is a display concern applied after
 * parsing, not a parse boundary (Requirement 10.2).
 *
 * `type` is a tagged union rather than a bare number so that a backend code the
 * web app has not been taught about survives parsing, display, and printing with
 * its integer unchanged (Requirements 10.6, 10.7). `createdAtMs` normalises the
 * wire's ISO-8601 value to an instant in epoch milliseconds; the printer emits it
 * back with an explicit `Z`, which is why the round-trip property compares
 * instants rather than wire strings (Requirement 10.8).
 *
 * Totality (Requirements 10.12, 14.12): every function here yields one of its
 * stated outcomes for every input value and raises nothing — including for an
 * absent value, `null`, a value of any other type, and a value nested a hundred
 * levels deep. That is achieved with **iterative type guards and no recursion
 * into unknown structure**: nothing here walks a candidate's interior, so depth
 * cannot exhaust the stack, and nothing coerces an unknown value to a string or a
 * number, so a hostile `toString` or `valueOf` cannot be reached. The per-record
 * guard is additionally wrapped so that even an accessor property that throws on
 * read costs that one candidate rather than the whole response.
 *
 * This module is React-free, DOM-free, and imports no `@pitchmate/api-client`
 * (Requirements 14.16, 15.5).
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.10, 10.11, 10.12
 */

/**
 * The eight catalogued notification kinds, in the code order the backend
 * serialises them: 0 through 7 (Requirement 10.5).
 */
export type CataloguedNotificationType =
  | 'member-joined'
  | 'promoted-to-admin'
  | 'removed-from-squad'
  | 'ownership-transferred'
  | 'match-drafted'
  | 'match-confirmed'
  | 'teams-rolled'
  | 'result-posted';

/**
 * A Notification_Type: either one of the eight catalogued kinds, or an
 * unrecognised marker retaining the integer code the backend supplied, so an
 * added backend type is displayed rather than discarded and its code survives
 * printing (Requirements 10.6, 10.7).
 */
export type NotificationType =
  | { readonly kind: 'catalogued'; readonly value: CataloguedNotificationType }
  | { readonly kind: 'unrecognised'; readonly code: number };

/** A Notification_Record's read status (Requirement 10.4). */
export type ReadState = 'unread' | 'read';

/** One row of the notification read model (Requirement 10.2). */
export interface NotificationRecord {
  /** Notification identity, 36-character hyphenated form, letter case as supplied. */
  readonly notificationId: string;
  /** The notification kind, catalogued or unrecognised. */
  readonly type: NotificationType;
  /** Squad identity, 36-character hyphenated form, letter case as supplied. */
  readonly squadId: string;
  /** 1 to 200 characters, retained untruncated (Requirement 10.2). */
  readonly title: string;
  /** 0 to 2000 characters, retained untruncated (Requirement 10.2). */
  readonly body: string;
  /** The creation instant, in epoch milliseconds. */
  readonly createdAtMs: number;
  /** The read status. */
  readonly readState: ReadState;
}

/** The outcome of parsing a notification list response body (Requirement 10.1). */
export type ListParse =
  | { readonly kind: 'parsed'; readonly records: NotificationRecord[] }
  | { readonly kind: 'parse-failure' };

/**
 * The catalogued kinds indexed by their wire code — index 0 is code 0
 * (Requirement 10.5).
 */
export const CATALOGUED_NOTIFICATION_TYPES: readonly CataloguedNotificationType[] = [
  'member-joined',
  'promoted-to-admin',
  'removed-from-squad',
  'ownership-transferred',
  'match-drafted',
  'match-confirmed',
  'teams-rolled',
  'result-posted',
];

/** The accepted inclusive bounds on a supplied `title` (Requirement 10.2). */
export const NOTIFICATION_TITLE_MIN_LENGTH = 1;
export const NOTIFICATION_TITLE_MAX_LENGTH = 200;

/** The accepted inclusive bounds on a supplied `body` (Requirement 10.2). */
export const NOTIFICATION_BODY_MIN_LENGTH = 0;
export const NOTIFICATION_BODY_MAX_LENGTH = 2000;

/**
 * The number of leading array elements a single listing is parsed from — the
 * Notification_List_Cap of 200 (Requirement 10.11).
 *
 * `lib/notificationOrdering.ts` owns the display-side cap constant; the two hold
 * the same value and a test keeps them from drifting.
 */
export const NOTIFICATION_LIST_PARSE_CAP = 200;

/** The wire code for an unread record, and for a read one (Requirement 10.4). */
const READ_STATE_CODE_UNREAD = 0;
const READ_STATE_CODE_READ = 1;

/** The one parse-failure value, shared so callers can compare cheaply. */
const PARSE_FAILURE: ListParse = { kind: 'parse-failure' };

/**
 * The 36-character hyphenated identity form: 8, 4, 4, 4, and 12 hexadecimal
 * digits, accepted in either letter case (Requirement 10.2). Not global and not
 * sticky, so it carries no `lastIndex` state between calls.
 */
const IDENTITY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An ISO 8601 date-time carrying an explicit UTC designator or a numeric UTC
 * offset (Requirement 10.2). A value with no designator and no offset matches
 * nothing here, which is the point: a local-time instant is ambiguous.
 *
 * Accepted: a four-digit year or the expanded signed six-digit year (which is
 * what an instant near the ends of the representable range prints as), an
 * optional seconds field, an optional fractional part introduced by `.` or `,`,
 * and an offset of `Z`, `±HH:MM`, `±HHMM`, or `±HH`.
 */
const ISO_DATE_TIME_PATTERN =
  /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?(Z|z|[+-]\d{2}:\d{2}|[+-]\d{4}|[+-]\d{2})$/;

/** The largest absolute instant a JavaScript date value can represent. */
const MAX_INSTANT_MS = 8_640_000_000_000_000;

/**
 * Parse a notification list response body.
 *
 * Total over every input and free of exceptions (Requirements 10.12, 14.12).
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.10, 10.11, 10.12
 */
export function parseNotificationList(body: unknown): ListParse {
  // 10.10: only an array is a list. Absent, null, and every other shape is a
  // parse-failure the caller treats as a failed call.
  if (!Array.isArray(body)) {
    return PARSE_FAILURE;
  }

  const candidates: unknown[] = body;

  // 10.11: only the first 200 elements are considered; later elements are
  // discarded without turning the outcome into a parse-failure.
  const limit = Math.min(candidates.length, NOTIFICATION_LIST_PARSE_CAP);
  const records: NotificationRecord[] = [];

  for (let index = 0; index < limit; index += 1) {
    const record = parseNotificationCandidate(candidates[index]);

    // 10.3: an invalid candidate is dropped; every other candidate of the same
    // response keeps its supplied relative order.
    if (record !== null) {
      records.push(record);
    }
  }

  return { kind: 'parsed', records };
}

/**
 * Parse one candidate record, yielding `null` when the candidate is not an
 * object or when any one of the seven properties is absent, null, or outside its
 * accepted form or length (Requirement 10.3).
 *
 * Exported for the Notifications_Api's single-record paths and for the property
 * tests; the list parser is the only caller that also applies the cap.
 */
export function parseNotificationCandidate(candidate: unknown): NotificationRecord | null {
  // Reading a property is the only place an arbitrary input value could raise —
  // a getter defined on the candidate. Guarding here keeps totality absolute
  // while costing the malformed candidate only (Requirement 10.12).
  try {
    return readNotificationCandidate(candidate);
  } catch {
    return null;
  }
}

function readNotificationCandidate(candidate: unknown): NotificationRecord | null {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return null;
  }

  const fields = candidate as Record<string, unknown>;

  const notificationId = readIdentity(fields.notificationId);
  if (notificationId === null) {
    return null;
  }

  const squadId = readIdentity(fields.squadId);
  if (squadId === null) {
    return null;
  }

  const type = notificationTypeFromCode(fields.type);
  if (type === null) {
    return null;
  }

  const title = readBoundedString(
    fields.title,
    NOTIFICATION_TITLE_MIN_LENGTH,
    NOTIFICATION_TITLE_MAX_LENGTH,
  );
  if (title === null) {
    return null;
  }

  const body = readBoundedString(
    fields.body,
    NOTIFICATION_BODY_MIN_LENGTH,
    NOTIFICATION_BODY_MAX_LENGTH,
  );
  if (body === null) {
    return null;
  }

  const createdAtMs = parseIsoInstantMs(fields.createdAt);
  if (createdAtMs === null) {
    return null;
  }

  const readState = readStateFromCode(fields.readState);
  if (readState === null) {
    return null;
  }

  return { notificationId, type, squadId, title, body, createdAtMs, readState };
}

/**
 * Render a Notification_Record into the wire form the parser accepts: exactly
 * the seven properties of acceptance criterion 10.2, `createdAt` with an
 * explicit UTC designator, `title` and `body` untruncated, and as `type` the
 * catalogued integer code or the code retained by an unrecognised marker
 * (Requirement 10.7).
 *
 * Total and exception-free for every input, including a value that is not a
 * Notification_Record at all: such a value prints properties the parser then
 * rejects, rather than raising (Requirement 10.12).
 *
 * Requirements: 10.7, 10.8, 10.12
 */
export function printNotificationRecord(record: NotificationRecord): unknown {
  const source: Partial<NotificationRecord> =
    typeof record === 'object' && record !== null ? record : {};

  return {
    notificationId: source.notificationId,
    type: notificationTypeCode(source.type as NotificationType),
    squadId: source.squadId,
    title: source.title,
    body: source.body,
    createdAt: printIsoInstant(source.createdAtMs),
    readState: source.readState === 'read' ? READ_STATE_CODE_READ : READ_STATE_CODE_UNREAD,
  };
}

/**
 * Map a wire `type` value to a Notification_Type: codes 0 through 7 to the eight
 * catalogued kinds in their catalogued order, any other integer to an
 * unrecognised marker retaining that code, and any non-integer — including a
 * fractional, non-numeric, string-encoded, `NaN`, or infinite value — to `null`,
 * meaning the field cannot be interpreted (Requirements 10.5, 10.6).
 */
export function notificationTypeFromCode(code: unknown): NotificationType | null {
  if (typeof code !== 'number' || !Number.isInteger(code)) {
    return null;
  }

  // `-0` compares equal to `0`, so it is the catalogued code 0.
  if (code >= 0 && code < CATALOGUED_NOTIFICATION_TYPES.length) {
    return { kind: 'catalogued', value: CATALOGUED_NOTIFICATION_TYPES[code] };
  }

  return { kind: 'unrecognised', code };
}

/**
 * The wire code for a Notification_Type: the catalogued index for a recognised
 * kind, the retained code for an unrecognised marker, and `NaN` for a value that
 * is neither — a code the parser rejects, so a malformed record cannot round-trip
 * into a well-formed one (Requirements 10.5, 10.6, 10.7).
 */
export function notificationTypeCode(type: NotificationType): number {
  if (typeof type !== 'object' || type === null) {
    return Number.NaN;
  }

  if (type.kind === 'catalogued') {
    const code = CATALOGUED_NOTIFICATION_TYPES.indexOf(type.value);
    return code === -1 ? Number.NaN : code;
  }

  if (type.kind === 'unrecognised') {
    return typeof type.code === 'number' ? type.code : Number.NaN;
  }

  return Number.NaN;
}

/**
 * Map a wire `readState` value: 0 to `unread`, 1 to `read`, and every other
 * value — negative, fractional, non-numeric, or string-encoded — to `null`,
 * meaning the field cannot be interpreted (Requirement 10.4).
 */
function readStateFromCode(code: unknown): ReadState | null {
  if (code === READ_STATE_CODE_UNREAD) {
    return 'unread';
  }

  if (code === READ_STATE_CODE_READ) {
    return 'read';
  }

  return null;
}

/**
 * A supplied identity in the accepted 36-character hyphenated form, in the letter
 * case it was supplied in, or `null` (Requirement 10.2).
 */
function readIdentity(value: unknown): string | null {
  if (typeof value !== 'string' || value.length !== 36 || !IDENTITY_PATTERN.test(value)) {
    return null;
  }

  return value;
}

/**
 * A supplied string within the inclusive length bounds, untruncated, or `null`
 * (Requirement 10.2). Length is counted in UTF-16 code units, the same unit the
 * backend's own bound is expressed in.
 */
function readBoundedString(
  value: unknown,
  minLength: number,
  maxLength: number,
): string | null {
  if (typeof value !== 'string' || value.length < minLength || value.length > maxLength) {
    return null;
  }

  return value;
}

/**
 * Parse an ISO 8601 date-time carrying an explicit UTC designator or a numeric
 * UTC offset into an instant in epoch milliseconds, or `null` when the value is
 * not a string, is not that form, carries neither designator nor offset, names a
 * calendar field outside its range, or falls outside the representable instant
 * range (Requirement 10.2).
 *
 * Calendar fields are combined arithmetically rather than handed to the runtime's
 * lenient date parser, so a two-digit year is not silently shifted into the
 * twentieth century and a rolled-over field such as day 32 is rejected rather
 * than absorbed. A fractional part is truncated to millisecond precision, which
 * is why the round-trip property compares instants and not wire strings.
 */
function parseIsoInstantMs(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }

  const match = ISO_DATE_TIME_PATTERN.exec(value);

  if (match === null) {
    return null;
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText, offsetText] =
    match;

  // ISO 8601 has no negative zero year.
  if (yearText === '-000000') {
    return null;
  }

  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = secondText === undefined ? 0 : Number(secondText);

  if (month < 1 || month > 12) {
    return null;
  }

  if (day < 1 || day > daysInMonth(year, month)) {
    return null;
  }

  if (hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  const millisecond =
    fractionText === undefined ? 0 : Number(`${fractionText}00`.slice(0, 3));

  const offsetMinutes = offsetMinutesFrom(offsetText);

  if (offsetMinutes === null) {
    return null;
  }

  // `setUTCFullYear` rather than `Date.UTC`, which maps years 0..99 to 1900..1999.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);

  const localMs = date.getTime();

  if (!Number.isFinite(localMs)) {
    return null;
  }

  const instantMs = localMs - offsetMinutes * 60_000;

  if (!Number.isFinite(instantMs) || Math.abs(instantMs) > MAX_INSTANT_MS) {
    return null;
  }

  return instantMs;
}

/**
 * The offset of a matched designator in whole minutes east of UTC: `0` for the
 * UTC designator, and `null` for an offset whose hour or minute field is out of
 * range.
 */
function offsetMinutesFrom(offsetText: string): number | null {
  if (offsetText === 'Z' || offsetText === 'z') {
    return 0;
  }

  const sign = offsetText.charAt(0) === '-' ? -1 : 1;
  const digits = offsetText.slice(1).replace(':', '');
  const offsetHour = Number(digits.slice(0, 2));
  const offsetMinute = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;

  if (offsetHour > 23 || offsetMinute > 59) {
    return null;
  }

  return sign * (offsetHour * 60 + offsetMinute);
}

/** The number of days in a month of the proleptic Gregorian calendar. */
function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Print an instant as an ISO 8601 date-time with an explicit `Z` designator
 * (Requirement 10.7). A value that is not a representable instant prints as a
 * value the parser rejects rather than raising (Requirement 10.12).
 */
function printIsoInstant(createdAtMs: unknown): string {
  if (
    typeof createdAtMs !== 'number' ||
    !Number.isFinite(createdAtMs) ||
    Math.abs(createdAtMs) > MAX_INSTANT_MS
  ) {
    return String(createdAtMs);
  }

  return new Date(createdAtMs).toISOString();
}
