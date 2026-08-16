/**
 * The App_Shell's single pure Read_State transitions over the displayed
 * Notification_List and Unread_Count.
 *
 * Marking a notification read touches two displayed values at once — one
 * Notification_Record's Read_State and the Unread_Count on the
 * Notification_Indicator — and both changes are applied optimistically, before
 * the backend answers, then rolled back if the call fails (Requirements 6.1,
 * 6.6). Requirement 6.10 therefore asks for the pair to be derived by one pure
 * function, so that the arithmetic is testable without a browser and so that the
 * optimistic apply, the rollback, and the successful confirm all read the same
 * rule rather than three hand-rolled ones.
 *
 * The two transitions:
 *
 * | Transition                            | Records                              | Unread_Count |
 * | ------------------------------------- | ------------------------------------ | ------------ |
 * | mark-read, identity is unread         | that record becomes `read`           | one lower, floored at 0 |
 * | mark-read, identity already `read`    | unchanged                            | unchanged    |
 * | mark-read, identity not displayed     | unchanged                            | unchanged    |
 * | mark-all-read                         | every record becomes `read`          | 0            |
 *
 * Three properties fall out of that table, and they are the reason the rule is
 * written as a table rather than as an increment:
 *
 *  - **Idempotence** (Requirement 14.5). A second mark-read for the same identity
 *    finds the record already `read` and is a no-op, so applying the transition
 *    twice yields the same Notification_List and Unread_Count as applying it once.
 *    That matters in practice: an impatient second activation of the same row,
 *    or a re-render that replays the transition, must not decrement the count
 *    twice for one notification. The Read_State itself carries the "already
 *    counted" fact, so no separate record of what has been decremented is needed.
 *  - **A no-op for an already-read record** (Requirement 6.3). Activating a
 *    record that is already `read` leaves both values alone, which is also what
 *    tells the caller there is nothing to send to the backend.
 *  - **A bounded count** (Requirements 6.10, 14.7). The count after a mark-read is
 *    never above the count before and never more than 1 below it, and never below
 *    0. The floor is what keeps an Unread_Count of 0 alongside an unread record —
 *    reachable whenever the backend's count arrives lower than the list, since
 *    the count is account-wide or squad-wide while the list is capped at 200 —
 *    from producing a count of `-1`.
 *
 * `applyMarkAllRead` sets the count to **0 unconditionally** rather than
 * subtracting the number of unread records it marked (Requirement 6.5). The
 * displayed list is a capped window on the Squad_Scope, so unread records outside
 * it are marked by the same backend call and are not there to be counted;
 * subtracting would leave a non-zero count behind after a successful
 * mark-all-read.
 *
 * Both functions are **pure**: the supplied view, its records array, and every
 * record in it are left exactly as they were, and the result is built from new
 * objects. A caller may hold the pre-transition view as its rollback value
 * (Requirement 6.6) and be sure the transition has not edited it underneath.
 * Where nothing changes, the supplied records array is returned by reference —
 * the same records in the same order — so a no-op transition gives a React caller
 * nothing to re-render.
 *
 * A record's other values are carried across untouched, including the integer
 * code of an unrecognised type marker (Requirement 10.6) and the untruncated
 * `title` and `body`: only `readState` is rewritten.
 *
 * Identities are compared **exactly**, with no case folding and no trimming.
 * Both sides originate from the same parsed Notification_Record — the shell marks
 * read the record a person activated — so the letter case the parser retained is
 * the letter case on both sides of the comparison, and folding here would only
 * risk marking a different record read.
 *
 * Both functions are **total**: every input yields a view whose `unreadCount` is
 * a non-negative integer and whose `records` is an array, and no input raises an
 * exception. In production `unreadCount` has already passed
 * `parseNonNegativeInteger`, so it is an integer from 0 to 2,147,483,647 and the
 * fold below is the identity; the fold exists so that no value can produce a
 * displayed count of `-1`, `5.5`, or `NaN`. For such an out-of-range input the
 * floor of Requirement 6.10 is honoured ahead of the metamorphic bound of
 * Requirement 14.7 — a supplied count of `-5` yields 0, which is not below the
 * input — because 14.7 quantifies over Unread_Counts, which are non-negative by
 * construction, and for every one of those the two agree.
 *
 * This module is React-free and DOM-free like every module under `lib/`, and
 * imports only the record type it transitions — in particular not
 * `@pitchmate/api-client` (Requirements 14.16, 15.5).
 *
 * Requirements: 6.3, 6.5, 6.10, 14.5, 14.6, 14.7
 */

import type { NotificationRecord } from './notificationParsing';

/**
 * The pair of displayed values a Read_State transition rewrites: the displayed
 * Notification_List and the displayed Unread_Count (Requirement 6.10).
 *
 * The two travel together because a transition can never change one without
 * considering the other.
 */
export interface ReadStateView {
  /** The displayed Notification_List, in display order. */
  readonly records: readonly NotificationRecord[];
  /** The displayed Unread_Count: a whole number, never below 0. */
  readonly unreadCount: number;
}

/**
 * The lowest Unread_Count a transition can produce (Requirements 6.10, 14.7).
 */
const UNREAD_COUNT_FLOOR = 0;

/**
 * Apply the mark-read transition for one notification identity.
 *
 * A no-op — both values returned as supplied — when the identity names no
 * displayed Notification_Record or names one whose Read_State is already `read`
 * (Requirement 6.3), which is also how a caller learns there is no backend call
 * to issue.
 *
 * Idempotent: applying this to its own result yields that result again
 * (Requirement 14.5). The resulting Unread_Count is never above the supplied
 * count and never more than 1 below it, and never below 0 (Requirements 6.10,
 * 14.7).
 *
 * @param view the displayed Notification_List and Unread_Count before the
 *   transition, left untouched
 * @param notificationId the identity of the Notification_Record to mark read,
 *   compared exactly
 * @returns a new view holding the Notification_List and Unread_Count after the
 *   transition
 *
 * Requirements: 6.3, 6.10, 14.5, 14.7
 */
export function applyMarkRead(
  view: ReadStateView,
  notificationId: string,
): ReadStateView {
  const records = suppliedRecords(view);
  const unreadCount = displayedUnreadCount(view);

  // 6.3: an identity that is not a usable string names no displayed record, so
  // there is nothing to mark and nothing to decrement.
  if (typeof notificationId !== 'string' || notificationId.length === 0) {
    return { records, unreadCount };
  }

  let marked = false;

  const next = records.map((record) => {
    // Identity is unique per Notification_Record, so at most one element matches;
    // mapping over all of them rather than stopping at the first keeps the
    // postcondition "no displayed record with this identity is unread" true even
    // if the same record were somehow displayed twice.
    if (!isUnreadWithIdentity(record, notificationId)) {
      return record;
    }

    marked = true;

    // 10.6: every other value is carried across untouched — the unrecognised type
    // marker's integer code and the untruncated title and body included. A new
    // object, so the supplied record is not edited (Requirement 6.6 relies on it).
    return { ...record, readState: 'read' } satisfies NotificationRecord;
  });

  // 6.3, 14.5: nothing was unread under that identity — already read, or not
  // displayed at all — so both values stand, and the records array is handed back
  // by reference rather than as an equal copy.
  if (!marked) {
    return { records, unreadCount };
  }

  // 6.10, 14.7: exactly one off the count however many records were rewritten,
  // floored at 0 so a count already at 0 alongside an unread record cannot go
  // negative.
  return {
    records: next,
    unreadCount: Math.max(UNREAD_COUNT_FLOOR, unreadCount - 1),
  };
}

/**
 * Apply the mark-all-read transition.
 *
 * Every displayed Notification_Record's Read_State becomes `read` and the
 * Unread_Count becomes 0 — unconditionally, irrespective of the count supplied
 * and of unread Notification_Records within the active Squad_Scope that the
 * capped Notification_List does not display (Requirements 6.5, 14.6).
 *
 * Idempotent, since its result is already a fully read list with a count of 0.
 *
 * @param view the displayed Notification_List and Unread_Count before the
 *   transition, left untouched
 * @returns a new view whose every Read_State is `read` and whose Unread_Count is 0
 *
 * Requirements: 6.5, 14.6
 */
export function applyMarkAllRead(view: ReadStateView): ReadStateView {
  const records = suppliedRecords(view);

  let marked = false;

  const next = records.map((record) => {
    if (record?.readState === 'read') {
      return record;
    }

    marked = true;

    return { ...record, readState: 'read' } satisfies NotificationRecord;
  });

  // 6.5: the count is 0 either way. Only the records array is reused when every
  // record was already read, so an already-read list re-renders nothing.
  return { records: marked ? next : records, unreadCount: UNREAD_COUNT_FLOOR };
}

/**
 * Whether a displayed record carries the supplied identity and is still unread —
 * the one case a mark-read transition acts on (Requirements 6.1, 6.3).
 *
 * Reads through optional chaining so that a records array holding a value that is
 * not a Notification_Record costs that element a match rather than raising.
 */
function isUnreadWithIdentity(
  record: NotificationRecord,
  notificationId: string,
): boolean {
  return record?.notificationId === notificationId && record?.readState === 'unread';
}

/**
 * The supplied Notification_List, by reference, or an empty list when the view
 * carries no array — so that every result's `records` is an array and the
 * transitions stay total.
 */
function suppliedRecords(view: ReadStateView): readonly NotificationRecord[] {
  const records = view?.records;

  return Array.isArray(records) ? records : [];
}

/**
 * The supplied Unread_Count read as the whole number of unread
 * Notification_Records, so that no transition can carry a fraction, a negative
 * value, or `NaN` into a displayed count (Requirement 6.10).
 *
 * The fold is the identity for every value an accepted unread-count response
 * produces: an integer from 0 to 2,147,483,647.
 */
function displayedUnreadCount(view: ReadStateView): number {
  const count = view?.unreadCount;

  // `NaN`, `Infinity`, and `-Infinity` are no count at all. This runs before the
  // floor comparison because `NaN` compares false against it and would otherwise
  // pass through as `NaN`.
  if (typeof count !== 'number' || !Number.isFinite(count)) {
    return UNREAD_COUNT_FLOOR;
  }

  // A count below the floor is no unread record. This also normalises `-0` to `0`.
  if (count < UNREAD_COUNT_FLOOR) {
    return UNREAD_COUNT_FLOOR;
  }

  // A fraction reads as the whole count it has passed: `0.5` is not yet one
  // unread record, and `5.5` is five.
  return Math.trunc(count);
}
