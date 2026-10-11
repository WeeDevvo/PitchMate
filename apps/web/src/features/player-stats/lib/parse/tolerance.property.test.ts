import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  FULL_PROFILE_FIXTURE,
  PROFILE_FIXTURE_ARBS,
  anyProfileFixtureArb,
  type PlayerProfileFixture,
} from '../../testing/playerProfileFixtures';
import { parsePlayerProfile, type PlayerProfile } from './playerProfile';

/**
 * Property 11: unrecognised properties are inert.
 *
 * The Response_Parser names the members it wants and reads nothing else, so a
 * property the feature does not present is never read at all
 * (Requirement 13.9). This file states the consequence as an equality: every
 * valid body, extended with arbitrary properties whose names no parser names,
 * parses to **exactly** the value the unextended body parses to — at the top
 * level and on every nested object the parser descends into.
 *
 * ## Why an equality, and not "the parse still succeeds"
 *
 * "An additive change cannot fail a parse" is the weak half of the claim, and a
 * parser that accepted the extended body while reading a figure out of it would
 * satisfy it completely. The damage an additive change could do is in the
 * *value*: a new backend member named for the same thing as one the screen
 * presents, picked up by a parser that enumerated the body rather than naming
 * its members, would reach a rendered figure that nobody designed. So the
 * subject here is the parsed value, compared three ways over the same bodies —
 * against the parse of the unextended body, against the fixture's independent
 * oracle, and (for the rating-internal names) against the absence of any key
 * that could hold one.
 *
 * ## The three kinds of extension, and why each is here
 *
 * - **Names of a rating quantity.** The wire already carries a mean skill and a
 *   spread on its rating summary and on every progression record, and a later
 *   contract could add a display scale and offset beside them. All four names
 *   are added at *every* site, including sites that have no business carrying
 *   one, because this is the read-path half of Requirement 7.7: they are not
 *   filtered out after reading, they are never read, and a property named for
 *   one cannot reach the parsed graph however it arrives.
 * - **A throwing accessor.** The one operation an arbitrary body can make the
 *   parser raise on is the read of a property defined as a getter that throws.
 *   A throwing *unrecognised* property is therefore the sharpest available
 *   witness that the property was not read: if the parse settles, nothing
 *   touched it — and the harness proves separately that reading it really does
 *   throw, so the witness is not vacuous. An enumerating parser, a
 *   `structuredClone`, a `JSON.stringify`, or a spread of the body would each
 *   raise here.
 * - **Arbitrary names and values.** Free-form names carrying nulls, numbers,
 *   strings, arrays, and nested objects, so the claim is about unrecognised
 *   properties in general rather than about a hand-picked few. The names that
 *   the parser *does* read are excluded by construction — overwriting one of
 *   those is a different body, not an additive change, and the harness
 *   demonstrates that doing so is visible to these very assertions.
 *
 * The rating-internal names are spelled as **string constants** rather than as
 * bare identifiers, as `testing/playerProfileFixtures.ts` does, so this file
 * stays clean of the identifiers the feature's later rating-internal source
 * scan forbids.
 *
 * React-free and DOM-free, like every module under `lib/`.
 *
 * **Validates: Requirements 13.9**
 */

/* -------------------------------------------------------------------------- */
/* The names the parser does read                                             */
/* -------------------------------------------------------------------------- */

/**
 * Every member name any parser of `playerProfile.ts` names, across all seven of
 * its blocks, as one set.
 *
 * Pooled rather than kept per block because it is used as an **exclusion**:
 * a generated extension must not collide with a recognised name at any site,
 * and the safe way to guarantee that is to exclude every recognised name
 * everywhere. Over-excluding costs nothing — `count` is unrecognised on a
 * rating block, but adding it there proves nothing that a free-form name does
 * not.
 */
const RECOGNISED_WIRE_NAMES: ReadonlySet<string> = new Set([
  // the profile
  'membershipId',
  'displayName',
  'state',
  'isGuest',
  'record',
  'winPercentage',
  'rating',
  'progression',
  'winStreak',
  'unbeatenStreak',
  'mostPlayedWith',
  'mostPlayedAgainst',
  'bestPartnerships',
  'bogeyOpponents',
  'bibAppearances',
  'rich',
  // the record
  'appearances',
  'wins',
  'draws',
  'losses',
  // the rating summary and a progression record
  'displayRating',
  'completedAt',
  // a pairwise row
  'count',
  'value',
  'qualifyingMatches',
  // the rich block
  'goals',
  'cleanSheets',
  'goalsConcededAsKeeper',
  'keeperTime',
]);

/**
 * The four names a rating quantity would arrive under: the mean skill estimate,
 * the spread, and the display scale and offset.
 *
 * Spelled as string constants, so a source scan over comment-and-string-stripped
 * code sees no rating-internal identifier in this file.
 */
const RATING_INTERNAL_WIRE_NAMES = ['mu', 'sigma', 'k', 'c'] as const;

/**
 * Other names an additive change plausibly arrives under, including three that
 * shadow a prototype member — a parser that coerced the body to a string, or
 * consulted its constructor, would read one of those.
 */
const OTHER_UNRECOGNISED_NAMES = [
  'tau',
  'beta',
  'ordinal',
  'conservativeEstimate',
  'ratingScale',
  'ratingOffset',
  'etag',
  'version',
  '_links',
  'displayRatingRaw',
  'toString',
  'valueOf',
  'constructor',
] as const;

/* -------------------------------------------------------------------------- */
/* Generating an extension                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A set of properties to add to one wire object: data properties carrying a
 * value, and accessors that throw when read.
 *
 * Carried as plain data — names and values, never a built object — so that
 * fast-check can report and shrink a counterexample without a serialiser ever
 * reading the throwing accessors. The objects themselves are built inside the
 * predicate.
 */
interface UnrecognisedProperties {
  /** Names onto the values they carry; every name unrecognised and unique. */
  readonly plain: readonly (readonly [string, unknown])[];
  /** Names defined as accessors that throw; disjoint from {@link plain}. */
  readonly throwing: readonly string[];
}

/** A value an added property might carry, from a null to a nested object. */
const unrecognisedValueArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.string({ maxLength: 12 }),
  fc.array(fc.integer(), { maxLength: 3 }),
  fc.dictionary(fc.string({ maxLength: 6 }), fc.integer(), { maxKeys: 3 }),
);

/** A property name no parser of this feature names. */
const unrecognisedNameArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom(...RATING_INTERNAL_WIRE_NAMES) },
  { weight: 3, arbitrary: fc.constantFrom(...OTHER_UNRECOGNISED_NAMES) },
  {
    weight: 2,
    arbitrary: fc
      .string({ minLength: 1, maxLength: 12 })
      .filter((name) => !RECOGNISED_WIRE_NAMES.has(name) && !name.startsWith('__')),
  },
);

/**
 * An extension of one wire object.
 *
 * All four rating-internal names are always present, so every site is always
 * asked the Requirement 7.7 question; the generated extras and throwing
 * accessors vary around them. A name chosen as a throwing accessor is removed
 * from the data properties, which keeps the two sets disjoint and leaves at
 * least one data property standing (there are four rating-internal names and at
 * most three accessors), so the non-vacuity check below always has both kinds
 * to examine.
 */
const unrecognisedPropertiesArb: fc.Arbitrary<UnrecognisedProperties> = fc
  .record({
    internalValues: fc.tuple(
      unrecognisedValueArb,
      unrecognisedValueArb,
      unrecognisedValueArb,
      unrecognisedValueArb,
    ),
    extra: fc.array(fc.tuple(unrecognisedNameArb, unrecognisedValueArb), {
      maxLength: 4,
    }),
    throwing: fc.array(unrecognisedNameArb, { minLength: 1, maxLength: 3 }),
  })
  .map(({ internalValues, extra, throwing }) => {
    const throwingNames = [...new Set(throwing)];
    const plain = new Map<string, unknown>();

    RATING_INTERNAL_WIRE_NAMES.forEach((name, index) => {
      plain.set(name, internalValues[index]);
    });

    for (const [name, value] of extra) {
      plain.set(name, value);
    }

    for (const name of throwingNames) {
      plain.delete(name);
    }

    return { plain: [...plain], throwing: throwingNames };
  });

/** One to three extensions, dealt round-robin to the sites of one body. */
const extensionsArb: fc.Arbitrary<readonly UnrecognisedProperties[]> = fc.array(
  unrecognisedPropertiesArb,
  { minLength: 1, maxLength: 3 },
);

/* -------------------------------------------------------------------------- */
/* Extending a body                                                           */
/* -------------------------------------------------------------------------- */

/** A wire object, as the fixtures build them. */
type WireObject = Record<string, unknown>;

/** One extended object of a body, kept so the extension can be verified. */
interface ExtendedSite {
  /** Where in the body this object sits, for a diagnostic. */
  readonly label: string;
  /** The extended copy. */
  readonly object: WireObject;
  /** What was added to it. */
  readonly added: UnrecognisedProperties;
}

/** An extended body, and every object the extension touched. */
interface ExtendedBody {
  readonly wire: WireObject;
  readonly sites: readonly ExtendedSite[];
}

/** The four Pairwise_Sections, which are extended element by element. */
const PAIRWISE_KEYS = [
  'mostPlayedWith',
  'mostPlayedAgainst',
  'bestPartnerships',
  'bogeyOpponents',
] as const;

/** Whether a value is a plain object, as a nested wire block is. */
function isWireObject(value: unknown): value is WireObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A nested wire block, asserted to be one. */
function wireObjectAt(source: WireObject, key: string): WireObject {
  const value = source[key];

  if (!isWireObject(value)) {
    throw new Error(`the fixture's \`${key}\` is not a wire object`);
  }

  return value;
}

/** A nested wire collection, asserted to be one. */
function wireArrayAt(source: WireObject, key: string): readonly unknown[] {
  const value = source[key];

  if (!Array.isArray(value)) {
    throw new Error(`the fixture's \`${key}\` is not a wire collection`);
  }

  return value;
}

/**
 * A copy of `source` carrying the given unrecognised properties.
 *
 * Defined with `Object.defineProperty` rather than by assignment, so a name
 * that shadows a prototype member is added as the own enumerable property the
 * backend would have sent rather than going through an inherited setter. The
 * original is left untouched: every assertion below compares a parse of the
 * extended copy with a parse of the body the fixture built.
 */
function extendObject(
  source: WireObject,
  added: UnrecognisedProperties,
): WireObject {
  const extended: WireObject = { ...source };

  for (const [name, value] of added.plain) {
    Object.defineProperty(extended, name, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  for (const name of added.throwing) {
    Object.defineProperty(extended, name, {
      get(): never {
        throw new Error(`the unrecognised property \`${name}\` was read`);
      },
      enumerable: true,
      configurable: true,
    });
  }

  return extended;
}

/**
 * The body with **every** object the parser descends into extended: the body
 * itself, its record, its rating, each progression record, each row of each of
 * the four Pairwise_Sections, and the rich block when one is present.
 *
 * Extensions are dealt round-robin, so neighbouring elements of a collection
 * carry different additions and a parser that happened to tolerate one shape
 * does not thereby tolerate the collection.
 */
function extendEveryObject(
  wire: WireObject,
  extensions: readonly UnrecognisedProperties[],
): ExtendedBody {
  const sites: ExtendedSite[] = [];
  let dealt = 0;

  const extend = (label: string, source: WireObject): WireObject => {
    const added = extensions[dealt % extensions.length];
    dealt += 1;

    const object = extendObject(source, added);
    sites.push({ label, object, added });

    return object;
  };

  const top: WireObject = { ...wire };

  top.record = extend('record', wireObjectAt(wire, 'record'));
  top.rating = extend('rating', wireObjectAt(wire, 'rating'));
  top.progression = wireArrayAt(wire, 'progression').map((record, index) => {
    if (!isWireObject(record)) {
      throw new Error('a fixture progression record is not a wire object');
    }

    return extend(`progression[${String(index)}]`, record);
  });

  for (const key of PAIRWISE_KEYS) {
    top[key] = wireArrayAt(wire, key).map((row, index) => {
      if (!isWireObject(row)) {
        throw new Error(`a fixture \`${key}\` row is not a wire object`);
      }

      return extend(`${key}[${String(index)}]`, row);
    });
  }

  // Absent, or explicitly null: a body that carries no block has no object to
  // extend there, and the absence is itself one of the seven declared ones.
  if (isWireObject(wire.rich)) {
    top.rich = extend('rich', wire.rich);
  }

  return { wire: extend('profile', top), sites };
}

/** The body with only its outermost object extended. */
function extendTopLevelOnly(
  wire: WireObject,
  added: UnrecognisedProperties,
): ExtendedBody {
  const object = extendObject(wire, added);

  return { wire: object, sites: [{ label: 'profile', object, added }] };
}

/* -------------------------------------------------------------------------- */
/* Non-vacuity: the extension really happened                                 */
/* -------------------------------------------------------------------------- */

/**
 * Every way an extended body falls short of actually carrying its unrecognised
 * properties, as diagnostics naming the site.
 *
 * Without this, the whole file would be satisfied by an extender that added
 * nothing: "the extended body parses the same" is trivially true of a body that
 * was never extended, and "the throwing accessor was not read" is trivially true
 * of an accessor that does not throw.
 */
function extensionFaults(sites: readonly ExtendedSite[]): string[] {
  const faults: string[] = [];

  if (sites.length === 0) {
    return ['no object was extended'];
  }

  for (const { label, object, added } of sites) {
    if (added.plain.length === 0 && added.throwing.length === 0) {
      faults.push(`\`${label}\` was extended with nothing`);
    }

    for (const [name, value] of added.plain) {
      if (!Object.prototype.hasOwnProperty.call(object, name)) {
        faults.push(`\`${label}\` carries no own \`${name}\``);

        continue;
      }

      if (!Object.is(object[name], value)) {
        faults.push(`\`${label}\`'s \`${name}\` is not the value added`);
      }
    }

    for (const name of added.throwing) {
      if (!Object.prototype.hasOwnProperty.call(object, name)) {
        faults.push(`\`${label}\` carries no own \`${name}\``);

        continue;
      }

      let raised = false;

      try {
        void object[name];
      } catch {
        raised = true;
      }

      if (!raised) {
        faults.push(`\`${label}\`'s \`${name}\` does not throw when read`);
      }
    }
  }

  return faults;
}

/* -------------------------------------------------------------------------- */
/* The frame: a parse settles, raising nothing, and is accepted               */
/* -------------------------------------------------------------------------- */

/**
 * The profile a body parses to, with the frame asserted on the way through: the
 * parser raises nothing and the body is accepted.
 *
 * A raise is reported as its own fault rather than as a rejection, because it
 * escapes the call site entirely (Requirement 13.1) — and a raise is exactly
 * what a parser that read an unrecognised throwing accessor would produce, so
 * the distinction is the point of this file.
 */
function acceptedProfile(body: unknown, what: string): PlayerProfile {
  let outcome;

  try {
    outcome = parsePlayerProfile(body);
  } catch (raised) {
    throw new Error(`${what}: the parser raised instead of settling: ${String(raised)}`, {
      cause: raised,
    });
  }

  if (!outcome.ok) {
    throw new Error(`${what}: a valid body was rejected: ${outcome.reason}`);
  }

  return outcome.value;
}

/** The assertion this whole file makes, over one fixture and one extension. */
function assertInert(fixture: PlayerProfileFixture, extended: ExtendedBody): void {
  const baseline = acceptedProfile(fixture.wire, 'the unextended body');
  const profile = acceptedProfile(extended.wire, 'the extended body');

  // Equal to the parse of the same body without the additions — the property
  // itself — and equal to the fixture's own oracle, which was built from the
  // generator's choices rather than by parsing anything.
  expect(profile).toStrictEqual(baseline);
  expect(profile).toStrictEqual(fixture.parsed);

  // And the additions were really there to be ignored.
  expect(extensionFaults(extended.sites)).toStrictEqual([]);
}

/* -------------------------------------------------------------------------- */
/* Property 11, over every generated body shape                               */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 11: Unrecognised properties are inert
// Validates: Requirements 13.9
describe('unrecognised properties are inert', () => {
  for (const shape of PROFILE_FIXTURE_ARBS) {
    it(`parses a body with ${shape.label} the same when every object is extended`, () => {
      fc.assert(
        fc.property(shape.arbitrary, extensionsArb, (fixture, extensions) => {
          assertInert(fixture, extendEveryObject(fixture.wire, extensions));
        }),
        { numRuns: 100 },
      );
    });
  }

  it('parses the same when only the outermost object is extended', () => {
    fc.assert(
      fc.property(
        anyProfileFixtureArb,
        unrecognisedPropertiesArb,
        (fixture, added) => {
          assertInert(fixture, extendTopLevelOnly(fixture.wire, added));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('parses the same when a rating quantity arrives at every object', () => {
    fc.assert(
      fc.property(
        anyProfileFixtureArb,
        fc.tuple(
          unrecognisedValueArb,
          unrecognisedValueArb,
          unrecognisedValueArb,
          unrecognisedValueArb,
        ),
        (fixture, values) => {
          const added: UnrecognisedProperties = {
            plain: RATING_INTERNAL_WIRE_NAMES.map(
              (name, index) => [name, values[index]] as const,
            ),
            throwing: [],
          };

          const extended = extendEveryObject(fixture.wire, [added]);

          assertInert(fixture, extended);

          // The read-path half of Requirement 7.7: not filtered out after
          // reading, never read, so there is no key one could sit in.
          expect(ratingInternalKeysIn(acceptedProfile(extended.wire, 'the extended body'))).toStrictEqual(
            [],
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it('parses the same when every rating name is a throwing accessor', () => {
    fc.assert(
      fc.property(anyProfileFixtureArb, (fixture) => {
        const added: UnrecognisedProperties = {
          plain: [],
          throwing: [...RATING_INTERNAL_WIRE_NAMES],
        };

        assertInert(fixture, extendEveryObject(fixture.wire, [added]));
      }),
      { numRuns: 200 },
    );
  });
});

/** Every key named for a rating quantity anywhere in a parsed value's graph. */
function ratingInternalKeysIn(value: unknown): string[] {
  const forbidden = new Set<string>(RATING_INTERNAL_WIRE_NAMES);
  const found: string[] = [];
  const pending: unknown[] = [value];

  while (pending.length > 0) {
    const current = pending.pop();

    if (Array.isArray(current)) {
      pending.push(...current);

      continue;
    }

    if (!isWireObject(current)) {
      continue;
    }

    for (const [key, member] of Object.entries(current)) {
      if (forbidden.has(key)) {
        found.push(key);
      }

      pending.push(member);
    }
  }

  return found;
}

/* -------------------------------------------------------------------------- */
/* Non-vacuity: the harness adds properties, and would see a changed parse    */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 11: Unrecognised properties are inert
// Validates: Requirements 13.9
describe('the extension harness', () => {
  const added: UnrecognisedProperties = {
    plain: [
      ['mu', 25.5],
      ['sigma', 8.333],
      ['someLaterMember', { nested: [1, 2, 3] }],
    ],
    throwing: ['k', 'c'],
  };

  it('really adds every property, and the accessors really throw', () => {
    const extended = extendEveryObject(FULL_PROFILE_FIXTURE.wire, [added]);

    // The fully populated sample: the body, its record, its rating, three
    // progression records, five pairwise rows, and a rich block.
    expect(extended.sites).toHaveLength(12);
    expect(extensionFaults(extended.sites)).toStrictEqual([]);

    for (const { object } of extended.sites) {
      expect(Object.prototype.hasOwnProperty.call(object, 'mu')).toBe(true);
      expect(object.sigma).toBe(8.333);
      expect(() => object.k).toThrow();
      expect(() => object.c).toThrow();
    }

    // The fixture's own body was not touched: every comparison above is between
    // two separate bodies.
    expect(Object.prototype.hasOwnProperty.call(FULL_PROFILE_FIXTURE.wire, 'k')).toBe(
      false,
    );
  });

  it('detects an extension that did not happen', () => {
    const untouched: readonly ExtendedSite[] = [
      { label: 'profile', object: { ...FULL_PROFILE_FIXTURE.wire }, added },
    ];

    expect(extensionFaults(untouched)).not.toStrictEqual([]);
    expect(extensionFaults([])).not.toStrictEqual([]);

    // An accessor that does not throw is a witness that proves nothing.
    const inert: readonly ExtendedSite[] = [
      {
        label: 'profile',
        object: { mu: 25.5, sigma: 8.333, someLaterMember: null, k: 1, c: 2 },
        added,
      },
    ];

    expect(extensionFaults(inert)).not.toStrictEqual([]);
  });

  it('would see a parse that an overwritten recognised member changed', () => {
    // The equality in `assertInert` is only meaningful if it can fail. Each of
    // these overwrites a member the parser *does* name, which is a different
    // body rather than an additive change, and each must be visible.
    const renamed = { ...FULL_PROFILE_FIXTURE.wire, displayName: 'Someone else' };

    expect(acceptedProfile(renamed, 'a renamed body')).not.toStrictEqual(
      FULL_PROFILE_FIXTURE.parsed,
    );

    const malformed = { ...FULL_PROFILE_FIXTURE.wire, winStreak: -1 };

    expect(parsePlayerProfile(malformed).ok).toBe(false);

    // And a throwing accessor on a *recognised* member costs that member its
    // reading, rather than raising — so the tolerance above is about the names,
    // not about accessors being harmless everywhere.
    const throwingRecognised = extendObject(
      { ...FULL_PROFILE_FIXTURE.wire },
      { plain: [], throwing: ['winStreak'] },
    );

    expect(parsePlayerProfile(throwingRecognised).ok).toBe(false);
  });

  it('reaches every extension site across the generated shapes', () => {
    // A fixed seed, so the coverage claim is a fact about the generators rather
    // than a hope about a particular run.
    const fixtures = fc.sample(anyProfileFixtureArb, {
      numRuns: 300,
      seed: 20_260_101,
    });

    const seen = {
      progressionRecord: 0,
      pairwiseRow: 0,
      richBlock: 0,
      noRichBlock: 0,
      manySites: 0,
    };

    for (const fixture of fixtures) {
      const { sites } = extendEveryObject(fixture.wire, [added]);
      const labels = sites.map((site) => site.label);

      if (labels.some((label) => label.startsWith('progression['))) {
        seen.progressionRecord += 1;
      }

      if (labels.some((label) => label.startsWith('mostPlayedWith['))) {
        seen.pairwiseRow += 1;
      }

      if (labels.includes('rich')) {
        seen.richBlock += 1;
      } else {
        seen.noRichBlock += 1;
      }

      if (sites.length >= 100) {
        seen.manySites += 1;
      }
    }

    for (const [corner, count] of Object.entries(seen)) {
      expect(count, `bodies reaching ${corner}`).toBeGreaterThan(0);
    }
  });
});
