import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  NAME_MAX_LENGTH,
  validateDisplayName,
  validateSquadName,
  type NameValidation,
} from './nameValidation';

/**
 * Property tests for the one pure rule the Create_Squad_Form, the Join_Code_Form,
 * and the Guest_Form all submit through, beside the module they cover as the
 * design's Testing Strategy asks, and running well above the 100-iteration floor
 * (Requirement 20.1).
 *
 * Five claims are made, and together they are the pure half of Property 5:
 *
 * - **The accepted set is exactly the strings that are non-empty after trimming
 *   and at most 100 units long after trimming.** Stated against an independently
 *   written oracle: trimming through a regular expression rather than through
 *   `String.prototype.trim`, and length through a code-point walk that adds each
 *   code point's own code-unit count rather than through `String.length`. Same
 *   rule, two different routes to it, so a test failure means the *criterion* is
 *   broken and not that the implementation was restated.
 * - **The boundaries land where Requirements 3.2 and 3.3 put them.** Exercised by
 *   name at 0, 1, 100, and 101 units; at exactly 100 units wrapped in whitespace;
 *   and on whitespace-only input. 100 is accepted and 101 is rejected, which is
 *   the one comparison in the module that could be off by one, and the one that
 *   would either refuse a name the backend's `MaxLength(100)` takes or wave
 *   through one it refuses.
 * - **The accepted value is the input trimmed, and nothing else.** Not recased,
 *   not collapsed, not reshaped — interior whitespace survives, and two names
 *   differing only in letter case are both accepted and both submitted as typed.
 *   Requirement 3.9 makes the backend the authority on a name's acceptability, so
 *   the client's job is to pass the person's own words through.
 * - **Length is counted in UTF-16 code units, after trimming.** The unit the
 *   backend's column counts in. Asserted on astral input, where the code-unit
 *   count and the visible character count differ: 50 astral characters (100 code
 *   units) are accepted while 100 astral characters (200 code units) are
 *   rejected. A grapheme-cluster count would accept the latter and the backend
 *   would then refuse it, which is the failure mode this bound exists to prevent.
 * - **A rejection is one named reason and carries no value; the function is pure
 *   and total.** `'empty'` and `'too-long'` exhaust the failures, no failure
 *   carries a `value` property at all, and no input — including one that is not a
 *   string, which a form field should not produce but which the module guards
 *   against anyway — raises.
 *
 * Both exported validators apply the one rule, so every claim is asserted through
 * both and the two are required to agree structurally. They are separate exports
 * because the call site identifies the field a message attaches to, not because
 * the rule differs.
 *
 * What is deliberately **not** claimed here: the rendered clauses of Property 5 —
 * that a rejected submission issues no `CreateSquad` call, that the message is
 * programmatically associated with the offending field, and that every entered
 * value is retained. Those belong to the form's own test, which is the point of
 * Requirement 3.4 putting the rule in a function that needs no browser.
 */

// --- the oracle --------------------------------------------------------------

/**
 * The characters `String.prototype.trim` removes: ECMAScript `WhiteSpace` plus
 * `LineTerminator`, which is exactly the set JavaScript's `\s` matches. Listed so
 * the generators can build padding out of the whole set rather than out of the
 * space character alone — a `trim` replaced by a hand-rolled space strip would
 * pass a space-only test and fail here.
 */
const TRIM_WHITESPACE: readonly string[] = [
  '\u0009', // tab
  '\u000a', // line feed
  '\u000b', // vertical tab
  '\u000c', // form feed
  '\u000d', // carriage return
  '\u0020', // space
  '\u00a0', // no-break space
  '\u1680', // ogham space mark
  '\u2000',
  '\u2001',
  '\u2002',
  '\u2003',
  '\u2004',
  '\u2005',
  '\u2006',
  '\u2007',
  '\u2008',
  '\u2009',
  '\u200a',
  '\u2028', // line separator
  '\u2029', // paragraph separator
  '\u202f', // narrow no-break space
  '\u205f', // medium mathematical space
  '\u3000', // ideographic space
  '\ufeff', // zero-width no-break space / BOM
];

/**
 * Trimming, read straight off Requirement 3.2's "leading and trailing whitespace"
 * — through a regular expression rather than through the `trim` the module calls.
 */
function trimOracle(value: string): string {
  return value.replace(/^\s+|\s+$/gu, '');
}

/**
 * The length of a string in UTF-16 code units, counted by walking its code points
 * and adding each one's own code-unit count. Deliberately **not** `String.length`,
 * and deliberately not a code-point count either: an astral code point contributes
 * 2, which is what the backend's column charges for it.
 */
function countCodeUnits(value: string): number {
  let count = 0;

  for (const codePoint of value) {
    count += codePoint.length;
  }

  return count;
}

/**
 * The rule as Requirements 3.2 and 3.3 word it: trim, reject if nothing is left,
 * reject if what is left is longer than 100 code units, otherwise accept the
 * trimmed value. The bound is written as the literal 100 the requirement states,
 * not as `NAME_MAX_LENGTH`, so a change to the constant cannot quietly move the
 * criterion this suite checks against.
 */
function validateOracle(input: string): NameValidation {
  const trimmed = trimOracle(input);

  if (trimmed === '') {
    return { ok: false, reason: 'empty' };
  }

  if (countCodeUnits(trimmed) > 100) {
    return { ok: false, reason: 'too-long' };
  }

  return { ok: true, value: trimmed };
}

// --- helpers -----------------------------------------------------------------

/** An accepted-length ASCII name of exactly `codeUnits` code units. */
function asciiOfLength(codeUnits: number): string {
  return 'a'.repeat(codeUnits);
}

/** A name of `characters` astral code points — twice that many code units. */
function astralOfCharacters(characters: number): string {
  // U+1D11E MUSICAL SYMBOL G CLEF: one code point, one visible character, two
  // code units.
  return '\u{1d11e}'.repeat(characters);
}

/**
 * Asserts both exported validators agree with the oracle on one input, and agree
 * with each other. Every property routes through this, because "both validators
 * apply the same rule" is part of what is being claimed.
 */
function expectBothValidatorsAgree(input: string): void {
  const expected = validateOracle(input);
  const squadResult = validateSquadName(input);
  const displayResult = validateDisplayName(input);

  expect(squadResult).toEqual(expected);
  expect(displayResult).toEqual(expected);
  expect(displayResult).toEqual(squadResult);
}

// --- generators --------------------------------------------------------------

/** A run of whitespace drawn from the whole trim set, possibly empty. */
const whitespaceRunArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...TRIM_WHITESPACE), { minLength: 0, maxLength: 6 })
  .map((characters) => characters.join(''));

/** A non-empty run of whitespace — the padding, and the whitespace-only name. */
const whitespaceOnlyArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...TRIM_WHITESPACE), { minLength: 1, maxLength: 12 })
  .map((characters) => characters.join(''));

/**
 * The lengths worth naming: the empty string, one unit, the bound itself, one
 * past it, and a length far past it. 0, 1, 100, and 101 are the four the tasks
 * call for; 100 and 101 are the pair the comparison turns on.
 */
const BOUNDARY_LENGTHS: readonly number[] = [0, 1, 2, 99, 100, 101, 102, 250];

/** ASCII names sitting exactly on each of those lengths. */
const boundaryNameArb: fc.Arbitrary<string> = fc
  .constantFrom(...BOUNDARY_LENGTHS)
  .map(asciiOfLength);

/**
 * Characters whose code-unit count differs from what a reader would call their
 * length: astral code points, a ZWJ emoji sequence, a flag, and a combining
 * sequence. The whole reason the counted unit has to be stated.
 */
const WIDE_CHARACTERS: readonly string[] = [
  '\u{1d11e}', // 𝄞  two code units
  '\u{1f600}', // 😀 two code units
  '\u{20b9e}', // 𠮞 two code units
  '\u{1f9d1}\u200d\u{1f692}', // 🧑‍🚒 five code units
  '\u{1f1ec}\u{1f1e7}', // 🇬🇧 four code units
  'e\u0301', // é as e + combining acute: two code units
];

/** A name built from those characters, so code units outrun characters. */
const wideNameArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...WIDE_CHARACTERS), { minLength: 1, maxLength: 60 })
  .map((characters) => characters.join(''));

/**
 * Names differing only in letter case, plus a few that differ only in accent —
 * the module must treat all of them alike, since none of case, accent, or script
 * is a rule it applies.
 */
const CASE_FAMILIES: readonly (readonly string[])[] = [
  ['dave', 'Dave', 'DAVE', 'dAvE'],
  ['sunday league', 'Sunday League', 'SUNDAY LEAGUE', 'Sunday league'],
  ['fc', 'FC', 'Fc', 'fC'],
  ['elan', 'Elan', 'ELAN', 'eLAN'],
  ['big dave', 'Big Dave', 'BIG DAVE', 'bIG dAVE'],
];

/** One member of one case family. */
const caseFamilyNameArb: fc.Arbitrary<string> = fc
  .constantFrom(...CASE_FAMILIES)
  .chain((family) => fc.constantFrom(...family));

/**
 * Names worth naming outright: the empties, whitespace of several kinds, the
 * boundary pair with and without padding, interior whitespace, a zero-width space
 * that `trim` does **not** remove, and non-Latin scripts.
 */
const NOTABLE_NAMES: readonly string[] = [
  '',
  ' ',
  '   ',
  '\t',
  '\n',
  '\r\n',
  '\u00a0',
  '\u3000\u3000',
  '\ufeff',
  'a',
  ' a ',
  '\u200b', // zero-width space: not whitespace to `trim`
  'a  b',
  'a\tb',
  'Sunday League',
  '  Sunday League  ',
  '5-a-side',
  '日本語のチーム',
  'Ω≈ç√',
  '🙈 squad',
  asciiOfLength(100),
  asciiOfLength(101),
  `  ${asciiOfLength(100)}  `,
  `\t${asciiOfLength(101)}\n`,
  astralOfCharacters(50),
  astralOfCharacters(51),
  astralOfCharacters(100),
];

/**
 * The broad name generator. Weighted towards the boundary and the padding, since
 * that is where the rule can be wrong, and topped up with arbitrary text —
 * including graphemes and lone-surrogate-capable binary strings — because the
 * function is total over whatever a person types into a field.
 */
const nameArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(...NOTABLE_NAMES) },
  {
    weight: 4,
    arbitrary: fc
      .tuple(whitespaceRunArb, boundaryNameArb, whitespaceRunArb)
      .map(([leading, name, trailing]) => `${leading}${name}${trailing}`),
  },
  { weight: 2, arbitrary: whitespaceOnlyArb },
  { weight: 2, arbitrary: caseFamilyNameArb },
  { weight: 2, arbitrary: wideNameArb },
  {
    weight: 3,
    arbitrary: fc
      .tuple(whitespaceRunArb, fc.string({ maxLength: 120 }), whitespaceRunArb)
      .map(([leading, name, trailing]) => `${leading}${name}${trailing}`),
  },
  { weight: 2, arbitrary: fc.string({ unit: 'grapheme', maxLength: 60 }) },
  { weight: 1, arbitrary: fc.string({ unit: 'binary', maxLength: 60 }) },
);

/** Values a field should never produce, kept out because the module guards them. */
const NON_STRING_INPUTS: readonly unknown[] = [
  null,
  undefined,
  0,
  1,
  100,
  Number.NaN,
  true,
  false,
  {},
  [],
  ['Dave'],
  { toString: () => 'Dave' },
];

// Feature: web-squads-screens, Property 5: Name validation accepts exactly the
// trimmed non-empty values within the length bound
// Validates: Requirements 3.2, 3.3, 3.4, 20.1
describe('name validation — the accepted set is exactly the non-empty trimmed values within the bound', () => {
  it('agrees with an independently written rule on every generated name', () => {
    fc.assert(
      fc.property(nameArb, (input) => {
        // The oracle trims by regular expression and counts by walking code
        // points, so this asserts the criterion of 3.2 and 3.3 rather than the
        // module's own two lines restated.
        expectBothValidatorsAgree(input);
      }),
      { numRuns: 1000 },
    );
  });

  it('accepts a name exactly when it has content after trimming and fits the bound', () => {
    fc.assert(
      fc.property(nameArb, (input) => {
        const result = validateSquadName(input);
        const trimmed = trimOracle(input);
        const fits = trimmed !== '' && countCodeUnits(trimmed) <= 100;

        // Stated as a biconditional, which is what "exactly when" asks for: no
        // accepted value outside the set, and nothing inside the set rejected.
        expect(result.ok).toBe(fits);
      }),
      { numRuns: 1000 },
    );
  });

  it('is unaffected by whitespace padding: padded and bare names validate alike', () => {
    fc.assert(
      fc.property(
        whitespaceRunArb,
        nameArb.map(trimOracle),
        whitespaceRunArb,
        (leading, core, trailing) => {
          // 3.2: trimming happens before both tests, so padding can neither
          // rescue an empty name nor push an accepted one over the bound.
          expect(validateSquadName(`${leading}${core}${trailing}`)).toEqual(
            validateSquadName(core),
          );
          expect(validateDisplayName(`${leading}${core}${trailing}`)).toEqual(
            validateDisplayName(core),
          );
        },
      ),
      { numRuns: 600 },
    );
  });

  it('rejects a name that is empty or whitespace only, whatever whitespace it holds', () => {
    fc.assert(
      fc.property(whitespaceOnlyArb, (whitespace) => {
        // 3.3: a field of spaces is not a name, and neither is a field of
        // no-break spaces, ideographic spaces, or a byte-order mark.
        expect(validateSquadName(whitespace)).toEqual({
          ok: false,
          reason: 'empty',
        });
        expect(validateDisplayName(whitespace)).toEqual({
          ok: false,
          reason: 'empty',
        });
      }),
      { numRuns: 500 },
    );

    expect(validateSquadName('')).toEqual({ ok: false, reason: 'empty' });
    expect(validateDisplayName('')).toEqual({ ok: false, reason: 'empty' });
  });

  it('accepts a zero-width space, which trim does not remove and the backend judges', () => {
    // Adversarial on purpose: U+200B is not in the ECMAScript whitespace set, so
    // it survives trimming and the name is non-empty. 3.9 makes the backend the
    // authority on whether such a name is acceptable — a client rule that
    // stripped it would be guessing, and would block a name the backend takes.
    expect(validateSquadName('\u200b')).toEqual({ ok: true, value: '\u200b' });
    expect(validateDisplayName(' \u200b ')).toEqual({
      ok: true,
      value: '\u200b',
    });
  });
});

// Feature: web-squads-screens, Property 5: Name validation accepts exactly the
// trimmed non-empty values within the length bound
// Validates: Requirements 3.2, 3.3
describe('name validation — the bound is 100 code units after trimming, inclusive', () => {
  it('answers each named boundary length as Requirement 3.3 states', () => {
    // The four lengths the boundary turns on, checked as a table a reader can
    // verify by eye: nothing, one character, the bound, one past it.
    expect(validateSquadName(asciiOfLength(0))).toEqual({
      ok: false,
      reason: 'empty',
    });
    expect(validateSquadName(asciiOfLength(1))).toEqual({
      ok: true,
      value: 'a',
    });
    expect(validateSquadName(asciiOfLength(100))).toEqual({
      ok: true,
      value: asciiOfLength(100),
    });
    expect(validateSquadName(asciiOfLength(101))).toEqual({
      ok: false,
      reason: 'too-long',
    });

    for (const length of BOUNDARY_LENGTHS) {
      expectBothValidatorsAgree(asciiOfLength(length));
    }
  });

  it('accepts a name whose trimmed length is exactly 100 however it is padded', () => {
    fc.assert(
      fc.property(whitespaceOnlyArb, whitespaceOnlyArb, (leading, trailing) => {
        const atBound = asciiOfLength(100);

        // 3.2 with 3.3: the padding is removed *before* the count, so a
        // 100-character name typed with stray spaces is accepted — and submitted
        // without them.
        expect(validateSquadName(`${leading}${atBound}${trailing}`)).toEqual({
          ok: true,
          value: atBound,
        });
        expect(validateDisplayName(`${leading}${atBound}${trailing}`)).toEqual({
          ok: true,
          value: atBound,
        });
      }),
      { numRuns: 400 },
    );
  });

  it('rejects a name whose trimmed length is 101 however it is padded', () => {
    fc.assert(
      fc.property(whitespaceOnlyArb, whitespaceOnlyArb, (leading, trailing) => {
        const overBound = asciiOfLength(101);

        // The mirror of the case above, and the reason padding cannot be counted:
        // trimming must not be able to bring an over-long name under the bound.
        expect(validateSquadName(`${leading}${overBound}${trailing}`)).toEqual({
          ok: false,
          reason: 'too-long',
        });
      }),
      { numRuns: 400 },
    );
  });

  it('accepts every length from 1 to 100 and rejects every length above it', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 400 }), (length) => {
        const result = validateSquadName(asciiOfLength(length));

        if (length === 0) {
          expect(result).toEqual({ ok: false, reason: 'empty' });
        } else if (length <= 100) {
          expect(result).toEqual({ ok: true, value: asciiOfLength(length) });
        } else {
          expect(result).toEqual({ ok: false, reason: 'too-long' });
        }
      }),
      { numRuns: 500 },
    );
  });

  it('enforces the bound the exported constant names, so a field can carry it', () => {
    // NAME_MAX_LENGTH is rendered as a field's `maxLength`, so it has to be the
    // bound actually enforced. Found by probing rather than compared to a
    // literal: the largest accepted ASCII length must be the constant.
    let largestAccepted = 0;

    for (let length = 1; length <= 200; length += 1) {
      if (validateSquadName(asciiOfLength(length)).ok) {
        largestAccepted = length;
      }
    }

    expect(largestAccepted).toBe(NAME_MAX_LENGTH);
    expect(NAME_MAX_LENGTH).toBe(100);
  });
});

// Feature: web-squads-screens, Property 5: Name validation accepts exactly the
// trimmed non-empty values within the length bound
// Validates: Requirements 3.2, 3.3
describe('name validation — length is counted in UTF-16 code units, matching the column', () => {
  it('accepts 50 astral characters (100 code units) and rejects 100 of them (200)', () => {
    // The single case that decides which unit is counted. Under a
    // grapheme-cluster count, 100 astral characters would be accepted here and
    // then refused by the backend's MaxLength(100) — the exact failure this bound
    // exists to prevent.
    expect(validateSquadName(astralOfCharacters(50))).toEqual({
      ok: true,
      value: astralOfCharacters(50),
    });
    expect(validateSquadName(astralOfCharacters(51))).toEqual({
      ok: false,
      reason: 'too-long',
    });
    expect(validateSquadName(astralOfCharacters(100))).toEqual({
      ok: false,
      reason: 'too-long',
    });
  });

  it('counts a surrogate pair as two units, so 50 astral characters plus one is over', () => {
    // 100 code units of astral text is exactly at the bound; one more ASCII
    // character puts it over. A code-point count would accept this.
    expect(validateSquadName(`${astralOfCharacters(50)}a`)).toEqual({
      ok: false,
      reason: 'too-long',
    });
    expect(validateSquadName(`${astralOfCharacters(49)}ab`)).toEqual({
      ok: true,
      value: `${astralOfCharacters(49)}ab`,
    });
  });

  it('agrees with a code-unit count on generated wide-character names', () => {
    fc.assert(
      fc.property(whitespaceRunArb, wideNameArb, whitespaceRunArb, (leading, wide, trailing) => {
        const input = `${leading}${wide}${trailing}`;
        const trimmed = trimOracle(input);
        const result = validateSquadName(input);

        // Emoji sequences, flags, and combining marks all cost more units than
        // they show, and the oracle charges for each one the way the column does.
        expect(result.ok).toBe(countCodeUnits(trimmed) <= 100);
        expectBothValidatorsAgree(input);
      }),
      { numRuns: 600 },
    );
  });
});

// Feature: web-squads-screens, Property 5: the accepted value is the trimmed
// input
// Validates: Requirements 3.2, 3.4, 3.9
describe('name validation — an accepted value is the input trimmed and nothing else', () => {
  it('yields exactly the trimmed input for every accepted name', () => {
    fc.assert(
      fc.property(nameArb, (input) => {
        const result = validateSquadName(input);

        if (result.ok) {
          // 3.2: the trimmed value is what gets submitted. Not recased, not
          // normalised, not collapsed — the backend stores what was typed.
          expect(result.value).toBe(trimOracle(input));
          expect(result.value).toBe(input.trim());
          expect(result.value).not.toBe('');
          expect(countCodeUnits(result.value)).toBeLessThanOrEqual(100);
        }
      }),
      { numRuns: 800 },
    );
  });

  it('keeps interior whitespace, so a two-word name survives intact', () => {
    fc.assert(
      fc.property(
        whitespaceRunArb,
        fc.stringMatching(/^[A-Za-z]{1,20}$/u),
        whitespaceOnlyArb,
        fc.stringMatching(/^[A-Za-z]{1,20}$/u),
        whitespaceRunArb,
        (leading, first, gap, second, trailing) => {
          const input = `${leading}${first}${gap}${second}${trailing}`;

          // Only the ends are trimmed. Collapsing the gap would change the name a
          // person chose, and would make two distinct display names collide.
          expect(validateSquadName(input)).toEqual({
            ok: true,
            value: `${first}${gap}${second}`,
          });
        },
      ),
      { numRuns: 500 },
    );
  });

  it('treats names differing only in case alike, and recases neither', () => {
    fc.assert(
      fc.property(caseFamilyNameArb, whitespaceRunArb, (name, padding) => {
        // Case is not a rule this function applies: every member of a family is
        // accepted, and each is submitted exactly as typed. Per-squad uniqueness
        // of a display name is the backend's call (3.9), not a client rule that
        // could fold two names together.
        expect(validateSquadName(`${padding}${name}${padding}`)).toEqual({
          ok: true,
          value: name,
        });
        expect(validateDisplayName(name)).toEqual({ ok: true, value: name });
      }),
      { numRuns: 400 },
    );

    for (const family of CASE_FAMILIES) {
      for (const name of family) {
        expect(validateSquadName(name)).toEqual({ ok: true, value: name });
      }
    }
  });

  it('is idempotent: validating an accepted value again accepts the same value', () => {
    fc.assert(
      fc.property(nameArb, (input) => {
        const first = validateSquadName(input);

        if (first.ok) {
          // The submitted value must itself be submittable, so a re-validation
          // on a retry cannot turn an accepted name into a rejection.
          expect(validateSquadName(first.value)).toEqual({
            ok: true,
            value: first.value,
          });
        }
      }),
      { numRuns: 600 },
    );
  });
});

// Feature: web-squads-screens, Property 5: every rejected name yields a named
// failure and no accepted value
// Validates: Requirements 3.3, 3.4, 20.1
describe('name validation — a rejection is one named reason carrying no value', () => {
  it('names one of exactly two reasons and carries no accepted value', () => {
    fc.assert(
      fc.property(nameArb, (input) => {
        const result = validateSquadName(input);

        if (!result.ok) {
          // 3.4: a named failure, for the caller to map to a message from
          // lib/messages.ts. No user-facing wording is produced here.
          expect(['empty', 'too-long']).toContain(result.reason);
          // Asserted with `in`, because a failure that also carried a `value`
          // would let a caller submit a name the rule rejected.
          expect('value' in result).toBe(false);
        } else {
          expect('reason' in result).toBe(false);
        }
      }),
      { numRuns: 800 },
    );
  });

  it('reports empty for nothing entered and too-long only for content over the bound', () => {
    fc.assert(
      fc.property(nameArb, (input) => {
        const result = validateSquadName(input);
        const trimmed = trimOracle(input);

        if (!result.ok && result.reason === 'empty') {
          expect(trimmed).toBe('');
        }

        if (!result.ok && result.reason === 'too-long') {
          // The two reasons are disjoint: an over-long name has content, so a
          // whitespace-only field never reports too-long and vice versa.
          expect(trimmed).not.toBe('');
          expect(countCodeUnits(trimmed)).toBeGreaterThan(100);
        }
      }),
      { numRuns: 800 },
    );
  });
});

// Feature: web-squads-screens, Property 5: the validation is a pure, total
// function of the entered value
// Validates: Requirements 3.4, 20.1
describe('name validation — the rule is pure and total', () => {
  it('returns a well-formed result for every generated name without throwing', () => {
    fc.assert(
      fc.property(nameArb, (input) => {
        const result = validateSquadName(input);

        expect(typeof result.ok).toBe('boolean');

        if (result.ok) {
          expect(typeof result.value).toBe('string');
        } else {
          expect(typeof result.reason).toBe('string');
        }
      }),
      { numRuns: 600 },
    );
  });

  it('is deterministic: repeated calls on one name agree', () => {
    fc.assert(
      fc.property(nameArb, (input) => {
        // A controlled field validates on every keystroke; two calls on the same
        // value must not disagree about the message shown.
        expect(validateSquadName(input)).toEqual(validateSquadName(input));
      }),
      { numRuns: 500 },
    );
  });

  it('depends on nothing but its argument, so an interleaved call changes nothing', () => {
    fc.assert(
      fc.property(nameArb, nameArb, (first, second) => {
        const firstResult = validateSquadName(first);

        // Validating the other field in between must not carry anything over —
        // the two fields on the Create_Squad_Form are validated back to back.
        validateDisplayName(second);
        validateSquadName(second);

        expect(validateSquadName(first)).toEqual(firstResult);
      }),
      { numRuns: 500 },
    );
  });

  it('classifies a value that is not a string as empty rather than raising', () => {
    for (const input of NON_STRING_INPUTS) {
      // Not a shape a form field should produce, but the value originates outside
      // the type system, so the module guards it: nothing typed is nothing
      // entered, and no name reaches the backend by coercion.
      expect(validateSquadName(input as unknown as string)).toEqual({
        ok: false,
        reason: 'empty',
      });
      expect(validateDisplayName(input as unknown as string)).toEqual({
        ok: false,
        reason: 'empty',
      });
    }
  });
});
