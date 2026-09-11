/**
 * The App_Shell's single pure Notification_List ordering and its display caps.
 *
 * The backend list endpoint returns Notification_Records in no order the web app
 * may rely on, so the shell decides the order itself. Requirement 5.4 fixes that
 * order exactly: creation instant **descending** — newest first — with ties
 * broken by notification identity **descending**, keeping at most the first 200
 * records of that ordering and discarding the rest without any error indication.
 *
 * Because identity is unique per Notification_Record, the pair
 * (creation instant, identity) is unique too, so the comparison below is a
 * **strict total order** on the supplied records rather than a partial one. That
 * is the whole point of the identity tie-break: two records created in the same
 * millisecond still have exactly one correct relative position, so the ordering
 * cannot depend on the order the records arrived in (Requirement 14.3). Without
 * the tie-break, same-instant records would keep their supplied relative order
 * and the same set of records could render two different ways.
 *
 * Ordering is a **rearrangement plus a truncation, never an edit**: no record is
 * introduced, no record appears twice, no record is dropped except by the cap,
 * and every record is returned by reference exactly as supplied (Requirement
 * 14.4). The supplied array is not mutated — it is copied before sorting — so a
 * caller may hold the parser's output and order it repeatedly without the list it
 * holds changing underneath it.
 *
 * Two caps apply, both of them display concerns (Requirements 5.4, 5.12):
 *
 *  - {@link NOTIFICATION_LIST_CAP} of 200 — the length of the ordered
 *    Notification_List itself, which is what the Notifications_Destination shows
 *    in full.
 *  - {@link NOTIFICATION_PANEL_PREVIEW_CAP} of 10 — the leading slice of that
 *    ordered list the Notification_Panel previews beside its control that
 *    navigates to the Notifications_Destination.
 *
 * Both are applied by taking a **leading slice of the ordered list**, so the
 * panel preview is always a prefix of what the destination shows and the two
 * surfaces can never disagree about which notification is newest.
 *
 * Every function here is **total**: any array of records yields an array, and no
 * input raises an exception. Totality is structural — sorting compares numbers
 * and strings through folds that admit no `NaN` comparison and no coercion of an
 * unknown value, so neither a hostile `valueOf` nor an implementation-defined
 * sort result is reachable.
 *
 * This module is React-free and DOM-free like every module under `lib/`, and
 * imports only the record type it orders — in particular not
 * `@pitchmate/api-client` (Requirements 14.16, 15.5).
 *
 * Requirements: 5.4, 5.12, 14.3, 14.4
 */

import type { NotificationRecord } from './notificationParsing';

/**
 * The greatest number of Notification_Records an ordered Notification_List
 * carries — the Notification_List_Cap of 200 (Requirements 5.4, 5.12).
 *
 * Records beyond it are discarded silently: the cap mirrors the backend read
 * model's own limit, so exceeding it is not an error condition to report.
 *
 * `lib/notificationParsing.ts` owns the parse-side cap constant
 * (`NOTIFICATION_LIST_PARSE_CAP`); the two hold the same value and a test keeps
 * them from drifting.
 */
export const NOTIFICATION_LIST_CAP = 200;

/**
 * The greatest number of Notification_Records the Notification_Panel previews —
 * the first 10 of the ordered Notification_List, the rest reached through the
 * Notifications_Destination (Requirement 5.12).
 */
export const NOTIFICATION_PANEL_PREVIEW_CAP = 10;

/**
 * Order Notification_Records newest first and cap the result at the
 * Notification_List_Cap.
 *
 * The supplied array is left untouched; the returned array is a fresh array of
 * the same record references.
 *
 * @param records the Notification_Records to order, in any supplied order
 * @returns a new array holding the first {@link NOTIFICATION_LIST_CAP} records of
 *   the ordering: creation instant descending, ties broken by notification
 *   identity descending
 *
 * Requirements: 5.4, 5.12, 14.3, 14.4
 */
export function orderNotifications(
  records: readonly NotificationRecord[],
): NotificationRecord[] {
  // 14.4: copy first. `sort` reorders in place, and the caller's array — often
  // the parser's output held in shell state — must survive being ordered.
  const ordered = records.slice();

  // 5.4, 14.3: one total comparison, so the result depends on the records and
  // not on the order they were supplied in.
  ordered.sort(compareNotificationsNewestFirst);

  // 5.4: discard everything beyond the cap, silently.
  return ordered.slice(0, NOTIFICATION_LIST_CAP);
}

/**
 * Take the leading Notification_Records the Notification_Panel previews.
 *
 * Expects the already-ordered Notification_List from {@link orderNotifications}
 * and returns a prefix of it, so the panel and the Notifications_Destination
 * always agree on which notifications are newest (Requirement 5.12).
 *
 * @param orderedRecords the ordered Notification_List
 * @returns a new array holding at most the first
 *   {@link NOTIFICATION_PANEL_PREVIEW_CAP} records, in the order supplied
 *
 * Requirements: 5.12, 14.4
 */
export function panelPreviewNotifications(
  orderedRecords: readonly NotificationRecord[],
): NotificationRecord[] {
  return orderedRecords.slice(0, NOTIFICATION_PANEL_PREVIEW_CAP);
}

/**
 * Compare two Notification_Records for the Notification_List order: creation
 * instant descending, then notification identity descending (Requirement 5.4).
 *
 * Returns 0 only for records sharing both keys. Identity is unique per record,
 * so that happens only when the same notification was supplied twice, in which
 * case the two copies keep their supplied relative order — `sort` is stable —
 * and the ordering is still deterministic.
 */
function compareNotificationsNewestFirst(
  left: NotificationRecord,
  right: NotificationRecord,
): number {
  const leftInstant = comparableInstant(left);
  const rightInstant = comparableInstant(right);

  // Descending: the later instant sorts first. Both operands are finite here, so
  // the subtraction could not be `NaN`, but comparisons are used anyway to keep
  // the result inside the -1/0/1 range a comparator is read as.
  if (leftInstant > rightInstant) {
    return -1;
  }

  if (leftInstant < rightInstant) {
    return 1;
  }

  const leftIdentity = comparableIdentity(left);
  const rightIdentity = comparableIdentity(right);

  // Descending by identity, compared by UTF-16 code unit in the letter case the
  // records were supplied in — the same case the parser retained, so ordering
  // adds no normalisation of its own.
  if (leftIdentity > rightIdentity) {
    return -1;
  }

  if (leftIdentity < rightIdentity) {
    return 1;
  }

  return 0;
}

/**
 * A record's creation instant as a finite number to compare.
 *
 * The parser only ever produces a finite instant, so the fold matters solely for
 * a record reaching this module by some other route: a non-numeric or `NaN`
 * instant folds to `-Infinity` and therefore sorts last under the descending
 * order, instead of making the comparator return `NaN` and leaving the sorted
 * result implementation-defined.
 */
function comparableInstant(record: NotificationRecord): number {
  const instant = record?.createdAtMs;

  return typeof instant === 'number' && Number.isFinite(instant) ? instant : -Infinity;
}

/**
 * A record's identity as a string to compare, folding an absent or non-string
 * identity to the empty string so it sorts last under the descending order
 * rather than making the comparison undefined.
 */
function comparableIdentity(record: NotificationRecord): string {
  const identity = record?.notificationId;

  return typeof identity === 'string' ? identity : '';
}
