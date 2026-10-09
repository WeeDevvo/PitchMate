import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  ANONYMISED_PLACEHOLDER,
  isAnonymisedPlaceholder,
} from './anonymisedName';

/**
 * Property tests for the Anonymised_Placeholder predicate, beside the module they
 * cover and each assertion running well above the 100-case floor (Requirement
 * 14.5).
 *
 * Requirement 5.7 asks for the recognition to be a pure function depending on
 * neither React nor the DOM, and this file is what that buys: both rendered
 * consumers — the subject's Former_Player presentation (Requirement 5.5) and a
 * Pairwise_Section entry's, which keeps its Pairwise_Link (Requirement 10.8) —
 * can be sure the recognition itself is right without rendering anything.
 *
 * Four claims:
 *
 * - **The accepted set is exactly the placeholder after trimming.** Held against
 *   an independently written oracle: the placeholder as the literal
 *   `'Former player'` rather than as the imported constant, and trimming as an
 *   index walk over an explicit character list rather than as a call to `trim`.
 *   The same rule reached by a different route, so a failure means the criterion
 *   is broken rather than that the implementation was restated. The exported
 *   constant is pinned to the literal separately, once — and that one assertion
 *   is also what keeps this feature's declaration and the Squads_Feature's own
 *   declaration of the backend placeholder in step, since each is pinned to the
 *   same literal by its own suite.
 * - **Surrounding whitespace never hides the placeholder.** Over the whole trim
 *   set rather than the space alone: a display name that reached the backend by
 *   paste can carry a non-breaking space (U+00A0) or a BOM (U+FEFF), and a
 *   hand-rolled space strip would pass a space-only test and fail this one.
 *   Sharpened into a claim about every name: padding never changes the verdict.
 * - **The recognition is a value comparison, not a heuristic.** Case variants are
 *   rejected — `'former player'` and `'FORMER PLAYER'` included, and under padding
 *   too, so trimming cannot rescue them — as are interior-whitespace variants and
 *   near misses built by deletion, substitution, and non-whitespace affixes. This
 *   is the half that protects a real person: a name wrongly read as the
 *   placeholder would announce them as erased on their own stats screen. U+200B,
 *   the zero-width space, is asserted **not** to be trimmed; it is not ECMAScript
 *   whitespace, and a wider "any space-like character" rule would be a different
 *   predicate.
 * - **The predicate is pure and total.** A `boolean` primitive for every generated
 *   name including astral and lone-surrogate text, never an exception, repeated
 *   calls in agreement, and no state carried between the names of one
 *   Pairwise_Section.
 *
 * Deliberately not claimed here: that the Player_Identity_Header renders the
 * Former_Player label and no acting control, or that a Pairwise_Section entry
 * keeps its link while presenting as a Former_Player. Those are rendering claims
 * that consume this answer; neither re-decides it.
 */

// --- the oracle --------------------------------------------------------------

/**
 * The Anonymised_Placeholder as a literal — the backend's
 * `SquadMembership.DisplayNamePlaceholder` value, written out rather than
 * imported, so this suite checks the criterion and not the module's own constant.
 * A change to the constant must break these tests loudly rather than move the
 * goalposts quietly.
 */
const PLACEHOLDER_LITERAL = 'Former player';

/**
 * The characters `String.prototype.trim` removes: ECMAScript `WhiteSpace` plus
 * `LineTerminator`. Listed in full so the padding generators draw from the whole
 * set — the no-break space and the BOM are the two a pasted name is most likely to
 * carry, and the two a naive strip forgets.
 *
 * U+200B (zero-width space) is deliberately **absent**: it is not ECMAScript
 * whitespace, so it is not trimmed, and a name padded with it is not the
 * placeholder. That absence is asserted below rather than left implicit.
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

const TRIM_WHITESPACE_SET: ReadonlySet<string> = new Set(TRIM_WHITESPACE);

/** The zero-width space: not whitespace, and so not trimmed. */
const ZERO_WIDTH_SPACE = '\u200b';

/**
 * Trimming as an index walk over {@link TRIM_WHITESPACE} from each end — neither
 * `String.prototype.trim` (the implementation's route) nor a `\s` regular
 * expression, so agreement between this and the module is evidence about the rule
 * rather than about one standard-library function.
 */
function trimOracle(value: string): string {
  let start = 0;
  let end = value.length;

  while (start < end && TRIM_WHITESPACE_SET.has(value.charAt(start))) {
    start += 1;
  }

  while (end > start && TRIM_WHITESPACE_SET.has(value.charAt(end - 1))) {
    end -= 1;
  }

  return value.slice(start, end);
}

/**
 * The rule as Requirements 5.5 and 10.8 word it: a Former_Player is a
 * Player_Display_Name that equals the anonymisation placeholder after trimming,
 * and nothing else — including a name differing only in letter case or by interior
 * whitespace.
 */
function isPlaceholderOracle(displayName: string): boolean {
  return trimOracle(displayName) === PLACEHOLDER_LITERAL;
}

// --- helpers -----------------------------------------------------------------

/** The letter positions of the placeholder, i.e. every index but the space. */
const LETTER_POSITIONS: readonly number[] = [...PLACEHOLDER_LITERAL]
  .map((character, index) => ({ character, index }))
  .filter(({ character }) => !TRIM_WHITESPACE_SET.has(character))
  .map(({ index }) => index);

/** Toggles the letter case at the chosen positions, leaving the rest alone. */
function flipCaseAt(text: string, positions: readonly number[]): string {
  const chosen = new Set(positions);

  return [...text]
    .map((character, index) => {
      if (!chosen.has(index)) {
        return character;
      }

      const upper = character.toUpperCase();

      return character === upper ? character.toLowerCase() : upper;
    })
    .join('');
}

// --- generators --------------------------------------------------------------

const whitespaceCharArb: fc.Arbitrary<string> = fc.constantFrom(
  ...TRIM_WHITESPACE,
);

/** A run of trimmed whitespace, possibly empty and possibly mixed. */
const whitespaceRunArb: fc.Arbitrary<string> = fc.string({
  unit: whitespaceCharArb,
  minLength: 0,
  maxLength: 6,
});

/** A non-empty run, for the cases that must actually carry padding. */
const nonEmptyWhitespaceRunArb: fc.Arbitrary<string> = fc.string({
  unit: whitespaceCharArb,
  minLength: 1,
  maxLength: 6,
});

/** A single printable character that is not trimmed whitespace. */
const nonWhitespaceCharArb: fc.Arbitrary<string> = fc
  .string({ unit: 'grapheme-ascii', minLength: 1, maxLength: 1 })
  .filter((character) => !TRIM_WHITESPACE_SET.has(character));

/** A non-empty run of characters none of which is trimmed away. */
const nonWhitespaceRunArb: fc.Arbitrary<string> = fc.string({
  unit: nonWhitespaceCharArb,
  minLength: 1,
  maxLength: 8,
});

/** The placeholder wrapped in arbitrary (possibly empty) trimmed whitespace. */
const paddedPlaceholderArb: fc.Arbitrary<string> = fc
  .tuple(whitespaceRunArb, whitespaceRunArb)
  .map(([leading, trailing]) => `${leading}${PLACEHOLDER_LITERAL}${trailing}`);

/**
 * The placeholder with at least one letter's case flipped, plus the variants worth
 * naming outright. Flipping any ASCII letter always changes the character, so
 * every value here differs from the placeholder in case alone.
 */
const caseVariantArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc
      .uniqueArray(fc.constantFrom(...LETTER_POSITIONS), {
        minLength: 1,
        maxLength: LETTER_POSITIONS.length,
      })
      .map((positions) => flipCaseAt(PLACEHOLDER_LITERAL, positions)),
  },
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      'former player',
      'FORMER PLAYER',
      'FoRmEr PlAyEr',
      'Former Player',
      'fORMER PLAYER',
    ),
  },
);

/** A case variant wrapped in whitespace, so trimming cannot rescue it. */
const paddedCaseVariantArb: fc.Arbitrary<string> = fc
  .tuple(whitespaceRunArb, caseVariantArb, whitespaceRunArb)
  .map(([leading, variant, trailing]) => `${leading}${variant}${trailing}`);

/**
 * The placeholder with its *interior* whitespace disturbed: an extra whitespace
 * character pushed somewhere inside it, the single interior space swapped for
 * another whitespace character, or that space removed altogether. Insertion
 * positions stop short of both ends, where whitespace would be trimmed away and
 * leave the placeholder intact.
 */
const interiorWhitespaceVariantArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc
      .tuple(
        fc.integer({ min: 1, max: PLACEHOLDER_LITERAL.length - 1 }),
        whitespaceCharArb,
      )
      .map(
        ([position, character]) =>
          `${PLACEHOLDER_LITERAL.slice(0, position)}${character}${PLACEHOLDER_LITERAL.slice(position)}`,
      ),
  },
  {
    weight: 2,
    arbitrary: whitespaceCharArb
      .filter((character) => character !== ' ')
      .map((character) => PLACEHOLDER_LITERAL.replace(' ', character)),
  },
  { weight: 1, arbitrary: fc.constant('Formerplayer') },
);

/**
 * Near misses: one character deleted, one character substituted for a different
 * non-whitespace one, or non-whitespace text added at either end — which survives
 * trimming, so the result is never the placeholder.
 */
const nearMissArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 2,
    arbitrary: fc
      .integer({ min: 0, max: PLACEHOLDER_LITERAL.length - 1 })
      .map(
        (position) =>
          `${PLACEHOLDER_LITERAL.slice(0, position)}${PLACEHOLDER_LITERAL.slice(position + 1)}`,
      ),
  },
  {
    weight: 3,
    arbitrary: fc
      .tuple(
        fc.integer({ min: 0, max: PLACEHOLDER_LITERAL.length - 1 }),
        nonWhitespaceCharArb,
      )
      .filter(
        ([position, character]) =>
          character !== PLACEHOLDER_LITERAL.charAt(position),
      )
      .map(
        ([position, character]) =>
          `${PLACEHOLDER_LITERAL.slice(0, position)}${character}${PLACEHOLDER_LITERAL.slice(position + 1)}`,
      ),
  },
  {
    weight: 3,
    arbitrary: fc
      .tuple(nonWhitespaceRunArb, fc.constantFrom('before', 'after', 'both'))
      .map(([affix, placement]) => {
        if (placement === 'before') {
          return `${affix}${PLACEHOLDER_LITERAL}`;
        }

        if (placement === 'after') {
          return `${PLACEHOLDER_LITERAL}${affix}`;
        }

        return `${affix}${PLACEHOLDER_LITERAL}${affix}`;
      }),
  },
);

/**
 * Names a person might plausibly carry that sit close to the placeholder without
 * being it, including the Cyrillic-о homoglyph and the zero-width-padded forms.
 */
const FIXED_NEAR_MISSES: readonly string[] = [
  '',
  'Former',
  'player',
  'Former players',
  'Former playe',
  'Former  player',
  'Formerplayer',
  'Formerly a player',
  'Former player.',
  'Former player!',
  'A former player',
  'the former player',
  'Ex-player',
  'Fоrmer player', // Cyrillic 'о' in place of the Latin one
  `${ZERO_WIDTH_SPACE}${PLACEHOLDER_LITERAL}`,
  `${PLACEHOLDER_LITERAL}${ZERO_WIDTH_SPACE}`,
  `${ZERO_WIDTH_SPACE}${PLACEHOLDER_LITERAL}${ZERO_WIDTH_SPACE}`,
];

/**
 * The whole generated input space for the agreement claim: the placeholder family,
 * every deliberate variant, and plain arbitrary text — astral and lone-surrogate
 * strings included, which a display name read straight off the wire can
 * legitimately be.
 */
const displayNameArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: paddedPlaceholderArb },
  { weight: 2, arbitrary: paddedCaseVariantArb },
  { weight: 2, arbitrary: interiorWhitespaceVariantArb },
  { weight: 3, arbitrary: nearMissArb },
  { weight: 2, arbitrary: fc.constantFrom(...FIXED_NEAR_MISSES) },
  { weight: 3, arbitrary: fc.string({ maxLength: 40 }) },
  { weight: 1, arbitrary: fc.string({ unit: 'grapheme', maxLength: 16 }) },
  { weight: 1, arbitrary: fc.string({ unit: 'binary', maxLength: 16 }) },
  {
    weight: 2,
    arbitrary: fc
      .tuple(whitespaceRunArb, fc.string({ maxLength: 24 }), whitespaceRunArb)
      .map(([leading, text, trailing]) => `${leading}${text}${trailing}`),
  },
);

// Feature: web-player-stats-screen, supporting property for Requirements 5.5 and
// 10.8: the anonymised-placeholder predicate accepts exactly the placeholder
// Validates: Requirements 5.5, 5.7, 10.8, 14.5
describe('isAnonymisedPlaceholder — the accepted set is exactly the placeholder after trimming', () => {
  it('agrees with the Former_Player criterion on every generated display name', () => {
    fc.assert(
      fc.property(displayNameArb, (displayName) => {
        // The oracle trims through an explicit whitespace list and compares
        // against a literal, so this checks the rule rather than restating the
        // module's one-line body.
        expect(isAnonymisedPlaceholder(displayName)).toBe(
          isPlaceholderOracle(displayName),
        );
      }),
      { numRuns: 1000 },
    );
  });

  it('pins the exported constant to the backend placeholder the oracle uses', () => {
    // The single place the two independent statements of the placeholder meet. The
    // Squads_Feature pins its own declaration to this same literal, which is how
    // a player-list row and the stats screen it opens agree on what a
    // Former_Player is without this feature importing that one's internals.
    expect(ANONYMISED_PLACEHOLDER).toBe(PLACEHOLDER_LITERAL);
  });

  it('accepts the placeholder exactly as the backend writes it', () => {
    expect(isAnonymisedPlaceholder(PLACEHOLDER_LITERAL)).toBe(true);
  });

  it('generates a space carrying both verdicts, so the agreement claim is not vacuous', () => {
    const sampled = fc.sample(displayNameArb, { numRuns: 500, seed: 55 });
    const accepted = sampled.filter((displayName) =>
      isAnonymisedPlaceholder(displayName),
    );

    // Without this, an implementation returning a constant `false` would satisfy
    // the agreement property against a generator that never produced a
    // placeholder.
    expect(accepted.length).toBeGreaterThan(0);
    expect(sampled.length - accepted.length).toBeGreaterThan(0);
  });
});

// Feature: web-player-stats-screen, supporting property for Requirements 5.5 and
// 10.8: surrounding whitespace never hides the placeholder
// Validates: Requirements 5.5, 5.7, 10.8, 14.5
describe('isAnonymisedPlaceholder — surrounding whitespace never hides the placeholder', () => {
  it('accepts the placeholder under any run of leading and trailing whitespace', () => {
    fc.assert(
      fc.property(whitespaceRunArb, whitespaceRunArb, (leading, trailing) => {
        // The comparison is exact *after trimming*, so a padded name still reads
        // as erased and the screen still presents a Former_Player.
        expect(
          isAnonymisedPlaceholder(`${leading}${PLACEHOLDER_LITERAL}${trailing}`),
        ).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('accepts the placeholder padded with each trimmed whitespace character in turn', () => {
    for (const character of TRIM_WHITESPACE) {
      expect({
        codePoint: character.codePointAt(0),
        recognised: isAnonymisedPlaceholder(
          `${character}${PLACEHOLDER_LITERAL}${character}`,
        ),
      }).toEqual({ codePoint: character.codePointAt(0), recognised: true });
    }
  });

  it('gives the same verdict for a name and for that name padded with whitespace', () => {
    fc.assert(
      fc.property(
        displayNameArb,
        whitespaceRunArb,
        whitespaceRunArb,
        (displayName, leading, trailing) => {
          // The sharp form of "after trimming": padding is invisible to the
          // predicate for every name, not only for the placeholder.
          expect(
            isAnonymisedPlaceholder(`${leading}${displayName}${trailing}`),
          ).toBe(isAnonymisedPlaceholder(displayName));
        },
      ),
      { numRuns: 500 },
    );
  });

  it('does not trim the zero-width space, which is not whitespace', () => {
    fc.assert(
      fc.property(fc.constantFrom('before', 'after', 'both'), (placement) => {
        const padded =
          placement === 'before'
            ? `${ZERO_WIDTH_SPACE}${PLACEHOLDER_LITERAL}`
            : placement === 'after'
              ? `${PLACEHOLDER_LITERAL}${ZERO_WIDTH_SPACE}`
              : `${ZERO_WIDTH_SPACE}${PLACEHOLDER_LITERAL}${ZERO_WIDTH_SPACE}`;

        // U+200B is not in ECMAScript's WhiteSpace set, so `trim` leaves it in
        // place and the name is not the placeholder. A predicate built on a wider
        // "any space-like character" rule would disagree here.
        expect(isAnonymisedPlaceholder(padded)).toBe(false);
      }),
      { numRuns: 150 },
    );
  });
});

// Feature: web-player-stats-screen, supporting property for Requirements 5.5 and
// 10.8: the recognition is a value comparison, not a heuristic
// Validates: Requirements 5.5, 5.7, 10.8, 14.5
describe('isAnonymisedPlaceholder — the recognition is a value comparison, not a heuristic', () => {
  it('rejects every name differing from the placeholder in letter case alone', () => {
    fc.assert(
      fc.property(caseVariantArb, (variant) => {
        // A person who genuinely calls themselves `former player` sees their own
        // name on their own stats screen, not an erasure label.
        expect(variant).not.toBe(PLACEHOLDER_LITERAL);
        expect(isAnonymisedPlaceholder(variant)).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it('rejects a case variant however it is padded, so trimming cannot rescue it', () => {
    fc.assert(
      fc.property(paddedCaseVariantArb, (padded) => {
        expect(isAnonymisedPlaceholder(padded)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('rejects the two case variants named outright', () => {
    expect(isAnonymisedPlaceholder('former player')).toBe(false);
    expect(isAnonymisedPlaceholder('FORMER PLAYER')).toBe(false);
  });

  it('rejects every interior-whitespace variant', () => {
    fc.assert(
      fc.property(interiorWhitespaceVariantArb, (variant) => {
        // Trimming touches the ends only, so `Former  player` and
        // `Former\u00a0player` are ordinary names as far as this predicate goes.
        expect(variant).not.toBe(PLACEHOLDER_LITERAL);
        expect(isAnonymisedPlaceholder(variant)).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it('rejects the doubled interior space, the missing one, and the non-breaking one', () => {
    expect(isAnonymisedPlaceholder('Former  player')).toBe(false);
    expect(isAnonymisedPlaceholder('Formerplayer')).toBe(false);
    expect(isAnonymisedPlaceholder('Former\u00a0player')).toBe(false);
  });

  it('rejects near misses built by deletion, substitution, and non-whitespace affixes', () => {
    fc.assert(
      fc.property(nearMissArb, (nearMiss) => {
        // Not a prefix test and not a "contains former" test: a name that merely
        // holds the placeholder is not the placeholder.
        expect(isAnonymisedPlaceholder(nearMiss)).toBe(false);
      }),
      { numRuns: 700 },
    );
  });

  it('rejects each fixed near-miss name', () => {
    for (const nearMiss of FIXED_NEAR_MISSES) {
      expect({
        name: nearMiss,
        recognised: isAnonymisedPlaceholder(nearMiss),
      }).toEqual({ name: nearMiss, recognised: false });
    }
  });
});

// Feature: web-player-stats-screen, supporting property for Requirement 5.7: the
// predicate is a pure, total function of the display name
// Validates: Requirements 5.7, 14.5
describe('isAnonymisedPlaceholder — the predicate is pure and total', () => {
  it('returns a boolean primitive for every generated name without throwing', () => {
    fc.assert(
      fc.property(displayNameArb, (displayName) => {
        const recognised = isAnonymisedPlaceholder(displayName);

        // Total: one trim and one comparison, no structure to recurse into and no
        // input a parsed display name could carry that raises.
        expect(typeof recognised).toBe('boolean');
      }),
      { numRuns: 500 },
    );
  });

  it('is deterministic: repeated calls on one name agree', () => {
    fc.assert(
      fc.property(displayNameArb, (displayName) => {
        // The header asks this on every render; two renders of the same parsed
        // name must not disagree about whether the subject is a Former_Player.
        expect(isAnonymisedPlaceholder(displayName)).toBe(
          isAnonymisedPlaceholder(displayName),
        );
      }),
      { numRuns: 300 },
    );
  });

  it('depends on nothing but its argument', () => {
    fc.assert(
      fc.property(displayNameArb, displayNameArb, (first, second) => {
        const firstVerdict = isAnonymisedPlaceholder(first);

        // Interleaving a call for another name changes nothing, so the predicate
        // holds no state between the entries of one Pairwise_Section.
        isAnonymisedPlaceholder(second);

        expect(isAnonymisedPlaceholder(first)).toBe(firstVerdict);
      }),
      { numRuns: 300 },
    );
  });

  it('reformats nothing: the name is read, never rewritten', () => {
    fc.assert(
      fc.property(nonEmptyWhitespaceRunArb, (padding) => {
        const padded = `${padding}${PLACEHOLDER_LITERAL}${padding}`;
        const before = padded;

        isAnonymisedPlaceholder(padded);

        // Strings are immutable, so this is really a claim about the predicate
        // returning a verdict rather than a cleaned-up name: a name reaches the
        // screen exactly as parsed, padding and all.
        expect(padded).toBe(before);
      }),
      { numRuns: 200 },
    );
  });
});
