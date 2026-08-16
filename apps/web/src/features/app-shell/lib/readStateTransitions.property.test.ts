import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  applyMarkAllRead,
  applyMarkRead,
  type ReadStateView,
} from './readStateTransitions';
import type {
  NotificationRecord,
  NotificationType,
  ReadState,
} from './notificationParsing';

/**
 * Property tests for the App_Shell's single pure Read_State transitions, beside
 * the module they cover as Requirement 14.2 asks, at well above the
 * 100-iteration floor.
 *
 * This file carries **Property 13: The mark-read transition is idempotent and
 * bounds the count**, in the blocks below:
 *
 *  - *idempotence* — applying the mark-read transition twice for one identity
 *    yields the same Notification_List and Unread_Count as applying it once
 *    (Requirement 14.5). This is what stops an impatient second activation of
 *    one row, or a re-render that replays the transition, from taking a second
 *    unread record off the count.
 *  - *the no-op cases* — an identity whose Notification_Record is already `read`,
 *    and an identity absent from the displayed Notification_List, leave both
 *    displayed values alone (Requirement 6.3).
 *  - *the count bound* — the resulting Unread_Count is never above the count
 *    before the transition, never more than 1 below it, and never below 0
 *    (Requirements 6.10, 14.7), including the reachable case of a supplied count
 *    of 0 sitting alongside an unread record.
 *  - *non-mutation* — the supplied view, its records array, and every record in
 *    it are left exactly as they were, so a caller may hold the pre-transition
 *    view as its rollback value (Requirement 6.6).
 *  - *totality* — every input yields a view whose `unreadCount` is a
 *    non-negative integer and whose `records` is an array, and raises nothing.
 *
 * A last block covers the **idempotence of the mark-all-read transition**, which
 * the same displayed pair travels through. Its invariant — a count of 0 and a
 * fully read list — belongs to Property 14 and is asserted there; what is needed
 * here is that a repeated application is a no-op on the same pair.
 *
 * Expectations are re-derived from the acceptance criteria — "set that
 * Notification_Record's displayed Read_State to `read`", "reduce the displayed
 * Unread_Count by 1 while the displayed Unread_Count is 1 or greater", "leave the
 * displayed Read_State and the displayed Unread_Count unchanged" — rather than
 * read off the module's branches, so a change of implementation cannot drag the
 * expectation along with it.
 *
 * Generators deliberately correlate the Unread_Count with the displayed records
 * most of the time and deliberately break that correlation the rest of the time:
 * the count is account-wide or squad-wide while the list is capped at 200, so a
 * count lower than the number of displayed unread records — 0 among them — is a
 * production input, not a corner case.
 *
 * Validates: Requirements 6.3, 6.10, 14.5, 14.7
 */

/** The largest Unread_Count an accepted count response can carry (`int32` max). */
const MAX_COUNT = 2_147_483_647;

// --- expectations read from the acceptance criteria ---------------------------

/**
 * Whether the identity names a displayed Notification_Record whose Read_State is
 * `unread` — the one case Requirement 6.1 acts on, and the complement of the two
 * no-op cases of Requirement 6.3.
 */
function namesAnUnreadRecord(
  view: ReadStateView,
  notificationId: string,
): boolean {
  return view.records.some(
    (record) =>
      record.notificationId === notificationId && record.readState === 'unread',
  );
}

/**
 * The Notification_List Requirement 6.1 asks for: that Notification_Record's
 * Read_State becomes `read`, every other value and every other record untouched.
 */
function expectedRecords(
  view: ReadStateView,
  notificationId: string,
): NotificationRecord[] {
  return view.records.map((record) =>
    record.notificationId === notificationId && record.readState === 'unread'
      ? { ...record, readState: 'read' }
      : record,
  );
}

/**
 * The Unread_Count Requirement 6.1 asks for: one lower while the displayed count
 * is 1 or greater, and unchanged otherwise — which is also Requirement 6.3's
 * "unchanged" when the identity names nothing unread.
 *
 * Written for the counts the criteria speak about: whole numbers of 0 or above.
 */
function expectedCount(view: ReadStateView, notificationId: string): number {
  if (!namesAnUnreadRecord(view, notificationId) || view.unreadCount < 1) {
    return view.unreadCount;
  }

  return view.unreadCount - 1;
}

/** Asserts two views hold structurally equal lists and equal counts. */
function expectSameView(actual: ReadStateView, expected: ReadStateView): void {
  expect(actual.records).toEqual(expected.records);
  expect(actual.unreadCount).toBe(expected.unreadCount);
}

/** The number of displayed Notification_Records whose Read_State is `unread`. */
function displayedUnread(records: readonly NotificationRecord[]): number {
  return records.filter((record) => record.readState === 'unread').length;
}

// --- generators --------------------------------------------------------------

const hexDigitArb = fc.constantFrom(...'0123456789abcdef'.split(''));

const hexRun = (length: number): fc.Arbitrary<string> =>
  fc.string({ unit: hexDigitArb, minLength: length, maxLength: length });

/**
 * A 36-character hyphenated identity, in lower, upper, or mixed case. Case is
 * generated because identities are compared as raw strings on both sides — both
 * originate from the same parsed Notification_Record — so a fold would risk
 * marking a different record read.
 */
const identityArb: fc.Arbitrary<string> = fc
  .tuple(
    hexRun(8),
    hexRun(4),
    hexRun(4),
    hexRun(4),
    hexRun(12),
    fc.constantFrom('lower' as const, 'upper' as const, 'mixed' as const),
  )
  .map(([a, b, c, d, e, letterCase]) => {
    const identity = `${a}-${b}-${c}-${d}-${e}`;

    if (letterCase === 'upper') {
      return identity.toUpperCase();
    }

    if (letterCase === 'lower') {
      return identity;
    }

    return identity
      .split('')
      .map((character, index) =>
        index % 2 === 0 ? character.toUpperCase() : character.toLowerCase(),
      )
      .join('');
  });

const typeArb: fc.Arbitrary<NotificationType> = fc.oneof(
  fc
    .constantFrom(
      'member-joined' as const,
      'promoted-to-admin' as const,
      'removed-from-squad' as const,
      'ownership-transferred' as const,
      'match-drafted' as const,
      'match-confirmed' as const,
      'teams-rolled' as const,
      'result-posted' as const,
    )
    .map((value) => ({ kind: 'catalogued', value }) as const),
  fc
    .integer({ min: 8, max: 64 })
    .map((code) => ({ kind: 'unrecognised', code }) as const),
);

const readStateArb: fc.Arbitrary<ReadState> = fc.constantFrom(
  'unread' as const,
  'read' as const,
);

/**
 * A Notification_Record. Every non-`readState` value is generated so that a
 * transition rewriting one of them — or dropping the integer code of an
 * unrecognised type marker (Requirement 10.6) — is caught rather than hidden by
 * fixtures that happen to agree.
 */
const recordArb: fc.Arbitrary<NotificationRecord> = fc.record({
  notificationId: identityArb,
  type: typeArb,
  squadId: identityArb,
  title: fc.string({ minLength: 1, maxLength: 24 }),
  body: fc.string({ minLength: 0, maxLength: 24 }),
  createdAtMs: fc.integer({ min: 0, max: 1_800_000_000_000 }),
  readState: readStateArb,
});

/**
 * A displayed Notification_List with **distinct identities**, since a
 * notification identity is unique per Notification_Record.
 */
const recordsArb = (minLength: number, maxLength: number) =>
  fc.uniqueArray(recordArb, {
    minLength,
    maxLength,
    selector: (record) => record.notificationId,
  });

/**
 * A displayed Unread_Count for a given list. Usually the number of unread
 * records actually displayed, because that is the coherent case; often 0 or some
 * other value, because the count is account-wide or squad-wide while the list is
 * capped, so the two legitimately disagree.
 */
const countForArb = (
  records: readonly NotificationRecord[],
): fc.Arbitrary<number> => {
  const unread = displayedUnread(records);

  return fc.oneof(
    { weight: 4, arbitrary: fc.constant(unread) },
    { weight: 3, arbitrary: fc.constantFrom(0, 1, unread + 1, MAX_COUNT) },
    { weight: 2, arbitrary: fc.integer({ min: 0, max: 500 }) },
    { weight: 1, arbitrary: fc.integer({ min: 0, max: MAX_COUNT }) },
  );
};

/** A well-formed displayed pair: a Notification_List and its Unread_Count. */
const viewArb = (
  minLength = 0,
  maxLength = 12,
): fc.Arbitrary<ReadStateView> =>
  recordsArb(minLength, maxLength).chain((records) =>
    countForArb(records).map((unreadCount) => ({ records, unreadCount })),
  );

/**
 * A displayed pair together with an identity to mark read. The identity is
 * usually one of the displayed records — the case that does something — and
 * otherwise an identity the list does not carry, which is the second no-op case
 * of Requirement 6.3.
 */
const viewAndIdentityArb = (
  minLength = 0,
  maxLength = 12,
): fc.Arbitrary<{ view: ReadStateView; notificationId: string }> =>
  viewArb(minLength, maxLength).chain((view) => {
    const displayed = view.records.map((record) => record.notificationId);
    const absent: fc.Arbitrary<string> = fc.oneof(
      { weight: 3, arbitrary: identityArb },
      { weight: 1, arbitrary: fc.constantFrom('', ' ', 'not-an-identity') },
    );

    const identity =
      displayed.length === 0
        ? absent
        : fc.oneof(
            { weight: 6, arbitrary: fc.constantFrom(...displayed) },
            { weight: 4, arbitrary: absent },
          );

    return identity.map((notificationId) => ({ view, notificationId }));
  });

/** A list holding at least one unread Notification_Record, and its identity. */
const unreadTargetArb = (
  maxLength = 12,
): fc.Arbitrary<{ view: ReadStateView; notificationId: string }> =>
  recordsArb(1, maxLength)
    .filter((records) => displayedUnread(records) > 0)
    .chain((records) =>
      fc
        .tuple(
          countForArb(records),
          fc.constantFrom(
            ...records
              .filter((record) => record.readState === 'unread')
              .map((record) => record.notificationId),
          ),
        )
        .map(([unreadCount, notificationId]) => ({
          view: { records, unreadCount },
          notificationId,
        })),
    );

/** A list every one of whose Notification_Records is already `read`. */
const allReadViewArb: fc.Arbitrary<ReadStateView> = recordsArb(1, 12)
  .map((records) =>
    records.map((record) => ({ ...record, readState: 'read' as const })),
  )
  .chain((records) =>
    countForArb(records).map((unreadCount) => ({ records, unreadCount })),
  );

/** Freezes a view, its records array, and every record in it. */
function deepFreeze(view: ReadStateView): ReadStateView {
  view.records.forEach((record) => {
    Object.freeze(record);
  });
  Object.freeze(view.records);

  return Object.freeze(view);
}

/** A structural snapshot a call must leave intact (Requirement 6.6). */
function snapshot(view: ReadStateView): unknown {
  return JSON.parse(JSON.stringify(view)) as unknown;
}

// Feature: app-shell, Property 13: the mark-read transition is idempotent
// Validates: Requirements 14.5, 6.3
describe('applyMarkRead — applying the transition twice equals applying it once', () => {
  it('yields the same list and count from a second application for any view and identity', () => {
    fc.assert(
      fc.property(viewAndIdentityArb(0, 12), ({ view, notificationId }) => {
        const once = applyMarkRead(view, notificationId);
        const twice = applyMarkRead(once, notificationId);

        // Requirement 14.5: the Read_State itself carries the "already counted"
        // fact, so a replayed transition cannot take a second unread record off
        // the count.
        expectSameView(twice, once);
      }),
      { numRuns: 500 },
    );
  });

  it('stays at that result however many times the transition is replayed', () => {
    fc.assert(
      fc.property(
        unreadTargetArb(10),
        fc.integer({ min: 2, max: 6 }),
        ({ view, notificationId }, applications) => {
          const once = applyMarkRead(view, notificationId);

          let current = once;

          for (let index = 1; index < applications; index += 1) {
            current = applyMarkRead(current, notificationId);
          }

          // An impatient person clicking one row repeatedly: the count settles
          // one lower, not one lower per activation.
          expectSameView(current, once);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('marks an unread record read and leaves nothing under that identity unread', () => {
    fc.assert(
      fc.property(unreadTargetArb(12), ({ view, notificationId }) => {
        const result = applyMarkRead(view, notificationId);

        // Requirement 6.1: that Notification_Record's displayed Read_State
        // becomes `read`; expected from the criterion, not from the branch.
        expectSameView(result, {
          records: expectedRecords(view, notificationId),
          unreadCount: expectedCount(view, notificationId),
        });

        for (const record of result.records) {
          if (record.notificationId === notificationId) {
            expect(record.readState).toBe('read');
          }
        }
      }),
      { numRuns: 500 },
    );
  });

  it('leaves every other displayed record exactly as it was', () => {
    fc.assert(
      fc.property(unreadTargetArb(12), ({ view, notificationId }) => {
        const result = applyMarkRead(view, notificationId);

        expect(result.records).toHaveLength(view.records.length);

        for (let index = 0; index < view.records.length; index += 1) {
          const before = view.records[index];
          const after = result.records[index];

          expect(after.notificationId).toBe(before.notificationId);

          if (before.notificationId === notificationId) {
            // Only `readState` is rewritten — the unrecognised type marker's
            // integer code and the untruncated title and body are carried across
            // (Requirement 10.6).
            expect(after).toEqual({ ...before, readState: 'read' });
          } else {
            expect(after).toEqual(before);
          }
        }
      }),
      { numRuns: 500 },
    );
  });
});

// Feature: app-shell, Property 13: an already-read or absent identity changes
// neither the list nor the count
// Validates: Requirement 6.3
describe('applyMarkRead — the no-op cases', () => {
  it('changes neither value for an identity whose record is already read', () => {
    fc.assert(
      fc.property(
        allReadViewArb.chain((view) =>
          fc
            .constantFrom(...view.records.map((record) => record.notificationId))
            .map((notificationId) => ({ view, notificationId })),
        ),
        ({ view, notificationId }) => {
          // Requirement 6.3: both displayed values stand, which is also how the
          // caller learns there is no backend call to issue.
          expectSameView(applyMarkRead(view, notificationId), view);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('changes neither value for an identity the list does not display', () => {
    fc.assert(
      fc.property(viewArb(0, 12), identityArb, (view, notificationId) => {
        fc.pre(
          view.records.every(
            (record) => record.notificationId !== notificationId,
          ),
        );

        expectSameView(applyMarkRead(view, notificationId), view);
      }),
      { numRuns: 400 },
    );
  });

  it('treats an identity differing only in letter case as one the list does not display', () => {
    fc.assert(
      fc.property(unreadTargetArb(10), ({ view, notificationId }) => {
        const variant =
          notificationId === notificationId.toUpperCase()
            ? notificationId.toLowerCase()
            : notificationId.toUpperCase();

        fc.pre(
          view.records.every((record) => record.notificationId !== variant),
        );

        // Both sides of the comparison come from the same parsed
        // Notification_Record, so folding case here could only mark a different
        // record read.
        expectSameView(applyMarkRead(view, variant), view);
      }),
      { numRuns: 400 },
    );
  });

  it('changes neither value for an empty list, whatever identity arrives', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MAX_COUNT }),
        identityArb,
        (unreadCount, notificationId) => {
          const result = applyMarkRead({ records: [], unreadCount }, notificationId);

          // An Unread_Count with nothing displayed is ordinary — the count is
          // account-wide while the panel may be showing nothing yet.
          expect(result.records).toEqual([]);
          expect(result.unreadCount).toBe(unreadCount);
        },
      ),
      { numRuns: 300 },
    );
  });
});

// Feature: app-shell, Property 13: the transition bounds the Unread_Count
// Validates: Requirements 6.10, 14.7
describe('applyMarkRead — the resulting count is bounded', () => {
  it('is never above the supplied count, never more than 1 below it, and never below 0', () => {
    fc.assert(
      fc.property(viewAndIdentityArb(0, 12), ({ view, notificationId }) => {
        const { unreadCount } = applyMarkRead(view, notificationId);

        // Requirement 14.7's metamorphic bound, stated as the two inequalities
        // the criterion gives, plus Requirement 6.10's floor.
        expect(unreadCount).toBeLessThanOrEqual(view.unreadCount);
        expect(unreadCount).toBeGreaterThanOrEqual(view.unreadCount - 1);
        expect(unreadCount).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(unreadCount)).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it('takes exactly 1 off the count when the identity names an unread record and the count is 1 or greater', () => {
    fc.assert(
      fc.property(unreadTargetArb(12), ({ view, notificationId }) => {
        fc.pre(view.unreadCount >= 1);

        // Requirement 6.1: reduced by 1 — not by the number of records rewritten,
        // and not recomputed from the displayed list, which is only a capped
        // window on the Squad_Scope.
        expect(applyMarkRead(view, notificationId).unreadCount).toBe(
          view.unreadCount - 1,
        );
      }),
      { numRuns: 500 },
    );
  });

  it('holds a supplied count of 0 at 0 while still marking the unread record read', () => {
    fc.assert(
      fc.property(unreadTargetArb(12), ({ view, notificationId }) => {
        const zeroCount: ReadStateView = { records: view.records, unreadCount: 0 };
        const result = applyMarkRead(zeroCount, notificationId);

        // Reachable whenever the backend's count arrives lower than the list:
        // the count is account-wide or squad-wide while the list is capped at
        // 200. Requirement 6.10's floor is what keeps this from reading `-1`.
        expect(result.unreadCount).toBe(0);
        expect(
          result.records.find(
            (record) => record.notificationId === notificationId,
          )?.readState,
        ).toBe('read');
      }),
      { numRuns: 500 },
    );
  });

  it('reaches 0 and stops there when the transition is applied across every displayed identity', () => {
    fc.assert(
      fc.property(viewArb(1, 12), (view) => {
        // Marking every displayed record read, one activation at a time: the
        // count walks down by at most 1 a step and can never cross 0, however
        // far the supplied count sat below the number of unread records.
        let current = view;

        for (const record of view.records) {
          const previous = current.unreadCount;

          current = applyMarkRead(current, record.notificationId);

          expect(current.unreadCount).toBeLessThanOrEqual(previous);
          expect(current.unreadCount).toBeGreaterThanOrEqual(previous - 1);
          expect(current.unreadCount).toBeGreaterThanOrEqual(0);
        }

        expect(
          current.records.every((record) => record.readState === 'read'),
        ).toBe(true);
        expect(current.unreadCount).toBe(
          Math.max(0, view.unreadCount - displayedUnread(view.records)),
        );
      }),
      { numRuns: 400 },
    );
  });
});

// Feature: app-shell, Property 13: the transition leaves the supplied view
// untouched, so it can serve as the rollback value
// Validates: Requirements 6.3, 14.5
describe('applyMarkRead — the supplied view is left as the rollback snapshot', () => {
  it('leaves the supplied view, its array, and every record exactly as they were', () => {
    fc.assert(
      fc.property(viewAndIdentityArb(0, 12), ({ view, notificationId }) => {
        const before = snapshot(view);
        const suppliedRecords = view.records;

        applyMarkRead(view, notificationId);

        // Requirement 6.6 relies on this: a caller holds the pre-transition view
        // and restores it if the backend call fails, so the transition must not
        // have edited it underneath.
        expect(snapshot(view)).toEqual(before);
        expect(view.records).toBe(suppliedRecords);
      }),
      { numRuns: 600 },
    );
  });

  it('transitions a frozen view, since nothing is written back', () => {
    fc.assert(
      fc.property(viewAndIdentityArb(0, 12), ({ view, notificationId }) => {
        const frozen = deepFreeze({
          records: view.records.map((record) => ({ ...record })),
          unreadCount: view.unreadCount,
        });
        const before = snapshot(frozen);

        // An in-place rewrite of a record's `readState` would raise on a frozen
        // record under module strict mode; this passes only because the
        // transition builds new objects.
        const result = applyMarkRead(frozen, notificationId);

        expect(snapshot(frozen)).toEqual(before);
        expectSameView(result, {
          records: expectedRecords(frozen, notificationId),
          unreadCount: expectedCount(frozen, notificationId),
        });
      }),
      { numRuns: 400 },
    );
  });

  it('is deterministic: the same view and identity always give the same result', () => {
    fc.assert(
      fc.property(viewAndIdentityArb(0, 12), ({ view, notificationId }) => {
        expectSameView(
          applyMarkRead(view, notificationId),
          applyMarkRead(view, notificationId),
        );
      }),
      { numRuns: 400 },
    );
  });
});

// Feature: app-shell, Property 13: the transition is total
// Validates: Requirements 6.10, 14.7
describe('applyMarkRead — every input yields a displayable pair and raises nothing', () => {
  it('yields an array list and a non-negative integer count for any input at all', () => {
    fc.assert(
      fc.property(fc.anything(), fc.anything(), (view, notificationId) => {
        const call = () =>
          applyMarkRead(view as ReadStateView, notificationId as string);

        expect(call).not.toThrow();

        const result = call();

        // No input can produce a displayed count of `-1`, `5.5`, or `NaN`, and
        // no input can leave a component with a non-array to render.
        expect(Array.isArray(result.records)).toBe(true);
        expect(Number.isInteger(result.unreadCount)).toBe(true);
        expect(result.unreadCount).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 1000 },
    );
  });

  it('folds a count no accepted response can carry to a displayable whole count', () => {
    fc.assert(
      fc.property(
        recordsArb(0, 6),
        fc.oneof(
          fc.constantFrom(
            Number.NaN,
            Number.POSITIVE_INFINITY,
            Number.NEGATIVE_INFINITY,
            -1,
            -5,
            -MAX_COUNT,
            0.5,
            5.5,
            99.999,
          ),
          fc.double(),
        ),
        identityArb,
        (records, unreadCount, notificationId) => {
          const result = applyMarkRead(
            { records, unreadCount },
            notificationId,
          );

          // Requirement 6.10's floor is honoured ahead of Requirement 14.7's
          // bound for such a value: a supplied count of `-5` yields 0, which is
          // not below the input. 14.7 quantifies over Unread_Counts, which are
          // non-negative by construction.
          expect(Number.isInteger(result.unreadCount)).toBe(true);
          expect(result.unreadCount).toBeGreaterThanOrEqual(0);
          expect(result.unreadCount).toBeLessThanOrEqual(
            Number.isFinite(unreadCount) ? Math.max(0, unreadCount) : 0,
          );
        },
      ),
      { numRuns: 500 },
    );
  });

  it('names no record with an identity that is absent, empty, or not a string', () => {
    fc.assert(
      fc.property(
        viewArb(0, 8),
        fc.oneof(
          fc.constantFrom('', undefined, null, 42, true),
          fc.anything(),
        ),
        (view, notificationId) => {
          const result = applyMarkRead(view, notificationId as string);

          // An identity that is not a usable string names no displayed record,
          // so Requirement 6.3's no-op applies.
          expect(result.records).toEqual(view.records);
          expect(result.unreadCount).toBe(view.unreadCount);
        },
      ),
      { numRuns: 500 },
    );
  });
});

// Feature: app-shell, Property 13: the mark-all-read transition is idempotent on
// the same displayed pair
// Validates: Requirements 14.5, 14.6
describe('applyMarkAllRead — applying the transition twice equals applying it once', () => {
  it('yields the same list and count from a second application for any view', () => {
    fc.assert(
      fc.property(viewArb(0, 12), (view) => {
        const once = applyMarkAllRead(view);

        expectSameView(applyMarkAllRead(once), once);
      }),
      { numRuns: 500 },
    );
  });

  it('changes neither value for a list whose every record is already read and whose count is 0', () => {
    fc.assert(
      fc.property(
        allReadViewArb.map(
          (view): ReadStateView => ({ records: view.records, unreadCount: 0 }),
        ),
        (view) => {
          // Its own result is a fixed point: nothing left to mark, nothing left
          // to decrement.
          expectSameView(applyMarkAllRead(view), view);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('leaves the supplied view intact so it can serve as the rollback value', () => {
    fc.assert(
      fc.property(viewArb(0, 12), (view) => {
        const before = snapshot(view);
        const suppliedRecords = view.records;

        applyMarkAllRead(view);

        expect(snapshot(view)).toEqual(before);
        expect(view.records).toBe(suppliedRecords);
      }),
      { numRuns: 400 },
    );
  });

  it('yields an array list and a non-negative integer count for any input at all', () => {
    fc.assert(
      fc.property(fc.anything(), (view) => {
        const call = () => applyMarkAllRead(view as ReadStateView);

        expect(call).not.toThrow();

        const result = call();

        expect(Array.isArray(result.records)).toBe(true);
        expect(Number.isInteger(result.unreadCount)).toBe(true);
        expect(result.unreadCount).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 500 },
    );
  });

  it('is unaffected by a mark-read applied first, and vice versa', () => {
    fc.assert(
      fc.property(viewAndIdentityArb(0, 12), ({ view, notificationId }) => {
        const afterMarkRead = applyMarkAllRead(
          applyMarkRead(view, notificationId),
        );
        const straight = applyMarkAllRead(view);

        // A mark-read that landed before a mark-all-read cannot change where the
        // pair ends up: every record read, count 0.
        expectSameView(afterMarkRead, straight);
        expect(
          applyMarkRead(straight, notificationId).unreadCount,
        ).toBe(straight.unreadCount);
      }),
      { numRuns: 400 },
    );
  });
});
