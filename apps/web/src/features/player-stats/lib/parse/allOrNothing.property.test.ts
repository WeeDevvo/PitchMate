import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  FULL_PROFILE_FIXTURE,
  MINIMAL_PROFILE_FIXTURE,
  PROFILE_FIXTURE_ARBS,
  SAMPLE_PROFILE_FIXTURES,
  anyProfileFixtureArb,
  buildPlayerProfileFixture,
  presentRichBlockFixture,
  progressionRecordFixture,
  richStatsFixture,
  wireDurationFixtureArb,
  wireInstantFixtureArb,
  type PlayerProfileFixture,
} from '../../testing/playerProfileFixtures';
import { isPlayerStatsIdentifier } from '../identifiers';
import { MEMBERSHIP_STATE_NAMES, RATING_STATE_NAMES } from '../wireEnums';
import { parsePlayerProfile, type PlayerProfile } from './playerProfile';

/**
 * Property 6: a parsed profile is never partially populated.
 *
 * The companion to Property 7. Property 7 says that a malformed member fails
 * the body carrying it; this one says what an **accepted** body yields — every
 * member of the resulting `PlayerProfile` equals its wire value under this
 * feature's declared normalisation, and no member was defaulted, repaired,
 * truncated, coerced, rounded, or clamped (Requirement 13.2).
 *
 * ## Why the positive half needs a property of its own
 *
 * "One bad member fails the body" is satisfied completely by a parser that fails
 * every body, and "the parse succeeded" is satisfied by a parser that invents
 * the half of the profile it could not read. Neither statement constrains the
 * *value*, and the value is where the damage would be: a defaulted statistic is
 * indistinguishable, once rendered, from one the backend sent. A `winStreak`
 * quietly read as `0` is a person's record erased with no indication on screen;
 * a `winPercentage` clamped from `100.1` to `100` is a perfect record presented
 * for a membership that has lost matches; an appearance count rounded from `2.5`
 * to `3` is a confident figure nobody computed. Each of those is worse than the
 * single Generic_Profile_Failure with a retry, which at least says the body
 * could not be read.
 *
 * So the subject of this file is the **accepted value**, and it is checked three
 * ways over the same generated bodies:
 *
 *  1. **Against an independent oracle.** Every fixture carries the parsed value
 *     its wire form describes, built arithmetically by
 *     `testing/playerProfileFixtures.ts` from the values the generator chose
 *     rather than by parsing anything. The parse must equal it exactly.
 *  2. **Member by member, against the wire.** The oracle could in principle be
 *     wrong in the same direction as the parser, so each scalar member is also
 *     compared with the property of the body it came from, through `Object.is`
 *     — which distinguishes `-0` from `0` and so catches a normalisation that
 *     `toStrictEqual` would let pass.
 *  3. **Structurally.** A reflective walk asserts that every object in the
 *     parsed graph carries **exactly** its declared keys, that no member
 *     anywhere is `undefined`, and that every member is of its declared kind —
 *     so "fully populated" is checked at the element level too, not only at the
 *     top. The walk's non-vacuity is asserted in the same file against a
 *     deliberately defective profile.
 *
 * ## The two declared normalisations, and the one declared drop
 *
 * Instants and durations are the only members whose parsed form differs from
 * their wire form: both are read into **milliseconds**, and the fixtures carry
 * each wire spelling beside the number it must read into, so the comparison is
 * against a known value rather than against whatever the reader produced. A
 * dedicated case re-checks each against `Date.parse` where the runtime can parse
 * the same text, which is a second oracle outside this feature entirely.
 *
 * One member of the body is deliberately *not* retained: a progression record
 * carrying no Display_Rating is a record with nothing to plot, parses
 * successfully, and contributes no point. That is a declared normalisation, not
 * a dropped member, so it is asserted exactly — the parsed progression carries
 * precisely the rated records, in their wire order, and dropping any other
 * record would fail.
 *
 * React-free and DOM-free, like every module under `lib/`.
 *
 * **Validates: Requirements 13.2**
 */

/* -------------------------------------------------------------------------- */
/* The declared shape of a parsed profile                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every parsed type's own keys, sorted — the "fully populated" claim made
 * concrete.
 *
 * Stated here rather than derived from a parsed value, so that a parser which
 * stopped emitting a member, or started emitting one, fails rather than
 * redefining the expectation. A rating summary of exactly `displayRating,state`
 * is also the read-path half of Requirement 7.7: there is no key a rating
 * internal could sit in.
 */
const DECLARED_KEYS = {
  profile: [
    'bestPartnerships',
    'bibAppearances',
    'bogeyOpponents',
    'displayName',
    'isGuest',
    'membershipId',
    'mostPlayedAgainst',
    'mostPlayedWith',
    'progression',
    'rating',
    'record',
    'rich',
    'state',
    'unbeatenStreak',
    'winPercentage',
    'winStreak',
  ].join(','),
  record: ['appearances', 'draws', 'losses', 'wins'].join(','),
  rating: ['displayRating', 'state'].join(','),
  progressionPoint: ['completedAtMs', 'displayRating'].join(','),
  coAppearance: ['count', 'displayName', 'membershipId'].join(','),
  pairedStat: [
    'displayName',
    'membershipId',
    'qualifyingMatches',
    'value',
  ].join(','),
  rich: [
    'cleanSheets',
    'goals',
    'goalsConcededAsKeeper',
    'keeperTimeMs',
  ].join(','),
} as const;

/** A value's own keys, sorted, as a comparable signature. */
function keySignature(value: object): string {
  return Object.keys(value).sort().join(',');
}

/** Whether a value is a count the contract admits. */
function isCount(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Whether a value is a percentage the contract admits. */
function isPercentage(value: unknown): boolean {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
  );
}

/** Whether a value is a finite number. */
function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Every way the given value falls short of a fully populated `PlayerProfile`,
 * as diagnostics naming the member.
 *
 * Returns findings rather than asserting, so the same walk can be pointed at a
 * deliberately defective value to prove it detects one (see the non-vacuity case
 * at the foot of this file). It takes `unknown` for the same reason: a walker
 * that only accepted a well-typed profile could not be shown to fire.
 */
function populationFaults(candidate: unknown): string[] {
  const faults: string[] = [];

  if (typeof candidate !== 'object' || candidate === null) {
    return ['the profile is not an object'];
  }

  const profile = candidate as Record<string, unknown>;

  if (keySignature(profile) !== DECLARED_KEYS.profile) {
    faults.push(`the profile's keys are ${keySignature(profile)}`);
  }

  for (const [key, value] of Object.entries(profile)) {
    if (value === undefined) {
      faults.push(`\`${key}\` is undefined`);
    }
  }

  if (!isPlayerStatsIdentifier(profile.membershipId)) {
    faults.push('`membershipId` is not an identity');
  }

  if (typeof profile.displayName !== 'string') {
    faults.push('`displayName` is not a string');
  }

  if (
    profile.state !== null &&
    !MEMBERSHIP_STATE_NAMES.includes(profile.state as never)
  ) {
    faults.push('`state` is neither absent nor a membership state');
  }

  if (typeof profile.isGuest !== 'boolean') {
    faults.push('`isGuest` is not a boolean');
  }

  if (profile.winPercentage !== null && !isPercentage(profile.winPercentage)) {
    faults.push('`winPercentage` is neither absent nor a percentage');
  }

  for (const key of ['winStreak', 'unbeatenStreak', 'bibAppearances']) {
    if (!isCount(profile[key])) {
      faults.push(`\`${key}\` is not a count`);
    }
  }

  faults.push(...recordFaults(profile.record));
  faults.push(...ratingFaults(profile.rating));
  faults.push(...progressionFaults(profile.progression));
  faults.push(
    ...coAppearanceCollectionFaults(profile.mostPlayedWith, 'mostPlayedWith'),
    ...coAppearanceCollectionFaults(
      profile.mostPlayedAgainst,
      'mostPlayedAgainst',
    ),
    ...pairedStatCollectionFaults(profile.bestPartnerships, 'bestPartnerships'),
    ...pairedStatCollectionFaults(profile.bogeyOpponents, 'bogeyOpponents'),
  );
  faults.push(...richFaults(profile.rich));

  return faults;
}

function recordFaults(candidate: unknown): string[] {
  if (typeof candidate !== 'object' || candidate === null) {
    return ['`record` is not an object'];
  }

  const record = candidate as Record<string, unknown>;
  const faults: string[] = [];

  if (keySignature(record) !== DECLARED_KEYS.record) {
    faults.push(`\`record\`'s keys are ${keySignature(record)}`);
  }

  for (const key of ['appearances', 'wins', 'draws', 'losses']) {
    if (!isCount(record[key])) {
      faults.push(`\`record.${key}\` is not a count`);
    }
  }

  return faults;
}

function ratingFaults(candidate: unknown): string[] {
  if (typeof candidate !== 'object' || candidate === null) {
    return ['`rating` is not an object'];
  }

  const rating = candidate as Record<string, unknown>;
  const faults: string[] = [];

  if (keySignature(rating) !== DECLARED_KEYS.rating) {
    faults.push(`\`rating\`'s keys are ${keySignature(rating)}`);
  }

  if (
    rating.state !== null &&
    !RATING_STATE_NAMES.includes(rating.state as never)
  ) {
    faults.push('`rating.state` is neither absent nor a rating state');
  }

  if (rating.displayRating !== null && !isFiniteNumber(rating.displayRating)) {
    faults.push('`rating.displayRating` is neither absent nor a finite number');
  }

  return faults;
}

function progressionFaults(candidate: unknown): string[] {
  if (!Array.isArray(candidate)) {
    return ['`progression` is not an array'];
  }

  const faults: string[] = [];

  candidate.forEach((element: unknown, index) => {
    if (typeof element !== 'object' || element === null) {
      faults.push(`\`progression[${String(index)}]\` is not an object`);

      return;
    }

    const point = element as Record<string, unknown>;

    if (keySignature(point) !== DECLARED_KEYS.progressionPoint) {
      faults.push(
        `\`progression[${String(index)}]\`'s keys are ${keySignature(point)}`,
      );
    }

    if (!isFiniteNumber(point.completedAtMs)) {
      faults.push(
        `\`progression[${String(index)}].completedAtMs\` is not an instant`,
      );
    }

    // Non-nullable by design: a record carrying no rating is no point at all.
    if (!isFiniteNumber(point.displayRating)) {
      faults.push(
        `\`progression[${String(index)}].displayRating\` is not a finite number`,
      );
    }
  });

  return faults;
}

function coAppearanceCollectionFaults(
  candidate: unknown,
  label: string,
): string[] {
  if (!Array.isArray(candidate)) {
    return [`\`${label}\` is not an array`];
  }

  const faults: string[] = [];

  candidate.forEach((element: unknown, index) => {
    const at = `\`${label}[${String(index)}]\``;

    if (typeof element !== 'object' || element === null) {
      faults.push(`${at} is not an object`);

      return;
    }

    const entry = element as Record<string, unknown>;

    if (keySignature(entry) !== DECLARED_KEYS.coAppearance) {
      faults.push(`${at}'s keys are ${keySignature(entry)}`);
    }

    if (!isPlayerStatsIdentifier(entry.membershipId)) {
      faults.push(`${at}.membershipId is not an identity`);
    }

    if (typeof entry.displayName !== 'string') {
      faults.push(`${at}.displayName is not a string`);
    }

    if (!isCount(entry.count)) {
      faults.push(`${at}.count is not a count`);
    }
  });

  return faults;
}

function pairedStatCollectionFaults(
  candidate: unknown,
  label: string,
): string[] {
  if (!Array.isArray(candidate)) {
    return [`\`${label}\` is not an array`];
  }

  const faults: string[] = [];

  candidate.forEach((element: unknown, index) => {
    const at = `\`${label}[${String(index)}]\``;

    if (typeof element !== 'object' || element === null) {
      faults.push(`${at} is not an object`);

      return;
    }

    const entry = element as Record<string, unknown>;

    if (keySignature(entry) !== DECLARED_KEYS.pairedStat) {
      faults.push(`${at}'s keys are ${keySignature(entry)}`);
    }

    if (!isPlayerStatsIdentifier(entry.membershipId)) {
      faults.push(`${at}.membershipId is not an identity`);
    }

    if (typeof entry.displayName !== 'string') {
      faults.push(`${at}.displayName is not a string`);
    }

    if (!isPercentage(entry.value)) {
      faults.push(`${at}.value is not a percentage`);
    }

    if (!isCount(entry.qualifyingMatches)) {
      faults.push(`${at}.qualifyingMatches is not a count`);
    }
  });

  return faults;
}

function richFaults(candidate: unknown): string[] {
  if (candidate === null) {
    return [];
  }

  if (typeof candidate !== 'object') {
    return ['`rich` is neither absent nor an object'];
  }

  const rich = candidate as Record<string, unknown>;
  const faults: string[] = [];

  if (keySignature(rich) !== DECLARED_KEYS.rich) {
    faults.push(`\`rich\`'s keys are ${keySignature(rich)}`);
  }

  for (const key of ['goals', 'cleanSheets', 'goalsConcededAsKeeper']) {
    if (rich[key] !== null && !isCount(rich[key])) {
      faults.push(`\`rich.${key}\` is neither absent nor a count`);
    }
  }

  if (rich.keeperTimeMs !== null && !isCount(rich.keeperTimeMs)) {
    faults.push('`rich.keeperTimeMs` is neither absent nor a duration');
  }

  return faults;
}

/* -------------------------------------------------------------------------- */
/* Reading the wire side                                                      */
/* -------------------------------------------------------------------------- */

/** One property of a wire object, or `undefined` when it carries none. */
function wireMember(source: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(source, key)
    ? source[key]
    : undefined;
}

/**
 * The value a declared-optional member must read as: `null` and an absent
 * property are the same absence (Requirement 13.6).
 */
function absentAsNull(source: Record<string, unknown>, key: string): unknown {
  const value = wireMember(source, key);

  return value === undefined ? null : value;
}

/** A nested wire object, asserted to be one. */
function wireObject(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = wireMember(source, key);

  expect(typeof value).toBe('object');
  expect(value).not.toBeNull();

  return value as Record<string, unknown>;
}

/** A nested wire array of objects, asserted to be one. */
function wireArray(
  source: Record<string, unknown>,
  key: string,
): readonly Record<string, unknown>[] {
  const value = wireMember(source, key);

  expect(Array.isArray(value)).toBe(true);

  return value as readonly Record<string, unknown>[];
}

/** A deep copy of a plain wire value, for the "the body is unmodified" case. */
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

/* -------------------------------------------------------------------------- */
/* The frame: a parse settles, raising nothing, and carries a whole value     */
/* -------------------------------------------------------------------------- */

/**
 * The profile a fixture's body parses to, with the frame of the property
 * asserted on the way through: the parser raises nothing, the result is one of
 * the two declared shapes with exactly its own keys, and the body was accepted.
 *
 * A raise is not a parse failure — it escapes the call site and takes the
 * screen's own error handling with it (Requirement 13.1) — so it is reported as
 * a distinct fault rather than as a rejected body.
 */
function acceptedProfile(fixture: PlayerProfileFixture): PlayerProfile {
  let outcome;

  try {
    outcome = parsePlayerProfile(fixture.wire);
  } catch (raised) {
    throw new Error(
      `the parser raised instead of settling: ${String(raised)}`,
      { cause: raised },
    );
  }

  expect(typeof outcome).toBe('object');
  expect(outcome).not.toBeNull();
  expect(typeof outcome.ok).toBe('boolean');

  if (!outcome.ok) {
    throw new Error(
      `a valid body was rejected: ${outcome.reason} — ${JSON.stringify(fixture.wire)}`,
    );
  }

  // All-or-nothing on the accepting side: a success is a value and nothing
  // else, so there is no diagnostic for a caller to render beside a statistic.
  expect(keySignature(outcome)).toBe('ok,value');

  return outcome.value;
}

/* -------------------------------------------------------------------------- */
/* Property 6, over every generated body shape                                */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 6: A parsed profile is never partially populated
// Validates: Requirements 13.2
describe('a parsed profile is never partially populated', () => {
  for (const shape of PROFILE_FIXTURE_ARBS) {
    it(`yields exactly the profile a body with ${shape.label} describes`, () => {
      fc.assert(
        fc.property(shape.arbitrary, (fixture) => {
          const profile = acceptedProfile(fixture);

          // The independent oracle: the fixture built this value from the
          // choices its generator made, without parsing anything.
          expect(profile).toStrictEqual(fixture.parsed);

          // And the value is whole: exactly the declared keys, nothing
          // `undefined`, every member of its declared kind, at every level.
          expect(populationFaults(profile)).toStrictEqual([]);
        }),
        { numRuns: 100 },
      );
    });
  }

  it('reads every scalar member exactly as the wire carried it', () => {
    fc.assert(
      fc.property(anyProfileFixtureArb, (fixture) => {
        const profile = acceptedProfile(fixture);
        const wire = fixture.wire;

        // `Object.is` rather than `toBe`-style equality throughout, because it
        // separates `-0` from `0`: a reader that normalised the sign of a zero
        // count or a zero percentage would be a reader that altered a value,
        // and `toStrictEqual` would let it pass.
        expect(Object.is(profile.membershipId, wire.membershipId)).toBe(true);
        expect(Object.is(profile.displayName, wire.displayName)).toBe(true);
        expect(Object.is(profile.isGuest, wire.isGuest)).toBe(true);
        expect(Object.is(profile.winStreak, wire.winStreak)).toBe(true);
        expect(Object.is(profile.unbeatenStreak, wire.unbeatenStreak)).toBe(
          true,
        );
        expect(Object.is(profile.bibAppearances, wire.bibAppearances)).toBe(
          true,
        );

        // The declared absences: `null` and an omitted property read alike.
        expect(Object.is(profile.state, absentAsNull(wire, 'state'))).toBe(
          true,
        );
        expect(
          Object.is(profile.winPercentage, absentAsNull(wire, 'winPercentage')),
        ).toBe(true);

        const record = wireObject(wire, 'record');

        expect(Object.is(profile.record.appearances, record.appearances)).toBe(
          true,
        );
        expect(Object.is(profile.record.wins, record.wins)).toBe(true);
        expect(Object.is(profile.record.draws, record.draws)).toBe(true);
        expect(Object.is(profile.record.losses, record.losses)).toBe(true);

        const rating = wireObject(wire, 'rating');

        expect(
          Object.is(profile.rating.state, absentAsNull(rating, 'state')),
        ).toBe(true);
        expect(
          Object.is(
            profile.rating.displayRating,
            absentAsNull(rating, 'displayRating'),
          ),
        ).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('reads every collection entire, in its wire order, element by element', () => {
    fc.assert(
      fc.property(anyProfileFixtureArb, (fixture) => {
        const profile = acceptedProfile(fixture);
        const wire = fixture.wire;

        for (const key of ['mostPlayedWith', 'mostPlayedAgainst'] as const) {
          const rows = wireArray(wire, key);
          const parsed = profile[key];

          // Exactly as many rows as were sent — not "at least", and not "the
          // same set". A dropped row would silently remove a player from a
          // ranked list, with nothing on screen saying so.
          expect(parsed).toHaveLength(rows.length);

          rows.forEach((row, index) => {
            const entry = parsed[index];

            expect(Object.is(entry.membershipId, row.membershipId)).toBe(true);
            expect(Object.is(entry.displayName, row.displayName)).toBe(true);
            expect(Object.is(entry.count, row.count)).toBe(true);
          });
        }

        for (const key of ['bestPartnerships', 'bogeyOpponents'] as const) {
          const rows = wireArray(wire, key);
          const parsed = profile[key];

          expect(parsed).toHaveLength(rows.length);

          rows.forEach((row, index) => {
            const entry = parsed[index];

            expect(Object.is(entry.membershipId, row.membershipId)).toBe(true);
            expect(Object.is(entry.displayName, row.displayName)).toBe(true);
            expect(Object.is(entry.value, row.value)).toBe(true);
            expect(
              Object.is(entry.qualifyingMatches, row.qualifyingMatches),
            ).toBe(true);
          });
        }
      }),
      { numRuns: 200 },
    );
  });

  it('carries exactly the progression records that bear a display rating', () => {
    fc.assert(
      fc.property(anyProfileFixtureArb, (fixture) => {
        const profile = acceptedProfile(fixture);
        const records = wireArray(fixture.wire, 'progression');

        // The one declared normalisation that shortens a collection: a record
        // with nothing to plot parses and contributes no point. Every *other*
        // record must survive, in order.
        const rated = records.filter(
          (record) => absentAsNull(record, 'displayRating') !== null,
        );

        expect(profile.progression).toHaveLength(rated.length);

        rated.forEach((record, index) => {
          const point = profile.progression[index];

          expect(
            Object.is(point.displayRating, wireMember(record, 'displayRating')),
          ).toBe(true);
        });
      }),
      { numRuns: 200 },
    );
  });

  it('normalises an instant and a duration to the milliseconds they name', () => {
    fc.assert(
      fc.property(
        wireInstantFixtureArb,
        wireDurationFixtureArb,
        (instant, duration) => {
          // The minimal sample, with one rated progression point and a rich
          // block, so the two normalising readers are the only thing varying.
          const fixture = buildPlayerProfileFixture({
            ...MINIMAL_PROFILE_FIXTURE.parts,
            progression: [
              progressionRecordFixture({
                instant,
                displayRating: 1_200,
                displayRatingAbsence: 'null',
                state: null,
                modelValues: [0, 0],
              }),
            ],
            rich: presentRichBlockFixture(
              richStatsFixture({
                goals: null,
                cleanSheets: null,
                goalsConcededAsKeeper: null,
                keeperTime: duration,
                absence: 'null',
              }),
            ),
          });

          const profile = acceptedProfile(fixture);

          expect(profile.progression).toHaveLength(1);
          expect(Object.is(profile.progression[0].completedAtMs, instant.ms)).toBe(
            true,
          );
          expect(Object.is(profile.rich?.keeperTimeMs, duration.ms)).toBe(true);

          // A second oracle from outside this feature: where the runtime can
          // read the same text, it must name the same instant. Nothing is
          // rounded to a second and nothing is shifted by an offset.
          const runtimeMs = Date.parse(instant.wire);

          if (!Number.isNaN(runtimeMs)) {
            expect(runtimeMs).toBe(instant.ms);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('is pure: the same body yields the same profile and is left unmodified', () => {
    fc.assert(
      fc.property(anyProfileFixtureArb, (fixture) => {
        const before = deepCopy(fixture.wire);

        const first = acceptedProfile(fixture);
        const second = acceptedProfile(fixture);

        expect(second).toStrictEqual(first);

        // Nothing was repaired *in place*: a parser that normalised the body it
        // read would make the second parse a different question from the first.
        expect(fixture.wire).toStrictEqual(before);
      }),
      { numRuns: 200 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Non-vacuity: the fixtures reach the corners, and the walk detects a fault  */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 6: A parsed profile is never partially populated
// Validates: Requirements 13.2
describe('the population walk and the body fixtures', () => {
  it('accepts both fixed samples whole', () => {
    for (const { label, fixture } of SAMPLE_PROFILE_FIXTURES) {
      const profile = acceptedProfile(fixture);

      expect(profile, label).toStrictEqual(fixture.parsed);
      expect(populationFaults(profile)).toStrictEqual([]);
    }

    // The two samples are the two ends of the body: every optional member
    // omitted, and every optional member present. If they ever converge, this
    // suite has stopped covering the absences.
    expect(MINIMAL_PROFILE_FIXTURE.parsed.rich).toBeNull();
    expect(MINIMAL_PROFILE_FIXTURE.parsed.winPercentage).toBeNull();
    expect(MINIMAL_PROFILE_FIXTURE.parsed.state).toBeNull();
    expect(MINIMAL_PROFILE_FIXTURE.parsed.rating.state).toBeNull();
    expect(MINIMAL_PROFILE_FIXTURE.parsed.rating.displayRating).toBeNull();
    expect(FULL_PROFILE_FIXTURE.parsed.rich).not.toBeNull();
    expect(FULL_PROFILE_FIXTURE.parsed.winPercentage).not.toBeNull();
    // Three wire records, one of them carrying no rating: the declared drop is
    // exercised by the fixed sample as well as by the generators.
    expect(FULL_PROFILE_FIXTURE.parsed.progression).toHaveLength(2);
  });

  it('detects a partially populated profile', () => {
    const whole = MINIMAL_PROFILE_FIXTURE.parsed;

    // Were the walk vacuous, every assertion above would hold of a parser that
    // defaulted half the body. Each planted defect below is one such parser's
    // output, and each must be found.
    const planted: readonly { readonly label: string; readonly value: unknown }[] =
      [
        { label: 'a member left undefined', value: { ...whole, winStreak: undefined } },
        { label: 'a member defaulted away', value: { ...whole, bibAppearances: -1 } },
        {
          label: 'a count rounded from a fraction',
          value: { ...whole, record: { ...whole.record, appearances: 2.5 } },
        },
        {
          label: 'a percentage clamped into range',
          value: { ...whole, winPercentage: 100.1 },
        },
        { label: 'a member dropped entirely', value: { ...whole, rating: undefined } },
        {
          label: 'a rating internal smuggled in',
          value: { ...whole, rating: { ...whole.rating, spread: 8.333 } },
        },
        {
          label: 'a state outside its vocabulary',
          value: { ...whole, state: 'active' },
        },
        {
          label: 'a progression point without an instant',
          value: { ...whole, progression: [{ displayRating: 1_200 }] },
        },
        { label: 'not a profile at all', value: null },
      ];

    for (const { label, value } of planted) {
      expect(populationFaults(value), label).not.toStrictEqual([]);
    }

    // And it is not simply firing on everything.
    expect(populationFaults(whole)).toStrictEqual([]);
    expect(populationFaults(FULL_PROFILE_FIXTURE.parsed)).toStrictEqual([]);
  });

  it('generates bodies reaching every corner the property needs', () => {
    // A fixed seed, so the coverage claim is a fact about the generators rather
    // than a hope about a particular run.
    const fixtures = fc.sample(anyProfileFixtureArb, {
      numRuns: 400,
      seed: 20_260_101,
    });

    const seen = {
      emptyPairwise: 0,
      largePairwise: 0,
      emptyProgression: 0,
      longProgression: 0,
      droppedPoint: 0,
      provisional: 0,
      established: 0,
      ratingStateAbsent: 0,
      displayRatingAbsent: 0,
      richAbsent: 0,
      richAllAbsent: 0,
      richPopulated: 0,
      stateAbsent: 0,
      winPercentageAbsent: 0,
      nullSpelling: 0,
      missingSpelling: 0,
      guest: 0,
    };

    for (const fixture of fixtures) {
      const { parsed, parts, wire } = fixture;

      if (parsed.mostPlayedWith.length === 0) seen.emptyPairwise += 1;
      if (parsed.mostPlayedWith.length >= 200) seen.largePairwise += 1;
      if (parts.progression.length === 0) seen.emptyProgression += 1;
      if (parts.progression.length >= 500) seen.longProgression += 1;
      if (parsed.progression.length < parts.progression.length) {
        seen.droppedPoint += 1;
      }
      if (parsed.rating.state === 'Provisional') seen.provisional += 1;
      if (parsed.rating.state === 'Established') seen.established += 1;
      if (parsed.rating.state === null) seen.ratingStateAbsent += 1;
      if (parsed.rating.displayRating === null) seen.displayRatingAbsent += 1;
      if (parsed.rich === null) seen.richAbsent += 1;
      if (
        parsed.rich !== null &&
        parsed.rich.goals === null &&
        parsed.rich.cleanSheets === null &&
        parsed.rich.goalsConcededAsKeeper === null &&
        parsed.rich.keeperTimeMs === null
      ) {
        seen.richAllAbsent += 1;
      }
      if (parsed.rich !== null && parsed.rich.keeperTimeMs !== null) {
        seen.richPopulated += 1;
      }
      if (parsed.state === null) seen.stateAbsent += 1;
      if (parsed.winPercentage === null) seen.winPercentageAbsent += 1;
      if (parsed.isGuest) seen.guest += 1;
      if (parsed.rich === null && 'rich' in wire) seen.nullSpelling += 1;
      if (parsed.rich === null && !('rich' in wire)) seen.missingSpelling += 1;
    }

    for (const [corner, count] of Object.entries(seen)) {
      expect(count, `${corner} was never generated`).toBeGreaterThan(0);
    }
  });
});
