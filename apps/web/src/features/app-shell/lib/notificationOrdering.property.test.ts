import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  NOTIFICATION_LIST_CAP,
  NOTIFICATION_PANEL_PREVIEW_CAP,
  orderNotifications,
  panelPreviewNotifications,
} from './notificationOrdering';
import type {
  NotificationRecord,
  NotificationType,
  ReadState,
} from './notificationParsing';

/**
 * Property tests for the App_Shell's single pure Notification_List ordering and
 * its display caps (Requirements 5.4, 5.12, 14.3, 14.4), beside the module they
 * cover as Requirement 14.2 asks, at well over the 100-iteration floor.
 *
 * This file carries two properties, in the two halves below:
 *
 *  - **Property 11: Ordering is a total order independent of supplied order**
 *    (Requirements 5.4, 14.3).
 *  - **Property 12: Ordering and display caps neither add, drop, nor duplicate
 *    records** (Requirements 5.4, 5.12, 14.4).
 *
 * Property 11's claim has two halves, and both are needed:
 *
 *  - The result is *sorted*: creation instant descending, ties broken by
 *    notification identity descending (Requirement 5.4). Asserted twice over —
 *    adjacent pairs are non-increasing under the key, and the whole sequence
 *    equals an independent oracle sort written from the acceptance criterion
 *    rather than from the implementation.
 *  - The result is *independent of the supplied order* (Requirement 14.3). A
 *    "sorted" check alone cannot catch this, because a comparison that returned 0
 *    for same-instant records would still produce a non-increasing sequence while
 *    letting two permutations of the same records render differently. So every
 *    property below is driven through **permutations of one collection** and the
 *    ordered results are required to be equal element-for-element.
 *
 * Independence is exactly why the identity tie-break exists, so the generators
 * deliberately draw creation instants from a small pool: ties are the common
 * case here, not the corner. Identities are kept **distinct** across a
 * collection, matching the module's own note that an equal (instant, identity)
 * pair can only arise from the same record being supplied twice.
 *
 * Records are compared **by reference** throughout — ordering is a rearrangement,
 * so the ordered list must hold the very objects supplied.
 */

// --- the oracle --------------------------------------------------------------

/**
 * The ordering key of Requirement 5.4, read independently of the module: the
 * creation instant, then the notification identity.
 */
function orderingKey(record: NotificationRecord): [number, string] {
  return [record.createdAtMs, record.notificationId];
}

/**
 * The comparison of Requirement 5.4 written from the acceptance criterion:
 * creation instant descending, ties broken by notification identity descending.
 *
 * Identities are compared as raw UTF-16 strings — the same unit the criterion's
 * "descending" is expressed in — deliberately *not* through `localeCompare`,
 * which would reorder letter case and digits by locale.
 */
function compareOracle(left: NotificationRecord, right: NotificationRecord): number {
  const [leftInstant, leftIdentity] = orderingKey(left);
  const [rightInstant, rightIdentity] = orderingKey(right);

  if (leftInstant !== rightInstant) {
    return leftInstant > rightInstant ? -1 : 1;
  }

  if (leftIdentity === rightIdentity) {
    return 0;
  }

  return leftIdentity > rightIdentity ? -1 : 1;
}

/** The expected ordered list: the oracle sort of a copy, then the display cap. */
function expectedOrdering(records: readonly NotificationRecord[]): NotificationRecord[] {
  return records.slice().sort(compareOracle).slice(0, NOTIFICATION_LIST_CAP);
}

/** Asserts two lists hold the same record objects in the same order. */
function expectSameSequence(
  actual: readonly NotificationRecord[],
  expected: readonly NotificationRecord[],
): void {
  expect(actual).toHaveLength(expected.length);

  for (let index = 0; index < expected.length; index += 1) {
    expect(actual[index]).toBe(expected[index]);
  }
}

// --- generators --------------------------------------------------------------

const hexDigitArb = fc.constantFrom(...'0123456789abcdef'.split(''));

const hexRun = (length: number): fc.Arbitrary<string> =>
  fc.string({ unit: hexDigitArb, minLength: length, maxLength: length });

/**
 * A 36-character hyphenated identity, in lower, upper, or mixed case. Case is
 * generated because identities are compared as raw strings, so upper-case
 * identities sort ahead of lower-case ones — a real, observable part of the
 * ordering the parser's case retention feeds into.
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

/**
 * A small pool of creation instants, so same-instant records — the case the
 * identity tie-break exists for — turn up constantly rather than by luck. The
 * pool spans the negative side of the epoch and the ends of the representable
 * range as well as plausible "now" values.
 */
const TIE_INSTANTS = [
  -8_640_000_000_000_000,
  -1,
  0,
  1,
  1_700_000_000_000,
  1_700_000_000_001,
  1_760_000_000_000,
  8_640_000_000_000_000,
];

const instantArb: fc.Arbitrary<number> = fc.oneof(
  // Weighted towards the pool: ties are the interesting input here.
  { weight: 5, arbitrary: fc.constantFrom(...TIE_INSTANTS) },
  {
    weight: 2,
    arbitrary: fc.integer({ min: 1_700_000_000_000, max: 1_700_000_000_010 }),
  },
  {
    weight: 1,
    arbitrary: fc.integer({ min: -8_640_000_000_000_000, max: 8_640_000_000_000_000 }),
  },
);

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
 * A Notification_Record. The non-key fields are generated too, so a comparison
 * that leaned on title, body, type, or read state would be caught rather than
 * accidentally agreeing with the key.
 */
const recordArb: fc.Arbitrary<NotificationRecord> = fc.record({
  notificationId: identityArb,
  type: typeArb,
  squadId: identityArb,
  title: fc.string({ minLength: 1, maxLength: 24 }),
  body: fc.string({ minLength: 0, maxLength: 24 }),
  createdAtMs: instantArb,
  readState: readStateArb,
});

/**
 * A collection of records with **distinct identities**, so the ordering key is
 * unique per record and the comparison is a strict total order on the collection
 * — the module's own stated precondition for a supplied-order-independent result.
 */
const recordsArb = (minLength: number, maxLength: number) =>
  fc.uniqueArray(recordArb, {
    minLength,
    maxLength,
    selector: (record) => record.notificationId,
  });

/**
 * One collection plus two independent permutations of it. Every property is
 * driven from this: the two orderings must agree with each other and with the
 * oracle, which is Requirement 14.3 stated as a test.
 */
const permutationsArb = (
  minLength: number,
  maxLength: number,
): fc.Arbitrary<{
  supplied: NotificationRecord[];
  firstShuffle: NotificationRecord[];
  secondShuffle: NotificationRecord[];
}> =>
  recordsArb(minLength, maxLength).chain((supplied) =>
    fc.record({
      supplied: fc.constant(supplied),
      firstShuffle: fc.shuffledSubarray(supplied, {
        minLength: supplied.length,
        maxLength: supplied.length,
      }),
      secondShuffle: fc.shuffledSubarray(supplied, {
        minLength: supplied.length,
        maxLength: supplied.length,
      }),
    }),
  );

// Feature: app-shell, Property 11: ordering is a total order independent of
// supplied order
// Validates: Requirements 5.4, 14.3
describe('orderNotifications — the result is sorted newest first, ties by identity', () => {
  it('yields a sequence non-increasing by creation instant, then by identity', () => {
    fc.assert(
      fc.property(recordsArb(0, 60), (records) => {
        const ordered = orderNotifications(records);

        for (let index = 1; index < ordered.length; index += 1) {
          const [previousInstant, previousIdentity] = orderingKey(ordered[index - 1]);
          const [currentInstant, currentIdentity] = orderingKey(ordered[index]);

          // Requirement 5.4: creation instant descending — never ascending.
          expect(previousInstant).toBeGreaterThanOrEqual(currentInstant);

          if (previousInstant === currentInstant) {
            // The tie-break, also descending, and *strict*: distinct identities
            // means adjacent equal keys cannot occur, so a comparison that gave
            // up on a tie would be caught here.
            expect(previousIdentity > currentIdentity).toBe(true);
          }
        }
      }),
      { numRuns: 400 },
    );
  });

  it('agrees element-for-element with an independent oracle sort', () => {
    fc.assert(
      fc.property(recordsArb(0, 60), (records) => {
        // The oracle is written from Requirement 5.4 directly, so this is a
        // check of the criterion rather than of the implementation restated.
        expectSameSequence(orderNotifications(records), expectedOrdering(records));
      }),
      { numRuns: 400 },
    );
  });

  it('breaks a whole-collection instant tie by identity alone', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(identityArb, { minLength: 2, maxLength: 40 }),
        fc.constantFrom(...TIE_INSTANTS),
        (identities, instant) => {
          // Every record shares one creation instant, so identity descending is
          // the entire order — the case Requirement 14.3 turns on.
          const records = identities.map((notificationId) => ({
            notificationId,
            type: { kind: 'catalogued', value: 'match-drafted' } as const,
            squadId: '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b',
            title: 'A match was drafted',
            body: '',
            createdAtMs: instant,
            readState: 'unread' as const,
          }));

          const ordered = orderNotifications(records);
          const byIdentityDescending = identities
            .slice()
            .sort((left, right) => (left === right ? 0 : left > right ? -1 : 1));

          expect(ordered.map((record) => record.notificationId)).toEqual(
            byIdentityDescending,
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});

// Feature: app-shell, Property 11: the ordered result does not depend on the
// order the records were supplied in
// Validates: Requirements 5.4, 14.3
describe('orderNotifications — the result is independent of the supplied order', () => {
  it('gives equal ordered lists for any two permutations of one collection', () => {
    fc.assert(
      fc.property(permutationsArb(0, 60), ({ supplied, firstShuffle, secondShuffle }) => {
        const fromSupplied = orderNotifications(supplied);
        const fromFirst = orderNotifications(firstShuffle);
        const fromSecond = orderNotifications(secondShuffle);

        // Requirement 14.3: same records in, same rendered order out, whatever
        // order the backend happened to return them in.
        expectSameSequence(fromFirst, fromSupplied);
        expectSameSequence(fromSecond, fromSupplied);
        expectSameSequence(fromFirst, expectedOrdering(secondShuffle));
      }),
      { numRuns: 400 },
    );
  });

  it('stays supplied-order independent across the display cap', () => {
    fc.assert(
      fc.property(
        permutationsArb(NOTIFICATION_LIST_CAP - 2, NOTIFICATION_LIST_CAP + 6),
        ({ supplied, firstShuffle, secondShuffle }) => {
          // Capping is a leading slice of the *ordering*, so which records
          // survive the cap must not depend on the supplied order either — a
          // cap-then-sort implementation would fail exactly here.
          const fromSupplied = orderNotifications(supplied);

          expectSameSequence(orderNotifications(firstShuffle), fromSupplied);
          expectSameSequence(orderNotifications(secondShuffle), fromSupplied);
          expectSameSequence(fromSupplied, expectedOrdering(supplied));
        },
      ),
      { numRuns: 120 },
    );
  });

  it('reverses to the same ordered list, and orders an already-ordered list identically', () => {
    fc.assert(
      fc.property(recordsArb(0, 60), (records) => {
        const ordered = orderNotifications(records);

        // Two adversarial supplied orders: the exact reverse of the wanted one,
        // and the wanted one itself. Ordering is idempotent on its own output.
        expectSameSequence(orderNotifications(records.slice().reverse()), ordered);
        expectSameSequence(orderNotifications(ordered), ordered);
      }),
      { numRuns: 400 },
    );
  });

  it('is deterministic: repeated calls on one collection agree exactly', () => {
    fc.assert(
      fc.property(recordsArb(0, 60), (records) => {
        expectSameSequence(orderNotifications(records), orderNotifications(records));
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: app-shell, Property 11: the comparison is a strict total order and
// ordering leaves its input alone
// Validates: Requirements 5.4, 14.3
describe('orderNotifications — the comparison is a strict total order', () => {
  it('is antisymmetric and transitive over any three records', () => {
    fc.assert(
      fc.property(recordsArb(3, 3), ([first, second, third]) => {
        // Position within the ordered list *is* the order relation, so reading
        // the relation off pairwise orderings tests the comparison itself.
        const precedes = (left: NotificationRecord, right: NotificationRecord): boolean =>
          orderNotifications([left, right])[0] === left;

        // Antisymmetry: with distinct keys, exactly one of the two precedes the
        // other, and the answer does not depend on which way round they arrived.
        expect(precedes(first, second)).toBe(!precedes(second, first));

        // Transitivity, checked on whichever chain the generated triple forms.
        if (precedes(first, second) && precedes(second, third)) {
          expect(precedes(first, third)).toBe(true);
        }

        if (precedes(third, second) && precedes(second, first)) {
          expect(precedes(third, first)).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('is irreflexive on the key: a record never precedes itself', () => {
    fc.assert(
      fc.property(recordArb, (record) => {
        // The same record supplied twice shares both keys, so neither copy can
        // be claimed to come first — the ordering keeps them adjacent instead.
        const ordered = orderNotifications([record, record]);

        expect(ordered).toHaveLength(2);
        expect(ordered[0]).toBe(record);
        expect(ordered[1]).toBe(record);
      }),
      { numRuns: 200 },
    );
  });

  it('does not mutate the supplied array', () => {
    fc.assert(
      fc.property(recordsArb(0, 60), (records) => {
        const before = records.slice();

        orderNotifications(records);

        // Requirement 14.4's non-mutation half, and the reason ordering can be
        // applied repeatedly to state the caller still holds.
        expectSameSequence(records, before);
      }),
      { numRuns: 400 },
    );
  });

  it('leaves a frozen collection orderable, since nothing is written back', () => {
    fc.assert(
      fc.property(recordsArb(0, 40), (records) => {
        const frozen = Object.freeze(records.slice());

        // An in-place sort of the caller's array would raise on a frozen array;
        // this passes only because the module copies first.
        expectSameSequence(orderNotifications(frozen), expectedOrdering(records));
      }),
      { numRuns: 200 },
    );
  });
});
// --- Property 12 -------------------------------------------------------------

/**
 * The whole ordering with no cap applied, from the same oracle comparison as
 * above. Property 12 is about what the cap keeps, so the uncapped ordering is
 * the reference the capped list is checked against.
 */
function oracleSortedAll(
  records: readonly NotificationRecord[],
): NotificationRecord[] {
  return records.slice().sort(compareOracle);
}

/** The identities of a list, in list order. */
function identitiesOf(records: readonly NotificationRecord[]): string[] {
  return records.map((record) => record.notificationId);
}

/**
 * Asserts a list adds nothing and duplicates nothing: every element is one of the
 * supplied record objects, and no record appears twice.
 *
 * Membership is by **reference**, so a look-alike record built from a supplied
 * one would not satisfy it — ordering rearranges, it does not reconstruct
 * (Requirement 14.4).
 */
function expectSubsetWithoutDuplicates(
  actual: readonly NotificationRecord[],
  supplied: readonly NotificationRecord[],
): void {
  const suppliedRecords = new Set<NotificationRecord>(supplied);

  for (const record of actual) {
    expect(suppliedRecords.has(record)).toBe(true);
  }

  expect(new Set(actual).size).toBe(actual.length);
  expect(new Set(identitiesOf(actual)).size).toBe(actual.length);
}

/**
 * A collection larger than the Notification_List_Cap, so the cap is actually
 * exercised, together with the boundary sizes either side of it.
 */
const overCapRecordsArb = fc.oneof(
  { weight: 3, arbitrary: recordsArb(NOTIFICATION_LIST_CAP + 1, NOTIFICATION_LIST_CAP + 15) },
  { weight: 1, arbitrary: recordsArb(NOTIFICATION_LIST_CAP, NOTIFICATION_LIST_CAP) },
  { weight: 1, arbitrary: recordsArb(NOTIFICATION_LIST_CAP - 1, NOTIFICATION_LIST_CAP - 1) },
);

// Feature: app-shell, Property 12: ordering and display caps neither add, drop,
// nor duplicate records
// Validates: Requirements 5.4, 5.12, 14.4
describe('orderNotifications — the ordered list adds, drops, and duplicates nothing', () => {
  it('keeps every supplied record exactly once when the supplied count is within the cap', () => {
    fc.assert(
      fc.property(recordsArb(0, NOTIFICATION_LIST_CAP), (records) => {
        const ordered = orderNotifications(records);

        // Requirement 14.4: at or below the cap the ordered list is a
        // rearrangement — same records, same count, nothing lost, nothing added.
        expect(ordered).toHaveLength(records.length);
        expectSubsetWithoutDuplicates(ordered, records);
        expect(identitiesOf(ordered).slice().sort()).toEqual(
          identitiesOf(records).slice().sort(),
        );
      }),
      { numRuns: 200 },
    );
  });

  it('is exactly min(n, 200) records long, adding and duplicating nothing above the cap', () => {
    fc.assert(
      fc.property(overCapRecordsArb, (records) => {
        const ordered = orderNotifications(records);

        // Requirement 5.4: the cap is a hard length, and the excess is dropped
        // silently — no thrown error, no failure value, just a shorter list.
        expect(ordered).toHaveLength(Math.min(records.length, NOTIFICATION_LIST_CAP));
        expectSubsetWithoutDuplicates(ordered, records);
      }),
      { numRuns: 120 },
    );
  });

  it('keeps the leading records of the ordering, not an arbitrary 200', () => {
    fc.assert(
      fc.property(overCapRecordsArb, (records) => {
        const wholeOrdering = oracleSortedAll(records);

        // Requirement 14.4: "the first 200 Notification_Records of the ordering
        // defined by 14.3" — so the cap slices the ordering, and a
        // cap-then-order implementation keeping 200 arbitrary records fails here.
        expectSameSequence(
          orderNotifications(records),
          wholeOrdering.slice(0, NOTIFICATION_LIST_CAP),
        );
      }),
      { numRuns: 120 },
    );
  });

  it('discards only records that order after every record it kept', () => {
    fc.assert(
      fc.property(
        recordsArb(NOTIFICATION_LIST_CAP + 1, NOTIFICATION_LIST_CAP + 15),
        (records) => {
          const ordered = orderNotifications(records);
          const keptIdentities = new Set(identitiesOf(ordered));
          const discarded = records.filter(
            (record) => !keptIdentities.has(record.notificationId),
          );

          // The dropped records are the *oldest*, stated without reference to
          // position: nothing discarded may outrank anything kept.
          expect(discarded).toHaveLength(records.length - NOTIFICATION_LIST_CAP);

          const lastKept = ordered[ordered.length - 1];

          for (const record of discarded) {
            expect(compareOracle(lastKept, record)).toBe(-1);
          }
        },
      ),
      { numRuns: 120 },
    );
  });

  it('caps at the same records whatever order they were supplied in', () => {
    fc.assert(
      fc.property(
        permutationsArb(NOTIFICATION_LIST_CAP + 1, NOTIFICATION_LIST_CAP + 10),
        ({ supplied, firstShuffle, secondShuffle }) => {
          // Which records survive the cap is a fact about the collection, not
          // about the order the backend returned it in (Requirements 5.4, 14.3).
          const keptFromSupplied = identitiesOf(orderNotifications(supplied));

          expect(identitiesOf(orderNotifications(firstShuffle))).toEqual(keptFromSupplied);
          expect(identitiesOf(orderNotifications(secondShuffle))).toEqual(keptFromSupplied);
        },
      ),
      { numRuns: 120 },
    );
  });

  it('is idempotent: ordering the capped list again changes nothing', () => {
    fc.assert(
      fc.property(overCapRecordsArb, (records) => {
        const ordered = orderNotifications(records);

        // The Notifications_Destination shows this list in full (Requirement
        // 5.12), so ordering it again — as a re-render might — must be a no-op.
        expectSameSequence(orderNotifications(ordered), ordered);
      }),
      { numRuns: 120 },
    );
  });
});

// Feature: app-shell, Property 12: the two display caps are prefixes of one
// ordering
// Validates: Requirements 5.4, 5.12, 14.4
describe('panelPreviewNotifications — the panel previews the first min(10, n) of the ordering', () => {
  it('is a prefix of the ordered list, of length min(n, 10)', () => {
    fc.assert(
      fc.property(recordsArb(0, 40), (records) => {
        const ordered = orderNotifications(records);
        const preview = panelPreviewNotifications(ordered);

        // Requirement 5.12: at most the first 10 Notification_Records of the
        // ordered Notification_List, the rest reached through the destination.
        expect(preview).toHaveLength(
          Math.min(ordered.length, NOTIFICATION_PANEL_PREVIEW_CAP),
        );
        expectSameSequence(
          preview,
          ordered.slice(0, NOTIFICATION_PANEL_PREVIEW_CAP),
        );
        expectSubsetWithoutDuplicates(preview, records);
      }),
      { numRuns: 300 },
    );
  });

  it('agrees with the destination list on the newest records', () => {
    fc.assert(
      fc.property(overCapRecordsArb, (records) => {
        // Both surfaces slice one ordering — the panel min(10, n), the
        // destination min(200, n) — so they can never disagree about which
        // notification is newest (Requirement 5.12).
        const destinationList = orderNotifications(records);
        const preview = panelPreviewNotifications(destinationList);

        expect(destinationList).toHaveLength(
          Math.min(records.length, NOTIFICATION_LIST_CAP),
        );
        expect(preview).toHaveLength(
          Math.min(destinationList.length, NOTIFICATION_PANEL_PREVIEW_CAP),
        );

        for (let index = 0; index < preview.length; index += 1) {
          expect(preview[index]).toBe(destinationList[index]);
        }
      }),
      { numRuns: 120 },
    );
  });

  it('previews the same records whatever order they were supplied in', () => {
    fc.assert(
      fc.property(permutationsArb(0, 40), ({ supplied, firstShuffle, secondShuffle }) => {
        const previewOf = (records: readonly NotificationRecord[]) =>
          identitiesOf(panelPreviewNotifications(orderNotifications(records)));

        const expected = previewOf(supplied);

        expect(previewOf(firstShuffle)).toEqual(expected);
        expect(previewOf(secondShuffle)).toEqual(expected);
      }),
      { numRuns: 200 },
    );
  });

  it('is idempotent and leaves the ordered list untouched', () => {
    fc.assert(
      fc.property(recordsArb(0, 40), (records) => {
        const ordered = orderNotifications(records);
        const before = ordered.slice();
        const preview = panelPreviewNotifications(ordered);

        // A prefix of a prefix is the same prefix, and previewing must not
        // mutate the list the destination is rendering from.
        expectSameSequence(panelPreviewNotifications(preview), preview);
        expectSameSequence(ordered, before);
      }),
      { numRuns: 300 },
    );
  });

  it('previews an empty list without error when nothing was supplied', () => {
    expect(panelPreviewNotifications(orderNotifications([]))).toEqual([]);
    expect(orderNotifications([])).toEqual([]);
  });
});
