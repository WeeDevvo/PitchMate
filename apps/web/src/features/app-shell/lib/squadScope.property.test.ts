import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { normaliseSquadScope, SQUAD_SCOPE_IDENTITY_LENGTH } from './squadScope';

/**
 * Property tests for the App_Shell's single pure Squad_Scope normaliser
 * (Requirements 7.1, 7.2), placed beside the module they cover as Requirement
 * 14.2 asks, at well over the 100-iteration floor.
 *
 * These carry **Property 24: Squad scope normalisation admits only well-formed
 * identities**. The requirement is an *exact* characterisation — the identity
 * for a well-formed 36-character hyphenated value of 8, 4, 4, 4, and 12
 * hexadecimal digits in either letter case, and `null` for everything else — so
 * the central property is written as an equivalence rather than as a one-way
 * check. A test that only fed well-formed identities could not tell this
 * normaliser from one that returned whatever it was given.
 *
 * The accepted length is read from the module's own export rather than retyped,
 * so a test can never quietly disagree with the implementation about where the
 * boundary sits — the literal 36 is asserted once, separately, so a wrong
 * constant is still caught.
 *
 * Because an unusable value is *not* an error (Requirement 7.1), there is no
 * failure outcome to assert: the whole observable contract is "the identity, or
 * `null`", and every property below is stated in those terms.
 */

/**
 * The independent oracle for acceptance, written from Requirement 7.1 rather
 * than by reusing the implementation's guards, so the two can disagree: a
 * string of exactly 36 characters matching 8-4-4-4-12 hexadecimal digits in
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

/** Upper-cases roughly every other letter, producing a mixed-case identity. */
function mixCase(text: string): string {
  return text
    .split('')
    .map((character, index) =>
      index % 2 === 0 ? character.toUpperCase() : character.toLowerCase(),
    )
    .join('');
}

/**
 * The accepted form in all three letter cases — lower, upper, and mixed — since
 * Requirement 7.1 accepts either case and Requirement 7.2 returns the value
 * unchanged, so case is exactly where a normalising implementation would go
 * wrong.
 */
const wellFormedIdentityArb: fc.Arbitrary<string> = fc
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

// --- generators: malformed candidates ---------------------------------------

/** A well-formed identity used as the base for the malformed derivations. */
const BASE_IDENTITY = '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b';

/**
 * Malformed strings derived from a well-formed identity, one defect at a time,
 * so each rejection is attributable: wrong length, wrong separators, the braced
 * form, a non-hexadecimal digit, and surrounding whitespace.
 */
const malformedFromIdentityArb: fc.Arbitrary<string> = fc
  .tuple(
    wellFormedIdentityArb,
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
      'non-hex-digit' as const,
      'leading-space' as const,
      'trailing-space' as const,
      'surrounding-space' as const,
      'leading-tab' as const,
      'trailing-newline' as const,
      'hyphen-shifted' as const,
      'extra-hyphen' as const,
    ),
    fc.integer({ min: 0, max: 35 }),
  )
  .map(([identity, defect, position]) => {
    switch (defect) {
      case 'drop-a-character':
        // 35 characters: rejected on length alone.
        return identity.slice(0, position) + identity.slice(position + 1);
      case 'add-a-character':
        // 37 characters, still hexadecimal and hyphenated in shape.
        return `${identity.slice(0, position)}0${identity.slice(position)}`;
      case 'drop-all-hyphens':
        // The 32-digit unhyphenated form, which this normaliser does not accept.
        return identity.replaceAll('-', '');
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
      case 'non-hex-digit': {
        // Replace one hexadecimal digit with a letter outside a..f, keeping the
        // length and the hyphen positions intact so only the digit is wrong.
        const hyphenPositions = [8, 13, 18, 23];
        const target = hyphenPositions.includes(position)
          ? (position + 1) % 36
          : position;
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
        // 4-4-4-4-16 rather than 8-4-4-4-12.
        return `${identity.replaceAll('-', '').slice(0, 4)}-${identity
          .replaceAll('-', '')
          .slice(4, 8)}-${identity.replaceAll('-', '').slice(8, 12)}-${identity
          .replaceAll('-', '')
          .slice(12, 16)}-${identity.replaceAll('-', '').slice(16)}`;
      case 'extra-hyphen':
        // 36 characters with five hyphens, so one group is short.
        return `${identity.slice(0, 4)}-${identity.slice(5)}`;
      default:
        return identity;
    }
  });

/** Empty and whitespace-only strings, called out by Requirement 7.1. */
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
      ' '.repeat(SQUAD_SCOPE_IDENTITY_LENGTH), // 36 spaces: right length, wrong shape
      '\t'.repeat(SQUAD_SCOPE_IDENTITY_LENGTH),
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

/** Free-form strings, most of which are malformed but a few of which may not be. */
const arbitraryStringArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.string({ minLength: 0, maxLength: 48 }) },
  {
    weight: 2,
    arbitrary: fc.string({
      unit: hexDigitArb,
      minLength: 0,
      maxLength: SQUAD_SCOPE_IDENTITY_LENGTH + 4,
    }),
  },
  {
    weight: 2,
    arbitrary: fc.string({
      unit: fc.constantFrom(...'0123456789abcdefABCDEF-'.split('')),
      minLength: SQUAD_SCOPE_IDENTITY_LENGTH - 2,
      maxLength: SQUAD_SCOPE_IDENTITY_LENGTH + 2,
    }),
  },
  { weight: 1, arbitrary: fc.string({ unit: 'grapheme', minLength: 0, maxLength: 40 }) },
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      'not-an-identity',
      'null',
      'undefined',
      'squad',
      '00000000-0000-0000-0000-00000000000', // 35 characters
      '00000000-0000-0000-0000-000000000000', // the nil identity: well-formed
      'gggggggg-gggg-gggg-gggg-gggggggggggg', // right shape, no hexadecimal digits
      '018f3a2b4c5d7e6f8a9b0c1d2e3f4a5b',
      '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5',
      '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5bc',
    ),
  },
);

/**
 * Non-string values of every rejected type: absent, `null`, numbers, booleans,
 * symbols, bigints, functions, arrays, and objects — including an
 * identity-shaped wrapper and a one-element array holding a well-formed
 * identity, which are the shapes a coercing normaliser would wrongly accept.
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
      Object(BASE_IDENTITY), // a boxed string: an object, so still rejected
      Object.create(null),
    ),
  },
  { weight: 1, arbitrary: fc.integer() },
  { weight: 1, arbitrary: fc.boolean() },
  { weight: 1, arbitrary: fc.array(wellFormedIdentityArb, { maxLength: 3 }) },
  { weight: 1, arbitrary: fc.record({ squadId: wellFormedIdentityArb }) },
  {
    weight: 3,
    // Anything at all except a string, so this generator stays an honest
    // "non-string" generator and the property below is a real rejection claim.
    arbitrary: fc
      .anything({ maxDepth: 2, withBigInt: true, withMap: true, withSet: true })
      .filter((value) => typeof value !== 'string'),
  },
);

/** Anything at all — the totality generator, weighted so both answers appear. */
const anyCandidateArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 5, arbitrary: wellFormedIdentityArb },
  { weight: 4, arbitrary: malformedFromIdentityArb },
  { weight: 2, arbitrary: blankStringArb },
  { weight: 3, arbitrary: arbitraryStringArb },
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

// Feature: app-shell, Property 24: squad scope normalisation admits only
// well-formed identities
// Validates: Requirements 7.1, 7.2
describe('normaliseSquadScope — acceptance is exactly the well-formed identities', () => {
  it('yields the identity exactly when the value is well-formed, and null otherwise', () => {
    fc.assert(
      fc.property(anyCandidateArb, (candidate) => {
        const scope = normaliseSquadScope(candidate);

        // The one outcome shape: a string or `null`, never `undefined` and never
        // anything else (Requirement 7.1).
        expect(scope === null || typeof scope === 'string').toBe(true);

        // The equivalence: a scope is active exactly when the oracle says the
        // value is a well-formed identity. Both directions, from one generator
        // covering both.
        expect(scope !== null).toBe(shouldAccept(candidate));
      }),
      { numRuns: 1000 },
    );
  });

  it('returns a well-formed identity character-for-character, in any letter case', () => {
    fc.assert(
      fc.property(wellFormedIdentityArb, (identity) => {
        // Requirement 7.2: the backend treats the identity as opaque, so the
        // value returned is the value supplied — no case folding, no trimming,
        // no re-formatting.
        expect(normaliseSquadScope(identity)).toBe(identity);
        expect(normaliseSquadScope(identity.toLowerCase())).toBe(identity.toLowerCase());
        expect(normaliseSquadScope(identity.toUpperCase())).toBe(identity.toUpperCase());
      }),
      { numRuns: 500 },
    );
  });

  it('holds the stated length boundary: 36 characters in, 35 and 37 out', () => {
    // The length is the contract (Requirement 7.1), so it is asserted literally
    // here — the generated properties read it from the module and so could not
    // catch a wrong constant on their own.
    expect(SQUAD_SCOPE_IDENTITY_LENGTH).toBe(36);
    expect(BASE_IDENTITY).toHaveLength(SQUAD_SCOPE_IDENTITY_LENGTH);

    expect(normaliseSquadScope(BASE_IDENTITY)).toBe(BASE_IDENTITY);
    expect(normaliseSquadScope(BASE_IDENTITY.slice(0, 35))).toBeNull();
    expect(normaliseSquadScope(`${BASE_IDENTITY}0`)).toBeNull();
  });
});

// Feature: app-shell, Property 24: every unusable value leaves no scope active
// Validates: Requirements 7.1
describe('normaliseSquadScope — every unusable value leaves no scope active', () => {
  it('rejects a malformed derivation of a well-formed identity', () => {
    fc.assert(
      fc.property(malformedFromIdentityArb, (candidate) => {
        // Every derivation carries exactly one defect — wrong length, wrong
        // separators, a braced or prefixed form, a non-hexadecimal digit, or
        // surrounding whitespace — and each is enough on its own to leave no
        // Squad_Scope active (Requirement 7.1).
        expect(shouldAccept(candidate)).toBe(false);
        expect(normaliseSquadScope(candidate)).toBeNull();
      }),
      { numRuns: 500 },
    );
  });

  it('rejects the empty string and every whitespace-only string', () => {
    fc.assert(
      fc.property(blankStringArb, (candidate) => {
        expect(normaliseSquadScope(candidate)).toBeNull();
      }),
      { numRuns: 300 },
    );
  });

  it('never trims, so a well-formed identity inside whitespace is still rejected', () => {
    fc.assert(
      fc.property(
        wellFormedIdentityArb,
        fc.stringMatching(/^[ \t\n\r]{1,4}$/),
        fc.stringMatching(/^[ \t\n\r]{1,4}$/),
        (identity, before, after) => {
          // Trimming would send the backend an identity the route never
          // carried, so padded values are rejected rather than repaired
          // (Requirements 7.1, 7.2).
          expect(normaliseSquadScope(`${before}${identity}`)).toBeNull();
          expect(normaliseSquadScope(`${identity}${after}`)).toBeNull();
          expect(normaliseSquadScope(`${before}${identity}${after}`)).toBeNull();
        },
      ),
      { numRuns: 300 },
    );
  });

  it('rejects every non-string: absent, null, number, boolean, array, object', () => {
    fc.assert(
      fc.property(nonStringArb, (candidate) => {
        expect(normaliseSquadScope(candidate)).toBeNull();
      }),
      { numRuns: 500 },
    );
  });

  it('rejects an identity-shaped wrapper, performing no coercion', () => {
    fc.assert(
      fc.property(wellFormedIdentityArb, (identity) => {
        // `{ squadId: id }` and `[id]` are not identities (Requirement 7.1) — a
        // normaliser that coerced or unwrapped would accept both.
        expect(normaliseSquadScope({ squadId: identity })).toBeNull();
        expect(normaliseSquadScope([identity])).toBeNull();
        expect(normaliseSquadScope(Object(identity))).toBeNull();
      }),
      { numRuns: 300 },
    );
  });

  it('never converts a value, so a hostile toString or valueOf never runs', () => {
    fc.assert(
      fc.property(wellFormedIdentityArb, (identity) => {
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

        expect(normaliseSquadScope(hostile)).toBeNull();
        expect(conversions).toBe(0);
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: app-shell, Property 24: normalisation is total and deterministic
// Validates: Requirements 7.1, 7.2
describe('normaliseSquadScope — normalisation is total and deterministic', () => {
  it('raises no exception and yields one defined answer for any input of any type', () => {
    fc.assert(
      fc.property(anyCandidateArb, (candidate) => {
        const scope = normaliseSquadScope(candidate);

        expect(scope === null || typeof scope === 'string').toBe(true);
        expect(scope).not.toBeUndefined();
      }),
      { numRuns: 1000 },
    );
  });

  it('is idempotent: normalising the answer again gives the same answer', () => {
    fc.assert(
      fc.property(anyCandidateArb, (candidate) => {
        const first = normaliseSquadScope(candidate);
        const second = normaliseSquadScope(first);

        // `null` normalises to `null` and an accepted identity normalises to
        // itself, so the function is a projection onto its own range.
        expect(second).toBe(first);
      }),
      { numRuns: 500 },
    );
  });

  it('is deterministic and free of side effects across repeated calls', () => {
    fc.assert(
      fc.property(anyCandidateArb, (candidate) => {
        // A global or sticky pattern would carry `lastIndex` between calls and
        // make the second answer differ from the first.
        expect(normaliseSquadScope(candidate)).toBe(normaliseSquadScope(candidate));
      }),
      { numRuns: 500 },
    );
  });

  it('yields null for a value nested to 100 levels without walking into it', () => {
    fc.assert(
      fc.property(
        fc.oneof(wellFormedIdentityArb, blankStringArb, nonStringArb),
        fc.integer({ min: 1, max: 100 }),
        (leaf, depth) => {
          // A nested value is never a string at the top level, so it always
          // leaves no Squad_Scope active — and nothing recurses into it, so 100
          // levels cost nothing and overflow nothing.
          expect(normaliseSquadScope(nest(leaf, depth))).toBeNull();
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
      expect(normaliseSquadScope(candidate)).toBeNull();
    }
  });
});
