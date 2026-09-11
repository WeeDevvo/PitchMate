import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  comparePlayerRows,
  composePlayerList,
  type PlayerListRow,
} from './playerList';
import type { MemberRole, MembershipStateValue } from './enumCodes';
import type { FeatureFlag } from './parse/featureFlags';
import type {
  DisplayRatingEntry,
  DisplayRatingLeaderboard,
} from './parse/leaderboard';
import type { SquadDetail, SquadMember } from './parse/squadDetail';

/**
 * Property tests for the Player_List composition and the Player_Order, beside the
 * module they cover as the design's Testing Strategy asks, and running well above
 * the 100-iteration floor (Requirement 20.1).
 *
 * Four claims are made, and Requirements 20.4, 20.5, and 20.6 ask for three of
 * them by name:
 *
 * - **The row set is `detail.members`, in the same multiplicity, and nothing
 *   else.** The leaderboard is generated *disjoint from*, *overlapping with*, and
 *   *strictly containing* the detail's membership identities, because that is the
 *   direction the criterion runs in: `GetSquad` decides who is in the squad and
 *   the leaderboard only decorates them, so a ranked entry for a membership the
 *   detail does not carry must contribute no row (Requirement 7.2). Foreign
 *   entries carry deliberately recognisable display names, so "no player identity
 *   is rendered from the leaderboard alone" can be asserted as a fact about the
 *   composed rows rather than inferred from the row count.
 * - **Composing the same inputs twice yields equal results** (Requirement 20.5),
 *   the composition never writes to the collection it was handed, and it composes
 *   a frozen one — the collection a screen holds is the parsed one, and ordering it
 *   for rendering must not reorder what the screen is holding.
 * - **The Player_Order is a total order determined solely by its input**
 *   (Requirement 20.6): active before inactive, then display name ascending
 *   case-insensitively, then membership identity ascending, asserted against an
 *   independently written oracle and driven through permutations of one input.
 * - **Nothing else is an ordering key.** The row's rating is generated
 *   independently of its identity and the Former_Player flag is generated
 *   *inconsistently* with the display name, so a comparison that sorted by either
 *   would be caught rather than accidentally agreeing. The strongest form of this:
 *   the identity sequence is the same whether the leaderboard landed or not, so a
 *   failed leaderboard call cannot rearrange the list.
 *
 * The oracle is written from the acceptance criteria by a different route than the
 * module takes — an `Intl.Collator` rather than `String.prototype.localeCompare`,
 * a linear search over the entries rather than an indexed map, and the placeholder
 * name as a literal rather than through the exported constant — so agreement is
 * evidence about the criterion and not the implementation restated.
 *
 * The row shape asserted here is the module's own: `leaderboardObtained` plus the
 * raw `ratingEntry`, the documented deviation from the design's `rating`
 * field. Choosing between a Display_Rating, a Provisional_Band, and a
 * Rating_Unavailable label is Requirement 8's business and is claimed by
 * Property 19 beside `lib/ratingPresentation.ts`.
 *
 * Deliberately **not** claimed here: that the rows reach the screen (Properties 1
 * and 16, at the rendering site), the placeholder predicate's own boundaries
 * (Property 17), or anything about the rating presentation.
 */

// --- the oracle --------------------------------------------------------------

/**
 * The case-insensitive name comparison of Requirement 7.4, expressed
 * independently of the module: an `Intl.Collator` at base sensitivity rather than
 * `String.prototype.localeCompare` with the same option. Same collation, a
 * different route to it.
 */
const baseCollator = new Intl.Collator(undefined, { sensitivity: 'base' });

/**
 * The Anonymised_Placeholder written as a literal rather than imported, so a
 * change to the exported constant cannot silently move this oracle with it.
 */
const PLACEHOLDER_LITERAL = 'Former player';

/** The Player_Order written from Requirement 7.4, key by key. */
function compareOracle(left: PlayerListRow, right: PlayerListRow): number {
  const leftActive = left.state === 'active' ? 0 : 1;
  const rightActive = right.state === 'active' ? 0 : 1;

  if (leftActive !== rightActive) {
    return leftActive < rightActive ? -1 : 1;
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

/**
 * The Player_List written from Requirements 7.2 and 7.4: one row per member of
 * the detail, decorated by the *first* entry whose identity is exactly equal,
 * found by linear search rather than through an index, then ordered.
 */
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

/** Every property a `PlayerListRow` carries, and no other. */
const ROW_KEYS: readonly string[] = [
  'displayName',
  'isFormerPlayer',
  'isGuest',
  'leaderboardObtained',
  'membershipId',
  'ratingEntry',
  'role',
  'state',
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
 * Families of display names that collate **equal** at base sensitivity: letter
 * case and accent differences only. A squad genuinely contains these — the
 * product requires names to be distinct within a squad, and "Dave" and "dave"
 * are distinct names — so equal-collating rows are the common input rather than a
 * corner, and the identity tie-break is what separates them.
 */
const NAME_FAMILIES: readonly (readonly string[])[] = [
  ['dave', 'Dave', 'DAVE', 'dAvE', 'dāve', 'dàve'],
  ['big dave', 'Big Dave', 'BIG DAVE'],
  ['sam', 'Sam', 'SAM', 'sám'],
  ['élan', 'Élan', 'ELAN', 'elan'],
];

/** One member of one family, so equal-collating names turn up constantly. */
const familyNameArb: fc.Arbitrary<string> = fc
  .constantFrom(...NAME_FAMILIES)
  .chain((family) => fc.constantFrom(...family));

/**
 * A Player_Display_Name. Weighted towards the tie families and the placeholder
 * and its near misses — an erased membership is an ordinary row here, ordered by
 * the same keys as any other — then arbitrary text, because the composition must
 * be total over whatever the backend calls a player.
 */
const nameArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: familyNameArb },
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      'Former player',
      ' Former player ',
      'former player',
      'FORMER PLAYER',
      'Former  player',
      'Former players',
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
      '🙈 keeper',
      'player'.repeat(20),
    ),
  },
  { weight: 3, arbitrary: fc.string({ minLength: 0, maxLength: 24 }) },
);

/**
 * Display names only a *foreign* leaderboard entry carries — one no member name
 * can be, since `nameArb` draws from printable ASCII and these families. Their
 * absence from every composed row is what makes "no player identity is rendered
 * from the leaderboard alone" a checkable statement (Requirements 7.2, 7.11).
 */
const FOREIGN_NAMES: readonly string[] = [
  '⟨leaderboard only ⅰ⟩',
  '⟨leaderboard only ⅱ⟩',
  '⟨leaderboard only ⅲ⟩',
];

const foreignNameArb: fc.Arbitrary<string> = fc.constantFrom(...FOREIGN_NAMES);

/** A Member_Role, including the `null` a guest membership carries (16.8). */
const roleArb: fc.Arbitrary<MemberRole | null> = fc.constantFrom(
  'owner' as const,
  'admin' as const,
  'member' as const,
  null,
);

/** A Membership_State; never absent, since a membership always has one. */
const stateArb: fc.Arbitrary<MembershipStateValue> = fc.constantFrom(
  'active' as const,
  'inactive' as const,
);

/** A finite leaderboard value, as the parser reads one. */
const ratingValueArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 3, arbitrary: fc.integer({ min: -2000, max: 3000 }) },
  {
    weight: 1,
    arbitrary: fc.double({ min: -5000, max: 5000, noNaN: true }),
  },
  { weight: 1, arbitrary: fc.constantFrom(0, -0, 0.5, -0.5, 1.5) },
);

/** A Squad_Member with generated role, state, and Guest_Flag. */
const memberArb = (
  membershipIdArb: fc.Arbitrary<string>,
): fc.Arbitrary<SquadMember> =>
  fc.record({
    membershipId: membershipIdArb,
    displayName: nameArb,
    role: roleArb,
    state: stateArb,
    isGuest: fc.boolean(),
  });

/**
 * A membership collection with **distinct** identities — the form `GetSquad`
 * returns, and the precondition under which the Player_Order is a *strict* total
 * order.
 */
const membersArb = (
  minLength: number,
  maxLength: number,
): fc.Arbitrary<SquadMember[]> =>
  fc.uniqueArray(memberArb(identityArb), {
    minLength,
    maxLength,
    selector: (member) => member.membershipId,
  });

const featuresArb: fc.Arbitrary<FeatureFlag[]> = fc.array(
  fc.record({
    feature: fc.constant('live-match-tracking' as const),
    isEnabled: fc.boolean(),
  }),
  { maxLength: 2 },
);

/**
 * A Squad_Detail around a membership collection. The squad identity, the squad
 * name, and the feature flags are generated too, so a composition that read any
 * of them into a row would be caught.
 */
const detailArb = (
  members: readonly SquadMember[],
): fc.Arbitrary<SquadDetail> =>
  fc.record({
    squadId: identityArb,
    name: nameArb,
    members: fc.constant(members),
    features: featuresArb,
  });

/** A Squad_Detail around an explicit membership collection, for worked examples. */
const detailOf = (members: readonly SquadMember[]): SquadDetail => ({
  squadId: '11111111-1111-4111-8111-111111111111',
  name: 'Sunday League',
  members,
  features: [],
});

/** Leaderboard entries for exactly these identities, in this order. */
const entriesForArb = (
  identities: readonly string[],
  displayNameArb: fc.Arbitrary<string>,
): fc.Arbitrary<DisplayRatingEntry[]> =>
  fc
    .array(fc.record({ displayName: displayNameArb, value: ratingValueArb }), {
      minLength: identities.length,
      maxLength: identities.length,
    })
    .map((decorations) =>
      identities.map((membershipId, index) => ({
        membershipId,
        displayName: decorations[index].displayName,
        value: decorations[index].value,
      })),
    );

/**
 * How a generated leaderboard's identities sit against the detail's — the three
 * relationships Requirement 20.4 and Property 14 name, plus the two absences that
 * bracket them.
 */
type Relationship =
  | 'absent'
  | 'empty'
  | 'disjoint'
  | 'overlapping'
  | 'containing'
  | 'exact';

const RELATIONSHIPS: readonly Relationship[] = [
  'absent',
  'empty',
  'disjoint',
  'overlapping',
  'containing',
  'exact',
];

/** Whether a relationship puts entries for identities the detail does not carry. */
const usesForeign = (relationship: Relationship): boolean =>
  relationship === 'disjoint' ||
  relationship === 'overlapping' ||
  relationship === 'containing';

/** The member identities a relationship gives an entry to. */
const matchedIdentitiesArb = (
  relationship: Relationship,
  memberIdentities: readonly string[],
): fc.Arbitrary<readonly string[]> => {
  switch (relationship) {
    case 'absent':
    case 'empty':
    case 'disjoint':
      return fc.constant([]);
    case 'overlapping':
      return memberIdentities.length === 0
        ? fc.constant([])
        : fc.shuffledSubarray([...memberIdentities], {
            minLength: 0,
            maxLength: memberIdentities.length,
          });
    case 'containing':
    case 'exact':
      return fc.constant(memberIdentities);
  }
};

/**
 * A leaderboard carrying an entry for each supplied identity, shuffled — the
 * backend ranks its entries, so the composition must not depend on that order.
 * Identities within one leaderboard are distinct, as a parsed one's are
 * (Requirement 8.11).
 */
const leaderboardArb = (
  relationship: Relationship,
  matchedIdentities: readonly string[],
  foreignIdentities: readonly string[],
): fc.Arbitrary<DisplayRatingLeaderboard | null> => {
  if (relationship === 'absent') {
    return fc.constant(null);
  }

  return fc
    .tuple(
      entriesForArb(matchedIdentities, nameArb),
      entriesForArb(foreignIdentities, foreignNameArb),
    )
    .chain(([matchedEntries, foreignEntries]) => {
      const all = [...matchedEntries, ...foreignEntries];

      if (all.length === 0) {
        return fc.constant<DisplayRatingLeaderboard>({ entries: [] });
      }

      return fc
        .shuffledSubarray(all, { minLength: all.length, maxLength: all.length })
        .map<DisplayRatingLeaderboard>((entries) => ({ entries }));
    });
};

/** One generated composition input, with the relationship it was built for. */
interface CompositionCase {
  readonly detail: SquadDetail;
  readonly leaderboard: DisplayRatingLeaderboard | null;
  readonly relationship: Relationship;
  /** Leaderboard identities the detail does not carry; empty unless in use. */
  readonly foreignIdentities: readonly string[];
}

/**
 * Reached only if a generated foreign identity collided with a generated member
 * identity, which two random version-4 identities do not. It keeps the generator
 * total: a collision degrades `containing` to a non-strict containment rather
 * than producing an empty foreign set the assertions would read as a bug.
 */
const FOREIGN_FALLBACK_IDENTITY = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

const compositionCaseArb = (
  members: fc.Arbitrary<SquadMember[]>,
  relationships: readonly Relationship[] = RELATIONSHIPS,
): fc.Arbitrary<CompositionCase> =>
  fc
    .tuple(
      members,
      fc.uniqueArray(identityArb, { minLength: 1, maxLength: 6 }),
      fc.constantFrom(...relationships),
    )
    .chain(([memberCollection, foreignPool, relationship]) => {
      const claimed = new Set(
        memberCollection.map((member) => member.membershipId),
      );
      const candidates = [...foreignPool, FOREIGN_FALLBACK_IDENTITY].filter(
        (identity) => !claimed.has(identity),
      );
      const foreignIdentities = usesForeign(relationship)
        ? candidates.slice(0, Math.max(1, foreignPool.length))
        : [];

      return fc
        .tuple(
          detailArb(memberCollection),
          matchedIdentitiesArb(
            relationship,
            memberCollection.map((member) => member.membershipId),
          ),
        )
        .chain(([detail, matchedIdentities]) =>
          leaderboardArb(relationship, matchedIdentities, foreignIdentities).map(
            (leaderboard) => ({
              detail,
              leaderboard,
              relationship,
              foreignIdentities,
            }),
          ),
        );
    });

/** A Player_Row built directly, for the comparator's own algebra. */
const rowArb: fc.Arbitrary<PlayerListRow> = fc.record({
  membershipId: identityArb,
  displayName: nameArb,
  role: roleArb,
  state: stateArb,
  isGuest: fc.boolean(),
  // Generated independently of the display name on purpose: the flag is not an
  // ordering key, so an inconsistent one must not move a row.
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

/** A 200-member squad whose display names repeat heavily. */
const largeMembersArb: fc.Arbitrary<SquadMember[]> = fc
  .uniqueArray(fc.uuid(), { minLength: 200, maxLength: 200 })
  .map((identities) =>
    identities.map((membershipId, index) => ({
      membershipId,
      // Five names across 200 memberships: forty rows per name, so the identity
      // tie-break decides almost the whole order.
      displayName: ['dave', 'Dave', 'DAVE', 'Former player', 'sám'][index % 5],
      role: (index % 4 === 0 ? null : 'member') as MemberRole | null,
      state: (index % 3 === 0 ? 'inactive' : 'active') as MembershipStateValue,
      isGuest: index % 4 === 0,
    })),
  );

// Feature: web-squads-screens, Property 14: The Player_List holds exactly one row
// per Squad_Member
// Validates: Requirements 7.2, 7.3, 20.1, 20.4
describe('composePlayerList — exactly one row per Squad_Member, whatever the leaderboard carries', () => {
  it('holds one row per Squad_Member for every leaderboard relationship', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(membersArb(0, 24)),
        ({ detail, leaderboard }) => {
          const rows = composePlayerList(detail, leaderboard);

          // Requirement 20.4 as a multiset equality, so a row that was dropped and
          // a row that was duplicated cannot cancel out in the count.
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

  it('renders no row for a leaderboard identity matching no Squad_Member', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(membersArb(0, 24), [
          'disjoint',
          'overlapping',
          'containing',
        ]),
        ({ detail, leaderboard, foreignIdentities }) => {
          const rows = composePlayerList(detail, leaderboard);
          const rendered = new Set(identitiesOf(rows));

          // The leaderboard is ranked by the backend and may legitimately carry a
          // membership this detail does not — a stale read, or a membership removed
          // between the two concurrent calls. None of it becomes a player.
          expect(foreignIdentities.length).toBeGreaterThan(0);

          for (const foreign of foreignIdentities) {
            expect(rendered.has(foreign)).toBe(false);
          }

          for (const row of rows) {
            // Requirement 7.11 read structurally: not one name on screen came from
            // the leaderboard, only from `GetSquad`.
            expect(FOREIGN_NAMES).not.toContain(row.displayName);

            if (row.ratingEntry !== null) {
              // Nor did a row get *decorated* from a foreign entry: the decoration
              // is matched by identity, so a mismatched one reaches no row.
              expect(FOREIGN_NAMES).not.toContain(row.ratingEntry.displayName);
            }
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  it('copies each Squad_Member field onto its row and adds no other property', () => {
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
            // A name reaches the screen exactly as parsed: no trimming, no casing,
            // no truncation. Compared strictly, so a reformatted name fails here.
            expect(row?.displayName).toBe(member.displayName);
            expect(row?.role).toBe(member.role);
            expect(row?.state).toBe(member.state);
            expect(row?.isGuest).toBe(member.isGuest);
            expect(row?.isFormerPlayer).toBe(
              member.displayName.trim() === PLACEHOLDER_LITERAL,
            );
            expect(Object.keys(row ?? {}).slice().sort()).toEqual([...ROW_KEYS]);
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  it('composes the empty membership collection into no rows at all', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(fc.constant<SquadMember[]>([])),
        ({ detail, leaderboard }) => {
          // Requirement 7.12's empty state is a *composition* fact first: an empty
          // squad plus a leaderboard full of entries is still an empty list.
          expect(composePlayerList(detail, leaderboard)).toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('composes a single membership into a single row', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(membersArb(1, 1)),
        ({ detail, leaderboard }) => {
          const rows = composePlayerList(detail, leaderboard);

          expect(rows).toHaveLength(1);
          expect(rows[0].membershipId).toBe(detail.members[0].membershipId);
          expect(rows).toEqual(composeOracle(detail, leaderboard));
        },
      ),
      { numRuns: 300 },
    );
  });

  it('composes a 200-member squad whose display names repeat', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(largeMembersArb),
        ({ detail, leaderboard }) => {
          const rows = composePlayerList(detail, leaderboard);

          // Larger than any real squad, and the size at which forty rows sharing a
          // name make the identity tie-break the whole order.
          expect(rows).toHaveLength(200);
          expect(identityMultisetOf(rows)).toEqual(
            identityMultisetOf(detail.members),
          );
          expect(new Set(identitiesOf(rows)).size).toBe(200);
          expect(rows).toEqual(composeOracle(detail, leaderboard));
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: web-squads-screens, Property 14: The Player_List holds exactly one row
// per Squad_Member
// Validates: Requirements 7.2, 7.3, 20.4
describe('composePlayerList — the leaderboard decorates the rows, never defines them', () => {
  it('decorates a row exactly when the leaderboard carries its identity, with the entry as parsed', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(membersArb(0, 24)),
        ({ detail, leaderboard }) => {
          const rows = composePlayerList(detail, leaderboard);

          for (const row of rows) {
            const expected =
              leaderboard === null
                ? null
                : (leaderboard.entries.find(
                    (entry) => entry.membershipId === row.membershipId,
                  ) ?? null);

            // `toBe`, not `toEqual`: the row carries the parsed entry itself, so no
            // rounding or reshaping happened on the way through — that decision
            // belongs to the rating presentation (Requirement 8.6).
            expect(row.ratingEntry).toBe(expected);
            expect(row.leaderboardObtained).toBe(leaderboard !== null);
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  it('leaves every row undecorated when the leaderboard identities are disjoint', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(membersArb(1, 20), ['disjoint']),
        ({ detail, leaderboard }) => {
          const decorated = composePlayerList(detail, leaderboard);
          const undecorated = composePlayerList(detail, null);

          for (const row of decorated) {
            expect(row.ratingEntry).toBeNull();
            // The leaderboard *was* obtained — it simply names nobody here — which
            // is a different fact from the failed call of Requirement 7.10.
            expect(row.leaderboardObtained).toBe(true);
          }

          // Identical rows apart from that one flag, so an entry for a stranger
          // changes nothing else about the list.
          expect(
            decorated.map((row) => ({ ...row, leaderboardObtained: false })),
          ).toEqual([...undecorated]);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('decorates every row when the leaderboard strictly contains the membership', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(membersArb(1, 20), ['containing']),
        ({ detail, leaderboard, foreignIdentities }) => {
          const rows = composePlayerList(detail, leaderboard);
          const entries = leaderboard?.entries ?? [];

          // Strict containment: an entry for everybody, plus entries for
          // memberships this squad does not have.
          expect(entries.length).toBe(
            detail.members.length + foreignIdentities.length,
          );
          expect(entries.length).toBeGreaterThan(rows.length);

          for (const row of rows) {
            expect(row.ratingEntry).not.toBeNull();
            expect(row.ratingEntry?.membershipId).toBe(row.membershipId);
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  it('decorates exactly the overlap when the identities partly meet', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(membersArb(1, 20), ['overlapping']),
        ({ detail, leaderboard }) => {
          const rows = composePlayerList(detail, leaderboard);
          const ranked = new Set(
            (leaderboard?.entries ?? []).map((entry) => entry.membershipId),
          );

          for (const row of rows) {
            expect(row.ratingEntry !== null).toBe(ranked.has(row.membershipId));
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  it('does not match a leaderboard identity that differs only in letter case', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 8 }),
        nameArb,
        (identities, displayName) => {
          const cased = identities.filter(
            (identity) => identity.toUpperCase() !== identity,
          );

          fc.pre(cased.length > 0);

          const members: SquadMember[] = cased.map((membershipId) => ({
            membershipId,
            displayName,
            role: 'member' as const,
            state: 'active' as const,
            isGuest: false,
          }));
          const entries: DisplayRatingEntry[] = cased.map(
            (membershipId, index) => ({
              membershipId: membershipId.toUpperCase(),
              displayName: FOREIGN_NAMES[0],
              value: index,
            }),
          );

          // Requirement 8.1 matches identities *exactly*: an identity is opaque
          // here, so it is neither trimmed nor case-folded before comparison, and a
          // case-variant entry is as foreign as any other.
          for (const row of composePlayerList(detailOf(members), { entries })) {
            expect(row.ratingEntry).toBeNull();
            expect(row.leaderboardObtained).toBe(true);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('reads an empty leaderboard as obtained and decorating nobody', () => {
    fc.assert(
      fc.property(membersArb(0, 12), (members) => {
        const rows = composePlayerList(detailOf(members), { entries: [] });

        for (const row of rows) {
          expect(row.leaderboardObtained).toBe(true);
          expect(row.ratingEntry).toBeNull();
        }

        expect(rows).toHaveLength(members.length);
      }),
      { numRuns: 200 },
    );
  });
});

// Feature: web-squads-screens, Property 14: composing the same inputs twice yields
// equal results
// Validates: Requirements 7.3, 20.1, 20.5
describe('composePlayerList — the composition is deterministic and leaves its input alone', () => {
  it('yields equal results for two compositions of the same inputs', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(membersArb(0, 24)),
        ({ detail, leaderboard }) => {
          const first = composePlayerList(detail, leaderboard);
          const second = composePlayerList(detail, leaderboard);

          // Requirement 20.5. A screen composes on every render; two renders
          // holding the same parsed values must not disagree about the list.
          expect(second).toEqual([...first]);
          expect(identitiesOf(second)).toEqual(identitiesOf(first));

          for (let index = 0; index < first.length; index += 1) {
            expect(second[index].ratingEntry).toBe(first[index].ratingEntry);
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  it('agrees row-for-row with an independently written oracle', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(membersArb(0, 24)),
        ({ detail, leaderboard }) => {
          // The oracle reads the criteria through `Intl.Collator` and a linear
          // entry search, so this checks the stated composition rather than the
          // implementation restated.
          expect(composePlayerList(detail, leaderboard)).toEqual([
            ...composeOracle(detail, leaderboard),
          ]);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('does not reorder or otherwise touch the supplied membership collection', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(membersArb(0, 24)),
        ({ detail, leaderboard }) => {
          const before = [...detail.members];

          composePlayerList(detail, leaderboard);

          // The parsed collection is what a screen holds in state; composing it for
          // rendering must not rearrange what the screen is holding.
          expect(detail.members).toHaveLength(before.length);

          for (let index = 0; index < before.length; index += 1) {
            expect(detail.members[index]).toBe(before[index]);
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  it('composes a frozen membership collection and a frozen leaderboard', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(membersArb(0, 20)),
        ({ detail, leaderboard }) => {
          const frozenDetail: SquadDetail = Object.freeze({
            ...detail,
            members: Object.freeze([...detail.members]),
          });
          const frozenLeaderboard =
            leaderboard === null
              ? null
              : Object.freeze({
                  entries: Object.freeze([...leaderboard.entries]),
                });

          // An in-place sort of the caller's array would raise on a frozen array;
          // this passes only because the composition maps to a fresh collection
          // before ordering it.
          expect(composePlayerList(frozenDetail, frozenLeaderboard)).toEqual([
            ...composeOracle(detail, leaderboard),
          ]);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('is unaffected by the order the leaderboard ranked its entries in', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(membersArb(1, 20), [
          'overlapping',
          'containing',
          'exact',
        ]).chain((composition) =>
          fc.record({
            composition: fc.constant(composition),
            reranked: fc.shuffledSubarray(
              [...(composition.leaderboard?.entries ?? [])],
              {
                minLength: composition.leaderboard?.entries.length ?? 0,
                maxLength: composition.leaderboard?.entries.length ?? 0,
              },
            ),
          }),
        ),
        ({ composition, reranked }) => {
          const { detail, leaderboard } = composition;

          // A parsed leaderboard carries at most one entry per membership
          // (Requirement 8.11), so the ranking order it arrived in decides nothing.
          expect(composePlayerList(detail, { entries: reranked })).toEqual([
            ...composePlayerList(detail, leaderboard),
          ]);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('resolves a repeated leaderboard identity to the first entry, deterministically', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        nameArb,
        fc.array(ratingValueArb, { minLength: 2, maxLength: 5 }),
        (membershipId, displayName, values) => {
          const members: SquadMember[] = [
            {
              membershipId,
              displayName,
              role: 'member',
              state: 'active',
              isGuest: false,
            },
          ];
          const entries = values.map((value, index) => ({
            membershipId,
            displayName: `${displayName}#${index}`,
            value,
          }));
          const rows = composePlayerList(detailOf(members), { entries });

          // The parser rejects such a body outright (Requirement 8.11), so this is
          // unreachable through it. The claim is only that the function is
          // deterministic for *every* input, not just parser-produced ones.
          expect(rows).toHaveLength(1);
          expect(rows[0].ratingEntry).toBe(entries[0]);
          expect(
            composePlayerList(detailOf(members), { entries })[0].ratingEntry,
          ).toBe(entries[0]);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// Feature: web-squads-screens, Property 15 (pure half): the Player_Order is a
// total order determined solely by its input
// Validates: Requirements 7.4, 20.6
describe('composePlayerList — the rows come back in the Player_Order', () => {
  it('places every active membership before every inactive one, then orders by name, then by identity', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(membersArb(0, 24)),
        ({ detail, leaderboard }) => {
          const rows = composePlayerList(detail, leaderboard);
          const lastActive = rows.reduce(
            (latest, row, index) => (row.state === 'active' ? index : latest),
            -1,
          );
          const firstInactive = rows.findIndex((row) => row.state !== 'active');

          // 7.4, first key: no inactive row precedes an active one.
          if (firstInactive !== -1) {
            expect(lastActive).toBeLessThan(firstInactive);
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

            // 7.4, second key: ascending under a case-insensitive comparison.
            expect(byName).toBeLessThanOrEqual(0);

            if (byName === 0) {
              // 7.4, third key, and *strict*: identities are distinct within a
              // squad, so a comparison that gave up on two equal-collating names
              // would be caught here rather than passing as "non-decreasing".
              expect(previous.membershipId < current.membershipId).toBe(true);
            }
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  it('gives the same order for any two permutations of the same membership collection', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(membersArb(0, 24)).chain((composition) =>
          fc.record({
            composition: fc.constant(composition),
            firstShuffle: fc.shuffledSubarray([...composition.detail.members], {
              minLength: composition.detail.members.length,
              maxLength: composition.detail.members.length,
            }),
            secondShuffle: fc.shuffledSubarray([...composition.detail.members], {
              minLength: composition.detail.members.length,
              maxLength: composition.detail.members.length,
            }),
          }),
        ),
        ({ composition, firstShuffle, secondShuffle }) => {
          const { detail, leaderboard } = composition;
          const supplied = composePlayerList(detail, leaderboard);

          // Requirement 20.6: `GetSquad` promises no ordering, so a person must not
          // see the list rearrange between two loads of the same squad.
          expect(
            composePlayerList({ ...detail, members: firstShuffle }, leaderboard),
          ).toEqual([...supplied]);
          expect(
            composePlayerList({ ...detail, members: secondShuffle }, leaderboard),
          ).toEqual([...supplied]);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('orders a reversed collection and an already-ordered one identically', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(membersArb(0, 24)),
        ({ detail, leaderboard }) => {
          const rows = composePlayerList(detail, leaderboard);
          const reversed = composePlayerList(
            { ...detail, members: [...detail.members].reverse() },
            leaderboard,
          );

          // Two adversarial supplied orders: the exact reverse of the wanted one,
          // and the wanted one itself, so re-composing after a re-render is a no-op.
          expect(reversed).toEqual([...rows]);
          expect(identitiesOf(reversed)).toEqual(identitiesOf(rows));
          expect(
            identitiesOf(
              composePlayerList({ ...detail, members: rows }, leaderboard),
            ),
          ).toEqual(identitiesOf(rows));
        },
      ),
      { numRuns: 400 },
    );
  });

  it('orders identically whether or not the leaderboard landed', () => {
    fc.assert(
      fc.property(
        compositionCaseArb(membersArb(0, 24), [
          'overlapping',
          'containing',
          'exact',
        ]),
        ({ detail, leaderboard }) => {
          // The strongest form of "nothing else is an ordering key": sorting by
          // rating would make the order depend on whether a concurrent call
          // happened to land, so a failed leaderboard would rearrange the list
          // under a person mid-load (Requirement 7.10).
          expect(identitiesOf(composePlayerList(detail, leaderboard))).toEqual(
            identitiesOf(composePlayerList(detail, null)),
          );
        },
      ),
      { numRuns: 400 },
    );
  });

  it('orders a worked example: active first, case-insensitively by name, then by identity', () => {
    const rows = composePlayerList(
      detailOf([
        {
          membershipId: 'c',
          displayName: 'Zoe',
          role: 'member',
          state: 'active',
          isGuest: false,
        },
        {
          membershipId: 'a',
          displayName: 'alex',
          role: 'owner',
          state: 'inactive',
          isGuest: false,
        },
        {
          membershipId: 'e',
          displayName: 'dave',
          role: null,
          state: 'active',
          isGuest: true,
        },
        {
          membershipId: 'b',
          displayName: 'Dave',
          role: 'admin',
          state: 'active',
          isGuest: false,
        },
      ]),
      null,
    );

    // Read by eye: 'alex' would lead under a name-only order and 'Dave' would
    // follow 'Zoe' under a case-sensitive one. Both are wrong, and the two Daves
    // are separated by identity rather than by arrival.
    expect(rows.map((row) => `${row.displayName}/${row.membershipId}`)).toEqual([
      'Dave/b',
      'dave/e',
      'Zoe/c',
      'alex/a',
    ]);
  });
});

// Feature: web-squads-screens, Property 15 (pure half): the Player_Order is a
// total order determined solely by its input
// Validates: Requirements 7.4, 20.6
describe('comparePlayerRows — the comparison is a total order', () => {
  it('returns only -1, 0, or 1, and is antisymmetric over any two rows', () => {
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
        // This is what makes the order *total* over a real Player_List: identities
        // are unique within a squad, so no two rows compare equal and fall back to
        // arrival position.
        if (comparePlayerRows(left, right) === 0) {
          expect(left.membershipId).toBe(right.membershipId);
        }

        expect(comparePlayerRows(left, left)).toBe(0);
      }),
      { numRuns: 500 },
    );
  });

  it('agrees with the oracle comparison on every pair of rows', () => {
    fc.assert(
      fc.property(rowArb, rowArb, (left, right) => {
        expect(comparePlayerRows(left, right)).toBe(compareOracle(left, right));
      }),
      { numRuns: 500 },
    );
  });

  it('ranks an active row before an inactive one whatever their names', () => {
    fc.assert(
      fc.property(rowArb, rowArb, (left, right) => {
        const active = { ...left, state: 'active' as const };
        const inactive = { ...right, state: 'inactive' as const };

        // The state key dominates: a membership that left the squad sorts last even
        // if its name would otherwise lead the list.
        expect(comparePlayerRows(active, inactive)).toBe(-1);
        expect(comparePlayerRows(inactive, active)).toBe(1);
      }),
      { numRuns: 400 },
    );
  });

  it('ignores the role, the guest flag, the former-player flag, and the rating', () => {
    fc.assert(
      fc.property(
        rowArb,
        rowArb,
        roleArb,
        fc.boolean(),
        fc.boolean(),
        (left, right, role, isGuest, isFormerPlayer) => {
          const restated = comparePlayerRows(
            { ...left, role, isGuest, isFormerPlayer, ratingEntry: null },
            { ...right, role, isGuest, isFormerPlayer, ratingEntry: null },
          );

          // No criterion asks for guests last or for the highest rating first, so
          // rewriting all four non-key fields must not move a row.
          expect(restated).toBe(comparePlayerRows(left, right));
        },
      ),
      { numRuns: 500 },
    );
  });
});
