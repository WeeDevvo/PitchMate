/**
 * Property 40 of `web-player-stats-screen`: **the player list itself is
 * unchanged.**
 *
 * Task 12 of that spec amended three modules of this feature — the rating
 * presentation (`lib/ratingPresentation.ts`), the three band labels
 * (`lib/messages.ts`), and the badge that renders them
 * (`components/RatingBadge.tsx`) — so that a player who has never played reads
 * differently from one whose rating is still settling. The amendment was supposed
 * to change what a row *says about a rating* and nothing else: the row set, the
 * Player_Order, the row shape, and the absence of any further backend call are
 * all meant to be exactly as they were (`web-player-stats-screen` Requirements
 * 17.6, 17.7).
 *
 * "Exactly as they were" is a claim no example can carry, which is why it is
 * stated here as a property over generated squads, and why it is stated in a file
 * of its own rather than folded into `playerList.property.test.ts`. That file
 * claims the composition is *correct*; this one claims the amendment did not
 * *move* it. Keeping the two separate means the pinning assertions below cannot
 * be loosened in passing while someone is working on the composition's own rules.
 *
 * ### What is claimed
 *
 * 1. **One row per Squad_Member, in the existing Player_Order.** Asserted against
 *    an oracle written from the original acceptance criteria by an independent
 *    route — an `Intl.Collator` rather than `String.prototype.localeCompare`, a
 *    linear entry search rather than an indexed map, the placeholder name as a
 *    literal rather than through the exported constant — and asserted for a
 *    leaderboard that is absent, empty, partly matching, and strictly containing.
 * 2. **The row shape is pinned.** A row carries exactly the ten properties it
 *    carried before task 12 and no eleventh: in particular no resolved
 *    presentation, no band, and no rating condition. The amendment deliberately
 *    left the *decision* in `lib/ratingPresentation.ts`, a pure function of a
 *    Squad_Member and the optional leaderboard, so a row that started carrying
 *    the decision would be the first step towards two places deciding it.
 * 3. **Neither field the amendment newly reads is an ordering key.** The amended
 *    presentation reads the Appearance_Count and the Rating_State_Signal, which
 *    the composition already carried through unread. Rewriting both across a
 *    whole squad must leave the identity sequence identical and every row equal
 *    apart from those two fields — so a list cannot start grouping never-played
 *    or provisional rows, and a row cannot be dropped for having played nothing.
 * 4. **`comparePlayerRows` still induces the same total order**: three-valued,
 *    antisymmetric, transitive, equal only for one membership identity, in
 *    agreement with the oracle, and invariant under every non-key field including
 *    the two the amendment reads.
 * 5. **The amendment issues no backend call** (Requirement 17.7). A structural
 *    scan over the feature's production modules finds the `GetPlayerProfile`
 *    operation named nowhere, as a string literal or as an identifier, and finds
 *    no module importing the player-stats feature. The Player_List resolves all
 *    four bands from data `GetSquad` already sent.
 *
 * The scan reuses `structural/sourceScan.ts` — the machinery this feature's five
 * structural scans share — rather than walking the tree again here. It binds the
 * **production** module set, which excludes test files, so this file's own
 * mentions of the operation name are not scanned; the non-vacuity check below
 * pins the pattern against the feature that really does issue the call.
 *
 * Deliberately **not** claimed here: that the four presentations are total and
 * single-valued (Property 38, beside `lib/ratingPresentation.ts`), or that the
 * four bands are mutually distinguishable when rendered (Property 39, beside
 * `components/RatingBadge.tsx`).
 *
 * Feature: web-player-stats-screen, Property 40: The player list itself is
 * unchanged
 * Validates: Requirements 17.6, 17.7
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  comparePlayerRows,
  composePlayerList,
  type PlayerListRow,
} from './playerList';
import type { MembershipState, RatingState, SquadRole } from './wireEnums';
import type { FeatureFlag } from './parse/featureFlags';
import type {
  DisplayRatingEntry,
  DisplayRatingLeaderboard,
} from './parse/leaderboard';
import type { SquadDetail, SquadMember } from './parse/squadDetail';
import {
  collectProductionSources,
  inAppImports,
  isWithin,
  playerStatsRoot,
  readCodeOnly,
  readWithoutComments,
  relTo,
  squadsModules,
  squadsRoot,
} from '../structural/sourceScan';

// --- the oracle, written from the pre-amendment criteria ---------------------

/**
 * The case-insensitive name comparison of this feature's Requirement 7.4,
 * reached by a different route than the module takes: an `Intl.Collator` at base
 * sensitivity rather than `String.prototype.localeCompare` with the same option.
 */
const baseCollator = new Intl.Collator(undefined, { sensitivity: 'base' });

/** The Anonymised_Placeholder as a literal, so the exported constant cannot move this oracle. */
const PLACEHOLDER_LITERAL = 'Former player';

/** The Player_Order as it stood before task 12, key by key. */
function compareOracle(left: PlayerListRow, right: PlayerListRow): number {
  const leftRank = left.state === 'Active' ? 0 : 1;
  const rightRank = right.state === 'Active' ? 0 : 1;

  if (leftRank !== rightRank) {
    return leftRank < rightRank ? -1 : 1;
  }

  const byName = baseCollator.compare(left.displayName, right.displayName);

  if (byName !== 0) {
    return byName < 0 ? -1 : 1;
  }

  if (left.membershipId === right.membershipId) {
    return 0;
  }

  return left.membershipId < right.membershipId ? -1 : 1;
}

/** The Player_List as it stood before task 12: one row per member, then ordered. */
function composeOracle(
  detail: SquadDetail,
  leaderboard: DisplayRatingLeaderboard | null,
): PlayerListRow[] {
  return detail.members
    .map((member) => ({
      membershipId: member.membershipId,
      displayName: member.displayName,
      role: member.role,
      state: member.state,
      isGuest: member.isGuest,
      appearances: member.appearances,
      ratingState: member.ratingState,
      isFormerPlayer: member.displayName.trim() === PLACEHOLDER_LITERAL,
      leaderboardObtained: leaderboard !== null,
      ratingEntry:
        leaderboard === null
          ? null
          : (leaderboard.entries.find(
              (entry) => entry.membershipId === member.membershipId,
            ) ?? null),
    }))
    .sort(compareOracle);
}

/**
 * Every property a `PlayerListRow` carried before task 12 — the shape the
 * amendment was not supposed to widen.
 */
const PRE_AMENDMENT_ROW_KEYS: readonly string[] = [
  'appearances',
  'displayName',
  'isFormerPlayer',
  'isGuest',
  'leaderboardObtained',
  'membershipId',
  'ratingEntry',
  'ratingState',
  'role',
  'state',
];

/**
 * Names a row must not acquire: the resolved presentation and its spellings. The
 * decision stays in `lib/ratingPresentation.ts`, which is handed a member and the
 * leaderboard — a row carrying it too would be a second place deciding it.
 */
const FORBIDDEN_ROW_KEYS: readonly string[] = [
  'band',
  'kind',
  'presentation',
  'ratingBand',
  'ratingCondition',
  'ratingPresentation',
];

/** The membership identities of a collection, in collection order. */
function identitiesOf(
  rows: readonly { readonly membershipId: string }[],
): string[] {
  return rows.map((row) => row.membershipId);
}

/** The identities of a collection, sorted, for a multiset comparison. */
function identityMultisetOf(
  rows: readonly { readonly membershipId: string }[],
): string[] {
  return identitiesOf(rows).slice().sort();
}

// --- generators --------------------------------------------------------------

/** A well-formed 36-character hyphenated identity, in either letter case. */
const identityArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.uuid() },
  { weight: 1, arbitrary: fc.uuid().map((identity) => identity.toUpperCase()) },
);

/**
 * Display names that collate **equal** at base sensitivity, so the identity
 * tie-break decides a large share of every generated order rather than being an
 * occasional corner.
 */
const NAME_FAMILIES: readonly (readonly string[])[] = [
  ['dave', 'Dave', 'DAVE', 'dāve'],
  ['big dave', 'Big Dave', 'BIG DAVE'],
  ['sam', 'Sam', 'sám'],
  ['élan', 'Élan', 'elan'],
];

const familyNameArb: fc.Arbitrary<string> = fc
  .constantFrom(...NAME_FAMILIES)
  .chain((family) => fc.constantFrom(...family));

/** A Player_Display_Name, weighted towards ties and the placeholder's near misses. */
const nameArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: familyNameArb },
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      'Former player',
      ' Former player ',
      'former player',
      'Former  player',
      'Former players',
    ),
  },
  {
    weight: 2,
    arbitrary: fc.constantFrom('', ' ', '1', '10', '2', 'a', 'Z', '日本語', '🙈 keeper'),
  },
  { weight: 3, arbitrary: fc.string({ minLength: 0, maxLength: 20 }) },
);

/** A Member_Role, including the `null` a guest membership carries. */
const roleArb: fc.Arbitrary<SquadRole | null> = fc.constantFrom(
  'Owner' as const,
  'Admin' as const,
  'Member' as const,
  null,
);

/** A Membership_State; never absent, since a membership always has one. */
const stateArb: fc.Arbitrary<MembershipState> = fc.constantFrom(
  'Active' as const,
  'Inactive' as const,
);

/**
 * A Rating_State_Signal, including the `null` that means no rating was
 * established — one of the two fields the amendment newly reads.
 */
const ratingStateArb: fc.Arbitrary<RatingState | null> = fc.constantFrom(
  'Provisional' as const,
  'Established' as const,
  null,
);

/**
 * An Appearance_Count, weighted towards the zero the amendment's never-played
 * condition turns on.
 */
const appearancesArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 2, arbitrary: fc.constant(0) },
  { weight: 3, arbitrary: fc.nat({ max: 200 }) },
);

/** A finite leaderboard value, as the parser reads one. */
const ratingValueArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 3, arbitrary: fc.integer({ min: -2000, max: 3000 }) },
  { weight: 1, arbitrary: fc.double({ min: -5000, max: 5000, noNaN: true }) },
  { weight: 1, arbitrary: fc.constantFrom(0, -0, 0.5, -0.5) },
);

/** A Squad_Member, every field generated independently of every other. */
const memberArb: fc.Arbitrary<SquadMember> = fc.record({
  membershipId: identityArb,
  displayName: nameArb,
  role: roleArb,
  state: stateArb,
  isGuest: fc.boolean(),
  appearances: appearancesArb,
  ratingState: ratingStateArb,
});

/** A membership collection with **distinct** identities, as `GetSquad` returns. */
const membersArb = (
  minLength: number,
  maxLength: number,
): fc.Arbitrary<SquadMember[]> =>
  fc.uniqueArray(memberArb, {
    minLength,
    maxLength,
    selector: (member) => member.membershipId,
  });

const featuresArb: fc.Arbitrary<FeatureFlag[]> = fc.array(
  fc.record({
    feature: fc.constant('LiveMatchTracking' as const),
    isEnabled: fc.boolean(),
  }),
  { maxLength: 2 },
);

/** How a generated leaderboard's identities sit against the detail's. */
type Coverage = 'absent' | 'empty' | 'partial' | 'containing';

const COVERAGES: readonly Coverage[] = [
  'absent',
  'empty',
  'partial',
  'containing',
];

/** An identity no generated member carries, so `containing` is strict. */
const FOREIGN_IDENTITY = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

/** One generated composition input. */
interface CompositionCase {
  readonly detail: SquadDetail;
  readonly leaderboard: DisplayRatingLeaderboard | null;
  readonly coverage: Coverage;
}

const leaderboardArb = (
  coverage: Coverage,
  members: readonly SquadMember[],
): fc.Arbitrary<DisplayRatingLeaderboard | null> => {
  if (coverage === 'absent') {
    return fc.constant(null);
  }

  if (coverage === 'empty') {
    return fc.constant<DisplayRatingLeaderboard>({ entries: [] });
  }

  const identities = members.map((member) => member.membershipId);
  const coveredArb: fc.Arbitrary<readonly string[]> =
    coverage === 'containing'
      ? fc.constant([...identities, FOREIGN_IDENTITY])
      : identities.length === 0
        ? fc.constant([FOREIGN_IDENTITY])
        : fc.shuffledSubarray([...identities], {
            minLength: 0,
            maxLength: identities.length,
          });

  return coveredArb.chain((covered) =>
    fc
      .array(fc.tuple(nameArb, ratingValueArb), {
        minLength: covered.length,
        maxLength: covered.length,
      })
      .map<DisplayRatingLeaderboard>((decorations) => ({
        entries: covered.map<DisplayRatingEntry>((membershipId, index) => ({
          membershipId,
          displayName: decorations[index][0],
          value: decorations[index][1],
        })),
      })),
  );
};

const compositionCaseArb = (
  members: fc.Arbitrary<SquadMember[]>,
  coverages: readonly Coverage[] = COVERAGES,
): fc.Arbitrary<CompositionCase> =>
  fc
    .tuple(members, fc.constantFrom(...coverages), identityArb, nameArb, featuresArb)
    .chain(([collection, coverage, squadId, name, features]) =>
      leaderboardArb(coverage, collection).map((leaderboard) => ({
        detail: { squadId, name, members: collection, features },
        leaderboard,
        coverage,
      })),
    );

/** A Player_Row built directly, for the comparator's own algebra. */
const rowArb: fc.Arbitrary<PlayerListRow> = fc.record({
  membershipId: identityArb,
  displayName: nameArb,
  role: roleArb,
  state: stateArb,
  isGuest: fc.boolean(),
  appearances: appearancesArb,
  ratingState: ratingStateArb,
  // Generated inconsistently with the display name on purpose: the flag is not an
  // ordering key, so a row carrying a wrong one must still not move.
  isFormerPlayer: fc.boolean(),
  leaderboardObtained: fc.boolean(),
  ratingEntry: fc.option(
    fc.record({
      membershipId: identityArb,
      displayName: nameArb,
      value: ratingValueArb,
    }),
    { nil: null },
  ),
});

// ---------------------------------------------------------------------------
// 1. One row per Squad_Member, in the existing Player_Order.
// ---------------------------------------------------------------------------

// Feature: web-player-stats-screen, Property 40: The player list itself is
// unchanged
// Validates: Requirements 17.6
describe('composePlayerList — the row set and the Player_Order are as they were', () => {
  it('yields exactly one row per Squad_Member for every leaderboard coverage', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(membersArb(0, 20)),
        ({ detail, leaderboard }) => {
          const rows = composePlayerList(detail, leaderboard);

          // A multiset equality, so a dropped row and a duplicated one cannot
          // cancel out in the count.
          expect(rows).toHaveLength(detail.members.length);
          expect(identityMultisetOf(rows)).toEqual(
            identityMultisetOf(detail.members),
          );

          for (const member of detail.members) {
            expect(
              rows.filter((row) => row.membershipId === member.membershipId),
            ).toHaveLength(1);
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  it('agrees row-for-row with the pre-amendment oracle', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(membersArb(0, 20)),
        ({ detail, leaderboard }) => {
          // The oracle reads the original criteria through `Intl.Collator` and a
          // linear entry search, so agreement is evidence about the stated
          // composition rather than the implementation restated.
          expect(composePlayerList(detail, leaderboard)).toEqual([
            ...composeOracle(detail, leaderboard),
          ]);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('orders by state, then name, then identity, and by nothing the amendment reads', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(membersArb(0, 20)),
        ({ detail, leaderboard }) => {
          const rows = composePlayerList(detail, leaderboard);
          const firstInactive = rows.findIndex((row) => row.state !== 'Active');

          if (firstInactive !== -1) {
            expect(
              rows.slice(firstInactive).every((row) => row.state !== 'Active'),
            ).toBe(true);
          }

          for (let index = 1; index < rows.length; index += 1) {
            const previous = rows[index - 1];
            const current = rows[index];

            if (previous.state !== current.state) {
              continue;
            }

            const byName = baseCollator.compare(
              previous.displayName,
              current.displayName,
            );

            expect(byName).toBeLessThanOrEqual(0);

            if (byName === 0) {
              // Strict: identities are distinct within a squad, so a comparison
              // that gave up on two equal-collating names would be caught here.
              expect(previous.membershipId < current.membershipId).toBe(true);
            }
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  it('gives the same order for any permutation of the same membership collection', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(membersArb(0, 20)).chain((composition) =>
          fc.record({
            composition: fc.constant(composition),
            shuffled: fc.shuffledSubarray([...composition.detail.members], {
              minLength: composition.detail.members.length,
              maxLength: composition.detail.members.length,
            }),
          }),
        ),
        ({ composition, shuffled }) => {
          const { detail, leaderboard } = composition;

          expect(
            composePlayerList({ ...detail, members: shuffled }, leaderboard),
          ).toEqual([...composePlayerList(detail, leaderboard)]);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('composes an empty squad into no rows, whatever the leaderboard carries', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(fc.constant<SquadMember[]>([])),
        ({ detail, leaderboard }) => {
          expect(composePlayerList(detail, leaderboard)).toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// 2. The row shape is pinned: the amendment widened no row.
// ---------------------------------------------------------------------------

// Feature: web-player-stats-screen, Property 40: The player list itself is
// unchanged
// Validates: Requirements 17.6
describe('composePlayerList — a row carries exactly its pre-amendment properties', () => {
  it('carries the ten pre-amendment properties and no eleventh', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(membersArb(1, 16)),
        ({ detail, leaderboard }) => {
          for (const row of composePlayerList(detail, leaderboard)) {
            expect(Object.keys(row).slice().sort()).toEqual([
              ...PRE_AMENDMENT_ROW_KEYS,
            ]);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('carries no resolved presentation, band, or rating condition', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(membersArb(1, 16)),
        ({ detail, leaderboard }) => {
          // The four-condition decision is `selectRatingPresentation`'s, taken
          // from a member and the optional leaderboard. A row carrying it as well
          // would be a second place deciding it, and the two could then disagree.
          for (const row of composePlayerList(detail, leaderboard)) {
            const keys = Object.keys(row);

            for (const forbidden of FORBIDDEN_ROW_KEYS) {
              expect(keys).not.toContain(forbidden);
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('copies each member field through unchanged, the two the amendment reads included', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(membersArb(1, 16)),
        ({ detail, leaderboard }) => {
          const rows = composePlayerList(detail, leaderboard);

          for (const member of detail.members) {
            const row = rows.find(
              (candidate) => candidate.membershipId === member.membershipId,
            );

            expect(row).toBeDefined();
            expect(row?.displayName).toBe(member.displayName);
            expect(row?.role).toBe(member.role);
            expect(row?.state).toBe(member.state);
            expect(row?.isGuest).toBe(member.isGuest);
            // Carried, not interpreted: the composition reads neither of these,
            // and the amendment did not give it a reason to start.
            expect(row?.appearances).toBe(member.appearances);
            expect(row?.ratingState).toBe(member.ratingState);
            expect(row?.isFormerPlayer).toBe(
              member.displayName.trim() === PLACEHOLDER_LITERAL,
            );
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Neither field the amendment newly reads moves or removes a row.
// ---------------------------------------------------------------------------

// Feature: web-player-stats-screen, Property 40: The player list itself is
// unchanged
// Validates: Requirements 17.6
describe('composePlayerList — the amended fields decide nothing about the list', () => {
  it('keeps the identity sequence when every appearance count and rating state is rewritten', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(membersArb(0, 20)),
        fc.array(fc.tuple(appearancesArb, ratingStateArb), {
          minLength: 20,
          maxLength: 20,
        }),
        ({ detail, leaderboard }, rewrites) => {
          const rewritten: SquadDetail = {
            ...detail,
            members: detail.members.map((member, index) => ({
              ...member,
              appearances: rewrites[index % rewrites.length][0],
              ratingState: rewrites[index % rewrites.length][1],
            })),
          };

          const before = composePlayerList(detail, leaderboard);
          const after = composePlayerList(rewritten, leaderboard);

          // Nothing grouped, nothing reordered, nothing filtered: a never-played
          // or provisional row sits exactly where its name and identity put it.
          expect(identitiesOf(after)).toEqual(identitiesOf(before));
          expect(
            after.map((row) => ({
              ...row,
              appearances: 0,
              ratingState: null,
            })),
          ).toEqual(
            before.map((row) => ({
              ...row,
              appearances: 0,
              ratingState: null,
            })),
          );
        },
      ),
      { numRuns: 400 },
    );
  });

  it('keeps every row when no member has played and every rating is unestablished', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(membersArb(1, 20)),
        ({ detail, leaderboard }) => {
          const neverPlayed: SquadDetail = {
            ...detail,
            members: detail.members.map((member) => ({
              ...member,
              appearances: 0,
              ratingState: null,
            })),
          };
          const played: SquadDetail = {
            ...detail,
            members: detail.members.map((member) => ({
              ...member,
              appearances: 7,
              ratingState: 'Established' as const,
            })),
          };

          // A squad in its first week lists exactly the same players, in the same
          // places, as the same squad a season later.
          expect(
            identitiesOf(composePlayerList(neverPlayed, leaderboard)),
          ).toEqual(identitiesOf(composePlayerList(played, leaderboard)));
          expect(composePlayerList(neverPlayed, leaderboard)).toHaveLength(
            detail.members.length,
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it('orders identically whether or not the leaderboard landed', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(membersArb(0, 20), ['partial', 'containing']),
        ({ detail, leaderboard }) => {
          // The strongest form of "the rating is not an ordering key": a failed
          // leaderboard call must not rearrange the list under a reader.
          expect(identitiesOf(composePlayerList(detail, leaderboard))).toEqual(
            identitiesOf(composePlayerList(detail, null)),
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it('leaves the supplied membership collection untouched', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(membersArb(0, 20)),
        ({ detail, leaderboard }) => {
          const before = [...detail.members];

          composePlayerList(detail, leaderboard);

          expect(detail.members).toHaveLength(before.length);

          for (let index = 0; index < before.length; index += 1) {
            expect(detail.members[index]).toBe(before[index]);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
// 4. The comparator still induces the same total order.
// ---------------------------------------------------------------------------

// Feature: web-player-stats-screen, Property 40: The player list itself is
// unchanged
// Validates: Requirements 17.6
describe('comparePlayerRows — the same total order as before the amendment', () => {
  it('returns only -1, 0, or 1, and is antisymmetric', () => {
    fc.assert(
      fc.property(rowArb, rowArb, (left, right) => {
        const forward = comparePlayerRows(left, right);
        const backward = comparePlayerRows(right, left);

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

  it('is transitive over any three rows', () => {
    fc.assert(
      fc.property(rowArb, rowArb, rowArb, (first, second, third) => {
        const firstToSecond = comparePlayerRows(first, second);
        const secondToThird = comparePlayerRows(second, third);

        if (firstToSecond <= 0 && secondToThird <= 0) {
          expect(comparePlayerRows(first, third)).toBeLessThanOrEqual(0);
        }

        if (firstToSecond >= 0 && secondToThird >= 0) {
          expect(comparePlayerRows(first, third)).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('compares equal only for two rows carrying the same membership identity', () => {
    fc.assert(
      fc.property(rowArb, rowArb, (left, right) => {
        if (comparePlayerRows(left, right) === 0) {
          expect(left.membershipId).toBe(right.membershipId);
        }

        expect(comparePlayerRows(left, left)).toBe(0);
      }),
      { numRuns: 500 },
    );
  });

  it('agrees with the pre-amendment oracle on every pair of rows', () => {
    fc.assert(
      fc.property(rowArb, rowArb, (left, right) => {
        expect(comparePlayerRows(left, right)).toBe(compareOracle(left, right));
      }),
      { numRuns: 500 },
    );
  });

  it('ignores both fields the amendment reads, and every other non-key field', () => {
    fc.assert(
      fc.property(
        rowArb,
        rowArb,
        appearancesArb,
        ratingStateArb,
        roleArb,
        fc.boolean(),
        fc.boolean(),
        (left, right, appearances, ratingState, role, isGuest, isFormerPlayer) => {
          const rewrite = (row: PlayerListRow): PlayerListRow => ({
            ...row,
            appearances,
            ratingState,
            role,
            isGuest,
            isFormerPlayer,
            ratingEntry: null,
            leaderboardObtained: false,
          });

          // Rewriting all seven non-key fields on both rows must not move either:
          // the state, the name, and the identity are the whole order.
          expect(comparePlayerRows(rewrite(left), rewrite(right))).toBe(
            comparePlayerRows(left, right),
          );
        },
      ),
      { numRuns: 500 },
    );
  });

  it('ranks an active row before an inactive one whatever either has played', () => {
    fc.assert(
      fc.property(rowArb, rowArb, (left, right) => {
        const active: PlayerListRow = {
          ...left,
          state: 'Active',
          appearances: 0,
          ratingState: null,
        };
        const inactive: PlayerListRow = {
          ...right,
          state: 'Inactive',
          appearances: 300,
          ratingState: 'Established',
        };

        // The state key dominates, and a never-played active member still leads a
        // long-serving inactive one.
        expect(comparePlayerRows(active, inactive)).toBe(-1);
        expect(comparePlayerRows(inactive, active)).toBe(1);
      }),
      { numRuns: 400 },
    );
  });
});

// ---------------------------------------------------------------------------
// 5. The amendment issues no backend call (Requirement 17.7).
// ---------------------------------------------------------------------------

/** The feature's production modules: the set the scan binds. Test files excluded. */
const featureModules = squadsModules();

/** The three modules task 12 amended. */
const AMENDED_MODULES: readonly string[] = [
  'components/RatingBadge.tsx',
  'lib/messages.ts',
  'lib/ratingPresentation.ts',
];

/** The composition module, which task 12 was not supposed to touch at all. */
const playerListPath = join(squadsRoot, 'lib', 'playerList.ts');

/** The feature's own transport directory, for the amended modules' import check. */
const transportRoot = join(squadsRoot, 'api');

/** Path relative to the feature root, forward slashes, for a failure message. */
function featureRel(path: string): string {
  return relTo(squadsRoot, path);
}

/**
 * The `GetPlayerProfile` operation, as a string literal and as the identifier the
 * player-stats seam names its method with. Both patterns read comment-stripped
 * source, so a docblock discussing the operation is not a finding — these
 * modules' docblocks discuss it at length.
 */
const OPERATION_LITERAL = /\bGetPlayerProfile\b/;
const OPERATION_IDENTIFIER = /\bgetPlayerProfile\b/i;

describe('the Player_List issues no GetPlayerProfile call (Requirement 17.7)', () => {
  it('is not vacuous: the scan sees the feature, the amended modules among them', () => {
    const names = featureModules.map(featureRel);

    expect(names.length).toBeGreaterThan(40);

    for (const amended of AMENDED_MODULES) {
      expect(names).toContain(amended);
    }

    expect(names).toContain('lib/playerList.ts');
  });

  it('is not vacuous: the operation name is one the player-stats feature really issues', () => {
    // If the pattern were misspelt, every prohibition below would pass for the
    // wrong reason. The feature that *does* issue the call is scanned with the
    // same patterns, so a typo fails here rather than passing everywhere.
    const issuing = collectProductionSources(playerStatsRoot).filter(
      (file) =>
        OPERATION_LITERAL.test(readWithoutComments(file)) ||
        OPERATION_IDENTIFIER.test(readCodeOnly(file)),
    );

    expect(issuing.length).toBeGreaterThan(0);
  });

  it('names the operation in no production module of the squads feature', () => {
    // The four bands are resolved from the Appearance_Count and the
    // Rating_State_Signal `GetSquad` already sends, so the amendment needed no
    // further call — and made none.
    const offenders = featureModules
      .filter(
        (file) =>
          OPERATION_LITERAL.test(readWithoutComments(file)) ||
          OPERATION_IDENTIFIER.test(readCodeOnly(file)),
      )
      .map(featureRel);

    expect(offenders).toEqual([]);
  });

  it('imports nothing from the player-stats feature', () => {
    // The published seam runs one way: player-stats imports this feature's
    // barrel, and nothing here reaches back — so the Player_List cannot have
    // acquired that feature's transport by importing it.
    const offenders = featureModules.flatMap((file) =>
      inAppImports(file)
        .filter(({ target }) => isWithin(playerStatsRoot, target))
        .map(({ specifier }) => ({ module: featureRel(file), specifier })),
    );

    expect(offenders).toEqual([]);
  });

  it('has the three amended modules reach no transport at all', () => {
    // Stronger than "no profile call": none of the three names the feature's own
    // facade either, so the amendment issues no call of any kind. Labels, a pure
    // selection, and a badge — nothing that could await a response.
    const offenders: Array<{ module: string; specifier: string }> = [];

    for (const amended of AMENDED_MODULES) {
      const file = join(squadsRoot, ...amended.split('/'));

      for (const { specifier, target } of inAppImports(file)) {
        if (isWithin(transportRoot, target)) {
          offenders.push({ module: amended, specifier });
        }
      }

      const code = readCodeOnly(file);

      expect(code, `${amended} must name no Squads_Api`).not.toMatch(
        /\bSquadsApi\b|\bapiClient\b/,
      );
      expect(code, `${amended} must perform no bare transport`).not.toMatch(
        /\bfetch\b|\bXMLHttpRequest\b/,
      );
    }

    expect(offenders).toEqual([]);
  });

  it('leaves the composition module independent of the amended presentation', () => {
    // `lib/playerList.ts` was outside task 12's three-file footprint, and this is
    // the structural half of that: it imports neither the amended selection nor
    // the band labels, so composing a list cannot have started depending on what
    // a row says about a rating.
    const imported = inAppImports(playerListPath).map(({ target }) => target);

    for (const forbidden of ['lib/ratingPresentation', 'lib/messages']) {
      expect(
        imported.some((target) => target.endsWith(forbidden)),
        `lib/playerList.ts must not import ${forbidden}`,
      ).toBe(false);
    }

    const code = readCodeOnly(playerListPath);

    expect(code).not.toMatch(/\bselectRatingPresentation\b/);
    expect(code).not.toMatch(/\bRatingPresentation\b/);
    expect(code).not.toMatch(/\bBAND_LABEL\b/);
  });
});
