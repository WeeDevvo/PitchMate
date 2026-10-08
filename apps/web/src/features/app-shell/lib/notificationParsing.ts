/**
 * The App_Shell's single pure notification list parser, its record model, and the
 * matching printer.
 *
 * `GET /notifications` now answers with a described body — an array of
 * `NotificationSummary`, whose two enum-valued members are published as named
 * string schemas — so the generated client types the body rather than handing
 * back a bare `unknown`. A described body is still not a *verified* one: the
 * generated types describe the contract, while a proxy, a cache, or a backend
 * bug can deliver something else. Requirement 12.5 therefore keeps exactly one
 * pure parser here — React-free and DOM-free — that turns an unverified value
 * into either a parsed outcome carrying zero or more Notification_Records or a
 * parse-failure outcome, with no Notification_Record ever derived by asserting a
 * type onto an unvalidated value.
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
 * ### Both enum-valued fields are read as Wire_Enum_Names (Requirement 12.8)
 *
 * `type` and `readState` cross the wire as the backend enum member names —
 * `MatchDrafted`, `Unread` — not as integer codes, and neither is read as a
 * number and mapped through a table any more. The accepted vocabulary comes from
 * the Committed_Types: {@link CataloguedNotificationType} is an alias over
 * `components['schemas']['NotificationType']` and {@link WireReadState} over
 * `components['schemas']['ReadState']`, so the names are *read from* the
 * generated client rather than restated here.
 *
 * A runtime membership test needs those names as values, and a type alone cannot
 * be enumerated at runtime, so each union has a readonly tuple of its names
 * pinned to the generated union from both sides (Requirement 12.3):
 *
 * | Direction | Mechanism | What it catches |
 * | --- | --- | --- |
 * | No name the contract does not carry | `as const satisfies WireEnumNames<T>` on the tuple | a renamed, removed, or invented member |
 * | No name the contract carries omitted | an entry in {@link WIRE_ENUM_COVERAGE} | a member added to the backend enum |
 *
 * Only together are they a check: the tuple's own `satisfies` would accept a
 * tuple listing seven of eight members, and the coverage entry would accept a
 * tuple listing a ninth name that does not exist. Both fail `tsc -b`, so a
 * vocabulary change is a build failure rather than a runtime surprise — the same
 * idiom the Squads_Feature's `lib/wireEnums.ts` uses.
 *
 * `Read_State` keeps the App_Shell's own `unread`/`read` vocabulary, which its
 * acceptance criteria are written in and which its components and state hooks
 * compare against; the wire name is validated and translated at this boundary
 * and nowhere else, so Requirement 12.1 holds — no screen, component, or state
 * hook is edited by a wire change.
 *
 * ### The rest of the record model
 *
 * `title` and `body` are retained **untruncated** at their supplied lengths. The
 * truncation to 120 and 500 characters is a display concern applied after
 * parsing, not a parse boundary (Requirement 10.2).
 *
 * `type` is a tagged union rather than a bare name so that a backend type the
 * web app has not been taught about survives parsing, display, and printing with
 * its name unchanged (Requirements 10.6, 10.7). `createdAtMs` normalises the
 * wire's ISO-8601 value to an instant in epoch milliseconds; the printer emits it
 * back with an explicit `Z`, which is why the round-trip property compares
 * instants rather than wire strings (Requirement 10.8).
 *
 * **All or nothing per record** (Requirement 12.7): a candidate yields either a
 * fully populated Notification_Record or nothing at all. No field is clamped,
 * defaulted, coerced, or repaired.
 *
 * Totality (Requirements 12.6, 10.12, 14.12): every function here yields one of
 * its stated outcomes for every input value and raises nothing — including for an
 * absent value, `null`, a value of any other type, and a value nested a hundred
 * levels deep. That is achieved with **iterative type guards and no recursion
 * into unknown structure**: nothing here walks a candidate's interior, so depth
 * cannot exhaust the stack, and nothing coerces an unknown value to a string or a
 * number, so a hostile `toString` or `valueOf` cannot be reached. The per-record
 * guard is additionally wrapped so that even an accessor property that throws on
 * read costs that one candidate rather than the whole response.
 *
 * ### The one import a module under `lib/` may make
 *
 * Every other module under `lib/` imports nothing outside `lib/`. This one takes
 * a **type-only** import of `@pitchmate/api-client`, which is erased at compile
 * time: the emitted module has no import at all, so `lib/` keeps the property the
 * rule exists to protect — no runtime dependency, nothing to construct, testable
 * with no transport present. `pureLogic.structural.test.ts` admits this module by
 * name and asserts the import stays type-only (Requirements 14.16, 15.5).
 *
 * This module is React-free and DOM-free.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.10, 10.11, 10.12,
 * 12.3, 12.5, 12.6, 12.7, 12.8, 12.11
 */

import type { components } from '@pitchmate/api-client';

// --- The wire enum vocabulary ------------------------------------------------

/**
 * The names of one wire enum, in the order the backend declares them.
 *
 * Non-empty by construction, because an empty tuple would satisfy every
 * membership test vacuously.
 */
type WireEnumNames<TName extends string> = readonly [TName, ...TName[]];

/**
 * The generated members a tuple of names fails to list, as required properties.
 *
 * `Record<never, never>` is `{}` and accepts the `{}` beside it; a union member
 * missing from the tuple becomes a required property that `{}` cannot provide, so
 * the `satisfies` fails and names the missing member in the compiler error. This
 * is the half of Requirement 12.3 the tuple's own `satisfies` cannot state.
 */
type UncoveredNames<
  TUnion extends string,
  TNames extends readonly string[],
> = Record<Exclude<TUnion, TNames[number]>, never>;

/**
 * The eight catalogued notification kinds, as an alias over the generated enum
 * union of the Committed_Types (Requirements 10.5, 12.8).
 *
 * `null` is excluded because absence is this parser's concern, not a member of
 * the backend enum: the document exporter folds reference-site nullability into
 * the one shared schema, so a later nullable reference site must not widen the
 * vocabulary read here.
 */
export type CataloguedNotificationType = Exclude<
  components['schemas']['NotificationType'],
  null
>;

/** The wire names of a Read_State, as an alias over the generated enum union. */
export type WireReadState = Exclude<components['schemas']['ReadState'], null>;

/**
 * A Notification_Type: either one of the eight catalogued kinds, or an
 * unrecognised marker retaining the name the backend supplied, so an added
 * backend type is displayed rather than discarded and its name survives printing
 * (Requirements 10.6, 10.7).
 */
export type NotificationType =
  | { readonly kind: 'catalogued'; readonly value: CataloguedNotificationType }
  | { readonly kind: 'unrecognised'; readonly name: string };

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

/** The outcome of parsing a notification list response body (Requirement 12.5). */
export type ListParse =
  | { readonly kind: 'parsed'; readonly records: NotificationRecord[] }
  | { readonly kind: 'parse-failure' };

/**
 * The catalogued kinds, in the order the backend declares them, pinned to the
 * Generated_Enum_Union (Requirements 10.5, 12.3).
 *
 * The declaration order is documentation only — nothing is looked up by position
 * any more, which is the point of reading names: there is no index left to be off
 * by one.
 */
export const CATALOGUED_NOTIFICATION_TYPES = [
  'MemberJoined',
  'PromotedToAdmin',
  'RemovedFromSquad',
  'OwnershipTransferred',
  'MatchDrafted',
  'MatchConfirmed',
  'TeamsRolled',
  'ResultPosted',
] as const satisfies WireEnumNames<CataloguedNotificationType>;

/** The wire name of an unread record, and of a read one (Requirement 10.4). */
const WIRE_READ_STATE_UNREAD = 'Unread';
const WIRE_READ_STATE_READ = 'Read';

/**
 * The Read_State wire names, pinned to the Generated_Enum_Union
 * (Requirement 12.3).
 */
export const READ_STATE_WIRE_NAMES = [
  WIRE_READ_STATE_UNREAD,
  WIRE_READ_STATE_READ,
] as const satisfies WireEnumNames<WireReadState>;

/**
 * One `satisfies` per union, asserting that its tuple above omits **no** member
 * of its Generated_Enum_Union (Requirement 12.3).
 *
 * Each value is `{}`, and each target is the set of generated members the tuple
 * beside it fails to list. While a tuple is complete that target is `{}` and the
 * entry type-checks; the moment the Committed_Types gain a member the tuple does
 * not carry, the entry fails `tsc -b` with the missing member named.
 *
 * It is one exported value rather than two loose statements so that nothing here
 * is an unused binding, and so the set of unions this module declares can be read
 * at runtime.
 */
export const WIRE_ENUM_COVERAGE = {
  NotificationType: {} satisfies UncoveredNames<
    CataloguedNotificationType,
    typeof CATALOGUED_NOTIFICATION_TYPES
  >,
  ReadState: {} satisfies UncoveredNames<
    WireReadState,
    typeof READ_STATE_WIRE_NAMES
  >,
} as const;

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
 * Total over every input and free of exceptions (Requirements 12.6, 10.12,
 * 14.12).
 *
 * Requirements: 10.2, 10.3, 10.4, 10.5, 10.6, 10.10, 10.11, 10.12, 12.5, 12.8
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
 * accepted form or length (Requirements 10.3, 12.7).
 *
 * Exported for the Notifications_Api's single-record paths and for the property
 * tests; the list parser is the only caller that also applies the cap.
 */
export function parseNotificationCandidate(candidate: unknown): NotificationRecord | null {
  // Reading a property is the only place an arbitrary input value could raise —
  // a getter defined on the candidate. Guarding here keeps totality absolute
  // while costing the malformed candidate only (Requirements 10.12, 12.6).
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

  const type = notificationTypeFromName(fields.type);
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

  const readState = readStateFromName(fields.readState);
  if (readState === null) {
    return null;
  }

  return { notificationId, type, squadId, title, body, createdAtMs, readState };
}

/**
 * Render a Notification_Record into the wire form the parser accepts: exactly
 * the seven properties of acceptance criterion 10.2, `createdAt` with an
 * explicit UTC designator, `title` and `body` untruncated, and as `type` and
 * `readState` the Wire_Enum_Names of the contract — the catalogued name or the
 * name retained by an unrecognised marker (Requirements 10.7, 12.11).
 *
 * Total and exception-free for every input, including a value that is not a
 * Notification_Record at all: such a value prints properties the parser then
 * rejects, rather than raising (Requirements 10.12, 12.6).
 *
 * Requirements: 10.7, 10.8, 10.12, 12.11
 */
export function printNotificationRecord(record: NotificationRecord): unknown {
  const source: Partial<NotificationRecord> =
    typeof record === 'object' && record !== null ? record : {};

  return {
    notificationId: source.notificationId,
    type: notificationTypeName(source.type as NotificationType),
    squadId: source.squadId,
    title: source.title,
    body: source.body,
    createdAt: printIsoInstant(source.createdAtMs),
    readState:
      source.readState === 'read' ? WIRE_READ_STATE_READ : WIRE_READ_STATE_UNREAD,
  };
}

/**
 * Whether a value is one of the eight catalogued Notification_Type names
 * (Requirements 10.5, 12.8).
 *
 * Total and free of exceptions: a strict comparison against a fixed list of
 * strings, so nothing is coerced and a hostile `toString` or `valueOf` never
 * runs. Compared with `===` rather than `includes`, so the candidate stays
 * `unknown` and no cast is needed to ask the question.
 */
export function isCataloguedNotificationType(
  candidate: unknown,
): candidate is CataloguedNotificationType {
  return CATALOGUED_NOTIFICATION_TYPES.some((name) => name === candidate);
}

/**
 * Map a wire `type` value to a Notification_Type: one of the eight catalogued
 * names to that catalogued kind, any other non-empty string to an unrecognised
 * marker retaining that name, and anything else — absent, `null`, a number, a
 * boolean, an object, or the empty string — to `null`, meaning the field cannot
 * be interpreted (Requirements 10.5, 10.6, 12.8).
 *
 * The empty string is rejected rather than retained so that every unrecognised
 * marker carries a name the printer can emit and the parser will read back; a
 * marker that could not round-trip has no business in the record model.
 */
export function notificationTypeFromName(name: unknown): NotificationType | null {
  if (isCataloguedNotificationType(name)) {
    return { kind: 'catalogued', value: name };
  }

  if (typeof name !== 'string' || name.length === 0) {
    return null;
  }

  return { kind: 'unrecognised', name };
}

/**
 * The Wire_Enum_Name for a Notification_Type: the catalogued name for a
 * recognised kind, the retained name for an unrecognised marker, and the empty
 * string for a value that is neither — a value the parser rejects, so a malformed
 * record cannot round-trip into a well-formed one (Requirements 10.5, 10.6,
 * 10.7).
 */
export function notificationTypeName(type: NotificationType): string {
  if (typeof type !== 'object' || type === null) {
    return '';
  }

  if (type.kind === 'catalogued') {
    return isCataloguedNotificationType(type.value) ? type.value : '';
  }

  if (type.kind === 'unrecognised') {
    return typeof type.name === 'string' ? type.name : '';
  }

  return '';
}

/**
 * Map a wire `readState` value: the `Unread` name to `unread`, the `Read` name to
 * `read`, and every other value — a differently-cased name, the old integer
 * codes, any other string, or any other type — to `null`, meaning the field
 * cannot be interpreted (Requirements 10.4, 12.8).
 *
 * The comparison is exact, with no case folding: the backend serialises the
 * member name verbatim, so `unread` is not a name this contract carries.
 */
function readStateFromName(name: unknown): ReadState | null {
  if (name === WIRE_READ_STATE_UNREAD) {
    return 'unread';
  }

  if (name === WIRE_READ_STATE_READ) {
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
