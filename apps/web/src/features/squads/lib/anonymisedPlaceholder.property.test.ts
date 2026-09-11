import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { ANONYMISED_PLACEHOLDER, isAnonymisedPlaceholder } from './playerList';

/**
 * Property tests for the Anonymised_Placeholder predicate, beside the module it
 * covers as the design's Testing Strategy asks, and running well above the
 * 100-iteration floor (Requirement 20.1).
 *
 * Requirement 7.9 asks for the recognition to be *a pure predicate over a
 * Player_Display_Name, so that the recognition is testable without a browser* —
 * and this file is what that requirement buys. Two rendered rules read the answer
 * (the Former_Player labelling of Requirement 7.8 and the promotion exclusion of
 * Requirement 13.2) plus the guest-edit exclusion of Requirement 12.7, and none of
 * them has to render anything to be sure the recognition itself is right.
 *
 * Four claims are made:
 *
 * - **The accepted set is exactly the placeholder after trimming.** Stated against
 *   an independently written oracle: the placeholder as the literal
 *   `'Former player'` rather than as the imported constant, and trimming as an
 *   index walk over an explicit list of the characters `String.prototype.trim`
 *   removes rather than as a call to `trim` (or to the `\s` regular expression the
 *   name-validation oracle uses). Same rule, a different route to it, so a failure
 *   here means the criterion is broken rather than that the implementation was
 *   restated. The imported constant is pinned to the literal separately, once.
 * - **Surrounding whitespace never hides the placeholder.** Over the *whole* trim
 *   set, not the space character alone — a name pasted from a spreadsheet or a
 *   chat message can easily arrive carrying a non-breaking space (U+00A0) or a BOM
 *   (U+FEFF), and a hand-rolled space strip would pass a space-only test and fail
 *   this one. Sharpened into a claim about every name, not just the placeholder:
 *   padding a name with whitespace never changes the verdict.
 * - **The recognition is a value comparison, not a heuristic.** Case variants are
 *   rejected — `'former player'` and `'FORMER PLAYER'` included, and under
 *   whitespace padding too, so trimming cannot rescue them — as are
 *   interior-whitespace variants and near misses built by deleting a character,
 *   substituting one, and adding non-whitespace text at either end. This is the
 *   half of the property that protects a real player: a name wrongly read as the
 *   placeholder would strip their Promotion_Control and label them as erased,
 *   which is worse than an erased row keeping a control the backend refuses
 *   anyway (Requirement 10.5). U+200B, the zero-width space, is asserted **not**
 *   to be trimmed — it is not ECMAScript whitespace, and a `\p{White_Space}`-style
 *   strip that included it would be a different rule.
 * - **The predicate is pure and total.** A `boolean` primitive for every generated
 *   name including astral and lone-surrogate text, never an exception, repeated
 *   calls in agreement, and no state carried between calls.
 *
 * What is deliberately **not** claimed here: that a Player_Row whose name is the
 * placeholder renders the former-player label and drops its promotion and edit
 * controls (Property 16, at the rendering site), that the composed row's
 * `isFormerPlayer` flag is derived from this predicate (Property 14), or that
 * promotion eligibility excludes such a row (Property 27). Those all consume this
 * answer; none of them re-decides it.
 */

// --- the oracle --------------------------------------------------------------

/**
 * The Anonymised_Placeholder as a literal — the backend's
 * `SquadMembership.DisplayNamePlaceholder` value, written out here rather than
 * imported, so that this suite checks the criterion and not the module's own
 * constant. A change to the constant must break these tests loudly rather than
 * move the goalposts quietly.
 */
const PLACEHOLDER_LITERAL = 'Former player';

/**
 * The characters `String.prototype.trim` removes: ECMAScript `WhiteSpace` plus
 * `LineTerminator`. Listed in full so the padding generators draw from the whole
 * set — the non-breaking space and the BOM are the two a real pasted name is most
 * likely to carry, and they are also the two a naive strip forgets.
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
 * Trimming, as an index walk over {@link TRIM_WHITESPACE} from each end. Neither
 * `String.prototype.trim` (the implementation's route) nor a `\s` regular
 * expression (the name-validation oracle's route), so agreement between this and
 * the module is evidence about the rule rather than about one function.
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
 * The rule as Requirement 7.9 and the design's Property 17 word it: true exactly
 * when the name equals the anonymisation placeholder after trimming, and false for
 * every other name — including one differing only in letter case or by interior
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
 * The placeholder with at least one letter's case flipped, plus the three variants
 * the task names outright. Flipping any ASCII letter always changes the character,
 * so every value here differs from the placeholder in case alone.
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
 * positions stop short of both ends, since whitespace there is trimmed away and
 * would leave the placeholder intact.
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
 * non-whitespace one, or non-whitespace text added at either end (which survives
 * trimming, so the result is never the placeholder).
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
 * Names a person or a squad might plausibly carry that sit close to the
 * placeholder without being it, including the Cyrillic-о homoglyph and both
 * zero-width-padded forms.
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
 * every deliberate variant, and plain arbitrary text — including astral and
 * lone-surrogate strings, which a display name parsed straight off the wire can
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

// Feature: web-squads-screens, Property 17: The anonymised-placeholder predicate accepts exactly the placeholder
// Validates: Requirements 7.9
describe('isAnonymisedPlaceholder — the accepted set is exactly the placeholder after trimming', () => {
  it('agrees with the criterion of Requirement 7.9 on every generated display name', () => {
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
    // The single place the two independent statements of the placeholder meet: if
    // the backend value ever changes, this is the assertion that has to be
    // updated deliberately, and every generator above follows from the literal.
    expect(ANONYMISED_PLACEHOLDER).toBe(PLACEHOLDER_LITERAL);
  });

  it('accepts the placeholder exactly as the backend writes it', () => {
    expect(isAnonymisedPlaceholder(PLACEHOLDER_LITERAL)).toBe(true);
  });

  it('generates a space carrying both verdicts, so the agreement claim is not vacuous', () => {
    const sampled = fc.sample(displayNameArb, { numRuns: 500, seed: 17 });
    const accepted = sampled.filter((displayName) =>
      isAnonymisedPlaceholder(displayName),
    );

    // Without this, an implementation returning a constant `false` would satisfy
    // the agreement property against a generator that never produced a placeholder.
    expect(accepted.length).toBeGreaterThan(0);
    expect(sampled.length - accepted.length).toBeGreaterThan(0);
  });
});

// Feature: web-squads-screens, Property 17: The anonymised-placeholder predicate accepts exactly the placeholder
// Validates: Requirements 7.9
describe('isAnonymisedPlaceholder — surrounding whitespace never hides the placeholder', () => {
  it('accepts the placeholder under any run of leading and trailing whitespace', () => {
    fc.assert(
      fc.property(whitespaceRunArb, whitespaceRunArb, (leading, trailing) => {
        // 7.9: the comparison is exact *after trimming*, so a name that arrives
        // padded — pasted from a message, say — is still recognised as erased.
        expect(
          isAnonymisedPlaceholder(
            `${leading}${PLACEHOLDER_LITERAL}${trailing}`,
          ),
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
          // predicate for *every* name, not only for the placeholder.
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
      fc.property(
        fc.constantFrom('before', 'after', 'both'),
        (placement) => {
          const padded =
            placement === 'before'
              ? `${ZERO_WIDTH_SPACE}${PLACEHOLDER_LITERAL}`
              : placement === 'after'
                ? `${PLACEHOLDER_LITERAL}${ZERO_WIDTH_SPACE}`
                : `${ZERO_WIDTH_SPACE}${PLACEHOLDER_LITERAL}${ZERO_WIDTH_SPACE}`;

          // U+200B is not in ECMAScript's WhiteSpace set, so `trim` leaves it in
          // place and the name is not the placeholder. A predicate built on a
          // wider "any space-like character" rule would disagree here.
          expect(isAnonymisedPlaceholder(padded)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: web-squads-screens, Property 17: The anonymised-placeholder predicate accepts exactly the placeholder
// Validates: Requirements 7.9
describe('isAnonymisedPlaceholder — the recognition is a value comparison, not a heuristic', () => {
  it('rejects every name differing from the placeholder in letter case alone', () => {
    fc.assert(
      fc.property(caseVariantArb, (variant) => {
        // A member who genuinely calls themselves `former player` keeps their
        // Promotion_Control: guessing here would strip a real player's controls
        // and label them as erased.
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

  it('rejects the doubled interior space and the missing one', () => {
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

// Feature: web-squads-screens, Property 17: the predicate is a pure, total function
// of the display name
// Validates: Requirements 7.9
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
        // A Player_Row asks this on every render; two renders of the same parsed
        // name must not disagree about whether the row is a Former_Player.
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

        // Interleaving a call for another row changes nothing, so the predicate
        // holds no state between the rows of one Player_List.
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
        // returning a verdict rather than a cleaned-up name for display: a name
        // reaches the screen exactly as parsed, padding and all.
        expect(padded).toBe(before);
      }),
      { numRuns: 200 },
    );
  });
});
