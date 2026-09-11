import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { compareSquadSummaries, orderSquadSummaries } from './squadOrder';
import type { SquadSummary } from './parse/squadSummary';
import type { MemberRole, MembershipStateValue } from './enumCodes';

/**
 * Property tests for the single pure function that decides the Squad_Card order,
 * beside the module they cover as the design's Testing Strategy asks, and running
 * well above the 100-iteration floor (Requirement 20.1).
 *
 * Three claims are made here, and Requirement 20.6 asks for the first two of them
 * by name:
 *
 * - **The result is a total order determined solely by its input.** Asserted
 *   twice over: the sequence is non-decreasing under an independent collation,
 *   and the comparator itself is antisymmetric, transitive, and returns `0` only
 *   for two summaries carrying the same squad identity.
 * - **A permutation of the input changes nothing.** A "sorted" check alone cannot
 *   catch this — a comparison that gave up on a case-insensitive name tie would
 *   still produce a non-decreasing sequence while letting two loads of the same
 *   squads render in different orders. So the ordering is driven through
 *   permutations of one collection and the results required to be equal
 *   element-for-element.
 * - **Nothing is added, dropped, or duplicated.** Ordering is a rearrangement of
 *   the parsed collection, which is what keeps Requirement 1.2's "exactly one
 *   Squad_Card per parsed Squad_Summary" a fact about the collection rather than
 *   something the ordering could quietly break.
 *
 * The rendered-card clauses of Requirement 1.3 — that the *cards on screen* are
 * in this order — are claimed by **Property 1** at the rendering site. What is
 * stated here is the pure half Requirement 1.4 asks to be testable without a
 * browser.
 *
 * The generators lean hard on the case-insensitive tie, because that is the whole
 * reason the identity tie-break exists: names are drawn from small families whose
 * members differ only in letter case or accent, so `dave` / `Dave` / `dāve`
 * collating equal is the common input rather than a corner. Summaries are compared
 * **by reference** throughout, since ordering rearranges the very objects it was
 * given rather than rebuilding them.
 */

// --- the oracle --------------------------------------------------------------

/**
 * The case-insensitive name comparison of Requirement 1.3, expressed
 * independently of the module: an `Intl.Collator` at base sensitivity rather than
 * `String.prototype.localeCompare` with the same option. Same collation, a
 * different route to it.
 */
const baseCollator = new Intl.Collator(undefined, { sensitivity: 'base' });

/**
 * The Squad_Card comparison written from the acceptance criterion: name ascending
 * case-insensitively, ties broken by squad identity ascending. Identities are
 * compared as raw UTF-16 strings — the unit "ascending" is stated in for an opaque
 * identity — deliberately *not* through a collator.
 */
function compareOracle(left: SquadSummary, right: SquadSummary): number {
  const byName = baseCollator.compare(left.name, right.name);

  if (byName !== 0) {
    return byName < 0 ? -1 : 1;
  }

  if (left.squadId === right.squadId) {
    return 0;
  }

  return left.squadId < right.squadId ? -1 : 1;
}

/** The expected ordered collection: the oracle sort of a copy. */
function expectedOrdering(summaries: readonly SquadSummary[]): SquadSummary[] {
  return summaries.slice().sort(compareOracle);
}

/** Asserts two collections hold the same summary objects in the same order. */
function expectSameSequence(
  actual: readonly SquadSummary[],
  expected: readonly SquadSummary[],
): void {
  expect(actual).toHaveLength(expected.length);

  for (let index = 0; index < expected.length; index += 1) {
    expect(actual[index]).toBe(expected[index]);
  }
}

/** The squad identities of a collection, in collection order. */
function identitiesOf(summaries: readonly SquadSummary[]): string[] {
  return summaries.map((summary) => summary.squadId);
}

// --- generators --------------------------------------------------------------

/** A well-formed 36-character hyphenated identity, in either letter case. */
const identityArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.uuid() },
  { weight: 1, arbitrary: fc.uuid().map((identity) => identity.toUpperCase()) },
);

/**
 * Families of names that collate **equal** at base sensitivity: letter case and
 * accent differences only. A collection drawn from one family is ordered entirely
 * by the identity tie-break, which is the case Requirement 1.3's second clause
 * exists for.
 */
const NAME_FAMILIES: readonly (readonly string[])[] = [
  ['dave', 'Dave', 'DAVE', 'dAvE', 'dāve', 'dàve'],
  ['sunday league', 'Sunday League', 'SUNDAY LEAGUE', 'Sunday league'],
  ['fc', 'FC', 'Fc', 'fC'],
  ['élan', 'Élan', 'ELAN', 'elan'],
  ['5-a-side', '5-A-SIDE', '5-a-Side'],
];

/** One member of one family, so equal-collating names turn up constantly. */
const familyNameArb: fc.Arbitrary<string> = fc
  .constantFrom(...NAME_FAMILIES)
  .chain((family) => fc.constantFrom(...family));

/**
 * A Squad_Name. Weighted towards the tie families, then names that differ only in
 * a leading or trailing space, then arbitrary text — including the empty string,
 * digits, non-ASCII scripts, emoji, and a 100-character name — because the
 * ordering must be total over whatever the backend calls a squad.
 */
const nameArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: familyNameArb },
  {
    weight: 2,
    arbitrary: familyNameArb.chain((name) =>
      fc.constantFrom(name, ` ${name}`, `${name} `, `${name}  `),
    ),
  },
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      '',
      ' ',
      '1',
      '10',
      '2',
      'a',
      'A',
      'z',
      'Z',
      '日本語',
      'Ω≈ç√',
      '🙈 squad',
      'squad'.repeat(20),
    ),
  },
  { weight: 3, arbitrary: fc.string({ minLength: 0, maxLength: 24 }) },
);

const roleArb: fc.Arbitrary<MemberRole | null> = fc.constantFrom(
  'owner' as const,
  'admin' as const,
  'member' as const,
  null,
);

const stateArb: fc.Arbitrary<MembershipStateValue | null> = fc.constantFrom(
  'active' as const,
  'inactive' as const,
  null,
);

/**
 * A Squad_Summary. Role and state are generated, including their absences, so a
 * comparison that leaned on either — putting owned squads first, say, which no
 * criterion asks for — would be caught rather than accidentally agreeing with the
 * ordering keys.
 */
const summaryArb: fc.Arbitrary<SquadSummary> = fc.record({
  squadId: identityArb,
  name: nameArb,
  role: roleArb,
  state: stateArb,
});

/**
 * A collection with **distinct** squad identities — the form a `ListMySquads`
 * response takes, one element per squad the caller belongs to, and the
 * precondition under which the comparison is a *strict* total order.
 */
const summariesArb = (
  minLength: number,
  maxLength: number,
): fc.Arbitrary<SquadSummary[]> =>
  fc.uniqueArray(summaryArb, {
    minLength,
    maxLength,
    selector: (summary) => summary.squadId,
  });

/**
 * A collection that may repeat an identity, drawn from a small identity pool.
 * Not a shape the backend sends, but the ordering must still neither drop nor
 * merge an element it cannot separate.
 */
const repeatedIdentitiesArb: fc.Arbitrary<SquadSummary[]> = fc
  .uniqueArray(identityArb, { minLength: 1, maxLength: 4 })
  .chain((pool) =>
    fc.array(
      fc.record({
        squadId: fc.constantFrom(...pool),
        name: nameArb,
        role: roleArb,
        state: stateArb,
      }),
      { minLength: 2, maxLength: 20 },
    ),
  );

/**
 * One collection plus two independent permutations of it. Every permutation
 * property is driven from this: the orderings must agree with each other and with
 * the oracle, which is Requirement 20.6's "unchanged by a permutation of that
 * input" stated as a test.
 */
const permutationsArb = (
  minLength: number,
  maxLength: number,
): fc.Arbitrary<{
  supplied: SquadSummary[];
  firstShuffle: SquadSummary[];
  secondShuffle: SquadSummary[];
}> =>
  summariesArb(minLength, maxLength).chain((supplied) =>
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

// Feature: web-squads-screens, Property 1 (pure half): the Squad_Card order is
// ascending by name case-insensitively, ties broken by squad identity ascending
// Validates: Requirements 1.3, 1.4, 20.1, 20.6
describe('orderSquadSummaries — the result is sorted by name, then by identity', () => {
  it('yields a sequence non-decreasing by name, with equal names in identity order', () => {
    fc.assert(
      fc.property(summariesArb(0, 40), (summaries) => {
        const ordered = orderSquadSummaries(summaries);

        for (let index = 1; index < ordered.length; index += 1) {
          const previous = ordered[index - 1];
          const current = ordered[index];
          const byName = baseCollator.compare(previous.name, current.name);

          // Requirement 1.3: ascending under a case-insensitive comparison.
          expect(byName).toBeLessThanOrEqual(0);

          if (byName === 0) {
            // The tie-break, and *strict*: identities are distinct here, so a
            // comparison that gave up on equal-collating names would be caught.
            expect(previous.squadId < current.squadId).toBe(true);
          }
        }
      }),
      { numRuns: 400 },
    );
  });

  it('agrees element-for-element with an independent oracle sort', () => {
    fc.assert(
      fc.property(summariesArb(0, 40), (summaries) => {
        // The oracle reads the criterion through `Intl.Collator` rather than
        // `localeCompare`, so this checks the stated order and not the
        // implementation restated.
        expectSameSequence(orderSquadSummaries(summaries), expectedOrdering(summaries));
      }),
      { numRuns: 400 },
    );
  });

  it('orders a collection whose names all collate equal by identity alone', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(identityArb, { minLength: 2, maxLength: 30 }),
        fc.constantFrom(...NAME_FAMILIES),
        (identities, family) => {
          // Every name differs only in case or accent, so the identity tie-break
          // is the entire order — the case Requirement 1.3's second clause and
          // Requirement 20.6's determinism claim turn on.
          const summaries = identities.map((squadId, index) => ({
            squadId,
            name: family[index % family.length],
            role: 'member' as const,
            state: 'active' as const,
          }));

          expect(identitiesOf(orderSquadSummaries(summaries))).toEqual(
            identities.slice().sort((left, right) => (left < right ? -1 : 1)),
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it('ignores letter case in the name, so a squad is not sorted by how it is typed', () => {
    // A worked example a reader can check by eye: under a case-*sensitive*
    // comparison 'Zebra' would precede 'apple', which is the bug this key avoids.
    const ordered = orderSquadSummaries([
      { squadId: 'a', name: 'Zebra FC', role: null, state: null },
      { squadId: 'b', name: 'apple FC', role: 'owner', state: 'active' },
      { squadId: 'c', name: 'Banana FC', role: 'admin', state: 'inactive' },
    ]);

    expect(ordered.map((summary) => summary.name)).toEqual([
      'apple FC',
      'Banana FC',
      'Zebra FC',
    ]);
  });
});

// Feature: web-squads-screens, Property 1 (pure half): the order does not depend
// on the order the summaries arrived in
// Validates: Requirements 1.3, 1.4, 20.6
describe('orderSquadSummaries — the result is independent of the supplied order', () => {
  it('gives equal ordered collections for any two permutations of one collection', () => {
    fc.assert(
      fc.property(permutationsArb(0, 40), ({ supplied, firstShuffle, secondShuffle }) => {
        const fromSupplied = orderSquadSummaries(supplied);

        // Requirement 20.6: same summaries in, same rendered order out, whatever
        // order `ListMySquads` happened to return them in — it promises none.
        expectSameSequence(orderSquadSummaries(firstShuffle), fromSupplied);
        expectSameSequence(orderSquadSummaries(secondShuffle), fromSupplied);
        expectSameSequence(fromSupplied, expectedOrdering(secondShuffle));
      }),
      { numRuns: 400 },
    );
  });

  it('reverses to the same order, and orders an already-ordered collection identically', () => {
    fc.assert(
      fc.property(summariesArb(0, 40), (summaries) => {
        const ordered = orderSquadSummaries(summaries);

        // Two adversarial supplied orders: the exact reverse of the wanted one,
        // and the wanted one itself. Ordering is idempotent on its own output, so
        // a re-render that orders again is a no-op.
        expectSameSequence(orderSquadSummaries(summaries.slice().reverse()), ordered);
        expectSameSequence(orderSquadSummaries(ordered), ordered);
      }),
      { numRuns: 400 },
    );
  });

  it('is deterministic: repeated calls on one collection agree exactly', () => {
    fc.assert(
      fc.property(summariesArb(0, 40), (summaries) => {
        expectSameSequence(
          orderSquadSummaries(summaries),
          orderSquadSummaries(summaries),
        );
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: web-squads-screens, Property 1 (pure half): the comparison is a total
// order and ordering leaves its input alone
// Validates: Requirements 1.3, 1.4, 20.6
describe('compareSquadSummaries — the comparison is a total order', () => {
  it('is antisymmetric over any two summaries', () => {
    fc.assert(
      fc.property(summaryArb, summaryArb, (left, right) => {
        const forward = compareSquadSummaries(left, right);
        const backward = compareSquadSummaries(right, left);

        expect([-1, 0, 1]).toContain(forward);

        if (backward === 0) {
          expect(forward).toBe(0);
        } else {
          expect(forward).toBe(-backward);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('is transitive over any three summaries', () => {
    fc.assert(
      fc.property(summaryArb, summaryArb, summaryArb, (first, second, third) => {
        const firstToSecond = compareSquadSummaries(first, second);
        const secondToThird = compareSquadSummaries(second, third);

        if (firstToSecond <= 0 && secondToThird <= 0) {
          expect(compareSquadSummaries(first, third)).toBeLessThanOrEqual(0);
        }

        if (firstToSecond >= 0 && secondToThird >= 0) {
          expect(compareSquadSummaries(first, third)).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('compares equal only for two summaries of the same squad', () => {
    fc.assert(
      fc.property(summaryArb, summaryArb, (left, right) => {
        // This is what makes the order *total* over a `ListMySquads` collection:
        // identities are distinct there, so no two cards can compare equal and
        // fall back to arrival position.
        if (compareSquadSummaries(left, right) === 0) {
          expect(left.squadId).toBe(right.squadId);
        }

        expect(compareSquadSummaries(left, left)).toBe(0);
      }),
      { numRuns: 500 },
    );
  });

  it('does not mutate the supplied collection', () => {
    fc.assert(
      fc.property(summariesArb(0, 40), (summaries) => {
        const before = summaries.slice();

        orderSquadSummaries(summaries);

        // The state a screen holds is the parsed collection; ordering it for
        // rendering must not reorder what the screen is holding.
        expectSameSequence(summaries, before);
      }),
      { numRuns: 400 },
    );
  });

  it('leaves a frozen collection orderable, since nothing is written back', () => {
    fc.assert(
      fc.property(summariesArb(0, 30), (summaries) => {
        const frozen = Object.freeze(summaries.slice());

        // An in-place sort of the caller's array would raise on a frozen array;
        // this passes only because the module copies first.
        expectSameSequence(
          orderSquadSummaries(frozen),
          expectedOrdering(summaries),
        );
      }),
      { numRuns: 200 },
    );
  });
});

// Feature: web-squads-screens, Property 1 (pure half): ordering neither adds,
// drops, nor duplicates a Squad_Summary
// Validates: Requirements 1.3, 1.4, 20.1
describe('orderSquadSummaries — the ordered collection adds, drops, and duplicates nothing', () => {
  it('holds exactly the supplied summary objects, each exactly once', () => {
    fc.assert(
      fc.property(summariesArb(0, 40), (summaries) => {
        const ordered = orderSquadSummaries(summaries);
        const supplied = new Set<SquadSummary>(summaries);

        // Requirement 1.2 stays a fact about the parsed collection: ordering
        // rearranges by reference, so it can neither invent a card nor lose one.
        expect(ordered).toHaveLength(summaries.length);

        for (const summary of ordered) {
          expect(supplied.has(summary)).toBe(true);
        }

        expect(new Set(ordered).size).toBe(ordered.length);
        expect(identitiesOf(ordered).slice().sort()).toEqual(
          identitiesOf(summaries).slice().sort(),
        );
      }),
      { numRuns: 400 },
    );
  });

  it('keeps every element of a collection that repeats an identity', () => {
    fc.assert(
      fc.property(repeatedIdentitiesArb, (summaries) => {
        const ordered = orderSquadSummaries(summaries);

        // Two summaries the comparison cannot separate are kept adjacent, not
        // merged and not dropped.
        expect(ordered).toHaveLength(summaries.length);
        expect(identitiesOf(ordered).slice().sort()).toEqual(
          identitiesOf(summaries).slice().sort(),
        );
        expectSameSequence(ordered, expectedOrdering(summaries));
      }),
      { numRuns: 300 },
    );
  });

  it('orders the empty, single, and 200-summary collections', () => {
    expect(orderSquadSummaries([])).toEqual([]);

    fc.assert(
      fc.property(summaryArb, (summary) => {
        expectSameSequence(orderSquadSummaries([summary]), [summary]);
      }),
      { numRuns: 200 },
    );

    fc.assert(
      fc.property(summariesArb(200, 200), (summaries) => {
        // Larger than any real squads listing, and the size at which a comparison
        // that is not a consistent order would start producing engine-dependent
        // results.
        const ordered = orderSquadSummaries(summaries);

        expect(ordered).toHaveLength(200);
        expectSameSequence(ordered, expectedOrdering(summaries));
      }),
      { numRuns: 100 },
    );
  });
});
