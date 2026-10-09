import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  ABSENCE_SPELLINGS,
  absenceSpellingArb,
  anyProfileFixtureArb,
  buildPlayerProfileFixture,
  coAppearanceEntryFixtureArb,
  fullyPopulatedRichStatsFixtureArb,
  pairedStatEntryFixtureArb,
  playerProfileFixtureArb,
  playerRecordFixtureArb,
  presentRichBlockFixture,
  ratedProgressionRecordFixtureArb,
  ratingSummaryFixture,
  wireCountArb,
  wireDisplayNameArb,
  wireDisplayRatingArb,
  wireIdentityArb,
  wireMembershipStateArb,
  wirePercentageArb,
  wireRatingStateArb,
  type AbsenceSpelling,
  type PlayerProfileFixture,
} from '../../testing/playerProfileFixtures';
import {
  parsePlayerProfile,
  type PlayerProfile,
  type RatingSummary,
  type RichStats,
} from './playerProfile';

/**
 * Property 8: exactly the declared-optional members tolerate absence.
 *
 * Requirement 13.6 names **seven** members of the `GetPlayerProfile` body that
 * may be absent — `winPercentage`, `state`, `rating.state`,
 * `rating.displayRating`, a progression record's `displayRating`, `rich`, and
 * each member of `rich` — and says that `null` and an omitted property are the
 * **same** absence. This file asserts both halves of that, and the half nobody
 * writes down: that *no other* named member tolerates absence.
 *
 * ## Why the negative half is the load-bearing one
 *
 * "The optional members may be absent" is satisfied completely by a parser that
 * treats every member as optional, and that parser is the dangerous one. A
 * `winStreak` read as absent and defaulted to `0` is a person's record erased
 * with nothing on screen saying so; an absent `record` block defaulted to four
 * zeroes is a Never_Played statement for a membership with 24 appearances; an
 * absent `isGuest` defaulted to `false` decides a label on a value nobody sent.
 * Each of those renders as a figure a person would believe. So the subject here
 * is a **table of every member the parser names**, each marked as tolerating
 * absence or rejecting it, and the property is quantified over the whole table:
 * the ten tolerating paths must yield an accepted body, and the thirty-two
 * rejecting paths must fail it.
 *
 * The table is also checked against a generated body (see the final describe), so
 * a member the backend starts sending — or one the fixtures start emitting —
 * cannot sit outside the quantification unnoticed. The only wire members
 * permitted to be absent from the table are the ones the parser deliberately
 * never names: the rating-model pair on a rating block and on every progression
 * record, and a progression record's own state (Requirement 7.7).
 *
 * ## What "tolerates" is asserted to mean
 *
 * Not merely "the parse succeeded". For each tolerating member the accepted value
 * is compared against the fixture's own parsed oracle **with exactly that member
 * absent** — so an absence that quietly changed a second statistic, or that was
 * defaulted rather than read as an absence, fails. Two of the ten have a
 * consequence worth naming:
 *
 *  - an absent `rich` yields `rich: null`, while a **present** block whose every
 *    member is absent yields a present block of nulls. Tracking being off and
 *    tracking being on with nothing recorded are different states, and
 *    `lib/richStats.ts` tells them apart, so the all-absent subset is asserted to
 *    keep the block present;
 *  - an absent `displayRating` on a progression record yields a record with
 *    nothing to plot, so the accepted profile's progression is exactly the other
 *    records, in their wire order — a shorter collection, not a failure and not a
 *    point with a defaulted rating.
 *
 * Both spellings are covered independently, each tolerating member is asserted to
 * parse **equal** under the two spellings, and the `rich` block is exercised at
 * all sixteen subsets of its four members — in each spelling, and in a mixed
 * spelling, since nothing says a real body spells two absences alike.
 *
 * React-free and DOM-free, like every module under `lib/`.
 *
 * **Validates: Requirements 13.6**
 */

/* -------------------------------------------------------------------------- */
/* The table: every member the parser names, and whether it tolerates absence */
/* -------------------------------------------------------------------------- */

/** Whether a named member accepts null-or-absent, or fails the body carrying it. */
type Tolerance = 'tolerates-absence' | 'rejects-absence';

/** One step of a path into a wire body: a property name or an array index. */
type PathSegment = string | number;

/**
 * The wire members a rating block carries that **no parser names**, spelled as
 * string constants rather than as identifiers — the same precaution
 * `testing/playerProfileFixtures.ts` takes, so this file stays clean of the
 * identifiers the feature's rating-internal source scan forbids.
 *
 * They are listed here only so the completeness check below can say "every wire
 * member is either in the table or deliberately unread", rather than silently
 * ignoring whatever it does not recognise.
 */
const UNREAD_RATING_MODEL_MEMBERS = ['mu', 'sigma'] as const;

/** A progression record's own classification, which the parser never names. */
const UNREAD_PROGRESSION_STATE = 'state';

/** The four members of the `rich` block, every one declared-optional. */
const RICH_MEMBER_NAMES = [
  'goals',
  'cleanSheets',
  'goalsConcededAsKeeper',
  'keeperTime',
] as const;

/** One wire member of one container, and its tolerance of absence. */
interface NamedMember {
  /** A stable name, independent of which element index a path lands on. */
  readonly label: string;
  /** The container this member belongs to. */
  readonly containerId: string;
  /** The member's own wire property name. */
  readonly key: string;
  /** The path to it, for the given element index of its collection. */
  readonly pathFor: (index: number) => readonly PathSegment[];
  readonly tolerance: Tolerance;
  /** Whether the path descends into one element of a collection. */
  readonly indexed: boolean;
  /** Whether reaching it needs the body to carry a present `rich` block. */
  readonly needsRichBlock: boolean;
}

/** One container of the body, with the members the parser names inside it. */
interface BodyContainer {
  readonly id: string;
  readonly label: string;
  /** The path to the container itself, for a given element index. */
  readonly prefix: (index: number) => readonly PathSegment[];
  readonly indexed: boolean;
  readonly members: Readonly<Record<string, Tolerance>>;
  /** Wire members of this container the parser deliberately never names. */
  readonly unread: readonly string[];
}

/**
 * Every container of the body, and every member the parser names in each.
 *
 * Written out by hand rather than derived from a parsed value, so that a parser
 * which started tolerating an absence it should not — or stopped tolerating one
 * it should — fails here instead of redefining the expectation.
 */
const BODY_CONTAINERS: readonly BodyContainer[] = [
  {
    id: 'profile',
    label: 'the profile',
    prefix: () => [],
    indexed: false,
    members: {
      membershipId: 'rejects-absence',
      displayName: 'rejects-absence',
      state: 'tolerates-absence',
      isGuest: 'rejects-absence',
      record: 'rejects-absence',
      winPercentage: 'tolerates-absence',
      rating: 'rejects-absence',
      progression: 'rejects-absence',
      winStreak: 'rejects-absence',
      unbeatenStreak: 'rejects-absence',
      mostPlayedWith: 'rejects-absence',
      mostPlayedAgainst: 'rejects-absence',
      bestPartnerships: 'rejects-absence',
      bogeyOpponents: 'rejects-absence',
      bibAppearances: 'rejects-absence',
      rich: 'tolerates-absence',
    },
    unread: [],
  },
  {
    id: 'record',
    label: 'the record block',
    prefix: () => ['record'],
    indexed: false,
    members: {
      appearances: 'rejects-absence',
      wins: 'rejects-absence',
      draws: 'rejects-absence',
      losses: 'rejects-absence',
    },
    unread: [],
  },
  {
    id: 'rating',
    label: 'the rating block',
    prefix: () => ['rating'],
    indexed: false,
    members: {
      state: 'tolerates-absence',
      displayRating: 'tolerates-absence',
    },
    unread: UNREAD_RATING_MODEL_MEMBERS,
  },
  {
    id: 'rich',
    label: 'the rich block',
    prefix: () => ['rich'],
    indexed: false,
    members: {
      goals: 'tolerates-absence',
      cleanSheets: 'tolerates-absence',
      goalsConcededAsKeeper: 'tolerates-absence',
      keeperTime: 'tolerates-absence',
    },
    unread: [],
  },
  {
    id: 'progression',
    label: 'a progression record',
    prefix: (index) => ['progression', index],
    indexed: true,
    members: {
      completedAt: 'rejects-absence',
      displayRating: 'tolerates-absence',
    },
    unread: [...UNREAD_RATING_MODEL_MEMBERS, UNREAD_PROGRESSION_STATE],
  },
  {
    id: 'mostPlayedWith',
    label: 'a mostPlayedWith row',
    prefix: (index) => ['mostPlayedWith', index],
    indexed: true,
    members: {
      membershipId: 'rejects-absence',
      displayName: 'rejects-absence',
      count: 'rejects-absence',
    },
    unread: [],
  },
  {
    id: 'mostPlayedAgainst',
    label: 'a mostPlayedAgainst row',
    prefix: (index) => ['mostPlayedAgainst', index],
    indexed: true,
    members: {
      membershipId: 'rejects-absence',
      displayName: 'rejects-absence',
      count: 'rejects-absence',
    },
    unread: [],
  },
  {
    id: 'bestPartnerships',
    label: 'a bestPartnerships row',
    prefix: (index) => ['bestPartnerships', index],
    indexed: true,
    members: {
      membershipId: 'rejects-absence',
      displayName: 'rejects-absence',
      value: 'rejects-absence',
      qualifyingMatches: 'rejects-absence',
    },
    unread: [],
  },
  {
    id: 'bogeyOpponents',
    label: 'a bogeyOpponents row',
    prefix: (index) => ['bogeyOpponents', index],
    indexed: true,
    members: {
      membershipId: 'rejects-absence',
      displayName: 'rejects-absence',
      value: 'rejects-absence',
      qualifyingMatches: 'rejects-absence',
    },
    unread: [],
  },
];

/** Every member of every container, flattened. */
const NAMED_MEMBERS: readonly NamedMember[] = BODY_CONTAINERS.flatMap(
  (container) =>
    Object.entries(container.members).map(([key, tolerance]) => ({
      label: `${container.label}'s \`${key}\``,
      containerId: container.id,
      key,
      pathFor: (index: number) => [...container.prefix(index), key],
      tolerance,
      indexed: container.indexed,
      needsRichBlock: container.id === 'rich',
    })),
);

/** The members by name, so a property can quantify over readable labels. */
const MEMBER_BY_LABEL = new Map(
  NAMED_MEMBERS.map((member) => [member.label, member] as const),
);

/** The member a label names. */
function memberNamed(label: string): NamedMember {
  const member = MEMBER_BY_LABEL.get(label);

  if (member === undefined) {
    throw new Error(`the table names no member ${label}`);
  }

  return member;
}

/** The labels of the members declared to tolerate absence. */
const TOLERATING_LABELS: readonly string[] = NAMED_MEMBERS.filter(
  (member) => member.tolerance === 'tolerates-absence',
).map((member) => member.label);

/** The labels of the members declared to reject absence. */
const REJECTING_LABELS: readonly string[] = NAMED_MEMBERS.filter(
  (member) => member.tolerance === 'rejects-absence',
).map((member) => member.label);

/**
 * The labels reachable in **any** valid body: no collection element, and no
 * descent into a `rich` block that may not be there.
 *
 * These are the ones quantified over the shared body shapes — empty collections,
 * 200-by-500 collections, every rating shape, `rich` absent — where a path
 * through an element or through an absent block would not exist.
 */
function blockLabels(tolerance: Tolerance): readonly string[] {
  return NAMED_MEMBERS.filter(
    (member) =>
      member.tolerance === tolerance &&
      !member.indexed &&
      !member.needsRichBlock,
  ).map((member) => member.label);
}

/* -------------------------------------------------------------------------- */
/* Planting an absence                                                        */
/* -------------------------------------------------------------------------- */

/** A deep copy of a plain wire value, so a mutation never touches a fixture. */
function deepCopy(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((element: unknown) => deepCopy(element));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, member]) => [key, deepCopy(member)]),
    );
  }

  return value;
}

/**
 * The same value with every object in it rebuilt as a plain one.
 *
 * `toStrictEqual` compares prototypes, and fast-check's record arbitrary yields
 * a **null-prototype** object for some draws, so an oracle assembled from
 * generated parts can differ from the parser's object literals in prototype
 * alone. A prototype is not a claim of this property — the subject is which
 * members are present — so the oracle is normalised before comparison. Own
 * keys, including any carrying `undefined`, are preserved, so the comparison
 * still distinguishes an absent member from one left `undefined`.
 */
function plain<T>(value: T): T {
  return deepCopy(value) as T;
}

/** The container a path leads into, asserted to be there. */
function holderAt(
  body: Record<string, unknown>,
  path: readonly PathSegment[],
): Record<string, unknown> {
  let holder: Record<string, unknown> = body;

  for (const segment of path) {
    const next = holder[String(segment)];

    if (typeof next !== 'object' || next === null) {
      throw new Error(
        `the body carries no container at \`${path.join('.')}\``,
      );
    }

    holder = next as Record<string, unknown>;
  }

  return holder;
}

/** Whether a container carries a property of its own under that name. */
function carries(holder: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(holder, key);
}

/**
 * A copy of the body with the member at `path` absent — spelled as an explicit
 * `null`, or by removing the property outright.
 *
 * The two spellings are the whole subject of Requirement 13.6, so they are
 * planted separately rather than one standing in for the other, and the original
 * body is left untouched (the fixtures are shared across this feature's parsing
 * suites).
 */
function withAbsence(
  wire: Record<string, unknown>,
  path: readonly PathSegment[],
  spelling: AbsenceSpelling,
): Record<string, unknown> {
  const body = deepCopy(wire) as Record<string, unknown>;
  const holder = holderAt(body, path.slice(0, -1));
  const key = String(path[path.length - 1]);

  if (spelling === 'null') {
    holder[key] = null;
  } else {
    delete holder[key];
  }

  return body;
}

/* -------------------------------------------------------------------------- */
/* The oracle: the same profile, with exactly that member absent               */
/* -------------------------------------------------------------------------- */

/** A rating summary with one named member absent. */
function ratingWithout(rating: RatingSummary, key: string): RatingSummary {
  return {
    state: key === 'state' ? null : rating.state,
    displayRating: key === 'displayRating' ? null : rating.displayRating,
  };
}

/** A rich block with one named member absent. */
function richWithout(rich: RichStats, key: string): RichStats {
  return {
    goals: key === 'goals' ? null : rich.goals,
    cleanSheets: key === 'cleanSheets' ? null : rich.cleanSheets,
    goalsConcededAsKeeper:
      key === 'goalsConcededAsKeeper' ? null : rich.goalsConcededAsKeeper,
    keeperTimeMs: key === 'keeperTime' ? null : rich.keeperTimeMs,
  };
}

/**
 * The profile a body must parse to once the member at `path` is absent.
 *
 * Derived from the fixture's own parsed oracle — which was built arithmetically
 * from the generator's choices, never by parsing anything — so the comparison is
 * against a known value rather than against the parser's own output. Every
 * member other than the one made absent must be unchanged, which is what rules
 * out an absence that quietly took a second statistic with it.
 *
 * A progression record losing its `displayRating` loses its **point**: the
 * expected progression is the other records, in order.
 */
function profileWithout(
  parsed: PlayerProfile,
  path: readonly PathSegment[],
): PlayerProfile {
  const [head, ...rest] = path;

  switch (head) {
    case 'state':
      return { ...parsed, state: null };

    case 'winPercentage':
      return { ...parsed, winPercentage: null };

    case 'rating':
      return { ...parsed, rating: ratingWithout(parsed.rating, String(rest[0])) };

    case 'progression': {
      const index = Number(rest[0]);

      return {
        ...parsed,
        progression: parsed.progression.filter(
          (_point, at) => at !== index,
        ),
      };
    }

    case 'rich': {
      if (rest.length === 0) {
        return { ...parsed, rich: null };
      }

      if (parsed.rich === null) {
        throw new Error('the body carries no rich block to take a member from');
      }

      return { ...parsed, rich: richWithout(parsed.rich, String(rest[0])) };
    }

    default:
      throw new Error(
        `\`${path.join('.')}\` is not a declared-optional member`,
      );
  }
}

/* -------------------------------------------------------------------------- */
/* The frame: a parse settles, raising nothing                                */
/* -------------------------------------------------------------------------- */

/** A parse that settled, with a raise reported as the distinct fault it is. */
function parseOutcome(body: unknown) {
  try {
    return parsePlayerProfile(body);
  } catch (raised) {
    throw new Error(`the parser raised instead of settling: ${String(raised)}`, {
      cause: raised,
    });
  }
}

/** A value's own keys, sorted, as a comparable signature. */
function keySignature(value: object): string {
  return Object.keys(value).sort().join(',');
}

/** The profile an accepted body parses to, with the acceptance asserted. */
function acceptedProfile(body: unknown, what: string): PlayerProfile {
  const outcome = parseOutcome(body);

  if (!outcome.ok) {
    throw new Error(`${what} was rejected: ${outcome.reason}`);
  }

  // All or nothing on the accepting side: a success is a value and nothing else.
  expect(keySignature(outcome), what).toBe('ok,value');

  return outcome.value;
}

/** A body asserted to be rejected, carrying no value for a caller to render. */
function expectRejected(body: unknown, what: string): void {
  const outcome = parseOutcome(body);

  expect(outcome.ok, what).toBe(false);
  expect(keySignature(outcome), what).toBe('ok,reason');
}

/* -------------------------------------------------------------------------- */
/* Bodies in which every declared-optional member is present                   */
/* -------------------------------------------------------------------------- */

/** Any finite number, for the wire members the parser never reads. */
const unreadModelValueArb: fc.Arbitrary<number> = fc
  .double({ noNaN: true, noDefaultInfinity: true })
  .filter((value) => Number.isFinite(value));

/** A rating block carrying **both** of its declared-optional members. */
const presentRatingFixtureArb = fc
  .record({
    state: wireRatingStateArb,
    displayRating: wireDisplayRatingArb,
    stateAbsence: absenceSpellingArb,
    displayRatingAbsence: absenceSpellingArb,
    modelValues: fc.tuple(unreadModelValueArb, unreadModelValueArb),
  })
  .map((input) => ratingSummaryFixture(input));

/**
 * How many elements each collection of the body below carries: enough that an
 * absence can be planted at the first, a middle, and the last index.
 */
const ELEMENT_COUNT = 3;

/** An element index of one of those collections. */
const elementIndexArb: fc.Arbitrary<number> = fc.integer({
  min: 0,
  max: ELEMENT_COUNT - 1,
});

const elementCount = { minLength: ELEMENT_COUNT, maxLength: ELEMENT_COUNT };

/**
 * A valid body in which **every member the parser names is present** — every
 * declared-optional one included, every collection stocked, every progression
 * record carrying a rating, and a fully populated `rich` block.
 *
 * Declared here rather than taken from the shared presets because the shared
 * ones vary the absences deliberately, and this property needs a body where
 * planting an absence is a real change: removing a member that was already
 * absent would assert nothing. Built from the shared leaf generators and the
 * shared builder, so the bodies are the same kind of thing every other parsing
 * suite reads.
 */
const fullyPresentBodyArb: fc.Arbitrary<PlayerProfileFixture> = fc
  .record({
    membershipId: wireIdentityArb,
    displayName: wireDisplayNameArb,
    state: wireMembershipStateArb,
    stateAbsence: absenceSpellingArb,
    isGuest: fc.boolean(),
    record: playerRecordFixtureArb,
    winPercentage: wirePercentageArb,
    winPercentageAbsence: absenceSpellingArb,
    rating: presentRatingFixtureArb,
    progression: fc.array(ratedProgressionRecordFixtureArb, elementCount),
    winStreak: wireCountArb,
    unbeatenStreak: wireCountArb,
    mostPlayedWith: fc.array(coAppearanceEntryFixtureArb, elementCount),
    mostPlayedAgainst: fc.array(coAppearanceEntryFixtureArb, elementCount),
    bestPartnerships: fc.array(pairedStatEntryFixtureArb, elementCount),
    bogeyOpponents: fc.array(pairedStatEntryFixtureArb, elementCount),
    bibAppearances: wireCountArb,
    rich: fullyPopulatedRichStatsFixtureArb.map((fixture) =>
      presentRichBlockFixture(fixture),
    ),
  })
  .map((input) => buildPlayerProfileFixture(input));

/** A valid body of ordinary shape carrying a fully populated `rich` block. */
const presentRichBodyArb: fc.Arbitrary<PlayerProfileFixture> =
  playerProfileFixtureArb({
    rich: fullyPopulatedRichStatsFixtureArb.map((fixture) =>
      presentRichBlockFixture(fixture),
    ),
  });

/* -------------------------------------------------------------------------- */
/* The declared-optional members tolerate both spellings of an absence         */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 8: Exactly the declared-optional members tolerate absence
// Validates: Requirements 13.6
describe('a declared-optional member tolerates absence', () => {
  it('accepts the body and yields exactly that absence, in either spelling', () => {
    fc.assert(
      fc.property(
        fullyPresentBodyArb,
        elementIndexArb,
        fc.constantFrom(...TOLERATING_LABELS),
        absenceSpellingArb,
        (fixture, index, label, spelling) => {
          const member = memberNamed(label);
          const path = member.pathFor(index);

          // Non-vacuity: the member really was there to be taken away.
          expect(
            carries(holderAt(fixture.wire, path.slice(0, -1)), member.key),
            `${label} is present before the absence is planted`,
          ).toBe(true);

          const body = withAbsence(fixture.wire, path, spelling);
          const profile = acceptedProfile(
            body,
            `a body with ${label} ${spelling === 'null' ? 'null' : 'omitted'}`,
          );

          // The absence is read as an absence, and nothing else moved: the
          // expectation is the fixture's own oracle with exactly this member
          // gone, so a defaulted member or a second statistic altered fails.
          expect(profile).toStrictEqual(
            plain(profileWithout(fixture.parsed, path)),
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it('reads an explicit null and an omitted property as the same absence', () => {
    fc.assert(
      fc.property(
        fullyPresentBodyArb,
        elementIndexArb,
        fc.constantFrom(...TOLERATING_LABELS),
        (fixture, index, label) => {
          const path = memberNamed(label).pathFor(index);

          const nulled = acceptedProfile(
            withAbsence(fixture.wire, path, 'null'),
            `a body with ${label} null`,
          );
          const omitted = acceptedProfile(
            withAbsence(fixture.wire, path, 'missing'),
            `a body with ${label} omitted`,
          );

          // The distinction a JSON body can draw between "sent as null" and
          // "not sent" carries no meaning for this feature.
          expect(omitted).toStrictEqual(nulled);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('tolerates the absence over every generated body shape', () => {
    fc.assert(
      fc.property(
        anyProfileFixtureArb,
        fc.constantFrom(...blockLabels('tolerates-absence')),
        absenceSpellingArb,
        (fixture, label, spelling) => {
          // The shared shapes: empty collections, 200-by-500 collections, every
          // rating shape, `rich` absent, a progression with nothing to plot.
          const path = memberNamed(label).pathFor(0);
          const body = withAbsence(fixture.wire, path, spelling);
          const profile = acceptedProfile(body, `a body with ${label} absent`);

          expect(profile).toStrictEqual(
            plain(profileWithout(fixture.parsed, path)),
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it('keeps a progression record with nothing to plot, minus its point', () => {
    fc.assert(
      fc.property(
        fullyPresentBodyArb,
        elementIndexArb,
        absenceSpellingArb,
        (fixture, index, spelling) => {
          const body = withAbsence(
            fixture.wire,
            ['progression', index, 'displayRating'],
            spelling,
          );
          const profile = acceptedProfile(
            body,
            'a body with a ratingless progression record',
          );

          // Every record was rated, so exactly one point is lost — and the
          // others keep their order. A record with nothing to plot is not a
          // failure, and not a point with a defaulted rating.
          expect(profile.progression).toHaveLength(ELEMENT_COUNT - 1);
          expect(profile.progression).toStrictEqual(
            plain(
              fixture.parsed.progression.filter((_point, at) => at !== index),
            ),
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Every other named member rejects both spellings                            */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 8: Exactly the declared-optional members tolerate absence
// Validates: Requirements 13.6
describe('a member that is not declared optional rejects absence', () => {
  it('fails the whole body, in either spelling', () => {
    fc.assert(
      fc.property(
        fullyPresentBodyArb,
        elementIndexArb,
        fc.constantFrom(...REJECTING_LABELS),
        absenceSpellingArb,
        (fixture, index, label, spelling) => {
          const member = memberNamed(label);
          const path = member.pathFor(index);

          expect(
            carries(holderAt(fixture.wire, path.slice(0, -1)), member.key),
            `${label} is present before the absence is planted`,
          ).toBe(true);

          const body = withAbsence(fixture.wire, path, spelling);

          // No defaulted count, no empty collection substituted for a missing
          // one, no `false` stood in for an unsent flag.
          expectRejected(
            body,
            `a body with ${label} ${spelling === 'null' ? 'null' : 'omitted'}`,
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it('fails over every generated body shape', () => {
    fc.assert(
      fc.property(
        anyProfileFixtureArb,
        fc.constantFrom(...blockLabels('rejects-absence')),
        absenceSpellingArb,
        (fixture, label, spelling) => {
          const path = memberNamed(label).pathFor(0);

          expectRejected(
            withAbsence(fixture.wire, path, spelling),
            `a body with ${label} absent`,
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The rich block, at every subset of its four members                        */
/* -------------------------------------------------------------------------- */

/** How a subset of absences is spelled: alike, or member by member. */
const SUBSET_SPELLINGS = ['null', 'missing', 'alternating'] as const;

/** One way of spelling a subset of absences. */
type SubsetSpelling = (typeof SUBSET_SPELLINGS)[number];

/** The spelling to use for the member at `position` of a subset. */
function spellingAt(
  spelling: SubsetSpelling,
  position: number,
): AbsenceSpelling {
  if (spelling === 'alternating') {
    return position % 2 === 0 ? 'null' : 'missing';
  }

  return spelling;
}

/** Every subset of the four rich members, as the sixteen bit patterns. */
const RICH_SUBSETS: readonly (readonly string[])[] = Array.from(
  { length: 1 << RICH_MEMBER_NAMES.length },
  (_unused, mask) =>
    RICH_MEMBER_NAMES.filter((_name, bit) => (mask & (1 << bit)) !== 0),
);

// Feature: web-player-stats-screen, Property 8: Exactly the declared-optional members tolerate absence
// Validates: Requirements 13.6
describe('a rich block with any subset of its members absent', () => {
  it('accepts all sixteen subsets, in either spelling and in both at once', () => {
    const subsetsSeen = new Set<string>();

    fc.assert(
      fc.property(
        presentRichBodyArb,
        fc.constantFrom(...SUBSET_SPELLINGS),
        (fixture, spelling) => {
          for (const subset of RICH_SUBSETS) {
            let body = fixture.wire;
            let expected = fixture.parsed;

            subset.forEach((key, position) => {
              body = withAbsence(
                body,
                ['rich', key],
                spellingAt(spelling, position),
              );
              expected = profileWithout(expected, ['rich', key]);
            });

            const profile = acceptedProfile(
              body,
              `a rich block absent [${subset.join(', ')}] spelled ${spelling}`,
            );

            expect(profile).toStrictEqual(plain(expected));

            // Tracking on with nothing recorded is **not** tracking off: an
            // all-absent block stays a present block of nulls, which is what
            // lets `lib/richStats.ts` tell the two apart.
            expect(profile.rich).not.toBeNull();

            subsetsSeen.add(subset.join(','));
          }
        },
      ),
      { numRuns: 100 },
    );

    expect(subsetsSeen.size).toBe(16);
  });

  it('separates an absent block from a block whose members are all absent', () => {
    fc.assert(
      fc.property(presentRichBodyArb, absenceSpellingArb, (fixture, spelling) => {
        let allAbsent = fixture.wire;

        for (const key of RICH_MEMBER_NAMES) {
          allAbsent = withAbsence(allAbsent, ['rich', key], spelling);
        }

        const withEmptyBlock = acceptedProfile(
          allAbsent,
          'a body with an all-absent rich block',
        );
        const withNoBlock = acceptedProfile(
          withAbsence(fixture.wire, ['rich'], spelling),
          'a body with no rich block',
        );

        expect(withNoBlock.rich).toBeNull();
        expect(withEmptyBlock.rich).toStrictEqual({
          goals: null,
          cleanSheets: null,
          goalsConcededAsKeeper: null,
          keeperTimeMs: null,
        });
      }),
      { numRuns: 200 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Non-vacuity: the table is complete, and a planted absence is really there   */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 8: Exactly the declared-optional members tolerate absence
// Validates: Requirements 13.6
describe('the member table and the planted absences', () => {
  it('declares exactly the seven members Requirement 13.6 names', () => {
    expect([...TOLERATING_LABELS].sort()).toStrictEqual(
      [
        "the profile's `winPercentage`",
        "the profile's `state`",
        "the profile's `rich`",
        "the rating block's `state`",
        "the rating block's `displayRating`",
        "a progression record's `displayRating`",
        ...RICH_MEMBER_NAMES.map((key) => `the rich block's \`${key}\``),
      ].sort(),
    );

    // Seven declared groups, ten paths — `rich`'s four members are one group.
    expect(TOLERATING_LABELS).toHaveLength(10);
    expect(REJECTING_LABELS).toHaveLength(32);
    expect(NAMED_MEMBERS).toHaveLength(42);

    // Nothing is in both halves, and no label is spelled twice.
    expect(MEMBER_BY_LABEL.size).toBe(NAMED_MEMBERS.length);
  });

  it('names every member a valid body carries, apart from those never read', () => {
    // A fixed seed, so the completeness claim is a fact about the generators
    // rather than a hope about a particular run.
    const [fixture] = fc.sample(fullyPresentBodyArb, {
      numRuns: 1,
      seed: 20_260_101,
    });

    for (const container of BODY_CONTAINERS) {
      const holder = holderAt(fixture.wire, container.prefix(0));
      const named = Object.keys(container.members);
      const unnamed = Object.keys(holder).filter(
        (key) => !named.includes(key),
      );

      // Every member the table names is actually sent...
      for (const key of named) {
        expect(carries(holder, key), `${container.label} carries \`${key}\``).toBe(
          true,
        );
      }

      // ...and every member sent is either named or deliberately unread. A
      // member the backend starts sending cannot slip past the quantification.
      expect([...unnamed].sort(), container.label).toStrictEqual(
        [...container.unread].sort(),
      );
    }
  });

  it('plants an absence the body really carries, and leaves the original be', () => {
    const [fixture] = fc.sample(fullyPresentBodyArb, {
      numRuns: 1,
      seed: 20_260_102,
    });
    const before = deepCopy(fixture.wire);

    const nulled = withAbsence(fixture.wire, ['winStreak'], 'null');

    expect(carries(nulled, 'winStreak')).toBe(true);
    expect(nulled.winStreak).toBeNull();

    const omitted = withAbsence(fixture.wire, ['winStreak'], 'missing');

    // Genuinely gone, not merely `undefined`: the two spellings are different
    // bodies, which is the distinction this property exists to collapse.
    expect(carries(omitted, 'winStreak')).toBe(false);

    const nested = withAbsence(
      fixture.wire,
      ['mostPlayedWith', 2, 'count'],
      'missing',
    );
    const row = holderAt(nested, ['mostPlayedWith', 2]);

    expect(carries(row, 'count')).toBe(false);
    expect(carries(holderAt(nested, ['mostPlayedWith', 0]), 'count')).toBe(true);

    // The fixtures are shared across this feature's parsing suites.
    expect(plain(fixture.wire)).toStrictEqual(before);

    // And the body the mutations started from is the one the parser accepts.
    expect(acceptedProfile(fixture.wire, 'the unmutated body')).toStrictEqual(
      plain(fixture.parsed),
    );
  });

  it('spells every absence both ways across the subset table', () => {
    expect(ABSENCE_SPELLINGS).toStrictEqual(['null', 'missing']);
    expect(RICH_SUBSETS).toHaveLength(16);

    // The empty subset (nothing absent) and the full one are both exercised.
    expect(RICH_SUBSETS[0]).toStrictEqual([]);
    expect(RICH_SUBSETS[15]).toStrictEqual([...RICH_MEMBER_NAMES]);

    // The alternating spelling really does mix the two.
    expect(spellingAt('alternating', 0)).toBe('null');
    expect(spellingAt('alternating', 1)).toBe('missing');
  });
});
