import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  FULL_PROFILE_FIXTURE,
  absenceSpellingArb,
  buildPlayerProfileFixture,
  fullyPopulatedRichStatsFixtureArb,
  playerProfileFixtureArb,
  presentRichBlockFixture,
  ratedProgressionRecordFixtureArb,
  ratingSummaryFixture,
  wireDisplayRatingArb,
  wirePercentageArb,
  wireRatingStateArb,
  type PlayerProfileFixture,
  type WireFixture,
} from '../../testing/playerProfileFixtures';
import {
  parsePlayerProfile,
  type PlayerProfile,
  type RatingSummary,
} from './playerProfile';
import type { ParseResult } from './primitives';

/**
 * Property 9: a string-encoded number is rejected wherever a number is read.
 *
 * The backend's own exporter schematises **every integer as
 * `["integer","string"]`**, so a string-encoded figure is not a hypothetical
 * fault: it is a shape the published contract permits and a shape a careless
 * serialiser, a hand-written stub, or a proxy that rewrites a body could
 * actually send. This feature accepts the JSON number form and nothing else
 * (Requirement 13.5), and this file is the statement of that: for **every**
 * numeric member of the body, replacing the number with the decimal string of
 * the same value fails the parse.
 *
 * ## Why it matters that the string names the same number
 *
 * A reader that coerced would look correct in every ordinary test: `Number('12')`
 * is `12`, and a `'12'` appearance count rendered as `12` is the figure the
 * backend meant. The damage is in what coercion also admits once it is the rule
 * — `''` reading as `0`, `'1e3'` as `1000`, `' 12 '` as `12` — and in the
 * printer, whose contract is "emit a body this parser accepts"
 * (Requirement 13.7): if both forms parsed, the round trip would no longer pin
 * a single wire shape and two bodies that disagree would both be valid.
 *
 * So each mutation here is deliberately the *benign* one. The replacement is the
 * decimal text of the very number it replaces, asserted value-preserving on
 * every run (`Number(encoded) === replaced`), and the surrounding body is left
 * untouched. A parse that accepted it would be coercing, not recovering.
 *
 * ## Enumerated, so the contract cannot grow a gap
 *
 * The nineteen numeric sites are listed by path in {@link NUMERIC_SITES} — the
 * four record counts, the Win_Percentage, the rating's Display_Rating, a
 * progression point's Display_Rating, both streaks, the Bib_Appearance count, a
 * co-appearance count in each of the two Pairwise_Sections that carry one, and a
 * paired statistic's percentage and qualifying-match count in each of the other
 * two, plus the three whole-number members of the Rich_Stats block.
 *
 * An enumeration can rot, so it is checked against the bodies rather than
 * trusted: a reflective walk collects **every** path at which a generated body
 * carries a number, and asserts that set is exactly the enumerated sites plus
 * the wire's two rating-model members, which this feature declares unread
 * (Requirement 7.7). A numeric member added to the contract therefore fails this
 * file until a case covers it, and an enumerated site that disappeared fails it
 * too. The unread members are checked from the other side in the same file:
 * string-encoding one of those is **inert**, which is what shows each rejection
 * above is the work of that member's own reader rather than of anything
 * incidental about a string appearing in the body.
 *
 * Non-vacuity throughout: every body is parsed unmutated before and after its
 * mutation and must be accepted both times, each mutation is asserted to replace
 * exactly one numeric leaf with exactly one string leaf, and every rejection is
 * asserted to carry **no value** — a failure is a reason and nothing else, so
 * there is no half-read profile for a screen to render beside it.
 *
 * React-free and DOM-free, like every module under `lib/`.
 *
 * **Validates: Requirements 13.5**
 */

/* -------------------------------------------------------------------------- */
/* Paths into a wire body                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The path segment standing for "an element of this collection", so that one
 * site names the same member of every element rather than of a fixed index.
 *
 * Which element a mutation lands on is chosen per run (see
 * {@link INDEX_CHOICES}), and the collapsed form is also the label a reflective
 * walk reports — `mostPlayedWith[].count` — so an enumerated site and a
 * discovered one are comparable.
 */
const ELEMENT = '[]';

/** One member of the body at which a number is read. */
interface NumericSite {
  /** The dotted path, with {@link ELEMENT} for a collection step. */
  readonly label: string;
  /** The path itself, as the mutation walks it. */
  readonly path: readonly string[];
}

/** A path rendered as a label: `rich.goals`, `progression[].displayRating`. */
function labelOf(path: readonly string[]): string {
  return path.reduce<string>((text, segment) => {
    if (segment === ELEMENT) {
      return `${text}[]`;
    }

    return text === '' ? segment : `${text}.${segment}`;
  }, '');
}

/** A site, with its label derived from its path so the two cannot disagree. */
function site(path: readonly string[]): NumericSite {
  return { label: labelOf(path), path };
}

/**
 * Every numeric member of the `GetPlayerProfile` body, listed explicitly.
 *
 * Listed rather than discovered, because a discovered list would quietly accept
 * a contract that grew a numeric member nobody wrote a case for. The
 * completeness of this list against the bodies the fixtures send is asserted at
 * the foot of this file.
 */
const NUMERIC_SITES: readonly NumericSite[] = [
  // The four counts of the Player_Record.
  site(['record', 'appearances']),
  site(['record', 'wins']),
  site(['record', 'draws']),
  site(['record', 'losses']),
  // The Win_Percentage, read through the percentage reader.
  site(['winPercentage']),
  // Both Display_Ratings: the summary's, and a progression point's.
  site(['rating', 'displayRating']),
  site(['progression', ELEMENT, 'displayRating']),
  // The two streak lengths and the Bib_Appearance count.
  site(['winStreak']),
  site(['unbeatenStreak']),
  site(['bibAppearances']),
  // A co-appearance count, in each section that carries one.
  site(['mostPlayedWith', ELEMENT, 'count']),
  site(['mostPlayedAgainst', ELEMENT, 'count']),
  // A paired statistic's percentage and its denominator, in each section.
  site(['bestPartnerships', ELEMENT, 'value']),
  site(['bogeyOpponents', ELEMENT, 'value']),
  site(['bestPartnerships', ELEMENT, 'qualifyingMatches']),
  site(['bogeyOpponents', ELEMENT, 'qualifyingMatches']),
  // The three whole-number members of the Rich_Stats block. Its fourth member,
  // the Keeper_Time, is transmitted as a duration string and is not a number on
  // the wire at all, so it is not a site of this property.
  site(['rich', 'goals']),
  site(['rich', 'cleanSheets']),
  site(['rich', 'goalsConcededAsKeeper']),
];

/**
 * The wire's two rating-model member names, spelled as strings.
 *
 * The body carries them on the rating summary and on every progression point,
 * and **no parser of this feature names either** (Requirement 7.7). They are
 * therefore numeric members of the body that this property deliberately does
 * *not* claim a rejection for — string-encoding one is inert, asserted below.
 * Spelling them as string constants rather than as identifiers keeps this file
 * clean for the feature's rating-internal source scan.
 */
const UNREAD_NUMERIC_MEMBERS = ['mu', 'sigma'] as const;

/** Every numeric member of the body that no parser reads. */
const UNREAD_NUMERIC_SITES: readonly NumericSite[] = [
  ...UNREAD_NUMERIC_MEMBERS.map((member) => site(['rating', member])),
  ...UNREAD_NUMERIC_MEMBERS.map((member) =>
    site(['progression', ELEMENT, member]),
  ),
];

/* -------------------------------------------------------------------------- */
/* The mutation                                                               */
/* -------------------------------------------------------------------------- */

/** Which element of a collection a mutation lands on. */
type IndexChoice = 'first' | 'middle' | 'last';

/** The three positions worth landing on. */
const INDEX_CHOICES = ['first', 'middle', 'last'] as const;

/** One of the three positions. */
const indexChoiceArb: fc.Arbitrary<IndexChoice> =
  fc.constantFrom<IndexChoice>(...INDEX_CHOICES);

/** The index a choice names in a collection of the given length. */
function chooseIndex(length: number, choice: IndexChoice): number {
  switch (choice) {
    case 'first':
      return 0;
    case 'middle':
      return Math.floor((length - 1) / 2);
    case 'last':
      return length - 1;
  }
}

/** A body with one number string-encoded, and the two forms of that number. */
interface EncodedBody {
  /** The body, copied, with the one member replaced. */
  readonly body: unknown;
  /** The number that was replaced. */
  readonly replaced: number;
  /** The decimal text it was replaced by. */
  readonly encoded: string;
}

/**
 * The decimal text of a number — the string form a serialiser that emitted this
 * figure as a string would produce.
 *
 * An integral value goes through `BigInt`, which renders its exact digits with
 * no exponent: `String(1e21)` would be `'1e+21'`, and a value beyond the exactly
 * representable range would lose its tail. A fractional value goes through
 * `String`, which is its shortest round-tripping text; for a magnitude below
 * `1e-6` that text carries an exponent, which is the only decimal form the
 * runtime can write for such a value and is still a string naming the same
 * number.
 *
 * Value-preserving in every case, and asserted so on every run: a mutation that
 * changed the figure as well as its form would be testing something else.
 */
function decimalStringOf(value: number): string {
  if (Number.isInteger(value)) {
    return BigInt(value).toString();
  }

  return String(value);
}

/**
 * `body` copied, with the number at `path` replaced by its decimal string — or
 * `null` when the body carries no number there.
 *
 * Copies rather than writes, at every level it descends, so the caller's body is
 * never reordered or rewritten and can be re-parsed afterwards to show the
 * mutation was the only difference.
 *
 * Reports `null` rather than asserting, so the same function can be pointed at a
 * path that holds no number to prove it detects one (see the mechanism cases at
 * the foot of this file). Every call made by the properties themselves asserts
 * on a `null`, because the bodies they generate carry every site.
 */
function encodeNumberAt(
  body: unknown,
  path: readonly string[],
  choice: IndexChoice,
): EncodedBody | null {
  if (path.length === 0) {
    if (typeof body !== 'number') {
      return null;
    }

    const encoded = decimalStringOf(body);

    return { body: encoded, replaced: body, encoded };
  }

  const [head, ...rest] = path;

  if (head === ELEMENT) {
    if (!Array.isArray(body) || body.length === 0) {
      return null;
    }

    const elements = body as readonly unknown[];
    const index = chooseIndex(elements.length, choice);
    const inner = encodeNumberAt(elements[index], rest, choice);

    if (inner === null) {
      return null;
    }

    const copy = [...elements];
    copy[index] = inner.body;

    return { ...inner, body: copy };
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return null;
  }

  const source = body as Record<string, unknown>;

  if (!Object.prototype.hasOwnProperty.call(source, head)) {
    return null;
  }

  const inner = encodeNumberAt(source[head], rest, choice);

  if (inner === null) {
    return null;
  }

  return { ...inner, body: { ...source, [head]: inner.body } };
}

/** The encoding at a site, asserted to have landed on a number. */
function encodedAt(
  body: unknown,
  numericSite: NumericSite,
  choice: IndexChoice,
): EncodedBody {
  const encoded = encodeNumberAt(body, numericSite.path, choice);

  if (encoded === null) {
    throw new Error(
      `the body carries no number at \`${numericSite.label}\`, so the ${choice} element case asserts nothing`,
    );
  }

  // The replacement names the same number, in string form and nothing else.
  // `===` rather than `Object.is`, because `-0` is a generated count and its
  // decimal text is `'0'`: the same number, written down.
  expect(typeof encoded.encoded, numericSite.label).toBe('string');
  expect(Number(encoded.encoded) === encoded.replaced, numericSite.label).toBe(
    true,
  );

  return encoded;
}

/* -------------------------------------------------------------------------- */
/* Reflective walks over a wire body                                          */
/* -------------------------------------------------------------------------- */

/** Every path at which `value` carries a number, as collapsed labels. */
function collectNumericPaths(
  value: unknown,
  path: readonly string[],
  into: Set<string>,
): void {
  if (typeof value === 'number') {
    into.add(labelOf(path));

    return;
  }

  if (Array.isArray(value)) {
    for (const element of value as readonly unknown[]) {
      collectNumericPaths(element, [...path, ELEMENT], into);
    }

    return;
  }

  if (typeof value === 'object' && value !== null) {
    for (const [key, member] of Object.entries(
      value as Record<string, unknown>,
    )) {
      collectNumericPaths(member, [...path, key], into);
    }
  }
}

/** How many number and string leaves a value carries. */
interface LeafCounts {
  readonly numbers: number;
  readonly strings: number;
}

/** The number and string leaves of a value, counted. */
function leafCounts(value: unknown): LeafCounts {
  if (typeof value === 'number') {
    return { numbers: 1, strings: 0 };
  }

  if (typeof value === 'string') {
    return { numbers: 0, strings: 1 };
  }

  const members: readonly unknown[] = Array.isArray(value)
    ? (value as readonly unknown[])
    : typeof value === 'object' && value !== null
      ? Object.values(value as Record<string, unknown>)
      : [];

  return members.reduce<LeafCounts>(
    (total, member) => {
      const counts = leafCounts(member);

      return {
        numbers: total.numbers + counts.numbers,
        strings: total.strings + counts.strings,
      };
    },
    { numbers: 0, strings: 0 },
  );
}

/* -------------------------------------------------------------------------- */
/* Settling, accepting, rejecting                                             */
/* -------------------------------------------------------------------------- */

/**
 * The parse of a body, with a raise reported as the distinct fault it is: a
 * raise is not a rejection, it escapes the call site and takes the screen's own
 * handling with it (Requirement 13.1).
 */
function parseSettling(body: unknown): ParseResult<PlayerProfile> {
  try {
    return parsePlayerProfile(body);
  } catch (raised) {
    throw new Error(`the parser raised instead of settling: ${String(raised)}`, {
      cause: raised,
    });
  }
}

/** The profile an accepted body yields, asserted accepted. */
function expectAccepted(body: unknown, label: string): PlayerProfile {
  const outcome = parseSettling(body);

  if (!outcome.ok) {
    throw new Error(`${label} was rejected: ${outcome.reason}`);
  }

  return outcome.value;
}

/**
 * A body asserted rejected, **carrying no value**: a failure is a reason and
 * nothing else, so there is no partially read profile beside it for a caller to
 * render (Requirements 13.2, 13.3).
 */
function expectRejected(body: unknown, label: string): void {
  const outcome = parseSettling(body);

  expect(outcome.ok, label).toBe(false);
  expect(Object.keys(outcome).sort().join(','), label).toBe('ok,reason');
  expect('value' in outcome, label).toBe(false);
}

/* -------------------------------------------------------------------------- */
/* Bodies carrying every numeric member                                       */
/* -------------------------------------------------------------------------- */

/** A finite value of the wire's rating-model members, which no parser reads. */
const unreadModelValueArb: fc.Arbitrary<number> = fc
  .double({ noNaN: true, noDefaultInfinity: true })
  .filter((value) => Number.isFinite(value));

/**
 * A rating block whose Display_Rating is always present.
 *
 * The shared fixtures generate the absent case too, and an absent member is no
 * site for this property: there would be no number to encode. The state stays
 * optional, because it is not a number either way.
 */
const ratedRatingSummaryFixtureArb: fc.Arbitrary<WireFixture<RatingSummary>> = fc
  .record({
    state: fc.option(wireRatingStateArb, { nil: null }),
    displayRating: wireDisplayRatingArb,
    stateAbsence: absenceSpellingArb,
    displayRatingAbsence: absenceSpellingArb,
    modelValues: fc.tuple(unreadModelValueArb, unreadModelValueArb),
  })
  .map((input) => ratingSummaryFixture(input));

/**
 * A valid body carrying **every** numeric member at once: non-empty collections,
 * a progression of rated records, a present Win_Percentage and Display_Rating,
 * and a fully populated Rich_Stats block.
 *
 * Built from the shared fixtures so it is the same kind of body every other
 * parsing suite reads, and narrowed only where an absence would leave a site
 * with no number to encode. The Win_Percentage is re-chosen through
 * {@link buildPlayerProfileFixture} because the shared generator makes it
 * optional and the fixture options expose no lever for it.
 *
 * Collections run to five elements so the `middle` element case lands somewhere
 * other than the ends.
 */
const populatedProfileFixtureArb: fc.Arbitrary<PlayerProfileFixture> = fc
  .tuple(
    playerProfileFixtureArb({
      pairwise: { minLength: 1, maxLength: 5 },
      progression: { minLength: 1, maxLength: 5 },
      rating: ratedRatingSummaryFixtureArb,
      rich: fullyPopulatedRichStatsFixtureArb.map((fixture) =>
        presentRichBlockFixture(fixture),
      ),
      progressionRecord: ratedProgressionRecordFixtureArb,
    }),
    wirePercentageArb,
  )
  .map(([fixture, winPercentage]) =>
    buildPlayerProfileFixture({
      ...fixture.parts,
      winPercentage,
      winPercentageAbsence: 'null',
    }),
  );

/* -------------------------------------------------------------------------- */
/* Property 9, one case per numeric member                                    */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 9: A string-encoded number is rejected wherever a number is read
// Validates: Requirements 13.5
describe('a string-encoded number is rejected wherever a number is read', () => {
  for (const numericSite of NUMERIC_SITES) {
    it(`rejects a body whose \`${numericSite.label}\` arrives as a decimal string`, () => {
      fc.assert(
        fc.property(
          populatedProfileFixtureArb,
          indexChoiceArb,
          (fixture, choice) => {
            // Non-vacuity: the body this mutation starts from is accepted, so
            // the rejection below is the string and nothing else.
            expectAccepted(
              fixture.wire,
              `the unmutated body behind \`${numericSite.label}\``,
            );

            const encoded = encodedAt(fixture.wire, numericSite, choice);

            expectRejected(
              encoded.body,
              `\`${numericSite.label}\` sent as the string '${encoded.encoded}'`,
            );

            // And the mutation left the original alone: a copy was rejected,
            // not the body that had just parsed.
            expectAccepted(
              fixture.wire,
              `the body behind \`${numericSite.label}\`, after the mutation`,
            );
          },
        ),
        { numRuns: 100 },
      );
    });
  }

  it('rejects the fixed fully populated sample at every numeric member', () => {
    // A fixed body, so the claim does not rest on a generator reaching every
    // site. Its progression carries a record with nothing to plot in the middle
    // position, so the ends are the positions asserted here.
    expectAccepted(FULL_PROFILE_FIXTURE.wire, 'the fully populated sample');

    for (const numericSite of NUMERIC_SITES) {
      for (const choice of ['first', 'last'] as const) {
        const encoded = encodedAt(
          FULL_PROFILE_FIXTURE.wire,
          numericSite,
          choice,
        );

        expectRejected(
          encoded.body,
          `the sample with \`${numericSite.label}\` (${choice}) sent as the string '${encoded.encoded}'`,
        );
      }
    }

    expectAccepted(
      FULL_PROFILE_FIXTURE.wire,
      'the fully populated sample, after the mutations',
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The enumeration is complete, and the mutation is honest                    */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 9: A string-encoded number is rejected wherever a number is read
// Validates: Requirements 13.5
describe('the numeric members of the body', () => {
  it('enumerates exactly the numeric members a valid body carries', () => {
    // A fixed seed, so this is a fact about the generators rather than a hope
    // about a particular run.
    const fixtures = fc.sample(populatedProfileFixtureArb, {
      numRuns: 200,
      seed: 20_260_101,
    });

    const discovered = new Set<string>();

    for (const fixture of fixtures) {
      collectNumericPaths(fixture.wire, [], discovered);
    }

    collectNumericPaths(FULL_PROFILE_FIXTURE.wire, [], discovered);

    const covered = NUMERIC_SITES.map((numericSite) => numericSite.label);
    const unread = UNREAD_NUMERIC_SITES.map((numericSite) => numericSite.label);
    const accounted = new Set([...covered, ...unread]);

    // A numeric member the contract gains must be claimed by a case above or
    // declared unread; until it is, this fails and names it.
    expect(
      [...discovered].filter((label) => !accounted.has(label)).sort(),
    ).toStrictEqual([]);

    // And nothing enumerated has gone away, so no case above is quietly
    // asserting against a member the body no longer carries.
    expect(
      [...accounted].filter((label) => !discovered.has(label)).sort(),
    ).toStrictEqual([]);

    // The two lists are disjoint, and neither is empty.
    expect(covered).toHaveLength(new Set(covered).size);
    expect(covered.filter((label) => unread.includes(label))).toStrictEqual([]);
    expect(unread.length).toBeGreaterThan(0);
  });

  it('leaves a numeric member no parser reads inert when it arrives as a string', () => {
    fc.assert(
      fc.property(
        populatedProfileFixtureArb,
        indexChoiceArb,
        (fixture, choice) => {
          const expected = expectAccepted(fixture.wire, 'the unmutated body');

          for (const numericSite of UNREAD_NUMERIC_SITES) {
            const encoded = encodedAt(fixture.wire, numericSite, choice);
            const profile = expectAccepted(
              encoded.body,
              `a body with \`${numericSite.label}\` sent as a string`,
            );

            // A member the parser never names cannot fail a parse and cannot
            // change its value (Requirements 7.7, 13.9) — which is what makes
            // each rejection above the work of that member's own reader rather
            // than of a string appearing anywhere in the body.
            expect(profile, numericSite.label).toStrictEqual(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('replaces exactly one numeric leaf with exactly one string leaf', () => {
    fc.assert(
      fc.property(
        populatedProfileFixtureArb,
        indexChoiceArb,
        (fixture, choice) => {
          const before = leafCounts(fixture.wire);

          for (const numericSite of [
            ...NUMERIC_SITES,
            ...UNREAD_NUMERIC_SITES,
          ]) {
            const encoded = encodedAt(fixture.wire, numericSite, choice);
            const after = leafCounts(encoded.body);

            // One member changed form, and nothing else was touched: were the
            // mutation coarser — a whole block replaced, a member removed — the
            // rejections above would not be evidence about this member.
            expect(after.numbers, numericSite.label).toBe(before.numbers - 1);
            expect(after.strings, numericSite.label).toBe(before.strings + 1);
          }

          // The original is unchanged after all of them.
          expect(leafCounts(fixture.wire)).toStrictEqual(before);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('reports no encoding where the body carries no number', () => {
    const body = FULL_PROFILE_FIXTURE.wire;

    // Were this detection absent, a site whose path had gone stale would
    // silently assert nothing at all, and `encodedAt` would never raise.
    const unavailable: readonly { label: string; path: readonly string[] }[] = [
      { label: 'a string member', path: ['displayName'] },
      { label: 'a boolean member', path: ['isGuest'] },
      { label: 'a duration string', path: ['rich', 'keeperTime'] },
      { label: 'an instant string', path: ['progression', ELEMENT, 'completedAt'] },
      { label: 'a member the body does not carry', path: ['record', 'penalties'] },
      { label: 'a block the body does not carry', path: ['rich', 'saves', 'total'] },
      { label: 'an element of an empty collection', path: ['mostPlayedWith', ELEMENT, 'count'] },
    ];

    for (const { label, path } of unavailable) {
      const subject =
        label === 'an element of an empty collection'
          ? { ...(body as Record<string, unknown>), mostPlayedWith: [] }
          : body;

      expect(encodeNumberAt(subject, path, 'first'), label).toBeNull();
    }

    // And it does find the numbers it should.
    for (const numericSite of NUMERIC_SITES) {
      expect(
        encodeNumberAt(body, numericSite.path, 'first'),
        numericSite.label,
      ).not.toBeNull();
    }
  });

  it('writes the decimal text of the number it replaces', () => {
    const samples: readonly { readonly value: number; readonly text: string }[] =
      [
        { value: 0, text: '0' },
        { value: -0, text: '0' },
        { value: 1, text: '1' },
        { value: 100, text: '100' },
        { value: 33.3, text: '33.3' },
        { value: 0.1, text: '0.1' },
        { value: 1e21, text: '1000000000000000000000' },
        {
          value: Number.MAX_SAFE_INTEGER,
          text: '9007199254740991',
        },
      ];

    for (const { value, text } of samples) {
      expect(decimalStringOf(value), String(value)).toBe(text);
      expect(Number(decimalStringOf(value)) === value, String(value)).toBe(
        true,
      );
    }

    // Value-preserving for every figure the fixtures can choose, including the
    // extremes a `String` would render with an exponent.
    fc.assert(
      fc.property(
        fc.oneof(
          wireDisplayRatingArb,
          wirePercentageArb,
          fc.constantFrom(
            0,
            -0,
            Number.MAX_VALUE,
            Number.MIN_VALUE,
            Number.MAX_SAFE_INTEGER,
          ),
        ),
        (value) => {
          const text = decimalStringOf(value);

          expect(typeof text).toBe('string');
          expect(Number(text) === value, text).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });
});
