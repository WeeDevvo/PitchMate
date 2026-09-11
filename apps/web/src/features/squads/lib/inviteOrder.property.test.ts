import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { compareInviteSummaries, orderInviteSummaries } from './inviteOrder';
import type { InviteSummary } from './parse/inviteSummary';
import type { InviteStateValue } from './enumCodes';

/**
 * Property tests for the single pure function that decides the Invite_Order,
 * beside the module they cover as the design's Testing Strategy asks, and running
 * well above the 100-iteration floor (Requirement 20.1).
 *
 * Three claims are made here, and Requirement 20.6 asks for the first two of them
 * by name:
 *
 * - **The result is a total order determined solely by its input.** Asserted twice
 *   over: the sequence is non-increasing by creation instant with equal instants in
 *   identity order, and the comparator itself is antisymmetric, transitive, and
 *   returns `0` only for two summaries carrying the same invite identity.
 * - **A permutation of the input changes nothing.** A "sorted" check alone cannot
 *   catch this — a comparison that gave up on two invites sharing a creation
 *   millisecond would still produce a non-increasing sequence while letting two
 *   `ListInvites` loads of the same invites render in different orders. So the
 *   ordering is driven through permutations of one listing and the results required
 *   to be equal element-for-element. It matters concretely: Requirement 11.10 has a
 *   successful revocation issue a *further* `ListInvites`, so an order that depended
 *   on arrival position would rearrange the remaining invites under the cursor of
 *   the admin who just revoked one.
 * - **Nothing is added, dropped, or duplicated.** Ordering is a rearrangement of the
 *   parsed listing, which is what keeps Requirement 11.2's "exactly one entry per
 *   parsed Invite_Summary" a fact about the listing rather than something the
 *   ordering could quietly break. The ordering also filters nothing: a revoked or
 *   expired invite is still listed, just without a revoke control (Requirement 11.9).
 *
 * The rendered-entry clauses — that the *entries on screen* are in this order — are
 * claimed by **Property 28** at the rendering site. What is stated here is the pure
 * half Requirement 11.3 asks the order to be derived through.
 *
 * The generators lean hard on the shared creation instant, because that is the whole
 * reason the identity tie-break exists: instants are drawn from a small pool of
 * millisecond values, so two invites stamped in the same millisecond is the common
 * input rather than a corner. Summaries are compared **by reference** throughout,
 * since ordering rearranges the very objects it was given rather than rebuilding
 * them.
 */

// --- the oracle --------------------------------------------------------------

/**
 * The Invite_Summary comparison written from the acceptance criterion: creation
 * instant descending, ties broken by invite identity ascending.
 *
 * Deliberately expressed differently from the module — the instants are compared
 * through a subtraction reduced to a sign rather than through two `>`/`<` tests, so
 * this checks the stated order rather than the implementation restated.
 */
function compareOracle(left: InviteSummary, right: InviteSummary): number {
  const byInstant = right.createdAtMs - left.createdAtMs;

  if (byInstant !== 0) {
    return byInstant < 0 ? -1 : 1;
  }

  if (left.inviteId === right.inviteId) {
    return 0;
  }

  return left.inviteId < right.inviteId ? -1 : 1;
}

/** The expected ordered listing: the oracle sort of a copy. */
function expectedOrdering(summaries: readonly InviteSummary[]): InviteSummary[] {
  return summaries.slice().sort(compareOracle);
}

/** Asserts two listings hold the same summary objects in the same order. */
function expectSameSequence(
  actual: readonly InviteSummary[],
  expected: readonly InviteSummary[],
): void {
  expect(actual).toHaveLength(expected.length);

  for (let index = 0; index < expected.length; index += 1) {
    expect(actual[index]).toBe(expected[index]);
  }
}

/** The invite identities of a listing, in listing order. */
function identitiesOf(summaries: readonly InviteSummary[]): string[] {
  return summaries.map((summary) => summary.inviteId);
}

// --- generators --------------------------------------------------------------

/** A well-formed 36-character hyphenated identity, in either letter case. */
const identityArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.uuid() },
  { weight: 1, arbitrary: fc.uuid().map((identity) => identity.toUpperCase()) },
);

/**
 * A small pool of creation instants, so two invites sharing a millisecond turns up
 * constantly — the case Requirement 11.3's tie-break exists for.
 *
 * The values are epoch milliseconds, which is what `lib/parse/inviteSummary`
 * normalises every `createdAt` to. `0`, a negative instant (an invite dated before
 * 1970 — nonsense in practice, but the parser accepts the instant that produces it),
 * and two values one millisecond apart are all in the pool, because the descending
 * key must separate adjacent milliseconds and must not treat `0` as an absence.
 */
const COLLIDING_INSTANTS: readonly number[] = [
  -86_400_000, -1, 0, 1, 1_700_000_000_000, 1_700_000_000_001,
  1_700_000_086_400_000,
];

/** A creation instant: usually from the colliding pool, sometimes arbitrary. */
const instantArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 5, arbitrary: fc.constantFrom(...COLLIDING_INSTANTS) },
  {
    weight: 2,
    arbitrary: fc.integer({ min: -8_640_000_000_000, max: 8_640_000_000_000 }),
  },
);

const stateArb: fc.Arbitrary<InviteStateValue> = fc.constantFrom(
  'active' as const,
  'revoked' as const,
  'expired' as const,
);

/** The audit actor string, `null` for a system operation. */
const createdByArb: fc.Arbitrary<string | null> = fc.oneof(
  { weight: 3, arbitrary: fc.string({ minLength: 0, maxLength: 24 }) },
  { weight: 1, arbitrary: fc.constant(null) },
);

/**
 * An Invite_Summary. The state, the audit actor, and the expiry are all generated,
 * including their absences, so a comparison that leaned on any of them — putting
 * active invites first, say, or non-expiring ones last, neither of which any
 * criterion asks for — would be caught rather than accidentally agreeing with the
 * ordering keys.
 */
const summaryArb: fc.Arbitrary<InviteSummary> = fc.record({
  inviteId: identityArb,
  state: stateArb,
  createdAtMs: instantArb,
  createdBy: createdByArb,
  expiresAtMs: fc.oneof(instantArb, fc.constant(null)),
});

/**
 * A listing with **distinct** invite identities — the form a `ListInvites` response
 * takes, one element per invite of the squad, and the precondition under which the
 * comparison is a *strict* total order.
 */
const summariesArb = (
  minLength: number,
  maxLength: number,
): fc.Arbitrary<InviteSummary[]> =>
  fc.uniqueArray(summaryArb, {
    minLength,
    maxLength,
    selector: (summary) => summary.inviteId,
  });

/**
 * A listing that may repeat an identity, drawn from a small identity pool. Not a
 * shape the backend sends, but the ordering must still neither drop nor merge an
 * element it cannot separate.
 */
const repeatedIdentitiesArb: fc.Arbitrary<InviteSummary[]> = fc
  .uniqueArray(identityArb, { minLength: 1, maxLength: 4 })
  .chain((pool) =>
    fc.array(
      fc.record({
        inviteId: fc.constantFrom(...pool),
        state: stateArb,
        createdAtMs: instantArb,
        createdBy: createdByArb,
        expiresAtMs: fc.oneof(instantArb, fc.constant(null)),
      }),
      { minLength: 2, maxLength: 20 },
    ),
  );

/**
 * One listing plus two independent permutations of it. Every permutation property is
 * driven from this: the orderings must agree with each other and with the oracle,
 * which is Requirement 20.6's "unchanged by a permutation of that input" stated as a
 * test.
 */
const permutationsArb = (
  minLength: number,
  maxLength: number,
): fc.Arbitrary<{
  supplied: InviteSummary[];
  firstShuffle: InviteSummary[];
  secondShuffle: InviteSummary[];
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

// Feature: web-squads-screens, Property 28 (pure half): the Invite_Order is
// creation instant descending, ties broken by invite identity ascending
// Validates: Requirements 11.3, 20.1, 20.6
describe('orderInviteSummaries — the result is newest first, then by identity', () => {
  it('yields a sequence non-increasing by creation instant, with equal instants in identity order', () => {
    fc.assert(
      fc.property(summariesArb(0, 40), (summaries) => {
        const ordered = orderInviteSummaries(summaries);

        for (let index = 1; index < ordered.length; index += 1) {
          const previous = ordered[index - 1];
          const current = ordered[index];

          // Requirement 11.3: descending, so the newer invite is never after the
          // older one.
          expect(previous.createdAtMs).toBeGreaterThanOrEqual(
            current.createdAtMs,
          );

          if (previous.createdAtMs === current.createdAtMs) {
            // The tie-break, and *strict*: identities are distinct here, so a
            // comparison that gave up on a shared millisecond would be caught.
            expect(previous.inviteId < current.inviteId).toBe(true);
          }
        }
      }),
      { numRuns: 400 },
    );
  });

  it('agrees element-for-element with an independent oracle sort', () => {
    fc.assert(
      fc.property(summariesArb(0, 40), (summaries) => {
        expectSameSequence(
          orderInviteSummaries(summaries),
          expectedOrdering(summaries),
        );
      }),
      { numRuns: 400 },
    );
  });

  it('orders a listing whose invites share one creation instant by identity alone', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(identityArb, { minLength: 2, maxLength: 30 }),
        instantArb,
        (identities, createdAtMs) => {
          // Every invite was stamped in the same millisecond, so the identity
          // tie-break is the entire order — the case Requirement 11.3's second
          // clause and Requirement 20.6's determinism claim turn on.
          const summaries = identities.map((inviteId) => ({
            inviteId,
            state: 'active' as const,
            createdAtMs,
            createdBy: null,
            expiresAtMs: null,
          }));

          expect(identitiesOf(orderInviteSummaries(summaries))).toEqual(
            identities.slice().sort((left, right) => (left < right ? -1 : 1)),
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it('puts the newest invite first, which is the opposite of the Squad_Card order', () => {
    // A worked example a reader can check by eye: the invite an admin generated a
    // moment ago is the one they are about to act on, so it leads.
    const ordered = orderInviteSummaries([
      {
        inviteId: 'a',
        state: 'expired',
        createdAtMs: 1_000,
        createdBy: null,
        expiresAtMs: 2_000,
      },
      {
        inviteId: 'b',
        state: 'active',
        createdAtMs: 3_000,
        createdBy: 'admin',
        expiresAtMs: null,
      },
      {
        inviteId: 'c',
        state: 'revoked',
        createdAtMs: 2_000,
        createdBy: 'admin',
        expiresAtMs: null,
      },
    ]);

    expect(identitiesOf(ordered)).toEqual(['b', 'c', 'a']);
  });
});

// Feature: web-squads-screens, Property 28 (pure half): the order does not depend
// on the order the invites arrived in
// Validates: Requirements 11.3, 20.6
describe('orderInviteSummaries — the result is independent of the supplied order', () => {
  it('gives equal ordered listings for any two permutations of one listing', () => {
    fc.assert(
      fc.property(
        permutationsArb(0, 40),
        ({ supplied, firstShuffle, secondShuffle }) => {
          const fromSupplied = orderInviteSummaries(supplied);

          // Requirement 20.6: same invites in, same rendered order out, whatever
          // order `ListInvites` happened to return them in — it promises none.
          expectSameSequence(orderInviteSummaries(firstShuffle), fromSupplied);
          expectSameSequence(orderInviteSummaries(secondShuffle), fromSupplied);
          expectSameSequence(fromSupplied, expectedOrdering(secondShuffle));
        },
      ),
      { numRuns: 400 },
    );
  });

  it('reverses to the same order, and orders an already-ordered listing identically', () => {
    fc.assert(
      fc.property(summariesArb(0, 40), (summaries) => {
        const ordered = orderInviteSummaries(summaries);

        // Two adversarial supplied orders: the exact reverse of the wanted one, and
        // the wanted one itself. Ordering is idempotent on its own output, so the
        // re-list after a revocation cannot rearrange anything.
        expectSameSequence(
          orderInviteSummaries(summaries.slice().reverse()),
          ordered,
        );
        expectSameSequence(orderInviteSummaries(ordered), ordered);
      }),
      { numRuns: 400 },
    );
  });

  it('is deterministic: repeated calls on one listing agree exactly', () => {
    fc.assert(
      fc.property(summariesArb(0, 40), (summaries) => {
        expectSameSequence(
          orderInviteSummaries(summaries),
          orderInviteSummaries(summaries),
        );
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: web-squads-screens, Property 28 (pure half): the comparison is a total
// order and ordering leaves its input alone
// Validates: Requirements 11.3, 20.6
describe('compareInviteSummaries — the comparison is a total order', () => {
  it('is antisymmetric over any two summaries', () => {
    fc.assert(
      fc.property(summaryArb, summaryArb, (left, right) => {
        const forward = compareInviteSummaries(left, right);
        const backward = compareInviteSummaries(right, left);

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
        const firstToSecond = compareInviteSummaries(first, second);
        const secondToThird = compareInviteSummaries(second, third);

        if (firstToSecond <= 0 && secondToThird <= 0) {
          expect(compareInviteSummaries(first, third)).toBeLessThanOrEqual(0);
        }

        if (firstToSecond >= 0 && secondToThird >= 0) {
          expect(compareInviteSummaries(first, third)).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('compares equal only for two summaries of the same invite', () => {
    fc.assert(
      fc.property(summaryArb, summaryArb, (left, right) => {
        // This is what makes the order *total* over a `ListInvites` listing:
        // identities are distinct there, so no two entries can compare equal and
        // fall back to arrival position.
        if (compareInviteSummaries(left, right) === 0) {
          expect(left.inviteId).toBe(right.inviteId);
        }

        expect(compareInviteSummaries(left, left)).toBe(0);
      }),
      { numRuns: 500 },
    );
  });

  it('does not mutate the supplied listing', () => {
    fc.assert(
      fc.property(summariesArb(0, 40), (summaries) => {
        const before = summaries.slice();

        orderInviteSummaries(summaries);

        // The state the invite manager holds is the parsed listing; ordering it for
        // rendering must not reorder what the hook is holding.
        expectSameSequence(summaries, before);
      }),
      { numRuns: 400 },
    );
  });

  it('leaves a frozen listing orderable, since nothing is written back', () => {
    fc.assert(
      fc.property(summariesArb(0, 30), (summaries) => {
        const frozen = Object.freeze(summaries.slice());

        // An in-place sort of the caller's array would raise on a frozen array;
        // this passes only because the module copies first.
        expectSameSequence(
          orderInviteSummaries(frozen),
          expectedOrdering(summaries),
        );
      }),
      { numRuns: 200 },
    );
  });
});

// Feature: web-squads-screens, Property 28 (pure half): ordering neither adds,
// drops, nor duplicates an Invite_Summary
// Validates: Requirements 11.2, 11.3, 11.9, 20.1
describe('orderInviteSummaries — the ordered listing adds, drops, and duplicates nothing', () => {
  it('holds exactly the supplied summary objects, each exactly once', () => {
    fc.assert(
      fc.property(summariesArb(0, 40), (summaries) => {
        const ordered = orderInviteSummaries(summaries);
        const supplied = new Set<InviteSummary>(summaries);

        // Requirement 11.2 stays a fact about the parsed listing: ordering
        // rearranges by reference, so it can neither invent an entry nor lose one.
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

  it('filters no Invite_State, so a revoked or expired invite is still listed', () => {
    fc.assert(
      fc.property(summariesArb(1, 30), (summaries) => {
        const ordered = orderInviteSummaries(summaries);

        // Requirement 11.9 hides the revoke *control* on a non-active invite, not
        // the invite. Ordering is not the place that decision is made, and this is
        // what says so.
        for (const state of ['active', 'revoked', 'expired'] as const) {
          expect(ordered.filter((summary) => summary.state === state)).toHaveLength(
            summaries.filter((summary) => summary.state === state).length,
          );
        }
      }),
      { numRuns: 300 },
    );
  });

  it('keeps every element of a listing that repeats an identity', () => {
    fc.assert(
      fc.property(repeatedIdentitiesArb, (summaries) => {
        const ordered = orderInviteSummaries(summaries);

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

  it('orders the empty, single, and 200-invite listings', () => {
    expect(orderInviteSummaries([])).toEqual([]);

    fc.assert(
      fc.property(summaryArb, (summary) => {
        expectSameSequence(orderInviteSummaries([summary]), [summary]);
      }),
      { numRuns: 200 },
    );

    fc.assert(
      fc.property(summariesArb(200, 200), (summaries) => {
        // Larger than the backend's active-invite limit allows, and the size at
        // which a comparison that is not a consistent order would start producing
        // engine-dependent results.
        const ordered = orderInviteSummaries(summaries);

        expect(ordered).toHaveLength(200);
        expectSameSequence(ordered, expectedOrdering(summaries));
      }),
      { numRuns: 100 },
    );
  });
});
