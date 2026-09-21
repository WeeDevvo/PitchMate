import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { SQUAD_IDENTIFIER_LENGTH, isSquadIdentifier } from './identifiers';

/**
 * Property tests for the Squads_Feature's one syntactic identity check, placed
 * beside the module they cover as the design's Testing Strategy asks, and running
 * well above the 100-iteration floor (20.1).
 *
 * These carry the pure half of **Property 13: The Not_Found_Treatment is
 * identical for every cause and asserts nothing**. The rendered half — the
 * Squad_Screen issuing no `GetSquad` call for a malformed `squadId` and rendering
 * content identical to the not-found, inaccessible, and inactive-membership cases
 * — is carried by the screen's property test. What is stated here is the decision
 * that half rests on: *acceptance is exactly the well-formed 36-character
 * hyphenated identity, and nothing else* (6.6).
 *
 * The central property is written as an **equivalence** against an oracle read
 * from Requirement 6.6 rather than as a one-way check, because a predicate fed
 * only well-formed identities cannot be told from one that returns `true` for
 * everything. The oracle is spelled out from the requirement's wording and not by
 * reusing the module's guards, so the two can disagree and a defect shows.
 *
 * Malformed candidates are derived from a well-formed identity **one defect at a
 * time** — a dropped character, a swapped separator, a shifted hyphen, a
 * non-hexadecimal digit, surrounding whitespace — so each rejection is
 * attributable to a stated rule rather than to a generator that happened to
 * produce noise.
 */

/**
 * The independent oracle for acceptance, written from Requirement 6.6: a string
 * of exactly 36 characters matching 8, 4, 4, 4, and 12 hexadecimal digits in
 * either letter case, and nothing else.
 */
function shouldAccept(candidate: unknown): boolean {
  return (
    typeof candidate === 'string' &&
    candidate.length === 36 &&
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      candidate,
    )
  );
}

// --- generators: well-formed identities --------------------------------------

const hexDigitArb = fc.constantFrom(...'0123456789abcdef'.split(''));

const hexRun = (length: number): fc.Arbitrary<string> =>
  fc.string({ unit: hexDigitArb, minLength: length, maxLength: length });

/** Upper-cases roughly every other character, producing a mixed-case identity. */
function mixCase(text: string): string {
  return text
    .split('')
    .map((character, index) =>
      index % 2 === 0 ? character.toUpperCase() : character.toLowerCase(),
    )
    .join('');
}

/**
 * The accepted form in all three letter cases. Case is exactly where a check
 * written with a case-sensitive pattern would wrongly reject a valid identity the
 * backend serialised in upper case.
 */
const wellFormedArb: fc.Arbitrary<string> = fc
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

    return letterCase === 'mixed' ? mixCase(identity) : identity;
  });

// --- generators: malformed candidates ----------------------------------------

/** A well-formed identity, used as the readable base for the examples below. */
const BASE_IDENTITY = '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b';

/** One defect at a time, applied to a well-formed identity. */
const malformedFromIdentityArb: fc.Arbitrary<string> = fc
  .tuple(
    wellFormedArb,
    fc.constantFrom(
      'drop-a-character' as const,
      'add-a-character' as const,
      'drop-all-hyphens' as const,
      'underscore-separators' as const,
      'space-separators' as const,
      'colon-separators' as const,
      'braced' as const,
      'parenthesised' as const,
      'urn-prefixed' as const,
      'percent-encoded-hyphens' as const,
      'non-hex-digit' as const,
      'leading-space' as const,
      'trailing-space' as const,
      'surrounding-space' as const,
      'leading-tab' as const,
      'trailing-newline' as const,
      'hyphen-shifted' as const,
      'extra-hyphen' as const,
      'quoted' as const,
    ),
    fc.integer({ min: 0, max: 35 }),
  )
  .map(([identity, defect, position]) => {
    const undashed = identity.replaceAll('-', '');

    switch (defect) {
      case 'drop-a-character':
        // 35 characters: rejected on length alone.
        return identity.slice(0, position) + identity.slice(position + 1);
      case 'add-a-character':
        // 37 characters, still hexadecimal and hyphenated in shape.
        return `${identity.slice(0, position)}0${identity.slice(position)}`;
      case 'drop-all-hyphens':
        // The 32-digit unhyphenated form, which this check does not accept: the
        // backend serialises the hyphenated form, and accepting both would make
        // two spellings of one identity reach the api.
        return undashed;
      case 'underscore-separators':
        return identity.replaceAll('-', '_');
      case 'space-separators':
        return identity.replaceAll('-', ' ');
      case 'colon-separators':
        return identity.replaceAll('-', ':');
      case 'braced':
        return `{${identity}}`;
      case 'parenthesised':
        return `(${identity})`;
      case 'urn-prefixed':
        return `urn:uuid:${identity}`;
      case 'percent-encoded-hyphens':
        // What an over-encoded route segment would look like if it reached the
        // check undecoded.
        return identity.replaceAll('-', '%2D');
      case 'non-hex-digit': {
        // One hexadecimal digit replaced by a letter outside a..f, with the
        // length and the hyphen positions left intact.
        const hyphenPositions = [8, 13, 18, 23];
        const target = hyphenPositions.includes(position) ? (position + 1) % 36 : position;
        return `${identity.slice(0, target)}z${identity.slice(target + 1)}`;
      }
      case 'leading-space':
        return ` ${identity}`;
      case 'trailing-space':
        return `${identity} `;
      case 'surrounding-space':
        return ` ${identity} `;
      case 'leading-tab':
        return `\t${identity}`;
      case 'trailing-newline':
        return `${identity}\n`;
      case 'hyphen-shifted':
        // Right length, hexadecimal digits only, hyphens in the wrong places:
        // 4-4-4-4-16 rather than 8-4-4-4-12. This is the case a length check
        // alone would wrongly accept.
        return `${undashed.slice(0, 4)}-${undashed.slice(4, 8)}-${undashed.slice(
          8,
          12,
        )}-${undashed.slice(12, 16)}-${undashed.slice(16)}`;
      case 'extra-hyphen':
        // 36 characters with five hyphens, so one group is short.
        return `${identity.slice(0, 4)}-${identity.slice(5)}`;
      case 'quoted':
        return `"${identity}"`;
      default:
        return identity;
    }
  });

/** Empty and whitespace-only strings, including 36 whitespace characters. */
const blankStringArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      '',
      ' ',
      '   ',
      '\t',
      '\n',
      '\r\n',
      '\u00a0',
      '\u2003',
      ' '.repeat(SQUAD_IDENTIFIER_LENGTH), // right length, wrong shape
      '\t'.repeat(SQUAD_IDENTIFIER_LENGTH),
    ),
  },
  {
    weight: 1,
    arbitrary: fc.string({
      unit: fc.constantFrom(' ', '\t', '\n', '\r', '\u00a0'),
      minLength: 0,
      maxLength: 40,
    }),
  },
);

/**
 * Free-form strings, weighted towards the length and alphabet where the boundary
 * sits so that near-misses are generated rather than left to chance.
 */
const arbitraryStringArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.string({ minLength: 0, maxLength: 48 }) },
  {
    weight: 2,
    arbitrary: fc.string({
      unit: hexDigitArb,
      minLength: 0,
      maxLength: SQUAD_IDENTIFIER_LENGTH + 4,
    }),
  },
  {
    weight: 3,
    arbitrary: fc.string({
      unit: fc.constantFrom(...'0123456789abcdefABCDEF-'.split('')),
      minLength: SQUAD_IDENTIFIER_LENGTH - 2,
      maxLength: SQUAD_IDENTIFIER_LENGTH + 2,
    }),
  },
  { weight: 1, arbitrary: fc.string({ unit: 'grapheme', minLength: 0, maxLength: 40 }) },
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      'not-an-identity',
      'undefined',
      'null',
      'NaN',
      'squads',
      'me',
      '00000000-0000-0000-0000-000000000000', // the nil identity: well-formed
      '00000000-0000-0000-0000-00000000000', // 35 characters
      'gggggggg-gggg-gggg-gggg-gggggggggggg', // right shape, no hexadecimal digit
      '018f3a2b4c5d7e6f8a9b0c1d2e3f4a5b',
      '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5',
      '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5bc',
      '../018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b',
    ),
  },
);

/**
 * Non-strings of every rejected type, including the wrapper shapes a coercing
 * check would wrongly accept: a one-element array holding an identity, an object
 * carrying it under `squadId`, and a boxed string.
 */
const nonStringArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      0,
      1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      true,
      false,
      [],
      [BASE_IDENTITY],
      [[BASE_IDENTITY]],
      {},
      { squadId: BASE_IDENTITY },
      { id: BASE_IDENTITY },
      Symbol(BASE_IDENTITY),
      1n,
      () => BASE_IDENTITY,
      new Map([['squadId', BASE_IDENTITY]]),
      new Set([BASE_IDENTITY]),
      new Date(0),
      Object(BASE_IDENTITY),
      Object.create(null),
    ),
  },
  { weight: 1, arbitrary: fc.integer() },
  { weight: 1, arbitrary: fc.boolean() },
  { weight: 1, arbitrary: fc.array(wellFormedArb, { maxLength: 3 }) },
  { weight: 1, arbitrary: fc.record({ squadId: wellFormedArb }) },
  {
    weight: 3,
    arbitrary: fc
      .anything({ maxDepth: 2, withBigInt: true, withMap: true, withSet: true })
      .filter((value) => typeof value !== 'string'),
  },
);

/** Anything at all, weighted so both answers occur often. */
const anyCandidateArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 5, arbitrary: wellFormedArb },
  { weight: 4, arbitrary: malformedFromIdentityArb },
  { weight: 2, arbitrary: blankStringArb },
  { weight: 4, arbitrary: arbitraryStringArb },
  { weight: 4, arbitrary: nonStringArb },
);

/** Wraps `leaf` in `depth` levels of arrays and objects, alternating. */
function nest(leaf: unknown, depth: number): unknown {
  let value: unknown = leaf;

  for (let level = 0; level < depth; level += 1) {
    value = level % 2 === 0 ? [value] : { squadId: value };
  }

  return value;
}

// Feature: web-squads-screens, Property 13 (pure half): the syntactic squad
// identifier check accepts exactly the well-formed identities
// Validates: Requirements 6.6, 20.1
describe('isSquadIdentifier — acceptance is exactly the well-formed identities', () => {
  it('accepts a candidate exactly when it is a well-formed identity', () => {
    fc.assert(
      fc.property(anyCandidateArb, (candidate) => {
        // The equivalence, both directions, from one generator covering both: a
        // check that accepted everything and one that accepted nothing each fail
        // here (6.6).
        expect(isSquadIdentifier(candidate)).toBe(shouldAccept(candidate));
      }),
      { numRuns: 1000 },
    );
  });

  it('accepts a well-formed identity in lower, upper, and mixed case', () => {
    fc.assert(
      fc.property(wellFormedArb, (identity) => {
        expect(isSquadIdentifier(identity)).toBe(true);
        expect(isSquadIdentifier(identity.toLowerCase())).toBe(true);
        expect(isSquadIdentifier(identity.toUpperCase())).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('holds the stated length boundary: 36 characters in, 35 and 37 out', () => {
    // The length is part of the contract, so it is asserted literally here — the
    // generated properties read it from the module and so could not catch a wrong
    // constant on their own.
    expect(SQUAD_IDENTIFIER_LENGTH).toBe(36);
    expect(BASE_IDENTITY).toHaveLength(SQUAD_IDENTIFIER_LENGTH);

    expect(isSquadIdentifier(BASE_IDENTITY)).toBe(true);
    expect(isSquadIdentifier(BASE_IDENTITY.slice(0, 35))).toBe(false);
    expect(isSquadIdentifier(`${BASE_IDENTITY}0`)).toBe(false);
  });
});

// Feature: web-squads-screens, Property 13 (pure half): every malformed
// candidate is rejected, and nothing is repaired
// Validates: Requirements 6.6
describe('isSquadIdentifier — every malformed candidate is rejected', () => {
  it('rejects a well-formed identity carrying exactly one defect', () => {
    fc.assert(
      fc.property(malformedFromIdentityArb, (candidate) => {
        // Each derivation carries one stated defect, and each is enough on its
        // own for the Squad_Screen to render the Not_Found_Treatment without
        // issuing a call (6.6).
        expect(shouldAccept(candidate)).toBe(false);
        expect(isSquadIdentifier(candidate)).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it('rejects the empty string and every whitespace-only string', () => {
    fc.assert(
      fc.property(blankStringArb, (candidate) => {
        expect(isSquadIdentifier(candidate)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('never trims, so a well-formed identity inside whitespace is rejected', () => {
    fc.assert(
      fc.property(
        wellFormedArb,
        fc.stringMatching(/^[ \t\n\r]{1,4}$/),
        fc.stringMatching(/^[ \t\n\r]{1,4}$/),
        (identity, before, after) => {
          // Trimming would have the feature call the backend with an identity the
          // route never carried, so a padded value is rejected rather than
          // repaired (6.6).
          expect(isSquadIdentifier(`${before}${identity}`)).toBe(false);
          expect(isSquadIdentifier(`${identity}${after}`)).toBe(false);
          expect(isSquadIdentifier(`${before}${identity}${after}`)).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('rejects every non-string: absent, null, number, boolean, array, object', () => {
    fc.assert(
      fc.property(nonStringArb, (candidate) => {
        expect(isSquadIdentifier(candidate)).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it('rejects an identity-shaped wrapper, performing no coercion', () => {
    fc.assert(
      fc.property(wellFormedArb, (identity) => {
        expect(isSquadIdentifier({ squadId: identity })).toBe(false);
        expect(isSquadIdentifier([identity])).toBe(false);
        expect(isSquadIdentifier(Object(identity))).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('never converts a value, so a hostile toString or valueOf never runs', () => {
    fc.assert(
      fc.property(wellFormedArb, (identity) => {
        let conversions = 0;
        const hostile = {
          valueOf() {
            conversions += 1;
            return identity;
          },
          toString() {
            conversions += 1;
            return identity;
          },
        };

        expect(isSquadIdentifier(hostile)).toBe(false);
        expect(conversions).toBe(0);
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: web-squads-screens, Property 13 (pure half): the check is total and
// deterministic
// Validates: Requirements 6.6, 20.1
describe('isSquadIdentifier — the check is total and deterministic', () => {
  it('yields a boolean and raises nothing for any input of any type', () => {
    fc.assert(
      fc.property(anyCandidateArb, (candidate) => {
        const accepted = isSquadIdentifier(candidate);

        expect(typeof accepted).toBe('boolean');
      }),
      { numRuns: 1000 },
    );
  });

  it('is deterministic and free of side effects across repeated calls', () => {
    fc.assert(
      fc.property(anyCandidateArb, (candidate) => {
        // A global or sticky pattern would carry `lastIndex` between calls and
        // make the second answer differ from the first.
        expect(isSquadIdentifier(candidate)).toBe(isSquadIdentifier(candidate));
        expect(isSquadIdentifier(candidate)).toBe(isSquadIdentifier(candidate));
      }),
      { numRuns: 500 },
    );
  });

  it('rejects a value nested to 100 levels without walking into it', () => {
    fc.assert(
      fc.property(
        fc.oneof(wellFormedArb, blankStringArb, nonStringArb),
        fc.integer({ min: 1, max: 100 }),
        (leaf, depth) => {
          expect(isSquadIdentifier(nest(leaf, depth))).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('survives self-referencing structures and a throwing accessor', () => {
    const selfReferencing: Record<string, unknown> = { squadId: BASE_IDENTITY };
    selfReferencing.self = selfReferencing;

    const cyclicArray: unknown[] = [BASE_IDENTITY];
    cyclicArray.push(cyclicArray);

    const throwingGetter = {
      get squadId(): string {
        throw new Error('must never be read');
      },
    };

    for (const candidate of [selfReferencing, cyclicArray, throwingGetter]) {
      expect(isSquadIdentifier(candidate)).toBe(false);
    }
  });
});
